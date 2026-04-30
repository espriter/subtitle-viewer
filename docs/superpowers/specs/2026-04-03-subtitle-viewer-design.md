# Subtitle Viewer — Design Spec

**Date:** 2026-04-03
**Status:** Draft

## 1. Overview

A mobile-first web application for reading SRT subtitle files with large text.
Users navigate subtitles manually (prev/next) without video synchronization.
Supports dual subtitles (e.g., Korean + English) displayed simultaneously in card blocks.

### Key Use Case

- User places SRT files in server folders organized by movie
- Opens the web app on mobile (Safari via mTLS)
- Selects a movie, picks 1 or 2 subtitle files
- Reads subtitles in large font, navigating with arrows or swipe gestures
- Optionally plays the video/audio separately (out of scope for this app)

## 2. Architecture

```
[Browser] <--HTTPS--> [nginx :443 /subtitle/] <--proxy--> [FastAPI :8091]
                                                              |-- API (SRT parsing, file listing, upload)
                                                              |-- Static files (HTML/CSS/JS)

[Filesystem]
/srv/subtitle-viewer/subtitles/
  +-- {movie-name}/
      |-- en.srt
      +-- ko.srt
```

- **Backend:** FastAPI (Python), running on `0.0.0.0:8091`, `root_path="/subtitle"` for nginx sub-path proxying
- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Reverse proxy:** nginx `/subtitle/` -> `http://127.0.0.1:8091`
- **Process manager:** systemd service (same pattern as adsb-online-api)
- **No Docker** — direct systemd for simplicity

## 3. API Design

**Base path:** `/subtitle/api/`

### Core Endpoints (read-only)

| Endpoint | Method | Response | Description |
|----------|--------|----------|-------------|
| `/api/movies` | GET | `["terminator", "inception"]` | List movie folders |
| `/api/movies/{name}/files` | GET | `["en.srt", "ko.srt"]` | List SRT files in movie folder |
| `/api/movies/{name}/subtitles/{file}` | GET | `[{index, start, end, text}, ...]` | Parse SRT, return JSON array |

### Upload Endpoints (modular, can be disabled)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/movies` | POST | Create movie folder (`{"name": "terminator"}`) |
| `/api/movies/{name}/upload` | POST | Upload SRT file (multipart) |

### SRT Parse Response Format

```json
[
  {
    "index": 1,
    "start": "00:01:23,456",
    "end": "00:01:25,789",
    "text": "I'll be back."
  }
]
```

- Timecodes included for reference (no auto-sync, but available for future use)
- Multi-line subtitle text joined with `\n`
- Encoding: UTF-8 assumed, latin-1 fallback

## 4. Upload Module — Modular Design

Upload functionality is isolated in a separate FastAPI router module (`upload_router.py`).

**Toggle mechanism:**
```python
# main.py
ENABLE_UPLOAD = os.getenv("SUBTITLE_ENABLE_UPLOAD", "true").lower() == "true"

if ENABLE_UPLOAD:
    from app.upload_router import router as upload_router
    app.include_router(upload_router)
```

- **Enable:** `SUBTITLE_ENABLE_UPLOAD=true` (default)
- **Disable:** `SUBTITLE_ENABLE_UPLOAD=false` in systemd env or .env
- When disabled, upload endpoints return 404 (router not mounted)
- Frontend hides upload UI when upload endpoints are unavailable

**Security constraints (when enabled):**
- `.srt` extension only
- Max file size: 1MB
- Folder/file name sanitize: alphanumeric, hyphens, underscores only (path traversal prevention)
- Writes restricted to `subtitles/` directory

## 5. Frontend UI/UX

### 5.1 Views (SPA with JS view switching)

**View 1 — Movie Selection**
- List of movie folders as cards
- Tap to enter file selection
- Upload button: create new movie folder (when upload enabled)

**View 2 — Subtitle File Selection**
- List SRT files for the selected movie
- Select 1 or 2 files (dual subtitle mode)
- Upload button: add SRT to this movie (when upload enabled)
- "Start" button to enter viewer

**View 3 — [Subtitle Viewer](../../README.md) (main)**
- Dark theme, mobile-first
- Card block layout: each language in a separate card with distinct background
- Dual subtitle: top card (subtitle 1) + bottom card (subtitle 2)
- Single subtitle: one centered card

### 5.2 Navigation

- **Arrow buttons** (fixed at bottom): prev / next
- **Swipe gestures**: left = next, right = previous
- **Position indicator**: e.g., `3 / 142`

### 5.3 Settings (in-viewer controls)

| Setting | Options | Default |
|---------|---------|---------|
| Lines per view | 1 / 2 / 3 | 1 |
| Navigation mode | Page / Sliding | Page |
| Font size | +/- buttons or slider | Medium |

**Page mode:** 3 lines = show 1-2-3, then 4-5-6 (no overlap)
**Sliding mode:** 3 lines = show 1-2-3, then 2-3-4 (1-line shift, context preserved)

Settings persisted in `localStorage`.

### 5.4 Visual Design

- Dark background (`#1a1a2e` or similar)
- Subtitle 1 card: dark gray background (`#222`), white text
- Subtitle 2 card: dark blue background (`#1a2a3a`), light blue text (`#8ab4f8`)
- Large, readable font (system sans-serif)
- Minimal chrome — subtitle text is the focus

## 6. Project Structure

```
/srv/subtitle-viewer/
|-- app/
|   |-- main.py              # FastAPI app, core routers, static file serving
|   |-- srt_parser.py        # SRT parsing logic
|   |-- upload_router.py     # Upload endpoints (modular, toggleable)
|   +-- static/
|       |-- index.html        # SPA shell
|       |-- style.css         # Dark theme, mobile-first
|       +-- app.js            # View switching, subtitle navigation, settings
|-- subtitles/                # Runtime data (SRT files, gitignored)
|-- requirements.txt          # fastapi, uvicorn, python-multipart
|-- docs/
|   +-- superpowers/specs/
|       +-- 2026-04-03-subtitle-viewer-design.md
+-- .gitignore
```

## 7. Deployment

### Port & Path
- **Port:** 8091 (no conflict with existing services)
- **nginx path:** `/subtitle/`

### nginx config addition
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

### systemd service
```ini
[Unit]
Description=Subtitle Viewer
After=network.target

[Service]
Type=simple
User=espriter
WorkingDirectory=/srv/subtitle-viewer
ExecStart=/srv/subtitle-viewer/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8091
Environment=SUBTITLE_ENABLE_UPLOAD=true
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## 8. Out of Scope

- Video/audio playback or synchronization
- SMI subtitle format (future addition if needed)
- Auto timecode sync
- User authentication (relies on nginx mTLS + basic auth)
- Multi-user state or database

## 9. Future Considerations

- SMI format support
- Bookmark / progress tracking per movie
- Search within subtitles
- Auto-advance with timecode (if video sync becomes feasible)
