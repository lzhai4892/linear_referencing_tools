"""Join two LRS line event tables and break them at milepost overlaps."""

from __future__ import annotations

from typing import Iterable

import numpy as np
import pandas as pd

from lrs_tools.dissolve import collapse_longest
from lrs_tools.schema import LrsSchema, coerce_numeric, pad_roadway_id


def _target_base(row: dict, drop_cols: set[str]) -> dict:
    return {key: value for key, value in row.items() if key not in drop_cols}


def overlay_events(
    target: pd.DataFrame,
    overlay: pd.DataFrame,
    target_schema: LrsSchema | None = None,
    overlay_schema: LrsSchema | None = None,
    *,
    how: str = "left",
    overlay_cols: Iterable[str] | None = None,
    collapse: str = "none",
    collapse_group_cols: Iterable[str] | None = None,
    target_rename: dict[str, str] | None = None,
) -> pd.DataFrame:
    """Dynamic-segment *target* against *overlay* on roadway + BMP/EMP.

    An overlap exists when ``overlay_BMP < target_EMP`` and
    ``overlay_EMP > target_BMP``. Gaps on the target (unmatched roadway or
    unmatched stretch) are kept when ``how='left'`` with overlay attributes
    set to NaN.

    ``collapse='longest'`` then merges contiguous target-attribute blocks and
    keeps attributes from the longest overlapping overlay slice.
    """
    if how not in {"left", "inner"}:
        raise ValueError("how must be 'left' or 'inner'")
    if collapse not in {"none", "longest"}:
        raise ValueError("collapse must be 'none' or 'longest'")

    target_schema = target_schema or LrsSchema.from_dataframe(target, require_line=True)
    overlay_schema = overlay_schema or LrsSchema.from_dataframe(overlay, require_line=True)
    target_schema.validate_line(target)
    overlay_schema.validate_line(overlay)

    left = target.copy()
    right = overlay.copy()
    if target_rename:
        left = left.rename(columns=target_rename)
        target_schema = target_schema.with_updates(
            **{
                field: target_rename[getattr(target_schema, field)]
                for field in ("roadway", "bmp", "emp")
                if getattr(target_schema, field) in target_rename
            }
        )

    left[target_schema.bmp] = coerce_numeric(left[target_schema.bmp])
    left[target_schema.emp] = coerce_numeric(left[target_schema.emp])
    right[overlay_schema.bmp] = coerce_numeric(right[overlay_schema.bmp])
    right[overlay_schema.emp] = coerce_numeric(right[overlay_schema.emp])
    right = right.dropna(subset=[overlay_schema.bmp, overlay_schema.emp]).copy()

    left["_merge_roadway"] = left[target_schema.roadway].map(pad_roadway_id)
    right["_merge_roadway"] = right[overlay_schema.roadway].map(pad_roadway_id)

    excluded_overlay = {
        overlay_schema.roadway,
        overlay_schema.bmp,
        overlay_schema.emp,
        "_merge_roadway",
        "geometry",
    }
    if overlay_cols is None:
        resolved_overlay_cols = [col for col in right.columns if col not in excluded_overlay]
    else:
        resolved_overlay_cols = [col for col in overlay_cols if col in right.columns]

    overlay_by_roadway = {
        road: group.to_dict("records")
        for road, group in right.groupby("_merge_roadway", dropna=True)
    }

    drop_from_base = {
        target_schema.bmp,
        target_schema.emp,
        "_merge_roadway",
        "geometry",
    }

    rows: list[dict] = []
    for row in left.to_dict("records"):
        new_bmp = row[target_schema.bmp]
        new_emp = row[target_schema.emp]
        merge_road = row["_merge_roadway"]
        base = _target_base(row, drop_from_base)

        def emit(begin, end, overlay_row=None, matched=True):
            if begin is None or end is None or pd.isna(begin) or pd.isna(end):
                if how == "left":
                    out = base.copy()
                    out[target_schema.bmp] = begin
                    out[target_schema.emp] = end
                    for attr in resolved_overlay_cols:
                        out[attr] = overlay_row[attr] if overlay_row is not None else np.nan
                    rows.append(out)
                return
            if begin >= end:
                return
            if how == "inner" and not matched:
                return
            out = base.copy()
            out[target_schema.bmp] = begin
            out[target_schema.emp] = end
            for attr in resolved_overlay_cols:
                out[attr] = overlay_row[attr] if overlay_row is not None else np.nan
            rows.append(out)

        if pd.isna(new_bmp) or pd.isna(new_emp):
            emit(row.get(target_schema.bmp), row.get(target_schema.emp), matched=False)
            continue

        old_segs = overlay_by_roadway.get(merge_road, [])
        overlaps = [
            old
            for old in old_segs
            if old[overlay_schema.bmp] < new_emp and old[overlay_schema.emp] > new_bmp
        ]
        if not overlaps:
            emit(new_bmp, new_emp, matched=False)
            continue

        overlaps.sort(key=lambda item: item[overlay_schema.bmp])
        current = new_bmp
        for old in overlaps:
            old_b = old[overlay_schema.bmp]
            old_e = old[overlay_schema.emp]
            if old_b > current:
                emit(current, min(old_b, new_emp), matched=False)
            overlap_b = max(current, old_b)
            overlap_e = min(new_emp, old_e)
            if overlap_b < overlap_e:
                emit(overlap_b, overlap_e, overlay_row=old, matched=True)
            current = max(current, overlap_e)
        if current < new_emp:
            emit(current, new_emp, matched=False)

    result = pd.DataFrame(rows)
    if result.empty:
        columns = (
            [col for col in left.columns if col not in drop_from_base]
            + [target_schema.bmp, target_schema.emp]
            + resolved_overlay_cols
        )
        result = pd.DataFrame(columns=list(dict.fromkeys(columns)))
        return result

    result = result.sort_values(by=[target_schema.roadway, target_schema.bmp]).reset_index(drop=True)

    if collapse == "longest":
        if collapse_group_cols is None:
            collapse_cols = [
                col
                for col in result.columns
                if col not in resolved_overlay_cols
                and col not in {target_schema.bmp, target_schema.emp}
            ]
        else:
            collapse_cols = list(collapse_group_cols)
        result = collapse_longest(result, collapse_cols, schema=target_schema)

    return result
