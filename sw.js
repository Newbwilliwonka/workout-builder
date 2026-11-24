/* Pass-through worker. It does not cache and does not answer fetches,
   so Supabase and the Bunny CDN keep using the browser's own network path. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', function () {});
