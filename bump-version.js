#!/usr/bin/env node
/**
 * bump-version.js
 *
 * 把 sw.js 顶部的 CACHE_VERSION 替换为当前 UTC 时间戳。
 * 每次 push / 部署前先跑一次：
 *
 *   node bump-version.js
 *   # 或
 *   npm run bump
 *
 * 这样确保每次代码更新后 SW 缓存名 daily-planner-${CACHE_VERSION} 必然变化，
 * 浏览器一定会安装新 SW、清除旧缓存、触发 controllerchange → 自动刷新。
 */
const fs = require('fs');
const path = require('path');

const swPath = path.join(__dirname, 'sw.js');
const src = fs.readFileSync(swPath, 'utf8');

const d = new Date();
const pad = n => String(n).padStart(2, '0');
const ts = `${d.getUTCFullYear()}.${pad(d.getUTCMonth()+1)}.${pad(d.getUTCDate())}.${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

const replaced = src.replace(
  /const\s+CACHE_VERSION\s*=\s*['"][^'"]+['"]\s*;/,
  `const CACHE_VERSION = '${ts}';`
);

if (replaced === src) {
  console.error('❌ 未找到 CACHE_VERSION 行，请检查 sw.js 顶部');
  process.exit(1);
}

fs.writeFileSync(swPath, replaced);
console.log(`✅ sw.js CACHE_VERSION 已更新为: ${ts}`);
