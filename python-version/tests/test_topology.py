import pandas as pd

from lrs_tools import find_gaps, find_overlaps, neighbors_along_route, validate_lrs


def test_find_gaps_and_overlaps():
    df = pd.DataFrame(
        {
            "ROADWAY": ["1", "1", "1"],
            "BEGIN_POST": [0.0, 1.5, 5.0],
            "END_POST": [2.0, 3.0, 6.0],
        }
    )
    overlaps = find_overlaps(df)
    assert len(overlaps) == 1
    gaps = find_gaps(df)
    assert len(gaps) == 1
    assert gaps.loc[0, "GAP_BMP"] == 3.0
    assert gaps.loc[0, "GAP_EMP"] == 5.0


def test_validate_lrs_flags_inverted_bounds():
    df = pd.DataFrame(
        {
            "ROADWAY": ["1", "2"],
            "BEGIN_POST": [5.0, 0.0],
            "END_POST": [1.0, 2.0],
        }
    )
    report = validate_lrs(df)
    assert not report.ok
    assert len(report.invalid_bounds) == 1


def test_neighbors_along_route():
    df = pd.DataFrame(
        {
            "ROADWAY": ["1", "1", "1"],
            "BEGIN_POST": [0.0, 2.0, 4.0],
            "END_POST": [2.0, 4.0, 6.0],
            "AADT": [100.0, 200.0, 100.0],
        }
    )
    out = neighbors_along_route(df, "AADT")
    assert pd.isna(out.loc[0, "Upstream_Value"])
    assert out.loc[1, "Upstream_Value"] == 100.0
    assert out.loc[1, "Downstream_Value"] == 100.0
    assert out.loc[1, "Upstream_Diff_pct"] == 1.0
