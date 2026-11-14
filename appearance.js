/* MOTO // GARAGE — 外观设置
   本文件在 <head> 中提前加载，先于 CSS 渲染应用设置，避免首屏字号跳动。 */
(function (M) {
  'use strict';

  var KEY = 'moto.appearance.v1';
  var DEFAULTS = { scale: 1.15, leading: 1.7, accent: 'orange', motion: 'full' };
  var ACCENTS = {
    orange: { name:'赛车橙', hex:'#ff4a1c', hi:'#ff6a3d', rgb:'255,74,28', spec:'RACING ORANGE / #FF4A1C' },
    amber:  { name:'警戒黄', hex:'#ffb020', hi:'#ffc453', rgb:'255,176,32', spec:'WARNING AMBER / #FFB020' },
    cyan:   { name:'电光青', hex:'#22d3ee', hi:'#67e8f9', rgb:'34,211,238', spec:'ELECTRIC CYAN / #22D3EE' },
    lime:   { name:'荧光绿', hex:'#a3e635', hi:'#bef264', rgb:'163,230,53', spec:'ACID LIME / #A3E635' }
  };
  var SCALES = [1, 1.15, 1.3, 1.45];
  var SCALE_NAMES = ['紧凑', '标准', '舒适', '放大'];
  var LEADINGS = [1.55, 1.7, 1.9];
  var LEAD_NAMES = ['紧凑', '标准', '宽松'];

  function normalize(raw) {
    var o = (raw && typeof raw === 'object') ? raw : {};
    var scale = Number(o.scale);
    if (!isFinite(scale)) scale = DEFAULTS.scale;
    scale = Math.min(1.45, Math.max(1, scale));
    var leading = Number(o.leading);
    if (!isFinite(leading)) leading = DEFAULTS.leading;
    leading = Math.min(1.9, Math.max(1.55, leading));
    return {
      scale: Math.round(scale * 100) / 100,
      leading: leading,
      accent: ACCENTS[o.accent] ? o.accent : DEFAULTS.accent,
      motion: o.motion === 'reduced' ? 'reduced' : 'full'
    };
  }

  function read() {
    try { return normalize(JSON.parse(localStorage.getItem(KEY))); }
    catch (e) { return normalize(null); }
  }

  var cfg = read();

  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); }
    catch (e) { console.warn('[MOTO] 外观设置无法写入本机存储', e); }
  }

  function syncSpec() {
    var a = ACCENTS[cfg.accent];
    var sw = document.querySelector('#spec-accent-swatch');
    var tx = document.querySelector('#spec-accent-text');
    if (sw) sw.style.background = a.hex;
    if (tx) tx.textContent = a.spec;
    var btn = document.querySelector('#appearance-btn');
    if (btn) btn.title = '外观设置 · 文字 ' + Math.round(cfg.scale * 100) + '%';
  }

  function apply() {
    var r = document.documentElement, a = ACCENTS[cfg.accent];
    r.style.setProperty('--ui-scale', String(cfg.scale));
    r.style.setProperty('--read-leading', String(cfg.leading));
    r.style.setProperty('--accent', a.hex);
    r.style.setProperty('--accent-hi', a.hi);
    r.style.setProperty('--accent-rgb', a.rgb);
    r.style.setProperty('--accent-soft', 'rgba(' + a.rgb + ',.13)');
    r.style.setProperty('--accent-line', 'rgba(' + a.rgb + ',.45)');
    r.setAttribute('data-motion', cfg.motion);
    r.setAttribute('data-accent', cfg.accent);
    syncSpec();
  }

  function get() { return Object.assign({}, cfg); }
  function set(next) { cfg = normalize(next); write(); apply(); return get(); }

  /* ---------------- 设置面板 ---------------- */
  function seg(group, list, labels, current, isPercent) {
    return '<div class="ap-seg" data-group="' + group + '">' + list.map(function (v, i) {
      var on = Math.abs(v - current) < 0.001;
      var small = isPercent ? Math.round(v * 100) + '%' : String(v);
      return '<button type="button" data-val="' + v + '" class="' + (on ? 'is-active' : '') + '">' +
        '<span>' + labels[i] + '</span><small>' + small + '</small></button>';
    }).join('') + '</div>';
  }

  function swatches(current) {
    return '<div class="ap-swatches" data-group="accent">' + Object.keys(ACCENTS).map(function (k) {
      var a = ACCENTS[k];
      return '<button type="button" class="ap-swatch ' + (k === current ? 'is-active' : '') +
        '" data-val="' + k + '"><i style="background:' + a.hex + '"></i><span>' + a.name + '</span></button>';
    }).join('') + '</div>';
  }

  function bodyHtml() {
    var reduced = cfg.motion === 'reduced';
    return '' +
      '<div class="ap-preview">' +
        '<span class="eyebrow">// LIVE PREVIEW · 实时预览</span>' +
        '<h3>两轮之上，自有方向</h3>' +
        '<p>字号、行距与强调色会即时作用于全站所有页面，改动即时保存。</p>' +
        '<div class="ap-preview-row"><button class="btn btn--primary btn--sm" type="button" tabindex="-1">示例按钮</button>' +
        '<span class="cat-pill is-active">机车相关</span><span class="mini-tag">MOTO</span></div>' +
      '</div>' +

      '<div class="ap-group">' +
        '<div class="ap-group-head"><strong>文字大小 / TYPE SCALE</strong><span class="ap-value">' + Math.round(cfg.scale * 100) + '%</span></div>' +
        seg('scale', SCALES, SCALE_NAMES, cfg.scale, true) +
        '<p class="ap-hint">默认已比初版放大 15%，侧栏宽度同步调整；仍觉得小可选「舒适」或「放大」。</p>' +
      '</div>' +

      '<div class="ap-group">' +
        '<div class="ap-group-head"><strong>阅读行距 / LINE HEIGHT</strong><span class="ap-value">' + cfg.leading + '</span></div>' +
        seg('leading', LEADINGS, LEAD_NAMES, cfg.leading, false) +
        '<p class="ap-hint">影响正文与提示文字，长文阅读可选「宽松」。</p>' +
      '</div>' +

      '<div class="ap-group">' +
        '<div class="ap-group-head"><strong>强调色 / ACCENT</strong><span class="ap-value">' + ACCENTS[cfg.accent].name + '</span></div>' +
        swatches(cfg.accent) +
        '<p class="ap-hint">按钮、指示条、选中态、仪表指针与光晕均由主色派生。</p>' +
      '</div>' +

      '<div class="ap-group">' +
        '<div class="ap-group-head"><strong>动效 / MOTION</strong></div>' +
        '<button type="button" class="ap-toggle ' + (reduced ? 'is-on' : '') + '" data-toggle="motion" aria-pressed="' + reduced + '">' +
          '<span class="ap-toggle-track"><span></span></span>' +
          '<span class="ap-toggle-text"><strong>减少动效</strong><em>关闭卡片悬停位移、壁纸推镜与页面过渡，切换更安静</em></span>' +
        '</button>' +
      '</div>' +

      '<p class="ap-footer-note">' + M.icon('check') +
        '<span>设置保存在本机浏览器，重新打开仍然有效；登录后也会随云同步带到其他设备。</span></p>';
  }

  function refresh(api) {
    var body = api.$('.modal-body');
    if (!body) return;
    var top = body.scrollTop;
    body.innerHTML = bodyHtml();
    body.scrollTop = top;
  }

  function openPanel() {
    if (typeof M.modal !== 'function') return;
    return M.modal({
      title: '外观设置 / APPEARANCE',
      wide: true,
      body: bodyHtml(),
      footer: '<button class="btn btn--outline btn--sm" type="button" data-reset>恢复默认</button>' +
              '<button class="btn btn--primary btn--sm" type="button" data-done>完成</button>',
      onMount: function (api) {
        api.el.addEventListener('click', function (e) {
          var t = e.target.closest ? e.target.closest('[data-val]') : null;
          if (t && t.parentNode) {
            var group = t.parentNode.getAttribute('data-group');
            var val = t.getAttribute('data-val');
            if (group === 'scale') cfg.scale = Number(val);
            else if (group === 'leading') cfg.leading = Number(val);
            else if (group === 'accent') cfg.accent = val;
            cfg = normalize(cfg); write(); apply(); refresh(api);
            return;
          }
          if (e.target.closest && e.target.closest('[data-toggle]')) {
            cfg.motion = cfg.motion === 'reduced' ? 'full' : 'reduced';
            write(); apply(); refresh(api);
            return;
          }
          if (e.target.closest && e.target.closest('[data-reset]')) {
            cfg = normalize(null); write(); apply(); refresh(api);
            M.toast('外观已恢复默认', 'ok');
            return;
          }
          if (e.target.closest && e.target.closest('[data-done]')) api.close();
        });
      }
    });
  }

  function init() {
    syncSpec();
    var b = document.querySelector('#appearance-btn');
    if (b) b.addEventListener('click', openPanel);
    var s = document.querySelector('#spec-appearance-btn');
    if (s) s.addEventListener('click', openPanel);
    window.addEventListener('storage', function (e) {
      if (e.key === KEY) { cfg = read(); apply(); }
    });
  }

  M.appearance = {
    get: get, set: set, apply: apply, openPanel: openPanel,
    defaults: DEFAULTS, accents: ACCENTS
  };

  apply(); // 首屏立即生效
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.MOTO);
