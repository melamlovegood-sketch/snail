function applyTheme() {
  const t = state.theme;
  let mode = t;
  if (t === 'auto') {
    mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', mode);
  document.querySelector('meta[name=theme-color]').setAttribute('content', mode === 'dark' ? '#0a0a0a' : '#ffffff');
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.theme === 'auto') applyTheme();
});

/* ---------------- 跨日处理 + 循环注入 + 截止升级 ---------------- */
function dailyTick() {
  const today = todayStr();
  const isCrossDay = state.lastDate && state.lastDate !== today;
  if (isCrossDay) {
    state.done = [];                                       // 清空昨日已完成
    state.tasks.forEach(t => { t.sortOrder = null; });     // AI 早间规划仅当日有效
    // 助手相关跨日重置（内存态）
    chatHistory = [];
    checkInMode = false;
    lastOperation = null;
  }
  state.lastDate = today;

  // 滚入：所有 date < today 且未完成的任务 → 移到今天 + rolloverCount += 1
  // 即使 dailyTick 同日内重跑，下次 t.date 已是 today，条件不再满足，不会双计数
  const _autoRealityTriggers = [];
  state.tasks.forEach(t => {
    if (t.date < today && t.timerState !== 'done') {
      if (!t.originalDate) t.originalDate = t.date;
      t.rolloverCount = (t.rolloverCount || 0) + 1;
      t.rollover = true;
      t.date = today;
      if (t.rolloverCount === 3 && !t.realityCheckShown) {
        t.realityCheckShown = true;
        _autoRealityTriggers.push(t.id);
      }
    }
  });
  if (_autoRealityTriggers.length > 0) {
    // 延迟到 DOM 准备好后再弹（首屏渲染后）
    setTimeout(() => {
      if (typeof chainRealityChecks === 'function') chainRealityChecks(_autoRealityTriggers);
    }, 800);
  }

  // 注入循环任务到未来 8 天
  for (let i = 0; i < 8; i++) {
    const targetDate = dateAdd(today, i);
    const wd = weekday(targetDate);
    state.recurTemplates.forEach(tpl => {
      if (!tpl.days.includes(wd)) return;
      // 是否已存在该实例
      const exists = state.tasks.some(t => t.recurId === tpl.id && t.date === targetDate);
      const doneKey = `${tpl.id}_${targetDate}`;
      if (exists || state.recurDoneLog[doneKey]) return;
      state.tasks.push(makeTask({
        desc: tpl.desc,
        cat: tpl.cat,
        priority: tpl.priority || 'normal',
        date: targetDate,
        startTime: tpl.startTime || null,
        durPlan: tpl.durPlan,
        recurId: tpl.id,
        isRecur: true
      }));
    });
  }

  // 截止升级：deadline ≤ 3 天的强制升紧急
  state.tasks.forEach(t => {
    if (!t.deadline) return;
    const d = diffDays(today, t.deadline);
    if (d <= 3 && !t.deadlineUrgencyApplied) {
      t.priority = 'urgent-important';
      t.deadlineUrgencyApplied = true;
    }
  });

  saveState();
}

/* ---------------- 任务工厂 ---------------- */
function makeTask(opts) {
  return {
    id: uid(),
    desc: opts.desc || '',
    cat: opts.cat || 'C',
    priority: opts.priority || 'normal',
    date: opts.date || todayStr(),
    startTime: opts.startTime || null,  // HH:MM 或 null
    timeLabel: opts.timeLabel || null,  // 模糊时间标签，如 "下午"，null 表示精确时间或无时间
    endTime: opts.endTime || null,      // 模糊时间区间结束，如 "18:00"
    createdAt: opts.createdAt || Date.now(),
    deadline: opts.deadline || null,
    durPlan: opts.durPlan || 60,
    durActual: opts.durActual ?? null,
    timerStart: null,
    timerPaused: 0,
    timerState: 'idle',
    rollover: false,
    recurId: opts.recurId || null,
    isRecur: !!opts.isRecur,
    priorityManualOverride: !!opts.priorityManualOverride,
    deadlineUrgencyApplied: false,
    notes: opts.notes || '',
    favoriteId: opts.favoriteId || null,
    rolloverCount: opts.rolloverCount || 0,    // 已被滚入次数（拖延天数）
    originalDate: opts.originalDate || null,   // 原始创建日期（rollover 前）
    decomposed: !!opts.decomposed,             // 是否已被 AI 拆解
    sortOrder: opts.sortOrder ?? null          // AI 早间规划排序（同优先级内排序更高）
  };
}

/* ---------------- 自然语言解析 ---------------- */
const CN_NUM = { '一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'半':0.5 };
const CN_DIGIT = { '零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
function cnToNum(s) {
  if (s == null) return null;
  s = String(s).trim();
  if (s === '') return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s.length === 1 && CN_DIGIT[s] != null) return CN_DIGIT[s];
  if (s === '十') return 10;
  if (s.length === 2 && s[0] === '十' && CN_DIGIT[s[1]] != null) return 10 + CN_DIGIT[s[1]];          // 十一..十九
  if (s.length === 2 && s[1] === '十' && CN_DIGIT[s[0]] != null) return CN_DIGIT[s[0]] * 10;          // 二十,三十..
  if (s.length === 3 && s[1] === '十' && CN_DIGIT[s[0]] != null && CN_DIGIT[s[2]] != null)             // 二十一..五十九
    return CN_DIGIT[s[0]] * 10 + CN_DIGIT[s[2]];
  return null;
}

/* 模糊时间词映射（功能一） */
const FUZZY_TIME_MAP = {
  '早上': { startTime: '07:00', endTime: '09:00' },
  '早晨': { startTime: '07:00', endTime: '09:00' },
  '上午': { startTime: '09:00', endTime: '12:00' },
  '中午': { startTime: '11:30', endTime: '13:30' },
  '下午': { startTime: '14:00', endTime: '18:00' },
  '傍晚': { startTime: '17:00', endTime: '19:00' },
  '晚上': { startTime: '19:00', endTime: '22:00' },
  '睡前': { startTime: '22:00', endTime: '23:59' }
};
const FUZZY_TIME_RE = /(早晨|早上|上午|中午|下午|傍晚|晚上|睡前)/;

/* 解析开始时间，返回 { time: "HH:MM", matched: "原文匹配串", timeLabel?, endTime? } 或 null */
function parseStartTime(text) {
  // 1) 数字格式 HH:MM（可带时段前缀，用于 12 小时表达）
  let m = text.match(/(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|夜晚|深夜)?\s*(\d{1,2})\s*[:：]\s*(\d{1,2})/);
  if (m) {
    let h = parseInt(m[2], 10), min = parseInt(m[3], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      h = applyPeriod(h, m[1]);
      return { time: pad2(h) + ':' + pad2(min), matched: m[0] };
    }
  }
  // 2) 中文：[时段?] [数字/中文数] 点(/时) [半|X分|X]?
  m = text.match(/(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|夜晚|深夜)?\s*([零〇一二两三四五六七八九十]{1,3}|\d{1,2})\s*[点时](?:\s*([零〇一二两三四五六七八九十]{1,3}|\d{1,2})\s*分?|\s*(半))?/);
  if (m) {
    let h = cnToNum(m[2]);
    if (h == null) return null;
    let min = 0;
    if (m[4] === '半') min = 30;
    else if (m[3]) {
      const mm = cnToNum(m[3]);
      if (mm != null && mm >= 0 && mm <= 59) min = mm;
    }
    h = applyPeriod(h, m[1]);
    if (h < 0 || h > 23) return null;
    return { time: pad2(h) + ':' + pad2(min), matched: m[0] };
  }
  // 3) 模糊时段词（无具体小时）— 映射到固定区间，并带 timeLabel
  m = text.match(FUZZY_TIME_RE);
  if (m) {
    const info = FUZZY_TIME_MAP[m[1]];
    if (info) {
      return {
        time: info.startTime,
        matched: m[0],
        timeLabel: m[1],
        endTime: info.endTime
      };
    }
  }
  return null;
}
function pad2(n) { return String(n).padStart(2, '0'); }
function applyPeriod(h, period) {
  if (!period) return h;
  if (period === '下午' || period === '傍晚' || period === '晚上' || period === '夜里' || period === '夜晚') {
    if (h < 12) h += 12;
  } else if (period === '中午') {
    if (h < 6) h += 12; // "中午1点" -> 13
    else if (h === 12) h = 12;
  } else if (period === '凌晨' || period === '深夜') {
    if (h === 12) h = 0;
  } else if (period === '早上' || period === '早晨' || period === '上午') {
    if (h === 12) h = 0;
  }
  return h;
}
function parseDuration(text) {
  // 返回分钟，未找到返回 null
  let m;
  // 1小时30分 / 1h30m
  m = text.match(/(\d+(?:\.\d+)?)\s*(?:小时|h)\s*(\d+)\s*(?:分钟|分|m)/i);
  if (m) return Math.round(parseFloat(m[1]) * 60 + parseInt(m[2]));
  // 1.5小时 / 2h
  m = text.match(/(\d+(?:\.\d+)?)\s*(?:小时|h(?![a-z]))/i);
  if (m) return Math.round(parseFloat(m[1]) * 60);
  // 30分钟 / 30m
  m = text.match(/(\d+)\s*(?:分钟|分|m(?!s))/i);
  if (m) return parseInt(m[1]);
  // 中文：两小时 / 半小时
  m = text.match(/(一|二|两|三|四|五|六|七|八|九|十|半)\s*(?:个)?\s*小时/);
  if (m) return Math.round(CN_NUM[m[1]] * 60);
  return null;
}
function parseDate(text) {
  const today = todayStr();
  if (/今天|今日/.test(text)) return today;
  if (/明天|明日/.test(text)) return dateAdd(today, 1);
  if (/后天/.test(text)) return dateAdd(today, 2);
  if (/大后天/.test(text)) return dateAdd(today, 3);
  let m = text.match(/(\d+)\s*天后/);
  if (m) return dateAdd(today, parseInt(m[1]));
  m = text.match(/下周([一二三四五六日天])/);
  if (m) {
    const target = m[1] === '日' || m[1] === '天' ? 0 : '一二三四五六'.indexOf(m[1]) + 1;
    const cur = weekday(today);
    let delta = 7 + (target - cur);
    if (delta > 13) delta -= 7;
    if (delta <= 7) delta += 7;
    return dateAdd(today, delta);
  }
  m = text.match(/(?:这周|本周)?([一二三四五六日天])/);
  if (m && /(?:这周|本周|周)/.test(text)) {
    const target = m[1] === '日' || m[1] === '天' ? 0 : '一二三四五六'.indexOf(m[1]) + 1;
    const cur = weekday(today);
    let delta = (target - cur + 7) % 7;
    if (delta === 0) delta = 7;
    return dateAdd(today, delta);
  }
  m = text.match(/(\d+)\s*月\s*(\d+)\s*[日号]/);
  if (m) {
    const now = new Date();
    let d = new Date(now.getFullYear(), parseInt(m[1])-1, parseInt(m[2]));
    if (d < now && d.toDateString() !== now.toDateString()) d.setFullYear(d.getFullYear()+1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  return null;
}
function parseDeadline(text) {
  const m = text.match(/(?:截止|deadline|ddl)\s*[:：]?\s*([^,，、。]+)/i);
  if (!m) return null;
  return parseDate(m[1]);
}
function parseCategory(text) {
  // 关键词分类
  if (/学习\s*[一-龥]+/.test(text) && !/听课|抄作业|刷题|听讲座/.test(text)) {
    // 仅当明确说 学习xxx 才归 S
    return 'S';
  }
  if (/(论文|实验|文献|导师|组会|paper|research)/i.test(text)) return 'R';
  if (/(游泳|健身|跑步|阅读|读书|冥想|瑜伽|散步|锻炼|运动)/.test(text)) return 'G';
  return 'C';
}
function parseRecur(text) {
  // 每天xxx / 每周一三五xxx
  let m = text.match(/每天\s*(.+)/);
  if (m) return { days: [0,1,2,3,4,5,6], desc: m[1].trim() };
  m = text.match(/每(?:周|个星期)([一二三四五六日天]+)\s*(.+)/);
  if (m) {
    const dayChars = m[1].split('');
    const days = dayChars.map(c => c === '日' || c === '天' ? 0 : '一二三四五六'.indexOf(c) + 1).filter(d => d >= 0);
    return { days, desc: m[2].trim() };
  }
  m = text.match(/每周\s*(.+)/);
  if (m) return { days: [1], desc: m[1].trim() };
  return null;
}
function parseSegments(text) {
  return text.split(/[,，、]|然后|接着|再/).map(s => s.trim()).filter(Boolean);
}
/**
 * 优先级判定规则（彻底重写，2026-05-27）：
 *   第一步：重要性
 *     desc 含 论文/作业/报告/考试/答辩/项目/实验/文献/提交/交/due/deadline/ddl → 重要
 *   第二步：紧急性，满足任一即紧急
 *     - date 是今天或明天
 *     - 距离 deadline ≤ 3 天
 *     - desc 含 今天/明天/马上/立刻/紧急/尽快/截止
 *   第三步：组合
 *     重要+紧急→红 / 重要→蓝 / 紧急→橙 / 都不→默认
 *   第四步：默认 important（蓝）——宁可高估也不低估
 */
const IMPORTANT_KW = /论文|作业|报告|考试|答辩|项目|实验|文献|提交|交|due|deadline|ddl/i;
const URGENT_KW = /今天|明天|马上|立刻|紧急|尽快|截止/;

function inferPriority(desc, deadline, date, startTime) {
  const today = todayStr();
  const tomorrow = dateAdd(today, 1);

  let important = false, urgent = false;

  if (IMPORTANT_KW.test(desc || '')) important = true;
  if (URGENT_KW.test(desc || '')) urgent = true;

  if (date === today || date === tomorrow) urgent = true;

  if (deadline) {
    const d = diffDays(today, deadline);
    if (d <= 3) urgent = true;
    // deadline 7 天内也视为重要（弱触发，便于早动手）
    if (d <= 7) important = true;
  }

  if (urgent && important) return 'urgent-important';
  if (urgent) return 'urgent-unimportant';
  if (important) return 'important';
  // 第四步：无法判断时默认 important（蓝），而不是 normal
  return 'important';
}
function estimateDuration(desc) {
  // 简单启发
  if (/(吃饭|喝水|休息)/.test(desc)) return 30;
  if (/(会议|组会|课)/.test(desc)) return 90;
  if (/(写|阅读|学习|论文|实验)/.test(desc)) return 90;
  if (/(健身|跑步|游泳|锻炼)/.test(desc)) return 60;
  return 60;
}
function parseTaskText(text) {
  // 检测循环
  const recur = parseRecur(text);
  if (recur) {
    const startTimeInfo = parseStartTime(recur.desc);
    const dur = parseDuration(recur.desc) || 60;
    let working = recur.desc;
    if (startTimeInfo) working = working.replace(startTimeInfo.matched, '');
    const cleanDesc = working
      .replace(/(\d+(?:\.\d+)?)\s*(?:小时|h)(?:\s*\d+\s*(?:分钟|分|m))?/gi, '')
      .replace(/(\d+)\s*(?:分钟|分|m(?!s))/gi, '')
      .replace(/(一|二|两|三|四|五|六|七|八|九|十|半)\s*(?:个)?\s*小时/g, '')
      .trim();
    return [{
      type: 'recur',
      desc: cleanDesc || recur.desc,
      days: recur.days,
      durPlan: dur,
      startTime: startTimeInfo ? startTimeInfo.time : null,
      cat: parseCategory(cleanDesc),
      priority: 'normal'
    }];
  }
  // 多任务
  const segs = parseSegments(text);
  return segs.map(seg => {
    const startTimeInfo = parseStartTime(seg);
    const dur = parseDuration(seg);
    const date = parseDate(seg) || todayStr();
    const deadline = parseDeadline(seg);
    let working = seg;
    if (startTimeInfo) working = working.replace(startTimeInfo.matched, '');
    const cat = parseCategory(working);
    const cleanDesc = working
      .replace(/截止[^,，、。]+/, '')
      .replace(/deadline[^,，、。]+/i, '')
      .replace(/今天|明天|后天|大后天|下周[一二三四五六日天]|本周[一二三四五六日天]|这周[一二三四五六日天]|\d+天后|\d+月\d+[日号]/g, '')
      .replace(/(\d+(?:\.\d+)?)\s*(?:小时|h)(?:\s*\d+\s*(?:分钟|分|m))?/gi, '')
      .replace(/(\d+)\s*(?:分钟|分|m(?!s))/gi, '')
      .replace(/(一|二|两|三|四|五|六|七|八|九|十|半)\s*(?:个)?\s*小时/g, '')
      .trim();
    const finalDesc = cleanDesc || seg;
    return {
      type: 'task',
      desc: finalDesc,
      durPlan: dur,
      needConfirmDur: dur == null,
      estimatedDur: dur == null ? estimateDuration(finalDesc) : null,
      date,
      startTime: startTimeInfo ? startTimeInfo.time : null,
      timeLabel: startTimeInfo ? (startTimeInfo.timeLabel || null) : null,
      endTime: startTimeInfo ? (startTimeInfo.endTime || null) : null,
      deadline,
      cat,
      priority: inferPriority(finalDesc, deadline, date, startTimeInfo ? startTimeInfo.time : null)
    };
  });
}

/* ---------------- 输入提交 ---------------- */
/* ---------------- 自然语言操作识别 ---------------- */
const OPERATION_KW = /(?:推到|挪到|顺延|改成|改为|压缩|删除所有|今天不做|不做了|改时长|调整到|清空)/;

function isOperationCommand(text) {
  return OPERATION_KW.test(text);
}

function handleTextInput(text) {
  text = text.trim();
  if (!text) return;

  // 统一默认走 AI：用用户配置的文字模型理解意图（新建任务 / 操作指令）
  if (getApiKey()) {
    callTaskAI(text);
    return;
  }

  // 未配置 API Key → 回退本地正则解析
  handleTextInputLocal(text);
}

// 本地正则解析路径（无 API Key 或 AI 失败时的回退）
function handleTextInputLocal(text) {
  text = text.trim();
  if (!text) return;

  // 操作指令需要 AI，本地无法处理
  if (isOperationCommand(text)) {
    toast('操作指令需要先配置 API Key');
    return;
  }

  const parsed = parseTaskText(text);
  if (parsed.length === 0) { toast('没解析到任务'); return; }

  // 处理循环
  if (parsed[0].type === 'recur') {
    const r = parsed[0];
    const tpl = {
      id: uid(),
      desc: r.desc,
      cat: r.cat,
      priority: r.priority,
      durPlan: r.durPlan,
      startTime: r.startTime || null,
      days: r.days,
      createdAt: todayStr()
    };
    state.recurTemplates.push(tpl);
    dailyTick();
    render();
    toast(`已创建循环任务：${r.desc}`);
    return;
  }

  // 检查是否需要确认时长
  const needConfirm = parsed.filter(p => p.needConfirmDur);
  if (needConfirm.length > 0) {
    showDurationConfirmModal(parsed);
  } else {
    parsed.forEach(p => state.tasks.push(makeTask(p)));
    saveState();
    render();
    toast(`已添加 ${parsed.length} 个任务`);
  }
}

