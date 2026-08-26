"""Cookbook for the internal LRS toolkit.

Run from the repo root:

    python examples/lrs_cookbook.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
from shapely.geometry import LineString

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from lrs_tools import (  # noqa: E402
    LrsSchema,
    dissolve_contiguous,
    export_lrs_geometry,
    locate_events_on_routes,
    overlay_events,
    pad_roadway_id,
    write_events,
)


def main() -> None:
    out_dir = ROOT / "output" / "lrs_cookbook"
    out_dir.mkdir(parents=True, exist_ok=True)

    target = pd.DataFrame(
        {
            "ROADWAY": [100, 100],
            "BEGIN_POST": [0.0, 5.0],
            "END_POST": [5.0, 10.0],
            "SECTADT": [4000, 4000],
        }
    )
    overlay = pd.DataFrame(
        {
            "roadway": ["00000100"],
            "begin_post": [2.0],
            "end_post": [8.0],
            "HIST_AADT": [3800],
        }
    )

    print("pad_roadway_id(100) ->", pad_roadway_id(100))

    dissolved = dissolve_contiguous(
        target,
        group_cols=["ROADWAY", "SECTADT"],
        schema=LrsSchema(roadway="ROADWAY", bmp="BEGIN_POST", emp="END_POST"),
    )
    print("dissolved rows:", len(dissolved), dissolved[["BEGIN_POST", "END_POST"]].to_dict("records"))

    sliced = overlay_events(dissolved, overlay)
    print("overlay slices:", len(sliced))
    csv_path = write_events(sliced, out_dir / "overlay_slices.csv")
    print("wrote", csv_path)

    try:
        import geopandas as gpd
    except ImportError:
        print("geopandas not installed; skip GIS clip example")
        return

    routes = gpd.GeoDataFrame(
        {"ROADWAY": ["00000100"], "BEGIN_POST": [0.0], "END_POST": [10.0]},
        geometry=[LineString([(0, 0), (10, 0)])],
        crs="EPSG:4326",
    )
    located = locate_events_on_routes(sliced, routes)
    gpkg_path = write_events(located, out_dir / "overlay_slices.gpkg")
    print("wrote", gpkg_path, "with", int(located.geometry.notna().sum()), "geometries")

    geojson_path = export_lrs_geometry(
        routes,
        out_dir / "overlay_slices",
        segment_id="ROADWAY",
        start_post="BEGIN_POST",
        end_post="END_POST",
        events=sliced,
        fmt="geojson",
    )
    shp_path = export_lrs_geometry(
        routes,
        out_dir / "routes_lrs.shp",
        segment_id="ROADWAY",
        start_post="BEGIN_POST",
        end_post="END_POST",
        fmt="shp",
    )
    print("wrote", geojson_path)
    print("wrote", shp_path)


if __name__ == "__main__":
    main()
