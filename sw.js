/* ============================================================================
   FIT · 서비스 워커
   ----------------------------------------------------------------------------
   목적은 하나입니다: 일본에서 데이터가 끊겨도 "일정"은 반드시 보이게 하는 것.

   · HTML  : 네트워크 우선 → 실패하면 캐시 (재배포 시 항상 최신을 받게)
   · 정적  : 캐시 우선 → 없으면 네트워크 후 캐시에 저장
   · 구글 지도 등 외부 요청은 아예 건드리지 않습니다.
     타일은 캐시할 수도 없고(약관) 캐시해서도 안 됩니다.
     따라서 오프라인에서는 지도만 비고 일정·시간·금액·주의사항은 그대로 보입니다.

   일정을 고쳐 배포할 때 CACHE 뒤 숫자만 올리면 옛 캐시가 정리됩니다.
   ========================================================================== */
const CACHE = "tokyo-trip-v15";

const SHELL = [
  "./",
  "index.html",
  "expenses.html",
  "admin.html",
  "manifest.webmanifest",
  "shell.css?v=15",
  "shell.js?v=15",
  "api.js?v=15",
  "edit.css?v=15",
  "edit.js?v=15",
  "panels.js?v=15",
  "trips.js?v=15",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-180.png",
  "icons/icon-maskable-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 하나라도 404 면 addAll 전체가 실패하므로 개별로 담는다
    await Promise.all(SHELL.map(u => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    /* 새 버전이 자리를 잡았다고 열려 있는 페이지에 알린다 */
    for (const c of await self.clients.matchAll({ type: "window" })) {
      c.postMessage({ type: "sw-activated" });
    }
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 구글 지도 등은 통과

  /* API 는 절대 캐시하지 않는다.
     /api/auth/me 같은 응답이 캐시되면 로그아웃 상태가 계속 되돌아와서
     로그인 자체가 되지 않는다. 항상 네트워크로 보낸다. */
  if (url.pathname.startsWith("/api/")) return;

  /* 지도 키 파일도 캐시하지 않는다 — 바꿔도 반영이 안 되면 곤란하다 */
  if (url.pathname.endsWith("/gmaps-key.local.js")) return;

  const isHTML = req.mode === "navigate" ||
                 (req.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    // 네트워크 우선 — 온라인이면 항상 최신 일정을 본다
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(req)) ||
               (await caches.match("index.html")) ||
               new Response("오프라인입니다. 한 번은 온라인에서 열어야 저장됩니다.",
                            { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  /* 정적 파일 — 캐시를 즉시 주고, 뒤에서 새 버전을 받아 둔다.
     캐시 우선으로만 주면 새로 배포해도 옛 스크립트가 계속 나가서
     "최신 HTML + 옛 JS" 조합이 만들어지고, 그 조합에서 부트가 죽는다. */
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const network = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (hit) { e.waitUntil(network); return hit; }
    return (await network) || new Response("", { status: 504 });
  })());
});
