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
    }

    function updateCreateMovieVisibility() {
        const section = $("#create-movie-section");
        if (section) {
            section.style.display = state.uploadEnabled ? "" : "none";
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
        renderFileList();
        updateUploadVisibility();
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
        $("#btn-back-movies").addEventListener("click", () => {
            showView("movies");
            loadMovies();
        });

        $("#btn-back-files").addEventListener("click", () => {
            showView("files");
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

        // Upload
        const fileUpload = $("#file-upload");
        if (fileUpload) {
            fileUpload.addEventListener("change", () => handleUpload(fileUpload));
        }

        // Create movie folder
        const btnCreate = $("#btn-create-movie");
        if (btnCreate) {
            btnCreate.addEventListener("click", createMovie);
        }

        setupSwipe();
        setupKeyboard();
    }

    // --- Init ---
    function init() {
        loadSettings();
        bindEvents();
        loadMovies();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
