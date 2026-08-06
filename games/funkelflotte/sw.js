// Funkel-Flotte service worker: stale-while-revalidate for everything
// in this game's directory, so hot-seat and robo mode work offline.
const CACHE = "funkelflotte-v12";

const PRECACHE = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/main.js",
  "./js/engine.js",
  "./js/ai.js",
  "./js/worlds.js",
  "./js/sound.js",
  "./js/net.js",
  "./js/scene.js",
  "./js/tween.js",
  "./js/models.js",
  "./js/environments.js",
  "./js/progress.js",
  "./js/flags.js",
  "./js/puzzle.js",
  "./js/chase.js",
  "./js/boss.js",
  "./js/powers.js",
  "./vendor/three.module.min.js",
  "./vendor/three.core.min.js",
  "./vendor/peerjs.min.js",
  "./vendor/qrcode.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request, {
        ignoreSearch: url.pathname.endsWith("/") || url.pathname.endsWith("index.html"),
      });
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
