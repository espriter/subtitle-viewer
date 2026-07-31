# subtitle-viewer

> 정책 SSOT는 `/srv/CLAUDE.md`를 따른다. (실행 원칙·보안 정책·테스트 서버 IP 안내 포함)

## 개요
SRT 자막 뷰어. MP3 싱크, wake lock, 듀얼 싱크, Data Engineer Study Mode 챕터 기능.

## 운영
- 포트: 8091
- GitHub: `espriter/subtitle-viewer`

## 유튜브 가져오기 (수동 요청 시 절차)

사용자가 "이 유튜브 링크 다운받아줘", "자막 번역해줘", "다른 언어 자막도 찾아줘" 라고
요청하면 아래 절차를 따른다. 인프라는 `ops/fetch-youtube.sh` + `POST /api/movies/fetch-youtube`
(인앱 폼: 영화 목록 → "유튜브에서 가져오기")로 이미 구현돼 있음.

### 1. 다운로드 (오디오 + 자막)
```
ops/fetch-youtube.sh <youtube-url>          # 폴더명을 영상 제목에서 자동 생성
ops/fetch-youtube.sh <movie> <youtube-url>  # 폴더명 직접 지정
```
- `subtitles/<movie>/`에 `audio.mp3` + srt(있으면) + `youtube.json`(url/title/uploader/
  upload_date/duration_sec/subtitle_lang/fetched_at 메타데이터) 생성.
- 폴더명은 지정한 이름 우선, 없거나(또는 정리 후 빈 문자열이면) **영상 제목에서 자동 생성**
  (특수문자·공백·한글 등은 `_`로 뭉쳐 치환). 유튜브에 "기본 자막" 지정 개념은 없어서 대신
  **영상의 실제 발화 언어**(`language` 메타데이터)를 자막 우선순위로 쓴다 — 없으면 en 폴백.
- 재시작 불필요, 앱이 폴더를 실시간 스캔.
- **언어를 하나만 요청한다** — en+ko처럼 한 번에 여러 언어를 요청하면 유튜브 자막
  엔드포인트가 429(Too Many Requests)를 내고 yt-dlp가 통째로 중단돼 이미 받은 자막까지
  변환 못 하고 날아간 전례가 있음 (2026-07-31). 다른 언어가 필요하면 아래 2번을
  **시간차를 두고** 별도 실행.

### 2. 다른 언어 자막 탐색/추가
기존 폴더의 `youtube.json`에서 원본 `url`을 확인한 뒤, 해당 언어만 콕 집어 개별 실행:
```
venv/bin/yt-dlp --skip-download --write-subs --write-auto-subs \
    --sub-langs "<lang>" --convert-subs srt --restrict-filenames \
    -o "subtitles/<movie>/%(id)s.%(ext)s" "<url>"
```
- 429 방지를 위해 언어당 한 번에 하나씩, 방금 막 다운로드를 돌렸다면 몇 분 간격을 둘 것.
- 결과가 `.vtt`로 남아있으면(변환 중 중단) `ffmpeg -i x.vtt x.srt`로 직접 변환.
- 파일명은 `_SAFE_NAME` 규칙(영문·숫자·`-`·`_`·`.`) 준수 — 안 맞으면 안전한 이름으로 rename.

### 3. 자막 번역 (스크립트 없음 — Claude가 직접 번역)
- 원본 srt(예: `<id>.en.srt`)를 읽고, **인덱스 번호·타임코드는 그대로**, 자막 텍스트만 번역.
- 번역 결과는 같은 폴더에 별도 파일로 저장 (예: `<id>.ko.srt`, `_SAFE_NAME` 준수 ASCII 파일명).
- 저장만 하면 끝 — 재시작 불필요, 앱이 자동 인식.
- 앱은 자막 파일 최대 2개(원문+번역)를 동시 선택해 듀얼 싱크로 보여줄 수 있음(기존 기능,
  Reader의 "자막 파일 · 1~2개 선택").
