"""Internal LRS toolkit for firm work on FDOT linear-referencing event tables."""

from lrs_tools.dissolve import collapse_longest, dissolve_contiguous
from lrs_tools.geometry import (
    dissolve_geometries,
    export_lrs_geometry,
    locate_events_on_routes,
    split_line_by_measure,
)
from lrs_tools.io import read_events, write_events
from lrs_tools.locate import locate_points
from lrs_tools.overlay import overlay_events
from lrs_tools.schema import LrsSchema, pad_roadway_id, pad_roadway_series
from lrs_tools.topology import (
    LrsValidation,
    find_gaps,
    find_overlaps,
    neighbors_along_route,
    validate_lrs,
)

__all__ = [
    "LrsSchema",
    "LrsValidation",
    "collapse_longest",
    "dissolve_contiguous",
    "dissolve_geometries",
    "export_lrs_geometry",
    "find_gaps",
    "find_overlaps",
    "locate_events_on_routes",
    "locate_points",
    "neighbors_along_route",
    "overlay_events",
    "pad_roadway_id",
    "pad_roadway_series",
    "read_events",
    "split_line_by_measure",
    "validate_lrs",
    "write_events",
]
