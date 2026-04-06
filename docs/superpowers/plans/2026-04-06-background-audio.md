# Background Audio Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable background audio playback with lock-screen media controls on iOS Safari and Android Chrome.

**Architecture:** Add minimal PWA shell (manifest.json + empty Service Worker) for iOS qualification, plus Media Session API for lock-screen controls and stable background playback. Frontend-only changes — no server modifications.

**Tech Stack:** Web App Manifest, Service Worker API, Media Session API, vanilla JS

---

### Task 1: PWA Manifest and Icons

**Files:**
- Create: `app/static/manifest.json`
- Create: `app/static/icons/icon-192.png`
- Create: `app/static/icons/icon-512.png`

- [ ] **Step 1: Create PWA icons directory and placeholder icons**

Generate minimal PNG icons using ImageMagick (available on server). Simple colored square with "SV" text.

```bash
mkdir -p /srv/subtitle-viewer/app/static/icons
convert -size 192x192 xc:'#302b63' -fill white -gravity center -pointsize 64 -annotate 0 'SV' /srv/subtitle-viewer/app/static/icons/icon-192.png
convert -size 512x512 xc:'#302b63' -fill white -gravity center -pointsize 160 -annotate 0 'SV' /srv/subtitle-viewer/app/static/icons/icon-512.png
```

If ImageMagick is not available, create 1x1 placeholder PNGs via Python:

```bash
python3 -c "
import struct, zlib
def make_png(w, h, r, g, b):
    raw = b''
    for _ in range(h):
        raw += b'\x00' + bytes([r, g, b]) * w
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw)) +
            chunk(b'IEND', b''))
open('app/static/icons/icon-192.png','wb').write(make_png(192,192,48,43,99))
open('app/static/icons/icon-512.png','wb').write(make_png(512,512,48,43,99))
"
```

- [ ] **Step 2: Create manifest.json**

Create `app/static/manifest.json`:

```json
{
    "name": "자막 뷰어",
    "short_name": "자막 뷰어",
    "start_url": ".",
    "display": "standalone",
    "background_color": "#111827",
    "theme_color": "#1a1a2e",
    "icons": [
        {
            "src": "icons/icon-192.png",
            "sizes": "192x192",
            "type": "image/png"
        },
        {
            "src": "icons/icon-512.png",
            "sizes": "512x512",
            "type": "image/png"
        }
    ]
}
```

- [ ] **Step 3: Commit**

```bash
git add app/static/manifest.json app/static/icons/
git commit -m "feat: add PWA manifest and icons for background audio support"
```

---

### Task 2: Minimal Service Worker

**Files:**
- Create: `app/static/sw.js`

- [ ] **Step 1: Create sw.js**

Create `app/static/sw.js`:

```javascript
self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});
```

No fetch handler, no caching. Sole purpose is PWA qualification for iOS.

- [ ] **Step 2: Commit**

```bash
git add app/static/sw.js
git commit -m "feat: add minimal service worker for PWA qualification"
```

---

### Task 3: Register Service Worker and Add PWA Meta Tags

**Files:**
- Modify: `app/static/index.html:4-8` (add meta tags in `<head>`)
- Modify: `app/static/app.js:592-598` (register SW in `init()`)

- [ ] **Step 1: Add PWA meta tags to index.html**

In `app/static/index.html`, after line 5 (`<meta name="viewport" ...>`), add:

```html
    <meta name="theme-color" content="#1a1a2e">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="manifest" href="manifest.json">
    <link rel="apple-touch-icon" href="icons/icon-192.png">
```

- [ ] **Step 2: Add SW registration in app.js init()**

In `app/static/app.js`, inside `init()` function (currently at line 592), add SW registration at the top of the function body:

```javascript
    async function init() {
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("sw.js").catch(() => {});
        }
        loadSettings();
        bindEvents();
        showHomeScreen();
        updateResumeCard();
        await loadMovies();
    }
```

- [ ] **Step 3: Verify SW registration in browser**

Open browser DevTools → Application → Service Workers. Confirm `sw.js` is registered and active.

- [ ] **Step 4: Commit**

```bash
git add app/static/index.html app/static/app.js
git commit -m "feat: register service worker and add PWA meta tags"
```

---

### Task 4: Media Session Integration

**Files:**
- Modify: `app/static/app.js:374-411` (setupAudio, onTimeUpdate area)

- [ ] **Step 1: Add updateMediaSession function**

In `app/static/app.js`, after the `onAudioError` function (after line 411), add:

```javascript
    function updateMediaSession() {
        if (!("mediaSession" in navigator) || !state.audioFile) return;

        navigator.mediaSession.metadata = new MediaMetadata({
            title: state.currentMovie || "자막 뷰어",
            artist: "자막 뷰어",
        });

        navigator.mediaSession.setActionHandler("play", () => {
            $("#audio-player").play();
        });
        navigator.mediaSession.setActionHandler("pause", () => {
            $("#audio-player").pause();
        });
        navigator.mediaSession.setActionHandler("previoustrack", () => {
            navigate(-1);
        });
        navigator.mediaSession.setActionHandler("nexttrack", () => {
            navigate(1);
        });
    }
```

- [ ] **Step 2: Call updateMediaSession from setupAudio**

In `app/static/app.js`, inside `setupAudio()`, after line 387 (`container.classList.remove("hidden");`), add the call:

```javascript
        container.classList.remove("hidden");

        updateMediaSession();
```

- [ ] **Step 3: Manual test on mobile**

1. Open the app on a mobile device
2. Select a movie with MP3, start playback
3. Lock screen → verify media controls appear (play/pause, prev/next)
4. Tap next/prev → verify subtitle changes
5. Switch to another app → verify audio continues

- [ ] **Step 4: Commit**

```bash
git add app/static/app.js
git commit -m "feat: add Media Session API for lock-screen controls and background playback"
```

---

### Task 5: Update README

**Files:**
- Modify: `docs/README.md`

- [ ] **Step 1: Add background playback to Features list**

In `docs/README.md`, update the MP3 feature line (line 52) from:

```
- MP3 오디오 재생 + 자막 자동 싱크 (MP3 없으면 수동 모드)
```

to:

```
- MP3 오디오 재생 + 자막 자동 싱크 (MP3 없으면 수동 모드)
- 백그라운드 오디오 재생 + 잠금화면 미디어 컨트롤 (PWA)
```

- [ ] **Step 2: Commit and push**

```bash
git add docs/README.md
git commit -m "docs: add background audio playback feature to README"
git push
```
