const fs = require("fs");
const path = require("path");

require("../js/table.js");
require("../js/schema.js");
require("../js/explode.js");
require("../js/dissolve.js");
require("../js/overlay.js");
require("../js/locate.js");
require("../js/topology.js");
require("../js/geometry.js");
require("../js/io.js");
require("../js/report.js");

const LRS = global.LRS;
const root = path.join(__dirname, "..", "..", "input_data");
const eventDir = path.join(root, "event_tables");
const routeDir = path.join(root, "route_geometry", "basemap_route");

function files(dir) {
  return Object.fromEntries(
    fs.readdirSync(dir).map((name) => [name, fs.readFileSync(path.join(dir, name))])
  );
}

function padSample(rows, col, n = 5) {
  return rows.slice(0, n).map((row) => `${row[col]} -> ${LRS.padRoadwayId(row[col])}`);
}

(async () => {
  const issues = [];
  const note = (ok, msg) => {
    const line = `${ok ? "OK  " : "ISSUE"} ${msg}`;
    console.log(line);
    if (!ok) issues.push(msg);
  };

  console.log("=== Basemap routes ===");
  const named = {};
  for (const [name, data] of Object.entries(files(routeDir))) {
    if (/\.(shp|dbf|prj|shx)$/i.test(name)) named[name] = data;
  }
  const routesTable = await LRS.tableFromNamedBuffers(named);
  const routes = routesTable.rows;
  const routeCols = LRS.columnsOf(routes).filter((col) => col !== "geometry");
  const routeSchema = LRS.LrsSchema.fromRows(routes);
  const withGeom = LRS.countLineGeometry(routes);
  const withM = routes.filter((row) => LRS.coordsHaveM(row.geometry)).length;
  console.log("rows", routes.length, "geom", withGeom, "M-values", withM);
  console.log("cols", routeCols.join(", "));
  console.log("detected", routeSchema.roadway, routeSchema.bmp, routeSchema.emp);
  console.log("roadway samples", padSample(routes, routeSchema.roadway));
  console.log("crs", routesTable.crs);
  note(routes.length > 0, `basemap loaded ${routes.length} rows`);
  note(withGeom === routes.length, `all route rows have line geometry (${withGeom}/${routes.length})`);
  note(Boolean(routeSchema.roadway && routeSchema.bmp && routeSchema.emp), "basemap LRS fields auto-detected");

  const eventFiles = fs.readdirSync(eventDir).filter((name) => name.endsWith(".xlsx") && !name.startsWith("~$"));
  for (const name of eventFiles) {
    console.log(`\n=== ${name} ===`);
    const table = await LRS.tableFromNamedBuffers({ [name]: fs.readFileSync(path.join(eventDir, name)) });
    const rows = table.rows;
    const inspect = LRS.inspectEventKeys(rows);
    console.log("rows", rows.length, "cols", LRS.columnsOf(rows).length);
    console.log("has ROADWAY", "ROADWAY" in (rows[0] || {}));
    console.log("has BEGIN/END", "BEGIN_POST" in (rows[0] || {}), "END_POST" in (rows[0] || {}));
    console.log("packed", inspect.packedCol, "approaches", inspect.approachCount);
    console.log("usable LRS", inspect.usable, "recommend", inspect.recommended);
    console.log("parent", LRS.detectParentColumn(rows));

    let exploded;
    let didExtract = false;
    try {
      if (inspect.recommended === "extract") {
        exploded = LRS.explodeNestedRoutes(rows, { stubLength: 0.02 });
        didExtract = true;
        console.log("extract", exploded.rows.length, "skipped", exploded.skipped);
        note(exploded.rows.length > 0, `${name}: extract produced approaches`);
        if (exploded.skipped) note(false, `${name}: ${exploded.skipped} source rows had no packed routes`);
      } else {
        exploded = { rows, skipped: 0, packedCol: inspect.packedCol };
        console.log("skip extract; using existing LRS fields", rows.length);
        note(inspect.usable === rows.length, `${name}: all rows have usable BMP/EMP`);
      }
    } catch (err) {
      note(false, `${name}: extract failed: ${err.message}`);
      continue;
    }

    try {
      const schema = LRS.LrsSchema.fromRows(exploded.rows, { requireLine: true });
      const qc = LRS.validateLrs(exploded.rows, schema);
      const report = LRS.reportValidate(qc);
      console.log(
        "QC inverted",
        qc.invalidBounds.length,
        "null",
        qc.nullKeys.length,
        "overlaps",
        qc.overlaps.length,
        "gaps",
        qc.gaps.length
      );
      report.lines.forEach((line) => console.log(" ", line.level, line.text));
      if (qc.invalidBounds.length) note(false, `${name}: ${qc.invalidBounds.length} inverted BMP/EMP after extract`);
      if (qc.nullKeys.length) note(false, `${name}: ${qc.nullKeys.length} null keys after extract`);
    } catch (err) {
      note(false, `${name}: validate failed: ${err.message}`);
    }

    try {
      const dissolved = LRS.dissolveContiguous(exploded.rows, {
        groupCols: ["ROADWAY", "LRS_PARENT_ID"],
        requireContiguous: true,
      });
      console.log("dissolve", exploded.rows.length, "->", dissolved.length);
      note(true, `${name}: dissolve ${exploded.rows.length} -> ${dissolved.length}`);
    } catch (err) {
      note(false, `${name}: dissolve failed: ${err.message}`);
    }

    const points = exploded.rows.map((row) => ({
      ROADWAY: row.ROADWAY,
      LOCATION:
        row.LOCATION != null
          ? row.LOCATION
          : (Number(row.BEGIN_POST) + Number(row.END_POST)) / 2,
      LRS_PARENT_ID: row.LRS_PARENT_ID,
    }));
    try {
      const { located, unmatched } = LRS.locatePoints(points, exploded.rows);
      const locReport = LRS.reportLocate(points, exploded.rows, located, unmatched);
      console.log("locate self", located.length, "unmatched", unmatched.length);
      locReport.lines.forEach((line) => {
        if (line.level !== "info") console.log(" ", line.level, line.text, line.sample || "");
      });
      if (located.length < points.length) {
        note(false, `${name}: self-locate lost points ${located.length}/${points.length}`);
      } else if (located.length > points.length) {
        console.log(
          `NOTE ${name}: self-locate ${located.length}/${points.length} — extra hits are overlapping ${0.02}-mile stubs on the same roadway.`
        );
      } else {
        note(true, `${name}: self-locate 1:1`);
      }
    } catch (err) {
      note(false, `${name}: locate failed: ${err.message}`);
    }

    try {
      const clipped = LRS.locateEventsOnRoutes(exploded.rows, routes);
      const clipReport = LRS.reportClip(exploded.rows, routes, clipped);
      clipReport.lines.forEach((line) => console.log(" ", line.level, line.text, line.sample || ""));
      const geom = LRS.countLineGeometry(clipped);
      note(geom > 0, `${name}: display wrote ${geom}/${clipped.length} geometries`);
      if (clipReport.onlyEvents.length) {
        console.log(
          `NOTE ${name}: ${clipReport.onlyEvents.length} extracted roadways are off the state basemap (often 03A local IDs).`
        );
      }
      if (clipReport.noGeom) {
        console.log(`NOTE ${name}: ${clipReport.noGeom} approaches produced no line (missing roadway or measure off route).`);
      }

      try {
        LRS.shapefileZip(clipped.filter((row) => LRS.isLineGeom(row.geometry)).slice(0, 20), "probe.zip");
        note(true, `${name}: shapefile zip of displayed lines succeeded (20-row probe)`);
      } catch (err) {
        note(false, `${name}: shapefile zip failed: ${err.message}`);
      }

      if (!didExtract) {
        note(true, `${name}: skipped combine (table used as-is)`);
      } else {
        const combined = LRS.combineNestedRoutes(clipped);
        const combinedGeom = LRS.countLineGeometry(combined);
        console.log("combine", clipped.length, "->", combined.length, "geom", combinedGeom);
        note(combined.length > 0 && combined.length <= rows.length, `${name}: combine ${clipped.length} -> ${combined.length}`);
        if (combined.length !== rows.length - exploded.skipped) {
          note(
            false,
            `${name}: combine row count ${combined.length} vs source ${rows.length} minus skipped ${exploded.skipped}`
          );
        }
      }
    } catch (err) {
      note(false, `${name}: display/combine failed: ${err.message}`);
      console.error(err);
    }

    if (name.includes("LPI")) {
      try {
        const overlaySrc = eventFiles.find((item) => item.includes("Yellow"));
        if (overlaySrc) {
          const other = await LRS.tableFromNamedBuffers({
            [overlaySrc]: fs.readFileSync(path.join(eventDir, overlaySrc)),
          });
          const left = LRS.explodeNestedRoutes(rows, { stubLength: 0.02 }).rows;
          const right = LRS.explodeNestedRoutes(other.rows, { stubLength: 0.02 }).rows;
          const joined = LRS.overlayEvents(left, right);
          const ov = LRS.reportOverlay(left, right, joined);
          ov.lines.forEach((line) => {
            if (line.level !== "info") console.log(" overlay", line.level, line.text, line.sample || "");
          });
          note(joined.length > 0, `${name}: overlay vs Yellow produced ${joined.length} slices`);
        }
      } catch (err) {
        note(false, `${name}: overlay vs Yellow failed: ${err.message}`);
      }
    }
  }

  console.log("\n=== SUMMARY ===");
  if (!issues.length) console.log("No issues found.");
  else issues.forEach((item, i) => console.log(`${i + 1}. ${item}`));
  process.exit(issues.length ? 2 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
