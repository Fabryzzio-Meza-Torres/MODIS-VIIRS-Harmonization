"""Semantic scope, historical context and freshness of the observed-activity API."""
from pathlib import Path
from datetime import datetime,timedelta
import copy,hashlib,json,tempfile,unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from activity_api import router

SOURCE=Path(__file__).resolve().parents[1]/'data/regional_activity_outlook.json'

class ActivityApiTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'activity.json'
        self.document=json.loads(SOURCE.read_bytes())
        self.current=datetime.fromisoformat(self.document['metadata']['issued_at'])+timedelta(minutes=1)
        self.save(self.document)
        app=FastAPI();app.include_router(router(self.path,clock=lambda:self.current));self.client=TestClient(app)

    def tearDown(self):self.client.close();self.temp.cleanup()

    def save(self,document):
        raw=json.dumps(document,allow_nan=False).encode();self.path.write_bytes(raw)
        meta=document['metadata']
        self.path.with_name('activity_manifest.json').write_text(json.dumps({'bytes':len(raw),
            'sha256':hashlib.sha256(raw).hexdigest(),'rows':300,'snapshot_id':meta['snapshot_id'],
            'method_version':meta['method_version']}))

    def test_explicit_target_and_historical_denominator(self):
        response=self.client.get('/v1/fire-activity?region_id=20&target_week_start=2026-11-16')
        self.assertEqual(response.status_code,200,response.text)
        result=response.json();row=result['data'][0];meta=result['metadata']
        self.assertEqual(meta['target_event'],'at_least_one_eligible_fire_detection_recorded')
        self.assertEqual(meta['supported_spatial_units'],['department'])
        self.assertFalse(meta['province_probability_available'])
        self.assertFalse(meta['physical_ignition_probability_verified'])
        reference=row['historical_reference']
        self.assertGreaterEqual(reference['total_weeks'],20)
        self.assertAlmostEqual(reference['frequency_percent'],100*reference['positive_weeks']/reference['total_weeks'])
        self.assertAlmostEqual(row['difference_from_historical_frequency_pp'],row['probability_percent']-reference['frequency_percent'])
        self.assertLess(max(reference['years']),2026)

    def test_province_point_national_and_duplicate_filters_not_silently_ignored(self):
        base='/v1/fire-activity?region_id=20&target_week_start=2026-11-16'
        for unsupported in ['province_id=2007','prov=2007','province=Talara','latitude=-4.5','cell_id=abc','region_id=08']:
            self.assertEqual(self.client.get(base+'&'+unsupported).status_code,422,unsupported)
        self.assertEqual(self.client.get('/v1/fire-activity?target_week_start=2026-11-16').status_code,422)
        self.assertEqual(self.client.get('/v1/fire-activity/outlook?prov=2007').status_code,422)

    def test_all_departments_not_one_national_probability(self):
        result=self.client.get('/v1/fire-activity/outlook?limit=300').json()
        self.assertEqual(len(result['data']),300)
        self.assertEqual(len({(r['region_id'],r['lead_weeks']) for r in result['data']}),300)
        self.assertFalse(result['metadata']['national_probability_available'])
        self.assertFalse(result['metadata']['cumulative_twelve_week_risk'])
        region=self.client.get('/v1/fire-activity/outlook?region_id=20').json()
        self.assertEqual(len(region['data']),12)

    def test_freshness_and_no_forecast_zero_fallback(self):
        self.current=datetime.fromisoformat('2026-11-22T00:00:00-05:00')
        response=self.client.get('/v1/fire-activity/outlook')
        self.assertEqual(response.status_code,503)
        self.assertTrue(self.client.get('/v1/fire-activity/metadata').json()['refresh_required'])
        self.current=datetime.fromisoformat(self.document['metadata']['issued_at'])-timedelta(seconds=1)
        self.assertEqual(self.client.get('/v1/fire-activity/outlook').status_code,503)

    def test_invalid_week_region_and_snapshot(self):
        for query,code in [('region_id=20&target_week_start=2026-11-17',422),
            ('region_id=99&target_week_start=2026-11-16',404),('region_id=20&target_week_start=2027-02-08',404)]:
            self.assertEqual(self.client.get('/v1/fire-activity?'+query).status_code,code)
        self.path.write_bytes(self.path.read_bytes()+b' ')
        self.assertEqual(self.client.get('/v1/fire-activity/outlook').status_code,503)
        self.path.unlink()
        self.assertEqual(self.client.get('/v1/fire-activity/outlook').status_code,503)

    def test_scientific_contract_corruption_rejected(self):
        for key,value in [('target_event','physical_ignition'),('province_probability_available',True),
                          ('probability_is_area_burned_fraction',True)]:
            document=copy.deepcopy(self.document);document['metadata'][key]=value;self.save(document)
            self.assertEqual(self.client.get('/v1/fire-activity/outlook').status_code,503,key)
        for field,value in [('frequency_percent',0),('positive_weeks',100000)]:
            document=copy.deepcopy(self.document);document['data'][0]['historical_reference'][field]=value;self.save(document)
            self.assertEqual(self.client.get('/v1/fire-activity/outlook').status_code,503,field)
        document=copy.deepcopy(self.document);document['data'][0]['difference_from_historical_frequency_pp']=99
        self.save(document)
        self.assertEqual(self.client.get('/v1/fire-activity/outlook').status_code,503)

    def test_null_stays_null_when_support_missing(self):
        document=copy.deepcopy(self.document)
        document['data'][0].update(probability=None,probability_percent=None,difference_from_historical_frequency_pp=None,
            estimation_status='unavailable',quality_status='insufficient_support',unavailable_reasons=['missing_NRT'])
        self.save(document)
        result=self.client.get('/v1/fire-activity/outlook?limit=1').json()['data'][0]
        self.assertIsNone(result['probability_percent'])
        self.assertIsNone(result['difference_from_historical_frequency_pp'])

if __name__=='__main__':unittest.main()
