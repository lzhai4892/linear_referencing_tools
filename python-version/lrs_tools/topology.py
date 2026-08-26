"""Gap, overlap, neighbor, and validation helpers for LRS event tables."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from lrs_tools.schema import LrsSchema, coerce_numeric, pad_roadway_id


def _prepared(df: pd.DataFrame, schema: LrsSchema) -> pd.DataFrame:
    work = df.copy()
    work[schema.bmp] = coerce_numeric(work[schema.bmp])
    work[schema.emp] = coerce_numeric(work[schema.emp])
    work["_merge_roadway"] = work[schema.roadway].map(pad_roadway_id)
    return work.sort_values(by=["_merge_roadway", schema.bmp, schema.emp]).reset_index(drop=True)


def find_gaps(df: pd.DataFrame, schema: LrsSchema | None = None) -> pd.DataFrame:
    """Return coverage gaps between consecutive events on the same roadway."""
    if df.empty:
        return pd.DataFrame(columns=["ROADWAY", "GAP_BMP", "GAP_EMP", "GAP_LENGTH"])

    schema = schema or LrsSchema.from_dataframe(df, require_line=True)
    schema.validate_line(df)
    work = _prepared(df, schema)

    prev_road = work["_merge_roadway"].shift(1)
    prev_emp = work[schema.emp].shift(1)
    same_road = work["_merge_roadway"].notna() & (work["_merge_roadway"] == prev_road)
    gap_len = work[schema.bmp] - prev_emp
    is_gap = same_road & gap_len.notna() & (gap_len > schema.tolerance)

    gaps = work.loc[is_gap, ["_merge_roadway", schema.bmp]].copy()
    gaps = gaps.rename(columns={"_merge_roadway": "ROADWAY", schema.bmp: "GAP_EMP"})
    gaps["GAP_BMP"] = prev_emp[is_gap].values
    gaps["GAP_LENGTH"] = gaps["GAP_EMP"] - gaps["GAP_BMP"]
    return gaps[["ROADWAY", "GAP_BMP", "GAP_EMP", "GAP_LENGTH"]].reset_index(drop=True)


def find_overlaps(df: pd.DataFrame, schema: LrsSchema | None = None) -> pd.DataFrame:
    """Return pairwise overlaps of events on the same roadway."""
    schema = schema or LrsSchema.from_dataframe(df, require_line=True)
    schema.validate_line(df)
    work = _prepared(df, schema)
    work = work.dropna(subset=["_merge_roadway", schema.bmp, schema.emp])
    if work.empty:
        return pd.DataFrame(columns=["ROADWAY", "LEFT_BMP", "LEFT_EMP", "RIGHT_BMP", "RIGHT_EMP"])

    rows: list[dict] = []
    for road, group in work.groupby("_merge_roadway", sort=False):
        records = group[[schema.bmp, schema.emp]].to_dict("records")
        for i, left in enumerate(records):
            for right in records[i + 1 :]:
                if left[schema.bmp] < right[schema.emp] and left[schema.emp] > right[schema.bmp]:
                    rows.append(
                        {
                            "ROADWAY": road,
                            "LEFT_BMP": left[schema.bmp],
                            "LEFT_EMP": left[schema.emp],
                            "RIGHT_BMP": right[schema.bmp],
                            "RIGHT_EMP": right[schema.emp],
                        }
                    )
    return pd.DataFrame(rows)


def neighbors_along_route(
    df: pd.DataFrame,
    value_col: str,
    schema: LrsSchema | None = None,
    *,
    sort_col: str | None = None,
) -> pd.DataFrame:
    """Attach upstream/downstream neighbor values along each roadway."""
    if value_col not in df.columns:
        raise ValueError(f"value_col '{value_col}' is not in the DataFrame")

    work = df.copy()
    if schema is None:
        schema = LrsSchema.from_dataframe(work)
    if schema.roadway not in work.columns:
        raise ValueError(f"roadway column '{schema.roadway}' is not in the DataFrame")

    order_col = sort_col or schema.measure or schema.bmp
    if order_col not in work.columns:
        raise ValueError(f"sort column '{order_col}' is not in the DataFrame")

    work[order_col] = coerce_numeric(work[order_col])
    work["_merge_roadway"] = work[schema.roadway].map(pad_roadway_id)
    work = work.sort_values(by=["_merge_roadway", order_col]).reset_index(drop=True)
    grouped = work.groupby("_merge_roadway", dropna=False)

    work["Upstream_Value"] = grouped[value_col].shift(1)
    work["Downstream_Value"] = grouped[value_col].shift(-1)
    work["Upstream_Measure"] = grouped[order_col].shift(1)
    work["Downstream_Measure"] = grouped[order_col].shift(-1)

    up_ok = work[value_col].notna() & work["Upstream_Value"].notna() & (work["Upstream_Value"] != 0)
    down_ok = work[value_col].notna() & work["Downstream_Value"].notna() & (work["Downstream_Value"] != 0)
    work["Upstream_Diff_pct"] = np.where(
        up_ok, (work[value_col] - work["Upstream_Value"]) / work["Upstream_Value"], np.nan
    )
    work["Downstream_Diff_pct"] = np.where(
        down_ok, (work[value_col] - work["Downstream_Value"]) / work["Downstream_Value"], np.nan
    )
    return work.drop(columns=["_merge_roadway"])


@dataclass
class LrsValidation:
    invalid_bounds: pd.DataFrame
    overlaps: pd.DataFrame
    null_keys: pd.DataFrame
    gaps: pd.DataFrame

    @property
    def ok(self) -> bool:
        return self.invalid_bounds.empty and self.overlaps.empty and self.null_keys.empty


def validate_lrs(df: pd.DataFrame, schema: LrsSchema | None = None) -> LrsValidation:
    """Flag BMP >= EMP, null keys, and overlapping events on the same roadway."""
    schema = schema or LrsSchema.from_dataframe(df, require_line=True)
    schema.validate_line(df)
    work = _prepared(df, schema)
    invalid_bounds = work[work[schema.bmp].notna() & work[schema.emp].notna() & (work[schema.bmp] >= work[schema.emp])].copy()
    null_keys = work[work["_merge_roadway"].isna() | work[schema.bmp].isna() | work[schema.emp].isna()].copy()
    overlaps = find_overlaps(work.drop(columns=["_merge_roadway"], errors="ignore"), schema)
    gaps = find_gaps(work.drop(columns=["_merge_roadway"], errors="ignore"), schema)
    return LrsValidation(
        invalid_bounds=invalid_bounds.drop(columns=["_merge_roadway"], errors="ignore"),
        overlaps=overlaps,
        null_keys=null_keys.drop(columns=["_merge_roadway"], errors="ignore"),
        gaps=gaps,
    )
