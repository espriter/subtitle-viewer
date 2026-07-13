import subprocess
from unittest.mock import patch, MagicMock

from app.chapter_metadata import load_chapters


def _touch_mp3(movie_dir):
    (movie_dir / "movie.mp3").write_bytes(b"")


def test_load_chapters_ffprobe_missing_binary(tmp_path):
    movie_dir = tmp_path / "example"
    movie_dir.mkdir()
    _touch_mp3(movie_dir)

    with patch("app.chapter_metadata.subprocess.run", side_effect=OSError("not found")):
        assert load_chapters(movie_dir) == []


def test_load_chapters_ffprobe_timeout(tmp_path):
    movie_dir = tmp_path / "example"
    movie_dir.mkdir()
    _touch_mp3(movie_dir)

    with patch(
        "app.chapter_metadata.subprocess.run",
        side_effect=subprocess.TimeoutExpired(cmd="ffprobe", timeout=5),
    ):
        assert load_chapters(movie_dir) == []


def test_load_chapters_ffprobe_nonzero_exit(tmp_path):
    movie_dir = tmp_path / "example"
    movie_dir.mkdir()
    _touch_mp3(movie_dir)

    mock_result = MagicMock(returncode=1, stdout="")
    with patch("app.chapter_metadata.subprocess.run", return_value=mock_result):
        assert load_chapters(movie_dir) == []


def test_load_chapters_ffprobe_malformed_json(tmp_path):
    movie_dir = tmp_path / "example"
    movie_dir.mkdir()
    _touch_mp3(movie_dir)

    mock_result = MagicMock(returncode=0, stdout="not json{{{")
    with patch("app.chapter_metadata.subprocess.run", return_value=mock_result):
        assert load_chapters(movie_dir) == []


def test_load_chapters_ffprobe_valid_output(tmp_path):
    movie_dir = tmp_path / "example"
    movie_dir.mkdir()
    _touch_mp3(movie_dir)

    mock_result = MagicMock(
        returncode=0,
        stdout='{"chapters": [{"start_time": "0.0", "end_time": "10.5", '
        '"tags": {"title": "Intro"}}]}',
    )
    with patch("app.chapter_metadata.subprocess.run", return_value=mock_result):
        result = load_chapters(movie_dir)

    assert result == [{
        "index": 1,
        "title": "Intro",
        "start_seconds": 0.0,
        "end_seconds": 10.5,
        "start": "00:00:00.000",
        "end": "00:00:10.500",
    }]


def test_load_chapters_no_mp3_returns_empty(tmp_path):
    movie_dir = tmp_path / "example"
    movie_dir.mkdir()

    assert load_chapters(movie_dir) == []
