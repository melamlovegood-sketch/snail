// ============================================================
// Service Worker — Snail
//
// 部署流程：
//   1. 修改任何文件
//   2. `node bump-version.js` 或 `npm run bump` 把 CACHE_VERSION 自动改成当前时间戳
//   3. push 到仓库
//   4. 用户下次打开 app：新 SW 自动 install + skipWaiting + activate
//      → 清除所有旧缓存 → controllerchange → 主线程自动 reload
//      → 看到最新版本，localStorage 完全保留
//
// 缓存策略：
//   - index.html / 导航请求：永远从网络拿，不读不写缓存（彻底杜绝 stale HTML）
//   - 其它静态资源：Network First — 先网络拿最新，失败回退缓存（离线兜底）
//   - 通义千问 API：完全不走 SW，直通
// ============================================================
const CACHE_VERSION = '2026.05.29.120317';  // ← 由 bump-version.js 自动注入
const CACHE_NAME = `snail-${CACHE_VERSION}`;

self.addEventListener('install', e => {
  // 立即跳过 waiting 进入 activate，不等待现有 SW 闲下来
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          // 清除所有非当前版本的缓存（旧版本痕迹一律清掉）
          keys.filter(k => k !== CACHE_NAME).map(k => {
            console.log('[SW] 清理旧缓存:', k);
            return caches.delete(k);
          })
        )
      )
      .then(() => self.clients.claim())  // 立即接管现有页面 → 触发 controllerchange
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // 通义千问 API：完全直通
  if (url.includes('dashscope.aliyuncs.com')) return;

  // Supabase：REST/Realtime/Auth 全部直通，绝不缓存
  if (url.includes('supabase.co')) return;

  // 非 GET 请求一律不缓存
  if (e.request.method !== 'GET') return;

  // 判断是否是 HTML / 导航请求
  const isHTML =
    e.request.mode === 'navigate' ||
    e.request.destination === 'document' ||
    /\/(index\.html)?(\?|$)/.test(new URL(url).pathname + (new URL(url).search || ''));

  // ============== HTML：永远从网络拿，绝不缓存 ==============
  if (isHTML) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(() =>
        // 仅在离线且没有任何缓存时返回简单兜底页（防止白屏）
        caches.match(e.request).then(c =>
          c || new Response(
            '<!doctype html><meta charset=utf-8><title>离线</title><style>body{font-family:-apple-system,sans-serif;padding:40px;text-align:center;color:#666}</style><h2>离线</h2><p>请检查网络后重试</p>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          )
        )
      )
    );
    return;
  }

  // ============== 其它资源：Network First + 离线缓存兜底 ==============
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
});
