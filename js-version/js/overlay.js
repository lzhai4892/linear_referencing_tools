(function (root) {
  const isNode = typeof module === "object" && module.exports;
  const LRS = isNode ? require("./dissolve.js") : root.LRS || (root.LRS = {});

  function overlayEvents(target, overlay, options = {}) {
    const how = options.how || "left";
    const collapse = options.collapse || "none";
    if (!["left", "inner"].includes(how)) throw new Error("how must be 'left' or 'inner'");
    if (!["none", "longest"].includes(collapse)) throw new Error("collapse must be 'none' or 'longest'");

    let left = LRS.cloneRows(target);
    let right = LRS.cloneRows(overlay);
    let targetSchema = options.targetSchema || LRS.LrsSchema.fromRows(left, { requireLine: true });
    const overlaySchema = options.overlaySchema || LRS.LrsSchema.fromRows(right, { requireLine: true });
    targetSchema.validateLine(left);
    overlaySchema.validateLine(right);

    if (options.targetRename) {
      left = left.map((row) => LRS.renameRow(row, options.targetRename));
      const updates = {};
      for (const field of ["roadway", "bmp", "emp"]) {
        const current = targetSchema[field];
        if (current in options.targetRename) updates[field] = options.targetRename[current];
      }
      targetSchema = targetSchema.withUpdates(updates);
    }

    left.forEach((row) => {
      row[targetSchema.bmp] = LRS.coerceNumeric(row[targetSchema.bmp]);
      row[targetSchema.emp] = LRS.coerceNumeric(row[targetSchema.emp]);
      row._merge_roadway = LRS.padRoadwayId(row[targetSchema.roadway]);
    });
    right.forEach((row) => {
      row[overlaySchema.bmp] = LRS.coerceNumeric(row[overlaySchema.bmp]);
      row[overlaySchema.emp] = LRS.coerceNumeric(row[overlaySchema.emp]);
      row._merge_roadway = LRS.padRoadwayId(row[overlaySchema.roadway]);
    });
    right = right.filter((row) => row[overlaySchema.bmp] != null && row[overlaySchema.emp] != null);

    const excludedOverlay = new Set([
      overlaySchema.roadway,
      overlaySchema.bmp,
      overlaySchema.emp,
      "_merge_roadway",
      "geometry",
    ]);
    const rightCols = LRS.columnsOf(right);
    const resolvedOverlayCols =
      options.overlayCols == null
        ? rightCols.filter((col) => !excludedOverlay.has(col))
        : options.overlayCols.filter((col) => rightCols.includes(col));

    const overlayByRoadway = LRS.groupBy(right, (row) => row._merge_roadway);
    const dropFromBase = new Set([targetSchema.bmp, targetSchema.emp, "_merge_roadway", "geometry"]);
    const rows = [];

    function emit(base, begin, end, overlayRow, matched) {
      if (begin == null || end == null || LRS.isMissing(begin) || LRS.isMissing(end)) {
        if (how === "left") {
          const out = LRS.cloneRow(base);
          out[targetSchema.bmp] = begin;
          out[targetSchema.emp] = end;
          for (const attr of resolvedOverlayCols) {
            out[attr] = overlayRow ? overlayRow[attr] : null;
          }
          rows.push(out);
        }
        return;
      }
      if (begin >= end) return;
      if (how === "inner" && !matched) return;
      const out = LRS.cloneRow(base);
      out[targetSchema.bmp] = begin;
      out[targetSchema.emp] = end;
      for (const attr of resolvedOverlayCols) {
        out[attr] = overlayRow ? overlayRow[attr] : null;
      }
      rows.push(out);
    }

    for (const row of left) {
      const newBmp = row[targetSchema.bmp];
      const newEmp = row[targetSchema.emp];
      const mergeRoad = row._merge_roadway;
      const base = LRS.dropColumns(row, dropFromBase);

      if (newBmp == null || newEmp == null) {
        emit(base, row[targetSchema.bmp], row[targetSchema.emp], null, false);
        continue;
      }

      const oldSegs = overlayByRoadway.get(mergeRoad) || [];
      const overlaps = oldSegs.filter((old) => {
        if (!(old[overlaySchema.bmp] < newEmp && old[overlaySchema.emp] > newBmp)) return false;
        for (const pair of options.matchPairs || []) {
          if (!pair || !pair.target || !pair.overlay) continue;
          if (LRS.compareKey(row[pair.target]) !== LRS.compareKey(old[pair.overlay])) return false;
        }
        if (options.dateOverlap && !LRS.dateRangesOverlap(row, old, options.dateOverlap)) return false;
        return true;
      });
      if (!overlaps.length) {
        emit(base, newBmp, newEmp, null, false);
        continue;
      }
      const breaks = new Set([newBmp, newEmp]);
      for (const old of overlaps) {
        breaks.add(Math.max(newBmp, old[overlaySchema.bmp]));
        breaks.add(Math.min(newEmp, old[overlaySchema.emp]));
      }
      const edges = [...breaks].filter((value) => value != null && Number.isFinite(value)).sort((a, b) => a - b);
      for (let i = 0; i < edges.length - 1; i += 1) {
        const begin = edges[i];
        const end = edges[i + 1];
        if (end <= begin) continue;
        const covering = overlaps.filter(
          (old) => old[overlaySchema.bmp] < end && old[overlaySchema.emp] > begin
        );
        if (!covering.length) {
          emit(base, begin, end, null, false);
          continue;
        }
        covering.sort((a, b) => {
          const beginDelta = a[overlaySchema.bmp] - b[overlaySchema.bmp];
          return beginDelta !== 0 ? beginDelta : a[overlaySchema.emp] - b[overlaySchema.emp];
        });
        for (const old of covering) emit(base, begin, end, old, true);
      }
    }

    if (!rows.length) return [];

    let result = LRS.sortRows(rows, [targetSchema.roadway, targetSchema.bmp]);
    if (collapse === "longest") {
      const collapseCols =
        options.collapseGroupCols == null
          ? LRS.columnsOf(result).filter(
              (col) =>
                !resolvedOverlayCols.includes(col) &&
                col !== targetSchema.bmp &&
                col !== targetSchema.emp
            )
          : [...options.collapseGroupCols];
      result = LRS.collapseLongest(result, { groupCols: collapseCols, schema: targetSchema });
    }
    return result;
  }

  Object.assign(LRS, { overlayEvents });
  if (isNode) module.exports = LRS;
})(typeof globalThis !== "undefined" ? globalThis : this);
