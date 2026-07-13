import os
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.chapter_metadata import load_chapters
from app.srt_parser import parse_srt
from app.smi_parser import parse_smi

_SAFE_NAME = re.compile(r"^[a-zA-Z0-9_\-]+(\.[a-zA-Z0-9_\-]+)*$")

DEFAULT_SUBTITLES_DIR = Path(__file__).resolve().parent.parent / "subtitles"


def _validate_name(name: str) -> None:
    if not _SAFE_NAME.match(name):
        raise HTTPException(status_code=400, detail=f"Invalid name: {name}")


def create_app(
    *,
    subtitles_dir: Path | None = None,
    root_path: str = "",
) -> FastAPI:
    subs_dir = subtitles_dir or DEFAULT_SUBTITLES_DIR

    app = FastAPI(title="Subtitle Viewer", root_path=root_path)

    @app.middleware("http")
    async def block_path_traversal(request: Request, call_next):
        # Reject any raw path containing traversal sequences before normalization
        raw_path = request.scope.get("path", "")
        if ".." in raw_path.split("/"):
            return JSONResponse(status_code=400, content={"detail": "Path traversal not allowed"})
        return await call_next(request)

    @app.middleware("http")
    async def no_cache_static(request: Request, call_next):
        # 정적 파일(app.js/style.css 등)은 빌드/해시가 없어 배포 즉시 반영되어야 함.
        # Cache-Control이 없으면 Cloudflare가 자체 기본 TTL(수 시간)로 엣지 캐싱해
        # 배포 후에도 오래된 버전이 보일 수 있어, ETag 재검증을 강제한다.
        response = await call_next(request)
        if not request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        # CSP는 index.html의 인라인 style 속성 때문에 정책 설계가 더 필요해 보류.
        # 호환성 리스크 없는 기본 방어 헤더만 우선 추가.
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

    @app.get("/api/movies")
    def list_movies():
        if not subs_dir.exists():
            return []
        return sorted(
            d.name for d in subs_dir.iterdir() if d.is_dir()
        )

    @app.get("/api/movies/{movie}/files")
    def list_files(movie: str):
        _validate_name(movie)
        movie_dir = subs_dir / movie
        try:
            is_dir = movie_dir.is_dir()
        except OSError:
            raise HTTPException(status_code=404, detail="Movie not found")
        if not is_dir:
            raise HTTPException(status_code=404, detail="Movie not found")
        return sorted(
            f.name for f in movie_dir.iterdir()
            if f.is_file() and f.suffix in (".srt", ".smi", ".mp3")
        )

    @app.get("/api/movies/{movie}/subtitles/{filename}")
    def get_subtitles(movie: str, filename: str):
        _validate_name(movie)
        _validate_name(filename)
        filepath = subs_dir / movie / filename
        try:
            is_file = filepath.is_file()
        except OSError:
            raise HTTPException(status_code=404, detail="Subtitle file not found")
        if not is_file:
            raise HTTPException(status_code=404, detail="Subtitle file not found")
        raw = filepath.read_bytes()
        for enc in ("utf-8", "euc-kr", "latin-1"):
            try:
                content = raw.decode(enc)
                break
            except (UnicodeDecodeError, ValueError):
                continue
        if filepath.suffix == ".smi":
            return parse_smi(content)
        return parse_srt(content)

    @app.get("/api/movies/{movie}/chapters")
    def get_chapters(movie: str):
        _validate_name(movie)
        movie_dir = subs_dir / movie
        try:
            is_dir = movie_dir.is_dir()
        except OSError:
            raise HTTPException(status_code=404, detail="Movie not found")
        if not is_dir:
            raise HTTPException(status_code=404, detail="Movie not found")
        try:
            return load_chapters(movie_dir)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/movies/{movie}/audio/{filename}")
    def get_audio(movie: str, filename: str):
        _validate_name(movie)
        _validate_name(filename)
        if not filename.endswith(".mp3"):
            raise HTTPException(status_code=400, detail="Only .mp3 files allowed")
        filepath = subs_dir / movie / filename
        try:
            is_file = filepath.is_file()
        except OSError:
            raise HTTPException(status_code=404, detail="Audio file not found")
        if not is_file:
            raise HTTPException(status_code=404, detail="Audio file not found")
        return FileResponse(filepath, media_type="audio/mpeg", filename=filename)

    return app


def _mount_static(app: FastAPI) -> None:
    """Mount static files — call AFTER all routers are included."""
    static_dir = Path(__file__).resolve().parent / "static"
    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


def create_default_app() -> FastAPI:
    """Production factory — called by uvicorn --factory."""
    root_path = os.getenv("SUBTITLE_ROOT_PATH", "/subtitle")
    enable_upload = os.getenv("SUBTITLE_ENABLE_UPLOAD", "true").lower() == "true"

    app = create_app(root_path=root_path)

    if enable_upload:
        from app.upload_router import create_upload_router
        app.include_router(create_upload_router(DEFAULT_SUBTITLES_DIR))

    # Mount static last so all API routes take priority
    _mount_static(app)

    return app
