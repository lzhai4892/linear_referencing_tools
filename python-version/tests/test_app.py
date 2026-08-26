from pathlib import Path

from fastapi.testclient import TestClient

from lrs_app.server import app


def test_health():
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["bind"] == "127.0.0.1"


def test_overlay_and_dissolve_endpoints(tmp_path: Path):
    client = TestClient(app)
    target = tmp_path / "target.csv"
    overlay = tmp_path / "overlay.csv"
    joined = tmp_path / "joined.csv"
    dissolved = tmp_path / "dissolved.csv"
    target.write_text("ROADWAY,BEGIN_POST,END_POST,SECTADT\n100,0,10,50\n")
    overlay.write_text("ROADWAY,BEGIN_POST,END_POST,AADT\n100,2,6,9\n")

    result = client.post(
        "/api/overlay",
        json={
            "target_path": str(target),
            "overlay_path": str(overlay),
            "output_path": str(joined),
            "how": "left",
            "collapse": "none",
        },
    )
    assert result.status_code == 200, result.text
    payload = result.json()
    assert payload["rows"] == 3
    assert joined.exists()

    dissolved_result = client.post(
        "/api/dissolve",
        json={
            "input_path": str(joined),
            "output_path": str(dissolved),
            "group_cols": ["ROADWAY", "SECTADT"],
            "require_contiguous": False,
        },
    )
    assert dissolved_result.status_code == 200, dissolved_result.text
    assert dissolved_result.json()["rows"] == 1


def test_export_geometry_endpoint(tmp_path: Path):
    import geopandas as gpd
    from shapely.geometry import LineString

    client = TestClient(app)
    routes = tmp_path / "routes.geojson"
    events = tmp_path / "events.csv"
    output = tmp_path / "out.geojson"
    gpd.GeoDataFrame(
        {"SECT_ID": ["00000100"], "BMP": [0.0], "EMP": [10.0]},
        geometry=[LineString([(0, 0), (10, 0)])],
        crs="EPSG:4326",
    ).to_file(routes, driver="GeoJSON")
    events.write_text("ROADWAY,BEGIN_POST,END_POST\n100,1,4\n")

    columns = client.post("/api/columns", json={"path": str(routes)})
    assert columns.status_code == 200
    assert "SECT_ID" in columns.json()["columns"]

    result = client.post(
        "/api/export_geometry",
        json={
            "routes_path": str(routes),
            "output_path": str(output),
            "segment_id": "SECT_ID",
            "start_post": "BMP",
            "end_post": "EMP",
            "events_path": str(events),
            "event_segment_id": "ROADWAY",
            "event_start_post": "BEGIN_POST",
            "event_end_post": "END_POST",
            "fmt": "geojson",
        },
    )
    assert result.status_code == 200, result.text
    payload = result.json()
    assert payload["rows"] == 1
    assert payload["format"] == "geojson"
    assert output.exists()
