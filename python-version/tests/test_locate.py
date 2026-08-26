import pandas as pd

from lrs_tools import LrsSchema, locate_points


def test_locate_points_keeps_on_segment_and_exports_misses():
    points = pd.DataFrame(
        {
            "Roadway ID": ["00000100", "00000100", "00000200"],
            "LOCATION": [1.5, 9.0, 0.5],
            "SITE": ["A", "B", "C"],
        }
    )
    events = pd.DataFrame(
        {
            "roadway": ["100"],
            "begin_post": [0.0],
            "end_post": [5.0],
            "sectadt24": [111],
        }
    )
    located, unmatched = locate_points(
        points,
        events,
        point_schema=LrsSchema(roadway="Roadway ID", measure="LOCATION"),
        event_schema=LrsSchema(roadway="roadway", bmp="begin_post", emp="end_post"),
    )
    assert list(located["SITE"]) == ["A"]
    assert located.loc[0, "sectadt24"] == 111
    assert set(unmatched["SITE"]) == {"B", "C"}


def test_locate_points_inclusive_bounds():
    points = pd.DataFrame({"ROADWAY": ["1"], "LOCATION": [2.0]})
    events = pd.DataFrame({"ROADWAY": ["1"], "BEGIN_POST": [0.0], "END_POST": [2.0]})
    located, unmatched = locate_points(points, events)
    assert len(located) == 1
    assert unmatched.empty
