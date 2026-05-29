function deleteFav(id) {
  state.favorites = state.favorites.filter(f => f.id !== id);
  // 清掉所有任务上对该收藏的引用，避免卡片显示实心星但点击无效
  state.tasks.forEach(t => { if (t.favoriteId === id) t.favoriteId = null; });
  state.done.forEach(t => { if (t.favoriteId === id) t.favoriteId = null; });
  saveState();
  render();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chronos-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) {
        throw new Error('文件不符合 Chronos 备份格式');
      }
      // 导入前自动把当前数据备份到独立 key，避免误导入导致丢数据
      try {
        const cur = localStorage.getItem('chronos_state');
        if (cur) {
          const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
          localStorage.setItem('chronos_state_backup_' + ts, cur);
        }
      } catch(_) {}
      state = { ...JSON.parse(JSON.stringify(DEFAULT_STATE)), ...data };
      saveState();
      render();
      toast('导入成功，旧数据已备份');
    } catch(e) {
      toast('导入失败：' + e.message);
    }
  };
  r.readAsText(file);
}

/* ---------------- 日历导出 ICS ---------------- */
function icsDate(dateStr, hour, min) {
  const d = new Date(dateStr);
  d.setHours(hour, min, 0, 0);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function icsDateUTC(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function buildICS(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Snail//ZH//',
    'CALSCALE:GREGORIAN'
  ];
  events.forEach(e => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${icsDateUTC(new Date())}`);
    lines.push(`DTSTART:${e.start}`);
    lines.push(`DTEND:${e.end}`);
    lines.push(`SUMMARY:${e.summary.replace(/[,;\\]/g, '\\$&')}`);
    if (e.desc) lines.push(`DESCRIPTION:${e.desc.replace(/[,;\\]/g, '\\$&').replace(/\n/g, '\\n')}`);
    if (e.alarms) e.alarms.forEach(a => {
      lines.push('BEGIN:VALARM');
      lines.push(`TRIGGER:-PT${a}M`);
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${e.summary}`);
      lines.push('END:VALARM');
    });
    // deadline 特殊提醒（前一天 20:00 / 当天 09:00）
    if (e.deadlineAlarms) {
      e.deadlineAlarms.forEach(t => {
        lines.push('BEGIN:VALARM');
        lines.push(`TRIGGER;VALUE=DATE-TIME:${t}`);
        lines.push('ACTION:DISPLAY');
        lines.push(`DESCRIPTION:${e.summary}`);
        lines.push('END:VALARM');
      });
    }
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function taskToICSEvent(t) {
  // 有 startTime 用真实时间；否则默认 09:00
  let startHour = 9, startMin = 0;
  if (t.startTime && /^\d{1,2}:\d{2}$/.test(t.startTime)) {
    const [h, m] = t.startTime.split(':').map(Number);
    startHour = h; startMin = m;
  }
  const start = icsDate(t.date, startHour, startMin);
  const endD = new Date(t.date);
  endD.setHours(startHour, startMin + t.durPlan, 0, 0);
  const end = icsDateUTC(endD);

  let alarms;
  let deadlineAlarms;
  if (t.isRecur) alarms = [10];
  else if (t.deadline) {
    alarms = [];
    // 前一天 20:00 和 当天 09:00
    const ddl = t.deadline;
    deadlineAlarms = [icsDate(dateAdd(ddl, -1), 20, 0), icsDate(ddl, 9, 0)];
  } else {
    alarms = [15]; // 普通任务提前15
  }

  return {
    uid: `${t.id}@chronos`,
    start, end,
    summary: t.desc,
    desc: [
      `分类: ${t.cat}`,
      `优先级: ${t.priority}`,
      t.deadline ? `截止: ${t.deadline}` : '',
      t.notes || ''
    ].filter(Boolean).join('\n'),
    alarms,
    deadlineAlarms
  };
}

function exportTaskICS(taskId) {
  const t = findTask(taskId);
  if (!t) return;
  const ics = buildICS([taskToICSEvent(t)]);
  downloadICS(ics, `${t.desc.slice(0,20)}.ics`);
}

function exportTodayICS() {
  const today = todayStr();
  const tasks = [...state.tasks, ...state.done].filter(t => t.date === today);
  if (tasks.length === 0) { toast('今天没任务'); return; }
  const ics = buildICS(tasks.map(taskToICSEvent));
  downloadICS(ics, `今日-${today}.ics`);
}

function downloadICS(content, filename) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  toast('已导出');
}

/* ---------------- 主渲染 ---------------- */
function render() {
  // 渲染前用归档重建「今日已完成」镜像，保证各设备显示一致（划线）
  try { reconcileDoneFromArchive(); } catch(_) {}
  renderHeader();
  if (currentTab === 'plans') renderPlans();
  else if (currentTab === 'today') renderToday();
  else if (currentTab === 'recur') renderRecur();
  else if (currentTab === 'stats') renderStats();
  else if (currentTab === 'assistant') renderAssistant();
  else if (currentTab === 'settings') renderSettings();
}

/* ---------------- Tab 切换 ---------------- */
document.querySelectorAll('.tabbar .tab').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.tabbar .tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    currentTab = b.dataset.tab;
    window._scheduleResult = null;
    // 离开统计页或切换 tab 时清掉所有图表实例
    destroyAllCharts();
    render();
  };
});

/* ---------------- 文件输入 ---------------- */
document.getElementById('img-input').addEventListener('change', e => {
  if (e.target.files[0]) {
    handleImageUpload(e.target.files[0]);
    e.target.value = '';
  }
});
document.getElementById('json-input').addEventListener('change', e => {
  if (e.target.files[0]) {
    importData(e.target.files[0]);
    e.target.value = '';
  }
});

/* ---------------- 拖拽 / 粘贴 上传截图 ---------------- */
(function setupDragPasteUpload() {
  let dragCounter = 0;

  function hasFiles(e) {
    return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  }
  function getUploadBar() {
    const bar = document.querySelector('.input-bar');
    if (!bar || !bar.querySelector('#img-btn')) return null;
    return bar;
  }
  function showHighlight() {
    const bar = getUploadBar();
    if (!bar) return;
    bar.classList.add('drag-over');
    if (!bar.querySelector('.drag-overlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'drag-overlay';
      overlay.textContent = '松开即上传';
      bar.appendChild(overlay);
    }
  }
  function clearHighlight() {
    document.querySelectorAll('.input-bar.drag-over').forEach(bar => {
      bar.classList.remove('drag-over');
      const overlay = bar.querySelector('.drag-overlay');
      if (overlay) overlay.remove();
    });
  }
  function processFile(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      toast('请上传图片文件');
      return;
    }
    handleImageUpload(file);
  }

  window.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter++;
    showHighlight();
  });
  window.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      clearHighlight();
    }
  });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter = 0;
    clearHighlight();
    if (!getUploadBar()) return; // 当前视图不支持上传截图
    processFile(e.dataTransfer.files[0]);
  });

  window.addEventListener('paste', e => {
    if (!getUploadBar()) return;
    const cd = e.clipboardData;
    if (!cd) return;
    let imgFile = null;
    const items = cd.items || [];
    for (const item of items) {
      if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
        imgFile = item.getAsFile();
        break;
      }
    }
    if (!imgFile && cd.files) {
      for (const f of cd.files) {
        if (f.type && f.type.startsWith('image/')) { imgFile = f; break; }
      }
    }
    if (imgFile) {
      e.preventDefault();
      processFile(imgFile);
    }
  });
})();

/* ---------------- 启动 ---------------- */
// 全局错误捕获：任何启动期 throw 都打日志，不让单点失败拖垮整个 app
window.addEventListener('error', e => console.error('[Chronos] uncaught:', e.message, 'at', e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => console.error('[Chronos] unhandled rejection:', e.reason));

/* ============== 开屏动画 ============== */
function makeSpiralPath(cx, cy, startR, endR, turns, steps) {
  // 阿基米德螺旋：r 随 t 线性收缩，theta 顺时针累加（负方向）
  const totalAngle = turns * 2 * Math.PI;
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = -totalAngle * t;             // 顺时针向内
    const r = startR + (endR - startR) * t;    // 半径线性收缩
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    d += (i === 0 ? 'M ' : 'L ') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
  }
  return d.trim();
}
// ★★★ splash dismiss 已移到 <script> 顶部第一行的 IIFE，独立运行 ★★★
// 这里仅保留螺旋路径注入（视觉效果，不影响 dismiss 时序）
(function injectSpiralPath() {
  try {
    var pathEl = document.querySelector('#splash-spiral');
    if (pathEl && typeof makeSpiralPath === 'function') {
      pathEl.setAttribute('d', makeSpiralPath(75, 50, 20, 3, 2.5, 120));
    }
  } catch(_) {}
})();

console.log('[Chronos] booting…');
try { applyTheme(); } catch(e) { console.error('[Chronos] applyTheme 失败:', e); }
try { dailyTick(); } catch(e) { console.error('[Chronos] dailyTick 失败:', e); }
try { loadFocusPins(); } catch(e) { console.error('[Chronos] loadFocusPins 失败:', e); }
try { render(); console.log('[Chronos] 初次 render 完成'); } catch(e) { console.error('[Chronos] render 失败:', e); }
try { startTimerTick(); } catch(e) { console.error('[Chronos] startTimerTick 失败:', e); }

/* ============== 云同步启动（异步、永不抛出未捕获错误） ============== */
