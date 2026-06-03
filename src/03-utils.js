function uid() {
  // 优先用 RFC 4122 v4 UUID，兼容 Supabase 的 uuid 列
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function isUuid(s) { return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s); }
// 基于种子的确定性 UUID（RFC-4122 v4 形状）：同一 seed 在任何设备都生成相同 id。
// 用于循环任务实例——让多设备对「同一模板 + 同一天」生成一致的 id，从而去重、
// 并让一台设备完成后另一台能按 id 正确归档/移除，避免已完成的循环任务重复出现。
function uidFromSeed(seed) {
  const s = String(seed);
  const bytes = new Array(16).fill(0);
  for (let i = 0; i < s.length; i++) {
    const idx = i % 16;
    let h = bytes[idx] ^ ((s.charCodeAt(i) + (i + 1) * 0x9e3779b1) & 0xffffffff);
    h ^= h << 13; h ^= h >>> 7; h ^= h << 17;   // xorshift 扰动，降低碰撞
    bytes[idx] = h & 0xff;
  }
  for (let round = 0; round < 2; round++) {      // 二次混合，缓解短种子分布不均
    for (let i = 0; i < 16; i++) {
      let h = bytes[i] ^ ((bytes[(i + 7) % 16] * 31 + i) & 0xffffffff);
      h ^= h << 5; h ^= h >>> 3;
      bytes[i] = h & 0xff;
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;           // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80;           // variant 10xx
  const hex = bytes.map(b => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0,4).join('')}-${hex.slice(4,6).join('')}-${hex.slice(6,8).join('')}-${hex.slice(8,10).join('')}-${hex.slice(10,16).join('')}`;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dateAdd(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function diffDays(a, b) {
  const da = new Date(a), db = new Date(b);
  return Math.round((db - da) / 86400000);
}
function weekday(dateStr) {
  return new Date(dateStr).getDay(); // 0 Sun ... 6 Sat
}
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const today = todayStr();
  if (dateStr === today) return '今天';
  if (dateStr === dateAdd(today, 1)) return '明天';
  if (dateStr === dateAdd(today, 2)) return '后天';
  if (dateStr === dateAdd(today, -1)) return '昨天';
  const d = new Date(dateStr);
  return `${d.getMonth()+1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`;
}
function fmtDur(min) {
  if (min == null) return '';
  if (min < 60) return `${min}分钟`;
  const h = Math.floor(min/60), m = min % 60;
  return m ? `${h}h${m}m` : `${h}h`;
}
function fmtTimer(ms) {
  const s = Math.floor(ms/1000);
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
// epoch ms ↔ <input type="datetime-local"> 值（YYYY-MM-DDTHH:MM，本地时区）
function msToLocalInput(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function localInputToMs(str) {
  if (!str) return null;
  const ms = new Date(str).getTime();   // "YYYY-MM-DDTHH:MM" 按本地时区解析
  return Number.isNaN(ms) ? null : ms;
}
/**
 * 数据持久化策略（重要）：
 * - 唯一的 localStorage 键是 'chronos_state'，由 saveState/loadState 管理。
 * - 代码更新（新版 index.html、新 SW 缓存版本）永远不会清空用户数据。
 * - 只有用户在「设置」点击「清空所有数据」按钮（带 confirm）才会删 key。
 * - 解析失败时，原始数据不会被覆盖：会另存为 chronos_state_corrupted_*
 *   作为应急备份，主键暂时回退到默认状态，便于用户继续使用。
 * - importData 也会先把现有数据备份到 chronos_state_backup_* 再覆盖。
 */
// 计时字段补齐：老版本数据可能缺 timerState/timerStart/timerPaused，
// 导致 taskCardHTML 里 `t.timerState === 'idle'` 判定失败 → 不显示播放按钮
function normalizeTaskTimer(t, isDoneArr) {
  if (t.timerState !== 'running' && t.timerState !== 'paused' && t.timerState !== 'done') {
    t.timerState = isDoneArr ? 'done' : (t.durActual != null ? 'done' : 'idle');
  }
  if (t.timerStart === undefined) t.timerStart = null;
  if (t.timerPaused === undefined) t.timerPaused = 0;
  // 计时段补齐：老版本数据无 segments，按旧 timer 字段合成，保证跨设备同步与日历显示有真相源
  if (!Array.isArray(t.segments)) {
    if (t.timerState === 'running' && t.timerStart) {
      t.segments = [{ s: t.timerStart, e: null }];
    } else if (t.timerState === 'paused' && t.timerPaused > 0) {
      const now = Date.now();
      t.segments = [{ s: now - t.timerPaused, e: now }];  // 保留时长，墙钟近似
    } else {
      t.segments = [];  // 其它（含历史 done）无实际段 → 日历退回规划时间
    }
  }
}
function loadState() {
  let raw;
  try {
    raw = localStorage.getItem('chronos_state');
  } catch(e) {
    console.warn('[Chronos] localStorage 不可用，回退到内存模式', e);
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
  if (raw == null) return JSON.parse(JSON.stringify(DEFAULT_STATE));
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') throw new Error('state 不是对象');
    // 浅合并：新版本新增的字段自动获得默认值，已有用户数据完整保留
    const merged = { ...JSON.parse(JSON.stringify(DEFAULT_STATE)), ...s };
    if (Array.isArray(merged.tasks)) merged.tasks.forEach(t => normalizeTaskTimer(t, false));
    if (Array.isArray(merged.done)) merged.done.forEach(t => normalizeTaskTimer(t, true));
    if (Array.isArray(merged.archive)) merged.archive.forEach(t => normalizeTaskTimer(t, true));
    return merged;
  } catch(e) {
    console.error('[Chronos] chronos_state 解析失败，已备份到 chronos_state_corrupted_*', e);
    try {
      const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
      localStorage.setItem('chronos_state_corrupted_' + ts, raw);
    } catch(_) {}
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}
function saveState(opts) {
  try {
    localStorage.setItem('chronos_state', JSON.stringify(state));
  } catch(e) {
    console.error('[Chronos] saveState 失败（可能 localStorage 容量满或被禁用）', e);
  }
  // 触发云同步（debounce）；从云端回写时传 skipCloudSync 避免回环
  if (!(opts && opts.skipCloudSync)) {
    scheduleCloudSync();
  }
}

// state 在此初始化：loadState() 定义于本文件、DEFAULT_STATE 定义于 02-config-state.js，
// 此处两者都已就绪。（拆分为多个 <script> 后函数提升不跨文件，故不能在 02 中提前调用。）
state = loadState();

// 多对话存储初始化（loadChatConversations / makeConversation 依赖此处已就绪的 uid()）
;(function initChatStore() {
  const store = loadChatConversations();
  chatConversations = store.conversations;
  activeConvId = store.activeId;
  chatDeletedConvIds = store.deletedIds || [];
  chatHistory = getActiveConversation().messages;
})();

