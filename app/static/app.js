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
        settings: {
            linesPerView: 1,
            navMode: "page",
            fontSize: 24,
        },
        uploadEnabled: true,
        audioFile: null,
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
    };

    // --- View switching ---
    function showView(name) {
        Object.values(views).forEach((v) => v.classList.remove("active"));
        views[name].classList.add("active");
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
        $("#movie-title").textContent = movie;
        state.files = await api.getFiles(movie);
        state.audioFile = state.files.find(f => f.endsWith('.mp3')) || null;
        state.files = state.files.filter(f => f.endsWith('.srt'));
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
            el.textContent = file;
            el.addEventListener("click", () => toggleFileSelection(file, el));
            if (state.selectedFiles.includes(file)) {
                el.classList.add("selected");
            }
            list.appendChild(el);
        });
        updateStartButton();
    }

    function toggleFileSelection(file, el) {
        const idx = state.selectedFiles.indexOf(file);
        if (idx >= 0) {
            state.selectedFiles.splice(idx, 1);
            el.classList.remove("selected");
        } else if (state.selectedFiles.length < 2) {
            state.selectedFiles.push(file);
            el.classList.add("selected");
        }
        updateStartButton();
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
        state.subtitles.primary = await api.getSubtitles(
            state.currentMovie,
            state.selectedFiles[0]
        );
        state.subtitles.secondary =
            state.selectedFiles.length > 1
                ? await api.getSubtitles(state.currentMovie, state.selectedFiles[1])
                : [];
        state.position = 0;
        setupAudio();
        renderSubtitles();
        showView("reader");
    }

    function getVisibleEntries(subs) {
        const { linesPerView } = state.settings;
        const start = state.position;
        const end = Math.min(start + linesPerView, subs.length);
        return subs.slice(start, end);
    }

    function renderSubtitles() {
        const primary = getVisibleEntries(state.subtitles.primary);
        const secondary = getVisibleEntries(state.subtitles.secondary);

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
            return;
        }

        const src = `api/movies/${encodeURIComponent(state.currentMovie)}/audio/${encodeURIComponent(state.audioFile)}`;
        audio.src = src;
        container.classList.remove("hidden");

        updateMediaSession();

        audio.removeEventListener("timeupdate", onTimeUpdate);
        audio.addEventListener("timeupdate", onTimeUpdate);

        audio.removeEventListener("error", onAudioError);
        audio.addEventListener("error", onAudioError);
    }

    function onTimeUpdate() {
        const audio = $("#audio-player");
        const t = audio.currentTime;
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

    function applySettings() {
        document.documentElement.style.setProperty(
            "--font-size",
            state.settings.fontSize + "px"
        );
        $("#font-size-display").textContent = state.settings.fontSize + "px";

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
    }

    document.addEventListener("DOMContentLoaded", init);
})();
