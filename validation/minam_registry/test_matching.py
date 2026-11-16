import unittest
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from match_registry import match_points,MAX_RADIUS_M,MAX_TIME_DAYS,utc_days

class MatchingTests(unittest.TestCase):
    def test_real_calendar_date_has_correct_epoch_day_in_us_and_ns(self):
        t=pd.DatetimeIndex(['2020-01-01T12:00:00Z'])
        np.testing.assert_allclose(utc_days(t.as_unit('us')),[18262.5])
        np.testing.assert_allclose(utc_days(t.as_unit('ns')),[18262.5])

    def test_circle_filter_and_calendar_boundaries(self):
        scale=[MAX_RADIUS_M,MAX_RADIUS_M,MAX_TIME_DAYS]
        # First point is in a 5km square, but outside the 5km circle.
        points=np.array([[5000.,5000.,20000.],[0.,0.,20003.5]])
        tree=cKDTree(points/scale)
        r=match_points(tree,points,np.array([[0.,0.,20000.]]))
        self.assertFalse(r[0,0]) # upper end of the seven-day interval is exclusive
        self.assertTrue(r[0,1])  # the square point is inside the 10km circle

    def test_negative_control_does_not_match_same_season_automatically(self):
        points=np.array([[0.,0.,20000.]])
        tree=cKDTree(points/[MAX_RADIUS_M,MAX_RADIUS_M,MAX_TIME_DAYS])
        events=np.array([[0.,0.,20000.],[0.,0.,20028.]])
        found=match_points(tree,points,events)
        self.assertTrue(found[0,0]);self.assertFalse(found[1].any())

if __name__=='__main__':unittest.main()
