// ============================================================
// Service Worker — Daily Planner
// ⚠️  每次更新 index.html / manifest / icon 后，请递增 CACHE_VERSION。
//     activate 阶段会自动清除所有旧版本缓存。
//     localStorage 用户数据由主线程管理，本 SW 永远不接触，因此版本
//     升级 / 缓存清理对用户任务数据零影响。
// ============================================================
const CACHE_VERSION = 'v3';
const CACHE_NAME = `daily-planner-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(ASSETS).catch(err => console.warn('Cache addAll partial fail:', err))
    )
  );
  // 新 SW 立即接管，旧 SW 不再服务
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] 清理旧缓存:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // 通义千问 API：完全不走缓存
  if (url.includes('dashscope.aliyuncs.com')) return;

  // HTML / 导航请求：网络优先 — 在线时永远拿最新版本，离线回退缓存
  // 这样代码更新后用户下次访问立刻生效，不必等用户手动清缓存
  const isHTML = e.request.mode === 'navigate' ||
                 (e.request.method === 'GET' &&
                  (e.request.headers.get('accept') || '').includes('text/html'));

  if (isHTML) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 其它静态资源：缓存优先 + 后台静默刷新
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request)
        .then(resp => {
          if (resp && resp.status === 200 && e.request.method === 'GET') {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
