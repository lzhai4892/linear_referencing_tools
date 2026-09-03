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

  const PRJ_WKT = {
    "EPSG:4326":
      'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
    "EPSG:4269":
      'GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
    "EPSG:26917":
      'PROJCS["NAD_1983_UTM_Zone_17N",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-81.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]',
    "EPSG:26916":
      'PROJCS["NAD_1983_UTM_Zone_16N",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-87.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]',
    "EPSG:2236":
      'PROJCS["NAD_1983_HARN_StatePlane_Florida_East_FIPS_0901_Feet",GEOGCS["GCS_North_American_1983_HARN",DATUM["D_North_American_1983_HARN",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",656166.6666666665],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-81.0],PARAMETER["Scale_Factor",0.9999411764705882],PARAMETER["Latitude_Of_Origin",24.33333333333333],UNIT["Foot_US",0.3048006096012192]]',
    "EPSG:2237":
      'PROJCS["NAD_1983_HARN_StatePlane_Florida_West_FIPS_0902_Feet",GEOGCS["GCS_North_American_1983_HARN",DATUM["D_North_American_1983_HARN",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",656166.6666666665],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-82.0],PARAMETER["Scale_Factor",0.9999411764705882],PARAMETER["Latitude_Of_Origin",24.33333333333333],UNIT["Foot_US",0.3048006096012192]]',
    "EPSG:3857":
      'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]',
  };

  function isPrjWkt(text) {
    return /GEOGCS|PROJCS/i.test(String(text || ""));
  }

  function prjWkt(prj, crs) {
    const text = String(prj || "").trim();
    if (isPrjWkt(text)) return text;
    return PRJ_WKT[crs] || PRJ_WKT["EPSG:4326"];
  }

  const ELLIPSE_A = 6378137;
  const ELLIPSE_E2 = 0.006694380022900788;
  const ELLIPSE_E4 = ELLIPSE_E2 * ELLIPSE_E2;
  const ELLIPSE_E6 = ELLIPSE_E4 * ELLIPSE_E2;
  const ELLIPSE_EP2 = ELLIPSE_E2 / (1 - ELLIPSE_E2);
  const ELLIPSE_E = Math.sqrt(ELLIPSE_E2);

  function geographicDef(code, label) {
    return { kind: "geographic", code: code || "EPSG:4326", convertible: true, label: label || code || "WGS 84" };
  }

  function utmDef(zone, northern) {
    const n = northern !== false;
    const z = Number(zone);
    return {
      kind: "utm",
      zone: z,
      northern: n,
      code: n ? `EPSG:269${String(z).padStart(2, "0")}` : `EPSG:327${String(z).padStart(2, "0")}`,
      convertible: true,
      label: `UTM Zone ${z}${n ? "N" : "S"}`,
    };
  }

  function mercatorDef() {
    return { kind: "mercator", code: "EPSG:3857", convertible: true, label: "Web Mercator" };
  }

  function wktName(text) {
    const match = String(text).match(/PROJCS\["([^"]+)"/i) || String(text).match(/GEOGCS\["([^"]+)"/i);
    return match ? match[1] : null;
  }

  function wktParam(text, name) {
    const match = String(text).match(new RegExp(`PARAMETER\\["${name}"\\s*,\\s*([+-]?[0-9.eE]+)\\]`, "i"));
    return match ? Number(match[1]) : null;
  }

  function wktLinearToMeter(text) {
    const units = [...String(text).matchAll(/UNIT\["([^"]+)"\s*,\s*([0-9.eE+-]+)\]/gi)];
    if (!units.length) return 1;
    const linear = [...units].reverse().find((item) => !/degree|radian/i.test(item[1]));
    return linear ? Number(linear[2]) : 1;
  }

  function parsePrjText(text) {
    const raw = String(text || "");
    if (/3857|900913|Web.?Mercator|Pseudo.?Mercator|Mercator_Auxiliary_Sphere/i.test(raw)) return mercatorDef();
    const utm = raw.match(/UTM.?Zone.?(\d{1,2})\s*([NS])?/i);
    if (utm) return utmDef(Number(utm[1]), (utm[2] || "N").toUpperCase() !== "S");
    const epsgUtm = raw.match(/\b26(?:6|7|8|9)(\d{2})\b/) || raw.match(/\b326(\d{2})\b/);
    if (epsgUtm) return utmDef(Number(epsgUtm[1]), true);
    if (/GEOGCS/i.test(raw) && !/PROJCS/i.test(raw)) {
      return geographicDef(/NAD.?1983|North.?American.?1983|4269/i.test(raw) ? "EPSG:4269" : "EPSG:4326", wktName(raw));
    }
    if (/Transverse_Mercator|Gauss_Kruger/i.test(raw)) {
      const lon0 = wktParam(raw, "Central_Meridian");
      const lat0 = wktParam(raw, "Latitude_Of_Origin") || 0;
      const k0 = wktParam(raw, "Scale_Factor") || 1;
      const x0 = wktParam(raw, "False_Easting") || 0;
      const y0 = wktParam(raw, "False_Northing") || 0;
      const toMeter = wktLinearToMeter(raw);
      if (Math.abs(k0 - 0.9996) < 1e-6 && Math.abs(lat0) < 1e-6 && Math.abs(x0 * toMeter - 500000) < 1) {
        const zone = Number.isFinite(lon0) ? Math.round((lon0 + 183) / 6) : null;
        if (zone >= 1 && zone <= 60) return utmDef(zone, y0 * toMeter < 5000000);
      }
      return {
        kind: "tmerc",
        code: wktName(raw) || "source",
        convertible: true,
        label: wktName(raw) || "Transverse Mercator",
        lat0,
        lon0: Number.isFinite(lon0) ? lon0 : 0,
        k0,
        x0,
        y0,
        toMeter,
      };
    }
    if (/Lambert_Conformal_Conic|Lambert_Conic_Conformal/i.test(raw)) {
      return {
        kind: "lcc",
        code: wktName(raw) || "source",
        convertible: true,
        label: wktName(raw) || "Lambert Conformal Conic",
        lat0: wktParam(raw, "Latitude_Of_Origin") || 0,
        lon0: wktParam(raw, "Central_Meridian") || 0,
        lat1: wktParam(raw, "Standard_Parallel_1"),
        lat2: wktParam(raw, "Standard_Parallel_2"),
        x0: wktParam(raw, "False_Easting") || 0,
        y0: wktParam(raw, "False_Northing") || 0,
        toMeter: wktLinearToMeter(raw),
      };
    }
    if (isPrjWkt(raw)) {
      return { kind: "unknown", code: wktName(raw) || "source", convertible: false, label: wktName(raw) || "source" };
    }
    return null;
  }

  function parseProjection(prj, crs, rows) {
    const text = String(prj || "").trim();
    const hint = String(crs || "").trim();
    if (hint === "EPSG:4326" || hint === "EPSG:4269") return geographicDef(hint);
    if (hint === "EPSG:3857") return mercatorDef();
    const nadUtm = hint.match(/^EPSG:269(\d{2})$/i);
    if (nadUtm) return utmDef(Number(nadUtm[1]), true);
    if (hint === "EPSG:2236") {
      return parsePrjText(PRJ_WKT["EPSG:2236"]);
    }
    if (hint === "EPSG:2237") {
      return parsePrjText(PRJ_WKT["EPSG:2237"]);
    }
    const fromPrj = parsePrjText(text) || (isPrjWkt(hint) ? parsePrjText(hint) : null);
    if (fromPrj) return fromPrj;
    if (/^EPSG:2236/i.test(hint)) return parsePrjText(PRJ_WKT["EPSG:2236"]);
    if (/^EPSG:2237/i.test(hint)) return parsePrjText(PRJ_WKT["EPSG:2237"]);
    const coord = firstRowCoord(rows);
    if (!coord) return geographicDef("EPSG:4326");
    const x = Number(coord[0]);
    const y = Number(coord[1]);
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90) {
      return geographicDef("EPSG:4326");
    }
    return { kind: "unknown", code: hint || "source", convertible: false, label: hint || "unknown projected" };
  }

  function detectCrs(prj, rows) {
    return parseProjection(prj, null, rows).code;
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

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function toDeg(rad) {
    return (rad * 180) / Math.PI;
  }

  function meridionalArc(phi) {
    return (
      ELLIPSE_A *
      ((1 - ELLIPSE_E2 / 4 - (3 * ELLIPSE_E4) / 64 - (5 * ELLIPSE_E6) / 256) * phi -
        ((3 * ELLIPSE_E2) / 8 + (3 * ELLIPSE_E4) / 32 + (45 * ELLIPSE_E6) / 1024) * Math.sin(2 * phi) +
        ((15 * ELLIPSE_E4) / 256 + (45 * ELLIPSE_E6) / 1024) * Math.sin(4 * phi) -
        ((35 * ELLIPSE_E6) / 3072) * Math.sin(6 * phi))
    );
  }

  function footpointLatitude(mu) {
    const e1 = (1 - Math.sqrt(1 - ELLIPSE_E2)) / (1 + Math.sqrt(1 - ELLIPSE_E2));
    return (
      mu +
      ((3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32) * Math.sin(2 * mu) +
      ((21 * Math.pow(e1, 2)) / 16 - (55 * Math.pow(e1, 4)) / 32) * Math.sin(4 * mu) +
      ((151 * Math.pow(e1, 3)) / 96) * Math.sin(6 * mu) +
      ((1097 * Math.pow(e1, 4)) / 512) * Math.sin(8 * mu)
    );
  }

  function tmercToLonLat(easting, northing, def) {
    const toMeter = def.toMeter || 1;
    const k0 = def.k0 || 1;
    const x = easting * toMeter - (def.x0 || 0) * toMeter;
    const y = northing * toMeter - (def.y0 || 0) * toMeter;
    const m = meridionalArc(toRad(def.lat0 || 0)) + y / k0;
    const mu =
      m /
      (ELLIPSE_A * (1 - ELLIPSE_E2 / 4 - (3 * ELLIPSE_E4) / 64 - (5 * ELLIPSE_E6) / 256));
    const fp = footpointLatitude(mu);
    const sinfp = Math.sin(fp);
    const cosfp = Math.cos(fp);
    const tanfp = Math.tan(fp);
    const c1 = ELLIPSE_EP2 * cosfp * cosfp;
    const t1 = tanfp * tanfp;
    const r1 = (ELLIPSE_A * (1 - ELLIPSE_E2)) / Math.pow(1 - ELLIPSE_E2 * sinfp * sinfp, 1.5);
    const n1 = ELLIPSE_A / Math.sqrt(1 - ELLIPSE_E2 * sinfp * sinfp);
    const d = x / (n1 * k0);
    const lat =
      fp -
      ((n1 * tanfp) / r1) *
        (d * d / 2 -
          ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ELLIPSE_EP2) * Math.pow(d, 4)) / 24 +
          ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ELLIPSE_EP2 - 3 * c1 * c1) * Math.pow(d, 6)) / 720);
    const lon =
      toRad(def.lon0 || 0) +
      (d -
        ((1 + 2 * t1 + c1) * Math.pow(d, 3)) / 6 +
        ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ELLIPSE_EP2 + 24 * t1 * t1) * Math.pow(d, 5)) / 120) /
        cosfp;
    return [toDeg(lon), toDeg(lat)];
  }

  function lccM(phi) {
    return Math.cos(phi) / Math.sqrt(1 - ELLIPSE_E2 * Math.sin(phi) * Math.sin(phi));
  }

  function lccT(phi) {
    const sin = Math.sin(phi);
    return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - ELLIPSE_E * sin) / (1 + ELLIPSE_E * sin), ELLIPSE_E / 2);
  }

  function lccToLonLat(easting, northing, def) {
    const toMeter = def.toMeter || 1;
    const lat1 = toRad(def.lat1 == null ? def.lat0 || 0 : def.lat1);
    const lat2 = toRad(def.lat2 == null ? def.lat1 == null ? def.lat0 || 0 : def.lat1 : def.lat2);
    const lat0 = toRad(def.lat0 || 0);
    const lon0 = toRad(def.lon0 || 0);
    const x = easting * toMeter - (def.x0 || 0) * toMeter;
    const y = northing * toMeter - (def.y0 || 0) * toMeter;
    const m1 = lccM(lat1);
    const m2 = lccM(lat2);
    const t0 = lccT(lat0);
    const t1 = lccT(lat1);
    const t2 = lccT(lat2);
    const n =
      Math.abs(lat1 - lat2) < 1e-12
        ? Math.sin(lat1)
        : Math.log(m1 / m2) / Math.log(t1 / t2);
    const f = m1 / (n * Math.pow(t1, n));
    const rho0 = ELLIPSE_A * f * Math.pow(t0, n);
    const rho = Math.sign(n) * Math.sqrt(x * x + (rho0 - y) * (rho0 - y));
    const theta = Math.atan2(x, rho0 - y);
    const t = Math.pow(rho / (ELLIPSE_A * f), 1 / n);
    let phi = Math.PI / 2 - 2 * Math.atan(t);
    for (let i = 0; i < 8; i += 1) {
      const sin = Math.sin(phi);
      phi = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - ELLIPSE_E * sin) / (1 + ELLIPSE_E * sin), ELLIPSE_E / 2));
    }
    return [toDeg(theta / n + lon0), toDeg(phi)];
  }

  function projectCoordinate(x, y, crs) {
    const def = typeof crs === "object" && crs && crs.kind ? crs : parseProjection("", crs);
    if (!def || def.kind === "geographic" || !def.convertible) return [x, y];
    if (def.kind === "utm") return utmToLonLat(x, y, def.zone, def.northern !== false);
    if (def.kind === "mercator") return webMercatorToLonLat(x, y);
    if (def.kind === "tmerc") return tmercToLonLat(x, y, def);
    if (def.kind === "lcc") return lccToLonLat(x, y, def);
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

  function projectPoint(point, crs) {
    const [lon, lat] = projectCoordinate(point[0], point[1], crs);
    return point.length > 2 ? [lon, lat, ...point.slice(2)] : [lon, lat];
  }

  function projectCoords(coords, crs, maxVertices) {
    if (!coords || !coords.length) return [];
    if (typeof coords[0] === "number") {
      return projectPoint(coords, crs);
    }
    if (typeof coords[0][0] === "number") {
      return downsampleLine(coords, maxVertices).map((point) => projectPoint(point, crs));
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

  function rowsToWgs84(rows, options = {}) {
    const def = parseProjection(options.prj, options.crs, rows);
    if (def.kind === "geographic") {
      return { rows, crs: "EPSG:4326", prj: PRJ_WKT["EPSG:4326"], converted: false, from: def.label };
    }
    if (!def.convertible) {
      throw new Error(
        `Cannot convert ${def.label || "this projection"} to WGS 84. Export with “Keep source CRS”, or load a route shapefile whose .prj is UTM, State Plane (TM/Lambert), or geographic.`
      );
    }
    const out = (rows || []).map((row) => {
      if (!row || !row.geometry) return { ...row };
      return { ...row, geometry: projectGeometry(row.geometry, def) };
    });
    return { rows: out, crs: "EPSG:4326", prj: PRJ_WKT["EPSG:4326"], converted: true, from: def.label || def.code };
  }

  function rowsToMapGeoJson(rows, options = {}) {
    const def = parseProjection(options.prj, options.crs, rows);
    const maxVertices = options.maxVertices == null ? 0 : options.maxVertices;
    const features = [];
    (rows || []).forEach((row, index) => {
      const geomType = row.geometry && row.geometry.type;
      const sourceGeom =
        LRS.asMapLines?.(row.geometry) ||
        (geomType === "Point" || geomType === "MultiPoint" ? row.geometry : null);
      if (!sourceGeom) return;
      const geometry = projectGeometry(sourceGeom, def, maxVertices);
      if (!geometry) return;
      const properties = { _row: index };
      for (const key of Object.keys(row)) {
        if (key === "geometry") continue;
        const value = mapPropertyValue(row[key]);
        if (value != null) properties[key] = value;
      }
      features.push({ type: "Feature", properties, geometry });
    });
    return { type: "FeatureCollection", features, crs: def.code, crsLabel: def.label };
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
    isPrjWkt,
    prjWkt,
    parseProjection,
    utmToLonLat,
    projectCoordinate,
    projectGeometry,
    rowsToWgs84,
    rowsToMapGeoJson,
    boundsOfCollection,
  });
  if (isNode) module.exports = LRS;
})(typeof globalThis !== "undefined" ? globalThis : this);
