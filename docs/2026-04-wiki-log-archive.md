# subtitle-viewer 위키 로그 아카이브 (2026-04)

이 문서는 삭제된 `/srv/wiki/log.md`에서 subtitle-viewer 관련 이력을 추려 보존한 아카이브다. 전체 원본 로그는 `/srv/docs/retired-wiki-log.md`에 있다.

## 2026-04-07 | 화면 꺼짐 방지, 듀얼 싱크, 아이콘

- Wake Lock API와 NoSleep 비디오 fallback을 사용해 화면 꺼짐 방지를 추가했다.
- 60초 주기 재획득으로 모바일 환경에서 wake lock 유지를 보강했다.
- 듀얼 자막 시간 기준을 독립 싱크로 바꾸고 secondary 자막을 primary timestamp 기준으로 매칭했다.
- 자막 선택 순서 표시 배지를 추가했다.
- 자막 테마 파비콘과 앱 아이콘을 생성했다.

## 2026-04-06 | 기능 추가 반영

- PWA와 Media Session API 기반 백그라운드 오디오 재생을 추가했다.
- 자막 싱크 보정 오프셋을 추가했다.
- 자막 자동 싱크 ON/OFF 토글을 추가했다.

## 2026-04-06 | 기존 프로젝트 일괄 정리

- `/srv` 하위 프로젝트 정리 과정에서 subtitle-viewer 위키 페이지가 생성됐다.
- 2026-04-14 프로젝트 위키 폐기 때 사람용 내용은 프로젝트 문서와 auto memory로 이관됐다.
