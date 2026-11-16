/* Service worker：第一次開啟時將成個 App（連真人短片）存入快取，之後完全離線運行。
   改咗程式檔案，記得將 APP_VERSION 加一；短片清單變咗會自動更新。 */
importScripts('media/media.js');                       // 提供 MEDIA_IDS 同 MEDIA_VER
var APP_VERSION = 'v3';
var VERSION = 'gzj-' + APP_VERSION + '-' + self.MEDIA_VER;
var FILES = ['./', './index.html', './styles.css', './data.js', './engine.js', './anim.js', './app.js', './media/media.js',
  './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png']
  .concat(self.MEDIA_IDS.map(function (id) { return './media/' + id + '.mp4'; }));

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* iPhone 播片會用 Range 請求，要由快取切出相應一段、回覆 206 */
function ranged(req, res) {
  var m = /bytes=(\d+)-(\d*)/.exec(req.headers.get('range') || '');
  if (!m) return res;
  return res.arrayBuffer().then(function (buf) {
    var start = +m[1], end = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
    return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: {
      'Content-Type': res.headers.get('Content-Type') || 'video/mp4', 'Accept-Ranges': 'bytes',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + buf.byteLength, 'Content-Length': String(end - start + 1) } });
  });
}
/* 快取優先：有快取就即刻用，冇先上網攞 */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
    if (hit) return e.request.headers.has('range') ? ranged(e.request, hit) : hit;
    return fetch(e.request).catch(function () { return caches.match('./index.html'); });
  }));
});
