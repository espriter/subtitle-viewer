#!/usr/bin/env bash
# YouTube 링크에서 오디오(mp3) + 자막(en srt)을 추출해 subtitles/<movie>/ 에 넣는다.
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

echo "== ${MOVIE}: 메타데이터 조회 =="
mapfile -t META < <("$YTDLP" --no-warnings --skip-download \
    --print "%(id)s" --print "%(title)s" --print "%(uploader)s" \
    --print "%(upload_date)s" --print "%(duration)s" "$URL")
VIDEO_ID="${META[0]:-}"
TITLE="${META[1]:-}"
UPLOADER="${META[2]:-}"
UPLOAD_DATE="${META[3]:-}"
DURATION="${META[4]:-}"
[[ -n "$VIDEO_ID" ]] || { echo "video id 를 가져오지 못했습니다 (URL 확인)." >&2; exit 1; }

echo "== 오디오 추출 → audio.mp3 =="
# mp3 고정: iOS Safari(아이폰/AirPod 라이딩) 호환. 트랜스코드 1회 비용은 감수.
"$YTDLP" -x --audio-format mp3 --restrict-filenames \
    -o "${DIR}/audio.%(ext)s" "$URL"

echo "== 자막 추출 → en srt (있으면) =="
# 수동 자막 우선, 없으면 자동생성 자막. vtt→srt 변환(앱은 srt 파서만 존재).
# en 하나만 요청: 언어를 여러 개 요청하면(en+ko) 유튜브 자막 엔드포인트에
# 연속 요청이 들어가 429(Too Many Requests)를 유발하기 쉽다 — 실제로 en 성공 후
# ko에서 429가 나면서 yt-dlp가 통째로 중단돼 en.vtt조차 srt로 변환 못 한 사례가
# 있었다. 다국어가 필요하면 별도 시간을 두고 수동으로 재실행할 것.
"$YTDLP" --skip-download \
    --write-subs --write-auto-subs \
    --sub-langs "en" --convert-subs srt \
    --restrict-filenames \
    -o "${DIR}/%(id)s.%(ext)s" "$URL" || echo "  (en 자막 없음/실패)"

# 안전망: 위 변환이 중간에 끊겨 vtt가 그대로 남았으면 ffmpeg로 직접 변환한다.
# (앱은 srt만 인식하므로 vtt가 남으면 자막이 통째로 안 보이는 상태가 됨)
shopt -s nullglob
for vtt in "${DIR}"/*.vtt; do
    srt="${vtt%.vtt}.srt"
    if ffmpeg -y -loglevel error -i "$vtt" "$srt"; then
        rm -f "$vtt"
        echo "  변환: $(basename "$vtt") → $(basename "$srt")"
    fi
done
shopt -u nullglob

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

# --- 소스 기록 (다시보기/재추출 + 번역 등 후속 작업용 메타데이터) ---
# title/uploader에 따옴표·유니코드가 섞여도 깨지지 않게 bash 문자열 보간 대신
# Python json 모듈로 조립한다 (env var로 전달해 셸 인젝션도 원천 차단).
FETCHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SUBTITLE_LANG=""
ls "${DIR}"/*.srt >/dev/null 2>&1 && SUBTITLE_LANG="en"

YT_URL="$URL" YT_VIDEO_ID="$VIDEO_ID" YT_TITLE="$TITLE" YT_UPLOADER="$UPLOADER" \
YT_UPLOAD_DATE="$UPLOAD_DATE" YT_DURATION="$DURATION" YT_SUB_LANG="$SUBTITLE_LANG" \
YT_FETCHED_AT="$FETCHED_AT" \
"${PROJECT_ROOT}/venv/bin/python" - "${DIR}/youtube.json" <<'PYEOF'
import json
import os
import sys


def clean(value):
    return None if not value or value == "NA" else value


def as_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


data = {
    "url": os.environ.get("YT_URL", ""),
    "video_id": os.environ.get("YT_VIDEO_ID", ""),
    "title": clean(os.environ.get("YT_TITLE")),
    "uploader": clean(os.environ.get("YT_UPLOADER")),
    "upload_date": clean(os.environ.get("YT_UPLOAD_DATE")),
    "duration_sec": as_int(os.environ.get("YT_DURATION")),
    "subtitle_lang": clean(os.environ.get("YT_SUB_LANG")),
    "fetched_at": os.environ.get("YT_FETCHED_AT", ""),
}
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
PYEOF

echo
echo "== 완료: ${DIR} =="
ls -1 "${DIR}"
if ! ls "${DIR}"/*.srt >/dev/null 2>&1; then
    echo "주의: 자막(srt) 없음. 이 영상엔 en 자막이 등록돼 있지 않습니다."
fi
