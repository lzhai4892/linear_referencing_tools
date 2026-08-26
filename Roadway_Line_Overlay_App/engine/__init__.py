"""
Roadway Line-to-Line Overlay Engine Package.
"""

from .cleaner import DataCleaner, LayerInfo, load_and_clean_layer
from .corridor_math import (
    FEET_TO_METERS,
    METERS_TO_FEET,
    angle_difference_degrees,
    compute_local_bearing_at_point,
    compute_segment_metrics,
    line_bearing_degrees,
)
from .overlay_core import OverlayConfig, OverlayResult, RoadwayOverlayEngine

__all__ = [
    "DataCleaner",
    "LayerInfo",
    "load_and_clean_layer",
    "FEET_TO_METERS",
    "METERS_TO_FEET",
    "line_bearing_degrees",
    "angle_difference_degrees",
    "compute_local_bearing_at_point",
    "compute_segment_metrics",
    "OverlayConfig",
    "OverlayResult",
    "RoadwayOverlayEngine",
]
