/* MOTO // GARAGE — bootstrap, router & dashboard */
(function (M) {
  'use strict';

  function routeFromHash() {
    var h = (location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
    return M.ROUTES.some(function (r) { return r.key === h; }) ? h : 'home';
  }
  function setRoute(key, initial) {
    var meta = M.ROUTES.filter(function (r) { return r.key === key; })[0];
    M.$$('.view').forEach(function (v) { v.classList.toggle('is-active', v.getAttribute('data-view') === key); });
    M.$$('[data-route]').forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('data-route') === key); });
    M.$('#crumb-idx').textContent = meta.idx;
    M.$('#crumb-name').textContent = meta.name;
    document.title = meta.name.split(' / ')[0] + ' — MOTO // GARAGE';
    if (!initial) window.scrollTo({ top:0, behavior:'smooth' });
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
    var sum = M.dashboard ? M.dashboard.aggregate() : null;
    var entry = M.$('#home-db-summary');
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

    M.wallpaper.init();
    M.notes.init();
    M.fuel.init();
    M.links.init();
    M.media.init();
    M.weather.init();
    M.routes.init();
    M.dashboard.init();
    M.pwa.init();
    M.cloud.init();

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
