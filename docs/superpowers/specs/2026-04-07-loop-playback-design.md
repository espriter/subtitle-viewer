# Loop Playback (A-B Repeat) Design

## Goal

Enable section repeat playback for language learning. The user selects a start (A)
and end (B) subtitle from a full-list view, then returns to the reader where audio
loops between A's start time and B's end time.

## Use Case

- Primary: Listening practice — repeatedly hear a dialogue section while reading subtitles
- Audio is required; the loop button is hidden when no audio file is present

## New View: Loop Setup

A 4th view added to the existing SPA (Movies → Files → Reader → **Loop Setup**).

### Entry Point

- "Loop" button in the Reader view (visible only when audio file exists)
- Tapping it switches to the Loop Setup view

### Layout

- Full scrollable list of all primary subtitles (card style)
- Each card shows: subtitle index, start time, text
- If dual subtitles are active, secondary text is displayed smaller below primary text
- Top bar: title ("Loop Setup"), "Save" button (disabled until A and B are set), "Cancel" button

### Selection Interaction

| Action | Result |
|--------|--------|
| Tap a card (nothing selected) | Card becomes **A** (green highlight + "Start" tag) |
| Tap another card (A is set) | Card becomes **B** (red highlight + "End" tag); cards between A and B get light highlight |
| Tap a card before A | A moves to the tapped card (B stays) |
| Tap a card after B | B moves to the tapped card (A stays) |
| Tap a card between A and B | Reset both; tapped card becomes new A |

- A must be before B (by subtitle index)
- If only A is set and user taps the same card again, it deselects (reset)

### Save

- Stores `loop.startIndex` and `loop.endIndex` in state
- Returns to Reader view
- Audio seeks to A subtitle's `start` time and begins playback
- `loop.active` is set to `true`

## Reader View Changes

### Loop Indicator

- When loop is active, a bar appears above subtitle content:
  `"Loop A 00:01:30 ~ B 00:02:15"` with an **X** (close) button
- Tapping X deactivates the loop, resumes normal playback from current position

### Loop Logic in `onTimeUpdate()`

```
if loop.active:
    currentTime = audio.currentTime + syncOffset
    endTime = endTimeOfSubtitle(loop.endIndex)
    if currentTime >= endTime:
        audio.currentTime = startTimeOfSubtitle(loop.startIndex)
```

- Loop check runs before the existing subtitle sync logic
- When audio loops back, subtitle position also resets to `loop.startIndex`

### Navigation Within Loop

- Prev/next navigation is NOT constrained to the loop range
  (user may want to peek at surrounding subtitles)
- Audio seek on navigation still works normally

## State Changes

Add to `state` object:

```javascript
loop: {
    startIndex: null,  // A subtitle index (primary)
    endIndex: null,    // B subtitle index (primary)
    active: false
}
```

- Cleared on movie change or file re-selection
- NOT persisted to localStorage (loop is session-only)

## Modified Files

| File | Changes |
|------|---------|
| `app/static/index.html` | Add Loop Setup view container, loop indicator bar in reader, loop button |
| `app/static/app.js` | Add loop state, Loop Setup view logic, selection interaction, loop playback logic in `onTimeUpdate()`, loop indicator rendering |
| `app/static/style.css` | Styles for loop setup cards (green/red highlights, light range highlight), loop indicator bar, loop button |

## No Backend Changes

All loop logic is client-side. No new API endpoints needed.

## Out of Scope

- Playback speed control (future enhancement)
- Loop persistence across sessions
- Loop in audio-less mode
- Card tap in Reader view for loop setting (separate view only)
