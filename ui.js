/* MOTO // GARAGE — shared UI utilities */
(function (M) {
  'use strict';

  M.$ = function (sel, root) { return (root || document).querySelector(sel); };
  M.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  M.icon = function (name, cls) { return '<svg class="icon ' + (cls || '') + '"><use href="#i-' + name + '"/></svg>'; };
  M.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  };
  M.uid = function () {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };
  M.debounce = function (fn, ms) {
    var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); };
  };
  M.pad2 = function (n) { return n < 10 ? '0' + n : '' + n; };
  M.clockText = function (d) {
    d = d || new Date();
    return M.pad2(d.getHours()) + ':' + M.pad2(d.getMinutes()) + ':' + M.pad2(d.getSeconds());
  };
  M.fmtDate = function (ts) {
    var d = new Date(ts), now = new Date();
    if (isNaN(d.getTime())) return '—';
    var same = d.toDateString() === now.toDateString();
    return same ? ('今天 ' + M.pad2(d.getHours()) + ':' + M.pad2(d.getMinutes()))
      : (d.getFullYear() + '/' + M.pad2(d.getMonth() + 1) + '/' + M.pad2(d.getDate()));
  };
  M.fmtSize = function (b) {
    if (!b && b !== 0) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  };
  M.normalizeUrl = function (raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
    try { var u = new URL(s); if (!/^https?:$/.test(u.protocol)) return ''; return u.href; }
    catch (e) { return ''; }
  };
  M.hostOf = function (url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; } };
  M.fetchTimeout = function (url, ms, opts) {
    ms = ms || 10000;
    if (typeof AbortController === 'undefined') return fetch(url, opts || {});
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, ms);
    var o = Object.assign({}, opts || {}, { signal: ctl.signal });
    return fetch(url, o).finally(function () { clearTimeout(timer); });
  };

  /* ---- tiny event bus ---- */
  var listeners = {};
  M.on = function (evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); };
  M.emit = function (evt, payload) {
    (listeners[evt] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { console.warn('[MOTO] listener error', evt, e); }
    });
  };

  /* ---- toast ---- */
  M.toast = function (msg, type, ms) {
    var stack = M.$('#toast-stack');
    if (!stack) return;
    var icons = { ok:'check', warn:'warn', err:'warn', info:'check' };
    var el = document.createElement('div');
    el.className = 'toast toast--' + (type || 'info');
    el.innerHTML = M.icon(icons[type] || 'check') + '<span>' + M.esc(msg) + '</span>';
    stack.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 260);
    }, ms || 3200);
  };

  /* ---- modal ---- */
  M.modal = function (opts) {
    var root = M.$('#modal-root');
    var title = opts.title || '';
    var body = opts.body || '';
    var foot = opts.footer || '';
    root.innerHTML = '<div class="modal ' + (opts.wide ? 'modal--wide' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><h3>' + M.esc(title) + '</h3><button class="icon-btn" data-close aria-label="关闭">' + M.icon('close') + '</button></div>' +
      '<div class="modal-body">' + body + '</div>' +
      (foot ? '<div class="modal-foot">' + foot + '</div>' : '') + '</div>';
    root.classList.add('is-open');
    var api = {
      root: root,
      el: M.$('.modal', root),
      close: function () { root.classList.remove('is-open'); root.innerHTML = ''; document.removeEventListener('keydown', onKey); },
      $: function (s) { return M.$(s, api.el); }
    };
    function onKey(e) { if (e.key === 'Escape') api.close(); }
    document.addEventListener('keydown', onKey);
    M.$$('[data-close]', root).forEach(function (b) { b.addEventListener('click', api.close); });
    root.addEventListener('click', function (e) { if (e.target === root) api.close(); });
    if (opts.onMount) opts.onMount(api);
    return api;
  };

  M.confirm = function (title, message, onYes, yesLabel) {
    var m = M.modal({
      title: title,
      body: '<p style="margin:0;color:var(--text-2);font-size:calc(13px * var(--ui-scale));line-height:1.9">' + M.esc(message) + '</p>',
      footer: '<button class="btn btn--outline" data-no>取消</button><button class="btn btn--primary btn--danger" data-yes>' + M.esc(yesLabel || '确认删除') + '</button>',
      onMount: function (api) {
        M.$('[data-no]', api.el).addEventListener('click', api.close);
        M.$('[data-yes]', api.el).addEventListener('click', function () { api.close(); onYes(); });
      }
    });
    return m;
  };

})(window.MOTO);
