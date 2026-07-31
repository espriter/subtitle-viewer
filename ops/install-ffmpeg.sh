#!/usr/bin/env bash
# ffmpeg 설치 — fetch-youtube.sh 의 mp3 추출 + 자막 srt 변환에 필요.
# sudo 필요:  sudo /srv/subtitle-viewer/ops/install-ffmpeg.sh
set -euo pipefail

apt-get update
apt-get install -y ffmpeg
echo
ffmpeg -version | head -1
echo "ffmpeg 설치 완료."
