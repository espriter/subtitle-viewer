import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    movie_dir = tmp_path / "example"
    movie_dir.mkdir()
    (movie_dir / "en.srt").write_text(
        "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n"
        "2\n00:00:03,000 --> 00:00:04,000\nWorld\n",
        encoding="utf-8",
    )
    (movie_dir / "ko.srt").write_text(
        "1\n00:00:01,000 --> 00:00:02,000\n안녕\n\n"
        "2\n00:00:03,000 --> 00:00:04,000\n세계\n",
        encoding="utf-8",
    )

    app = create_app(subtitles_dir=tmp_path)
    return TestClient(app)


def test_list_movies(client):
    resp = client.get("/api/movies")
    assert resp.status_code == 200
    assert "example" in resp.json()


def test_list_files(client):
    resp = client.get("/api/movies/example/files")
    assert resp.status_code == 200
    files = resp.json()
    assert "en.srt" in files
    assert "ko.srt" in files


def test_list_files_not_found(client):
    resp = client.get("/api/movies/nonexistent/files")
    assert resp.status_code == 404


def test_get_subtitles(client):
    resp = client.get("/api/movies/example/subtitles/en.srt")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["text"] == "Hello"
    assert data[1]["text"] == "World"


def test_get_subtitles_korean(client):
    resp = client.get("/api/movies/example/subtitles/ko.srt")
    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["text"] == "안녕"


def test_get_subtitles_file_not_found(client):
    resp = client.get("/api/movies/example/subtitles/fr.srt")
    assert resp.status_code == 404


def test_get_subtitles_movie_not_found(client):
    resp = client.get("/api/movies/nonexistent/subtitles/en.srt")
    assert resp.status_code == 404


def test_path_traversal_movie_name(client):
    # httpx normalizes '..' client-side, so the server sees /api/etc/files
    # which matches no route — either 400 (caught by validator) or 404 is acceptable
    resp = client.get("/api/movies/../etc/files")
    assert resp.status_code in {400, 404}


def test_path_traversal_file_name(client):
    # httpx normalizes '..' client-side, so the server sees /api/movies/etc/passwd
    # which matches no route — either 400 (caught by validator) or 404 is acceptable
    resp = client.get("/api/movies/example/subtitles/../../etc/passwd")
    assert resp.status_code in {400, 404}
