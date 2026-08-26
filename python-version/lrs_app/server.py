"""FastAPI backend for the internal LRS desktop UI. Binds to localhost only."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from lrs_tools import (
    LrsSchema,
    dissolve_contiguous,
    export_lrs_geometry,
    locate_events_on_routes,
    locate_points,
    overlay_events,
    read_events,
    write_events,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="Internal LRS Toolkit", docs_url=None, redoc_url=None)


class OverlayBody(BaseModel):
    target_path: str
    overlay_path: str
    output_path: str
    how: str = "left"
    collapse: str = "none"
    group_cols: list[str] | None = None
    overlay_cols: list[str] | None = None


class DissolveBody(BaseModel):
    input_path: str
    output_path: str
    group_cols: list[str] = Field(default_factory=list)
    require_contiguous: bool = True


class LocateBody(BaseModel):
    points_path: str
    events_path: str
    output_path: str
    unmatched_path: str | None = None


class ClipBody(BaseModel):
    events_path: str
    routes_path: str
    output_path: str


class ExportGeometryBody(BaseModel):
    routes_path: str
    output_path: str
    segment_id: str
    start_post: str
    end_post: str
    events_path: str | None = None
    event_segment_id: str | None = None
    event_start_post: str | None = None
    event_end_post: str | None = None
    fmt: str = "geojson"


class BrowseBody(BaseModel):
    kind: str = "file"


class ColumnsBody(BaseModel):
    path: str


def _preview(df: pd.DataFrame, n: int = 40) -> dict[str, Any]:
    table = df.drop(columns=["geometry"], errors="ignore")
    return {
        "rows": int(len(table)),
        "columns": [str(c) for c in table.columns],
        "preview": json.loads(table.head(n).to_json(orient="records")),
    }


def _load_table(path: str) -> pd.DataFrame:
    try:
        data = read_events(path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if "geometry" in getattr(data, "columns", []):
        return pd.DataFrame(data.drop(columns="geometry"))
    return pd.DataFrame(data)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "bind": "127.0.0.1"}


@app.post("/api/columns")
def columns(body: ColumnsBody) -> dict[str, Any]:
    df = _load_table(body.path)
    schema = LrsSchema.from_dataframe(df)
    return {
        "columns": [str(c) for c in df.columns],
        "schema": {
            "roadway": schema.roadway if schema.roadway in df.columns else None,
            "bmp": schema.bmp if schema.bmp in df.columns else None,
            "emp": schema.emp if schema.emp in df.columns else None,
            "measure": schema.measure if schema.measure in df.columns else None,
        },
        "rows": int(len(df)),
    }


@app.post("/api/overlay")
def api_overlay(body: OverlayBody) -> dict[str, Any]:
    target = _load_table(body.target_path)
    overlay = _load_table(body.overlay_path)
    result = overlay_events(
        target,
        overlay,
        how=body.how,
        overlay_cols=body.overlay_cols,
        collapse=body.collapse,
        collapse_group_cols=body.group_cols or None,
    )
    dest = write_events(result, body.output_path)
    payload = _preview(result)
    payload["output_path"] = str(dest)
    return payload


@app.post("/api/dissolve")
def api_dissolve(body: DissolveBody) -> dict[str, Any]:
    df = _load_table(body.input_path)
    result = dissolve_contiguous(
        df,
        group_cols=body.group_cols or None,
        require_contiguous=body.require_contiguous,
    )
    dest = write_events(result, body.output_path)
    payload = _preview(result)
    payload["output_path"] = str(dest)
    return payload


@app.post("/api/locate")
def api_locate(body: LocateBody) -> dict[str, Any]:
    points = _load_table(body.points_path)
    events = _load_table(body.events_path)
    located, unmatched = locate_points(points, events)
    dest = write_events(located, body.output_path)
    unmatched_path = None
    if body.unmatched_path:
        unmatched_path = str(write_events(unmatched, body.unmatched_path))
    payload = _preview(located)
    payload["output_path"] = str(dest)
    payload["unmatched_rows"] = int(len(unmatched))
    payload["unmatched_path"] = unmatched_path
    return payload


@app.post("/api/clip")
def api_clip(body: ClipBody) -> dict[str, Any]:
    events = read_events(body.events_path)
    if "geometry" in getattr(events, "columns", []):
        events = pd.DataFrame(events.drop(columns="geometry"))
    else:
        events = pd.DataFrame(events)
    routes = read_events(body.routes_path)
    located = locate_events_on_routes(events, routes)
    dest = write_events(located, body.output_path)
    payload = _preview(located)
    payload["output_path"] = str(dest)
    payload["with_geometry"] = int(located.geometry.notna().sum()) if "geometry" in located.columns else 0
    return payload


@app.post("/api/export_geometry")
def api_export_geometry(body: ExportGeometryBody) -> dict[str, Any]:
    try:
        routes = read_events(body.routes_path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    events = None
    if body.events_path:
        events = _load_table(body.events_path)
    try:
        dest = export_lrs_geometry(
            routes,
            body.output_path,
            segment_id=body.segment_id,
            start_post=body.start_post,
            end_post=body.end_post,
            events=events,
            event_segment_id=body.event_segment_id or None,
            event_start_post=body.event_start_post or None,
            event_end_post=body.event_end_post or None,
            fmt=body.fmt,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    located = read_events(dest)
    payload = _preview(located)
    payload["output_path"] = str(dest)
    payload["with_geometry"] = (
        int(located.geometry.notna().sum()) if "geometry" in getattr(located, "columns", []) else 0
    )
    payload["format"] = dest.suffix.lstrip(".").lower()
    return payload


@app.post("/api/browse")
def api_browse(body: BrowseBody) -> dict[str, str | None]:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail=f"Native file dialog is unavailable: {exc}") from exc

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    try:
        if body.kind == "folder":
            path = filedialog.askdirectory()
        elif body.kind == "save":
            path = filedialog.asksaveasfilename(
                defaultextension=".csv",
                filetypes=[
                    ("CSV", "*.csv"),
                    ("GeoJSON", "*.geojson"),
                    ("Shapefile", "*.shp"),
                    ("GeoPackage", "*.gpkg"),
                    ("Excel", "*.xlsx"),
                    ("All", "*.*"),
                ],
            )
        else:
            path = filedialog.askopenfilename(
                filetypes=[
                    ("LRS files", "*.csv *.xlsx *.xls *.shp *.gpkg *.geojson"),
                    ("CSV", "*.csv"),
                    ("Excel", "*.xlsx *.xls"),
                    ("Shapefile", "*.shp"),
                    ("GeoJSON", "*.geojson"),
                    ("GeoPackage", "*.gpkg"),
                    ("All", "*.*"),
                ]
            )
    finally:
        root.destroy()
    return {"path": path or None}


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
