from pathlib import Path

import pandas as pd
from shapely.geometry import LineString

from lrs_tools.io import read_events, write_events


def test_read_write_csv_roundtrip(tmp_path: Path):
    df = pd.DataFrame(
        {"ROADWAY": ["00000100"], "BEGIN_POST": [0.0], "END_POST": [1.5], "AADT": [9]}
    )
    dest = tmp_path / "events.csv"
    write_events(df, dest)
    loaded = read_events(dest)
    assert list(loaded["ROADWAY"]) == ["00000100"]
    assert loaded.loc[0, "AADT"] == 9


def test_write_gpkg_requires_geometry(tmp_path: Path):
    df = pd.DataFrame({"ROADWAY": ["1"], "BEGIN_POST": [0], "END_POST": [1]})
    try:
        write_events(df, tmp_path / "x.gpkg")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_write_read_gpkg(tmp_path: Path):
    import geopandas as gpd

    gdf = gpd.GeoDataFrame(
        {"ROADWAY": ["1"], "BEGIN_POST": [0.0], "END_POST": [1.0]},
        geometry=[LineString([(0, 0), (1, 0)])],
        crs="EPSG:4326",
    )
    dest = tmp_path / "routes.gpkg"
    write_events(gdf, dest)
    loaded = read_events(dest)
    assert len(loaded) == 1
    assert loaded.geometry.iloc[0].length == 1.0


def test_write_read_geojson(tmp_path: Path):
    import geopandas as gpd

    gdf = gpd.GeoDataFrame(
        {"ROADWAY": ["1"], "BEGIN_POST": [0.0], "END_POST": [1.0]},
        geometry=[LineString([(0, 0), (1, 0)])],
        crs="EPSG:4326",
    )
    dest = tmp_path / "routes.geojson"
    write_events(gdf, dest)
    loaded = read_events(dest)
    assert dest.exists()
    assert len(loaded) == 1
    assert loaded.geometry.iloc[0].length == 1.0
