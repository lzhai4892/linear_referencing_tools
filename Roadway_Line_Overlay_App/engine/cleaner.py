"""
Layer Data Ingestion, Multi-Part Cleaning, and Coordinate Normalization Module.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, List, Optional, Tuple

import geopandas as gpd
import pandas as pd
from pyproj import CRS
from shapely import wkt
from shapely.geometry import GeometryCollection, LineString, MultiLineString


@dataclass
class LayerInfo:
    layer_name: str
    feature_count: int
    multipart_count: int
    invalid_geom_count: int
    source_crs: str
    target_crs: str
    columns: List[str]
    sample_data: List[dict] = field(default_factory=list)
    warning_messages: List[str] = field(default_factory=list)


class DataCleaner:
    """Handles file format parsing, geometry validation/exploding, and CRS standardization."""

    SUPPORTED_EXTENSIONS = {".zip", ".shp", ".geojson", ".json", ".kml", ".gpkg", ".csv"}

    @classmethod
    def extract_zip(cls, zip_path: Path | str, target_dir: Path) -> Path:
        """Extract a zip archive and locate the primary .shp or .geojson file."""
        zip_path = Path(zip_path)
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(target_dir)

        # Ignore __MACOSX and hidden files
        for ext in [".shp", ".geojson", ".json", ".gpkg", ".kml", ".csv"]:
            found = [
                p for p in target_dir.rglob(f"*{ext}")
                if "__MACOSX" not in str(p) and not p.name.startswith("._")
            ]
            if found:
                return found[0]
        raise ValueError(f"No valid GIS file (.shp, .geojson, .gpkg, .csv) found inside zip archive: {zip_path.name}")

    @classmethod
    def load_raw_geodataframe(cls, file_path: Path | str) -> Tuple[gpd.GeoDataFrame, str, Optional[tempfile.TemporaryDirectory]]:
        """Load any supported spatial file format into a GeoDataFrame."""
        path = Path(file_path)
        temp_dir = None

        if not path.exists():
            raise FileNotFoundError(f"Input file does not exist: {path}")

        ext = path.suffix.lower()

        if ext == ".zip":
            temp_dir = tempfile.TemporaryDirectory()
            extract_target = Path(temp_dir.name)
            spatial_file = cls.extract_zip(path, extract_target)
            gdf = gpd.read_file(spatial_file)
            layer_name = path.stem
        elif ext in {".shp", ".geojson", ".json", ".gpkg", ".kml"}:
            gdf = gpd.read_file(path)
            layer_name = path.stem
        elif ext == ".csv":
            df = pd.read_csv(path)
            # Detect geometry or WKT column
            geom_col = None
            for col in df.columns:
                if col.lower() in {"wkt", "geometry", "geom", "the_geom", "shape"}:
                    geom_col = col
                    break
            if geom_col is None:
                # Check for lat/lon columns
                lat_col = next((c for c in df.columns if c.lower() in {"lat", "latitude", "y"}), None)
                lon_col = next((c for c in df.columns if c.lower() in {"lon", "long", "longitude", "x"}), None)
                if lat_col and lon_col:
                    from shapely.geometry import Point
                    geometry = [Point(xy) for xy in zip(df[lon_col], df[lat_col])]
                    gdf = gpd.GeoDataFrame(df, geometry=geometry, crs="EPSG:4326")
                else:
                    raise ValueError(f"CSV file '{path.name}' has no identifiable WKT or coordinate columns.")
            else:
                geometry = df[geom_col].apply(lambda x: wkt.loads(str(x)) if pd.notna(x) else None)
                gdf = gpd.GeoDataFrame(df, geometry=geometry)
            layer_name = path.stem
        else:
            raise ValueError(f"Unsupported file format '{ext}'. Supported: {cls.SUPPORTED_EXTENSIONS}")

        return gdf, layer_name, temp_dir

    @classmethod
    def clean_and_explode_linework(
        cls,
        gdf: gpd.GeoDataFrame,
        layer_name: str = "Layer",
        target_crs: int | str = 26917,
    ) -> Tuple[gpd.GeoDataFrame, LayerInfo]:
        """
        Cleans geometries, explodes MultiLineStrings, handles projection conversion,
        and produces a comprehensive LayerInfo summary.
        """
        warnings: List[str] = []
        original_count = len(gdf)

        # 1. Source CRS Detection & Reprojection
        source_crs_str = "Unknown (Assumed EPSG:4326)"
        if gdf.crs is not None:
            try:
                crs_obj = CRS.from_user_input(gdf.crs)
                source_crs_str = crs_obj.to_string()
            except Exception:
                source_crs_str = str(gdf.crs)
        else:
            # Missing CRS: default to WGS84 EPSG:4326
            gdf = gdf.set_crs(epsg=4326)
            warnings.append("Missing CRS metadata in source file. Assumed WGS84 (EPSG:4326).")

        # 2. Filter valid and non-empty geometries
        valid_mask = gdf.geometry.notna() & (~gdf.geometry.is_empty)
        invalid_count = original_count - int(valid_mask.sum())
        if invalid_count > 0:
            warnings.append(f"Dropped {invalid_count} null or empty geometries from {layer_name}.")
        working_gdf = gdf[valid_mask].copy()

        # 3. Detect Multi-part features
        multipart_count = int(
            working_gdf.geometry.apply(
                lambda g: isinstance(g, (MultiLineString, GeometryCollection))
            ).sum()
        )

        if multipart_count > 0:
            warnings.append(
                f"Notice: {multipart_count} multi-part feature(s) detected in '{layer_name}'. "
                "Exploded into single-part LineStrings for accurate corridor bearing and overlap analysis."
            )

        # 4. Preserve original feature index
        if "_orig_fid" not in working_gdf.columns:
            working_gdf["_orig_fid"] = working_gdf.index

        # 5. Explode multi-part geometries to single-part
        # Using geopandas explode
        exploded_gdf = working_gdf.explode(index_parts=False, ignore_index=True)

        # Ensure only LineString geometries remain
        line_mask = exploded_gdf.geometry.apply(lambda g: isinstance(g, LineString))
        non_line_count = len(exploded_gdf) - int(line_mask.sum())
        if non_line_count > 0:
            exploded_gdf = exploded_gdf[line_mask].copy()
            warnings.append(f"Filtered out {non_line_count} non-line geometry fragments.")

        # 6. Reproject to target projected CRS
        target_crs_str = f"EPSG:{target_crs}" if isinstance(target_crs, int) else str(target_crs)
        try:
            proj_gdf = exploded_gdf.to_crs(target_crs)
        except Exception as e:
            warnings.append(f"Reprojection error: {e}. Re-projecting via EPSG code.")
            proj_gdf = exploded_gdf.to_crs(epsg=int(target_crs) if str(target_crs).isdigit() else 26917)

        # 7. Collect metadata & sample data
        cols = [c for c in proj_gdf.columns if c != "geometry"]
        sample_records = (
            proj_gdf[cols].head(5).fillna("").to_dict(orient="records") if len(proj_gdf) > 0 else []
        )

        info = LayerInfo(
            layer_name=layer_name,
            feature_count=len(proj_gdf),
            multipart_count=multipart_count,
            invalid_geom_count=invalid_count,
            source_crs=source_crs_str,
            target_crs=target_crs_str,
            columns=cols,
            sample_data=sample_records,
            warning_messages=warnings,
        )

        return proj_gdf, info


def load_and_clean_layer(
    file_path: Path | str,
    target_crs: int | str = 26917,
) -> Tuple[gpd.GeoDataFrame, LayerInfo, Optional[tempfile.TemporaryDirectory]]:
    """Convenience entry point to load and clean a spatial layer from file."""
    raw_gdf, layer_name, temp_dir = DataCleaner.load_raw_geodataframe(file_path)
    cleaned_gdf, layer_info = DataCleaner.clean_and_explode_linework(
        raw_gdf, layer_name=layer_name, target_crs=target_crs
    )
    return cleaned_gdf, layer_info, temp_dir
