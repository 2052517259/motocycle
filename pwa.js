/* MOTO // GARAGE — PWA 安装与离线状态
   职责：注册 Service Worker、捕获安装提示、提供手动安装入口、显示离线状态。
   不修改任何业务数据；浏览器不支持时静默降级，不影响站点其它功能。 */
(function (M) {
  'use strict';

  var deferredPrompt = null;
  var swReg = null;
  var isStandalone = false;

  function canInstall() {
    return !!deferredPrompt;
  }

  /* 是否已以应用模式运行（添加到主屏幕后打开） */
  function inStandalone() {
    return isStandalone ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }

  function offlineChip(show) {
    var el = M.$('#offline-chip');
    if (!el) return;
    el.hidden = !show;
  }

  function updateNetwork() {
    offlineChip(!navigator.onLine);
    M.emit('pwa:network', { online: navigator.onLine });
  }

  /* 注册 Service Worker —— 仅在 https 或 localhost（SW 的安全上下文要求） */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    var ok = location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (!ok) return; // file:// 等环境不支持，静默跳过
    function doRegister() {
      navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
        swReg = reg;
        // 发现新版本时提示用户刷新
        reg.onupdatefound = function () {
          var nw = reg.installing;
          if (!nw) return;
          nw.onstatechange = function () {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              M.toast('应用已更新到新版本，刷新后生效', 'info', 4200);
            }
          };
        };
      }).catch(function (e) {
        console.warn('[MOTO] service worker registration failed', (e && e.message) || e);
      });
    }
    // SW 注册不依赖页面图片等资源加载完成，直接注册即可（避免 load 事件被慢资源拖住）
    doRegister();
  }

  /* 顶部/侧栏安装入口：始终显示，点击时按能力分流 */
  function bindInstallButtons() {
    M.$$('[data-act="pwa-install"]').forEach(function (b) {
      b.addEventListener('click', function () { install(); });
    });
  }

  function install() {
    if (inStandalone()) { M.toast('当前已在桌面应用模式中', 'info'); return; }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        deferredPrompt = null;
        renderInstallUI();
        if (choice && choice.outcome === 'accepted') M.toast('正在添加到桌面…', 'ok');
      });
      return;
    }
    // 未捕获到安装事件：给出平台指引
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var tip = isIOS
      ? 'iPhone / iPad：点击 Safari 底部的「分享」按钮 → 选择「添加到主屏幕」。'
      : '在浏览器地址栏右侧点击「安装应用」图标（或使用菜单中的「安装 / 添加到主屏幕」）。若刚访问，请先联网刷新一次再试。';
    M.modal({
      title: '安装到桌面',
      body: '<div class="pwa-guide"><div class="pwa-guide-icon"><svg class="icon"><use href="#i-dashboard"/></svg></div>' +
        '<p>' + M.esc(tip) + '</p>' +
        '<p class="pwa-guide-note">安装后可离线打开，数据仍保存在本机浏览器；支持快捷方式直达看板、加油与出行准备。</p></div>',
      footer: '<button class="btn btn--primary" data-close>知道了</button>'
    });
  }

  /* 根据安装状态刷新所有入口的显示文案 */
  function renderInstallUI() {
    var inApp = inStandalone();
    M.$$('[data-act="pwa-install"]').forEach(function (b) {
      var label = b.querySelector('span');
      if (label) label.textContent = inApp ? '已在应用模式' : (deferredPrompt ? '安装到桌面' : '添加到桌面');
      b.classList.toggle('is-hidden', inApp);
    });
    var hint = M.$('#pwa-hint');
    if (hint) hint.hidden = inApp;
  }

  function init() {
    isStandalone = inStandalone();
    updateNetwork();
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      renderInstallUI();
      M.toast('可安装到桌面，离线也能打开本站', 'info', 3600);
    });
    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      renderInstallUI();
      M.toast('已添加到桌面', 'ok');
    });

    bindInstallButtons();
    renderInstallUI();
    registerSW();
  }

  M.pwa = {
    init: init,
    install: install,
    canInstall: canInstall,
    inStandalone: inStandalone,
    state: function () {
      return {
        sw: !!swReg,
        swActive: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
        online: navigator.onLine,
        standalone: inStandalone(),
        prompt: !!deferredPrompt
      };
    }
  };
})(window.MOTO);
