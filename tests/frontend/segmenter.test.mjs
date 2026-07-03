// 세그멘터(가상 세션 분할) 테스트 — 의존성 없이 node 내장 러너 사용
// 실행: node --test tests/frontend/
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Segmenter = require("../../app/static/segmenter.js");
const { computeSessions, timeToSeconds } = Segmenter;

// --- helpers ---

function tc(sec) {
    const h = String(Math.floor(sec / 3600)).padStart(2, "0");
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
    const s = String(Math.floor(sec % 60)).padStart(2, "0");
    const ms = String(Math.round((sec % 1) * 1000)).padStart(3, "0");
    return `${h}:${m}:${s},${ms}`;
}

function makeCues(pairs) {
    return pairs.map(([s, e], i) => ({ index: i + 1, start: tc(s), end: tc(e) }));
}

// 대사 3초 + 갭 1초 연속, sceneGapEvery초마다 sceneGapLen초 씬 갭
function syntheticCues(totalSec, sceneGapEvery = 840, sceneGapLen = 8) {
    const pairs = [];
    let t = 0;
    let sinceScene = 0;
    while (t + 3 <= totalSec) {
        pairs.push([t, t + 3]);
        t += 4;
        sinceScene += 4;
        if (sceneGapEvery > 0 && sinceScene >= sceneGapEvery) {
            t += sceneGapLen;
            sinceScene = 0;
        }
    }
    return makeCues(pairs);
}

function gapBeforeCue(cues, i) {
    return timeToSeconds(cues[i].start) - timeToSeconds(cues[i - 1].end);
}

// --- tests ---

test("빈 입력이면 빈 배열", () => {
    assert.deepEqual(computeSessions([], {}), []);
    assert.deepEqual(computeSessions(null, {}), []);
});

test("짧은 콘텐츠(목표+minTail 이하)는 세션 1개로 통짜", () => {
    const cues = syntheticCues(1130, 0); // 18.8분, 씬 갭 없음
    const sessions = computeSessions(cues);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].startCue, 0);
    assert.equal(sessions[0].endCue, cues.length - 1);
});

test("90분 영화: 씬 갭에서 커팅되고 세션 길이가 목표±창 안에 든다", () => {
    const cues = syntheticCues(5400, 840, 8); // 90분, 14분마다 8초 씬 갭
    const sessions = computeSessions(cues); // target 900s, window 180s
    assert.ok(sessions.length >= 4, `expected >=4 sessions, got ${sessions.length}`);

    for (let k = 1; k < sessions.length; k++) {
        // 인접 세션은 큐를 빠짐없이 나눠 가진다
        assert.equal(sessions[k].startCue, sessions[k - 1].endCue + 1);
        // 세션 경계는 씬 갭(8초)에 정렬된다 — 일반 갭은 1초뿐
        const g = gapBeforeCue(cues, sessions[k].startCue);
        assert.ok(g >= 7.9, `session ${k} boundary gap = ${g}s, expected scene gap`);
    }
    // 마지막 세션을 제외하면 길이가 target ± window (+패딩 여유) 안
    for (let k = 0; k < sessions.length - 1; k++) {
        const dur = sessions[k].endSec - sessions[k].startSec;
        assert.ok(dur >= 900 - 180 - 2 && dur <= 900 + 180 + 2,
            `session ${k} duration ${dur}s out of range`);
    }
    // 전체 커버리지
    assert.equal(sessions[0].startCue, 0);
    assert.equal(sessions[sessions.length - 1].endCue, cues.length - 1);
});

test("챕터 시작점이 창 안에 있으면 최우선 경계로 스냅", () => {
    const cues = syntheticCues(3600, 840, 8); // 씬 갭 있음
    // 950초 부근의 큐 사이(일반 1초 갭)에 챕터 시작을 놓는다
    const at950 = cues.findIndex((c) => timeToSeconds(c.start) >= 950);
    const chapterStart = timeToSeconds(cues[at950].start) - 0.5;
    const sessions = computeSessions(cues, { chapterStarts: [chapterStart] });
    // 첫 세션 경계가 씬 갭(~840)이 아니라 챕터 지점(~950)에 스냅
    assert.equal(sessions[1].startCue, at950);
});

test("창 안에 2초 이상 갭이 없으면 최대 갭으로 폴백 (목표 근처 커팅)", () => {
    const cues = syntheticCues(3600, 0); // 모든 갭 1초
    const sessions = computeSessions(cues);
    assert.ok(sessions.length >= 3);
    for (let k = 0; k < sessions.length - 1; k++) {
        const dur = sessions[k].endSec - sessions[k].startSec;
        // 동률 갭은 목표에 가장 가까운 경계 선택 → 길이 ≈ 900
        assert.ok(Math.abs(dur - 900) < 10, `session ${k} duration ${dur}s, expected ~900`);
    }
});

test("창 안에 큐 경계가 없으면(거대 무음) 창을 확장해 경계를 찾는다", () => {
    // 0~600초 대사 → 600~2000초 무음 → 2000~2600초 대사
    const block1 = [];
    for (let t = 0; t + 3 <= 600; t += 4) block1.push([t, t + 3]);
    const block2 = [];
    for (let t = 2000; t + 3 <= 2600; t += 4) block2.push([t, t + 3]);
    const cues = makeCues([...block1, ...block2]);

    const sessions = computeSessions(cues);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].endCue, block1.length - 1); // 첫 세션 = 첫 블록
    assert.equal(sessions[1].startCue, block1.length);   // 둘째 세션 = 둘째 블록
});

test("컷 이후 꼬리가 4분 미만이면 마지막 세션에 흡수", () => {
    // 20.8분: 컷하면 꼬리가 ~3.7분 → 흡수되어 세션 1개
    const cues = syntheticCues(1250, 1020, 8);
    const sessions = computeSessions(cues);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].endCue, cues.length - 1);
});

test("경계 패딩: 시작 -0.5s(0 미만 클램프), 끝 +0.5s", () => {
    const cues = syntheticCues(2000, 840, 8);
    const sessions = computeSessions(cues);
    assert.equal(sessions[0].startSec, 0); // 0 - 0.5 → clamp 0
    const last = sessions[sessions.length - 1];
    assert.equal(last.endSec, timeToSeconds(cues[cues.length - 1].end) + 0.5);
    const s1 = sessions[1];
    assert.equal(s1.startSec, timeToSeconds(cues[s1.startCue].start) - 0.5);
});

test("결정성: 같은 입력이면 항상 같은 결과", () => {
    const cues = syntheticCues(5400, 840, 8);
    const a = computeSessions(cues, { targetSec: 900 });
    const b = computeSessions(cues, { targetSec: 900 });
    assert.deepEqual(a, b);
});

test("목표 길이 변경 시 세션 수가 달라진다 (10분 vs 20분)", () => {
    const cues = syntheticCues(5400, 300, 6); // 5분마다 씬 갭 → 유연한 커팅
    const short = computeSessions(cues, { targetSec: 600 });
    const long = computeSessions(cues, { targetSec: 1200 });
    assert.ok(short.length > long.length,
        `10분 세션(${short.length}) > 20분 세션(${long.length}) 이어야 함`);
});
