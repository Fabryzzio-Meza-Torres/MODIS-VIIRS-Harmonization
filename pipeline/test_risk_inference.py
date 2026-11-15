"""Causal feature extraction and explicit insufficient-support behavior."""
import unittest
import numpy as np
import pandas as pd
from regional_risk_features import RegionalFeatureStore
from generate_regional_outlook import support_reasons


class RiskInferenceTests(unittest.TestCase):
    def setUp(self):
        self.reference=pd.Timestamp('2020-01-12',tz='America/Lima')
        self.target=self.reference+pd.Timedelta(days=1)
        self.regions=pd.DataFrame([{'region_id':'01','min_lon':-79.,'max_lon':-77.,
            'min_lat':-7.,'max_lat':-5.}])
        self.detections=pd.DataFrame({'region_id':['01']*3,
            'timestamp_utc':pd.to_datetime(['2020-01-01T12:00Z','2020-01-08T12:00Z','2020-01-10T12:00Z']),
            'frp_mw':[2.,5.,999.],'is_candidate_onset':[True,True,True]})
        self.weather=pd.DataFrame({'date':pd.date_range('2019-08-01','2020-01-20'),
            'region_id':'01','T2M':20.,'RH2M':50.,'WS2M':3.,'PRECTOTCORR':1.})

    def vector(self,detections=None,weather=None):
        store=RegionalFeatureStore(self.regions,self.detections if detections is None else detections,
            self.weather if weather is None else weather,{})
        return store,store.vector('01',self.reference,self.target,1)

    def test_future_observations_cannot_change_current_features(self):
        _,before=self.vector()
        detections=self.detections.copy()
        future=detections.timestamp_utc>=self.reference-pd.Timedelta(days=3)
        detections.loc[future,'frp_mw']=1e8
        detections.loc[future,'is_candidate_onset']=False
        weather=self.weather.copy()
        weather.loc[weather.date>pd.Timestamp('2020-01-04'),['T2M','RH2M','WS2M','PRECTOTCORR']]=1e6
        _,after=self.vector(detections,weather)
        for key,value in before.items():
            if isinstance(value,float) and np.isnan(value):self.assertTrue(np.isnan(after[key]))
            else:self.assertEqual(value,after[key],key)
        self.assertEqual(before['weather_value_day'],'2020-01-04')
        self.assertAlmostEqual(before['log_ref_frp_sum_90d'],np.log1p(7.))

    def test_stale_nrt_and_weather_are_unavailable(self):
        _,features=self.vector()
        reasons=support_reasons(self.reference,pd.Timestamp('2019-01-01',tz='UTC'),
            pd.Timestamp('2020-01-08',tz='UTC'),'2020-01-03',features,
            ['log_ref_records_7d'],self.target,self.reference)
        self.assertIn('NRT_acquisition_extent_does_not_reach_feature_cutoff',reasons)
        self.assertIn('weather_point_does_not_reach_assumed_availability_cutoff',reasons)

    def test_missing_selected_feature_and_insufficient_history(self):
        _,features=self.vector();features['rain_sum_90d']=np.nan
        reasons=support_reasons(self.reference,pd.Timestamp('2020-01-01',tz='UTC'),
            pd.Timestamp('2020-01-10',tz='UTC'),'2020-01-04',features,
            ['rain_sum_90d'],self.target,self.reference)
        self.assertIn('missing_selected_feature:rain_sum_90d',reasons)
        self.assertIn('insufficient_NRT_history_for_90_day_window_and_episode_buffer',reasons)

    def test_already_started_week_is_not_a_future_prediction(self):
        _,features=self.vector()
        reasons=support_reasons(self.reference,pd.Timestamp('2019-01-01',tz='UTC'),
            pd.Timestamp('2020-01-10',tz='UTC'),'2020-01-04',features,
            ['rain_sum_90d'],self.target,self.target)
        self.assertEqual(reasons,['target_week_already_started_at_issue'])

    def test_invalid_reference_lead_region_and_weather_calendar(self):
        store,_=self.vector()
        for rid,reference,target,lead in [('99',self.reference,self.target,1),
                ('01',self.reference,self.target,0),('01',self.reference,self.target,13),
                ('01',self.reference,self.target,1.5),
                ('01',self.reference+pd.Timedelta(days=1),self.target,1),
                ('01',self.reference,self.target+pd.Timedelta(days=7),1),
                ('01',self.reference.tz_localize(None),self.target,1)]:
            with self.assertRaises(ValueError):store.vector(rid,reference,target,lead)
        with self.assertRaises(ValueError):self.vector(weather=self.weather.drop(index=20))


if __name__=='__main__':unittest.main()
