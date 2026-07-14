(function () {
    "use strict";

    // --- State ---
    const state = {
        movies: [],
        currentMovie: null,
        files: [],
        selectedFiles: [],
        chapters: [],
        selectedChapterIndex: null,
        subtitles: { primary: [], secondary: [] },
        position: 0,
        positionSecondary: 0,
        settings: {
            linesPerView: 1,
            navMode: "page",
            fontSize: 24,
            syncOffset: 0,
            autoSync: true,
            loopCount: 0,   // 0 = 무한 반복, N = N회 후 정지
            loopGap: 0,     // 구간 끝(B)에서 멈췄다 되감기까지 초
            playbackRate: 1,
            commuteTargetMin: 15,     // 가상 세션 목표 길이(분)
            sessionEndPause: true,    // 세션 경계 도달 시 일시정지
            commuteSwapButtons: false, // 이어폰 prev/next 의미 스왑 (AirPods 대응)
            commuteSubtitle: "primary", // 라이딩 미리보기 자막: "primary"(1st) | "secondary"(2nd)
        },
        uploadEnabled: true,
        audioFile: null,
        wakeLock: null,
        loop: {
            startIndex: null,
            endIndex: null,
            active: false,
            _done: 0,        // 현재까지 반복한 횟수
            _finished: false, // loopCount 도달로 종료됨
            _waiting: false,  // 끝 멈춤(gap) 대기 중
            _gapTimer: null,
            _sessionRepeat: false, // A-B가 수동 선택이 아닌 세션 반복 토글로 설정됨
        },
        mode: "reader",  // "reader" | "commute" | "review" — 재생 모드 (Media Session 매핑 분기)
        commuteFrom: "home", // 라이딩 모드 진입 경로 ("home" | "reader")
        study: {
            movie: null,     // study 데이터가 로드된 영화
            data: null,      // localStorage 영속 레코드 (progressSec/resumeSec/cues)
            sessions: [],    // Segmenter.computeSessions 결과 (메모이즈)
            currentIndex: 0, // 현재 세션 포인터 (resumeSec에서 파생)
        },
        review: {
            sessionIndex: 0,
            filter: "marked", // "marked" | "all"
            blind: false,
            from: "home",     // 리뷰 진입 경로 ("home" | "commute")
        },
        playlist: {
            cues: [],   // 마킹 문장 복습 재생 대기열 (큐 인덱스, 시간순)
            pos: 0,
            active: false,
        },
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
        async getChapters(movie) {
            const resp = await fetch(`api/movies/${encodeURIComponent(movie)}/chapters`);
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

    // 자막 파일(업로드/외부 다운로드) 내용은 신뢰할 수 없는 입력이므로 innerHTML에
    // 넣기 전 반드시 이스케이프한다 — <script>/<img onerror> 같은 태그가 그대로
    // 실행되는 XSS를 막기 위함. 단, <i>/<b>/<u>는 자막에서 흔히 쓰이는 안전한
    // 서식 태그라 이스케이프 후 정확히 이 형태로만 되돌려 살려준다(속성 없는
    // 태그만 허용하므로 <img onerror=...> 같은 위험한 값은 되돌아가지 않음).
    const escapeHtml = (str) => str.replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
    const SAFE_TAG_RE = /&lt;(\/?(?:i|b|u))&gt;/gi;
    const sanitizeSubtitleHtml = (str) => escapeHtml(str).replace(SAFE_TAG_RE, "<$1>");

    const views = {
        movies: $("#view-movies"),
        files: $("#view-files"),
        reader: $("#view-reader"),
        loop: $("#view-loop"),
        commute: $("#view-commute"),
        review: $("#view-review"),
    };

    // --- View switching ---
    function showView(name) {
        Object.values(views).forEach((v) => v.classList.remove("active"));
        views[name].classList.add("active");
        if (name === "reader") {
            requestWakeLock();
        } else {
            releaseWakeLock();
        }
    }

    // --- Home Screen ---
    function showHomeScreen() {
        $("#home-screen").classList.remove("hidden");
        $("#movie-list-section").classList.add("hidden");
        updateResumeCard();
        updateStudyCards();
    }

    function showMovieListSection() {
        $("#home-screen").classList.add("hidden");
        $("#movie-list-section").classList.remove("hidden");
    }

    // --- Resume Session ---
    const SESSION_KEY = "subtitle-viewer-last-session";

    function saveSession() {
        if (!state.currentMovie || state.selectedFiles.length === 0) return;
        const audio = $("#audio-player");
        const session = {
            movie: state.currentMovie,
            files: [...state.selectedFiles],
            position: state.position,
            audioTime: (state.audioFile && audio) ? audio.currentTime : 0,
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }

    function loadSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    function updateResumeCard() {
        const session = loadSession();
        const card = $("#menu-resume");
        const desc = $("#resume-desc");
        if (!session) {
            card.classList.add("disabled");
            desc.textContent = "저장된 세션이 없습니다";
        } else {
            card.classList.remove("disabled");
            const posLabel = session.position + 1;
            desc.textContent = `${session.movie} — #${posLabel}`;
        }
    }

    // Load movie/files/subtitles/chapters from the saved session record.
    // Shared by resume (reader) and commute/review entry from home.
    async function loadFromSavedSession() {
        const session = loadSession();
        if (!session) return null;

        state.currentMovie = session.movie;
        state.selectedFiles = session.files;

        try {
            // Detect MP3 audio file for this movie
            const allFiles = await api.getFiles(state.currentMovie);
            state.audioFile = allFiles.find(f => f.endsWith('.mp3')) || null;
            state.chapters = await api.getChapters(state.currentMovie);

            state.subtitles.primary = await api.getSubtitles(
                state.currentMovie,
                state.selectedFiles[0]
            );
            state.subtitles.secondary =
                state.selectedFiles.length > 1
                    ? await api.getSubtitles(state.currentMovie, state.selectedFiles[1])
                    : [];
        } catch {
            alert("이어서 불러오지 못했습니다. 네트워크를 확인하고 다시 시도하세요.");
            return null;
        }
        return session;
    }

    async function resumeSession() {
        const session = await loadFromSavedSession();
        if (!session) return;

        state.position = Math.min(session.position, state.subtitles.primary.length - 1);
        setupAudio();
        if (state.audioFile && session.audioTime) {
            $("#audio-player").currentTime = session.audioTime;
        }
        renderSubtitles();
        showView("reader");
    }

    // --- Study store (라이딩/리뷰 학습 기록, per-movie localStorage) ---
    const STUDY_KEY_PREFIX = "subtitle-viewer-study:";

    function studyKey(movie) {
        return STUDY_KEY_PREFIX + movie;
    }

    function loadStudy(movie) {
        try {
            const raw = localStorage.getItem(studyKey(movie));
            if (!raw) return null;
            const data = JSON.parse(raw);
            return data && data.v === 1 ? data : null;
        } catch {
            return null;
        }
    }

    let lastStudySaveAt = 0;
    // 라이딩 중 timeupdate마다 불리므로 기본 5초 스로틀; force=true는 즉시 저장.
    function saveStudy(force) {
        const st = state.study;
        if (!st.data || !st.movie) return;
        const now = Date.now();
        if (!force && now - lastStudySaveAt < 5000) return;
        lastStudySaveAt = now;
        st.data.updatedAt = new Date().toISOString();
        if (st.sessions.length > 0) {
            const idx = sessionIndexForSec(st.data.resumeSec || 0);
            const sess = st.sessions[idx];
            st.data.summary = {
                sessionCount: st.sessions.length,
                currentSession: idx + 1,
                remainSec: Math.max(0, Math.round(sess.endSec - Math.max(st.data.resumeSec || 0, sess.startSec))),
            };
        }
        localStorage.setItem(studyKey(st.movie), JSON.stringify(st.data));
    }

    // 현재 영화의 study 레코드를 로드/초기화. 자막 교체 감지 포함.
    function ensureStudy() {
        const movie = state.currentMovie;
        const cueCount = state.subtitles.primary.length;
        const srtFile = state.selectedFiles[0] || null;

        if (state.study.movie === movie && state.study.data) return;

        let data = loadStudy(movie);
        if (data && (data.cueCount !== cueCount || data.srtFile !== srtFile)) {
            const reset = confirm(
                "자막 구성이 바뀐 것 같습니다. 학습 기록(마킹/진도)을 초기화할까요?\n(취소하면 기존 기록을 그대로 사용합니다)"
            );
            if (reset) {
                data = null;
            } else {
                data.srtFile = srtFile;
                data.cueCount = cueCount;
            }
        }
        if (!data) {
            data = { v: 1, srtFile, cueCount, progressSec: 0, resumeSec: 0, cues: {} };
        }
        state.study.movie = movie;
        state.study.data = data;
        state.study.sessions = [];
    }

    function computeStudySessions() {
        const chapterStarts = (state.chapters || [])
            .map((c) => c.start_seconds)
            .filter((s) => typeof s === "number");
        state.study.sessions = Segmenter.computeSessions(state.subtitles.primary, {
            targetSec: state.settings.commuteTargetMin * 60,
            chapterStarts,
        });
    }

    function sessionIndexForSec(sec) {
        const ss = state.study.sessions;
        for (let i = 0; i < ss.length; i++) {
            if (sec < ss[i].endSec) return i;
        }
        return Math.max(0, ss.length - 1);
    }

    function isSessionCompleted(sess) {
        return state.study.data && sess.endSec <= (state.study.data.progressSec || 0) + 0.01;
    }

    function markedCuesInOrder() {
        const data = state.study.data;
        if (!data) return [];
        return Object.keys(data.cues)
            .filter((k) => data.cues[k].r > 0)
            .map(Number)
            .sort((a, b) => a - b);
    }

    function countMarkedCues(data) {
        if (!data || !data.cues) return 0;
        return Object.keys(data.cues).filter((k) => data.cues[k].r > 0).length;
    }

    // 홈 화면 라이딩/리뷰 카드 상태 갱신 (localStorage만 읽음)
    function updateStudyCards() {
        const session = loadSession();
        const commuteCard = $("#menu-commute");
        const reviewCard = $("#menu-review");
        const commuteDesc = $("#commute-desc");
        const reviewDesc = $("#review-desc");
        if (!commuteCard || !reviewCard) return;

        if (!session) {
            commuteCard.classList.add("disabled");
            reviewCard.classList.add("disabled");
            commuteDesc.textContent = "저장된 세션이 없습니다";
            reviewDesc.textContent = "저장된 세션이 없습니다";
            return;
        }

        const study = loadStudy(session.movie);
        commuteCard.classList.remove("disabled");
        if (study && study.summary) {
            const s = study.summary;
            const remainMin = Math.max(1, Math.round(s.remainSec / 60));
            commuteDesc.textContent =
                `세션 ${s.currentSession}/${s.sessionCount} · 남은 ${remainMin}분 · ${session.movie}`;
        } else {
            commuteDesc.textContent = `처음부터 · ${session.movie}`;
        }

        const marked = countMarkedCues(study);
        if (marked > 0) {
            reviewCard.classList.remove("disabled");
            reviewDesc.textContent = `다시들은 문장 ${marked}개 · ${session.movie}`;
        } else {
            reviewCard.classList.add("disabled");
            reviewDesc.textContent = "마킹된 문장이 없습니다";
        }
    }

    // --- View 1: Movies ---
    async function loadMovies() {
        const list = $("#movie-list");
        try {
            state.movies = await api.getMovies();
        } catch {
            // 네트워크 끊김(예: 라이딩 중 전파 약한 구간)에도 앱이 멈추지 않도록 재시도 가능한 상태로 표시
            list.innerHTML = "";
            const err = document.createElement("div");
            err.className = "card-item";
            err.setAttribute("role", "button");
            err.tabIndex = 0;
            err.textContent = "목록을 불러오지 못했습니다 · 탭하여 재시도";
            err.addEventListener("click", () => loadMovies());
            list.appendChild(err);
            return;
        }
        list.innerHTML = "";
        state.movies.forEach((movie) => {
            const el = document.createElement("div");
            el.className = "card-item";
            el.setAttribute("role", "button");
            el.tabIndex = 0;
            el.textContent = movie;
            el.addEventListener("click", () => selectMovie(movie));
            list.appendChild(el);
        });

        try {
            const resp = await fetch("api/upload-enabled");
            state.uploadEnabled = resp.ok;
        } catch {
            state.uploadEnabled = false;
        }
        updateCreateMovieVisibility();
        updateMenuCreateFolder();
    }

    function updateCreateMovieVisibility() {
        const section = $("#create-movie-section");
        if (section) {
            section.style.display = state.uploadEnabled ? "" : "none";
        }
    }

    function updateMenuCreateFolder() {
        const card = $("#menu-create-folder");
        if (card) {
            card.style.display = state.uploadEnabled ? "" : "none";
        }
    }

    async function createMovie() {
        const name = prompt("새 폴더 이름을 입력하세요 (영문, 숫자, 하이픈, 언더스코어만 가능):");
        if (!name) return;

        try {
            const resp = await api.createMovie(name.trim());
            if (resp.ok) {
                await loadMovies();
            } else {
                const err = await resp.json();
                alert(err.detail || "폴더 생성 실패");
            }
        } catch {
            alert("폴더 생성 실패. 네트워크를 확인하고 다시 시도하세요.");
        }
    }

    // --- View 2: Files ---
    async function selectMovie(movie) {
        state.currentMovie = movie;
        state.selectedFiles = [];
        state.selectedChapterIndex = null;
        stopPlaylist(false);
        cancelLoop();
        $("#movie-title").textContent = movie;
        try {
            state.files = await api.getFiles(movie);
            state.chapters = await api.getChapters(movie);
        } catch {
            alert("폴더 정보를 불러오지 못했습니다. 네트워크를 확인하고 다시 시도하세요.");
            return;
        }
        state.audioFile = state.files.find(f => f.endsWith('.mp3')) || null;
        state.files = state.files.filter(f => f.endsWith('.srt') || f.endsWith('.smi'));
        renderChapterList();
        renderFileList();
        updateUploadVisibility();
        updateAudioHint();
        showView("files");
    }

    function renderFileList() {
        const list = $("#file-list");
        list.innerHTML = "";
        state.files.forEach((file) => {
            const el = document.createElement("div");
            el.className = "card-item";
            el.setAttribute("role", "button");
            el.tabIndex = 0;
            const order = state.selectedFiles.indexOf(file);
            if (order >= 0) {
                el.classList.add("selected");
                const badge = order === 0 ? "▶ 1st" : "▷ 2nd";
                el.innerHTML = `<span class="file-badge">${badge}</span> ${file}`;
            } else {
                el.textContent = file;
            }
            el.addEventListener("click", () => toggleFileSelection(file));
            list.appendChild(el);
        });
        updateStartButton();
    }

    function renderChapterList() {
        const section = $("#chapter-section");
        const list = $("#chapter-list");
        if (!section || !list) return;

        list.innerHTML = "";
        if (!state.chapters || state.chapters.length === 0) {
            section.classList.add("hidden");
            return;
        }

        section.classList.remove("hidden");
        state.chapters.forEach((chapter, index) => {
            const el = document.createElement("button");
            el.type = "button";
            el.className = "chapter-card";
            if (state.selectedChapterIndex === index) {
                el.classList.add("selected");
            }

            const time = document.createElement("span");
            time.className = "chapter-time";
            time.textContent = `${chapter.start.split(".")[0]} · #${chapter.index}`;

            const title = document.createElement("span");
            title.className = "chapter-title";
            title.textContent = chapter.title;

            el.appendChild(time);
            el.appendChild(title);
            el.addEventListener("click", () => toggleChapterSelection(index));
            list.appendChild(el);
        });
    }

    function toggleChapterSelection(index) {
        state.selectedChapterIndex = state.selectedChapterIndex === index ? null : index;
        renderChapterList();
    }

    function toggleFileSelection(file) {
        const idx = state.selectedFiles.indexOf(file);
        if (idx >= 0) {
            state.selectedFiles.splice(idx, 1);
        } else if (state.selectedFiles.length < 2) {
            state.selectedFiles.push(file);
        }
        renderFileList();
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

    function updateAudioHint() {
        const hint = $("#audio-hint");
        if (hint) {
            hint.classList.toggle("hidden", !state.audioFile);
        }
    }

    // --- View 3: Reader ---
    async function startReader() {
        stopPlaylist(false);
        cancelLoop();
        state.mode = "reader";
        try {
            state.subtitles.primary = await api.getSubtitles(
                state.currentMovie,
                state.selectedFiles[0]
            );
            state.subtitles.secondary =
                state.selectedFiles.length > 1
                    ? await api.getSubtitles(state.currentMovie, state.selectedFiles[1])
                    : [];
        } catch {
            alert("자막을 불러오지 못했습니다. 네트워크를 확인하고 다시 시도하세요.");
            return;
        }
        state.position = 0;
        state.positionSecondary = 0;
        const selectedChapter = state.chapters[state.selectedChapterIndex];
        if (selectedChapter && state.subtitles.primary.length > 0) {
            state.position = findNearestSubtitle(
                state.subtitles.primary,
                selectedChapter.start_seconds
            );
        }
        setupAudio();
        if (selectedChapter && state.audioFile) {
            $("#audio-player").currentTime = selectedChapter.start_seconds;
        }
        renderSubtitles();
        showView("reader");
    }

    function getVisibleEntries(subs, position) {
        const { linesPerView } = state.settings;
        const start = position;
        const end = Math.min(start + linesPerView, subs.length);
        return subs.slice(start, end);
    }

    function syncSecondaryPosition() {
        const sec = state.subtitles.secondary;
        if (!sec || sec.length === 0) return;
        const pri = state.subtitles.primary;
        if (!pri || pri.length === 0) return;
        const currentTime = timeToSeconds(pri[state.position].start);
        const idx = findSubtitleAtTime(sec, currentTime);
        state.positionSecondary = idx >= 0 ? idx : 0;
    }

    function renderSubtitles() {
        syncSecondaryPosition();
        const primary = getVisibleEntries(state.subtitles.primary, state.position);
        const secondary = getVisibleEntries(state.subtitles.secondary, state.positionSecondary);

        $("#card-primary").innerHTML = primary
            .map((e) => `<div>${sanitizeSubtitleHtml(e.text).replace(/\n/g, "<br>")}</div>`)
            .join("");

        $("#card-secondary").innerHTML = secondary
            .map((e) => `<div>${sanitizeSubtitleHtml(e.text).replace(/\n/g, "<br>")}</div>`)
            .join("");

        const total = state.subtitles.primary.length;
        const current = Math.min(state.position + 1, total);
        $("#position-indicator").textContent = `${current} / ${total}`;

        saveSession();
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
        const audio = $("#audio-player");
        if (state.audioFile && audio.src && !audio.paused) {
            const entry = state.subtitles.primary[state.position];
            if (entry) {
                audio.currentTime = timeToSeconds(entry.start);
            }
        }
    }

    // --- Time Jump ---
    function timeToSeconds(timeStr) {
        // Handle "HH:MM:SS,mmm" or "HH:MM:SS" or "MM:SS"
        const parts = timeStr.replace(",", ".").split(":");
        if (parts.length === 3) return +parts[0] * 3600 + +parts[1] * 60 + parseFloat(parts[2]);
        if (parts.length === 2) return +parts[0] * 60 + parseFloat(parts[1]);
        return parseFloat(parts[0]);
    }

    function findSubtitleAtTime(subs, seconds) {
        if (!subs || subs.length === 0) return -1;
        for (let i = subs.length - 1; i >= 0; i--) {
            const startSec = timeToSeconds(subs[i].start);
            if (seconds >= startSec) return i;
        }
        return -1;
    }

    function findNearestSubtitle(subs, targetSeconds) {
        let closest = 0;
        let minDiff = Infinity;
        subs.forEach((entry, i) => {
            const seconds = timeToSeconds(entry.start);
            const diff = Math.abs(seconds - targetSeconds);
            if (diff < minDiff) {
                minDiff = diff;
                closest = i;
            }
        });
        return closest;
    }

    function doTimeJump() {
        const input = $("#time-jump-input").value.trim();
        if (!input) return;

        const subs = state.subtitles.primary;
        if (!subs || subs.length === 0) return;

        const targetSeconds = timeToSeconds(input);
        const feedback = $("#time-jump-feedback");
        if (isNaN(targetSeconds)) {
            feedback.textContent = "올바른 시간 형식이 아닙니다 (예: 00:30:00)";
            feedback.classList.remove("hidden");
            return;
        }
        const idx = findNearestSubtitle(subs, targetSeconds);

        state.position = idx;
        renderSubtitles();

        const entry = subs[idx];
        feedback.textContent = `→ ${entry.start.split(",")[0]} (#${idx + 1}) 로 이동`;
        feedback.classList.remove("hidden");
    }

    // --- Audio ---
    function setupAudio() {
        const container = $("#audio-container");
        const audio = $("#audio-player");

        if (!state.audioFile) {
            container.classList.add("hidden");
            audio.removeAttribute("src");
            audio.load();
            const btnLoop = $("#btn-loop");
            if (btnLoop) btnLoop.classList.add("hidden");
            const btnSessionRepeat = $("#btn-session-repeat");
            if (btnSessionRepeat) btnSessionRepeat.classList.add("hidden");
            const btnCommute = $("#btn-commute");
            if (btnCommute) btnCommute.classList.add("hidden");
            return;
        }

        const src = `api/movies/${encodeURIComponent(state.currentMovie)}/audio/${encodeURIComponent(state.audioFile)}`;
        audio.src = src;
        container.classList.remove("hidden");

        updateMediaSession();

        const autoSyncRow = $("#auto-sync-row");
        if (autoSyncRow) autoSyncRow.style.display = "";
        const syncRow = $("#sync-offset-row");
        if (syncRow) syncRow.style.display = "";

        audio.removeEventListener("timeupdate", onTimeUpdate);
        audio.addEventListener("timeupdate", onTimeUpdate);

        audio.removeEventListener("error", onAudioError);
        audio.addEventListener("error", onAudioError);

        // src 교체 후 load()가 playbackRate를 리셋하는 브라우저 대응
        audio.removeEventListener("loadedmetadata", onAudioLoadedMetadata);
        audio.addEventListener("loadedmetadata", onAudioLoadedMetadata);

        audio.removeEventListener("play", onAudioPlayState);
        audio.addEventListener("play", onAudioPlayState);
        audio.removeEventListener("pause", onAudioPause);
        audio.addEventListener("pause", onAudioPause);

        applyPlaybackRate();

        const btnLoop = $("#btn-loop");
        if (btnLoop) btnLoop.classList.remove("hidden");
        const btnSessionRepeat = $("#btn-session-repeat");
        if (btnSessionRepeat) btnSessionRepeat.classList.remove("hidden");
        const btnCommute = $("#btn-commute");
        if (btnCommute) btnCommute.classList.remove("hidden");
    }

    function applyPlaybackRate() {
        const audio = $("#audio-player");
        const rate = state.settings.playbackRate || 1;
        audio.playbackRate = rate;
        audio.preservesPitch = true;
        audio.webkitPreservesPitch = true;
        $$("[data-rate]").forEach((b) => {
            b.classList.toggle("active", parseFloat(b.dataset.rate) === rate);
        });
    }

    function onAudioLoadedMetadata() {
        applyPlaybackRate();
        updatePositionState();
    }

    function onAudioPlayState() {
        updateCommutePlayButton();
        updatePositionState();
    }

    function onAudioPause() {
        // 이어폰 분리 시 iOS가 자동 pause → 진행 위치 즉시 저장
        if (state.mode === "commute") saveStudy(true);
        updateCommutePlayButton();
        updatePositionState();
    }

    // 잠금화면 스크러버 정합 (지원 브라우저 한정)
    function updatePositionState() {
        if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
        const audio = $("#audio-player");
        if (!audio.duration || !isFinite(audio.duration)) return;
        try {
            navigator.mediaSession.setPositionState({
                duration: audio.duration,
                playbackRate: audio.playbackRate,
                position: Math.min(audio.currentTime, audio.duration),
            });
        } catch {
            // 일부 브라우저는 유효성 검사로 throw — 무시
        }
    }

    function onTimeUpdate() {
        const audio = $("#audio-player");
        const subs = state.subtitles.primary;
        const t = audio.currentTime + state.settings.syncOffset;

        // Loop enforcement runs regardless of autoSync (#1):
        // seek back to A when playback passes B's end time.
        const loop = state.loop;
        if (loop.active && !loop._finished && !loop._waiting &&
            loop.startIndex !== null && loop.endIndex !== null) {
            const endEntry = subs[loop.endIndex];
            if (endEntry && t >= timeToSeconds(endEntry.end)) {
                handleLoopBoundary();
                return;
            }
        }

        if (state.mode === "commute") {
            handleCommuteTick(t);
        }

        if (!state.settings.autoSync) return;

        const idx = findSubtitleAtTime(subs, t);
        if (idx >= 0 && idx !== state.position) {
            state.position = idx;
            renderSubtitles();
        }
    }

    // Convert a subtitle's display time to the raw audio.currentTime it maps to,
    // compensating for syncOffset so seeks land where the user expects (#4).
    function audioTimeForSubtitleStart(index) {
        const startSec = timeToSeconds(state.subtitles.primary[index].start);
        return Math.max(0, startSec - state.settings.syncOffset);
    }

    function seekToLoopStart() {
        const audio = $("#audio-player");
        audio.currentTime = audioTimeForSubtitleStart(state.loop.startIndex);
        state.position = state.loop.startIndex;
        renderSubtitles();
        audio.play().catch(() => {});
    }

    function handleLoopBoundary() {
        const audio = $("#audio-player");

        // Count handling: stop after loopCount repeats.
        // 복습 플레이리스트 중에는 문장당 2회 고정 후 다음 문장으로 넘어간다.
        const playlistActive = state.playlist.active;
        const count = playlistActive ? 2 : state.settings.loopCount;
        if (count > 0) {
            state.loop._done += 1;
            if (state.loop._done >= count) {
                if (playlistActive) {
                    advancePlaylist();
                    return;
                }
                audio.pause();
                state.loop._finished = true;
                updateLoopIndicator();
                // 리뷰 뷰에서는 카드의 재생 하이라이트를 해제
                if (views.review.classList.contains("active")) renderReviewList();
                return;
            }
        }

        if (state.settings.loopGap > 0) {
            // Pause briefly at B before rewinding (shadowing practice).
            state.loop._waiting = true;
            audio.pause();
            updateLoopIndicator();
            state.loop._gapTimer = window.setTimeout(() => {
                state.loop._waiting = false;
                state.loop._gapTimer = null;
                if (state.loop.active) {
                    seekToLoopStart();
                    updateLoopIndicator();
                }
            }, state.settings.loopGap * 1000);
        } else {
            seekToLoopStart();
            updateLoopIndicator();
        }
    }

    function replayLoop() {
        if (!state.loop.active || state.loop.startIndex === null) return;
        if (state.loop._gapTimer) {
            window.clearTimeout(state.loop._gapTimer);
            state.loop._gapTimer = null;
        }
        state.loop._done = 0;
        state.loop._finished = false;
        state.loop._waiting = false;
        seekToLoopStart();
        updateLoopIndicator();
    }

    function onAudioError() {
        console.warn("Audio load failed, falling back to manual mode");
        $("#audio-container").classList.add("hidden");
        state.audioFile = null;
        const banner = $("#audio-error-banner");
        if (banner) {
            banner.classList.remove("hidden");
            clearTimeout(banner._hideTimer);
            banner._hideTimer = setTimeout(() => banner.classList.add("hidden"), 5000);
        }
    }

    function updateMediaSession() {
        if (!("mediaSession" in navigator) || !state.audioFile) return;

        const commute = state.mode === "commute";
        navigator.mediaSession.metadata = new MediaMetadata({
            title: (state.currentMovie || "자막 뷰어") + (commute ? " · 라이딩" : ""),
            artist: "자막 뷰어",
        });

        navigator.mediaSession.setActionHandler("play", () => {
            $("#audio-player").play();
        });
        navigator.mediaSession.setActionHandler("pause", () => {
            $("#audio-player").pause();
        });
        // 라이딩 모드: ⏮ = 현재 문장 다시듣기(자동 마킹), ⏭ = 다음 문장 스킵.
        // 핸들러가 호출 시점에 state.mode를 읽으므로 모드 전환 시 재등록 불필요.
        // seekforward/backward는 등록하지 않는다 — iOS 잠금화면에서 prev/next
        // 버튼이 시크 화살표로 대체되는 것을 막기 위함.
        navigator.mediaSession.setActionHandler("previoustrack", () => {
            if (state.mode === "commute") {
                if (state.settings.commuteSwapButtons) skipToNextSentence();
                else replayCurrentSentence();
            } else {
                navigate(-1);
            }
        });
        navigator.mediaSession.setActionHandler("nexttrack", () => {
            if (state.mode === "commute") {
                if (state.settings.commuteSwapButtons) replayCurrentSentence();
                else skipToNextSentence();
            } else {
                navigate(1);
            }
        });
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

    function updateSyncDisplay() {
        const val = state.settings.syncOffset;
        const sign = val > 0 ? "+" : val < 0 ? "" : "±";
        $("#sync-offset-display").textContent = `${sign}${val.toFixed(1)}s`;
    }

    function applySettings() {
        document.documentElement.style.setProperty(
            "--font-size",
            state.settings.fontSize + "px"
        );
        $("#font-size-display").textContent = state.settings.fontSize + "px";
        updateSyncDisplay();

        const syncBtn = $("#btn-auto-sync");
        if (syncBtn) {
            syncBtn.textContent = state.settings.autoSync ? "ON" : "OFF";
            syncBtn.classList.toggle("active", state.settings.autoSync);
        }

        $$("[data-lines]").forEach((btn) => {
            btn.classList.toggle(
                "active",
                parseInt(btn.dataset.lines) === state.settings.linesPerView
            );
        });
        $$("[data-mode]").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.mode === state.settings.navMode);
        });
        $$("[data-rate]").forEach((btn) => {
            btn.classList.toggle(
                "active",
                parseFloat(btn.dataset.rate) === (state.settings.playbackRate || 1)
            );
        });
        $$("[data-commute-min]").forEach((btn) => {
            btn.classList.toggle(
                "active",
                parseInt(btn.dataset.commuteMin) === state.settings.commuteTargetMin
            );
        });
        const pauseBtn = $("#btn-session-end-pause");
        if (pauseBtn) {
            pauseBtn.textContent = state.settings.sessionEndPause ? "ON" : "OFF";
            pauseBtn.classList.toggle("active", state.settings.sessionEndPause);
        }
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

    // --- Upload ---
    async function handleUpload(fileInput) {
        const file = fileInput.files[0];
        if (!file) return;

        try {
            const resp = await api.uploadFile(state.currentMovie, file);
            if (resp.ok) {
                state.files = await api.getFiles(state.currentMovie);
                renderFileList();
            } else {
                const err = await resp.json();
                alert(err.detail || "업로드 실패");
            }
        } catch {
            alert("업로드 실패. 네트워크를 확인하고 다시 시도하세요.");
        }
        fileInput.value = "";
    }

    // --- Wake Lock (screen stay-on) ---
    // Primary: Screen Wake Lock API
    // Fallback: hidden silent video loop (NoSleep pattern for iOS/Android)
    let wakeLockVideo = null;
    let wakeLockTimer = null;

    function createWakeLockVideo() {
        if (wakeLockVideo) return wakeLockVideo;
        // Tiny silent MP4 video (base64) — prevents screen sleep on iOS/Android
        const SILENT_MP4 = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAA" +
            "ABtZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE0OCByMjY0MyA1YzY1NzA0IC0gSC4yNjQvTV" +
            "BFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHR" +
            "tbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3Vi" +
            "bWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsa" +
            "XM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aH" +
            "JlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2V" +
            "kPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9" +
            "MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfb" +
            "WluPTI1IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj" +
            "0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMAAAAAAP" +
            "pGVuY28gbGF2YzU2LjYwLjEwMAAAAAAYc3R0cwAAAAAAAAABAAAAAgAABAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjA" +
            "AAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAArIAAAAGAAAAFHN0Y28AAAAAAAAAAQAAADAAAABidWR0" +
            "YQAAAFptZXRhAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAA" +
            "ABMYXZmNTYuNDAuMTAx";
        const video = document.createElement("video");
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        video.setAttribute("muted", "");
        video.muted = true;
        video.loop = true;
        video.src = SILENT_MP4;
        video.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
        document.body.appendChild(video);
        wakeLockVideo = video;
        return video;
    }

    function startVideoWakeLock() {
        const video = createWakeLockVideo();
        const playPromise = video.play();
        if (playPromise) playPromise.catch(() => {});
    }

    function stopVideoWakeLock() {
        if (wakeLockVideo && !wakeLockVideo.paused) {
            wakeLockVideo.pause();
        }
    }

    async function requestWakeLock() {
        // Try native Wake Lock API first
        let nativeAcquired = false;
        if ("wakeLock" in navigator) {
            try {
                state.wakeLock = await navigator.wakeLock.request("screen");
                nativeAcquired = true;
                state.wakeLock.addEventListener("release", () => {
                    state.wakeLock = null;
                    // If still in reader, fallback to video and schedule re-acquire
                    if (views.reader.classList.contains("active")) {
                        startVideoWakeLock();
                    }
                });
            } catch {
                // Wake lock request failed
            }
        }

        // Always also start video fallback for maximum reliability
        startVideoWakeLock();

        // Periodic re-acquisition: re-request native wake lock every 60s
        clearInterval(wakeLockTimer);
        wakeLockTimer = setInterval(() => {
            if (!views.reader.classList.contains("active")) {
                clearInterval(wakeLockTimer);
                return;
            }
            if (!state.wakeLock && "wakeLock" in navigator) {
                navigator.wakeLock.request("screen").then((lock) => {
                    state.wakeLock = lock;
                    lock.addEventListener("release", () => {
                        state.wakeLock = null;
                        if (views.reader.classList.contains("active")) {
                            startVideoWakeLock();
                        }
                    });
                }).catch(() => {});
            }
            // Keep video alive too
            if (wakeLockVideo && wakeLockVideo.paused) {
                const p = wakeLockVideo.play();
                if (p) p.catch(() => {});
            }
        }, 60000);
    }

    async function releaseWakeLock() {
        clearInterval(wakeLockTimer);
        wakeLockTimer = null;
        if (state.wakeLock) {
            await state.wakeLock.release();
            state.wakeLock = null;
        }
        stopVideoWakeLock();
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

        // role="button"인 클릭 전용 div(홈 메뉴 카드, 영화/파일 목록)를 키보드로도 조작 가능하게.
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            if (e.target.getAttribute("role") !== "button" || e.target.tagName === "BUTTON") return;
            e.preventDefault();
            e.target.click();
        });
    }

    // --- Loop Setup ---
    // preserve=true keeps current A/B (used when editing an active loop).
    function showLoopSetup(preserve) {
        if (!preserve) {
            state.loop.startIndex = null;
            state.loop.endIndex = null;
        }
        renderLoopOptions();
        renderLoopList();
        showView("loop");
        setupLoopScrubber();

        if (preserve && state.loop.startIndex !== null) {
            const list = $("#loop-subtitle-list");
            const card = list.children[state.loop.startIndex];
            if (card) card.scrollIntoView({ block: "center" });
        }
    }

    function renderLoopOptions() {
        $$("[data-count]").forEach((b) => {
            b.classList.toggle("active", parseInt(b.dataset.count) === state.settings.loopCount);
        });
        $$("[data-gap]").forEach((b) => {
            b.classList.toggle("active", parseInt(b.dataset.gap) === state.settings.loopGap);
        });
    }

    function renderLoopList() {
        const list = $("#loop-subtitle-list");
        const scrollTop = list.scrollTop;
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
            html += `<div class="loop-card-text">${sanitizeSubtitleHtml(entry.text).replace(/\n/g, " ")}</div>`;

            // Secondary subtitle if available
            if (secSubs.length > 0) {
                const secIdx = findSubtitleAtTime(secSubs, timeToSeconds(entry.start));
                if (secIdx >= 0) {
                    html += `<div class="loop-card-secondary">${sanitizeSubtitleHtml(secSubs[secIdx].text).replace(/\n/g, " ")}</div>`;
                }
            }

            card.innerHTML = html;
            card.addEventListener("click", () => onLoopCardTap(i));
            list.appendChild(card);
        });

        $("#btn-loop-save").disabled = !(state.loop.startIndex !== null && state.loop.endIndex !== null);
        list.scrollTop = scrollTop;

        // Update selection summary
        updateLoopSummary();
    }

    function updateLoopSummary() {
        const el = $("#loop-selection-summary");
        const subs = state.subtitles.primary;
        const startIdx = state.loop.startIndex;
        const endIdx = state.loop.endIndex;

        if (startIdx === null && endIdx === null) {
            el.innerHTML = "시작 자막과 종료 자막을 선택하세요";
        } else if (startIdx !== null && endIdx === null) {
            const startTime = subs[startIdx].start.split(",")[0];
            el.innerHTML = `<span class="summary-a">시작 #${startIdx + 1} · ${startTime}</span> → 종료를 선택하세요`;
        } else if (startIdx !== null && endIdx !== null) {
            const startTime = subs[startIdx].start.split(",")[0];
            const endTime = subs[endIdx].start.split(",")[0];
            el.innerHTML = `<span class="summary-a">시작 #${startIdx + 1} · ${startTime}</span> → <span class="summary-b">종료 #${endIdx + 1} · ${endTime}</span>`;
        }
    }

    let loopScrubberBound = false;
    function setupLoopScrubber() {
        const scrubber = $("#loop-scrubber");
        const thumb = $("#loop-scrubber-thumb");
        const label = $("#loop-scrubber-label");
        const list = $("#loop-subtitle-list");

        // Listeners must be bound only once; re-entry would stack duplicates.
        if (loopScrubberBound) {
            requestAnimationFrame(() => {
                if (list.scrollHeight <= list.clientHeight) {
                    thumb.style.display = "none";
                } else {
                    thumb.style.display = "";
                    const ratio = list.scrollTop / (list.scrollHeight - list.clientHeight);
                    thumb.style.top = (ratio * (scrubber.clientHeight - thumb.clientHeight)) + "px";
                }
            });
            return;
        }
        loopScrubberBound = true;

        function updateThumb() {
            if (list.scrollHeight <= list.clientHeight) {
                thumb.style.display = "none";
                return;
            }
            thumb.style.display = "";
            const ratio = list.scrollTop / (list.scrollHeight - list.clientHeight);
            const trackHeight = scrubber.clientHeight - thumb.clientHeight;
            thumb.style.top = (ratio * trackHeight) + "px";
        }

        function scrollToRatio(ratio) {
            const maxScroll = list.scrollHeight - list.clientHeight;
            list.scrollTop = ratio * maxScroll;
        }

        function getLabel(ratio) {
            const subs = state.subtitles.primary;
            if (!subs || subs.length === 0) return "";
            const idx = Math.min(Math.floor(ratio * subs.length), subs.length - 1);
            return `#${idx + 1} · ${subs[idx].start.split(",")[0]}`;
        }

        function onDrag(clientY) {
            const rect = scrubber.getBoundingClientRect();
            const y = Math.max(0, Math.min(clientY - rect.top, rect.height));
            const ratio = y / rect.height;
            scrollToRatio(ratio);
            // Show label
            label.textContent = getLabel(ratio);
            label.classList.remove("hidden");
            label.style.top = Math.max(0, Math.min(y - 14, rect.height - 28)) + "px";
        }

        let dragging = false;

        scrubber.addEventListener("pointerdown", (e) => {
            dragging = true;
            scrubber.classList.add("dragging");
            scrubber.setPointerCapture(e.pointerId);
            onDrag(e.clientY);
        });

        scrubber.addEventListener("pointermove", (e) => {
            if (!dragging) return;
            onDrag(e.clientY);
        });

        scrubber.addEventListener("pointerup", () => {
            dragging = false;
            scrubber.classList.remove("dragging");
            label.classList.add("hidden");
        });

        scrubber.addEventListener("pointercancel", () => {
            dragging = false;
            scrubber.classList.remove("dragging");
            label.classList.add("hidden");
        });

        list.addEventListener("scroll", updateThumb, { passive: true });

        // Initial position
        updateThumb();
    }

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

    function saveLoop() {
        if (state.loop.startIndex === null || state.loop.endIndex === null) return;
        state.loop.active = true;
        state.loop._done = 0;
        state.loop._finished = false;
        state.loop._waiting = false;
        state.loop._sessionRepeat = false;

        // Return to reader, show indicator, seek to A and play.
        showView("reader");
        $("#loop-indicator").classList.remove("hidden");
        updateLoopIndicator();
        seekToLoopStart();
    }

    function updateLoopIndicator() {
        const loop = state.loop;
        if (loop.startIndex === null || loop.endIndex === null) return;
        const subs = state.subtitles.primary;
        const startTime = subs[loop.startIndex].start.split(",")[0];
        const endTime = subs[loop.endIndex].end.split(",")[0];
        const count = state.settings.loopCount;

        let label = loop._sessionRepeat ? `세션 반복 · ${startTime} ~ ${endTime}` : `${startTime} ~ ${endTime}`;
        if (loop._finished) {
            label = `✓ ${count}회 완료 · ${label}`;
        } else if (loop._waiting) {
            label = `⏸ ${label}`;
        } else if (count > 0) {
            label += `  ${loop._done}/${count}회`;
        }
        $("#loop-indicator-text").textContent = label;

        // Replay button is only meaningful once a loop is running.
        const replayBtn = $("#btn-loop-replay");
        if (replayBtn) replayBtn.classList.toggle("hidden", !loop.active);
    }

    function cancelLoop() {
        if (state.loop._gapTimer) {
            window.clearTimeout(state.loop._gapTimer);
            state.loop._gapTimer = null;
        }
        state.loop.active = false;
        state.loop.startIndex = null;
        state.loop.endIndex = null;
        state.loop._done = 0;
        state.loop._finished = false;
        state.loop._waiting = false;
        state.loop._sessionRepeat = false;
        $("#loop-indicator").classList.add("hidden");
    }

    // 현재 재생 위치가 속한 세션(segmenter.js, 라이딩 모드와 동일 계산)을 A-B 루프 범위로
    // 설정한다 — Loop Setup에서 자막 2개를 직접 고르는 대신 한 번의 탭으로 세션 전체 반복.
    function toggleSessionRepeat() {
        if (state.loop.active && state.loop._sessionRepeat) {
            cancelLoop();
            return;
        }
        if (!state.audioFile || state.subtitles.primary.length === 0) return;
        ensureStudy();
        if (state.study.sessions.length === 0) computeStudySessions();
        if (state.study.sessions.length === 0) return;
        const audio = $("#audio-player");
        const t = audio.currentTime + state.settings.syncOffset;
        const sess = state.study.sessions[sessionIndexForSec(t)];
        state.loop.startIndex = sess.startCue;
        state.loop.endIndex = sess.endCue;
        saveLoop();
        state.loop._sessionRepeat = true;
        updateLoopIndicator();
    }

    // ============================================================
    // 라이딩 모드 (Commute) — 화면 없이 이어폰 버튼만으로 듣기 연습
    // ============================================================

    function formatClock(sec) {
        const s = Math.max(0, Math.floor(sec));
        const h = String(Math.floor(s / 3600)).padStart(2, "0");
        const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        return `${h}:${m}:${ss}`;
    }

    async function enterCommuteFromHome() {
        const session = await loadFromSavedSession();
        if (!session) return;
        if (!state.audioFile) {
            alert("이 폴더에는 오디오(mp3)가 없어 라이딩 모드를 쓸 수 없습니다.");
            return;
        }
        setupAudio();
        state.commuteFrom = "home";
        enterCommute();
    }

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
        state.mode = "reader";
        saveStudy(true);
        updateMediaSession();
        if (state.commuteFrom === "reader") {
            showView("reader");
        } else {
            showView("movies");
            showHomeScreen();
        }
    }

    function renderCommuteSessions() {
        const list = $("#commute-session-list");
        if (!list) return;
        list.innerHTML = "";
        state.study.sessions.forEach((sess, i) => {
            const el = document.createElement("button");
            el.type = "button";
            el.className = "session-chip";
            const done = isSessionCompleted(sess);
            if (done) el.classList.add("done");
            if (i === state.study.currentIndex) el.classList.add("current");

            const title = document.createElement("span");
            title.className = "session-chip-title";
            title.textContent = `세션 ${i + 1}${done ? " ✓" : ""}`;

            const meta = document.createElement("span");
            meta.className = "session-chip-meta";
            const dur = Math.round((sess.endSec - sess.startSec) / 60);
            meta.textContent = `${formatClock(sess.startSec)} · ${dur}분`;

            el.appendChild(title);
            el.appendChild(meta);
            el.addEventListener("click", () => selectCommuteSession(i));
            list.appendChild(el);
        });
        const cur = list.children[state.study.currentIndex];
        if (cur) cur.scrollIntoView({ inline: "center", block: "nearest" });
    }

    function selectCommuteSession(i) {
        stopPlaylist(false);
        state.study.currentIndex = i;
        renderCommuteSessions();
        updateCommuteSummary();
    }

    function updateCommuteSummary() {
        const el = $("#commute-summary");
        if (!el) return;
        const sess = state.study.sessions[state.study.currentIndex];
        if (!sess) {
            el.textContent = "";
            return;
        }
        const dur = Math.round((sess.endSec - sess.startSec) / 60);
        let line = `세션 ${state.study.currentIndex + 1}/${state.study.sessions.length}` +
            ` · ${formatClock(sess.startSec)} ~ ${formatClock(sess.endSec)} (${dur}분)`;
        const resume = state.study.data ? state.study.data.resumeSec || 0 : 0;
        if (resume > sess.startSec + 1 && resume < sess.endSec - 1) {
            line += ` · 이어서 ${formatClock(resume)}`;
        }
        el.textContent = line;

        const plBtn = $("#btn-commute-playlist");
        if (plBtn) {
            const marked = markedCuesInOrder().length;
            plBtn.classList.toggle("hidden", marked === 0 && !state.playlist.active);
            plBtn.textContent = state.playlist.active
                ? "⏹ 복습 중지"
                : `🔁 복습 재생 (${marked}문장)`;
        }
    }

    function updateCommutePlayButton() {
        const btn = $("#btn-commute-play");
        if (!btn) return;
        const audio = $("#audio-player");
        const playing = !audio.paused;
        btn.innerHTML = playing ? "&#10074;&#10074;" : "&#9654;";
        btn.setAttribute("aria-label", playing ? "일시정지" : "재생");
        btn.classList.toggle("playing", playing);
    }

    // fromStart=false면 resumeSec에서 이어듣기 (세션 밖이면 세션 처음부터)
    function startCommutePlayback(fromStart) {
        const audio = $("#audio-player");
        const sess = state.study.sessions[state.study.currentIndex];
        if (!sess || !state.study.data) return;
        stopPlaylist(false);
        let t = fromStart
            ? sess.startSec
            : Math.max(state.study.data.resumeSec || 0, sess.startSec);
        if (t >= sess.endSec - 1 || t < sess.startSec) t = sess.startSec;
        audio.currentTime = Math.max(0, t - state.settings.syncOffset);
        audio.play().catch(() => {});
        state.study.data.resumeSec = t;
        updateCommuteSummary();
    }

    // onTimeUpdate에서 호출 — t는 자막 시간 도메인 (currentTime + syncOffset)
    function handleCommuteTick(t) {
        const st = state.study;
        const sess = st.sessions[st.currentIndex];
        if (!sess || !st.data) return;
        if (state.playlist.active) return; // 복습 재생은 루프 엔진이 관리

        st.data.resumeSec = t;
        // 진도 워터마크는 현재 세션 끝까지만 — 앞으로 시크해도 미래 세션이 완료 처리되지 않게
        st.data.progressSec = Math.max(st.data.progressSec || 0, Math.min(t, sess.endSec));
        saveStudy(); // 5초 스로틀

        if (views.commute.classList.contains("active")) {
            updateCommuteNow(t);
        }

        const audio = $("#audio-player");
        if (t >= sess.endSec && !audio.paused) {
            completeCommuteSession(sess);
        }
    }

    function updateCommuteNow(t) {
        const el = $("#commute-now");
        if (!el) return;
        const list = state.settings.commuteSubtitle === "secondary" && state.subtitles.secondary.length > 0
            ? state.subtitles.secondary
            : state.subtitles.primary;
        const idx = findSubtitleAtTime(list, t);
        el.textContent = idx >= 0 ? list[idx].text.replace(/\n/g, " ") : "";
    }

    function completeCommuteSession(sess) {
        const audio = $("#audio-player");
        const st = state.study;
        st.data.progressSec = Math.max(st.data.progressSec || 0, sess.endSec);
        const isLast = st.currentIndex >= st.sessions.length - 1;
        if (!isLast) {
            st.currentIndex += 1;
            st.data.resumeSec = st.sessions[st.currentIndex].startSec;
        }
        if (state.settings.sessionEndPause || isLast) {
            audio.pause();
            if (!isLast) {
                // 다음 세션 시작점으로 미리 시크 — 이어폰 play 한 번이면 다음 세션
                audio.currentTime = Math.max(0, st.data.resumeSec - state.settings.syncOffset);
            }
        }
        saveStudy(true);
        renderCommuteSessions();
        updateCommuteSummary();
    }

    // 이어폰 ⏮ — 현재 문장 처음부터 다시 + 암묵 마킹(replayCount++)
    let lastReplayAt = 0;
    function replayCurrentSentence() {
        const now = Date.now();
        if (now - lastReplayAt < 300) return; // 이어버드 더블 파이어 디바운스
        lastReplayAt = now;

        const audio = $("#audio-player");
        const subs = state.subtitles.primary;
        if (subs.length === 0) return;
        const t = audio.currentTime + state.settings.syncOffset;
        let idx = findSubtitleAtTime(subs, t);
        if (idx < 0) {
            idx = 0;
        } else if (idx > 0 && t - timeToSeconds(subs[idx].start) < 1.0) {
            // 반응시간 보정: 큐 시작 1초 이내에 눌렀다면 의도는 "방금 끝난 문장"
            idx -= 1;
        }

        bumpReplayCount(idx);
        if (state.playlist.active) state.loop._done = 0; // 재청취는 반복 카운트 리셋
        audio.currentTime = Math.max(0, audioTimeForSubtitleStart(idx) - 0.3);
        audio.play().catch(() => {});
    }

    // 이어폰 ⏭ — 다음 문장으로 스킵 (마킹 없음)
    function skipToNextSentence() {
        if (state.playlist.active) {
            advancePlaylist();
            return;
        }
        const audio = $("#audio-player");
        const subs = state.subtitles.primary;
        if (subs.length === 0) return;
        const t = audio.currentTime + state.settings.syncOffset;
        const idx = findSubtitleAtTime(subs, t);
        const next = Math.min(idx + 1, subs.length - 1);
        if (next <= idx) return;
        audio.currentTime = audioTimeForSubtitleStart(next);
        audio.play().catch(() => {});
    }

    function bumpReplayCount(idx) {
        const data = state.study.data;
        if (!data) return;
        const key = String(idx);
        const rec = data.cues[key] || (data.cues[key] = {});
        rec.r = (rec.r || 0) + 1;
        saveStudy();
    }

    // ============================================================
    // 복습 재생 (마킹 문장 플레이리스트) — 퇴근길 귀-only 재검증
    // 마킹 큐를 시간순으로 문장당 2회씩 루프 엔진에 물려 재생한다.
    // ============================================================

    function toggleMarkedPlaylist() {
        if (state.playlist.active) {
            stopPlaylist(true);
        } else {
            startMarkedPlaylist();
        }
    }

    function startMarkedPlaylist() {
        const cues = markedCuesInOrder();
        if (cues.length === 0) return;
        cancelLoop();
        state.playlist.cues = cues;
        state.playlist.pos = 0;
        state.playlist.active = true;
        playPlaylistCue();
        updateCommuteSummary();
    }

    function playPlaylistCue() {
        const idx = state.playlist.cues[state.playlist.pos];
        state.loop.startIndex = idx;
        state.loop.endIndex = idx;
        state.loop.active = true;
        state.loop._done = 0;
        state.loop._finished = false;
        state.loop._waiting = false;
        seekToLoopStart();
    }

    function advancePlaylist() {
        state.playlist.pos += 1;
        if (state.playlist.pos >= state.playlist.cues.length) {
            stopPlaylist(true); // 완주 → 정지
            return;
        }
        playPlaylistCue();
    }

    function stopPlaylist(pauseAudio) {
        const wasActive = state.playlist.active;
        state.playlist.active = false;
        state.playlist.cues = [];
        state.playlist.pos = 0;
        if (wasActive) {
            cancelLoop();
            if (pauseAudio) $("#audio-player").pause();
            updateCommuteSummary();
        }
    }

    // ============================================================
    // 리뷰 모드 — 마킹한 문장을 이중자막 + 문장 루프로 집중 복습
    // ============================================================

    async function enterReviewFromHome() {
        const session = await loadFromSavedSession();
        if (!session) return;
        setupAudio();
        state.review.from = "home";
        enterReview(null);
    }

    function enterReview(sessionIdx) {
        if (state.subtitles.primary.length === 0) return;
        stopPlaylist(false);
        cancelLoop();
        state.mode = "review";
        ensureStudy();
        if (state.study.sessions.length === 0) computeStudySessions();
        if (state.study.sessions.length === 0) return;

        if (sessionIdx === null || sessionIdx === undefined) {
            // 기본: 가장 최근 마킹이 속한 세션, 없으면 현재 진도 세션
            const marked = markedCuesInOrder();
            sessionIdx = marked.length > 0
                ? sessionIndexForCue(marked[marked.length - 1])
                : sessionIndexForSec(state.study.data.resumeSec || 0);
        }
        state.review.sessionIndex = Math.max(0, Math.min(sessionIdx, state.study.sessions.length - 1));
        state.review.filter = sessionHasMarks(state.review.sessionIndex) ? "marked" : "all";
        updateMediaSession();
        renderLoopOptions();
        renderReviewList();
        showView("review");
    }

    function exitReview() {
        cancelLoop();
        if (state.review.from === "commute") {
            state.mode = "commute";
            updateMediaSession();
            renderCommuteSessions();
            updateCommuteSummary();
            showView("commute");
        } else {
            state.mode = "reader";
            updateMediaSession();
            showView("movies");
            showHomeScreen();
        }
    }

    function sessionIndexForCue(cueIdx) {
        const ss = state.study.sessions;
        for (let i = 0; i < ss.length; i++) {
            if (cueIdx <= ss[i].endCue) return i;
        }
        return Math.max(0, ss.length - 1);
    }

    function sessionHasMarks(sessionIdx) {
        const sess = state.study.sessions[sessionIdx];
        if (!sess || !state.study.data) return false;
        const cues = state.study.data.cues;
        return Object.keys(cues).some((k) => {
            const i = Number(k);
            return cues[k].r > 0 && i >= sess.startCue && i <= sess.endCue;
        });
    }

    function renderReviewList() {
        const list = $("#review-list");
        const sess = state.study.sessions[state.review.sessionIndex];
        if (!list || !sess) return;
        const scrollTop = list.scrollTop;
        const subs = state.subtitles.primary;
        const secSubs = state.subtitles.secondary;
        const cuesData = state.study.data.cues;

        list.classList.toggle("review-blind", state.review.blind);
        list.innerHTML = "";

        let shown = 0;
        let markedCount = 0;
        for (let i = sess.startCue; i <= sess.endCue; i++) {
            const rec = cuesData[String(i)];
            const replays = rec && rec.r ? rec.r : 0;
            if (replays > 0) markedCount += 1;
            if (state.review.filter === "marked" && replays === 0) continue;
            shown += 1;

            const card = document.createElement("div");
            card.className = "loop-card review-card";
            if (rec && rec.d) card.classList.add("review-done");
            if (state.loop.active && state.loop.startIndex === i && state.loop.endIndex === i) {
                card.classList.add("playing");
            }

            const entry = subs[i];
            const timeStr = entry.start.split(",")[0];
            let html = '<div class="review-card-head">';
            html += `<span class="loop-card-time">#${i + 1} · ${timeStr}</span>`;
            if (replays > 0) {
                html += `<span class="review-badge${replays >= 2 ? " hot" : ""}">🔁 ${replays}</span>`;
            }
            html += `<button type="button" class="review-done-btn${rec && rec.d ? " active" : ""}">✓</button>`;
            html += "</div>";
            html += `<div class="loop-card-text">${sanitizeSubtitleHtml(entry.text).replace(/\n/g, " ")}</div>`;
            if (secSubs.length > 0) {
                const secIdx = findSubtitleAtTime(secSubs, timeToSeconds(entry.start));
                if (secIdx >= 0) {
                    html += `<div class="loop-card-secondary">${sanitizeSubtitleHtml(secSubs[secIdx].text).replace(/\n/g, " ")}</div>`;
                }
            }
            card.innerHTML = html;

            card.addEventListener("click", () => toggleReviewPlayback(i));
            card.querySelector(".review-done-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                toggleReviewDone(i);
            });
            if (state.review.blind) {
                card.querySelector(".loop-card-text").addEventListener("click", (e) => {
                    if (!card.classList.contains("revealed")) {
                        e.stopPropagation(); // 첫 탭은 공개만, 재생은 그 다음 탭부터
                        card.classList.add("revealed");
                    }
                });
            }
            list.appendChild(card);
        }

        if (shown === 0) {
            const empty = document.createElement("div");
            empty.className = "review-empty";
            empty.textContent = "이 세션에는 다시 들은 문장이 없습니다";
            list.appendChild(empty);
        }

        $("#review-session-label").textContent =
            `세션 ${state.review.sessionIndex + 1}/${state.study.sessions.length}` +
            ` · 다시들은 문장 ${markedCount}개`;
        $("#btn-review-filter-marked").classList.toggle("active", state.review.filter === "marked");
        $("#btn-review-filter-all").classList.toggle("active", state.review.filter === "all");
        $("#btn-review-blind").classList.toggle("active", state.review.blind);
        list.scrollTop = scrollTop;
    }

    // 카드 탭 = 그 문장만 루프 재생 (기존 A-B 엔진, start=end)
    function toggleReviewPlayback(i) {
        const audio = $("#audio-player");
        const isPlaying = state.loop.active &&
            state.loop.startIndex === i && state.loop.endIndex === i;
        stopPlaylist(false);
        cancelLoop();
        if (isPlaying) {
            audio.pause();
        } else if (state.audioFile) {
            state.loop.startIndex = i;
            state.loop.endIndex = i;
            state.loop.active = true;
            seekToLoopStart();
        }
        renderReviewList();
    }

    function toggleReviewDone(i) {
        const data = state.study.data;
        if (!data) return;
        const key = String(i);
        const rec = data.cues[key] || (data.cues[key] = {});
        rec.d = !rec.d;
        saveStudy(true);
        renderReviewList();
    }

    function clearSessionMarks() {
        const sess = state.study.sessions[state.review.sessionIndex];
        const data = state.study.data;
        if (!sess || !data) return;
        if (!confirm(`세션 ${state.review.sessionIndex + 1}의 마킹을 모두 지울까요?`)) return;
        Object.keys(data.cues).forEach((k) => {
            const i = Number(k);
            if (i >= sess.startCue && i <= sess.endCue) delete data.cues[k];
        });
        saveStudy(true);
        renderReviewList();
    }

    function navReviewSession(dir) {
        const next = state.review.sessionIndex + dir;
        if (next < 0 || next >= state.study.sessions.length) return;
        cancelLoop();
        state.review.sessionIndex = next;
        state.review.filter = sessionHasMarks(next) ? "marked" : "all";
        renderReviewList();
    }

    // --- Event binding ---
    function bindEvents() {
        // Home menu cards
        $("#menu-movie-list").addEventListener("click", () => {
            showMovieListSection();
        });

        $("#menu-resume").addEventListener("click", () => {
            resumeSession();
        });

        $("#menu-create-folder").addEventListener("click", () => {
            createMovie();
        });

        // Back to home from movie list sub-view
        $("#btn-back-home").addEventListener("click", () => {
            showHomeScreen();
        });

        // Back to home (movies view) from file selection
        $("#btn-back-movies").addEventListener("click", () => {
            showView("movies");
            showMovieListSection();
        });

        $("#btn-back-files").addEventListener("click", () => {
            showView("files");
        });

        $("#btn-home").addEventListener("click", goHome);

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

        // Auto sync toggle
        $("#btn-auto-sync").addEventListener("click", () => {
            state.settings.autoSync = !state.settings.autoSync;
            applySettings();
            saveSettings();
        });

        // Sync offset
        $("#btn-sync-up").addEventListener("click", () => {
            state.settings.syncOffset = Math.round((state.settings.syncOffset + 0.5) * 10) / 10;
            updateSyncDisplay();
            saveSettings();
        });
        $("#btn-sync-down").addEventListener("click", () => {
            state.settings.syncOffset = Math.round((state.settings.syncOffset - 0.5) * 10) / 10;
            updateSyncDisplay();
            saveSettings();
        });

        // Time jump
        $("#btn-time-jump").addEventListener("click", doTimeJump);
        $("#time-jump-input").addEventListener("keydown", (e) => {
            if (e.key === "Enter") doTimeJump();
        });

        // Upload
        const fileUpload = $("#file-upload");
        if (fileUpload) {
            fileUpload.addEventListener("change", () => handleUpload(fileUpload));
        }

        // Create movie folder (in movie list sub-view)
        const btnCreate = $("#btn-create-movie");
        if (btnCreate) {
            btnCreate.addEventListener("click", createMovie);
        }

        // Loop
        $("#btn-loop").addEventListener("click", () => showLoopSetup(false));
        $("#btn-loop-back").addEventListener("click", () => showView("reader"));
        $("#btn-loop-home").addEventListener("click", goHome);
        $("#btn-loop-save").addEventListener("click", saveLoop);
        $("#btn-loop-cancel").addEventListener("click", cancelLoop);
        $("#btn-session-repeat").addEventListener("click", toggleSessionRepeat);
        $("#btn-loop-replay").addEventListener("click", replayLoop);
        $("#loop-indicator-main").addEventListener("click", () => showLoopSetup(true));

        // Loop options (repeat count / end gap)
        $$("[data-count]").forEach((b) => {
            b.addEventListener("click", () => {
                state.settings.loopCount = parseInt(b.dataset.count);
                saveSettings();
                renderLoopOptions();
            });
        });
        $$("[data-gap]").forEach((b) => {
            b.addEventListener("click", () => {
                state.settings.loopGap = parseInt(b.dataset.gap);
                saveSettings();
                renderLoopOptions();
            });
        });

        // Playback rate (설정 패널 + 라이딩 뷰 공용)
        $$("[data-rate]").forEach((b) => {
            b.addEventListener("click", () => {
                state.settings.playbackRate = parseFloat(b.dataset.rate);
                applyPlaybackRate();
                saveSettings();
                updatePositionState();
            });
        });

        // Commute: 라이딩 미리보기 자막 선택 (1st/2nd)
        $$("[data-commute-subtitle]").forEach((b) => {
            b.addEventListener("click", () => {
                state.settings.commuteSubtitle = b.dataset.commuteSubtitle;
                saveSettings();
                applySettings();
                updateCommuteNow($("#audio-player").currentTime);
            });
        });

        // Commute: session length — 변경 시 세션 재계산 (기록은 시간 기준이라 유효 유지)
        $$("[data-commute-min]").forEach((b) => {
            b.addEventListener("click", () => {
                state.settings.commuteTargetMin = parseInt(b.dataset.commuteMin);
                saveSettings();
                applySettings();
                if (state.study.data && state.subtitles.primary.length > 0) {
                    computeStudySessions();
                    state.study.currentIndex = sessionIndexForSec(state.study.data.resumeSec || 0);
                    if (views.commute.classList.contains("active")) {
                        renderCommuteSessions();
                        updateCommuteSummary();
                    }
                }
            });
        });

        $("#btn-session-end-pause").addEventListener("click", () => {
            state.settings.sessionEndPause = !state.settings.sessionEndPause;
            saveSettings();
            applySettings();
        });
        $("#btn-commute-swap").addEventListener("click", () => {
            state.settings.commuteSwapButtons = !state.settings.commuteSwapButtons;
            saveSettings();
            applySettings();
        });

        // Home: 라이딩 / 리뷰 카드
        $("#menu-commute").addEventListener("click", enterCommuteFromHome);
        $("#menu-review").addEventListener("click", enterReviewFromHome);

        // Commute view
        $("#btn-commute").addEventListener("click", () => {
            state.commuteFrom = "reader";
            enterCommute();
        });
        $("#btn-commute-back").addEventListener("click", exitCommute);
        $("#btn-commute-home").addEventListener("click", goHome);
        $("#btn-commute-open-review").addEventListener("click", () => {
            state.review.from = "commute";
            enterReview(state.study.currentIndex);
        });
        $("#btn-commute-play").addEventListener("click", () => {
            const audio = $("#audio-player");
            if (audio.paused) startCommutePlayback(false);
            else audio.pause();
        });
        $("#btn-commute-restart").addEventListener("click", () => startCommutePlayback(true));
        $("#btn-commute-playlist").addEventListener("click", toggleMarkedPlaylist);

        // Review view
        $("#btn-review-back").addEventListener("click", exitReview);
        $("#btn-review-home").addEventListener("click", goHome);
        $("#btn-review-prev-session").addEventListener("click", () => navReviewSession(-1));
        $("#btn-review-next-session").addEventListener("click", () => navReviewSession(1));
        $("#btn-review-filter-marked").addEventListener("click", () => {
            state.review.filter = "marked";
            renderReviewList();
        });
        $("#btn-review-filter-all").addEventListener("click", () => {
            state.review.filter = "all";
            renderReviewList();
        });
        $("#btn-review-blind").addEventListener("click", () => {
            state.review.blind = !state.review.blind;
            renderReviewList();
        });
        $("#btn-review-clear-marks").addEventListener("click", clearSessionMarks);

        setupSwipe();
        setupKeyboard();
    }

    // --- Init ---
    async function init() {
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("sw.js").catch(() => {});
        }
        loadSettings();
        bindEvents();
        showHomeScreen();
        updateResumeCard();
        await loadMovies();

        // Re-acquire wake lock when returning to the app
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && views.reader.classList.contains("active")) {
                requestWakeLock();
            }
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
