(function (root) {
  const isNode = typeof module === "object" && module.exports;
  const LRS = isNode ? require("./schema.js") : root.LRS || (root.LRS = {});

  function prepared(rows, schema) {
    const work = LRS.cloneRows(rows);
    work.forEach((row) => {
      row[schema.bmp] = LRS.coerceNumeric(row[schema.bmp]);
      row[schema.emp] = LRS.coerceNumeric(row[schema.emp]);
      row._merge_roadway = LRS.padRoadwayId(row[schema.roadway]);
    });
    return LRS.sortRows(work, ["_merge_roadway", schema.bmp, schema.emp]);
  }

  function extraGroupCols(rows, schema, extraCols) {
    const columns = LRS.columnsOf(rows);
    return (extraCols || []).filter((col) => col && columns.includes(col) && col !== schema.roadway);
  }

  function extraGroupKey(row, extraCols) {
    if (!extraCols.length) return "";
    return extraCols.map((col) => String(LRS.compareKey(row[col]))).join("\u001f");
  }

  function findGaps(rows, schema, options = {}) {
    if (!rows.length) {
      return [];
    }
    schema = schema || LRS.LrsSchema.fromRows(rows, { requireLine: true });
    schema.validateLine(rows);
    const extraCols = extraGroupCols(rows, schema, options.groupCols);
    let work = prepared(rows, schema);
    work = LRS.sortRows(work, ["_merge_roadway", ...extraCols, schema.bmp, schema.emp]);
    const gaps = [];
    for (let i = 1; i < work.length; i += 1) {
      const prev = work[i - 1];
      const curr = work[i];
      const sameGroup =
        curr._merge_roadway != null &&
        curr._merge_roadway === prev._merge_roadway &&
        extraGroupKey(curr, extraCols) === extraGroupKey(prev, extraCols);
      const gapLen = curr[schema.bmp] != null && prev[schema.emp] != null
        ? curr[schema.bmp] - prev[schema.emp]
        : null;
      if (sameGroup && gapLen != null && gapLen > schema.tolerance) {
        gaps.push({
          ROADWAY: curr._merge_roadway,
          GAP_BMP: prev[schema.emp],
          GAP_EMP: curr[schema.bmp],
          GAP_LENGTH: curr[schema.bmp] - prev[schema.emp],
        });
      }
    }
    return gaps;
  }

  function findOverlaps(rows, schema, options = {}) {
    schema = schema || LRS.LrsSchema.fromRows(rows, { requireLine: true });
    schema.validateLine(rows);
    const extraCols = extraGroupCols(rows, schema, options.groupCols);
    let work = prepared(rows, schema).filter(
      (row) => row._merge_roadway != null && row[schema.bmp] != null && row[schema.emp] != null
    );
    const out = [];
    const groups = LRS.groupBy(work, (row) => `${row._merge_roadway}\u001f${extraGroupKey(row, extraCols)}`);
    for (const [key, group] of groups.entries()) {
      const road = key.split("\u001f")[0];
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const left = group[i];
          const right = group[j];
          if (left[schema.bmp] < right[schema.emp] && left[schema.emp] > right[schema.bmp]) {
            out.push({
              ROADWAY: road,
              LEFT_BMP: left[schema.bmp],
              LEFT_EMP: left[schema.emp],
              RIGHT_BMP: right[schema.bmp],
              RIGHT_EMP: right[schema.emp],
            });
          }
        }
      }
    }
    return out;
  }

  function neighborsAlongRoute(rows, valueCol, options = {}) {
    const columns = LRS.columnsOf(rows);
    if (!columns.includes(valueCol)) {
      throw new Error(`value_col '${valueCol}' is not in the DataFrame`);
    }
    const work = LRS.cloneRows(rows);
    const schema = options.schema || LRS.LrsSchema.fromRows(work);
    if (!columns.includes(schema.roadway)) {
      throw new Error(`route ID column '${schema.roadway}' is not in the DataFrame`);
    }
    const orderCol = options.sortCol || schema.measure || schema.bmp;
    if (!columns.includes(orderCol)) {
      throw new Error(`sort column '${orderCol}' is not in the DataFrame`);
    }
    work.forEach((row) => {
      row[orderCol] = LRS.coerceNumeric(row[orderCol]);
      row._merge_roadway = LRS.padRoadwayId(row[schema.roadway]);
    });
    const sorted = LRS.sortRows(work, ["_merge_roadway", orderCol]);
    const groups = LRS.groupBy(sorted, (row) => row._merge_roadway);
    const result = [];
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i += 1) {
        const row = LRS.dropColumns(group[i], ["_merge_roadway"]);
        const prev = i > 0 ? group[i - 1] : null;
        const next = i < group.length - 1 ? group[i + 1] : null;
        row.Upstream_Value = prev ? prev[valueCol] : null;
        row.Downstream_Value = next ? next[valueCol] : null;
        row.Upstream_Measure = prev ? prev[orderCol] : null;
        row.Downstream_Measure = next ? next[orderCol] : null;
        const value = LRS.coerceNumeric(row[valueCol]);
        const up = LRS.coerceNumeric(row.Upstream_Value);
        const down = LRS.coerceNumeric(row.Downstream_Value);
        row.Upstream_Diff_pct = value != null && up != null && up !== 0 ? (value - up) / up : null;
        row.Downstream_Diff_pct =
          value != null && down != null && down !== 0 ? (value - down) / down : null;
        result.push(row);
      }
    }
    return result;
  }

  function validateLrs(rows, schema, options = {}) {
    schema = schema || LRS.LrsSchema.fromRows(rows, { requireLine: true });
    schema.validateLine(rows);
    const work = prepared(rows, schema);
    const invalidBounds = work.filter(
      (row) => row[schema.bmp] != null && row[schema.emp] != null && row[schema.bmp] > row[schema.emp]
    );
    const zeroLength = work.filter(
      (row) => row[schema.bmp] != null && row[schema.emp] != null && row[schema.bmp] === row[schema.emp]
    );
    const nullKeys = work.filter(
      (row) => row._merge_roadway == null || row[schema.bmp] == null || row[schema.emp] == null
    );
    const cleaned = work.map((row) => LRS.dropColumns(row, ["_merge_roadway"]));
    return {
      invalidBounds: invalidBounds.map((row) => LRS.dropColumns(row, ["_merge_roadway"])),
      zeroLength: zeroLength.map((row) => LRS.dropColumns(row, ["_merge_roadway"])),
      overlaps: findOverlaps(cleaned, schema, options),
      nullKeys: nullKeys.map((row) => LRS.dropColumns(row, ["_merge_roadway"])),
      gaps: findGaps(cleaned, schema, options),
      get ok() {
        return (
          !this.invalidBounds.length &&
          !this.zeroLength.length &&
          !this.overlaps.length &&
          !this.nullKeys.length &&
          !this.gaps.length
        );
      },
    };
  }

  Object.assign(LRS, { findGaps, findOverlaps, neighborsAlongRoute, validateLrs });
  if (isNode) module.exports = LRS;
})(typeof globalThis !== "undefined" ? globalThis : this);
