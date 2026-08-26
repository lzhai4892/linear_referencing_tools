import pandas as pd
from shapely.geometry import LineString

from lrs_tools import (
    LrsSchema,
    dissolve_geometries,
    export_lrs_geometry,
    locate_events_on_routes,
    split_line_by_measure,
)


def test_split_line_by_measure_uses_length_ratio():
    line = LineString([(0, 0), (10, 0)])
    clipped = split_line_by_measure(line, 0.0, 10.0, 2.0, 5.0)
    assert clipped is not None
    assert abs(clipped.length - 3.0) < 1e-6
    assert abs(clipped.coords[0][0] - 2.0) < 1e-6
    assert abs(clipped.coords[-1][0] - 5.0) < 1e-6


def test_split_line_by_measure_uses_m_values():
    from types import SimpleNamespace

    from lrs_tools.geometry import _substring_by_m

    dummy = SimpleNamespace(coords=[(0, 0, 0, 0.0), (10, 0, 0, 20.0)])
    clipped = _substring_by_m(dummy, 5.0, 15.0)
    assert clipped is not None
    assert abs(clipped.coords[0][0] - 2.5) < 1e-6
    assert abs(clipped.coords[-1][0] - 7.5) < 1e-6


def test_locate_events_on_routes_and_dissolve_union():
    geopandas = pytest_import_geopandas()
    routes = geopandas.GeoDataFrame(
        {
            "ROADWAY": ["1"],
            "BEGIN_POST": [0.0],
            "END_POST": [10.0],
        },
        geometry=[LineString([(0, 0), (10, 0)])],
        crs="EPSG:4326",
    )
    events = pd.DataFrame(
        {
            "ROADWAY": ["1", "1"],
            "BEGIN_POST": [0.0, 5.0],
            "END_POST": [5.0, 10.0],
            "GROUP": ["A", "A"],
        }
    )
    located = locate_events_on_routes(events, routes)
    assert len(located) == 2
    assert all(located.geometry.notna())
    assert abs(located.geometry.iloc[0].length - 5.0) < 1e-6

    dissolved = dissolve_geometries(
        located,
        group_cols=["ROADWAY", "GROUP"],
        schema=LrsSchema(roadway="ROADWAY", bmp="BEGIN_POST", emp="END_POST"),
    )
    assert len(dissolved) == 1
    assert abs(dissolved.geometry.iloc[0].length - 10.0) < 1e-6
    assert dissolved.loc[0, "BEGIN_POST"] == 0.0
    assert dissolved.loc[0, "END_POST"] == 10.0


def test_export_lrs_geometry_geojson_and_shp(tmp_path):
    geopandas = pytest_import_geopandas()
    routes = geopandas.GeoDataFrame(
        {
            "SECT_ID": ["00000100"],
            "BMP": [0.0],
            "EMP": [10.0],
        },
        geometry=[LineString([(0, 0), (10, 0)])],
        crs="EPSG:4326",
    )
    events = pd.DataFrame(
        {
            "ROADWAY": ["100"],
            "BEGIN_POST": [2.0],
            "END_POST": [6.0],
            "AADT": [50],
        }
    )
    geojson_path = export_lrs_geometry(
        routes,
        tmp_path / "clipped",
        segment_id="SECT_ID",
        start_post="BMP",
        end_post="EMP",
        events=events,
        event_segment_id="ROADWAY",
        event_start_post="BEGIN_POST",
        event_end_post="END_POST",
        fmt="geojson",
    )
    assert geojson_path.suffix == ".geojson"
    loaded = geopandas.read_file(geojson_path)
    assert len(loaded) == 1
    assert abs(loaded.geometry.iloc[0].length - 4.0) < 1e-6

    shp_path = export_lrs_geometry(
        routes,
        tmp_path / "routes_only.shp",
        segment_id="SECT_ID",
        start_post="BMP",
        end_post="EMP",
        fmt="shp",
    )
    assert shp_path.suffix == ".shp"
    source_only = geopandas.read_file(shp_path)
    assert len(source_only) == 1
    assert abs(source_only.geometry.iloc[0].length - 10.0) < 1e-6


def test_export_lrs_geometry_requires_picked_fields():
    geopandas = pytest_import_geopandas()
    routes = geopandas.GeoDataFrame(
        {"ROADWAY": ["1"], "BEGIN_POST": [0.0], "END_POST": [1.0]},
        geometry=[LineString([(0, 0), (1, 0)])],
    )
    try:
        export_lrs_geometry(
            routes,
            "unused.geojson",
            segment_id="MISSING_ID",
            start_post="BEGIN_POST",
            end_post="END_POST",
        )
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "MISSING_ID" in str(exc)


def pytest_import_geopandas():
    import geopandas as gpd

    return gpd
