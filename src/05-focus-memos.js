function toast(msg, ms = 2000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function getApiKey() {
  const cfg = getAiConfig();
  return (cfg.apiKey && cfg.apiKey.trim()) ? cfg.apiKey.trim() : '';
}

/* ---------------- 今日专注 ---------------- */
function loadFocusPins() {
  let raw;
  try { raw = localStorage.getItem('snail_focus_pins'); } catch(_) { raw = null; }
  if (!raw) {
    focusPins = [];
    focusHintSeen = false; // 第一次进入 app，显示引导
    return;
  }
  focusHintSeen = true;
  try {
    const obj = JSON.parse(raw);
    if (obj && obj.date === todayStr() && Array.isArray(obj.pinnedIds)) {
      focusPins = obj.pinnedIds.slice(0, 3);
    } else {
      focusPins = []; // 跨日重置 pin，但 hintSeen 保持
    }
  } catch(_) {
    focusPins = [];
  }
}
function saveFocusPins() {
  try {
    localStorage.setItem('snail_focus_pins', JSON.stringify({
      date: todayStr(),
      pinnedIds: focusPins
    }));
    focusHintSeen = true;
  } catch(_) {}
}
function addToFocus(taskId) {
  if (focusPins.includes(taskId)) return;
  if (focusPins.length >= 3) { toast('今天已有3个专注任务，先完成一个吧 🐌'); return; }
  focusPins.push(taskId);
  saveFocusPins();
  render();
}
function removeFromFocus(taskId) {
  focusPins = focusPins.filter(id => id !== taskId);
  saveFocusPins();
  render();
}
function togglePin(taskId) {
  if (focusPins.includes(taskId)) removeFromFocus(taskId);
  else addToFocus(taskId);
}
function smartRecommendFocus() {
  const today = todayStr();
  const todayTasks = state.tasks.filter(t => t.date === today);
  if (todayTasks.length === 0) { toast('今天还没有任务'); return; }
  const order = { 'urgent-important': 0, 'urgent-unimportant': 1, 'important': 2, 'normal': 3 };
  const sorted = todayTasks.slice().sort((a, b) => {
    const pa = order[a.priority] ?? 9, pb = order[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    const ta = a.startTime || '~', tb = b.startTime || '~';
    return ta.localeCompare(tb);
  });
  focusPins = sorted.slice(0, 3).map(t => t.id);
  saveFocusPins();
  render();
  toast(`已为你挑选 ${focusPins.length} 件最值得专注的事`);
}

/* ---------------- 快速备忘（snail_memos） ---------------- */
let inputMode = 'task';        // 'task' | 'memo' —— 主输入框的当前模式
let memoCollapsed = false;     // 备忘块折叠状态（仅当前会话）
let memos = loadMemos();

function loadMemos() {
  let raw;
  try { raw = localStorage.getItem('snail_memos'); } catch(_) { raw = null; }
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch(_) { return []; }
}
function saveMemos() {
  try { localStorage.setItem('snail_memos', JSON.stringify(memos)); } catch(_) {}
}
function addMemo(content) {
  content = (content || '').trim();
  if (!content) return;
  memos.push({
    id: uid(),
    content,
    createdAt: Date.now(),
    pinned: false,
    archived: false
  });
  saveMemos();
  memoCollapsed = false;
  render();
  toast('已记一笔');
}
function togglePinMemo(id) {
  const m = memos.find(x => x.id === id);
  if (!m) return;
  m.pinned = !m.pinned;
  saveMemos();
  render();
}
function archiveMemo(id) {
  const m = memos.find(x => x.id === id);
  if (!m) return;
  m.archived = true;
  saveMemos();
  render();
  toast('已归档');
}
function memoToTask(id) {
  const m = memos.find(x => x.id === id);
  if (!m || m.archived) return;
  // 走原有任务创建流程；handleTextInput 会触发 render
  // 归档由用户手动决定（转为任务后可能仍想保留笔迹），不在这里自动归档
  handleTextInput(m.content);
}
function toggleMemoCollapsed() {
  memoCollapsed = !memoCollapsed;
  render();
}
function setInputMode(mode) {
  if (inputMode === mode) return;
  inputMode = mode;
  render();
  // 切换后聚焦输入框，保持输入手感
  setTimeout(() => {
    const el = document.getElementById('task-input');
    if (el) el.focus();
  }, 0);
}

function fmtMemoTs(ts) {
  const d = new Date(ts);
  const today = todayStr();
  const dStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const hm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  if (dStr === today) return hm;
  if (dStr === dateAdd(today, -1)) return `昨天 ${hm}`;
  return `${d.getMonth()+1}月${d.getDate()}日`;
}

function renderMemoBlock() {
  const active = memos.filter(m => !m.archived);
  if (active.length === 0) {
    // 没有任何活跃备忘时，整块不显示，避免占用视觉空间
    return '';
  }
  const sorted = active.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
  const collapsedCls = memoCollapsed ? ' collapsed' : '';
  return `
    <div class="memo-block${collapsedCls}">
      <div class="memo-head" onclick="toggleMemoCollapsed()">
        <h3 class="memo-title">备忘</h3>
        <div class="memo-head-right">
          <span>${active.length}</span>
          <span class="memo-fold">▾</span>
        </div>
      </div>
      <div class="memo-list">
        ${sorted.map(m => `
          <div class="memo-card${m.pinned ? ' pinned' : ''}">
            <div class="memo-ts">${m.pinned ? '<span class="memo-pin-mark">●</span>' : ''}${fmtMemoTs(m.createdAt)}</div>
            <div class="memo-content">${escapeHtml(m.content)}</div>
            <div class="memo-actions">
              <button class="memo-action-btn${m.pinned ? ' pinned' : ''}" onclick="togglePinMemo('${m.id}')" title="${m.pinned ? '取消置顶' : '置顶'}">${m.pinned ? '★' : '☆'}</button>
              <button class="memo-action-btn" onclick="memoToTask('${m.id}')" title="转为任务">→ 任务</button>
              <button class="memo-action-btn" onclick="archiveMemo('${m.id}')" title="归档">归档</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderFocusBlock() {
  const today = todayStr();
  const todayAll = [...state.tasks, ...state.done].filter(t => t.date === today);
  // pinnedIds 按 focusPins 顺序解析为真实 task 对象，过滤掉已经不存在的
  const pinnedTasks = focusPins.map(id => todayAll.find(t => t.id === id)).filter(Boolean);
  // 清理已不存在的 id（如被删除）
  if (pinnedTasks.length !== focusPins.length) {
    focusPins = pinnedTasks.map(t => t.id);
    saveFocusPins();
  }
  const empty = pinnedTasks.length === 0;
  const showHint = !focusHintSeen && empty;

  return `
    <div class="focus-block">
      <div class="focus-head">
        <h3 class="focus-title">今日专注</h3>
        ${pinnedTasks.length > 0 ? `<span class="focus-count">${pinnedTasks.length}/3</span>` : ''}
      </div>
      ${empty ? `
        <div class="focus-empty">
          <div class="focus-empty-text">今天想专注什么？</div>
          <button class="focus-smart-btn" onclick="smartRecommendFocus()">✦ 智能推荐</button>
        </div>
      ` : pinnedTasks.map(t => focusCardHTML(t)).join('')}
      ${showHint ? `<div class="focus-hint">每天选 3 件最重要的事，其余的慢慢来 🐌</div>` : ''}
    </div>
  `;
}

function focusCardHTML(t) {
  // 复用 taskCardHTML，注入 📌 取消按钮到 task-actions 开头
  const html = taskCardHTML(t);
  return html.replace(
    '<div class="task-actions" onclick="event.stopPropagation()">',
    `<div class="task-actions" onclick="event.stopPropagation()"><button class="icon-btn pin-active" onclick="removeFromFocus('${t.id}')" title="取消今日专注">📌</button>`
  );
}

/* ============================================================
 * Supabase 云同步层
 * ============================================================ */
