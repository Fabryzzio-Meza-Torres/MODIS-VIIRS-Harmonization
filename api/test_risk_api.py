"""HTTP contract, snapshot integrity and expiry using the actual pilot artifact."""
from datetime import datetime,timedelta
from pathlib import Path
import copy,hashlib,json,tempfile,unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from risk_api import router

SOURCE=Path(__file__).resolve().parents[1]/'data/regional_outlook.json'


class RiskApiTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'regional_outlook.json'
        self.document=json.loads(SOURCE.read_bytes())
        self.issued=datetime.fromisoformat(self.document['metadata']['issued_at'])
        self.current=self.issued+timedelta(minutes=2)
        self.write(self.document)
        app=FastAPI();app.include_router(router(self.path,clock=lambda:self.current))
        self.client=TestClient(app)

    def tearDown(self):
        self.client.close();self.temp.cleanup()

    def write(self,document):
        raw=json.dumps(document,allow_nan=False).encode()
        self.path.write_bytes(raw)
        meta=document['metadata']
        self.path.with_name('regional_outlook_manifest.json').write_text(json.dumps({
            'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'rows':300,
            'snapshot_id':meta['snapshot_id'],'method_version':meta['method_version']}))

    def test_region_week_percent_and_semantics(self):
        result=self.client.get('/v1/fire-risk',params={'region_id':'08','target_week_start':'2026-11-16'})
        self.assertEqual(result.status_code,200,result.text)
        row=result.json()['data'][0]
        self.assertAlmostEqual(row['probability_percent'],97.665377,places=5)
        self.assertEqual(row['target_week_end_exclusive'],'2026-11-23')
        self.assertEqual(row['lead_weeks'],1)
        meta=result.json()['metadata']
        self.assertFalse(meta['physical_ignition_probability_verified'])
        self.assertFalse(meta['cumulative_twelve_week_risk'])
        self.assertEqual(meta['target_period_status'],'upcoming')
        self.assertNotIn('raw_model_probability_for_review',row)

    def test_full_grid_pagination_and_region(self):
        data=self.client.get('/v1/fire-risk/outlook?limit=1000').json()['data']
        self.assertEqual(len({(r['region_id'],r['lead_weeks']) for r in data}),300)
        self.assertTrue(all(0<=r['probability_percent']<=100 for r in data))
        regional=self.client.get('/v1/fire-risk/outlook?region_id=08').json()['data']
        self.assertEqual([r['lead_weeks'] for r in regional],list(range(1,13)))
        page=self.client.get('/v1/fire-risk/outlook?limit=7').json()
        self.assertEqual(page['pagination']['next_offset'],7)
        nextpage=self.client.get('/v1/fire-risk/outlook?limit=7&offset=7').json()
        self.assertNotEqual(page['data'][-1],nextpage['data'][0])

    def test_invalid_queries(self):
        for query,code in [('region_id=08&target_week_start=2026-11-17',422),
                ('region_id=99&target_week_start=2026-11-16',404),
                ('region_id=08&target_week_start=2027-02-08',404),
                ('region_id=8&target_week_start=2026-11-16',422)]:
            self.assertEqual(self.client.get('/v1/fire-risk?'+query).status_code,code)
        self.assertEqual(self.client.get('/v1/fire-risk/outlook?limit=1001').status_code,422)

    def test_expired_snapshot_never_returns_live_percentage(self):
        self.current=datetime.fromisoformat('2026-11-22T00:00:00-05:00')
        result=self.client.get('/v1/fire-risk/outlook')
        self.assertEqual(result.status_code,503)
        self.assertEqual(result.json()['detail']['code'],'risk_snapshot_expired')
        meta=self.client.get('/v1/fire-risk/metadata').json()
        self.assertTrue(meta['refresh_required'])
        self.assertIn('available_target_weeks',meta)

    def test_no_backdated_release(self):
        self.current=self.issued-timedelta(seconds=1)
        self.assertEqual(self.client.get('/v1/fire-risk/outlook').status_code,503)

    def test_integrity_and_missing_snapshot(self):
        self.path.write_bytes(self.path.read_bytes()+b' ')
        self.assertEqual(self.client.get('/v1/fire-risk/outlook').status_code,503)
        self.path.unlink()
        self.assertEqual(self.client.get('/v1/fire-risk/outlook').status_code,503)

    def test_semantic_corruption_rejected_even_with_updated_hash(self):
        for field,value in [('probability',1.01),('probability_percent',0),
                ('target_week_start','2026-11-23'),('region_id','99')]:
            doc=copy.deepcopy(self.document);doc['data'][0][field]=value
            self.write(doc)
            self.assertEqual(self.client.get('/v1/fire-risk/outlook').status_code,503,field)
        doc=copy.deepcopy(self.document);doc['data'][1]=doc['data'][0]
        self.write(doc)
        self.assertEqual(self.client.get('/v1/fire-risk/outlook').status_code,503)

    def test_unavailable_is_null_with_reason_never_zero(self):
        doc=copy.deepcopy(self.document);row=doc['data'][0]
        row.update(probability=None,probability_percent=None,estimation_status='unavailable',
            quality_status='insufficient_support',unavailable_reasons=['missing_weather'])
        self.write(doc)
        result=self.client.get('/v1/fire-risk/outlook?region_id=01').json()['data'][0]
        self.assertIsNone(result['probability'])
        self.assertEqual(result['unavailable_reasons'],['missing_weather'])

    def test_same_week_is_marked_in_progress(self):
        self.current=datetime.fromisoformat('2026-11-18T00:00:00-05:00')
        response=self.client.get('/v1/fire-risk?region_id=08&target_week_start=2026-11-16')
        self.assertEqual(response.json()['metadata']['target_period_status'],'in_progress')


if __name__=='__main__':unittest.main()
