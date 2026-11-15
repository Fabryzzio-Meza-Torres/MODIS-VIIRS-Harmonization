import json
import csv
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from fastapi.testclient import TestClient
from api import create_app
from prepare_data import SCHEMA, optional_float
from prepare_data import file_hash
from publish_series import publish


class SeriesApiTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.db=Path(self.temp.name)/'test.sqlite'
        with closing(sqlite3.connect(self.db)) as db, db:
            db.executescript(SCHEMA)
            for name, extra in [
                ('raw',{'crs':'test','missing_policy':'unknown'}),
                ('baseline_national',{'status':'provisional_baseline'}),
                ('coverage_pilot',{'status':'experimental'}),
                ('harmonized',{'status':'not_published'}),
            ]:
                db.execute('INSERT INTO datasets VALUES (?,?)',(name,json.dumps({'name':name,**extra})))
            db.execute('INSERT INTO cells VALUES (?)',('laea10_1_2',))
            db.executemany('INSERT INTO raw VALUES (?,?,?,?,?)',[
                ('laea10_1_2','2023-01-02','Aqua',1,'unknown'),
                ('laea10_1_2','2023-01-02','Suomi-NPP',7,'unknown'),
                ('laea10_1_2','2023-01-16','Aqua',2,'unknown')])
            db.execute('INSERT INTO national VALUES (?,?,?,?,?,?)',
                ('2023-01-02',None,7,2,'unknown','test-baseline'))
            db.execute('INSERT INTO pilot VALUES (?,?,?,?,?,?)',
                ('laea10_1_2','file.nc','VNP03IMG',100,60,'experimental_center_derived_footprints'))
        self.client=TestClient(create_app(self.db))
        self.query={'cell_id':'laea10_1_2','start':'2023-01-01','end':'2023-02-01'}

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def test_health_and_openapi(self):
        self.assertTrue(self.client.get('/health').json()['database_available'])
        self.assertIn('/v1/series',self.client.get('/openapi.json').json()['paths'])

    def test_raw_absence_is_not_filled_with_zero(self):
        data=self.client.get('/v1/raw-series',params=self.query).json()['data']
        self.assertEqual([r['raw_count'] for r in data],[1,7,2])
        self.assertNotIn('2023-01-09',[r['week_start_utc'] for r in data])
        self.assertTrue(all(r['coverage_status']=='unknown' for r in data))

    def test_end_exclusive(self):
        params={**self.query,'end':'2023-01-16'}
        data=self.client.get('/v1/raw-series',params=params).json()['data']
        self.assertEqual(len(data),2)

    def test_pagination(self):
        first=self.client.get('/v1/raw-series',params={**self.query,'limit':2}).json()
        self.assertEqual(first['pagination']['next_offset'],2)
        last=self.client.get('/v1/raw-series',params={**self.query,'limit':2,'offset':2}).json()
        self.assertEqual(len(last['data']),1)
        self.assertIsNone(last['pagination']['next_offset'])

    def test_date_and_cell_validation(self):
        for changes in [{'start':'wrong'},{'end':'2022-01-01'},{'cell_id':"';DROP TABLE raw;--"},
                        {'limit':1001},{'offset':-1}]:
            self.assertEqual(self.client.get('/v1/raw-series',params={**self.query,**changes}).status_code,422)

    def test_unpublished_final_series_is_not_baseline(self):
        r=self.client.get('/v1/series',params=self.query)
        self.assertEqual(r.status_code,503)
        self.assertEqual(r.json()['detail']['code'],'harmonization_not_published')

    def test_published_fixture_response(self):
        # Solo datos sintéticos de contrato; no representa validación científica.
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute('UPDATE datasets SET payload=? WHERE name=?',
                       (json.dumps({'status':'validated_published','name':'harmonized'}),'harmonized'))
            db.execute('INSERT INTO harmonized VALUES (?,?,?,?,?,?,?,?,?,?)',
                       ('laea10_1_2','2023-01-02',2,1,3,'partial','estimated',
                        json.dumps(['Aqua','Suomi-NPP']),'fixture-v1','fixture-sha'))
        r=self.client.get('/v1/series',params=self.query)
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['data'][0]['platforms_used'],['Aqua','Suomi-NPP'])
        self.assertEqual(r.json()['data'][0]['method_version'],'fixture-v1')

    def test_baseline_preserves_null_and_label(self):
        r=self.client.get('/v1/baselines/national',params={'start':'2023-01-01','end':'2023-02-01'}).json()
        self.assertIsNone(r['data'][0]['raw_aqua'])
        self.assertEqual(r['metadata']['status'],'provisional_baseline')

    def test_pilot_retains_experimental_label(self):
        r=self.client.get('/v1/coverage/pilot',params={'cell_id':'laea10_1_2'}).json()
        self.assertEqual(r['metadata']['status'],'experimental')
        self.assertEqual(r['data'][0]['candidate_usable_area_km2'],60)

    def test_missing_database_is_503(self):
        with TestClient(create_app(Path(self.temp.name)/'missing.sqlite')) as client:
            self.assertEqual(client.get('/v1/datasets').status_code,503)

    def test_read_only_cors(self):
        headers={'Origin':'https://dashboard.example','Access-Control-Request-Method':'GET'}
        r=self.client.options('/v1/datasets',headers=headers)
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.headers['access-control-allow-origin'],'*')
        self.assertNotIn('access-control-allow-credentials',r.headers)
        self.assertEqual(self.client.post('/v1/datasets',json={}).status_code,405)

    def test_ingestion_rejects_non_finite_or_negative(self):
        self.assertIsNone(optional_float(''))
        for value in ['nan','inf','-1']:
            with self.assertRaises(ValueError):
                optional_float(value)

    def publication_fixture(self, rows=None, reviewed=True):
        folder=Path(self.temp.name)
        data=folder/'series.csv'
        report=folder/'validation.json'
        manifest=folder/'manifest.json'
        item={'cell_id':'laea10_1_2','week_start_utc':'2023-01-02T00:00:00Z',
              'harmonized_count':'2.5','lower_bound':'1','upper_bound':'4',
              'coverage_status':'partial','estimation_status':'estimated',
              'platforms_used':'["Aqua","Suomi-NPP"]','method_version':'fixture-v1',
              'source_snapshot_id':'synthetic-fixture'}
        with data.open('w',encoding='utf-8',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=item.keys()); writer.writeheader()
            writer.writerows(rows if rows is not None else [item])
        report.write_text('{"synthetic_contract_test":true}',encoding='utf-8')
        meta={'method_version':'fixture-v1','reference_scale':'synthetic-test-units',
              'source_snapshot_id':'synthetic-fixture','interval_level':0.95,
              'validation_status':'accepted','human_reviewed':reviewed,
              'data_sha256':file_hash(data),'validation_report_sha256':file_hash(report)}
        manifest.write_text(json.dumps(meta),encoding='utf-8')
        return data,manifest,report,item

    def test_publication_serves_validated_batch(self):
        data,meta,report,_=self.publication_fixture()
        self.assertEqual(publish(self.db,data,meta,report),1)
        r=self.client.get('/v1/series',params=self.query).json()
        self.assertEqual(r['data'][0]['harmonized_count'],2.5)
        self.assertEqual(r['metadata']['reference_scale'],'synthetic-test-units')

    def test_publication_requires_review(self):
        data,meta,report,_=self.publication_fixture(reviewed=False)
        with self.assertRaises(ValueError): publish(self.db,data,meta,report)
        self.assertEqual(self.client.get('/v1/series',params=self.query).status_code,503)

    def test_publication_bad_batch_preserves_previous_release(self):
        data,meta,report,item=self.publication_fixture()
        publish(self.db,data,meta,report)
        bad={**item,'week_start_utc':'2023-01-09','harmonized_count':'nan'}
        data,meta,report,_=self.publication_fixture(rows=[item,bad])
        with self.assertRaises(ValueError): publish(self.db,data,meta,report)
        r=self.client.get('/v1/series',params=self.query).json()
        self.assertEqual(len(r['data']),1)
        self.assertEqual(r['data'][0]['harmonized_count'],2.5)

    def test_publication_rejects_changed_validated_file(self):
        data,meta,report,_=self.publication_fixture()
        data.write_text('changed after validation',encoding='utf-8')
        with self.assertRaises(ValueError): publish(self.db,data,meta,report)


if __name__=='__main__':
    unittest.main(verbosity=2)
