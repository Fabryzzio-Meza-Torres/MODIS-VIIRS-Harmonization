"""Exact activity labels, prior-year reference and explicit training target."""
import unittest
import pandas as pd
from regional_risk_models import RegionalRiskEstimator
from generate_regional_activity import historical_reference

class RegionalActivityTests(unittest.TestCase):
    def test_estimator_fits_explicit_activity_label_without_onset_alias(self):
        frame=pd.DataFrame({'region_id':['01']*20,'target_week_start':pd.date_range('2020-01-06',periods=20,freq='7D'),
            'y_fire_activity_recorded':[1]*15+[0]*5})
        estimator=RegionalRiskEstimator('constant',['region_id']).fit(frame,label_column='y_fire_activity_recorded')
        self.assertGreater(estimator.predict_proba(frame)[0],.7)
        self.assertEqual(estimator.label_column,'y_fire_activity_recorded')

    def test_reference_excludes_target_year_and_weeks_not_completed_at_issue(self):
        dates=[f'{year}-01-07' for year in range(1995,2027)]
        labels=pd.DataFrame({'region_id':'01','target_week_start':dates,'y_fire_activity_recorded':1})
        context=historical_reference(labels,'01',pd.Timestamp('2026-01-05',tz='America/Lima'),
            pd.Timestamp('2025-11-16',tz='America/Lima'))
        self.assertNotIn(2026,context['years'])
        self.assertEqual(context['frequency_percent'],100.)
        self.assertEqual(context['positive_weeks'],context['total_weeks'])
        self.assertFalse(context['is_independent_binomial_sample'])

    def test_short_history_has_no_percentage(self):
        labels=pd.DataFrame({'region_id':['01'],'target_week_start':['2024-11-18'],'y_fire_activity_recorded':[1]})
        result=historical_reference(labels,'01',pd.Timestamp('2026-11-16',tz='America/Lima'),
            pd.Timestamp('2026-11-15',tz='America/Lima'))
        self.assertEqual(result['total_weeks'],1)
        self.assertIsNone(result['frequency_percent'])

if __name__=='__main__':unittest.main()
