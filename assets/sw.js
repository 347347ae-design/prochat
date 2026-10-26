/* ProChat Service Worker
 *
 * 只缓存应用外壳（HTML / JS / CSS / 图标 / KaTeX），让「添加到主屏幕」后能秒开。
 * 聊天内容一律不缓存——所有消息本来就不经过服务器。
 *
 * 策略：
 *   - 页面导航、JS、CSS：先走网络，失败再回退缓存（保证更新及时）
 *   - 图标、字体等静态资源：先给缓存，同时后台更新
 */
var CACHE = 'prochat-1.2.7';
var SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './web.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './katex/katex.min.css',
  './katex/katex.min.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 单个资源失败不影响整体安装
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

function isShellAsset(url) {
  return /\.(js|css|html|webmanifest)$/i.test(url.pathname) ||
    url.pathname.slice(-1) === '/';
}

function isStatic(url) {
  return /\.(png|jpg|jpeg|svg|woff2?|ttf|otf|ico)$/i.test(url.pathname);
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 只处理同源资源；模型接口、留言板等一律直连，不经过缓存
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate' || isShellAsset(url)) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
    return;
  }

  if (isStatic(url)) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      })
    );
  }
});
