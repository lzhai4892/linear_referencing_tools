"""
Corridor Spatial Geometry, Local Bearing Calculation, and Mathematical Rules Module.
"""

from __future__ import annotations

import math
from typing import Optional, Tuple

from shapely.geometry import LineString, MultiLineString, Point
from shapely.ops import substring

METERS_TO_FEET = 3.280839895013123
FEET_TO_METERS = 0.3048


def line_bearing_degrees(geom: LineString | MultiLineString) -> float:
    """
    Compute undirected line bearing in degrees [0, 90].
    Roadways digitized in opposing directions (EB vs WB or N vs S)
    are treated collinearly.
    """
    if geom is None or geom.is_empty:
        return float("nan")

    if isinstance(geom, MultiLineString):
        geom = max(geom.geoms, key=lambda p: p.length)

    coords = list(geom.coords)
    if len(coords) < 2:
        return float("nan")

    x1, y1 = coords[0]
    x2, y2 = coords[-1]
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return 0.0

    bearing = abs(math.degrees(math.atan2(dx, dy))) % 180.0
    return min(bearing, 180.0 - bearing)


def angle_difference_degrees(bearing_a: float, bearing_b: float) -> float:
    """Compute undirected angular difference between two bearings in [0, 90]."""
    if math.isnan(bearing_a) or math.isnan(bearing_b):
        return 999.0
    diff = abs(bearing_a - bearing_b) % 180.0
    diff_180 = min(diff, 180.0 - diff)
    return min(diff_180, 180.0 - diff_180)


def compute_local_bearing_at_point(
    line: LineString,
    point: Point,
    window_length: float = 500.0 * FEET_TO_METERS,
) -> float:
    """
    Extract a localized substring of length `window_length` centered on `point`
    projected onto `line`, and compute its undirected bearing in [0, 90].
    """
    if line is None or line.is_empty or point is None or line.length <= 0.001:
        return float("nan")

    if isinstance(line, MultiLineString):
        line = max(line.geoms, key=lambda part: part.length)

    distance = line.project(point)
    half_win = window_length / 2.0
    start = max(0.0, distance - half_win)
    end = min(line.length, distance + half_win)

    if end - start < 0.5:
        return line_bearing_degrees(line)

    sub_segment = substring(line, start, end)
    return line_bearing_degrees(sub_segment)


def get_representative_point(geom) -> Optional[Point]:
    """Get the midpoint along an overlap geometry."""
    if geom is None or geom.is_empty:
        return None
    if isinstance(geom, LineString):
        return geom.interpolate(0.5, normalized=True)
    elif isinstance(geom, MultiLineString):
        longest = max(geom.geoms, key=lambda g: g.length)
        return longest.interpolate(0.5, normalized=True)
    return geom.centroid


def compute_segment_metrics(
    target_geom: LineString,
    ref_geom: LineString,
    buffer_distance: float,
    bearing_window: float,
) -> dict:
    """
    Compute intersection geometry, overlap lengths, ratios, minimum perpendicular distance,
    and localized bearing difference between target and reference line geometries.
    """
    target_len = target_geom.length
    ref_len = ref_geom.length

    if target_len <= 0 or ref_len <= 0:
        return {
            "has_intersection": False,
            "overlap_geom": None,
            "overlap_length": 0.0,
            "target_ratio": 0.0,
            "ref_ratio": 0.0,
            "min_distance": float("inf"),
            "angle_diff": 999.0,
        }

    # Buffer reference line
    ref_buffer = ref_geom.buffer(buffer_distance)
    overlap = target_geom.intersection(ref_buffer)

    if overlap is None or overlap.is_empty or overlap.length <= 0:
        return {
            "has_intersection": False,
            "overlap_geom": None,
            "overlap_length": 0.0,
            "target_ratio": 0.0,
            "ref_ratio": 0.0,
            "min_distance": target_geom.distance(ref_geom),
            "angle_diff": 999.0,
        }

    overlap_length = overlap.length
    target_ratio = overlap_length / target_len
    ref_ratio = overlap_length / ref_len
    min_dist = target_geom.distance(ref_geom)

    # Localized bearing at midpoint of overlap
    mid_pt = get_representative_point(overlap)
    if mid_pt is not None:
        target_bearing = compute_local_bearing_at_point(target_geom, mid_pt, bearing_window)
        ref_bearing = compute_local_bearing_at_point(ref_geom, mid_pt, bearing_window)
        angle_diff = angle_difference_degrees(target_bearing, ref_bearing)
    else:
        angle_diff = 999.0

    return {
        "has_intersection": True,
        "overlap_geom": overlap,
        "overlap_length": overlap_length,
        "target_ratio": target_ratio,
        "ref_ratio": ref_ratio,
        "min_distance": min_dist,
        "angle_diff": angle_diff,
    }
