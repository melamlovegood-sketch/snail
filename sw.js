// ============================================================
// Service Worker — Daily Planner
//
// 用户无感更新流程：
//   1. 修改任何静态资源后，把 CACHE_VERSION 改成新日期串
//      （部署脚本里可以 sed 替换 __BUILD_TIME__，手动改也行）
//   2. push 到仓库
//   3. 用户下次打开 app：
//      新 SW 自动 install → skipWaiting → activate
//      → 清掉所有旧版本缓存 → clients.claim() 接管页面
//      → 主线程监听到 controllerchange → 静默刷新一次
//      → 用户看到新版本，localStorage 完全保留
//
// 缓存策略：全量 Network First
//   先尝试网络，失败回退缓存。在线时永远最新，离线时退化到上次缓存的内容。
// ============================================================
const CACHE_VERSION = '2026.05.27.2';
const CACHE_NAME = `daily-planner-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'
];

self.addEventListener('install', e => {
  // 预缓存失败不阻塞激活，下次 fetch 会自动补回
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(PRECACHE).catch(err => console.warn('[SW] precache partial fail:', err))
    )
  );
  // 新 SW 立即跳过 waiting 进入 activate
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys.filter(k => k !== CACHE_NAME).map(k => {
            console.log('[SW] 清理旧缓存:', k);
            return caches.delete(k);
          })
        )
      )
      .then(() => self.clients.claim())  // 立即接管现有页面，触发 controllerchange
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // 通义千问 API：完全不走 SW
  if (url.includes('dashscope.aliyuncs.com')) return;

  // 非 GET 请求不缓存
  if (e.request.method !== 'GET') return;

  // Network First：先网络后缓存
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        // 只缓存成功的 200 响应（不缓存 opaque/3xx/4xx/5xx）
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
