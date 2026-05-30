# CLAUDE.md

Snail —— 个人时间管理 PWA，纯前端单页应用 + 一个 Cloudflare Worker 后端。

## 架构速览

- 前端：根目录 `index.html` + `src/01..16-*.js`（按职责拆分的「经典脚本」，共享同一全局作用域，按 `index.html` 里的顺序依次同步执行；函数提升**不跨**文件边界）+ `styles.css`。
- 数据：localStorage 单键 `chronos_state`（见 `src/03-utils.js` 的 saveState/loadState），登录后通过 Supabase 跨设备同步（`src/06-cloud-auth.js`）。
- 后端：`snail-api/`（Cloudflare Worker），提供 AI 代理与 iCal 日历订阅。手动部署：`cd snail-api && npx wrangler deploy`。
- PWA 缓存：`sw.js` 的 `CACHE_VERSION` 由 `node bump-version.js`（或 `npm run bump`）在部署前自动注入时间戳，与下面的应用版本号是两回事。

## 版本号约定（重要）

应用版本号是 semver，**唯一展示源**是 `src/02-config-state.js` 里的 `const APP_VERSION`，展示在设置页「关于」区块。

**每次创建新的 PR，都要递增版本号：**

1. 改 `src/02-config-state.js` 的 `APP_VERSION`。
2. 同步改 `package.json` 的 `version`，保持两者一致。
3. 递增规则（semver）：修 bug → patch（`x.y.Z`）；加功能 → minor（`x.Y.0`）；破坏性改动 → major（`X.0.0`）。

> 注意：`APP_VERSION` 是给人看的应用版本；`sw.js` 的 `CACHE_VERSION` 是部署时自动生成的缓存时间戳，二者独立，不要混用。
