"""Merge adjacent LRS event rows that share attributes and connect by milepost."""

from __future__ import annotations

from typing import Iterable

import pandas as pd

from lrs_tools.schema import LrsSchema, coerce_numeric, compare_key

try:
    import geopandas as gpd
except ImportError:  # pragma: no cover
    gpd = None


def _block_ids(
    df: pd.DataFrame,
    group_cols: list[str],
    schema: LrsSchema,
    require_contiguous: bool,
) -> pd.Series:
    if df.empty:
        return pd.Series(dtype="int64")

    changed = pd.Series(False, index=df.index)
    for col in group_cols:
        changed = changed | (compare_key(df[col]) != compare_key(df[col]).shift(1))

    if require_contiguous:
        prev_end = df[schema.emp].shift(1)
        curr_begin = df[schema.bmp]
        gap = (curr_begin - prev_end).abs()
        not_contiguous = (gap > schema.tolerance) | gap.isna()
        same_roadway = compare_key(df[schema.roadway]) == compare_key(df[schema.roadway]).shift(1)
        changed = changed | (not_contiguous & same_roadway) | (~same_roadway)

    changed.iloc[0] = True
    return changed.cumsum()


def dissolve_contiguous(
    df: pd.DataFrame,
    group_cols: Iterable[str] | None = None,
    schema: LrsSchema | None = None,
    *,
    require_contiguous: bool = True,
    agg: dict | None = None,
) -> pd.DataFrame:
    """Collapse rows that share *group_cols* (and, by default, connect at BMP/EMP).

    ``require_contiguous=False`` matches the Step 4 pre-dissolve: after sorting by
    roadway and BMP, identical attribute runs are merged even if a milepost gap
    sits between them.

    When *df* is a GeoDataFrame, geometries in a block are unioned.
    """
    if df.empty:
        return df.copy()

    work = df.copy()
    schema = schema or LrsSchema.from_dataframe(work, require_line=True)
    schema.validate_line(work)

    work[schema.bmp] = coerce_numeric(work[schema.bmp])
    work[schema.emp] = coerce_numeric(work[schema.emp])
    work = work.dropna(subset=[schema.bmp, schema.emp]).copy()

    if group_cols is None:
        resolved_groups = [schema.roadway]
    else:
        resolved_groups = [col for col in group_cols if col in work.columns]
        if schema.roadway not in resolved_groups:
            resolved_groups = [schema.roadway] + resolved_groups

    sort_cols = [schema.roadway, schema.bmp]
    if schema.emp in work.columns:
        sort_cols.append(schema.emp)
    work = work.sort_values(by=sort_cols).reset_index(drop=True)
    work["_lrs_block"] = _block_ids(work, resolved_groups, schema, require_contiguous)

    geometry_col = None
    if gpd is not None and isinstance(work, gpd.GeoDataFrame) and work.geometry.name in work.columns:
        geometry_col = work.geometry.name

    agg_dict: dict = {}
    if agg:
        agg_dict.update(agg)
    for col in resolved_groups:
        agg_dict.setdefault(col, "first")
    agg_dict[schema.bmp] = "min"
    agg_dict[schema.emp] = "max"

    for col in work.columns:
        if col in {"_lrs_block", geometry_col}:
            continue
        agg_dict.setdefault(col, "first")

    if geometry_col:
        geom = work.groupby("_lrs_block", sort=True)[geometry_col].agg(
            lambda parts: parts.union_all() if hasattr(parts, "union_all") else parts.unary_union
        )
        dissolved = work.drop(columns=[geometry_col]).groupby("_lrs_block", sort=True).agg(agg_dict)
        dissolved[geometry_col] = geom
        dissolved = dissolved.reset_index(drop=True)
        result = gpd.GeoDataFrame(dissolved, geometry=geometry_col, crs=work.crs)
    else:
        result = work.groupby("_lrs_block", sort=True).agg(agg_dict).reset_index(drop=True)

    return result.sort_values(by=[schema.roadway, schema.bmp]).reset_index(drop=True)


def collapse_longest(
    df: pd.DataFrame,
    group_cols: Iterable[str] | None = None,
    schema: LrsSchema | None = None,
) -> pd.DataFrame:
    """Dissolve contiguous blocks but keep attributes from the longest slice.

    Used after overlay to remove sliver artifacts while retaining the dominant
    overlapping event attributes (Step 4 post-overlay behavior).
    """
    if df.empty:
        return df.copy()

    work = df.copy()
    schema = schema or LrsSchema.from_dataframe(work, require_line=True)
    schema.validate_line(work)

    work[schema.bmp] = coerce_numeric(work[schema.bmp])
    work[schema.emp] = coerce_numeric(work[schema.emp])
    work = work.dropna(subset=[schema.bmp, schema.emp]).copy()

    if group_cols is None:
        resolved_groups = [schema.roadway]
    else:
        resolved_groups = [col for col in group_cols if col in work.columns]
        if not resolved_groups:
            resolved_groups = [schema.roadway]

    work = work.sort_values(by=[schema.roadway, schema.bmp, schema.emp]).reset_index(drop=True)
    work["_lrs_block"] = _block_ids(work, resolved_groups, schema, require_contiguous=True)
    work["_slice_length"] = work[schema.emp] - work[schema.bmp]

    bounds = (
        work.groupby("_lrs_block", sort=True)
        .agg(_block_min_bmp=(schema.bmp, "min"), _block_max_emp=(schema.emp, "max"))
        .reset_index()
    )
    longest = (
        work.sort_values(by=["_lrs_block", "_slice_length"])
        .drop_duplicates(subset=["_lrs_block"], keep="last")
        .reset_index(drop=True)
    )
    longest = longest.merge(bounds, on="_lrs_block")
    longest[schema.bmp] = longest["_block_min_bmp"]
    longest[schema.emp] = longest["_block_max_emp"]
    longest = longest.drop(columns=["_lrs_block", "_slice_length", "_block_min_bmp", "_block_max_emp"])
    return longest.sort_values(by=[schema.roadway, schema.bmp]).reset_index(drop=True)
