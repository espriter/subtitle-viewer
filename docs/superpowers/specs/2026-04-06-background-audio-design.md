# Background Audio Playback Design

## Goal

Enable background audio playback on both iOS Safari and Android Chrome so that
audio continues playing when the screen is off or the app is switched away.
Lock-screen media controls (play/pause, prev/next subtitle) should be shown.

## Approach: Media Session API + Minimal PWA

### New Files

| File | Purpose |
|------|---------|
| `app/static/manifest.json` | PWA metadata (name, icons, display: standalone) |
| `app/static/sw.js` | Minimal Service Worker (install/activate only, no caching) |
| `app/static/icons/icon-192.png` | PWA icon 192x192 |
| `app/static/icons/icon-512.png` | PWA icon 512x512 |

### Modified Files

| File | Changes |
|------|---------|
| `app/static/index.html` | Add manifest link, theme-color, apple-mobile-web-app meta tags |
| `app/static/app.js` | Register SW, add Media Session metadata and action handlers |

### Media Session Actions

| Action | Behavior |
|--------|----------|
| `play` | Resume audio playback |
| `pause` | Pause audio playback |
| `previoustrack` | Move to previous subtitle, seek audio to its start time |
| `nexttrack` | Move to next subtitle, seek audio to its start time |

### Media Session Metadata

- `title`: Current movie name
- `artist`: "자막 뷰어"
- Updated when movie changes.

### PWA Meta Tags (index.html)

```html
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#1a1a2e">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="icons/icon-192.png">
```

### Service Worker (sw.js)

Minimal — only install and activate events with `skipWaiting()` and
`clients.claim()`. No fetch handler, no caching. Sole purpose is PWA
qualification for iOS background audio support.

### Flow

1. Page load → register Service Worker
2. Audio playback starts → set Media Session metadata + bind action handlers
3. Subtitle changes → update metadata title (optional, keep movie name)
4. Screen off / app switch → OS detects active Media Session, keeps playback alive
5. Lock screen controls → trigger Media Session action handlers

### Constraints

- iOS Safari: most reliable when added to home screen as PWA
- Android Chrome: works in browser with Media Session alone
- No server-side changes required
- No offline caching (audio streams from server)
