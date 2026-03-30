// Service Worker for 꿈-드림 페스티벌 미래기술존
const CACHE_NAME = 'dreamfest-v3';

// Core app files to pre-cache
const CORE_ASSETS = [
  './',
  './index.html',
  './qr-checkin.html',
  './kiosk.html',
  './manifest.json',
  './sync-client.js',
  './certificates.html',
  './manual.html',
  './programs/01-ai-body-scanner.html',
  './programs/02-smart-fitness-trainer.html',
  './programs/03-dance-battle-ai.html',
  './programs/04-ai-vision-explorer.html',
  './programs/05-ai-safety-guardian.html',
  './programs/06-train-your-own-ai.html',
  './programs/07-my-ai-avatar.html',
  './programs/08-ai-music-video.html',
  './programs/09-prompt-art-challenge.html',
  './programs/10-ai-doctor.html',
  './programs/11-smart-farm.html',
  './programs/12-self-driving-sim.html',
  './programs/13-ai-career-matcher.html',
  './programs/14-visual-coding-lab.html',
  './programs/15-tech-mentor-talk.html',
  './icons/icon.svg',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
];

// CDN resources to cache on first use
const CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com'
];

// Install: pre-cache core assets
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Pre-caching core assets');
      return cache.addAll(CORE_ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// Activate: clean old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(name) {
          return name !== CACHE_NAME;
        }).map(function(name) {
          console.log('[SW] Deleting old cache:', name);
          return caches.delete(name);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch strategy: Network First for HTML, Cache First for CDN assets
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and other non-http(s) schemes
  if (!url.protocol.startsWith('http')) return;

  // CDN resources: Cache First (fonts, libraries rarely change)
  var isCDN = CDN_HOSTS.some(function(host) { return url.hostname === host; });
  if (isCDN) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(function() {
          return new Response('', { status: 503, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // Local resources: Network First with cache fallback
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request).then(function(cached) {
          if (cached) return cached;
          // Fallback for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
    );
    return;
  }
});

// Handle messages from clients
self.addEventListener('message', function(event) {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'getCacheSize') {
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.keys();
    }).then(function(keys) {
      event.source.postMessage({ type: 'cacheSize', count: keys.length });
    });
  }
});
