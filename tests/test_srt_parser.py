from app.srt_parser import parse_srt


SAMPLE_SRT = """\
1
00:00:02,000 --> 00:00:07,000
Downloaded from
YTS.MX

2
00:00:29,821 --> 00:00:33,658
Huntrix!

3
00:00:45,545 --> 00:00:46,838
Huntrix!
"""


def test_parse_srt_returns_list():
    result = parse_srt(SAMPLE_SRT)
    assert isinstance(result, list)
    assert len(result) == 3


def test_parse_srt_entry_fields():
    result = parse_srt(SAMPLE_SRT)
    entry = result[0]
    assert entry["index"] == 1
    assert entry["start"] == "00:00:02,000"
    assert entry["end"] == "00:00:07,000"
    assert entry["text"] == "Downloaded from\nYTS.MX"


def test_parse_srt_single_line_text():
    result = parse_srt(SAMPLE_SRT)
    entry = result[1]
    assert entry["text"] == "Huntrix!"


def test_parse_srt_empty_string():
    result = parse_srt("")
    assert result == []


def test_parse_srt_trailing_whitespace():
    srt_with_spaces = "1\n00:00:01,000 --> 00:00:02,000\nHello \n\n"
    result = parse_srt(srt_with_spaces)
    assert len(result) == 1
    assert result[0]["text"] == "Hello"
