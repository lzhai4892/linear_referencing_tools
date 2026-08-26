"""
Automated Unit Tests for Roadway Line-to-Line Overlay Engine.
"""

import math
import unittest
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import LineString, MultiLineString

# Add parent directory to sys.path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.cleaner import DataCleaner, load_and_clean_layer
from engine.corridor_math import (
    FEET_TO_METERS,
    METERS_TO_FEET,
    angle_difference_degrees,
    line_bearing_degrees,
)
from engine.overlay_core import OverlayConfig, RoadwayOverlayEngine


class TestCorridorMath(unittest.TestCase):
    def test_line_bearing_degrees(self):
        # East-West line
        line_ew = LineString([(0, 0), (100, 0)])
        self.assertAlmostEqual(line_bearing_degrees(line_ew), 90.0, places=1)

        # West-East line (opposite digitizing direction)
        line_we = LineString([(100, 0), (0, 0)])
        self.assertAlmostEqual(line_bearing_degrees(line_we), 90.0, places=1)

        # North-South line
        line_ns = LineString([(0, 0), (0, 100)])
        self.assertAlmostEqual(line_bearing_degrees(line_ns), 0.0, places=1)

        # 45-degree diagonal line
        line_diag = LineString([(0, 0), (100, 100)])
        self.assertAlmostEqual(line_bearing_degrees(line_diag), 45.0, places=1)

    def test_angle_difference_degrees(self):
        # Same bearing
        self.assertAlmostEqual(angle_difference_degrees(45.0, 45.0), 0.0, places=1)
        # Undirected collinear
        self.assertAlmostEqual(angle_difference_degrees(0.0, 180.0), 0.0, places=1)
        # Perpendicular
        self.assertAlmostEqual(angle_difference_degrees(0.0, 90.0), 90.0, places=1)
        # 30-degree difference
        self.assertAlmostEqual(angle_difference_degrees(10.0, 40.0), 30.0, places=1)


class TestDataCleaner(unittest.TestCase):
    def test_multipart_explosion(self):
        # Create a GeoDataFrame with 1 single-part and 1 multi-part LineString
        line1 = LineString([(0, 0), (10, 0)])
        line2 = MultiLineString([
            [(-10, -10), (0, -10)],
            [(0, -10), (10, -10)]
        ])
        gdf = gpd.GeoDataFrame(
            {"ID": [1, 2], "name": ["Single", "Multi"]},
            geometry=[line1, line2],
            crs="EPSG:26917",
        )

        cleaned_gdf, info = DataCleaner.clean_and_explode_linework(gdf, "TestLayer", target_crs=26917)
        self.assertEqual(info.multipart_count, 1)
        self.assertEqual(len(cleaned_gdf), 3)  # 1 + 2 parts
        self.assertTrue(all(cleaned_gdf.geometry.geom_type == "LineString"))
        self.assertIn("_orig_fid", cleaned_gdf.columns)


class TestOverlayEngine(unittest.TestCase):
    def setUp(self):
        # Target: East-West segment of length 1000m
        self.target_geom = LineString([(0, 0), (1000, 0)])
        self.target_gdf = gpd.GeoDataFrame(
            {"Target_ID": ["T-01"], "Road": ["Mainline"]},
            geometry=[self.target_geom],
            crs="EPSG:26917",
        )

        # Ref 1: Overlapping parallel line
        ref1 = LineString([(-50, 10), (1050, 10)])
        # Ref 2: Duplicate ID overlapping parallel line
        ref2 = LineString([(200, 15), (800, 15)])
        # Ref 3: Perpendicular crossing line
        ref3 = LineString([(500, -200), (500, 200)])

        self.ref_gdf = gpd.GeoDataFrame(
            {
                "ITEMSEG": ["WP_100", "WP_100", "WP_999"],
                "PHASE": ["CON", "PE", "CROSS"],
                "YEAR": [2026, 2025, 2024],
            },
            geometry=[ref1, ref2, ref3],
            crs="EPSG:26917",
        )

    def test_duplicate_retention_mode(self):
        # With keep_duplicates=True, should list both occurrences of WP_100
        config = OverlayConfig(
            buffer_distance=300.0,
            min_overlap_length=300.0,
            reference_columns=["ITEMSEG"],
            keep_duplicates=True,
            projected_crs=26917,
        )
        engine = RoadwayOverlayEngine(config)
        result = engine.run(self.target_gdf, self.ref_gdf)

        self.assertEqual(result.matched_targets, 1)
        row = result.output_gdf.iloc[0]
        self.assertEqual(row["Match_Stat"], "On Corridor")
        self.assertEqual(row["Match_Cnt"], 2)
        self.assertEqual(row["Matched_ID"], "WP_100, WP_100")
        # Perpendicular line (WP_999) should NOT be in the matched list
        self.assertNotIn("WP_999", row["Matched_ID"])

    def test_deduplicate_mode(self):
        # With keep_duplicates=False, should collapse to unique WP_100
        config = OverlayConfig(
            buffer_distance=300.0,
            min_overlap_length=300.0,
            reference_columns=["ITEMSEG"],
            keep_duplicates=False,
            projected_crs=26917,
        )
        engine = RoadwayOverlayEngine(config)
        result = engine.run(self.target_gdf, self.ref_gdf)

        row = result.output_gdf.iloc[0]
        self.assertEqual(row["Matched_ID"], "WP_100")

    def test_composite_template_expression(self):
        # Custom expression: "{ITEMSEG} - {PHASE} {YEAR}"
        config = OverlayConfig(
            buffer_distance=300.0,
            min_overlap_length=300.0,
            custom_expression_template="{ITEMSEG} - {PHASE} {YEAR}",
            keep_duplicates=True,
            projected_crs=26917,
        )
        engine = RoadwayOverlayEngine(config)
        result = engine.run(self.target_gdf, self.ref_gdf)

        row = result.output_gdf.iloc[0]
        self.assertIn("WP_100 - CON 2026", row["Matched_ID"])
        self.assertIn("WP_100 - PE 2025", row["Matched_ID"])


if __name__ == "__main__":
    unittest.main()
