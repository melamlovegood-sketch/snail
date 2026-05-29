function renderRecur() {
  const main = document.getElementById('main');
  if (state.recurTemplates.length === 0) {
    main.innerHTML = `
      <div class="empty">
        <div class="big">↻</div>
        <div>还没有循环任务</div>
        <div class="text-sm" style="margin-top:8px">输入"每天游泳1小时"或"每周一三五跑步30分钟"</div>
      </div>
    `;
    return;
  }
  main.innerHTML = state.recurTemplates.map(tpl => {
    const streak = computeStreak(tpl.id);
    const daysLabel = fmtRecurDays(tpl.days);
    return `
      <div class="recur-card">
        <span class="pri-dot pri-${tpl.priority || 'normal'}" style="width:10px; height:10px; border-radius:50%"></span>
        <div style="flex:1; min-width:0; cursor:pointer" onclick="showRecurTemplateModal('${tpl.id}')" title="点击编辑循环模板">
          <div style="font-weight:500">${escapeHtml(tpl.desc)}</div>
          <div class="text-xs text-soft" style="margin-top:2px">
            ${tpl.startTime ? `<span class="time-tag" style="margin-right:4px">◷ ${tpl.startTime}</span>` : ''}
            <span class="cat-tag" data-cat="${tpl.cat}">${tpl.cat}</span>
            &nbsp;${daysLabel} · ${fmtDur(tpl.durPlan)}
          </div>
        </div>
        ${streak > 0 ? `<span class="streak-badge">🔥 ${streak}</span>` : ''}
        <button class="icon-btn" onclick="event.stopPropagation(); deleteRecur('${tpl.id}')" title="删除">✕</button>
      </div>
    `;
  }).join('');
}

function deleteRecur(id) {
  if (!confirm('删除该循环任务模板？已生成的实例会保留。')) return;
  state.recurTemplates = state.recurTemplates.filter(t => t.id !== id);
  // 记录本地删除标记，防止同步时云端复活
  if (!Array.isArray(state.deletedRecurIds)) state.deletedRecurIds = [];
  if (!state.deletedRecurIds.includes(id)) state.deletedRecurIds.push(id);
  saveState();
  // 同步删除云端记录
  cloudDeleteRecurTemplate(id);
  render();
}

/* ---------------- 统计 ---------------- */
function renderStats() {
  const main = document.getElementById('main');
  main.innerHTML = `
    ${renderSnailJourneyHTML()}
    <div class="stat-tabs">
      <button data-v="day" class="${statView==='day'?'active':''}">日</button>
      <button data-v="week" class="${statView==='week'?'active':''}">周</button>
      <button data-v="month" class="${statView==='month'?'active':''}">月</button>
    </div>
    <div id="stats-content"></div>
    <div class="ai-summary-area" style="margin-top:20px">
      <h3 style="margin-bottom:12px">AI 总结分析</h3>
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        <button class="btn-secondary" onclick="aiSummary('day')">今日总结</button>
        <button class="btn-secondary" onclick="aiSummary('week')">本周总结</button>
        <button class="btn-secondary" onclick="aiSummary('month')">本月总结</button>
      </div>
      <div id="ai-result-area"></div>
    </div>
    ${renderAchievementWallHTML()}
  `;
  main.querySelectorAll('.stat-tabs button').forEach(b => {
    b.onclick = () => { statView = b.dataset.v; renderStats(); };
  });
  // 时间轴默认滚到最右（今天）
  const tl = document.getElementById('snail-journey-timeline');
  if (tl) tl.scrollLeft = tl.scrollWidth;
  renderStatChart();
  initAchievementWallEvents();
}

function getRangeTasks(view) {
  const today = todayStr();
  // 历史统计用 archive（永久归档，含今日已完成），而非跨日清空的 done
  const all = [...state.tasks, ...(state.archive || [])];
  if (view === 'day') {
    return all.filter(t => t.date === today);
  }
  if (view === 'week') {
    // 本周从周一到今天
    const wd = weekday(today);
    const monday = dateAdd(today, -((wd + 6) % 7));
    return all.filter(t => t.date >= monday && t.date <= today);
  }
  if (view === 'month') {
    const d = new Date();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const prefix = `${d.getFullYear()}-${m}`;
    return all.filter(t => t.date.startsWith(prefix));
  }
  return [];
}

function destroyAllCharts() {
  Object.keys(chartInstances).forEach(k => {
    try { chartInstances[k].destroy(); } catch(_) {}
    delete chartInstances[k];
  });
}

function computeCatTotals(tasks) {
  const totals = { S: 0, R: 0, G: 0, C: 0 };
  tasks.forEach(t => {
    const isDone = (state.archive || []).some(d => d.id === t.id);
    const v = isDone ? (t.durActual ?? t.durPlan) : t.durPlan;
    if (totals[t.cat] !== undefined) totals[t.cat] += (v || 0);
  });
  return totals;
}

function buildMonthSeries() {
  const d = new Date();
  const daysInMonth = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  const labels = [];
  const series = { S: [], R: [], G: [], C: [] };
  let total = 0;
  for (let i = 1; i <= daysInMonth; i++) {
    labels.push(i);
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
    const dayTasks = [...state.tasks, ...(state.archive || [])].filter(t => t.date === ds);
    ['S','R','G','C'].forEach(c => {
      const sum = dayTasks
        .filter(t => t.cat === c)
        .reduce((s,t) => {
          const isDone = (state.archive || []).some(dd => dd.id === t.id);
          return s + ((isDone ? (t.durActual ?? t.durPlan) : t.durPlan) || 0);
        }, 0);
      series[c].push(sum);
      total += sum;
    });
  }
  return { labels, series, total };
}

function renderStatChart() {
  // 切视图前清理所有旧实例，防止重复渲染 + 内存泄漏
  destroyAllCharts();

  const content = document.getElementById('stats-content');
  const tasks = getRangeTasks(statView);
  const completed = tasks.filter(t => (state.archive || []).some(d => d.id === t.id));
  const totalTasks = tasks.length;
  const completedCount = completed.length;
  const rate = totalTasks > 0 ? Math.round(completedCount / totalTasks * 100) : 0;

  if (statView === 'month') {
    const monthData = buildMonthSeries();
    const empty = monthData.total === 0;
    content.innerHTML = `
      <div class="chart-card">
        <h3>本月四维度时长</h3>
        ${empty
          ? '<div class="chart-empty-state">本月暂无数据</div>'
          : '<div class="chart-wrap tall"><canvas id="cat-line-chart"></canvas></div>'}
        ${empty ? '' : renderCatLegend()}
      </div>
      <div class="chart-card">
        <h3>关键数据</h3>
        ${renderKeyStats(tasks, completed)}
      </div>
    `;
    if (!empty) drawMonthLineChart(monthData);
  } else {
    const totals = computeCatTotals(tasks);
    const sumAll = totals.S + totals.R + totals.G + totals.C;
    const empty = sumAll === 0;
    content.innerHTML = `
      <div class="chart-card">
        <h3>四维度时长分布</h3>
        ${empty
          ? '<div class="chart-empty-state">' + (statView==='day'?'今天':'本周') + '暂无数据</div>'
          : '<div class="chart-wrap"><canvas id="cat-pie-chart"></canvas></div>'}
        ${empty ? '' : renderCatLegend()}
      </div>
      <div class="chart-card">
        <h3>关键数据</h3>
        <div class="settings-row"><span class="label">完成率</span><strong>${completedCount}/${totalTasks} · ${rate}%</strong></div>
        ${renderKeyStats(tasks, completed)}
      </div>
    `;
    if (!empty) drawPieChart(totals);
  }
}

function renderCatLegend() {
  return `
    <div class="cat-legend">
      <div class="item"><span class="swatch" style="background:var(--cat-s)"></span> S 学习</div>
      <div class="item"><span class="swatch" style="background:var(--cat-r)"></span> R 研究</div>
      <div class="item"><span class="swatch" style="background:var(--cat-g)"></span> G 成长</div>
      <div class="item"><span class="swatch" style="background:var(--cat-c)"></span> C 杂事</div>
    </div>
  `;
}

function renderKeyStats(tasks, completed) {
  const totalPlan = tasks.reduce((s,t) => s + (t.durPlan || 0), 0);
  const totalActual = completed.reduce((s,t) => s + (t.durActual || 0), 0);
  return `
    <div class="settings-row"><span class="label">总计划时长</span><strong>${fmtDur(totalPlan)}</strong></div>
    <div class="settings-row"><span class="label">总实际时长</span><strong>${fmtDur(totalActual)}</strong></div>
  `;
}

function drawPieChart(totals) {
  const ctx = document.getElementById('cat-pie-chart');
  if (!ctx) return;
  if (chartInstances.pie) { try { chartInstances.pie.destroy(); } catch(_) {} delete chartInstances.pie; }
  chartInstances.pie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['S 学习', 'R 研究', 'G 成长', 'C 杂事'],
      datasets: [{
        data: [totals.S, totals.R, totals.G, totals.C],
        backgroundColor: ['#7A8B99', '#8B7B9B', '#8B9B7A', '#B89B7A'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 100,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.parsed;
              const total = ctx.dataset.data.reduce((a,b)=>a+b,0);
              const pct = total > 0 ? Math.round(v/total*100) : 0;
              return `${ctx.label}: ${fmtDur(v)} · ${pct}%`;
            }
          }
        }
      }
    }
  });
}

function drawMonthLineChart(monthData) {
  const ctx = document.getElementById('cat-line-chart');
  if (!ctx) return;
  const { labels, series } = monthData;
  if (chartInstances.line) { try { chartInstances.line.destroy(); } catch(_) {} delete chartInstances.line; }
  chartInstances.line = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'S', data: series.S, borderColor: '#7A8B99', backgroundColor: '#7A8B99', tension: 0.3 },
        { label: 'R', data: series.R, borderColor: '#8B7B9B', backgroundColor: '#8B7B9B', tension: 0.3 },
        { label: 'G', data: series.G, borderColor: '#8B9B7A', backgroundColor: '#8B9B7A', tension: 0.3 },
        { label: 'C', data: series.C, borderColor: '#B89B7A', backgroundColor: '#B89B7A', tension: 0.3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 100,
      animation: { duration: 300 },
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => v + '分' } }
      }
    }
  });
}

async function aiSummary(view) {
  const apiKey = getApiKey();
  if (!apiKey) { toast('请先在设置中填入 API Key'); return; }
  const tasks = getRangeTasks(view);
  if (tasks.length === 0) { toast('这个时间段还没有任务'); return; }

  const completed = tasks.filter(t => (state.archive || []).some(d => d.id === t.id));
  const data = {
    range: view,
    today: todayStr(),
    total: tasks.length,
    completed: completed.length,
    tasks: tasks.map(t => ({
      desc: t.desc,
      cat: t.cat,
      priority: t.priority,
      date: t.date,
      durPlan: t.durPlan,
      durActual: t.durActual,
      done: (state.archive || []).some(d => d.id === t.id),
      isRecur: t.isRecur,
      rollover: t.rollover
    })),
    recurTemplates: state.recurTemplates.map(tpl => ({ desc: tpl.desc, days: tpl.days, durPlan: tpl.durPlan })),
    recurDoneLog: state.recurDoneLog
  };

  const resultArea = document.getElementById('ai-result-area');
  resultArea.innerHTML = `<div class="ai-result"><span class="spinner"></span> &nbsp;AI 正在分析…</div>`;

  try {
    const sysPrompt = `你是一个关心朋友的时间管理顾问。用户会给你他的任务数据（JSON），请你像朋友一样和他聊聊。

要点：
1. 完成率和自律情况怎么样
2. S/R/G/C 四个维度的时间分配是否均衡（S=学习 R=研究 G=成长 健身阅读冥想 C=杂事）
3. 计划时长和实际时长的对比，是高估还是低估自己
4. 循环任务坚持得怎么样
5. 给出 2-3 条具体、可行的改进建议

语气：
- 像关心你的朋友，不是老师
- 不要说教，不要鸡汤
- 要具体，不要泛泛而谈
- 用中文，简洁有力
- 控制在 250 字以内`;

    const _stCfg = getAiConfig();
    const resp = await fetch(QWEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: _stCfg.provider,
        apiKey: _stCfg.apiKey,
        baseURL: _stCfg.baseURL || '',
        model: _stCfg.model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: sysPrompt },
          {
            role: 'user',
            content: `这是我${view==='day'?'今天':view==='week'?'本周':'本月'}的数据：\n\n${JSON.stringify(data, null, 2)}`
          }
        ]
      })
    });
    if (!resp.ok) {
      resultArea.innerHTML = `<div class="ai-result">API 调用失败</div>`;
      return;
    }
    const d = await resp.json();
    const text = d.choices?.[0]?.message?.content || '没收到内容';
    resultArea.innerHTML = `<div class="ai-result">${escapeHtml(text)}</div>`;
  } catch(e) {
    resultArea.innerHTML = `<div class="ai-result">出错了：${escapeHtml(e.message)}</div>`;
  }
}

/* ---------------- AI 助手对话 ---------------- */
function buildAssistantContext() {
  const trim = t => ({
    desc: t.desc,
    cat: t.cat,
    priority: t.priority,
    date: t.date,
    startTime: t.startTime,
    deadline: t.deadline,
    durPlan: t.durPlan,
    durActual: t.durActual,
    notes: t.notes,
    isRecur: t.isRecur,
    rollover: t.rollover
  });
  return {
    today: todayStr(),
    pending: state.tasks.map(trim),
    done_today: state.done.map(trim),
    recurTemplates: state.recurTemplates.map(tpl => ({
      desc: tpl.desc, cat: tpl.cat, days: tpl.days, durPlan: tpl.durPlan, startTime: tpl.startTime
    })),
    recurDoneLog: state.recurDoneLog
  };
}

function buildCheckInSystemPrompt() {
  const today = todayStr();
  const todayUnfinished = state.tasks.filter(t => t.date === today);
  const todayDone = state.done.filter(t => t.date === today);
  const totalTasks = todayUnfinished.length + todayDone.length;
  const doneTasks = todayDone.length;
  const rate = totalTasks > 0 ? Math.round(doneTasks / totalTasks * 100) : 0;

  const sumMin = (arr, c) => arr.filter(x => x.cat === c).reduce((s, x) => {
    const isDone = state.done.some(d => d.id === x.id);
    return s + ((isDone ? (x.durActual ?? x.durPlan) : x.durPlan) || 0);
  }, 0);
  const all = [...todayUnfinished, ...todayDone];
  const h = c => (sumMin(all, c) / 60).toFixed(1);

  return `你是用户的私人时间管家，名字叫 Chronos。
今天是 ${today}。

用户今日数据：
- 计划任务：${totalTasks} 个
- 已完成：${doneTasks} 个
- 完成率：${rate}%
- 已完成任务：${todayDone.map(t => t.desc).join('、') || '（无）'}
- 未完成任务：${todayUnfinished.map(t => t.desc).join('、') || '（无）'}
- 各分类时长：S:${h('S')}h R:${h('R')}h G:${h('G')}h C:${h('C')}h

请用温暖、不评判的语气和用户对话。
不要说教，不要催促，像一个理解你的朋友。
- 第一句简短问候，提到完成数，问"今天感觉怎么样？"
- 用户回应后：一句肯定（不管完成多少都要找到值得肯定的）+ 一个具体的明日建议；如果有未完成任务，温和地问是否要调整
- 控制每条回复在 100 字以内`;
}

function buildAssistantSystemPrompt() {
  if (checkInMode) return buildCheckInSystemPrompt();
  const ctx = buildAssistantContext();
  const wd = '日一二三四五六'[new Date().getDay()];
  return `你是用户的私人日程助手。以下是用户当前所有任务数据（JSON）：

${JSON.stringify(ctx, null, 2)}

今天是 ${ctx.today}（周${wd}）。

字段含义：
- pending：未完成任务列表
- done_today：今日已完成（每天 0 点会重置）
- recurTemplates：循环任务模板（days 是 0=周日 ... 6=周六）
- recurDoneLog：循环任务完成记录，key 形如 "templateId_YYYY-MM-DD"
- cat：S=学习 / R=研究 / G=成长（健身阅读等） / C=杂事
- priority：urgent-important(红) / urgent-unimportant(橙) / important(蓝) / normal(绿)
- durPlan 计划分钟数，durActual 实际分钟数

优先级判定规则（如果用户问"帮我看优先级"或"调整优先级"，按此规则给建议）：
1) 重要：desc 含 论文/作业/报告/考试/答辩/项目/实验/文献/提交/交/due/deadline/ddl
2) 紧急：date 是今天或明天，或 deadline ≤ 3 天，或 desc 含 今天/明天/马上/立刻/紧急/尽快/截止
3) 组合：重要+紧急→红 / 重要→蓝 / 紧急→橙 / 都不→默认蓝（宁可高估）

回答要求：
- 语气像了解用户的朋友，简洁直接，不说教不重复问题
- 用中文回答
- 涉及具体任务时直接引用任务描述
- 给出可执行的建议，不要泛泛而谈
- 控制在 200 字以内，长答案用列表

【添加任务能力 — 重要】
如果用户的意图是"加任务/记下来/帮我加一个/提醒我..."等创建任务的请求：
1) 先在回复正文里用一句话确认你帮他加了什么（例如"好，已加上明天下午的跑步"）
2) 在回复的最后追加一行特殊标签，前端会解析这行并真正写入任务列表：
   <ADD_TASK>{"desc":"跑步","date":"YYYY-MM-DD","startTime":"HH:MM 或 null","durPlan":分钟数,"cat":"S/R/G/C","priority":"urgent-important/urgent-unimportant/important/normal"}</ADD_TASK>
3) 规则：
   - 一次只能加一个任务，desc 简短（30 字内）
   - date 用绝对日期（YYYY-MM-DD），今天就是 ${ctx.today}
   - 不知道的字段：startTime 用 null，durPlan 用 60，cat 用 C，priority 用 normal
   - 整个 <ADD_TASK>…</ADD_TASK> 必须是合法 JSON，前端会原样解析
   - 只有在用户明确要"加任务/记下来"时才输出这个标签，单纯聊天/查询不要输出`;
}

function renderAssistant() {
  const main = document.getElementById('main');
  const today = todayStr();
  const todayU = state.tasks.filter(t => t.date === today).length;
  const todayD = state.done.filter(t => t.date === today).length;
  const totalToday = todayU + todayD;

  main.innerHTML = `
    <div class="chat-toolbar">
      <button class="btn-secondary checkin-btn ${checkInMode ? 'is-active' : ''}" id="checkin-btn" style="padding:8px 14px; min-height:36px; font-size:13px">
        ${checkInMode ? '↻ 重新复盘' : '今日复盘'} <span class="rate">${todayD}/${totalToday}</span>
      </button>
      <span class="meta" style="margin-left:auto">${chatHistory.length} 条对话</span>
      <button class="btn-secondary" id="chat-clear" style="padding:6px 12px; min-height:32px; font-size:12px">新对话</button>
    </div>
    <div class="chat-scroll" id="chat-scroll"></div>
    <div class="chat-input-bar">
      <textarea id="chat-input" placeholder="${checkInMode ? '说说你今天的感受…' : '问点什么…例：今天还有什么没完成？'}" rows="1" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>
      <button class="btn-primary" id="chat-send" style="min-height:48px">发送</button>
    </div>
  `;

  renderChatMessages();

  main.querySelector('#checkin-btn').onclick = startCheckIn;

  const input = main.querySelector('#chat-input');
  const sendBtn = main.querySelector('#chat-send');

  // 自动高度
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  });

  // Enter 发送 / Shift+Enter 换行
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  sendBtn.onclick = doSend;

  main.querySelector('#chat-clear').onclick = () => {
    if (chatHistory.length === 0) return;
    if (confirm('清空当前对话历史？')) {
      chatHistory = [];
      renderAssistant();
    }
  };

  function doSend() {
    const text = input.value.trim();
    if (!text || chatLoading) return;
    input.value = '';
    input.style.height = 'auto';
    sendChatMessage(text);
  }
}

function renderChatMessages() {
  const box = document.getElementById('chat-scroll');
  if (!box) return;
  if (chatHistory.length === 0 && !chatLoading) {
    const suggestions = [
      '我今天还有什么没完成？',
      '这周 G 类时间够吗？',
      '帮我看看优先级有没有问题',
      '明天最重要的事是什么？'
    ];
    box.innerHTML = `
      <div class="chat-empty">
        <div class="big">✦</div>
        <div class="hint">问我任何关于你计划的问题</div>
        <div class="chat-suggestions">
          ${suggestions.map(s => `<button class="chat-suggestion" data-q="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}
        </div>
      </div>
    `;
    box.querySelectorAll('.chat-suggestion').forEach(btn => {
      btn.onclick = () => {
        const q = btn.dataset.q;
        sendChatMessage(q);
      };
    });
    return;
  }
  box.innerHTML = chatHistory.map(m => `
    <div class="chat-msg ${m.role}">
      <div class="bubble">${escapeHtml(m.content)}</div>
    </div>
  `).join('') + (chatLoading ? `
    <div class="chat-msg assistant loading">
      <div class="bubble">正在思考…</div>
    </div>
  ` : '');
  box.scrollTop = box.scrollHeight;
}

async function startCheckIn() {
  const apiKey = getApiKey();
  if (!apiKey) { toast('请先在设置中填入 API Key'); return; }
  // 切换到复盘模式，重置历史
  checkInMode = true;
  chatHistory = [];
  chatLoading = true;
  currentTab = 'assistant';
  document.querySelectorAll('.tabbar .tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === 'assistant');
  });
  render();

  try {
    const _ciCfg = getAiConfig();
    const resp = await fetch(QWEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: _ciCfg.provider,
        apiKey: _ciCfg.apiKey,
        baseURL: _ciCfg.baseURL || '',
        model: _ciCfg.model,
        max_tokens: 256,
        messages: [
          { role: 'system', content: buildCheckInSystemPrompt() },
          { role: 'user', content: '开始今日复盘，简短问候我并问我今天感觉怎么样' }
        ]
      })
    });
    if (!resp.ok) throw new Error('API ' + resp.status);
    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content || '今天感觉怎么样？';
    chatHistory.push({ role: 'assistant', content: reply });
  } catch(e) {
    chatHistory.push({ role: 'assistant', content: `复盘启动失败：${e.message}` });
  } finally {
    chatLoading = false;
    renderChatMessages();
    const tb = document.querySelector('.chat-toolbar .meta');
    if (tb) tb.textContent = `${chatHistory.length} 条对话`;
  }
}

// 从助手回复里抽取 <ADD_TASK>{...}</ADD_TASK> 标签，真正创建任务，并返回去掉标签后的文本
function handleAssistantAddTaskTags(reply) {
  const re = /<ADD_TASK>([\s\S]*?)<\/ADD_TASK>/g;
  let addedCount = 0;
  let m;
  while ((m = re.exec(reply)) !== null) {
    const jsonStr = m[1].trim();
    try {
      const obj = JSON.parse(jsonStr);
      if (!obj || typeof obj.desc !== 'string' || !obj.desc.trim()) continue;
      const t = makeTask({
        desc: obj.desc.trim(),
        date: (typeof obj.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.date)) ? obj.date : todayStr(),
        startTime: (typeof obj.startTime === 'string' && /^\d{2}:\d{2}$/.test(obj.startTime)) ? obj.startTime : null,
        durPlan: (typeof obj.durPlan === 'number' && obj.durPlan >= 5) ? obj.durPlan : 60,
        cat: (typeof obj.cat === 'string' && /^[SRGC]$/.test(obj.cat)) ? obj.cat : 'C',
        priority: (typeof obj.priority === 'string' && /^(urgent-important|urgent-unimportant|important|normal)$/.test(obj.priority)) ? obj.priority : 'normal'
      });
      state.tasks.push(t);
      addedCount++;
    } catch(e) {
      // 单条解析失败不影响其它
    }
  }
  const cleanText = reply.replace(re, '').replace(/\n{3,}/g, '\n\n').trim() || '已加好。';
  return { cleanText, addedCount };
}

async function sendChatMessage(text) {
  const apiKey = getApiKey();
  if (!apiKey) {
    chatHistory.push({ role: 'user', content: text });
    chatHistory.push({ role: 'assistant', content: '请先在设置中填入 API Key。' });
    renderChatMessages();
    return;
  }
  if (chatLoading) return;

  chatHistory.push({ role: 'user', content: text });
  chatLoading = true;
  renderChatMessages();

  try {
    const messages = [
      { role: 'system', content: buildAssistantSystemPrompt() },
      ...chatHistory
    ];
    const _chatCfg = getAiConfig();
    const resp = await fetch(QWEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: _chatCfg.provider,
        apiKey: _chatCfg.apiKey,
        baseURL: _chatCfg.baseURL || '',
        model: _chatCfg.model,
        max_tokens: 1024,
        messages
      })
    });

    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => '');
      chatHistory.push({ role: 'assistant', content: `API 调用失败（${resp.status}）。${errTxt ? errTxt.slice(0,200) : ''}` });
    } else {
      const data = await resp.json();
      const rawReply = data.choices?.[0]?.message?.content || '（没收到内容）';
      // 解析 <ADD_TASK>{...}</ADD_TASK> 动作标签，真正创建任务
      const { cleanText, addedCount } = handleAssistantAddTaskTags(rawReply);
      chatHistory.push({ role: 'assistant', content: cleanText });
      if (addedCount > 0) {
        saveState();
        render();
        toast(`已加入 ${addedCount} 个任务到计划`);
      }
    }
  } catch(e) {
    chatHistory.push({ role: 'assistant', content: `出错了：${e.message}` });
  } finally {
    chatLoading = false;
    renderChatMessages();
    // 刷新工具栏的消息计数
    const tb = document.querySelector('.chat-toolbar .meta');
    if (tb) tb.textContent = `已加载 ${state.tasks.length} 个待办 · ${(state.archive || []).length} 已完成 · ${chatHistory.length} 条对话`;
  }
}

/* ---------------- 日历订阅提醒 ---------------- */
function formatReminderLabel(minutes) {
  if (!minutes || minutes <= 0) return '提前 15 分钟提醒';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days} 天`);
  if (hours) parts.push(`${hours} 小时`);
  if (mins) parts.push(`${mins} 分钟`);
  return parts.length ? `提前 ${parts.join(' ')}提醒` : '提前 0 分钟提醒';
}
function icalAddR1(m) {
  const cur = parseInt(localStorage.getItem('ical_reminder_1') || '15', 10);
  localStorage.setItem('ical_reminder_1', String(cur + m));
  renderSettings();
}
function icalResetR1() {
  localStorage.setItem('ical_reminder_1', '15');
  renderSettings();
}
function icalToggleR2(checked) {
  if (checked) {
    const cur = parseInt(localStorage.getItem('ical_reminder_2') || '0', 10);
    if (cur <= 0) localStorage.setItem('ical_reminder_2', '15');
  } else {
    localStorage.setItem('ical_reminder_2', '0');
  }
  renderSettings();
}
function icalAddR2(m) {
  const cur = Math.max(1, parseInt(localStorage.getItem('ical_reminder_2') || '15', 10));
  localStorage.setItem('ical_reminder_2', String(cur + m));
  renderSettings();
}
function icalResetR2() {
  localStorage.setItem('ical_reminder_2', '15');
  renderSettings();
}

/* ---------------- 设置 ---------------- */
