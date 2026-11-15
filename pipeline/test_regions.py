import unittest
import numpy as np
from shapely import STRtree,box
from build_regions import assign_points

class PointAssignmentTests(unittest.TestCase):
    def test_vector_assignment_preserves_order_and_single_boundary_owner(self):
        tree=STRtree([box(0,0,1,1),box(1,0,2,1)])
        regions,ties=assign_points(tree,np.array([.5,1.5,1.,3.]),np.array([.5,.5,.5,.5]))
        np.testing.assert_array_equal(regions,[0,1,0,-1])
        self.assertEqual(ties,1)
    def test_no_matches_keeps_all_points_unassigned(self):
        regions,ties=assign_points(STRtree([box(0,0,1,1)]),[10,11],[10,11])
        np.testing.assert_array_equal(regions,[-1,-1])
        self.assertEqual(ties,0)

if __name__=='__main__':unittest.main()
