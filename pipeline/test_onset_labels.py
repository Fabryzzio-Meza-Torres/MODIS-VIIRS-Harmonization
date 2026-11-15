import unittest
import numpy as np
from onset_label_pilot import causal_onsets

DAY = 86400 * 10**9


class OnsetLabelTests(unittest.TestCase):
    def test_future_append_does_not_relabel_prior_onsets(self):
        xy = np.array([[0., 0.], [8000., 0.], [100., 0.], [4000., 0.]])
        times = np.array([0, DAY, 2*DAY, 3*DAY], dtype=np.int64)
        prefix = causal_onsets(xy[:3], times[:3])
        full = causal_onsets(xy, times)
        np.testing.assert_array_equal(prefix, full[full < 3])
        np.testing.assert_array_equal(prefix, [0, 1])

    def test_simultaneous_chain_connected_to_past_is_continuation(self):
        xy = np.array([[0., 0.], [1000., 0.], [2000., 0.], [9000., 0.]])
        times = np.array([0, DAY, DAY, DAY], dtype=np.int64)
        np.testing.assert_array_equal(causal_onsets(xy, times), [0, 3])

    def test_inclusive_quiet_window_and_later_reappearance(self):
        xy = np.array([[0., 0.], [1250., 0.], [1250., 0.]])
        times = np.array([0, 5*DAY, 10*DAY+1], dtype=np.int64)
        np.testing.assert_array_equal(causal_onsets(xy, times), [0, 2])


if __name__ == '__main__':
    unittest.main()
