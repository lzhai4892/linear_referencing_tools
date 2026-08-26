"""Locate point events onto line events using roadway ID + milepost."""

from __future__ import annotations

import pandas as pd

from lrs_tools.schema import LrsSchema, coerce_numeric, pad_roadway_id


def locate_points(
    points: pd.DataFrame,
    events: pd.DataFrame,
    point_schema: LrsSchema | None = None,
    event_schema: LrsSchema | None = None,
    *,
    how: str = "inner",
    event_cols: list[str] | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Join points to line events when ``BMP <= LOCATION <= EMP`` on the same roadway.

    Returns ``(located, unmatched)``. *unmatched* is the roadway-join explosion
    that failed the milepost test, matching the existing Step 2 QC export.
    """
    if how not in {"inner", "left"}:
        raise ValueError("how must be 'inner' or 'left'")

    point_schema = point_schema or LrsSchema.from_dataframe(points, require_measure=True)
    event_schema = event_schema or LrsSchema.from_dataframe(events, require_line=True)
    point_schema.validate_point(points)
    event_schema.validate_line(events)

    pts = points.copy()
    ev = events.copy()
    if "geometry" in ev.columns:
        ev = ev.drop(columns=["geometry"])

    pts["_merge_roadway"] = pts[point_schema.roadway].map(pad_roadway_id)
    ev["_merge_roadway"] = ev[event_schema.roadway].map(pad_roadway_id)
    pts[point_schema.measure] = coerce_numeric(pts[point_schema.measure])
    ev[event_schema.bmp] = coerce_numeric(ev[event_schema.bmp])
    ev[event_schema.emp] = coerce_numeric(ev[event_schema.emp])

    if event_cols is None:
        keep_event = [
            col
            for col in ev.columns
            if col not in {event_schema.roadway, "_merge_roadway"}
        ]
    else:
        keep_event = [col for col in event_cols if col in ev.columns]
        for required in (event_schema.bmp, event_schema.emp):
            if required not in keep_event and required in ev.columns:
                keep_event.append(required)

    ev_slim = ev[["_merge_roadway"] + keep_event].copy()
    joined = pts.merge(ev_slim, on="_merge_roadway", how="left")

    on_segment = (
        joined[point_schema.measure].notna()
        & joined[event_schema.bmp].notna()
        & joined[event_schema.emp].notna()
        & (joined[point_schema.measure] >= joined[event_schema.bmp])
        & (joined[point_schema.measure] <= joined[event_schema.emp])
    )
    located = joined.loc[on_segment].drop(columns=["_merge_roadway"]).reset_index(drop=True)
    unmatched = joined.loc[~on_segment].drop(columns=["_merge_roadway"]).reset_index(drop=True)

    if how == "left" and located.empty and unmatched.empty:
        return joined.drop(columns=["_merge_roadway"]), unmatched
    return located, unmatched
