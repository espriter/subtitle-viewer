# Data Engineer Study Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the first slice of Data Engineer study mode: chapter-aware navigation and a documented study-note data model.

**Architecture:** Keep the app file-system based. Add a small chapter metadata service that reads `chapters.json` first and falls back to embedded MP3 chapters through `ffprobe`; expose it through FastAPI and render the normalized chapter list in the existing file selection view.

**Tech Stack:** FastAPI, Python standard library, pytest, vanilla HTML/CSS/JS, browser localStorage.

---

### Task 1: Chapter Metadata API

**Files:**
- Create: `app/chapter_metadata.py`
- Create: `tests/test_chapters.py`
- Modify: `app/main.py`

**Step 1: Write the failing test**

Add tests for:
- `GET /api/movies/example/chapters` returns normalized sidecar chapters.
- missing sidecar and missing MP3 returns `[]`.
- invalid movie name returns `400` or `404`.

**Step 2: Run test to verify it fails**

Run:

```bash
venv/bin/python -m pytest tests/test_chapters.py -v
```

Expected: FAIL because the endpoint does not exist.

**Step 3: Implement minimal backend**

Create `app/chapter_metadata.py` with sidecar parsing, seconds formatting, and optional `ffprobe` fallback. Add `/api/movies/{movie}/chapters` to `app/main.py`.

**Step 4: Run test to verify it passes**

Run:

```bash
venv/bin/python -m pytest tests/test_chapters.py -v
```

Expected: PASS.

### Task 2: Chapter Picker Frontend

**Files:**
- Modify: `app/static/index.html`
- Modify: `app/static/app.js`
- Modify: `app/static/style.css`

**Step 1: Add UI structure**

Add a hidden `chapter-section` to the file selection view with a chapter list container.

**Step 2: Wire API state**

Add `api.getChapters(movie)`, `state.chapters`, and `state.selectedChapter`.

**Step 3: Render chapter cards**

Render chapter cards after movie selection. Tapping a card toggles selected state.

**Step 4: Start reader at selected chapter**

After subtitles load, find the nearest primary subtitle to `chapter.start_seconds`, set `state.position`, and set audio `currentTime` when audio exists.

**Step 5: Verify JavaScript syntax**

Run:

```bash
node --check app/static/app.js
```

Expected: no syntax errors.

### Task 3: Documentation Update

**Files:**
- Modify: `docs/README.md`

**Step 1: Document the feature**

Add chapter navigation and optional `chapters.json` to features and folder structure.

**Step 2: Document the study-note model**

Add a short "Data Engineer Study Mode" section describing chapter navigation now and later notes/export.

### Task 4: Verification

**Files:**
- No code changes.

**Step 1: Run focused tests**

```bash
venv/bin/python -m pytest tests/test_chapters.py -v
```

**Step 2: Run full tests**

```bash
venv/bin/python -m pytest tests/ -v
```

**Step 3: Run JS syntax check**

```bash
node --check app/static/app.js
```

**Step 4: Inspect git diff**

```bash
git diff -- app tests docs/plans docs/README.md
```
