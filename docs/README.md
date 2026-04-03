# Subtitle Viewer

모바일 환경에서 SRT 자막을 큰 글씨로 읽는 웹앱.
듀얼 자막(한국어+영어)을 카드 블록으로 동시 표시, 화살표/스와이프로 대사 탐색.

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

## Directory Structure

```
/srv/subtitle-viewer/
├── app/
│   ├── main.py              # FastAPI app (create_app, create_default_app)
│   ├── srt_parser.py         # SRT parsing logic
│   ├── upload_router.py      # Upload endpoints (modular, toggleable)
│   └── static/               # Frontend SPA
├── tests/                    # 106 tests
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
    └── ko.srt          # 한국어 자막
```

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
python -m pytest tests/ -v           # 106 tests
uvicorn app.main:create_default_app --factory --host 0.0.0.0 --port 8091
```

## GitHub

아직 remote 미설정. 올리려면:
```bash
cd /srv/subtitle-viewer
gh repo create espriter/subtitle-viewer --private --source=. --push
```
또는:
```bash
git remote add origin git@github.com:espriter/subtitle-viewer.git
git push -u origin master
```

## Design Docs

- [설계서](superpowers/specs/2026-04-03-subtitle-viewer-design.md)
- [구현 플랜](superpowers/plans/2026-04-03-subtitle-viewer.md)
