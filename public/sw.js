/*
 * Service worker for the MEEDO Admin Console.
 *
 * It exists so Windows and Edge will install the console as a desktop app —
 * that requires a worker with a fetch handler — and it deliberately does
 * nothing else. Every request goes straight to the network, nothing is cached.
 *
 * That is the point. Caching an app shell would mean a machine could keep
 * running last week's console against this week's records, which for billing
 * is worse than not loading at all. The records live in Firestore, which has
 * its own offline handling, so there is nothing for a cache here to add.
 */

self.addEventListener("install", () => {
  // Replace any previous worker immediately rather than waiting for every
  // window to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Clear anything an earlier version of this worker may have cached.
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", () => {
  // No respondWith: the browser handles it exactly as it would without a
  // worker. Present only because installability requires a fetch handler.
});
