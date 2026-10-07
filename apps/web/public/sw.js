// Minimal service worker: makes the app installable and keeps the shell available briefly offline.
// API calls and documents are never cached (always live data).
const CACHE = "petrapms-shell-v1";
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/")) return;
  if (u.pathname.startsWith("/_next/static/") || u.pathname.startsWith("/fonts/")) {
    e.respondWith(caches.open(CACHE).then(async (c) => { const hit = await c.match(e.request); if (hit) return hit; const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r; }));
  }
});
