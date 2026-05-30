/* ============== 蜗牛状态 + 里程系统 ============== */
const SNAIL_COLOR = '#6B4C2A';

function loadSnailMileage() {
  let raw;
  try { raw = localStorage.getItem('snail_mileage'); } catch(_) { raw = null; }
  if (!raw) return { total: 0, dailyLog: {} };
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return { total: 0, dailyLog: {} };
    return {
      total: Number(obj.total) || 0,
      dailyLog: (obj.dailyLog && typeof obj.dailyLog === 'object') ? obj.dailyLog : {}
    };
  } catch(_) {
    return { total: 0, dailyLog: {} };
  }
}
function saveSnailMileage(m) {
  try { localStorage.setItem('snail_mileage', JSON.stringify(m)); } catch(_) {}
  try { if (typeof scheduleSnailProgressCloudSync === 'function') scheduleSnailProgressCloudSync(); } catch(_) {}
}
let snailMileage = loadSnailMileage();
let _prevSnailState = null;

function computeTodayCompletionRate() {
  const today = todayStr();
  const all = [...state.tasks, ...state.done].filter(t => t.date === today);
  if (all.length === 0) return 0;
  const done = state.done.filter(t => t.date === today).length;
  return done / all.length;
}

function getSnailState(rate) {
  if (rate <= 0) return 'sleeping';
  if (rate >= 1) return 'bloom';
  if (rate <= 0.25) return 'peek';
  if (rate <= 0.50) return 'start';
  if (rate <= 0.75) return 'speed';
  return 'near';
}

const SNAIL_STATE_LABELS = {
  sleeping: '睡觉中',
  peek: '探头了',
  start: '出发了',
  speed: '加速中',
  near: '快到了',
  bloom: '开花了',
};

/* 五个蜗牛 SVG 状态：32x32 viewBox，#6B4C2A 线条
 * 风格：阿基米德螺旋（用三层同心圆稳定呈现）+ 左侧括号曲线（身体底部）+ 触角圆点 */
function snailStatusSVG(name) {
  const c = SNAIL_COLOR;
  const common = `xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"`;
  if (name === 'sleeping') {
    return `<svg ${common}>
      <circle cx="15" cy="19" r="7" />
      <circle cx="15.6" cy="19.6" r="4" />
      <circle cx="16.1" cy="20.1" r="1.5" />
      <text x="22" y="11" font-size="6" fill="${c}" stroke="none" font-style="italic" font-family="Georgia, serif">z</text>
      <text x="25.5" y="8" font-size="5" fill="${c}" stroke="none" font-style="italic" font-family="Georgia, serif">z</text>
      <text x="28.5" y="6" font-size="4" fill="${c}" stroke="none" font-style="italic" font-family="Georgia, serif">z</text>
    </svg>`;
  }
  if (name === 'peek') {
    return `<svg ${common}>
      <circle cx="12" cy="19" r="6.5" />
      <circle cx="12.6" cy="19.6" r="3.5" />
      <circle cx="13.1" cy="20.1" r="1.3" />
      <path d="M 18.5 19 Q 21.5 18.5 22.5 14.5" />
      <line x1="21" y1="13" x2="21" y2="9.5" />
      <line x1="24" y1="13" x2="25.5" y2="9.5" />
      <circle cx="21" cy="9" r="1" fill="${c}" stroke="none" />
      <circle cx="25.7" cy="9.2" r="1" fill="${c}" stroke="none" />
    </svg>`;
  }
  if (name === 'start') {
    return `<svg ${common}>
      <path d="M 4 24 Q 11 26.5 18 24 Q 24 22 27 19" />
      <circle cx="11" cy="18" r="6" />
      <circle cx="11.6" cy="18.6" r="3.3" />
      <circle cx="12.1" cy="19.1" r="1.2" />
      <path d="M 19 22 Q 24 22.5 27 18" />
      <line x1="24" y1="16" x2="24" y2="11" />
      <line x1="27.5" y1="17" x2="29" y2="12.5" />
      <circle cx="24" cy="10.3" r="1" fill="${c}" stroke="none" />
      <circle cx="29.2" cy="11.8" r="1" fill="${c}" stroke="none" />
    </svg>`;
  }
  if (name === 'speed') {
    return `<svg ${common}>
      <path d="M 1 14 Q 2.5 13 4 14" opacity="0.55" stroke-width="1.2" />
      <path d="M 1 20 Q 2.5 19 4 20" opacity="0.55" stroke-width="1.2" />
      <path d="M 7 24 Q 14 26.5 21 24 Q 27 22 30 19" />
      <circle cx="14" cy="18" r="6" />
      <circle cx="14.6" cy="18.6" r="3.3" />
      <circle cx="15.1" cy="19.1" r="1.2" />
      <path d="M 22 22 Q 27 22.5 30 18" />
      <line x1="27" y1="16" x2="27" y2="11" />
      <line x1="30.5" y1="17" x2="31.8" y2="12.5" />
      <circle cx="27" cy="10.3" r="1" fill="${c}" stroke="none" />
      <circle cx="31.9" cy="11.8" r="1" fill="${c}" stroke="none" />
    </svg>`;
  }
  if (name === 'near') {
    return `<svg ${common}>
      <path d="M 3 14 Q 4.5 13 6 14" opacity="0.55" stroke-width="1.2" />
      <path d="M 3 20 Q 4.5 19 6 20" opacity="0.55" stroke-width="1.2" />
      <path d="M 8 24 Q 15 26.5 22 24 Q 28 22 30.5 18" />
      <circle cx="15" cy="17" r="6" />
      <circle cx="15.6" cy="17.6" r="3.3" />
      <circle cx="16.1" cy="18.1" r="1.2" />
      <path d="M 23 21 Q 28 21.5 30.5 17" />
      <line x1="28" y1="15" x2="28" y2="10" />
      <line x1="31.5" y1="16" x2="32.5" y2="11.5" />
      <circle cx="28" cy="9.3" r="1" fill="${c}" stroke="none" />
      <circle cx="32.6" cy="10.8" r="1" fill="${c}" stroke="none" />
      <text x="2" y="9" font-size="5" fill="${c}" stroke="none" font-style="italic" font-family="Georgia, serif">!</text>
    </svg>`;
  }
  // bloom：满分开花
  return `<svg ${common}>
    <path d="M 4 25 Q 11 27 18 25 Q 24 23 27 20" />
    <circle cx="11" cy="20" r="5.5" />
    <circle cx="11.6" cy="20.6" r="3" />
    <circle cx="12.1" cy="21.1" r="1.2" />
    <path d="M 19 23 Q 24 23.5 27 19" />
    <line x1="24" y1="17" x2="24" y2="13.5" />
    <line x1="27.5" y1="18" x2="29" y2="14" />
    <g class="bloom-flower f1" style="transform-origin:11px 8.5px">
      <circle cx="11" cy="7" r="1.3" fill="${c}" stroke="none" />
      <circle cx="12.8" cy="8.5" r="1.3" fill="${c}" stroke="none" />
      <circle cx="11" cy="10" r="1.3" fill="${c}" stroke="none" />
      <circle cx="9.2" cy="8.5" r="1.3" fill="${c}" stroke="none" />
      <circle cx="11" cy="8.5" r="0.65" fill="#FAF9F6" stroke="none" />
    </g>
    <g class="bloom-flower f2" style="transform-origin:24px 12.5px">
      <circle cx="24" cy="11.5" r="0.95" fill="${c}" stroke="none" />
      <circle cx="25.1" cy="12.5" r="0.95" fill="${c}" stroke="none" />
      <circle cx="24" cy="13.5" r="0.95" fill="${c}" stroke="none" />
      <circle cx="22.9" cy="12.5" r="0.95" fill="${c}" stroke="none" />
      <circle cx="24" cy="12.5" r="0.45" fill="#FAF9F6" stroke="none" />
    </g>
    <g class="bloom-flower f3" style="transform-origin:29px 13.5px">
      <circle cx="29" cy="12.5" r="0.95" fill="${c}" stroke="none" />
      <circle cx="30.1" cy="13.5" r="0.95" fill="${c}" stroke="none" />
      <circle cx="29" cy="14.5" r="0.95" fill="${c}" stroke="none" />
      <circle cx="27.9" cy="13.5" r="0.95" fill="${c}" stroke="none" />
      <circle cx="29" cy="13.5" r="0.45" fill="#FAF9F6" stroke="none" />
    </g>
  </svg>`;
}

/* 更新 header 蜗牛状态，带淡出/淡入 + scale 弹入动画 */
function updateSnailStatus(forceImmediate) {
  const root = document.getElementById('snail-status');
  if (!root) return;
  const rate = computeTodayCompletionRate();
  const newState = getSnailState(rate);
  if (!forceImmediate && _prevSnailState === newState && root.firstChild) return;

  const oldSvgWrap = root.querySelector('.snail-svg');
  const newWrap = document.createElement('div');
  newWrap.className = 'snail-svg entering';
  newWrap.innerHTML = snailStatusSVG(newState);

  if (oldSvgWrap && !forceImmediate) {
    // 淡出旧的
    oldSvgWrap.classList.add('exiting');
    setTimeout(() => {
      try { oldSvgWrap.remove(); } catch(_) {}
    }, 320);
    // 重叠：旧的还在淡出时插入新的（绝对定位避免抖动）
    newWrap.style.position = 'absolute';
    newWrap.style.inset = '0';
    root.appendChild(newWrap);
    requestAnimationFrame(() => {
      newWrap.classList.add('active');
    });
    setTimeout(() => {
      newWrap.style.position = '';
      newWrap.style.inset = '';
    }, 400);
  } else {
    root.innerHTML = '';
    root.appendChild(newWrap);
    requestAnimationFrame(() => {
      newWrap.classList.add('active');
    });
  }
  _prevSnailState = newState;
  const textEl = document.getElementById('snail-state-text');
  if (textEl) textEl.textContent = SNAIL_STATE_LABELS[newState] || '';
}

/* 完成任务时调用：按分类加里程 + 计算 100% 奖励 + streak 奖励 */
function awardMileageOnComplete(task) {
  const today = todayStr();
  const prevTotal = snailMileage.total;
  if (!snailMileage.dailyLog[today]) {
    snailMileage.dailyLog[today] = { earned: 0, completionRate: 0, bonusGiven: false, streakBonusGiven: false };
  }
  const log = snailMileage.dailyLog[today];
  const cat = task && task.cat;
  const base = (cat === 'C') ? 1 : 3; // R/S/G +3，C +1
  log.earned += base;
  snailMileage.total += base;

  // streak 奖励：本日首次完成任意任务 → +1km × streak（包含今天）
  if (!log.streakBonusGiven) {
    // 先把今天的 completionRate 暂存为大于 0 的值，以便 streak 包含今天
    log.completionRate = Math.max(log.completionRate, 0.0001);
    const streak = computeMileageStreak();
    if (streak > 0) {
      log.earned += streak;
      snailMileage.total += streak;
    }
    log.streakBonusGiven = true;
  }

  // 更新真实完成率
  log.completionRate = computeTodayCompletionRate();

  // 100% 奖励：每天只触发一次
  if (log.completionRate >= 1 && !log.bonusGiven) {
    log.earned += 5;
    snailMileage.total += 5;
    log.bonusGiven = true;
  }

  saveSnailMileage(snailMileage);
  checkAndUnlockAchievements(prevTotal, snailMileage.total);
}

/* 取消完成时调用：只更新当日完成率，不退还里程 */
function recomputeDailyRate() {
  const today = todayStr();
  if (!snailMileage.dailyLog[today]) return;
  snailMileage.dailyLog[today].completionRate = computeTodayCompletionRate();
  saveSnailMileage(snailMileage);
}

/* 计算 streak：从今天往前数连续完成率 > 0 的天数（包含今天） */
function computeMileageStreak() {
  let streak = 0;
  let cursor = todayStr();
  for (let i = 0; i < 365; i++) {
    const log = snailMileage.dailyLog[cursor];
    if (log && log.completionRate > 0) {
      streak++;
      cursor = dateAdd(cursor, -1);
    } else {
      break;
    }
  }
  return streak;
}

/* ============== 成就系统 ============== */
const SNAIL_MILESTONES = [
  { id: 'km_1',     km: 1,     icon: '🌱', name: '壳里的世界',   real: '绕操场3圈',          quote: '出发了，这就够了。' },
  { id: 'km_10',    km: 10,    icon: '🪨', name: '慢慢有意思',   real: '八达岭长城全程',      quote: '慢，是因为每一步都算数。' },
  { id: 'km_30',    km: 30,    icon: '🌙', name: '穿越一座城',   real: '上海内环绕一圈',      quote: '没有捷径，但有风景。' },
  { id: 'km_100',   km: 100,   icon: '☁️', name: '沪苏之间',     real: '上海到苏州',          quote: '你比你以为的更能坚持。' },
  { id: 'km_300',   km: 300,   icon: '⛰️', name: '来回折返跑',   real: '北京到天津再回来',    quote: '折返不是退步，是见过了才回来。' },
  { id: 'km_500',   km: 500,   icon: '🌊', name: '蜀道不再难',   real: '成都到重庆再回来',    quote: '蜀道难，但蜗牛不知道这件事。' },
  { id: 'km_1000',  km: 1000,  icon: '⭐', name: '京沪全程',     real: '高铁要4.5小时',       quote: '高铁4.5小时，你用了更长时间，也更诚实。' },
  { id: 'km_2000',  km: 2000,  icon: '🌅', name: '大半个中国',   real: '北京到广州',          quote: '大半个中国，一件事一件事做到的。' },
  { id: 'km_5000',  km: 5000,  icon: '🌍', name: '丝绸之路',     real: '西安到罗马的一半',    quote: '速度从不是重点。' },
  { id: 'km_10000', km: 10000, icon: '🌌', name: '地球四分之一', real: '北京到布宜诺斯艾利斯', quote: '地球是圆的，蜗牛终究会回到原点，但已经不同了。' },
];

function loadSnailAchievements() {
  let raw;
  try { raw = localStorage.getItem('snail_achievements'); } catch(_) { raw = null; }
  if (!raw) return { unlocked: [] };
  try {
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.unlocked)) return { unlocked: [] };
    return obj;
  } catch(_) { return { unlocked: [] }; }
}
function saveSnailAchievements(a) {
  try { localStorage.setItem('snail_achievements', JSON.stringify(a)); } catch(_) {}
  try { if (typeof scheduleSnailProgressCloudSync === 'function') scheduleSnailProgressCloudSync(); } catch(_) {}
}
let snailAchievements = loadSnailAchievements();

function checkAndUnlockAchievements(prevTotal, newTotal) {
  const today = todayStr();
  let newlyUnlocked = [];
  SNAIL_MILESTONES.forEach(m => {
    if (prevTotal < m.km && newTotal >= m.km) {
      const alreadyUnlocked = snailAchievements.unlocked.some(u => u.id === m.id);
      if (!alreadyUnlocked) {
        snailAchievements.unlocked.push({ id: m.id, unlockedAt: today });
        newlyUnlocked.push(m);
      }
    }
  });
  if (newlyUnlocked.length > 0) {
    saveSnailAchievements(snailAchievements);
    // 顺序显示，每个弹窗关闭后再显示下一个
    let idx = 0;
    function showNext() {
      if (idx < newlyUnlocked.length) showAchievementModal(newlyUnlocked[idx++], showNext);
    }
    showNext();
  }
}

function showAchievementModal(milestone, onClose) {
  const km = milestone.km;
  const snailHours = Math.round(km / 0.05).toLocaleString('zh-CN');
  const backdrop = document.createElement('div');
  backdrop.className = 'achievement-modal-backdrop';
  backdrop.innerHTML = `
    <div class="achievement-modal">
      <div class="ach-icon">${milestone.icon}</div>
      <div class="ach-name">${milestone.name}</div>
      <div class="ach-km">你爬了 ${km}km</div>
      <div class="ach-real">相当于${milestone.real}</div>
      <div class="ach-snail-time">蜗牛时速0.05km<br>你相当于它爬了 ${snailHours} 小时</div>
      <div class="ach-quote">「${milestone.quote}」</div>
      <button class="ach-dismiss">知道了</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.querySelector('.ach-dismiss').onclick = () => {
    backdrop.remove();
    if (onClose) onClose();
  };
  backdrop.onclick = (e) => {
    if (e.target === backdrop) { backdrop.remove(); if (onClose) onClose(); }
  };
}

function renderAchievementWallHTML() {
  const km = Math.round(snailMileage.total);
  const snailHours = Math.round(km / 0.05).toLocaleString('zh-CN');
  const itemsHTML = SNAIL_MILESTONES.map(m => {
    const entry = snailAchievements.unlocked.find(u => u.id === m.id);
    const locked = !entry;
    return `<div class="achievement-item${locked ? ' locked' : ''}" data-ach-id="${m.id}">
      <div class="ach-item-icon">${m.icon}</div>
      <div class="ach-item-name">${locked ? '???' : m.name}</div>
    </div>`;
  }).join('');
  return `<div class="achievement-wall">
    <div class="achievement-wall-title">旅程成就</div>
    <div class="achievement-wall-mileage">累计里程 ${km}km · 相当于蜗牛爬了 ${snailHours} 小时</div>
    <div class="achievement-grid" id="achievement-grid">${itemsHTML}</div>
  </div>`;
}

function initAchievementWallEvents() {
  const grid = document.getElementById('achievement-grid');
  if (!grid) return;
  grid.addEventListener('click', e => {
    const item = e.target.closest('.achievement-item');
    if (!item || item.classList.contains('locked')) return;
    const id = item.dataset.achId;
    const milestone = SNAIL_MILESTONES.find(m => m.id === id);
    const entry = snailAchievements.unlocked.find(u => u.id === id);
    if (!milestone || !entry) return;
    // 移除已有的展开行（无论属于谁）
    grid.querySelectorAll('.achievement-item-detail').forEach(el => el.remove());
    // 如果点的是同一个，只需收起（已经删了），否则展开新的
    if (item.dataset.expanded === '1') {
      item.dataset.expanded = '0';
      return;
    }
    grid.querySelectorAll('.achievement-item').forEach(el => { el.dataset.expanded = '0'; });
    item.dataset.expanded = '1';
    const detail = document.createElement('div');
    detail.className = 'achievement-item-detail';
    detail.textContent = `「${milestone.quote}」 · ${entry.unlockedAt}`;
    item.after(detail);
  });
}

/* 蜗牛旅程：统计页顶部组件 */
function renderSnailJourneyHTML() {
  const today = todayStr();
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = dateAdd(today, -i);
    const log = snailMileage.dailyLog[d];
    const rate = log ? log.completionRate : 0;
    days.push({ date: d, rate });
  }
  const km = Math.round(snailMileage.total);

  const nodesHTML = days.map((day, idx) => {
    const next = days[idx + 1];
    let gap = 'none';
    if (next) {
      // 当日和次日都完成（rate>0）：实线；否则虚线
      gap = (day.rate > 0 && next.rate > 0) ? 'solid' : 'dashed';
    }
    let flowersHTML;
    if (day.rate >= 1) flowersHTML = '<div class="flowers">✿✿✿</div>';
    else if (day.rate >= 0.61) flowersHTML = '<div class="flowers">✿✿</div>';
    else if (day.rate > 0) flowersHTML = '<div class="flowers">✿</div>';
    else flowersHTML = '<div class="flowers empty"></div>';
    const isToday = day.date === today;
    const dt = new Date(day.date);
    const label = `${dt.getMonth()+1}/${dt.getDate()}`;
    const snailHere = isToday ? `<div class="snail-here">${snailStatusSVG(getSnailState(day.rate))}</div>` : '';
    return `<div class="timeline-node${isToday ? ' today' : ''}" data-gap="${gap}">
      ${snailHere}
      ${flowersHTML}
      <div class="date-label">${label}</div>
    </div>`;
  }).join('');

  return `<div class="snail-journey">
    <div class="snail-journey-mileage">
      <span>🐌 已爬行</span>
      <span class="num">${km}</span>
      <span>km</span>
    </div>
    <div class="snail-journey-timeline" id="snail-journey-timeline">${nodesHTML}</div>
  </div>`;
}

