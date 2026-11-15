"""Actual artifact contract and missing-data semantics at the HTTP boundary."""
from pathlib import Path
import os
import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from history_api import router

SNAPSHOT=Path(os.environ.get('FIRMS_HISTORY_DB',Path(__file__).with_name('history.sqlite')))
@unittest.skipUnless(SNAPSHOT.is_file(),'Build the local data snapshot with load_history.py first.')
class HistoryApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app=FastAPI();app.include_router(router(SNAPSHOT))
        cls.client=TestClient(app)
        cls.cell=cls.client.get('/v1/empirical/cells',params={'limit':1}).json()['data'][0]['cell_id']

    def test_national_has_two_instruments_and_disclosures(self):
        r=self.client.get('/v1/empirical/series',params={'start':'2023-08-07','end':'2023-08-14'}).json()
        self.assertEqual({x['instrument'] for x in r['data']},{'MODIS','VIIRS'})
        self.assertFalse(r['metadata']['coverage_corrected'])
        self.assertTrue(all(x['harmonized_count']>0 for x in r['data']))
        for row in r['data']:
            self.assertGreater(row['upper_bound']-row['lower_bound'],1e-5)
            self.assertLessEqual(row['lower_bound'],row['harmonized_count'])
            self.assertGreaterEqual(row['upper_bound'],row['harmonized_count'])

    def test_pre_viirs_is_null_and_cell_missing_never_zero(self):
        r=self.client.get('/v1/empirical/series',params={'start':'2001-01-01','end':'2001-01-08','instrument':'VIIRS','cell_id':self.cell}).json()
        self.assertEqual(len(r['data']),1)
        self.assertIsNone(r['data'][0]['harmonized_count'])
        self.assertIsNone(r['data'][0]['raw_count'])
        self.assertEqual(r['data'][0]['estimation_status'],'unavailable')

    def test_pagination_is_stable(self):
        q={'start':'2023-01-01','end':'2023-03-01','limit':3}
        a=self.client.get('/v1/empirical/series',params=q).json()
        b=self.client.get('/v1/empirical/series',params={**q,'offset':3}).json()
        self.assertEqual(a['pagination']['next_offset'],3)
        self.assertLess((a['data'][-1]['week_start_utc'],a['data'][-1]['instrument']),
                        (b['data'][0]['week_start_utc'],b['data'][0]['instrument']))

    def test_invalid_query(self):
        for params in [{'bbox':'-75,2,-80,4'},{'bbox':'NaN,0,1,2'},{'limit':1001}]:
            self.assertEqual(self.client.get('/v1/forecasts',params=params).status_code,422)
        q={'start':'2023-01-01','end':'2023-02-01','cell_id':'laea10_999_999'}
        self.assertEqual(self.client.get('/v1/empirical/series',params=q).status_code,404)

    def test_forecast_is_ranked_and_target_is_record_probability(self):
        r=self.client.get('/v1/forecasts',params={'limit':10}).json()
        self.assertFalse(r['metadata']['physical_fire_risk_probability'])
        self.assertEqual(len(r['data']),10)
        self.assertEqual([x['rank'] for x in r['data']],list(range(1,11)))
        self.assertTrue(all(0<=x['record_probability']<=1 for x in r['data']))
        self.assertTrue(all(x['target_week_start']=='2026-11-16' for x in r['data']))

    def test_validation_discloses_actual_target_and_baseline_limit(self):
        r=self.client.get('/v1/validation').json()
        self.assertFalse(r['ground_incident_validation_complete'])
        self.assertFalse(r['coverage_corrected'])
        self.assertTrue(r['forecast_not_uniformly_better_than_climatology'])
        self.assertEqual({x['year'] for x in r['calibration_final']},{'2024','2025'})

if __name__=='__main__':unittest.main()
