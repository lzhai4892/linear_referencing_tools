# Implementation plan

Follow-up to [lrs-industry-practice.md](lrs-industry-practice.md). Work in **`js-version/`** (supported app). Do not add features to `python-version/` unless a JS change needs a paired algorithm note.

Product boundary: event-table workbench on a **published** route+measure layer. Do not build network LRS (calibration, realign, concurrency, event behavior).

**Default vs Advanced tools.** Everyday work is roadway + BMP/EMP + LOCATION. Lateral offset / side and temporal from/to dates are **Advanced tools**: off by default, user enables them in the app. QC, field mapping, workers, and map preview stay on the default path — they are not advanced analysis types.

**UX order** (see [js-ux-review.md](js-ux-review.md)): Validate → Overlay → Dissolve → Locate → Display. Clip and Export are one Display tab. Extract / combine is a Prepare step. Shapefile download is blocked unless the table has line geometry. Do not reorder JS files to match tabs; overlay must keep loading after dissolve.

---

## Goals

1. Close the daily-shop gap: **QC before overlay**.
2. Make every tab usable on non-Florida column names.
3. Keep the page responsive on large event tables.
4. Add geometry products that analysts already expect (point-at-measure, then optional XY locate).
5. Keep files local; no upload service.
6. Keep offset and dates **off the main tabs** until the user turns on Advanced tools.

---

## Current vs target

| Capability | Today | Target |
|---|---|---|
| Overlay / dissolve / locate / clip / export | UI tabs | Keep; add field pickers |
| Extract / combine packed intersection routes | UI tab | Have — explode `id = mp\|id = mp`, clip, fold back |
| `validateLrs`, gaps, overlaps | `js/topology.js` only | **Validate** tab + downloads |
| Neighbors along route | JS only | Optional control on Validate or a small extra export |
| Field mapping | Export tab only | All tabs |
| Heavy compute | Main thread | Web Worker |
| Point event → XY | Missing | Clip/export sibling |
| XY → route + measure | Missing | Phase 4, only if crash/GPS is in scope |
| N-way overlay | Two tables | Phase 5 or chain overlays |
| Map preview | Table only | Phase 3 on Clip / Export / Validate |
| Lateral offset + side | Missing | Advanced tools only (Phase A) |
| Temporal from/to dates | Missing | Advanced tools only (Phase A) |

---

## Phase 0 — Document and aliases (small)

**Why.** Other states will fail auto-detect before any new tab helps.

**Work**

- Expand `ROADWAY_ALIASES` / `BMP_ALIASES` / `EMP_ALIASES` / `MEASURE_ALIASES` in `js-version/js/schema.js` (and keep Python in sync only if that folder stays). Candidates: `RTE_ID`, `ROUTE`, `ROUTE_ID`, `BEG_MP`, `END_MP`, `FROM_MP`, `TO_MP`, `MEAS`, `MEASURE`.
- Document the 8-character roadway pad as a Florida default in the UI hint (do not silently pad non-8 IDs if the user picks a different ID field later — see Phase 1).
- Add schema tests in `js-version/tests/run.cjs`.

**Done when**

- A table with `RTE_ID` / `BEG_MP` / `END_MP` auto-detects without throwing.
- Existing Florida alias tests still pass (`node tests\run.cjs`).

---

## Phase 1 — Validate tab (highest leverage)

**Why.** QC is the operation shops run before overlay. The functions already exist.

**UI** (`js-version/index.html` + `js-version/js/app.js`)

- New tab **Validate** as the **leftmost** tab (before Overlay). Rename later tabs: Overlay, Dissolve, Locate points, Display.
- Inputs: one event table; download names for each report.
- Optional: pick roadway / BMP / EMP after “Load fields” (same pattern as Export).
- Outputs (separate CSVs or one zip):
  - `invalid_bounds` — BMP ≥ EMP
  - `null_keys` — missing roadway or measures
  - `overlaps`
  - `gaps`
- Status line: counts + `ok` flag (`validateLrs().ok` ignores gaps today; show gap count anyway).
- Preview: summary table of the four counts, then the first failing rows.

**Optional in the same tab**

- Neighbors: value column picker → `neighborsAlongRoute` → download. Useful for AADT / pavement jumps. Can slip to Phase 1b if the tab gets crowded.

**Tests**

- Topology cases already belong in `tests/run.cjs`: inverted bounds, overlap, gap, null roadway.
- Add them if missing.

**Done when**

- User can load a messy event CSV, download four QC tables, and see counts without opening a console.
- `node tests\run.cjs` covers validate / gaps / overlaps.

---

## Phase 2 — Field mapping on every tab

**Why.** Auto-detect is FDOT-centric. Export already has the UI pattern.

**Work**

- Shared helper in `app.js`: load file → `LRS.LrsSchema.fromRows` → fill selects (roadway, BMP, EMP, measure).
- Wire Join / break, Merge, Locate, Clip, Validate to pass explicit `schema` / `targetSchema` / `overlaySchema` into existing functions.
- Locate needs a **measure** picker on the points file.
- Clip needs event + route field pickers (route schema can differ from event schema).
- Keep “auto” as the default option.

**Pad / ID width**

- Today `padRoadwayId` always zfill-8. Add an optional “Roadway ID width” (default 8) or “do not pad” checkbox so non-Florida IDs are not rewritten. Default stays Florida.

**Done when**

- Two files that use different column names (`ROADWAY` vs `RTE_ID`) overlay correctly after the user picks fields.
- Auto still works for current Florida samples.

---

## Phase 3 — Responsiveness and geometry preview

### 3a. Web Worker

**Why.** Overlay and dissolve on statewide tables freeze the UI.

**Work**

- New `js-version/js/worker.js` that imports the same LRS scripts (or a bundled worker entry).
- `app.js` posts `{ op, payload }` and receives `{ rows }` or `{ error }`.
- Keep a fallback to main-thread if the worker fails to start (`file://` can block workers depending on browser; the local `run_lrs_app.bat` server is the supported path).
- Status: “Running…” stays until the worker returns; disable the run button while busy.

**Done when**

- Overlay of a few tens of thousands of rows does not lock the tab chrome.
- Tests still run in Node (worker is UI-only).

### 3b. Map preview + CRS caption

**Why.** Clip / export / validate-on-geometry cannot be judged from 40 attribute rows.

**Work**

- Add a map pane (MapLibre GL or Leaflet) shown after Clip / Export (and Validate if geometry is present).
- Draw result lines; do not load a statewide basemap as GeoJSON.
- Caption: “Measures clipped by M values” vs “Measures interpolated by 2D length — project the routes if you need mile fidelity.”
- Optional: show QC gap/overlap segments if those rows carry geometry later. Not required in 3b.

**Done when**

- After Clip, the user sees lines on a map and a one-line CRS/method note.
- App still works with no network if the map library is vendored, or degrades to table-only if the script is missing.

**Vendor choice:** vendor a single Leaflet or MapLibre build under `js-version/vendor/` so the tool stays offline.

---

## Phase 4 — Point geometry, then XY locate

### 4a. Point-at-measure (route + LOCATION → XY)

**Why.** Clip already cuts *lines*. Point inventories need a point on the route.

**Work**

- New `locatePointsOnRoutes(points, routes, schemas)` in `js/geometry.js` (mirror clip: use M if present, else length interpolation).
- UI: either a mode on Locate (“table join” vs “place on route geometry”) or a checkbox on Clip.
- Output GeoJSON / shapefile zip of points; unmatched download stays.

**Done when**

- A point table with `ROADWAY` + `LOCATION` and a measured (or BMP/EMP) route layer downloads point geometry.
- Tests cover M-value and length-interpolation paths, including measure outside the route.

### 4b. XY → route + measure (only if crash/GPS is in scope)

**Why.** Highest-value missing industry op; also the hardest.

**Work (if approved)**

- Nearest-route search in a **projected** CRS. Do not use raw WGS84 degrees as “feet.”
- Inputs: points with X/Y or lon/lat + CRS; routes; optional search radius; optional roadway filter.
- Outputs: `ROADWAY`, `LOCATION`, offset, side, distance-to-route; unmatched points.
- This may need a small projection helper (or require the user to supply projected shapefiles). Document the requirement in the tab.

**Done when**

- A known test point on a straight projected route returns the expected measure within tolerance.
- Geographic-only inputs show a clear error, not a silent wrong milepost.

**If crash/GPS is not in scope, stop after 4a.**

---

## Phase 5 — N-way overlay (optional)

**Why.** HPMS-style homogeneous sections stack many event layers.

**Work**

- UI: add more overlay files, or a “chain” list (target + overlay1 + overlay2…).
- Implementation: fold `overlayEvents` left-to-right; then optional dissolve on chosen group columns.
- Download the fully broken table.

**Done when**

- Three line tables produce one sectioned table whose breaks are the union of all BMP/EMP cuts.
- Tests cover a three-layer stack with a gap in the middle layer.

**Alternative:** document “run overlay twice” in the README and skip this phase.

---

## Phase A — Advanced tools (opt-in; do not schedule before 1–3)

Most users never need these. Do not put offset or date pickers on the default tabs.

### A0. Settings shell (small, can ship with Phase 2)

**Work**

- Header or a **Settings** strip: checkbox **Enable Advanced tools**.
- Default **off**. Persist in `localStorage` (`lrs.advancedTools`).
- When off: no offset, side, or date fields anywhere; overlay/dissolve/locate/QC ignore those columns even if they exist in the file.
- When on: extra field pickers appear on Join, Merge, Locate, Clip, Validate, Export (offset, side, from date, to date — each optional).
- Short hint: “For off-centerline assets and dated event history. Leave off for normal RCI tables.”

**Done when**

- Refresh keeps the toggle.
- With the toggle off, a file that happens to have `OFFSET` / `FROM_DATE` columns behaves exactly as today.

### A1. Lateral offset + side (only after someone needs it)

**When.** Signs, utilities, guardrail, or crashes stored as measure + offset + L/R.

**Work**

- Schema aliases: `OFFSET`, `LATERAL_OFFSET`, `SIDE`, `DIR`, `LRS_SIDE`.
- Overlay / dissolve / locate key includes roadway + measure **and** side (and optionally offset bucket) when those fields are mapped.
- QC: do not flag two same-measure events as overlaps if they are on opposite sides.
- Clip / point-at-measure: keep attributes; drawing a true cartographic offset is optional and later.

**Done when**

- With Advanced off, results match the no-offset tests.
- With Advanced on and side mapped, left and right events on the same milepost do not dissolve into one row and do not count as an overlap.

### A2. Temporal from/to dates (only after someone needs it)

**When.** Historical AADT or pavement with effective dates — not a full LRS version store.

**Work**

- Schema aliases: `FROM_DATE`, `TO_DATE`, `EFF_FROM`, `EFF_TO`, `BEGIN_DATE`, `END_DATE`.
- Optional **As-of date** on overlay / locate / dissolve / QC: keep rows where `from <= as-of < to` (null `to` = still open).
- Overlay of two dated tables: break on milepost **and** on date overlap only when both sides have dates mapped.
- QC gaps/overlaps are evaluated within the as-of slice, not across all years at once.

**Done when**

- Default path (Advanced off, or dates unmapped) is unchanged.
- Two years of the same roadway do not look like milepost overlaps when Advanced is on and an as-of date is set.

Do **not** build temporal event *behavior* after route realignment. That stays out of scope.

---

## Later (do not schedule until Phases 1–3 land)

| Item | Note |
|---|---|
| `.xlsx` via SheetJS | Vendored; keep CSV as the default |
| File System Access API | Repeat jobs; fallback to `<input type="file">` |
| Persist last field maps | `localStorage` keyed by column-name fingerprint |
| Roadway pad width setting | If Phase 2 checkbox is not enough |
| Advanced tools A0–A2 | Offset/dates — see Phase A; A0 shell only when A1 or A2 starts |

---

## Out of scope

Do not implement:

- Route create / split / merge / realign / retire
- Calibration points and station equations
- Concurrent-route dominance
- Event translation after remeasure (Esri event behavior)
- Temporal versioning as a system of record (Advanced tools may filter as-of dates only)
- Public website, uploads, or accounts
- GeoPackage write in the browser
- Polygon LRS events
- Showing offset or date pickers when Advanced tools is off

---

## Suggested order and effort

| Phase | Effort | Depends on |
|---|---|---|
| 0 Aliases | Small | — |
| 1 Validate tab | Small | 0 helpful, not required |
| 2 Field mapping | Medium | 0 |
| 3a Worker | Medium | 1–2 can ship first |
| 3b Map + CRS note | Medium | Clip/export already exist |
| 4a Point-at-measure | Medium | 2, 3b useful |
| 4b XY locate | Large | 4a, projected data policy |
| 5 N-way overlay | Small–medium | 2 |
| A0 Advanced toggle | Small | 2 (field pickers exist) |
| A1 Offset + side | Medium | A0 |
| A2 Temporal as-of | Medium | A0 |

Ship **0 → 1 → 2** as the first release. That closes industry QC and non-Florida schemas without new analysis types. Leave Advanced tools off until a real inventory needs offset or dates.

---

## Test and verify

After each phase:

```bat
cd js-version
node tests\run.cjs
```

Manual checks in Chrome or Edge via `run_lrs_app.bat` (not only `file://` once the worker exists):

1. Florida RCI-style CSV still overlays and dissolves.
2. A file with inverted BMP/EMP and a gap shows both on Validate.
3. Clip a short event onto a measured route; inspect geometry on the map (Phase 3b).
4. Locate unmatched points still download.

Update `js-version/README.md` operations table when a tab is added.

---

## File touch list (Phases 0–2)

| File | Change |
|---|---|
| `js-version/js/schema.js` | More aliases; optional pad width |
| `js-version/js/topology.js` | No API change expected |
| `js-version/js/app.js` | Validate runner; shared field-loader; pass schemas |
| `js-version/index.html` | Validate first; rename Overlay / Dissolve / Display; field rows |
| `js-version/styles.css` | Only if the new tab needs layout |
| `js-version/tests/run.cjs` | Schema aliases + validate cases |
| `js-version/README.md` | Document Validate and field picks |
