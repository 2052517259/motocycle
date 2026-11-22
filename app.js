/* MOTO // GARAGE — bootstrap, router & dashboard */
(function (M) {
  'use strict';

  function routeFromHash() {
    var h = (location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
    return M.ROUTES.some(function (r) { return r.key === h; }) ? h : 'home';
  }
  /* 方向8：惰性初始化——重模块脚本仍在首屏加载（保证模块对象存在、功能零回归），
     但其 init()（DOM 渲染 / 事件绑定）延迟到首次进入对应视图，缩短首屏关键路径。 */
  var lazyDone = {};
  var LAZY = {
    notes: function () { M.notes.init(); },
    links: function () { M.links.init(); },
    media: function () { M.media.init(); },
    ride: function () { M.routes.init(); },
    fuel: function () { M.fuelBoard.init(); },
    appearance: function () { /* appearance 已在 head 早期初始化，无需重复 */ }
  };
  function ensureView(key) {
    if (lazyDone[key] || !LAZY[key]) return;
    try { LAZY[key](); lazyDone[key] = true; }
    catch (e) { console.warn('[MOTO] lazy init failed: ' + key, e); }
  }

  function setRoute(key, initial) {
    var meta = M.ROUTES.filter(function (r) { return r.key === key; })[0];
    M.$$('.view').forEach(function (v) { v.classList.toggle('is-active', v.getAttribute('data-view') === key); });
    M.$$('[data-route]').forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('data-route') === key); });
    M.$('#crumb-idx').textContent = meta.idx;
    M.$('#crumb-name').textContent = meta.name;
    var label = meta.name.split(' / ')[0];
    document.title = label + ' — MOTO // GARAGE';
    // 无障碍：进入视图后把焦点交给 main，并播报视图名（不滚动到顶部时也有反馈）
    var announcer = M.$('#route-announcer');
    if (announcer) announcer.textContent = '已进入' + label;
    if (!initial) {
      window.scrollTo({ top:0, behavior:'smooth' });
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
    // 惰性初始化目标视图，再广播路由事件（保证模块监听已就绪）
    ensureView(key);
    M.emit('route:change', key);
  }

  function clock() {
    var t = M.clockText();
    var a = M.$('#top-clock'), b = M.$('#side-clock');
    if (a) a.textContent = t;
    if (b) b.textContent = t;
  }
  function homeDate() {
    var d = new Date(), w = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
    M.$('#home-date').textContent = d.getFullYear() + '.' + M.pad2(d.getMonth() + 1) + '.' + M.pad2(d.getDate()) + ' / ' + w;
  }
  function refreshStats() {
    var d = M.store.data;
    M.$('#stat-notes').textContent = d.notes.length;
    M.$('#stat-links').textContent = d.links.length;
    M.$('#stat-cats').textContent = d.linkCats.length + ' 个分类';
    M.$('#stat-media').textContent = d.mediaIndex.length;
    var total = d.mediaIndex.reduce(function (s, m) { return s + (m.size || 0); }, 0);
    M.$('#stat-media-size').textContent = total ? M.fmtSize(total) : '0 MB';
    var sum = M.fuelBoard ? M.fuelBoard.aggregate() : null;
    var entry = M.$('#home-fb-summary');
    if (entry && sum) {
      entry.textContent = sum.logs.length
        ? '累计 ' + Number(sum.totalKm).toFixed(0) + ' km · ' + money0(sum.totalCost) + ' · ' + sum.logs.length + ' 次记录'
        : '累计里程与油费，一目了然';
    }
  }
  function money0(n) { return '¥' + Math.round(Number(n)); }

  function boot() {
    clock(); setInterval(clock, 1000);
    homeDate(); refreshStats();

    // 首屏关键模块：壁纸、天气（首页天气卡）、PWA、导航、云同步立即初始化
    M.wallpaper.init();
    M.weather.init();
    M.pwa.init();
    M.nav.init();
    M.cloud.init();
    // 重视图模块改为首次进入时惰性初始化（见 ensureView），缩短首屏路径。
    // 注意：初始路由若是某个重视图，setRoute 会立即触发对应 ensureView。

    M.$('#sync-chip').addEventListener('click', function () { M.cloud.openPanel(); });
    window.addEventListener('hashchange', function () { setRoute(routeFromHash()); });
    setRoute(routeFromHash(), true);

    M.on('store:change', refreshStats);
    M.on('cloud:pulled', refreshStats);

    // 键盘快捷键：← → 切换首页壁纸，N 新建笔记（不在输入态时）
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (location.hash.indexOf('home') > -1 || !location.hash) {
        if (e.key === 'ArrowRight') M.wallpaper.next();
        if (e.key === 'ArrowLeft') M.wallpaper.prev();
      }
      if ((e.key === 'n' || e.key === 'N') && routeFromHash() === 'notes') M.$('#note-new').click();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.MOTO);
