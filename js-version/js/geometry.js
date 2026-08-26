(function (root) {
  const isNode = typeof module === "object" && module.exports;
  const LRS = isNode ? require("./dissolve.js") : root.LRS || (root.LRS = {});

  function asLines(geom) {
    if (!geom || geom.type == null) return [];
    if (geom.type === "LineString") return [geom];
    if (geom.type === "MultiLineString") {
      return (geom.coordinates || []).map((coordinates) => ({ type: "LineString", coordinates }));
    }
    if (geom.type === "GeometryCollection") {
      const lines = [];
      for (const part of geom.geometries || []) lines.push(...asLines(part));
      return lines;
    }
    return [];
  }

  function coordsHaveM(geom) {
    const coords = geom && geom.coordinates;
    if (!coords || !coords.length) return false;
    const first = coords[0];
    return Array.isArray(first) && first.length >= 4;
  }

  function lineLength(coords) {
    let length = 0;
    for (let i = 1; i < coords.length; i += 1) {
      const dx = coords[i][0] - coords[i - 1][0];
      const dy = coords[i][1] - coords[i - 1][1];
      length += Math.hypot(dx, dy);
    }
    return length;
  }

  function interpolate(a, b, t) {
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  }

  function coordAtNormalized(coords, t) {
    if (!coords || coords.length < 2) return null;
    const total = lineLength(coords);
    if (total <= 0) return [coords[0][0], coords[0][1]];
    const target = Math.max(0, Math.min(1, t)) * total;
    let traveled = 0;
    for (let i = 1; i < coords.length; i += 1) {
      const a = coords[i - 1];
      const b = coords[i];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (traveled + seg >= target) {
        const u = seg === 0 ? 0 : (target - traveled) / seg;
        return interpolate(a, b, u);
      }
      traveled += seg;
    }
    const last = coords[coords.length - 1];
    return [last[0], last[1]];
  }

  function coordAtM(coords, measure) {
    if (!coords || !coords.length) return null;
    const measures = coords.map((c) => c[3]);
    if (measure <= measures[0]) return [coords[0][0], coords[0][1]];
    if (measure >= measures[measures.length - 1]) {
      const last = coords[coords.length - 1];
      return [last[0], last[1]];
    }
    for (let i = 1; i < measures.length; i += 1) {
      const m0 = measures[i - 1];
      const m1 = measures[i];
      if ((m0 <= measure && measure <= m1) || (m1 <= measure && measure <= m0)) {
        const span = m1 - m0;
        const t = span === 0 ? 0 : (measure - m0) / span;
        return interpolate(coords[i - 1], coords[i], t);
      }
    }
    const last = coords[coords.length - 1];
    return [last[0], last[1]];
  }

  function pointAtMeasure(geom, lineBmp, lineEmp, measure) {
    if (!geom || measure == null) return null;
    const m = Number(measure);
    if (!Number.isFinite(m)) return null;
    for (const line of asLines(geom)) {
      const coords = line.coordinates || [];
      if (coords.length < 2) continue;
      if (coordsHaveM(line)) {
        const xy = coordAtM(coords, m);
        if (xy) return { type: "Point", coordinates: xy };
        continue;
      }
      if (lineBmp == null || lineEmp == null) continue;
      const span = Number(lineEmp) - Number(lineBmp);
      if (!(span > 0)) continue;
      const xy = coordAtNormalized(coords, (m - Number(lineBmp)) / span);
      if (xy) return { type: "Point", coordinates: xy };
    }
    return null;
  }

  function substringNormalized(geom, t0, t1) {
    const coords = geom.coordinates || [];
    if (coords.length < 2 || t1 <= t0) return null;
    const total = lineLength(coords);
    if (total <= 0) return null;
    const startDist = t0 * total;
    const stopDist = t1 * total;
    const kept = [];
    let traveled = 0;
    for (let i = 1; i < coords.length; i += 1) {
      const a = coords[i - 1];
      const b = coords[i];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const next = traveled + seg;
      if (next < startDist) {
        traveled = next;
        continue;
      }
      if (traveled <= startDist && kept.length === 0) {
        const t = seg === 0 ? 0 : (startDist - traveled) / seg;
        kept.push(interpolate(a, b, Math.max(0, Math.min(1, t))));
      }
      if (next < stopDist) {
        if (next > startDist) kept.push([b[0], b[1]]);
      } else {
        const t = seg === 0 ? 0 : (stopDist - traveled) / seg;
        kept.push(interpolate(a, b, Math.max(0, Math.min(1, t))));
        break;
      }
      traveled = next;
    }
    if (kept.length < 2) return null;
    return { type: "LineString", coordinates: kept };
  }

  function substringByM(geom, clipBmp, clipEmp) {
    const coords = geom.coordinates || [];
    const measures = coords.map((c) => c[3]);
    if (!measures.length || clipEmp <= measures[0] || clipBmp >= measures[measures.length - 1]) {
      return null;
    }

    function interp(m) {
      if (m <= measures[0]) return [coords[0][0], coords[0][1]];
      if (m >= measures[measures.length - 1]) {
        const last = coords[coords.length - 1];
        return [last[0], last[1]];
      }
      for (let i = 1; i < measures.length; i += 1) {
        const m0 = measures[i - 1];
        const m1 = measures[i];
        if ((m0 <= m && m <= m1) || (m1 <= m && m <= m0)) {
          const span = m1 - m0;
          const t = span === 0 ? 0 : (m - m0) / span;
          return interpolate(coords[i - 1], coords[i], t);
        }
      }
      const last = coords[coords.length - 1];
      return [last[0], last[1]];
    }

    const kept = [interp(clipBmp)];
    for (let i = 0; i < coords.length; i += 1) {
      if (clipBmp < measures[i] && measures[i] < clipEmp) {
        kept.push([coords[i][0], coords[i][1]]);
      }
    }
    kept.push(interp(clipEmp));
    if (kept.length < 2) return null;
    return { type: "LineString", coordinates: kept };
  }

  function isEmptyGeom(geom) {
    if (!geom) return true;
    if (geom.type === "LineString") return !geom.coordinates || geom.coordinates.length < 2;
    if (geom.type === "MultiLineString") return !geom.coordinates || !geom.coordinates.length;
    return false;
  }

  function geomLength(geom) {
    if (!geom) return 0;
    if (geom.type === "LineString") return lineLength(geom.coordinates || []);
    if (geom.type === "MultiLineString") {
      return (geom.coordinates || []).reduce((sum, coords) => sum + lineLength(coords), 0);
    }
    return 0;
  }

  function unionParts(parts) {
    if (!parts.length) return null;
    if (parts.length === 1) return parts[0];
    return {
      type: "MultiLineString",
      coordinates: parts.flatMap((part) =>
        part.type === "MultiLineString" ? part.coordinates : [part.coordinates]
      ),
    };
  }

  function splitLineByMeasure(geom, lineBmp, lineEmp, clipBmp, clipEmp) {
    if (isEmptyGeom(geom)) return null;
    if ([lineBmp, lineEmp, clipBmp, clipEmp].some((v) => v == null || Number.isNaN(v))) return null;
    const span = Number(lineEmp) - Number(lineBmp);
    if (span <= 0) return null;
    const start = Math.max(Number(clipBmp), Number(lineBmp));
    const stop = Math.min(Number(clipEmp), Number(lineEmp));
    if (stop <= start) return null;

    const parts = [];
    for (const line of asLines(geom)) {
      let clipped;
      if (coordsHaveM(line)) {
        clipped = substringByM(line, start, stop);
      } else {
        let t0 = (start - Number(lineBmp)) / span;
        let t1 = (stop - Number(lineBmp)) / span;
        t0 = Math.max(0, Math.min(1, t0));
        t1 = Math.max(0, Math.min(1, t1));
        if (t1 <= t0) continue;
        clipped = substringNormalized(line, t0, t1);
      }
      if (clipped && !isEmptyGeom(clipped) && geomLength(clipped) > 0) parts.push(clipped);
    }
    return unionParts(parts);
  }

  function locateEventsOnRoutes(events, routes, options = {}) {
    if (!events.length) return [];
    const eventSchema =
      options.eventSchema || LRS.LrsSchema.fromRows(events, { requireLine: true });
    const routeSchema =
      options.routeSchema || LRS.LrsSchema.fromRows(routes, { requireLine: true });
    eventSchema.validateLine(events);
    routeSchema.validateLine(routes);

    const ev = LRS.cloneRows(events);
    ev.forEach((row) => {
      row[eventSchema.bmp] = LRS.coerceNumeric(row[eventSchema.bmp]);
      row[eventSchema.emp] = LRS.coerceNumeric(row[eventSchema.emp]);
      row._merge_roadway = LRS.padRoadwayId(row[eventSchema.roadway]);
    });
    const rt = LRS.cloneRows(routes);
    rt.forEach((row) => {
      row[routeSchema.bmp] = LRS.coerceNumeric(row[routeSchema.bmp]);
      row[routeSchema.emp] = LRS.coerceNumeric(row[routeSchema.emp]);
      row._merge_roadway = LRS.padRoadwayId(row[routeSchema.roadway]);
    });
    const routesByRoad = LRS.groupBy(rt, (row) => row._merge_roadway);

    return ev.map((row) => {
      const pieces = routesByRoad.get(row._merge_roadway) || [];
      const clippedParts = [];
      for (const routeRow of pieces) {
        const clipped = splitLineByMeasure(
          routeRow.geometry,
          routeRow[routeSchema.bmp],
          routeRow[routeSchema.emp],
          row[eventSchema.bmp],
          row[eventSchema.emp]
        );
        if (clipped) clippedParts.push(clipped);
      }
      const out = LRS.dropColumns(row, ["_merge_roadway"]);
      out.geometry = unionParts(clippedParts);
      return out;
    });
  }

  function haversineMiles(a, b) {
    const earthMiles = 3958.7613;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * earthMiles * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function vertexDistance(a, b, crs) {
    if (!a || !b) return 0;
    if (crs === "EPSG:4326") return haversineMiles(a, b);
    const raw = Math.hypot((a[0] || 0) - (b[0] || 0), (a[1] || 0) - (b[1] || 0));
    if (crs === "EPSG:2236" || crs === "EPSG:2237") return raw / 5280;
    if (crs === "EPSG:26916" || crs === "EPSG:26917" || crs === "EPSG:3857") return raw / 1609.344;
    return raw;
  }

  function withMeasure(coord, measure) {
    if (!coord) return coord;
    if (coord.length >= 4) {
      const next = coord.slice();
      next[3] = measure;
      return next;
    }
    if (coord.length === 3) return [coord[0], coord[1], coord[2], measure];
    return [coord[0], coord[1], 0, measure];
  }

  function lineHasM(geom) {
    return asLines(geom).some((line) => coordsHaveM(line));
  }

  function applyMeasuresToLine(coords, startM, endM, crs) {
    if (!coords || coords.length < 2) return coords;
    const segs = [];
    let total = 0;
    for (let i = 1; i < coords.length; i += 1) {
      const dist = vertexDistance(coords[i - 1], coords[i], crs);
      segs.push(dist);
      total += dist;
    }
    const span = endM - startM;
    const out = [];
    let traveled = 0;
    out.push(withMeasure(coords[0], startM));
    for (let i = 1; i < coords.length; i += 1) {
      traveled += segs[i - 1];
      const t = total > 0 ? traveled / total : 1;
      out.push(withMeasure(coords[i], startM + t * span));
    }
    return out;
  }

  function calibrateRouteMeasures(rows, options = {}) {
    const work = LRS.cloneRows(rows);
    const columns = LRS.columnsOf(work);
    const crs = options.crs || "EPSG:4326";
    const resolved = LRS.resolveColumns(work, {
      roadway: options.roadway,
      bmp: options.bmp,
      emp: options.emp,
    });
    let roadway = resolved.roadway && columns.includes(resolved.roadway) ? resolved.roadway : null;
    let bmp = resolved.bmp && columns.includes(resolved.bmp) ? resolved.bmp : null;
    let emp = resolved.emp && columns.includes(resolved.emp) ? resolved.emp : null;
    const created = { roadway: false, measures: false, vertexM: 0 };
    if (!roadway) {
      roadway = "LRS_UID";
      created.roadway = true;
    }
    if (!bmp || !emp) {
      bmp = bmp || "LRS_BMP";
      emp = emp || "LRS_EMP";
      created.measures = true;
    }
    let nextId = 1;
    let wroteM = 0;
    let filledIds = 0;
    let filledMeasures = 0;
    for (const row of work) {
      const geom = row.geometry;
      const lines = asLines(geom);
      let length = 0;
      for (const line of lines) {
        const coords = line.coordinates || [];
        for (let i = 1; i < coords.length; i += 1) {
          length += vertexDistance(coords[i - 1], coords[i], crs);
        }
      }
      if (LRS.isMissing(row[roadway])) {
        row[roadway] = `R${String(nextId).padStart(6, "0")}`;
        nextId += 1;
        filledIds += 1;
      }
      let begin = LRS.coerceNumeric(row[bmp]);
      let end = LRS.coerceNumeric(row[emp]);
      if (begin == null || end == null || end <= begin) {
        begin = 0;
        end = length;
        row[bmp] = begin;
        row[emp] = end;
        filledMeasures += 1;
      }
      if (lines.length && !lineHasM(geom)) {
        if (geom.type === "LineString") {
          row.geometry = { type: "LineString", coordinates: applyMeasuresToLine(geom.coordinates, begin, end, crs) };
        } else if (geom.type === "MultiLineString") {
          let cursor = begin;
          const span = end - begin;
          const parts = [];
          const totals = (geom.coordinates || []).map((coords) => {
            let part = 0;
            for (let i = 1; i < (coords || []).length; i += 1) {
              part += vertexDistance(coords[i - 1], coords[i], crs);
            }
            return part;
          });
          const all = totals.reduce((sum, value) => sum + value, 0);
          for (let i = 0; i < (geom.coordinates || []).length; i += 1) {
            const partSpan = all > 0 ? (totals[i] / all) * span : 0;
            parts.push(applyMeasuresToLine(geom.coordinates[i], cursor, cursor + partSpan, crs));
            cursor += partSpan;
          }
          row.geometry = { type: "MultiLineString", coordinates: parts };
        }
        wroteM += 1;
      }
    }
    created.vertexM = wroteM;
    const lines = [];
    if (created.roadway || filledIds) {
      lines.push({
        level: "ok",
        text: created.roadway
          ? `Created ${roadway} for ${filledIds} route(s) that had no Route ID.`
          : `Filled ${filledIds} missing ${roadway} value(s).`,
      });
    }
    if (created.measures || filledMeasures) {
      lines.push({
        level: "warn",
        text: `Wrote ${bmp} / ${emp} from line length for ${filledMeasures} route(s). This is a generated LRS, not a published milepost system.`,
      });
    }
    if (wroteM) {
      lines.push({
        level: "warn",
        text: `Added measure (M) values on ${wroteM} route(s) by stretching ${bmp}–${emp} along line length. Clip is still length-ratio if the drawn length does not match EMP − BMP.`,
      });
    }
    if (!wroteM && !filledIds && !filledMeasures) {
      lines.push({ level: "ok", text: "Routes already have IDs and measures. Existing M values were kept." });
    }
    return { rows: work, roadway, bmp, emp, created, lines };
  }

  function exportLrsGeometry(routes, options = {}) {
    const { segmentId, startPost, endPost } = options;
    const columns = LRS.columnsOf(routes);
    const missing = [segmentId, startPost, endPost].filter((col) => !columns.includes(col));
    if (missing.length) {
      throw new Error(
        `Source geometry is missing the selected LRS fields: ${missing.join(", ")}. Available columns: ${columns.join(", ")}`
      );
    }
    const routeSchema = new LRS.LrsSchema({ roadway: segmentId, bmp: startPost, emp: endPost });
    let out;
    if (!options.events) {
      out = LRS.cloneRows(routes);
    } else {
      let ev = LRS.cloneRows(options.events).map((row) => LRS.dropColumns(row, ["geometry"]));
      let evId = options.eventSegmentId || (columns.includes(segmentId) && LRS.columnsOf(ev).includes(segmentId) ? segmentId : null);
      let evBmp = options.eventStartPost || (LRS.columnsOf(ev).includes(startPost) ? startPost : null);
      let evEmp = options.eventEndPost || (LRS.columnsOf(ev).includes(endPost) ? endPost : null);
      if (evId == null || evBmp == null || evEmp == null) {
        const detected = LRS.LrsSchema.fromRows(ev, { requireLine: true });
        evId = evId || detected.roadway;
        evBmp = evBmp || detected.bmp;
        evEmp = evEmp || detected.emp;
      }
      const eventSchema = new LRS.LrsSchema({ roadway: evId, bmp: evBmp, emp: evEmp });
      out = locateEventsOnRoutes(ev, routes, { eventSchema, routeSchema });
      if (options.dropEmpty !== false) {
        out = out.filter((row) => row.geometry && !isEmptyGeom(row.geometry));
      }
    }
    return out;
  }

  function isLineGeom(geom) {
    return Boolean(geom && (geom.type === "LineString" || geom.type === "MultiLineString") && !isEmptyGeom(geom));
  }

  function isPointGeom(geom) {
    return Boolean(
      geom &&
        ((geom.type === "Point" && geom.coordinates && geom.coordinates.length >= 2) ||
          (geom.type === "MultiPoint" && geom.coordinates && geom.coordinates.length))
    );
  }

  function asMapLines(geom) {
    if (!geom) return null;
    if (isLineGeom(geom)) return geom;
    if (geom.type === "Polygon" && geom.coordinates && geom.coordinates.length) {
      return { type: "MultiLineString", coordinates: geom.coordinates };
    }
    if (geom.type === "MultiPolygon") {
      const lines = [];
      for (const poly of geom.coordinates || []) {
        for (const ring of poly || []) {
          if (ring && ring.length >= 2) lines.push(ring);
        }
      }
      return lines.length ? { type: "MultiLineString", coordinates: lines } : null;
    }
    return null;
  }

  function rowsHaveLineGeometry(rows) {
    return (rows || []).some((row) => isLineGeom(row.geometry));
  }

  function rowsHaveMapGeometry(rows) {
    return (rows || []).some((row) => isPointGeom(row.geometry) || asMapLines(row.geometry));
  }

  function countLineGeometry(rows) {
    return (rows || []).filter((row) => isLineGeom(row.geometry)).length;
  }

  function countMapGeometry(rows) {
    return (rows || []).filter((row) => isPointGeom(row.geometry) || asMapLines(row.geometry)).length;
  }

  Object.assign(LRS, {
    asLines,
    asMapLines,
    coordsHaveM,
    pointAtMeasure,
    isPointGeom,
    calibrateRouteMeasures,
    substringByM,
    splitLineByMeasure,
    locateEventsOnRoutes,
    exportLrsGeometry,
    geomLength,
    isEmptyGeom,
    isLineGeom,
    rowsHaveLineGeometry,
    rowsHaveMapGeometry,
    countLineGeometry,
    countMapGeometry,
  });
  if (isNode) module.exports = LRS;
})(typeof globalThis !== "undefined" ? globalThis : this);
