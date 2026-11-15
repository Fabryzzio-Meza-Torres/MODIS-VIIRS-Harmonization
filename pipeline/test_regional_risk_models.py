import unittest
import numpy as np
import pandas as pd
from regional_risk_models import RegionalRiskEstimator,LeadProbabilityCalibrator


class RegionalRiskModelTests(unittest.TestCase):
    def test_climatology_does_not_count_shared_target_twelve_times(self):
        frame=pd.DataFrame({'region_id':['08']*8,'target_week_start':pd.date_range('2020-01-06',periods=8,freq='7D').strftime('%Y-%m-%d'),
                            'y_new_detected_episode':[0,0,0,1,0,1,1,1]})
        original=RegionalRiskEstimator('climatology',['region_id']).fit(frame)
        repeated=RegionalRiskEstimator('climatology',['region_id']).fit(pd.concat([frame]*12,ignore_index=True))
        np.testing.assert_allclose(original.predict_proba(frame),repeated.predict_proba(frame),rtol=0,atol=1e-15)

    def test_calibration_is_monotonic_and_lead_specific(self):
        p=np.tile(np.linspace(.01,.99,80),12)
        leads=np.repeat(np.arange(1,13),80)
        y=(p>.5).astype(int)
        c=LeadProbabilityCalibrator().fit(p,y,leads)
        for lead in range(1,13):
            q=c.predict(np.linspace(.01,.99,100),np.repeat(lead,100))
            self.assertTrue(np.all(np.diff(q)>=0))
            self.assertTrue(((q>=0)&(q<=1)).all())


if __name__=='__main__':unittest.main()
