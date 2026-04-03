import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client_with_audio(tmp_path):
    """Client with a movie that has both SRT and MP3 files."""
    movie_dir = tmp_path / "test-movie"
    movie_dir.mkdir()
    (movie_dir / "en.srt").write_text(
        "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n"
        "2\n00:00:03,000 --> 00:00:04,000\nWorld\n",
        encoding="utf-8",
    )
    (movie_dir / "audio.mp3").write_bytes(b"\xff\xfb\x90\x00" + b"\x00" * 100)

    app = create_app(subtitles_dir=tmp_path)
    return TestClient(app)


@pytest.fixture
def client_no_audio(tmp_path):
    """Client with a movie that has only SRT files."""
    movie_dir = tmp_path / "silent-movie"
    movie_dir.mkdir()
    (movie_dir / "en.srt").write_text(
        "1\n00:00:01,000 --> 00:00:02,000\nHello\n",
        encoding="utf-8",
    )

    app = create_app(subtitles_dir=tmp_path)
    return TestClient(app)


class TestListFilesWithAudio:
    def test_includes_mp3(self, client_with_audio):
        resp = client_with_audio.get("/api/movies/test-movie/files")
        assert resp.status_code == 200
        files = resp.json()
        assert "audio.mp3" in files
        assert "en.srt" in files

    def test_no_mp3_when_absent(self, client_no_audio):
        resp = client_no_audio.get("/api/movies/silent-movie/files")
        assert resp.status_code == 200
        files = resp.json()
        assert all(f.endswith(".srt") for f in files)


class TestAudioEndpoint:
    def test_serve_mp3(self, client_with_audio):
        resp = client_with_audio.get("/api/movies/test-movie/audio/audio.mp3")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/mpeg"

    def test_audio_not_found(self, client_with_audio):
        resp = client_with_audio.get("/api/movies/test-movie/audio/missing.mp3")
        assert resp.status_code == 404

    def test_movie_not_found(self, client_with_audio):
        resp = client_with_audio.get("/api/movies/nonexistent/audio/audio.mp3")
        assert resp.status_code == 404

    def test_reject_non_mp3(self, client_with_audio):
        resp = client_with_audio.get("/api/movies/test-movie/audio/en.srt")
        assert resp.status_code == 400

    def test_path_traversal_movie(self, client_with_audio):
        resp = client_with_audio.get("/api/movies/../etc/audio/audio.mp3")
        assert resp.status_code in {400, 404}

    def test_path_traversal_filename(self, client_with_audio):
        resp = client_with_audio.get("/api/movies/test-movie/audio/../../etc/passwd")
        assert resp.status_code in {400, 404}

    def test_invalid_movie_name(self, client_with_audio):
        resp = client_with_audio.get("/api/movies/bad%20name!/audio/audio.mp3")
        assert resp.status_code in {400, 404, 422}

    def test_invalid_filename(self, client_with_audio):
        resp = client_with_audio.get("/api/movies/test-movie/audio/bad%20file!.mp3")
        assert resp.status_code in {400, 422}
