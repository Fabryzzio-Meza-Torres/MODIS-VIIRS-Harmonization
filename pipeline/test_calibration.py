import unittest
import numpy as np
from scipy.optimize._numdiff import approx_derivative
from calibration import Pairs,EMBED,fit,terms
from calibration import time_block_ids
import pandas as pd

class CalibrationTests(unittest.TestCase):
    def test_calendar_blocks_are_resolution_invariant(self):
        days=pd.date_range('2020-01-01',periods=4,freq='28D',tz='UTC')
        expected=time_block_ids(days.as_unit('ns'))
        np.testing.assert_array_equal(np.diff(expected),[1,1,1])
        np.testing.assert_array_equal(time_block_ids(days.as_unit('us')),expected)
        np.testing.assert_array_equal(time_block_ids(days.as_unit('ms')),expected)
        self.assertGreater(len(np.unique(expected)),1)

    def synthetic(self,positive=True):
        rng=np.random.default_rng(81237)
        truth=np.array([-1.7,.5,-.15,.2])
        means=np.exp(rng.normal(0,1.8,30000))
        exposure=rng.uniform(.3,2.,(len(means),5)) if not positive else np.ones((len(means),5))
        n=rng.poisson(means[:,None]*np.exp(EMBED@truth)[None,:]*exposure)
        lists=[]
        for j in range(5):
            for k in range(j+1,5):
                total=n[:,j]+n[:,k]
                use=((n[:,j]>0)&(n[:,k]>0)&(total>=3)) if positive else total>0
                count=int(use.sum())
                lists.append(Pairs(np.full(count,j),np.full(count,k),n[use,j],total[use],
                    np.array(['2020-01-06']*count,dtype='datetime64[D]'),np.full(count,-9.),
                    np.zeros(count,dtype=bool),np.full(count,positive),
                    np.log(exposure[use,j]/exposure[use,k])))
        data=Pairs(**{k:np.concatenate([getattr(p,k) for p in lists]) for k in lists[0].__dict__})
        return data,truth

    def test_recovers_response_with_positive_selection(self):
        data,truth=self.synthetic()
        model=fit(data)
        np.testing.assert_allclose(model['theta'],truth,atol=.045)
        self.assertFalse(model['coverage_corrected'])

    def test_known_exposure_and_observed_zeros(self):
        data,truth=self.synthetic(False)
        model=fit(data)
        np.testing.assert_allclose(model['theta'],truth,atol=.035)
        self.assertTrue(model['coverage_corrected'])

    def test_derivative_matches_finite_difference(self):
        data,_=self.synthetic();data=data.take(np.arange(30))
        b=np.linspace(-4,4,len(data.total))
        analytic=terms(b,data)[1]
        numerical=approx_derivative(lambda z:np.sum(terms(z,data)[0]),b,method='3-point').ravel()
        np.testing.assert_allclose(analytic,numerical,atol=1e-6)

    def test_disconnected_graph_rejected(self):
        data,_=self.synthetic()
        data=data.take((data.left!=4)&(data.right!=4))
        with self.assertRaises(ValueError):fit(data)

if __name__=='__main__':unittest.main(verbosity=2)
