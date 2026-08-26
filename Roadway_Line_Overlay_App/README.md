# GeoCorridor Studio: Generalized Roadway Line-to-Line Overlay Tool

A generalized, high-performance GIS linear corridor overlay application designed for transportation planning, project alignment, and linear referencing across non-conforming roadway networks.

---

## 🌟 Key Features

1. **Multi-Format GIS Ingestion & Data Cleaning:**
   - Supports **Zipped Shapefiles (`.zip`)**, loose `.shp`, **GeoJSON (`.geojson`)**, **KML (`.kml`)**, **GeoPackage (`.gpkg`)**, and **CSV** with WKT geometry.
   - **Multi-Part Feature Explosion:** Automatically detects `MultiLineString` geometries, explodes them into single-part `LineString` elements, and alerts the user of detected multi-part anomalies.
   - **Automated Reprojection:** Reprojects layers into standard projected metric/foot coordinate systems (default **EPSG:26917 - Florida UTM 17N** or Florida State Plane East/West).

2. **Mathematical Corridor Geometry Matching:**
   - **Undirected Bearing Calculation:** Direction-agnostic angle calculation ($[0^\circ, 90^\circ]$) resolves opposing digitizing directions (e.g. EB vs WB or Southbound digitized pointing North).
   - **Localized Substring Sampling:** Computes bearings over a localized 500 ft window centered on the overlap midpoint to handle curved corridors and freeway interchanges.
   - **Strong Parallel Fallback:** Automatically retains segments with $\ge 75\%$ overlap and $\le 30\text{ ft}$ distance even around tight curves.

3. **Dynamic Composite Expression Builder & Multi-Match Modes:**
   - Concatenate multiple attributes into composite tags: e.g. `{ITEMSEG} - {high_yr_ph}` $\rightarrow$ `4425211 - CON 2026`.
   - **Duplicate Retention Mode (Default):** Preserves every overlapping occurrence (e.g. `WP 1235, WP 1235, WP 4432`).
   - **Deduplication Mode:** Collapses identical tags into unique IDs sorted by overlap length.

4. **Modern Interactive Web UI & Headless CLI:**
   - Interactive **Leaflet.js Map Viewer** with synchronized popup inspection.
   - Searchable, filterable **Data Table**.
   - One-click export to **Shapefile (.zip)**, **GeoJSON**, **CSV**, and **Excel (.xlsx)**.
   - 1-click Windows launcher (`run_app.bat`).

---

## 🚀 How to Run

### Method 1: 1-Click Launch (Windows)
Double-click `run_app.bat` in this folder. It will start the server and open your default browser at `http://127.0.0.1:5000`.

### Method 2: Python Command Line Web Server
```bash
cd Roadway_Line_Overlay_App
python app.py
```
Open `http://127.0.0.1:5000` in your web browser.

### Method 3: Headless CLI for Batch Automation
```bash
python cli.py \
  --target sample_data/sample_target.geojson \
  --reference sample_data/sample_reference.geojson \
  --ref-cols ITEMSEG high_yr_ph \
  --expr "{ITEMSEG} - {high_yr_ph}" \
  --buffer 300 \
  --min-overlap 300 \
  --output output/results.shp
```

---

## 📐 Output Attribute Schema

| Field Name | Shapefile DBF Header | Type | Description |
|:---|:---|:---:|:---|
| `Match_Status` | `Match_Stat` | String(15) | `"On Corridor"` or `"Off Corridor"` |
| `Matched_IDs` | `Matched_ID` | String(254) | Comma-separated list of matching reference IDs/expressions |
| `Match_Count` | `Match_Cnt` | Integer | Total number of matching reference segments |
| `Ovl_Length_Ft` | `Ovl_Ft` | Float(10,1) | Total combined overlap length (feet) |
| `Ovl_Ratio_Pct` | `Ovl_Pct` | Float(6,1) | Overlap length as % of target segment length |
| `Min_Dist_Ft` | `Min_Ft` | Float(10,1) | Minimum perpendicular distance to reference linework (feet) |
| `Ang_Diff_Deg` | `Ang_Dif` | Float(6,1) | Undirected bearing difference in degrees ($0^\circ - 90^\circ$) |
| `QC_Flag` | `QC_Flag` | String(25) | Quality flag: `"Verified Match"`, `"Borderline Overlap %"`, `"Borderline Angle"`, `"No Match"` |

---

## 🔬 Directionality Quality Note & Roadmap

In standard public agency roadway GIS layers, linework digitizing direction is often unstandardized (e.g. Southbound dual carriageway digitized in the Northward direction). The current version uses **undirected bearing difference** to ensure maximum recall. In future versions, an optional strict **Directed Travel Mode** can be enabled for datasets with validated travel direction attributes.
