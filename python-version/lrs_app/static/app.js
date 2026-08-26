const statusEl = document.getElementById("status");
const previewWrap = document.getElementById("preview-wrap");
const previewMeta = document.getElementById("preview-meta");
const previewTable = document.getElementById("preview");

function splitCols(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function showStatus(message, ok) {
  statusEl.hidden = false;
  statusEl.className = `status ${ok ? "ok" : "err"}`;
  statusEl.textContent = message;
}

function renderPreview(payload) {
  previewWrap.hidden = false;
  const extra = payload.unmatched_rows != null ? ` Unmatched: ${payload.unmatched_rows}.` : "";
  const geom = payload.with_geometry != null ? ` Geometries written: ${payload.with_geometry}.` : "";
  previewMeta.textContent = `${payload.rows} rows written to ${payload.output_path}.${extra}${geom}`;
  const cols = payload.columns || [];
  const rows = payload.preview || [];
  previewTable.innerHTML = "";
  const head = document.createElement("tr");
  cols.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col;
    head.appendChild(th);
  });
  previewTable.appendChild(head);
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    cols.forEach((col) => {
      const td = document.createElement("td");
      const value = row[col];
      td.textContent = value == null ? "" : value;
      tr.appendChild(td);
    });
    previewTable.appendChild(tr);
  });
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || response.statusText);
  }
  return data;
}

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((el) => el.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((el) => el.classList.remove("active"));
    button.classList.add("active");
    document.getElementById(button.dataset.tab).classList.add("active");
  });
});

function fillSelect(selectId, columns, selected, blankLabel) {
  const select = document.getElementById(selectId);
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

async function loadFields(pathInputId) {
  const path = document.getElementById(pathInputId).value;
  if (!path) {
    throw new Error("Choose a file first.");
  }
  const data = await api("/api/columns", { path });
  if (pathInputId === "ex-routes") {
    fillSelect("ex-seg", data.columns, data.schema.roadway);
    fillSelect("ex-bmp", data.columns, data.schema.bmp);
    fillSelect("ex-emp", data.columns, data.schema.emp);
  }
  if (pathInputId === "ex-events") {
    fillSelect("ex-ev-seg", data.columns, data.schema.roadway, "Same as source / auto");
    fillSelect("ex-ev-bmp", data.columns, data.schema.bmp, "Same as source / auto");
    fillSelect("ex-ev-emp", data.columns, data.schema.emp, "Same as source / auto");
  }
  return data;
}

document.querySelectorAll("[data-browse]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      const data = await api("/api/browse", { kind: button.dataset.kind || "file" });
      if (data.path) {
        document.getElementById(button.dataset.browse).value = data.path;
        if (button.dataset.load) {
          await loadFields(button.dataset.load);
        }
      }
    } catch (err) {
      showStatus(`Browse unavailable (${err.message}). Type a local path instead.`, false);
    }
  });
});

document.querySelectorAll("[data-load-fields]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      const data = await loadFields(button.dataset.loadFields);
      showStatus(`Loaded ${data.columns.length} fields from ${data.rows} rows.`, true);
    } catch (err) {
      showStatus(err.message, false);
    }
  });
});

document.getElementById("ex-fmt").addEventListener("change", () => {
  const output = document.getElementById("ex-output");
  const fmt = document.getElementById("ex-fmt").value;
  if (!output.value) return;
  output.value = output.value.replace(/\.(shp|geojson|json|gpkg)$/i, "") + (fmt === "shp" ? ".shp" : ".geojson");
});

const runners = {
  overlay: () =>
    api("/api/overlay", {
      target_path: document.getElementById("ov-target").value,
      overlay_path: document.getElementById("ov-overlay").value,
      output_path: document.getElementById("ov-output").value,
      how: document.getElementById("ov-how").value,
      collapse: document.getElementById("ov-collapse").value,
      group_cols: splitCols(document.getElementById("ov-groups").value),
    }),
  dissolve: () =>
    api("/api/dissolve", {
      input_path: document.getElementById("ds-input").value,
      output_path: document.getElementById("ds-output").value,
      group_cols: splitCols(document.getElementById("ds-groups").value),
      require_contiguous: document.getElementById("ds-contig").checked,
    }),
  locate: () =>
    api("/api/locate", {
      points_path: document.getElementById("lc-points").value,
      events_path: document.getElementById("lc-events").value,
      output_path: document.getElementById("lc-output").value,
      unmatched_path: document.getElementById("lc-unmatched").value || null,
    }),
  clip: () =>
    api("/api/clip", {
      events_path: document.getElementById("cl-events").value,
      routes_path: document.getElementById("cl-routes").value,
      output_path: document.getElementById("cl-output").value,
    }),
  export: () =>
    api("/api/export_geometry", {
      routes_path: document.getElementById("ex-routes").value,
      output_path: document.getElementById("ex-output").value,
      segment_id: document.getElementById("ex-seg").value,
      start_post: document.getElementById("ex-bmp").value,
      end_post: document.getElementById("ex-emp").value,
      events_path: document.getElementById("ex-events").value || null,
      event_segment_id: document.getElementById("ex-ev-seg").value || null,
      event_start_post: document.getElementById("ex-ev-bmp").value || null,
      event_end_post: document.getElementById("ex-ev-emp").value || null,
      fmt: document.getElementById("ex-fmt").value,
    }),
};

document.querySelectorAll("[data-run]").forEach((button) => {
  button.addEventListener("click", async () => {
    const kind = button.dataset.run;
    showStatus("Running…", true);
    try {
      const payload = await runners[kind]();
      showStatus(`Finished. ${payload.rows} rows.`, true);
      renderPreview(payload);
    } catch (err) {
      showStatus(err.message, false);
    }
  });
});
