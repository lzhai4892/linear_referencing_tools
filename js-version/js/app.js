(function () {
  const logEl = document.getElementById("log");
  const previewWrap = document.getElementById("preview-wrap");
  const previewMeta = document.getElementById("preview-meta");
  const previewTable = document.getElementById("preview");
  const sessionMeta = document.getElementById("session-meta");
  const loadNotice = document.getElementById("load-notice");
  const extractHint = document.getElementById("exn-hint");
  const panelInfo = document.getElementById("panel-info");
  const cache = {};
  const session = { last: null, extracted: null, display: null, calibrated: null, crs: null };
  const exports = {};

  const TABLE_EXT = [".csv", ".txt", ".xlsx", ".geojson", ".json", ".zip", ".shp", ".dbf", ".prj", ".shx"];
  const GEOM_EXT = [".geojson", ".json", ".zip", ".shp", ".dbf", ".prj", ".shx"];

  function splitCols(value) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  function extOf(name) {
    const lower = (name || "").toLowerCase();
    const idx = lower.lastIndexOf(".");
    return idx >= 0 ? lower.slice(idx) : "";
  }

  function assertAccept(files, allowed, label) {
    for (const file of files) {
      const ext = extOf(file.name);
      if (!allowed.includes(ext)) {
        throw new Error(
          `${label}: ${file.name} is not allowed. Use ${allowed.filter((item) => item !== ".dbf" && item !== ".prj" && item !== ".shx").join(", ")}.`
        );
      }
    }
  }

  function clearLog() {
    logEl.innerHTML = "";
  }

  const logClear = document.getElementById("log-clear");
  if (logClear) logClear.addEventListener("click", () => clearLog());

  function formatLogTime(when) {
    return when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  function addLog(entry) {
    const item = document.createElement("li");
    item.className = entry.level || "info";
    const when = new Date();
    const time = document.createElement("time");
    time.className = "log-time";
    time.dateTime = when.toISOString();
    time.textContent = formatLogTime(when);
    item.append(time, " ", entry.text);
    if (entry.sample) {
      const sample = document.createElement("span");
      sample.className = "sample";
      sample.textContent = entry.sample;
      item.appendChild(sample);
    }
    logEl.appendChild(item);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function writeLogs(lines) {
    (lines || []).forEach(addLog);
  }

  function previewValue(value) {
    if (value == null) return "";
    if (value && typeof value === "object") return value.type || "object";
    return value;
  }

  function renderPreview(rows, meta) {
    previewWrap.hidden = !rows.length;
    const cap = 200;
    const shown = rows.slice(0, cap);
    previewMeta.textContent = meta || (
      rows.length > cap
        ? `${rows.length} row(s), showing first ${cap}. Drag the top edge to resize.`
        : `${rows.length} row(s). Drag the top edge to resize. Click a row with geometry to zoom the map.`
    );
    const cols = LRS.previewColumns(rows);
    previewTable.innerHTML = "";
    const head = document.createElement("tr");
    cols.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col;
      head.appendChild(th);
    });
    previewTable.appendChild(head);
    shown.forEach((row, index) => {
      const tr = document.createElement("tr");
      cols.forEach((col) => {
        const td = document.createElement("td");
        td.textContent = previewValue(row[col]);
        tr.appendChild(td);
      });
      if (row.geometry && LRS.isLineGeom(row.geometry)) {
        tr.classList.add("preview-row-map");
        tr.title = "Show on map";
        tr.addEventListener("click", () => {
          if (window.LRSMap) LRSMap.focusRow(index);
        });
      }
      previewTable.appendChild(tr);
    });
    if (window.LRSMap) LRSMap.resize();
  }

  const SESSION_HINTS = {
    "ov-target": {
      empty: "No session yet. Run Validate first, or choose a target file here.",
      ready: (label, n) =>
        label === "Validate"
          ? `No file chosen — uses session from Validate (${n} rows, original measures, not cleaned). Pick a file to replace it.`
          : `No file chosen — uses session from ${label} (${n} rows). Pick a file to replace it.`,
    },
    "ds-input": {
      empty: "No session yet. Run Overlay or Validate first, or choose a file here.",
      ready: (label, n) => `No file chosen — dissolves session from ${label} (${n} rows). Pick a file to replace it.`,
    },
    "lc-events": {
      empty: "No session yet. Run Overlay or Dissolve first, or choose line events here.",
      ready: (label, n) => `No file chosen — locates on session from ${label} (${n} rows). Pick a file to replace it.`,
    },
    "dp-routes": {
      empty: "No calibrated routes yet. Choose a route layer, or run Create LRS first if the file has no IDs or measures.",
      ready: (label, n) =>
        label === "Create LRS"
          ? `No file chosen — uses calibrated routes from Create LRS (${n} rows). Pick a file to replace it.`
          : `No file chosen — uses session geometry from ${label} (${n} rows) if it has lines. Pick a file to replace it.`,
    },
    "dp-events": {
      empty: "No session yet. Run Overlay or Dissolve first, or choose events here. Routes-only is fine.",
      ready: (label, n) => `No file chosen — clips session from ${label} (${n} rows). Pick a file to replace it.`,
    },
    "cb-input": {
      empty: "No session yet. Run Extract or Display first, or choose extracted rows here.",
      ready: (label, n) => `No file chosen — combines session from ${label} (${n} rows). Pick a file to replace it.`,
    },
  };

  function updateSessionBanner() {
    if (!session.last) {
      sessionMeta.textContent = "No session table yet. Run a step, then leave the next file input empty to reuse that result.";
    } else if (session.last.label === "Validate") {
      sessionMeta.textContent = `Session from Validate: ${session.last.rows.length.toLocaleString()} original rows. QC listed issues but did not rewrite mileposts. Overlay will use these measures as-is.`;
    } else if (session.last.label === "Create LRS") {
      sessionMeta.textContent = `Session from Create LRS: ${session.last.rows.length.toLocaleString()} calibrated route(s). Display can reuse these. Generated measures follow line length, not a published milepost system.`;
    } else {
      sessionMeta.textContent = `Session from ${session.last.label}: ${session.last.rows.length.toLocaleString()} rows. Leave the next file input empty to reuse it.`;
    }
    document.querySelectorAll("[data-session-input]").forEach((el) => {
      const spec = SESSION_HINTS[el.dataset.sessionInput];
      if (!spec) return;
      const input = document.getElementById(el.dataset.sessionInput);
      const hasFile = input && input.files && input.files.length;
      if (hasFile) {
        el.textContent = `Using ${input.files[0].name}. Clear the file input to fall back to session.`;
        el.classList.remove("is-ready");
        return;
      }
      if (session.last) {
        el.textContent = spec.ready(session.last.label, session.last.rows.length.toLocaleString());
        el.classList.add("is-ready");
      } else {
        el.textContent = spec.empty;
        el.classList.remove("is-ready");
      }
    });
  }

  function setSession(rows, label) {
    session.last = { rows, label };
    updateSessionBanner();
  }

  function stashExport(key, rows, filename, fmt) {
    exports[key] = { rows, filename, fmt };
    document.querySelectorAll(`[data-export="${key}"]`).forEach((btn) => {
      btn.disabled = false;
      btn.textContent = `Export ${filenameFor(filename, fmt)}`;
    });
  }

  function clearExports(keys) {
    keys.forEach((key) => {
      delete exports[key];
      document.querySelectorAll(`[data-export="${key}"]`).forEach((btn) => {
        btn.disabled = true;
        btn.textContent = btn.dataset.exportLabel || "Export";
      });
    });
  }

  function downloadBytes(filename, bytes, type) {
    const blob = new Blob([bytes], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadText(filename, text, type) {
    downloadBytes(filename, new TextEncoder().encode(text), type);
  }

  function filenameFor(base, fmt) {
    const stem = (base || "lrs_output").replace(/\.(csv|txt|geojson|json|zip|shp|gpkg)$/i, "");
    if (fmt === "csv") return `${stem}.csv`;
    if (fmt === "shp") return `${stem}.zip`;
    return `${stem}.geojson`;
  }

  function writeOutput(rows, filename, options = {}) {
    const fmt = options.fmt || (extOf(filename) === ".zip" || extOf(filename) === ".shp" ? "shp" : extOf(filename) === ".geojson" || extOf(filename) === ".json" ? "geojson" : "csv");
    const name = filenameFor(filename, fmt);
    if (fmt === "shp") {
      if (!LRS.rowsHaveLineGeometry(rows)) {
        throw new Error(
          "Shapefile needs line geometry. Export CSV or GeoJSON, or run Display on a route layer first."
        );
      }
      downloadBytes(name, LRS.shapefileZip(rows, name), "application/zip");
      return name;
    }
    if (fmt === "geojson") {
      const geom = LRS.countLineGeometry(rows);
      if (!geom) {
        addLog({ level: "warn", text: "GeoJSON has no line geometry. Run Display if you need shapes on the map." });
      }
      downloadText(name, JSON.stringify(LRS.toGeoJson(rows), null, 2), "application/geo+json");
      return name;
    }
    downloadText(name, LRS.toCsv(rows), "text/csv");
    return name;
  }

  async function readInput(inputId, allowed, label) {
    const input = document.getElementById(inputId);
    const files = [...(input.files || [])];
    if (!files.length) throw new Error(`Choose a ${label || "file"} first.`);
    assertAccept(files, allowed, label || "Input");
    const named = {};
    for (const file of files) named[file.name] = new Uint8Array(await file.arrayBuffer());
    const table = await LRS.tableFromNamedBuffers(named);
    cache[inputId] = table;
    return table;
  }

  async function readTableOrSession(inputId, allowed, label) {
    const input = document.getElementById(inputId);
    const files = [...((input && input.files) || [])];
    if (files.length) return readInput(inputId, allowed, label);
    if (lastRows()) {
      addLog({
        level: "info",
        text: `Using session (${session.last.label}, ${session.last.rows.length} rows). Choose a file to replace it.`,
      });
      return { rows: lastRows() };
    }
    throw new Error(`Choose a ${label}, or run a prior step to fill the session.`);
  }

  function rememberCalibratedRoutes(table, roadway, bmp, emp) {
    cache["dp-routes"] = table;
    session.calibrated = table;
    session.crs = LRS.detectCrs(table.crs, table.rows);
    const columns = LRS.columnsOf(table.rows);
    fillSelect("dp-seg", columns, roadway);
    fillSelect("dp-bmp", columns, bmp);
    fillSelect("dp-emp", columns, emp);
  }

  async function readRoutesForDisplay() {
    const input = document.getElementById("dp-routes");
    if (input && input.files && input.files.length) return readInput("dp-routes", GEOM_EXT, "route layer");
    if (cache["dp-routes"]) {
      addLog({ level: "info", text: "Using calibrated routes from Create LRS or the last loaded route layer." });
      return cache["dp-routes"];
    }
    if (session.calibrated && LRS.rowsHaveLineGeometry(session.calibrated.rows)) {
      addLog({ level: "info", text: "Using calibrated routes from Create LRS." });
      return session.calibrated;
    }
    if (lastRows() && LRS.rowsHaveLineGeometry(lastRows())) {
      addLog({ level: "info", text: `Using session geometry from ${session.last.label}.` });
      return { rows: lastRows(), crs: session.crs };
    }
    throw new Error("Choose a route layer, or run Create LRS first.");
  }

  async function readOptionalTableOrSession(inputId, allowed, label) {
    const input = document.getElementById(inputId);
    const files = [...((input && input.files) || [])];
    if (files.length) return readInput(inputId, allowed, label);
    if (lastRows()) {
      addLog({
        level: "info",
        text: `Using session (${session.last.label}, ${session.last.rows.length} rows).`,
      });
      return { rows: lastRows() };
    }
    return null;
  }

  async function readCombineRows() {
    const input = document.getElementById("cb-input");
    if (input && input.files && input.files.length) {
      return (await readInput("cb-input", TABLE_EXT, "extracted table")).rows;
    }
    if (session.display && session.display.length) {
      addLog({ level: "info", text: `Combining ${session.display.length} displayed row(s) from session.` });
      return session.display;
    }
    if (session.extracted && session.extracted.length) {
      addLog({ level: "info", text: `Combining ${session.extracted.length} extracted approach row(s) from session.` });
      return session.extracted;
    }
    if (lastRows()) {
      addLog({ level: "info", text: `Combining session table (${session.last.label}).` });
      return lastRows();
    }
    throw new Error("Choose extracted rows, or run Extract or Display first.");
  }

  function selectedValue(id) {
    const el = document.getElementById(id);
    return el && el.value ? el.value : "";
  }

  function advancedOn() {
    return document.body.classList.contains("advanced-on");
  }

  function uniqueCols(cols) {
    return [...new Set(cols.filter(Boolean))];
  }

  function fillAdvanced(prefix, columns, detected, blankLabel) {
    const picks = detected || {};
    fillSelect(`${prefix}-offset`, columns, picks.offset, blankLabel);
    fillSelect(`${prefix}-side`, columns, picks.side, blankLabel);
    fillSelect(`${prefix}-from`, columns, picks.fromDate, blankLabel);
    fillSelect(`${prefix}-to`, columns, picks.toDate, blankLabel);
  }

  function mappedAdvanced(prefix, asOfId) {
    if (!advancedOn()) {
      return { offset: "", side: "", fromDate: "", toDate: "", asOf: "", groups: [] };
    }
    const mapped = {
      offset: selectedValue(`${prefix}-offset`),
      side: selectedValue(`${prefix}-side`),
      fromDate: selectedValue(`${prefix}-from`),
      toDate: selectedValue(`${prefix}-to`),
      asOf: selectedValue(asOfId || `${prefix}-asof`),
    };
    mapped.groups = uniqueCols([mapped.offset, mapped.side, mapped.fromDate, mapped.toDate]);
    return mapped;
  }

  function applyAsOf(rows, mapped) {
    if (!advancedOn() || !mapped || !mapped.asOf) return rows;
    return LRS.filterRowsAsOf(rows, {
      fromCol: mapped.fromDate || null,
      toCol: mapped.toDate || null,
      asOf: mapped.asOf,
    });
  }

  function fillSelect(selectId, columns, selected, blankLabel) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const current = selected || select.value;
    select.innerHTML = "";
    if (blankLabel) {
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = blankLabel;
      select.appendChild(blank);
    }
    columns.forEach((col) => {
      const option = document.createElement("option");
      option.value = col;
      option.textContent = col;
      if (col === current) option.selected = true;
      select.appendChild(option);
    });
  }

  function lineSchemaFromSelects(roadId, bmpId, empId, rows) {
    const resolved = LRS.resolveColumns(rows, {
      roadway: document.getElementById(roadId).value || undefined,
      bmp: document.getElementById(bmpId).value || undefined,
      emp: document.getElementById(empId).value || undefined,
      requireLine: true,
    });
    return new LRS.LrsSchema(resolved);
  }

  function applyMappedRoutePad(rows, column) {
    return LRS.applyRouteIdPad(rows, column);
  }

  function warnRoutePadIfOn() {
    const state = LRS.roadwayPadState();
    if (state.mode === "off") return false;
    addLog({
      level: "warn",
      text: `Route IDs were rewritten (pad ${state.mode}, width ${state.width}; example 100 → ${LRS.padRoadwayId(100)}). Export to save the modified table.`,
    });
    return true;
  }

  function updatePanelInfo(tabId) {
    if (!panelInfo || !window.LRSGuide) return;
    const title = document.getElementById("panel-info-title");
    const blurb = document.getElementById("panel-info-blurb");
    const toggle = document.getElementById("panel-info-toggle");
    const body = document.getElementById("panel-info-body");
    const guide = LRSGuide.stepForPanel(tabId);
    if (!guide || !title || !body) {
      panelInfo.hidden = true;
      return;
    }
    panelInfo.hidden = false;
    title.textContent = guide.title;
    if (blurb) blurb.textContent = guide.summary || "";
    body.innerHTML = "";
    const example = document.createElement("p");
    example.className = "info-example";
    example.textContent = guide.example;
    body.appendChild(example);
    const names = document.createElement("p");
    names.className = "info-example";
    names.textContent = "Common Route ID / BMP / EMP names: ROUTE_ID + FROM_MEASURE (Esri / many states), RTE_ID + BEG_MP, ROADWAY + BEGIN_POST (Florida), FROM_MILEPOINT. Use Column layout above the title or the dropdowns if Auto is wrong.";
    body.appendChild(names);
    if (guide.errors && guide.errors.length) {
      const errTitle = document.createElement("p");
      errTitle.className = "info-errors-title";
      errTitle.textContent = "Common issues";
      body.appendChild(errTitle);
      const list = document.createElement("ul");
      list.className = "info-errors";
      guide.errors.forEach((line) => {
        const li = document.createElement("li");
        li.textContent = line;
        list.appendChild(li);
      });
      body.appendChild(list);
    }
    if (toggle) toggle.hidden = false;
    bindFieldHints(tabId);
  }

  function bindPanelInfoToggle() {
    const toggle = document.getElementById("panel-info-toggle");
    const body = document.getElementById("panel-info-body");
    if (!toggle || !body) return;
    const open = localStorage.getItem("lrs.panelInfoOpen") === "1";
    body.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.addEventListener("click", () => {
      const next = body.hidden;
      body.hidden = !next;
      toggle.setAttribute("aria-expanded", next ? "true" : "false");
      localStorage.setItem("lrs.panelInfoOpen", next ? "1" : "0");
    });
  }

  function bindFieldHints(tabId) {
    if (!window.LRSGuide) return;
    const panel = document.getElementById(tabId);
    if (!panel) return;
    LRSGuide.fieldsForPanel(tabId).forEach(({ id, text }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const label = panel.querySelector(`label[for="${id}"]`) || el.closest("label");
      if (label) {
        label.title = text;
        label.dataset.hint = text;
      }
      el.title = text;
    });
  }

  function preflight(runId) {
    const issues = [];
    function needFile(inputId, label) {
      const input = document.getElementById(inputId);
      if (input && input.files && input.files.length) return;
      issues.push(`Choose ${label}.`);
    }
    function needFileOrSession(inputId, label) {
      const input = document.getElementById(inputId);
      if (input && input.files && input.files.length) return;
      if (lastRows()) return;
      issues.push(`Choose ${label}, or run a prior step to fill the session.`);
    }
    if (runId === "validate") needFile("va-input", "an event table");
    if (runId === "overlay") {
      needFileOrSession("ov-target", "a target table");
      needFile("ov-overlay", "an overlay table");
    }
    if (runId === "dissolve") needFileOrSession("ds-input", "an event table");
    if (runId === "locate") {
      needFile("lc-points", "a point table");
      needFileOrSession("lc-events", "line events");
    }
    if (runId === "display") {
      const routes = document.getElementById("dp-routes");
      const hasFile = routes && routes.files && routes.files.length;
      const hasCalibrated = cache["dp-routes"] || session.calibrated;
      const hasGeomSession = lastRows() && LRS.rowsHaveLineGeometry(lastRows());
      if (!hasFile && !hasCalibrated && !hasGeomSession) {
        issues.push("Choose a route layer, or run Create LRS first.");
      }
    }
    if (runId === "calibrate") needFile("cl-routes", "a route geometry file");
    if (runId === "explode") needFile("exn-input", "an intersection table");
    if (runId === "combine") {
      const cb = document.getElementById("cb-input");
      const hasFile = cb && cb.files && cb.files.length;
      const hasSession =
        (session.display && session.display.length) ||
        (session.extracted && session.extracted.length) ||
        lastRows();
      if (!hasFile && !hasSession) {
        issues.push("Choose extracted rows, or run Extract or Display first.");
      }
    }
    return issues;
  }

  function beginRun(label) {
    if (logEl.children.length) {
      const sep = document.createElement("li");
      sep.className = "log-sep";
      sep.textContent = "—";
      logEl.appendChild(sep);
    }
    addLog({ level: "info", text: `Running ${label}…` });
  }

  async function loadFields(inputId) {
    const table = cache[inputId] || (await readInput(
      inputId,
      inputId === "dp-routes" || inputId === "cl-routes" ? GEOM_EXT : TABLE_EXT,
      "file"
    ));
    const columns = LRS.columnsOf(table.rows);
    const schema = LRS.LrsSchema.fromRows(table.rows);
    const advanced = LRS.detectAdvancedFields(table.rows, { columns });
    if (inputId === "va-input") {
      fillSelect("va-road", columns, schema.roadway);
      fillSelect("va-bmp", columns, schema.bmp);
      fillSelect("va-emp", columns, schema.emp);
      fillAdvanced("va", columns, advanced, "None");
    }
    if (inputId === "ov-target") {
      fillSelect("ov-t-road", columns, schema.roadway, "Auto");
      fillSelect("ov-t-bmp", columns, schema.bmp, "Auto");
      fillSelect("ov-t-emp", columns, schema.emp, "Auto");
      fillAdvanced("ov-t", columns, advanced, "None");
    }
    if (inputId === "ov-overlay") {
      fillSelect("ov-o-road", columns, schema.roadway, "Auto");
      fillSelect("ov-o-bmp", columns, schema.bmp, "Auto");
      fillSelect("ov-o-emp", columns, schema.emp, "Auto");
      fillAdvanced("ov-o", columns, advanced, "None");
    }
    if (inputId === "ds-input") {
      fillSelect("ds-road", columns, schema.roadway, "Auto");
      fillSelect("ds-bmp", columns, schema.bmp, "Auto");
      fillSelect("ds-emp", columns, schema.emp, "Auto");
      fillAdvanced("ds", columns, advanced, "None");
    }
    if (inputId === "lc-points") {
      fillSelect("lc-p-road", columns, schema.roadway, "Auto");
      fillSelect("lc-p-meas", columns, schema.measure, "Auto");
      fillSelect("lc-p-offset", columns, advanced.offset, "None");
      fillSelect("lc-p-side", columns, advanced.side, "None");
    }
    if (inputId === "lc-events") {
      fillSelect("lc-e-road", columns, schema.roadway, "Auto");
      fillSelect("lc-e-bmp", columns, schema.bmp, "Auto");
      fillSelect("lc-e-emp", columns, schema.emp, "Auto");
      fillAdvanced("lc-e", columns, advanced, "None");
    }
    if (inputId === "dp-routes" || inputId === "cl-routes") {
      if (!LRS.rowsHaveLineGeometry(table.rows)) {
        throw new Error("Routes must include line geometry (shapefile or GeoJSON).");
      }
      if (inputId === "dp-routes") {
        fillSelect("dp-seg", columns, schema.roadway);
        fillSelect("dp-bmp", columns, schema.bmp);
        fillSelect("dp-emp", columns, schema.emp);
      } else {
        fillSelect("cl-seg", columns, schema.roadway, "Create LRS_UID if missing");
        fillSelect("cl-bmp", columns, schema.bmp, "Create LRS_BMP if missing");
        fillSelect("cl-emp", columns, schema.emp, "Create LRS_EMP if missing");
      }
      const crs = LRS.detectCrs(table.crs, table.rows);
      session.crs = crs;
      showRoutes(table.rows, crs);
      addLog({
        level: "ok",
        text: `Drew ${LRS.countLineGeometry(table.rows)} route line(s)${crs && crs !== "EPSG:4326" ? ` (${crs} → WGS84)` : ""}.`,
      });
    }
    if (inputId === "dp-events") {
      fillSelect("dp-ev-seg", columns, schema.roadway, "Same as routes / auto");
      fillSelect("dp-ev-bmp", columns, schema.bmp, "Same as routes / auto");
      fillSelect("dp-ev-emp", columns, schema.emp, "Same as routes / auto");
      fillAdvanced("dp-ev", columns, advanced, "None");
    }
    if (inputId === "exn-input") {
      fillSelect("exn-packed", columns, LRS.detectPackedColumn(table.rows));
      fillSelect("exn-parent", columns, LRS.detectParentColumn(table.rows), "Row number");
      fillSelect("exn-names", columns, LRS.detectNamesColumn(table.rows), "None");
    }
    const inspect = inputId === "dp-routes" || inputId === "cl-routes"
      ? null
      : LRS.inspectEventKeys(table.rows, {
          roadway: schema.roadway,
          bmp: schema.bmp,
          emp: schema.emp,
        });
    return { columns, rows: table.rows.length, schema, inspect };
  }

  function noticeText(inspect, rowCount) {
    if (!inspect) return "";
    if (inspect.recommended === "extract") {
      return `No usable BMP/EMP. Packed field ${inspect.packedCol} has ${inspect.approachCount} approaches — use Extract first.`;
    }
    if (inspect.packedCol && inspect.approachCount > inspect.usable) {
      return `${inspect.usable} rows have mileposts; ${inspect.approachCount} packed approaches also found. Extract only if you need one row per approach.`;
    }
    if (inspect.hasLineColumns && inspect.usable) {
      const fields = [inspect.roadway, inspect.bmp, inspect.emp].filter(Boolean).join(" / ");
      return `${inspect.usable} of ${rowCount} rows have usable ${fields || "Route ID / BMP / EMP"}. Change the dropdowns if Auto picked the wrong columns.`;
    }
    return "";
  }

  function setLoadNotice(inspect, rowCount) {
    const text = noticeText(inspect, rowCount);
    if (!loadNotice) return;
    loadNotice.hidden = !text;
    loadNotice.textContent = text;
    loadNotice.classList.toggle("warn", inspect && inspect.recommended === "extract");
    if (extractHint) extractHint.textContent = text || "Load a table to see whether mileposts exist or a packed field needs Extract.";
    if (extractHint) extractHint.classList.toggle("warn", inspect && inspect.recommended === "extract");
  }

  function lastRows() {
    return session.last && session.last.rows ? session.last.rows : null;
  }

  function normalizeCrs(crs, rows) {
    if (crs && /^EPSG:/i.test(crs)) return crs;
    if (session.crs && /^EPSG:/i.test(session.crs)) return session.crs;
    return LRS.detectCrs(crs || (cache["dp-routes"] && cache["dp-routes"].crs), rows);
  }

  function showRoutes(rows, crs) {
    if (!window.LRSMap) return;
    const code = normalizeCrs(crs, rows);
    session.crs = code;
    LRSMap.setRoutes(rows, { crs: code });
  }

  function fillMapColorBy(rows) {
    const select = document.getElementById("map-color-by");
    if (!select || !window.LRSMap) return;
    const fields = LRS.columnsOf(rows).filter((col) => col !== "geometry");
    const saved = LRSMap.getPrefs().colorBy;
    fillSelect("map-color-by", fields, fields.includes(saved) ? saved : "", "None");
    LRSMap.setEventColor(select.value || null);
  }

  function showEvents(rows, crs) {
    const canDraw = LRS.rowsHaveMapGeometry ? LRS.rowsHaveMapGeometry(rows) : LRS.rowsHaveLineGeometry(rows);
    if (!window.LRSMap || !canDraw) return;
    fillMapColorBy(rows);
    LRSMap.setEvents(rows, { crs: normalizeCrs(crs, rows) });
  }

  function drawLoadedTable(table, role) {
    if (!table || !window.LRSMap) return 0;
    const hasGeom = LRS.rowsHaveMapGeometry ? LRS.rowsHaveMapGeometry(table.rows) : LRS.rowsHaveLineGeometry(table.rows);
    if (!hasGeom) return 0;
    const n = LRS.countMapGeometry ? LRS.countMapGeometry(table.rows) : LRS.countLineGeometry(table.rows);
    if (role === "events") showEvents(table.rows, table.crs);
    else showRoutes(table.rows, table.crs);
    return n;
  }

  function bindColumnSplitters() {
    const app = document.querySelector(".app");
    const formPane = document.querySelector(".workbench");
    const statusPane = document.querySelector(".status-pane");
    const formSplit = document.getElementById("splitter");
    const statusSplit = document.getElementById("status-splitter");
    if (!app || !formPane || !formSplit) return;

    const MAP_MIN = 280;
    const columns = [
      {
        pane: formPane,
        splitter: formSplit,
        cssVar: "--form",
        storage: "lrs.formWidth",
        min: 360,
        def: 520,
      },
      statusPane && statusSplit
        ? {
            pane: statusPane,
            splitter: statusSplit,
            cssVar: "--status",
            storage: "lrs.statusWidth",
            min: 220,
            def: 320,
          }
        : null,
    ].filter(Boolean);

    function splitterWidth() {
      return columns.reduce((sum, col) => sum + (col.splitter.offsetWidth || 7), 0);
    }

    function otherWidth(current) {
      return columns.reduce((sum, col) => {
        if (col === current) return sum;
        return sum + col.pane.getBoundingClientRect().width;
      }, 0);
    }

    function maxWidth(col) {
      return Math.max(
        col.min,
        Math.floor(app.getBoundingClientRect().width - MAP_MIN - splitterWidth() - otherWidth(col))
      );
    }

    function applyWidth(col, px) {
      const width = Math.round(Math.min(maxWidth(col), Math.max(col.min, px)));
      document.documentElement.style.setProperty(col.cssVar, `${width}px`);
      col.splitter.setAttribute("aria-valuemin", String(col.min));
      col.splitter.setAttribute("aria-valuemax", String(maxWidth(col)));
      col.splitter.setAttribute("aria-valuenow", String(width));
      if (window.LRSMap) LRSMap.resize();
      return width;
    }

    function persist(col, width) {
      localStorage.setItem(col.storage, String(width));
    }

    columns.forEach((col) => {
      const stored = Number(localStorage.getItem(col.storage));
      applyWidth(col, Number.isFinite(stored) && stored >= col.min ? stored : col.def);

      let drag = null;
      col.splitter.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        drag = { x: event.clientX, width: col.pane.getBoundingClientRect().width };
        col.splitter.setPointerCapture(event.pointerId);
        col.splitter.classList.add("is-active");
        document.body.classList.add("is-resizing");
      });
      col.splitter.addEventListener("pointermove", (event) => {
        if (!drag) return;
        applyWidth(col, drag.width + (event.clientX - drag.x));
      });
      function endDrag() {
        if (!drag) return;
        persist(col, col.pane.getBoundingClientRect().width);
        drag = null;
        col.splitter.classList.remove("is-active");
        document.body.classList.remove("is-resizing");
      }
      col.splitter.addEventListener("pointerup", endDrag);
      col.splitter.addEventListener("pointercancel", endDrag);
      col.splitter.addEventListener("dblclick", () => persist(col, applyWidth(col, col.def)));
      col.splitter.addEventListener("keydown", (event) => {
        const width = col.pane.getBoundingClientRect().width;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          persist(col, applyWidth(col, width - 16));
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          persist(col, applyWidth(col, width + 16));
        } else if (event.key === "Home") {
          event.preventDefault();
          persist(col, applyWidth(col, col.min));
        } else if (event.key === "End") {
          event.preventDefault();
          persist(col, applyWidth(col, maxWidth(col)));
        }
      });
    });

    window.addEventListener("resize", () => {
      columns.forEach((col) => applyWidth(col, col.pane.getBoundingClientRect().width));
    });
  }
  bindColumnSplitters();

  function bindPreviewSplitter() {
    const pane = document.querySelector(".map-pane");
    const preview = document.getElementById("preview-wrap");
    const splitter = document.getElementById("preview-splitter");
    if (!pane || !preview || !splitter) return;

    const MIN = 140;
    const DEFAULT = 220;

    function maxHeight() {
      return Math.max(MIN, Math.floor(pane.getBoundingClientRect().height * 0.5));
    }

    function applyHeight(px) {
      const height = Math.round(Math.min(maxHeight(), Math.max(MIN, px)));
      document.documentElement.style.setProperty("--preview", `${height}px`);
      splitter.setAttribute("aria-valuemin", String(MIN));
      splitter.setAttribute("aria-valuemax", String(maxHeight()));
      splitter.setAttribute("aria-valuenow", String(height));
      if (window.LRSMap) LRSMap.resize();
      return height;
    }

    const stored = Number(localStorage.getItem("lrs.previewHeight"));
    applyHeight(Number.isFinite(stored) && stored >= MIN ? stored : DEFAULT);

    let drag = null;
    splitter.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      drag = { y: event.clientY, height: preview.getBoundingClientRect().height };
      splitter.setPointerCapture(event.pointerId);
      splitter.classList.add("is-active");
      document.body.classList.add("is-resizing");
    });
    splitter.addEventListener("pointermove", (event) => {
      if (!drag) return;
      applyHeight(drag.height - (event.clientY - drag.y));
    });
    function endDrag() {
      if (!drag) return;
      localStorage.setItem("lrs.previewHeight", String(preview.getBoundingClientRect().height));
      drag = null;
      splitter.classList.remove("is-active");
      document.body.classList.remove("is-resizing");
    }
    splitter.addEventListener("pointerup", endDrag);
    splitter.addEventListener("pointercancel", endDrag);
    splitter.addEventListener("dblclick", () => {
      const height = applyHeight(DEFAULT);
      localStorage.setItem("lrs.previewHeight", String(height));
    });
    splitter.addEventListener("keydown", (event) => {
      const height = preview.getBoundingClientRect().height;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        localStorage.setItem("lrs.previewHeight", String(applyHeight(height + 24)));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        localStorage.setItem("lrs.previewHeight", String(applyHeight(height - 24)));
      } else if (event.key === "Home") {
        event.preventDefault();
        localStorage.setItem("lrs.previewHeight", String(applyHeight(MIN)));
      } else if (event.key === "End") {
        event.preventDefault();
        localStorage.setItem("lrs.previewHeight", String(applyHeight(maxHeight())));
      }
    });
    window.addEventListener("resize", () => applyHeight(preview.getBoundingClientRect().height));
  }
  bindPreviewSplitter();

  document.querySelectorAll(".rail-item").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".rail-item").forEach((el) => el.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((el) => el.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.tab).classList.add("active");
      updatePanelInfo(button.dataset.tab);
      refreshAdvancedHint();
    });
  });
  bindPanelInfoToggle();
  updatePanelInfo("validate");

  const advanced = document.getElementById("advanced-toggle");
  const advancedHint = document.getElementById("advanced-hint");
  const modeButtons = document.querySelectorAll(".mode-btn[data-advanced]");

  const ADVANCED_HINTS = {
    validate: "Offset, side, dates split QC",
    overlay: "Side + date-aware overlay",
    dissolve: "Side and dates in dissolve groups",
    locate: "Side-aware point locate",
    display: "As-of date before clip",
    calibrate: "Standard geometry calibration",
    explode: "Standard milepost workflow",
  };

  function refreshAdvancedHint() {
    if (!advancedHint) return;
    if (!advancedOn()) {
      advancedHint.textContent = "Route ID + mileposts only";
      return;
    }
    const tab = document.querySelector(".rail-item.active");
    const tabId = tab && tab.dataset.tab;
    advancedHint.textContent =
      ADVANCED_HINTS[tabId] || "Offset, side, and dates on each step";
  }

  function setAdvancedMode(on) {
    if (advanced) advanced.checked = on;
    localStorage.setItem("lrs.advancedTools", on ? "1" : "0");
    document.body.classList.toggle("advanced-on", on);
    modeButtons.forEach((btn) => {
      const active = btn.dataset.advanced === (on ? "1" : "0");
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    refreshAdvancedHint();
  }

  function revealAdvancedFields() {
    const panel = document.querySelector(".panel.active");
    const block = panel && panel.querySelector(".advanced-only");
    if (block) block.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function fillAdvancedFromRows(prefix, rows, blankLabel) {
    if (!rows || !rows.length) return;
    fillAdvanced(prefix, LRS.columnsOf(rows), LRS.detectAdvancedFields(rows), blankLabel || "None");
  }

  function bindHelpTips() {
    const texts = (window.LRSGuide && LRSGuide.OPTION_HELP) || {};
    function closeHelp() {
      document.querySelectorAll(".help-pop").forEach((el) => el.remove());
    }
    function openHelp(btn) {
      const key = btn.dataset.help;
      const existing = document.querySelector(".help-pop");
      if (existing && existing.dataset.help === key) {
        existing.remove();
        return;
      }
      closeHelp();
      const pop = document.createElement("div");
      pop.className = "help-pop";
      pop.dataset.help = key;
      pop.setAttribute("role", "tooltip");
      pop.textContent = texts[key] || btn.title || "";
      document.body.appendChild(pop);
      const rect = btn.getBoundingClientRect();
      const left = Math.min(rect.left, window.innerWidth - pop.offsetWidth - 12);
      pop.style.left = `${Math.max(12, left)}px`;
      pop.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - pop.offsetHeight - 12)}px`;
    }
    document.addEventListener("click", (event) => {
      const btn = event.target.closest(".help-btn");
      if (btn) {
        event.preventDefault();
        event.stopPropagation();
        openHelp(btn);
        return;
      }
      if (!event.target.closest(".help-pop")) closeHelp();
    });
  }

  const ROUTE_PAD_ANCHORS = [
    "va-road",
    "ov-t-road",
    "ov-o-road",
    "ds-road",
    "lc-p-road",
    "lc-e-road",
    "dp-seg",
    "dp-ev-seg",
    "cl-seg",
  ];

  function insertRoutePadBlocks() {
    const template = document.getElementById("route-pad-template");
    if (!template || !template.content || !template.content.firstElementChild) return;
    ROUTE_PAD_ANCHORS.forEach((id) => {
      const field = document.getElementById(id);
      const row = field && field.closest(".row");
      if (!row || (row.nextElementSibling && row.nextElementSibling.classList.contains("route-pad"))) return;
      row.after(template.content.firstElementChild.cloneNode(true));
    });
  }

  function padHintText(state) {
    if (state.mode === "off") return "Route IDs are compared exactly as written.";
    if (state.mode === "all") return `Every ID is padded to ${state.width} characters, including text.`;
    return `Numeric IDs pad to ${state.width} characters (100 → ${LRS.padRoadwayId(100)}). Text IDs such as I-95 stay unchanged.`;
  }

  function applyRoadwayPad(fromEl) {
    const block = fromEl && fromEl.closest ? fromEl.closest(".route-pad") : null;
    const modeEl = (block && block.querySelector(".route-pad-mode")) || document.querySelector(".route-pad-mode");
    const widthEl = (block && block.querySelector(".route-pad-width-input")) || document.querySelector(".route-pad-width-input");
    if (!modeEl || !widthEl) return;
    const state = LRS.configureRoadwayPad({ mode: modeEl.value, width: widthEl.value });
    localStorage.setItem("lrs.roadwayPad", JSON.stringify(state));
    const hint = padHintText(state);
    document.querySelectorAll(".route-pad").forEach((el) => {
      const mode = el.querySelector(".route-pad-mode");
      const width = el.querySelector(".route-pad-width-input");
      const hintEl = el.querySelector(".route-pad-hint");
      const warn = el.querySelector(".route-pad-warn");
      if (mode) mode.value = state.mode;
      if (width) {
        width.value = String(state.width);
        width.disabled = state.mode === "off";
      }
      if (hintEl) hintEl.textContent = hint;
      if (warn) warn.hidden = state.mode === "off";
    });
  }

  function pickProfileColumn(columns, names) {
    const lower = new Map(columns.map((col) => [String(col).toLowerCase(), col]));
    for (const name of names || []) {
      if (columns.includes(name)) return name;
      const hit = lower.get(String(name).toLowerCase());
      if (hit) return hit;
    }
    return "";
  }

  const PROFILE_TARGETS = {
    validate: [["va-road", "va-bmp", "va-emp", null]],
    overlay: [
      ["ov-t-road", "ov-t-bmp", "ov-t-emp", null],
      ["ov-o-road", "ov-o-bmp", "ov-o-emp", null],
    ],
    dissolve: [["ds-road", "ds-bmp", "ds-emp", null]],
    locate: [
      ["lc-p-road", null, null, "lc-p-meas"],
      ["lc-e-road", "lc-e-bmp", "lc-e-emp", null],
    ],
    display: [
      ["dp-seg", "dp-bmp", "dp-emp", null],
      ["dp-ev-seg", "dp-ev-bmp", "dp-ev-emp", null],
    ],
    calibrate: [["cl-seg", "cl-bmp", "cl-emp", null]],
    explode: [],
  };

  function applyFieldProfile() {
    const profileEl = document.getElementById("field-profile");
    if (!profileEl || !window.LRSGuide) return;
    const key = profileEl.value;
    const profile = key ? LRSGuide.FIELD_PROFILES[key] : null;
    const tab = document.querySelector(".rail-item.active");
    const tabId = tab && tab.dataset.tab;
    const targets = PROFILE_TARGETS[tabId] || [];
    if (!profile) {
      addLog({ level: "info", text: "Column layout is Auto-detect from this file. Change a dropdown if the guess is wrong." });
      return;
    }
    let applied = 0;
    let seen = 0;
    for (const [roadId, bmpId, empId, measId] of targets) {
      const sample = document.getElementById(roadId || bmpId || measId);
      const columns = sample
        ? [...sample.options].map((option) => option.value).filter(Boolean)
        : [];
      if (!columns.length) continue;
      seen += 1;
      const assign = (id, names) => {
        if (!id || !names) return;
        const el = document.getElementById(id);
        const value = pickProfileColumn(columns, names);
        if (el && value) {
          el.value = value;
          applied += 1;
        }
      };
      assign(roadId, profile.roadway);
      assign(bmpId, profile.bmp);
      assign(empId, profile.emp);
      assign(measId, profile.measure);
    }
    if (!seen) {
      addLog({ level: "warn", text: `Load a table on ${tabId || "this step"} first, then apply ${profile.label}.` });
      return;
    }
    addLog({
      level: applied ? "ok" : "warn",
      text: applied
        ? `Applied ${profile.label} column names where they exist. Review the dropdowns.`
        : `${profile.label} names were not found in this file. Pick columns from the dropdowns.`,
    });
  }

  insertRoutePadBlocks();
  try {
    const storedPad = JSON.parse(localStorage.getItem("lrs.roadwayPad") || "null");
    const modeEl = document.querySelector(".route-pad-mode");
    const widthEl = document.querySelector(".route-pad-width-input");
    if (storedPad && modeEl && storedPad.mode) modeEl.value = storedPad.mode;
    if (storedPad && widthEl && storedPad.width != null) widthEl.value = storedPad.width;
  } catch (err) {
    /* keep defaults */
  }
  applyRoadwayPad();
  document.addEventListener("change", (event) => {
    if (event.target.closest(".route-pad-mode") || event.target.closest(".route-pad-width-input")) {
      applyRoadwayPad(event.target);
    }
  });
  const profileEl = document.getElementById("field-profile");
  if (profileEl) profileEl.addEventListener("change", applyFieldProfile);
  bindHelpTips();

  setAdvancedMode(localStorage.getItem("lrs.advancedTools") === "1");
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const on = btn.dataset.advanced === "1";
      if (on === advancedOn()) return;
      setAdvancedMode(on);
      if (on && lastRows()) {
        fillAdvancedFromRows("va", lastRows());
        fillAdvancedFromRows("ov-t", lastRows());
        fillAdvancedFromRows("ds", lastRows());
        fillAdvancedFromRows("lc-e", lastRows());
        fillAdvancedFromRows("dp-ev", lastRows());
        revealAdvancedFields();
      }
      addLog({
        level: "info",
        text: on ? "Advanced mode on." : "Standard mode on.",
      });
    });
  });

  [
    "va-input", "ov-target", "ov-overlay", "ds-input", "lc-points", "lc-events", "dp-routes", "dp-events", "cl-routes", "exn-input",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", async () => {
      try {
        const loaded = await loadFields(id);
        const name = el.files[0] ? el.files[0].name : id;
        addLog({ level: "info", text: `Loaded ${loaded.rows} row(s) from ${name}.` });
        if (loaded.inspect) {
          writeLogs(LRS.reportEventKeys(loaded.inspect, loaded.rows).lines);
          setLoadNotice(loaded.inspect, loaded.rows);
        }
        updateSessionBanner();
        if (id !== "dp-routes" && id !== "cl-routes") {
          const table = cache[id];
          const role = id === "ov-overlay" || id === "dp-events" || id === "lc-events" || id === "lc-points" ? "events" : "routes";
          const drawn = drawLoadedTable(table, role);
          if (drawn) {
            addLog({
              level: "ok",
              text: `Drew ${drawn} feature(s) on the map from ${name}.`,
            });
          } else if (/\.(zip|shp|geojson|json)$/i.test(name)) {
            addLog({
              level: "warn",
              text: `${name} loaded as a table, but no line or point geometry was found to draw.`,
            });
          }
        }
      } catch (err) {
        addLog({ level: "err", text: err.message });
      }
    });
  });

  const cbInput = document.getElementById("cb-input");
  if (cbInput) cbInput.addEventListener("change", () => updateSessionBanner());

  function bindFormat(fmtId, outputId) {
    const fmt = document.getElementById(fmtId);
    const output = document.getElementById(outputId);
    if (!fmt || !output) return;
    fmt.addEventListener("change", () => {
      output.value = filenameFor(output.value, fmt.value);
    });
  }
  bindFormat("ov-fmt", "ov-output");
  bindFormat("ds-fmt", "ds-output");
  bindFormat("dp-fmt", "dp-output");
  bindFormat("cb-fmt", "cb-output");

  document.querySelectorAll("[data-export]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pack = exports[btn.dataset.export];
      if (!pack) return;
      try {
        const name = writeOutput(pack.rows, pack.filename, { fmt: pack.fmt });
        addLog({ level: "ok", text: `Exported ${name}.` });
      } catch (err) {
        addLog({ level: "err", text: err.message });
      }
    });
  });

  if (window.LRSMap) LRSMap.init("map");
  const mapFit = document.getElementById("map-fit");
  if (mapFit) mapFit.addEventListener("click", () => window.LRSMap && LRSMap.fit());
  ["map-toggle-routes", "map-toggle-events"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => window.LRSMap && LRSMap.setVisibility());
  });

  const runners = {
    validate: async () => {
      clearExports(["va", "va-issues", "va-table"]);
      const input = await readInput("va-input", TABLE_EXT, "event table");
      const mapped = mappedAdvanced("va", "va-asof");
      const filtered = applyAsOf(input.rows, mapped);
      const schema = lineSchemaFromSelects("va-road", "va-bmp", "va-emp", filtered);
      const rows = applyMappedRoutePad(filtered, schema.roadway);
      const padded = warnRoutePadIfOn();
      const validation = LRS.validateLrs(rows, schema, { groupCols: mapped.groups });
      const issues = LRS.flattenValidation(validation, schema);
      writeLogs(LRS.reportValidate(validation).lines);
      if (validation.ok) addLog({ level: "ok", text: "No QC issues found." });
      else addLog({ level: "warn", text: `${issues.length} issue row(s). Gaps and overlaps were not rewritten. Export when ready.` });
      addLog({
        level: "info",
        text: padded
          ? "Validate padded Route IDs in session. Export table to save that version. Gaps and overlaps stay until you edit the file or dissolve/overlay with care."
          : "Validate keeps the original table in session. Gaps and overlaps stay until you edit the file or dissolve/overlay with care.",
      });
      setSession(rows, "Validate");
      stashExport("va-issues", issues, document.getElementById("va-output").value || "lrs_qc_issues.csv", "csv");
      stashExport("va-table", rows, document.getElementById("va-table-output").value || "lrs_events.csv", "csv");
      drawLoadedTable({ rows, crs: input.crs }, "routes");
      return {
        rows: issues.length ? issues : rows.slice(0, 12),
        previewAll: issues,
        summary: validation.ok
          ? padded
            ? "QC passed. Session Route IDs were padded — export the table to save them."
            : "QC passed. Session still has the original rows."
          : padded
            ? `${issues.length} issue(s) found. Session Route IDs were padded — export the table to save them.`
            : `${issues.length} issue(s) found. Session still has the original rows.`,
      };
    },
    overlay: async () => {
      clearExports(["ov"]);
      const target = await readTableOrSession("ov-target", TABLE_EXT, "target table");
      const overlay = await readInput("ov-overlay", TABLE_EXT, "overlay table");
      const targetMapped = mappedAdvanced("ov-t", "ov-asof");
      const overlayMapped = mappedAdvanced("ov-o", "ov-asof");
      const targetFiltered = applyAsOf(target.rows, targetMapped);
      const overlayFiltered = applyAsOf(overlay.rows, overlayMapped);
      const targetSchema = lineSchemaFromSelects("ov-t-road", "ov-t-bmp", "ov-t-emp", targetFiltered);
      const overlaySchema = lineSchemaFromSelects("ov-o-road", "ov-o-bmp", "ov-o-emp", overlayFiltered);
      const targetRows = applyMappedRoutePad(targetFiltered, targetSchema.roadway);
      const overlayRows = applyMappedRoutePad(overlayFiltered, overlaySchema.roadway);
      warnRoutePadIfOn();
      const typedGroups = splitCols(document.getElementById("ov-groups").value);
      const groups = typedGroups.length
        ? uniqueCols([...typedGroups, ...targetMapped.groups, ...overlayMapped.groups])
        : null;
      const matchPairs = [];
      if (targetMapped.side && overlayMapped.side) matchPairs.push({ target: targetMapped.side, overlay: overlayMapped.side });
      if (targetMapped.offset && overlayMapped.offset) matchPairs.push({ target: targetMapped.offset, overlay: overlayMapped.offset });
      const dateOverlap = targetMapped.fromDate && overlayMapped.fromDate
        ? {
            leftFrom: targetMapped.fromDate,
            leftTo: targetMapped.toDate || null,
            rightFrom: overlayMapped.fromDate,
            rightTo: overlayMapped.toDate || null,
          }
        : null;
      const result = LRS.overlayEvents(targetRows, overlayRows, {
        how: document.getElementById("ov-how").value,
        collapse: document.getElementById("ov-collapse").value,
        collapseGroupCols: groups && groups.length ? groups : null,
        matchPairs,
        dateOverlap,
        targetSchema,
        overlaySchema,
      });
      writeLogs(LRS.reportOverlay(targetRows, overlayRows, result, { targetSchema, overlaySchema }).lines);
      const fmt = document.getElementById("ov-fmt").value;
      stashExport("ov", result, document.getElementById("ov-output").value, fmt);
      setSession(result, "Overlay");
      if (LRS.rowsHaveLineGeometry(result)) showEvents(result, session.crs);
      return { rows: result, summary: `${result.length} overlay slice(s) ready.` };
    },
    dissolve: async () => {
      clearExports(["ds"]);
      const input = await readTableOrSession("ds-input", TABLE_EXT, "event table");
      const mapped = mappedAdvanced("ds", "ds-asof");
      const filtered = applyAsOf(input.rows, mapped);
      const schema = lineSchemaFromSelects("ds-road", "ds-bmp", "ds-emp", filtered);
      const rows = applyMappedRoutePad(filtered, schema.roadway);
      warnRoutePadIfOn();
      const groups = uniqueCols([...splitCols(document.getElementById("ds-groups").value), ...mapped.groups]);
      const result = LRS.dissolveContiguous(rows, {
        groupCols: groups.length ? groups : null,
        requireContiguous: document.getElementById("ds-contig").checked,
        schema,
      });
      addLog({ level: "info", text: `${rows.length} rows in → ${result.length} rows out.` });
      if (result.length === rows.length) {
        addLog({ level: "warn", text: "Nothing merged — check group columns and milepost adjacency." });
      } else {
        addLog({ level: "ok", text: `Merged ${rows.length - result.length} row(s).` });
      }
      const fmt = document.getElementById("ds-fmt").value;
      stashExport("ds", result, document.getElementById("ds-output").value, fmt);
      setSession(result, "Dissolve");
      return { rows: result, summary: `${result.length} dissolved row(s).` };
    },
    locate: async () => {
      clearExports(["lc", "lc-unmatched"]);
      const points = await readInput("lc-points", TABLE_EXT, "point table");
      const events = await readOptionalTableOrSession("lc-events", TABLE_EXT, "line events");
      if (!events) throw new Error("Choose line events or run a prior step to fill the session.");
      const pointMapped = mappedAdvanced("lc-p", "lc-asof");
      const eventMapped = mappedAdvanced("lc-e", "lc-asof");
      const pointUpdates = {};
      if (document.getElementById("lc-p-road").value) pointUpdates.roadway = document.getElementById("lc-p-road").value;
      if (document.getElementById("lc-p-meas").value) pointUpdates.measure = document.getElementById("lc-p-meas").value;
      const pointSchema = LRS.LrsSchema.fromRows(points.rows, { requireMeasure: true }).withUpdates(pointUpdates);
      const eventFiltered = applyAsOf(events.rows, eventMapped);
      const eventSchema = lineSchemaFromSelects("lc-e-road", "lc-e-bmp", "lc-e-emp", eventFiltered);
      const pointRows = applyMappedRoutePad(points.rows, pointSchema.roadway);
      const eventRows = applyMappedRoutePad(eventFiltered, eventSchema.roadway);
      warnRoutePadIfOn();
      const matchPairs = [];
      if (pointMapped.side && eventMapped.side) matchPairs.push({ point: pointMapped.side, event: eventMapped.side });
      if (pointMapped.offset && eventMapped.offset) matchPairs.push({ point: pointMapped.offset, event: eventMapped.offset });
      const { located, unmatched } = LRS.locatePoints(pointRows, eventRows, { pointSchema, eventSchema, matchPairs });
      writeLogs(LRS.reportLocate(pointRows, eventRows, located, unmatched, { pointSchema, eventSchema }).lines);
      stashExport("lc", located, document.getElementById("lc-output").value || "located.csv", "csv");
      const unmatchedName = document.getElementById("lc-unmatched").value.trim();
      if (unmatched.length && unmatchedName) {
        stashExport("lc-unmatched", unmatched, unmatchedName, "csv");
      }
      setSession(located, "Locate");
      if (LRS.rowsHaveMapGeometry(located)) showEvents(located, session.crs);
      return { rows: located, summary: `${located.length} located · ${unmatched.length} unmatched.` };
    },
    calibrate: async () => {
      clearExports(["cl"]);
      const routes = cache["cl-routes"] || (await readInput("cl-routes", GEOM_EXT, "route geometry"));
      if (!LRS.rowsHaveLineGeometry(routes.rows)) {
        throw new Error("Routes must include line geometry.");
      }
      const calibrated = LRS.calibrateRouteMeasures(routes.rows, {
        crs: LRS.detectCrs(routes.crs, routes.rows),
        roadway: document.getElementById("cl-seg").value || undefined,
        bmp: document.getElementById("cl-bmp").value || undefined,
        emp: document.getElementById("cl-emp").value || undefined,
      });
      const paddedRows = applyMappedRoutePad(calibrated.rows, calibrated.roadway);
      const table = { ...routes, rows: paddedRows };
      cache["cl-routes"] = table;
      rememberCalibratedRoutes(table, calibrated.roadway, calibrated.bmp, calibrated.emp);
      fillSelect("cl-seg", LRS.columnsOf(paddedRows), calibrated.roadway, "Create LRS_UID if missing");
      fillSelect("cl-bmp", LRS.columnsOf(paddedRows), calibrated.bmp, "Create LRS_BMP if missing");
      fillSelect("cl-emp", LRS.columnsOf(paddedRows), calibrated.emp, "Create LRS_EMP if missing");
      writeLogs(calibrated.lines);
      warnRoutePadIfOn();
      addLog({
        level: "info",
        text: "Create LRS is optional. Go to Display to clip events, or Overlay if you want to use this table as events. Generated measures are not agency mileposts.",
      });
      const fmt = document.getElementById("cl-fmt").value;
      stashExport("cl", paddedRows, document.getElementById("cl-output").value, fmt);
      setSession(paddedRows, "Create LRS");
      showRoutes(paddedRows, routes.crs);
      return { rows: paddedRows, summary: `${paddedRows.length} calibrated route(s) ready.` };
    },
    display: async () => {
      clearExports(["dp"]);
      const routes = await readRoutesForDisplay();
      if (!LRS.rowsHaveLineGeometry(routes.rows)) {
        throw new Error("Routes must include line geometry.");
      }
      const routeSchema = lineSchemaFromSelects("dp-seg", "dp-bmp", "dp-emp", routes.rows);
      const routeRows = applyMappedRoutePad(routes.rows, routeSchema.roadway);
      showRoutes(routeRows, routes.crs);
      const events = await readOptionalTableOrSession("dp-events", TABLE_EXT, "event table");
      let eventSchema = null;
      if (events) {
        const mapped = mappedAdvanced("dp-ev", "dp-asof");
        events.rows = applyAsOf(events.rows, mapped);
        eventSchema = lineSchemaFromSelects("dp-ev-seg", "dp-ev-bmp", "dp-ev-emp", events.rows);
        events.rows = applyMappedRoutePad(events.rows, eventSchema.roadway);
        const keys = LRS.inspectEventKeys(events.rows, {
          roadway: eventSchema.roadway,
          bmp: eventSchema.bmp,
          emp: eventSchema.emp,
        });
        if (!keys.hasLineColumns || keys.usable === 0) {
          throw new Error(
            keys.packedCol
              ? `No usable values in ${keys.bmp || "the mapped begin column"} / ${keys.emp || "end column"}. Extract from ${keys.packedCol} first.`
              : `No usable values in ${[keys.roadway, keys.bmp, keys.emp].filter(Boolean).join(" / ") || "the mapped Route ID / BMP / EMP columns"}.`
          );
        }
      }
      const result = LRS.exportLrsGeometry(routeRows, {
        segmentId: routeSchema.roadway,
        startPost: routeSchema.bmp,
        endPost: routeSchema.emp,
        events: events ? events.rows : null,
        eventSegmentId: eventSchema ? eventSchema.roadway : null,
        eventStartPost: eventSchema ? eventSchema.bmp : null,
        eventEndPost: eventSchema ? eventSchema.emp : null,
        dropEmpty: false,
      });
      warnRoutePadIfOn();
      if (events) writeLogs(LRS.reportClip(events.rows, routeRows, result).lines);
      else addLog({ level: "ok", text: `Clipped ${result.length} route row(s).` });
      const fmt = document.getElementById("dp-fmt").value;
      stashExport("dp", result, document.getElementById("dp-output").value, fmt);
      session.display = result;
      setSession(result, "Display");
      if (events) showEvents(result, routes.crs);
      else showRoutes(result, routes.crs);
      return { rows: result, summary: `${result.length} geometry row(s) on map.` };
    },
    explode: async () => {
      clearExports(["exn"]);
      const input = await readInput("exn-input", TABLE_EXT, "intersection table");
      const stub = Number(document.getElementById("exn-stub").value);
      const result = LRS.explodeNestedRoutes(input.rows, {
        packedCol: document.getElementById("exn-packed").value || null,
        parentCol: document.getElementById("exn-parent").value || null,
        namesCol: document.getElementById("exn-names").value,
        stubLength: Number.isFinite(stub) ? stub : 0.02,
      });
      writeLogs(LRS.reportExplode(input.rows.length, result).lines);
      session.extracted = result.rows;
      stashExport("exn", result.rows, document.getElementById("exn-output").value || "extracted_routes.csv", "csv");
      setSession(result.rows, "Extract");
      return { rows: result.rows, summary: `${result.rows.length} approach row(s).` };
    },
    combine: async () => {
      clearExports(["cb"]);
      const rows = await readCombineRows();
      const cols = LRS.columnsOf(rows);
      if (!cols.includes("LRS_SOURCE_ROW") && !cols.includes("LRS_PARENT_ID")) {
        throw new Error("Combine needs extracted approach rows (LRS_SOURCE_ROW or LRS_PARENT_ID).");
      }
      const result = LRS.combineNestedRoutes(rows);
      addLog({ level: "info", text: `${rows.length} approaches → ${result.length} intersection row(s).` });
      const fmt = document.getElementById("cb-fmt").value;
      stashExport("cb", result, document.getElementById("cb-output").value, fmt);
      setSession(result, "Combine");
      if (LRS.rowsHaveLineGeometry(result)) showEvents(result);
      return { rows: result, summary: `${result.length} combined row(s).` };
    },
  };

  document.querySelectorAll("[data-run]").forEach((button) => {
    button.addEventListener("click", async () => {
      const runId = button.dataset.run;
      const checks = preflight(runId);
      if (checks.length) {
        if (logEl.children.length) {
          const sep = document.createElement("li");
          sep.className = "log-sep";
          sep.textContent = "—";
          logEl.appendChild(sep);
        }
        checks.forEach((msg) => addLog({ level: "err", text: msg }));
        return;
      }
      const actionRow = button.closest(".actions");
      const siblings = actionRow ? actionRow.querySelectorAll("button") : [button];
      beginRun(button.textContent.trim());
      siblings.forEach((btn) => {
        btn.disabled = true;
      });
      try {
        const payload = await runners[runId]();
        addLog({ level: "ok", text: payload.summary || "Done." });
        const previewRows = payload.previewAll || payload.rows;
        renderPreview(previewRows);
        if (window.LRSMap) LRSMap.resize();
      } catch (err) {
        addLog({ level: "err", text: err.message || String(err) });
      } finally {
        siblings.forEach((btn) => {
          if (btn.dataset.export) {
            btn.disabled = !exports[btn.dataset.export];
          } else {
            btn.disabled = false;
          }
        });
      }
    });
  });

  updateSessionBanner();
})();
