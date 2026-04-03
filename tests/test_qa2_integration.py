"""
QA-2 Integration Test Suite
Covers: static file serving, API response format, upload flow, production config,
and JS navigation logic (documented as comments where browser is required).
"""

import os
import importlib
import pytest
from fastapi.testclient import TestClient

from app.main import create_app, create_default_app, _mount_static
from app.upload_router import create_upload_router


# ---------------------------------------------------------------------------
# Shared SRT content
# ---------------------------------------------------------------------------

SRT_EN_10 = "\n\n".join(
    f"{i}\n00:00:{i:02d},000 --> 00:00:{i:02d},999\nLine {i}"
    for i in range(1, 11)
) + "\n"

SRT_KO_8 = "\n\n".join(
    f"{i}\n00:00:{i:02d},000 --> 00:00:{i:02d},999\n한글 {i}"
    for i in range(1, 9)
) + "\n"

SRT_XSS = (
    "1\n00:00:01,000 --> 00:00:02,000\n"
    "<script>alert('xss')</script>\n\n"
    "2\n00:00:03,000 --> 00:00:04,000\n"
    '<img src=x onerror="alert(1)">\n'
)

SRT_UNICODE = (
    "1\n00:00:01,000 --> 00:00:02,000\n"
    "한국어 자막 테스트 🎬\n\n"
    "2\n00:00:03,000 --> 00:00:04,000\n"
    "日本語のテスト\n"
)

SRT_MULTILINE = (
    "1\n00:00:01,000 --> 00:00:02,000\n"
    "First line\nSecond line\n\n"
    "2\n00:00:03,000 --> 00:00:04,000\n"
    "Only one line\n"
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_subs(tmp_path):
    """Create a subtitles directory with an 'example' movie."""
    movie_dir = tmp_path / "example"
    movie_dir.mkdir()
    (movie_dir / "en.srt").write_text(SRT_EN_10, encoding="utf-8")
    (movie_dir / "ko.srt").write_text(SRT_KO_8, encoding="utf-8")
    (movie_dir / "xss.srt").write_text(SRT_XSS, encoding="utf-8")
    (movie_dir / "unicode.srt").write_text(SRT_UNICODE, encoding="utf-8")
    (movie_dir / "multiline.srt").write_text(SRT_MULTILINE, encoding="utf-8")
    return tmp_path


@pytest.fixture
def client_no_static(tmp_subs):
    """API-only client (no static files mounted)."""
    app = create_app(subtitles_dir=tmp_subs)
    return TestClient(app)


@pytest.fixture
def client_with_upload(tmp_subs):
    """API + upload router, no static files."""
    app = create_app(subtitles_dir=tmp_subs)
    app.include_router(create_upload_router(tmp_subs))
    return TestClient(app)


@pytest.fixture
def client_full(tmp_subs):
    """Full stack: API + upload + static files."""
    app = create_app(subtitles_dir=tmp_subs)
    app.include_router(create_upload_router(tmp_subs))
    _mount_static(app)
    return TestClient(app)


# ===========================================================================
# 1. Static file serving
# ===========================================================================

class TestStaticFileServing:
    def test_index_html_served(self, client_full):
        """GET / returns index.html with status 200."""
        resp = client_full.get("/")
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]
        assert "Subtitle Viewer" in resp.text

    def test_style_css_served(self, client_full):
        """GET /style.css returns the stylesheet."""
        resp = client_full.get("/style.css")
        assert resp.status_code == 200
        assert "text/css" in resp.headers["content-type"]

    def test_app_js_served(self, client_full):
        """GET /app.js returns the JavaScript bundle."""
        resp = client_full.get("/app.js")
        assert resp.status_code == 200
        assert "javascript" in resp.headers["content-type"]

    def test_api_takes_priority_over_static(self, client_full):
        """API routes must NOT be shadowed by the static catch-all."""
        resp = client_full.get("/api/movies")
        assert resp.status_code == 200
        data = resp.json()
        # Must return a list, not an HTML page
        assert isinstance(data, list)

    def test_nonexistent_static_file_returns_404(self, client_full):
        """A missing static file returns 404, not 500."""
        resp = client_full.get("/nonexistent-file.xyz")
        assert resp.status_code == 404

    def test_static_not_mounted_without_mount_call(self, client_no_static):
        """Without _mount_static, / is not served by static handler."""
        resp = client_no_static.get("/")
        # No static mount → FastAPI returns 404 for unknown path
        assert resp.status_code == 404


# ===========================================================================
# 2. API response format — what the frontend JS expects
# ===========================================================================

class TestApiResponseFormat:
    """
    Frontend app.js (api.getSubtitles) expects each item to have:
      { index: int, start: str, end: str, text: str }

    api.getMovies  → plain list of strings
    api.getFiles   → plain list of strings
    """

    def test_get_movies_returns_list_of_strings(self, client_no_static):
        resp = client_no_static.get("/api/movies")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert all(isinstance(m, str) for m in data)

    def test_get_files_returns_list_of_strings(self, client_no_static):
        resp = client_no_static.get("/api/movies/example/files")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert all(isinstance(f, str) for f in data)

    def test_subtitle_entry_has_required_keys(self, client_no_static):
        resp = client_no_static.get("/api/movies/example/subtitles/en.srt")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 10
        for entry in data:
            assert "index" in entry, "missing 'index' field"
            assert "start" in entry, "missing 'start' field"
            assert "end" in entry, "missing 'end' field"
            assert "text" in entry, "missing 'text' field"

    def test_subtitle_index_is_int(self, client_no_static):
        resp = client_no_static.get("/api/movies/example/subtitles/en.srt")
        data = resp.json()
        for entry in data:
            assert isinstance(entry["index"], int)

    def test_subtitle_text_is_string(self, client_no_static):
        resp = client_no_static.get("/api/movies/example/subtitles/en.srt")
        data = resp.json()
        for entry in data:
            assert isinstance(entry["text"], str)

    def test_response_content_type_is_json(self, client_no_static):
        resp = client_no_static.get("/api/movies/example/subtitles/en.srt")
        assert "application/json" in resp.headers["content-type"]

    def test_xss_content_returned_as_raw_text(self, client_no_static):
        """
        API must return raw subtitle text (including angle-bracket chars).
        XSS safety is the browser renderer's job; the JSON should NOT be HTML-escaped.
        The text field should preserve < and > as literal characters.
        """
        resp = client_no_static.get("/api/movies/example/subtitles/xss.srt")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        # The raw text must still contain angle brackets
        combined = " ".join(e["text"] for e in data)
        assert "<script>" in combined or "<img" in combined, (
            "XSS text not preserved in API response"
        )

    def test_unicode_properly_encoded_in_json(self, client_no_static):
        """Korean + emoji + Japanese must survive the JSON round-trip."""
        resp = client_no_static.get("/api/movies/example/subtitles/unicode.srt")
        assert resp.status_code == 200
        data = resp.json()
        texts = [e["text"] for e in data]
        assert any("한국어" in t for t in texts), "Korean text lost"
        assert any("🎬" in t for t in texts), "Emoji lost"
        assert any("日本語" in t for t in texts), "Japanese text lost"

    def test_korean_sample_srt_api(self, client_no_static):
        """Verify the bundled ko.srt (8 entries) is served correctly."""
        resp = client_no_static.get("/api/movies/example/subtitles/ko.srt")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 8
        assert data[0]["text"] == "한글 1"

    def test_multiline_text_preserved(self, client_no_static):
        """Multi-line subtitle text must be joined with \\n (not lost)."""
        resp = client_no_static.get("/api/movies/example/subtitles/multiline.srt")
        assert resp.status_code == 200
        data = resp.json()
        # Entry 1 has two lines separated by \n
        assert "\n" in data[0]["text"], "newline within subtitle block not preserved"

    def test_movies_list_is_sorted(self, tmp_path):
        """GET /api/movies returns entries in sorted order."""
        for name in ["zebra", "alpha", "movie2"]:
            (tmp_path / name).mkdir()
        app = create_app(subtitles_dir=tmp_path)
        client = TestClient(app)
        data = client.get("/api/movies").json()
        assert data == sorted(data)

    def test_files_list_is_sorted(self, client_no_static):
        """GET /api/movies/{movie}/files returns entries in sorted order."""
        data = client_no_static.get("/api/movies/example/files").json()
        assert data == sorted(data)


# ===========================================================================
# 3. Frontend JavaScript navigation logic  (server-side where possible)
# ===========================================================================

class TestNavigationLogic:
    """
    Many JS tests require a browser. Those are documented as comments.
    Server-side tests validate the data that navigation logic depends on.
    """

    # --- Server-side: verify data shapes navigation needs ---

    def test_primary_has_10_entries(self, client_no_static):
        """en.srt (primary) has 10 entries."""
        data = client_no_static.get("/api/movies/example/subtitles/en.srt").json()
        assert len(data) == 10

    def test_secondary_has_8_entries(self, client_no_static):
        """ko.srt (secondary) has 8 entries — mismatched length with primary."""
        data = client_no_static.get("/api/movies/example/subtitles/ko.srt").json()
        assert len(data) == 8

    def test_indices_are_sequential_from_1(self, client_no_static):
        """Entry indices start at 1 and are sequential (JS uses position, not index)."""
        data = client_no_static.get("/api/movies/example/subtitles/en.srt").json()
        for i, entry in enumerate(data, start=1):
            assert entry["index"] == i

    # --- JS logic documented as manual tests ---
    # These cannot run without a real browser / jsdom environment.

    # MANUAL TEST: Page mode navigation
    # Setup: linesPerView=1, navMode="page", primary=[10 entries]
    # 1. Initial state: position=0  → shows entry[0]
    # 2. navigate(1)   → position=1, shows entry[1]
    # 3. navigate(-1)  → position=0, shows entry[0]
    # 4. navigate(-1) at position=0 → NO-OP (newPos=-1 < 0, guard fires)
    # 5. navigate(1) at position=9 → NO-OP (newPos=10 >= total=10, guard fires)

    # MANUAL TEST: Slide mode navigation
    # Setup: linesPerView=3, navMode="slide", primary=[10 entries]
    # step = 1 (slide mode always steps by 1 regardless of linesPerView)
    # navigate(1) → position advances by 1 each call
    # Expected: position 9→ navigate(1) → NO-OP

    # MANUAL TEST: Page mode with linesPerView=3
    # Setup: linesPerView=3, navMode="page", primary=[10 entries]
    # step = 3
    # position=0 → navigate(1) → position=3  ✓ (3 < 10)
    # position=3 → navigate(1) → position=6  ✓ (6 < 10)
    # position=6 → navigate(1) → position=9  ✓ (9 < 10)
    # position=9 → navigate(1) → NO-OP       (12 >= 10)
    # position=9 → navigate(-1) → position=6 ✓

    # MANUAL TEST: Dual subtitle mode with mismatched lengths (primary=10, secondary=8)
    # getVisibleEntries slices [position : position+linesPerView] for BOTH arrays
    # When position=8, secondary.slice(8,9) → [] (empty)
    # card-secondary innerHTML → "" (no entries shown)
    # position-indicator still shows primary: "9 / 10"
    # This is expected behavior — no crash, secondary silently shows nothing.

    # MANUAL TEST: Font size bounds
    # Initial fontSize=24 (default)
    # btn-font-up clicked × 13: 24+26=50 → clamped to 48 (Math.min(...,48))
    # btn-font-down clicked × 6: 24-12=12 → clamped to 14 (Math.max(...,14))
    # After clamp, --font-size CSS var and font-size-display span must match.

    # MANUAL TEST: Settings persistence (localStorage)
    # Change fontSize to 32, navMode to "slide", linesPerView to 2
    # Reload page → applySettings() re-reads localStorage → state matches saved values


# ===========================================================================
# 4. Upload integration
# ===========================================================================

class TestUploadIntegration:
    def test_full_flow_create_upload_list(self, tmp_path):
        """Create movie → upload .srt → verify it appears in files list."""
        app = create_app(subtitles_dir=tmp_path)
        app.include_router(create_upload_router(tmp_path))
        client = TestClient(app)

        # Step 1: create movie
        resp = client.post("/api/movies", json={"name": "newmovie"})
        assert resp.status_code == 201
        assert (tmp_path / "newmovie").is_dir()

        # Step 2: upload subtitle
        srt = b"1\n00:00:01,000 --> 00:00:02,000\nTest subtitle\n"
        resp = client.post(
            "/api/movies/newmovie/upload",
            files={"file": ("test.srt", srt, "application/octet-stream")},
        )
        assert resp.status_code == 201
        assert resp.json()["uploaded"] == "test.srt"

        # Step 3: verify it appears in listing
        resp = client.get("/api/movies/newmovie/files")
        assert resp.status_code == 200
        assert "test.srt" in resp.json()

        # Step 4: verify movies list includes new movie
        resp = client.get("/api/movies")
        assert "newmovie" in resp.json()

        # Step 5: read the uploaded subtitle content
        resp = client.get("/api/movies/newmovie/subtitles/test.srt")
        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["text"] == "Test subtitle"

    def test_upload_endpoint_unavailable_when_disabled(self, tmp_path):
        """When upload router is NOT included, upload endpoint returns 405 or 404."""
        (tmp_path / "example").mkdir()
        app = create_app(subtitles_dir=tmp_path)
        client = TestClient(app)

        srt = b"1\n00:00:01,000 --> 00:00:02,000\nHello\n"
        resp = client.post(
            "/api/movies/example/upload",
            files={"file": ("en.srt", srt, "application/octet-stream")},
        )
        assert resp.status_code in {404, 405}

    def test_create_movie_endpoint_unavailable_when_disabled(self, tmp_path):
        """When upload router is NOT included, POST /api/movies returns 405 or 404."""
        app = create_app(subtitles_dir=tmp_path)
        client = TestClient(app)
        resp = client.post("/api/movies", json={"name": "test"})
        assert resp.status_code in {404, 405}

    def test_upload_duplicate_file_overwrites(self, tmp_path):
        """Uploading same filename twice overwrites the previous file."""
        (tmp_path / "mymovie").mkdir()
        app = create_app(subtitles_dir=tmp_path)
        app.include_router(create_upload_router(tmp_path))
        client = TestClient(app)

        first = b"1\n00:00:01,000 --> 00:00:02,000\nFirst\n"
        second = b"1\n00:00:01,000 --> 00:00:02,000\nSecond\n"

        client.post(
            "/api/movies/mymovie/upload",
            files={"file": ("dup.srt", first, "application/octet-stream")},
        )
        client.post(
            "/api/movies/mymovie/upload",
            files={"file": ("dup.srt", second, "application/octet-stream")},
        )
        content = (tmp_path / "mymovie" / "dup.srt").read_bytes()
        assert content == second

    def test_upload_invalid_movie_name(self, tmp_path):
        """Upload to a movie with an invalid name is rejected."""
        app = create_app(subtitles_dir=tmp_path)
        app.include_router(create_upload_router(tmp_path))
        client = TestClient(app)
        resp = client.post(
            "/api/movies/bad name!/upload",
            files={"file": ("en.srt", b"data", "application/octet-stream")},
        )
        assert resp.status_code == 400

    def test_upload_non_srt_file_rejected(self, tmp_path):
        """Non-.srt files are rejected."""
        (tmp_path / "mymovie").mkdir()
        app = create_app(subtitles_dir=tmp_path)
        app.include_router(create_upload_router(tmp_path))
        client = TestClient(app)
        resp = client.post(
            "/api/movies/mymovie/upload",
            files={"file": ("evil.sh", b"#!/bin/sh", "application/octet-stream")},
        )
        assert resp.status_code == 400

    def test_upload_oversized_file_rejected(self, tmp_path):
        """Files larger than 1MB are rejected."""
        (tmp_path / "mymovie").mkdir()
        app = create_app(subtitles_dir=tmp_path)
        app.include_router(create_upload_router(tmp_path))
        client = TestClient(app)
        big = b"x" * (1024 * 1024 + 1)
        resp = client.post(
            "/api/movies/mymovie/upload",
            files={"file": ("big.srt", big, "application/octet-stream")},
        )
        assert resp.status_code == 400

    # --- Bug fix validation: upload detection sentinel endpoint ---

    def test_upload_enabled_sentinel_present_when_upload_on(self, tmp_path):
        """GET /api/upload-enabled returns 200 + {enabled: true} when router included.
        This is the endpoint the JS frontend uses to show/hide the upload UI.
        Previously the frontend used OPTIONS /api/movies which always returned 405.
        """
        app = create_app(subtitles_dir=tmp_path)
        app.include_router(create_upload_router(tmp_path))
        client = TestClient(app)
        resp = client.get("/api/upload-enabled")
        assert resp.status_code == 200
        assert resp.json() == {"enabled": True}

    def test_upload_enabled_sentinel_absent_when_upload_off(self, tmp_path):
        """GET /api/upload-enabled returns 404 when upload router is NOT included."""
        app = create_app(subtitles_dir=tmp_path)
        client = TestClient(app)
        resp = client.get("/api/upload-enabled")
        assert resp.status_code == 404

    def test_options_api_movies_always_returns_405(self, tmp_path):
        """Regression guard: OPTIONS /api/movies is 405 regardless of upload router.
        This was the broken detection mechanism the frontend used before the fix.
        """
        # Without upload
        app = create_app(subtitles_dir=tmp_path)
        c = TestClient(app)
        assert c.options("/api/movies").status_code == 405

        # With upload — OPTIONS is STILL 405 (not a reliable signal)
        app2 = create_app(subtitles_dir=tmp_path)
        app2.include_router(create_upload_router(tmp_path))
        c2 = TestClient(app2)
        assert c2.options("/api/movies").status_code == 405


# ===========================================================================
# 5. Production config: create_default_app()
# ===========================================================================

class TestProductionConfig:
    def test_create_default_app_with_root_path(self, monkeypatch, tmp_path):
        """create_default_app() picks up SUBTITLE_ROOT_PATH from environment."""
        monkeypatch.setenv("SUBTITLE_ROOT_PATH", "/subtitle")
        monkeypatch.setenv("SUBTITLE_ENABLE_UPLOAD", "true")
        # Patch DEFAULT_SUBTITLES_DIR so no real fs dependency
        import app.main as main_mod
        backup = main_mod.DEFAULT_SUBTITLES_DIR
        main_mod.DEFAULT_SUBTITLES_DIR = tmp_path
        try:
            application = create_default_app()
            assert application.root_path == "/subtitle"
        finally:
            main_mod.DEFAULT_SUBTITLES_DIR = backup

    def test_create_default_app_upload_enabled(self, monkeypatch, tmp_path):
        """When SUBTITLE_ENABLE_UPLOAD=true, POST /api/movies returns 201 or 409."""
        monkeypatch.setenv("SUBTITLE_ROOT_PATH", "")
        monkeypatch.setenv("SUBTITLE_ENABLE_UPLOAD", "true")
        import app.main as main_mod
        backup = main_mod.DEFAULT_SUBTITLES_DIR
        main_mod.DEFAULT_SUBTITLES_DIR = tmp_path
        try:
            application = create_default_app()
            client = TestClient(application)
            resp = client.post("/api/movies", json={"name": "testmovie"})
            assert resp.status_code in {201, 409}
        finally:
            main_mod.DEFAULT_SUBTITLES_DIR = backup

    def test_create_default_app_upload_disabled(self, monkeypatch, tmp_path):
        """When SUBTITLE_ENABLE_UPLOAD=false, POST /api/movies is not routed."""
        monkeypatch.setenv("SUBTITLE_ROOT_PATH", "")
        monkeypatch.setenv("SUBTITLE_ENABLE_UPLOAD", "false")
        import app.main as main_mod
        backup = main_mod.DEFAULT_SUBTITLES_DIR
        main_mod.DEFAULT_SUBTITLES_DIR = tmp_path
        try:
            application = create_default_app()
            client = TestClient(application)
            resp = client.post("/api/movies", json={"name": "testmovie"})
            assert resp.status_code in {404, 405}
        finally:
            main_mod.DEFAULT_SUBTITLES_DIR = backup

    def test_create_default_app_serves_static(self, monkeypatch, tmp_path):
        """create_default_app() mounts static files (index.html served at /)."""
        monkeypatch.setenv("SUBTITLE_ROOT_PATH", "")
        monkeypatch.setenv("SUBTITLE_ENABLE_UPLOAD", "false")
        import app.main as main_mod
        backup = main_mod.DEFAULT_SUBTITLES_DIR
        main_mod.DEFAULT_SUBTITLES_DIR = tmp_path
        try:
            application = create_default_app()
            client = TestClient(application)
            resp = client.get("/")
            assert resp.status_code == 200
            assert "Subtitle Viewer" in resp.text
        finally:
            main_mod.DEFAULT_SUBTITLES_DIR = backup

    def test_create_default_app_api_not_shadowed_by_static(
        self, monkeypatch, tmp_path
    ):
        """Static mount does not shadow /api/* routes in create_default_app()."""
        monkeypatch.setenv("SUBTITLE_ROOT_PATH", "")
        monkeypatch.setenv("SUBTITLE_ENABLE_UPLOAD", "false")
        import app.main as main_mod
        backup = main_mod.DEFAULT_SUBTITLES_DIR
        main_mod.DEFAULT_SUBTITLES_DIR = tmp_path
        try:
            application = create_default_app()
            client = TestClient(application)
            resp = client.get("/api/movies")
            assert resp.status_code == 200
            assert isinstance(resp.json(), list)
        finally:
            main_mod.DEFAULT_SUBTITLES_DIR = backup

    def test_create_default_app_root_path_empty_string(self, monkeypatch, tmp_path):
        """SUBTITLE_ROOT_PATH='' produces app with root_path=''."""
        monkeypatch.setenv("SUBTITLE_ROOT_PATH", "")
        monkeypatch.setenv("SUBTITLE_ENABLE_UPLOAD", "false")
        import app.main as main_mod
        backup = main_mod.DEFAULT_SUBTITLES_DIR
        main_mod.DEFAULT_SUBTITLES_DIR = tmp_path
        try:
            application = create_default_app()
            assert application.root_path == ""
        finally:
            main_mod.DEFAULT_SUBTITLES_DIR = backup


# ===========================================================================
# 6. Additional edge-case integration tests
# ===========================================================================

class TestEdgeCases:
    def test_empty_movies_dir(self, tmp_path):
        """Empty subtitles directory returns empty list."""
        app = create_app(subtitles_dir=tmp_path)
        client = TestClient(app)
        resp = client.get("/api/movies")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_movies_dir_missing_entirely(self, tmp_path):
        """Non-existent subtitles directory returns empty list (not 500)."""
        app = create_app(subtitles_dir=tmp_path / "nonexistent")
        client = TestClient(app)
        resp = client.get("/api/movies")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_files_list_excludes_non_srt(self, tmp_path):
        """Non-.srt files in movie dir are excluded from file listing."""
        movie_dir = tmp_path / "mymovie"
        movie_dir.mkdir()
        (movie_dir / "en.srt").write_text("1\n00:00:01,000 --> 00:00:02,000\nHi\n")
        (movie_dir / "readme.txt").write_text("notes")
        (movie_dir / "cover.jpg").write_bytes(b"\xff\xd8\xff")

        app = create_app(subtitles_dir=tmp_path)
        client = TestClient(app)
        files = client.get("/api/movies/mymovie/files").json()
        assert "en.srt" in files
        assert "readme.txt" not in files
        assert "cover.jpg" not in files

    def test_path_traversal_blocked(self, tmp_path):
        """Path traversal sequences in movie name are rejected."""
        app = create_app(subtitles_dir=tmp_path)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/api/movies/%2e%2e/files")  # URL-encoded ..
        assert resp.status_code in {400, 404, 422}

    def test_special_chars_in_movie_name_rejected(self, tmp_path):
        """Movie names with spaces or special chars are rejected with 400."""
        app = create_app(subtitles_dir=tmp_path)
        client = TestClient(app)
        resp = client.get("/api/movies/bad movie!/files")
        assert resp.status_code == 400

    def test_subtitles_endpoint_returns_correct_count(self, tmp_path):
        """Subtitle count matches number of blocks in file."""
        movie_dir = tmp_path / "test"
        movie_dir.mkdir()
        srt = SRT_EN_10
        (movie_dir / "en.srt").write_text(srt, encoding="utf-8")

        app = create_app(subtitles_dir=tmp_path)
        client = TestClient(app)
        data = client.get("/api/movies/test/subtitles/en.srt").json()
        assert len(data) == 10

    def test_api_route_with_root_path_set(self, tmp_path):
        """create_app with root_path still serves API correctly via TestClient."""
        app = create_app(subtitles_dir=tmp_path, root_path="/subtitle")
        client = TestClient(app)
        resp = client.get("/api/movies")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
