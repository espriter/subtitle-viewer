import json
import subprocess
from pathlib import Path
from typing import Any


def seconds_to_timecode(seconds: float) -> str:
    """Format seconds as HH:MM:SS.mmm for chapter display."""
    millis_total = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(millis_total, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def _coerce_float(value: Any, field: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f"Invalid chapter {field}: {value!r}") from None


def _normalize_chapters(raw_chapters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    chapters = []
    for i, raw in enumerate(raw_chapters, start=1):
        if not isinstance(raw, dict):
            raise ValueError("Each chapter must be an object")

        start = _coerce_float(raw.get("start", raw.get("start_seconds")), "start")
        end_value = raw.get("end", raw.get("end_seconds", start))
        end = _coerce_float(end_value, "end")
        title = str(raw.get("title") or f"Chapter {i:02d}")

        chapters.append({
            "index": i,
            "title": title,
            "start_seconds": start,
            "end_seconds": end,
            "start": seconds_to_timecode(start),
            "end": seconds_to_timecode(end),
        })
    return chapters


def _load_sidecar(movie_dir: Path) -> list[dict[str, Any]] | None:
    sidecar = movie_dir / "chapters.json"
    if not sidecar.is_file():
        return None

    data = json.loads(sidecar.read_text(encoding="utf-8"))
    raw_chapters = data.get("chapters") if isinstance(data, dict) else data
    if not isinstance(raw_chapters, list):
        raise ValueError("chapters.json must be a list or an object with a chapters list")
    return _normalize_chapters(raw_chapters)


def _load_mp3_chapters(movie_dir: Path) -> list[dict[str, Any]]:
    mp3_files = sorted(movie_dir.glob("*.mp3"))
    if not mp3_files:
        return []

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_chapters",
                "-of",
                "json",
                str(mp3_files[0]),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []

    if result.returncode != 0:
        return []

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []

    raw_chapters = []
    for chapter in data.get("chapters", []):
        tags = chapter.get("tags") if isinstance(chapter.get("tags"), dict) else {}
        raw_chapters.append({
            "title": tags.get("title"),
            "start": chapter.get("start_time"),
            "end": chapter.get("end_time"),
        })
    return _normalize_chapters(raw_chapters)


def load_chapters(movie_dir: Path) -> list[dict[str, Any]]:
    """Load normalized chapters from sidecar metadata or embedded MP3 metadata."""
    sidecar_chapters = _load_sidecar(movie_dir)
    if sidecar_chapters is not None:
        return sidecar_chapters
    return _load_mp3_chapters(movie_dir)
