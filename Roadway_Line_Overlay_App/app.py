"""
Flask Web Application Server for Generalized Roadway Line-to-Line Overlay Tool.
"""

from __future__ import annotations

import io
import json
import os
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Dict

import geopandas as gpd
import pandas as pd
from flask import Flask, jsonify, render_template, request, send_file
from werkzeug.utils import secure_filename

from engine.cleaner import DataCleaner, LayerInfo, load_and_clean_layer
from engine.overlay_core import OverlayConfig, OverlayResult, RoadwayOverlayEngine

APP_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = APP_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
SAMPLE_DIR = APP_DIR / "sample_data"

app = Flask(__name__, template_folder=str(APP_DIR / "templates"), static_folder=str(APP_DIR / "static"), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100 MB max upload limit

# In-memory storage for active sessions
SESSION_STORE: Dict[str, dict] = {}


@app.after_request
def add_cors_headers(response):
    """Allow CORS for local dev tools like VS Code Live Server."""
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE"
    return response


def clean_old_sessions():
    """Prune stale session data."""
    if len(SESSION_STORE) > 20:
        SESSION_STORE.clear()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/load_sample", methods=["POST", "OPTIONS"])
def load_sample():
    """Load built-in sample target and reference datasets."""
    if request.method == "OPTIONS":
        return jsonify({"success": True})
    try:
        session_id = str(uuid.uuid4())
        target_sample_path = SAMPLE_DIR / "sample_target.geojson"
        ref_sample_path = SAMPLE_DIR / "sample_reference.geojson"

        if not target_sample_path.exists() or not ref_sample_path.exists():
            return jsonify({"success": False, "error": "Sample files not found on server."}), 404

        target_gdf, target_info, _ = load_and_clean_layer(target_sample_path, target_crs=26917)
        ref_gdf, ref_info, _ = load_and_clean_layer(ref_sample_path, target_crs=26917)

        SESSION_STORE[session_id] = {
            "target_gdf": target_gdf,
            "target_info": target_info,
            "ref_gdf": ref_gdf,
            "ref_info": ref_info,
            "result_gdf": None,
        }

        # Convert to WGS84 GeoJSON for Leaflet preview
        target_wgs84 = target_gdf.to_crs(4326)
        ref_wgs84 = ref_gdf.to_crs(4326)

        return jsonify({
            "success": True,
            "session_id": session_id,
            "target": {
                "name": "Sample Bottlenecks (Target)",
                "feature_count": target_info.feature_count,
                "multipart_count": target_info.multipart_count,
                "source_crs": target_info.source_crs,
                "columns": target_info.columns,
                "sample_data": target_info.sample_data,
                "warnings": target_info.warning_messages,
                "geojson": json.loads(target_wgs84.to_json()),
            },
            "reference": {
                "name": "Sample Work Program (Reference)",
                "feature_count": ref_info.feature_count,
                "multipart_count": ref_info.multipart_count,
                "source_crs": ref_info.source_crs,
                "columns": ref_info.columns,
                "sample_data": ref_info.sample_data,
                "warnings": ref_info.warning_messages,
                "geojson": json.loads(ref_wgs84.to_json()),
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/inspect_upload", methods=["POST", "OPTIONS"])
def inspect_upload():
    """Upload and inspect a spatial layer file (target or reference)."""
    if request.method == "OPTIONS":
        return jsonify({"success": True})

    try:
        clean_old_sessions()
        layer_role = request.form.get("role", "target")  # "target" or "reference"
        session_id = request.form.get("session_id") or str(uuid.uuid4())
        crs_input = request.form.get("crs", "26917")

        # Collect uploaded files (support single file or multi-file shapefile bundles)
        uploaded_files = []
        if "file" in request.files:
            uploaded_files = request.files.getlist("file")
        elif "files" in request.files:
            uploaded_files = request.files.getlist("files")
        elif "files[]" in request.files:
            uploaded_files = request.files.getlist("files[]")

        if not uploaded_files or uploaded_files[0].filename == "":
            return jsonify({"success": False, "error": "No file uploaded or file is empty."}), 400

        temp_dir = tempfile.mkdtemp(dir=UPLOAD_DIR)
        saved_paths = []
        primary_file = None
        primary_name = None

        for f in uploaded_files:
            fname = secure_filename(f.filename)
            if not fname:
                continue
            dest = Path(temp_dir) / fname
            f.save(dest)
            saved_paths.append(dest)
            ext = dest.suffix.lower()
            if ext in {".shp", ".geojson", ".json", ".zip", ".gpkg", ".kml", ".csv"}:
                if primary_file is None or ext in {".zip", ".shp", ".geojson"}:
                    primary_file = dest
                    primary_name = fname

        if primary_file is None:
            if saved_paths:
                primary_file = saved_paths[0]
                primary_name = primary_file.name
            else:
                return jsonify({"success": False, "error": "No valid files received."}), 400

        # Clean and load
        try:
            cleaned_gdf, layer_info, extract_temp = load_and_clean_layer(primary_file, target_crs=crs_input)
        except Exception as load_err:
            err_str = str(load_err)
            if "shx" in err_str.lower() or "dbf" in err_str.lower() or "not recognized as a supported file format" in err_str.lower():
                return jsonify({
                    "success": False,
                    "error": f"Shapefile missing companion files (.shx, .dbf). Please zip the shapefile or drag all components (.shp, .shx, .dbf, .prj) together. (Details: {err_str})"
                }), 400
            return jsonify({"success": False, "error": f"Failed to read '{primary_name}': {err_str}"}), 400

        if session_id not in SESSION_STORE:
            SESSION_STORE[session_id] = {
                "target_gdf": None,
                "target_info": None,
                "ref_gdf": None,
                "ref_info": None,
                "result_gdf": None,
            }

        if layer_role == "target":
            SESSION_STORE[session_id]["target_gdf"] = cleaned_gdf
            SESSION_STORE[session_id]["target_info"] = layer_info
        else:
            SESSION_STORE[session_id]["ref_gdf"] = cleaned_gdf
            SESSION_STORE[session_id]["ref_info"] = layer_info

        # Convert to WGS84 for map view
        wgs84_gdf = cleaned_gdf.to_crs(4326)
        geojson_data = json.loads(wgs84_gdf.to_json())

        # Cleanup upload temp directory
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
            if extract_temp:
                extract_temp.cleanup()
        except Exception:
            pass

        return jsonify({
            "success": True,
            "session_id": session_id,
            "layer_info": {
                "name": primary_name or layer_info.layer_name,
                "role": layer_role,
                "feature_count": layer_info.feature_count,
                "multipart_count": layer_info.multipart_count,
                "invalid_count": layer_info.invalid_geom_count,
                "source_crs": layer_info.source_crs,
                "target_crs": layer_info.target_crs,
                "columns": layer_info.columns,
                "sample_data": layer_info.sample_data,
                "warnings": layer_info.warning_messages,
                "geojson": geojson_data,
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/run_overlay", methods=["POST", "OPTIONS"])
def run_overlay():
    """Execute line-to-line overlay with user parameters."""
    try:
        data = request.get_json(force=True)
        session_id = data.get("session_id")

        if not session_id or session_id not in SESSION_STORE:
            return jsonify({"success": False, "error": "Invalid or expired session. Please re-upload layers."}), 400

        target_gdf = SESSION_STORE[session_id].get("target_gdf")
        ref_gdf = SESSION_STORE[session_id].get("ref_gdf")

        if target_gdf is None or ref_gdf is None:
            return jsonify({"success": False, "error": "Both Destination (Target) and Reference layers are required."}), 400

        # Build Config
        config = OverlayConfig(
            buffer_distance=float(data.get("buffer_distance", 300.0)),
            min_overlap_length=float(data.get("min_overlap_length", 300.0)),
            min_target_overlap_ratio=float(data.get("min_target_overlap_ratio", 30.0)) / 100.0,
            min_ref_overlap_ratio=float(data.get("min_ref_overlap_ratio", 50.0)) / 100.0,
            max_angle_diff_deg=float(data.get("max_angle_diff_deg", 30.0)),
            well_aligned_angle_deg=float(data.get("well_aligned_angle_deg", 15.0)),
            bearing_window_length=float(data.get("bearing_window_length", 500.0)),
            enable_strong_fallback=bool(data.get("enable_strong_fallback", True)),
            reference_columns=data.get("reference_columns", ["ITEMSEG"]),
            custom_expression_template=data.get("custom_expression_template") or None,
            column_delimiter=data.get("column_delimiter", " - "),
            keep_duplicates=bool(data.get("keep_duplicates", True)),
            distance_unit=data.get("distance_unit", "feet"),
            projected_crs=data.get("projected_crs", 26917),
        )

        engine = RoadwayOverlayEngine(config)
        result = engine.run(target_gdf, ref_gdf)

        # Store result in session
        SESSION_STORE[session_id]["result_gdf"] = result.output_gdf
        SESSION_STORE[session_id]["config"] = config

        # Convert result to WGS84 GeoJSON for Leaflet
        res_wgs84 = result.output_gdf.to_crs(4326)
        res_geojson = json.loads(res_wgs84.to_json())

        # Prepare Table Data (records)
        non_geom_cols = [c for c in result.output_gdf.columns if c != "geometry"]
        table_rows = result.output_gdf[non_geom_cols].fillna("").to_dict(orient="records")

        return jsonify({
            "success": True,
            "stats": {
                "total_targets": result.total_targets,
                "matched_targets": result.matched_targets,
                "unmatched_targets": result.unmatched_targets,
                "match_percentage": result.match_percentage,
                "duration_seconds": result.duration_seconds,
            },
            "columns": non_geom_cols,
            "table_data": table_rows,
            "geojson": res_geojson,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/export", methods=["GET", "POST"])
def export_results():
    """Download result dataset in chosen format."""
    try:
        session_id = request.args.get("session_id") or request.form.get("session_id")
        export_format = (request.args.get("format") or request.form.get("format", "shapefile")).lower()

        if not session_id or session_id not in SESSION_STORE:
            return "Invalid session", 400

        result_gdf: gpd.GeoDataFrame = SESSION_STORE[session_id].get("result_gdf")
        if result_gdf is None:
            return "No overlay results available for download", 400

        if export_format == "shapefile":
            # Package as .zip
            mem_zip = io.BytesIO()
            with tempfile.TemporaryDirectory() as tmp_dir:
                tmp_path = Path(tmp_dir)
                shp_path = tmp_path / "Roadway_Overlay_Results.shp"
                
                # Truncate field names to <= 10 chars for DBF
                export_copy = result_gdf.copy()
                rename_map = {}
                for col in export_copy.columns:
                    if col != "geometry" and len(col) > 10:
                        rename_map[col] = col[:10]
                if rename_map:
                    export_copy = export_copy.rename(columns=rename_map)

                export_copy.to_file(shp_path)

                with zipfile.ZipFile(mem_zip, "w", zipfile.ZIP_DEFLATED) as zf:
                    for f in tmp_path.glob("Roadway_Overlay_Results.*"):
                        zf.write(f, arcname=f.name)

            mem_zip.seek(0)
            return send_file(
                mem_zip,
                mimetype="application/zip",
                as_attachment=True,
                download_name="Roadway_Overlay_Results_Shapefile.zip",
            )

        elif export_format == "geojson":
            # Output WGS84 GeoJSON
            wgs84_gdf = result_gdf.to_crs(4326)
            mem_file = io.BytesIO()
            mem_file.write(wgs84_gdf.to_json().encode("utf-8"))
            mem_file.seek(0)
            return send_file(
                mem_file,
                mimetype="application/geo+json",
                as_attachment=True,
                download_name="Roadway_Overlay_Results.geojson",
            )

        elif export_format == "csv":
            mem_file = io.StringIO()
            result_gdf.drop(columns="geometry", errors="ignore").to_csv(mem_file, index=False)
            mem_bytes = io.BytesIO(mem_file.getvalue().encode("utf-8"))
            mem_bytes.seek(0)
            return send_file(
                mem_bytes,
                mimetype="text/csv",
                as_attachment=True,
                download_name="Roadway_Overlay_Results.csv",
            )

        elif export_format in {"excel", "xlsx"}:
            mem_bytes = io.BytesIO()
            with pd.ExcelWriter(mem_bytes, engine="openpyxl") as writer:
                result_gdf.drop(columns="geometry", errors="ignore").to_excel(writer, sheet_name="Overlay_Results", index=False)
            mem_bytes.seek(0)
            return send_file(
                mem_bytes,
                mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                as_attachment=True,
                download_name="Roadway_Overlay_Results.xlsx",
            )

        else:
            return f"Unsupported format '{export_format}'", 400

    except Exception as e:
        return f"Export error: {e}", 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
