from app.smi_parser import parse_smi


SAMPLE_SMI = """\
<SAMI>
<BODY>
<SYNC Start=2000><P Class=KRCC>Downloaded from<br>YTS.MX
<SYNC Start=7000><P Class=KRCC>&nbsp;
<SYNC Start=29821><P Class=KRCC>Huntrix!
<SYNC Start=33658><P Class=KRCC>&nbsp;
<SYNC Start=45545><P Class=KRCC>Huntrix!
</BODY>
</SAMI>
"""


def test_parse_smi_returns_list():
    result = parse_smi(SAMPLE_SMI)
    assert isinstance(result, list)
    assert len(result) == 3


def test_parse_smi_entry_fields():
    result = parse_smi(SAMPLE_SMI)
    entry = result[0]
    assert entry["index"] == 1
    assert entry["start"] == "00:00:02,000"
    assert entry["end"] == "00:00:07,000"
    assert entry["text"] == "Downloaded from\nYTS.MX"


def test_parse_smi_strips_tags_and_entities():
    result = parse_smi(SAMPLE_SMI)
    entry = result[1]
    assert entry["text"] == "Huntrix!"


def test_parse_smi_empty_string():
    result = parse_smi("")
    assert result == []


def test_parse_smi_no_sync_tags():
    result = parse_smi("<SAMI><BODY>no sync here</BODY></SAMI>")
    assert result == []


def test_parse_smi_br_becomes_newline():
    smi = "<SYNC Start=1000><P Class=KRCC>Line one<br>Line two"
    result = parse_smi(smi)
    assert result[0]["text"] == "Line one\nLine two"
