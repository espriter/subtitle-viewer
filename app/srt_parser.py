import re

_TIMECODE_PATTERN = re.compile(
    r"(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})"
)


def parse_srt(content: str) -> list[dict]:
    """Parse SRT subtitle content into a list of subtitle entries."""
    # Strip UTF-8 BOM if present, then normalize all line-ending styles to \n.
    content = content.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n\n+", content.strip())
    entries = []

    for block in blocks:
        lines = block.strip().splitlines()
        if len(lines) < 3:
            continue

        try:
            index = int(lines[0].strip())
        except ValueError:
            continue

        time_match = _TIMECODE_PATTERN.match(lines[1].strip())
        if not time_match:
            continue

        text = "\n".join(line.rstrip() for line in lines[2:]).strip()
        entries.append({
            "index": index,
            "start": time_match.group(1),
            "end": time_match.group(2),
            "text": text,
        })

    return entries
