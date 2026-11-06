// Offline support for the website: serve the app shell from cache, refresh it in the background.
const CACHE = "lvp-v3.1.0"
const SHELL = [
  "./",
  "index.html",
  "app.webmanifest",
  "styles/main.css",
  "styles/reset.css",
  "styles/fonts.css",
  "styles/colors.css",
  "styles/landing.css",
  "styles/features.css",
  "fonts/JetBrains-Mono.woff2",
  "fonts/Material-Symbols.woff2",
  "icons/icon.svg",
  "icons/favicon.png",
  "scripts/theme-init.js",
  "scripts/app.js",
  "scripts/player.js",
  "scripts/cover.js",
  "scripts/db.js",
  "scripts/files.js",
  "scripts/hud.js",
  "scripts/library.js",
  "scripts/playlist.js",
  "scripts/pwa.js",
  "scripts/shortcuts.js",
  "scripts/settings.js",
  "scripts/subtitles.js",
  "scripts/tools.js",
]

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return

  // Pages: network first so a new deploy shows up immediately; cache is the offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE).then((cache) => cache.put("./", response.clone()))
          return response
        })
        .catch(() => caches.match("./"))
    )
    return
  }

  // Everything else: cache first, refreshed in the background
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true })
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone())
          return response
        })
        .catch(() => cached)
      return cached ?? network
    })
  )
})
