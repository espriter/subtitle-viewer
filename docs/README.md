# Subtitle Viewer

영상 없이 자막만 빠르게 훑어보고 싶을 때 쓰는 웹앱.
SRT 파일을 올리면 모바일에서도 큰 글씨로 대사를 넘기며 읽을 수 있고, MP3를 함께 넣으면 오디오와 자막이 자동으로 싱크됩니다.

> This project was vibe-coded with [Claude Code](https://claude.ai/claude-code) (Anthropic).

## Quick Start

Python 3.12+ 환경이면 어디서든 바로 실행할 수 있습니다.

```bash
git clone https://github.com/espriter/subtitle-viewer.git
cd subtitle-viewer
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 자막 폴더 준비 (예시)
mkdir -p subtitles/my-movie
cp /path/to/en.srt subtitles/my-movie/
cp /path/to/ko.srt subtitles/my-movie/
# (선택) cp /path/to/audio.mp3 subtitles/my-movie/

# 실행
uvicorn app.main:create_default_app --factory --host 0.0.0.0 --port 8091
```

브라우저에서 `http://localhost:8091/` 접속. 같은 네트워크의 다른 기기에서는 `http://<서버IP>:8091/` 로 접근합니다.

## Stack

- **Backend:** FastAPI (Python 3.12), uvicorn
- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Infra:** systemd service, nginx reverse proxy (mTLS + Basic Auth)

## Access

| 경로 | 설명 |
|------|------|
| `https://<host>/subtitle/` | nginx 프록시 (mTLS) |
| `http://localhost:8091/` | 직접 접속 (로컬) |

## Features

- SRT 자막 파싱 및 대사 단위 탐색
- 듀얼 자막 (2개 SRT 동시 표시)
- 시간 점프 (HH:MM:SS 입력 → 가장 가까운 자막으로 이동)
- 최근 이어보기 (localStorage에 마지막 위치 저장)
- 설정: 대사 표시 수(1~3), 넘기기 방식(페이지/슬라이드), 글꼴 크기
- 웹에서 폴더 생성 + SRT 업로드 (env로 on/off 가능)
- 스와이프 제스처 + 키보드 화살표 지원
- MP3 오디오 재생 + 자막 자동 싱크 (MP3 없으면 수동 모드)
- 자막 싱크 보정 (±0.5초 단위 오프셋 조절)
- 자막 자동 싱크 ON/OFF 토글 (오디오 독립 재생 가능)
- 백그라운드 오디오 재생 + 잠금화면 미디어 컨트롤 (PWA)
- 화면 꺼짐 방지 (Wake Lock API + NoSleep 비디오 fallback)
- 듀얼 자막 시간 기준 독립 싱크 (secondary는 primary 타임스탬프 기준 매칭)
- 자막 선택 순서 표시 (▶ 1st / ▷ 2nd 뱃지)
- 자막 테마 파비콘 및 앱 아이콘

## Directory Structure

```
/srv/subtitle-viewer/
├── app/
│   ├── main.py              # FastAPI app (create_app, create_default_app)
│   ├── srt_parser.py         # SRT parsing logic
│   ├── upload_router.py      # Upload endpoints (modular, toggleable)
│   └── static/               # Frontend SPA
│       ├── favicon.ico
│       └── icons/            # PWA icons (192, 512)
├── tests/                    # 125 tests
├── subtitles/                # Runtime data (gitignored)
│   └── {movie-name}/
│       ├── en.srt
│       └── ko.srt
├── ops/
│   ├── run.sh                # Uvicorn launcher
│   └── systemd/
│       └── subtitle-viewer.service
├── requirements.txt
└── docs/
```

## Subtitle Folder Structure

```
subtitles/
└── {movie-name}/       # 영화별 폴더 (영문, 숫자, 하이픈, 언더스코어)
    ├── en.srt          # 영어 자막
    ├── ko.srt          # 한국어 자막
    └── audio.mp3       # 오디오 파일 (선택, 서버에서 직접 배치)
```

> **파일명 제약:** 폴더명과 파일명 모두 **영문, 숫자, 하이픈(`-`), 언더스코어(`_`), 마침표(`.`)** 만 허용됩니다.
> 대괄호(`[]`), 공백, 한글 등 특수문자가 포함되면 API에서 400 에러가 발생합니다.

웹 UI에서 폴더 생성 및 SRT 업로드 가능. 또는 서버에서 직접 파일 배치.

## Environment Variables

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `SUBTITLE_ROOT_PATH` | `/subtitle` | nginx sub-path (FastAPI root_path) |
| `SUBTITLE_ENABLE_UPLOAD` | `true` | 업로드 기능 on/off |
| `SUBTITLE_HOST` | `0.0.0.0` | 바인드 주소 |
| `SUBTITLE_PORT` | `8091` | 포트 |

## Deployment

### systemd
```bash
sudo cp ops/systemd/subtitle-viewer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now subtitle-viewer
```

### nginx
`/etc/nginx/sites-available/jupyter-proxy` 내 server 블록에 추가:
```nginx
location = /subtitle {
    return 301 /subtitle/;
}

location /subtitle/ {
    proxy_pass http://127.0.0.1:8091/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 2M;
}
```

### Deploy script
```bash
sudo bash /srv/scripts/deploy-subtitle-viewer.sh
```

## Development

```bash
cd /srv/subtitle-viewer
source venv/bin/activate
pip install -r requirements.txt
python -m pytest tests/ -v           # 125 tests
uvicorn app.main:create_default_app --factory --host 0.0.0.0 --port 8091
```

## Design Docs

- [설계서](superpowers/specs/2026-04-03-subtitle-viewer-design.md)
- [구현 플랜](superpowers/plans/2026-04-03-subtitle-viewer.md)
- [오디오 싱크 설계](superpowers/specs/2026-04-03-audio-sync-design.md)
