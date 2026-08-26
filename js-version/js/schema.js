(function (root) {
  const isNode = typeof module === "object" && module.exports;
  const LRS = isNode ? require("./table.js") : root.LRS || (root.LRS = {});

  const ROADWAY_ALIASES = [
    "ROADWAY",
    "ROADWAY_ID",
    "ROADWAYID",
    "RTE_UNIQUE",
    "RTE_ID",
    "RTEID",
    "ROUTE_ID",
    "ROUTEID",
    "LRS_ROUTE",
    "LRS_ID",
    "LRS_KEY",
    "NLFID",
    "RT_ID",
    "RTID",
    "ROUTE",
    "ROUTE_NUM",
    "ROUTE_NO",
    "ROUTENUM",
    "SEG_ID",
    "SECTION_",
    "SECTION_ID",
    "STREET_ID",
    "Route ID",
    "Roadway ID",
    "ROADWAY_new",
    "roadway *",
  ];
  const BMP_ALIASES = [
    "BEGIN_POST",
    "BEGINMP",
    "BEGIN_MP",
    "BEG_MP",
    "BEGMP",
    "FROM_MEASURE",
    "FROMMEASURE",
    "FROM_MILEPOINT",
    "FROM_MILEPOST",
    "FROM_MP",
    "FROMMP",
    "START_MP",
    "STARTMP",
    "BMP",
    "MinMP",
    "FROM_MEAS",
    "BEG_MEAS",
  ];
  const EMP_ALIASES = [
    "END_POST",
    "ENDMP",
    "END_MP",
    "TO_MEASURE",
    "TOMEASURE",
    "TO_MILEPOINT",
    "TO_MILEPOST",
    "TO_MP",
    "TOMP",
    "STOP_MP",
    "EMP",
    "MaxMP",
    "TO_MEAS",
    "END_MEAS",
  ];
  const MEASURE_ALIASES = [
    "LOCATION",
    "MEASURE",
    "MEAS",
    "MILEPOINT",
    "MILEPOST",
    "POSTMILE",
    "MP",
    "POINT_MP",
    "EVENT_MP",
  ];
  const OFFSET_ALIASES = ["OFFSET", "LATERAL_OFFSET", "LAT_OFFSET", "OFFSET_FT", "OFFSET_MI"];
  const SIDE_ALIASES = ["SIDE", "LRS_SIDE", "LANE_SIDE", "DIR"];
  const FROM_DATE_ALIASES = ["FROM_DATE", "EFF_FROM", "BEGIN_DATE", "START_DATE", "DATE_FROM"];
  const TO_DATE_ALIASES = ["TO_DATE", "EFF_TO", "END_DATE", "DATE_TO"];
  const DEFAULT_TOLERANCE = 1e-4;
  const roadwayPad = { mode: "numeric", width: 8 };

  function configureRoadwayPad(options = {}) {
    if (options.mode === "off" || options.mode === "numeric" || options.mode === "all") {
      roadwayPad.mode = options.mode;
    }
    if (options.width != null) {
      const width = Number(options.width);
      roadwayPad.width = Number.isFinite(width) ? Math.max(0, Math.min(32, Math.trunc(width))) : 8;
    }
    return { mode: roadwayPad.mode, width: roadwayPad.width };
  }

  function roadwayPadState() {
    return { mode: roadwayPad.mode, width: roadwayPad.width };
  }

  function isNumericRoadwayId(text) {
    return /^\d+$/.test(text);
  }

  function padRoadwayId(value, options) {
    if (LRS.isMissing(value)) return null;
    let text = String(value).trim();
    if (text === "" || text.toLowerCase() === "nan") return null;
    if (text.includes(".")) {
      const asFloat = Number(text);
      if (Number.isFinite(asFloat)) text = String(Math.trunc(asFloat));
    }
    const mode = options && options.mode != null ? options.mode : roadwayPad.mode;
    const width = options && options.width != null ? options.width : roadwayPad.width;
    if (mode === "off" || !width) return text;
    if (mode === "numeric" && !isNumericRoadwayId(text)) return text;
    if (text.length >= width) return text;
    return text.padStart(width, "0");
  }

  function applyRouteIdPad(rows, column) {
    if (!rows || !column || roadwayPad.mode === "off") return rows;
    return rows.map((row) => {
      const out = LRS.cloneRow(row);
      const padded = padRoadwayId(out[column]);
      if (padded != null) out[column] = padded;
      return out;
    });
  }

  function firstPresent(columns, aliases) {
    const lookup = new Map(columns.map((col) => [String(col), col]));
    const lowerLookup = new Map(columns.map((col) => [String(col).toLowerCase(), col]));
    for (const alias of aliases) {
      if (lookup.has(alias)) return lookup.get(alias);
      const lowered = alias.toLowerCase();
      if (lowerLookup.has(lowered)) return lowerLookup.get(lowered);
    }
    return null;
  }

  function resolveColumns(rows, options = {}) {
    const columns = options.columns || LRS.columnsOf(rows);
    const pick = (explicit, aliases) => {
      if (explicit && columns.includes(explicit)) return explicit;
      return firstPresent(columns, aliases);
    };
    const roadwayCol = pick(options.roadway, ROADWAY_ALIASES);
    const bmpCol = pick(options.bmp, BMP_ALIASES);
    const empCol = pick(options.emp, EMP_ALIASES);
    const measureCol = pick(options.measure, MEASURE_ALIASES);

    if (options.requireLine && (roadwayCol == null || bmpCol == null || empCol == null)) {
      throw new Error(
        `Could not resolve route ID / begin-milepost / end-milepost columns. Available columns: ${columns.join(", ")}`
      );
    }
    if (options.requireMeasure && (roadwayCol == null || measureCol == null)) {
      throw new Error(
        `Could not resolve route ID / measure columns. Available columns: ${columns.join(", ")}`
      );
    }
    return { roadway: roadwayCol, bmp: bmpCol, emp: empCol, measure: measureCol };
  }

  function detectAdvancedFields(rows, options = {}) {
    const columns = options.columns || LRS.columnsOf(rows);
    return {
      offset: firstPresent(columns, OFFSET_ALIASES),
      side: firstPresent(columns, SIDE_ALIASES),
      fromDate: firstPresent(columns, FROM_DATE_ALIASES),
      toDate: firstPresent(columns, TO_DATE_ALIASES),
    };
  }

  function parseLrsDate(value) {
    if (LRS.isMissing(value)) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
    const text = String(value).trim();
    if (!text) return null;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function filterRowsAsOf(rows, options = {}) {
    const asOf = parseLrsDate(options.asOf);
    if (asOf == null || (!options.fromCol && !options.toCol)) return rows;
    return rows.filter((row) => {
      const from = options.fromCol ? parseLrsDate(row[options.fromCol]) : null;
      const to = options.toCol ? parseLrsDate(row[options.toCol]) : null;
      if (from != null && asOf < from) return false;
      if (to != null && asOf >= to) return false;
      return true;
    });
  }

  function dateRangesOverlap(left, right, cols) {
    if (!cols || !cols.leftFrom || !cols.rightFrom) return true;
    const leftStart = parseLrsDate(left[cols.leftFrom]) ?? Number.NEGATIVE_INFINITY;
    const leftEnd = cols.leftTo ? parseLrsDate(left[cols.leftTo]) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
    const rightStart = parseLrsDate(right[cols.rightFrom]) ?? Number.NEGATIVE_INFINITY;
    const rightEnd = cols.rightTo ? parseLrsDate(right[cols.rightTo]) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
    return leftStart < rightEnd && leftEnd > rightStart;
  }

  class LrsSchema {
    constructor({
      roadway = "ROADWAY",
      bmp = "BEGIN_POST",
      emp = "END_POST",
      measure = "LOCATION",
      tolerance = DEFAULT_TOLERANCE,
    } = {}) {
      this.roadway = roadway;
      this.bmp = bmp;
      this.emp = emp;
      this.measure = measure;
      this.tolerance = tolerance;
    }

    static fromRows(rows, options = {}) {
      const resolved = resolveColumns(rows, options);
      return new LrsSchema({
        roadway: resolved.roadway || "ROADWAY",
        bmp: resolved.bmp || "BEGIN_POST",
        emp: resolved.emp || "END_POST",
        measure: resolved.measure,
        tolerance: options.tolerance ?? DEFAULT_TOLERANCE,
      });
    }

    withUpdates(updates) {
      return new LrsSchema({ ...this, ...updates });
    }

    lineColumns() {
      return [this.roadway, this.bmp, this.emp];
    }

    validateLine(rows) {
      const columns = LRS.columnsOf(rows);
      const missing = this.lineColumns().filter((col) => !columns.includes(col));
      if (missing.length) {
        throw new Error(`DataFrame is missing LRS line columns: ${missing.join(", ")}`);
      }
    }

    validatePoint(rows) {
      const columns = LRS.columnsOf(rows);
      if (this.measure == null || !columns.includes(this.measure)) {
        throw new Error("DataFrame is missing an LRS measure / LOCATION column.");
      }
      if (!columns.includes(this.roadway)) {
        throw new Error(`DataFrame is missing route ID column '${this.roadway}'.`);
      }
    }
  }

  Object.assign(LRS, {
    ROADWAY_ALIASES,
    BMP_ALIASES,
    EMP_ALIASES,
    MEASURE_ALIASES,
    OFFSET_ALIASES,
    SIDE_ALIASES,
    FROM_DATE_ALIASES,
    TO_DATE_ALIASES,
    DEFAULT_TOLERANCE,
    configureRoadwayPad,
    roadwayPadState,
    padRoadwayId,
    applyRouteIdPad,
    resolveColumns,
    detectAdvancedFields,
    parseLrsDate,
    filterRowsAsOf,
    dateRangesOverlap,
    LrsSchema,
  });
  if (isNode) module.exports = LRS;
})(typeof globalThis !== "undefined" ? globalThis : this);
