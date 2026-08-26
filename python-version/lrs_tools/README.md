# Internal LRS Toolkit

Firm-internal library for linear-referencing **event tables** (roadway ID + begin/end milepost). It is not an FDOT product and is not deployed on the public web.

Typical Florida RCI fields: 8-character roadway ID, `BEGIN_POST` / `BMP`, `END_POST` / `EMP`, and point measure `LOCATION`.

## Install / import

From this repo root (or copy `lrs_tools/` into another firm project):

```python
from lrs_tools import (
    LrsSchema,
    overlay_events,
    dissolve_contiguous,
    locate_points,
    locate_events_on_routes,
    export_lrs_geometry,
    validate_lrs,
)
```

## Operations

| Function | What it does |
|---|---|
| `pad_roadway_id` | Strip, drop float `.0`, zero-pad to 8 characters |
| `LrsSchema.from_dataframe` | Detect `ROADWAY` / `BMP` / `EMP` / `LOCATION` aliases |
| `overlay_events` | Join two line event tables and break at milepost overlaps; optional `collapse="longest"` |
| `dissolve_contiguous` | Merge rows that share attributes and (by default) connect at BMP/EMP (`tolerance=1e-4`) |
| `locate_points` | Keep points whose measure falls in `[BMP, EMP]` on the same roadway |
| `locate_events_on_routes` | Clip route geometry to each event BMP–EMP (M values if present, otherwise length interpolation) |
| `export_lrs_geometry` | User-selected segment ID / BMP / EMP on a source LRS layer; write Shapefile or GeoJSON (optionally clip an event table first) |
| `validate_lrs` / `find_gaps` / `find_overlaps` | QC inverted bounds, overlaps, and coverage gaps |

`dissolve_contiguous(..., require_contiguous=False)` merges identical-attribute runs after sort even if a milepost gap sits between them (legacy Step 4 pre-dissolve).

## Local app (no website)

```bash
uv sync
uv run python -m lrs_app
```

On Windows you can also double-click `run_lrs_app.bat`. Opens `http://127.0.0.1:8765` in the default browser. The server binds to localhost only. Use `--no-browser` if you will open the URL yourself. Paths are local filesystem paths (shapefile sidecars); Browse uses a native dialog when a desktop is available.

The **Export geometry** tab asks for a source LRS line layer, then lets you pick the segment ID, start post, and end post fields before writing `.shp` or `.geojson`. An event table is optional; when provided, those segments are clipped onto the source geometry.

## Tests

```bash
python -m pytest tests
```

See `examples/lrs_cookbook.py` for a short end-to-end script.
