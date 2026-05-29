function uid() {
  // 优先用 RFC 4122 v4 UUID，兼容 Supabase 的 uuid 列
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function isUuid(s) { return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s); }
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

