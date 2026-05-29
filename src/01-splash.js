/* =====================================================================
 * Snail - 个人时间管理 PWA
 * 设计哲学：克制、简洁、有重量感
 * ===================================================================== */

/* ╔══════════════════════════════════════════════════════════════════╗
 * ║ SPLASH DISMISS — 必须放在 <script> 第一行，独立 IIFE             ║
 * ║                                                                  ║
 * ║ 之前的卡死原因：splash dismiss setTimeout 注册在脚本第 5300+ 行， ║
 * ║ 如果脚本顶部任何同步代码（如 loadState）抛未捕获错误，主脚本会   ║
 * ║ 提前中断，setTimeout 永远不被排队，splash 永远不消失。           ║
 * ║                                                                  ║
 * ║ 修复策略：把 setTimeout 提前到脚本第一行 IIFE，独立自包含：      ║
 * ║   - 不依赖任何函数、变量、Promise、事件                         ║
 * ║   - 不依赖 DOMContentLoaded（脚本在 body 末尾，splash 已经存在） ║
 * ║   - 即使后面所有代码崩了，splash 也会 2.4s 后消失                ║
 * ║   - 写法用 var + function() {}，绕开任何 TDZ / closure 问题      ║
 * ╚══════════════════════════════════════════════════════════════════╝ */
(function () {
  setTimeout(function () {
    var splash = document.getElementById('splash');
    var main = document.querySelector('.app');
    var tabbar = document.querySelector('.tabbar');
    console.log('[Splash] 2s 计时到，准备淡出; splash =', splash, '; main =', main, '; tabbar =', tabbar);
    if (!splash) {
      // splash 元素不存在时立刻显示主界面
      if (main) main.style.display = '';
      if (tabbar) tabbar.style.display = '';
      return;
    }
    splash.style.transition = 'opacity 0.4s ease-out';
    splash.style.opacity = '0';
    setTimeout(function () {
      splash.style.display = 'none';
      if (main) { main.style.display = ''; main.style.opacity = '1'; }
      if (tabbar) tabbar.style.display = '';
      console.log('[Splash] 已隐藏，主界面已显示');
    }, 400);
  }, 2000);

  // 终极兜底：5 秒后不管发生什么，强制把 splash 干掉
  setTimeout(function () {
    var splash = document.getElementById('splash');
    var main = document.querySelector('.app');
    var tabbar = document.querySelector('.tabbar');
    if (splash && splash.style.display !== 'none') {
      console.warn('[Splash] 5s 终极兜底：强制隐藏');
      splash.style.display = 'none';
    }
    if (main && main.style.display === 'none') main.style.display = '';
    if (tabbar && tabbar.style.display === 'none') tabbar.style.display = '';
  }, 5000);
})();

