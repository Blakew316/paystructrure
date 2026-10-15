/**
 * Service worker for the WPI Agent Pay home-screen app.
 *
 * Pages and team files are network-first so agents always get the current
 * plan when online, with the cached copy as an offline fallback. Static
 * assets are cache-first. Bump VERSION whenever any cached file changes.
 */
'use strict';

const VERSION = 'wpi-pay-v5';
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/config.js',
  'js/calc.js',
  'js/app.js',
  'assets/logo.png',
  'assets/mark.png',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // fonts etc. go straight to the network

  const networkFirst = req.mode === 'navigate' || url.pathname.includes('/teams/');
  if (networkFirst) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then(cache => cache.put(req.mode === 'navigate' ? 'index.html' : req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req.mode === 'navigate' ? 'index.html' : req, { ignoreSearch: req.mode === 'navigate' }))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && !url.pathname.endsWith('.pdf')) {
        const copy = res.clone();
        caches.open(VERSION).then(cache => cache.put(req, copy));
      }
      return res;
    }))
  );
});
