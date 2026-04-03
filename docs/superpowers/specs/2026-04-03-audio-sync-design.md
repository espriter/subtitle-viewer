# Audio Sync Playback Design

## Overview

MP3 오디오 재생과 SRT 자막 싱크. MP3가 있으면 오디오 재생에 맞춰 자막 자동 이동, 없으면 기존 수동 탐색 유지.

## Folder Structure

```
subtitles/{movie}/
├── en.srt
├── ko.srt
└── audio.mp3    ← optional
```

## Backend Changes

### 1. Update `list_files` endpoint

`GET /api/movies/{movie}/files` — 기존 `.srt`만 반환하던 것을 `.srt`와 `.mp3` 모두 반환.

### 2. New audio streaming endpoint

```
GET /api/movies/{movie}/audio/{filename}
```

- `FileResponse` with `media_type="audio/mpeg"`
- Path traversal 방어: 기존 `_validate_name()` 재사용
- `.mp3` 확장자만 허용
- HTTP Range 요청 지원 (FastAPI `FileResponse` 기본 지원)

### 3. File location

`app/main.py`의 `create_app()` 함수에 엔드포인트 추가.

## Frontend Changes

### 1. HTML (`index.html`)

Reader 뷰 (`#view-reader`)의 `#subtitle-display` 위에 오디오 플레이어 추가:

```html
<div id="audio-container" class="hidden">
    <audio id="audio-player" controls preload="metadata"></audio>
</div>
```

### 2. JavaScript (`app.js`)

#### State 확장
```js
state.audioFile = null;  // e.g. "audio.mp3" or null
```

#### 파일 선택 시 MP3 감지
`selectMovie()` 또는 `startReader()` 시점에 파일 목록에서 `.mp3` 파일 존재 확인.

#### Audio 초기화 (`startReader` / `resumeSession`)
- MP3 있으면: `<audio>` src 설정, `#audio-container` 표시
- MP3 없으면: `#audio-container` 숨김, 기존 동작

#### timeupdate → 자막 싱크
```js
audio.addEventListener('timeupdate', () => {
    const t = audio.currentTime;
    const subs = state.subtitles.primary;
    // start <= t < next.start 범위 매칭
    const idx = findSubtitleAtTime(subs, t);
    if (idx >= 0 && idx !== state.position) {
        state.position = idx;
        renderSubtitles();
    }
});
```

#### 수동 네비게이션 → 오디오 seek (양방향 싱크)
```js
function navigate(direction) {
    // ... existing logic ...
    // After position change:
    if (audio && !audio.paused) {
        const entry = state.subtitles.primary[state.position];
        audio.currentTime = timeToSeconds(entry.start);
    }
}
```

#### `findSubtitleAtTime(subs, seconds)` — 새 함수
- `subs[i].start <= seconds < subs[i+1].start` 인 i 반환
- 마지막 자막이면 `subs[i].start <= seconds <= subs[i].end`
- 매칭 없으면 -1

#### 이어보기 확장
`saveSession()` / `loadSession()`에 `audioTime` 필드 추가.
`resumeSession()`에서 `audio.currentTime = session.audioTime`.

### 3. CSS (`style.css`)

```css
#audio-container {
    padding: 8px 0;
}

#audio-container.hidden {
    display: none;
}

#audio-player {
    width: 100%;
    height: 40px;
    border-radius: 8px;
}
```

### 4. File Selection View

파일 선택 뷰에서 `.mp3` 파일은 선택 리스트에서 제외 (자막 파일만 선택 가능).
MP3는 자동 감지되어 Reader에서 사용됨.

## Error Handling

- MP3 로드 실패 시: 콘솔 경고, 오디오 컨테이너 숨김, 수동 모드로 폴백
- 네트워크 끊김: 자막은 이미 로드되어 있으므로 수동 탐색 계속 가능

## Testing

### Backend Tests
- `GET /api/movies/{movie}/files` — MP3 포함 확인
- `GET /api/movies/{movie}/audio/{filename}` — 200, content-type, Range 요청
- 경로 조작 방어
- MP3 없는 경우 404

### Frontend Integration Tests
- MP3 있을 때 `#audio-container` 표시 확인
- MP3 없을 때 `#audio-container` 숨김 확인
- 세션 저장/복원에 audioTime 포함 확인
