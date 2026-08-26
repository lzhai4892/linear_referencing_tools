import pandas as pd

from lrs_tools import LrsSchema, dissolve_contiguous
from lrs_tools.dissolve import collapse_longest


def test_dissolve_contiguous_merges_touching_segments():
    df = pd.DataFrame(
        {
            "ROADWAY": ["1", "1", "1"],
            "BEGIN_POST": [0.0, 2.0, 5.0],
            "END_POST": [2.0, 5.0, 8.0],
            "FLAG": ["a", "a", "b"],
        }
    )
    out = dissolve_contiguous(df, group_cols=["ROADWAY", "FLAG"])
    assert len(out) == 2
    first = out[out["FLAG"] == "a"].iloc[0]
    assert first["BEGIN_POST"] == 0.0
    assert first["END_POST"] == 5.0


def test_dissolve_does_not_merge_across_gap_when_contiguous_required():
    df = pd.DataFrame(
        {
            "ROADWAY": ["1", "1"],
            "BEGIN_POST": [0.0, 4.0],
            "END_POST": [2.0, 6.0],
            "FLAG": ["a", "a"],
        }
    )
    out = dissolve_contiguous(df, group_cols=["ROADWAY", "FLAG"], require_contiguous=True)
    assert len(out) == 2


def test_dissolve_swallows_gap_when_contiguous_not_required():
    df = pd.DataFrame(
        {
            "ROADWAY": ["1", "1"],
            "BEGIN_POST": [0.0, 4.0],
            "END_POST": [2.0, 6.0],
            "FLAG": ["a", "a"],
        }
    )
    out = dissolve_contiguous(df, group_cols=["ROADWAY", "FLAG"], require_contiguous=False)
    assert len(out) == 1
    assert out.loc[0, "BEGIN_POST"] == 0.0
    assert out.loc[0, "END_POST"] == 6.0


def test_dissolve_respects_float_tolerance():
    df = pd.DataFrame(
        {
            "ROADWAY": ["1", "1"],
            "BEGIN_POST": [0.0, 2.00005],
            "END_POST": [2.0, 4.0],
            "FLAG": ["a", "a"],
        }
    )
    schema = LrsSchema(roadway="ROADWAY", bmp="BEGIN_POST", emp="END_POST", tolerance=1e-4)
    out = dissolve_contiguous(df, group_cols=["ROADWAY", "FLAG"], schema=schema)
    assert len(out) == 1


def test_collapse_longest_expands_bounds():
    df = pd.DataFrame(
        {
            "ROADWAY": ["1", "1"],
            "BEGIN_POST": [0.0, 1.0],
            "END_POST": [1.0, 10.0],
            "SRC": ["short", "long"],
        }
    )
    out = collapse_longest(df, group_cols=["ROADWAY"])
    assert len(out) == 1
    assert out.loc[0, "SRC"] == "long"
    assert out.loc[0, "BEGIN_POST"] == 0.0
    assert out.loc[0, "END_POST"] == 10.0
