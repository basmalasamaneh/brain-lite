import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

// All PWA URLs, including the service worker's scope, stay within the Vite mount.
const appBase = `/${basePath.replace(/^\/+|\/+$/g, '')}${basePath === '/' ? '' : '/'}`;

function brainLitePwa(): Plugin {
  return {
    name: 'brain-lite-pwa',
    apply: 'build',
    generateBundle(_options, bundle) {
      // Only Vite's content-hashed JS/CSS assets. No HTML, API responses, uploads,
      // audio, external resources, or unversioned files are stored by the worker.
      const staticAssets = Object.keys(bundle).filter((name) =>
        /^assets\/[^/]+-[a-zA-Z0-9_-]{8,}\.(?:js|css)$/.test(name)
      ).map((name) => appBase + name);
      const manifest = {
        name: 'Brain Lite',
        short_name: 'Brain Lite',
        description: "A calm place for life's scattered details.",
        start_url: appBase,
        scope: appBase,
        display: 'standalone',
        background_color: '#FBF8F1',
        theme_color: '#0D0C0A',
        icons: [
          { src: `${appBase}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: `${appBase}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      };
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifest) });
      const offline = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0D0C0A"><title>Brain Lite · Offline</title><style>body{box-sizing:border-box;min-height:100vh;min-height:100dvh;margin:0;padding:calc(2rem + env(safe-area-inset-top)) 1.5rem calc(2rem + env(safe-area-inset-bottom));display:grid;place-items:center;background:#FBF8F1;color:#1F1A10;font:16px/1.6 system-ui,sans-serif}main{max-width:28rem;text-align:center;border:1px solid #E8DFC8;background:#fff;border-radius:1.5rem;padding:2rem;box-shadow:0 12px 32px -16px #8A6A1E55}h1{font-size:1.5rem;margin:.5rem 0;color:#8A6A1E}p{margin:1rem 0}button{min-height:44px;padding:.65rem 1.5rem;border:0;border-radius:.75rem;background:#D4AF37;color:#1F1A10;font:inherit;font-weight:600;cursor:pointer}</style></head><body><main><h1>Brain Lite</h1><p>You're offline. Your personal memories aren't available offline. Reconnect to continue.</p><p dir="rtl" lang="ar">أنت غير متصل بالإنترنت. ذكرياتك الشخصية غير متاحة دون اتصال. اتصل بالإنترنت للمتابعة.</p><button onclick="location.reload()">Retry · إعادة المحاولة</button></main></body></html>`;
      this.emitFile({ type: 'asset', fileName: 'offline.html', source: offline });
      // The worker is generated on every build so its version tracks the exact bundle.
      // It never caches document responses, even when signed in.
      const worker = `
const BASE = ${JSON.stringify(appBase)};
const ASSETS = ${JSON.stringify(staticAssets)};
const OFFLINE = BASE + 'offline.html';
const CACHE = 'brain-lite-static:' + BASE + ':' + ${JSON.stringify(staticAssets.join('|'))};
const URLS = new Set(ASSETS.map(path => new URL(path, self.location.origin).href));
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const path of [...ASSETS, OFFLINE]) {
      const url = new URL(path, self.location.origin);
      const response = await fetch(new Request(url, { credentials: 'omit', cache: 'reload' }));
      if (!response.ok || response.redirected || response.url !== url.href ||
          response.type !== 'basic' || /private|no-store/i.test(response.headers.get('cache-control') || '')) {
        throw new Error('Static precache unavailable: ' + path);
      }
      await cache.put(url.href, response);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('brain-lite-static:' + BASE + ':') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () =>
       (await (await caches.open(CACHE)).match(OFFLINE)) ||
      new Response('Offline · غير متصل بالإنترنت', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    ));
    return;
  }
  if (URLS.has(url.href) && !url.search && request.destination !== 'document') {
    event.respondWith(caches.open(CACHE).then(async cache =>
      (await cache.match(url.href)) || fetch(request)
    ));
  }
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker });
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    brainLitePwa(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
