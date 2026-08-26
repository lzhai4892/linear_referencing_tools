"""Read and write LRS event tables (CSV, Excel, shapefile, GeoPackage)."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from lrs_tools.schema import ROADWAY_ALIASES

try:
    import geopandas as gpd
except ImportError:  # pragma: no cover
    gpd = None


TABLE_SUFFIXES = {".csv", ".xlsx", ".xls"}
SPATIAL_SUFFIXES = {".shp", ".gpkg", ".geojson", ".json"}
_ROADWAY_NAMES = {name.lower() for name in ROADWAY_ALIASES}


def _roadway_string_dtypes(columns) -> dict[str, type]:
    return {col: str for col in columns if str(col).lower() in _ROADWAY_NAMES}


def _as_path(path: str | Path) -> Path:
    return Path(path).expanduser()


def _first_shapefile(folder: Path) -> Path:
    matches = sorted(folder.glob("*.shp"))
    if not matches:
        raise FileNotFoundError(f"No .shp file found in {folder}")
    return matches[0]


def read_events(path: str | Path):
    """Load an event table or spatial layer. Directories resolve to the first .shp."""
    source = _as_path(path)
    if source.is_dir():
        source = _first_shapefile(source)
    if not source.exists():
        raise FileNotFoundError(f"LRS input not found: {source}")

    suffix = source.suffix.lower()
    if suffix == ".csv":
        preview = pd.read_csv(source, nrows=0)
        return pd.read_csv(source, dtype=_roadway_string_dtypes(preview.columns))
    if suffix in {".xlsx", ".xls"}:
        preview = pd.read_excel(source, nrows=0)
        return pd.read_excel(source, dtype=_roadway_string_dtypes(preview.columns))
    if suffix in SPATIAL_SUFFIXES:
        if gpd is None:
            raise ImportError("geopandas is required to read spatial LRS files")
        return gpd.read_file(source)
    raise ValueError(f"Unsupported LRS input type: {source.suffix}")


def write_events(df: pd.DataFrame, path: str | Path) -> Path:
    """Write an event table. Spatial formats require a geometry column."""
    dest = _as_path(path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    suffix = dest.suffix.lower()

    if suffix == ".csv":
        out = df.drop(columns=["geometry"], errors="ignore") if "geometry" in getattr(df, "columns", []) else df
        out.to_csv(dest, index=False)
        return dest
    if suffix in {".xlsx", ".xls"}:
        out = df.drop(columns=["geometry"], errors="ignore") if "geometry" in getattr(df, "columns", []) else df
        out.to_excel(dest, index=False)
        return dest
    if suffix in SPATIAL_SUFFIXES:
        if gpd is None:
            raise ImportError("geopandas is required to write spatial LRS files")
        if "geometry" not in getattr(df, "columns", []):
            raise ValueError(f"Cannot write {suffix} without a geometry column")
        gdf = df if isinstance(df, gpd.GeoDataFrame) else gpd.GeoDataFrame(df, geometry="geometry")
        if suffix == ".shp":
            gdf = _shapefile_safe(gdf)
            gdf.to_file(dest)
        elif suffix in {".geojson", ".json"}:
            gdf.to_file(dest, driver="GeoJSON")
        else:
            gdf.to_file(dest, driver="GPKG")
        return dest
    raise ValueError(f"Unsupported LRS output type: {dest.suffix}")


def _shapefile_safe(gdf):
    """Shorten attribute names to the shapefile 10-character limit."""
    used: set[str] = set()
    rename: dict[str, str] = {}
    geom_name = gdf.geometry.name
    for col in gdf.columns:
        if col == geom_name:
            continue
        base = str(col)[:10]
        name = base
        index = 1
        while name.lower() in used:
            suffix = str(index)
            name = f"{base[: max(1, 10 - len(suffix))]}{suffix}"
            index += 1
        used.add(name.lower())
        if name != col:
            rename[col] = name
    return gdf.rename(columns=rename) if rename else gdf


def normalize_spatial_output(path: str | Path, fmt: str | None = None) -> Path:
    """Resolve an output path and format (shp or geojson)."""
    dest = _as_path(path)
    resolved = (fmt or dest.suffix.lstrip(".") or "").lower()
    aliases = {
        "shapefile": "shp",
        "shp": "shp",
        "geojson": "geojson",
        "json": "geojson",
        "gpkg": "gpkg",
        "geopackage": "gpkg",
    }
    resolved = aliases.get(resolved)
    if resolved is None:
        raise ValueError("Export format must be shp, geojson, or gpkg")
    if dest.suffix.lower() not in {".shp", ".geojson", ".json", ".gpkg"}:
        dest = dest.with_suffix(".geojson" if resolved == "geojson" else f".{resolved}")
    return dest
