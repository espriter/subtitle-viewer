import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    movie_dir = tmp_path / "example"
    movie_dir.mkdir()
    (movie_dir / "en.srt").write_text(
        "1\n00:00:10,000 --> 00:00:12,000\nHello\n",
        encoding="utf-8",
    )
    app = create_app(subtitles_dir=tmp_path)
    return TestClient(app), movie_dir


def test_get_chapters_from_sidecar(client):
    test_client, movie_dir = client
    (movie_dir / "chapters.json").write_text(
        json.dumps(
            [
                {"title": "Spark shuffle basics", "start": 0, "end": 420.5},
                {"title": "Streaming checkpoints", "start": 420.5, "end": 900},
            ]
        ),
        encoding="utf-8",
    )

    resp = test_client.get("/api/movies/example/chapters")

    assert resp.status_code == 200
    assert resp.json() == [
        {
            "index": 1,
            "title": "Spark shuffle basics",
            "start_seconds": 0.0,
            "end_seconds": 420.5,
            "start": "00:00:00.000",
            "end": "00:07:00.500",
        },
        {
            "index": 2,
            "title": "Streaming checkpoints",
            "start_seconds": 420.5,
            "end_seconds": 900.0,
            "start": "00:07:00.500",
            "end": "00:15:00.000",
        },
    ]


def test_get_chapters_returns_empty_when_metadata_absent(client):
    test_client, _movie_dir = client

    resp = test_client.get("/api/movies/example/chapters")

    assert resp.status_code == 200
    assert resp.json() == []


def test_get_chapters_movie_not_found(client):
    test_client, _movie_dir = client

    resp = test_client.get("/api/movies/missing/chapters")

    assert resp.status_code == 404


def test_get_chapters_rejects_invalid_movie_name(client):
    test_client, _movie_dir = client

    resp = test_client.get("/api/movies/bad%20name/chapters")

    assert resp.status_code in {400, 404, 422}
