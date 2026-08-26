(function (root) {
  const isNode = typeof module === "object" && module.exports;
  const LRS = isNode ? require("./geometry.js") : root.LRS || (root.LRS = {});

  const PREVIEW_PREFERRED = [
    "ROADWAY",
    "BEGIN_POST",
    "END_POST",
    "LOCATION",
    "LRS_PARENT_ID",
    "LRS_SUB_ID",
    "LRS_ROAD_NAME",
  ];

  function schemaOf(rows, options) {
    return options || LRS.LrsSchema.fromRows(rows);
  }

  function roadId(row, col) {
    return LRS.padRoadwayId(row[col]);
  }

  function roadSet(rows, col) {
    const set = new Set();
    for (const row of rows) {
      const id = roadId(row, col);
      if (id) set.add(id);
    }
    return set;
  }

  function listSample(values, limit) {
    const items = [...values].slice(0, limit);
    const extra = values.size != null ? values.size - items.length : values.length - items.length;
    const text = items.join(", ");
    return extra > 0 ? `${text} (+${extra} more)` : text;
  }

  function line(level, text, sample) {
    return { level, text, sample: sample || null };
  }

  function reportOverlay(target, overlay, result, options = {}) {
    const targetSchema = schemaOf(target, options.targetSchema || LRS.LrsSchema.fromRows(target, { requireLine: true }));
    const overlaySchema = schemaOf(overlay, options.overlaySchema || LRS.LrsSchema.fromRows(overlay, { requireLine: true }));
    const tRoads = roadSet(target, targetSchema.roadway);
    const oRoads = roadSet(overlay, overlaySchema.roadway);
    const onlyTarget = [...tRoads].filter((id) => !oRoads.has(id));
    const onlyOverlay = [...oRoads].filter((id) => !tRoads.has(id));
    const both = [...tRoads].filter((id) => oRoads.has(id));

    let inverted = 0;
    let nullKeys = 0;
    let unmatchedStretches = 0;
    for (const row of target) {
      const bmp = LRS.coerceNumeric(row[targetSchema.bmp]);
      const emp = LRS.coerceNumeric(row[targetSchema.emp]);
      if (roadId(row, targetSchema.roadway) == null || bmp == null || emp == null) nullKeys += 1;
      else if (bmp > emp) inverted += 1;
    }
    const overlayCols = LRS.columnsOf(overlay).filter(
      (col) => ![overlaySchema.roadway, overlaySchema.bmp, overlaySchema.emp, "geometry"].includes(col)
    );
    const flagCol = overlayCols[0];
    if (flagCol) {
      unmatchedStretches = result.filter((row) => row[flagCol] == null).length;
    }

    const lines = [
      line("info", `Target: ${target.length} rows, ${tRoads.size} routes.`),
      line("info", `Overlay: ${overlay.length} rows, ${oRoads.size} routes.`),
      line("ok", `Result: ${result.length} slices. Shared routes: ${both.length}.`),
    ];
    if (onlyTarget.length) {
      lines.push(
        line(
          "warn",
          `${onlyTarget.length} target route(s) have no overlay match — those stretches keep target attributes only.`,
          listSample(onlyTarget, 8)
        )
      );
    }
    if (onlyOverlay.length) {
      lines.push(
        line(
          "warn",
          `${onlyOverlay.length} overlay route(s) are not in the target — they were not used.`,
          listSample(onlyOverlay, 8)
        )
      );
    }
    if (unmatchedStretches) {
      lines.push(line("warn", `${unmatchedStretches} result slice(s) have no overlay attributes (gap or unmatched route).`));
    }
    if (nullKeys) lines.push(line("warn", `${nullKeys} target row(s) have a null route ID or milepost.`));
    if (inverted) lines.push(line("err", `${inverted} target row(s) have BMP ≥ EMP.`));
    return { lines, onlyTarget, onlyOverlay, both: both.length, unmatchedStretches, inverted, nullKeys };
  }

  function reportLocate(points, events, located, unmatched, options = {}) {
    const pointSchema = schemaOf(points, options.pointSchema || LRS.LrsSchema.fromRows(points, { requireMeasure: true }));
    const eventSchema = schemaOf(events, options.eventSchema || LRS.LrsSchema.fromRows(events, { requireLine: true }));
    const eventRoads = roadSet(events, eventSchema.roadway);
    let noRoadway = 0;
    let offMeasure = 0;
    let nullMeasure = 0;
    const missIds = new Set();
    for (const point of points) {
      const id = roadId(point, pointSchema.roadway);
      const measure = LRS.coerceNumeric(point[pointSchema.measure]);
      if (measure == null) {
        nullMeasure += 1;
        continue;
      }
      if (!id || !eventRoads.has(id)) {
        noRoadway += 1;
        if (id) missIds.add(id);
        continue;
      }
      const on = events.some((event) => {
        if (roadId(event, eventSchema.roadway) !== id) return false;
        const bmp = LRS.coerceNumeric(event[eventSchema.bmp]);
        const emp = LRS.coerceNumeric(event[eventSchema.emp]);
        return bmp != null && emp != null && measure >= bmp && measure <= emp;
      });
      if (!on) {
        offMeasure += 1;
        missIds.add(id);
      }
    }
    const lines = [
      line("info", `Points: ${points.length}. Line events: ${events.length}, ${eventRoads.size} routes.`),
      line("ok", `Located: ${located.length}. Unmatched join rows: ${unmatched.length}.`),
    ];
    if (noRoadway) {
      lines.push(
        line("warn", `${noRoadway} point(s) have no matching route ID in the line events.`, listSample(missIds, 8))
      );
    }
    if (offMeasure) {
      lines.push(line("warn", `${offMeasure} point(s) match a route ID but sit outside every BMP–EMP.`));
    }
    if (nullMeasure) lines.push(line("warn", `${nullMeasure} point(s) have a null measure.`));
    return { lines, noRoadway, offMeasure, nullMeasure };
  }

  function reportClip(events, routes, result, options = {}) {
    const eventSchema = schemaOf(events, options.eventSchema || LRS.LrsSchema.fromRows(events, { requireLine: true }));
    const routeSchema = schemaOf(routes, options.routeSchema || LRS.LrsSchema.fromRows(routes, { requireLine: true }));
    const routeRoads = roadSet(routes, routeSchema.roadway);
    const eventRoads = roadSet(events, eventSchema.roadway);
    const onlyEvents = [...eventRoads].filter((id) => !routeRoads.has(id));
    const onlyRoutes = [...routeRoads].filter((id) => !eventRoads.has(id));
    let noGeom = 0;
    let noRouteGeom = 0;
    let inverted = 0;
    const missIds = new Set();
    const routesByRoad = LRS.groupBy(routes, (row) => roadId(row, routeSchema.roadway));
    events.forEach((event, index) => {
      const id = roadId(event, eventSchema.roadway);
      const bmp = LRS.coerceNumeric(event[eventSchema.bmp]);
      const emp = LRS.coerceNumeric(event[eventSchema.emp]);
      if (bmp != null && emp != null && bmp >= emp) inverted += 1;
      const out = result[index];
      const empty = !out || !LRS.isLineGeom(out.geometry);
      if (!empty) return;
      noGeom += 1;
      const pieces = routesByRoad.get(id) || [];
      if (!id || !pieces.length) {
        missIds.add(id || "(null)");
        return;
      }
      const hasGeom = pieces.some((row) => LRS.isLineGeom(row.geometry));
      if (!hasGeom) noRouteGeom += 1;
      else missIds.add(id);
    });
    const withGeom = LRS.countLineGeometry(result);
    const lines = [
      line("info", `Events: ${events.length} rows, ${eventRoads.size} routes.`),
      line("info", `Routes: ${routes.length} rows, ${routeRoads.size} routes.`),
      line(withGeom ? "ok" : "warn", `Geometries written: ${withGeom} of ${result.length}.`),
    ];
    if (onlyEvents.length) {
      lines.push(
        line("warn", `${onlyEvents.length} event route(s) are not in the route layer.`, listSample(onlyEvents, 8))
      );
    }
    if (onlyRoutes.length) {
      lines.push(
        line(
          "info",
          `${onlyRoutes.length} route(s) have no events in this table (unused).`,
          listSample(onlyRoutes, 8)
        )
      );
    }
    if (noGeom) {
      lines.push(
        line(
          "warn",
          `${noGeom} event(s) produced no line — route ID missing, measure outside the route, or route has no geometry.`,
          listSample(missIds, 8)
        )
      );
    }
    if (noRouteGeom) lines.push(line("err", `${noRouteGeom} matched route(s) have no line geometry on the route layer.`));
    if (inverted) lines.push(line("err", `${inverted} event row(s) have BMP ≥ EMP.`));
    return { lines, onlyEvents, onlyRoutes, noGeom, withGeom };
  }

  function reportValidate(validation) {
    const lines = [
      line(
        validation.ok ? "ok" : "err",
        validation.ok
          ? "QC passed — no inverted bounds, zero-length rows, null keys, overlaps, or gaps."
          : "QC found problems that should be fixed before overlay."
      ),
      line("info", `Inverted BMP > EMP: ${validation.invalidBounds.length}.`),
      line(
        validation.zeroLength && validation.zeroLength.length ? "warn" : "info",
        `Zero-length BMP = EMP: ${(validation.zeroLength || []).length}.`
      ),
      line("info", `Null route ID or milepost: ${validation.nullKeys.length}.`),
      line("info", `Overlaps: ${validation.overlaps.length}.`),
      line(validation.gaps.length ? "warn" : "ok", `Coverage gaps: ${validation.gaps.length}.`),
    ];
    return { lines };
  }

  function reportEventKeys(inspect, sourceCount) {
    const total = sourceCount == null ? inspect.usable + inspect.missing + inspect.inverted : sourceCount;
    const lines = [];
    if (inspect.hasLineColumns && inspect.usable) {
      lines.push(line("ok", `${inspect.usable} of ${total} row(s) already have usable Route ID / BMP / EMP.`));
    } else {
      lines.push(line("warn", "No usable BEGIN_POST / END_POST on this table."));
    }
    if (inspect.packedCol) {
      lines.push(
        line(
          inspect.recommended === "extract" ? "warn" : "info",
          `Packed approaches found in ${inspect.packedCol}: ${inspect.approachCount} approach(es) on ${inspect.packedHits} row(s).`
        )
      );
      if (inspect.recommended === "extract") {
        lines.push(
          line(
            "warn",
            `Open Extract / combine and extract from ${inspect.packedCol} before Display. This table cannot be drawn from Route ID / BMP / EMP as-is.`
          )
        );
      } else if (inspect.approachCount > inspect.usable) {
        lines.push(
          line(
            "info",
            `Extract is optional. Keep this table, or use Extract / combine to expand it to ${inspect.approachCount} approach rows.`
          )
        );
      }
    }
    return { lines };
  }

  function reportExplode(sourceCount, exploded) {
    const lines = [
      line("info", `Source rows: ${sourceCount}.`),
      line("ok", `Approaches written: ${exploded.rows.length}.`),
    ];
    if (exploded.packedCol) {
      lines.push(line("info", `Extracted from ${exploded.packedCol}.`));
    }
    if (exploded.skipped) {
      lines.push(line("warn", `${exploded.skipped} source row(s) had no parseable packed routes.`));
    }
    return { lines };
  }

  function flattenValidation(validation, schema) {
    const rows = [];
    for (const row of validation.invalidBounds) {
      rows.push({
        ISSUE: "inverted_bounds",
        ROADWAY: row[schema.roadway],
        BMP: row[schema.bmp],
        EMP: row[schema.emp],
      });
    }
    for (const row of validation.zeroLength || []) {
      rows.push({
        ISSUE: "zero_length",
        ROADWAY: row[schema.roadway],
        BMP: row[schema.bmp],
        EMP: row[schema.emp],
        NOTE: "Reported, not deleted. Point events stay in the session table.",
      });
    }
    for (const row of validation.nullKeys) {
      rows.push({
        ISSUE: "null_key",
        ROADWAY: row[schema.roadway],
        BMP: row[schema.bmp],
        EMP: row[schema.emp],
      });
    }
    for (const row of validation.overlaps) {
      rows.push({
        ISSUE: "overlap",
        ROADWAY: row.ROADWAY,
        BMP: row.LEFT_BMP,
        EMP: row.LEFT_EMP,
        NOTE: `${row.RIGHT_BMP}–${row.RIGHT_EMP}`,
      });
    }
    for (const row of validation.gaps) {
      rows.push({
        ISSUE: "gap",
        ROADWAY: row.ROADWAY,
        BMP: row.GAP_BMP,
        EMP: row.GAP_EMP,
        NOTE: row.GAP_LENGTH,
      });
    }
    return rows;
  }

  function previewColumns(rows) {
    const all = LRS.columnsOf(rows).filter((col) => col !== "geometry");
    const preferred = PREVIEW_PREFERRED.filter((col) => all.includes(col));
    const extra = all.filter((col) => !preferred.includes(col)).slice(0, 6);
    const cols = [...preferred, ...extra];
    if (rows.some((row) => row.geometry)) cols.push("geometry");
    return cols;
  }

  Object.assign(LRS, {
    reportOverlay,
    reportLocate,
    reportClip,
    reportValidate,
    reportEventKeys,
    reportExplode,
    flattenValidation,
    previewColumns,
  });
  if (isNode) module.exports = LRS;
})(typeof globalThis !== "undefined" ? globalThis : this);
