import re
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

_SAFE_NAME = re.compile(r"^[a-zA-Z0-9_\-]+(\.[a-zA-Z0-9_\-]+)*$")
_MAX_FILE_SIZE = 1024 * 1024  # 1MB

# ponytail: 큐/폴링 없이 요청 하나로 블로킹 처리 — 개인용 단일 사용자라 동시 다운로드 경합이
# 없고, 실패해도 재시도 비용이 낮다. 다중 사용자로 커지면 백그라운드 잡 + 진행률 API로 승격.
_YOUTUBE_FETCH_TIMEOUT_SEC = 1200  # 20분
_FETCH_YOUTUBE_SCRIPT = Path(__file__).resolve().parent.parent / "ops" / "fetch-youtube.sh"


class CreateMovieRequest(BaseModel):
    name: str


class FetchYoutubeRequest(BaseModel):
    name: str = ""
    url: str


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
            raise HTTPException(
                status_code=400,
                detail=f"영문, 숫자, 하이픈, 언더스코어만 사용할 수 있습니다: {req.name}",
            )
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

        if not file.filename or not file.filename.endswith((".srt", ".smi")):
            raise HTTPException(status_code=400, detail="Only .srt and .smi files allowed")

        if not _SAFE_NAME.match(file.filename):
            raise HTTPException(status_code=400, detail=f"Invalid filename: {file.filename}")

        content = await file.read()
        if len(content) > _MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 1MB)")

        (movie_dir / file.filename).write_bytes(content)
        return {"uploaded": file.filename}

    @router.post("/api/movies/fetch-youtube", status_code=201)
    def fetch_youtube(req: FetchYoutubeRequest):
        if not req.url.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="url must be an http(s) URL")

        # 폴더명이 비어 있으면 스크립트가 영상 제목에서 자동 생성한다.
        try:
            result = subprocess.run(
                [str(_FETCH_YOUTUBE_SCRIPT), req.name.strip(), req.url],
                capture_output=True,
                text=True,
                timeout=_YOUTUBE_FETCH_TIMEOUT_SEC,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(
                status_code=504,
                detail="다운로드 시간 초과 (20분). 영상이 너무 길거나 네트워크가 느립니다.",
            )
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"스크립트 실행 실패: {exc}")

        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "알 수 없는 오류").strip()
            raise HTTPException(status_code=502, detail=detail[-2000:])

        # 최종 폴더명은 스크립트가 stdout 마지막 줄에 "MOVIE=<name>"으로 보고한다
        # (이름을 안 줬으면 스크립트가 영상 제목에서 자동 생성하므로, 무엇이
        # 만들어졌는지는 스크립트만 안다).
        movie = next(
            (line[len("MOVIE="):].strip() for line in result.stdout.splitlines() if line.startswith("MOVIE=")),
            None,
        )
        if not movie:
            raise HTTPException(status_code=500, detail="스크립트가 폴더명을 보고하지 않았습니다")

        movie_dir = subtitles_dir / movie
        files = sorted(f.name for f in movie_dir.iterdir()) if movie_dir.is_dir() else []
        return {"movie": movie, "files": files}

    return router
