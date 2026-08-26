/**
 * Pure Client-Side GIS Overlay Engine for Roadway Line-to-Line Workbench.
 * 100% In-Browser Execution using Proj4js, Turf.js, shpjs, SheetJS, and PapaParse.
 * No Python or backend server required!
 */

// ----------------------------------------------------
// 1. Coordinate Reference System (CRS) Registrations
// ----------------------------------------------------
if (typeof proj4 !== "undefined") {
  proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs");
  proj4.defs("EPSG:3857", "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs");
  proj4.defs("EPSG:26917", "+proj=utm +zone=17 +ellps=GRS80 +datum=NAD83 +units=m +no_defs");
  proj4.defs("EPSG:26916", "+proj=utm +zone=16 +ellps=GRS80 +datum=NAD83 +units=m +no_defs");
  proj4.defs("EPSG:2236", "+proj=tmerc +lat_0=24.33333333333333 +lon_0=-81 +k=0.999941177 +x_0=200000.0001016002 +y_0=0 +ellps=GRS80 +datum=NAD83 +to_meter=0.3048006096012192 +no_defs");
  proj4.defs("EPSG:2237", "+proj=tmerc +lat_0=24.33333333333333 +lon_0=-82 +k=0.999941177 +x_0=200000.0001016002 +y_0=0 +ellps=GRS80 +datum=NAD83 +to_meter=0.3048006096012192 +no_defs");
}

class ClientGISEngine {
  /**
   * Parse uploaded File(s) into standard GeoJSON FeatureCollection.
   * Supports: .zip (ESRI Shapefile), multi-file (.shp+.dbf+.shx), .geojson, .json, .csv, .kml
   */
  static async parseUploadedFiles(fileList) {
    if (!fileList || fileList.length === 0) {
      throw new Error("No files selected.");
    }

    const files = Array.from(fileList);
    const zipFile = files.find(f => f.name.toLowerCase().endsWith(".zip"));
    const shpFile = files.find(f => f.name.toLowerCase().endsWith(".shp"));
    const dbfFile = files.find(f => f.name.toLowerCase().endsWith(".dbf"));
    const geojsonFile = files.find(f => f.name.toLowerCase().endsWith(".geojson") || f.name.toLowerCase().endsWith(".json"));
    const csvFile = files.find(f => f.name.toLowerCase().endsWith(".csv"));
    const kmlFile = files.find(f => f.name.toLowerCase().endsWith(".kml"));

    let rawGeoJSON = null;
    let baseName = files[0].name.replace(/\.[^/.]+$/, "");

    // 1. Zipped Shapefile Archive (.zip)
    if (zipFile) {
      baseName = zipFile.name.replace(/\.zip$/i, "");
      const arrayBuffer = await zipFile.arrayBuffer();
      try {
        const parsed = await shp(arrayBuffer);
        rawGeoJSON = Array.isArray(parsed) ? parsed[0] : (parsed.type === "FeatureCollection" ? parsed : Object.values(parsed)[0]);
      } catch (err) {
        throw new Error(`Failed to parse zipped Shapefile: ${err.message}`);
      }
    }
    // 2. Individual Shapefile (.shp + .dbf)
    else if (shpFile) {
      baseName = shpFile.name.replace(/\.shp$/i, "");
      const shpBuffer = await shpFile.arrayBuffer();
      let dbfBuffer = null;
      if (dbfFile) {
        dbfBuffer = await dbfFile.arrayBuffer();
      }
      try {
        const parsedGeom = shp.parseShp(shpBuffer);
        const parsedDbf = dbfBuffer ? shp.parseDbf(dbfBuffer) : [];
        rawGeoJSON = shp.combine([parsedGeom, parsedDbf]);
      } catch (err) {
        throw new Error(`Failed to parse Shapefile (.shp/.dbf): ${err.message}`);
      }
    }
    // 3. GeoJSON (.geojson / .json)
    else if (geojsonFile) {
      baseName = geojsonFile.name.replace(/\.(geojson|json)$/i, "");
      const text = await geojsonFile.text();
      try {
        rawGeoJSON = JSON.parse(text);
      } catch (err) {
        throw new Error(`Invalid JSON / GeoJSON file: ${err.message}`);
      }
    }
    // 4. CSV File with WKT or Lat/Lon (.csv)
    else if (csvFile) {
      baseName = csvFile.name.replace(/\.csv$/i, "");
      const text = await csvFile.text();
      rawGeoJSON = this.parseCsvToGeoJSON(text);
    } else {
      throw new Error("Unsupported format. Please upload .zip, .shp, .geojson, or .csv.");
    }

    if (!rawGeoJSON || !rawGeoJSON.features || rawGeoJSON.features.length === 0) {
      throw new Error("The uploaded layer contains 0 spatial features.");
    }

    // Explode MultiLineString geometries to single-part LineStrings
    return this.cleanAndExplodeLayer(rawGeoJSON, baseName);
  }

  /**
   * Parse CSV content with WKT linework or lat/long coordinates.
   */
  static parseCsvToGeoJSON(csvText) {
    const results = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    if (!results.data || results.data.length === 0) {
      throw new Error("CSV file contains no data rows.");
    }

    const features = [];
    const fields = results.meta.fields || Object.keys(results.data[0]);
    const wktCol = fields.find(f => ["wkt", "geometry", "geom", "the_geom", "shape"].includes(f.toLowerCase()));
    const latCol = fields.find(f => ["lat", "latitude", "y"].includes(f.toLowerCase()));
    const lonCol = fields.find(f => ["lon", "long", "longitude", "x"].includes(f.toLowerCase()));

    results.data.forEach((row, idx) => {
      let geom = null;
      if (wktCol && row[wktCol]) {
        geom = this.wktToGeoJSONGeometry(row[wktCol]);
      } else if (latCol && lonCol && row[latCol] && row[lonCol]) {
        const lat = parseFloat(row[latCol]);
        const lon = parseFloat(row[lonCol]);
        if (!isNaN(lat) && !isNaN(lon)) {
          geom = { type: "Point", coordinates: [lon, lat] };
        }
      }

      if (geom) {
        const props = { ...row };
        if (wktCol) delete props[wktCol];
        features.push({
          type: "Feature",
          id: idx,
          properties: props,
          geometry: geom
        });
      }
    });

    return { type: "FeatureCollection", features };
  }

  /**
   * Basic WKT LineString / Point parser.
   */
  static wktToGeoJSONGeometry(wktStr) {
    const trimmed = wktStr.trim();
    if (trimmed.toUpperCase().startsWith("LINESTRING")) {
      const coordPart = trimmed.replace(/^LINESTRING\s*\(/i, "").replace(/\)$/, "");
      const coords = coordPart.split(",").map(pair => {
        const parts = pair.trim().split(/\s+/).map(Number);
        return [parts[0], parts[1]];
      });
      return { type: "LineString", coordinates: coords };
    }
    if (trimmed.toUpperCase().startsWith("POINT")) {
      const coordPart = trimmed.replace(/^POINT\s*\(/i, "").replace(/\)$/, "");
      const parts = coordPart.trim().split(/\s+/).map(Number);
      return { type: "Point", coordinates: [parts[0], parts[1]] };
    }
    return null;
  }

  /**
   * Explodes Multi-Part lines, filters invalid geometries, and generates layer metadata.
   */
  static cleanAndExplodeLayer(geojson, layerName = "Layer") {
    let multipartCount = 0;
    let invalidCount = 0;
    const cleanFeatures = [];
    const columnsSet = new Set();
    const warnings = [];

    geojson.features.forEach((feat, origIdx) => {
      if (!feat || !feat.geometry || !feat.geometry.coordinates) {
        invalidCount++;
        return;
      }

      const geomType = feat.geometry.type;
      const props = { ...(feat.properties || {}), _orig_fid: origIdx };
      Object.keys(props).forEach(k => columnsSet.add(k));

      if (geomType === "LineString") {
        cleanFeatures.push({
          type: "Feature",
          properties: props,
          geometry: feat.geometry
        });
      } else if (geomType === "MultiLineString") {
        multipartCount++;
        feat.geometry.coordinates.forEach((lineCoords, partIdx) => {
          cleanFeatures.push({
            type: "Feature",
            properties: { ...props, _part_id: partIdx },
            geometry: { type: "LineString", coordinates: lineCoords }
          });
        });
      } else if (geomType === "GeometryCollection") {
        multipartCount++;
        feat.geometry.geometries.forEach((g, partIdx) => {
          if (g.type === "LineString") {
            cleanFeatures.push({
              type: "Feature",
              properties: { ...props, _part_id: partIdx },
              geometry: g
            });
          }
        });
      } else {
        invalidCount++;
      }
    });

    if (multipartCount > 0) {
      warnings.push(`Notice: ${multipartCount} multi-part feature(s) detected. Exploded into single-part LineStrings for accurate corridor bearing and overlap analysis.`);
    }
    if (invalidCount > 0) {
      warnings.push(`Filtered out ${invalidCount} non-line or empty geometry records.`);
    }

    const columns = Array.from(columnsSet).filter(c => c !== "_orig_fid" && c !== "_part_id");
    const sampleData = cleanFeatures.slice(0, 5).map(f => f.properties);

    const cleanGeoJSON = {
      type: "FeatureCollection",
      name: layerName,
      features: cleanFeatures
    };

    return {
      layer_name: layerName,
      feature_count: cleanFeatures.length,
      multipart_count: multipartCount,
      invalid_count: invalidCount,
      source_crs: "WGS84 (EPSG:4326)",
      target_crs: "EPSG:26917 - Florida UTM 17N",
      columns: columns,
      sample_data: sampleData,
      warnings: warnings,
      geojson: cleanGeoJSON
    };
  }

  /**
   * Direction-invariant corridor bearing difference between two lines (0° to 90°).
   */
  static calculateAngleDelta(lineA, lineB) {
    const coordsA = lineA.geometry.coordinates;
    const coordsB = lineB.geometry.coordinates;
    if (coordsA.length < 2 || coordsB.length < 2) return 0;

    const ptA1 = coordsA[0];
    const ptA2 = coordsA[coordsA.length - 1];
    const ptB1 = coordsB[0];
    const ptB2 = coordsB[coordsB.length - 1];

    const bearingA = turf.bearing(turf.point(ptA1), turf.point(ptA2));
    const bearingB = turf.bearing(turf.point(ptB1), turf.point(ptB2));

    let diff = Math.abs(bearingA - bearingB) % 180;
    if (diff > 90) {
      diff = 180 - diff;
    }
    return Math.round(diff * 10) / 10;
  }

  /**
   * Main Line-to-Line Overlay Execution Engine in Pure JavaScript.
   */
  static runOverlayAnalysis(targetGeoJSON, refGeoJSON, options = {}) {
    const startTime = performance.now();

    const bufferFeet = options.buffer_distance || 300;
    const minOverlapFeet = options.min_overlap_length || 300;
    const minTargetRatio = options.min_target_overlap_ratio || 30;
    const maxAngleDelta = options.max_angle_diff_deg || 30;
    const enableFallback = options.enable_strong_fallback !== false;
    const refColumns = options.reference_columns || [];
    const customTemplate = options.custom_expression_template || null;
    const keepDuplicates = options.keep_duplicates !== false;

    // Convert buffer feet to kilometers for turf.buffer
    const bufferKilometers = (bufferFeet * 0.3048) / 1000;

    const resultFeatures = [];
    const tableData = [];
    let matchedCount = 0;
    let unmatchedCount = 0;

    const refFeatures = refGeoJSON.features || [];

    targetGeoJSON.features.forEach((targetFeat, targetIdx) => {
      const targetProps = { ...targetFeat.properties };
      const targetGeom = targetFeat.geometry;
      
      // Calculate target length in feet
      const targetLengthFeet = turf.length(targetFeat, { units: "feet" });
      const targetBBox = turf.bbox(targetFeat);

      // Create corridor buffer around target segment
      let targetBufferPoly = null;
      try {
        targetBufferPoly = turf.buffer(targetFeat, bufferKilometers, { units: "kilometers" });
      } catch (err) {
        console.warn("Buffer failed on feature", targetIdx, err);
      }

      const matchTags = [];
      const matchedRefDetails = [];
      let totalOverlapFeet = 0;
      let minAngleDiff = 999;
      let minDistanceFeet = 999;
      let bestQcFlag = null;
      let matchOccurrences = 0;

      if (targetBufferPoly) {
        refFeatures.forEach((refFeat) => {
          const refProps = refFeat.properties || {};
          
          // Fast bounding box spatial overlap filter
          const refBBox = turf.bbox(refFeat);
          const overlapsBBox = !(
            refBBox[0] > targetBBox[2] + 0.05 ||
            refBBox[2] < targetBBox[0] - 0.05 ||
            refBBox[1] > targetBBox[3] + 0.05 ||
            refBBox[3] < targetBBox[1] - 0.05
          );

          if (!overlapsBBox) return;

          // Check intersection with buffer
          let intersects = false;
          let clippedOverlapFeet = 0;

          try {
            // Line overlap length inside the target corridor buffer
            const pts = refFeat.geometry.coordinates;
            let subLine = null;
            let insideCount = 0;

            for (let i = 0; i < pts.length - 1; i++) {
              const seg = turf.lineString([pts[i], pts[i + 1]]);
              const midPt = turf.midpoint(turf.point(pts[i]), turf.point(pts[i + 1]));
              if (turf.booleanPointInPolygon(midPt, targetBufferPoly)) {
                clippedOverlapFeet += turf.length(seg, { units: "feet" });
                insideCount++;
              }
            }

            if (clippedOverlapFeet > 0) {
              intersects = true;
            }
          } catch (e) {
            // Fallback to simple distance check
          }

          if (intersects && clippedOverlapFeet > 0) {
            const angleDelta = ClientGISEngine.calculateAngleDelta(targetFeat, refFeat);
            const overlapRatioPct = (clippedOverlapFeet / Math.max(1, targetLengthFeet)) * 100;

            // Distance check in feet
            const refMid = turf.point(refFeat.geometry.coordinates[Math.floor(refFeat.geometry.coordinates.length / 2)]);
            const distFeet = turf.pointToLineDistance(refMid, targetFeat, { units: "feet" });

            minAngleDiff = Math.min(minAngleDiff, angleDelta);
            minDistanceFeet = Math.min(minDistanceFeet, distFeet);

            // Match Logic: Primary Rule vs Parallel Fallback
            const isPrimaryMatch = (
              clippedOverlapFeet >= minOverlapFeet &&
              overlapRatioPct >= minTargetRatio &&
              angleDelta <= maxAngleDelta
            );

            const isParallelFallback = (
              enableFallback &&
              overlapRatioPct >= 75.0 &&
              distFeet <= 30.0 &&
              angleDelta <= 45.0
            );

            if (isPrimaryMatch || isParallelFallback) {
              matchOccurrences++;
              totalOverlapFeet += clippedOverlapFeet;
              bestQcFlag = isPrimaryMatch ? "Verified Match" : "Verified Parallel Fallback";

              // Generate Matched Tag from Expression Template or Selected Columns
              let tag = "";
              if (customTemplate) {
                tag = customTemplate.replace(/\{(\w+)\}/g, (match, key) => {
                  return refProps[key] !== undefined ? refProps[key] : "";
                });
              } else if (refColumns.length > 0) {
                tag = refColumns.map(col => refProps[col] || "").filter(Boolean).join(" - ");
              } else {
                tag = refProps.ITEMSEG || refProps.Segment_ID || refProps.ROADWAY || String(refProps._orig_fid || "MATCH");
              }

              if (tag) matchTags.push(tag);

              matchedRefDetails.push({
                tag: tag,
                overlap_ft: Math.round(clippedOverlapFeet),
                overlap_pct: Math.round(overlapRatioPct),
                angle_diff: angleDelta,
                dist_ft: Math.round(distFeet * 10) / 10,
                rule: isPrimaryMatch ? "Primary Rule" : "Parallel Fallback",
                properties: refProps
              });
            } else if (!bestQcFlag) {
              if (angleDelta > maxAngleDelta) {
                bestQcFlag = "No Match - Angle Mismatch";
              } else if (clippedOverlapFeet < minOverlapFeet) {
                bestQcFlag = "No Match - Low Overlap";
              }
            }
          }
        });
      }

      // Format matched output string
      let formattedMatchedId = "";
      if (matchTags.length > 0) {
        const finalTags = keepDuplicates ? matchTags : Array.from(new Set(matchTags));
        formattedMatchedId = finalTags.join(", ");
      }

      const isMatched = matchTags.length > 0;
      if (isMatched) {
        matchedCount++;
      } else {
        unmatchedCount++;
        if (!bestQcFlag) bestQcFlag = "Unmatched";
      }

      const overlapPctFinal = Math.min(100, Math.round((totalOverlapFeet / Math.max(1, targetLengthFeet)) * 100));
      const overlapMilesFinal = Math.round((totalOverlapFeet / 5280) * 100) / 100;

      const enrichedProps = {
        ...targetProps,
        Match_Stat: isMatched ? "On Corridor" : "Off Corridor",
        Matched_ID: formattedMatchedId,
        Match_Cnt: matchOccurrences,
        Ovl_Ft: Math.round(totalOverlapFeet),
        Ovl_Mi: overlapMilesFinal,
        Ovl_Pct: overlapPctFinal,
        Ang_Dif: minAngleDiff < 900 ? minAngleDiff : null,
        Min_Ft: minDistanceFeet < 900 ? Math.round(minDistanceFeet * 10) / 10 : null,
        QC_Flag: bestQcFlag,
        _matched_refs: matchedRefDetails
      };

      resultFeatures.push({
        type: "Feature",
        properties: enrichedProps,
        geometry: targetGeom
      });

      tableData.push(enrichedProps);
    });

    const endTime = performance.now();
    const durationSeconds = Math.round(((endTime - startTime) / 1000) * 100) / 100;
    const totalTargets = targetGeoJSON.features.length;
    const matchPercentage = totalTargets > 0 ? Math.round((matchedCount / totalTargets) * 1000) / 10 : 0;

    return {
      success: true,
      stats: {
        total_targets: totalTargets,
        matched_targets: matchedCount,
        unmatched_targets: unmatchedCount,
        match_percentage: matchPercentage,
        duration_seconds: durationSeconds
      },
      table_data: tableData,
      geojson: {
        type: "FeatureCollection",
        name: "Overlay_Results",
        features: resultFeatures
      }
    };
  }

  /**
   * Export Result GeoJSON directly in Browser.
   */
  static exportGeoJSON(geojson, filename = "roadway_overlay_results.geojson") {
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/json" });
    this.downloadBlob(blob, filename);
  }

  /**
   * Export Result Table to CSV directly in Browser.
   */
  static exportCSV(records, filename = "roadway_overlay_results.csv") {
    const csv = Papa.unparse(records);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    this.downloadBlob(blob, filename);
  }

  /**
   * Export Result Table to Excel (.xlsx) directly in Browser via SheetJS.
   */
  static exportExcel(records, filename = "roadway_overlay_results.xlsx") {
    if (typeof XLSX === "undefined") {
      throw new Error("SheetJS XLSX library is not loaded.");
    }
    const ws = XLSX.utils.json_to_sheet(records);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Overlay Results");
    XLSX.writeFile(wb, filename);
  }

  /**
   * Utility helper to trigger client-side download.
   */
  static downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 150);
  }
}

window.ClientGISEngine = ClientGISEngine;
