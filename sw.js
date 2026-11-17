// sw.js — オフラインでも開けるようにする(make_web.mjs が、自動で、作る。直接、直さない)。
//   起動時に、全部のファイル(コードと、物語)を、端末に、覚えさせる。
//   開く時は、ネットを先に見て(最新を、確かめて)、つながらなければ、覚えた物を使う。
const CACHE_NAME = "english-listening-web-cdc12d2475";
const FILES = [
  "./",
  "index.html",
  "app.js",
  "logic.mjs",
  "sync.mjs",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "stories/01-01-01-ken.json",
  "stories/01-01-02-ken.json",
  "stories/01-01-03-ken.json",
  "stories/01-01-04-ken.json",
  "stories/01-01-05-ken.json",
  "stories/01-01-06-ken.json",
  "stories/01-01-07-ken.json",
  "stories/01-01-08-ken.json",
  "stories/01-02-01-umbrella.json",
  "stories/01-02-02-umbrella.json",
  "stories/01-02-03-umbrella.json",
  "stories/01-02-04-umbrella.json",
  "stories/01-02-05-umbrella.json",
  "stories/01-02-06-umbrella.json",
  "stories/01-02-07-umbrella.json",
  "stories/01-02-08-umbrella.json",
  "stories/01-03-01-bakery.json",
  "stories/01-03-02-bakery.json",
  "stories/01-03-03-bakery.json",
  "stories/01-03-04-bakery.json",
  "stories/01-03-05-bakery.json",
  "stories/01-03-06-bakery.json",
  "stories/01-03-07-bakery.json",
  "stories/01-03-08-bakery.json",
  "stories/02-01-01-ken.json",
  "stories/02-01-02-ken.json",
  "stories/02-01-03-ken.json",
  "stories/02-01-04-ken.json",
  "stories/02-01-05-ken.json",
  "stories/02-01-06-ken.json",
  "stories/02-01-07-ken.json",
  "stories/02-01-08-ken.json",
  "stories/02-02-01-umbrella.json",
  "stories/02-02-02-umbrella.json",
  "stories/02-02-03-umbrella.json",
  "stories/02-02-04-umbrella.json",
  "stories/02-02-05-umbrella.json",
  "stories/02-02-06-umbrella.json",
  "stories/02-02-07-umbrella.json",
  "stories/02-02-08-umbrella.json",
  "stories/02-03-01-bakery.json",
  "stories/02-03-02-bakery.json",
  "stories/02-03-03-bakery.json",
  "stories/02-03-04-bakery.json",
  "stories/02-03-05-bakery.json",
  "stories/02-03-06-bakery.json",
  "stories/02-03-07-bakery.json",
  "stories/02-03-08-bakery.json",
  "stories/03-01-01-ken.json",
  "stories/03-01-02-ken.json",
  "stories/03-01-03-ken.json",
  "stories/03-01-04-ken.json",
  "stories/03-01-05-ken.json",
  "stories/03-01-06-ken.json",
  "stories/03-01-07-ken.json",
  "stories/03-01-08-ken.json",
  "stories/03-02-01-umbrella.json",
  "stories/03-02-02-umbrella.json",
  "stories/03-02-03-umbrella.json",
  "stories/03-02-04-umbrella.json",
  "stories/03-02-05-umbrella.json",
  "stories/03-02-06-umbrella.json",
  "stories/03-02-07-umbrella.json",
  "stories/03-02-08-umbrella.json",
  "stories/03-03-01-bakery.json",
  "stories/03-03-02-bakery.json",
  "stories/03-03-03-bakery.json",
  "stories/03-03-04-bakery.json",
  "stories/03-03-05-bakery.json",
  "stories/03-03-06-bakery.json",
  "stories/03-03-07-bakery.json",
  "stories/03-03-08-bakery.json",
  "stories/03-04-01-openboat.json",
  "stories/03-04-02-openboat.json",
  "stories/03-04-03-openboat.json",
  "stories/03-04-04-openboat.json",
  "stories/03-04-05-openboat.json",
  "stories/03-04-06-openboat.json",
  "stories/03-04-07-openboat.json",
  "stories/03-04-08-openboat.json",
  "stories/03-04-09-openboat.json",
  "stories/03-04-10-openboat.json",
  "stories/03-04-11-openboat.json",
  "stories/03-04-12-openboat.json",
  "stories/03-04-13-openboat.json",
  "stories/03-04-14-openboat.json",
  "stories/03-04-15-openboat.json",
  "stories/03-04-16-openboat.json",
  "stories/03-04-17-openboat.json",
  "stories/03-04-18-openboat.json",
  "stories/03-04-19-openboat.json",
  "stories/03-04-20-openboat.json",
  "stories/03-04-21-openboat.json",
  "stories/03-04-22-openboat.json",
  "stories/index.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("english-listening-web-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const KNOWN = new Set(FILES.map((f) => new URL(f, self.registration.scope).href));   // 覚えるファイルの、アドレス

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // 外のサイト(GitHub の API など)・GET 以外・一覧に無い物は、触らない
  if (event.request.method !== "GET" || url.origin !== location.origin || !KNOWN.has(url.origin + url.pathname)) return;
  event.respondWith((async () => {
    try {
      const fresh = await fetch(event.request, { cache: "no-cache" });          // 最新を、確かめる
      if (fresh.ok) { const cache = await caches.open(CACHE_NAME); cache.put(event.request, fresh.clone()); }
      return fresh;
    } catch {
      return (await caches.match(event.request, { ignoreSearch: true })) || (await caches.match("index.html")) || Response.error();
    }
  })());
});
