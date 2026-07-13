# 라이딩 자막 선택 토글 + 홈 버튼 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 라이딩 모드 미리보기에서 1st/2nd 자막 중 선택해 볼 수 있게 하고, 구간반복 설정/라이딩/리뷰 화면에 확대된 홈 버튼을 추가해 어디서든 한 번에 홈으로 돌아가게 한다.

**Architecture:** 순수 프론트엔드 변경(`app/static/index.html`, `app/static/app.js`, `app/static/style.css`). 빌드 단계 없음 — FastAPI가 `StaticFiles`로 디스크에서 직접 서빙하므로 저장 즉시 반영. 백엔드/API 변경 없음.

**Tech Stack:** Vanilla JS(IIFE), `localStorage` 기반 설정 영속화, 기존 `.btn-group`/`.btn-option`(data-attribute 토글) 패턴 재사용.

## Global Constraints

- 새 의존성 추가 금지 — 기존 vanilla JS/CSS 패턴만 사용.
- 기존 코드 컨벤션 그대로 따름: 설정 토글은 `state.settings` + `applySettings()` + `saveSettings()` + `[data-*]` 속성 클릭 위임 패턴(app.js의 `[data-rate]`, `[data-commute-min]` 참고).
- `.hidden` 유틸리티는 이 프로젝트에서 항상 스코프드(`#id.hidden` / `.class.hidden`)로 정의됨 — 전역 `.hidden` 룰 신규 추가 금지.
- 이 저장소엔 프론트 DOM 테스트 프레임워크가 없음(순수 함수 `segmenter.js`만 `node --test`로 검증). 이번 변경은 DOM 이벤트 배선이라 자동 테스트 신규 도입은 범위 밖(YAGNI) — 대신 실행 중인 서비스(`http://192.168.12.46:8091/subtitle`)에 Playwright로 직접 접속해 동작을 확인한다.
- 서비스 재시작 불필요(정적 파일 직접 서빙) — 브라우저 새로고침만으로 반영.

---

### Task 1: 라이딩 모드 자막 선택 토글 (1st/2nd)

**Files:**
- Modify: `app/static/index.html` (commute-stage 마크업)
- Modify: `app/static/app.js` (state, `updateCommuteNow`, `applySettings`, `enterCommute`, 이벤트 리스너)
- Modify: `app/static/style.css` (`#commute-subtitle-row` hidden 규칙)

**Interfaces:**
- Consumes: 기존 `state.subtitles.primary`/`.secondary`(배열), `findSubtitleAtTime(subs, seconds)`(app.js:607), `applySettings()`/`saveSettings()`(app.js:887-957).
- Produces: `state.settings.commuteSubtitle: "primary" | "secondary"` — Task 2와 무관, 다른 태스크가 이 값을 소비하지 않음.

- [ ] **Step 1: `index.html` — 라이딩 스테이지에 자막 칩 행 추가**

`app/static/index.html`에서 아래 블록을 찾는다(View 5, `commute-rate-row` 바로 앞):

```html
            <div class="commute-rate-row">
                <span class="loop-option-label">배속</span>
```

이 줄 바로 **앞**에 다음을 삽입한다:

```html
            <div class="commute-rate-row" id="commute-subtitle-row">
                <span class="loop-option-label">자막</span>
                <span class="btn-group">
                    <button class="btn-option" data-commute-subtitle="primary">1st</button>
                    <button class="btn-option" data-commute-subtitle="secondary">2nd</button>
                </span>
            </div>
```

- [ ] **Step 2: `style.css` — 2nd 자막 없는 폴더에서 행 숨김 규칙 추가**

`app/static/style.css`에서 다음 블록을 찾는다:

```css
.commute-rate-row .rate-group { justify-content: center; }
```

바로 아래에 추가:

```css
#commute-subtitle-row.hidden { display: none; }
```

- [ ] **Step 3: `app.js` — 기본 설정값 추가**

`state.settings` 객체(파일 상단, `commuteSwapButtons: false,` 줄)를 찾는다:

```js
            commuteSwapButtons: false, // 이어폰 prev/next 의미 스왑 (AirPods 대응)
        },
```

바로 아래 줄에 추가(콤마 유지):

```js
            commuteSwapButtons: false, // 이어폰 prev/next 의미 스왑 (AirPods 대응)
            commuteSubtitle: "primary", // 라이딩 미리보기 자막: "primary"(1st) | "secondary"(2nd)
        },
```

- [ ] **Step 4: `app.js` — `updateCommuteNow`가 선택된 자막을 참조하도록 변경**

기존 함수:

```js
    function updateCommuteNow(t) {
        const el = $("#commute-now");
        if (!el) return;
        const idx = findSubtitleAtTime(state.subtitles.primary, t);
        el.textContent = idx >= 0
            ? state.subtitles.primary[idx].text.replace(/\n/g, " ")
            : "";
    }
```

다음으로 교체:

```js
    function updateCommuteNow(t) {
        const el = $("#commute-now");
        if (!el) return;
        const list = state.settings.commuteSubtitle === "secondary" && state.subtitles.secondary.length > 0
            ? state.subtitles.secondary
            : state.subtitles.primary;
        const idx = findSubtitleAtTime(list, t);
        el.textContent = idx >= 0 ? list[idx].text.replace(/\n/g, " ") : "";
    }
```

- [ ] **Step 5: `app.js` — `applySettings()`에 자막 행 표시/활성 상태 반영 추가**

`applySettings()` 함수 끝부분, 다음 블록을 찾는다:

```js
        const swapBtn = $("#btn-commute-swap");
        if (swapBtn) {
            swapBtn.textContent = state.settings.commuteSwapButtons ? "ON" : "OFF";
            swapBtn.classList.toggle("active", state.settings.commuteSwapButtons);
        }
    }
```

다음으로 교체(마지막 `}`는 함수를 닫는 브레이스이므로 그 앞에 삽입):

```js
        const swapBtn = $("#btn-commute-swap");
        if (swapBtn) {
            swapBtn.textContent = state.settings.commuteSwapButtons ? "ON" : "OFF";
            swapBtn.classList.toggle("active", state.settings.commuteSwapButtons);
        }
        const subtitleRow = $("#commute-subtitle-row");
        if (subtitleRow) {
            subtitleRow.classList.toggle("hidden", state.subtitles.secondary.length === 0);
        }
        $$("[data-commute-subtitle]").forEach((btn) => {
            btn.classList.toggle(
                "active",
                btn.dataset.commuteSubtitle === (state.settings.commuteSubtitle || "primary")
            );
        });
    }
```

- [ ] **Step 6: `app.js` — `enterCommute()`에서 `applySettings()` 호출 추가**

기존 함수:

```js
    function enterCommute() {
        if (!state.audioFile || state.subtitles.primary.length === 0) return;
        stopPlaylist(false);
        cancelLoop();
        state.mode = "commute";
        ensureStudy();
        if (state.study.sessions.length === 0) computeStudySessions();
        state.study.currentIndex = sessionIndexForSec(state.study.data.resumeSec || 0);
        updateMediaSession();
        renderCommuteSessions();
        updateCommuteSummary();
        updateCommutePlayButton();
        showView("commute");
    }
```

`updateMediaSession();` 줄 바로 아래에 `applySettings();` 추가:

```js
    function enterCommute() {
        if (!state.audioFile || state.subtitles.primary.length === 0) return;
        stopPlaylist(false);
        cancelLoop();
        state.mode = "commute";
        ensureStudy();
        if (state.study.sessions.length === 0) computeStudySessions();
        state.study.currentIndex = sessionIndexForSec(state.study.data.resumeSec || 0);
        updateMediaSession();
        applySettings();
        renderCommuteSessions();
        updateCommuteSummary();
        updateCommutePlayButton();
        showView("commute");
    }
```

- [ ] **Step 7: `app.js` — 자막 칩 클릭 리스너 추가**

플레이백 레이트 리스너 블록을 찾는다:

```js
        // Playback rate (설정 패널 + 라이딩 뷰 공용)
        $$("[data-rate]").forEach((b) => {
            b.addEventListener("click", () => {
                state.settings.playbackRate = parseFloat(b.dataset.rate);
                applyPlaybackRate();
                saveSettings();
                updatePositionState();
            });
        });
```

바로 아래에 추가:

```js

        // Commute: 라이딩 미리보기 자막 선택 (1st/2nd)
        $$("[data-commute-subtitle]").forEach((b) => {
            b.addEventListener("click", () => {
                state.settings.commuteSubtitle = b.dataset.commuteSubtitle;
                saveSettings();
                applySettings();
                updateCommuteNow($("#audio-player").currentTime);
            });
        });
```

- [ ] **Step 8: Playwright로 동작 확인**

서비스는 이미 `http://192.168.12.46:8091/subtitle`에서 실행 중(systemd, 재시작 불필요). `mcp__playwright__browser_navigate`로 접속 후:

1. en+ko 두 자막 + mp3가 있는 폴더 열기 → 리더 화면 진입.
2. 🚴 버튼으로 라이딩 모드 진입 → "자막" 칩 행이 보이고 `1st`가 활성(강조) 상태인지 `browser_snapshot`으로 확인.
3. `2nd` 칩 클릭 → `#commute-now` 텍스트가 즉시 2번째 자막(ko) 텍스트로 바뀌는지 확인.
4. 페이지 새로고침(`browser_navigate` 재호출 또는 리로드) → 같은 폴더 재진입 → 라이딩 모드에서 `2nd`가 여전히 활성 상태인지 확인(설정 영속).
5. 단일 자막(en.srt만 있는 폴더가 있다면) 폴더로 라이딩 모드 진입 → "자막" 칩 행 자체가 안 보이는지 확인. (해당 폴더가 없으면 이 스텝은 생략하고 보고서에 "해당 없음"으로 남긴다.)

- [ ] **Step 9: Commit**

```bash
git add app/static/index.html app/static/app.js app/static/style.css
git commit -m "feat(commute): 라이딩 모드 1st/2nd 자막 선택 토글 추가"
```

---

### Task 2: 홈 버튼 확대 + `goHome()` 통합

**Files:**
- Modify: `app/static/index.html` (View 3/4/5/6 헤더)
- Modify: `app/static/app.js` (`goHome()` 신규, 이벤트 리스너 4곳)
- Modify: `app/static/style.css` (`.btn-icon.btn-home`)

**Interfaces:**
- Consumes: 기존 `saveStudy(force)`(app.js:234), `cancelLoop()`(app.js:1366), `updateMediaSession()`, `showView(name)`, `showHomeScreen()`, `loadMovies()`.
- Produces: `goHome()` — 인자 없음, 반환값 없음. 4개 이벤트 리스너(`#btn-home`, `#btn-loop-home`, `#btn-commute-home`, `#btn-review-home`)가 이 함수를 공유.

- [ ] **Step 1: `index.html` — Reader 홈 버튼에 `.btn-home` 클래스 추가**

기존:

```html
                <button id="btn-home" class="btn-icon" title="홈으로">&#8962;</button>
```

변경:

```html
                <button id="btn-home" class="btn-icon btn-home" title="홈으로">&#8962;</button>
```

- [ ] **Step 2: `index.html` — 구간반복 설정 헤더에 홈 버튼 추가**

기존(View 4):

```html
            <header>
                <button id="btn-loop-back" class="btn-icon">&larr;</button>
                <h1>구간반복 설정</h1>
                <button id="btn-loop-save" class="btn btn-loop-save" disabled>저장</button>
            </header>
```

변경:

```html
            <header>
                <button id="btn-loop-back" class="btn-icon">&larr;</button>
                <button id="btn-loop-home" class="btn-icon btn-home" title="홈으로">&#8962;</button>
                <h1>구간반복 설정</h1>
                <button id="btn-loop-save" class="btn btn-loop-save" disabled>저장</button>
            </header>
```

- [ ] **Step 3: `index.html` — 라이딩 모드 헤더에 홈 버튼 추가**

기존(View 5):

```html
        <header>
            <button id="btn-commute-back" class="btn-icon">&larr;</button>
            <h1>라이딩 모드</h1>
            <button id="btn-commute-open-review" class="btn-icon" title="리뷰">&#128221;</button>
        </header>
```

변경:

```html
        <header>
            <button id="btn-commute-back" class="btn-icon">&larr;</button>
            <button id="btn-commute-home" class="btn-icon btn-home" title="홈으로">&#8962;</button>
            <h1>라이딩 모드</h1>
            <button id="btn-commute-open-review" class="btn-icon" title="리뷰">&#128221;</button>
        </header>
```

- [ ] **Step 4: `index.html` — 리뷰 헤더에 홈 버튼 추가**

기존(View 6):

```html
            <header>
                <button id="btn-review-back" class="btn-icon">&larr;</button>
                <h1>리뷰</h1>
                <button id="btn-review-blind" class="btn-option" title="자막 가리고 듣기">블라인드</button>
            </header>
```

변경:

```html
            <header>
                <button id="btn-review-back" class="btn-icon">&larr;</button>
                <button id="btn-review-home" class="btn-icon btn-home" title="홈으로">&#8962;</button>
                <h1>리뷰</h1>
                <button id="btn-review-blind" class="btn-option" title="자막 가리고 듣기">블라인드</button>
            </header>
```

- [ ] **Step 5: `style.css` — 홈 버튼 확대 스타일 추가**

`.btn-icon:hover { color: var(--accent); }` 블록을 찾는다:

```css
.btn-icon:hover { color: var(--accent); }
```

바로 아래에 추가:

```css

.btn-icon.btn-home {
    font-size: 26px;
    padding: 6px 10px;
}
```

- [ ] **Step 6: `app.js` — 공용 `goHome()` 함수 추가**

`exitCommute()` 함수 바로 **앞**에 추가(파일에서 다음 블록을 찾는다):

```js
    function exitCommute() {
```

이 줄 바로 위에 삽입:

```js
    // 어느 화면(구간반복/라이딩/리뷰)에서든 한 번에 홈으로. 진행 중이던 라이딩/루프 상태를
    // 안전하게 정리(둘 다 관련 없으면 no-op)한 뒤 홈 화면으로 이동.
    function goHome() {
        saveStudy(true);
        cancelLoop();
        state.mode = "reader";
        updateMediaSession();
        showView("movies");
        showHomeScreen();
        loadMovies();
    }

    function exitCommute() {
```

- [ ] **Step 7: `app.js` — Reader `#btn-home` 리스너를 `goHome()`으로 교체**

기존:

```js
        $("#btn-home").addEventListener("click", () => {
            showView("movies");
            showHomeScreen();
            loadMovies();
        });
```

변경:

```js
        $("#btn-home").addEventListener("click", goHome);
```

- [ ] **Step 8: `app.js` — 구간반복 설정 홈 버튼 리스너 추가**

기존:

```js
        $("#btn-loop-back").addEventListener("click", () => showView("reader"));
```

바로 아래에 추가:

```js
        $("#btn-loop-back").addEventListener("click", () => showView("reader"));
        $("#btn-loop-home").addEventListener("click", goHome);
```

- [ ] **Step 9: `app.js` — 라이딩 모드 홈 버튼 리스너 추가**

기존:

```js
        $("#btn-commute-back").addEventListener("click", exitCommute);
```

바로 아래에 추가:

```js
        $("#btn-commute-back").addEventListener("click", exitCommute);
        $("#btn-commute-home").addEventListener("click", goHome);
```

- [ ] **Step 10: `app.js` — 리뷰 홈 버튼 리스너 추가**

기존:

```js
        $("#btn-review-back").addEventListener("click", exitReview);
```

바로 아래에 추가:

```js
        $("#btn-review-back").addEventListener("click", exitReview);
        $("#btn-review-home").addEventListener("click", goHome);
```

- [ ] **Step 11: Playwright로 동작 확인**

`http://192.168.12.46:8091/subtitle` 접속 후:

1. Reader 화면에서 ⌂ 버튼이 이전보다 커진 것을 스냅샷/스크린샷으로 확인.
2. 리더 → 구간반복 설정 진입 → 새 ⌂ 버튼 클릭 → 뒤로 여러 번 없이 홈 화면으로 바로 이동하는지 확인.
3. 홈 → 라이딩 모드 진입 → 재생 몇 초 진행 → ⌂ 클릭 → 홈으로 이동 + "라이딩 모드" 카드의 진행률(세션/남은 시간)이 갱신돼 있는지 확인(진행 저장 검증).
4. 라이딩 모드 → 📝 리뷰 진입 → ⌂ 클릭 → 홈으로 바로 이동하는지 확인(리뷰의 기존 "뒤로"는 라이딩으로 가지만 홈은 건너뛰고 바로 감).
5. 기존 회귀 확인: 각 화면의 "뒤로(←)" 버튼이 기존 동작(전 단계로 이동) 그대로인지 확인.

- [ ] **Step 12: Commit**

```bash
git add app/static/index.html app/static/app.js app/static/style.css
git commit -m "feat(nav): 구간반복/라이딩/리뷰 화면에 확대된 홈 버튼 추가 + goHome() 통합"
```

---

## Self-Review Notes

- **스펙 커버리지**: addendum의 "자막 선택" 섹션 → Task 1 전체. "홈 버튼 통합" 섹션 → Task 2 전체. 두 섹션 모두 매핑됨.
- **플레이스홀더**: 없음 — 모든 스텝에 실제 코드 diff 포함.
- **타입/이름 일관성**: `state.settings.commuteSubtitle`, `data-commute-subtitle`, `#commute-subtitle-row`, `goHome()`, `#btn-loop-home`/`#btn-commute-home`/`#btn-review-home` 모두 Task 1/2 전체에서 동일한 이름으로 사용.
- **Out of scope 재확인**: 자막 3단 동시 표시, 아이콘 크기 전역 설정화, 화면별 다른 홈 동작 분기 — 이번 플랜에 없음(설계 addendum과 일치).
