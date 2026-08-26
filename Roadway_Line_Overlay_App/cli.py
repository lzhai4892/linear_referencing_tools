"""
Command-Line Interface for Batch Headless Roadway Line-to-Line Overlay.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from engine.cleaner import load_and_clean_layer
from engine.overlay_core import OverlayConfig, RoadwayOverlayEngine


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generalized Roadway Line-to-Line Corridor Overlay Tool",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--target", "-t", required=True, help="Path to destination/target line layer (.shp, .zip, .geojson, .csv)")
    parser.add_argument("--reference", "-r", required=True, help="Path to reference roadway line layer (.shp, .zip, .geojson, .csv)")
    parser.add_argument("--output", "-o", required=True, help="Path for output deliverable (.shp, .geojson, .csv, .xlsx)")
    
    # ID Expression options
    parser.add_argument("--ref-cols", nargs="+", default=["ITEMSEG"], help="Reference columns to extract or concatenate")
    parser.add_argument("--expr", default=None, help="Custom concatenation template expression, e.g. '{ITEMSEG} - {high_yr_ph}'")
    parser.add_argument("--delimiter", default=" - ", help="Delimiter between reference columns")
    parser.add_argument("--deduplicate", action="store_true", help="Collapse duplicate match tags into unique IDs")
    
    # Geometry & Matching Parameters
    parser.add_argument("--buffer", type=float, default=300.0, help="Corridor buffer distance (ft or m)")
    parser.add_argument("--min-overlap", type=float, default=300.0, help="Minimum overlap length (ft or m)")
    parser.add_argument("--min-ratio", type=float, default=0.30, help="Minimum target segment overlap ratio (0.0 - 1.0)")
    parser.add_argument("--max-angle", type=float, default=30.0, help="Maximum local bearing difference in degrees")
    parser.add_argument("--crs", default=26917, help="Projected EPSG code (e.g. 26917 for Florida UTM 17N)")
    parser.add_argument("--unit", choices=["feet", "meters"], default="feet", help="Distance measurement unit")

    return parser.parse_args()


def main():
    args = parse_args()

    target_path = Path(args.target)
    ref_path = Path(args.reference)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print("=" * 70)
    print("ROADWAY LINE-TO-LINE GIS CORRIDOR OVERLAY")
    print("=" * 70)

    # 1. Load and clean target
    print(f"[1/4] Loading and cleaning Target Layer: {target_path.name}...")
    target_gdf, target_info, target_temp = load_and_clean_layer(target_path, target_crs=args.crs)
    for msg in target_info.warning_messages:
        print(f"      * {msg}")
    print(f"      Loaded {len(target_gdf)} target segments (Source CRS: {target_info.source_crs})")

    # 2. Load and clean reference
    print(f"[2/4] Loading and cleaning Reference Layer: {ref_path.name}...")
    ref_gdf, ref_info, ref_temp = load_and_clean_layer(ref_path, target_crs=args.crs)
    for msg in ref_info.warning_messages:
        print(f"      * {msg}")
    print(f"      Loaded {len(ref_gdf)} reference segments (Source CRS: {ref_info.source_crs})")

    # 3. Configure Engine
    config = OverlayConfig(
        buffer_distance=args.buffer,
        min_overlap_length=args.min_overlap,
        min_target_overlap_ratio=args.min_ratio,
        max_angle_diff_deg=args.max_angle,
        reference_columns=args.ref_cols,
        custom_expression_template=args.expr,
        column_delimiter=args.delimiter,
        keep_duplicates=not args.deduplicate,
        distance_unit=args.unit,
        projected_crs=args.crs,
    )
    engine = RoadwayOverlayEngine(config)

    # 4. Run Overlay
    print(f"[3/4] Running corridor matching algorithm...")
    def log_progress(pct, msg):
        print(f"      [{pct:3d}%] {msg}")

    result = engine.run(target_gdf, ref_gdf, progress_callback=log_progress)

    # 5. Export Deliverable
    print(f"[4/4] Exporting results to: {output_path}...")
    out_ext = output_path.suffix.lower()
    if out_ext == ".shp":
        result.output_gdf.to_file(output_path)
    elif out_ext in {".geojson", ".json"}:
        result.output_gdf.to_file(output_path, driver="GeoJSON")
    elif out_ext == ".csv":
        result.output_gdf.drop(columns="geometry", errors="ignore").to_csv(output_path, index=False)
    elif out_ext in {".xlsx", ".xls"}:
        result.output_gdf.drop(columns="geometry", errors="ignore").to_excel(output_path, index=False)
    else:
        result.output_gdf.to_file(output_path)

    print("-" * 70)
    print(f"Summary Statistics:")
    print(f"  Total Targets:      {result.total_targets}")
    print(f"  Matched (On Corridor): {result.matched_targets} ({result.match_percentage}%)")
    print(f"  Unmatched:          {result.unmatched_targets}")
    print(f"  Duration:           {result.duration_seconds}s")
    print("=" * 70)

    # Clean up temp directories
    if target_temp:
        target_temp.cleanup()
    if ref_temp:
        ref_temp.cleanup()


if __name__ == "__main__":
    main()
