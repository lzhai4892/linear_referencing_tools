import pandas as pd

from lrs_tools.schema import LrsSchema, pad_roadway_id, pad_roadway_series


def test_pad_roadway_id_handles_int_float_and_null():
    assert pad_roadway_id(123) == "00000123"
    assert pad_roadway_id("47") == "00000047"
    assert pad_roadway_id(84.0) == "00000084"
    assert pad_roadway_id("8470001.0") == "08470001"
    assert pad_roadway_id(None) is None
    assert pad_roadway_id(float("nan")) is None
    assert pad_roadway_id("") is None


def test_pad_roadway_series():
    series = pad_roadway_series(pd.Series([1, None, "22"]))
    assert series.tolist()[0] == "00000001"
    assert pd.isna(series.tolist()[1])
    assert series.tolist()[2] == "00000022"


def test_schema_from_dataframe_aliases():
    df = pd.DataFrame(
        {
            "roadway": ["1"],
            "begin_post": [0.0],
            "end_post": [1.0],
            "LOCATION": [0.4],
        }
    )
    schema = LrsSchema.from_dataframe(df)
    assert schema.roadway == "roadway"
    assert schema.bmp == "begin_post"
    assert schema.emp == "end_post"
    assert schema.measure == "LOCATION"


def test_schema_from_dataframe_min_max_mp():
    df = pd.DataFrame({"ROADWAY": ["1"], "MinMP": [0], "MaxMP": [2]})
    schema = LrsSchema.from_dataframe(df, require_line=True)
    assert schema.bmp == "MinMP"
    assert schema.emp == "MaxMP"
