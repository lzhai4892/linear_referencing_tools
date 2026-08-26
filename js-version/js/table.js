(function (root) {
  const LRS = root.LRS || (root.LRS = {});

  function isMissing(value) {
    if (value == null) return true;
    if (typeof value === "number" && Number.isNaN(value)) return true;
    if (typeof value === "string") {
      const text = value.trim();
      return text === "" || text.toLowerCase() === "nan";
    }
    return false;
  }

  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === "object") return { ...value };
    return value;
  }

  function cloneRow(row) {
    const out = {};
    for (const key of Object.keys(row)) out[key] = cloneValue(row[key]);
    return out;
  }

  function cloneRows(rows) {
    return rows.map(cloneRow);
  }

  function columnsOf(rows, extra) {
    const seen = new Set(extra || []);
    const columns = extra ? [...extra] : [];
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          columns.push(key);
        }
      }
    }
    return columns;
  }

  function coerceNumeric(value) {
    if (isMissing(value)) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const text = String(value).trim().replace(/,/g, "");
    if (text === "") return null;
    const num = Number(text);
    return Number.isFinite(num) ? num : null;
  }

  function compareKey(value) {
    return isMissing(value) ? "__NULL__" : String(value);
  }

  function dropColumns(row, names) {
    const skip = names instanceof Set ? names : new Set(names);
    const out = {};
    for (const key of Object.keys(row)) {
      if (!skip.has(key)) out[key] = row[key];
    }
    return out;
  }

  function renameRow(row, mapping) {
    const out = {};
    for (const key of Object.keys(row)) {
      out[mapping[key] || key] = row[key];
    }
    return out;
  }

  function sortRows(rows, cols) {
    const list = cloneRows(rows);
    list.sort((a, b) => {
      for (const col of cols) {
        const av = a[col];
        const bv = b[col];
        const aMissing = isMissing(av);
        const bMissing = isMissing(bv);
        if (aMissing && bMissing) continue;
        if (aMissing) return 1;
        if (bMissing) return -1;
        const an = coerceNumeric(av);
        const bn = coerceNumeric(bv);
        if (an != null && bn != null && an !== bn) return an - bn;
        const as = String(av);
        const bs = String(bv);
        if (as < bs) return -1;
        if (as > bs) return 1;
      }
      return 0;
    });
    return list;
  }

  function groupBy(rows, keyFn) {
    const groups = new Map();
    for (const row of rows) {
      const key = keyFn(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return groups;
  }

  Object.assign(LRS, {
    isMissing,
    cloneRow,
    cloneRows,
    columnsOf,
    coerceNumeric,
    compareKey,
    dropColumns,
    renameRow,
    sortRows,
    groupBy,
  });
  if (typeof module === "object" && module.exports) module.exports = LRS;
})(typeof globalThis !== "undefined" ? globalThis : this);
