# Commute Listening & Review Mode Design (라이딩 리스닝 모드)

## Goal

자전거 통근(편도 15~20분) 시간을 화면 없이 귀 + 이어폰 버튼만으로 쓰는 영어 리스닝
루틴으로 만든다. 라이딩 중엔 화면을 볼 수 없지만 이어폰 버튼(재생/이전/다음)은 누를 수
있고, 라이딩 후 짬날 때 같은 폰에서 자막으로 어려웠던 문장을 복습한다. 콘텐츠는
영화/드라마 대사(`en.srt` + `ko.srt` + full-length `audio.mp3`).

학습 흐름(리스닝 교수법 관점): **1차 다량듣기(라이딩, extensive) → 암묵 마킹(noticing)
→ 전사 기반 집중듣기(리뷰, intensive) → 퇴근길 마킹 문장만 재청취(같은 날 간격 재인출)**.

## Key Decisions

| # | 결정 | 근거 |
|---|------|------|
| D1 | 세션 분할은 100% 클라이언트 계산 (`segmenter.js` 순수 함수) | 입력(큐 start/end)이 이미 `state.subtitles.primary`에 있음. 백엔드 무변경. mp3를 물리적으로 자르지 않는다 |
| D2 | 영속 데이터는 시간(초)·큐 인덱스 기준, 세션 번호는 항상 파생 | 목표 길이 변경으로 세션 경계가 재계산돼도 진도/마킹이 유효 유지 |
| D3 | 라이딩 모드 = 5번째 뷰 `view-commute` + Media Session 리매핑 | `showView()`가 reader 외 뷰에서 wake lock을 해제 → 화면 꺼짐 자동 허용 |
| D4 | 리뷰 = 6번째 뷰 `view-review`, 기존 A-B 루프 엔진을 start=end=해당 큐로 재사용 | `handleLoopBoundary()`의 loopCount/loopGap이 그대로 문장 반복+섀도잉 멈춤이 됨 |
| D5 | 세션 경계 도달 시 기본 일시정지(설정으로 연속 재생 가능) | 무음 = 주머니 속 유일한 "세션 끝" 신호. 라이딩이 길면 이어폰 play 한 번으로 다음 세션 |

이 설계는 데이터엔지니어 스터디모드 문서(`docs/plans/2026-05-15-data-engineer-study-mode-design.md:112`)의
미결정 사항 "MP3 splitting: offline script vs in-app"을 **가상 분할(둘 다 아님)**로 해소한다.

## Virtual Segmentation (`app/static/segmenter.js`)

`computeSessions(cues, opts)` → `[{index, startCue, endCue, startSec, endSec}]`

```
opts = { targetSec: 900, windowSec: 180, minGapSec: 2.0, minTailSec: 240, padSec: 0.5, chapterStarts: [] }
```

1. 큐 간 갭 계산: `gap[i] = start(cue[i]) − end(cue[i−1])`
2. 탐욕적 전진 커팅: 세션 시작에서 목표 시각 `T = start + targetSec`. `[T−180, T+180]` 창
   안에서 **최대 갭** 지점을 경계로. 영화 씬 전환 갭은 보통 3~10초+라 자연히 씬 경계에
   떨어진다. 실제 챕터 시작점(`chapterStarts`)이 창 안에 있으면 gap=∞로 취급해 최우선.
3. 폴백: 창 안에 큐 경계가 전무하면(거대 무음) 창을 +60초씩 확장.
4. 꼬리: 컷 이후 잔여가 `minTailSec`(4분) 미만이면 자르지 않고 마지막 세션에 흡수(최악 ~22분).
5. 경계 ±0.5s 패딩(첫 음절 잘림 방지). 결정적(같은 입력 → 같은 출력).

자막 시간 도메인에서 동작하며, syncOffset 보정은 재생 시점의 책임
(기존 `audioTimeForSubtitleStart()` 패턴). 기본 목표 길이 15분, 설정에서 10/15/20분.

## Mode: Commute (`view-commute`)

**진입**: 홈 카드 "🚴 라이딩 모드"(마지막 재생 폴더 기준) 또는 Reader 독의 🚴 버튼.

**화면(출발 전 5초용)**: 세션 칩 리스트(완료✓/현재/미래), 세션 요약, 큰 ▶ 시작 버튼
(유저 제스처 → iOS Media Session 활성화 필수), 배속 칩, 현재 문장 1줄 미리보기.

**이어폰 버튼** (`updateMediaSession()`의 `state.mode === "commute"` 분기):

| 액션 | 동작 |
|------|------|
| play/pause | 그대로 |
| previoustrack (⏮) | `replayCurrentSentence()` — 현재 문장 처음부터(−0.3s 리드인) + **replayCount++ (암묵 마킹)**. 큐 시작 1초 이내면 "방금 끝난 문장"으로 이전 큐 대상. 300ms 디바운스 |
| nexttrack (⏭) | `skipToNextSentence()` — 다음 문장으로 스킵 (마킹 없음) |

`commuteSwapButtons` 설정으로 prev/next 의미를 스왑(AirPods 3-스퀴즈=prev 대응).
seekforward/backward 핸들러는 **등록하지 않는다** — iOS 잠금화면에서 prev/next 버튼이
시크 화살표로 대체되는 것을 막기 위함.

**세션 경계**: `onTimeUpdate()` → `handleCommuteTick()`가 `t ≥ endSec`이면
`completeCommuteSession()`: progressSec를 세션 끝으로 확정, 포인터를 다음 세션으로,
`sessionEndPause`(기본 ON)면 일시정지 + 다음 세션 시작점 pre-seek(이어폰 play 한 번으로 연속).

**진행 저장**: 5초 스로틀 `resumeSec` + `pause` 이벤트 시 즉시(이어폰 분리→iOS 자동 pause 활용).

## Mode: Review (`view-review`)

**진입**: 홈 카드 "📝 리뷰"(마킹 있을 때만) 또는 라이딩 뷰의 📝 버튼.

- 세션 네비(이전/다음), 필터 토글 [다시들은 문장 | 전체], 기존 loopCount/loopGap 칩 공유,
  블라인드 토글.
- 문장 카드(Loop Setup의 `.loop-card` + `renderReviewList()`): en+ko 이중자막,
  🔁 N회 배지(N≥2는 강조), ✓ 완료 버튼.
- **카드 탭 = 그 문장만 반복 재생**: `state.loop` start=end=cue → `seekToLoopStart()`.
  재탭 = 정지. loopCount/loopGap이 문장 반복+섀도잉 멈춤으로 그대로 적용.
- 블라인드 모드: en 텍스트 blur → 탭으로 공개(읽어서 이해가 들어서 이해를 가리는 것 방지).
- "마킹 지우기"로 세션 단위 카운트 리셋(confirm).

## Marked-Sentence Playlist (복습 재생)

라이딩 뷰의 "🔁 복습 재생(N문장)" 버튼. 마킹 큐를 **시간순**(서사 맥락 유지)으로 문장당
2회씩 기존 루프 엔진에 물려 연속 재생. `handleLoopBoundary()`의 반복 종료 지점에서
`advancePlaylist()`로 다음 큐로. 출근길 마킹 → 점심 리뷰 → 퇴근길 귀-only 재검증의
3단계를 완성한다.

## Playback Rate

`state.settings.playbackRate`(0.7/0.8/0.9/1.0/1.1/1.25). `preservesPitch` +
`webkitPreservesPitch`로 피치 유지. `setupAudio()`와 `loadedmetadata`에서 적용
(src 교체 시 rate 리셋 대응). 리뷰 집중듣기는 0.8~0.9로 연음 분해, 라이딩은 1.0 권장.

## Data Schema (localStorage)

기존 `subtitle-viewer-settings`에 추가(Object.assign 병합, 하위호환 자동):
```json
{ "playbackRate": 1.0, "commuteTargetMin": 15, "sessionEndPause": true, "commuteSwapButtons": false }
```

신규 per-movie 키 `subtitle-viewer-study:{movie}`:
```json
{
  "v": 1, "srtFile": "en.srt", "cueCount": 1543,
  "progressSec": 2765.0, "resumeSec": 2712.4,
  "cues": { "142": { "r": 3, "d": true }, "217": { "r": 1 } },
  "summary": { "sessionCount": 6, "currentSession": 4, "remainSec": 640 }
}
```
- `cues`는 활동 있는 큐만(희소 맵, `r`=replay 횟수, `d`=리뷰 완료). 영화당 <10KB.
- 세션 완료/현재는 저장 안 함 — `endSec ≤ progressSec`이면 완료, `resumeSec`이 속한
  세션이 현재(D2). `summary`는 홈 카드용 파생 캐시(자막 로드 없이 표시).
- `srtFile`/`cueCount` 불일치(자막 교체) 감지 → confirm 후 리셋.
- 로드 시 `v !== 1`이면 폐기(마이그레이션 없음, 개인 프로젝트).

## Edge Cases & Risks

- **iOS Media Session**: 라이딩 시작은 반드시 화면 ▶ 탭(제스처 체인). 홈 카드에서 자동재생 안 함.
- **경계 pause 후 iOS 오디오 세션 회수 가능성**: 실측 후 문제 시 `sessionEndPause` 기본값만 OFF로.
- **playbackRate 피치**: preservesPitch 미지원 구형 기기는 실측 후 저속 옵션 조정.
- **오조작 노이즈**: 300ms 디바운스 + 1회 마킹은 낮은 강조 + 지우기 저렴.
- **syncOffset**: 세션·큐는 자막 시간 도메인, 시크는 `audioTimeForSubtitleStart()`,
  경계 판정은 `t = currentTime + syncOffset` — 일관성이 리뷰 포인트.
- **회귀**: Reader의 Media Session(자막 prev/next)은 `state.mode` 분기로 보존,
  wake lock은 기존 reader-전용 로직 그대로(라이딩 뷰는 화면 꺼짐 허용).

## Files

- `app/static/segmenter.js` (신규) — `computeSessions()` 순수 함수
- `app/static/app.js` — state 확장, study 스토어, 배속, Media Session 리매핑, 라이딩/리뷰/플레이리스트
- `app/static/index.html` — 홈 카드 2개, 설정 행 4개, `view-commute`/`view-review`, segmenter.js 태그
- `app/static/style.css` — 세션 칩, 라이딩 스테이지, 리뷰 카드/배지/블라인드
- `tests/frontend/segmenter.test.mjs` (신규) — node 내장 테스트

## Out of Scope

mp3 물리 분할(가상 분할로 불필요), 서버측 진도 동기화/멀티 디바이스, TTS·비프 안내음,
SRS 스케줄러, 통계 대시보드, 오디오 오프라인 캐싱, 프론트 테스트 프레임워크 도입.

## Manual Test Checklist (iPhone PWA 기준)

세그멘터는 `node --test tests/frontend/segmenter.test.mjs`로 자동 검증. 나머지는 실기기 수동:

1. **[라이딩 시작·잠금·다시듣기]** 홈 → 라이딩 모드 → ▶ 시작 → 화면 잠금 → 30초 후
   이어폰 ⏮ → 직전 문장 처음부터 재생되는가.
2. **[마킹 반영]** 잠금 해제 → 📝 리뷰 → 해당 문장에 🔁 1 배지가 있는가.
3. **[스킵·재생/정지]** 이어폰 ⏭로 다음 문장, play/pause 정상 동작.
4. **[세션 경계]** 세션 끝 근처로(설정 시간 이동으로 endSec−30s 시크) 이동 후 잠금 →
   경계에서 자동 일시정지 → 이어폰 play → 다음 세션이 재생되는가.
5. **[이어보기 정확성]** 앱 강제 종료 → 재실행 → 홈 "라이딩 모드" 카드가 올바른 세션/남은
   시간을 표시하고, ▶로 그 지점부터 이어지는가.
6. **[화면 자동 꺼짐]** 라이딩 뷰에서 화면이 자동으로 꺼지는가(reader와 달리 wake lock 없음).
7. **[배속]** 배속 0.8 설정 → 폴더 재진입/새로고침 후에도 유지 + 피치 정상.
8. **[리뷰 루프·블라인드]** 리뷰에서 카드 탭 → loopCount·loopGap대로 반복 → 재탭 정지.
   블라인드 토글 → 자막 blur → 탭 공개.
9. **[복습 재생]** 라이딩 뷰 "🔁 복습 재생" → 마킹 문장이 시간순 2회씩 재생 → 완주 시 정지.
10. **[회귀]** 일반 Reader에서 이어폰 prev/next가 기존대로 자막 이전/다음으로 동작하는가.
