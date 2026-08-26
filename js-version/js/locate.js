(function (root) {
  const isNode = typeof module === "object" && module.exports;
  const LRS = isNode ? require("./schema.js") : root.LRS || (root.LRS = {});

  function locatePoints(points, events, options = {}) {
    const how = options.how || "inner";
    if (!["inner", "left"].includes(how)) throw new Error("how must be 'inner' or 'left'");

    const pts = LRS.cloneRows(points);
    let ev = LRS.cloneRows(events);
    const pointSchema = options.pointSchema || LRS.LrsSchema.fromRows(pts, { requireMeasure: true });
    const eventSchema = options.eventSchema || LRS.LrsSchema.fromRows(ev, { requireLine: true });
    pointSchema.validatePoint(pts);
    eventSchema.validateLine(ev);

    pts.forEach((row) => {
      row._merge_roadway = LRS.padRoadwayId(row[pointSchema.roadway]);
      row[pointSchema.measure] = LRS.coerceNumeric(row[pointSchema.measure]);
    });
    ev.forEach((row) => {
      row._merge_roadway = LRS.padRoadwayId(row[eventSchema.roadway]);
      row[eventSchema.bmp] = LRS.coerceNumeric(row[eventSchema.bmp]);
      row[eventSchema.emp] = LRS.coerceNumeric(row[eventSchema.emp]);
    });

    const evCols = LRS.columnsOf(ev);
    let keepEvent;
    if (options.eventCols == null) {
      keepEvent = evCols.filter((col) => col !== eventSchema.roadway && col !== "_merge_roadway" && col !== "geometry");
    } else {
      keepEvent = options.eventCols.filter((col) => evCols.includes(col) && col !== "geometry");
      for (const required of [eventSchema.bmp, eventSchema.emp]) {
        if (!keepEvent.includes(required) && evCols.includes(required)) keepEvent.push(required);
      }
    }

    const protectPoint = new Set([
      pointSchema.roadway,
      pointSchema.measure,
      "_merge_roadway",
      "LRS_PARENT_ID",
      "LRS_SUB_ID",
      "LRS_SOURCE_ROW",
      "ROADWAY_ORIG",
    ]);

    function coversMeasure(eventRow, measure, onRoad) {
      const bmp = eventRow[eventSchema.bmp];
      const emp = eventRow[eventSchema.emp];
      if (measure == null || bmp == null || emp == null) return false;
      if (measure < bmp || measure > emp) return false;
      if (measure === emp && measure > bmp) {
        const startsNext = onRoad.some((other) => other !== eventRow && other[eventSchema.bmp] === measure);
        if (startsNext) return false;
      }
      return true;
    }

    const joined = [];
    for (const point of pts) {
      const onRoad = ev.filter((row) => {
        if (row._merge_roadway !== point._merge_roadway) return false;
        for (const pair of options.matchPairs || []) {
          if (!pair || !pair.point || !pair.event) continue;
          if (LRS.compareKey(point[pair.point]) !== LRS.compareKey(row[pair.event])) return false;
        }
        return true;
      });
      const matches = onRoad.filter((row) => coversMeasure(row, point[pointSchema.measure], onRoad));
      const partners = matches.length ? matches : [null];
      for (const eventRow of partners) {
        const out = LRS.dropColumns(point, ["_merge_roadway"]);
        for (const col of keepEvent) {
          if (protectPoint.has(col) || col === "geometry") continue;
          out[col] = eventRow ? eventRow[col] : null;
        }
        const fromPoint = LRS.isPointGeom?.(point.geometry) ? point.geometry : null;
        const fromLine =
          eventRow && LRS.pointAtMeasure
            ? LRS.pointAtMeasure(
                eventRow.geometry,
                eventRow[eventSchema.bmp],
                eventRow[eventSchema.emp],
                point[pointSchema.measure]
              )
            : null;
        if (fromPoint || fromLine) out.geometry = fromPoint || fromLine;
        else delete out.geometry;
        joined.push(out);
      }
    }

    const located = [];
    const unmatched = [];
    for (const row of joined) {
      const measure = LRS.coerceNumeric(row[pointSchema.measure]);
      const bmp = LRS.coerceNumeric(row[eventSchema.bmp]);
      const emp = LRS.coerceNumeric(row[eventSchema.emp]);
      const onSegment = measure != null && bmp != null && emp != null && measure >= bmp && measure <= emp;
      if (onSegment) located.push(row);
      else unmatched.push(row);
    }
    return { located, unmatched };
  }

  Object.assign(LRS, { locatePoints });
  if (isNode) module.exports = LRS;
})(typeof globalThis !== "undefined" ? globalThis : this);
