/* MOTO // GARAGE — 导航体验
   职责：侧栏分组语义、移动端「更多」面板开关与状态同步。
   不改动路由本身（app.js 负责），只增强交互与可访问性。 */
(function (M) {
  'use strict';

  var HIDDEN_IN_TAB = ['ride', 'links', 'media']; // 收进「更多」的路由
  var moreSheet, backdrop, moreBtn;

  function open() {
    if (!moreSheet) return;
    moreSheet.hidden = false;
    if (backdrop) backdrop.hidden = false;
    if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('more-open');
    var first = moreSheet.querySelector('.more-item');
    if (first) first.focus();
  }

  function close() {
    if (!moreSheet) return;
    moreSheet.hidden = true;
    if (backdrop) backdrop.hidden = true;
    if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('more-open');
  }

  function isOpen() { return !!(moreSheet && !moreSheet.hidden); }

  /* 路由变化时：tabbar 只标亮 5 个常驻项；若当前页在「更多」里，则高亮更多按钮 */
  function syncActive(key) {
    if (moreBtn) moreBtn.classList.toggle('is-active', HIDDEN_IN_TAB.indexOf(key) > -1);
  }

  function init() {
    moreSheet = M.$('#more-sheet');
    backdrop = M.$('#more-backdrop');
    moreBtn = M.$('#tab-more');
    if (!moreSheet || !moreBtn) return;

    moreBtn.addEventListener('click', function () { isOpen() ? close() : open(); });
    if (backdrop) backdrop.addEventListener('click', close);
    var closeBtn = M.$('#more-close');
    if (closeBtn) closeBtn.addEventListener('click', close);

    // 面板内点击「更多」条目后跳转（hashchange 由 app.js 处理），关闭面板
    M.$$('.more-item', moreSheet).forEach(function (item) {
      item.addEventListener('click', function () {
        if (item.getAttribute('data-act') === 'more-sync') {
          close();
          if (M.cloud) M.cloud.openPanel();
          return;
        }
        if (item.getAttribute('href')) close();
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) { close(); moreBtn.focus(); }
    });

    // 视口切回桌面时关闭面板，避免残留状态
    window.addEventListener('resize', function () {
      if (isOpen() && window.innerWidth > 960) close();
    });

    // 侧栏分组：给每组标注 role，便于读屏理解结构
    M.$$('[data-nav-group]').forEach(function (g) {
      g.setAttribute('role', 'group');
      var label = g.querySelector('.nav-group-label');
      if (label && label.getAttribute('aria-hidden') === 'true') {
        g.setAttribute('aria-label', (label.querySelector('span') || {}).textContent || '导航分组');
      }
    });

    M.on('route:change', function (key) { syncActive(key); });
  }

  M.nav = { init: init, openMore: open, closeMore: close, isMoreOpen: isOpen };
})(window.MOTO);
