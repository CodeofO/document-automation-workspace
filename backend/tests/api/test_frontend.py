"""The API process can serve the built SPA; client-side routes fall back to index.html."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

INDEX_HTML = "<!doctype html><html><body><div id='root'></div></body></html>"


@pytest.fixture
def spa_client(tmp_path: Path, settings_env) -> TestClient:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX_HTML, encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log('app')", encoding="utf-8")
    (dist / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("outside dist", encoding="utf-8")
    settings_env(SERVE_FRONTEND="true", FRONTEND_DIST_DIR=str(dist))
    # Without the ``with`` block the lifespan (background workers) does not start.
    return TestClient(create_app())


@pytest.mark.parametrize("path", ["/", "/documents", "/key-info", "/workflows/wf_123", "/workflow-runs/run_1/items?tab=x"])
def test_client_routes_fall_back_to_index(spa_client: TestClient, path: str) -> None:
    response = spa_client.get(path)
    assert response.status_code == 200
    assert response.text == INDEX_HTML
    assert response.headers["content-type"].startswith("text/html")


def test_static_files_are_served_as_files(spa_client: TestClient) -> None:
    asset = spa_client.get("/assets/app.js")
    assert asset.status_code == 200
    assert asset.text == "console.log('app')"
    root_file = spa_client.get("/favicon.svg")
    assert root_file.status_code == 200
    assert root_file.text == "<svg/>"


def test_missing_asset_is_not_rewritten_to_index(spa_client: TestClient) -> None:
    assert spa_client.get("/assets/missing.js").status_code == 404


def test_api_routes_are_not_shadowed(spa_client: TestClient) -> None:
    assert spa_client.get("/api/health").json() == {"status": "ok"}
    for path in ["/api/does-not-exist", "/api"]:
        response = spa_client.get(path)
        assert response.status_code == 404
        assert response.json() == {"detail": "Not Found"}


def test_paths_outside_dist_are_never_served(spa_client: TestClient) -> None:
    response = spa_client.get("/..%2Fsecret.txt")
    assert response.status_code == 200
    assert response.text == INDEX_HTML


def test_frontend_is_not_mounted_without_a_build(tmp_path: Path, settings_env) -> None:
    settings_env(SERVE_FRONTEND="true", FRONTEND_DIST_DIR=str(tmp_path / "missing"))
    client = TestClient(create_app())
    assert client.get("/documents").status_code == 404
