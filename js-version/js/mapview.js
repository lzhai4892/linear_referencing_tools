(function () {
  const WORLD_CENTER = [0, 20];
  const WORLD_ZOOM = 2;
  const EMPTY = { type: "FeatureCollection", features: [] };
  const PREFS_KEY = "lrs.mapPrefs";
  const DEFAULT_EVENT_COLOR = "#c45c28";
  const DEFAULT_ROUTE_COLOR = "#3d6b5a";
  const OTHER_COLOR = "#8a8a84";
  const PALETTE = ["#c45c28", "#2f5d46", "#2f5a8f", "#8a3d7a", "#b8860b", "#0b6b3a", "#b42318", "#3d6b8a"];
  const LINE_FILTER = ["any", ["==", ["geometry-type"], "LineString"], ["==", ["geometry-type"], "MultiLineString"]];
  const POINT_FILTER = ["any", ["==", ["geometry-type"], "Point"], ["==", ["geometry-type"], "MultiPoint"]];
  const DEFAULT_STYLES = {
    routes: { color: DEFAULT_ROUTE_COLOR, width: 2 },
    events: { color: DEFAULT_EVENT_COLOR, width: 3, size: 7 },
  };
  const LRS_KEYS = ["ROADWAY", "BEGIN_POST", "END_POST", "LOCATION", "LRS_PARENT_ID", "LRS_SUB_ID"];
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
  const OPENMAPS = "https://tiles.openfreemap.org/styles";
  const BASEMAPS = {
    light: { style: `${OPENMAPS}/positron` },
    streets: { style: `${OPENMAPS}/liberty` },
    satellite: {
      tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      attribution: "Tiles &copy; Esri",
      tileSize: 256,
    },
  };

  let map = null;
  let popup = null;
  let focusTimer = null;
  const state = {
    routes: 0,
    events: 0,
    routeFc: EMPTY,
    eventFc: EMPTY,
    basemap: "light",
    colorBy: "",
    categories: [],
    styles: {
      routes: { ...DEFAULT_STYLES.routes },
      events: { ...DEFAULT_STYLES.events },
    },
    eventLines: false,
    eventPoints: false,
    selectedLayer: "",
  };

  function $(id) {
    return document.getElementById(id);
  }

  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (raw.basemap && BASEMAPS[raw.basemap]) state.basemap = raw.basemap;
      if (typeof raw.colorBy === "string") state.colorBy = raw.colorBy;
      if (raw.styles) {
        if (raw.styles.routes) Object.assign(state.styles.routes, raw.styles.routes);
        if (raw.styles.events) Object.assign(state.styles.events, raw.styles.events);
      }
    } catch (err) {
      /* keep defaults */
    }
  }

  function savePrefs() {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ basemap: state.basemap, colorBy: state.colorBy, styles: state.styles })
    );
  }

  function setStatus(text) {
    const el = $("map-status");
    if (el) el.textContent = text;
  }

  function setEmpty(hidden) {
    const el = $("map-empty");
    if (!el) return;
    el.hidden = hidden;
    el.setAttribute("aria-hidden", hidden ? "true" : "false");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function basemapSpec(id) {
    return BASEMAPS[id] || BASEMAPS.light;
  }

  function rasterSource(tiles, spec) {
    return {
      type: "raster",
      tiles,
      tileSize: spec.tileSize,
      attribution: spec.attribution,
    };
  }

  function styleFor(id) {
    const spec = basemapSpec(id);
    if (spec.style) return spec.style;
    const sources = { basemap: rasterSource(spec.tiles, spec) };
    const layers = [{ id: "basemap", type: "raster", source: "basemap" }];
    if (spec.overlay) {
      sources["basemap-labels"] = rasterSource(spec.overlay, spec);
      layers.push({ id: "basemap-labels", type: "raster", source: "basemap-labels" });
    }
    return { version: 8, name: "lrs-basemap", sources, layers };
  }

  function uniqueValues(fc, field) {
    const seen = [];
    const used = new Set();
    for (const feature of (fc && fc.features) || []) {
      const raw = feature.properties ? feature.properties[field] : null;
      if (raw == null || raw === "") continue;
      const key = String(raw);
      if (used.has(key)) continue;
      used.add(key);
      seen.push(key);
      if (seen.length >= 8) break;
    }
    return seen;
  }

  function eventColorPaint() {
    const field = state.colorBy;
    if (!field || !state.categories.length) {
      return state.styles.events.color;
    }
    const expr = ["match", ["to-string", ["coalesce", ["get", field], ""]]];
    state.categories.forEach((value, index) => {
      expr.push(value, PALETTE[index % PALETTE.length]);
    });
    expr.push(OTHER_COLOR);
    return expr;
  }

  function renderSwatches() {
    const box = $("map-swatches");
    const label = $("map-color-legend-label");
    if (!box) return;
    box.innerHTML = "";
    if (!state.colorBy || !state.categories.length) {
      box.hidden = true;
      if (label) label.hidden = true;
      return;
    }
    box.hidden = false;
    if (label) label.hidden = false;
    state.categories.forEach((value, index) => {
      const item = document.createElement("div");
      item.className = "map-swatch";
      const swatch = document.createElement("i");
      swatch.style.background = PALETTE[index % PALETTE.length];
      item.appendChild(swatch);
      item.append(value);
      box.appendChild(item);
    });
    const extras = (state.eventFc.features || []).some((feature) => {
      const raw = feature.properties ? feature.properties[state.colorBy] : null;
      return raw != null && raw !== "" && !state.categories.includes(String(raw));
    });
    if (extras) {
      const item = document.createElement("div");
      item.className = "map-swatch";
      const swatch = document.createElement("i");
      swatch.style.background = OTHER_COLOR;
      item.appendChild(swatch);
      item.append("Other");
      box.appendChild(item);
    }
  }

  function featureKinds(fc) {
    let lines = 0;
    let points = 0;
    for (const feature of (fc && fc.features) || []) {
      const type = feature.geometry && feature.geometry.type;
      if (type === "Point" || type === "MultiPoint") points += 1;
      else if (type) lines += 1;
    }
    return { lines, points };
  }

  function selectLayer(id) {
    state.selectedLayer = id === "routes" || id === "events" ? id : "";
    const routes = $("map-layer-routes");
    const events = $("map-layer-events");
    if (routes) routes.classList.toggle("is-selected", state.selectedLayer === "routes");
    if (events) events.classList.toggle("is-selected", state.selectedLayer === "events");
  }

  function syncLayerUi() {
    const routeStyle = state.styles.routes;
    const eventStyle = state.styles.events;
    const routeColor = $("map-color-routes");
    const routeWidth = $("map-width-routes");
    const routeWidthVal = $("map-width-routes-val");
    const eventColor = $("map-color-events");
    const eventWidth = $("map-width-events");
    const eventWidthVal = $("map-width-events-val");
    const eventSize = $("map-size-events");
    const eventSizeVal = $("map-size-events-val");
    if (routeColor) routeColor.value = routeStyle.color;
    if (routeWidth) routeWidth.value = String(routeStyle.width);
    if (routeWidthVal) routeWidthVal.textContent = String(routeStyle.width);
    if (eventColor) eventColor.value = eventStyle.color;
    if (eventWidth) eventWidth.value = String(eventStyle.width);
    if (eventWidthVal) eventWidthVal.textContent = String(eventStyle.width);
    if (eventSize) eventSize.value = String(eventStyle.size);
    if (eventSizeVal) eventSizeVal.textContent = String(eventStyle.size);
    const routeSwatch = $("map-swatch-routes");
    if (routeSwatch) {
      routeSwatch.style.borderTopColor = routeStyle.color;
      routeSwatch.style.borderTopWidth = `${Math.max(2, routeStyle.width)}px`;
    }
    const eventSwatch = $("map-swatch-events");
    if (eventSwatch) {
      eventSwatch.classList.toggle("is-point", state.eventPoints && !state.eventLines);
      eventSwatch.style.borderTopColor = eventStyle.color;
      eventSwatch.style.borderTopWidth = `${Math.max(2, eventStyle.width)}px`;
      eventSwatch.style.background = state.eventPoints && !state.eventLines ? eventStyle.color : "none";
    }
    const widthRow = $("map-style-events-width");
    const sizeRow = $("map-style-events-size");
    if (widthRow) widthRow.hidden = state.eventPoints && !state.eventLines;
    if (sizeRow) sizeRow.hidden = !state.eventPoints;
    const eventName = $("map-layer-events-name");
    if (eventName) eventName.textContent = state.eventPoints && !state.eventLines ? "Points" : "Events";
  }

  function applyLayerPaint() {
    if (!map) return;
    const routeStyle = state.styles.routes;
    const eventStyle = state.styles.events;
    const eventColor = eventColorPaint();
    if (map.getLayer("lrs-routes")) {
      map.setPaintProperty("lrs-routes", "line-color", routeStyle.color);
      map.setPaintProperty("lrs-routes", "line-width", routeStyle.width);
      map.setPaintProperty("lrs-routes-hit", "line-color", routeStyle.color);
      map.setPaintProperty("lrs-routes-hit", "line-width", Math.max(14, routeStyle.width + 10));
    }
    if (map.getLayer("lrs-events")) {
      map.setPaintProperty("lrs-events", "line-color", eventColor);
      map.setPaintProperty("lrs-events", "line-width", eventStyle.width);
      map.setPaintProperty("lrs-events-hit", "line-color", eventColor);
      map.setPaintProperty("lrs-events-hit", "line-width", Math.max(12, eventStyle.width + 10));
    }
    if (map.getLayer("lrs-events-point")) {
      map.setPaintProperty("lrs-events-point", "circle-color", eventColor);
      map.setPaintProperty("lrs-events-point", "circle-radius", eventStyle.size);
      map.setPaintProperty("lrs-events-point-hit", "circle-color", eventColor);
      map.setPaintProperty("lrs-events-point-hit", "circle-radius", eventStyle.size + 8);
    }
    if (map.getLayer("lrs-focus")) {
      map.setPaintProperty("lrs-focus", "line-width", Math.max(6, routeStyle.width + 3));
    }
    if (map.getLayer("lrs-focus-point")) {
      map.setPaintProperty("lrs-focus-point", "circle-radius", Math.max(8, eventStyle.size + 2));
    }
    renderSwatches();
    syncLayerUi();
  }

  function applyEventPaint() {
    applyLayerPaint();
  }

  function refreshColorBy() {
    const field = state.colorBy;
    const hasField =
      field &&
      (state.eventFc.features || []).some((feature) => feature.properties && feature.properties[field] != null);
    state.categories = hasField ? uniqueValues(state.eventFc, field) : [];
    applyEventPaint();
  }

  let styleGen = 0;

  function restoreOverlays() {
    ensureLayers();
    applyVisibility();
    applyLayerPaint();
  }

  function applyBasemap(id) {
    const next = BASEMAPS[id] ? id : "light";
    state.basemap = next;
    const select = $("map-basemap");
    if (select) select.value = next;
    if (!map) return;
    const gen = ++styleGen;
    map.once("style.load", () => {
      if (gen !== styleGen) return;
      restoreOverlays();
    });
    map.setStyle(styleFor(next));
  }

  function ensureLayers() {
    if (!map.getSource("lrs-routes")) {
      map.addSource("lrs-routes", { type: "geojson", data: state.routeFc || EMPTY });
      map.addLayer({
        id: "lrs-routes",
        type: "line",
        source: "lrs-routes",
        filter: LINE_FILTER,
        paint: {
          "line-color": state.styles.routes.color,
          "line-width": state.styles.routes.width,
          "line-opacity": 0.8,
        },
      });
      map.addLayer({
        id: "lrs-routes-hit",
        type: "line",
        source: "lrs-routes",
        filter: LINE_FILTER,
        paint: { "line-color": state.styles.routes.color, "line-width": 14, "line-opacity": 0 },
      });
    }
    if (!map.getSource("lrs-events")) {
      map.addSource("lrs-events", { type: "geojson", data: state.eventFc || EMPTY });
      map.addLayer({
        id: "lrs-events",
        type: "line",
        source: "lrs-events",
        filter: LINE_FILTER,
        paint: {
          "line-color": state.styles.events.color,
          "line-width": state.styles.events.width,
          "line-opacity": 0.92,
        },
      });
      map.addLayer({
        id: "lrs-events-hit",
        type: "line",
        source: "lrs-events",
        filter: LINE_FILTER,
        paint: { "line-color": state.styles.events.color, "line-width": 12, "line-opacity": 0 },
      });
      map.addLayer({
        id: "lrs-events-point",
        type: "circle",
        source: "lrs-events",
        filter: POINT_FILTER,
        paint: {
          "circle-color": state.styles.events.color,
          "circle-radius": state.styles.events.size,
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1.25,
        },
      });
      map.addLayer({
        id: "lrs-events-point-hit",
        type: "circle",
        source: "lrs-events",
        filter: POINT_FILTER,
        paint: {
          "circle-color": state.styles.events.color,
          "circle-radius": state.styles.events.size + 8,
          "circle-opacity": 0,
        },
      });
    }
    if (!map.getSource("lrs-focus")) {
      map.addSource("lrs-focus", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "lrs-focus",
        type: "line",
        source: "lrs-focus",
        filter: LINE_FILTER,
        paint: {
          "line-color": "#f0d060",
          "line-width": 6,
          "line-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "lrs-focus-point",
        type: "circle",
        source: "lrs-focus",
        filter: POINT_FILTER,
        paint: {
          "circle-color": "#f0d060",
          "circle-radius": 9,
          "circle-stroke-color": "#1c1c1a",
          "circle-stroke-width": 1.5,
        },
      });
    }
    applyLayerPaint();
  }

  function fitCollection(fc) {
    const bounds = LRS.boundsOfCollection(fc);
    if (!bounds || !map) return;
    map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 700 });
  }

  function identifyHtml(props) {
    const keys = [];
    LRS_KEYS.forEach((key) => {
      if (props[key] != null && props[key] !== "") keys.push(key);
    });
    Object.keys(props)
      .sort()
      .forEach((key) => {
        if (key === "_row" || key.charAt(0) === "_") return;
        if (keys.includes(key)) return;
        if (props[key] == null || props[key] === "") return;
        keys.push(key);
      });
    if (!keys.length) return "<div class=\"map-pop\">Feature</div>";
    const rows = keys
      .slice(0, 16)
      .map((key) => `<div><span>${escapeHtml(key)}</span>${escapeHtml(props[key])}</div>`)
      .join("");
    return `<div class="map-pop">${rows}</div>`;
  }

  function bindClicks() {
    [
      ["lrs-events-hit", "Event", "events"],
      ["lrs-events-point-hit", "Point", "events"],
      ["lrs-routes-hit", "Route", "routes"],
    ].forEach(([layer, kind, group]) => {
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", layer, (event) => {
        const feature = event.features && event.features[0];
        if (!feature) return;
        selectLayer(group);
        const html = `<p class="map-pop-kind">${kind}</p>${identifyHtml(feature.properties || {})}`;
        popup.setLngLat(event.lngLat).setHTML(html).addTo(map);
      });
    });
    map.on("dblclick", (event) => {
      event.preventDefault();
      LRSMap.fit();
    });
  }

  function applyVisibility() {
    if (!map || !map.getLayer("lrs-routes")) return;
    const routesOn = !$("map-toggle-routes") || $("map-toggle-routes").checked;
    const eventsOn = !$("map-toggle-events") || $("map-toggle-events").checked;
    const routeVis = routesOn ? "visible" : "none";
    const eventVis = eventsOn ? "visible" : "none";
    ["lrs-routes", "lrs-routes-hit"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", routeVis);
    });
    ["lrs-events", "lrs-events-hit", "lrs-events-point", "lrs-events-point-hit"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", eventVis);
    });
  }

  function refreshEmpty() {
    const hasData = Boolean(state.routes || state.events);
    setEmpty(hasData);
    const parts = [];
    if (state.routes) parts.push(`${state.routes.toLocaleString()} routes`);
    if (state.events) parts.push(`${state.events.toLocaleString()} events`);
    setStatus(parts.join(" · ") || "No geometry yet");
  }

  function findFeature(index) {
    const match = (fc) =>
      ((fc && fc.features) || []).find((feature) => feature.properties && feature.properties._row === index);
    return match(state.eventFc) || match(state.routeFc) || null;
  }

  function bindControls() {
    const basemap = $("map-basemap");
    if (basemap) {
      basemap.value = state.basemap;
      basemap.addEventListener("change", () => {
        applyBasemap(basemap.value);
        savePrefs();
      });
    }
    const colorBy = $("map-color-by");
    if (colorBy) {
      colorBy.value = state.colorBy;
      colorBy.addEventListener("change", () => {
        state.colorBy = colorBy.value || "";
        refreshColorBy();
        savePrefs();
      });
    }
    const bindStyle = (id, apply) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("input", () => {
        apply(el.value);
        applyLayerPaint();
        savePrefs();
      });
    };
    bindStyle("map-color-routes", (value) => {
      state.styles.routes.color = value;
    });
    bindStyle("map-width-routes", (value) => {
      state.styles.routes.width = Number(value);
    });
    bindStyle("map-color-events", (value) => {
      state.styles.events.color = value;
    });
    bindStyle("map-width-events", (value) => {
      state.styles.events.width = Number(value);
    });
    bindStyle("map-size-events", (value) => {
      state.styles.events.size = Number(value);
    });
    ["map-layer-routes", "map-layer-events"].forEach((id) => {
      const card = $(id);
      if (!card) return;
      card.addEventListener("click", (event) => {
        if (event.target && event.target.closest("input")) return;
        selectLayer(card.dataset.layer);
      });
    });
    syncLayerUi();
  }

  const LRSMap = {
    init(containerId) {
      if (typeof maplibregl === "undefined") return null;
      const container = $(containerId);
      if (!container) return null;
      loadPrefs();
      map = new maplibregl.Map({
        container,
        style: styleFor(state.basemap),
        center: WORLD_CENTER,
        zoom: WORLD_ZOOM,
        minZoom: 1,
        maxZoom: 18,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-right");
      popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "300px" });
      const resizeSoon = () => {
        requestAnimationFrame(() => {
          if (map) map.resize();
        });
      };
      map.on("load", () => {
        ensureLayers();
        bindClicks();
        applyVisibility();
        refreshColorBy();
        refreshEmpty();
        resizeSoon();
      });
      const stage = container.parentElement;
      if (typeof ResizeObserver === "function" && stage) {
        new ResizeObserver(() => map.resize()).observe(stage);
      }
      window.addEventListener("resize", () => map.resize());
      setTimeout(resizeSoon, 80);
      setTimeout(resizeSoon, 400);
      bindControls();
      return map;
    },
    setRoutes(rows, options = {}) {
      if (!map) return;
      const draw = () => {
        ensureLayers();
        const fc = LRS.rowsToMapGeoJson(rows, { crs: options.crs, prj: options.prj });
        map.getSource("lrs-routes").setData(fc);
        state.routeFc = fc;
        state.routes = fc.features.length;
        refreshEmpty();
        if (fc.features.length) fitCollection(fc);
        if (fc.crs && fc.crs !== "EPSG:4326") {
          setStatus(`${state.routes.toLocaleString()} routes · ${fc.crs} → WGS84`);
        }
      };
      if (map.loaded()) draw();
      else map.once("load", draw);
    },
    setEvents(rows, options = {}) {
      if (!map) return;
      const draw = () => {
        ensureLayers();
        const fc = LRS.rowsToMapGeoJson(rows, { crs: options.crs, prj: options.prj });
        map.getSource("lrs-events").setData(fc);
        state.eventFc = fc;
        state.events = fc.features.length;
        const kinds = featureKinds(fc);
        state.eventLines = Boolean(kinds.lines);
        state.eventPoints = Boolean(kinds.points);
        refreshColorBy();
        syncLayerUi();
        refreshEmpty();
        if (fc.features.length) fitCollection(fc);
      };
      if (map.loaded()) draw();
      else map.once("load", draw);
    },
    setBasemap(id) {
      applyBasemap(id);
      savePrefs();
    },
    setEventColor(field) {
      state.colorBy = field || "";
      const select = $("map-color-by");
      if (select && select.value !== state.colorBy) select.value = state.colorBy;
      refreshColorBy();
      savePrefs();
    },
    focusRow(index) {
      if (!map) return false;
      const feature = findFeature(index);
      if (!feature) return false;
      ensureLayers();
      const fc = { type: "FeatureCollection", features: [feature] };
      map.getSource("lrs-focus").setData(fc);
      fitCollection(fc);
      popup.remove();
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        if (map && map.getSource("lrs-focus")) map.getSource("lrs-focus").setData(EMPTY);
      }, 2500);
      const fromEvents = ((state.eventFc && state.eventFc.features) || []).some(
        (item) => item.properties && item.properties._row === index
      );
      selectLayer(fromEvents ? "events" : "routes");
      return true;
    },
    getPrefs() {
      return { basemap: state.basemap, colorBy: state.colorBy, styles: state.styles };
    },
    setVisibility: applyVisibility,
    fit() {
      if (!map) return;
      if (state.events && state.eventFc.features.length) fitCollection(state.eventFc);
      else if (state.routes && state.routeFc.features.length) fitCollection(state.routeFc);
      else map.flyTo({ center: WORLD_CENTER, zoom: WORLD_ZOOM, duration: 600 });
    },
    resize() {
      if (map) map.resize();
    },
    hasData() {
      return Boolean(state.routes || state.events);
    },
  };

  window.LRSMap = LRSMap;
})();
