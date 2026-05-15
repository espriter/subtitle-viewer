# Data Engineer Study Mode Design

**Date:** 2026-05-15
**Status:** Approved for first implementation slice

## Context

Subtitle Viewer is currently a mobile-first subtitle and MP3 learning tool. It already has the primitives needed for study: subtitle parsing, dual-language reading, MP3 sync, A-B loop playback, and session resume.

The career direction from `/srv/recruitment/data/profile/career_profile.md` is Data Engineer first, with adjacent Data Platform, AI/Data Platform, Marketing Data Platform, Analytics Engineer, and fintech data roles. The key gaps to close are production-grade streaming/Kafka evidence, product analytics/metric ownership, governance/security/auditability, and modern lakehouse platform fluency such as Databricks, Snowflake, PySpark, and orchestration.

LifeOS currently has the career Objective `실수 적은 와디즈 데엔 업무 2026`, but no connected FCS. This work should stay small enough to attach as a short FCS, not become a permanent knowledge base by itself.

## Goal

Extend Subtitle Viewer into a practical Data Engineer study tool that turns technical audio/subtitle material into reviewable evidence: chapter navigation, subtitle-linked notes, and exportable learning artifacts.

## Recommended Approach

Build a "study mode" on top of the existing app instead of creating a new service.

This preserves the working mobile/audio/loop behavior and adds only the data structures needed for career study. The first slice should focus on chapter-aware navigation because the existing MP3 files already contain chapter metadata for some content, and chapter boundaries are the natural unit for focused study sessions.

## Scope

### First Slice

- Backend endpoint for per-movie chapters.
- Sidecar `chapters.json` support so chapters can be supplied manually when MP3 metadata is absent.
- MP3 embedded chapter fallback using `ffprobe` when available.
- Frontend chapter list in the file selection view.
- Optional chapter selection before starting the reader.
- Reader starts at the nearest subtitle for the selected chapter.
- Documentation for the note/bookmark data model, without building a full notes UI yet.

### Later Slices

- Subtitle-linked bookmarks and notes.
- Topic tags: `Spark`, `Kafka`, `Snowflake`, `Databricks`, `SQL`, `System Design`, `Governance`, `Interview STAR`.
- Export to Markdown/JSON for LifeOS FCS and recruitment profile updates.
- Study dashboard: reviewed chapters, unresolved notes, interview-ready STAR snippets.
- Optional transcript search and concept index.

## Architecture

The backend stays file-system based. Each movie folder may include:

```text
subtitles/{movie}/
  audio.mp3
  en.srt
  ko.srt
  chapters.json
```

`chapters.json` is a sidecar file with a simple schema:

```json
[
  {"title": "Spark shuffle basics", "start": 0, "end": 420},
  {"title": "Structured Streaming checkpoints", "start": 420, "end": 900}
]
```

The API normalizes sidecar and MP3-derived chapters into:

```json
[
  {
    "index": 1,
    "title": "Spark shuffle basics",
    "start_seconds": 0.0,
    "end_seconds": 420.0,
    "start": "00:00:00.000",
    "end": "00:07:00.000"
  }
]
```

The frontend stores the selected chapter in memory only. Session resume remains unchanged and takes precedence when the user explicitly chooses "최근 이어보기".

## Data Engineer Study Fit

The study mode should bias toward evidence that can later be converted into interview preparation:

- `concept`: what was studied.
- `system`: which platform or component it maps to.
- `failure_mode`: what can break in production.
- `operator_action`: how to monitor, retry, backfill, govern, or debug it.
- `resume_signal`: how it connects to Wadiz work or personal projects.

This mirrors common DE interview expectations: ingestion, transformation, storage, orchestration, monitoring, optimization, security, and governance.

## Testing

Backend tests cover:

- sidecar chapter loading;
- fallback to empty list when no chapters exist;
- invalid movie names;
- API shape and time formatting.

Frontend verification for the first slice is lightweight:

- `node --check app/static/app.js`;
- manual smoke through the local server if needed.

## Open Decisions

- Whether notes should live only in browser `localStorage` or be written to server-side sidecar files.
- Whether exported Markdown should target `/srv/recruitment`, `/srv/life_os`, or both.
- Whether MP3 splitting should be implemented as a separate offline script or kept out of the web app.
