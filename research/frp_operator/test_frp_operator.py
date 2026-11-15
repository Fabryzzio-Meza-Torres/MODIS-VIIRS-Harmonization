import unittest
import numpy as np
from frp_operator import parameters,response_weight,forward_frp

class OperatorTests(unittest.TestCase):
    def test_published_table_transcription(self):
        d,r,c=parameters([1,1,.375**2,.375**2],['MODIS','MODIS','VIIRS','VIIRS'],['D','N','D','N'])
        np.testing.assert_allclose(d,[4.96,5.44,2.30765625,.5440625])
        np.testing.assert_allclose(r,[1.33,1.17,.61+.21/(.375**2),2.12+1.02/(.375**2)])
        np.testing.assert_allclose(c,[.045,.045,.05,.05])

    def test_monotonicity_limits_and_units(self):
        for sensor,area in [('MODIS',1.),('VIIRS',.14)]:
            p=np.linspace(0,1000,10001);q=response_weight(p,area,sensor,'D')
            self.assertTrue((np.diff(q)>=0).all());self.assertGreater(q[-1],.999)
            observed=forward_frp(p,area,sensor,'D')
            self.assertTrue((observed>=0).all());self.assertTrue((observed<=p).all())
            self.assertEqual(observed[0],0)

    def test_shifted_cutoff_not_a_half_probability(self):
        d,_,c=parameters(1,'MODIS','D')
        self.assertAlmostEqual(float(response_weight(d,1,'MODIS','D')),float((.5-c)/(1-c)))

    def test_no_observation_is_not_a_zero_fire_record(self):
        self.assertTrue(np.isnan(forward_frp(10,1,'MODIS','D',retrieval_valid=False)))
        for args in [(1,0,'MODIS','D'),(-1,1,'VIIRS','D'),(1,1,'MODISbad','D'),(1,1,'VIIRS','unknown')]:
            with self.assertRaises(ValueError):response_weight(*args)

if __name__=='__main__':unittest.main()
