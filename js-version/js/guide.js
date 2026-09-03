(function (root) {

  const STEPS = {

    validate: {

      title: "Validate event coverage",

      summary: "Check inverted mileposts, null keys, overlaps, and gaps before you break tables.",

      example: "Load an event table and confirm Route ID / BMP / EMP (or pick a column layout above). Run validate. Gaps, overlaps, inverted bounds, and BMP = EMP rows fail QC. Those rows stay. Route ID pad, if on, rewrites IDs in session — Export table to keep that version.",

      fields: {

        "va-input": "Line event table — CSV, Excel, GeoJSON, or zipped shapefile.",

        "va-road": "Route ID column (ROUTE_ID, RTE_ID, ROADWAY, …).",

        "va-bmp": "Begin milepost (BEGIN_POST, BMP, BEG_MP, …).",

        "va-emp": "End milepost (END_POST, EMP, END_MP, …).",

        "va-output": "QC export name. Updates from the input file (roads.xlsx → roads_qc.csv).",

        "va-table-output": "Validated table name. Updates from the input file (roads.xlsx → roads_events.csv).",

        "va-groups": "Optional: offset, side, and dates split QC groups when Advanced tools is on.",

      },

      errors: [

        "Choose an event table before Run QC.",

        "If column picks are wrong, mileposts may look inverted or missing.",

        "QC now fails when gaps or BMP = EMP rows exist. Those rows are reported, not deleted.",

      ],

    },

    overlay: {

      title: "Overlay and break at mileposts",

      summary: "Dynamic-segment a target table against another on route ID + BMP/EMP. Unmatched target stretches stay when you keep gaps.",

      example: "You overlay two files at a time: target (the route inventory) + one overlay table. Target 0–10 with overlay A 0–6 and B 4–10 becomes slices at 0, 4, 6, and 10. The 4–6 overlap keeps both A and B as separate rows. If the target is already the full route and overlay rows do not overlap each other, you will not see that extra split.",

      fields: {

        "ov-target": "Base line events. Leave empty to use the last session result.",

        "ov-overlay": "Second table whose mileposts split the target (required).",

        "ov-how": "Keep target gaps when overlay has no match, or return matches only. Overlay attributes are null on unmatched target stretches.",

        "ov-collapse": "Keep every slice, or fold slices back using the longest overlay attributes. This does not drop unmatched target rows unless Unmatched target is Matches only.",

        "ov-groups": "Columns that must stay together when collapse is Longest. Leave blank to use remaining target columns.",

        "ov-output": "Export name. Updates from the target file (roads.xlsx → roads_overlay.csv).",

      },

      errors: [

        "Overlay file is required every time.",

        "Unmatched routes in the log mean overlay IDs do not exist on the target.",

        "Zero output rows often means BMP/EMP columns were not mapped correctly.",

      ],

    },

    dissolve: {

      title: "Dissolve connected segments",

      summary: "Merge adjacent rows that share attributes when the current BMP meets the previous EMP.",

      example: "After overlay, leave the event file empty to dissolve the session. Leave group columns blank to keep every remaining attribute (AADT, surface, …) from merging. Type ROADWAY only if you really want the whole route collapsed.",

      fields: {

        "ds-input": "Line events. Leave empty to use the last session result.",

        "ds-groups": "Attributes that must match for two rows to merge. Blank = all remaining columns, so unlike AADT or surface stay separate.",

        "ds-contig": "Only merge when current BMP equals previous EMP (within tolerance).",

        "ds-output": "Export name. Updates from the input file (roads.xlsx → roads_dissolved.csv).",

      },

      errors: [

        "Nothing merged — check group columns and the adjacency checkbox.",

        "Wrong group columns can merge rows you meant to keep separate.",

      ],

    },

    locate: {

      title: "Locate points on line events",

      summary: "Keep point rows whose measure falls on a matching route’s BMP–EMP. Unmatched points are the QC for this step.",

      example: "Points file is required. Leave line events empty to use the session table. Unmatched points export separately.",

      fields: {

        "lc-points": "Point table with route ID and measure (LOCATION, MP).",

        "lc-events": "Line events. Leave empty to use the last session result.",

        "lc-output": "Located-points name. Updates from the points file (crashes.csv → crashes_located.csv).",

        "lc-unmatched": "Second export for points not on any segment (QC list).",

      },

      errors: [

        "Points file is always required.",

        "Many unmatched points often mean route IDs or measure columns differ between tables.",

      ],

    },

    display: {

      title: "Display events on route geometry",

      summary: "Clip event BMP–EMP onto a route+measure layer. Export geometry only when you click Export.",

      example: "Load a route shapefile first — the map fits worldwide to your data. Leave events empty to clip the session table.",

      fields: {

        "dp-routes": "Route layer with line geometry. Leave empty to reuse routes from Create LRS.",

        "dp-events": "Event table. Leave empty to use the last session result.",

        "dp-fmt": "GeoJSON is always WGS 84. Shapefile zip can be WGS 84 or the source CRS.",

        "dp-crs": "WGS 84 is the general lon/lat system for ArcGIS Pro anywhere. Keep source CRS to match the original route shapefile (UTM, State Plane, …).",

        "dp-output": "Export name. Updates from the events file, or the routes file if events are empty.",

      },

      errors: [

        "Routes must include line geometry (shapefile or GeoJSON).",

        "Packed mileposts need Extract before Display.",

        "If routes have no IDs or measures, open Create LRS first — it is the optional tool next to Extract / combine.",

        "Shapefile export fails on attribute-only tables — use CSV or GeoJSON.",

      ],

    },

    calibrate: {

      title: "Create LRS from geometry",

      summary: "Optional. Use only when a line file has no Route ID, BMP/EMP, or vertex measures. This is not part of the numbered milepost workflow.",

      example: "Load a route shapefile with no Route ID or mileposts. Run Create LRS, then go to Display (and Overlay if you need the generated table). Skip this tool when agency BMP/EMP and M values already exist.",

      fields: {

        "cl-routes": "Line shapefile or GeoJSON. Required.",

        "cl-seg": "Existing Route ID column, if the file has one. Otherwise LRS_UID is created.",

        "cl-bmp": "Existing begin measure, if present. Otherwise LRS_BMP is 0.",

        "cl-emp": "Existing end measure, if present. Otherwise LRS_EMP is line length.",

        "cl-output": "Export name. Updates from the route file (routes.zip → routes_lrs.geojson).",

        "cl-crs": "Same as Display: WGS 84 for a general lon/lat shapefile, or keep the source CRS.",

      },

      errors: [

        "Routes must include line geometry.",

        "Generated measures follow drawn length. They will not match a published milepost system.",

        "Do not treat Create LRS output as QC-passed inventory without reviewing it.",

      ],

    },

    explode: {

      title: "Extract packed intersection routes",

      summary: "Optional. If the table already has Route ID / BMP / EMP, skip this step. Use Extract only when those fields are missing, or when you want one row per packed approach.",

      example: "Skip if Route ID / BMP / EMP already exist. Extract builds one row per approach; Combine folds them back.",

      fields: {

        "exn-input": "Intersection table with a packed id=milepost field.",

        "exn-packed": "Column like Intersecting Roadway Id Milepoints.",

        "exn-stub": "Short segment length (miles) around each approach measure.",

        "cb-input": "Extracted rows. Leave empty to combine the last extract or display.",

      },

      errors: [

        "Combine needs LRS_SOURCE_ROW or LRS_PARENT_ID from Extract.",

        "If mileposts already exist, skip Extract and go straight to Validate.",

      ],

    },

  };



  function stepForPanel(panelId) {

    if (panelId === "explode") return STEPS.explode;

    return STEPS[panelId] || null;

  }



  function fieldsForPanel(panelId) {

    const step = stepForPanel(panelId);

    if (!step || !step.fields) return [];

    return Object.entries(step.fields).map(([id, text]) => ({ id, text }));

  }



  const OPTION_HELP = {
    "ov-how": "Keep the target as the spine. Overlay values copy only where mileposts overlap.\n\nExample — target 0–10, overlay only 3–7.\nKeep target gaps: 0–3 blank, 3–7 matched, 7–10 blank.\nMatches only: just 3–7. The 0–3 and 7–10 stretches are dropped.\n\nOverlay outside the target (12–14) is not saved.",
    "ov-collapse": "After overlay you get a row for each milepost slice. Collapse can fold those slices afterward — it does not create the breaks.\n\nExample — target 0–10, overlay A 0–3 (AADT 8000), overlay B 3–10 (AADT 20000).\nKeep every slice: two rows, 0–3 and 3–10.\nLongest overlay attributes: one row 0–10 with AADT 20000 (the longer stretch).\n\nIf two overlays share a stretch (A 0–6 and B 4–10), Keep every slice writes both on 4–6.",
    "ov-groups": "Used only when Collapse is Longest. Slices fold only when these target columns match.\n\nExample — target has COUNTY and SURFACE.\nLeave blank: same COUNTY and SURFACE can fold. Different SURFACE stays two rows.\nType COUNTY: same county folds even if SURFACE differs. The longer overlay’s values win.\n\nThis is not Dissolve group columns. Leave blank to use remaining target columns.",
    "ds-groups": "Rows merge only when these attributes match and (if checked) BMP meets the previous EMP. Leave blank to use every remaining column so AADT, surface, and similar fields stay separate. Type ROADWAY only if you want the whole route collapsed.",
    "ds-contig": "When checked, rows merge only if the current begin milepost meets the previous end milepost. Uncheck to also merge across gaps when the group columns match.",
    "roadway-pad": "Shown under each Route ID / BMP / EMP row. One setting for the whole tool: it matches IDs across files and rewrites the Route ID column (100 → 00000100). Numeric IDs only leaves I-95 or 008._P alone. Off keeps every ID as written. All IDs pads text too. Export the result to save the padded table. Use Off for already-formatted keys.",
    "cl-calibrate": "Builds a temporary LRS on the route geometry: LRS_UID when IDs are missing, LRS_BMP/LRS_EMP from line length, and vertex M. Prefer agency measures when they exist. After you run it, Display can reuse the session routes.",
    "export-crs": "WGS 84 (lon/lat) is the general reference system. Use it when the file should open in ArcGIS Pro in any state without assigning a projection.\n\nKeep source CRS writes the original .prj (Florida UTM 17N, Georgia State Plane, …) and leaves coordinates in those units. Use that when you need the export to sit on the same LRS layer you started with.\n\nGeoJSON is always WGS 84. Other states work when the route zip includes its .prj — the tool reads UTM (any zone) and State Plane (Transverse Mercator or Lambert). It does not guess Florida when the .prj says otherwise.",
    "field-profile": "Auto-detect reads common names from this file (ROADWAY, RTE_ID, ROUTE_ID, BEG_MP, FROM_MEASURE, …). Pick a regional layout to fill the dropdowns when those columns exist. You can still change any dropdown by hand.",
  };

  const FIELD_PROFILES = {
    florida: {
      label: "Florida RCI",
      roadway: ["ROADWAY", "ROADWAY_ID"],
      bmp: ["BEGIN_POST", "BEGIN_MP"],
      emp: ["END_POST", "END_MP"],
      measure: ["LOCATION", "MILEPOST"],
    },
    esri: {
      label: "Esri Roads and Highways",
      roadway: ["ROUTE_ID", "ROUTEID", "RouteID"],
      bmp: ["FROM_MEASURE", "FromMeasure", "FROM_MILEPOINT"],
      emp: ["TO_MEASURE", "ToMeasure", "TO_MILEPOINT"],
      measure: ["MEASURE", "MEAS"],
    },
    gdot: {
      label: "Georgia DOT",
      roadway: ["ROUTE_ID", "ROUTENAME"],
      bmp: ["FROM_MILEPOINT", "FROM_MEASURE"],
      emp: ["TO_MILEPOINT", "TO_MEASURE"],
      measure: ["MILEPOINT", "MEASURE"],
    },
    ncdot: {
      label: "NCDOT",
      roadway: ["RouteID", "ROUTE_ID", "ROUTEID"],
      bmp: ["FromMeasure", "FROM_MEASURE"],
      emp: ["ToMeasure", "TO_MEASURE"],
      measure: ["MEASURE"],
    },
    generic: {
      label: "Generic / many agencies",
      roadway: ["RTE_ID", "ROUTE", "ROUTE_ID", "LRS_ID", "NLFID"],
      bmp: ["BEG_MP", "FROM_MP", "BMP", "BEGIN_MP"],
      emp: ["END_MP", "TO_MP", "EMP"],
      measure: ["MEAS", "MEASURE", "MP"],
    },
  };

  Object.assign(root.LRSGuide || (root.LRSGuide = {}), {
    STEPS,
    stepForPanel,
    fieldsForPanel,
    OPTION_HELP,
    FIELD_PROFILES,
  });

})(typeof globalThis !== "undefined" ? globalThis : this);

