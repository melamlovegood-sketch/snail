function showLoading(text) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span class="spinner"></span> &nbsp;${text}`;
  t.classList.add('show');
  return { remove: () => { t.classList.remove('show'); t.textContent = ''; } };
}

/* ---------------- 优先级 / 分类切换菜单 ---------------- */
function closePopover() {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
  }
}
document.addEventListener('click', e => {
  if (activePopover && !activePopover.contains(e.target)) closePopover();
});

function showCatPicker(taskId, anchorEl) {
  closePopover();
  const cats = [
    { k: 'S', label: 'Studying 学习', color: 'var(--cat-s)' },
    { k: 'R', label: 'Research 研究', color: 'var(--cat-r)' },
    { k: 'G', label: 'Growth 成长', color: 'var(--cat-g)' },
    { k: 'C', label: 'Chores 杂事', color: 'var(--cat-c)' }
  ];
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.innerHTML = cats.map(c => `
    <div class="pop-item" data-cat="${c.k}">
      <span class="pop-dot" style="background:${c.color}"></span>
      <span>${c.label}</span>
    </div>
  `).join('');
  positionPopover(pop, anchorEl);
  pop.querySelectorAll('.pop-item').forEach(el => {
    el.onclick = e => {
      e.stopPropagation();
      const t = findTask(taskId);
      if (t) { t.cat = el.dataset.cat; saveState(); render(); }
      closePopover();
    };
  });
  document.body.appendChild(pop);
  activePopover = pop;
}

function showPriorityPicker(taskId, anchorEl) {
  closePopover();
  const pris = [
    { k: 'urgent-important', label: '紧急 · 重要', color: 'var(--pri-urgent-important)' },
    { k: 'urgent-unimportant', label: '紧急 · 不重要', color: 'var(--pri-urgent-unimportant)' },
    { k: 'important', label: '重要 · 不紧急', color: 'var(--pri-important)' },
    { k: 'normal', label: '不重要 · 不紧急', color: 'var(--pri-normal)' }
  ];
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.innerHTML = pris.map(p => `
    <div class="pop-item" data-pri="${p.k}">
      <span class="pop-dot" style="background:${p.color}"></span>
      <span>${p.label}</span>
    </div>
  `).join('');
  positionPopover(pop, anchorEl);
  pop.querySelectorAll('.pop-item').forEach(el => {
    el.onclick = e => {
      e.stopPropagation();
      const t = findTask(taskId);
      if (t) {
        t.priority = el.dataset.pri;
        t.priorityManualOverride = true;
        saveState();
        render();
      }
      closePopover();
    };
  });
  document.body.appendChild(pop);
  activePopover = pop;
}

function positionPopover(pop, anchor) {
  const r = anchor.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.top = (r.bottom + 6) + 'px';
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 200)) + 'px';
}

function findTask(id) {
  return state.tasks.find(t => t.id === id) || state.done.find(t => t.id === id);
}

/* ---------------- 计时器 ---------------- */
function startTimer(taskId) {
  const t = findTask(taskId);
  if (!t) return;
  if (t.timerState === 'idle') {
    t.timerStart = Date.now();
    t.timerPaused = 0;
    t.timerState = 'running';
  } else if (t.timerState === 'paused') {
    t.timerStart = Date.now() - t.timerPaused;
    t.timerState = 'running';
  }
  saveState();
  render();
}
function pauseTimer(taskId) {
  const t = findTask(taskId);
  if (!t || t.timerState !== 'running') return;
  t.timerPaused = Date.now() - t.timerStart;
  t.timerState = 'paused';
  saveState();
  render();
}
function stopTimer(taskId) {
  const t = findTask(taskId);
  if (!t) return;
  let elapsed = 0;
  if (t.timerState === 'running') elapsed = Date.now() - t.timerStart;
  else if (t.timerState === 'paused') elapsed = t.timerPaused;
  // 不足 60s 视为误点（点开播放又秒停），重置回 idle，不污染 durActual
  if (elapsed < 60000) {
    t.timerStart = null;
    t.timerPaused = 0;
    t.timerState = 'idle';
    saveState();
    render();
    return;
  }
  t.durActual = Math.round(elapsed / 60000);
  t.timerState = 'done';
  saveState();
  render();
}
function getTimerElapsed(t) {
  if (t.timerState === 'running') return Date.now() - t.timerStart;
  if (t.timerState === 'paused') return t.timerPaused;
  return 0;
}
function startTimerTick() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    // 只更新计时显示，不重渲染整个视图
    document.querySelectorAll('[data-timer-display]').forEach(el => {
      const id = el.dataset.timerDisplay;
      const t = findTask(id);
      if (t && t.timerState === 'running') {
        el.textContent = fmtTimer(getTimerElapsed(t));
      }
    });
  }, 1000);
}

/* ---------------- 完成任务 ---------------- */
function toggleComplete(taskId) {
  const isCurrentlyDone = state.done.some(t => t.id === taskId);
  if (!isCurrentlyDone) {
    // 任务勾选完成：先执行下滑淡出动画，200ms 后再更新状态
    const cardEl = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
    if (cardEl) {
      const animTarget = cardEl.closest('.swipe-wrap') || cardEl;
      animTarget.style.transition = 'transform 200ms ease-in-out, opacity 200ms ease-in-out';
      animTarget.style.transform = 'translateY(24px)';
      animTarget.style.opacity = '0';
      animTarget.style.pointerEvents = 'none';
      setTimeout(() => _doToggleComplete(taskId), 200);
      return;
    }
  }
  _doToggleComplete(taskId);
}

function _doToggleComplete(taskId) {
  let idx = state.tasks.findIndex(t => t.id === taskId);
  if (idx >= 0) {
    const t = state.tasks[idx];
    // 如果计时未停止，自动结束
    if (t.timerState === 'running' || t.timerState === 'paused') {
      let elapsed = t.timerState === 'running' ? Date.now() - t.timerStart : t.timerPaused;
      // 计时不足 60s 视为未真正使用计时器，按计划时长记录，避免出现 "1h30m → 1分钟" 这种异常显示
      t.durActual = elapsed >= 60000 ? Math.round(elapsed / 60000) : (t.durActual != null ? t.durActual : t.durPlan);
    } else if (t.durActual == null) {
      t.durActual = t.durPlan;
    }
    t.timerState = 'done';
    // 完成时清零拖延计数和 sortOrder
    t.rolloverCount = 0;
    t.rollover = false;
    t.sortOrder = null;
    // 循环任务：记录完成日志
    if (t.recurId) {
      state.recurDoneLog[`${t.recurId}_${t.date}`] = { actual: t.durActual, ts: Date.now() };
    }
    state.tasks.splice(idx, 1);
    state.done.push(t);
    // 完成的任务在云端软删除（next 同步周期 done 不再上推）
    cloudSoftDelete(t.id);
    // 仅当任务属于今日时计入里程
    if (t.date === todayStr()) {
      awardMileageOnComplete(t);
    }
    // 如果是专注任务，延迟 800ms 移出专注区块（保留完成动效）
    if (focusPins.includes(t.id)) {
      setTimeout(() => {
        focusPins = focusPins.filter(id => id !== t.id);
        saveFocusPins();
        render();
      }, 800);
    }
  } else {
    idx = state.done.findIndex(t => t.id === taskId);
    if (idx >= 0) {
      const t = state.done[idx];
      t.timerState = 'idle';
      if (t.recurId) {
        delete state.recurDoneLog[`${t.recurId}_${t.date}`];
      }
      state.done.splice(idx, 1);
      state.tasks.push(t);
      if (t.date === todayStr()) recomputeDailyRate();
    }
  }
  saveState();
  render();
  // 状态切换动画：在 render 之后，蜗牛 SVG 容器仍是同一个 DOM
  updateSnailStatus();
}

/* ---------------- 删除任务 ---------------- */
function deleteTask(taskId) {
  state.tasks = state.tasks.filter(t => t.id !== taskId);
  state.done = state.done.filter(t => t.id !== taskId);
  saveState();
  cloudSoftDelete(taskId);
  render();
}

/* ---------------- 任务详情模态框 ---------------- */
function showTaskDetailModal(taskId) {
  closePopover();
  const t = findTask(taskId);
  if (!t) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';

  const catItems = [['S','S 学习'],['R','R 研究'],['G','G 成长'],['C','C 杂事']];
  const priItems = [
    ['urgent-important','紧急 · 重要'],
    ['urgent-unimportant','紧急 · 不重要'],
    ['important','重要 · 不紧急'],
    ['normal','不重要 · 不紧急']
  ];

  // 提醒状态（任务级别）
  const _globalR1 = parseInt(localStorage.getItem('ical_reminder_1') || '15', 10);
  let _remEnabled = t.reminderEnabled !== false;
  let _remOverride = t.reminderOverride ?? null;

  function _getRemText() {
    if (_remOverride === null) return `使用全局设置（提前 ${_globalR1} 分钟）`;
    return '自定义：' + formatReminderLabel(_remOverride);
  }

  // 循环任务额外信息
  const tpl = t.isRecur && t.recurId ? state.recurTemplates.find(x => x.id === t.recurId) : null;
  const recurInfoBlock = tpl ? `
    <div class="form-group" style="background: var(--bg-soft); padding: 12px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-soft);">
      <div style="font-size: 12px; color: var(--text-soft); margin-bottom: 6px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase;">↻ 循环任务</div>
      <div style="font-size: 14px;">频率：${fmtRecurDays(tpl.days)}</div>
      <div style="font-size: 14px; margin-top: 4px;">连续打卡：🔥 ${computeStreak(tpl.id)} 天</div>
    </div>
    <div class="form-group">
      <label style="display:flex; align-items:center; gap:10px; cursor:pointer; text-transform:none; letter-spacing:0; font-weight:500; color:var(--text);">
        <input type="checkbox" id="td-sync-template" style="width:auto; min-height:auto; margin:0;">
        <span style="font-size:14px;">同步修改循环模板（影响所有未来未完成实例）</span>
      </label>
    </div>
  ` : '';

  modal.innerHTML = `
    <h2>任务详情</h2>
    ${recurInfoBlock}

    <div class="form-group">
      <label>描述</label>
      <input type="text" id="td-desc" value="${escapeHtml(t.desc)}">
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>日期</label>
        <input type="date" id="td-date" value="${t.date}">
      </div>
      <div class="form-group">
        <label>开始时间</label>
        <input type="time" id="td-startTime" value="${t.startTime || ''}">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>计划时长（分钟）</label>
        <input type="number" id="td-durPlan" value="${t.durPlan}" min="5" step="5">
      </div>
      <div class="form-group">
        <label>截止日期</label>
        <input type="date" id="td-deadline" value="${t.deadline || ''}">
      </div>
    </div>

    <div class="form-group">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <label style="margin:0">截止提醒 🔔</label>
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
          <span id="td-rem-label" style="font-size:12px;color:var(--text-soft)">${_remEnabled ? '开' : '关'}</span>
          <input type="checkbox" id="td-rem-toggle" ${_remEnabled ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent,#4f7cff)">
        </label>
      </div>
      <div id="td-rem-opts" style="${_remEnabled ? '' : 'display:none'};margin-top:8px">
        <div id="td-rem-display" style="font-size:13px;color:var(--accent,#4f7cff);margin-bottom:8px">${_getRemText()}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn-secondary" style="font-size:13px;padding:6px 10px" id="td-r-add1">+1分钟</button>
          <button type="button" class="btn-secondary" style="font-size:13px;padding:6px 10px" id="td-r-add15">+15分钟</button>
          <button type="button" class="btn-secondary" style="font-size:13px;padding:6px 10px" id="td-r-add60">+1小时</button>
          <button type="button" class="btn-secondary" style="font-size:13px;padding:6px 10px" id="td-r-add1440">+1天</button>
          <button type="button" class="btn-secondary" style="font-size:13px;padding:6px 10px" id="td-r-reset">重置</button>
        </div>
      </div>
    </div>

    <div class="form-group">
      <label>分类</label>
      <div class="td-chips" id="td-cat">
        ${catItems.map(([k,l]) => `<button type="button" data-v="${k}" class="${t.cat===k?'active':''}">${l}</button>`).join('')}
      </div>
    </div>

    <div class="form-group">
      <label>优先级</label>
      <div class="td-chips" id="td-pri">
        ${priItems.map(([k,l]) => `<button type="button" data-v="${k}" class="${t.priority===k?'active':''}">${l}</button>`).join('')}
      </div>
    </div>

    <div class="form-group">
      <label>备注</label>
      <textarea id="td-notes" rows="3" placeholder="例如：地点、需要签到签退、参考资料链接等">${escapeHtml(t.notes || '')}</textarea>
    </div>

    <div class="modal-actions">
      <button class="btn-secondary" id="td-decompose" style="margin-right:auto">✦ AI 拆解任务</button>
      ${t.date === todayStr() ? `<button class="btn-secondary" id="td-focus">${focusPins.includes(t.id) ? '📌 取消专注' : '📌 加入今日专注'}</button>` : ''}
      <button class="btn-secondary" id="td-cancel">取消</button>
      <button class="btn-primary" id="td-save">保存</button>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  modal.querySelector('#td-decompose').onclick = () => {
    backdrop.remove();
    decomposeTask(t.id);
  };
  const focusBtn = modal.querySelector('#td-focus');
  if (focusBtn) focusBtn.onclick = () => {
    backdrop.remove();
    togglePin(t.id);
  };

  // 提醒区域事件
  modal.querySelector('#td-rem-toggle').addEventListener('change', e => {
    _remEnabled = e.target.checked;
    modal.querySelector('#td-rem-label').textContent = _remEnabled ? '开' : '关';
    modal.querySelector('#td-rem-opts').style.display = _remEnabled ? '' : 'none';
  });
  function _updateRemDisplay() {
    modal.querySelector('#td-rem-display').textContent = _getRemText();
  }
  function _addRem(m) {
    _remOverride = (_remOverride === null) ? m : _remOverride + m;
    _updateRemDisplay();
  }
  modal.querySelector('#td-r-add1').addEventListener('click', () => _addRem(1));
  modal.querySelector('#td-r-add15').addEventListener('click', () => _addRem(15));
  modal.querySelector('#td-r-add60').addEventListener('click', () => _addRem(60));
  modal.querySelector('#td-r-add1440').addEventListener('click', () => _addRem(1440));
  modal.querySelector('#td-r-reset').addEventListener('click', () => { _remOverride = null; _updateRemDisplay(); });

  // chip 单选
  modal.querySelectorAll('.td-chips').forEach(group => {
    group.addEventListener('click', e => {
      const btn = e.target.closest('button[data-v]');
      if (!btn) return;
      group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const close = () => backdrop.remove();
  modal.querySelector('#td-cancel').onclick = close;

  modal.querySelector('#td-save').onclick = () => {
    const newDesc = modal.querySelector('#td-desc').value.trim();
    if (!newDesc) { toast('描述不能为空'); return; }

    const newDeadline = modal.querySelector('#td-deadline').value || null;
    if (newDeadline !== (t.deadline || null)) {
      // deadline 变更，让下次 dailyTick 重新评估紧急升级
      t.deadlineUrgencyApplied = false;
    }

    t.desc = newDesc;
    t.date = modal.querySelector('#td-date').value || todayStr();
    const newStartTime = modal.querySelector('#td-startTime').value || null;
    // 用户改动了开始时间 → 视为转为精确时间，清空模糊标签
    if (t.timeLabel && newStartTime !== (t.startTime || null)) {
      t.timeLabel = null;
      t.endTime = null;
    }
    t.startTime = newStartTime;
    t.durPlan = parseInt(modal.querySelector('#td-durPlan').value, 10) || 60;
    t.deadline = newDeadline;
    t.notes = modal.querySelector('#td-notes').value;
    t.reminderEnabled = _remEnabled;
    t.reminderOverride = _remOverride;

    const selCat = modal.querySelector('#td-cat button.active');
    if (selCat) t.cat = selCat.dataset.v;

    const selPri = modal.querySelector('#td-pri button.active');
    if (selPri && selPri.dataset.v !== t.priority) {
      t.priority = selPri.dataset.v;
      t.priorityManualOverride = true;
    }

    // 循环任务同步到模板及未来未完成实例
    let syncedCount = 0;
    const syncBox = modal.querySelector('#td-sync-template');
    if (syncBox && syncBox.checked && t.isRecur && t.recurId) {
      const tplRef = state.recurTemplates.find(x => x.id === t.recurId);
      if (tplRef) {
        tplRef.desc = t.desc;
        tplRef.cat = t.cat;
        tplRef.priority = t.priority;
        tplRef.durPlan = t.durPlan;
        tplRef.startTime = t.startTime;
        tplRef.notes = t.notes;
        const today = todayStr();
        state.tasks.forEach(other => {
          if (other.recurId === tplRef.id && other.id !== t.id && other.date >= today && other.timerState !== 'done') {
            other.desc = t.desc;
            other.cat = t.cat;
            other.priority = t.priority;
            other.durPlan = t.durPlan;
            other.startTime = t.startTime;
            other.notes = t.notes;
            syncedCount++;
          }
        });
      }
    }

    saveState();
    close();
    render();
    toast(syncedCount > 0 ? `已保存，同步 ${syncedCount} 个未来实例` : '已保存');
  };

  // 点击模态外部关闭
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) close();
  });
}

/* ---------------- 循环模板编辑模态框 ---------------- */
function showRecurTemplateModal(tplId) {
  closePopover();
  const tpl = state.recurTemplates.find(x => x.id === tplId);
  if (!tpl) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';

  const catItems = [['S','S 学习'],['R','R 研究'],['G','G 成长'],['C','C 杂事']];
  const priItems = [
    ['urgent-important','紧急 · 重要'],
    ['urgent-unimportant','紧急 · 不重要'],
    ['important','重要 · 不紧急'],
    ['normal','不重要 · 不紧急']
  ];
  const dayNames = ['日','一','二','三','四','五','六'];
  const streak = computeStreak(tpl.id);

  modal.innerHTML = `
    <h2>编辑循环模板</h2>

    <div class="form-group" style="background: var(--bg-soft); padding: 12px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-soft);">
      <div style="font-size: 14px;">当前频率：${fmtRecurDays(tpl.days)}</div>
      <div style="font-size: 14px; margin-top: 4px;">连续打卡：🔥 ${streak} 天</div>
    </div>

    <div class="form-group">
      <label>描述</label>
      <input type="text" id="rt-desc" value="${escapeHtml(tpl.desc)}">
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>计划时长（分钟）</label>
        <input type="number" id="rt-durPlan" value="${tpl.durPlan}" min="5" step="5">
      </div>
      <div class="form-group">
        <label>开始时间</label>
        <input type="time" id="rt-startTime" value="${tpl.startTime || ''}">
      </div>
    </div>

    <div class="form-group">
      <label>分类</label>
      <div class="td-chips" id="rt-cat">
        ${catItems.map(([k,l]) => `<button type="button" data-v="${k}" class="${tpl.cat===k?'active':''}">${l}</button>`).join('')}
      </div>
    </div>

    <div class="form-group">
      <label>优先级</label>
      <div class="td-chips" id="rt-pri">
        ${priItems.map(([k,l]) => `<button type="button" data-v="${k}" class="${(tpl.priority||'normal')===k?'active':''}">${l}</button>`).join('')}
      </div>
    </div>

    <div class="form-group">
      <label>循环日（多选）</label>
      <div class="td-chips" id="rt-days">
        ${dayNames.map((n, i) => `<button type="button" data-v="${i}" class="${tpl.days.includes(i)?'active':''}">周${n}</button>`).join('')}
      </div>
    </div>

    <div class="form-group">
      <label>备注（新实例会继承）</label>
      <textarea id="rt-notes" rows="3" placeholder="例如：地点、提醒事项">${escapeHtml(tpl.notes || '')}</textarea>
    </div>

    <div class="modal-actions">
      <button class="btn-secondary" id="rt-delete" style="margin-right:auto; color:var(--pri-urgent-important)">删除循环</button>
      <button class="btn-secondary" id="rt-cancel">取消</button>
      <button class="btn-primary" id="rt-save">保存并同步</button>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // chip 单选 / days 多选
  modal.querySelectorAll('.td-chips').forEach(group => {
    const multi = group.id === 'rt-days';
    group.addEventListener('click', e => {
      const btn = e.target.closest('button[data-v]');
      if (!btn) return;
      if (multi) btn.classList.toggle('active');
      else {
        group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    });
  });

  const close = () => backdrop.remove();
  modal.querySelector('#rt-cancel').onclick = close;
  modal.querySelector('#rt-delete').onclick = () => {
    close();
    deleteRecur(tpl.id);
  };

  modal.querySelector('#rt-save').onclick = () => {
    const newDesc = modal.querySelector('#rt-desc').value.trim();
    if (!newDesc) { toast('描述不能为空'); return; }
    const selectedDays = Array.from(modal.querySelectorAll('#rt-days button.active')).map(b => parseInt(b.dataset.v, 10));
    if (selectedDays.length === 0) { toast('至少选一个循环日'); return; }

    tpl.desc = newDesc;
    tpl.durPlan = parseInt(modal.querySelector('#rt-durPlan').value, 10) || 60;
    tpl.startTime = modal.querySelector('#rt-startTime').value || null;
    const selCat = modal.querySelector('#rt-cat button.active');
    if (selCat) tpl.cat = selCat.dataset.v;
    const selPri = modal.querySelector('#rt-pri button.active');
    if (selPri) tpl.priority = selPri.dataset.v;
    tpl.days = selectedDays.sort();
    tpl.notes = modal.querySelector('#rt-notes').value;

    // 同步：删除未来未完成实例，让 dailyTick 按新模板重新注入
    const today = todayStr();
    const beforeCount = state.tasks.length;
    state.tasks = state.tasks.filter(t =>
      !(t.recurId === tpl.id && t.date >= today && t.timerState !== 'done')
    );
    const removed = beforeCount - state.tasks.length;

    saveState();
    dailyTick(); // 按新模板重新注入
    close();
    render();
    toast(`模板已更新${removed > 0 ? `，已重排 ${removed} 个未来实例` : ''}`);
  };

  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) close();
  });
}

/* ---------------- 收藏 ---------------- */
function favoriteTask(taskId) {
  const t = findTask(taskId);
  if (!t) return;

  // 已收藏 → 取消（按 favoriteId 链接，比 desc+cat 匹配更稳健）
  if (t.favoriteId && state.favorites.some(f => f.id === t.favoriteId)) {
    state.favorites = state.favorites.filter(f => f.id !== t.favoriteId);
    t.favoriteId = null;
    saveState();
    render();
    toast('已取消收藏');
    return;
  }

  // 未收藏 → 加入。若 desc+cat 已存在同内容收藏则复用其 id，避免重复
  let existing = state.favorites.find(f => f.desc === t.desc && f.cat === t.cat);
  if (!existing) {
    existing = {
      id: uid(),
      desc: t.desc,
      cat: t.cat,
      priority: t.priority,
      durPlan: t.durPlan
    };
    state.favorites.push(existing);
  }
  t.favoriteId = existing.id;
  saveState();
  render();
  toast('已收藏');
}

function addFromFavorite(favId) {
  const f = state.favorites.find(x => x.id === favId);
  if (!f) return;
  state.tasks.push(makeTask({
    desc: f.desc,
    cat: f.cat,
    priority: f.priority,
    durPlan: f.durPlan,
    date: todayStr(),
    favoriteId: f.id // 一键添加的任务直接标记为已收藏
  }));
  saveState();
  render();
  toast(`已添加：${f.desc}`);
}

/* ---------------- 渲染 ---------------- */
const PRI_ORDER = { 'urgent-important': 0, 'urgent-unimportant': 1, 'important': 2, 'normal': 3 };
function sortTasks(arr) {
  return arr.slice().sort((a, b) => {
    // AI 早间规划的 sortOrder 优先（双方都有时直接比较；单方有时排前）
    if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
    if (a.sortOrder != null) return -1;
    if (b.sortOrder != null) return 1;

    const pa = PRI_ORDER[a.priority] ?? 9;
    const pb = PRI_ORDER[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    // 同优先级：startTime 升序，没有 startTime 的排在最后；都无时间则按创建时间升序
    const ta = a.startTime || null;
    const tb = b.startTime || null;
    if (ta && tb) return ta.localeCompare(tb);
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    const ca = a.createdAt || 0;
    const cb = b.createdAt || 0;
    return ca - cb;
  });
}

function deadlineTag(deadline) {
  if (!deadline) return '';
  const d = diffDays(todayStr(), deadline);
  let cls = '';
  let text = '';
  if (d < 0) { cls = 'overdue'; text = `已过期 ${Math.abs(d)}天`; }
  else if (d === 0) { cls = 'danger'; text = '今日截止'; }
  else if (d <= 3) { cls = 'danger'; text = `${d}天后截止`; }
  else if (d <= 7) { cls = 'warn'; text = `${d}天后截止`; }
  else { text = `${d}天后截止`; }
  return `<span class="deadline-tag ${cls}">${text}</span>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function taskCardHTML(t, opts={}) {
  const isDone = state.done.some(d => d.id === t.id);
  let timerHTML = '';
  if (t.timerState === 'idle' && !isDone) {
    timerHTML = `<button class="timer-btn" onclick="startTimer('${t.id}')" title="开始计时">▶</button>`;
  } else if (t.timerState === 'running') {
    timerHTML = `
      <span class="timer-display" data-timer-display="${t.id}">${fmtTimer(getTimerElapsed(t))}</span>
      <button class="timer-btn running" onclick="pauseTimer('${t.id}')" title="暂停">❚❚</button>
      <button class="timer-btn" onclick="stopTimer('${t.id}')" title="结束">■</button>
    `;
  } else if (t.timerState === 'paused') {
    timerHTML = `
      <span class="timer-display">${fmtTimer(t.timerPaused)}</span>
      <button class="timer-btn" onclick="startTimer('${t.id}')" title="继续">▶</button>
      <button class="timer-btn" onclick="stopTimer('${t.id}')" title="结束">■</button>
    `;
  }

  const durLine = t.durActual != null
    ? `<span class="text-xs">${fmtDur(t.durPlan)} → <strong>${fmtDur(t.durActual)}</strong></span>`
    : `<span class="text-xs">${fmtDur(t.durPlan)}</span>`;

  const threshold = state.rolloverWarnThreshold || 2;
  const isProcrastinated = !isDone && (t.rolloverCount || 0) >= threshold;

  // 如果任务可推迟，外层包裹 swipe-wrap，让任意渲染场景（今日页/计划页/专注块）都支持左滑
  const wrapStart = isDeferEligible(t) ? `
    <div class="swipe-wrap" data-swipe-task-id="${t.id}">
      <div class="swipe-actions">
        <button type="button" class="swipe-action-btn" data-defer-target="tomorrow" onclick="onSwipeActionClick(event, '${t.id}', 'tomorrow')">明天</button>
        <button type="button" class="swipe-action-btn" data-defer-target="dayAfter" onclick="onSwipeActionClick(event, '${t.id}', 'dayAfter')">后天</button>
        <button type="button" class="swipe-action-btn" data-defer-target="nextMonday" onclick="onSwipeActionClick(event, '${t.id}', 'nextMonday')">下周一</button>
      </div>
  ` : '';
  const wrapEnd = isDeferEligible(t) ? '</div>' : '';

  return wrapStart + `
    <div class="task-card ${isDone ? 'done' : ''}" data-task-id="${t.id}" data-priority="${t.priority}">
      <button class="pri-edge" onclick="event.stopPropagation(); showPriorityPicker('${t.id}', this)" title="点击修改优先级" aria-label="优先级 ${t.priority}"></button>
      <button class="complete-btn" onclick="event.stopPropagation(); toggleComplete('${t.id}')" title="${isDone ? '取消完成' : '标记完成'}"></button>
      <div class="task-main" onclick="showTaskDetailModal('${t.id}')" title="点击查看详情">
        <div class="task-row1">
          <span class="task-desc">${escapeHtml(t.desc)}</span>
          <div class="task-actions" onclick="event.stopPropagation()">
            <button class="icon-btn ${t.favoriteId ? 'is-fav' : ''}" onclick="favoriteTask('${t.id}')" title="${t.favoriteId ? '取消收藏' : '收藏'}">${t.favoriteId ? '★' : '☆'}</button>
            <button class="icon-btn" onclick="exportTaskICS('${t.id}')" title="导出日历">⤓</button>
            <button class="icon-btn" onclick="deleteTask('${t.id}')" title="删除">✕</button>
          </div>
        </div>
        <div class="task-row2">
          ${t.timeLabel
            ? `<span class="time-label-tag" onclick="event.stopPropagation(); showTimeLabelInfo('${t.id}', this)" title="模糊时间">${escapeHtml(t.timeLabel)}</span>`
            : (t.startTime ? `<span class="time-tag" title="开始时间">◷ ${t.startTime}</span>` : '')}
          <span class="cat-tag" data-cat="${t.cat}" onclick="event.stopPropagation(); showCatPicker('${t.id}', this)">${t.cat}</span>
          ${durLine}
          ${deadlineTag(t.deadline)}
          ${isProcrastinated ? `<span class="procrastinate-tag" title="已被滚入 ${t.rolloverCount} 天">⚠ 已拖延${t.rolloverCount}天</span>` : (t.rollover ? '<span class="rollover-tag">滚入</span>' : '')}
          ${t.decomposed ? '<span class="decomposed-tag">已拆解</span>' : ''}
          ${t.isRecur ? '<span class="recur-tag">↻ 循环</span>' : ''}
          <div class="timer-area" onclick="event.stopPropagation()">${timerHTML}</div>
        </div>
      </div>
    </div>
  ` + wrapEnd;
}

/* 模糊时间标签点击：显示区间提示 + 「改为精确时间」入口 */
function showTimeLabelInfo(taskId, anchorEl) {
  // 关掉已存在的 popover
  document.querySelectorAll('.time-label-pop').forEach(el => el.remove());

  const t = state.tasks.find(x => x.id === taskId);
  if (!t || !t.timeLabel) return;

  const pop = document.createElement('div');
  pop.className = 'time-label-pop';
  pop.innerHTML = `
    <div class="tlp-range">${escapeHtml(t.timeLabel)} ${t.startTime || ''}${t.endTime ? '–' + t.endTime : ''}</div>
    <div class="tlp-row">
      <input type="time" value="${t.startTime || ''}">
      <button type="button">改为精确时间</button>
    </div>
  `;
  document.body.appendChild(pop);

  const rect = anchorEl.getBoundingClientRect();
  const top = rect.bottom + window.scrollY + 6;
  const left = Math.max(8, Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - 220));
  pop.style.top = top + 'px';
  pop.style.left = left + 'px';

  const input = pop.querySelector('input');
  const btn = pop.querySelector('button');
  btn.onclick = () => {
    const v = input.value;
    if (!v) { toast('请先选择时间'); return; }
    t.startTime = v;
    t.timeLabel = null;
    t.endTime = null;
    saveState();
    pop.remove();
    render();
  };

  // 点外部关闭
  setTimeout(() => {
    const closer = (e) => {
      if (!pop.contains(e.target)) {
        pop.remove();
        document.removeEventListener('click', closer, true);
      }
    };
    document.addEventListener('click', closer, true);
  }, 0);
}

function renderHeader() {
  const titles = { plans: '全部计划', today: '今日日程', recur: '循环任务', stats: '统计', assistant: '助手', settings: '设置' };
  document.getElementById('page-title').textContent = titles[currentTab];
  const today = new Date();
  const wd = '日一二三四五六'[today.getDay()];
  document.getElementById('header-date').textContent = `${today.getFullYear()}年${today.getMonth()+1}月${today.getDate()}日 · 周${wd}`;

  const extra = document.getElementById('header-extra');
  const streak = computeMaxStreak();
  const streakHTML = (currentTab === 'plans' || currentTab === 'today') && streak > 0
    ? `<div class="streak-badge">🔥 ${streak}天</div>` : '';
  // 云同步指示器（仅在云模式下显示）
  const syncHTML = authStatus === 'cloud'
    ? `<button id="sync-dot" class="sync-dot ${syncStatus}" onclick="manualSync()" aria-label="同步状态"></button>`
    : '';
  extra.innerHTML = streakHTML + syncHTML;
  updateSnailStatus();
}

