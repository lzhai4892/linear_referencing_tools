# JS app review: module order and UX

Review of `js-version/` against a typical published-LRS analyst job (FDOT RCI-style event tables). 2026-08-25.

## 1. Are the JS modules in a logical sequence?

**For code loading: yes. For the analyst job: no — and they should not have to match.**

Scripts in `index.html` (and `tests/run.cjs`) load as:

```
table.js → schema.js → dissolve.js → overlay.js → locate.js → topology.js → geometry.js → io.js → app.js
```

Node `require` graph:

| Module | Requires | Role |
|---|---|---|
| `table.js` | — | Row helpers (clone, sort, group) |
| `schema.js` | `table.js` | Aliases, pad roadway, `LrsSchema` |
| `dissolve.js` | `schema.js` | Merge + `collapseLongest` |
| `overlay.js` | `dissolve.js` | Break/join (uses collapse) |
| `locate.js` | `schema.js` | Point-on-line table locate |
| `topology.js` | `schema.js` | QC (unused in the UI) |
| `geometry.js` | `dissolve.js` | Clip / export |
| `io.js` | `schema.js` | Read/write files |
| `app.js` | all of the above | Tabs and downloads |

That order is **safe**: each file only uses what was already attached to `LRS`. Overlay after dissolve is required because overlay calls `collapseLongest`. Do not shuffle scripts to match tab names or you will break `file://` and Node tests.

What is *not* layered cleanly:

- **`io.js` is last among libraries.** It is infrastructure, not an analysis step. It only needs `schema.js`. Put it after schema if you ever tidy the list.
- **`topology.js` sits after locate** and is never called from `app.js`. QC belongs first in the *job*, not last in the script list.
- **`dissolve.js` before `overlay.js`** is a code dependency, not a workflow order. Analysts overlay first, then dissolve.

Suggested script list (same graph, clearer layers). Optional cleanup, not a functional fix:

```
table.js → schema.js → io.js → topology.js → locate.js → dissolve.js → overlay.js → geometry.js → app.js
```

Keep one global `LRS` object. A bundler is unnecessary until a Web Worker needs a single worker entry.

---

## 2. Does the UX match a typical LR workflow?

**Partly.** Overlay → dissolve → draw geometry is the right *core* sequence. The app is missing the first step (QC / field map), splits the last step into two overlapping tabs, and treats locate as a middle step of one pipeline.

### Typical job (published LRS, event tables)

1. Load files and **name the LRS columns**.
2. **Validate** — inverted BMP/EMP, null keys, overlaps, gaps.
3. **Overlay** — break two line tables at mileposts.
4. **Dissolve** — merge adjacent rows that share attributes.
5. **Locate points** — optional side path (crashes, signs onto sections).
6. **Display** — clip events onto the route+measure layer and download GIS.

Esri and most DOT shops use the same story: identify fields → QC events → dynamic segmentation → concatenate → locate/display.

### What the tabs do today

| Tab order | Matches the job? |
|---|---|
| Extract / combine | Optional Prepare step. Detect packed `id = mp\|id = mp` on load; extract only if BMP/EMP are missing or the user wants one row per approach. Then Display, then Combine. |
| 1. Join / break | Right *operation*, wrong *first* screen. No field pickers. |
| 2. Merge connected | Right place after overlay. Isolated: must re-upload the overlay CSV. |
| 3. Locate points | Valid tool, wrong implication that it sits between dissolve and clip. |
| 4. Clip to routes | Same job as Export, but auto-detect only. |
| 5. Export geometry | Same job as Clip, with field pickers. |

### Gaps that break the usual flow

1. **No Validate tab** — shops QC before they break tables. The functions already exist in `topology.js`.
2. **Field mapping only on Export** — every other tab hopes Florida aliases are present.
3. **Clip and Export are one operation** — both call `locateEventsOnRoutes` / `exportLrsGeometry`. Users will not know which to open.
4. **No “use last result”** — overlay downloads a file; dissolve cannot see it. A real job is a chain, not five separate uploads.
5. **Locate is a branch, not step 3** — points vs lines. Fine as its own tab; do not park it between merge and map.
6. **Labels are developer words** — “Join / break”, `left` / `inner`, `longest` collapse. Analysts say overlay, dissolve, locate, display.
7. **Group columns as a typed list** — easy to typo. After “Load fields”, checkboxes are safer.
8. **Preview is attributes only** — after Clip/Export you cannot see whether M-clip or length interpolation ran.

What already matches practice: left overlay keeps target gaps; dissolve defaults to milepost adjacency; clip prefers M values; files stay local.

---

## 3. How to improve

Do this in the UI. Leave script order alone unless you do the optional layer tidy above.

### Tab order (default tools)

| New order | Tab name | Why |
|---|---|---|
| 1 | **Validate** | Always first. Wire `validateLrs`. |
| 2 | **Overlay** | Rename “Join / break”. Field pickers on both inputs. |
| 3 | **Dissolve** | Rename “Merge connected”. Offer “Use last overlay result”. |
| 4 | **Locate points** | Keep as a side tool, after the line-event pair. |
| 5 | **Display** | Merge Clip + Export into one tab: routes + optional events + field picks + format. |

Advanced tools (offset, dates) stay hidden until the user enables them. See [implementation-plan.md](implementation-plan.md) Phase A.

### UX changes that match the job

1. **Field pickers on every tab** after the file is chosen (same pattern as Export). Auto-detect remains the default selection.
2. **Session result** — keep the last output rows in memory. Buttons: “Send to Dissolve”, “Send to Display”, “Send to Validate”. Avoids download-and-reupload for a three-step job.
3. **One Display tab** — source LRS geometry required; event table optional; format GeoJSON or shapefile zip. Retire the Clip tab or make it a one-line shortcut that jumps to Display with events filled.
4. **Rename controls** — Join `left` → “Keep target gaps”; `inner` → “Matches only”; collapse `longest` → “Keep attributes from the longest overlay slice”.
5. **Group columns** — multi-select from loaded field names, not only a comma box.
6. **Locate unmatched** — always offer the unmatched download (pre-filled name), not a blank optional field. Unmatched *is* the QC for that step.
7. **Status that names the step** — “Overlay: 1,204 slices. 18 target gaps kept.” so the preview matches the job language.

### Do not change

- Five isolated file pickers as the *fallback* (users still bring files from ArcGIS).
- Florida 8-character pad as the default.
- Loading dissolve before overlay in the script tags (code dependency).
- Putting offset/date pickers on these tabs by default.

---

## Suggested first UI patch

1. Add Validate as the leftmost tab (Phase 1 in the plan).
2. Rename tabs: Overlay, Dissolve, Locate points, Display.
3. Fold Clip into Display (keep Clip as an alias heading if people already know the name).
4. Add “Use last result” from Overlay → Dissolve → Display.

Field pickers on Overlay/Dissolve/Locate can land with Phase 2.
