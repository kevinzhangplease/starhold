// Runs AFTER `vite build` (see package.json's `build:pwa` script). Vite's production build
// emits content-hashed filenames (index-XXXXXXXX.js etc.) that change every build, so the
// service worker can't be hand-written with a static file list — this scans the real dist/
// output and generates one, stamped with a version derived from the build's own content so
// every build is a genuinely new SW version (old caches get cleaned up on activate).
import { readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { createHash } from 'crypto';

const distDir = join(process.cwd(), 'dist');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function run() {
  const files = walk(distDir);
  // precache every emitted asset except the service worker itself and any source maps
  // (maps are large and only needed for debugging, not for offline play)
  const urls = files
    .filter(f => !f.endsWith('.map') && !f.endsWith('sw.js'))
    .map(f => '/' + relative(distDir, f).split(sep).join('/'));

  // version = short hash of the combined asset list + sizes, so it changes iff the actual
  // build output changed (not just because the script ran again)
  const hash = createHash('sha256');
  for (const f of files) {
    if (f.endsWith('.map') || f.endsWith('sw.js')) continue;
    hash.update(f);
    hash.update(String(statSync(f).size));
  }
  const version = hash.digest('hex').slice(0, 10);

  const swSource = `// AUTO-GENERATED at build time by build-tools/gen-sw.ts — do not edit directly.
const VERSION = ${JSON.stringify(version)};
const CACHE = 'starhold-' + VERSION;
const PRECACHE_URLS = ${JSON.stringify(urls, null, 2)};

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Cache-first: serve from cache when available (instant, works offline), fall back to the
// network and quietly backfill the cache for next time. Never intercepts cross-origin
// requests (fonts, etc.) — those pass straight through to the network as normal.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
`;

  writeFileSync(join(distDir, 'sw.js'), swSource);
  console.log(`Service worker written: dist/sw.js (version ${version}, ${urls.length} precached files)`);
}

run();
