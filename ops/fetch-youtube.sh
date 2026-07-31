#!/usr/bin/env bash
# YouTube 링크에서 오디오(mp3) + 자막(영상 발화 언어 기준 srt, 없으면 en)을 추출해
# subtitles/<movie>/ 에 넣는다.
# 넣기만 하면 기존 앱이 자동 탐색해 재생/라이딩 모드로 반복 재생한다 (앱 코드 변경 없음).
#
# 사용법: ops/fetch-youtube.sh <youtube-url>          (폴더명을 영상 제목에서 자동 생성)
#         ops/fetch-youtube.sh <movie> <youtube-url>  (폴더명 직접 지정)
#   <movie> 생략 시, 또는 지정했지만 정리 후 빈 문자열이면 영상 제목에서 유도한다.
#
# 의존성: yt-dlp (venv 우선), ffmpeg (시스템). 없으면 안내 후 종료.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# --- 인자 파싱 ---
if [[ $# -eq 1 ]]; then
    MOVIE_ARG=""
    URL="$1"
elif [[ $# -eq 2 ]]; then
    MOVIE_ARG="$1"
    URL="$2"
else
    echo "사용법: $0 <youtube-url>           (폴더명 자동 생성)" >&2
    echo "   또는: $0 <movie> <youtube-url>  (폴더명 직접 지정)" >&2
    exit 2
fi

# 허용 문자(영문/숫자/-/_) 아닌 구간을 밑줄 하나로 뭉쳐 치환한다 (거부 대신 자동 정리).
# app/upload_router.py의 _sanitize_movie_name과 동일한 규칙.
sanitize_name() {
    echo "$1" | sed -E 's/[^a-zA-Z0-9_-]+/_/g; s/^_+//; s/_+$//'
}

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

echo "== 메타데이터 조회 =="
mapfile -t META < <("$YTDLP" --no-warnings --skip-download \
    --print "%(id)s" --print "%(title)s" --print "%(uploader)s" \
    --print "%(upload_date)s" --print "%(duration)s" --print "%(language)s" "$URL")
VIDEO_ID="${META[0]:-}"
TITLE="${META[1]:-}"
UPLOADER="${META[2]:-}"
UPLOAD_DATE="${META[3]:-}"
DURATION="${META[4]:-}"
VIDEO_LANG="${META[5]:-}"
[[ -n "$VIDEO_ID" ]] || { echo "video id 를 가져오지 못했습니다 (URL 확인)." >&2; exit 1; }

# 영상 자체의 발화 언어(language 메타데이터)를 자막 우선순위로 쓴다.
# 업로더가 "기본 자막"을 지정하는 개념은 유튜브에 없고, 이게 그나마 실제
# 콘텐츠 언어에 가장 가까운 신호다. 값이 없으면(NA) en으로 폴백.
SUB_LANG="en"
if [[ -n "$VIDEO_LANG" && "$VIDEO_LANG" != "NA" ]]; then
    SUB_LANG="$VIDEO_LANG"
fi

# 폴더 이름 결정: 지정한 이름 우선(정리 후 사용), 없거나 정리 후 비면 영상 제목에서 유도.
MOVIE=""
if [[ -n "$MOVIE_ARG" ]]; then
    MOVIE="$(sanitize_name "$MOVIE_ARG")"
fi
if [[ -z "$MOVIE" ]]; then
    MOVIE="$(sanitize_name "$TITLE")"
fi
if [[ -z "$MOVIE" ]]; then
    echo "폴더 이름을 만들 수 없습니다 (제목/movie 인자에 영문·숫자·-·_ 문자가 없음). movie를 직접 지정하세요." >&2
    exit 1
fi
echo "  폴더명: ${MOVIE}"

DIR="${PROJECT_ROOT}/subtitles/${MOVIE}"
mkdir -p "$DIR"

echo "== 오디오 추출 → audio.mp3 =="
# mp3 고정: iOS Safari(아이폰/AirPod 라이딩) 호환. 트랜스코드 1회 비용은 감수.
"$YTDLP" -x --audio-format mp3 --restrict-filenames \
    -o "${DIR}/audio.%(ext)s" "$URL"

echo "== 자막 추출 → ${SUB_LANG} srt (있으면) =="
# 수동 자막 우선, 없으면 자동생성 자막. vtt→srt 변환(앱은 srt 파서만 존재).
# 언어 하나만 요청: 여러 언어를 한 번에 요청하면(예: en+ko) 유튜브 자막
# 엔드포인트가 429(Too Many Requests)를 내고 yt-dlp가 통째로 중단돼 이미 받은
# 자막까지 변환 못 하고 날아간 전례가 있다 (2026-07-31). 다른 언어가 필요하면
# CLAUDE.md "다른 언어 자막 탐색/추가" 절차로 시간차를 두고 별도 실행할 것.
"$YTDLP" --skip-download \
    --write-subs --write-auto-subs \
    --sub-langs "$SUB_LANG" --convert-subs srt \
    --restrict-filenames \
    -o "${DIR}/%(id)s.%(ext)s" "$URL" || echo "  (${SUB_LANG} 자막 없음/실패)"

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
ls "${DIR}"/*.srt >/dev/null 2>&1 && SUBTITLE_LANG="$SUB_LANG"

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
    echo "주의: 자막(srt) 없음. 이 영상엔 ${SUB_LANG} 자막이 등록돼 있지 않습니다."
fi

# 호출자(백엔드 API 등)가 자동 생성된 최종 폴더명을 알 수 있게 마지막에 출력한다.
echo "MOVIE=${MOVIE}"
