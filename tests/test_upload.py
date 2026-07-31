import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import create_app
from app.upload_router import create_upload_router


@pytest.fixture
def client(tmp_path):
    app = create_app(subtitles_dir=tmp_path)
    app.include_router(create_upload_router(tmp_path))
    return TestClient(app)


@pytest.fixture
def client_no_upload(tmp_path):
    app = create_app(subtitles_dir=tmp_path)
    return TestClient(app)


def test_create_movie_folder(client, tmp_path):
    resp = client.post("/api/movies", json={"name": "inception"})
    assert resp.status_code == 201
    assert (tmp_path / "inception").is_dir()


def test_create_movie_folder_already_exists(client, tmp_path):
    (tmp_path / "inception").mkdir()
    resp = client.post("/api/movies", json={"name": "inception"})
    assert resp.status_code == 409


def test_create_movie_folder_invalid_name(client):
    resp = client.post("/api/movies", json={"name": "../etc"})
    assert resp.status_code == 400


def test_upload_srt(client, tmp_path):
    (tmp_path / "inception").mkdir()
    srt_content = "1\n00:00:01,000 --> 00:00:02,000\nHello\n"
    resp = client.post(
        "/api/movies/inception/upload",
        files={"file": ("en.srt", srt_content.encode(), "application/octet-stream")},
    )
    assert resp.status_code == 201
    assert (tmp_path / "inception" / "en.srt").read_text() == srt_content


def test_upload_non_srt_rejected(client, tmp_path):
    (tmp_path / "inception").mkdir()
    resp = client.post(
        "/api/movies/inception/upload",
        files={"file": ("script.py", b"import os", "application/octet-stream")},
    )
    assert resp.status_code == 400


def test_upload_too_large(client, tmp_path):
    (tmp_path / "inception").mkdir()
    large_content = b"x" * (1024 * 1024 + 1)
    resp = client.post(
        "/api/movies/inception/upload",
        files={"file": ("en.srt", large_content, "application/octet-stream")},
    )
    assert resp.status_code == 400


def test_upload_movie_not_found(client):
    resp = client.post(
        "/api/movies/nonexistent/upload",
        files={"file": ("en.srt", b"data", "application/octet-stream")},
    )
    assert resp.status_code == 404


def test_upload_disabled(client_no_upload, tmp_path):
    (tmp_path / "inception").mkdir()
    resp = client_no_upload.post("/api/movies", json={"name": "test"})
    assert resp.status_code == 405 or resp.status_code == 404


def test_fetch_youtube_sanitizes_special_chars(client, tmp_path, monkeypatch):
    import subprocess as subprocess_module

    def fake_run(cmd, capture_output, text, timeout):
        movie_dir = tmp_path / cmd[1]
        movie_dir.mkdir(parents=True, exist_ok=True)
        (movie_dir / "audio.mp3").write_bytes(b"fake")
        return subprocess_module.CompletedProcess(cmd, 0, stdout="ok", stderr="")

    monkeypatch.setattr("app.upload_router.subprocess.run", fake_run)

    resp = client.post(
        "/api/movies/fetch-youtube",
        json={"name": "End of the Line - Overwatch", "url": "https://www.youtube.com/watch?v=x"},
    )
    assert resp.status_code == 201
    assert resp.json()["movie"] == "End_of_the_Line_-_Overwatch"


def test_fetch_youtube_sanitizes_path_traversal(client, tmp_path, monkeypatch):
    import subprocess as subprocess_module

    def fake_run(cmd, capture_output, text, timeout):
        movie_dir = tmp_path / cmd[1]
        movie_dir.mkdir(parents=True, exist_ok=True)
        return subprocess_module.CompletedProcess(cmd, 0, stdout="ok", stderr="")

    monkeypatch.setattr("app.upload_router.subprocess.run", fake_run)

    resp = client.post(
        "/api/movies/fetch-youtube",
        json={"name": "../../etc/passwd", "url": "https://www.youtube.com/watch?v=x"},
    )
    assert resp.status_code == 201
    movie = resp.json()["movie"]
    assert "/" not in movie and ".." not in movie


def test_fetch_youtube_name_empty_after_sanitize(client):
    resp = client.post(
        "/api/movies/fetch-youtube",
        json={"name": "!!!", "url": "https://www.youtube.com/watch?v=x"},
    )
    assert resp.status_code == 400


def test_fetch_youtube_invalid_url(client):
    resp = client.post(
        "/api/movies/fetch-youtube",
        json={"name": "inception", "url": "not-a-url"},
    )
    assert resp.status_code == 400


def test_fetch_youtube_success(client, tmp_path, monkeypatch):
    import subprocess as subprocess_module

    def fake_run(cmd, capture_output, text, timeout):
        movie_dir = tmp_path / cmd[1]
        movie_dir.mkdir(parents=True, exist_ok=True)
        (movie_dir / "audio.mp3").write_bytes(b"fake")
        (movie_dir / "sub_en.srt").write_text("1\n00:00:01,000 --> 00:00:02,000\nHi\n")
        return subprocess_module.CompletedProcess(cmd, 0, stdout="ok", stderr="")

    monkeypatch.setattr("app.upload_router.subprocess.run", fake_run)

    resp = client.post(
        "/api/movies/fetch-youtube",
        json={"name": "yt_movie", "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["movie"] == "yt_movie"
    assert set(body["files"]) == {"audio.mp3", "sub_en.srt"}


def test_fetch_youtube_script_failure(client, monkeypatch):
    import subprocess as subprocess_module

    def fake_run(cmd, capture_output, text, timeout):
        return subprocess_module.CompletedProcess(cmd, 1, stdout="", stderr="yt-dlp: video unavailable")

    monkeypatch.setattr("app.upload_router.subprocess.run", fake_run)

    resp = client.post(
        "/api/movies/fetch-youtube",
        json={"name": "yt_movie", "url": "https://www.youtube.com/watch?v=deadbeef"},
    )
    assert resp.status_code == 502
    assert "unavailable" in resp.json()["detail"]


def test_fetch_youtube_timeout(client, monkeypatch):
    import subprocess as subprocess_module

    def fake_run(cmd, capture_output, text, timeout):
        raise subprocess_module.TimeoutExpired(cmd, timeout)

    monkeypatch.setattr("app.upload_router.subprocess.run", fake_run)

    resp = client.post(
        "/api/movies/fetch-youtube",
        json={"name": "yt_movie", "url": "https://www.youtube.com/watch?v=deadbeef"},
    )
    assert resp.status_code == 504
