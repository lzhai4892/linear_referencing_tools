"""
Main Roadway Line-to-Line Corridor Overlay Execution Engine.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union
from shapely.strtree import STRtree

from .corridor_math import (
    FEET_TO_METERS,
    METERS_TO_FEET,
    compute_segment_metrics,
)


@dataclass
class OverlayConfig:
    """Configuration parameters for the line-to-line overlay analysis."""

    # Corridor geometric matching thresholds
    buffer_distance: float = 300.0  # in distance_unit (default feet)
    min_overlap_length: float = 300.0  # in distance_unit (default feet)
    min_target_overlap_ratio: float = 0.30  # 30%
    min_ref_overlap_ratio: float = 0.50  # 50%
    max_angle_diff_deg: float = 30.0  # degrees
    well_aligned_angle_deg: float = 15.0  # degrees (accepted even if shallow)
    bearing_window_length: float = 500.0  # in distance_unit (default feet)

    # Strong parallel fallback
    enable_strong_fallback: bool = True
    strong_overlap_ratio: float = 0.75  # 75%
    strong_max_distance: float = 30.0  # in distance_unit (default feet)

    # Reference attribute extraction
    reference_columns: List[str] = field(default_factory=lambda: ["ITEMSEG"])
    custom_expression_template: Optional[str] = None  # e.g. "{ITEMSEG} - {high_yr_ph}"
    column_delimiter: str = " - "

    # Multi-match handling
    keep_duplicates: bool = True  # True: list every matching occurrence (e.g. WP 1235, WP 1235, WP 4432)
    max_matches_in_cell: int = 50

    # Units and CRS
    distance_unit: str = "feet"  # 'feet' or 'meters'
    projected_crs: int | str = 26917  # NAD83 / UTM Zone 17N (meters)

    # Output field prefix
    output_prefix: str = ""  # e.g., "WP_" or "SIS_" if desired


@dataclass
class OverlayResult:
    """Result summary and enriched GeoDataFrame from overlay execution."""

    output_gdf: gpd.GeoDataFrame
    total_targets: int
    matched_targets: int
    unmatched_targets: int
    match_percentage: float
    total_reference_features: int
    duration_seconds: float
    summary_stats: Dict[str, Any] = field(default_factory=dict)


class RoadwayOverlayEngine:
    """Executes the line-to-line spatial overlay between target and reference layers."""

    def __init__(self, config: Optional[OverlayConfig] = None):
        self.config = config or OverlayConfig()

    def format_reference_tag(self, row: pd.Series) -> str:
        """Format the output ID/label for a matching reference segment."""
        # 1. Custom expression template (e.g. "{ITEMSEG} - {high_yr_ph}")
        if self.config.custom_expression_template:
            template = self.config.custom_expression_template
            # Find all {col_name} placeholders
            placeholders = re.findall(r"\{([^}]+)\}", template)
            formatted = template
            for col in placeholders:
                val = row.get(col, "")
                val_str = self._clean_field_value(val)
                formatted = formatted.replace(f"{{{col}}}", val_str)
            return formatted.strip(" -:,_")

        # 2. Multi-column list
        if self.config.reference_columns:
            parts = []
            for col in self.config.reference_columns:
                val = row.get(col, "")
                val_str = self._clean_field_value(val)
                if val_str:
                    parts.append(val_str)
            return self.config.column_delimiter.join(parts)

        return ""

    @staticmethod
    def _clean_field_value(val: Any) -> str:
        """Normalize numeric/text field values for display."""
        if val is None or pd.isna(val):
            return ""
        if isinstance(val, float):
            if math.isnan(val):
                return ""
            if val.is_integer():
                return str(int(val))
            return f"{val:.2f}"
        if isinstance(val, int):
            return str(val)
        return str(val).strip()

    def run(
        self,
        target_gdf: gpd.GeoDataFrame,
        reference_gdf: gpd.GeoDataFrame,
        progress_callback: Optional[Callable[[int, str], None]] = None,
    ) -> OverlayResult:
        """
        Execute line-to-line corridor matching.
        target_gdf: Destination layer receiving attributes.
        reference_gdf: Reference roadway features.
        """
        import time
        start_time = time.time()

        if progress_callback:
            progress_callback(5, "Initializing spatial parameters and CRS...")

        # 1. Coordinate conversion factors
        # If CRS is metric (e.g. UTM Zone 17N meters) and config is feet:
        unit_to_crs_scale = FEET_TO_METERS if self.config.distance_unit == "feet" else 1.0
        crs_to_unit_scale = METERS_TO_FEET if self.config.distance_unit == "feet" else 1.0

        buffer_crs = self.config.buffer_distance * unit_to_crs_scale
        min_overlap_crs = self.config.min_overlap_length * unit_to_crs_scale
        bearing_window_crs = self.config.bearing_window_length * unit_to_crs_scale
        strong_dist_crs = self.config.strong_max_distance * unit_to_crs_scale

        # Ensure both are in projected CRS
        target_proj = (
            target_gdf if str(target_gdf.crs) == str(self.config.projected_crs)
            else target_gdf.to_crs(self.config.projected_crs)
        )
        ref_proj = (
            reference_gdf if str(reference_gdf.crs) == str(self.config.projected_crs)
            else reference_gdf.to_crs(self.config.projected_crs)
        )

        if progress_callback:
            progress_callback(15, "Building reference layer spatial index...")

        ref_geoms = list(ref_proj.geometry)
        ref_tree = STRtree(ref_geoms)

        total_targets = len(target_proj)
        matched_tags_col: List[str] = []
        match_count_col: List[int] = []
        match_status_col: List[str] = []
        ovl_length_col: List[float] = []
        ovl_ratio_col: List[float] = []
        min_dist_col: List[float] = []
        ang_diff_col: List[float] = []
        qc_flag_col: List[str] = []

        if progress_callback:
            progress_callback(20, f"Evaluating corridor overlay across {total_targets} target segments...")

        for idx, target_geom in enumerate(target_proj.geometry):
            if idx % max(1, total_targets // 20) == 0 and progress_callback:
                pct = 20 + int((idx / total_targets) * 70)
                progress_callback(pct, f"Processing target segment {idx + 1} of {total_targets}...")

            if target_geom is None or target_geom.is_empty or target_geom.length <= 0:
                matched_tags_col.append("")
                match_count_col.append(0)
                match_status_col.append("Off Corridor")
                ovl_length_col.append(0.0)
                ovl_ratio_col.append(0.0)
                min_dist_col.append(float("nan"))
                ang_diff_col.append(float("nan"))
                qc_flag_col.append("Invalid Geometry")
                continue

            target_len = target_geom.length
            # Query candidate reference lines within search buffer
            candidates = ref_tree.query(target_geom.buffer(buffer_crs))

            if len(candidates) == 0:
                matched_tags_col.append("")
                match_count_col.append(0)
                match_status_col.append("Off Corridor")
                ovl_length_col.append(0.0)
                ovl_ratio_col.append(0.0)
                min_dist_col.append(float("nan"))
                ang_diff_col.append(float("nan"))
                qc_flag_col.append("No Match")
                continue

            # Evaluate each candidate
            matches_for_target: List[Tuple[float, str, float, float, float]] = []
            qualifying_overlap_geoms = []
            best_angle_diff = 999.0
            overall_min_dist = float("inf")

            for c_idx in candidates:
                c_idx_int = int(c_idx)
                ref_geom = ref_geoms[c_idx_int]
                ref_row = ref_proj.iloc[c_idx_int]

                metrics = compute_segment_metrics(
                    target_geom=target_geom,
                    ref_geom=ref_geom,
                    buffer_distance=buffer_crs,
                    bearing_window=bearing_window_crs,
                )

                if not metrics["has_intersection"]:
                    continue

                overlap_len = metrics["overlap_length"]
                target_ratio = metrics["target_ratio"]
                ref_ratio = metrics["ref_ratio"]
                min_dist = metrics["min_distance"]
                angle_diff = metrics["angle_diff"]

                overall_min_dist = min(overall_min_dist, min_dist)
                if angle_diff < best_angle_diff:
                    best_angle_diff = angle_diff

                # Classification Decision
                is_match = False
                if overlap_len >= min_overlap_crs:
                    # Condition 1: Well aligned (<= 15 deg)
                    if angle_diff <= self.config.well_aligned_angle_deg:
                        is_match = True
                    # Condition 2: Moderately angled (<= 30 deg) with significant coverage
                    elif (
                        angle_diff <= self.config.max_angle_diff_deg
                        and (
                            target_ratio >= self.config.min_target_overlap_ratio
                            or ref_ratio >= self.config.min_ref_overlap_ratio
                        )
                    ):
                        is_match = True
                    # Condition 3: Strong parallel fallback
                    elif (
                        self.config.enable_strong_fallback
                        and target_ratio >= self.config.strong_overlap_ratio
                        and min_dist <= strong_dist_crs
                    ):
                        is_match = True

                if is_match:
                    tag = self.format_reference_tag(ref_row)
                    if tag:
                        matches_for_target.append((overlap_len, tag, target_ratio, min_dist, angle_diff))
                        qualifying_overlap_geoms.append(metrics["overlap_geom"])

            # Post-process matches for this target segment
            if matches_for_target:
                # Sort matches by overlap length descending
                matches_for_target.sort(key=lambda x: x[0], reverse=True)

                if self.config.keep_duplicates:
                    # Preserve all duplicate occurrences (e.g. WP 1235, WP 1235, WP 4432)
                    ordered_tags = [m[1] for m in matches_for_target[: self.config.max_matches_in_cell]]
                else:
                    # Deduplicate unique values
                    seen = set()
                    ordered_tags = []
                    for m in matches_for_target:
                        if m[1] not in seen:
                            seen.add(m[1])
                            ordered_tags.append(m[1])
                        if len(ordered_tags) >= self.config.max_matches_in_cell:
                            break

                # Combine qualifying overlap geometries to compute true non-duplicate overlap length
                union_overlap = unary_union(qualifying_overlap_geoms)
                total_ovl_len = union_overlap.length if union_overlap else 0.0
                total_ovl_ratio = min(1.0, total_ovl_len / target_len) if target_len > 0 else 0.0

                matched_tags_col.append(", ".join(ordered_tags))
                match_count_col.append(len(matches_for_target))
                match_status_col.append("On Corridor")
                ovl_length_col.append(round(total_ovl_len * crs_to_unit_scale, 1))
                ovl_ratio_col.append(round(total_ovl_ratio * 100.0, 1))
                min_dist_col.append(round(overall_min_dist * crs_to_unit_scale, 1))
                ang_diff_col.append(round(best_angle_diff, 1) if best_angle_diff != 999.0 else float("nan"))

                # QC Flagging
                if total_ovl_ratio < 0.35:
                    qc_flag_col.append("Borderline Overlap %")
                elif best_angle_diff > 25.0:
                    qc_flag_col.append("Borderline Angle")
                else:
                    qc_flag_col.append("Verified Match")
            else:
                matched_tags_col.append("")
                match_count_col.append(0)
                match_status_col.append("Off Corridor")
                ovl_length_col.append(0.0)
                ovl_ratio_col.append(0.0)
                min_dist_col.append(round(overall_min_dist * crs_to_unit_scale, 1) if overall_min_dist != float("inf") else float("nan"))
                ang_diff_col.append(round(best_angle_diff, 1) if best_angle_diff != 999.0 else float("nan"))
                qc_flag_col.append("No Match")

        if progress_callback:
            progress_callback(95, "Assembling enriched deliverable dataset...")

        # Construct Enriched GeoDataFrame
        pfx = self.config.output_prefix
        unit_suffix = "Ft" if self.config.distance_unit == "feet" else "M"

        res_gdf = target_gdf.copy()
        res_gdf[f"{pfx}Match_Stat"] = match_status_col
        res_gdf[f"{pfx}Matched_ID"] = matched_tags_col
        res_gdf[f"{pfx}Match_Cnt"] = match_count_col
        res_gdf[f"{pfx}Ovl_{unit_suffix}"] = ovl_length_col
        res_gdf[f"{pfx}Ovl_Pct"] = ovl_ratio_col
        res_gdf[f"{pfx}Min_{unit_suffix}"] = min_dist_col
        res_gdf[f"{pfx}Ang_Dif"] = ang_diff_col
        res_gdf[f"{pfx}QC_Flag"] = qc_flag_col

        matched_count = sum(1 for s in match_status_col if s == "On Corridor")
        unmatched_count = total_targets - matched_count
        match_pct = (matched_count / total_targets * 100.0) if total_targets > 0 else 0.0
        elapsed = time.time() - start_time

        if progress_callback:
            progress_callback(100, f"Complete! Matched {matched_count}/{total_targets} ({match_pct:.1f}%) in {elapsed:.2f}s")

        return OverlayResult(
            output_gdf=res_gdf,
            total_targets=total_targets,
            matched_targets=matched_count,
            unmatched_targets=unmatched_count,
            match_percentage=round(match_pct, 1),
            total_reference_features=len(reference_gdf),
            duration_seconds=round(elapsed, 2),
            summary_stats={
                "distance_unit": self.config.distance_unit,
                "buffer_distance": self.config.buffer_distance,
                "min_overlap": self.config.min_overlap_length,
                "max_angle": self.config.max_angle_diff_deg,
                "keep_duplicates": self.config.keep_duplicates,
            },
        )
