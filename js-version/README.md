# Linear Referencing Toolset

**Version 1.0.** Browser-only tool for linear-referencing event tables (route ID + begin/end milepost). Nothing is uploaded; files stay on this computer.

Typical keys: 8-character roadway ID, `BEGIN_POST` / `BMP`, `END_POST` / `EMP`, and point measure `LOCATION`. Column names from other agencies (Esri, Georgia, NCDOT, generic `RTE_ID`) are auto-detected or applied from **Column layout**.

## Open the app

From this folder, double-click `run_lrs_app.bat`. That starts `http://127.0.0.1:8765` when Python is available.

You can also open `index.html` directly in Chrome or Edge, or run:

```bat
python -m http.server 8765
```

Then open `http://127.0.0.1:8765/`.

## Workflow

| Step | Tab | What it does |
|---|---|---|
| 1 | Validate | QC inverted mileposts, null keys, overlaps, gaps, and zero-length rows. Export QC issues and/or the table. |
| 2 | Overlay | Dynamic-segment a target table against an overlay on route ID + BMP/EMP. Overlapping overlays keep both rows. |
| 3 | Dissolve | Merge adjacent rows that share group attributes. |
| 4 | Locate | Keep point rows whose measure falls on a matching line event. Unmatched points export separately. |
| 5 | Display | Clip events onto route geometry and draw them on the map. |

**Optional tools** (not on the numbered path):

- **Create LRS** — fill missing route IDs, 0–length mileposts, and vertex M from drawn length. Temporary LRS, not a published milepost system.
- **Extract / combine** — unpack packed approach fields (`id = milepost|…`) into one row per approach, then combine them back.

Each step can reuse the last session result so you do not reload the file. The run log is timestamped to the second. The review table shows a sample; click a row with geometry to zoom the map.

Skip Extract when the table already has Route ID / BMP / EMP. Use it when a packed approach field is all you have (for example LPI files). Combine only after Extract.

## Standard vs Advanced

**Standard** is route ID + mileposts only.

**Advanced** adds optional offset, side, from/to date, and as-of date. Left/right and different years are QC’d and overlaid separately when those fields are mapped.

## Route ID pad

One setting, shown under every Route ID mapping. Numeric IDs can pad to a fixed width (`100` → `00000100`). Text IDs such as `I-95` stay unchanged.

Padding rewrites Route IDs in the session. Use **Export table** (Validate) or the step export to save the padded file. Matching still uses a padded merge key.

## Map

MapLibre draws routes and events after Display, Create LRS, or a file with line (or point) geometry. Coordinates in UTM / State Plane are projected to WGS84. Input vertices are not simplified.

- **Basemap:** OpenMaps (default), Streets, or Esri World Imagery satellite.
- **Zoom to data** fits the map to loaded routes and events.
- **Layers** — show/hide routes and events; set color and width. Locate dots use color and point size.
- **Color events by** — optional thematic color from an attribute column (not the same as the solid Layers color).
- Click a line or point to identify it and select that layer for styling.

## Formats

- **Event tables:** CSV, Excel (`.xlsx`), GeoJSON, or a zipped shapefile (`.shp` + `.dbf` / `.prj` / `.shx` in one zip, or those sidecars selected together).
- **Route / Display source:** GeoJSON or zipped shapefile with line geometry.
- **Shapefile download:** after Display (or Combine of displayed geometry). Overlay, dissolve, and locate write attributes only unless Display has already attached lines.

## Tests

From this folder:

```bat
node tests\run.cjs
```
