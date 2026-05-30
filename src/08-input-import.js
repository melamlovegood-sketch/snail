function showDurationConfirmModal(parsed) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <h2>确认任务时长</h2>
    <p class="text-soft text-sm" style="margin-bottom:16px">未识别到时长，已为你估算，可调整后确认。</p>
    <div id="dur-list"></div>
    <div class="modal-actions">
      <button class="btn-secondary" id="cancel-dur">取消</button>
      <button class="btn-primary" id="confirm-dur">添加</button>
    </div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const list = modal.querySelector('#dur-list');
  parsed.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'modal-list-item';
    row.innerHTML = `
      <input type="checkbox" checked data-i="${i}">
      <div style="flex:1; min-width:0">
        <div style="font-weight:500">${escapeHtml(p.desc)}</div>
        <div class="text-xs text-soft">${fmtDate(p.date)}${p.startTime ? ' · '+p.startTime : ''} · ${p.cat}</div>
      </div>
      <input type="number" min="5" step="5" value="${p.durPlan ?? p.estimatedDur ?? 60}" style="width:70px" data-dur="${i}">
      <span class="text-xs text-soft">分</span>
    `;
    list.appendChild(row);
  });

  modal.querySelector('#cancel-dur').onclick = () => backdrop.remove();
  modal.querySelector('#confirm-dur').onclick = () => {
    let added = 0;
    parsed.forEach((p, i) => {
      const cb = modal.querySelector(`[data-i="${i}"]`);
      const dur = parseInt(modal.querySelector(`[data-dur="${i}"]`).value) || 60;
      if (cb.checked) {
        p.durPlan = dur;
        state.tasks.push(makeTask(p));
        added++;
      }
    });
    saveState();
    backdrop.remove();
    render();
    toast(`已添加 ${added} 个任务`);
  };
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) backdrop.remove();
  });
}

/* ---------------- AI: 截图解析 ---------------- */
// 上传图片后先暂存（不立即发送），等用户补一句文字再一起解析
let pendingParseImage = null; // { dataUrl, mediaType, name }

// 选好图片：转 dataUrl 暂存，并刷新输入区显示「图片已上传」的卡片
async function stageParseImage(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    toast('请上传图片文件');
    return;
  }
  const apiKey = getApiKey();
  if (!apiKey) { toast('请先在设置中填入 API Key'); return; }
  try {
    const dataUrl = await fileToDataUrl(file);
    pendingParseImage = { dataUrl, mediaType: file.type, name: file.name || '截图' };
  } catch(e) {
    toast('读取图片失败');
    return;
  }
  // 重渲染计划页以显示暂存卡片（renderPlans 会读取 pendingParseImage）
  if (currentTab === 'plans') render();
  else toast('图片已暂存，去「计划」页补充说明并解析');
}

function clearPendingParseImage() {
  pendingParseImage = null;
  if (currentTab === 'plans') render();
}

// 真正调用 AI 解析：使用已暂存的图片 + 用户补充的文字
async function handleImageUpload(extraText) {
  const apiKey = getApiKey();
  if (!apiKey) { toast('请先在设置中填入 API Key'); return; }
  if (!pendingParseImage) { toast('请先上传图片'); return; }

  const dataUrl = pendingParseImage.dataUrl;
  const base64 = dataUrl.split(',')[1];
  const mediaType = pendingParseImage.mediaType;
  const userNote = (extraText || '').trim();
  pendingParseImage = null;
  if (currentTab === 'plans') render();

  const loadingToast = showLoading('AI 正在解析图片');

  try {
    const today = todayStr();
    const sysPrompt = `今天日期是 ${today}。
请从图片中提取所有事项和截止日期，包括周期性事件。
返回 JSON 对象（不要 markdown，不要任何其它文字）：

{
  "tasks": [
    {
      "desc": "描述（10字以内，不含时间地点班级）",
      "date": "YYYY-MM-DD（单次任务的日期；循环任务填首次出现的日期）",
      "startTime": "HH:MM 或 null",
      "dur": 60,
      "cat": "S/R/G/C",
      "priority": "urgent-important/urgent-unimportant/important/normal",
      "deadline": "YYYY-MM-DD 或 null",
      "reminder": 30,
      "notes": "备注：地点/签到/参考链接等",
      "isRecur": false,
      "recurFreq": "daily/weekly 或 null",
      "recurWeekdays": []
    }
  ],
  "summary": "识别到 X 个任务，包括 X 个截止日期 / X 个循环事件"
}

规则：
- 课程表 → 每节课都创建一个 isRecur:true 的循环任务，recurFreq:"weekly"，recurWeekdays 用 [0=周日..6=周六]
- 群通知/作业列表 → 每个 DDL 一个单次任务，priority 用下面规则
- "每天/每周X/每节课/每周一三五" → 循环任务
- 一张截图里 5-20 个事项都要提取，不要漏

分类规则：
- 听课/抄作业/刷题/听讲座 → C，不是 S
- 只有"学习+具体内容"才归 S
- 论文/实验/文献/导师/组会 → R
- 游泳/健身/跑步/阅读/冥想 → G
- 其它（吃饭/通勤/会议/上课/作业等）→ C

优先级判定（必须严格按这套规则）：
1) 重要词：论文/作业/报告/考试/答辩/项目/实验/文献/提交/交/due/deadline/ddl
2) 紧急条件：date 是今天/明天 或 deadline ≤ 3 天 或 含 今天/明天/马上/立刻/紧急/尽快/截止
3) 组合：重要+紧急→urgent-important / 重要→important / 紧急→urgent-unimportant / 都不→默认 important (蓝)`;

    const _imgCfg = getAiConfig();
    const resp = await fetch(QWEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: _imgCfg.provider,
        apiKey: _imgCfg.apiKey,
        baseURL: _imgCfg.baseURL || '',
        model: _imgCfg.visionModel || _imgCfg.model,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: sysPrompt },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
              { type: 'text', text: '请解析此截图中的所有事项和截止日期，包括周期性事件，按上述格式返回 JSON。' + (userNote ? `\n\n用户补充说明（请结合理解）：${userNote}` : '') }
            ]
          }
        ]
      })
    });

    loadingToast.remove();
    if (!resp.ok) {
      const err = await resp.text();
      toast('API 调用失败');
      console.error(err);
      return;
    }
    const data = await resp.json();
    const txt = data.choices?.[0]?.message?.content || '';
    let parsed;
    try {
      // 兼容老格式：可能返回数组
      const objMatch = txt.match(/\{[\s\S]*\}/);
      const arrMatch = txt.match(/\[[\s\S]*\]/);
      if (objMatch) parsed = JSON.parse(objMatch[0]);
      else if (arrMatch) parsed = { tasks: JSON.parse(arrMatch[0]), summary: '' };
      else parsed = JSON.parse(txt);
    } catch(e) {
      toast('AI 返回格式异常');
      console.error(txt);
      return;
    }
    const tasks = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
    if (!Array.isArray(tasks) || tasks.length === 0) {
      toast('未识别到任务');
      return;
    }
    showImportGroupedModal(tasks, parsed.summary);
  } catch(e) {
    loadingToast.remove();
    toast('解析失败');
    console.error(e);
  }
}

function classifyImportItem(it) {
  if (it.isRecur) return 'recur';
  const today = todayStr();
  const d = it.date || today;
  if (d <= dateAdd(today, 1)) return 'urgent';        // 今天/明天/过期
  if (d <= dateAdd(today, 7)) return 'week';
  return 'later';
}

function showImportGroupedModal(tasks, summary) {
  const groups = { urgent: [], week: [], later: [], recur: [] };
  tasks.forEach((t, i) => { t.__i = i; groups[classifyImportItem(t)].push(t); });

  const groupLabels = {
    urgent: '今天 / 明天',
    week:   '本周内',
    later:  '本月及以后',
    recur:  '循环任务'
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <h2>AI 解析结果</h2>
    <p class="text-soft text-sm" style="margin-bottom:16px">${escapeHtml(summary || `共识别 ${tasks.length} 项`)}</p>
    <div id="ai-grouped">
      ${Object.keys(groupLabels).map(gk => {
        const list = groups[gk];
        if (list.length === 0) return '';
        return `
          <div class="import-group" data-group="${gk}">
            <div class="import-group-head">
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer; flex:1; text-transform:none; letter-spacing:0;">
                <input type="checkbox" class="grp-master" data-group="${gk}" checked>
                <span style="font-size:13px; font-weight:600; color:var(--text);">${groupLabels[gk]}</span>
                <span style="font-size:11px; color:var(--text-soft);">· ${list.length} 项</span>
              </label>
            </div>
            <div class="import-group-body">
              ${list.map(it => `
                <div class="modal-list-item">
                  <input type="checkbox" checked class="item-cb" data-i="${it.__i}">
                  <div style="flex:1; min-width:0">
                    <div style="font-weight:500">${escapeHtml(it.desc || '未命名')}</div>
                    <div class="text-xs text-soft" style="margin-top:2px">
                      ${it.isRecur
                        ? (it.recurFreq === 'daily' ? '每天' : '每周 ' + (it.recurWeekdays||[]).map(d=>'日一二三四五六'[d]).join('、'))
                        : fmtDate(it.date || todayStr())}
                      ${it.startTime ? ' · '+it.startTime : ''}
                       · ${it.cat || 'C'}
                       · ${it.priority || 'important'}
                      ${it.deadline ? ' · DDL '+it.deadline : ''}
                      ${it.notes ? ' · '+escapeHtml(it.notes) : ''}
                    </div>
                  </div>
                  <input type="number" min="5" step="5" value="${it.dur || 60}" style="width:70px" data-dur="${it.__i}">
                  <span class="text-xs text-soft">分</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" id="ai-cancel">取消</button>
      <button class="btn-primary" id="ai-confirm">添加选中</button>
    </div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // 组主复选 → 控制本组所有 item
  modal.querySelectorAll('.grp-master').forEach(m => {
    m.addEventListener('change', () => {
      const gk = m.dataset.group;
      modal.querySelectorAll(`.import-group[data-group="${gk}"] .item-cb`).forEach(cb => {
        cb.checked = m.checked;
      });
    });
  });
  // item 改变 → 同步组主状态（全选/部分/全空）
  modal.querySelectorAll('.item-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const grp = cb.closest('.import-group');
      const items = grp.querySelectorAll('.item-cb');
      const m = grp.querySelector('.grp-master');
      const checked = [...items].filter(x => x.checked).length;
      m.checked = checked === items.length;
      m.indeterminate = checked > 0 && checked < items.length;
    });
  });

  modal.querySelector('#ai-cancel').onclick = () => backdrop.remove();
  modal.querySelector('#ai-confirm').onclick = () => {
    let addedTasks = 0, addedRecur = 0;
    tasks.forEach(it => {
      const cb = modal.querySelector(`.item-cb[data-i="${it.__i}"]`);
      if (!cb || !cb.checked) return;
      const dur = parseInt(modal.querySelector(`[data-dur="${it.__i}"]`).value, 10) || 60;

      if (it.isRecur) {
        let days = [];
        if (it.recurFreq === 'daily') days = [0,1,2,3,4,5,6];
        else if (it.recurFreq === 'weekly' && Array.isArray(it.recurWeekdays) && it.recurWeekdays.length > 0) {
          days = it.recurWeekdays.filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
        } else {
          days = [1,2,3,4,5];
        }
        if (days.length === 0) days = [1];
        state.recurTemplates.push({
          id: uid(),
          desc: it.desc || '循环任务',
          cat: it.cat || 'C',
          priority: it.priority || 'normal',
          durPlan: dur,
          startTime: it.startTime || null,
          days: days.sort(),
          notes: it.notes || '',
          createdAt: todayStr()
        });
        addedRecur++;
      } else {
        state.tasks.push(makeTask({
          desc: it.desc || '未命名',
          cat: it.cat || 'C',
          priority: it.priority || 'important',
          date: it.date || todayStr(),
          startTime: it.startTime || null,
          deadline: it.deadline || null,
          durPlan: dur,
          notes: it.notes || ''
        }));
        addedTasks++;
      }
    });
    saveState();
    if (addedRecur > 0) dailyTick();   // 循环模板需要立即注入实例
    backdrop.remove();
    render();
    toast(`已添加 ${addedTasks} 个任务${addedRecur > 0 ? `，${addedRecur} 个循环` : ''}`);
  };

  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
}

/* AI 文字解析结果：逐个任务的完整可编辑详情弹框 */
function showAIParseDetailModal(tasks, summary) {
  if (!Array.isArray(tasks) || tasks.length === 0) { toast('未识别到任务'); return; }

  const catItems = [['S','S 学习'],['R','R 研究'],['G','G 成长'],['C','C 杂事']];
  const priItems = [
    ['urgent-important','紧急 · 重要'],
    ['urgent-unimportant','紧急 · 不重要'],
    ['important','重要 · 不紧急'],
    ['normal','不重要 · 不紧急']
  ];
  const dayNames = ['日','一','二','三','四','五','六'];
  const today = todayStr();
  const _globalR1 = parseInt(localStorage.getItem('ical_reminder_1') || '15', 10);
  const multi = tasks.length > 1;

  // 每个任务的提醒状态（AI 的 reminder 分钟数作为自定义初始值）
  const rem = tasks.map(t => ({
    enabled: t.reminderEnabled !== false,
    override: (typeof t.reminder === 'number' && t.reminder > 0) ? t.reminder : null
  }));
  const remText = i => rem[i].override === null
    ? `使用全局设置（提前 ${_globalR1} 分钟）`
    : '自定义：' + formatReminderLabel(rem[i].override);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';

  const cardHTML = (t, i) => {
    const cat = t.cat || 'C';
    const pri = t.priority || 'important';
    const isRecur = !!t.isRecur;
    const freq = t.recurFreq === 'daily' ? 'daily' : 'weekly';
    const days = Array.isArray(t.recurWeekdays) ? t.recurWeekdays.filter(d => d >= 0 && d <= 6) : [];
    const recurBlock = isRecur ? `
      <div class="form-group">
        <label>循环频率</label>
        <div class="td-chips ai-freq">
          <button type="button" data-v="daily" class="${freq==='daily'?'active':''}">每天</button>
          <button type="button" data-v="weekly" class="${freq==='weekly'?'active':''}">每周</button>
        </div>
      </div>
      <div class="form-group ai-days-wrap" style="${freq==='weekly'?'':'display:none'}">
        <label>循环日（多选）</label>
        <div class="td-chips ai-days">
          ${dayNames.map((n,di)=>`<button type="button" data-v="${di}" class="${days.includes(di)?'active':''}">周${n}</button>`).join('')}
        </div>
      </div>
    ` : '';

    return `
    <div class="ai-task-card" data-i="${i}" style="${multi ? 'border:1px solid var(--border-soft);border-radius:var(--radius-sm);padding:14px;margin-bottom:14px;' : ''}">
      ${multi ? `
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;margin-bottom:10px;">
          <input type="checkbox" class="ai-include" checked style="width:auto;min-height:auto;margin:0;">
          <span style="font-weight:600;font-size:14px;color:var(--text);">任务 ${i+1}${isRecur ? ' · 循环' : ''}</span>
        </label>
      ` : `<input type="checkbox" class="ai-include" checked hidden>`}

      <div class="form-group">
        <label>描述</label>
        <input type="text" class="ai-desc" value="${escapeHtml(t.desc || '')}">
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>日期</label>
          <input type="date" class="ai-date" value="${t.date || today}">
        </div>
        <div class="form-group">
          <label>开始时间</label>
          <input type="time" class="ai-startTime" value="${t.startTime || ''}">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>计划时长（分钟）</label>
          <input type="number" class="ai-durPlan" value="${t.dur || 60}" min="5" step="5">
        </div>
        <div class="form-group">
          <label>截止日期</label>
          <input type="date" class="ai-deadline" value="${t.deadline || ''}">
        </div>
      </div>

      <div class="form-group">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <label style="margin:0">截止提醒 🔔</label>
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
            <span class="ai-rem-label" style="font-size:12px;color:var(--text-soft)">${rem[i].enabled ? '开' : '关'}</span>
            <input type="checkbox" class="ai-rem-toggle" ${rem[i].enabled ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent,#4f7cff)">
          </label>
        </div>
        <div class="ai-rem-opts" style="${rem[i].enabled ? '' : 'display:none'};margin-top:8px">
          <div class="ai-rem-display" style="font-size:13px;color:var(--accent,#4f7cff);margin-bottom:8px">${remText(i)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="btn-secondary ai-r" data-m="1" style="font-size:13px;padding:6px 10px">+1分钟</button>
            <button type="button" class="btn-secondary ai-r" data-m="15" style="font-size:13px;padding:6px 10px">+15分钟</button>
            <button type="button" class="btn-secondary ai-r" data-m="60" style="font-size:13px;padding:6px 10px">+1小时</button>
            <button type="button" class="btn-secondary ai-r" data-m="1440" style="font-size:13px;padding:6px 10px">+1天</button>
            <button type="button" class="btn-secondary ai-r-reset" style="font-size:13px;padding:6px 10px">重置</button>
          </div>
        </div>
      </div>

      ${recurBlock}

      <div class="form-group">
        <label>分类</label>
        <div class="td-chips ai-cat">
          ${catItems.map(([k,l]) => `<button type="button" data-v="${k}" class="${cat===k?'active':''}">${l}</button>`).join('')}
        </div>
      </div>

      <div class="form-group">
        <label>优先级</label>
        <div class="td-chips ai-pri">
          ${priItems.map(([k,l]) => `<button type="button" data-v="${k}" class="${pri===k?'active':''}">${l}</button>`).join('')}
        </div>
      </div>

      <div class="form-group">
        <label>备注</label>
        <textarea class="ai-notes" rows="2" placeholder="例如：地点、需要签到签退、参考资料链接等">${escapeHtml(t.notes || '')}</textarea>
      </div>
    </div>`;
  };

  modal.innerHTML = `
    <h2>AI 解析详情</h2>
    <p class="text-soft text-sm" style="margin-bottom:16px">${escapeHtml(summary || `共识别 ${tasks.length} 项，可编辑后添加`)}</p>
    ${tasks.map(cardHTML).join('')}
    <div class="modal-actions">
      <button class="btn-secondary" id="ai-cancel">取消</button>
      <button class="btn-primary" id="ai-confirm">${multi ? '添加选中' : '添加'}</button>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // chip 选择：cat/pri/freq 单选，days 多选；freq 切换控制循环日显隐
  modal.querySelectorAll('.td-chips').forEach(group => {
    const isMulti = group.classList.contains('ai-days');
    group.addEventListener('click', e => {
      const btn = e.target.closest('button[data-v]');
      if (!btn) return;
      if (isMulti) { btn.classList.toggle('active'); return; }
      group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (group.classList.contains('ai-freq')) {
        const card = group.closest('.ai-task-card');
        const daysWrap = card.querySelector('.ai-days-wrap');
        if (daysWrap) daysWrap.style.display = (btn.dataset.v === 'weekly') ? '' : 'none';
      }
    });
  });

  // 每张卡片的提醒交互
  modal.querySelectorAll('.ai-task-card').forEach((card, i) => {
    const toggle = card.querySelector('.ai-rem-toggle');
    const opts = card.querySelector('.ai-rem-opts');
    const label = card.querySelector('.ai-rem-label');
    const display = card.querySelector('.ai-rem-display');
    const refresh = () => { display.textContent = remText(i); };
    toggle.addEventListener('change', e => {
      rem[i].enabled = e.target.checked;
      label.textContent = rem[i].enabled ? '开' : '关';
      opts.style.display = rem[i].enabled ? '' : 'none';
    });
    card.querySelectorAll('.ai-r').forEach(b => b.addEventListener('click', () => {
      const m = parseInt(b.dataset.m, 10);
      rem[i].override = (rem[i].override === null) ? m : rem[i].override + m;
      refresh();
    }));
    card.querySelector('.ai-r-reset').addEventListener('click', () => { rem[i].override = null; refresh(); });
  });

  const close = () => backdrop.remove();
  modal.querySelector('#ai-cancel').onclick = close;

  modal.querySelector('#ai-confirm').onclick = () => {
    let addedTasks = 0, addedRecur = 0;
    modal.querySelectorAll('.ai-task-card').forEach((card, i) => {
      const inc = card.querySelector('.ai-include');
      if (inc && !inc.checked) return;
      const desc = card.querySelector('.ai-desc').value.trim();
      if (!desc) return;
      const date = card.querySelector('.ai-date').value || today;
      const startTime = card.querySelector('.ai-startTime').value || null;
      const durPlan = parseInt(card.querySelector('.ai-durPlan').value, 10) || 60;
      const deadline = card.querySelector('.ai-deadline').value || null;
      const catEl = card.querySelector('.ai-cat button.active');
      const priEl = card.querySelector('.ai-pri button.active');
      const cat = catEl ? catEl.dataset.v : 'C';
      const priority = priEl ? priEl.dataset.v : 'important';
      const notes = card.querySelector('.ai-notes').value;

      if (tasks[i].isRecur) {
        const freqBtn = card.querySelector('.ai-freq button.active');
        const freq = freqBtn ? freqBtn.dataset.v : 'weekly';
        let days;
        if (freq === 'daily') days = [0,1,2,3,4,5,6];
        else {
          days = Array.from(card.querySelectorAll('.ai-days button.active')).map(b => parseInt(b.dataset.v, 10));
          if (days.length === 0) days = [1,2,3,4,5];
        }
        state.recurTemplates.push({
          id: uid(), desc, cat, priority, durPlan,
          startTime, days: days.sort(), notes, createdAt: today
        });
        addedRecur++;
      } else {
        const task = makeTask({ desc, cat, priority, date, startTime, deadline, durPlan, notes });
        task.reminderEnabled = rem[i].enabled;
        task.reminderOverride = rem[i].override;
        task.priorityManualOverride = true;  // 用户已核对优先级，避免被自动重判
        state.tasks.push(task);
        addedTasks++;
      }
    });

    if (addedTasks === 0 && addedRecur === 0) { toast('没有选中可添加的任务'); return; }
    saveState();
    if (addedRecur > 0) dailyTick();
    close();
    render();
    toast(`已添加 ${addedTasks} 个任务${addedRecur > 0 ? `，${addedRecur} 个循环` : ''}`);
  };

  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
}

// 保留旧名称作为别名供其它代码引用
function showAITaskConfirmModal(tasks) { return showImportGroupedModal(tasks, ''); }

function __removed_showAITaskConfirmModal_old(tasks) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <h2>AI 解析结果</h2>
    <p class="text-soft text-sm" style="margin-bottom:16px">勾选要添加的任务，可调整时长。</p>
    <div id="ai-list"></div>
    <div class="modal-actions">
      <button class="btn-secondary" id="cancel-ai">取消</button>
      <button class="btn-primary" id="confirm-ai">添加选中</button>
    </div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const list = modal.querySelector('#ai-list');
  tasks.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'modal-list-item';
    row.innerHTML = `
      <input type="checkbox" checked data-i="${i}">
      <div style="flex:1; min-width:0">
        <div style="font-weight:500">${escapeHtml(t.desc || '未命名')}</div>
        <div class="text-xs text-soft">${fmtDate(t.date || todayStr())}${t.startTime ? ' · '+t.startTime : ''} · ${t.cat || 'C'} · ${t.priority || 'normal'}${t.deadline ? ' · DDL '+t.deadline : ''}${t.notes ? ' · '+escapeHtml(t.notes) : ''}</div>
      </div>
      <input type="number" min="5" step="5" value="${t.dur || 60}" style="width:70px" data-dur="${i}">
      <span class="text-xs text-soft">分</span>
    `;
    list.appendChild(row);
  });

  modal.querySelector('#cancel-ai').onclick = () => backdrop.remove();
  modal.querySelector('#confirm-ai').onclick = () => {
    let added = 0;
    tasks.forEach((t, i) => {
      const cb = modal.querySelector(`[data-i="${i}"]`);
      const dur = parseInt(modal.querySelector(`[data-dur="${i}"]`).value) || 60;
      if (cb.checked) {
        state.tasks.push(makeTask({
          desc: t.desc || '未命名',
          cat: t.cat || 'C',
          priority: t.priority || 'normal',
          date: t.date || todayStr(),
          startTime: t.startTime || null,
          deadline: t.deadline || null,
          durPlan: dur,
          notes: t.notes || ''
        }));
        added++;
      }
    });
    saveState();
    backdrop.remove();
    render();
    toast(`已添加 ${added} 个任务`);
  };
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) backdrop.remove();
  });
}

function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

