import re
from html import unescape


_SYNC_PATTERN = re.compile(
    r"<SYNC\s+Start\s*=\s*(\d+)\s*>",
    re.IGNORECASE,
)
_TAG_PATTERN = re.compile(r"<[^>]+>")
_NBSP_PATTERN = re.compile(r"&nbsp;?", re.IGNORECASE)


def _ms_to_timecode(ms: int) -> str:
    """Convert milliseconds to SRT-style timecode HH:MM:SS,mmm."""
    if ms < 0:
        ms = 0
    hours, ms = divmod(ms, 3_600_000)
    minutes, ms = divmod(ms, 60_000)
    seconds, millis = divmod(ms, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def _clean_text(raw: str) -> str:
    """Strip HTML tags and collapse whitespace from SMI body text."""
    text = _NBSP_PATTERN.sub(" ", raw)
    text = _TAG_PATTERN.sub("", text)
    text = unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = "\n".join(line.strip() for line in text.splitlines())
    return text.strip()


def parse_smi(content: str) -> list[dict]:
    """Parse SMI/SAMI subtitle content into a list of subtitle entries.

    Returns the same structure as parse_srt:
        [{"index": int, "start": str, "end": str, "text": str}, ...]
    """
    content = content.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")

    # Collect all SYNC points with their raw body text.
    sync_points: list[tuple[int, str]] = []
    for match in _SYNC_PATTERN.finditer(content):
        start_ms = int(match.group(1))
        body_start = match.end()
        sync_points.append((start_ms, body_start))

    if not sync_points:
        return []

    # Extract text between consecutive SYNC tags.
    entries: list[dict] = []
    index = 1
    for i, (start_ms, body_start) in enumerate(sync_points):
        # Body runs until the next SYNC tag or end of content.
        if i + 1 < len(sync_points):
            body_end = _SYNC_PATTERN.search(content, body_start).start()
            next_ms = sync_points[i + 1][0]
        else:
            body_end = len(content)
            next_ms = start_ms  # last entry — no real end time

        raw_body = content[body_start:body_end]
        text = _clean_text(raw_body)

        # Skip blank/nbsp-only entries (used as end markers in SMI).
        if not text:
            continue

        entries.append({
            "index": index,
            "start": _ms_to_timecode(start_ms),
            "end": _ms_to_timecode(next_ms),
            "text": text,
        })
        index += 1

    return entries
