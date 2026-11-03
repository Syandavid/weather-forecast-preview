const CACHE = "weather-acceptance-v31.55";
const ASSETS = [
  "./",
  "./index.html",
  "./assets/weather-insights.js?v=31.47",
  "./assets/route-weather.js?v=31.54",
  "./assets/storm-quality.js?v=31.55",
  "./assets/map-weather.js?v=27.1",
  "./assets/map-weather-worker.js?v=27.1",
  "./assets/pro-weather.js?v=28",
  "./assets/city-search.js?v=31.32",
  "./assets/road-overlay.js?v=31.32",
  "./assets/vector-labels.js?v=31.34",
  "./assets/ui-clean.css?v=31.53",
  "./manifest.webmanifest",
  "./icon-192-v3.png",
  "./icon-512-v3.png",
  "./apple-touch-icon-v3.png",
  "./assets/weather-app-icon-v3.png",
  "./assets/weather-cover.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    // A new application cache must not install stale HTML from the HTTP cache.
    // Keep addAll atomic: any missing resource leaves the previous worker active.
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map(url => new Request(url, {cache:'reload'}))))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const owned = keys.filter(k => k.startsWith('weather-acceptance-v'));
        const previous = owned.filter(k => k !== CACHE).at(-1);
        return Promise.all(owned.filter(k => k !== CACHE && k !== previous).map(k => caches.delete(k)));
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});

function isHtmlRequest(request) {
  if (request.mode === "navigate") return true;
  if (request.destination === "document") return true;
  try {
    const path = new URL(request.url).pathname;
    return path.endsWith("/") || /\/index\.html$/.test(path);
  } catch (_) {
    return false;
  }
}

function sameOrigin(request) {
  try {
    return new URL(request.url).origin === self.location.origin;
  } catch (_) {
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const req = event.request;
  // Never replace a failed third-party iframe navigation with our app shell.
  if (!sameOrigin(req)) return;

  if (isHtmlRequest(req)) {
    // Serve the shell belonging to this active worker, not a newer shell with
    // different script versions. A fully installed update waits for user action.
    event.respondWith(caches.open(CACHE).then(cache => cache.match('./index.html')).then(cached => cached || fetch(req)));
    return;
  }
  if (new URL(req.url).pathname.endsWith('/data/typhoons.json')) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      try {
        const response = await fetch(req);
        if (!response.ok) throw Error('snapshot unavailable');
        await cache.put(req, response.clone()); return response;
      } catch (_) {
        return await cache.match(req) || new Response(JSON.stringify({updated:null,storms:[],errors:['CMA unavailable','NHC unavailable']}),{status:503,headers:{'Content-Type':'application/json'}});
      }
    }));
    return;
  }
  // Only install-time assets are cached. Do not grow an unbounded request cache.
  event.respondWith(caches.open(CACHE).then(cache => cache.match(req)).then(cached => cached || fetch(req)));
});

