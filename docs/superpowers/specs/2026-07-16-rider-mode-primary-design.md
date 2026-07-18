# Rider Mode as Primary UX (라이딩 모드 메인화) Design

## Goal

자전거 라이딩(15분 내외)에 쓸 수 있는 시간이 짧기 때문에, 넓은 범위를 한 번 듣는 것보다
**짧은 구간(5분 내외)을 반복해서 듣는 것**이 학습 효율이 높다. 기존에는 라이딩 모드가
홈 화면의 카드 4개 중 하나였고, 세션 길이 기본값도 15분(=사실상 편도 전체를 1세션)이라
반복의 이점을 살리지 못했다. 라이딩 모드를 UX상 메인으로 올리고, 세션을 5분 단위로
쪼개 기본적으로 반복 재생하도록 바꾼다. 화면 보며 읽는 기존 Reader(자막 읽기)는 서브
기능으로 격하한다.

## Key Decisions

| # | 결정 | 근거 |
|---|------|------|
| D1 | 홈 화면 재설계: 라이딩 모드를 히어로 카드로, 영화 목록/이어보기(자막 읽기)/리뷰는 "더보기" 아래 보조 리스트로 격하 | 방향 전환의 핵심. 진입 동선을 자동화하진 않음 |
| D2 | 앱 자동 진입(라이딩 모드로 스킵)은 **하지 않음** | 이어폰 미연결 상태에서 오디오가 갑자기 자동재생될 위험(사용자 피드백으로 제외) — 홈 화면은 매번 거쳐가되, 라이딩 카드가 최상단/최대 크기 |
| D3 | `commuteTargetMin` 기본값 15 → **5**, 프리셋을 `5 / 10 / 15분` + `직접입력`(2~60분)으로 교체 | 반복재생의 단위를 라이딩 실사용 패턴(5~10분)에 맞춤. `segmenter.js`는 `targetSec`를 그대로 받는 순수 함수라 무변경 |
| D4 | 세션 반복재생 기본 **ON** (`commuteRepeat: true`, Settings 토글) | 세션 끝에 도달하면 다음 세션으로 넘기지 않고 세션 시작으로 되감아 끊김없이 반복. 세션 전환은 라이딩 전/후 화면에서 세션 칩을 눌러 수동으로 — 화면 없이 조작해야 할 필요가 없다는 판단(짧은 라이딩엔 같은 5분을 계속 듣는 게 목표) |
| D5 | Reader 재생바(`#audio-player`, 네이티브 `<audio controls>`) 터치 타겟 확대 | 모바일에서 드래그하기 작다는 피드백. `height` 확대로 1차 대응 (ponytail 한계: iOS는 네이티브 컨트롤 내부 스크러버 자체를 CSS로 완전히 재설계할 수 없음 — 실기기 확인 후 부족하면 `loop-scrubber`처럼 커스텀 슬라이더로 교체) |

## Home Screen Redesign

- `#menu-commute`가 `.feature` 클래스를 가짐(기존 `#menu-movie-list`에서 이동) → 악센트
  그라데이션 배경의 큰 카드로 승격. 기존 `commuteDesc` 진행 요약(`세션 2/3 · 남은 3분 ·
  영화명`)이 그대로 노출되어 정보량은 유지.
- `영화 목록 / 이어보기 / 리뷰 / 새 폴더 만들기`는 "더보기" 섹션 라벨(`.section-label`
  재사용) 아래 컴팩트 카드 스타일(`.menu-card.compact` — 아이콘/패딩 축소)로 묶임.
- `이어보기` 카드 설명을 "자막으로 이어읽기"로 다듬어 라이딩과 구분되는 서브 기능임을
  명시.
- 자동 진입은 하지 않으므로 `init()`은 기존과 동일하게 항상 `showHomeScreen()`부터
  시작.

## Session Length: 5-Minute Default + Custom Input

- `state.settings.commuteTargetMin` 기본값 `15 → 5`.
- Settings 화면 "세션 길이" 행: 칩 `5분 / 10분 / 15분` + `직접입력` 칩.
- `직접입력` 클릭 시 인라인 숫자 입력(`<input type="number">`, min=2 max=60)이
  나타남. Enter/blur(`change` 이벤트)로 적용.
- 프리셋 클릭과 커스텀 입력 적용 로직은 공용 함수(`applyCommuteTargetMin(min)`)로
  통합 — 기존 `data-commute-min` 클릭 핸들러의 재계산 블록(세션 재계산 +
  `sessionIndexForSec` + 라이딩 뷰 갱신)을 그대로 재사용.
- `applySettings()`에서 현재 값이 프리셋 중 하나면 해당 칩을, 아니면 `직접입력` 칩을
  active 표시 + 커스텀 입력 행을 펼침.

## Session Repeat (Default ON)

- 새 설정 `commuteRepeat: true`. Settings에 "세션 반복재생" ON/OFF 토글 행 추가(기존
  `세션 끝 일시정지`/`이어폰 버튼 스왑`과 동일한 버튼 패턴).
- `completeCommuteSession(sess)` 분기:
  - `commuteRepeat` ON → `resumeSec`를 세션 시작으로 되돌리고 오디오를 세션 시작으로
    시크한 뒤 **일시정지 없이 계속 재생**. `sessionEndPause`/다음 세션 전환 로직은
    타지 않음(같은 세션이 반복되는 것뿐이므로 "세션이 끝났다"는 신호 자체가 무의미).
  - `commuteRepeat` OFF → 기존 동작(다음 세션으로 포인터 이동 + `sessionEndPause`면
    일시정지) 그대로 유지 — 하위호환.
- `updateCommuteSummary()`에 반복 횟수 표시(`🔁 N회째`) 추가. 카운트는
  `state.study`에 세션 전환/선택 시 리셋되는 경량 카운터로 관리(영속 저장 없음, 기존
  A-B 루프의 `loop._done`과 동일한 성격).
- 세션 전환(다음 5분 구간으로)은 여전히 라이딩 뷰 상단 세션 칩 탭으로 수행(기존
  `selectCommuteSession()`) — 이어폰 제스처로는 넘기지 않음(범위 밖, D4 근거 참고).

## Playback Bar Enlargement

- `#audio-player { height: 40px }` → 확대(예: 56px 내외, 다른 곳의 44px+ 터치 타겟
  기준과 맞춤). 여백/`border-radius`도 비례 조정.
- ponytail 한계 주석: iOS Safari의 `<audio controls>`는 내부 스크러버를 CSS로 완전히
  재설계할 수 없어 `height` 확대의 실효가 제한적일 수 있음. 실기기 확인 후 부족하면
  차기 작업으로 `.loop-scrubber`(기존에 이미 구현된 커스텀 슬라이더 패턴)를 재생바에도
  적용하는 방안으로 격상.

## Files

- `app/static/app.js` — 설정 기본값/토글, `applyCommuteTargetMin()` 공용 함수,
  `completeCommuteSession()` 반복 분기, `applySettings()`/`bindEvents()` 확장
- `app/static/index.html` — 홈 메뉴 재배치(`.feature` 이동 + 보조 그룹), 세션 길이
  칩+커스텀 입력 행, 세션반복 토글 행
- `app/static/style.css` — 보조 메뉴 컴팩트 스타일, 커스텀 분 입력 스타일,
  `#audio-player` 크기

## Out of Scope

앱 자동 진입(D2로 제외), mp3 실제 분할, 세션 간 알림음, 서버 동기화, 이어폰 제스처로
세션 전환, 재생바 완전 커스텀 슬라이더 교체(D5 폴백, 필요시 후속 작업).

## Addendum (2026-07-16b): 복습 재생 버튼 제거 + 향후 백로그

**배경**: 라이딩 화면에 "세션 반복재생"(자동, 세션 끝에서 세션 시작으로 되감기)과
"🔁 복습 재생"(마킹된 문장만 골라 2회씩 재생하는 별개 기능)이 나란히 있어 사용자가
둘을 혼동함 — 세션 전체 반복을 기대하고 복습 재생 버튼을 눌렀다가 의도와 다르게
동작해 "반응이 없다"고 오인.

**조치**: `#btn-commute-playlist` 버튼 마크업만 `view-commute`에서 제거. 관련 로직
(`toggleMarkedPlaylist`/`startMarkedPlaylist`/`playPlaylistCue`/`advancePlaylist`/
`stopPlaylist`/`markedCuesInOrder`, `state.playlist`)은 전부 유지 — 재도입 시
`index.html`에 버튼 마크업 한 줄만 되살리면 됨(`app.js` 바인딩은 이미 null-guard로
버튼 유무와 무관하게 안전).

**향후 백로그 (미구현)**: 현재 문장 마킹은 이어폰 ⏮(다시듣기)로만 가능 — 화면을 보고
있을 때 탭으로 바로 마킹할 수 있는 온스크린 버튼은 없음. 필요성이 확인되면 라이딩
화면(또는 Reader)에 수동 마킹 버튼을 추가하는 방안을 검토할 것. 지금은 만들지 않음.

## Addendum (2026-07-18): 수동 마킹 버튼 구현

위 백로그를 구현. `view-commute`의 `.commute-sub-actions`에 `#btn-commute-mark`
(`⏮ 다시듣기 (마킹)`) 버튼 추가 — 클릭 시 기존 `replayCurrentSentence()`를 그대로
호출(이어폰 ⏮과 완전히 동일한 동작: 현재 문장 처음부터 재생 + `bumpReplayCount()`로
암묵 마킹). 새 로직은 버튼 텍스트를 900ms간 "✓ 마킹됨"으로 바꿨다가 원복하는 시각
피드백뿐(`markCurrentSentenceOnScreen()`). 세션반복 시 `commute-sub-actions`가
가로모드 압축 화면에서는 기존과 동일하게 숨김(리소스 절약 규칙 그대로 적용, 라이딩
중 실제 조작은 이어폰 우선이라는 기존 설계 의도 유지).

Playwright로 실기 서버(8091) 대상 검증: 라이딩 화면 진입 → 재생 → 버튼 클릭 →
`localStorage`의 `study.cues[idx].r` 증가 + 오디오가 문장 시작으로 되감김 + 버튼
텍스트 일시 변경 확인.

## Addendum (2026-07-18b): Reader에도 동일 버튼 추가 + 마킹 유실 버그 수정

백로그 원문의 "(또는 Reader)"를 마저 구현. `nav-controls`(리더 하단 독)에
`#btn-reader-mark`(🔖) 추가 — `setupAudio()`의 기존 show/hide 3종(`btn-loop`/
`btn-session-repeat`/`btn-commute`) 패턴에 맞춰 오디오 유무로 노출. 클릭 핸들러는
`markCurrentSentenceOnScreen(event)`를 `#btn-commute-mark`와 공유하도록 일반화
(`event.currentTarget` 사용) — 아이콘 전용 버튼(54px 고정폭)에서도 넘치지 않도록
확인 플래시 문구를 "✓ 마킹됨" → "✓"로 통일.

**발견한 버그 (수정함)**: `bumpReplayCount()`가 `state.study.data`가 없으면 조용히
no-op — 이 데이터는 `ensureStudy()`가 최초 호출될 때만 채워지는데, 기존에는
라이딩 모드 진입/세션반복 토글/리뷰 진입 세 경로에서만 호출되고 있었다. Reader에서
곧장 오디오를 재생하고 마킹 버튼을 누르면 마킹이 **조용히 유실**되는 경로가 이미
존재했던 것 — Reader 마킹 버튼을 추가하며 실사용 시나리오로 재현됨. `bumpReplayCount()`
맨 앞에 `ensureStudy()` 호출을 추가해 근본 수정.
(정정: Reader의 이어폰 ⏮은 `navigate(-1)`로 가고 `bumpReplayCount`를 타지 않으므로
이 버그의 영향을 받지 않았음 — 실제로 유실되던 경로는 Reader의 두 온스크린 마킹
버튼뿐. 라이딩 모드의 이어폰 ⏮은 진입 시 이미 `ensureStudy()`를 호출하므로 원래도
안전했음.)

레이아웃: 리더 하단 독 아이콘 버튼이 3개→4개로 늘며 360px 폭에서 이전/다음 버튼이
26px까지 줄어드는 회귀 발견 → `@media (max-width: 420px)`에서 아이콘 버튼 54→44px,
gap 12→8px로 축소해 이전/다음을 44px 이상으로 복구 (360/375/414px, 데스크톱 800px
Playwright로 확인). 320px급 구형 기기는 이 수정 이후에도 44px 미만(계산상 ~36px)이지만
수정 이전에도 이미 44px 미만(~39px)이던 기존 한계라 이번 회귀는 아님 — 별도 과제로
남김.

## Addendum (2026-07-18c): QA 리뷰로 발견한 버그 2건 수정

10개 앵글 병렬 코드리뷰(`/code-review --effort high`)로 이전 addendum의 구현을 다시
검증, 두 가지 실제 버그를 발견해 수정:

1. **`ensureStudy()`의 confirm() 대화상자가 가벼운 탭에서도 뜰 수 있었음**: 자막
   구성이 바뀐 이력이 있는 영화를 Reader에서 열고 마킹 버튼을 처음 누르면,
   `ensureStudy()`가 "학습 기록을 초기화할까요?" `confirm()`을 띄울 수 있었다(화면을
   안 보고 있을 수도 있는 경로에서 재생을 막는 모달). `ensureStudy(silent)` 파라미터를
   추가해 `bumpReplayCount()`에서는 `ensureStudy(true)`로 호출 — 대화상자 없이 "취소"를
   누른 것과 동일한 안전한 기본값(기존 마킹/진도 보존, srtFile/cueCount만 갱신)으로
   처리.
2. **Reader 마킹 버튼이 화면과 다른 문장을 마킹할 수 있었음**: `replayCurrentSentence()`를
   그대로 재사용했는데, 이 함수는 `audio.currentTime` 기준으로 문장을 찾는다. Reader는
   자막 자동싱크 OFF거나 오디오가 정지된 채로 자막만 넘길 수 있어(`navigate()`는
   `!audio.paused`일 때만 오디오를 따라 시크) `state.position`(화면에 보이는 문장)과
   오디오 위치가 어긋날 수 있음 — 이 상태에서 마킹하면 화면과 다른 문장이 마킹됨.
   `markReaderPosition()`을 새로 분리해 `state.position` 기준으로 마킹하고, 오디오는
   이미 재생 중일 때만 문장 시작으로 이어 재생(정지 중이면 건드리지 않음 — 조용히
   읽던 흐름을 방해하지 않기 위함). 라이딩 모드는 화면 표시 자체가 오디오 위치 기준이라
   기존 `replayCurrentSentence()` 그대로 사용.

부수 수정: 디바운스(300ms)로 걸러진 탭에서도 버튼이 "✓"로 깜빡이던 거짓 피드백을
`replayCurrentSentence()`/`markReaderPosition()`이 성공 여부를 반환하도록 고쳐 제거.
`setupAudio()`의 4버튼 show/hide 중복 블록(각 8줄)을 `.btn-loop` 클래스 기반
`$$(".btn-loop").forEach(...)` 한 줄로 축소(이미 마크업에서 4개 버튼이 공유하던
클래스라 별도 그룹핑 없이 재사용).

Playwright로 검증: (a) 자동싱크 OFF + 오디오 정지 + 자막 10개 앞으로 이동 후 마킹 →
화면에 보이던 인덱스(10)가 정확히 마킹되고 오디오는 계속 정지 상태 유지, (b) 자막
구성이 다른 저장 기록이 있는 영화를 Reader에서 열고 마킹 → `confirm()` 미발생 +
기존 마킹 보존 + 새 마킹 정상 기록, (c) 300ms 내 연속 탭 → 두 번째 탭은 무시되고
마킹 횟수 1회만 기록.

**추가 발견(리뷰 sweep)**: `saveStudy()`는 5초 스로틀이라, 마킹 직후 5초 안에 앱이
백그라운드로 전환되면(화면 잠금, 탭 전환) 방금 한 마킹이 저장되지 않고 유실될 수
있었음 — `visibilitychange`가 `hidden`이 될 때 `saveStudy(true)`로 즉시 강제 저장하도록
추가. Playwright로 마킹 직후 50ms 내 `visibilitychange`를 발생시켜 `updatedAt`이
갱신되고 마킹이 저장됨을 확인.

## Addendum (2026-07-18d): 마킹 배지 기능 + 후속 리뷰 수정

세션 반복재생이 기본이라 같은 문장을 여러 번 다시 만나므로, 이미 마킹한 문장을
알아볼 수 있게 `🔖` 배지를 추가: 라이딩 모드 세션 요약에 "이번 세션 마킹 N개"
(`updateCommuteSummary`), 현재 재생 중인 문장 표시(`updateCommuteNow`, primary/secondary
인덱스 공간이 달라 별도 조회), Reader 자막 카드(`renderSubtitles`, `state.position + i`
기준, `linesPerView` 다중 표시 시에도 현재 문장에만 정확히 표시).

타겟 리뷰(3앵글)로 실제 버그 발견·수정:
- `renderSubtitles()`가 `state.study.data`를 확인 없이 읽어 (a) Reader를 바로 열면
  기존 마킹의 배지가 전혀 안 보이고 (b) 다른 영화로 넘어가면 이전 영화 마킹이 새
  영화 문장에 잘못 표시될 수 있었음 — 실기 확인(마킹 → 새로고침 → 이어읽기 → 배지
  없음) 후 `renderSubtitles()` 진입 시 `ensureStudy(true)`로 근본 수정.
- 1st/2nd 자막 전환 핸들러가 `syncOffset`을 빠뜨린 기존 버그(내 배지 기능이 처음으로
  가시화) 수정.
- 마킹 직후 배지가 다음 재생 tick에 의존해 늦게 뜨던 것을 `replayCurrentSentence()`에서
  `updateCommuteNow()` 즉시 호출로 수정.

**보류(범위 밖)**: 같은 영화에서 primary 자막 파일을 바꿔가며 마킹하면
`ensureStudy()`가 영화 단위로만 캐시를 구분해 인덱스가 어긋날 수 있음 — 발생
빈도가 낮고(듀얼 자막 영화에서 의도적으로 파일을 바꿔야 함) `ensureStudy()` 자체의
더 넓은 재설계가 필요해 이번 라운드에서는 손대지 않음.

## Manual Test Checklist

1. 홈 화면 진입 시 라이딩 모드 카드가 최상단 큰 카드로 보이는가. 나머지는 "더보기"
   아래 작게 보이는가.
2. 세션 길이 설정에서 기본값이 5분인가. 10/15분 칩 정상 동작. 직접입력 칩 → 숫자
   입력(예: 7분) → 적용 후 라이딩 세션 리스트가 7분 단위로 재계산되는가.
3. 라이딩 모드 세션 반복 ON 상태에서 세션 끝 도달 시 일시정지 없이 세션 처음부터
   자동으로 다시 재생되는가(반복 횟수 표시 증가 확인).
4. 세션 반복 OFF로 바꾸면 기존처럼 다음 세션으로 넘어가고 `세션 끝 일시정지` 설정에
   따라 멈추는가.
5. Reader 화면에서 재생바가 이전보다 커져서 드래그하기 편한가(실기기 확인).
