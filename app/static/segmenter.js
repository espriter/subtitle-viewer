/* ============================================================
   세그멘터 — 자막 큐 타임스탬프 기반 가상 세션 분할
   mp3를 자르지 않고, 씬 전환 무음 갭에서 15분 내외 세션 경계를 계산한다.
   순수 함수 모듈: 브라우저(window.Segmenter)와 node:test 양쪽에서 사용.
   ============================================================ */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.Segmenter = factory();
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // "HH:MM:SS,mmm" | "HH:MM:SS" | "MM:SS" → seconds
    function timeToSeconds(timeStr) {
        const parts = String(timeStr).replace(",", ".").split(":");
        if (parts.length === 3) return +parts[0] * 3600 + +parts[1] * 60 + parseFloat(parts[2]);
        if (parts.length === 2) return +parts[0] * 60 + parseFloat(parts[1]);
        return parseFloat(parts[0]);
    }

    const DEFAULTS = {
        targetSec: 900,      // 세션 목표 길이
        windowSec: 180,      // 목표 시각 ± 탐색 창
        minGapSec: 2.0,      // 씬 전환으로 간주하는 최소 무음 갭
        minTailSec: 240,     // 이보다 짧은 꼬리는 마지막 세션에 흡수
        padSec: 0.5,         // 경계 패딩 (첫 음절 잘림 방지)
        chapterStarts: [],   // 실제 챕터 시작(초) — 창 안에 있으면 최우선 경계
    };

    // cues: [{start, end, ...}] → [{index, startCue, endCue, startSec, endSec}]
    // 자막 시간 도메인에서 동작한다. syncOffset 보정은 재생 시점의 책임.
    function computeSessions(cues, opts) {
        const cfg = Object.assign({}, DEFAULTS, opts || {});
        if (!cues || cues.length === 0) return [];

        const n = cues.length;
        const starts = new Array(n);
        const ends = new Array(n);
        for (let i = 0; i < n; i++) {
            starts[i] = timeToSeconds(cues[i].start);
            ends[i] = timeToSeconds(cues[i].end);
        }
        const lastEnd = ends[n - 1];

        // 챕터 시작이 큐 i 앞의 무음 구간에 놓이는가 (±1s 여유)
        function isChapterBoundary(i) {
            for (const cs of cfg.chapterStarts) {
                if (cs > ends[i - 1] - 1 && cs <= starts[i] + 1) return true;
            }
            return false;
        }

        // 세션 [s..cut-1]이 되도록 경계 큐 인덱스 cut을 고른다.
        function pickCut(s, target) {
            let windowSec = cfg.windowSec;
            while (windowSec <= 86400) {
                const lo = target - windowSec;
                const hi = target + windowSec;
                let best = -1;
                let bestGap = -Infinity;
                for (let i = s + 1; i < n; i++) {
                    const boundary = ends[i - 1];
                    if (boundary < lo) continue;
                    if (boundary > hi) break;
                    let gap = starts[i] - boundary;
                    if (isChapterBoundary(i)) gap = Infinity;
                    const better =
                        best === -1 ||
                        gap > bestGap + 1e-9 ||
                        (Math.abs(gap - bestGap) <= 1e-9 &&
                            Math.abs(boundary - target) < Math.abs(ends[best - 1] - target));
                    if (better) {
                        best = i;
                        bestGap = gap;
                    }
                }
                // 창 안 최대 갭 사용: minGap 미달이어도 폴백으로 채택.
                if (best !== -1) return best;
                windowSec += 60; // 창 안에 큐 경계가 전무 → 창 확장
            }
            return n; // 안전망: 남은 전부를 한 세션으로
        }

        const sessions = [];
        let s = 0;
        while (s < n) {
            // 남은 분량이 목표+minTail 이하면 끝까지 한 세션.
            if (lastEnd - starts[s] <= cfg.targetSec + cfg.minTailSec) {
                sessions.push(makeSession(s, n - 1));
                break;
            }
            const cut = pickCut(s, starts[s] + cfg.targetSec);
            // 꼬리 흡수: 컷 이후 잔여가 minTail 미만이면 자르지 않고 흡수 (최악 ~22분)
            if (cut >= n || lastEnd - starts[cut] < cfg.minTailSec) {
                sessions.push(makeSession(s, n - 1));
                break;
            }
            sessions.push(makeSession(s, cut - 1));
            s = cut;
        }
        return sessions;

        function makeSession(startCue, endCue) {
            return {
                index: sessions.length,
                startCue,
                endCue,
                startSec: Math.max(0, starts[startCue] - cfg.padSec),
                endSec: ends[endCue] + cfg.padSec,
            };
        }
    }

    return { computeSessions, timeToSeconds, DEFAULTS };
});
