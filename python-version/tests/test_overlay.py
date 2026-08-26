import pandas as pd

from lrs_tools import LrsSchema, overlay_events


def _target():
    return pd.DataFrame(
        {
            "ROADWAY": ["100"],
            "BEGIN_POST": [0.0],
            "END_POST": [10.0],
            "SECTADT": [5000],
        }
    )


def test_overlay_overlap_leading_and_trailing_gaps():
    overlay = pd.DataFrame(
        {
            "roadway": ["100"],
            "BEGIN_POST": [2.0],
            "END_POST": [6.0],
            "AADT": [1200],
        }
    )
    result = overlay_events(_target(), overlay)
    assert list(result["BEGIN_POST"]) == [0.0, 2.0, 6.0]
    assert list(result["END_POST"]) == [2.0, 6.0, 10.0]
    assert pd.isna(result.loc[0, "AADT"])
    assert result.loc[1, "AADT"] == 1200
    assert pd.isna(result.loc[2, "AADT"])


def test_overlay_internal_gap_between_two_overlay_segments():
    overlay = pd.DataFrame(
        {
            "ROADWAY": ["100", "100"],
            "BEGIN_POST": [0.0, 7.0],
            "END_POST": [3.0, 10.0],
            "FLAG": ["a", "b"],
        }
    )
    result = overlay_events(_target(), overlay)
    assert len(result) == 3
    assert list(result["BEGIN_POST"]) == [0.0, 3.0, 7.0]
    assert list(result["FLAG"])[1] != list(result["FLAG"])[0]
    assert pd.isna(result.loc[1, "FLAG"])


def test_overlay_unmatched_roadway_keeps_target_bounds():
    overlay = pd.DataFrame(
        {
            "ROADWAY": ["999"],
            "BEGIN_POST": [0.0],
            "END_POST": [5.0],
            "AADT": [1],
        }
    )
    result = overlay_events(_target(), overlay)
    assert len(result) == 1
    assert result.loc[0, "BEGIN_POST"] == 0.0
    assert result.loc[0, "END_POST"] == 10.0
    assert pd.isna(result.loc[0, "AADT"])


def test_overlay_inner_drops_gaps():
    overlay = pd.DataFrame(
        {
            "ROADWAY": ["100"],
            "BEGIN_POST": [4.0],
            "END_POST": [6.0],
            "AADT": [9],
        }
    )
    result = overlay_events(_target(), overlay, how="inner")
    assert len(result) == 1
    assert result.loc[0, "BEGIN_POST"] == 4.0
    assert result.loc[0, "END_POST"] == 6.0


def test_overlay_pads_roadway_ids():
    target = pd.DataFrame({"ROADWAY": [100], "BEGIN_POST": [0.0], "END_POST": [2.0]})
    overlay = pd.DataFrame(
        {"roadway": ["00000100"], "begin_post": [0.0], "end_post": [2.0], "X": [7]}
    )
    result = overlay_events(target, overlay)
    assert len(result) == 1
    assert result.loc[0, "X"] == 7


def test_overlay_collapse_longest_keeps_dominant_attributes():
    target = pd.DataFrame(
        {
            "ROADWAY": ["100"],
            "BEGIN_POST": [0.0],
            "END_POST": [10.0],
            "GROUP": ["A"],
        }
    )
    overlay = pd.DataFrame(
        {
            "ROADWAY": ["100", "100"],
            "BEGIN_POST": [0.0, 1.0],
            "END_POST": [1.0, 10.0],
            "SRC": ["short", "long"],
        }
    )
    result = overlay_events(
        target,
        overlay,
        collapse="longest",
        collapse_group_cols=["ROADWAY", "GROUP"],
    )
    assert len(result) == 1
    assert result.loc[0, "BEGIN_POST"] == 0.0
    assert result.loc[0, "END_POST"] == 10.0
    assert result.loc[0, "SRC"] == "long"


def test_overlay_target_rename():
    result = overlay_events(
        _target(),
        pd.DataFrame(
            {"ROADWAY": ["100"], "BEGIN_POST": [0.0], "END_POST": [10.0], "OLD": [3]}
        ),
        target_rename={"ROADWAY": "ROADWAY_new", "SECTADT": "SECTADT_new"},
        target_schema=LrsSchema(roadway="ROADWAY", bmp="BEGIN_POST", emp="END_POST"),
    )
    assert "ROADWAY_new" in result.columns
    assert result.loc[0, "SECTADT_new"] == 5000
    assert result.loc[0, "OLD"] == 3
