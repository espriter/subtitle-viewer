"""Integration tests for audio sync feature."""
import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def full_client(tmp_path):
    """Client with movie having dual subtitles + audio."""
    movie_dir = tmp_path / "inception"
    movie_dir.mkdir()
    (movie_dir / "en.srt").write_text(
        "1\n00:00:01,000 --> 00:00:03,000\nDream within a dream\n\n"
        "2\n00:00:04,000 --> 00:00:06,000\nWake up\n\n"
        "3\n00:00:07,500 --> 00:00:10,000\nThe kick\n",
        encoding="utf-8",
    )
    (movie_dir / "ko.srt").write_text(
        "1\n00:00:01,000 --> 00:00:03,000\n꿈속의 꿈\n\n"
        "2\n00:00:04,000 --> 00:00:06,000\n일어나\n\n"
        "3\n00:00:07,500 --> 00:00:10,000\n킥\n",
        encoding="utf-8",
    )
    (movie_dir / "audio.mp3").write_bytes(b"\xff\xfb\x90\x00" + b"\x00" * 200)

    silent_dir = tmp_path / "silent"
    silent_dir.mkdir()
    (silent_dir / "en.srt").write_text(
        "1\n00:00:01,000 --> 00:00:02,000\nSilent movie\n",
        encoding="utf-8",
    )

    app = create_app(subtitles_dir=tmp_path)
    return TestClient(app)


class TestFileListingForFrontend:
    def test_files_include_audio_mp3(self, full_client):
        resp = full_client.get("/api/movies/inception/files")
        files = resp.json()
        mp3_files = [f for f in files if f.endswith(".mp3")]
        srt_files = [f for f in files if f.endswith(".srt")]
        assert len(mp3_files) == 1
        assert len(srt_files) == 2

    def test_files_sorted(self, full_client):
        resp = full_client.get("/api/movies/inception/files")
        files = resp.json()
        assert files == sorted(files)

    def test_no_audio_in_silent_movie(self, full_client):
        resp = full_client.get("/api/movies/silent/files")
        files = resp.json()
        assert not any(f.endswith(".mp3") for f in files)


class TestAudioStreamingForFrontend:
    def test_audio_content_type(self, full_client):
        resp = full_client.get("/api/movies/inception/audio/audio.mp3")
        assert resp.status_code == 200
        assert "audio/mpeg" in resp.headers["content-type"]

    def test_audio_has_content(self, full_client):
        resp = full_client.get("/api/movies/inception/audio/audio.mp3")
        assert len(resp.content) > 0

    def test_audio_404_for_silent_movie(self, full_client):
        resp = full_client.get("/api/movies/silent/audio/audio.mp3")
        assert resp.status_code == 404


class TestSubtitleTimestampsForSync:
    def test_subtitles_have_start_end(self, full_client):
        resp = full_client.get("/api/movies/inception/subtitles/en.srt")
        data = resp.json()
        for entry in data:
            assert "start" in entry
            assert "end" in entry
            assert "-->" not in entry["start"]

    def test_subtitles_ordered_by_index(self, full_client):
        resp = full_client.get("/api/movies/inception/subtitles/en.srt")
        data = resp.json()
        for i in range(len(data) - 1):
            assert data[i]["index"] < data[i + 1]["index"]

    def test_dual_subtitles_same_count(self, full_client):
        en = full_client.get("/api/movies/inception/subtitles/en.srt").json()
        ko = full_client.get("/api/movies/inception/subtitles/ko.srt").json()
        assert len(en) == len(ko)
