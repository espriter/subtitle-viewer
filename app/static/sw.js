const CACHE_NAME = "subtitle-viewer-shell-v1";

self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// 앱 셸(정적 파일)만 네트워크 우선 + 캐시 폴백. 라이딩 중 전파가 끊겨도 앱은 뜨게 하되,
// 자막/오디오/영화 목록(/api/...)은 매번 최신 데이터가 필요하므로 캐싱 대상에서 제외.
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== "GET" || url.pathname.includes("/api/")) return;

    event.respondWith(
        fetch(event.request, { cache: "no-store" })
            .then((res) => {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                return res;
            })
            .catch(() => caches.match(event.request))
    );
});
