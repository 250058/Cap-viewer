/* Service worker: offline app shell + receives files shared to the installed app. */
const VERSION = 'cap-viewer-v4';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/zip.js',
  './js/cap.js',
  './js/richtext.js',
  './js/util.js',
  './js/chart.js',
  './js/widgets.js',
  './js/pdf.js',
  './vendor/html2canvas.min.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/favicon.svg',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './examples/demo.cap',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'cap-viewer-share').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Android share sheet -> POST multipart to ./share-target
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      try {
        const form = await req.formData();
        const file = form.get('file');
        if (file && typeof file !== 'string') {
          const cache = await caches.open('cap-viewer-share');
          await cache.put('shared-file', new Response(file, {
            headers: { 'X-File-Name': encodeURIComponent(file.name || 'shared.cap') },
          }));
        }
      } catch (e) {
        // fall through to the app; it will show the start screen
      }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }

  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Stale-while-revalidate: fast + offline, and picks up new versions on the next visit.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    const network = fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      })
      .catch(() => null);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    const res = await network;
    if (res) return res;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('offline', { status: 503, statusText: 'offline' });
  })());
});
