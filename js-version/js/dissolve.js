(function (root) {
  const isNode = typeof module === "object" && module.exports;
  const LRS = isNode ? require("./schema.js") : root.LRS || (root.LRS = {});

  function blockIds(rows, groupCols, schema, requireContiguous) {
    if (!rows.length) return [];
    const changed = rows.map(() => false);
    for (const col of groupCols) {
      for (let i = 0; i < rows.length; i += 1) {
        const prev = i === 0 ? null : rows[i - 1][col];
        if (LRS.compareKey(rows[i][col]) !== LRS.compareKey(prev)) changed[i] = true;
      }
    }
    if (requireContiguous) {
      for (let i = 0; i < rows.length; i += 1) {
        const prevEnd = i === 0 ? null : LRS.coerceNumeric(rows[i - 1][schema.emp]);
        const currBegin = LRS.coerceNumeric(rows[i][schema.bmp]);
        const gap = prevEnd == null || currBegin == null ? null : Math.abs(currBegin - prevEnd);
        const notContiguous = gap == null || gap > schema.tolerance;
        const sameRoadway =
          i > 0 &&
          LRS.compareKey(rows[i][schema.roadway]) === LRS.compareKey(rows[i - 1][schema.roadway]);
        if ((notContiguous && sameRoadway) || !sameRoadway) changed[i] = true;
      }
    }
    changed[0] = true;
    const ids = [];
    let current = 0;
    for (let i = 0; i < changed.length; i += 1) {
      if (changed[i]) current += 1;
      ids.push(current);
    }
    return ids;
  }

  function unionGeometries(parts) {
    const geoms = parts.filter((geom) => geom && geom.type);
    if (!geoms.length) return null;
    const lines = [];
    for (const geom of geoms) {
      if (geom.type === "LineString") lines.push(geom.coordinates);
      else if (geom.type === "MultiLineString") lines.push(...geom.coordinates);
    }
    if (!lines.length) return geoms[0];
    if (lines.length === 1) return { type: "LineString", coordinates: lines[0] };
    return { type: "MultiLineString", coordinates: lines };
  }

  function attributeGroupColumns(rows, schema, extraExclude) {
    const skip = new Set([schema.bmp, schema.emp, "geometry", "_merge_roadway", ...(extraExclude || [])]);
    const cols = LRS.columnsOf(rows).filter((col) => !skip.has(col));
    if (schema.roadway && !cols.includes(schema.roadway)) cols.unshift(schema.roadway);
    return cols.length ? cols : [schema.roadway];
  }

  function dissolveContiguous(rows, options = {}) {
    if (!rows.length) return [];
    let work = LRS.cloneRows(rows);
    const schema = options.schema || LRS.LrsSchema.fromRows(work, { requireLine: true });
    schema.validateLine(work);
    work.forEach((row) => {
      row[schema.bmp] = LRS.coerceNumeric(row[schema.bmp]);
      row[schema.emp] = LRS.coerceNumeric(row[schema.emp]);
    });
    work = work.filter((row) => row[schema.bmp] != null && row[schema.emp] != null);

    let resolvedGroups;
    if (options.groupCols == null || (Array.isArray(options.groupCols) && !options.groupCols.length)) {
      resolvedGroups = attributeGroupColumns(work, schema);
    } else {
      const columns = LRS.columnsOf(work);
      resolvedGroups = options.groupCols.filter((col) => columns.includes(col));
      if (!resolvedGroups.includes(schema.roadway)) {
        resolvedGroups = [schema.roadway, ...resolvedGroups];
      }
    }

    const sortCols = [...resolvedGroups];
    if (!sortCols.includes(schema.bmp)) sortCols.push(schema.bmp);
    if (LRS.columnsOf(work).includes(schema.emp) && !sortCols.includes(schema.emp)) sortCols.push(schema.emp);
    work = LRS.sortRows(work, sortCols);
    const ids = blockIds(work, resolvedGroups, schema, options.requireContiguous !== false);

    const blocks = new Map();
    work.forEach((row, index) => {
      const id = ids[index];
      if (!blocks.has(id)) blocks.set(id, []);
      blocks.get(id).push(row);
    });

    const result = [];
    for (const group of blocks.values()) {
      const out = LRS.cloneRow(group[0]);
      for (const col of resolvedGroups) out[col] = group[0][col];
      out[schema.bmp] = Math.min(...group.map((row) => row[schema.bmp]));
      out[schema.emp] = Math.max(...group.map((row) => row[schema.emp]));
      if (group.some((row) => row.geometry)) {
        out.geometry = unionGeometries(group.map((row) => row.geometry));
      }
      result.push(out);
    }
    return LRS.sortRows(result, [schema.roadway, schema.bmp]);
  }

  function collapseLongest(rows, options = {}) {
    if (!rows.length) return [];
    let work = LRS.cloneRows(rows);
    const schema = options.schema || LRS.LrsSchema.fromRows(work, { requireLine: true });
    schema.validateLine(work);
    work.forEach((row) => {
      row[schema.bmp] = LRS.coerceNumeric(row[schema.bmp]);
      row[schema.emp] = LRS.coerceNumeric(row[schema.emp]);
    });
    work = work.filter((row) => row[schema.bmp] != null && row[schema.emp] != null);

    let resolvedGroups;
    if (options.groupCols == null || (Array.isArray(options.groupCols) && !options.groupCols.length)) {
      resolvedGroups = attributeGroupColumns(work, schema);
    } else {
      const columns = LRS.columnsOf(work);
      resolvedGroups = options.groupCols.filter((col) => columns.includes(col));
      if (!resolvedGroups.length) resolvedGroups = [schema.roadway];
    }

    const sortCols = [...resolvedGroups];
    if (!sortCols.includes(schema.bmp)) sortCols.push(schema.bmp);
    if (!sortCols.includes(schema.emp)) sortCols.push(schema.emp);
    work = LRS.sortRows(work, sortCols);
    const ids = blockIds(work, resolvedGroups, schema, true);
    const byBlock = new Map();
    work.forEach((row, index) => {
      const id = ids[index];
      const sliceLength = row[schema.emp] - row[schema.bmp];
      if (!byBlock.has(id)) byBlock.set(id, []);
      byBlock.get(id).push({ row, sliceLength });
    });

    const result = [];
    for (const group of byBlock.values()) {
      let best = group[0];
      let minBmp = group[0].row[schema.bmp];
      let maxEmp = group[0].row[schema.emp];
      for (const item of group) {
        if (item.sliceLength >= best.sliceLength) best = item;
        minBmp = Math.min(minBmp, item.row[schema.bmp]);
        maxEmp = Math.max(maxEmp, item.row[schema.emp]);
      }
      const out = LRS.cloneRow(best.row);
      out[schema.bmp] = minBmp;
      out[schema.emp] = maxEmp;
      result.push(out);
    }
    return LRS.sortRows(result, [schema.roadway, schema.bmp]);
  }

  Object.assign(LRS, { attributeGroupColumns, dissolveContiguous, collapseLongest });
  if (isNode) module.exports = LRS;
})(typeof globalThis !== "undefined" ? globalThis : this);
