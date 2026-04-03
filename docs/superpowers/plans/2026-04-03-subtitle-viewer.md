# Subtitle Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first SRT subtitle reader web app with dual-subtitle support, card-block layout, and modular upload functionality.

**Architecture:** FastAPI backend serves a vanilla JS SPA. SRT files are stored in `subtitles/{movie}/` folders on the filesystem. nginx reverse-proxies `/subtitle/` to the FastAPI app on port 8091. Upload endpoints live in a separate router module toggled by env var.

**Tech Stack:** Python 3, FastAPI, uvicorn, vanilla HTML/CSS/JS

---

## File Map

```
/srv/subtitle-viewer/
├── app/
│   ├── __init__.py              # Empty package marker
│   ├── main.py                  # FastAPI app, core routers, static mount
│   ├── srt_parser.py            # SRT file parsing logic
│   ├── upload_router.py         # Upload endpoints (modular)
│   └── static/
│       ├── index.html           # SPA shell
│       ├── style.css            # Dark theme, mobile-first
│       └── app.js               # View switching, navigation, settings
├── tests/
│   ├── __init__.py
│   ├── test_srt_parser.py       # SRT parser unit tests
│   ├── test_api.py              # Core API endpoint tests
│   └── test_upload.py           # Upload endpoint tests
├── subtitles/                   # Runtime data (gitignored)
│   └── example/
│       ├── en.srt               # Sample English subtitle
│       └── ko.srt               # Sample Korean subtitle
├── ops/
│   ├── run.sh                   # Uvicorn launcher script
│   └── systemd/
│       └── subtitle-viewer.service
├── requirements.txt
├── .gitignore
└── docs/
```

---

### Task 1: Project Scaffold and SRT Parser

**Files:**
- Create: `app/__init__.py`
- Create: `app/srt_parser.py`
- Create: `tests/__init__.py`
- Create: `tests/test_srt_parser.py`
- Create: `requirements.txt`
- Create: `.gitignore`
- Create: `subtitles/example/en.srt`
- Create: `subtitles/example/ko.srt`

- [ ] **Step 1: Initialize project with venv and dependencies**

```bash
cd /srv/subtitle-viewer
python3 -m venv venv
source venv/bin/activate
```

Create `requirements.txt`:
```
fastapi>=0.115.0,<1.0
uvicorn[standard]>=0.30.0,<1.0
python-multipart>=0.0.9,<1.0
pytest>=8.0
httpx>=0.27.0
```

Create `.gitignore`:
```
venv/
__pycache__/
*.pyc
subtitles/
.superpowers/
```

```bash
pip install -r requirements.txt
```

- [ ] **Step 2: Create sample SRT files for testing**

Create `subtitles/example/en.srt`:
```
1
00:00:02,000 --> 00:00:07,000
Downloaded from
YTS.MX

2
00:00:08,000 --> 00:00:13,000
Official YIFY movies site:
YTS.MX

3
00:00:29,821 --> 00:00:33,658
Huntrix!

4
00:00:33,742 --> 00:00:39,706
Huntrix!

5
00:00:45,545 --> 00:00:46,838
Huntrix!
```

Create `subtitles/example/ko.srt`:
```
1
00:00:02,000 --> 00:00:07,000
Downloaded from
YTS.MX

2
00:00:08,000 --> 00:00:13,000
Official YIFY movies site:
YTS.MX

3
00:00:29,821 --> 00:00:33,658
헌트릭스!

4
00:00:33,742 --> 00:00:39,706
헌트릭스!

5
00:00:45,545 --> 00:00:46,838
헌트릭스!
```

- [ ] **Step 3: Write failing tests for SRT parser**

Create `app/__init__.py` (empty file).

Create `tests/__init__.py` (empty file).

Create `tests/test_srt_parser.py`:
```python
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
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
cd /srv/subtitle-viewer
venv/bin/python -m pytest tests/test_srt_parser.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.srt_parser'`

- [ ] **Step 5: Implement SRT parser**

Create `app/srt_parser.py`:
```python
import re

_TIMECODE_PATTERN = re.compile(
    r"(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})"
)


def parse_srt(content: str) -> list[dict]:
    """Parse SRT subtitle content into a list of subtitle entries."""
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
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /srv/subtitle-viewer
venv/bin/python -m pytest tests/test_srt_parser.py -v
```

Expected: All 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /srv/subtitle-viewer
git init
git add app/__init__.py app/srt_parser.py tests/__init__.py tests/test_srt_parser.py requirements.txt .gitignore
git commit -m "feat: add SRT parser with tests"
```

---

### Task 2: Core API Endpoints

**Files:**
- Create: `app/main.py`
- Create: `tests/test_api.py`

- [ ] **Step 1: Write failing tests for core API**

Create `tests/test_api.py`:
```python
import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    """Create test client with a temporary subtitles directory."""
    # Set up test subtitles
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
    resp = client.get("/api/movies/../etc/files")
    assert resp.status_code == 400


def test_path_traversal_file_name(client):
    resp = client.get("/api/movies/example/subtitles/../../etc/passwd")
    assert resp.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /srv/subtitle-viewer
venv/bin/python -m pytest tests/test_api.py -v
```

Expected: FAIL — `ImportError: cannot import name 'create_app' from 'app.main'`

- [ ] **Step 3: Implement core API**

Create `app/main.py`:
```python
import os
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from app.srt_parser import parse_srt

_SAFE_NAME = re.compile(r"^[a-zA-Z0-9_\-]+(\.[a-zA-Z0-9]+)?$")

DEFAULT_SUBTITLES_DIR = Path(__file__).resolve().parent.parent / "subtitles"


def _validate_name(name: str) -> None:
    if not _SAFE_NAME.match(name):
        raise HTTPException(status_code=400, detail=f"Invalid name: {name}")


def create_app(
    *,
    subtitles_dir: Path | None = None,
    root_path: str = "",
) -> FastAPI:
    subs_dir = subtitles_dir or DEFAULT_SUBTITLES_DIR

    app = FastAPI(title="Subtitle Viewer", root_path=root_path)

    @app.get("/api/movies")
    def list_movies():
        if not subs_dir.exists():
            return []
        return sorted(
            d.name for d in subs_dir.iterdir() if d.is_dir()
        )

    @app.get("/api/movies/{movie}/files")
    def list_files(movie: str):
        _validate_name(movie)
        movie_dir = subs_dir / movie
        if not movie_dir.is_dir():
            raise HTTPException(status_code=404, detail="Movie not found")
        return sorted(
            f.name for f in movie_dir.iterdir()
            if f.is_file() and f.suffix == ".srt"
        )

    @app.get("/api/movies/{movie}/subtitles/{filename}")
    def get_subtitles(movie: str, filename: str):
        _validate_name(movie)
        _validate_name(filename)
        filepath = subs_dir / movie / filename
        if not filepath.is_file():
            raise HTTPException(status_code=404, detail="Subtitle file not found")
        try:
            content = filepath.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            content = filepath.read_text(encoding="latin-1")
        return parse_srt(content)

    # Static files — mount last so API routes take priority
    static_dir = Path(__file__).resolve().parent / "static"
    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app


def create_default_app() -> FastAPI:
    """Production factory — called by uvicorn --factory."""
    root_path = os.getenv("SUBTITLE_ROOT_PATH", "/subtitle")
    enable_upload = os.getenv("SUBTITLE_ENABLE_UPLOAD", "true").lower() == "true"

    app = create_app(root_path=root_path)

    if enable_upload:
        from app.upload_router import create_upload_router
        app.include_router(create_upload_router(DEFAULT_SUBTITLES_DIR))

    return app
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /srv/subtitle-viewer
venv/bin/python -m pytest tests/test_api.py -v
```

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /srv/subtitle-viewer
git add app/main.py tests/test_api.py
git commit -m "feat: add core API endpoints with path traversal protection"
```

---

### Task 3: Upload Router Module

**Files:**
- Create: `app/upload_router.py`
- Create: `tests/test_upload.py`

- [ ] **Step 1: Write failing tests for upload endpoints**

Create `tests/test_upload.py`:
```python
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
    """Client without upload router — simulates SUBTITLE_ENABLE_UPLOAD=false."""
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
    large_content = b"x" * (1024 * 1024 + 1)  # 1MB + 1 byte
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /srv/subtitle-viewer
venv/bin/python -m pytest tests/test_upload.py -v
```

Expected: FAIL — `ImportError: cannot import name 'create_upload_router'`

- [ ] **Step 3: Implement upload router**

Create `app/upload_router.py`:
```python
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

_SAFE_NAME = re.compile(r"^[a-zA-Z0-9_\-]+(\.[a-zA-Z0-9]+)?$")
_MAX_FILE_SIZE = 1024 * 1024  # 1MB


class CreateMovieRequest(BaseModel):
    name: str


def create_upload_router(subtitles_dir: Path) -> APIRouter:
    router = APIRouter()

    @router.post("/api/movies", status_code=201)
    def create_movie(req: CreateMovieRequest):
        if not _SAFE_NAME.match(req.name):
            raise HTTPException(status_code=400, detail=f"Invalid name: {req.name}")
        movie_dir = subtitles_dir / req.name
        if movie_dir.exists():
            raise HTTPException(status_code=409, detail="Movie folder already exists")
        movie_dir.mkdir(parents=True)
        return {"created": req.name}

    @router.post("/api/movies/{movie}/upload", status_code=201)
    async def upload_srt(movie: str, file: UploadFile = File(...)):
        if not _SAFE_NAME.match(movie):
            raise HTTPException(status_code=400, detail=f"Invalid name: {movie}")

        movie_dir = subtitles_dir / movie
        if not movie_dir.is_dir():
            raise HTTPException(status_code=404, detail="Movie not found")

        if not file.filename or not file.filename.endswith(".srt"):
            raise HTTPException(status_code=400, detail="Only .srt files allowed")

        if not _SAFE_NAME.match(file.filename):
            raise HTTPException(status_code=400, detail=f"Invalid filename: {file.filename}")

        content = await file.read()
        if len(content) > _MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 1MB)")

        (movie_dir / file.filename).write_bytes(content)
        return {"uploaded": file.filename}

    return router
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /srv/subtitle-viewer
venv/bin/python -m pytest tests/test_upload.py -v
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Run all tests**

```bash
cd /srv/subtitle-viewer
venv/bin/python -m pytest tests/ -v
```

Expected: All 22 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /srv/subtitle-viewer
git add app/upload_router.py tests/test_upload.py
git commit -m "feat: add modular upload router with security constraints"
```

---

### Task 4: Frontend — HTML Shell and CSS

**Files:**
- Create: `app/static/index.html`
- Create: `app/static/style.css`

- [ ] **Step 1: Create HTML shell**

Create `app/static/index.html`:
```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>Subtitle Viewer</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <!-- View 1: Movie Selection -->
    <div id="view-movies" class="view active">
        <header>
            <h1>Subtitle Viewer</h1>
        </header>
        <div id="movie-list" class="card-list"></div>
    </div>

    <!-- View 2: File Selection -->
    <div id="view-files" class="view">
        <header>
            <button id="btn-back-movies" class="btn-icon">&larr;</button>
            <h1 id="movie-title"></h1>
        </header>
        <p class="hint">Select 1 or 2 subtitle files</p>
        <div id="file-list" class="card-list"></div>
        <div id="upload-section">
            <label class="btn btn-secondary">
                Upload .srt
                <input type="file" id="file-upload" accept=".srt" hidden>
            </label>
        </div>
        <button id="btn-start" class="btn btn-primary" disabled>Start</button>
    </div>

    <!-- View 3: Subtitle Viewer -->
    <div id="view-reader" class="view">
        <header>
            <button id="btn-back-files" class="btn-icon">&larr;</button>
            <span id="position-indicator">1 / 1</span>
            <button id="btn-settings" class="btn-icon">&#9881;</button>
        </header>

        <div id="subtitle-display">
            <div id="card-primary" class="subtitle-card primary"></div>
            <div id="card-secondary" class="subtitle-card secondary"></div>
        </div>

        <nav id="nav-controls">
            <button id="btn-prev" class="btn-nav">&larr;</button>
            <button id="btn-next" class="btn-nav">&rarr;</button>
        </nav>

        <!-- Settings Panel -->
        <div id="settings-panel" class="panel hidden">
            <div class="setting-row">
                <label>Lines per view</label>
                <div class="btn-group">
                    <button class="btn-option" data-lines="1">1</button>
                    <button class="btn-option" data-lines="2">2</button>
                    <button class="btn-option" data-lines="3">3</button>
                </div>
            </div>
            <div class="setting-row">
                <label>Navigation mode</label>
                <div class="btn-group">
                    <button class="btn-option" data-mode="page">Page</button>
                    <button class="btn-option" data-mode="slide">Slide</button>
                </div>
            </div>
            <div class="setting-row">
                <label>Font size</label>
                <div class="btn-group">
                    <button id="btn-font-down" class="btn-option">A-</button>
                    <span id="font-size-display">24px</span>
                    <button id="btn-font-up" class="btn-option">A+</button>
                </div>
            </div>
        </div>
    </div>

    <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create CSS**

Create `app/static/style.css`:
```css
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

:root {
    --bg: #1a1a2e;
    --surface: #222;
    --surface-alt: #1a2a3a;
    --text: #ffffff;
    --text-secondary: #8ab4f8;
    --text-muted: #888;
    --accent: #4a9eff;
    --font-size: 24px;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100dvh;
    overflow-x: hidden;
}

/* Views */
.view {
    display: none;
    padding: 16px;
    max-width: 600px;
    margin: 0 auto;
}

.view.active {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
}

/* Header */
header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    margin-bottom: 16px;
}

header h1 {
    font-size: 20px;
    font-weight: 600;
    flex: 1;
}

/* Card List */
.card-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
}

.card-item {
    background: var(--surface);
    border-radius: 12px;
    padding: 16px;
    cursor: pointer;
    transition: background 0.15s;
    font-size: 16px;
}

.card-item:active {
    background: var(--surface-alt);
}

.card-item.selected {
    outline: 2px solid var(--accent);
}

/* Hint */
.hint {
    color: var(--text-muted);
    font-size: 14px;
    margin-bottom: 12px;
}

/* Subtitle Cards */
#subtitle-display {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 12px;
    padding: 16px 0;
}

.subtitle-card {
    border-radius: 12px;
    padding: 24px;
    font-size: var(--font-size);
    line-height: 1.5;
    text-align: center;
    word-break: keep-all;
    overflow-wrap: break-word;
}

.subtitle-card.primary {
    background: var(--surface);
    color: var(--text);
}

.subtitle-card.secondary {
    background: var(--surface-alt);
    color: var(--text-secondary);
}

.subtitle-card:empty {
    display: none;
}

/* Navigation */
#nav-controls {
    display: flex;
    gap: 16px;
    padding: 16px 0;
    justify-content: center;
}

.btn-nav {
    width: 80px;
    height: 56px;
    border-radius: 12px;
    border: none;
    background: var(--surface);
    color: var(--text);
    font-size: 24px;
    cursor: pointer;
    transition: background 0.15s;
}

.btn-nav:active {
    background: var(--accent);
}

/* Buttons */
.btn {
    border: none;
    border-radius: 12px;
    padding: 14px 24px;
    font-size: 16px;
    cursor: pointer;
    transition: background 0.15s;
}

.btn-primary {
    background: var(--accent);
    color: white;
    margin-top: 16px;
}

.btn-primary:disabled {
    opacity: 0.4;
    cursor: default;
}

.btn-secondary {
    background: var(--surface);
    color: var(--text);
    display: inline-block;
    text-align: center;
    margin-top: 12px;
}

.btn-icon {
    background: none;
    border: none;
    color: var(--text);
    font-size: 24px;
    cursor: pointer;
    padding: 4px 8px;
}

/* Settings */
.panel {
    background: var(--surface);
    border-radius: 12px;
    padding: 16px;
    margin-top: 12px;
}

.panel.hidden {
    display: none;
}

.setting-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0;
}

.setting-row label {
    font-size: 14px;
    color: var(--text-muted);
}

.btn-group {
    display: flex;
    gap: 6px;
    align-items: center;
}

.btn-option {
    background: var(--bg);
    border: 1px solid var(--text-muted);
    border-radius: 8px;
    color: var(--text);
    padding: 6px 12px;
    font-size: 14px;
    cursor: pointer;
}

.btn-option.active {
    background: var(--accent);
    border-color: var(--accent);
}

#font-size-display {
    font-size: 14px;
    color: var(--text-muted);
    min-width: 40px;
    text-align: center;
}

#position-indicator {
    font-size: 14px;
    color: var(--text-muted);
}

/* Upload */
#upload-section {
    text-align: center;
}

/* Responsive */
@media (min-width: 768px) {
    .btn-nav {
        width: 100px;
        height: 64px;
    }
}
```

- [ ] **Step 3: Verify static files serve correctly**

```bash
cd /srv/subtitle-viewer
venv/bin/python -c "
from app.main import create_app
from fastapi.testclient import TestClient
from pathlib import Path
app = create_app(subtitles_dir=Path('subtitles'))
client = TestClient(app)
resp = client.get('/')
print(f'Status: {resp.status_code}')
print(f'Has Subtitle Viewer: {\"Subtitle Viewer\" in resp.text}')
resp2 = client.get('/style.css')
print(f'CSS Status: {resp2.status_code}')
"
```

Expected: Status 200, `Has Subtitle Viewer: True`, CSS Status 200.

- [ ] **Step 4: Commit**

```bash
cd /srv/subtitle-viewer
git add app/static/index.html app/static/style.css
git commit -m "feat: add HTML shell and dark theme CSS"
```

---

### Task 5: Frontend — JavaScript Application

**Files:**
- Create: `app/static/app.js`

- [ ] **Step 1: Implement app.js**

Create `app/static/app.js`:
```javascript
(function () {
    "use strict";

    // --- State ---
    const state = {
        movies: [],
        currentMovie: null,
        files: [],
        selectedFiles: [],
        subtitles: { primary: [], secondary: [] },
        position: 0,
        settings: {
            linesPerView: 1,
            navMode: "page", // "page" or "slide"
            fontSize: 24,
        },
        uploadEnabled: true,
    };

    // --- API ---
    const api = {
        async getMovies() {
            const resp = await fetch("api/movies");
            return resp.json();
        },
        async getFiles(movie) {
            const resp = await fetch(`api/movies/${encodeURIComponent(movie)}/files`);
            return resp.json();
        },
        async getSubtitles(movie, file) {
            const resp = await fetch(
                `api/movies/${encodeURIComponent(movie)}/subtitles/${encodeURIComponent(file)}`
            );
            return resp.json();
        },
        async createMovie(name) {
            const resp = await fetch("api/movies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });
            return resp;
        },
        async uploadFile(movie, file) {
            const form = new FormData();
            form.append("file", file);
            const resp = await fetch(
                `api/movies/${encodeURIComponent(movie)}/upload`,
                { method: "POST", body: form }
            );
            return resp;
        },
    };

    // --- DOM refs ---
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const views = {
        movies: $("#view-movies"),
        files: $("#view-files"),
        reader: $("#view-reader"),
    };

    // --- View switching ---
    function showView(name) {
        Object.values(views).forEach((v) => v.classList.remove("active"));
        views[name].classList.add("active");
    }

    // --- View 1: Movies ---
    async function loadMovies() {
        state.movies = await api.getMovies();
        const list = $("#movie-list");
        list.innerHTML = "";
        state.movies.forEach((movie) => {
            const el = document.createElement("div");
            el.className = "card-item";
            el.textContent = movie;
            el.addEventListener("click", () => selectMovie(movie));
            list.appendChild(el);
        });

        // Check if upload is available
        try {
            const resp = await fetch("api/movies", { method: "OPTIONS" });
            state.uploadEnabled = resp.ok;
        } catch {
            state.uploadEnabled = false;
        }
    }

    // --- View 2: Files ---
    async function selectMovie(movie) {
        state.currentMovie = movie;
        state.selectedFiles = [];
        $("#movie-title").textContent = movie;
        state.files = await api.getFiles(movie);
        renderFileList();
        updateUploadVisibility();
        showView("files");
    }

    function renderFileList() {
        const list = $("#file-list");
        list.innerHTML = "";
        state.files.forEach((file) => {
            const el = document.createElement("div");
            el.className = "card-item";
            el.textContent = file;
            el.addEventListener("click", () => toggleFileSelection(file, el));
            if (state.selectedFiles.includes(file)) {
                el.classList.add("selected");
            }
            list.appendChild(el);
        });
        updateStartButton();
    }

    function toggleFileSelection(file, el) {
        const idx = state.selectedFiles.indexOf(file);
        if (idx >= 0) {
            state.selectedFiles.splice(idx, 1);
            el.classList.remove("selected");
        } else if (state.selectedFiles.length < 2) {
            state.selectedFiles.push(file);
            el.classList.add("selected");
        }
        updateStartButton();
    }

    function updateStartButton() {
        $("#btn-start").disabled = state.selectedFiles.length === 0;
    }

    function updateUploadVisibility() {
        const section = $("#upload-section");
        if (section) {
            section.style.display = state.uploadEnabled ? "" : "none";
        }
    }

    // --- View 3: Reader ---
    async function startReader() {
        state.subtitles.primary = await api.getSubtitles(
            state.currentMovie,
            state.selectedFiles[0]
        );
        state.subtitles.secondary =
            state.selectedFiles.length > 1
                ? await api.getSubtitles(state.currentMovie, state.selectedFiles[1])
                : [];
        state.position = 0;
        renderSubtitles();
        showView("reader");
    }

    function getVisibleEntries(subs) {
        const { linesPerView } = state.settings;
        const start = state.position;
        const end = Math.min(start + linesPerView, subs.length);
        return subs.slice(start, end);
    }

    function renderSubtitles() {
        const primary = getVisibleEntries(state.subtitles.primary);
        const secondary = getVisibleEntries(state.subtitles.secondary);

        $("#card-primary").innerHTML = primary
            .map((e) => `<div>${e.text.replace(/\n/g, "<br>")}</div>`)
            .join("");

        $("#card-secondary").innerHTML = secondary
            .map((e) => `<div>${e.text.replace(/\n/g, "<br>")}</div>`)
            .join("");

        const total = state.subtitles.primary.length;
        const current = Math.min(state.position + 1, total);
        $("#position-indicator").textContent = `${current} / ${total}`;
    }

    function navigate(direction) {
        const { linesPerView, navMode } = state.settings;
        const total = state.subtitles.primary.length;
        const step = navMode === "page" ? linesPerView : 1;

        const newPos = state.position + direction * step;
        if (newPos >= 0 && newPos < total) {
            state.position = newPos;
            renderSubtitles();
        }
    }

    // --- Settings ---
    function loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem("subtitle-viewer-settings"));
            if (saved) {
                Object.assign(state.settings, saved);
            }
        } catch {
            // Use defaults
        }
        applySettings();
    }

    function saveSettings() {
        localStorage.setItem(
            "subtitle-viewer-settings",
            JSON.stringify(state.settings)
        );
    }

    function applySettings() {
        document.documentElement.style.setProperty(
            "--font-size",
            state.settings.fontSize + "px"
        );
        $("#font-size-display").textContent = state.settings.fontSize + "px";

        // Highlight active options
        $$("[data-lines]").forEach((btn) => {
            btn.classList.toggle(
                "active",
                parseInt(btn.dataset.lines) === state.settings.linesPerView
            );
        });
        $$("[data-mode]").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.mode === state.settings.navMode);
        });
    }

    // --- Upload ---
    async function handleUpload(fileInput) {
        const file = fileInput.files[0];
        if (!file) return;

        const resp = await api.uploadFile(state.currentMovie, file);
        if (resp.ok) {
            state.files = await api.getFiles(state.currentMovie);
            renderFileList();
        } else {
            const err = await resp.json();
            alert(err.detail || "Upload failed");
        }
        fileInput.value = "";
    }

    // --- Swipe gestures ---
    function setupSwipe() {
        let startX = 0;
        const display = $("#subtitle-display");

        display.addEventListener("touchstart", (e) => {
            startX = e.touches[0].clientX;
        }, { passive: true });

        display.addEventListener("touchend", (e) => {
            const dx = e.changedTouches[0].clientX - startX;
            if (Math.abs(dx) > 50) {
                navigate(dx < 0 ? 1 : -1);
            }
        }, { passive: true });
    }

    // --- Keyboard support ---
    function setupKeyboard() {
        document.addEventListener("keydown", (e) => {
            if (!views.reader.classList.contains("active")) return;
            if (e.key === "ArrowLeft") navigate(-1);
            if (e.key === "ArrowRight") navigate(1);
        });
    }

    // --- Event binding ---
    function bindEvents() {
        $("#btn-back-movies").addEventListener("click", () => {
            showView("movies");
            loadMovies();
        });

        $("#btn-back-files").addEventListener("click", () => {
            showView("files");
        });

        $("#btn-start").addEventListener("click", startReader);
        $("#btn-prev").addEventListener("click", () => navigate(-1));
        $("#btn-next").addEventListener("click", () => navigate(1));

        $("#btn-settings").addEventListener("click", () => {
            $("#settings-panel").classList.toggle("hidden");
        });

        // Lines per view
        $$("[data-lines]").forEach((btn) => {
            btn.addEventListener("click", () => {
                state.settings.linesPerView = parseInt(btn.dataset.lines);
                state.position = 0;
                applySettings();
                saveSettings();
                renderSubtitles();
            });
        });

        // Nav mode
        $$("[data-mode]").forEach((btn) => {
            btn.addEventListener("click", () => {
                state.settings.navMode = btn.dataset.mode;
                applySettings();
                saveSettings();
            });
        });

        // Font size
        $("#btn-font-up").addEventListener("click", () => {
            state.settings.fontSize = Math.min(state.settings.fontSize + 2, 48);
            applySettings();
            saveSettings();
        });
        $("#btn-font-down").addEventListener("click", () => {
            state.settings.fontSize = Math.max(state.settings.fontSize - 2, 14);
            applySettings();
            saveSettings();
        });

        // Upload
        const fileUpload = $("#file-upload");
        if (fileUpload) {
            fileUpload.addEventListener("change", () => handleUpload(fileUpload));
        }

        setupSwipe();
        setupKeyboard();
    }

    // --- Init ---
    function init() {
        loadSettings();
        bindEvents();
        loadMovies();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
```

- [ ] **Step 2: Manual smoke test**

```bash
cd /srv/subtitle-viewer
venv/bin/uvicorn app.main:create_default_app --factory --host 0.0.0.0 --port 8091
```

Open browser at `http://<host>:8091/`. Verify:
1. Movie list shows "example"
2. Tapping "example" shows en.srt and ko.srt
3. Select both files, tap Start
4. Subtitle cards display with navigation working
5. Settings panel toggles font size, lines, nav mode

Stop the server with Ctrl+C after testing.

- [ ] **Step 3: Commit**

```bash
cd /srv/subtitle-viewer
git add app/static/app.js
git commit -m "feat: add frontend JS with dual subtitle viewer"
```

---

### Task 6: Deployment (systemd + nginx)

**Files:**
- Create: `ops/run.sh`
- Create: `ops/systemd/subtitle-viewer.service`

- [ ] **Step 1: Create launcher script**

Create `ops/run.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PYTHON_BIN="${PYTHON_BIN:-${PROJECT_ROOT}/venv/bin/python}"
HOST="${SUBTITLE_HOST:-0.0.0.0}"
PORT="${SUBTITLE_PORT:-8091}"

exec "${PYTHON_BIN}" -m uvicorn \
    app.main:create_default_app \
    --factory \
    --host "${HOST}" \
    --port "${PORT}" \
    --app-dir "${PROJECT_ROOT}"
```

```bash
chmod +x /srv/subtitle-viewer/ops/run.sh
```

- [ ] **Step 2: Create systemd service file**

Create `ops/systemd/subtitle-viewer.service`:
```ini
[Unit]
Description=Subtitle Viewer
After=network.target

[Service]
Type=simple
User=espriter
Group=espriter
WorkingDirectory=/srv/subtitle-viewer
ExecStart=/srv/subtitle-viewer/ops/run.sh
Environment=SUBTITLE_ROOT_PATH=/subtitle
Environment=SUBTITLE_ENABLE_UPLOAD=true
Environment=SUBTITLE_HOST=0.0.0.0
Environment=SUBTITLE_PORT=8091
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Commit**

```bash
cd /srv/subtitle-viewer
mkdir -p ops/systemd
git add ops/run.sh ops/systemd/subtitle-viewer.service
git commit -m "feat: add systemd service and launcher script"
```

- [ ] **Step 4: Install and start service**

```bash
sudo cp /srv/subtitle-viewer/ops/systemd/subtitle-viewer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable subtitle-viewer
sudo systemctl start subtitle-viewer
sudo systemctl status subtitle-viewer
```

Expected: Active (running).

- [ ] **Step 5: Add nginx location block**

Add to `/etc/nginx/sites-available/jupyter-proxy` inside the `server` block:

```nginx
location /subtitle/ {
    proxy_pass http://127.0.0.1:8091/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 2M;
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Expected: `nginx: configuration file /etc/nginx/nginx.conf syntax is ok`

- [ ] **Step 6: Verify end-to-end via nginx**

```bash
curl -k https://localhost/subtitle/ -o /dev/null -w "%{http_code}"
```

Expected: `200` (or `401` if basic auth is configured — that's expected).

- [ ] **Step 7: Commit nginx config note**

No commit needed for nginx config (system config, not project code). Document the required location block in the project README or design doc if needed.

---

### Task 7: Final Integration Test and Cleanup

- [ ] **Step 1: Run full test suite**

```bash
cd /srv/subtitle-viewer
venv/bin/python -m pytest tests/ -v
```

Expected: All tests pass.

- [ ] **Step 2: Verify upload toggle works**

```bash
# Stop service
sudo systemctl stop subtitle-viewer

# Start with upload disabled
SUBTITLE_ENABLE_UPLOAD=false SUBTITLE_ROOT_PATH="" \
  /srv/subtitle-viewer/venv/bin/python -m uvicorn \
  app.main:create_default_app --factory --host 0.0.0.0 --port 8091 &

sleep 2
# POST should return 404 or 405
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8091/api/movies \
  -H "Content-Type: application/json" -d '{"name":"test"}'
# Expected: 404 or 405

kill %1

# Restart normal service
sudo systemctl start subtitle-viewer
```

- [ ] **Step 3: Final commit with sample subtitles tracked**

The `subtitles/` directory is gitignored (runtime data). Sample files are for manual testing only, placed by Task 1 Step 2.

```bash
cd /srv/subtitle-viewer
git log --oneline
```

Expected commit history:
```
feat: add systemd service and launcher script
feat: add frontend JS with dual subtitle viewer
feat: add HTML shell and dark theme CSS
feat: add modular upload router with security constraints
feat: add core API endpoints with path traversal protection
feat: add SRT parser with tests
```
