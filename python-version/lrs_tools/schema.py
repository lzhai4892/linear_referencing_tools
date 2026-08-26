"""Column aliases and roadway-ID helpers for FDOT LRS event tables."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Iterable

import pandas as pd

ROADWAY_ALIASES: tuple[str, ...] = (
    "ROADWAY",
    "roadway",
    "Roadway ID",
    "ROADWAY_ID",
    "roadwayid",
    "ROADWAY_new",
    "SECTION_",
    "roadway *",
)

BMP_ALIASES: tuple[str, ...] = (
    "BEGIN_POST",
    "begin_post",
    "BMP",
    "MinMP",
    "BEGINMP",
    "BEGIN_MP",
)

EMP_ALIASES: tuple[str, ...] = (
    "END_POST",
    "end_post",
    "EMP",
    "MaxMP",
    "ENDMP",
    "END_MP",
)

MEASURE_ALIASES: tuple[str, ...] = (
    "LOCATION",
    "location",
    "MP",
    "MILEPOST",
    "milepost",
)

DEFAULT_TOLERANCE = 1e-4
ROADWAY_WIDTH = 8
_MISSING_COMPARE = "__NULL__"


def pad_roadway_id(value) -> str | None:
    """Normalize a Florida RCI roadway ID to an 8-character zero-padded string."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if pd.isna(value):
        return None
    text = str(value).strip()
    if text == "" or text.lower() == "nan":
        return None
    if "." in text:
        try:
            text = str(int(float(text)))
        except ValueError:
            pass
    return text.zfill(ROADWAY_WIDTH)


def pad_roadway_series(values: pd.Series) -> pd.Series:
    """Vectorized roadway-ID padding. Nulls stay as pandas NA."""
    return values.map(pad_roadway_id)


def _first_present(columns: Iterable[str], aliases: Iterable[str]) -> str | None:
    lookup = {str(col): col for col in columns}
    lower_lookup = {str(col).lower(): col for col in columns}
    for alias in aliases:
        if alias in lookup:
            return lookup[alias]
        lowered = alias.lower()
        if lowered in lower_lookup:
            return lower_lookup[lowered]
    return None


def resolve_columns(
    df: pd.DataFrame,
    *,
    roadway: str | None = None,
    bmp: str | None = None,
    emp: str | None = None,
    measure: str | None = None,
    require_line: bool = False,
    require_measure: bool = False,
) -> tuple[str | None, str | None, str | None, str | None]:
    """Resolve LRS column names from explicit names or common aliases."""
    roadway_col = roadway if roadway in df.columns else _first_present(df.columns, ROADWAY_ALIASES)
    if roadway is not None and roadway in df.columns:
        roadway_col = roadway
    bmp_col = bmp if bmp in df.columns else _first_present(df.columns, BMP_ALIASES)
    if bmp is not None and bmp in df.columns:
        bmp_col = bmp
    emp_col = emp if emp in df.columns else _first_present(df.columns, EMP_ALIASES)
    if emp is not None and emp in df.columns:
        emp_col = emp
    measure_col = measure if measure in df.columns else _first_present(df.columns, MEASURE_ALIASES)
    if measure is not None and measure in df.columns:
        measure_col = measure

    if require_line and (roadway_col is None or bmp_col is None or emp_col is None):
        raise ValueError(
            "Could not resolve roadway / begin-milepost / end-milepost columns. "
            f"Available columns: {list(df.columns)}"
        )
    if require_measure and (roadway_col is None or measure_col is None):
        raise ValueError(
            "Could not resolve roadway / measure columns. "
            f"Available columns: {list(df.columns)}"
        )
    return roadway_col, bmp_col, emp_col, measure_col


@dataclass(frozen=True)
class LrsSchema:
    """Column mapping for an LRS event or point table."""

    roadway: str = "ROADWAY"
    bmp: str = "BEGIN_POST"
    emp: str = "END_POST"
    measure: str | None = "LOCATION"
    tolerance: float = DEFAULT_TOLERANCE

    @classmethod
    def from_dataframe(
        cls,
        df: pd.DataFrame,
        *,
        roadway: str | None = None,
        bmp: str | None = None,
        emp: str | None = None,
        measure: str | None = None,
        tolerance: float = DEFAULT_TOLERANCE,
        require_line: bool = False,
        require_measure: bool = False,
    ) -> "LrsSchema":
        roadway_col, bmp_col, emp_col, measure_col = resolve_columns(
            df,
            roadway=roadway,
            bmp=bmp,
            emp=emp,
            measure=measure,
            require_line=require_line,
            require_measure=require_measure,
        )
        return cls(
            roadway=roadway_col or "ROADWAY",
            bmp=bmp_col or "BEGIN_POST",
            emp=emp_col or "END_POST",
            measure=measure_col,
            tolerance=tolerance,
        )

    def with_updates(self, **kwargs) -> "LrsSchema":
        return replace(self, **kwargs)

    def line_columns(self) -> list[str]:
        return [self.roadway, self.bmp, self.emp]

    def validate_line(self, df: pd.DataFrame) -> None:
        missing = [col for col in self.line_columns() if col not in df.columns]
        if missing:
            raise ValueError(f"DataFrame is missing LRS line columns: {missing}")

    def validate_point(self, df: pd.DataFrame) -> None:
        if self.measure is None or self.measure not in df.columns:
            raise ValueError("DataFrame is missing an LRS measure / LOCATION column.")
        if self.roadway not in df.columns:
            raise ValueError(f"DataFrame is missing roadway column '{self.roadway}'.")


def coerce_numeric(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def compare_key(series: pd.Series) -> pd.Series:
    """Stable equality key so NaN compares equal to NaN when detecting blocks."""
    return series.fillna(_MISSING_COMPARE).astype(str)
