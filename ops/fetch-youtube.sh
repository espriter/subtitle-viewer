#!/usr/bin/env bash
# YouTube 링크에서 오디오(mp3) + 자막(en/ko srt)을 추출해 subtitles/<movie>/ 에 넣는다.
# 넣기만 하면 기존 앱이 자동 탐색해 재생/라이딩 모드로 반복 재생한다 (앱 코드 변경 없음).
#
# 사용법: ops/fetch-youtube.sh <movie> <youtube-url>
#   <movie> : 폴더/무비 이름. 영문·숫자·하이픈·언더스코어만 (_SAFE_NAME 규칙).
#
# 의존성: yt-dlp (venv 우선), ffmpeg (시스템). 없으면 안내 후 종료.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# --- 인자 검증 ---
if [[ $# -ne 2 ]]; then
    echo "사용법: $0 <movie> <youtube-url>" >&2
    exit 2
fi
MOVIE="$1"
URL="$2"

# app/upload_router.py 의 _SAFE_NAME 과 동일한 규칙 (파일 서빙/스캔 경로가 이 규칙 사용)
if [[ ! "$MOVIE" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "movie 이름은 영문·숫자·하이픈·언더스코어만 가능합니다: $MOVIE" >&2
    exit 2
fi

# --- 의존성 확인 ---
if [[ -x "${PROJECT_ROOT}/venv/bin/yt-dlp" ]]; then
    YTDLP="${PROJECT_ROOT}/venv/bin/yt-dlp"
elif command -v yt-dlp >/dev/null 2>&1; then
    YTDLP="$(command -v yt-dlp)"
else
    echo "yt-dlp 가 없습니다. 설치:  ${PROJECT_ROOT}/venv/bin/pip install yt-dlp" >&2
    exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "ffmpeg 가 없습니다. 설치:  sudo ${SCRIPT_DIR}/install-ffmpeg.sh" >&2
    exit 1
fi

DIR="${PROJECT_ROOT}/subtitles/${MOVIE}"
mkdir -p "$DIR"

echo "== ${MOVIE}: video id 조회 =="
VIDEO_ID="$("$YTDLP" --no-warnings --skip-download --print id "$URL" | head -1)"
[[ -n "$VIDEO_ID" ]] || { echo "video id 를 가져오지 못했습니다 (URL 확인)." >&2; exit 1; }

echo "== 오디오 추출 → audio.mp3 =="
# mp3 고정: iOS Safari(아이폰/AirPod 라이딩) 호환. 트랜스코드 1회 비용은 감수.
"$YTDLP" -x --audio-format mp3 --restrict-filenames \
    -o "${DIR}/audio.%(ext)s" "$URL"

echo "== 자막 추출 → en/ko srt (있으면) =="
# 수동 자막 우선, 없으면 자동생성 자막. vtt→srt 변환(앱은 srt 파서만 존재).
"$YTDLP" --skip-download \
    --write-subs --write-auto-subs \
    --sub-langs "en,ko" --convert-subs srt \
    --restrict-filenames \
    -o "${DIR}/%(id)s.%(ext)s" "$URL" || echo "  (자막 없음 — 오디오만 진행)"

# 혹시라도 _SAFE_NAME 위반 파일명이 나오면 안전한 이름으로 정리
shopt -s nullglob
for f in "${DIR}"/*.srt; do
    base="$(basename "$f")"
    if [[ ! "$base" =~ ^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$ ]]; then
        safe="$(echo "$base" | tr -c 'a-zA-Z0-9._-' '_')"
        mv -f "$f" "${DIR}/${safe}"
        echo "  파일명 정리: ${base} → ${safe}"
    fi
done
shopt -u nullglob

# --- 소스 기록 (다시보기/재추출용 sidecar) ---
FETCHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "${DIR}/youtube.json" <<EOF
{
  "url": "${URL}",
  "video_id": "${VIDEO_ID}",
  "fetched_at": "${FETCHED_AT}"
}
EOF

echo
echo "== 완료: ${DIR} =="
ls -1 "${DIR}"
if ! ls "${DIR}"/*.srt >/dev/null 2>&1; then
    echo "주의: 자막(srt) 없음. 이 영상엔 en/ko 자막이 등록돼 있지 않습니다."
fi
