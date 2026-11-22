/* MOTO // GARAGE — Service Worker
   离线可用：预缓存应用外壳，导航离线回退 index.html。
   策略：同源静态资源「缓存优先 + 后台更新」；跨域 API/图片直接放行不缓存。
   用户数据（localStorage / IndexedDB）由应用自行管理，SW 不介入。
   更新版本号 CACHE_VER 即可让所有客户端拉取新版本。 */
'use strict';

var CACHE_VER = 'moto-garage-v12';
var SHELL = [
  './', './index.html', './manifest.json', './robots.txt', './sitemap.xml',
  './theme.css', './layout.css', './modules.css', './appearance.css', './ride.css', './fuel-board.css', './pwa.css', './legibility.css',
  './config.js', './appearance.js', './ui.js', './store.js', './cloud.js',
  './wallpaper.js', './notes.js', './fuel-board.js', './links.js', './media.js',
  './weather.js', './routes.js', './pwa.js', './nav.js', './app.js',
  './favicon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'
];

/* 安装：预缓存应用外壳。单个文件失败不影响其余，保证安装流程不中断 */
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_VER).then(function (cache) {
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

/* 激活：清理旧版本缓存，接管已打开页面 */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('moto-garage-') === 0 && k !== CACHE_VER; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isShellRequest(url, req) {
  if (url.origin !== self.location.origin) return false;
  if (req.mode === 'navigate') return true;
  var p = url.pathname.toLowerCase();
  if (/\.(css|js|html|png|svg|ico|webmanifest|json)$/.test(p)) return true;
  return p === '/' || p.indexOf('/#/') > -1;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  /* 跨域（天气 / 油价 / 图床 / 云端 SDK）不缓存，直接放行 */
  if (url.origin !== self.location.origin) return;

  /* 导航：网络优先，离线时回退缓存的 index.html —— 保证离线打开不白屏 */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_VER).then(function (c) { c.put('./index.html', copy); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || new Response('离线不可用：请先联网打开一次本站以缓存应用。', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
    );
    return;
  }

  /* 同源静态资源：缓存优先，后台静默更新（stale-while-revalidate） */
  if (isShellRequest(url, req)) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        var network = fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE_VER).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return hit || Response.error(); });
        return hit || network;
      })
    );
  }
});

/* 允许页面主动触发更新检查 */
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
