function isDeferEligible(t) {
  if (!t) return false;
  if (t.isRecur) return false;
  if (t.timerState === 'done') return false;
  if (t.date !== todayStr()) return false;
  return true;
}

/* 计算下周一日期（如果今天就是周一，则跳到下一个周一） */
function nextMondayDate() {
  const today = todayStr();
  const wd = new Date(today).getDay(); // 0=Sun..6=Sat
  let days = (1 - wd + 7) % 7;
  if (days === 0) days = 7;
  return dateAdd(today, days);
}

/* 把目标 key 转成日期串 */
function deferTargetToDate(target) {
  const today = todayStr();
  if (target === 'tomorrow') return dateAdd(today, 1);
  if (target === 'dayAfter') return dateAdd(today, 2);
  if (target === 'nextMonday') return nextMondayDate();
  return null;
}

/* 当前展开的 swipe-wrap，全局唯一 */
let _activeSwipeWrap = null;

function closeActiveSwipe() {
  if (!_activeSwipeWrap) return;
  const card = _activeSwipeWrap.querySelector('.task-card');
  if (card) card.style.transform = '';
  _activeSwipeWrap.classList.remove('swipe-open');
  _activeSwipeWrap = null;
}

/* ===== 左滑手势：文档级事件委托，touch + mouse 都走同一套状态机 =====
 * 关键设计：
 *  1) 委托在 document 上 → 今日页 / 计划页 / 专注块的卡片统一生效
 *  2) 阈值 10px：水平位移超 10px 才锁定为"滑动"，避免轻微移动吞掉点击
 *  3) touchmove 在锁定为水平后 preventDefault → 阻止页面滚动
 *  4) 鼠标真实拖动后吞掉紧跟着的 click → 防止误触发卡片详情/按钮
 */
const SWIPE_THRESHOLD = 10;
let _swipe = null;          // { wrap, card, actions, startX, startY, dx, dy, lockedAxis, actionsWidth, cardWidth, baseTx }
let _swallowNextClick = false;

function _findSwipeWrap(target) {
  if (!target || !target.closest) return null;
  // 不接管点在 swipe-actions 按钮上的事件（让按钮自己处理 onclick）
  if (target.closest('.swipe-actions')) return null;
  return target.closest('.swipe-wrap');
}

function _swipeStart(clientX, clientY, wrap) {
  const card = wrap.querySelector('.task-card');
  const actions = wrap.querySelector('.swipe-actions');
  if (!card || !actions) return null;
  if (_activeSwipeWrap && _activeSwipeWrap !== wrap) closeActiveSwipe();
  const actionsWidth = actions.getBoundingClientRect().width || 200;
  const wasOpen = wrap.classList.contains('swipe-open');
  return {
    wrap, card, actions,
    startX: clientX, startY: clientY,
    dx: 0, dy: 0,
    lockedAxis: null,
    actionsWidth,
    cardWidth: card.getBoundingClientRect().width || 300,
    baseTx: wasOpen ? -actionsWidth : 0,
    wasOpen,
  };
}

function _swipeMove(clientX, clientY, e) {
  if (!_swipe) return;
  _swipe.dx = clientX - _swipe.startX;
  _swipe.dy = clientY - _swipe.startY;
  if (_swipe.lockedAxis == null) {
    if (Math.abs(_swipe.dx) > SWIPE_THRESHOLD || Math.abs(_swipe.dy) > SWIPE_THRESHOLD) {
      _swipe.lockedAxis = Math.abs(_swipe.dx) > Math.abs(_swipe.dy) ? 'x' : 'y';
      if (_swipe.lockedAxis === 'x') _swipe.wrap.classList.add('swiping');
    }
  }
  if (_swipe.lockedAxis === 'x') {
    if (e && e.cancelable) e.preventDefault();
    let tx = _swipe.baseTx + _swipe.dx;
    tx = Math.min(0, Math.max(tx, -_swipe.actionsWidth - 20));
    _swipe.card.style.transform = `translateX(${tx}px)`;
  }
}

function _swipeEnd() {
  if (!_swipe) return;
  const s = _swipe;
  s.wrap.classList.remove('swiping');
  if (s.lockedAxis === 'x') {
    const finalTx = s.baseTx + s.dx;
    const openThreshold = s.cardWidth / 3;
    if (-finalTx > openThreshold) {
      s.card.style.transform = `translateX(${-s.actionsWidth}px)`;
      s.wrap.classList.add('swipe-open');
      _activeSwipeWrap = s.wrap;
    } else {
      s.card.style.transform = '';
      s.wrap.classList.remove('swipe-open');
      if (_activeSwipeWrap === s.wrap) _activeSwipeWrap = null;
    }
    // 锁定过水平 → 真实滑动，吞掉紧随其后的 click（鼠标用得着；触屏 preventDefault 已抑制）
    _swallowNextClick = true;
  } else if (s.wasOpen && Math.abs(s.dx) <= SWIPE_THRESHOLD && Math.abs(s.dy) <= SWIPE_THRESHOLD) {
    // 在已展开的卡片可见区域上轻点 → 收起，吞掉这次 click（避免误开详情）
    s.card.style.transform = '';
    s.wrap.classList.remove('swipe-open');
    if (_activeSwipeWrap === s.wrap) _activeSwipeWrap = null;
    _swallowNextClick = true;
  }
  _swipe = null;
}

/* Touch */
document.addEventListener('touchstart', e => {
  const wrap = _findSwipeWrap(e.target);
  if (!wrap) return;
  const t = e.touches[0];
  _swipe = _swipeStart(t.clientX, t.clientY, wrap);
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (!_swipe) return;
  const t = e.touches[0];
  _swipeMove(t.clientX, t.clientY, e);
}, { passive: false });

document.addEventListener('touchend', () => { _swipeEnd(); });
document.addEventListener('touchcancel', () => { _swipeEnd(); });

/* Mouse（桌面） */
document.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const wrap = _findSwipeWrap(e.target);
  if (!wrap) return;
  _swipe = _swipeStart(e.clientX, e.clientY, wrap);
});

document.addEventListener('mousemove', e => {
  if (!_swipe) return;
  _swipeMove(e.clientX, e.clientY, e);
});

document.addEventListener('mouseup', () => {
  _swipeEnd();
});

/* 点击：捕获阶段优先 — 如果刚发生过真实滑动则吞掉，否则放行；同时关闭已展开的其他卡片 */
document.addEventListener('click', e => {
  if (_swallowNextClick) {
    _swallowNextClick = false;
    e.stopPropagation();
    e.preventDefault();
    return;
  }
  if (_activeSwipeWrap && !_activeSwipeWrap.contains(e.target)) {
    closeActiveSwipe();
  }
}, true);

/* 点击滑出按钮 */
function onSwipeActionClick(e, taskId, target) {
  if (e) e.stopPropagation();
  closeActiveSwipe();
  deferSingleTask(taskId, target);
}

/* 单个推迟：处理规则 + 紧急确认 + DDL 守门 */
function deferSingleTask(taskId, target) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t) return;
  if (t.isRecur) { toast('循环任务不可推迟'); return; }

  const today = todayStr();
  if (t.deadline) {
    const dd = diffDays(today, t.deadline);
    if (dd <= 1) {
      if (navigator.vibrate) try { navigator.vibrate(30); } catch(_) {}
      toast('明天就截止了，来不及了 🐌');
      return;
    }
  }

  if (t.priority === 'urgent-important') {
    showDeferUrgentConfirm(t, target);
    return;
  }

  performDefer(t, target);
}

/* 紧急+重要任务推迟前的确认 */
function showDeferUrgentConfirm(t, target) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal defer-modal" role="dialog">
      <h2>这个任务很重要，确定推迟吗？</h2>
      <div class="defer-body">${escapeHtml(t.desc)}</div>
      <div class="defer-actions">
        <button type="button" class="defer-btn defer-btn-ghost" data-act="cancel">取消</button>
        <button type="button" class="defer-btn defer-btn-primary" data-act="ok">确定推迟</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.querySelector('[data-act="cancel"]').onclick = () => backdrop.remove();
  backdrop.querySelector('[data-act="ok"]').onclick = () => {
    backdrop.remove();
    performDefer(t, target);
  };
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
}

/* 真正执行推迟：修改日期 + rolloverCount +1 + 触发承认现实弹窗（如适用） */
function performDefer(t, target) {
  const newDate = deferTargetToDate(target);
  if (!newDate) return;
  if (!t.originalDate) t.originalDate = t.date;
  t.date = newDate;
  t.rolloverCount = (t.rolloverCount || 0) + 1;
  t.rollover = true;
  saveState();

  // rolloverCount 刚变为 3：弹出「也许现在不是时候」（仅一次）
  if (t.rolloverCount === 3 && !t.realityCheckShown) {
    t.realityCheckShown = true;
    saveState();
    render();
    showRealityCheck(t.id);
    return;
  }

  render();
  toast(`已推迟到${fmtDate(newDate)}`);
}

/* 批量推迟：今天先到这里 */
async function openBatchDeferPanel() {
  const today = todayStr();
  const candidates = state.tasks.filter(t => isDeferEligible(t));
  const moveList = [];
  const keepList = [];
  candidates.forEach(t => {
    if (t.priority === 'urgent-important') { keepList.push(t); return; }
    if (t.deadline) {
      const dd = diffDays(today, t.deadline);
      if (dd <= 3) { keepList.push(t); return; }
    }
    moveList.push(t);
  });

  if (moveList.length === 0) {
    toast('没有可以推迟的任务');
    return;
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const keepListHTML = keepList.length > 0
    ? `<div class="defer-urgent-list">${keepList.map(t => `<div class="item">· ${escapeHtml(t.desc)}</div>`).join('')}</div>`
    : '';
  backdrop.innerHTML = `
    <div class="modal defer-modal" role="dialog">
      <h2>今天先到这里</h2>
      <div class="defer-body">
        ${moveList.length} 件任务将移到明天<br>
        ${keepList.length} 件紧急任务将留下
      </div>
      ${keepListHTML}
      <div class="defer-ai-line" id="defer-ai-line">…</div>
      <div class="defer-actions">
        <button type="button" class="defer-btn defer-btn-ghost" data-act="cancel">再想想</button>
        <button type="button" class="defer-btn defer-btn-primary" data-act="ok">移到明天</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.querySelector('[data-act="cancel"]').onclick = () => backdrop.remove();
  backdrop.querySelector('[data-act="ok"]').onclick = () => {
    backdrop.remove();
    performBatchDefer(moveList);
  };
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

  // 异步拉取 AI 一句话（失败时静默显示一个本地回退句子）
  fetchBatchDeferAILine().then(line => {
    const el = backdrop.querySelector('#defer-ai-line');
    if (el) el.textContent = line;
  }).catch(() => {
    const el = backdrop.querySelector('#defer-ai-line');
    if (el) el.textContent = '';
  });
}

function performBatchDefer(moveList) {
  const tomorrow = dateAdd(todayStr(), 1);
  const realityTriggers = [];
  moveList.forEach(t => {
    if (!t.originalDate) t.originalDate = t.date;
    t.date = tomorrow;
    t.rolloverCount = (t.rolloverCount || 0) + 1;
    t.rollover = true;
    if (t.rolloverCount === 3 && !t.realityCheckShown) {
      t.realityCheckShown = true;
      realityTriggers.push(t);
    }
  });
  saveState();
  render();
  toast(`已推迟 ${moveList.length} 件任务`);
  // 多个任务命中第三次推迟，依次弹出（队列化）
  if (realityTriggers.length > 0) {
    chainRealityChecks(realityTriggers.map(t => t.id));
  }
}

function chainRealityChecks(ids) {
  if (ids.length === 0) return;
  const next = ids.shift();
  showRealityCheck(next, () => chainRealityChecks(ids));
}

/* 调用千问 API 获取一句话 */
async function fetchBatchDeferAILine() {
  const today = todayStr();
  const doneToday = state.done.filter(t => t.date === today);
  const n = doneToday.length;
  const s = doneToday.filter(t => t.cat === 'S').length;
  const r = doneToday.filter(t => t.cat === 'R').length;
  const g = doneToday.filter(t => t.cat === 'G').length;
  const c = doneToday.filter(t => t.cat === 'C').length;
  const km = Math.round((snailMileage && snailMileage.total) || 0);

  const apiKey = getApiKey();
  if (!apiKey) {
    return `今天完成了 ${n} 件任务，蜗牛爬了 ${km} km。`;
  }

  const prompt = `今天用户完成了${n}件任务，
分类：S${s}件 R${r}件 G${g}件 C${c}件，
蜗牛爬了${km}km。
用一句话陈述今天的情况，15字以内，
不要评判好坏，不要说加油，语气平静自然，
可以带一点点蜗牛的意象。`;

  const _sumCfg = getAiConfig();
  const resp = await fetch(QWEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: _sumCfg.provider,
      apiKey: _sumCfg.apiKey,
      baseURL: _sumCfg.baseURL || '',
      model: _sumCfg.model,
      max_tokens: 80,
      messages: [
        { role: 'system', content: '你是一个语气平静自然的写作助手，只输出一句话，不要引号，不要解释。' },
        { role: 'user', content: prompt }
      ]
    })
  });
  if (!resp.ok) throw new Error('API ' + resp.status);
  const data = await resp.json();
  let txt = (data.choices?.[0]?.message?.content || '').trim();
  txt = txt.replace(/^["“『「]+|["”』」]+$/g, '').split('\n')[0].trim();
  if (!txt) txt = `今天完成了 ${n} 件任务，蜗牛爬了 ${km} km。`;
  return txt;
}

/* 承认现实：rolloverCount 刚变为 3 时一次性触发 */
function showRealityCheck(taskId, onClose) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t) { if (onClose) onClose(); return; }

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal defer-modal reality-modal" role="dialog">
      <h2>也许现在不是时候</h2>
      <div class="defer-body">
        这个任务已经推迟 3 次了<br>
        <span class="reality-task-name">${escapeHtml(t.desc)}</span>
      </div>
      <div class="defer-actions">
        <button type="button" class="defer-btn defer-btn-ghost" data-act="again">再推一次</button>
        <button type="button" class="defer-btn defer-btn-danger" data-act="delete">删掉它</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  function close() {
    backdrop.remove();
    if (onClose) onClose();
  }

  backdrop.querySelector('[data-act="delete"]').onclick = () => {
    deleteTask(t.id);
    close();
  };
  backdrop.querySelector('[data-act="again"]').onclick = () => {
    // 已经在本次推迟里 +1 了，"再推一次" 表示用户接受继续累加并保留当前结果
    close();
  };
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
}

function handleSchedule(text) {
  let m = text.match(/(\d{2}):?(\d{2})\s*-\s*(\d{2}):?(\d{2})/);
  let startH, startM, endH, endM;
  if (m) {
    startH = parseInt(m[1]); startM = parseInt(m[2]);
    endH = parseInt(m[3]); endM = parseInt(m[4]);
  } else {
    m = text.match(/排.*?到\s*(\d+)\s*点/);
    if (m) {
      const now = new Date();
      startH = now.getHours(); startM = now.getMinutes();
      endH = parseInt(m[1]); endM = 0;
    } else {
      toast('未识别。例：schedule 1800-2300');
      return;
    }
  }
  const today = todayStr();
  const tasks = state.tasks.filter(t => t.date === today);
  if (tasks.length === 0) { toast('今天没有任务'); return; }

  // 精力模型排序：R > S/G > C，再按优先级
  const energy = { R: 0, S: 1, G: 1, C: 2 };
  const sorted = tasks.slice().sort((a, b) => {
    const ea = energy[a.cat] ?? 3, eb = energy[b.cat] ?? 3;
    if (ea !== eb) return ea - eb;
    return (PRI_ORDER[a.priority] ?? 9) - (PRI_ORDER[b.priority] ?? 9);
  });

  const totalMin = (endH * 60 + endM) - (startH * 60 + startM);
  if (totalMin <= 0) { toast('时间区间无效'); return; }

  // 分配时间，每 90 分钟插入 10 分钟休息
  const result = [];
  let cur = startH * 60 + startM;
  let elapsed = 0;
  for (const t of sorted) {
    if (cur + t.durPlan > endH * 60 + endM) break;
    result.push({ type: 'task', task: t, start: cur, end: cur + t.durPlan });
    cur += t.durPlan;
    elapsed += t.durPlan;
    if (elapsed >= 90 && cur + 10 <= endH * 60 + endM) {
      result.push({ type: 'break', start: cur, end: cur + 10 });
      cur += 10;
      elapsed = 0;
    }
  }
  window._scheduleResult = result;
  render();
  toast(`已排 ${result.filter(r => r.type === 'task').length} 个任务`);
}

function fmtMin(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function renderScheduleTimeline(result) {
  return `
    <div style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center">
      <h3>时间轴</h3>
      <button class="btn-secondary" onclick="window._scheduleResult=null; render()">清除日程</button>
    </div>
    <div class="chart-card">
      ${result.map(item => {
        if (item.type === 'break') {
          return `
            <div class="schedule-item">
              <div class="schedule-time">${fmtMin(item.start)} - ${fmtMin(item.end)}</div>
              <div class="schedule-content schedule-break">休息 ☕</div>
            </div>
          `;
        }
        return `
          <div class="schedule-item">
            <div class="schedule-time">${fmtMin(item.start)} - ${fmtMin(item.end)}</div>
            <div class="schedule-content">
              <div style="display:flex; align-items:center; gap:8px">
                <span class="pri-dot pri-${item.task.priority}" style="width:8px; height:8px; border-radius:50%; background: var(--pri-${item.task.priority})"></span>
                <span>${escapeHtml(item.task.desc)}</span>
                <span class="cat-tag" data-cat="${item.task.cat}">${item.task.cat}</span>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

