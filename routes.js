/* MOTO // GARAGE — 地图路线
   支持跳转高德地图查看路线；常用路线保存在本地并随云同步；
   起点/终点若填写「经度,纬度」则走精确导航，否则按文本检索。 */
(function (M) {
  'use strict';

  var C = M.CONFIG;

  function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }
  function parseCoord(s) {
    var m = String(s || '').split(',');
    if (m.length === 2) {
      var a = Number(m[0].trim()), b = Number(m[1].trim());
      if (isFinite(a) && isFinite(b) && Math.abs(a) <= 180 && Math.abs(b) <= 90) return { lng:a, lat:b };
    }
    return null;
  }

  function buildUrl(r) {
    var f = parseCoord(r.from), t = parseCoord(r.to);
    if (f && t) {
      return C.amapUri + '?from=' + f.lng + ',' + f.lat + ',起点&to=' + t.lng + ',' + t.lat +
        ',终点&mode=car&policy=1&src=' + C.amapSrc + '&coordinate=gaode&callnative=1';
    }
    return C.amapWeb + '?from[name]=' + enc(r.from) + '&from[city]=' + enc(r.city || '') +
      '&to[name]=' + enc(r.to) + '&to[city]=' + enc(r.city || '') +
      '&type=car&policy=1&src=' + C.amapSrc;
  }

  function list() { return M.store.data.routes || []; }
  function saveAll(arr) { M.store.data.routes = arr; M.store.save(['routes']); }

  function open(r) {
    if (!r || !r.from || !r.to) { M.toast('请先填写起点和终点', 'warn'); return; }
    var u = buildUrl(r);
    M.toast('正在打开高德地图…', 'info', 1400);
    window.open(u, '_blank', 'noopener');
  }

  function remove(id) {
    M.confirm('删除常用路线', '确定删除这条已保存的路线吗？', function () {
      saveAll(list().filter(function (x) { return x.id !== id; }));
      renderList();
      M.toast('已删除', 'ok');
    });
  }

  function use(id) {
    var r = list().filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    setForm(r);
    if (F.name) F.name.focus();
  }

  /* ---------------- 表单 ---------------- */
  var F = {};
  function setForm(r) {
    if (F.name) F.name.value = r.name || '';
    if (F.from) F.from.value = r.from || '';
    if (F.to) F.to.value = r.to || '';
    if (F.city) F.city.value = r.city || '';
    if (F.note) F.note.value = r.note || '';
  }
  function readForm() {
    return {
      name: (F.name && F.name.value || '').trim(),
      from: (F.from && F.from.value || '').trim(),
      to: (F.to && F.to.value || '').trim(),
      city: (F.city && F.city.value || '').trim(),
      note: (F.note && F.note.value || '').trim()
    };
  }

  function renderForm() {
    F.name = M.$('#rt-name'); F.from = M.$('#rt-from'); F.to = M.$('#rt-to');
    F.city = M.$('#rt-city'); F.note = M.$('#rt-note');
    var openBtn = M.$('#rt-open'), saveBtn = M.$('#rt-save');
    if (openBtn) openBtn.addEventListener('click', function () {
      var v = readForm();
      if (!v.from || !v.to) { M.toast('请填写起点和终点后再打开地图', 'warn'); return; }
      open(v);
    });
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var v = readForm();
      if (!v.name) { M.toast('给路线起个名字吧', 'warn'); if (F.name) F.name.focus(); return; }
      if (!v.from || !v.to) { M.toast('请填写起点和终点', 'warn'); return; }
      var r = { id: M.uid(), name: v.name, from: v.from, to: v.to, city: v.city, note: v.note, createdAt: Date.now() };
      var all = list().slice(); all.unshift(r); saveAll(all); renderList();
      M.toast('已保存为常用路线', 'ok');
    });
  }

  /* ---------------- 列表 ---------------- */
  function renderList() {
    var box = M.$('#route-list'); if (!box) return;
    var arr = list();
    var cnt = M.$('#route-count'); if (cnt) cnt.textContent = arr.length + ' 条';
    if (!arr.length) {
      box.innerHTML = '<div class="empty-state" style="padding:40px 16px">' + M.icon('route') +
        '<h3>还没有常用路线</h3><p>填好上方表单，点「保存为常用」即可随时选用。</p></div>';
      return;
    }
    box.innerHTML = arr.map(function (r) {
      var fc = parseCoord(r.from), tc = parseCoord(r.to);
      var hint = (fc && tc) ? '坐标 · 精确导航' : '文本 · 高德检索';
      return '<div class="route-card" data-id="' + r.id + '">' +
        '<div class="route-top"><strong>' + M.esc(r.name) + '</strong>' +
          '<span class="route-hint">' + M.esc(hint) + '</span></div>' +
        '<div class="route-path"><span>' + M.esc(r.from) + '</span>' + M.icon('arrow') +
          '<span>' + M.esc(r.to) + '</span></div>' +
        (r.city ? '<div class="route-city">城市：' + M.esc(r.city) + '</div>' : '') +
        (r.note ? '<div class="route-note">' + M.esc(r.note) + '</div>' : '') +
        '<div class="route-acts">' +
          '<button type="button" class="btn btn--sm btn--outline" data-act="use">选用</button>' +
          '<button type="button" class="btn btn--sm btn--primary" data-act="open">' + M.icon('external') + '<span>地图</span></button>' +
          '<button type="button" class="btn btn--sm btn--outline btn--danger" data-act="del">删除</button>' +
        '</div></div>';
    }).join('');
    M.$$('.route-card', box).forEach(function (card) {
      var id = card.getAttribute('data-id');
      card.addEventListener('click', function (e) {
        var act = e.target.closest('[data-act]');
        if (!act) return;
        var a = act.getAttribute('data-act');
        if (a === 'use') use(id);
        else if (a === 'open') { var r = list().filter(function (x) { return x.id === id; })[0]; open(r); }
        else if (a === 'del') remove(id);
      });
    });
  }

  function init() { renderForm(); renderList(); }

  M.routes = { init: init, open: open, buildUrl: buildUrl, list: list };
})(window.MOTO);
