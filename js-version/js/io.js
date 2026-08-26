(function (root) {
  const isNode = typeof module === "object" && module.exports;
  const LRS = isNode ? require("./schema.js") : root.LRS || (root.LRS = {});

  const ROADWAY_NAMES = new Set((LRS.ROADWAY_ALIASES || []).map((name) => name.toLowerCase()));

  function parseCsv(text) {
    const rows = [];
    let i = 0;
    const len = text.length;

    function readRow() {
      const cells = [];
      let cell = "";
      let inQuotes = false;
      while (i < len) {
        const c = text[i];
        if (inQuotes) {
          if (c === '"') {
            if (text[i + 1] === '"') {
              cell += '"';
              i += 2;
              continue;
            }
            inQuotes = false;
            i += 1;
            continue;
          }
          cell += c;
          i += 1;
          continue;
        }
        if (c === '"') {
          inQuotes = true;
          i += 1;
          continue;
        }
        if (c === ",") {
          cells.push(cell);
          cell = "";
          i += 1;
          continue;
        }
        if (c === "\r") {
          i += 1;
          continue;
        }
        if (c === "\n") {
          cells.push(cell);
          i += 1;
          return cells;
        }
        cell += c;
        i += 1;
      }
      if (cell !== "" || cells.length) cells.push(cell);
      return cells.length ? cells : null;
    }

    const header = readRow();
    if (!header) return [];
    const names = header.map((name) => name.trim());
    while (i < len) {
      const cells = readRow();
      if (!cells) break;
      if (cells.length === 1 && cells[0] === "" && i >= len) break;
      const row = {};
      names.forEach((name, index) => {
        let value = cells[index] == null ? "" : cells[index];
        if (ROADWAY_NAMES.has(name.toLowerCase())) {
          row[name] = value;
        } else if (value === "") {
          row[name] = null;
        } else {
          const num = Number(value);
          row[name] = Number.isFinite(num) && value.trim() !== "" ? num : value;
        }
      });
      rows.push(row);
    }
    return rows;
  }

  function csvEscape(value) {
    if (value == null) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function toCsv(rows) {
    const columns = LRS.columnsOf(rows).filter((col) => col !== "geometry");
    const lines = [columns.join(",")];
    for (const row of rows) {
      lines.push(columns.map((col) => csvEscape(row[col])).join(","));
    }
    return `${lines.join("\n")}\n`;
  }

  function featureToRow(feature) {
    const row = { ...(feature.properties || {}) };
    row.geometry = feature.geometry || null;
    return row;
  }

  function parseGeoJson(text) {
    const data = typeof text === "string" ? JSON.parse(text) : text;
    if (data.type === "FeatureCollection") return (data.features || []).map(featureToRow);
    if (data.type === "Feature") return [featureToRow(data)];
    return [{ geometry: data }];
  }

  function toGeoJson(rows, crs) {
    return {
      type: "FeatureCollection",
      ...(crs ? { crs: { type: "name", properties: { name: crs } } } : {}),
      features: rows.map((row) => {
        const properties = LRS.dropColumns(row, ["geometry"]);
        return {
          type: "Feature",
          properties,
          geometry: row.geometry || null,
        };
      }),
    };
  }

  function decode(bytes, encoding) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder(encoding || "utf-8").decode(bytes);
    return Buffer.from(bytes).toString(encoding || "utf8");
  }

  class BinaryReader {
    constructor(buffer) {
      this.data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
      this.offset = 0;
    }
    get length() {
      return this.data.length;
    }
    seek(offset) {
      this.offset = offset;
    }
    int32le() {
      const value = this.view.getInt32(this.offset, true);
      this.offset += 4;
      return value;
    }
    int32be() {
      const value = this.view.getInt32(this.offset, false);
      this.offset += 4;
      return value;
    }
    uint32le() {
      const value = this.view.getUint32(this.offset, true);
      this.offset += 4;
      return value;
    }
    uint16le() {
      const value = this.view.getUint16(this.offset, true);
      this.offset += 2;
      return value;
    }
    float64le() {
      const value = this.view.getFloat64(this.offset, true);
      this.offset += 8;
      return value;
    }
    readBytes(n) {
      const slice = this.data.subarray(this.offset, this.offset + n);
      this.offset += n;
      return slice;
    }
  }

  function parseDbf(buffer) {
    const reader = new BinaryReader(buffer);
    reader.seek(4);
    const numRecords = reader.uint32le();
    const headerLength = reader.uint16le();
    const recordLength = reader.uint16le();
    const fields = [];
    reader.seek(32);
    while (reader.offset < headerLength - 1) {
      const nameBytes = reader.readBytes(11);
      if (nameBytes[0] === 0x0d) break;
      let name = decode(nameBytes).replace(/\0/g, "").trim();
      const type = String.fromCharCode(reader.readBytes(1)[0]);
      reader.offset += 4;
      const length = reader.readBytes(1)[0];
      reader.readBytes(1);
      reader.offset += 14;
      fields.push({ name, type, length });
    }
    reader.seek(headerLength);
    const rows = [];
    for (let i = 0; i < numRecords; i += 1) {
      const deleted = reader.readBytes(1)[0];
      const record = {};
      for (const field of fields) {
        const raw = decode(reader.readBytes(field.length)).trim();
        if (deleted === 0x2a) continue;
        if (field.type === "N" || field.type === "F") {
          record[field.name] = raw === "" ? null : Number(raw);
        } else {
          record[field.name] = raw;
        }
      }
      if (deleted !== 0x2a) rows.push(record);
      if (reader.offset > headerLength + (i + 1) * recordLength) {
        reader.seek(headerLength + (i + 1) * recordLength);
      }
    }
    return rows;
  }

  function readShapeRecord(reader, contentLengthWords) {
    const start = reader.offset;
    const shapeType = reader.int32le();
    if (shapeType === 0) return null;

    function readBox() {
      return [reader.float64le(), reader.float64le(), reader.float64le(), reader.float64le()];
    }
    function readPartsPoints() {
      readBox();
      const numParts = reader.int32le();
      const numPoints = reader.int32le();
      const parts = [];
      for (let i = 0; i < numParts; i += 1) parts.push(reader.int32le());
      const points = [];
      for (let i = 0; i < numPoints; i += 1) points.push([reader.float64le(), reader.float64le()]);
      return { parts, points };
    }
    function toLine(parts, points, measures) {
      const rings = [];
      for (let i = 0; i < parts.length; i += 1) {
        const end = i + 1 < parts.length ? parts[i + 1] : points.length;
        const coords = [];
        for (let p = parts[i]; p < end; p += 1) {
          const xy = points[p];
          coords.push(measures ? [xy[0], xy[1], 0, measures[p]] : xy);
        }
        if (coords.length) rings.push(coords);
      }
      if (!rings.length) return null;
      if (rings.length === 1) return { type: "LineString", coordinates: rings[0] };
      return { type: "MultiLineString", coordinates: rings };
    }

    if (shapeType === 1 || shapeType === 11 || shapeType === 21) {
      const x = reader.float64le();
      const y = reader.float64le();
      return { type: "Point", coordinates: [x, y] };
    }
    if ([3, 5, 13, 15, 23, 25].includes(shapeType)) {
      const { parts, points } = readPartsPoints();
      let measures = null;
      if (shapeType === 13 || shapeType === 15) {
        reader.float64le();
        reader.float64le();
        for (let i = 0; i < points.length; i += 1) reader.float64le();
      }
      if ([13, 15, 23, 25].includes(shapeType)) {
        const remaining = start + contentLengthWords * 2 - reader.offset;
        if (remaining >= 16 + points.length * 8) {
          reader.float64le();
          reader.float64le();
          measures = [];
          for (let i = 0; i < points.length; i += 1) measures.push(reader.float64le());
        }
      }
      const geom = toLine(parts, points, measures);
      if (shapeType === 5 || shapeType === 15 || shapeType === 25) {
        if (!geom) return null;
        return {
          type: geom.type === "LineString" ? "Polygon" : "MultiPolygon",
          coordinates: geom.type === "LineString" ? [geom.coordinates] : geom.coordinates.map((ring) => [ring]),
        };
      }
      return geom;
    }
    reader.seek(start + contentLengthWords * 2);
    return null;
  }

  function parseShp(buffer) {
    const reader = new BinaryReader(buffer);
    reader.seek(24);
    const fileLengthWords = reader.int32be();
    reader.seek(100);
    const geoms = [];
    const end = Math.min(reader.length, fileLengthWords * 2);
    while (reader.offset + 8 <= end) {
      reader.int32be();
      const contentLength = reader.int32be();
      const recStart = reader.offset;
      const geom = readShapeRecord(reader, contentLength);
      geoms.push(geom);
      reader.seek(recStart + contentLength * 2);
    }
    return geoms;
  }

  function parseShapefile({ shp, dbf, prj }) {
    const geoms = shp ? parseShp(shp) : [];
    const attributes = dbf ? parseDbf(dbf) : geoms.map(() => ({}));
    const count = Math.max(geoms.length, attributes.length);
    const rows = [];
    for (let i = 0; i < count; i += 1) {
      const row = { ...(attributes[i] || {}) };
      row.geometry = geoms[i] || null;
      rows.push(row);
    }
    return { rows, crs: prj ? decode(prj instanceof Uint8Array ? prj : new Uint8Array(prj)).trim() : null };
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== "undefined") {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    }
    if (isNode) {
      const zlib = require("zlib");
      return new Uint8Array(zlib.inflateRawSync(Buffer.from(bytes)));
    }
    throw new Error("Cannot inflate zip contents in this environment.");
  }

  function zipBaseName(raw) {
    const parts = String(raw || "")
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean);
    if (!parts.length) return null;
    if (parts.some((part) => part === "__MACOSX" || part.startsWith("."))) return null;
    const base = parts[parts.length - 1].toLowerCase();
    return base && !base.endsWith("/") ? base : null;
  }

  async function parseZip(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = bytes.length - 22;
    while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
    if (end < 0) throw new Error("Not a zip file.");
    const count = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true);
    const files = {};
    for (let i = 0; i < count; i += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) break;
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      const base = zipBaseName(name);
      offset += 46 + nameLength + extraLength + commentLength;
      if (!base) continue;
      const dataStart =
        localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      let data = bytes.subarray(dataStart, dataStart + compressedSize);
      if (method === 8) data = await inflateRaw(data);
      files[base] = data;
    }
    return files;
  }

  function crcTable() {
    if (LRS._crcTable) return LRS._crcTable;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    LRS._crcTable = table;
    return table;
  }

  function crc32(bytes) {
    const table = crcTable();
    let crc = 0 ^ -1;
    for (let i = 0; i < bytes.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
    return (crc ^ -1) >>> 0;
  }

  function u16(value) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, value, true);
    return b;
  }
  function u32(value) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value, true);
    return b;
  }

  function concat(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function zipStore(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
    for (const file of files) {
      const nameBytes = encoder ? encoder.encode(file.name) : Buffer.from(file.name, "utf8");
      const data = file.data;
      const crc = crc32(data);
      const local = concat([
        new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        nameBytes,
        data,
      ]);
      const central = concat([
        new Uint8Array([0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    }
    const centralDir = concat(centrals);
    const end = concat([
      new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]),
      u16(files.length),
      u16(files.length),
      u32(centralDir.length),
      u32(offset),
      u16(0),
    ]);
    return concat([...locals, centralDir, end]);
  }

  function shapefileSafeName(name, used) {
    let base = String(name).slice(0, 10);
    let candidate = base;
    let index = 1;
    while (used.has(candidate.toLowerCase())) {
      const suffix = String(index);
      candidate = `${base.slice(0, Math.max(1, 10 - suffix.length))}${suffix}`;
      index += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  function writeDbf(rows, fieldNames) {
    const fields = fieldNames.map((name) => {
      let maxLen = 1;
      let numeric = true;
      for (const row of rows) {
        const value = row[name];
        if (value == null) continue;
        if (typeof value !== "number") numeric = false;
        maxLen = Math.max(maxLen, String(value).length);
      }
      return { name: name.slice(0, 10), type: numeric ? "N" : "C", length: Math.min(254, Math.max(maxLen, numeric ? 18 : 16)) };
    });
    const recordLength = fields.reduce((sum, field) => sum + field.length, 1);
    const headerLength = 32 + fields.length * 32 + 1;
    const buffer = new Uint8Array(headerLength + recordLength * rows.length + 1);
    const view = new DataView(buffer.buffer);
    buffer[0] = 0x03;
    const now = new Date();
    buffer[1] = now.getFullYear() - 1900;
    buffer[2] = now.getMonth() + 1;
    buffer[3] = now.getDate();
    view.setUint32(4, rows.length, true);
    view.setUint16(8, headerLength, true);
    view.setUint16(10, recordLength, true);
    fields.forEach((field, index) => {
      const offset = 32 + index * 32;
      for (let i = 0; i < field.name.length; i += 1) buffer[offset + i] = field.name.charCodeAt(i);
      buffer[offset + 11] = field.type.charCodeAt(0);
      buffer[offset + 16] = field.length;
    });
    buffer[headerLength - 1] = 0x0d;
    rows.forEach((row, rowIndex) => {
      let offset = headerLength + rowIndex * recordLength;
      buffer[offset] = 0x20;
      offset += 1;
      for (const field of fields) {
        let text = row[field.name] == null ? "" : String(row[field.name]);
        text = text.slice(0, field.length).padEnd(field.length, " ");
        for (let i = 0; i < field.length; i += 1) buffer[offset + i] = text.charCodeAt(i);
        offset += field.length;
      }
    });
    buffer[buffer.length - 1] = 0x1a;
    return buffer;
  }

  function collectLineCoords(geom) {
    if (!geom) return [];
    if (geom.type === "LineString") return [geom.coordinates];
    if (geom.type === "MultiLineString") return geom.coordinates;
    if (geom.type === "Polygon") return geom.coordinates;
    if (geom.type === "MultiPolygon") return geom.coordinates.flat();
    return [];
  }

  function writeShp(rows) {
    const records = [];
    for (const row of rows) {
      const partsCoords = collectLineCoords(row.geometry);
      const parts = [];
      const points = [];
      for (const line of partsCoords) {
        parts.push(points.length);
        for (const coord of line) points.push(coord);
      }
      if (!points.length) {
        const content = new Uint8Array(4);
        new DataView(content.buffer).setInt32(0, 0, true);
        records.push(content);
        continue;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      const content = new ArrayBuffer(44 + parts.length * 4 + points.length * 16);
      const view = new DataView(content);
      view.setInt32(0, 3, true);
      view.setFloat64(4, minX, true);
      view.setFloat64(12, minY, true);
      view.setFloat64(20, maxX, true);
      view.setFloat64(28, maxY, true);
      view.setInt32(36, parts.length, true);
      view.setInt32(40, points.length, true);
      parts.forEach((part, index) => view.setInt32(44 + index * 4, part, true));
      points.forEach((point, index) => {
        const offset = 44 + parts.length * 4 + index * 16;
        view.setFloat64(offset, point[0], true);
        view.setFloat64(offset + 8, point[1], true);
      });
      records.push(new Uint8Array(content));
    }

    let offsetWords = 50;
    const recBuffers = [];
    const shxParts = [];
    records.forEach((content, index) => {
      const rec = new Uint8Array(8 + content.length);
      const view = new DataView(rec.buffer);
      view.setInt32(0, index + 1, false);
      view.setInt32(4, content.length / 2, false);
      rec.set(content, 8);
      recBuffers.push(rec);
      const idx = new Uint8Array(8);
      const iv = new DataView(idx.buffer);
      iv.setInt32(0, offsetWords, false);
      iv.setInt32(4, content.length / 2, false);
      shxParts.push(idx);
      offsetWords += rec.length / 2;
    });

    function header(fileLengthWords) {
      const buf = new Uint8Array(100);
      const view = new DataView(buf.buffer);
      view.setInt32(0, 9994, false);
      view.setInt32(24, fileLengthWords, false);
      view.setInt32(28, 1000, true);
      view.setInt32(32, 3, true);
      return buf;
    }
    const shpBody = concat(recBuffers);
    const shp = concat([header(50 + shpBody.length / 2), shpBody]);
    const shxBody = concat(shxParts);
    const shx = concat([header(50 + shxBody.length / 2), shxBody]);
    return { shp, shx };
  }

  function shapefileZip(rows, baseName) {
    if (typeof LRS.rowsHaveLineGeometry === "function" && !LRS.rowsHaveLineGeometry(rows)) {
      throw new Error(
        "Shapefile export needs line geometry. Use CSV or GeoJSON for attribute-only tables, or run Display on a route layer first."
      );
    }
    const used = new Set();
    const rename = {};
    const columns = LRS.columnsOf(rows).filter((col) => col !== "geometry");
    for (const col of columns) {
      const safe = shapefileSafeName(col, used);
      if (safe !== col) rename[col] = safe;
    }
    const mapped = rows.map((row) => {
      const out = {};
      for (const col of columns) out[rename[col] || col] = row[col];
      out.geometry = row.geometry;
      return out;
    });
    const fieldNames = columns.map((col) => rename[col] || col);
    const { shp, shx } = writeShp(mapped);
    const dbf = writeDbf(mapped, fieldNames);
    const stem = baseName.replace(/\.(zip|shp)$/i, "") || "lrs_export";
    return zipStore([
      { name: `${stem}.shp`, data: shp },
      { name: `${stem}.shx`, data: shx },
      { name: `${stem}.dbf`, data: dbf },
    ]);
  }

  function extensionOf(name) {
    const lower = (name || "").toLowerCase();
    const idx = lower.lastIndexOf(".");
    return idx >= 0 ? lower.slice(idx) : "";
  }

  function decodeXml(text) {
    return String(text)
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }

  function columnIndexFromRef(ref) {
    const letters = String(ref).replace(/[0-9]/g, "");
    let n = 0;
    for (let i = 0; i < letters.length; i += 1) {
      n = n * 26 + (letters.charCodeAt(i) - 64);
    }
    return n - 1;
  }

  function parseSharedStrings(xml) {
    const strings = [];
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let match;
    while ((match = siRe.exec(xml))) {
      const texts = [];
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      let tMatch;
      while ((tMatch = tRe.exec(match[1]))) texts.push(decodeXml(tMatch[1]));
      strings.push(texts.join(""));
    }
    return strings;
  }

  function parseXlsxSheet(xml, shared) {
    const rows = [];
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch;
    while ((rowMatch = rowRe.exec(xml))) {
      const cells = [];
      const cRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cMatch;
      while ((cMatch = cRe.exec(rowMatch[1]))) {
        const attrs = cMatch[1];
        const ref = (attrs.match(/\br="([^"]+)"/) || [])[1];
        const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || "";
        if (!ref) continue;
        let raw = "";
        if (type === "inlineStr") {
          const tMatch = cMatch[2].match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
          raw = tMatch ? decodeXml(tMatch[1]) : "";
        } else {
          const vMatch = cMatch[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
          raw = vMatch ? decodeXml(vMatch[1]) : "";
        }
        let value = raw;
        if (type === "s") value = shared[Number(raw)] != null ? shared[Number(raw)] : raw;
        else if (type === "b") value = raw === "1";
        else if (type !== "inlineStr" && raw !== "") {
          const num = Number(raw);
          value = Number.isFinite(num) ? num : raw;
        }
        cells[columnIndexFromRef(ref)] = value;
      }
      rows.push(cells);
    }
    return rows;
  }

  async function parseXlsx(buffer) {
    const files = await parseZip(buffer);
    const sheetName =
      Object.keys(files).find((name) => /^sheet\d+\.xml$/i.test(name)) ||
      Object.keys(files).find((name) => name.endsWith(".xml") && name.includes("sheet"));
    if (!sheetName) throw new Error("Excel workbook has no worksheet.");
    const sharedXml = files["sharedstrings.xml"];
    const shared = sharedXml ? parseSharedStrings(decode(sharedXml)) : [];
    const grid = parseXlsxSheet(decode(files[sheetName]), shared);
    if (!grid.length) return [];
    const header = (grid[0] || []).map((name, index) => {
      const text = name == null ? "" : String(name).trim();
      return text || `COL_${index + 1}`;
    });
    const out = [];
    for (const cells of grid.slice(1)) {
      if (!cells || cells.every((value) => value == null || value === "")) continue;
      const row = {};
      header.forEach((name, index) => {
        let value = cells[index];
        if (value === "" || value == null) row[name] = null;
        else if (ROADWAY_NAMES.has(name.toLowerCase())) row[name] = value;
        else row[name] = value;
      });
      out.push(row);
    }
    return out;
  }

  async function tableFromNamedBuffers(files) {
    const byName = {};
    for (const [name, data] of Object.entries(files)) byName[name.toLowerCase()] = { name, data };
    const names = Object.keys(byName);
    const zipFile = names.find((name) => name.endsWith(".zip"));
    if (zipFile) {
      const inner = await parseZip(byName[zipFile].data);
      const innerNames = Object.keys(inner);
      if (!innerNames.some((name) => /\.(shp|geojson|json|csv|txt|xlsx)$/i.test(name))) {
        throw new Error(
          "That zip has no shapefile, GeoJSON, CSV, or Excel file. Zip the .shp together with its .dbf, .prj, and .shx."
        );
      }
      return tableFromNamedBuffers(inner);
    }
    const geo = names.find((name) => name.endsWith(".geojson") || name.endsWith(".json"));
    if (geo) return { rows: parseGeoJson(decode(byName[geo].data)), name: byName[geo].name };
    const csv = names.find((name) => name.endsWith(".csv") || name.endsWith(".txt"));
    if (csv) return { rows: parseCsv(decode(byName[csv].data)), name: byName[csv].name };
    const xlsx = names.find((name) => name.endsWith(".xlsx"));
    if (xlsx) return { rows: await parseXlsx(byName[xlsx].data), name: byName[xlsx].name };
    if (names.some((name) => name.endsWith(".xls"))) {
      throw new Error("Old .xls workbooks are not supported. Save as .xlsx or CSV.");
    }
    const shps = names.filter((name) => name.endsWith(".shp"));
    if (shps.length > 1) {
      throw new Error(`Zip contains more than one shapefile (${shps.join(", ")}). Zip one layer per file.`);
    }
    const shp = shps[0];
    if (shp) {
      const stem = shp.slice(0, -4);
      const sidecar = (ext) =>
        (names.includes(`${stem}${ext}`) && byName[`${stem}${ext}`].data) ||
        (names.find((name) => name.endsWith(ext)) && byName[names.find((name) => name.endsWith(ext))].data) ||
        null;
      const parsed = parseShapefile({
        shp: byName[shp].data,
        dbf: sidecar(".dbf"),
        prj: sidecar(".prj"),
      });
      return { rows: parsed.rows, crs: parsed.crs, name: byName[shp].name };
    }
    throw new Error("Choose a CSV, Excel (.xlsx), GeoJSON, shapefile, or a zip of a shapefile.");
  }

  Object.assign(LRS, {
    parseCsv,
    toCsv,
    parseGeoJson,
    toGeoJson,
    parseShapefile,
    parseZip,
    zipStore,
    parseXlsx,
    shapefileZip,
    tableFromNamedBuffers,
    extensionOf,
  });
  if (isNode) module.exports = LRS;
})(typeof globalThis !== "undefined" ? globalThis : this);
