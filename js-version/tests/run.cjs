const assert = require("assert");

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
require("../js/project.js");

const LRS = global.LRS;
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

function target() {
  return [{ ROADWAY: "100", BEGIN_POST: 0.0, END_POST: 10.0, SECTADT: 5000 }];
}

test("pad roadway id", () => {
  assert.strictEqual(LRS.padRoadwayId(123), "00000123");
  assert.strictEqual(LRS.padRoadwayId("47"), "00000047");
  assert.strictEqual(LRS.padRoadwayId(84.0), "00000084");
  assert.strictEqual(LRS.padRoadwayId("8470001.0"), "08470001");
  assert.strictEqual(LRS.padRoadwayId(null), null);
  assert.strictEqual(LRS.padRoadwayId(Number.NaN), null);
  assert.strictEqual(LRS.padRoadwayId(""), null);
});

test("schema aliases", () => {
  const schema = LRS.LrsSchema.fromRows([
    { roadway: "1", begin_post: 0.0, end_post: 1.0, LOCATION: 0.4 },
  ]);
  assert.strictEqual(schema.roadway, "roadway");
  assert.strictEqual(schema.bmp, "begin_post");
  assert.strictEqual(schema.emp, "end_post");
  assert.strictEqual(schema.measure, "LOCATION");
});

test("schema min/max mp", () => {
  const schema = LRS.LrsSchema.fromRows([{ ROADWAY: "1", MinMP: 0, MaxMP: 2 }], { requireLine: true });
  assert.strictEqual(schema.bmp, "MinMP");
  assert.strictEqual(schema.emp, "MaxMP");
});

test("overlay overlap leading and trailing gaps", () => {
  const result = LRS.overlayEvents(target(), [
    { roadway: "100", BEGIN_POST: 2.0, END_POST: 6.0, AADT: 1200 },
  ]);
  assert.deepStrictEqual(result.map((row) => row.BEGIN_POST), [0.0, 2.0, 6.0]);
  assert.deepStrictEqual(result.map((row) => row.END_POST), [2.0, 6.0, 10.0]);
  assert.strictEqual(result[0].AADT, null);
  assert.strictEqual(result[1].AADT, 1200);
  assert.strictEqual(result[2].AADT, null);
});

test("overlay internal gap", () => {
  const result = LRS.overlayEvents(target(), [
    { ROADWAY: "100", BEGIN_POST: 0.0, END_POST: 3.0, FLAG: "a" },
    { ROADWAY: "100", BEGIN_POST: 7.0, END_POST: 10.0, FLAG: "b" },
  ]);
  assert.strictEqual(result.length, 3);
  assert.deepStrictEqual(result.map((row) => row.BEGIN_POST), [0.0, 3.0, 7.0]);
  assert.strictEqual(result[1].FLAG, null);
});

test("overlay unmatched roadway", () => {
  const result = LRS.overlayEvents(target(), [
    { ROADWAY: "999", BEGIN_POST: 0.0, END_POST: 5.0, AADT: 1 },
  ]);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].BEGIN_POST, 0.0);
  assert.strictEqual(result[0].END_POST, 10.0);
  assert.strictEqual(result[0].AADT, null);
});

test("overlay inner drops gaps", () => {
  const result = LRS.overlayEvents(
    target(),
    [{ ROADWAY: "100", BEGIN_POST: 4.0, END_POST: 6.0, AADT: 9 }],
    { how: "inner" }
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].BEGIN_POST, 4.0);
  assert.strictEqual(result[0].END_POST, 6.0);
});

test("overlay pads roadway ids", () => {
  const result = LRS.overlayEvents(
    [{ ROADWAY: 100, BEGIN_POST: 0.0, END_POST: 2.0 }],
    [{ roadway: "00000100", begin_post: 0.0, end_post: 2.0, X: 7 }]
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].X, 7);
});

test("overlay collapse longest", () => {
  const result = LRS.overlayEvents(
    [{ ROADWAY: "100", BEGIN_POST: 0.0, END_POST: 10.0, GROUP: "A" }],
    [
      { ROADWAY: "100", BEGIN_POST: 0.0, END_POST: 1.0, SRC: "short" },
      { ROADWAY: "100", BEGIN_POST: 1.0, END_POST: 10.0, SRC: "long" },
    ],
    { collapse: "longest", collapseGroupCols: ["ROADWAY", "GROUP"] }
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].BEGIN_POST, 0.0);
  assert.strictEqual(result[0].END_POST, 10.0);
  assert.strictEqual(result[0].SRC, "long");
});

test("overlay target rename", () => {
  const result = LRS.overlayEvents(
    target(),
    [{ ROADWAY: "100", BEGIN_POST: 0.0, END_POST: 10.0, OLD: 3 }],
    {
      targetRename: { ROADWAY: "ROADWAY_new", SECTADT: "SECTADT_new" },
      targetSchema: new LRS.LrsSchema({ roadway: "ROADWAY", bmp: "BEGIN_POST", emp: "END_POST" }),
    }
  );
  assert.ok("ROADWAY_new" in result[0]);
  assert.strictEqual(result[0].SECTADT_new, 5000);
  assert.strictEqual(result[0].OLD, 3);
});

test("dissolve contiguous merges touching segments", () => {
  const out = LRS.dissolveContiguous(
    [
      { ROADWAY: "1", BEGIN_POST: 0.0, END_POST: 2.0, FLAG: "a" },
      { ROADWAY: "1", BEGIN_POST: 2.0, END_POST: 5.0, FLAG: "a" },
      { ROADWAY: "1", BEGIN_POST: 5.0, END_POST: 8.0, FLAG: "b" },
    ],
    { groupCols: ["ROADWAY", "FLAG"] }
  );
  assert.strictEqual(out.length, 2);
  const first = out.find((row) => row.FLAG === "a");
  assert.strictEqual(first.BEGIN_POST, 0.0);
  assert.strictEqual(first.END_POST, 5.0);
});

test("dissolve does not merge across gap when contiguous required", () => {
  const out = LRS.dissolveContiguous(
    [
      { ROADWAY: "1", BEGIN_POST: 0.0, END_POST: 2.0, FLAG: "a" },
      { ROADWAY: "1", BEGIN_POST: 4.0, END_POST: 6.0, FLAG: "a" },
    ],
    { groupCols: ["ROADWAY", "FLAG"], requireContiguous: true }
  );
  assert.strictEqual(out.length, 2);
});

test("dissolve swallows gap when contiguous not required", () => {
  const out = LRS.dissolveContiguous(
    [
      { ROADWAY: "1", BEGIN_POST: 0.0, END_POST: 2.0, FLAG: "a" },
      { ROADWAY: "1", BEGIN_POST: 4.0, END_POST: 6.0, FLAG: "a" },
    ],
    { groupCols: ["ROADWAY", "FLAG"], requireContiguous: false }
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].BEGIN_POST, 0.0);
  assert.strictEqual(out[0].END_POST, 6.0);
});

test("detect advanced field aliases", () => {
  const found = LRS.detectAdvancedFields([
    { ROADWAY: "1", BEGIN_POST: 0, END_POST: 1, LATERAL_OFFSET: 6, LRS_SIDE: "L", EFF_FROM: "2020-01-01", EFF_TO: "2021-01-01" },
  ]);
  assert.strictEqual(found.offset, "LATERAL_OFFSET");
  assert.strictEqual(found.side, "LRS_SIDE");
  assert.strictEqual(found.fromDate, "EFF_FROM");
  assert.strictEqual(found.toDate, "EFF_TO");
});

test("as-of date keeps open and overlapping rows", () => {
  const rows = [
    { ROADWAY: "1", FROM_DATE: "2020-01-01", TO_DATE: "2021-01-01" },
    { ROADWAY: "1", FROM_DATE: "2021-01-01", TO_DATE: null },
  ];
  const kept = LRS.filterRowsAsOf(rows, { fromCol: "FROM_DATE", toCol: "TO_DATE", asOf: "2021-06-01" });
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(kept[0].FROM_DATE, "2021-01-01");
});

test("opposite sides are not overlaps when grouped", () => {
  const rows = [
    { ROADWAY: "1", BEGIN_POST: 0, END_POST: 10, SIDE: "L" },
    { ROADWAY: "1", BEGIN_POST: 0, END_POST: 10, SIDE: "R" },
  ];
  assert.strictEqual(LRS.findOverlaps(rows).length, 1);
  assert.strictEqual(LRS.findOverlaps(rows, null, { groupCols: ["SIDE"] }).length, 0);
});

test("dissolve keeps left and right separate when side is grouped", () => {
  const rows = [
    { ROADWAY: "1", BEGIN_POST: 0, END_POST: 5, SIDE: "L", FLAG: "a" },
    { ROADWAY: "1", BEGIN_POST: 5, END_POST: 10, SIDE: "L", FLAG: "a" },
    { ROADWAY: "1", BEGIN_POST: 0, END_POST: 5, SIDE: "R", FLAG: "a" },
    { ROADWAY: "1", BEGIN_POST: 5, END_POST: 10, SIDE: "R", FLAG: "a" },
  ];
  const split = LRS.dissolveContiguous(rows, { groupCols: ["ROADWAY", "FLAG", "SIDE"] });
  assert.strictEqual(split.length, 2);
  assert.ok(split.every((row) => row.BEGIN_POST === 0 && row.END_POST === 10));
});

test("overlay matches only the same side when asked", () => {
  const target = [{ ROADWAY: "100", BEGIN_POST: 0, END_POST: 10, SIDE: "L" }];
  const overlay = [
    { ROADWAY: "100", BEGIN_POST: 0, END_POST: 10, SIDE: "R", FLAG: "right" },
    { ROADWAY: "100", BEGIN_POST: 2, END_POST: 4, SIDE: "L", FLAG: "left" },
  ];
  const result = LRS.overlayEvents(target, overlay, {
    matchPairs: [{ target: "SIDE", overlay: "SIDE" }],
  });
  const matched = result.filter((row) => row.FLAG);
  assert.strictEqual(matched.length, 1);
  assert.strictEqual(matched[0].FLAG, "left");
});

test("locate matches side when both sides are mapped", () => {
  const points = [{ ROADWAY: "100", LOCATION: 3, SIDE: "L" }];
  const events = [
    { ROADWAY: "100", BEGIN_POST: 0, END_POST: 10, SIDE: "R", FLAG: "right" },
    { ROADWAY: "100", BEGIN_POST: 0, END_POST: 10, SIDE: "L", FLAG: "left" },
  ];
  const { located } = LRS.locatePoints(points, events, {
    matchPairs: [{ point: "SIDE", event: "SIDE" }],
  });
  assert.strictEqual(located.length, 1);
  assert.strictEqual(located[0].FLAG, "left");
});

test("dissolve respects float tolerance", () => {
  const out = LRS.dissolveContiguous(
    [
      { ROADWAY: "1", BEGIN_POST: 0.0, END_POST: 2.0, FLAG: "a" },
      { ROADWAY: "1", BEGIN_POST: 2.00005, END_POST: 4.0, FLAG: "a" },
    ],
    {
      groupCols: ["ROADWAY", "FLAG"],
      schema: new LRS.LrsSchema({ roadway: "ROADWAY", bmp: "BEGIN_POST", emp: "END_POST", tolerance: 1e-4 }),
    }
  );
  assert.strictEqual(out.length, 1);
});

test("collapse longest expands bounds", () => {
  const out = LRS.collapseLongest(
    [
      { ROADWAY: "1", BEGIN_POST: 0.0, END_POST: 1.0, SRC: "short" },
      { ROADWAY: "1", BEGIN_POST: 1.0, END_POST: 10.0, SRC: "long" },
    ],
    { groupCols: ["ROADWAY"] }
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].SRC, "long");
  assert.strictEqual(out[0].BEGIN_POST, 0.0);
  assert.strictEqual(out[0].END_POST, 10.0);
});

test("locate points keeps on-segment and exports misses", () => {
  const { located, unmatched } = LRS.locatePoints(
    [
      { "Roadway ID": "00000100", LOCATION: 1.5, SITE: "A" },
      { "Roadway ID": "00000100", LOCATION: 9.0, SITE: "B" },
      { "Roadway ID": "00000200", LOCATION: 0.5, SITE: "C" },
    ],
    [{ roadway: "100", begin_post: 0.0, end_post: 5.0, sectadt24: 111 }],
    {
      pointSchema: new LRS.LrsSchema({ roadway: "Roadway ID", measure: "LOCATION" }),
      eventSchema: new LRS.LrsSchema({ roadway: "roadway", bmp: "begin_post", emp: "end_post" }),
    }
  );
  assert.deepStrictEqual(located.map((row) => row.SITE), ["A"]);
  assert.strictEqual(located[0].sectadt24, 111);
  assert.deepStrictEqual(unmatched.map((row) => row.SITE).sort(), ["B", "C"]);
});

test("locate does not overwrite point LOCATION with event LOCATION", () => {
  const points = [{ ROADWAY: "100", LOCATION: 3, NOTE: "crash" }];
  const events = [
    { ROADWAY: "100", BEGIN_POST: 0, END_POST: 2, LOCATION: 1, FLAG: "a" },
    { ROADWAY: "100", BEGIN_POST: 2.5, END_POST: 4, LOCATION: 3.2, FLAG: "b" },
  ];
  const { located, unmatched } = LRS.locatePoints(points, events);
  assert.strictEqual(located.length, 1);
  assert.strictEqual(located[0].LOCATION, 3);
  assert.strictEqual(located[0].FLAG, "b");
  assert.strictEqual(unmatched.length, 0);
});

test("locate points inclusive bounds", () => {
  const { located, unmatched } = LRS.locatePoints(
    [{ ROADWAY: "1", LOCATION: 2.0 }],
    [{ ROADWAY: "1", BEGIN_POST: 0.0, END_POST: 2.0 }]
  );
  assert.strictEqual(located.length, 1);
  assert.strictEqual(unmatched.length, 0);
});

test("split line by measure uses length ratio", () => {
  const line = { type: "LineString", coordinates: [[0, 0], [10, 0]] };
  const clipped = LRS.splitLineByMeasure(line, 0.0, 10.0, 2.0, 5.0);
  assert.ok(clipped);
  assert.ok(Math.abs(LRS.geomLength(clipped) - 3.0) < 1e-6);
  assert.ok(Math.abs(clipped.coordinates[0][0] - 2.0) < 1e-6);
  assert.ok(Math.abs(clipped.coordinates[clipped.coordinates.length - 1][0] - 5.0) < 1e-6);
});

test("split line by measure uses M values", () => {
  const dummy = { type: "LineString", coordinates: [[0, 0, 0, 0.0], [10, 0, 0, 20.0]] };
  const clipped = LRS.substringByM(dummy, 5.0, 15.0);
  assert.ok(clipped);
  assert.ok(Math.abs(clipped.coordinates[0][0] - 2.5) < 1e-6);
  assert.ok(Math.abs(clipped.coordinates[clipped.coordinates.length - 1][0] - 7.5) < 1e-6);
});

test("locate events on routes", () => {
  const routes = [
    {
      ROADWAY: "1",
      BEGIN_POST: 0.0,
      END_POST: 10.0,
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
    },
  ];
  const events = [
    { ROADWAY: "1", BEGIN_POST: 0.0, END_POST: 5.0, GROUP: "A" },
    { ROADWAY: "1", BEGIN_POST: 5.0, END_POST: 10.0, GROUP: "A" },
  ];
  const located = LRS.locateEventsOnRoutes(events, routes);
  assert.strictEqual(located.length, 2);
  assert.ok(located.every((row) => row.geometry));
  assert.ok(Math.abs(LRS.geomLength(located[0].geometry) - 5.0) < 1e-6);
  const dissolved = LRS.dissolveContiguous(located, {
    groupCols: ["ROADWAY", "GROUP"],
    schema: new LRS.LrsSchema({ roadway: "ROADWAY", bmp: "BEGIN_POST", emp: "END_POST" }),
  });
  assert.strictEqual(dissolved.length, 1);
  assert.ok(Math.abs(LRS.geomLength(dissolved[0].geometry) - 10.0) < 1e-6);
  assert.strictEqual(dissolved[0].BEGIN_POST, 0.0);
  assert.strictEqual(dissolved[0].END_POST, 10.0);
});

test("export lrs geometry geojson clip", () => {
  const routes = [
    {
      SECT_ID: "00000100",
      BMP: 0.0,
      EMP: 10.0,
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
    },
  ];
  const events = [{ ROADWAY: "100", BEGIN_POST: 2.0, END_POST: 6.0, AADT: 50 }];
  const out = LRS.exportLrsGeometry(routes, {
    segmentId: "SECT_ID",
    startPost: "BMP",
    endPost: "EMP",
    events,
    eventSegmentId: "ROADWAY",
    eventStartPost: "BEGIN_POST",
    eventEndPost: "END_POST",
  });
  assert.strictEqual(out.length, 1);
  assert.ok(Math.abs(LRS.geomLength(out[0].geometry) - 4.0) < 1e-6);
});

test("export requires picked fields", () => {
  let threw = false;
  try {
    LRS.exportLrsGeometry(
      [{ ROADWAY: "1", BEGIN_POST: 0.0, END_POST: 1.0, geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] } }],
      { segmentId: "MISSING_ID", startPost: "BEGIN_POST", endPost: "END_POST" }
    );
  } catch (err) {
    threw = String(err.message).includes("MISSING_ID");
  }
  assert.ok(threw);
});

test("utm zone 17 origin is -81, 0", () => {
  const [lon, lat] = LRS.utmToLonLat(500000, 0, 17, true);
  assert.ok(Math.abs(lon + 81) < 0.001);
  assert.ok(Math.abs(lat) < 0.001);
});

test("detect UTM 17N from PRJ and project without mutating source", () => {
  const prj = 'PROJCS["NAD_1983_UTM_Zone_17N"]';
  assert.strictEqual(LRS.detectCrs(prj), "EPSG:26917");
  const rows = [
    {
      ROADWAY: "00000100",
      geometry: { type: "LineString", coordinates: [[500000, 3100000], [500200, 3100200]] },
    },
  ];
  const fc = LRS.rowsToMapGeoJson(rows, { crs: "EPSG:26917" });
  assert.strictEqual(rows[0].geometry.coordinates[0][0], 500000);
  assert.strictEqual(fc.features.length, 1);
  const lon = fc.features[0].geometry.coordinates[0][0];
  const lat = fc.features[0].geometry.coordinates[0][1];
  assert.ok(lon < -80 && lon > -83);
  assert.ok(lat > 27 && lat < 29);
});

test("map geojson keeps attributes and source row index", () => {
  const rows = [
    {
      ROADWAY: "00000100",
      FLAG: "a",
      SIDE: "L",
      geometry: { type: "LineString", coordinates: [[-82, 28], [-82.1, 28.1]] },
    },
    { ROADWAY: "00000200", FLAG: "skip" },
    {
      ROADWAY: "00000300",
      FLAG: "c",
      extra: { type: "note" },
      geometry: { type: "LineString", coordinates: [[-81, 27], [-81.1, 27.1]] },
    },
  ];
  const fc = LRS.rowsToMapGeoJson(rows);
  assert.strictEqual(fc.features.length, 2);
  assert.strictEqual(fc.features[0].properties._row, 0);
  assert.strictEqual(fc.features[0].properties.FLAG, "a");
  assert.strictEqual(fc.features[0].properties.SIDE, "L");
  assert.strictEqual(fc.features[1].properties._row, 2);
  assert.strictEqual(fc.features[1].properties.FLAG, "c");
  assert.ok(String(fc.features[1].properties.extra).includes("note"));
  assert.strictEqual(rows[0].geometry.coordinates[0][0], -82);
});

test("map geojson keeps every vertex", () => {
  const coords = Array.from({ length: 80 }, (_, i) => [-82 - i * 0.001, 28 + i * 0.001]);
  const fc = LRS.rowsToMapGeoJson([{ ROADWAY: "1", geometry: { type: "LineString", coordinates: coords } }]);
  assert.strictEqual(fc.features[0].geometry.coordinates.length, 80);
});

test("map geojson draws locate points", () => {
  const fc = LRS.rowsToMapGeoJson([
    { ROADWAY: "1", LOCATION: 2, geometry: { type: "Point", coordinates: [-82, 28] } },
  ]);
  assert.strictEqual(fc.features[0].geometry.type, "Point");
  assert.strictEqual(fc.features[0].geometry.coordinates[0], -82);
});

test("point at measure uses length ratio", () => {
  const line = { type: "LineString", coordinates: [[0, 0], [10, 0]] };
  const point = LRS.pointAtMeasure(line, 0, 10, 4);
  assert.ok(point);
  assert.strictEqual(point.type, "Point");
  assert.ok(Math.abs(point.coordinates[0] - 4) < 1e-6);
  assert.ok(Math.abs(point.coordinates[1]) < 1e-6);
});

test("locate attaches a point on event geometry", () => {
  const { located } = LRS.locatePoints(
    [{ ROADWAY: "1", LOCATION: 2.5 }],
    [
      {
        ROADWAY: "1",
        BEGIN_POST: 0,
        END_POST: 5,
        FLAG: "seg",
        geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
      },
    ]
  );
  assert.strictEqual(located.length, 1);
  assert.strictEqual(located[0].FLAG, "seg");
  assert.strictEqual(located[0].geometry.type, "Point");
  assert.ok(Math.abs(located[0].geometry.coordinates[0] - 5) < 1e-6);
});

test("map geojson draws polygon outlines as lines", () => {
  const rows = [
    {
      ROADWAY: "00000100",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-82, 28],
            [-82.1, 28],
            [-82.1, 28.1],
            [-82, 28],
          ],
        ],
      },
    },
  ];
  const fc = LRS.rowsToMapGeoJson(rows);
  assert.strictEqual(fc.features.length, 1);
  assert.strictEqual(fc.features[0].geometry.type, "MultiLineString");
});

test("inspect keeps existing LRS when BMP/EMP are populated", () => {
  const inspect = LRS.inspectEventKeys([
    {
      ROADWAY: "100",
      BEGIN_POST: 1,
      END_POST: 2,
      "Intersecting Roadway Id Milepoints": "03010000 = 8.8|03A05476 = .5",
    },
  ]);
  assert.strictEqual(inspect.recommended, "lrs");
  assert.strictEqual(inspect.usable, 1);
  assert.strictEqual(inspect.approachCount, 2);
  assert.strictEqual(inspect.packedCol, "Intersecting Roadway Id Milepoints");
});

test("inspect recommends extract when BMP/EMP are missing", () => {
  const inspect = LRS.inspectEventKeys([
    {
      ROADWAY: "100",
      "Intersecting Roadway Id Milepoints": "03010000 = 8.8|03A05476 = .5",
    },
  ]);
  assert.strictEqual(inspect.recommended, "extract");
  assert.strictEqual(inspect.hasLineColumns, false);
  assert.strictEqual(inspect.approachCount, 2);
});

test("parse packed intersection approaches", () => {
  const packed = "03010000 = 8.837|03A05476 = .496";
  const parts = LRS.parsePackedApproaches(packed);
  assert.strictEqual(parts.length, 2);
  assert.strictEqual(LRS.padRoadwayId(parts[0].roadway), "03010000");
  assert.ok(Math.abs(parts[1].measure - 0.496) < 1e-9);
});

test("explode nested routes adds parent and sub ids", () => {
  const rows = [
    {
      LocationID: "LPI-02352",
      ROADWAY: 3010000,
      "Intersecting Roadway Id Milepoints": "03010000 = 8.837|03A05476 = .496",
      "Intersecting Road Names": "9TH ST N|ANCHOR RODE DR",
      CostEstimate: 5408,
    },
  ];
  const { rows: exploded, skipped } = LRS.explodeNestedRoutes(rows, { stubLength: 0.02 });
  assert.strictEqual(skipped, 0);
  assert.strictEqual(exploded.length, 2);
  assert.strictEqual(exploded[0].LRS_PARENT_ID, "LPI-02352");
  assert.strictEqual(exploded[0].LRS_SOURCE_ROW, 1);
  assert.strictEqual(exploded[0].LRS_SUB_ID, 1);
  assert.strictEqual(exploded[1].ROADWAY, "03A05476");
  assert.strictEqual(exploded[0].ROADWAY_ORIG, 3010000);
  assert.ok(Math.abs(exploded[0].BEGIN_POST - (8.837 - 0.01)) < 1e-9);
  assert.strictEqual(exploded[0].CostEstimate, 5408);
});

test("combine nested routes restores original shape", () => {
  const rows = [
    {
      LocationID: "LPI-02352",
      ROADWAY: 3010000,
      "Intersecting Roadway Id Milepoints": "03010000 = 8.837|03A05476 = .496",
      CostEstimate: 5408,
    },
  ];
  const { rows: exploded } = LRS.explodeNestedRoutes(rows, { stubLength: 0.02 });
  exploded[0].geometry = { type: "LineString", coordinates: [[0, 0], [1, 0]] };
  exploded[1].geometry = { type: "LineString", coordinates: [[2, 0], [3, 0]] };
  const combined = LRS.combineNestedRoutes(exploded);
  assert.strictEqual(combined.length, 1);
  assert.strictEqual(combined[0].ROADWAY, 3010000);
  assert.ok(String(combined[0]["Intersecting Roadway Id Milepoints"]).includes("03010000"));
  assert.ok(String(combined[0]["Intersecting Roadway Id Milepoints"]).includes("03A05476"));
  assert.strictEqual(combined[0].LRS_SUB_ID, undefined);
  assert.strictEqual(combined[0].geometry.type, "MultiLineString");
  assert.strictEqual(combined[0].CostEstimate, 5408);
});

test("shapefile export refuses attribute-only tables", () => {
  let threw = false;
  try {
    LRS.shapefileZip([{ ROADWAY: "00000100", BEGIN_POST: 0, END_POST: 1 }], "events.zip");
  } catch (err) {
    threw = String(err.message).includes("line geometry");
  }
  assert.ok(threw);
});

test("overlay report flags unmatched roadways", () => {
  const target = [
    { ROADWAY: "100", BEGIN_POST: 0, END_POST: 10 },
    { ROADWAY: "200", BEGIN_POST: 0, END_POST: 5 },
  ];
  const overlay = [{ ROADWAY: "100", BEGIN_POST: 2, END_POST: 4, AADT: 9 }];
  const result = LRS.overlayEvents(target, overlay);
  const report = LRS.reportOverlay(target, overlay, result);
  assert.ok(report.onlyTarget.includes("00000200"));
  assert.ok(report.lines.some((line) => line.level === "warn"));
});

test("locate report splits missing roadway vs off-measure", () => {
  const points = [
    { ROADWAY: "100", LOCATION: 3 },
    { ROADWAY: "100", LOCATION: 99 },
    { ROADWAY: "999", LOCATION: 1 },
  ];
  const events = [{ ROADWAY: "100", BEGIN_POST: 0, END_POST: 10, FLAG: "a" }];
  const { located, unmatched } = LRS.locatePoints(points, events);
  const report = LRS.reportLocate(points, events, located, unmatched);
  assert.strictEqual(located.length, 1);
  assert.strictEqual(report.noRoadway, 1);
  assert.strictEqual(report.offMeasure, 1);
});

test("overlay splits overlapping overlay rows at all breakpoints", () => {
  const result = LRS.overlayEvents(target(), [
    { ROADWAY: "100", BEGIN_POST: 0.0, END_POST: 6.0, SRC: "A" },
    { ROADWAY: "100", BEGIN_POST: 4.0, END_POST: 10.0, SRC: "B" },
  ]);
  assert.deepStrictEqual(
    result.map((row) => [row.BEGIN_POST, row.END_POST, row.SRC]),
    [
      [0, 4, "A"],
      [4, 6, "A"],
      [4, 6, "B"],
      [6, 10, "B"],
    ]
  );
});

test("dissolve empty groups keeps unlike attributes separate", () => {
  const out = LRS.dissolveContiguous([
    { ROADWAY: "1", BEGIN_POST: 0.0, END_POST: 2.0, FLAG: "a", AADT: 100 },
    { ROADWAY: "1", BEGIN_POST: 2.0, END_POST: 5.0, FLAG: "b", AADT: 200 },
  ]);
  assert.strictEqual(out.length, 2);
});

test("inspect uses mapped columns not Florida aliases", () => {
  const rows = [{ RTE_ID: "A12", BEG_MP: 0, END_MP: 4 }];
  const inspect = LRS.inspectEventKeys(rows, { roadway: "RTE_ID", bmp: "BEG_MP", emp: "END_MP" });
  assert.strictEqual(inspect.hasLineColumns, true);
  assert.strictEqual(inspect.usable, 1);
  assert.strictEqual(inspect.roadway, "RTE_ID");
});

test("detect worldwide route aliases", () => {
  const generic = LRS.LrsSchema.fromRows([{ RTE_ID: "A", BEG_MP: 0, END_MP: 2 }], { requireLine: true });
  assert.strictEqual(generic.roadway, "RTE_ID");
  assert.strictEqual(generic.bmp, "BEG_MP");
  assert.strictEqual(generic.emp, "END_MP");
  const esri = LRS.LrsSchema.fromRows([{ ROUTE_ID: "A", FROM_MEASURE: 1, TO_MEASURE: 3 }], { requireLine: true });
  assert.strictEqual(esri.roadway, "ROUTE_ID");
  assert.strictEqual(esri.bmp, "FROM_MEASURE");
  assert.strictEqual(esri.emp, "TO_MEASURE");
});

test("locate shared boundary keeps one event", () => {
  const { located, unmatched } = LRS.locatePoints(
    [{ ROADWAY: "1", LOCATION: 5 }],
    [
      { ROADWAY: "1", BEGIN_POST: 0, END_POST: 5, FLAG: "first" },
      { ROADWAY: "1", BEGIN_POST: 5, END_POST: 10, FLAG: "second" },
    ]
  );
  assert.strictEqual(located.length, 1);
  assert.strictEqual(located[0].FLAG, "second");
  assert.strictEqual(unmatched.length, 0);
});

test("QC fails on gaps and reports zero-length without deleting", () => {
  const rows = [
    { ROADWAY: "1", BEGIN_POST: 0, END_POST: 2 },
    { ROADWAY: "1", BEGIN_POST: 4, END_POST: 6 },
    { ROADWAY: "2", BEGIN_POST: 3, END_POST: 3 },
  ];
  const qc = LRS.validateLrs(rows);
  assert.strictEqual(qc.ok, false);
  assert.ok(qc.gaps.length >= 1);
  assert.strictEqual(qc.zeroLength.length, 1);
  assert.strictEqual(qc.invalidBounds.length, 0);
  const issues = LRS.flattenValidation(qc, LRS.LrsSchema.fromRows(rows, { requireLine: true }));
  assert.ok(issues.some((row) => row.ISSUE === "zero_length"));
  assert.ok(issues.some((row) => row.ISSUE === "gap"));
});

test("pad numeric ids leave text ids unchanged", () => {
  assert.strictEqual(LRS.padRoadwayId("I-95"), "I-95");
  assert.strictEqual(LRS.padRoadwayId("008._P"), "008._P");
  LRS.configureRoadwayPad({ mode: "all", width: 8 });
  assert.strictEqual(LRS.padRoadwayId("I-95"), "0000I-95");
  LRS.configureRoadwayPad({ mode: "off" });
  assert.strictEqual(LRS.padRoadwayId(100), "100");
  LRS.configureRoadwayPad({ mode: "numeric", width: 8 });
  assert.strictEqual(LRS.padRoadwayId(100), "00000100");
});

test("applyRouteIdPad writes padded ids onto the mapped column", () => {
  LRS.configureRoadwayPad({ mode: "numeric", width: 8 });
  const out = LRS.applyRouteIdPad([{ ROADWAY: 100, BEGIN_POST: 0, END_POST: 1 }], "ROADWAY");
  assert.strictEqual(out[0].ROADWAY, "00000100");
  LRS.configureRoadwayPad({ mode: "off" });
  const same = LRS.applyRouteIdPad([{ ROADWAY: 100 }], "ROADWAY");
  assert.strictEqual(same[0].ROADWAY, 100);
  LRS.configureRoadwayPad({ mode: "numeric", width: 8 });
});

test("calibrate writes unique ids and vertex M values", () => {
  const out = LRS.calibrateRouteMeasures(
    [{ geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] } }],
    { crs: "EPSG:3857" }
  );
  assert.strictEqual(out.roadway, "LRS_UID");
  assert.ok(out.rows[0].LRS_UID);
  assert.strictEqual(out.rows[0].LRS_BMP, 0);
  assert.ok(out.rows[0].geometry.coordinates[0].length >= 4);
  assert.ok(Math.abs(out.rows[0].geometry.coordinates[0][3] - 0) < 1e-9);
  assert.ok(out.rows[0].geometry.coordinates[1][3] > 0);
});

test("csv round trip", () => {
  const text = LRS.toCsv([{ ROADWAY: "00000100", BEGIN_POST: 0, END_POST: 1, AADT: 12 }]);
  const rows = LRS.parseCsv(text);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(String(rows[0].ROADWAY), "00000100");
  assert.strictEqual(rows[0].AADT, 12);
});

(async () => {
  const zip = LRS.shapefileZip(
    [
      {
        ROADWAY: "00000100",
        BEGIN_POST: 0,
        END_POST: 10,
        geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
      },
    ],
    "routes.shp"
  );
  const files = await LRS.parseZip(zip);
  const parsed = LRS.parseShapefile({ shp: files["routes.shp"], dbf: files["routes.dbf"] });
  assert.strictEqual(parsed.rows.length, 1);
  assert.strictEqual(String(parsed.rows[0].ROADWAY), "00000100");
  assert.ok(Math.abs(LRS.geomLength(parsed.rows[0].geometry) - 10) < 1e-6);
  passed += 1;
  console.log("ok  shapefile zip round trip");

  const fromZip = await LRS.tableFromNamedBuffers({ "routes.zip": zip });
  assert.strictEqual(fromZip.rows.length, 1);
  assert.strictEqual(String(fromZip.rows[0].ROADWAY), "00000100");
  passed += 1;
  console.log("ok  table from zipped shapefile");

  const nested = LRS.zipStore([
    { name: "export/routes.shp", data: files["routes.shp"] },
    { name: "export/routes.dbf", data: files["routes.dbf"] },
    { name: "export/routes.shx", data: files["routes.shx"] },
  ]);
  const fromNested = await LRS.tableFromNamedBuffers({ "layer.zip": nested });
  assert.strictEqual(fromNested.rows.length, 1);
  assert.strictEqual(String(fromNested.rows[0].ROADWAY), "00000100");
  passed += 1;
  console.log("ok  table from nested zipped shapefile");

  const lpiPath = path.join(
    __dirname,
    "..",
    "..",
    "input_data",
    "event_tables",
    "Intersection Grouped Improvements_LPI.xlsx"
  );
  if (fs.existsSync(lpiPath)) {
    const table = await LRS.tableFromNamedBuffers({
      "Intersection Grouped Improvements_LPI.xlsx": fs.readFileSync(lpiPath),
    });
    assert.ok(table.rows.length > 1000);
    assert.ok(table.rows[0]["Intersecting Roadway Id Milepoints"]);
    const { rows: exploded } = LRS.explodeNestedRoutes(table.rows.slice(0, 20), { stubLength: 0.02 });
    assert.ok(exploded.length >= 20);
    assert.ok(exploded.every((row) => row.LRS_PARENT_ID && row.ROADWAY && row.LOCATION != null));
    const combined = LRS.combineNestedRoutes(exploded);
    assert.ok(combined.length <= 20);
    passed += 1;
    console.log("ok  LPI xlsx extract and combine");
  }

  console.log(`\n${passed} tests passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
