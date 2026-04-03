import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

_SAFE_NAME = re.compile(r"^[a-zA-Z0-9_\-]+(\.[a-zA-Z0-9]+)?$")
_MAX_FILE_SIZE = 1024 * 1024  # 1MB


class CreateMovieRequest(BaseModel):
    name: str


def create_upload_router(subtitles_dir: Path) -> APIRouter:
    router = APIRouter()

    @router.get("/api/upload-enabled")
    def upload_enabled():
        """Sentinel endpoint: present only when upload is enabled.
        The frontend checks this to show/hide the upload UI."""
        return {"enabled": True}

    @router.post("/api/movies", status_code=201)
    def create_movie(req: CreateMovieRequest):
        if not _SAFE_NAME.match(req.name):
            raise HTTPException(status_code=400, detail=f"Invalid name: {req.name}")
        movie_dir = subtitles_dir / req.name
        if movie_dir.exists():
            raise HTTPException(status_code=409, detail="Movie folder already exists")
        try:
            movie_dir.mkdir(parents=True)
        except FileExistsError:
            # Another request created the directory between the exists() check and mkdir().
            raise HTTPException(status_code=409, detail="Movie folder already exists")
        return {"created": req.name}

    @router.post("/api/movies/{movie}/upload", status_code=201)
    async def upload_srt(movie: str, file: UploadFile = File(...)):
        if not _SAFE_NAME.match(movie):
            raise HTTPException(status_code=400, detail=f"Invalid name: {movie}")

        movie_dir = subtitles_dir / movie
        if not movie_dir.is_dir():
            raise HTTPException(status_code=404, detail="Movie not found")

        if not file.filename or not file.filename.endswith(".srt"):
            raise HTTPException(status_code=400, detail="Only .srt files allowed")

        if not _SAFE_NAME.match(file.filename):
            raise HTTPException(status_code=400, detail=f"Invalid filename: {file.filename}")

        content = await file.read()
        if len(content) > _MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 1MB)")

        (movie_dir / file.filename).write_bytes(content)
        return {"uploaded": file.filename}

    return router
