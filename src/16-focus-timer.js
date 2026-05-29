/* =====================================================================
 * 专注计时全屏 UI
 *
 * 开始任务计时（startTimer 进入 running）后立即弹出覆盖全屏的计时器：
 *   - 顶部：最小化（向下箭头）/「Focusing」标题 / 静音开关
 *   - 任务名 + 铅笔（行内改名）
 *   - 大圆表盘：HOURS / MINUTES 大字 + 红色秒针绕圈 + 钟点刻点
 *   - 底部：备注 / 暂停·继续 / 结束
 *   - 可最小化收进左侧边栏的小药丸（点开即恢复全屏）
 *
 * 设计原则：本模块是自包含的「UI 层」，只调用 09-task-core.js 里的
 * startTimer / pauseTimer / stopTimer / getTimerElapsed / findTask，
 * 不直接改任务状态。按 1s 轮询当前专注任务的 timerState：一旦任务被外部
 * （任务卡 ■ / 勾选完成 / 删除）结束，自动关闭浮层。
 * ===================================================================== */

let focusTimerTaskId = null;     // 当前正在专注的任务 id（null = 未激活）
let focusTimerMinimized = false; // 是否已最小化到侧边栏
let focusTimerTick = null;       // 1s 刷新定时器
let focusTickSoundOn = false;    // 静音开关（默认静音，与设计图一致）
let _focusAudioCtx = null;

/* ---- 图标（lucide outline，stroke-width 继承自 CSS） ---- */
const FOCUS_ICONS = {
  chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  volumeX: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
  volume2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 4.5v15a1 1 0 0 0 1.55.83l11-7.5a1 1 0 0 0 0-1.66l-11-7.5A1 1 0 0 0 7 4.5Z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/></svg>',
};

/* ---- DOM 注入（仅一次） ---- */
function ensureFocusOverlayDOM() {
  if (document.getElementById('focus-overlay')) return;

  // 钟点刻点（12 个）位于圆周内侧
  let dots = '';
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * 2 * Math.PI - Math.PI / 2;
    const r = 47;                       // 百分比半径
    const x = 50 + r * Math.cos(ang);
    const y = 50 + r * Math.sin(ang);
    dots += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="0.7" fill="currentColor"/>`;
  }

  const overlay = document.createElement('div');
  overlay.id = 'focus-overlay';
  overlay.className = 'focus-overlay hidden';
  overlay.innerHTML = `
    <div class="focus-topbar">
      <button class="focus-icon-btn" id="focus-minimize" title="最小化" aria-label="最小化">${FOCUS_ICONS.chevronDown}</button>
      <span class="focus-topbar-title">Focusing</span>
      <button class="focus-icon-btn" id="focus-mute" title="提示音" aria-label="提示音开关">${FOCUS_ICONS.volumeX}</button>
    </div>

    <div class="focus-task-head">
      <span class="focus-task-name" id="focus-task-name"></span>
      <button class="focus-edit-name" id="focus-edit-name" title="重命名" aria-label="重命名">${FOCUS_ICONS.pencil}</button>
    </div>

    <div class="focus-dial">
      <svg class="focus-dial-marks" viewBox="0 0 100 100" aria-hidden="true">${dots}</svg>
      <div class="focus-dial-circle">
        <span class="focus-brand">Snail</span>
        <div class="focus-time">
          <div class="focus-time-unit">
            <span class="focus-time-num" id="focus-hours">00</span>
            <span class="focus-time-label">HOURS</span>
          </div>
          <div class="focus-time-unit">
            <span class="focus-time-num" id="focus-mins">00</span>
            <span class="focus-time-label">MINUTES</span>
          </div>
        </div>
      </div>
      <div class="focus-hand" id="focus-hand"><span class="focus-hand-tick"></span></div>
    </div>

    <div class="focus-controls">
      <button class="focus-ctrl-btn" id="focus-note" title="备注" aria-label="备注">${FOCUS_ICONS.note}</button>
      <button class="focus-ctrl-btn primary" id="focus-toggle" title="暂停" aria-label="暂停">${FOCUS_ICONS.pause}</button>
      <button class="focus-ctrl-btn" id="focus-stop" title="结束" aria-label="结束">${FOCUS_ICONS.stop}</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // 最小化药丸（左侧边栏）
  const mini = document.createElement('button');
  mini.id = 'focus-mini';
  mini.className = 'focus-mini hidden';
  mini.title = '回到专注计时';
  mini.innerHTML = `<span class="focus-mini-icon">${FOCUS_ICONS.timer}</span><span class="focus-mini-time" id="focus-mini-time">0:00</span>`;
  document.body.appendChild(mini);

  // 事件绑定
  overlay.querySelector('#focus-minimize').onclick = minimizeFocusTimer;
  overlay.querySelector('#focus-mute').onclick = toggleFocusSound;
  overlay.querySelector('#focus-edit-name').onclick = renameFocusTask;
  overlay.querySelector('#focus-task-name').onclick = renameFocusTask;
  overlay.querySelector('#focus-note').onclick = editFocusNote;
  overlay.querySelector('#focus-toggle').onclick = onFocusToggle;
  overlay.querySelector('#focus-stop').onclick = onFocusStop;
  mini.onclick = restoreFocusTimer;
}

/* ---- 打开 / 关闭 / 最小化 ---- */
function openFocusOverlay(taskId) {
  ensureFocusOverlayDOM();
  const t = findTask(taskId);
  if (!t) return;
  focusTimerTaskId = taskId;
  focusTimerMinimized = false;
  document.getElementById('focus-overlay').classList.remove('hidden');
  document.getElementById('focus-mini').classList.add('hidden');
  updateFocusUI();
  startFocusTick();
}

function closeFocusOverlay() {
  focusTimerTaskId = null;
  focusTimerMinimized = false;
  stopFocusTick();
  const ov = document.getElementById('focus-overlay');
  const mini = document.getElementById('focus-mini');
  if (ov) ov.classList.add('hidden');
  if (mini) mini.classList.add('hidden');
}

function minimizeFocusTimer() {
  if (!focusTimerTaskId) return;
  focusTimerMinimized = true;
  document.getElementById('focus-overlay').classList.add('hidden');
  document.getElementById('focus-mini').classList.remove('hidden');
  updateFocusUI();
}

function restoreFocusTimer() {
  if (!focusTimerTaskId) { closeFocusOverlay(); return; }
  focusTimerMinimized = false;
  document.getElementById('focus-overlay').classList.remove('hidden');
  document.getElementById('focus-mini').classList.add('hidden');
  updateFocusUI();
}

/* ---- 刷新 ---- */
function startFocusTick() {
  if (focusTimerTick) clearInterval(focusTimerTick);
  focusTimerTick = setInterval(updateFocusUI, 1000);
}
function stopFocusTick() {
  if (focusTimerTick) { clearInterval(focusTimerTick); focusTimerTick = null; }
}

function updateFocusUI() {
  if (!focusTimerTaskId) return;
  const t = findTask(focusTimerTaskId);
  // 任务已结束 / 完成 / 删除 → 浮层自动消失
  if (!t || (t.timerState !== 'running' && t.timerState !== 'paused')) {
    closeFocusOverlay();
    return;
  }

  const ms = getTimerElapsed(t);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const running = t.timerState === 'running';

  if (focusTimerMinimized) {
    const miniTime = document.getElementById('focus-mini-time');
    if (miniTime) miniTime.textContent = fmtTimer(ms);
    document.getElementById('focus-mini').classList.toggle('paused', !running);
    return;
  }

  document.getElementById('focus-hours').textContent = String(h).padStart(2, '0');
  document.getElementById('focus-mins').textContent = String(m).padStart(2, '0');
  document.getElementById('focus-task-name').textContent = t.desc || '专注';

  // 红色秒针：每分钟转一圈；暂停时停在当前角度
  const hand = document.getElementById('focus-hand');
  if (hand) hand.style.transform = `rotate(${(sec / 60) * 360}deg)`;

  // 暂停 / 继续 图标与态
  const toggle = document.getElementById('focus-toggle');
  toggle.innerHTML = running ? FOCUS_ICONS.pause : FOCUS_ICONS.play;
  toggle.title = running ? '暂停' : '继续';
  document.getElementById('focus-overlay').classList.toggle('is-paused', !running);

  // 提示音（每秒一次柔和滴答，仅 running 且未静音）
  if (running) playFocusTick();
}

/* ---- 控制：暂停 / 继续 / 结束 ---- */
function onFocusToggle() {
  if (!focusTimerTaskId) return;
  const t = findTask(focusTimerTaskId);
  if (!t) return;
  if (t.timerState === 'running') pauseTimer(focusTimerTaskId);
  else startTimer(focusTimerTaskId);
  updateFocusUI();
}

function onFocusStop() {
  if (!focusTimerTaskId) return;
  stopTimer(focusTimerTaskId);  // 不足 60s 重置回 idle；否则记 durActual 并 done
  closeFocusOverlay();
}

/* ---- 行内改名 ---- */
function renameFocusTask() {
  if (!focusTimerTaskId) return;
  const t = findTask(focusTimerTaskId);
  if (!t) return;
  const next = window.prompt('任务名称', t.desc || '');
  if (next == null) return;
  const trimmed = next.trim();
  if (!trimmed) { toast('描述不能为空'); return; }
  t.desc = trimmed;
  saveState();
  render();
  updateFocusUI();
}

/* ---- 编辑备注 ---- */
function editFocusNote() {
  if (!focusTimerTaskId) return;
  const t = findTask(focusTimerTaskId);
  if (!t) return;
  const next = window.prompt('备注', t.notes || '');
  if (next == null) return;
  t.notes = next;
  saveState();
  render();
  toast('备注已保存');
}

/* ---- 提示音开关（默认静音，与设计图一致） ---- */
function toggleFocusSound() {
  focusTickSoundOn = !focusTickSoundOn;
  const btn = document.getElementById('focus-mute');
  if (btn) {
    btn.innerHTML = focusTickSoundOn ? FOCUS_ICONS.volume2 : FOCUS_ICONS.volumeX;
    btn.classList.toggle('active', focusTickSoundOn);
  }
  if (focusTickSoundOn) toast('已开启滴答声'); else toast('已静音');
}

function playFocusTick() {
  if (!focusTickSoundOn) return;
  try {
    if (!_focusAudioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      _focusAudioCtx = new AC();
    }
    const ctx = _focusAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
  } catch (_) { /* 忽略音频失败 */ }
}
