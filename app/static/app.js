(function () {
    "use strict";

    // --- State ---
    const state = {
        movies: [],
        currentMovie: null,
        files: [],
        selectedFiles: [],
        subtitles: { primary: [], secondary: [] },
        position: 0,
        positionSecondary: 0,
        settings: {
            linesPerView: 1,
            navMode: "page",
            fontSize: 24,
            syncOffset: 0,
            autoSync: true,
        },
        uploadEnabled: true,
        audioFile: null,
        wakeLock: null,
        loop: {
            startIndex: null,
            endIndex: null,
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

    const views = {
        movies: $("#view-movies"),
        files: $("#view-files"),
        reader: $("#view-reader"),
        loop: $("#view-loop"),
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

    async function resumeSession() {
        const session = loadSession();
        if (!session) return;

        state.currentMovie = session.movie;
        state.selectedFiles = session.files;

        // Detect MP3 audio file for this movie
        const allFiles = await api.getFiles(state.currentMovie);
        state.audioFile = allFiles.find(f => f.endsWith('.mp3')) || null;

        state.subtitles.primary = await api.getSubtitles(
            state.currentMovie,
            state.selectedFiles[0]
        );
        state.subtitles.secondary =
            state.selectedFiles.length > 1
                ? await api.getSubtitles(state.currentMovie, state.selectedFiles[1])
                : [];

        state.position = Math.min(session.position, state.subtitles.primary.length - 1);
        setupAudio();
        if (state.audioFile && session.audioTime) {
            $("#audio-player").currentTime = session.audioTime;
        }
        renderSubtitles();
        showView("reader");
    }

    // --- View 1: Movies ---
    async function loadMovies() {
        state.movies = await api.getMovies();
        const list = $("#movie-list");
        list.innerHTML = "";
        state.movies.forEach((movie) => {
            const el = document.createElement("div");
            el.className = "card-item";
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

        const resp = await api.createMovie(name.trim());
        if (resp.ok) {
            await loadMovies();
        } else {
            const err = await resp.json();
            alert(err.detail || "폴더 생성 실패");
        }
    }

    // --- View 2: Files ---
    async function selectMovie(movie) {
        state.currentMovie = movie;
        state.selectedFiles = [];
        cancelLoop();
        $("#movie-title").textContent = movie;
        state.files = await api.getFiles(movie);
        state.audioFile = state.files.find(f => f.endsWith('.mp3')) || null;
        state.files = state.files.filter(f => f.endsWith('.srt') || f.endsWith('.smi'));
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
        cancelLoop();
        state.subtitles.primary = await api.getSubtitles(
            state.currentMovie,
            state.selectedFiles[0]
        );
        state.subtitles.secondary =
            state.selectedFiles.length > 1
                ? await api.getSubtitles(state.currentMovie, state.selectedFiles[1])
                : [];
        state.position = 0;
        state.positionSecondary = 0;
        setupAudio();
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
            .map((e) => `<div>${e.text.replace(/\n/g, "<br>")}</div>`)
            .join("");

        $("#card-secondary").innerHTML = secondary
            .map((e) => `<div>${e.text.replace(/\n/g, "<br>")}</div>`)
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
        const idx = findNearestSubtitle(subs, targetSeconds);

        state.position = idx;
        renderSubtitles();

        const entry = subs[idx];
        const feedback = $("#time-jump-feedback");
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

        const btnLoop = $("#btn-loop");
        if (btnLoop) btnLoop.classList.remove("hidden");
    }

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

    function onAudioError() {
        console.warn("Audio load failed, falling back to manual mode");
        $("#audio-container").classList.add("hidden");
        state.audioFile = null;
    }

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
    }

    // --- Upload ---
    async function handleUpload(fileInput) {
        const file = fileInput.files[0];
        if (!file) return;

        const resp = await api.uploadFile(state.currentMovie, file);
        if (resp.ok) {
            state.files = await api.getFiles(state.currentMovie);
            renderFileList();
        } else {
            const err = await resp.json();
            alert(err.detail || "업로드 실패");
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
    }

    // --- Loop Setup ---
    function showLoopSetup() {
        state.loop.startIndex = null;
        state.loop.endIndex = null;
        renderLoopList();
        showView("loop");
        setupLoopScrubber();
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

    function setupLoopScrubber() {
        const scrubber = $("#loop-scrubber");
        const thumb = $("#loop-scrubber-thumb");
        const label = $("#loop-scrubber-label");
        const list = $("#loop-subtitle-list");

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
        audio.play().catch(() => {});
    }

    function cancelLoop() {
        state.loop.active = false;
        state.loop.startIndex = null;
        state.loop.endIndex = null;
        $("#loop-indicator").classList.add("hidden");
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

        $("#btn-home").addEventListener("click", () => {
            showView("movies");
            showHomeScreen();
            loadMovies();
        });

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
        $("#btn-loop").addEventListener("click", showLoopSetup);
        $("#btn-loop-back").addEventListener("click", () => showView("reader"));
        $("#btn-loop-save").addEventListener("click", saveLoop);
        $("#btn-loop-cancel").addEventListener("click", cancelLoop);

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
