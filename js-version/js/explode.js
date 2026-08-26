(function (root) {
  const isNode = typeof module === "object" && module.exports;
  const LRS = isNode ? require("./schema.js") : root.LRS || (root.LRS = {});

  const PACKED_ALIASES = [
    "Intersecting Roadway Id Milepoints",
    "INTERSECTING ROADWAY ID MILEPOINTS",
    "INTERSECTING_ROADWAY_ID_MILEPOINTS",
  ];
  const NAME_ALIASES = ["Intersecting Road Names", "INTERSECTING ROAD NAMES"];
  const PARENT_ALIASES = ["LocationID", "LOCATIONID", "OBJECTID_1", "OBJECTID"];

  function findColumn(columns, aliases) {
    const lower = new Map(columns.map((col) => [String(col).toLowerCase(), col]));
    for (const alias of aliases) {
      if (lower.has(alias.toLowerCase())) return lower.get(alias.toLowerCase());
    }
    return null;
  }

  function formatMeasure(value) {
    if (value == null || Number.isNaN(value)) return "";
    const text = String(value);
    if (text.includes("e") || text.includes("E")) return String(value);
    return text;
  }

  function parsePackedApproaches(text) {
    if (LRS.isMissing(text)) return [];
    const parts = String(text).split("|");
    const out = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const roadway = trimmed.slice(0, eq).trim();
      const rest = trimmed.slice(eq + 1).trim();
      if (!roadway || !rest) continue;
      const range = rest.split(/\s*[-–]\s*|\s*,\s*/);
      const first = LRS.coerceNumeric(range[0]);
      const second = range.length > 1 ? LRS.coerceNumeric(range[1]) : null;
      if (first == null) continue;
      out.push({
        roadway,
        measure: first,
        bmp: first,
        emp: second != null ? second : first,
      });
    }
    return out;
  }

  function detectPackedColumn(rows) {
    const columns = LRS.columnsOf(rows);
    const named = findColumn(columns, PACKED_ALIASES);
    if (named) return named;
    let best = null;
    let bestHits = 0;
    for (const col of columns) {
      let hits = 0;
      for (const row of rows.slice(0, 50)) {
        const value = row[col];
        if (typeof value === "string" && value.includes("=") && parsePackedApproaches(value).length) {
          hits += 1;
        }
      }
      if (hits > bestHits) {
        bestHits = hits;
        best = col;
      }
    }
    return bestHits >= 1 ? best : null;
  }

  function detectParentColumn(rows) {
    return findColumn(LRS.columnsOf(rows), PARENT_ALIASES);
  }

  function detectNamesColumn(rows) {
    return findColumn(LRS.columnsOf(rows), NAME_ALIASES);
  }

  function inspectEventKeys(rows, options = {}) {
    if (!rows.length) {
      return {
        hasLineColumns: false,
        usable: 0,
        missing: 0,
        inverted: 0,
        packedCol: null,
        packedHits: 0,
        approachCount: 0,
        recommended: "lrs",
      };
    }
    const columns = LRS.columnsOf(rows);
    const resolved = LRS.resolveColumns(rows, {
      roadway: options.roadway,
      bmp: options.bmp,
      emp: options.emp,
    });
    const hasRoadway = Boolean(resolved.roadway && columns.includes(resolved.roadway));
    const hasBmp = Boolean(resolved.bmp && columns.includes(resolved.bmp));
    const hasEmp = Boolean(resolved.emp && columns.includes(resolved.emp));
    const hasLineColumns = hasRoadway && hasBmp && hasEmp;
    let usable = 0;
    let missing = 0;
    let inverted = 0;
    if (hasLineColumns) {
      for (const row of rows) {
        const roadway = row[resolved.roadway];
        const bmp = LRS.coerceNumeric(row[resolved.bmp]);
        const emp = LRS.coerceNumeric(row[resolved.emp]);
        if (LRS.isMissing(roadway) || bmp == null || emp == null) missing += 1;
        else if (emp < bmp) inverted += 1;
        else usable += 1;
      }
    } else {
      missing = rows.length;
    }
    const packedCol = detectPackedColumn(rows);
    let packedHits = 0;
    let approachCount = 0;
    if (packedCol) {
      for (const row of rows) {
        const parts = parsePackedApproaches(row[packedCol]);
        if (parts.length) {
          packedHits += 1;
          approachCount += parts.length;
        }
      }
    }
    let recommended = "lrs";
    if ((!hasLineColumns || usable === 0) && packedCol) recommended = "extract";
    return {
      roadway: resolved.roadway,
      bmp: resolved.bmp,
      emp: resolved.emp,
      hasLineColumns,
      usable,
      missing,
      inverted,
      packedCol,
      packedHits,
      approachCount,
      recommended,
    };
  }

  function applyStub(approach, stubLength) {
    const stub = Number(stubLength) || 0;
    if (stub <= 0 || approach.emp !== approach.bmp) {
      return { bmp: approach.bmp, emp: approach.emp };
    }
    const half = stub / 2;
    return {
      bmp: Math.max(0, approach.measure - half),
      emp: approach.measure + half,
    };
  }

  function unionGeoms(geoms) {
    const parts = (geoms || []).filter((geom) => geom && geom.type && !LRS.isEmptyGeom?.(geom));
    if (!parts.length) return null;
    if (typeof LRS.unionParts === "function") return LRS.unionParts(parts);
    if (parts.length === 1) return parts[0];
    return {
      type: "MultiLineString",
      coordinates: parts.flatMap((part) =>
        part.type === "MultiLineString" ? part.coordinates : [part.coordinates]
      ),
    };
  }

  function explodeNestedRoutes(rows, options = {}) {
    if (!rows.length) return { rows: [], skipped: 0, packedCol: null, parentCol: null };

    const packedCol = options.packedCol || detectPackedColumn(rows);
    if (!packedCol) {
      throw new Error(
        "Could not find a packed route column (for example Intersecting Roadway Id Milepoints)."
      );
    }
    const parentCol = options.parentCol || detectParentColumn(rows);
    const namesCol = options.namesCol === "" ? null : options.namesCol || detectNamesColumn(rows);
    const stubLength = options.stubLength == null ? 0.02 : Number(options.stubLength);
    const hadBmp = LRS.columnsOf(rows).includes("BEGIN_POST") || LRS.columnsOf(rows).includes("END_POST");

    const exploded = [];
    let skipped = 0;
    rows.forEach((row, index) => {
      const approaches = parsePackedApproaches(row[packedCol]);
      if (!approaches.length) {
        skipped += 1;
        return;
      }
      const names = namesCol && row[namesCol] != null ? String(row[namesCol]).split("|") : [];
      const parentId = parentCol && !LRS.isMissing(row[parentCol]) ? row[parentCol] : `ROW-${index + 1}`;
      approaches.forEach((approach, subIndex) => {
        const out = LRS.cloneRow(row);
        const span = applyStub(approach, stubLength);
        out.ROADWAY_ORIG = row.ROADWAY;
        if (hadBmp) {
          out.BEGIN_POST_ORIG = row.BEGIN_POST;
          out.END_POST_ORIG = row.END_POST;
        }
        out.LRS_SOURCE_ROW = index + 1;
        out.LRS_PARENT_ID = parentId;
        out.LRS_SUB_ID = subIndex + 1;
        out.ROADWAY = LRS.padRoadwayId(approach.roadway) || approach.roadway;
        out.LOCATION = approach.measure;
        out.BEGIN_POST = span.bmp;
        out.END_POST = span.emp;
        if (names[subIndex] != null) out.LRS_ROAD_NAME = names[subIndex].trim();
        delete out.geometry;
        exploded.push(out);
      });
    });
    return { rows: exploded, skipped, packedCol, parentCol: parentCol || "LRS_PARENT_ID" };
  }

  function combineNestedRoutes(rows, options = {}) {
    if (!rows.length) return [];
    const parentCol =
      options.parentCol ||
      (LRS.columnsOf(rows).includes("LRS_SOURCE_ROW") ? "LRS_SOURCE_ROW" : "LRS_PARENT_ID");
    const subCol = options.subCol || "LRS_SUB_ID";
    const packedCol = options.packedCol || detectPackedColumn(rows) || "Intersecting Roadway Id Milepoints";
    if (!LRS.columnsOf(rows).includes(parentCol)) {
      throw new Error(`Combine needs a parent id column (expected ${parentCol}). Run Extract first.`);
    }

    const groups = LRS.groupBy(rows, (row) => row[parentCol]);
    const combined = [];
    for (const group of groups.values()) {
      const sorted = LRS.sortRows(group, [subCol, "ROADWAY", "LOCATION"]);
      const first = LRS.cloneRow(sorted[0]);
      const seen = new Set();
      const parts = [];
      const geoms = [];
      for (const row of sorted) {
        const key = `${row[subCol] ?? ""}|${row.ROADWAY}|${row.LOCATION}`;
        if (!seen.has(key)) {
          seen.add(key);
          const id = LRS.padRoadwayId(row.ROADWAY) || row.ROADWAY;
          const measure = row.LOCATION != null ? row.LOCATION : row.BEGIN_POST;
          if (id != null && measure != null) parts.push(`${id} = ${formatMeasure(measure)}`);
        }
        if (row.geometry) geoms.push(row.geometry);
      }
      first[packedCol] = parts.join("|");
      first.geometry = unionGeoms(geoms);
      if (first.ROADWAY_ORIG != null) first.ROADWAY = first.ROADWAY_ORIG;
      if (first.BEGIN_POST_ORIG != null) first.BEGIN_POST = first.BEGIN_POST_ORIG;
      if (first.END_POST_ORIG != null) first.END_POST = first.END_POST_ORIG;
      const drop = [
        "LRS_SUB_ID",
        "LRS_ROAD_NAME",
        "LRS_SOURCE_ROW",
        "ROADWAY_ORIG",
        "BEGIN_POST_ORIG",
        "END_POST_ORIG",
        "LOCATION",
      ];
      if (options.keepParentId === false) drop.push("LRS_PARENT_ID");
      if (options.dropWorkingMeasures !== false && first.BEGIN_POST_ORIG == null) {
        drop.push("BEGIN_POST", "END_POST");
      }
      combined.push(LRS.dropColumns(first, drop));
    }
    return combined;
  }

  Object.assign(LRS, {
    PACKED_ALIASES,
    parsePackedApproaches,
    detectPackedColumn,
    detectParentColumn,
    detectNamesColumn,
    inspectEventKeys,
    explodeNestedRoutes,
    combineNestedRoutes,
  });
  if (isNode) module.exports = LRS;
})(typeof globalThis !== "undefined" ? globalThis : this);
