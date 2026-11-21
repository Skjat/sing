// Офлайн-режим: приложение открывается без сети, свежая версия берётся из сети, когда она есть.

const CACHE = 'golos-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/audio.js', 'js/claude.js', 'js/curriculum.js', 'js/music.js', 'js/pitch.js',
  'js/roll.js', 'js/runner.js', 'js/scoring.js', 'js/songparse.js', 'js/store.js', 'js/timeline.js', 'js/tips.js', 'js/ui.js',
  'js/views/onboarding.js', 'js/views/plan.js', 'js/views/progress.js', 'js/views/session.js',
  'js/views/settings.js', 'js/views/songs.js', 'js/views/teacher.js', 'js/views/today.js',
  'vendor/anthropic-sdk.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Запросы к API и любые чужие адреса не трогаем.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await Promise.race([
        fetch(req),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500)),
      ]);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch {
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
