(function (root) {
  const isNode = typeof module === "object" && module.exports;
  const LRS = isNode ? require("./io.js") : root.LRS || (root.LRS = {});

  const UTM_A = 6378137;
  const UTM_E = 0.081819191;
  const UTM_E1SQ = 0.006739497;
  const UTM_K0 = 0.9996;

  function firstCoord(geom) {
    if (!geom || !geom.coordinates) return null;
    if (geom.type === "Point") return geom.coordinates;
    if (geom.type === "LineString" || geom.type === "MultiPoint") return geom.coordinates[0] || null;
    if (geom.type === "MultiLineString" || geom.type === "Polygon") {
      return geom.coordinates[0] && geom.coordinates[0][0] ? geom.coordinates[0][0] : null;
    }
    if (geom.type === "MultiPolygon") {
      const ring = geom.coordinates[0] && geom.coordinates[0][0];
      return ring && ring[0] ? ring[0] : null;
    }
    return null;
  }

  function firstRowCoord(rows) {
    for (const row of rows || []) {
      const coord = firstCoord(row.geometry);
      if (coord) return coord;
    }
    return null;
  }

  function detectCrs(prj, rows) {
    const text = prj || "";
    if (/UTM.?Zone.?17/i.test(text) || /26917/.test(text)) return "EPSG:26917";
    if (/UTM.?Zone.?16/i.test(text) || /26916/.test(text)) return "EPSG:26916";
    if (/2236|Florida.?State.?Plane.?East|NAD_1983_HARN_StatePlane_Florida_East/i.test(text)) return "EPSG:2236";
    if (/2237|Florida.?State.?Plane.?West|NAD_1983_HARN_StatePlane_Florida_West/i.test(text)) return "EPSG:2237";
    if (/3857|Web.?Mercator|Pseudo.?Mercator/i.test(text)) return "EPSG:3857";
    if (/GEOGCS/i.test(text) && !/PROJCS/i.test(text)) return "EPSG:4326";
    const coord = firstRowCoord(rows);
    if (!coord) return "EPSG:4326";
    const x = Number(coord[0]);
    const y = Number(coord[1]);
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90) return "EPSG:4326";
    if (Math.abs(x) > 20000 && Math.abs(y) > 20000) {
      if (x < 300000 && y > 2700000 && y < 3600000) return "EPSG:26916";
      if (y > 2700000 && y < 3600000) return "EPSG:26917";
      if (Math.abs(x) > 1000000) return "EPSG:3857";
    }
    return "EPSG:4326";
  }

  function utmToLonLat(easting, northing, zone, northern) {
    const x = easting - 500000;
    let y = northing;
    if (!northern) y -= 10000000;
    const lonOrigin = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
    const m = y / UTM_K0;
    const mu =
      m /
      (UTM_A *
        (1 - Math.pow(UTM_E, 2) / 4 - (3 * Math.pow(UTM_E, 4)) / 64 - (5 * Math.pow(UTM_E, 6)) / 256));
    const e1 = (1 - Math.sqrt(1 - UTM_E * UTM_E)) / (1 + Math.sqrt(1 - UTM_E * UTM_E));
    const fp =
      mu +
      ((3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32) * Math.sin(2 * mu) +
      ((21 * Math.pow(e1, 2)) / 16 - (55 * Math.pow(e1, 4)) / 32) * Math.sin(4 * mu) +
      ((151 * Math.pow(e1, 3)) / 96) * Math.sin(6 * mu) +
      ((1097 * Math.pow(e1, 4)) / 512) * Math.sin(8 * mu);
    const sinfp = Math.sin(fp);
    const cosfp = Math.cos(fp);
    const tanfp = Math.tan(fp);
    const c1 = UTM_E1SQ * cosfp * cosfp;
    const t1 = tanfp * tanfp;
    const r1 = (UTM_A * (1 - UTM_E * UTM_E)) / Math.pow(1 - UTM_E * UTM_E * sinfp * sinfp, 1.5);
    const n1 = UTM_A / Math.sqrt(1 - UTM_E * UTM_E * sinfp * sinfp);
    const d = x / (n1 * UTM_K0);
    const q1 = (n1 * tanfp) / r1;
    const lat =
      fp -
      q1 *
        (d * d / 2 -
          ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * UTM_E1SQ) * Math.pow(d, 4)) / 24 +
          ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * UTM_E1SQ - 3 * c1 * c1) * Math.pow(d, 6)) / 720);
    const lon =
      lonOrigin +
      (d - ((1 + 2 * t1 + c1) * Math.pow(d, 3)) / 6 +
        ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * UTM_E1SQ + 24 * t1 * t1) * Math.pow(d, 5)) / 120) /
        cosfp;
    return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
  }

  function webMercatorToLonLat(x, y) {
    const lon = (x / 6378137) * (180 / Math.PI);
    const lat = (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * (180 / Math.PI);
    return [lon, lat];
  }

  function ensureProj4() {
    const proj = typeof proj4 === "function" ? proj4 : null;
    if (!proj) return null;
    proj.defs("EPSG:26917", "+proj=utm +zone=17 +datum=NAD83 +units=m +no_defs");
    proj.defs("EPSG:26916", "+proj=utm +zone=16 +datum=NAD83 +units=m +no_defs");
    proj.defs("EPSG:2236", "+proj=tmerc +lat_0=24.33333333333333 +lon_0=-81 +k=0.9999411764705882 +x_0=200000.0001016002 +y_0=0 +ellps=GRS80 +to_meter=0.3048006096012192 +no_defs");
    proj.defs("EPSG:2237", "+proj=tmerc +lat_0=24.33333333333333 +lon_0=-82 +k=0.9999411764705882 +x_0=200000.0001016002 +y_0=0 +ellps=GRS80 +to_meter=0.3048006096012192 +no_defs");
    proj.defs("EPSG:3857", "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs");
    return proj;
  }

  function projectCoordinate(x, y, crs) {
    if (crs === "EPSG:4326" || crs === "EPSG:4269" || !crs) return [x, y];
    if (crs === "EPSG:26917") return utmToLonLat(x, y, 17, true);
    if (crs === "EPSG:26916") return utmToLonLat(x, y, 16, true);
    if (crs === "EPSG:3857") return webMercatorToLonLat(x, y);
    const proj = ensureProj4();
    if (proj && proj.defs(crs)) return proj(crs, "EPSG:4326", [x, y]);
    return [x, y];
  }

  function downsampleLine(coords, maxVertices) {
    if (!maxVertices || coords.length <= maxVertices) return coords;
    const out = [];
    const last = coords.length - 1;
    const step = last / (maxVertices - 1);
    for (let i = 0; i < maxVertices; i += 1) {
      out.push(coords[Math.round(i * step)]);
    }
    if (out[out.length - 1] !== coords[last]) out[out.length - 1] = coords[last];
    return out;
  }

  function projectCoords(coords, crs, maxVertices) {
    if (!coords || !coords.length) return [];
    if (typeof coords[0] === "number") {
      return projectCoordinate(coords[0], coords[1], crs);
    }
    if (typeof coords[0][0] === "number") {
      return downsampleLine(coords, maxVertices).map((point) => projectCoordinate(point[0], point[1], crs));
    }
    return coords.map((item) => projectCoords(item, crs, maxVertices));
  }

  function projectGeometry(geom, crs, maxVertices) {
    if (!geom || !geom.type) return null;
    if (geom.type === "GeometryCollection") {
      const geometries = (geom.geometries || []).map((part) => projectGeometry(part, crs, maxVertices)).filter(Boolean);
      return geometries.length ? { type: "GeometryCollection", geometries } : null;
    }
    if (!geom.coordinates) return null;
    return { type: geom.type, coordinates: projectCoords(geom.coordinates, crs, maxVertices) };
  }

  function mapPropertyValue(value) {
    if (value == null) return null;
    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") return value;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    if (type === "object") {
      try {
        return JSON.stringify(value);
      } catch (err) {
        return String(value);
      }
    }
    return String(value);
  }

  function rowsToMapGeoJson(rows, options = {}) {
    const crs = options.crs || detectCrs(options.prj, rows);
    const maxVertices = options.maxVertices == null ? 0 : options.maxVertices;
    const features = [];
    (rows || []).forEach((row, index) => {
      const geomType = row.geometry && row.geometry.type;
      const sourceGeom =
        LRS.asMapLines?.(row.geometry) ||
        (geomType === "Point" || geomType === "MultiPoint" ? row.geometry : null);
      if (!sourceGeom) return;
      const geometry = projectGeometry(sourceGeom, crs, maxVertices);
      if (!geometry) return;
      const properties = { _row: index };
      for (const key of Object.keys(row)) {
        if (key === "geometry") continue;
        const value = mapPropertyValue(row[key]);
        if (value != null) properties[key] = value;
      }
      features.push({ type: "Feature", properties, geometry });
    });
    return { type: "FeatureCollection", features, crs };
  }

  function boundsOfCollection(fc) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    function walk(coords) {
      if (!coords) return;
      if (typeof coords[0] === "number") {
        if (coords[0] < minX) minX = coords[0];
        if (coords[1] < minY) minY = coords[1];
        if (coords[0] > maxX) maxX = coords[0];
        if (coords[1] > maxY) maxY = coords[1];
        return;
      }
      coords.forEach(walk);
    }
    for (const feature of fc.features || []) walk(feature.geometry && feature.geometry.coordinates);
    if (!Number.isFinite(minX)) return null;
    return [
      [minX, minY],
      [maxX, maxY],
    ];
  }

  Object.assign(LRS, {
    detectCrs,
    utmToLonLat,
    projectCoordinate,
    projectGeometry,
    rowsToMapGeoJson,
    boundsOfCollection,
  });
  if (isNode) module.exports = LRS;
})(typeof globalThis !== "undefined" ? globalThis : this);
