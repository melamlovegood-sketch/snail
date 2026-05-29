async function manualSync() {
  if (authStatus !== 'cloud') return;
  if (!navigator.onLine) { toast('当前离线'); return; }
  await pushAllToCloud();
  await syncFromCloud();
  toast('已同步');
}

function fmtRecurDays(days) {
  if (!Array.isArray(days) || days.length === 0) return '';
  if (days.length === 7) return '每天';
  const names = ['日','一','二','三','四','五','六'];
  return '每周 ' + days.slice().sort().map(d => names[d]).join('、');
}

function computeStreak(tplId) {
  const tpl = state.recurTemplates.find(t => t.id === tplId);
  if (!tpl || !Array.isArray(tpl.days) || tpl.days.length === 0) return 0;
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = dateAdd(todayStr(), -i);
    const wd = weekday(d);
    if (!tpl.days.includes(wd)) continue;
    if (state.recurDoneLog[`${tpl.id}_${d}`]) streak++;
    else { if (i === 0) continue; break; }
  }
  return streak;
}

function computeMaxStreak() {
  if (state.recurTemplates.length === 0) return 0;
  let max = 0;
  state.recurTemplates.forEach(tpl => {
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = dateAdd(todayStr(), -i);
      const wd = weekday(d);
      if (!tpl.days.includes(wd)) continue;
      if (state.recurDoneLog[`${tpl.id}_${d}`]) {
        streak++;
      } else {
        // 今天还没完成不算断
        if (i === 0) continue;
        break;
      }
    }
    if (streak > max) max = streak;
  });
  return max;
}

/* ---------------- 拖延预警 banner ---------------- */
function getProcrastinatedTasks() {
  const threshold = state.rolloverWarnThreshold || 2;
  return state.tasks.filter(t => (t.rolloverCount || 0) >= threshold);
}
function renderProcrastinationBanner() {
  const list = getProcrastinatedTasks();
  if (list.length === 0) return '';
  return `
    <div class="warn-banner">
      <div style="font-size:20px">⚠</div>
      <div class="body">
        <div class="t">你有 ${list.length} 个任务被拖延了，要不要拆解一下？</div>
        <div class="d">点击查看可以跳转到第一个拖延任务</div>
      </div>
      <button class="btn-secondary" onclick="scrollToFirstProcrastinated()" style="white-space:nowrap">查看</button>
    </div>
  `;
}
function scrollToFirstProcrastinated() {
  const list = getProcrastinatedTasks();
  if (list.length === 0) return;
  // 按 date+rolloverCount 找最 "卡" 的那个
  const target = list.slice().sort((a,b) => (b.rolloverCount||0) - (a.rolloverCount||0))[0];
  const el = document.querySelector(`[data-task-id="${target.id}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'background 0.4s';
    const old = el.style.background;
    el.style.background = 'rgba(245,158,11,0.18)';
    setTimeout(() => { el.style.background = old; }, 1200);
  }
}

/* ---------------- 早间规划 banner ---------------- */
function renderMorningBanner() {
  if (!morningPlan) return '';
  if (morningPlan.loading) {
    return `
      <div class="morning-banner">
        <h3>早安，正在为你规划今天…</h3>
        <p class="advice"><span class="spinner"></span> &nbsp;让 AI 看看你的任务清单</p>
      </div>
    `;
  }
  if (morningPlan.noKey) {
    return `
      <div class="morning-banner">
        <button class="close-x" onclick="dismissMorningPlan()" title="关闭">✕</button>
        <h3>早安 🌅</h3>
        <p class="advice">配置通义千问 API Key 后可使用 AI 规划助手。</p>
      </div>
    `;
  }
  if (!morningPlan.advice) return '';
  return `
    <div class="morning-banner">
      <button class="close-x" onclick="dismissMorningPlan()" title="关闭">✕</button>
      <h3>早安，这是今天的计划建议</h3>
      <p class="advice">${escapeHtml(morningPlan.advice)}</p>
      <div class="actions">
        <button class="btn-primary" onclick="acceptMorningPlan()">采纳建议</button>
        <button class="btn-secondary" onclick="dismissMorningPlan()">我自己安排</button>
      </div>
    </div>
  `;
}

async function checkMorningPlan() {
  const today = todayStr();
  if (state.lastMorningPlanDate === today) return;
  const todayPending = state.tasks.filter(t => t.date === today && t.timerState !== 'done');
  if (todayPending.length < 3) return;

  const apiKey = getApiKey();
  if (!apiKey) {
    morningPlan = { noKey: true };
    render();
    return;
  }

  morningPlan = { loading: true };
  render();

  // 历史完成率：最近 7 天
  const today_d = todayStr();
  const recent7 = [];
  for (let i = 1; i <= 7; i++) {
    const d = dateAdd(today_d, -i);
    const dayTasks = [...state.tasks, ...(state.archive || [])].filter(t => t.date === d || t.originalDate === d);
    const doneCount = dayTasks.filter(t => (state.archive || []).some(x => x.id === t.id)).length;
    recent7.push({ date: d, total: dayTasks.length, done: doneCount });
  }

  const taskList = todayPending.map(t => ({
    id: t.id,
    desc: t.desc,
    cat: t.cat,
    priority: t.priority,
    startTime: t.startTime,
    durPlan: t.durPlan,
    deadline: t.deadline,
    rolloverCount: t.rolloverCount || 0
  }));

  const sysPrompt = `你是用户的私人日程助手。请根据用户今日任务和历史完成率，给出温和的今日规划建议。
返回纯 JSON（不要 markdown 包裹）：
{
  "advice": "50字以内的建议文字，语气像朋友，不要说教",
  "order": ["taskId1", "taskId2", ...]  // 推荐执行顺序，必须是输入任务的 id
}
order 的排序原则：高优先级 + 有 startTime 的按时间排 + 拖延久的优先动手。`;

  try {
    const _mpCfg = getAiConfig();
    const resp = await fetch(QWEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: _mpCfg.provider,
        apiKey: _mpCfg.apiKey,
        baseURL: _mpCfg.baseURL || '',
        model: _mpCfg.model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `今日任务：\n${JSON.stringify(taskList, null, 2)}\n\n最近7天完成率：\n${JSON.stringify(recent7)}` }
        ]
      })
    });
    if (!resp.ok) throw new Error('API ' + resp.status);
    const data = await resp.json();
    const txt = data.choices?.[0]?.message?.content || '';
    const m = txt.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(m ? m[0] : txt);
    if (typeof obj.advice !== 'string' || !Array.isArray(obj.order)) throw new Error('AI 返回结构异常');
    morningPlan = { advice: obj.advice, order: obj.order };
    render();
  } catch(e) {
    console.warn('[Chronos] morning plan fetch failed:', e);
    morningPlan = null; // 静默失败
  }
}

function acceptMorningPlan() {
  if (!morningPlan || !Array.isArray(morningPlan.order)) return;
  morningPlan.order.forEach((id, i) => {
    const t = state.tasks.find(x => x.id === id);
    if (t) t.sortOrder = i;
  });
  state.lastMorningPlanDate = todayStr();
  morningPlan = null;
  saveState();
  render();
  toast('已按 AI 建议排序');
}

function dismissMorningPlan() {
  state.lastMorningPlanDate = todayStr();
  morningPlan = null;
  saveState();
  render();
}

/* ---------------- AI 任务拆解 ---------------- */
/* ---------------- 自然语言批量操作 ---------------- */
async function callTaskAI(userText) {
  const apiKey = getApiKey();
  if (!apiKey) { handleTextInputLocal(userText); return; }

  const loading = showLoading('AI 正在理解…');
  const today = todayStr();
  const trim = t => ({
    id: t.id, desc: t.desc, cat: t.cat, priority: t.priority,
    date: t.date, startTime: t.startTime, endTime: t.endTime,
    timeLabel: t.timeLabel, durPlan: t.durPlan,
    deadline: t.deadline, notes: t.notes
  });
  const ctx = {
    today,
    pending: state.tasks.map(trim),
    done_today: state.done.map(trim)
  };

  const sysPrompt = `你是用户的私人时间管理助手。
今天是 ${today}。
用户当前任务列表（JSON）：
${JSON.stringify(ctx)}

用户输入可能是：
A) 对现有任务的操作（可修改任意字段 / 删除 / 批量调整，涵盖全部待办与今日已完成任务）
B) 新建一个或多个任务（含循环任务）

请严格判断并只返回一个 JSON（不要 markdown，不要任何额外文字）。

A) 操作指令：用一个万能 update 即可改任意字段，一条 action 可同时改多个字段。
{
  "type": "operation",
  "actions": [
    {"op": "update", "taskId": "xxx", "desc": "新描述", "date": "YYYY-MM-DD", "startTime": "HH:MM", "dur": 60, "cat": "S", "priority": "urgent-important", "deadline": "YYYY-MM-DD", "notes": "新备注"},
    {"op": "delete", "taskId": "xxx"}
  ],
  "summary": "我帮你把「学CNN」的开始时间改到了 21:00"
}
update 的字段规则（只放需要改的字段，不改的字段不要出现）：
- desc：任务描述（30字内）
- date：任务日期 YYYY-MM-DD
- startTime："HH:MM" 设置具体开始时间；传 "" 或 null 表示清除时间，变成全天/不定时
- dur：计划时长（分钟，≥5）
- cat：S/R/G/C
- priority：urgent-important/urgent-unimportant/important/normal
- deadline："YYYY-MM-DD" 设置截止；传 "" 或 null 清除截止
- notes：备注文本
（旧式单字段写法 reschedule/updateDate/updateDur/updateCat/updatePriority/updateStartTime/updateDesc/updateDeadline/updateNotes 仍兼容，但优先用 update。）

B) 新建任务：
{
  "type": "tasks",
  "tasks": [
    {
      "desc": "描述（30字以内，去掉无关寒暄/地点/班级等）",
      "date": "YYYY-MM-DD（单次任务日期；循环任务填首次出现日期）",
      "startTime": "HH:MM 或 null",
      "dur": 60,
      "cat": "S/R/G/C",
      "priority": "urgent-important/urgent-unimportant/important/normal",
      "deadline": "YYYY-MM-DD 或 null",
      "reminder": 30,
      "notes": "备注：地点/链接等，无则空字符串",
      "isRecur": false,
      "recurFreq": "daily/weekly 或 null",
      "recurWeekdays": []
    }
  ],
  "summary": "识别到 X 个任务"
}

判断与操作规则：
- taskId 必须是上面列表（pending 或 done_today）里真实存在的 id；可对全部任务（含已完成）操作
- 含 推到/挪到/顺延/改成/改为/调整/重命名/叫做/压缩/拉长/删除/不做了/清空/改时间/改名字/改备注/改截止 等且明确指向已有任务 → operation
- 用户只说改某一项时，update 里就只放那一项；说改多项就一条 update 放多项
- 靠 desc 文字匹配用户指的是哪个任务，匹配到对应的 taskId
- "把今天所有 C 类推到明天"针对每个匹配任务展开为多个 update(date)
- "删除所有已完成"针对 done_today 展开为多个 delete
- 否则一律按新建任务处理

新建任务规则：
- 用户一句话里若确实包含多件独立的事，可拆成多个任务；但不要把同一件事的细节拆开
- "每天X" → isRecur:true, recurFreq:"daily"
- "每周一三五X" → isRecur:true, recurFreq:"weekly", recurWeekdays 用 [0=周日..6=周六]
- 没有明确时长时按经验合理估算 dur（分钟）
- 相对日期（今天/明天/下周一等）要换算成具体 YYYY-MM-DD

分类规则：
- 听课/抄作业/刷题/听讲座 → C
- 只有"学习+具体内容"才归 S
- 论文/实验/文献/导师/组会/paper/research → R
- 游泳/健身/跑步/阅读/冥想/瑜伽/散步/锻炼 → G
- 其它（吃饭/通勤/会议/上课/作业等）→ C

优先级判定：
1) 重要词：论文/作业/报告/考试/答辩/项目/实验/文献/提交/交/due/deadline/ddl
2) 紧急条件：date 是今天/明天 或 deadline ≤ 3 天 或 含 今天/明天/马上/立刻/紧急/尽快/截止
3) 组合：重要+紧急→urgent-important / 重要→important / 紧急→urgent-unimportant / 都不→默认 important

summary 是给用户看的简洁中文确认信息。`;

  try {
    const _nlCfg = getAiConfig();
    const resp = await fetch(QWEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: _nlCfg.provider,
        apiKey: _nlCfg.apiKey,
        baseURL: _nlCfg.baseURL || '',
        model: _nlCfg.model,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userText }
        ]
      })
    });
    loading.remove();
    if (!resp.ok) { toast('API 调用失败，已用本地解析'); handleTextInputLocal(userText); return; }
    const data = await resp.json();
    const txt = data.choices?.[0]?.message?.content || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) { toast('AI 返回格式异常，已用本地解析'); handleTextInputLocal(userText); return; }
    let obj;
    try { obj = JSON.parse(m[0]); }
    catch(_) { toast('AI 返回格式异常，已用本地解析'); handleTextInputLocal(userText); return; }

    if (obj.type === 'operation' && Array.isArray(obj.actions)) {
      const applied = applyOperations(obj.actions, obj.summary || '已执行操作');
      if (applied === 0) toast('未识别到可执行的操作');
    } else if (obj.type === 'tasks' || obj.type === 'task') {
      // 兼容 type:"tasks"+tasks[] 与老格式 type:"task"+desc
      let tasks = Array.isArray(obj.tasks) ? obj.tasks : [];
      if (tasks.length === 0 && typeof obj.desc === 'string' && obj.desc.trim()) {
        tasks = [{ desc: obj.desc.trim() }];
      }
      if (tasks.length === 0) { toast('未识别到任务'); return; }
      showAIParseDetailModal(tasks, obj.summary);
    } else {
      toast('AI 未识别意图');
    }
  } catch(e) {
    loading.remove();
    toast('AI 处理失败，已用本地解析');
    handleTextInputLocal(userText);
  }
}

function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

/**
 * 把 action 上携带的字段应用到任务 t，返回成功修改的字段数。
 * 只处理 action 上实际出现的字段；非法值忽略。供万能 update 与所有旧式单字段 op 共用。
 */
function applyTaskFields(t, a) {
  let changed = 0;
  // 描述
  if (typeof a.desc === 'string' && a.desc.trim()) { t.desc = a.desc.trim(); changed++; }
  // 日期
  if (typeof a.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.date)) {
    t.date = a.date; t.rollover = false; t.rolloverCount = 0; changed++;
  }
  // 计划时长（分钟）
  if (typeof a.dur === 'number' && a.dur >= 5) { t.durPlan = a.dur; changed++; }
  // 分类
  if (typeof a.cat === 'string' && /^[SRGC]$/.test(a.cat)) { t.cat = a.cat; changed++; }
  // 优先级
  if (typeof a.priority === 'string' && /^(urgent-important|urgent-unimportant|important|normal)$/.test(a.priority)) {
    t.priority = a.priority; t.priorityManualOverride = true; changed++;
  }
  // 开始时间："HH:MM" 设置；"" 或 null 清除（同时清掉模糊时段标签）
  if (a.startTime !== undefined) {
    if (typeof a.startTime === 'string' && /^\d{2}:\d{2}$/.test(a.startTime)) {
      t.startTime = a.startTime; t.timeLabel = null; t.endTime = null; changed++;
    } else if (a.startTime === null || a.startTime === '') {
      t.startTime = null; t.timeLabel = null; t.endTime = null; changed++;
    }
  }
  // 截止："YYYY-MM-DD" 设置；"" 或 null 清除
  if (a.deadline !== undefined) {
    if (typeof a.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.deadline)) {
      t.deadline = a.deadline; t.deadlineUrgencyApplied = false; changed++;
    } else if (a.deadline === null || a.deadline === '') {
      t.deadline = null; changed++;
    }
  }
  // 备注
  if (typeof a.notes === 'string') { t.notes = a.notes; changed++; }
  return changed;
}

function applyOperations(actions, summary) {
  // 先快照便于撤销
  const snapshot = {
    tasks: deepClone(state.tasks),
    done: deepClone(state.done),
    recurTemplates: deepClone(state.recurTemplates),
    favorites: deepClone(state.favorites)
  };

  let applied = 0;
  for (const action of actions) {
    if (!action || !action.op) continue;
    if (action.op === 'delete' && action.taskId) {
      const before = state.tasks.length + state.done.length;
      state.tasks = state.tasks.filter(t => t.id !== action.taskId);
      state.done = state.done.filter(t => t.id !== action.taskId);
      if (state.tasks.length + state.done.length < before) applied++;
      continue;
    }
    const t = findTask(action.taskId);
    if (!t) continue;
    // 万能 update 与所有旧式单字段 op 统一走 applyTaskFields；
    // 旧式 reschedule/updateDate 用 newDate 字段，这里兼容映射到 date。
    if (action.op === 'reschedule' || action.op === 'updateDate') {
      if (action.date === undefined && action.newDate !== undefined) action.date = action.newDate;
    }
    if (applyTaskFields(t, action) > 0) applied++;
  }

  if (applied > 0) {
    lastOperation = { snapshot, summary, ts: Date.now() };
    // 12 秒后自动隐藏撤销条（不真正销毁数据）
    setTimeout(() => {
      if (lastOperation && Date.now() - lastOperation.ts >= 11000) {
        lastOperation = null;
        if (currentTab === 'plans' || currentTab === 'today') render();
      }
    }, 12000);
  }
  saveState();
  render();
  return applied;
}

function undoLastOperation() {
  if (!lastOperation) return;
  state.tasks = lastOperation.snapshot.tasks;
  state.done = lastOperation.snapshot.done;
  state.recurTemplates = lastOperation.snapshot.recurTemplates;
  state.favorites = lastOperation.snapshot.favorites;
  lastOperation = null;
  saveState();
  render();
  toast('已撤销');
}

function renderUndoBanner() {
  if (!lastOperation) return '';
  return `
    <div class="undo-banner">
      <div class="msg">${escapeHtml(lastOperation.summary)}</div>
      <button class="btn-secondary" onclick="undoLastOperation()" style="min-height:36px; padding:6px 14px;">撤销</button>
    </div>
  `;
}

async function decomposeTask(taskId) {
  const apiKey = getApiKey();
  if (!apiKey) { toast('请先在设置中填入 API Key'); return; }
  const t = findTask(taskId);
  if (!t) return;

  const loading = showLoading('AI 正在拆解任务');
  const sysPrompt = `你是一个时间管理助手。请把以下任务拆解成 3-5 个可执行的子任务，每个子任务有明确的描述和预估时长（分钟）。
要求：
- 子任务总时长接近原任务总时长
- 描述简短具体（10 字以内），不要重复原任务大标题
- 返回纯 JSON 数组，不要 markdown，不要任何其他文字
格式：
[{"desc": "子任务描述", "dur": 30, "cat": "${t.cat}"}]`;
  const userMsg = `任务：${t.desc}
分类：${t.cat}
计划总时长：${t.durPlan} 分钟${t.notes ? '\n备注：'+t.notes : ''}`;

  try {
    const _dcCfg = getAiConfig();
    const resp = await fetch(QWEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: _dcCfg.provider,
        apiKey: _dcCfg.apiKey,
        baseURL: _dcCfg.baseURL || '',
        model: _dcCfg.model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userMsg }
        ]
      })
    });
    loading.remove();
    if (!resp.ok) { toast('API 调用失败'); return; }
    const data = await resp.json();
    const txt = data.choices?.[0]?.message?.content || '';
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) { toast('AI 返回格式异常'); return; }
    const subtasks = JSON.parse(m[0]);
    if (!Array.isArray(subtasks) || subtasks.length === 0) { toast('未拆解到子任务'); return; }
    showDecomposeConfirmModal(t, subtasks);
  } catch(e) {
    loading.remove();
    toast('拆解失败：' + e.message);
  }
}

function showDecomposeConfirmModal(parentTask, subtasks) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <h2>拆解结果</h2>
    <p class="text-soft text-sm" style="margin-bottom:14px">原任务：${escapeHtml(parentTask.desc)} (${fmtDur(parentTask.durPlan)})</p>
    <div id="dec-list"></div>
    <div class="form-group" style="margin-top:8px;">
      <label style="display:flex; align-items:center; gap:10px; cursor:pointer; text-transform:none; letter-spacing:0; font-weight:500;">
        <input type="checkbox" id="dec-delete-orig" style="width:auto; min-height:auto; margin:0;">
        <span style="font-size:14px;">添加子任务后删除原任务</span>
      </label>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" id="dec-cancel">取消</button>
      <button class="btn-primary" id="dec-confirm">添加选中</button>
    </div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const list = modal.querySelector('#dec-list');
  subtasks.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'modal-list-item';
    row.innerHTML = `
      <input type="checkbox" checked data-i="${i}">
      <input type="text" value="${escapeHtml(s.desc || '')}" data-desc="${i}" style="flex:1; min-width:0">
      <input type="number" min="5" step="5" value="${s.dur || 30}" style="width:80px" data-dur="${i}">
      <span class="text-xs text-soft">分</span>
    `;
    list.appendChild(row);
  });

  modal.querySelector('#dec-cancel').onclick = () => backdrop.remove();
  modal.querySelector('#dec-confirm').onclick = () => {
    let added = 0;
    subtasks.forEach((s, i) => {
      const cb = modal.querySelector(`[data-i="${i}"]`);
      if (!cb.checked) return;
      const desc = modal.querySelector(`[data-desc="${i}"]`).value.trim() || s.desc;
      const dur = parseInt(modal.querySelector(`[data-dur="${i}"]`).value, 10) || 30;
      state.tasks.push(makeTask({
        desc, cat: parentTask.cat, priority: parentTask.priority,
        date: todayStr(), durPlan: dur
      }));
      added++;
    });
    const delOrig = modal.querySelector('#dec-delete-orig').checked;
    if (delOrig) {
      state.tasks = state.tasks.filter(x => x.id !== parentTask.id);
      state.done = state.done.filter(x => x.id !== parentTask.id);
    } else {
      // 标记原任务为"已拆解"
      const p = findTask(parentTask.id);
      if (p) p.decomposed = true;
    }
    saveState();
    backdrop.remove();
    render();
    toast(`已添加 ${added} 个子任务${delOrig ? '，原任务已删除' : '，原任务标记为已拆解'}`);
  };
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
}

/* 切换某分组已完成区域的展开/折叠（纯 DOM 操作，不触发整页 re-render） */
function toggleDoneCollapsed(groupKey) {
  doneCollapsed[groupKey] = !doneCollapsed[groupKey];
  const section = document.querySelector(`.done-section[data-group-key="${groupKey}"]`);
  if (!section) return;
  const isCollapsed = !!doneCollapsed[groupKey];
  const collapseRow = section.querySelector('.done-collapse-row');
  const taskList = section.querySelector('.done-tasks-list');
  if (collapseRow) collapseRow.classList.toggle('expanded', !isCollapsed);
  if (taskList) taskList.classList.toggle('collapsed', isCollapsed);
}

/* 渲染某分组的已完成任务区域 */
function renderDoneSection(doneItems, groupKey) {
  if (doneItems.length === 0) return '';
  const isCollapsed = !!doneCollapsed[groupKey];
  const showToggle = doneItems.length > 3;
  const safeKey = groupKey.replace(/"/g, '&quot;');

  if (showToggle) {
    return `
      <div class="done-section" data-group-key="${safeKey}">
        <button class="done-collapse-row ${isCollapsed ? '' : 'expanded'}" onclick="toggleDoneCollapsed('${safeKey}')">
          <span class="done-collapse-arrow">›</span>
          ✓ 已完成 ${doneItems.length} 项
        </button>
        <div class="done-tasks-list ${isCollapsed ? 'collapsed' : ''}">
          ${doneItems.map(t => taskCardHTML(t)).join('')}
        </div>
      </div>
    `;
  } else {
    return `
      <div class="done-section" data-group-key="${safeKey}">
        ${doneItems.map(t => taskCardHTML(t)).join('')}
      </div>
    `;
  }
}

/* 「已完成」标签页：把永久归档（state.archive，跨设备同步）按日期分组展示。
 * 归档是所有设备完成记录的统一来源，因此这里的列表在各设备上一致。*/
function renderCompletedArchive() {
  const archive = (state.archive || []).slice();
  if (archive.length === 0) {
    return `
      <div class="empty">
        <div class="big">✓</div>
        <div>还没有已完成的事项</div>
        <div class="text-sm" style="margin-top:8px">完成任务后会按日期归档在这里</div>
      </div>
    `;
  }
  const completedTime = t => t.completedAt || (t._updatedAt ? new Date(t._updatedAt).getTime() : 0);
  // 按任务日期分组
  const groups = {};
  archive.forEach(t => {
    const d = t.date || todayStr();
    (groups[d] = groups[d] || []).push(t);
  });
  const dates = Object.keys(groups).sort().reverse();   // 最近的日期在前
  return dates.map(date => {
    const items = groups[date].slice().sort((a, b) => completedTime(b) - completedTime(a));
    return `
      <div class="task-group">
        <div class="task-group-header">
          <span class="date-label">${fmtDate(date)}</span>
          <span class="text-xs text-faint">${items.length} 项</span>
        </div>
        ${items.map(t => taskCardHTML(t)).join('')}
      </div>
    `;
  }).join('');
}

function renderPlans() {
  const main = document.getElementById('main');
  // 「已完成」是只读归档视图，没有可输入项 → 隐藏输入框
  const showInput = inputMode !== 'done';
  main.innerHTML = `
    ${renderUndoBanner()}
    ${renderMorningBanner()}
    ${renderProcrastinationBanner()}
    ${showInput ? `
    <div class="input-bar">
      <input id="task-input" placeholder="${inputMode === 'memo' ? '记一笔...（按 Enter 保存）' : '新任务或操作指令，例：把今天 C 类推到明天'}" autocomplete="off">
      ${inputMode === 'task' ? `
        <button class="btn-icon" id="img-btn" title="截图解析">⎙</button>
        <button class="btn-icon" id="fav-btn" title="收藏">★</button>
      ` : ''}
    </div>` : ''}
    <div class="input-mode-tabs${showInput ? '' : ' detached'}">
      <button class="input-mode-tab${inputMode === 'task' ? ' active' : ''}" onclick="setInputMode('task')">任务</button>
      <button class="input-mode-tab${inputMode === 'memo' ? ' active' : ''}" onclick="setInputMode('memo')">记一笔</button>
      <button class="input-mode-tab${inputMode === 'done' ? ' active' : ''}" onclick="setInputMode('done')">已完成</button>
    </div>
    ${inputMode === 'done' ? '' : renderMemoBlock()}
    <div id="plans-list"></div>
  `;

  if (showInput) {
    const input = main.querySelector('#task-input');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        if (inputMode === 'memo') {
          addMemo(input.value);
        } else {
          handleTextInput(input.value);
        }
        input.value = '';
      }
    });
    if (inputMode === 'task') {
      main.querySelector('#img-btn').onclick = () => document.getElementById('img-input').click();
      main.querySelector('#fav-btn').onclick = showFavoritesQuickPick;
    }
  }

  // 「已完成」标签页：读取永久归档，按日期（最近优先）分组展示
  if (inputMode === 'done') {
    main.querySelector('#plans-list').innerHTML = renderCompletedArchive();
    return;
  }

  // 按日期分组
  const allTasks = [...state.tasks, ...state.done];
  if (allTasks.length === 0) {
    main.querySelector('#plans-list').innerHTML = `
      <div class="empty">
        <div class="big">▦</div>
        <div>还没有计划</div>
        <div class="text-sm" style="margin-top:8px">输入或上传截图开始</div>
      </div>
    `;
    return;
  }
  const doneIdSet = new Set(state.done.map(t => t.id));
  const groups = {};
  allTasks.forEach(t => {
    if (!groups[t.date]) groups[t.date] = [];
    groups[t.date].push(t);
  });
  const sortedDates = Object.keys(groups).sort();
  const listEl = main.querySelector('#plans-list');
  listEl.innerHTML = sortedDates.map(date => {
    const doneTasks = groups[date].filter(t => doneIdSet.has(t.id));
    const undoneTasks = groups[date].filter(t => !doneIdSet.has(t.id));
    return `
      <div class="task-group">
        <div class="task-group-header">
          <span class="date-label">${fmtDate(date)}</span>
          <span class="text-xs text-faint">${groups[date].length} 项</span>
        </div>
        ${sortTasksByTime(undoneTasks).map(t => taskCardHTML(t)).join('')}
        ${renderDoneSection(doneTasks, date)}
      </div>
    `;
  }).join('');
}

function showFavoritesQuickPick() {
  if (state.favorites.length === 0) { toast('还没有收藏任务'); return; }
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <h2>常用任务</h2>
    <p class="text-soft text-sm" style="margin-bottom:16px">点击一键添加到今天</p>
    <div>${state.favorites.map(f => `
      <div class="fav-row">
        <div>
          <div class="fav-desc">${escapeHtml(f.desc)}</div>
          <div class="fav-meta">${f.cat} · ${fmtDur(f.durPlan)}</div>
        </div>
        <button class="btn-primary" onclick="addFromFavorite('${f.id}'); document.querySelector('.modal-backdrop').remove()">添加</button>
      </div>
    `).join('')}</div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="this.closest('.modal-backdrop').remove()">关闭</button>
    </div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) backdrop.remove();
  });
}

function renderToday() {
  const main = document.getElementById('main');
  const today = todayStr();
  const todayTasks = state.tasks.filter(t => t.date === today);
  const todayDone = state.done.filter(t => t.date === today);

  main.innerHTML = `
    ${renderFocusBlock()}
    <div class="input-bar">
      <input id="schedule-input" placeholder="排日程：例 schedule 1800-2300 或 排到23点" autocomplete="off">
      <button class="btn-primary" id="export-today" style="white-space:nowrap">导出</button>
    </div>
    <div id="today-list"></div>
  `;

  const input = main.querySelector('#schedule-input');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      handleSchedule(input.value);
      input.value = '';
    }
  });
  main.querySelector('#export-today').onclick = exportTodayICS;

  // 普通列表过滤掉已 pin 到专注的任务（避免重复）
  const pinSet = new Set(focusPins);
  const restUnfinished = todayTasks.filter(t => !pinSet.has(t.id));
  const restDone = todayDone.filter(t => !pinSet.has(t.id));
  const allRest = [...restUnfinished, ...restDone];
  const listEl = main.querySelector('#today-list');

  if (allRest.length === 0 && focusPins.length === 0) {
    listEl.innerHTML = `
      <div class="empty">
        <div class="big">◷</div>
        <div>今天没有任务</div>
      </div>
    `;
    return;
  }

  // 如果有计算好的日程，显示时间轴
  if (window._scheduleResult) {
    listEl.innerHTML = renderScheduleTimeline(window._scheduleResult);
    return;
  }

  if (allRest.length === 0) {
    // 所有任务都在专注块里，下面不显示重复列表
    listEl.innerHTML = '';
    return;
  }

  const sortedUnfinished = sortTasks(restUnfinished);
  const _today = todayStr();
  const deferEligibleCount = sortedUnfinished.filter(t => {
    if (!isDeferEligible(t)) return false;
    if (t.priority === 'urgent-important') return false;
    if (t.deadline && diffDays(_today, t.deadline) <= 3) return false;
    return true;
  }).length;

  listEl.innerHTML = `
    <div class="task-group">
      <div class="task-group-header">
        <span class="date-label">今天 · ${restUnfinished.length} 项待完成</span>
        <span class="text-xs text-faint">${restDone.length} 已完成</span>
      </div>
      ${sortedUnfinished.map(t => taskCardHTML(t)).join('')}
      ${renderDoneSection(restDone, 'today')}
      ${deferEligibleCount > 0 ? '<button class="day-end-btn" onclick="openBatchDeferPanel()">今天先到这里</button>' : ''}
    </div>
  `;
}

/* ===================== 推迟功能：单个推迟 / 批量推迟 / 承认现实 ===================== */

/* 任务是否可推迟（用于决定是否包裹 swipe-wrap 与批量推迟） */
