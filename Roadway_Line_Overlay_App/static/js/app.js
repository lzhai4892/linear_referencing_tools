/**
 * Roadway Line-to-Line Overlay Tool • 100% Pure Client-Side Static App Controller
 * No backend server, Python, or port required!
 * Features:
 * - Pure In-browser spatial overlay engine (Turf.js, Proj4js, shpjs, SheetJS, PapaParse)
 * - Dynamic interactive column buttons & automatic ID expression generation
 * - Visual Scientific Matching Logic Guide Modal with vector diagrams
 * - Default scientific sort (Matched -> Angle Mismatch -> Unmatched)
 * - Dynamic interactive column sorting (ascending / descending) on all columns including Overlap (ft) and Overlap (mi)
 * - Dual-layer attribute inspection popup & smooth map zoom
 * - Export results located in Table toolbar (Excel .xlsx, GeoJSON .geojson, CSV .csv)
 * - Responsive sliding panel with flexible wrapping
 */

document.addEventListener("DOMContentLoaded", () => {
  let targetLayerData = null;
  let refLayerData = null;
  let currentResults = null;
  let currentTableData = [];
  let mapViewer = null;

  // Sorting State
  let activeSortColumn = null;
  let activeSortDirection = "asc"; // "asc" or "desc"

  try {
    mapViewer = new MapViewer("map-container");
    setTimeout(() => {
      if (mapViewer && mapViewer.map) mapViewer.map.invalidateSize();
    }, 250);
  } catch (err) {
    console.error("Map initialization error:", err);
  }

  window.addEventListener("resize", () => {
    if (mapViewer && mapViewer.map) mapViewer.map.invalidateSize();
  });

  // DOM Elements
  const sidebarPane = document.getElementById("sidebar-pane");
  const sidebarResizer = document.getElementById("sidebar-resizer");
  const mapPane = document.getElementById("map-pane");
  const gridPane = document.getElementById("grid-pane");
  const rowResizer = document.getElementById("row-resizer");

  const targetBlock = document.getElementById("target-block");
  const targetFileInput = document.getElementById("target-file-input");
  const targetFilename = document.getElementById("target-filename");
  const targetStatus = document.getElementById("target-status");
  const targetMeta = document.getElementById("target-meta");
  const targetCount = document.getElementById("target-count");
  const targetMultipart = document.getElementById("target-multipart");
  const targetCrs = document.getElementById("target-crs");
  const targetAlert = document.getElementById("target-alert");

  const refBlock = document.getElementById("ref-block");
  const refFileInput = document.getElementById("ref-file-input");
  const refFilename = document.getElementById("ref-filename");
  const refStatus = document.getElementById("ref-status");
  const refMeta = document.getElementById("ref-meta");
  const refCount = document.getElementById("ref-count");
  const refMultipart = document.getElementById("ref-multipart");
  const refCrs = document.getElementById("ref-crs");
  const refAlert = document.getElementById("ref-alert");

  const columnButtonsContainer = document.getElementById("column-buttons-container");
  const customExprInput = document.getElementById("custom-expr-input");
  const btnClearColumns = document.getElementById("btn-clear-columns");
  const btnResetExpr = document.getElementById("btn-reset-expr");

  const btnOpenGuide = document.getElementById("btn-open-guide");
  const btnCloseGuide = document.getElementById("btn-close-guide");
  const guideModal = document.getElementById("guide-modal");

  const btnLoadSample = document.getElementById("btn-load-sample");
  const btnRunOverlay = document.getElementById("btn-run-overlay");
  const progressContainer = document.getElementById("progress-container");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const progressLabel = document.getElementById("progress-label");

  const paletteSelect = document.getElementById("palette-select");
  const btnZoomExtent = document.getElementById("btn-zoom-extent");

  const tableSearchInput = document.getElementById("table-search-input");
  const statusFilter = document.getElementById("status-filter");
  const resultsTable = document.getElementById("results-table");
  const tableBody = document.getElementById("table-body");
  const tableCountDisplay = document.getElementById("table-count-display");
  const tableSortIndicator = document.getElementById("table-sort-indicator");

  // ----------------------------------------------------
  // Toast Helper
  // ----------------------------------------------------
  function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const icon = type === "success" ? "check" : type === "error" ? "circle-exclamation" : "circle-info";
    toast.innerHTML = `<i class="fa-solid fa-${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 250);
    }, 4500);
  }

  // ----------------------------------------------------
  // Tolerance Visual Guide Modal
  // ----------------------------------------------------
  if (btnOpenGuide && guideModal) {
    btnOpenGuide.addEventListener("click", () => {
      guideModal.classList.remove("hidden");
    });
  }

  if (btnCloseGuide && guideModal) {
    btnCloseGuide.addEventListener("click", () => {
      guideModal.classList.add("hidden");
    });
  }

  if (guideModal) {
    guideModal.addEventListener("click", (e) => {
      if (e.target === guideModal) {
        guideModal.classList.add("hidden");
      }
    });
  }

  // ----------------------------------------------------
  // Draggable Splitters (Sidebar Width & Map/Table Height)
  // ----------------------------------------------------
  function initResizers() {
    if (sidebarResizer && sidebarPane) {
      let isDraggingSidebar = false;

      sidebarResizer.addEventListener("mousedown", (e) => {
        isDraggingSidebar = true;
        sidebarResizer.classList.add("dragging");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
      });

      window.addEventListener("mousemove", (e) => {
        if (!isDraggingSidebar) return;
        const newWidth = Math.max(270, Math.min(window.innerWidth - 340, e.clientX));
        sidebarPane.style.width = `${newWidth}px`;
        if (mapViewer && mapViewer.map) {
          mapViewer.map.invalidateSize();
        }
      });

      window.addEventListener("mouseup", () => {
        if (isDraggingSidebar) {
          isDraggingSidebar = false;
          sidebarResizer.classList.remove("dragging");
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          if (mapViewer && mapViewer.map) {
            mapViewer.map.invalidateSize();
          }
        }
      });
    }

    if (rowResizer && mapPane && gridPane) {
      let isDraggingRow = false;
      const workstation = document.getElementById("workstation-pane");

      rowResizer.addEventListener("mousedown", (e) => {
        isDraggingRow = true;
        rowResizer.classList.add("dragging");
        document.body.style.cursor = "row-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
      });

      window.addEventListener("mousemove", (e) => {
        if (!isDraggingRow) return;
        const workstationRect = workstation.getBoundingClientRect();
        const offsetTop = e.clientY - workstationRect.top;
        const totalHeight = workstationRect.height;
        const mapHeight = Math.max(160, Math.min(totalHeight - 140, offsetTop));
        
        mapPane.style.flex = "none";
        mapPane.style.height = `${mapHeight}px`;
        gridPane.style.flex = "1";

        if (mapViewer && mapViewer.map) {
          mapViewer.map.invalidateSize();
        }
      });

      window.addEventListener("mouseup", () => {
        if (isDraggingRow) {
          isDraggingRow = false;
          rowResizer.classList.remove("dragging");
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          if (mapViewer && mapViewer.map) {
            mapViewer.map.invalidateSize();
          }
        }
      });
    }
  }

  initResizers();

  // ----------------------------------------------------
  // Color Palette Selector
  // ----------------------------------------------------
  if (paletteSelect) {
    paletteSelect.addEventListener("change", (e) => {
      if (mapViewer) {
        mapViewer.setPalette(e.target.value);
        showToast(`Theme updated to ${PALETTES[e.target.value].name}`, "info");
      }
    });
  }

  // ----------------------------------------------------
  // Drag & Drop and File Ingestion (100% In-Browser)
  // ----------------------------------------------------
  function setupDropZone(dropElement, fileInput, role) {
    if (!dropElement) return;

    ["dragenter", "dragover"].forEach((eventName) => {
      dropElement.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropElement.classList.add("drag-over");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropElement.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropElement.classList.remove("drag-over");
      });
    });

    dropElement.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        handleClientFileUpload(dt.files, role);
      }
    });

    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleClientFileUpload(e.target.files, role);
        }
      });
    }
  }

  setupDropZone(targetBlock, targetFileInput, "target");
  setupDropZone(refBlock, refFileInput, "reference");

  async function handleClientFileUpload(fileList, role) {
    const displayName = fileList.length === 1 ? fileList[0].name : `${fileList[0].name} (+${fileList.length - 1} files)`;
    showToast(`Parsing ${displayName} in browser...`, "info");

    try {
      const layerInfo = await ClientGISEngine.parseUploadedFiles(fileList);

      if (role === "target") {
        targetLayerData = layerInfo;
        updateTargetUI(layerInfo);
        if (mapViewer) mapViewer.displayTargetPreview(layerInfo.geojson);
      } else {
        refLayerData = layerInfo;
        updateRefUI(layerInfo);
        if (mapViewer) mapViewer.displayReferenceLayer(layerInfo.geojson);
        populateReferenceColumns(layerInfo.columns);
      }

      showToast(`Loaded ${layerInfo.feature_count} features from ${layerInfo.layer_name}`, "success");
    } catch (err) {
      console.error("Client GIS Parse Error:", err);
      showToast(`Layer parsing error: ${err.message}`, "error");
    }
  }

  function updateTargetUI(info) {
    targetFilename.textContent = info.layer_name;
    targetFilename.title = info.layer_name;
    targetStatus.textContent = `${info.feature_count} features`;
    targetCount.textContent = info.feature_count.toLocaleString();
    targetMultipart.textContent = info.multipart_count.toLocaleString();
    targetCrs.textContent = info.source_crs;
    targetCrs.title = info.source_crs;
    targetMeta.classList.remove("hidden");

    if (info.warnings && info.warnings.length > 0) {
      targetAlert.classList.remove("hidden");
      targetAlert.textContent = info.warnings[0];
    } else {
      targetAlert.classList.add("hidden");
    }
  }

  function updateRefUI(info) {
    refFilename.textContent = info.layer_name;
    refFilename.title = info.layer_name;
    refStatus.textContent = `${info.feature_count} features`;
    refCount.textContent = info.feature_count.toLocaleString();
    refMultipart.textContent = info.multipart_count.toLocaleString();
    refCrs.textContent = info.source_crs;
    refCrs.title = info.source_crs;
    refMeta.classList.remove("hidden");

    if (info.warnings && info.warnings.length > 0) {
      refAlert.classList.remove("hidden");
      refAlert.textContent = info.warnings[0];
    } else {
      refAlert.classList.add("hidden");
    }
  }

  // ----------------------------------------------------
  // Section 2: Combined Column Buttons & Expression Sync
  // ----------------------------------------------------
  function populateReferenceColumns(columns) {
    columnButtonsContainer.innerHTML = "";

    if (!columns || columns.length === 0) {
      columnButtonsContainer.innerHTML = '<span class="empty-hint">No attributes found in reference layer</span>';
      return;
    }

    // Default active columns
    const preferredCols = ["ITEMSEG", "high_yr_ph", "ROADWAY", "DESC", "PHASE", "FISCAL_YR"];
    const defaultActives = [];

    columns.forEach((col) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sci-col-btn";
      btn.dataset.col = col;
      btn.innerHTML = `<span class="col-name">${col}</span>`;

      // Check default selection
      if (preferredCols.includes(col)) {
        if (defaultActives.length < 2) {
          btn.classList.add("active");
          defaultActives.push(col);
        }
      }

      btn.addEventListener("click", () => {
        btn.classList.toggle("active");
        updateExpressionFromActiveButtons();
      });

      columnButtonsContainer.appendChild(btn);
    });

    // If no preferred columns matched, activate first column
    if (defaultActives.length === 0 && columns.length > 0) {
      const firstBtn = columnButtonsContainer.querySelector(".sci-col-btn");
      if (firstBtn) firstBtn.classList.add("active");
    }

    updateExpressionFromActiveButtons();
  }

  function updateExpressionFromActiveButtons() {
    const activeBtns = columnButtonsContainer.querySelectorAll(".sci-col-btn.active");
    const activeCols = Array.from(activeBtns).map((b) => b.dataset.col);

    if (activeCols.length === 0) {
      customExprInput.value = "";
    } else {
      customExprInput.value = activeCols.map((c) => `{${c}}`).join(" - ");
    }
  }

  function syncActiveButtonsFromExpression() {
    const text = customExprInput.value;
    const tokens = (text.match(/\{([^}]+)\}/g) || []).map((t) => t.replace(/[{}]/g, "").trim());

    columnButtonsContainer.querySelectorAll(".sci-col-btn").forEach((btn) => {
      const col = btn.dataset.col;
      if (tokens.includes(col)) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  if (customExprInput) {
    customExprInput.addEventListener("input", syncActiveButtonsFromExpression);
  }

  if (btnClearColumns) {
    btnClearColumns.addEventListener("click", () => {
      columnButtonsContainer.querySelectorAll(".sci-col-btn").forEach((b) => b.classList.remove("active"));
      customExprInput.value = "";
    });
  }

  if (btnResetExpr) {
    btnResetExpr.addEventListener("click", () => {
      updateExpressionFromActiveButtons();
    });
  }

  // ----------------------------------------------------
  // Load Embedded Florida Sample Data (Instant & Offline)
  // ----------------------------------------------------
  btnLoadSample.addEventListener("click", () => {
    try {
      if (!window.SAMPLE_TARGET_DATA || !window.SAMPLE_REFERENCE_DATA) {
        showToast("Sample data script not loaded.", "error");
        return;
      }

      const targetInfo = ClientGISEngine.cleanAndExplodeLayer(window.SAMPLE_TARGET_DATA, "Sample Bottlenecks (Target)");
      targetLayerData = targetInfo;
      updateTargetUI(targetInfo);
      if (mapViewer) mapViewer.displayTargetPreview(targetInfo.geojson);

      const refInfo = ClientGISEngine.cleanAndExplodeLayer(window.SAMPLE_REFERENCE_DATA, "Sample Work Program (Reference)");
      refLayerData = refInfo;
      updateRefUI(refInfo);
      if (mapViewer) mapViewer.displayReferenceLayer(refInfo.geojson);
      populateReferenceColumns(refInfo.columns);

      if (refInfo.columns.includes("ITEMSEG") && refInfo.columns.includes("high_yr_ph")) {
        customExprInput.value = "{ITEMSEG} - {high_yr_ph}";
        syncActiveButtonsFromExpression();
      }

      showToast("Sample Florida bottleneck datasets loaded successfully.", "success");
    } catch (err) {
      console.error("Load sample error:", err);
      showToast(`Failed to load sample data: ${err.message}`, "error");
    }
  });

  // ----------------------------------------------------
  // Run Line-to-Line Overlay (100% In-Browser Engine)
  // ----------------------------------------------------
  btnRunOverlay.addEventListener("click", () => {
    if (!targetLayerData || !refLayerData) {
      showToast("Please load both Destination and Reference layers first.", "error");
      return;
    }

    const activeBtns = columnButtonsContainer.querySelectorAll(".sci-col-btn.active");
    const selectedCols = Array.from(activeBtns).map((b) => b.dataset.col);
    const customTemplate = customExprInput.value.trim();
    const duplicateMode = document.querySelector('input[name="duplicate-mode"]:checked').value;
    const bufferDist = parseFloat(document.getElementById("param-buffer").value) || 300;
    const minOverlap = parseFloat(document.getElementById("param-min-overlap").value) || 300;
    const targetRatio = parseFloat(document.getElementById("param-target-ratio").value) || 30;
    const maxAngle = parseFloat(document.getElementById("param-max-angle").value) || 30;
    const enableFallback = document.getElementById("param-fallback-toggle").checked;

    btnRunOverlay.disabled = true;
    progressContainer.classList.remove("hidden");
    progressBarFill.style.width = "40%";
    progressLabel.textContent = "Computing spatial overlay in browser...";

    setTimeout(() => {
      try {
        const options = {
          buffer_distance: bufferDist,
          min_overlap_length: minOverlap,
          min_target_overlap_ratio: targetRatio,
          max_angle_diff_deg: maxAngle,
          enable_strong_fallback: enableFallback,
          reference_columns: selectedCols.length > 0 ? selectedCols : (refLayerData.columns ? [refLayerData.columns[0]] : []),
          custom_expression_template: customTemplate || null,
          keep_duplicates: duplicateMode === "keep"
        };

        const result = ClientGISEngine.runOverlayAnalysis(
          targetLayerData.geojson,
          refLayerData.geojson,
          options
        );

        progressBarFill.style.width = "100%";
        progressLabel.textContent = "Complete";

        currentResults = result;
        currentTableData = result.table_data;

        // Reset to Default Scientific Sort
        activeSortColumn = null;
        activeSortDirection = "asc";

        // Update KPI Stats
        document.getElementById("stat-total").textContent = result.stats.total_targets;
        document.getElementById("stat-matched").textContent = result.stats.matched_targets;
        document.getElementById("stat-unmatched").textContent = result.stats.unmatched_targets;
        document.getElementById("stat-rate").textContent = `${result.stats.match_percentage}%`;
        document.getElementById("stat-time").textContent = `${result.stats.duration_seconds}s`;

        // Update Map
        if (mapViewer) {
          mapViewer.displayOverlayResults(result.geojson, (feature) => {
            highlightTableRow(feature.properties);
          });
        }

        // Apply filters & render sorted table
        applyTableFiltersAndSort();

        showToast(`Matched ${result.stats.matched_targets} of ${result.stats.total_targets} segments in ${result.stats.duration_seconds}s.`, "success");
      } catch (err) {
        console.error("Overlay calculation error:", err);
        showToast(`Overlay Error: ${err.message}`, "error");
      } finally {
        btnRunOverlay.disabled = false;
        setTimeout(() => progressContainer.classList.add("hidden"), 600);
      }
    }, 50);
  });

  // ----------------------------------------------------
  // Scientific Sorting Logic (Matched -> Angle Mismatch -> Unmatched)
  // ----------------------------------------------------
  function getScientificRank(row) {
    const stat = (row.Match_Stat || row.Match_Status || "").toLowerCase();
    const qc = (row.QC_Flag || "").toLowerCase();
    if (stat.includes("on corridor") || qc.includes("verified")) return 1;
    if (qc.includes("angle")) return 2;
    if (qc.includes("overlap") || qc.includes("low")) return 3;
    return 4; // Unmatched / other
  }

  function sortRecords(records) {
    const sorted = [...records];

    if (!activeSortColumn) {
      // Default Scientific Sort
      sorted.sort((a, b) => {
        const rankA = getScientificRank(a);
        const rankB = getScientificRank(b);
        if (rankA !== rankB) return rankA - rankB;
        // Secondary sort by overlap length descending
        return (b.Ovl_Ft || 0) - (a.Ovl_Ft || 0);
      });
      if (tableSortIndicator) {
        tableSortIndicator.textContent = "Default Scientific Sort (Matched → Angle Mismatch → Unmatched)";
      }
      return sorted;
    }

    // Dynamic Column Sorting
    sorted.sort((a, b) => {
      let valA = a[activeSortColumn];
      let valB = b[activeSortColumn];

      if (valA === undefined || valA === null) valA = "";
      if (valB === undefined || valB === null) valB = "";

      let comparison = 0;
      if (typeof valA === "number" && typeof valB === "number") {
        comparison = valA - valB;
      } else {
        comparison = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: "base" });
      }

      return activeSortDirection === "asc" ? comparison : -comparison;
    });

    if (tableSortIndicator) {
      tableSortIndicator.textContent = `Sorted by ${activeSortColumn} (${activeSortDirection.toUpperCase()})`;
    }
    return sorted;
  }

  // ----------------------------------------------------
  // Table Column Header Click to Sort
  // ----------------------------------------------------
  if (resultsTable) {
    resultsTable.querySelectorAll("th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.getAttribute("data-col");
        if (!col) return;

        if (activeSortColumn === col) {
          activeSortDirection = activeSortDirection === "asc" ? "desc" : "asc";
        } else {
          activeSortColumn = col;
          const isNumeric = ["Match_Cnt", "Ovl_Ft", "Ovl_Mi", "Ovl_Pct", "Ang_Dif", "Min_Ft"].includes(col);
          activeSortDirection = isNumeric ? "desc" : "asc";
        }

        // Update header sort icons
        resultsTable.querySelectorAll("th.sortable").forEach((h) => {
          h.classList.remove("sorted-asc", "sorted-desc");
          const icon = h.querySelector(".sort-icon");
          if (icon) icon.className = "fa-solid fa-sort sort-icon";
        });

        th.classList.add(activeSortDirection === "asc" ? "sorted-asc" : "sorted-desc");
        const activeIcon = th.querySelector(".sort-icon");
        if (activeIcon) {
          activeIcon.className = `fa-solid fa-sort-${activeSortDirection === "asc" ? "up" : "down"} sort-icon`;
        }

        applyTableFiltersAndSort();
      });
    });
  }

  // ----------------------------------------------------
  // Table Rendering & Filters
  // ----------------------------------------------------
  function applyTableFiltersAndSort() {
    const query = tableSearchInput.value.toLowerCase().trim();
    const statusVal = statusFilter.value;

    const filtered = currentTableData.filter((row) => {
      const status = row.Match_Stat || row.Match_Status || "Off Corridor";
      if (statusVal !== "ALL" && status !== statusVal) return false;
      if (query) {
        const rowStr = Object.values(row).join(" ").toLowerCase();
        return rowStr.includes(query);
      }
      return true;
    });

    const sorted = sortRecords(filtered);
    renderTable(sorted);
  }

  function renderTable(records) {
    tableBody.innerHTML = "";
    if (!records || records.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="9" class="table-empty-msg">No records match the current filter.</td></tr>`;
      tableCountDisplay.textContent = "Showing 0 of 0 records";
      return;
    }

    records.forEach((row, idx) => {
      const tr = document.createElement("tr");
      tr.id = `row-${idx}`;
      tr.dataset.origFid = row._orig_fid !== undefined ? row._orig_fid : idx;

      const status = row.Match_Stat || row.Match_Status || "Off Corridor";
      const isMatched = status === "On Corridor";
      const statusBadge = `<span class="table-badge ${isMatched ? 'on' : 'off'}">${status}</span>`;

      const overlapFtStr = row.Ovl_Ft !== undefined && row.Ovl_Ft !== null ? `${row.Ovl_Ft.toLocaleString()} ft` : "-";
      const overlapMiStr = row.Ovl_Mi !== undefined && row.Ovl_Mi !== null ? `${row.Ovl_Mi.toFixed(2)} mi` : (row.Ovl_Ft !== undefined ? `${(row.Ovl_Ft / 5280).toFixed(2)} mi` : "-");
      const minDistStr = row.Min_Ft !== undefined && row.Min_Ft !== null ? `${row.Min_Ft} ft` : "-";

      tr.innerHTML = `
        <td>${statusBadge}</td>
        <td style="color: ${isMatched ? 'var(--match-color)' : 'var(--text-secondary)'}; font-weight: ${isMatched ? '600' : '400'}; font-family: var(--font-mono);">${row.Matched_ID || '-'}</td>
        <td>${row.Match_Cnt !== undefined ? row.Match_Cnt : '-'}</td>
        <td>${overlapFtStr}</td>
        <td>${overlapMiStr}</td>
        <td>${row.Ovl_Pct !== undefined ? row.Ovl_Pct + '%' : '-'}</td>
        <td>${row.Ang_Dif !== undefined && row.Ang_Dif !== null ? row.Ang_Dif + '°' : '-'}</td>
        <td>${minDistStr}</td>
        <td><span style="color: ${row.QC_Flag && row.QC_Flag.startsWith('Verified') ? 'var(--match-color)' : 'var(--warn-color)'}; font-weight: 500;">${row.QC_Flag || '-'}</span></td>
      `;

      // Interactive Click: Zoom & Dual Inspection Popup
      tr.addEventListener("click", () => {
        document.querySelectorAll(".sci-table tr").forEach((r) => r.classList.remove("selected"));
        tr.classList.add("selected");
        if (mapViewer) {
          const fid = row._orig_fid !== undefined ? row._orig_fid : idx;
          mapViewer.zoomToFeatureById(fid, row);
        }
      });

      tableBody.appendChild(tr);
    });

    tableCountDisplay.textContent = `Showing ${records.length} of ${currentTableData.length} records`;
  }

  function highlightTableRow(props) {
    const fid = props._orig_fid;
    const rows = tableBody.querySelectorAll("tr");
    rows.forEach((r) => {
      r.classList.remove("selected");
      if (fid !== undefined && r.dataset.origFid === String(fid)) {
        r.classList.add("selected");
        r.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }

  tableSearchInput.addEventListener("input", applyTableFiltersAndSort);
  statusFilter.addEventListener("change", applyTableFiltersAndSort);

  // ----------------------------------------------------
  // Map Tools
  // ----------------------------------------------------
  if (btnZoomExtent) {
    btnZoomExtent.addEventListener("click", () => {
      if (mapViewer) mapViewer.fitBounds();
    });
  }

  // ----------------------------------------------------
  // Export Results Dropdown Menu (Under Table Header)
  // ----------------------------------------------------
  const btnTableExport = document.getElementById("btn-table-export");
  const tableExportMenu = document.getElementById("table-export-menu");

  if (btnTableExport && tableExportMenu) {
    btnTableExport.addEventListener("click", (e) => {
      e.stopPropagation();
      tableExportMenu.classList.toggle("show");
    });

    tableExportMenu.addEventListener("click", (e) => {
      const item = e.target.closest(".dropdown-item");
      if (!item) return;
      if (!currentResults || !currentTableData || currentTableData.length === 0) {
        showToast("Please run overlay analysis before exporting.", "error");
        return;
      }

      const format = item.getAttribute("data-format");
      showToast(`Generating ${format.toUpperCase()} export in browser...`, "info");

      try {
        if (format === "geojson") {
          ClientGISEngine.exportGeoJSON(currentResults.geojson, "roadway_overlay_results.geojson");
        } else if (format === "csv") {
          ClientGISEngine.exportCSV(currentTableData, "roadway_overlay_results.csv");
        } else if (format === "excel") {
          ClientGISEngine.exportExcel(currentTableData, "roadway_overlay_results.xlsx");
        }
        showToast(`Exported ${format.toUpperCase()} successfully.`, "success");
      } catch (err) {
        console.error("Export error:", err);
        showToast(`Export failed: ${err.message}`, "error");
      }
    });
  }

  document.addEventListener("click", () => {
    if (tableExportMenu) tableExportMenu.classList.remove("show");
  });
});
