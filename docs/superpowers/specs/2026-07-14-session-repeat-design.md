# Session Repeat in Reader (일상 재생 세션 반복) Design

## Goal

일상 재생(Reader, 화면 보며 자막 읽기)에서도 라이딩 모드의 "세션"(15분 내외 자동 분할,
`segmenter.js`) 단위로 반복 청취할 수 있게 한다. 기존 구간반복(A-B 루프)은 자막 2개를
직접 골라야 해서 세션 전체를 반복하려면 번거로웠다.

## Decision

새 엔진을 만들지 않고 기존 두 시스템을 그대로 이어붙인다:

- **세션 계산**: 라이딩 모드가 쓰는 `computeStudySessions()` / `sessionIndexForSec()` 재사용.
- **반복 재생**: 기존 A-B 루프 엔진(`state.loop`, `handleLoopBoundary()`, loop-indicator)
  재사용. 새 토글이 하는 일은 현재 재생 위치가 속한 세션의 `startCue`/`endCue`를
  `state.loop.startIndex`/`endIndex`에 넣고 `saveLoop()`를 호출하는 것뿐.

Reader 하단 nav에 🔂 버튼 추가(오디오 있을 때만 노출, `btn-loop`/`btn-commute`와 동일 조건).
탭하면 현재 세션을 A-B 루프로 설정 + 세션 시작으로 시크 + 재생. 다시 탭하면 해제
(`cancelLoop()`). Loop Setup에서 수동으로 A/B를 저장하면 `state._sessionRepeat` 플래그가
꺼져 일반 구간반복 라벨로 되돌아간다 — 두 기능이 같은 상태를 공유해도 충돌하지 않는다.

## State

`state.loop._sessionRepeat: boolean` 추가 — 현재 활성 루프가 세션 반복 토글로 설정된
것인지 구분(라벨에 "세션 반복 · " 접두어 표시 여부만 좌우, 그 외 loop 동작은 기존과 동일).
세션 반복은 A-B 루프와 마찬가지로 **세션 간 영속하지 않음**(localStorage 저장 없음,
페이지 새로고침/폴더 재진입 시 해제).

## Files

- `app/static/index.html` — `#btn-session-repeat` 버튼 (reader-dock, btn-loop/btn-commute 사이)
- `app/static/app.js` — `toggleSessionRepeat()`, `saveLoop()`/`cancelLoop()`/
  `updateLoopIndicator()`에 `_sessionRepeat` 처리 3줄씩 추가, `setupAudio()`에 버튼
  show/hide 2곳 추가

## Out of Scope

세션 길이 설정 UI(기존 라이딩 설정의 10/15/20분 그대로 공유), 세션 경계 알림음,
세션 반복 중 진도 저장(A-B 루프와 동일하게 세션-only), 새 아이콘 디자인.

## Manual Test (완료, 2026-07-14 로컬 8091 Playwright)

1. Reader에서 오디오 있는 폴더 진입 → 🔂 버튼 노출 확인.
2. 🔂 탭 → 인디케이터에 "세션 반복 · HH:MM:SS ~ HH:MM:SS 0/N회" 표시, 재생 위치가 세션
   시작으로 이동.
3. 인디케이터 × 탭 → 해제.
4. 🔂 재탭(켜짐) → 다시 🔂 탭 → 해제(토글 동작 확인).
