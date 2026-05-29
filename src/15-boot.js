(async function bootApp() {
  try {
    await bootAuth();
    if (authStatus === 'unauth') {
      showAuthOverlay();
    } else {
      hideAuthOverlay();
      checkMorningPlan();
    }
    render();
    console.log('[Chronos] bootApp 完成, authStatus =', authStatus);
  } catch(e) {
    console.error('[Chronos] bootApp 失败:', e);
    // 降级为 guest 模式，保证 UI 可用
    authStatus = 'guest';
    try { hideAuthOverlay(); render(); } catch(_) {}
  }
})();

/* 登录页按钮绑定 — 元素可能不存在，每个 getElementById 都守卫 */
try {
  const ov = document.getElementById('auth-overlay');
  if (ov) {
    const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    const isValidEmail = v => EMAIL_RE.test(v) && !v.includes('..');
    const SNAIL_API_URL = 'https://snail-api.friday0.top';

    /* ── 登录表单元素 ── */
    const loginForm  = document.getElementById('auth-login-form');
    const emailIn    = document.getElementById('auth-email');
    const passIn     = document.getElementById('auth-password');
    const errEl      = document.getElementById('auth-error');
    const btnLogin   = document.getElementById('btn-login');
    const btnReg     = document.getElementById('btn-register');
    const btnGuest   = document.getElementById('btn-guest');
    const showLoginErr = msg => { if (errEl) errEl.textContent = msg || ''; };

    /* ── 注册表单元素 ── */
    const registerForm  = document.getElementById('auth-register-form');
    const regEmailIn    = document.getElementById('reg-email');
    const regCodeIn     = document.getElementById('reg-code');
    const regPassIn     = document.getElementById('reg-password');
    const regErrEl      = document.getElementById('reg-error');
    const btnSendCode   = document.getElementById('btn-send-code');
    const btnBackLogin  = document.getElementById('btn-back-login');
    const btnDoRegister = document.getElementById('btn-do-register');
    const showRegErr = msg => { if (regErrEl) regErrEl.textContent = msg || ''; };

    /* ── 切换到注册表单 ── */
    if (btnReg) btnReg.onclick = () => {
      showLoginErr('');
      const prefill = (emailIn && emailIn.value || '').trim();
      if (regEmailIn && prefill) regEmailIn.value = prefill;
      if (loginForm) loginForm.classList.add('hidden');
      if (registerForm) registerForm.classList.remove('hidden');
      if (regEmailIn) regEmailIn.focus();
    };

    /* ── 返回登录表单 ── */
    if (btnBackLogin) btnBackLogin.onclick = () => {
      showRegErr('');
      if (registerForm) registerForm.classList.add('hidden');
      if (loginForm) loginForm.classList.remove('hidden');
    };

    /* ── 发送验证码（60s 冷却） ── */
    let cooldownTimer = null;
    if (btnSendCode) btnSendCode.onclick = async () => {
      showRegErr('');
      const email = (regEmailIn && regEmailIn.value || '').trim();
      if (!email) { showRegErr('请填写邮箱'); return; }
      if (!isValidEmail(email)) { showRegErr('邮箱格式不正确'); return; }

      btnSendCode.disabled = true;
      btnSendCode.textContent = '发送中…';
      try {
        const resp = await fetch(`${SNAIL_API_URL}/api/send-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!data.success) {
          showRegErr(data.message || '发送失败，请重试');
          btnSendCode.textContent = '发送验证码';
          btnSendCode.disabled = false;
          return;
        }
      } catch (_) {
        showRegErr('发送失败，请重试');
        btnSendCode.textContent = '发送验证码';
        btnSendCode.disabled = false;
        return;
      }

      let secs = 60;
      btnSendCode.textContent = `${secs}s`;
      clearInterval(cooldownTimer);
      cooldownTimer = setInterval(() => {
        secs--;
        if (secs <= 0) {
          clearInterval(cooldownTimer);
          btnSendCode.textContent = '重新发送';
          btnSendCode.disabled = false;
        } else {
          btnSendCode.textContent = `${secs}s`;
        }
      }, 1000);
    };

    /* ── 确认注册 ── */
    if (btnDoRegister) btnDoRegister.onclick = async () => {
      showRegErr('');
      const email    = (regEmailIn && regEmailIn.value || '').trim();
      const code     = (regCodeIn  && regCodeIn.value  || '').trim();
      const password = (regPassIn  && regPassIn.value) || '';

      if (!email)                   { showRegErr('请填写邮箱'); return; }
      if (!isValidEmail(email))     { showRegErr('邮箱格式不正确'); return; }
      if (!/^\d{6}$/.test(code))    { showRegErr('请输入6位数字验证码'); return; }
      if (password.length < 6)      { showRegErr('密码至少 6 位'); return; }

      btnDoRegister.disabled = true;
      try {
        const vResp = await fetch(`${SNAIL_API_URL}/api/verify-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code }),
        });
        const vData = await vResp.json().catch(() => ({}));
        if (!vData.valid) {
          showRegErr(vData.message || '验证码错误');
          return;
        }
        const r = await registerWithEmail(email, password);
        if (r && r.error)          showRegErr(r.error);
        else if (r && r.needsConfirm) showRegErr('注册成功，请查收确认邮件');
      } catch (_) {
        showRegErr('注册失败，请重试');
      } finally {
        btnDoRegister.disabled = false;
      }
    };

    /* ── 登录 ── */
    if (btnLogin) btnLogin.onclick = async () => {
      showLoginErr('');
      const email    = (emailIn && emailIn.value || '').trim();
      const password = (passIn  && passIn.value) || '';
      if (!email || !password) { showLoginErr('请填邮箱和密码'); return; }
      if (!isValidEmail(email)) { showLoginErr('邮箱格式不正确'); return; }
      const r = await loginWithEmail(email, password);
      if (r && r.error) showLoginErr(r.error);
    };

    if (btnGuest) btnGuest.onclick = enterGuestMode;

    [emailIn, passIn].forEach(el => el && el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && btnLogin) btnLogin.click();
    }));
  }
} catch(e) { console.error('[Chronos] wireAuthPage 失败:', e); }

/* 网络状态监听 */
window.addEventListener('online', () => {
  if (authStatus === 'cloud') {
    syncStatus = 'syncing'; updateSyncIndicator();
    // 恢复网络：先推本地改动，再拉云端最新（任务 / AI 配置 / 对话历史）
    pushAllToCloud().then(autoPullFromCloud);
  }
});
window.addEventListener('offline', () => {
  if (authStatus === 'cloud') {
    syncStatus = 'offline'; updateSyncIndicator();
  }
});

/* 自动下行同步：从云端拉取任务、AI 配置、对话历史的最新数据 */
function autoPullFromCloud() {
  if (authStatus !== 'cloud' || !navigator.onLine) return;
  try { syncFromCloud(); } catch(_) {}
  try { syncAiProfilesFromCloud(); } catch(_) {}
  try { syncChatHistoryFromCloud(); } catch(_) {}
}

/* 回到前台（切回标签页 / 解锁）时自动拉取云端最新，跨设备改动无需手动同步。
 * 任务表已有 Realtime 订阅；此处补齐对话历史、AI 配置以及订阅可能掉线后的兜底。 */
let _lastAutoPull = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (authStatus !== 'cloud' || !navigator.onLine) return;
  const now = Date.now();
  if (now - _lastAutoPull < 5000) return; // 节流，避免频繁切换重复拉取
  _lastAutoPull = now;
  autoPullFromCloud();
});

/* ===================== Service Worker 注册 + 强制更新检测 =====================
 * 每次 push 后用户下次打开 app：
 *   1. register('sw.js') → 浏览器拉最新 sw.js
 *   2. reg.update() 立即检查更新
 *   3. 字节不同 → install (skipWaiting) → activated → controllerchange
 *   4. 自动 reload → 用户看到最新版本，localStorage 完整保留
 * 用 refreshing 旗子防止 statechange 和 controllerchange 双重 reload
 * 用 hadController 判断首次安装 vs 更新场景，首次安装不刷新（页面已是最新）
 * ============================================================================ */
// 强化守卫：iOS 私密浏览 / 某些 PWA 上下文里 'serviceWorker' in navigator 为真但 navigator.serviceWorker === undefined
try {
  if ('serviceWorker' in navigator && navigator.serviceWorker) {
    var refreshing = false;
    var hadController = false;
    try { hadController = !!navigator.serviceWorker.controller; } catch(_) {}
  const doReload = () => {
    if (refreshing) return;
    refreshing = true;
    console.log('[App] 新版本已激活，自动刷新');
    window.location.reload();
  };

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => {
        // 立即检查是否有新版本
        reg.update().catch(() => {});
        // 监听新 SW 出现并激活
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            // activated 状态触发刷新；仅在更新场景（已有 controller）才刷
            if (nw.state === 'activated' && hadController) {
              doReload();
            }
          });
        });
      })
      .catch(err => console.warn('SW register failed:', err));
  });

  // controllerchange：新 SW 接管页面时也触发；同样仅更新场景才刷
  // refreshing 旗子和 doReload 函数共享，避免和 statechange 冲突
  if (hadController) {
    navigator.serviceWorker.addEventListener('controllerchange', doReload);
  }

  // 用户从后台切回 app 时主动检查更新
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) reg.update().catch(() => {});
      });
    }
  });
  }
} catch(e) { console.error('[Chronos] SW 注册失败:', e); }

/* 暴露给 onclick */
window.startTimer = startTimer;
window.pauseTimer = pauseTimer;
window.stopTimer = stopTimer;
window.toggleComplete = toggleComplete;
window.deleteTask = deleteTask;
window.favoriteTask = favoriteTask;
window.showCatPicker = showCatPicker;
window.showPriorityPicker = showPriorityPicker;
window.deleteRecur = deleteRecur;
window.deleteFav = deleteFav;
window.addFromFavorite = addFromFavorite;
window.exportTaskICS = exportTaskICS;
window.aiSummary = aiSummary;
window.render = render;
window.showTaskDetailModal = showTaskDetailModal;
window.showRecurTemplateModal = showRecurTemplateModal;
window.scrollToFirstProcrastinated = scrollToFirstProcrastinated;
window.acceptMorningPlan = acceptMorningPlan;
window.dismissMorningPlan = dismissMorningPlan;
window.decomposeTask = decomposeTask;
window.undoLastOperation = undoLastOperation;
window.startCheckIn = startCheckIn;
window.manualSync = manualSync;
window.logoutCloud = logoutCloud;
window.showAuthOverlay = showAuthOverlay;
window.smartRecommendFocus = smartRecommendFocus;
window.removeFromFocus = removeFromFocus;
window.togglePin = togglePin;
window.setInputMode = setInputMode;
window.togglePinMemo = togglePinMemo;
window.archiveMemo = archiveMemo;
window.memoToTask = memoToTask;
window.toggleMemoCollapsed = toggleMemoCollapsed;
window.showTimeLabelInfo = showTimeLabelInfo;

/* ===================== 新手引导 ===================== */
(function () {
  'use strict';

  function makeSnailSVG(w, h) {
    var sp = '';
    try { if (typeof makeSpiralPath === 'function') sp = makeSpiralPath(75, 50, 20, 3, 2.5, 120); } catch (_) {}
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 120 100" xmlns="http://www.w3.org/2000/svg">'
      + '<path d="M 32 32 Q 8 32 8 55 Q 8 75 28 75 L 72 75" fill="none" stroke="#6B4C2A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="' + sp + '" fill="none" stroke="#6B4C2A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="14" cy="22" r="2" fill="#6B4C2A"/>'
      + '<circle cx="25" cy="19" r="2" fill="#6B4C2A"/>'
      + '</svg>';
  }

  var STEPS = [
    { type: 'full', n: 1 },
    { type: 'tip', n: 2, tab: 'today', sel: '.cat-tag',
      title: '给每件事找到位置',
      body: 'S学习  R科研  G成长  C杂事\n四个分类，覆盖生活的全部。' },
    { type: 'tip', n: 3, tab: null, sel: '.pri-edge',
      title: '一眼看出轻重缓急',
      body: '左侧颜色条代表优先级\n颜色越深，越需要先做。' },
    { type: 'tip', n: 4, tab: 'plans', sel: '.input-bar',
      title: '加任务很简单',
      body: '手动输入，或截图发给AI\n它帮你解析成结构化任务。' },
    { type: 'tip', n: 5, tab: 'today', sel: '.focus-block',
      title: '今天最重要的三件事',
      body: '把任务pin在这里，最多3个\n先做完它们，其他都是次要的。' },
    { type: 'tip', n: 6, tab: 'today', sel: '#today-list .task-card',
      title: '今天做不完？左滑',
      body: '选明天、后天或下周一\n同一任务推迟3次会有特别提示。',
      swipe: true },
    { type: 'tip', n: 7, tab: 'today', sel: '.day-end-btn',
      title: '可以体面地收工',
      body: '把非紧急任务一键移到明天\n不是放弃，是量力而行。',
      scrollBottom: true },
    { type: 'tip', n: 8, tab: 'stats', sel: '.snail-journey-mileage',
      title: '每一步都算数',
      body: '完成任务蜗牛就往前爬\n累积里程解锁成就，慢慢来。',
      delay: 280 },
    { type: 'full', n: 9 },
  ];

  var cur = 0;
  var guideActive = false;
  var renderGen = 0;
  var parts = [];
  var ring = null;
  var tipEl = null;
  var fullEl = null;
  var skipBtn = null;
  var fingerEl = null;

  function mkEl(tag, cls) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    return d;
  }

  function cleanup() {
    [ring, tipEl, fullEl, fingerEl].forEach(function (e) { if (e) e.remove(); });
    ring = tipEl = fullEl = fingerEl = null;
    parts.forEach(function (e) { e.remove(); });
    parts = [];
  }

  function mkParts() {
    for (var i = 0; i < 4; i++) {
      var d = mkEl('div', 'guide-overlay-part');
      document.body.appendChild(d);
      parts.push(d);
    }
  }

  function posParts(r) {
    var W = window.innerWidth, H = window.innerHeight, pad = 5;
    var l = Math.max(0, r.left - pad);
    var t = Math.max(0, r.top - pad);
    var ri = Math.min(W, r.right + pad);
    var b = Math.min(H, r.bottom + pad);
    parts[0].style.cssText = 'left:0;top:0;width:' + W + 'px;height:' + t + 'px';
    parts[1].style.cssText = 'left:0;top:' + b + 'px;width:' + W + 'px;height:' + (H - b) + 'px';
    parts[2].style.cssText = 'left:0;top:' + t + 'px;width:' + l + 'px;height:' + (b - t) + 'px';
    parts[3].style.cssText = 'left:' + ri + 'px;top:' + t + 'px;width:' + (W - ri) + 'px;height:' + (b - t) + 'px';
    if (ring) {
      ring.style.left = l + 'px'; ring.style.top = t + 'px';
      ring.style.width = (ri - l) + 'px'; ring.style.height = (b - t) + 'px';
    }
  }

  function fullParts() {
    var W = window.innerWidth, H = window.innerHeight;
    parts[0].style.cssText = 'left:0;top:0;width:' + W + 'px;height:' + H + 'px';
    [1, 2, 3].forEach(function (i) { parts[i].style.cssText = 'left:0;top:0;width:0;height:0'; });
  }

  function dotsHTML(active) {
    var h = '<div class="guide-dots">';
    for (var i = 0; i < 9; i++) h += '<div class="guide-dot' + (i === active ? ' active' : '') + '"></div>';
    return h + '</div>';
  }

  function switchTab(tab) {
    var btn = document.querySelector('.tab[data-tab="' + tab + '"]');
    if (btn) btn.click();
  }

  function posTip(r) {
    var W = window.innerWidth;
    var tipW = Math.min(280, W - 32);
    tipEl.style.width = tipW + 'px';
    var cx = r ? (r.left + r.right) / 2 : W / 2;
    var left = Math.max(16, Math.min(cx - tipW / 2, W - tipW - 16));
    tipEl.style.left = left + 'px';
    var arrowEl = tipEl.querySelector('.guide-tooltip-arrow');
    var tipH = 175;
    if (r && r.top > tipH + 20) {
      tipEl.style.top = Math.max(8, r.top - tipH - 14) + 'px';
      if (arrowEl) arrowEl.className = 'guide-tooltip-arrow arr-down';
    } else {
      var topV = r ? r.bottom + 14 : (window.innerHeight / 2 - tipH / 2);
      tipEl.style.top = Math.min(topV, window.innerHeight - tipH - 8) + 'px';
      if (arrowEl) arrowEl.className = 'guide-tooltip-arrow arr-up';
    }
  }

  function drawTip(step, targetEl, gen) {
    if (!guideActive || gen !== renderGen) return;
    var r = null;
    if (targetEl) {
      r = targetEl.getBoundingClientRect();
      if (!r || r.width === 0) r = null;
    }
    mkParts();
    if (r) {
      ring = mkEl('div', 'guide-highlight-ring');
      document.body.appendChild(ring);
      posParts(r);
    } else {
      fullParts();
    }
    var idx = cur;
    var hidePrev = idx <= 1;
    tipEl = mkEl('div', 'guide-tooltip');
    tipEl.innerHTML = '<div class="guide-tooltip-arrow"></div>'
      + '<div class="guide-tooltip-title">' + step.title + '</div>'
      + '<div class="guide-tooltip-body">' + step.body + '</div>'
      + dotsHTML(idx)
      + '<div class="guide-btn-row">'
      + '<button class="guide-btn-prev"' + (hidePrev ? ' style="visibility:hidden"' : '') + ' id="g-prev">← 上一步</button>'
      + '<button class="guide-btn-next" id="g-next">下一步 →</button>'
      + '</div>';
    document.body.appendChild(tipEl);
    posTip(r);
    document.getElementById('g-prev').onclick = prev;
    document.getElementById('g-next').onclick = next;
    if (step.swipe && r) {
      fingerEl = mkEl('div', 'guide-swipe-finger');
      fingerEl.textContent = '👆';
      fingerEl.style.left = (r.right - 28) + 'px';
      fingerEl.style.top = ((r.top + r.bottom) / 2) + 'px';
      document.body.appendChild(fingerEl);
    }
  }

  function renderTip(step, gen) {
    var needSwitch = step.tab && typeof currentTab !== 'undefined' && currentTab !== step.tab;
    if (needSwitch) switchTab(step.tab);
    var delay = step.delay || (needSwitch ? 240 : 0);

    var doIt = function () {
      if (!guideActive || gen !== renderGen) return;
      var doRender = function () {
        if (!guideActive || gen !== renderGen) return;
        var el = document.querySelector(step.sel);
        if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
        drawTip(step, el, gen);
      };
      if (step.scrollBottom) {
        window.scrollTo(0, document.body.scrollHeight);
        setTimeout(function () {
          if (!guideActive || gen !== renderGen) return;
          drawTip(step, document.querySelector(step.sel), gen);
        }, 200);
      } else {
        doRender();
      }
    };

    if (delay > 0) setTimeout(doIt, delay); else doIt();
  }

  function renderFull(step) {
    mkParts();
    fullParts();
    fullEl = mkEl('div', 'guide-fullscreen');
    if (step.n === 1) {
      fullEl.innerHTML = '<div class="guide-fullscreen-snail">' + makeSnailSVG(80, 66) + '</div>'
        + '<h2 class="guide-fullscreen-title">欢迎来到 Snail</h2>'
        + '<p class="guide-fullscreen-body">不是要你做更多<br>是要你做得更踏实</p>'
        + '<p class="guide-fullscreen-sub">Slow down &amp; Get things done</p>'
        + '<button class="guide-fullscreen-btn" id="gf-btn">开始了解 →</button>';
    } else {
      fullEl.innerHTML = '<div class="guide-fullscreen-snail">' + makeSnailSVG(80, 66) + '</div>'
        + '<h2 class="guide-fullscreen-title">蜗牛已就位</h2>'
        + '<p class="guide-fullscreen-body">慢慢来，比较快。</p>'
        + '<button class="guide-fullscreen-btn" id="gf-btn">开始使用</button>';
    }
    document.body.appendChild(fullEl);
    var btn = document.getElementById('gf-btn');
    if (btn) btn.onclick = next;
  }

  function render() {
    if (!guideActive) return;
    var gen = ++renderGen;
    cleanup();
    var step = STEPS[cur];
    var isLast = step.n === 9;
    if (!skipBtn) {
      skipBtn = mkEl('button', 'guide-skip');
      skipBtn.textContent = '跳过';
      skipBtn.onclick = function () { cur = 8; render(); };
      document.body.appendChild(skipBtn);
    }
    skipBtn.style.display = isLast ? 'none' : '';
    if (step.type === 'full') renderFull(step);
    else renderTip(step, gen);
  }

  function next() {
    if (cur >= STEPS.length - 1) { finish(); return; }
    cur++;
    render();
  }

  function prev() {
    if (cur <= 0) return;
    cur--;
    render();
  }

  function finish() {
    guideActive = false;
    cleanup();
    if (skipBtn) { skipBtn.remove(); skipBtn = null; }
    try { localStorage.setItem('snail_guide_done', 'true'); } catch (_) {}
  }

  function startGuide() {
    guideActive = true;
    cur = 0;
    cleanup();
    if (skipBtn) { skipBtn.remove(); skipBtn = null; }
    render();
  }

  window.startOnboarding = function () {
    try { localStorage.removeItem('snail_guide_done'); } catch (_) {}
    startGuide();
  };

  setTimeout(function () {
    try { if (localStorage.getItem('snail_guide_done')) return; } catch (_) { return; }
    var authOv = document.getElementById('auth-overlay');
    if (authOv && !authOv.classList.contains('hidden')) {
      var obs = new MutationObserver(function () {
        if (authOv.classList.contains('hidden')) {
          obs.disconnect();
          setTimeout(startGuide, 600);
        }
      });
      obs.observe(authOv, { attributes: true, attributeFilter: ['class'] });
    } else {
      startGuide();
    }
  }, 2700);
})();
