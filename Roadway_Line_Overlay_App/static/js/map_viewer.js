/**
 * Leaflet Map Controller for Roadway Line-to-Line Overlay Tool.
 * Supports: Dynamic Muted Color Palettes, Interactive Feature Zoom, Dual-Layer Inspection Popups, and Glow Highlighting.
 */

const PALETTES = {
  forest: {
    name: "Forest & Slate",
    matched: "#2e5b38",
    matchedBg: "#f2f7f3",
    matchedBorder: "#d1e7d6",
    unmatched: "#52525b",
    unmatchedBg: "#f4f4f5",
    unmatchedBorder: "#e4e4e7",
    ref: "#78350f",
    refBg: "#fefce8",
    refBorder: "#fef08a",
    highlight: "#15803d"
  },
  nordic: {
    name: "Nordic Teal & Amber",
    matched: "#0e7490",
    matchedBg: "#ecfeff",
    matchedBorder: "#cffafe",
    unmatched: "#475569",
    unmatchedBg: "#f1f5f9",
    unmatchedBorder: "#e2e8f0",
    ref: "#b45309",
    refBg: "#fffbeb",
    refBorder: "#fde68a",
    highlight: "#0891b2"
  },
  indigo: {
    name: "Indigo & Burgundy",
    matched: "#4338ca",
    matchedBg: "#eef2ff",
    matchedBorder: "#e0e7ff",
    unmatched: "#64748b",
    unmatchedBg: "#f8fafc",
    unmatchedBorder: "#e2e8f0",
    ref: "#9f1239",
    refBg: "#fff1f2",
    refBorder: "#fecdd3",
    highlight: "#6366f1"
  },
  olive: {
    name: "Charcoal & Olive",
    matched: "#3f6212",
    matchedBg: "#f7fee7",
    matchedBorder: "#ecfccb",
    unmatched: "#3f3f46",
    unmatchedBg: "#f4f4f5",
    unmatchedBorder: "#e4e4e7",
    ref: "#854d0e",
    refBg: "#fefce8",
    refBorder: "#fef08a",
    highlight: "#4d7c0f"
  }
};

class MapViewer {
  constructor(containerId = "map-container") {
    this.containerId = containerId;
    this.map = null;
    this.targetLayerGroup = null;
    this.refLayerGroup = null;
    this.resultLayerGroup = null;
    this.highlightLayerGroup = null;
    this.currentPalette = "forest";
    this.latestResultGeoJSON = null;
    this.latestRefGeoJSON = null;
    this.latestTargetGeoJSON = null;
    this.unitMode = "ft"; // "ft" or "mi"
    this.featureLayerMap = new Map();

    this.initMap();
  }

  initMap() {
    // Default centered on Florida
    this.map = L.map(this.containerId, {
      center: [28.5383, -81.3792],
      zoom: 8,
      zoomControl: true,
    });

    // CartoDB Positron (Clean Light Scientific Basemap)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> | &copy; OpenStreetMap',
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(this.map);

    this.refLayerGroup = L.featureGroup().addTo(this.map);
    this.targetLayerGroup = L.featureGroup().addTo(this.map);
    this.resultLayerGroup = L.featureGroup().addTo(this.map);
    this.highlightLayerGroup = L.featureGroup().addTo(this.map);
  }

  setUnitMode(mode) {
    this.unitMode = mode;
  }

  setPalette(paletteKey) {
    if (!PALETTES[paletteKey]) return;
    this.currentPalette = paletteKey;
    const pal = PALETTES[paletteKey];

    // Update CSS custom properties for dynamic legend & table badge sync
    const root = document.documentElement;
    root.style.setProperty("--match-color", pal.matched);
    root.style.setProperty("--match-bg", pal.matchedBg);
    root.style.setProperty("--match-border", pal.matchedBorder);
    root.style.setProperty("--unmatch-color", pal.unmatched);
    root.style.setProperty("--unmatch-bg", pal.unmatchedBg);
    root.style.setProperty("--unmatch-border", pal.unmatchedBorder);
    root.style.setProperty("--ref-color", pal.ref);
    root.style.setProperty("--ref-bg", pal.refBg);
    root.style.setProperty("--ref-border", pal.refBorder);

    // Refresh map layer styles
    if (this.latestRefGeoJSON) {
      this.displayReferenceLayer(this.latestRefGeoJSON, false);
    }
    if (this.latestResultGeoJSON) {
      this.displayOverlayResults(this.latestResultGeoJSON, this.onResultFeatureClick, false);
    } else if (this.latestTargetGeoJSON) {
      this.displayTargetPreview(this.latestTargetGeoJSON, false);
    }
  }

  clearAll() {
    this.refLayerGroup.clearLayers();
    this.targetLayerGroup.clearLayers();
    this.resultLayerGroup.clearLayers();
    this.highlightLayerGroup.clearLayers();
    this.featureLayerMap.clear();
  }

  displayReferenceLayer(geojson, autoFit = true) {
    this.latestRefGeoJSON = geojson;
    this.refLayerGroup.clearLayers();
    if (!geojson || !geojson.features || geojson.features.length === 0) return;

    const pal = PALETTES[this.currentPalette];

    const layer = L.geoJSON(geojson, {
      style: {
        color: pal.ref,
        weight: 3,
        opacity: 0.85,
        dashArray: "4, 4",
      },
      onEachFeature: (feature, l) => {
        const props = feature.properties || {};
        let content = `<div class="map-popup-card">`;
        content += `<div class="popup-header ref-hdr"><i class="fa-solid fa-road"></i> Reference Roadway Segment</div>`;
        content += `<table class="popup-attr-table">`;
        for (const [k, v] of Object.entries(props)) {
          if (!k.startsWith("_") && k !== "geometry") {
            content += `<tr><td><b>${k}</b></td><td>${v !== null && v !== undefined ? v : "-"}</td></tr>`;
          }
        }
        content += `</table></div>`;
        l.bindPopup(content, { maxWidth: 350 });
      },
    });

    this.refLayerGroup.addLayer(layer);
    if (autoFit) this.fitBounds();
  }

  displayTargetPreview(geojson, autoFit = true) {
    this.latestTargetGeoJSON = geojson;
    this.targetLayerGroup.clearLayers();
    if (!geojson || !geojson.features || geojson.features.length === 0) return;

    const layer = L.geoJSON(geojson, {
      style: {
        color: "#334155",
        weight: 3.5,
        opacity: 0.9,
      },
      onEachFeature: (feature, l) => {
        const props = feature.properties || {};
        let content = `<div class="map-popup-card">`;
        content += `<div class="popup-header target-hdr"><i class="fa-solid fa-bullseye"></i> Target Corridor Segment</div>`;
        content += `<table class="popup-attr-table">`;
        for (const [k, v] of Object.entries(props)) {
          if (!k.startsWith("_") && k !== "geometry") {
            content += `<tr><td><b>${k}</b></td><td>${v !== null && v !== undefined ? v : "-"}</td></tr>`;
          }
        }
        content += `</table></div>`;
        l.bindPopup(content, { maxWidth: 350 });
      },
    });

    this.targetLayerGroup.addLayer(layer);
    if (autoFit) this.fitBounds();
  }

  displayOverlayResults(geojson, onFeatureClick, autoFit = true) {
    this.latestResultGeoJSON = geojson;
    this.onResultFeatureClick = onFeatureClick;
    this.targetLayerGroup.clearLayers();
    this.resultLayerGroup.clearLayers();
    this.highlightLayerGroup.clearLayers();
    this.featureLayerMap.clear();

    if (!geojson || !geojson.features || geojson.features.length === 0) return;

    const pal = PALETTES[this.currentPalette];

    const layer = L.geoJSON(geojson, {
      style: (feature) => {
        const props = feature.properties || {};
        const isMatched = props.Match_Stat === "On Corridor" || props.Match_Status === "On Corridor";
        return {
          color: isMatched ? pal.matched : pal.unmatched,
          weight: isMatched ? 4.5 : 2.5,
          opacity: isMatched ? 0.95 : 0.7,
        };
      },
      onEachFeature: (feature, l) => {
        const fid = feature.properties._orig_fid !== undefined ? feature.properties._orig_fid : feature.id;
        this.featureLayerMap.set(String(fid), l);

        const popupContent = this.generateDualLayerPopupContent(feature);
        l.bindPopup(popupContent, { maxWidth: 450, className: "dual-layer-leaflet-popup" });

        l.on("click", () => {
          this.highlightFeature(feature);
          if (onFeatureClick) onFeatureClick(feature);
        });
      },
    });

    this.resultLayerGroup.addLayer(layer);
    if (autoFit) this.fitBounds();
  }

  generateDualLayerPopupContent(feature) {
    const props = feature.properties || {};
    const isMatched = props.Match_Stat === "On Corridor" || props.Match_Status === "On Corridor";
    const pal = PALETTES[this.currentPalette];

    let html = `<div class="dual-popup-container">`;

    // Header Status Bar
    html += `
      <div class="dual-popup-status-bar" style="border-left: 4px solid ${isMatched ? pal.matched : pal.unmatched};">
        <div>
          <span class="popup-badge ${isMatched ? 'match' : 'unmatch'}">${props.Match_Stat || 'Segment'}</span>
          <span class="popup-qc-badge">${props.QC_Flag || 'Verified'}</span>
        </div>
        <div class="popup-sub-metrics font-mono">
          ${props.Ovl_Ft !== undefined ? `<span><b>${props.Ovl_Pct}%</b> ovl (${props.Ovl_Ft.toLocaleString()} ft)</span>` : ''}
        </div>
      </div>
    `;

    // Tab Header
    html += `
      <div class="popup-tabs">
        <button class="popup-tab-btn active" onclick="window._switchPopupTab(this, 'tab-target')">
          <i class="fa-solid fa-bullseye"></i> Destination Attributes
        </button>
        <button class="popup-tab-btn" onclick="window._switchPopupTab(this, 'tab-ref')">
          <i class="fa-solid fa-road"></i> Matched References (${props._matched_refs ? props._matched_refs.length : 0})
        </button>
      </div>
    `;

    // Tab Content 1: Destination (Target) Layer Table
    html += `<div class="popup-tab-pane active" id="tab-target"><table class="popup-attr-table">`;
    for (const [k, v] of Object.entries(props)) {
      if (!k.startsWith("_") && k !== "geometry" && k !== "Match_Stat" && k !== "QC_Flag" && k !== "Matched_ID") {
        html += `<tr><td><b>${k}</b></td><td>${v !== null && v !== undefined ? v : "-"}</td></tr>`;
      }
    }
    html += `</table></div>`;

    // Tab Content 2: Reference Roadway Matched Table
    html += `<div class="popup-tab-pane" id="tab-ref">`;
    if (props._matched_refs && props._matched_refs.length > 0) {
      props._matched_refs.forEach((refItem, idx) => {
        html += `
          <div class="ref-match-item">
            <div class="ref-item-title">
              <strong>#${idx + 1}: ${refItem.tag || 'Ref Match'}</strong>
              <span class="font-mono text-muted">${refItem.overlap_ft.toLocaleString()} ft (${refItem.overlap_pct}%) • ∠${refItem.angle_diff}°</span>
            </div>
            <table class="popup-attr-table">
        `;
        for (const [rk, rv] of Object.entries(refItem.properties || {})) {
          if (!rk.startsWith("_") && rk !== "geometry") {
            html += `<tr><td><b>${rk}</b></td><td>${rv !== null && rv !== undefined ? rv : "-"}</td></tr>`;
          }
        }
        html += `</table></div>`;
      });
    } else {
      html += `<div class="popup-empty-msg"><i class="fa-solid fa-info-circle"></i> No reference roadway features overlapped within buffer and angle tolerances.</div>`;
    }
    html += `</div>`;

    html += `</div>`;
    return html;
  }

  highlightFeature(feature) {
    this.highlightLayerGroup.clearLayers();
    if (!feature || !feature.geometry) return;

    const pal = PALETTES[this.currentPalette];

    const glowLayer = L.geoJSON(feature, {
      style: {
        color: pal.highlight,
        weight: 8,
        opacity: 0.7,
        lineCap: "round",
        lineJoin: "round"
      }
    });

    const innerLayer = L.geoJSON(feature, {
      style: {
        color: "#ffffff",
        weight: 3,
        opacity: 0.95
      }
    });

    this.highlightLayerGroup.addLayer(glowLayer);
    this.highlightLayerGroup.addLayer(innerLayer);
  }

  zoomToFeatureById(origFid, targetProps) {
    const layer = this.featureLayerMap.get(String(origFid));
    if (layer) {
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        this.map.flyToBounds(bounds, { maxZoom: 15, padding: [50, 50], duration: 0.6 });
        layer.openPopup();
        if (layer.feature) {
          this.highlightFeature(layer.feature);
        }
      }
    }
  }

  fitBounds() {
    const allBounds = L.latLngBounds([]);
    if (this.refLayerGroup.getLayers().length > 0) {
      allBounds.extend(this.refLayerGroup.getBounds());
    }
    if (this.targetLayerGroup.getLayers().length > 0) {
      allBounds.extend(this.targetLayerGroup.getBounds());
    }
    if (this.resultLayerGroup.getLayers().length > 0) {
      allBounds.extend(this.resultLayerGroup.getBounds());
    }

    if (allBounds.isValid()) {
      this.map.fitBounds(allBounds, { padding: [25, 25] });
    }
  }
}

// Global helper for popup tab switching
window._switchPopupTab = function(btn, tabId) {
  const container = btn.closest(".dual-popup-container");
  if (!container) return;
  container.querySelectorAll(".popup-tab-btn").forEach(b => b.classList.remove("active"));
  container.querySelectorAll(".popup-tab-pane").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  const targetPane = container.querySelector(`#${tabId}`);
  if (targetPane) targetPane.classList.add("active");
};

window.PALETTES = PALETTES;
window.MapViewer = MapViewer;
