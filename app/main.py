import os
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.srt_parser import parse_srt

_SAFE_NAME = re.compile(r"^[a-zA-Z0-9_\-]+(\.[a-zA-Z0-9]+)?$")

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
        if not movie_dir.is_dir():
            raise HTTPException(status_code=404, detail="Movie not found")
        return sorted(
            f.name for f in movie_dir.iterdir()
            if f.is_file() and f.suffix == ".srt"
        )

    @app.get("/api/movies/{movie}/subtitles/{filename}")
    def get_subtitles(movie: str, filename: str):
        _validate_name(movie)
        _validate_name(filename)
        filepath = subs_dir / movie / filename
        if not filepath.is_file():
            raise HTTPException(status_code=404, detail="Subtitle file not found")
        try:
            content = filepath.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            content = filepath.read_text(encoding="latin-1")
        return parse_srt(content)

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
