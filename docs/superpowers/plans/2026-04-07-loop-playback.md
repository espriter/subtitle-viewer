# Loop Playback (A-B Repeat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add section repeat (A-B loop) playback for language learning — a dedicated view to select start/end subtitles, then loop audio between those points in the reader.

**Architecture:** New "Loop Setup" view (4th SPA view) with a scrollable subtitle list. Selection state stored in `state.loop`. Loop enforcement in existing `onTimeUpdate()`. All client-side, no backend changes.

**Tech Stack:** Vanilla JavaScript (IIFE pattern), HTML5, CSS3

---

### Task 1: Add loop state to state object

**Files:**
- Modify: `app/static/app.js:5-23` (state object)

- [ ] **Step 1: Add loop property to state**

In `app/static/app.js`, add `loop` after the `wakeLock` property in the state object:

```javascript
    wakeLock: null,
    loop: {
        startIndex: null,
        endIndex: null,
        active: false,
    },
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd /srv/subtitle-viewer && python -c "import subprocess; subprocess.run(['node', '--check', 'app/static/app.js'])"`
Expected: no output (exit 0)

- [ ] **Step 3: Commit**

```bash
git add app/static/app.js
git commit -m "feat(loop): add loop state to state object"
```

---

### Task 2: Add Loop Setup view HTML

**Files:**
- Modify: `app/static/index.html:83-157` (add new view between reader close and script tag)

- [ ] **Step 1: Add loop indicator bar in reader view**

In `app/static/index.html`, add the loop indicator bar and loop button inside `#view-reader`, right after the `<header>` block (after line 90) and before `#audio-container`:

```html
        <div id="loop-indicator" class="loop-indicator hidden">
            <span id="loop-indicator-text"></span>
            <button id="btn-loop-cancel" class="btn-icon loop-cancel">&times;</button>
        </div>
```

- [ ] **Step 2: Add loop button in nav-controls**

In `app/static/index.html`, add a loop button inside `#nav-controls`, after `btn-next`:

```html
            <button id="btn-loop" class="btn-nav btn-loop hidden" title="구간반복">&#8634;</button>
```

- [ ] **Step 3: Add Loop Setup view HTML**

In `app/static/index.html`, add the new view after `</div><!-- end view-reader -->` (after line 157) and before the `<script>` tag:

```html
    <!-- View 4: Loop Setup -->
    <div id="view-loop" class="view">
        <header>
            <button id="btn-loop-back" class="btn-icon">&larr;</button>
            <h1>구간반복 설정</h1>
            <button id="btn-loop-save" class="btn btn-loop-save" disabled>저장</button>
        </header>
        <p class="hint">시작 자막과 종료 자막을 선택하세요</p>
        <div id="loop-subtitle-list" class="loop-list"></div>
    </div>
```

- [ ] **Step 4: Verify HTML structure**

Open the app in a browser (`http://<server-ip>:8091/`) and verify no rendering errors in devtools console.

- [ ] **Step 5: Commit**

```bash
git add app/static/index.html
git commit -m "feat(loop): add loop setup view and loop indicator HTML"
```

---

### Task 3: Add Loop Setup view CSS

**Files:**
- Modify: `app/static/style.css` (append at end, before the closing `@media` block)

- [ ] **Step 1: Add loop-related styles**

Append the following CSS before the `@media (min-width: 768px)` block in `app/static/style.css`:

```css
/* Loop Playback */
.btn-loop.hidden {
    display: none;
}

.loop-indicator {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(74, 158, 255, 0.15);
    border: 1px solid var(--accent);
    border-radius: 10px;
    padding: 8px 12px;
    font-size: 13px;
    color: var(--accent);
}

.loop-indicator.hidden {
    display: none;
}

.loop-cancel {
    font-size: 18px;
    color: var(--accent);
    padding: 0 4px;
}

/* Loop Setup View */
.loop-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    overflow-y: auto;
    padding-bottom: 24px;
}

.loop-card {
    background: var(--surface);
    border: 2px solid transparent;
    border-radius: 10px;
    padding: 12px 14px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    font-size: 14px;
    line-height: 1.4;
}

.loop-card:active {
    background: var(--surface-alt);
}

.loop-card-time {
    font-size: 12px;
    color: var(--text-muted);
    font-family: monospace;
    margin-bottom: 4px;
}

.loop-card-text {
    color: var(--text);
}

.loop-card-secondary {
    color: var(--text-secondary);
    font-size: 12px;
    margin-top: 4px;
}

.loop-card-tag {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 6px;
    margin-right: 6px;
    vertical-align: middle;
}

/* A marker: green */
.loop-card.loop-start {
    border-color: #22c55e;
    background: rgba(34, 197, 94, 0.1);
}

.loop-card.loop-start .loop-card-tag {
    background: #22c55e;
    color: #fff;
}

/* B marker: red */
.loop-card.loop-end {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
}

.loop-card.loop-end .loop-card-tag {
    background: #ef4444;
    color: #fff;
}

/* Range between A and B */
.loop-card.loop-range {
    background: rgba(74, 158, 255, 0.06);
    border-color: rgba(74, 158, 255, 0.2);
}

/* Loop save button */
.btn-loop-save {
    background: var(--accent);
    color: #fff;
    font-size: 14px;
    padding: 6px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
}

.btn-loop-save:disabled {
    opacity: 0.4;
    cursor: default;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/static/style.css
git commit -m "feat(loop): add loop setup and indicator CSS styles"
```

---

### Task 4: Register Loop Setup view in JS view system

**Files:**
- Modify: `app/static/app.js:64-79` (views object and showView function)

- [ ] **Step 1: Add loop view to views object**

In `app/static/app.js`, update the `views` object (around line 64-68):

```javascript
    const views = {
        movies: $("#view-movies"),
        files: $("#view-files"),
        reader: $("#view-reader"),
        loop: $("#view-loop"),
    };
```

- [ ] **Step 2: Update showView to handle wake lock for loop view**

The existing `showView` function already handles wake lock correctly — wake lock is only acquired for `reader` and released otherwise. The loop view will release wake lock, which is fine since the user is just selecting subtitles, not listening.

No changes needed to `showView`.

- [ ] **Step 3: Commit**

```bash
git add app/static/app.js
git commit -m "feat(loop): register loop view in SPA view system"
```

---

### Task 5: Implement Loop Setup view rendering and selection logic

**Files:**
- Modify: `app/static/app.js` (add new functions before the `// --- Event binding ---` section)

- [ ] **Step 1: Add renderLoopSetup function**

Insert the following functions before the `// --- Event binding ---` comment (around line 666):

```javascript
    // --- Loop Setup ---
    function showLoopSetup() {
        state.loop.startIndex = null;
        state.loop.endIndex = null;
        renderLoopList();
        showView("loop");
    }

    function renderLoopList() {
        const list = $("#loop-subtitle-list");
        list.innerHTML = "";
        const subs = state.subtitles.primary;
        const secSubs = state.subtitles.secondary;

        subs.forEach((entry, i) => {
            const card = document.createElement("div");
            card.className = "loop-card";

            // Apply selection classes
            const startIdx = state.loop.startIndex;
            const endIdx = state.loop.endIndex;
            let tagHTML = "";

            if (startIdx !== null && i === startIdx) {
                card.classList.add("loop-start");
                tagHTML = '<span class="loop-card-tag">시작</span>';
            } else if (endIdx !== null && i === endIdx) {
                card.classList.add("loop-end");
                tagHTML = '<span class="loop-card-tag">종료</span>';
            } else if (startIdx !== null && endIdx !== null && i > startIdx && i < endIdx) {
                card.classList.add("loop-range");
            }

            const timeStr = entry.start.split(",")[0];
            let html = `<div class="loop-card-time">${tagHTML}#${i + 1} · ${timeStr}</div>`;
            html += `<div class="loop-card-text">${entry.text.replace(/\n/g, " ")}</div>`;

            // Secondary subtitle if available
            if (secSubs.length > 0) {
                const secIdx = findSubtitleAtTime(secSubs, timeToSeconds(entry.start));
                if (secIdx >= 0) {
                    html += `<div class="loop-card-secondary">${secSubs[secIdx].text.replace(/\n/g, " ")}</div>`;
                }
            }

            card.innerHTML = html;
            card.addEventListener("click", () => onLoopCardTap(i));
            list.appendChild(card);
        });

        $("#btn-loop-save").disabled = !(state.loop.startIndex !== null && state.loop.endIndex !== null);
    }
```

- [ ] **Step 2: Add onLoopCardTap selection logic**

Insert right after `renderLoopList`:

```javascript
    function onLoopCardTap(index) {
        const startIdx = state.loop.startIndex;
        const endIdx = state.loop.endIndex;

        if (startIdx === null) {
            // Nothing selected — set A
            state.loop.startIndex = index;
        } else if (startIdx === index && endIdx === null) {
            // Same card tapped again with only A set — deselect
            state.loop.startIndex = null;
        } else if (endIdx === null) {
            // A is set, no B yet
            if (index < startIdx) {
                // Before A — move A
                state.loop.startIndex = index;
            } else {
                // After A — set B
                state.loop.endIndex = index;
            }
        } else {
            // Both A and B are set
            if (index < startIdx) {
                // Before A — move A
                state.loop.startIndex = index;
            } else if (index > endIdx) {
                // After B — move B
                state.loop.endIndex = index;
            } else {
                // Between A and B (inclusive) — reset, tapped becomes new A
                state.loop.startIndex = index;
                state.loop.endIndex = null;
            }
        }

        renderLoopList();
    }
```

- [ ] **Step 3: Add saveLoop function**

Insert right after `onLoopCardTap`:

```javascript
    function saveLoop() {
        if (state.loop.startIndex === null || state.loop.endIndex === null) return;
        state.loop.active = true;

        // Return to reader
        showView("reader");

        // Show loop indicator
        const subs = state.subtitles.primary;
        const startTime = subs[state.loop.startIndex].start.split(",")[0];
        const endTime = subs[state.loop.endIndex].end.split(",")[0];
        $("#loop-indicator-text").textContent = `구간반복 ${startTime} ~ ${endTime}`;
        $("#loop-indicator").classList.remove("hidden");

        // Seek audio to start and play
        const audio = $("#audio-player");
        audio.currentTime = timeToSeconds(subs[state.loop.startIndex].start);
        state.position = state.loop.startIndex;
        renderSubtitles();
        audio.play();
    }

    function cancelLoop() {
        state.loop.active = false;
        state.loop.startIndex = null;
        state.loop.endIndex = null;
        $("#loop-indicator").classList.add("hidden");
    }
```

- [ ] **Step 4: Verify no syntax errors**

Run: `cd /srv/subtitle-viewer && node --check app/static/app.js`
Expected: no output (exit 0)

- [ ] **Step 5: Commit**

```bash
git add app/static/app.js
git commit -m "feat(loop): implement loop setup rendering and selection logic"
```

---

### Task 6: Add loop enforcement in onTimeUpdate

**Files:**
- Modify: `app/static/app.js:426-436` (onTimeUpdate function)

- [ ] **Step 1: Add loop check at the beginning of onTimeUpdate**

Replace the existing `onTimeUpdate` function:

```javascript
    function onTimeUpdate() {
        if (!state.settings.autoSync) return;
        const audio = $("#audio-player");
        const t = audio.currentTime + state.settings.syncOffset;

        // Loop enforcement: seek back to A when passing B's end time
        if (state.loop.active) {
            const subs = state.subtitles.primary;
            const endEntry = subs[state.loop.endIndex];
            if (endEntry) {
                const endSec = timeToSeconds(endEntry.end);
                if (t >= endSec) {
                    const startSec = timeToSeconds(subs[state.loop.startIndex].start);
                    audio.currentTime = startSec;
                    state.position = state.loop.startIndex;
                    renderSubtitles();
                    return;
                }
            }
        }

        const subs = state.subtitles.primary;
        const idx = findSubtitleAtTime(subs, t);
        if (idx >= 0 && idx !== state.position) {
            state.position = idx;
            renderSubtitles();
        }
    }
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd /srv/subtitle-viewer && node --check app/static/app.js`
Expected: no output (exit 0)

- [ ] **Step 3: Commit**

```bash
git add app/static/app.js
git commit -m "feat(loop): enforce A-B loop in onTimeUpdate"
```

---

### Task 7: Wire up event bindings and show/hide loop button

**Files:**
- Modify: `app/static/app.js` (bindEvents function and setupAudio function)

- [ ] **Step 1: Show loop button when audio exists**

In the `setupAudio` function (around line 397-424), add after `audio.addEventListener("error", onAudioError);`:

```javascript
        const btnLoop = $("#btn-loop");
        if (btnLoop) btnLoop.classList.remove("hidden");
```

And in the early return branch (when `!state.audioFile`), add after `audio.load();`:

```javascript
        const btnLoop = $("#btn-loop");
        if (btnLoop) btnLoop.classList.add("hidden");
```

- [ ] **Step 2: Add loop event bindings**

In the `bindEvents` function, add before `setupSwipe();`:

```javascript
        // Loop
        $("#btn-loop").addEventListener("click", showLoopSetup);
        $("#btn-loop-back").addEventListener("click", () => showView("reader"));
        $("#btn-loop-save").addEventListener("click", saveLoop);
        $("#btn-loop-cancel").addEventListener("click", cancelLoop);
```

- [ ] **Step 3: Clear loop state on movie/file change**

In the `selectMovie` function (around line 211), add after `state.selectedFiles = [];`:

```javascript
        cancelLoop();
```

This ensures loop state is cleared when switching movies. Also add the same call at the beginning of `startReader` (around line 273), before the subtitle fetch:

```javascript
        cancelLoop();
```

- [ ] **Step 4: Verify no syntax errors**

Run: `cd /srv/subtitle-viewer && node --check app/static/app.js`
Expected: no output (exit 0)

- [ ] **Step 5: Commit**

```bash
git add app/static/app.js
git commit -m "feat(loop): wire up loop event bindings and button visibility"
```

---

### Task 8: Manual browser testing

**Files:** None (verification only)

- [ ] **Step 1: Start test server**

```bash
cd /srv/subtitle-viewer && source venv/bin/activate && uvicorn app.main:create_default_app --factory --host 0.0.0.0 --port 8091
```

Note the server IP from `hostname -I | awk '{print $1}'` and access `http://<ip>:8091/`.

- [ ] **Step 2: Test loop button visibility**

1. Select a movie that has an MP3 audio file
2. Verify the loop button (↺) appears in the reader nav controls
3. Select a movie without MP3 — verify loop button is hidden

- [ ] **Step 3: Test Loop Setup view**

1. Tap the loop button — verify Loop Setup view appears with all subtitles listed
2. Verify each card shows index, time, primary text, and secondary text (if dual)
3. Tap "Cancel" — verify it returns to reader

- [ ] **Step 4: Test A-B selection**

1. Tap a card → verify green highlight + "시작" tag
2. Tap the same card again → verify it deselects (reset)
3. Tap card #5 → green. Tap card #10 → red + range highlighted between
4. Tap card #3 (before A) → A moves to #3, B stays at #10
5. Tap card #12 (after B) → B moves to #12, A stays at #3
6. Tap card #7 (between A and B) → reset, #7 becomes new A
7. Verify "Save" button enables only when both A and B are set

- [ ] **Step 5: Test loop playback**

1. Select A and B, tap "Save"
2. Verify reader shows loop indicator bar with correct time range
3. Verify audio starts playing from A's start time
4. Wait for audio to reach B's end time — verify it loops back to A
5. Tap the X button on the indicator — verify loop deactivates, normal playback resumes

- [ ] **Step 6: Test edge cases**

1. Switch to a different movie while loop is active — verify loop is cleared
2. Navigate (prev/next) while loop is active — verify navigation works normally
3. Verify loop indicator disappears after canceling

- [ ] **Step 7: Commit any fixes discovered during testing**

```bash
git add -u
git commit -m "fix(loop): fixes from manual testing"
```

---

### Task 9: Update design spec as completed

**Files:**
- Modify: `docs/superpowers/specs/2026-04-07-loop-playback-design.md`

- [ ] **Step 1: Update CLAUDE.md if docs reference is needed**

No docs/READING-ORDER.md exists, so no update needed there.

- [ ] **Step 2: Commit**

```bash
git add docs/
git commit -m "docs: mark loop playback design as implemented"
```
