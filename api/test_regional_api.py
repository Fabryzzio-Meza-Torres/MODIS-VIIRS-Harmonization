from pathlib import Path
from contextlib import closing
import csv,gzip,hashlib,json,sqlite3,tempfile,unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from add_regions import enrich
from history_api import router

class RegionalApiTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.db=self.root/'history.sqlite';assets=self.root/'assets';assets.mkdir();self.assets=assets
        with closing(sqlite3.connect(self.db)) as db,db:
            db.executescript('''CREATE TABLE metadata(name TEXT PRIMARY KEY,payload TEXT);
                CREATE TABLE cells(cell_id TEXT PRIMARY KEY,center_lon REAL,center_lat REAL,country_area_km2 REAL);
                CREATE TABLE cell_series(cell_id TEXT,week_start_utc TEXT,instrument TEXT,platform TEXT,
                    raw_count INTEGER,harmonized_count REAL,lower_bound REAL,upper_bound REAL);
                CREATE TABLE national_series(week_start_utc TEXT,instrument TEXT,platform TEXT,raw_count INTEGER,
                    harmonized_count REAL,lower_bound REAL,upper_bound REAL,coverage_status TEXT,estimation_status TEXT);
                CREATE TABLE forecasts(cell_id TEXT,center_lon REAL,center_lat REAL,country_area_km2 REAL,
                    record_probability REAL,rank INTEGER,target_week_start TEXT,target_week_end TEXT,quality_flag TEXT);''')
            db.executemany('INSERT INTO metadata VALUES (?,?)',[(n,json.dumps({'name':n,'coverage_corrected':False})) for n in ['series','forecast','validation']])
            db.execute('INSERT INTO cells VALUES (?,?,?,?)',('laea10_1_1',-76,-10.75,100))
            for week,instrument,platform,count,factor in [('2023-08-07','MODIS','Aqua',4,2),
                    ('2023-08-07','VIIRS','Suomi-NPP',10,.5),('2023-08-14','MODIS','Aqua',3,2)]:
                db.execute('INSERT INTO national_series VALUES (?,?,?,?,?,?,?,?,?)',
                    (week,instrument,platform,count,count*factor,count*factor*.9,count*factor*1.1,'unknown','estimated'))
                db.execute('INSERT INTO cell_series VALUES (?,?,?,?,?,?,?,?)',
                    ('laea10_1_1',week,instrument,platform,count,count*factor,count*factor*.9,count*factor*1.1))
            db.execute('INSERT INTO forecasts VALUES (?,?,?,?,?,?,?,?,?)',
                ('laea10_1_1',-76,-10.75,100,.7,1,'2026-11-16','2026-11-22','experimental'))
        # Region A is concave: its bounding box includes points outside its polygon.
        polygons=[('01','ALFA',[[-77,-11],[-76,-11],[-76,-10.5],[-76.5,-10.5],[-76.5,-10],[-77,-10],[-77,-11]]),
                  ('02','BETA',[[-76,-11],[-75,-11],[-75,-10],[-76,-10],[-76,-11]])]
        (assets/'regions.geojson').write_text(json.dumps({'type':'FeatureCollection','features':[
            {'type':'Feature','properties':{'region_id':rid,'name':name},'geometry':{'type':'Polygon','coordinates':[ring]}}
            for rid,name,ring in polygons]}))
        (assets/'regional_metadata.json').write_text(json.dumps({'boundary_source':'synthetic fixture',
            'region_interval_method':'shared factor, not a sum of cell intervals'}))
        (assets/'region_cells.csv').write_text('region_id,cell_id,overlap_area_km2\n01,laea10_1_1,50\n02,laea10_1_1,50\n')
        columns=['region_id','week_start_utc','instrument','platform','raw_count','harmonized_count',
                 'lower_bound','upper_bound','coverage_status','estimation_status']
        with gzip.open(assets/'regional_series.csv.gz','wt',newline='') as f:
            writer=csv.writer(f);writer.writerow(columns)
            # A straddling cell has 4 MODIS points; only 1 is in region A.
            for region,week,instrument,platform,count,factor in [
                ('01','2023-08-07','MODIS','Aqua',1,2),('02','2023-08-07','MODIS','Aqua',3,2),
                ('01','2023-08-07','VIIRS','Suomi-NPP',4,.5),('02','2023-08-07','VIIRS','Suomi-NPP',6,.5),
                ('01','2023-08-14','MODIS','Aqua',3,2)]:
                writer.writerow([region,week,instrument,platform,count,count*factor,count*factor*.9,count*factor*1.1,'unknown','estimated'])
        enrich(self.db,assets)
        app=FastAPI();app.include_router(router(self.db));self.client=TestClient(app)
    def tearDown(self):
        self.client.close();self.temp.cleanup()
    def test_regions_and_exact_location(self):
        self.assertEqual(len(self.client.get('/v1/regions').json()['data']),2)
        r=self.client.get('/v1/regions/locate',params={'longitude':-76.75,'latitude':-10.75})
        self.assertEqual(r.json()['region']['region_id'],'01')
        # Within A's bbox, outside A itself: the RTree candidate must be rejected.
        r=self.client.get('/v1/regions/locate',params={'longitude':-76.25,'latitude':-10.25})
        self.assertEqual(r.status_code,404)
    def test_shared_boundary_is_deterministic(self):
        r=self.client.get('/v1/regions/locate',params={'longitude':-76,'latitude':-10.75}).json()
        self.assertEqual(r['region']['region_id'],'01')
        self.assertEqual(r['boundary_matches'],['01','02'])
        self.assertTrue(r['metadata']['boundary_ambiguous'])
    def test_regional_count_does_not_take_whole_straddling_cell(self):
        q={'start':'2023-08-07','end':'2023-08-14','region_id':'01','instrument':'MODIS'}
        result=self.client.get('/v1/empirical/series',params=q).json()
        self.assertEqual(result['data'][0]['raw_count'],1)
        self.assertEqual(result['data'][0]['harmonized_count'],2)
        self.assertEqual(result['metadata']['region']['name'],'ALFA')
    def test_partial_dates_are_explicit_and_preserve_week_resolution(self):
        q={'start':'2023-08-10','end':'2023-08-17','region_id':'01'}
        original=self.client.get('/v1/empirical/series',params=q).json()
        overlap=self.client.get('/v1/empirical/series',params={**q,'week_selection':'overlap'}).json()
        self.assertEqual(len(original['data']),2);self.assertEqual(len(overlap['data']),4)
        self.assertEqual(overlap['metadata']['effective_week_start'],'2023-08-07')
        self.assertEqual(overlap['metadata']['effective_end_exclusive'],'2023-08-21')
        missing=[r for r in overlap['data'] if r['instrument']=='VIIRS' and r['week_start_utc']=='2023-08-14'][0]
        self.assertIsNone(missing['raw_count']);self.assertIsNone(missing['harmonized_count'])
        self.assertEqual(missing['estimation_status'],'unavailable')
    def test_region_time_index_and_rtree_are_used(self):
        with closing(sqlite3.connect(self.db)) as db:
            plan=str(db.execute("EXPLAIN QUERY PLAN SELECT * FROM regional_series WHERE region_id=? AND instrument=? AND week_start_utc>=? AND week_start_utc<?",
                ('01','MODIS','2023-01-01','2024-01-01')).fetchall())
            self.assertIn('regional_instrument_time',plan)
            plan=str(db.execute('EXPLAIN QUERY PLAN SELECT * FROM region_spatial_index WHERE min_lon<=? AND max_lon>=?',(-76,-76)).fetchall())
            self.assertIn('VIRTUAL TABLE INDEX',plan)
    def test_spatial_filters_and_full_cell_forecast_probability(self):
        q={'region_id':'01','bbox':'-76.1,-10.9,-75.9,-10.6'}
        r=self.client.get('/v1/empirical/cells',params=q).json()
        self.assertEqual(len(r['data']),1);self.assertIn('R*Tree',r['metadata']['spatial_index'])
        for region in ['01','02']:
            r=self.client.get('/v1/forecasts',params={'region_id':region}).json()
            self.assertEqual(r['data'][0]['record_probability'],.7)
    def test_conflicts_bad_regions_and_pagination(self):
        q={'start':'2023-08-07','end':'2023-08-21','region_id':'01','limit':1}
        a=self.client.get('/v1/empirical/series',params=q).json()
        b=self.client.get('/v1/empirical/series',params={**q,'offset':1}).json()
        self.assertEqual(a['pagination']['next_offset'],1)
        self.assertNotEqual(a['data'][0]['instrument'],b['data'][0]['instrument'])
        self.assertEqual(self.client.get('/v1/empirical/series',params={**q,'region_id':'99'}).status_code,404)
        self.assertEqual(self.client.get('/v1/empirical/series',params={**q,'cell_id':'laea10_1_1'}).status_code,422)
        self.assertEqual(self.client.get('/v1/regions/locate',params={'longitude':999,'latitude':0}).status_code,422)
    def test_mismatched_source_does_not_replace_existing_database(self):
        before=hashlib.sha256(self.db.read_bytes()).hexdigest()
        p=self.assets/'regional_metadata.json';info=json.loads(p.read_text())
        info['source_snapshot_id']='wrong-source';p.write_text(json.dumps(info))
        with self.assertRaises(ValueError):enrich(self.db,self.assets)
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).hexdigest(),before)
    def test_count_mismatch_does_not_replace_existing_database(self):
        before=hashlib.sha256(self.db.read_bytes()).hexdigest()
        p=self.assets/'regional_series.csv.gz'
        with gzip.open(p,'rt',newline='') as stream:
            reader=csv.DictReader(stream);fields=reader.fieldnames;records=list(reader)
        records[0]['raw_count']=str(int(records[0]['raw_count'])+1)
        with gzip.open(p,'wt',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader();writer.writerows(records)
        with self.assertRaises(ValueError):enrich(self.db,self.assets)
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).hexdigest(),before)

if __name__=='__main__':unittest.main()
