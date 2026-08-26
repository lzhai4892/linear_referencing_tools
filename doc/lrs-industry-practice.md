# Linear referencing: industry practice vs this toolkit

Internal note. Compared against ISO 19148 (2021), FGDC Transportation Base, FDOT RCI-style event tables, FHWA HPMS sectioning, and Esri Roads and Highways / Location Referencing.

This product is an **event-table analyst toolkit**, not a full network LRS. The JavaScript app in `js-version/` is the supported copy. Python in `python-version/` is optional reference.

Reviewed 2026-08-25. Product split (default vs Advanced tools) recorded 2026-08-25.

## Verdict

Line and point events are the two industry event geometries. This toolkit is **not** missing a third type such as polygons.

**Default app:** roadway + BMP/EMP (lines) and LOCATION (points). That matches everyday RCI / consultant work.

**Advanced tools (opt-in):** lateral offset + side, and temporal from/to dates. Most users never need these. Keep them off until the user enables Advanced tools in the app. Do not put them on the main tabs by default.

The usual *everyone* gaps are still two operations: event QC and (later) XY ↔ route/measure — those stay in the default product, not behind Advanced.

---

## 1. Analysis types

ISO 19148 and the FGDC Transportation Base define two event geometries. A position expression is: linear element (route) + measure along it + optional lateral/vertical offset.

| Type | Position | Typical DOT layers | This toolkit |
|---|---|---|---|
| **Line (from–to)** | roadway + BMP + EMP | pavement, AADT, lanes, speed, functional class, projects | Covered: overlay, dissolve, clip, export |
| **Point (at-measure)** | roadway + LOCATION | crashes, signs, bridges, rail crossings, intersections | Covered as a table join: `LOCATION` in `[BMP, EMP]` |

Those two cover almost all transportation event tables.

### Not a third geometry

**Do not add polygon events.** Maintenance districts, cities, and urban boundaries are spatial overlays, not LRS events.

FGDC also splits **attribute events** (a value along the route) from **feature events** (another GIS feature hung on the route). The tables in this tool are attribute events. Clip and export are the feature-event step: hang those attributes on route geometry.

### Default vs Advanced tools

Most inventories in this shop are milepost-only. Offset and dates add columns, extra pickers, and different overlay/QC rules. Putting them on every tab would slow the common path.

| Layer | What the user sees | When to use |
|---|---|---|
| **Default (always on)** | Roadway, BMP/EMP, LOCATION. Overlay, dissolve, locate, clip, export, and (planned) Validate. | Everyday event tables |
| **Advanced tools (user enables)** | Extra field pickers: offset, side (L/R), from date, to date. Overlay / dissolve / locate / QC then honor those fields. | Signs/utilities off centerline; historical AADT or pavement with effective dates |
| **Out of scope** | Referent+distance, lane/direction, concurrency, calibration | Convert upstream, or use the DOT system of record |

Rules for the toggle:

- Default **off**. Persist the choice in `localStorage` so it survives a refresh.
- Enabling Advanced tools only *reveals* extra fields. It must not change results for tables that have no offset or date columns.
- Algorithms stay unused until someone maps those fields. Do not ship offset/date logic in the first release — ship the setting shell when the first advanced algorithm lands.
- QC, field mapping, workers, and map preview stay default. Those are not “advanced analysis types.”

| Dimension | Industry role | Placement |
|---|---|---|
| Lateral offset + side (L/R) | ISO 19148 offset: signs, off-center crashes, guardrail, utilities | Advanced tools |
| Temporal (from/to dates) | Same mileposts, different years; as-of overlay | Advanced tools |
| Referent + distance | “0.3 mi east of Main St” | Out of scope — convert to milepoint first |
| Lane / increasing vs decreasing | HPMS, pavement on divided roads | Out of scope unless a later Advanced item |
| Concurrency / dominance | Same pavement, several route IDs | Do not build |
| Calibration / station equations | LRS network infrastructure | Do not build |

**Typical DOT layers that stay in default point/line**

- Line: functional class, lanes, pavement, AADT, speed, urban/rural, projects.
- Point: crashes, bridges (NBI), signs, rail crossings, intersections (on-centerline measure only).

---

## 2. Current toolset

Florida RCI assumptions: 8-character roadway ID; `BEGIN_POST` / `BMP`; `END_POST` / `EMP`; point measure `LOCATION`.

| Tab / function | What it does | Industry name |
|---|---|---|
| Join / break (`overlayEvents`) | Overlay two line tables and break at milepost overlaps; left or inner; optional longest-slice collapse | Dynamic segmentation / overlay |
| Merge connected (`dissolveContiguous`) | Merge rows that share attributes and (by default) connect at BMP/EMP (`tolerance=1e-4`) | Dissolve / concatenate |
| Locate points (`locatePoints`) | Keep points whose measure falls in `[BMP, EMP]` on the same roadway | Point-on-line event locate |
| Clip to routes (`locateEventsOnRoutes`) | Cut route geometry to each event BMP–EMP (M values if present, otherwise length interpolation) | Event → geometry |
| Export geometry (`exportLrsGeometry`) | User-selected segment ID / BMP / EMP on a source LRS layer; optional event clip; GeoJSON or shapefile zip | Dynamic segmentation display |

**Already coded, not in the HTML app**

| Function | File | Purpose |
|---|---|---|
| `validateLrs` | `js-version/js/topology.js` | Inverted BMP ≥ EMP, null keys, overlaps, gaps |
| `findGaps` / `findOverlaps` | same | Coverage QC |
| `neighborsAlongRoute` | same | Upstream/downstream value check (AADT, pavement jumps) |

Python `lrs_tools` exposes the same QC helpers. The HTML tabs do not call them.

---

## 3. Are these functions enough?

**Yes** for “two event tables in, broken/merged table or clipped geometry out.” That is the daily consultant / RCI workflow.

**Not enough** if users also bring crash GPS, need a QC report before overlay, or must section five HPMS layers at once.

| Operation | Where it lives | Gap |
|---|---|---|
| Join / break at mileposts | UI + JS + Python | Core — have |
| Merge connected rows | UI + JS + Python | Core — have |
| Locate points on events | UI + JS + Python | Table join only, not XY |
| Clip events to routes | UI + JS + Python | Core — have |
| Export reconciled geometry | UI + JS + Python | Core — have |
| Validate gaps / overlaps / inverted measures | JS + Python only | Expose as a tab first |
| Neighbors along route | JS + Python only | Useful for AADT / pavement jumps |
| Longest-slice collapse | Overlay option | Have; document when to use |
| XY → route + measure | Missing | Highest missing op for crashes and GPS |
| Point-at-measure geometry | Missing | Route + LOCATION → XY |
| N-way overlay | Missing (2 tables only) | HPMS homogeneous sections; chain overlays or add a batch tab |
| Event translation after remeasure | Missing | Esri event behavior — skip |
| Route split / realign / calibrate | Missing | Network edit — do not build |

**Do not chase a full LRS.** Concurrent routes, station equations, redlines, and a temporal *system of record* belong in Esri Location Referencing, AgileAssets, or the DOT database. This app may later overlay two dated event tables when Advanced tools is on; that is not versioned LRS.

---

## 4. JS / HTML recommendations

A local browser port is the right shape: files stay on the machine, shapefile + CSV in, CSV / GeoJSON out. Treat the browser as the workbench and keep Python (optional) as the batch/GIS engine.

### Ship next

1. **QC tab** calling `validateLrs` — already in JS.
2. **Explicit field mapping on every tab**, not only Export. Aliases are Florida-centric; other states send `RTE_ID`, `BEG_MP`, `MEAS`.
3. **Web Worker** for overlay / dissolve so a statewide table does not freeze the page.
4. **Map preview** (MapLibre or Leaflet) on Clip / Export. A 40-row table cannot catch bad M interpolation.
5. **CRS + units caption** — length-based clip is wrong if the shapefile is geographic and users think in miles.

### Nice later

- `.xlsx` via SheetJS (README already says save as CSV).
- File System Access API and persist last field-map choices.
- Point-at-measure geometry, then XY locate if crash/GPS files are in scope.
- Optional N-way overlay for HPMS-style stacks.

### Keep

- Local-only files, sidecar shapefile zip, auto-detect plus override.
- CSV / GeoJSON / shapefile out.
- Same function names as Python so tests can stay paired.

### Avoid

- A public website or server-side uploads.
- Rebuilding route calibration.
- Loading a full-state basemap as GeoJSON on the main thread.

---

## Sources

- ISO 19148:2021 — Geographic information — Linear referencing (point / from–to locations; optional offset; referents).
- FGDC Framework Data Standard, Part 7 — Transportation Base (attribute vs feature events; point vs linear; optional lateral offset).
- FDOT RCI field conventions used in this repo (`ROADWAY`, `BEGIN_POST`, `END_POST`, `LOCATION`).
- FHWA HPMS — homogeneous sections from multiple event layers.
- Esri Roads and Highways / Location Referencing — full network LRS (out of product scope).
