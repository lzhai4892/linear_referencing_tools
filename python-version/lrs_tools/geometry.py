"""Clip and dissolve line geometries using LRS mileposts."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

import pandas as pd

from lrs_tools.dissolve import dissolve_contiguous
from lrs_tools.io import normalize_spatial_output, write_events
from lrs_tools.schema import LrsSchema, coerce_numeric, pad_roadway_id

try:
    import geopandas as gpd
    from shapely.geometry import LineString, MultiLineString
    from shapely.ops import substring, unary_union
except ImportError:  # pragma: no cover
    gpd = None
    LineString = None
    MultiLineString = None
    substring = None
    unary_union = None


def _require_geopandas() -> None:
    if gpd is None:
        raise ImportError("geopandas and shapely are required for GIS LRS operations")


def _as_lines(geom):
    if geom is None or getattr(geom, "is_empty", True):
        return []
    if geom.geom_type == "LineString":
        return [geom]
    if geom.geom_type == "MultiLineString":
        return list(geom.geoms)
    if geom.geom_type == "GeometryCollection":
        lines = []
        for part in geom.geoms:
            lines.extend(_as_lines(part))
        return lines
    return []


def _coords_have_m(geom) -> bool:
    if geom is None or getattr(geom.has_z, "__bool__", lambda: False)():
        pass
    coords = getattr(geom, "coords", None)
    if not coords:
        return False
    first = next(iter(coords), None)
    return first is not None and len(first) >= 4


def _substring_by_m(geom, clip_bmp: float, clip_emp: float):
    """Extract a portion of a measured line using M values when present."""
    coords = list(geom.coords)
    measures = [c[3] for c in coords]
    if clip_emp <= measures[0] or clip_bmp >= measures[-1]:
        return None

    def _interp(m):
        if m <= measures[0]:
            return coords[0][:2]
        if m >= measures[-1]:
            return coords[-1][:2]
        for i in range(1, len(measures)):
            m0, m1 = measures[i - 1], measures[i]
            if m0 <= m <= m1 or m1 <= m <= m0:
                span = m1 - m0
                t = 0.0 if span == 0 else (m - m0) / span
                x = coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0])
                y = coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1])
                return (x, y)
        return coords[-1][:2]

    kept = [_interp(clip_bmp)]
    for coord, measure in zip(coords, measures):
        if clip_bmp < measure < clip_emp:
            kept.append(coord[:2])
    kept.append(_interp(clip_emp))
    if len(kept) < 2:
        return None
    return LineString(kept)


def split_line_by_measure(geom, line_bmp: float, line_emp: float, clip_bmp: float, clip_emp: float):
    """Clip a line to ``[clip_bmp, clip_emp]`` using M values or length interpolation."""
    _require_geopandas()
    if geom is None or getattr(geom, "is_empty", True):
        return None
    if pd.isna(line_bmp) or pd.isna(line_emp) or pd.isna(clip_bmp) or pd.isna(clip_emp):
        return None
    span = float(line_emp) - float(line_bmp)
    if span <= 0:
        return None

    start = max(float(clip_bmp), float(line_bmp))
    stop = min(float(clip_emp), float(line_emp))
    if stop <= start:
        return None

    parts = []
    for line in _as_lines(geom):
        if _coords_have_m(line):
            clipped = _substring_by_m(line, start, stop)
        else:
            t0 = (start - float(line_bmp)) / span
            t1 = (stop - float(line_bmp)) / span
            t0 = max(0.0, min(1.0, t0))
            t1 = max(0.0, min(1.0, t1))
            if t1 <= t0:
                continue
            clipped = substring(line, t0, t1, normalized=True)
        if clipped is not None and not clipped.is_empty and clipped.length > 0:
            parts.append(clipped)

    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return unary_union(parts)


def locate_events_on_routes(
    events: pd.DataFrame,
    routes,
    event_schema: LrsSchema | None = None,
    route_schema: LrsSchema | None = None,
) -> "gpd.GeoDataFrame":
    """Cut route geometries to each event BMP–EMP and return a GeoDataFrame."""
    _require_geopandas()
    if events.empty:
        return gpd.GeoDataFrame(events.copy(), geometry=[], crs=getattr(routes, "crs", None))

    event_schema = event_schema or LrsSchema.from_dataframe(events, require_line=True)
    route_schema = route_schema or LrsSchema.from_dataframe(routes, require_line=True)
    event_schema.validate_line(events)
    route_schema.validate_line(routes)

    ev = events.copy()
    ev[event_schema.bmp] = coerce_numeric(ev[event_schema.bmp])
    ev[event_schema.emp] = coerce_numeric(ev[event_schema.emp])
    ev["_merge_roadway"] = ev[event_schema.roadway].map(pad_roadway_id)

    rt = routes.copy()
    if not isinstance(rt, gpd.GeoDataFrame):
        raise TypeError("routes must be a GeoDataFrame with line geometry")
    rt[route_schema.bmp] = coerce_numeric(rt[route_schema.bmp])
    rt[route_schema.emp] = coerce_numeric(rt[route_schema.emp])
    rt["_merge_roadway"] = rt[route_schema.roadway].map(pad_roadway_id)

    routes_by_road = {
        road: group
        for road, group in rt.groupby("_merge_roadway", dropna=True)
    }

    geometries = []
    for row in ev.to_dict("records"):
        pieces = routes_by_road.get(row["_merge_roadway"])
        if pieces is None:
            geometries.append(None)
            continue
        clipped_parts = []
        for _, route_row in pieces.iterrows():
            clipped = split_line_by_measure(
                route_row.geometry,
                route_row[route_schema.bmp],
                route_row[route_schema.emp],
                row[event_schema.bmp],
                row[event_schema.emp],
            )
            if clipped is not None:
                clipped_parts.append(clipped)
        if not clipped_parts:
            geometries.append(None)
        elif len(clipped_parts) == 1:
            geometries.append(clipped_parts[0])
        else:
            geometries.append(unary_union(clipped_parts))

    ev = ev.drop(columns=["_merge_roadway"])
    return gpd.GeoDataFrame(ev, geometry=geometries, crs=rt.crs)


def export_lrs_geometry(
    routes,
    output_path: str | Path,
    *,
    segment_id: str,
    start_post: str,
    end_post: str,
    events: pd.DataFrame | None = None,
    event_segment_id: str | None = None,
    event_start_post: str | None = None,
    event_end_post: str | None = None,
    fmt: str | None = None,
    drop_empty: bool = True,
) -> Path:
    """Locate events on a source LRS geometry and write Shapefile or GeoJSON.

    *routes* must be a GeoDataFrame whose linear-referencing fields the caller
    names explicitly: segment ID, begin milepost, and end milepost. When
    *events* is omitted, the source geometry itself is exported. When *events*
    is provided, each event is clipped to the matching route milepost range.
    """
    _require_geopandas()
    if not isinstance(routes, gpd.GeoDataFrame):
        raise TypeError("Source geometry must be a GeoDataFrame with line geometry")

    missing = [col for col in (segment_id, start_post, end_post) if col not in routes.columns]
    if missing:
        raise ValueError(
            "Source geometry is missing the selected LRS fields: "
            f"{missing}. Available columns: {list(routes.columns)}"
        )

    dest = normalize_spatial_output(output_path, fmt)
    route_schema = LrsSchema(roadway=segment_id, bmp=start_post, emp=end_post)

    if events is None:
        out = routes.copy()
    else:
        ev = events.copy()
        if "geometry" in ev.columns:
            ev = ev.drop(columns=["geometry"])
        ev_id = event_segment_id or (segment_id if segment_id in ev.columns else None)
        ev_bmp = event_start_post or (start_post if start_post in ev.columns else None)
        ev_emp = event_end_post or (end_post if end_post in ev.columns else None)
        if ev_id is None or ev_bmp is None or ev_emp is None:
            detected = LrsSchema.from_dataframe(ev, require_line=True)
            ev_id = ev_id or detected.roadway
            ev_bmp = ev_bmp or detected.bmp
            ev_emp = ev_emp or detected.emp
        event_schema = LrsSchema(roadway=ev_id, bmp=ev_bmp, emp=ev_emp)
        out = locate_events_on_routes(ev, routes, event_schema=event_schema, route_schema=route_schema)
        if drop_empty and "geometry" in out.columns:
            out = out[out.geometry.notna() & ~out.geometry.is_empty].copy()

    return write_events(out, dest)


def dissolve_geometries(
    gdf,
    group_cols: Iterable[str] | None = None,
    schema: LrsSchema | None = None,
    *,
    require_contiguous: bool = True,
):
    """Dissolve contiguous LRS events and union their geometries."""
    _require_geopandas()
    return dissolve_contiguous(
        gdf,
        group_cols=group_cols,
        schema=schema,
        require_contiguous=require_contiguous,
    )
