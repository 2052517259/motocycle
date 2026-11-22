/* MOTO // GARAGE — 出行准备 / 地图路线
   页内合规地图（高德 JS API）+ 起终点联想/点选/定位 + 驾车路线规划与结果展示。
   未配置 Key 或 SDK 加载失败时，页面内给出明确提示与重试，并保留原有外部跳转能力。
   常用路线仍保存在本地并随云同步。 */
(function (M) {
  'use strict';

  var C = M.CONFIG;
  var F = {};
  var sdkPromise = null, sdkState = 'idle';       // idle / loading / ready / error
  var map = null, currentDriving = null, geocoder = null, geoloc = null;
  var markers = {}, autos = {};
  var points = { from:null, to:null };
  var pickMode = null, planSeq = 0, initDone = false;

  function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }
  function parseCoord(s) {
    var m = String(s || '').split(',');
    if (m.length === 2) {
      var a = Number(m[0].trim()), b = Number(m[1].trim());
      if (isFinite(a) && isFinite(b) && Math.abs(a) <= 180 && Math.abs(b) <= 90) return { lng:a, lat:b };
    }
    return null;
  }
  function keyConfigured() {
    var k = C.amapJsKey || '';
    return !(/占位符|申请|please apply|your own key/i.test(k));
  }
  /* 安全密钥必须在 JS API 脚本加载之前写入全局配置；旧 Key 无需此项 */
  function applySecurityCode() {
    var sc = C.amapJsSecurityCode || '';
    if (sc && !/占位符|申请|your|please/i.test(sc)) {
      window._AMapSecurityConfig = { securityJsCode: sc };
    }
  }
  function sdkUrl() {
    return (C.amapJsUrl || 'https://webapi.amap.com/maps') +
      '?v=' + (C.amapJsVersion || '1.4.15') +
      '&key=' + enc(C.amapJsKey) +
      '&plugin=' + enc((C.amapJsPlugins || []).join(','));
  }

  /* ---------------- 原有：外部跳转与本地路线 ---------------- */
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
    window.open(buildUrl(r), '_blank', 'noopener');
    M.toast('已在新窗口打开高德地图', 'info', 1800);
  }
  function remove(id) {
    M.confirm('删除常用路线', '确定删除这条已保存的路线吗？', function () {
      saveAll(list().filter(function (x) { return x.id !== id; }));
      renderList(); M.toast('已删除', 'ok');
    });
  }
  function use(id) {
    var r = list().filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    setForm(r);
    points.from = null; points.to = null;
    if (F.name) F.name.focus();
  }

  /* ---------------- 表单 ---------------- */
  function setForm(r) {
    if (F.name) F.name.value = r.name || '';
    if (F.from) F.from.value = r.from || '';
    if (F.to) F.to.value = r.to || '';
    if (F.city) F.city.value = r.city || '';
    if (F.note) F.note.value = r.note || '';
    markResolved();
  }
  function readForm() {
    return {
      name:(F.name && F.name.value || '').trim(),
      from:(F.from && F.from.value || '').trim(),
      to:(F.to && F.to.value || '').trim(),
      city:(F.city && F.city.value || '').trim(),
      note:(F.note && F.note.value || '').trim()
    };
  }
  function markResolved() {
    [['from', F.from], ['to', F.to]].forEach(function (pair) {
      if (pair[1]) pair[1].classList.toggle('is-resolved', !!points[pair[0]]);
    });
  }
  function setPoint(which, point, opts) {
    opts = opts || {};
    if (!point || !isFinite(point.lng) || !isFinite(point.lat)) return;
    points[which] = { lng:point.lng, lat:point.lat, name:point.name || '' };
    var input = F[which];
    if (input && !opts.silent) {
      input.value = point.name || (point.lng.toFixed(5) + ',' + point.lat.toFixed(5));
    }
    markResolved();
    drawMarkers();
    if (!opts.noFit && points.from && points.to && map && !currentDriving) fitPoints();
  }
  function fitPoints() {
    if (!map || !points.from || !points.to) return;
    var overlays = [markers.from, markers.to].filter(Boolean);
    if (!overlays.length) return;
    try { map.setFitView(overlays, false, [60, 60, 60, 60]); } catch (e) {}
  }
  function drawMarkers() {
    if (!map || !window.AMap || !window.AMap.Marker) return;
    Object.keys(markers).forEach(function (k) { try { map.remove(markers[k]); } catch (e) {} });
    markers = {};
    ['from', 'to'].forEach(function (k) {
      var p = points[k];
      if (!p) return;
      markers[k] = new AMap.Marker({
        map:map, position:new AMap.LngLat(p.lng, p.lat),
        title:(k === 'from' ? '起点' : '终点') + (p.name ? ' · ' + p.name : ''),
        zIndex:120, raiseOnDrag:false
      });
    });
  }

  /* ---------------- SDK 加载与地图状态 ---------------- */
  function stateBox() { return M.$('#rt-map-state'); }
  function setState(kind, title, text, retry) {
    var box = stateBox(); if (!box) return;
    box.hidden = !kind;
    box.classList.toggle('is-error', kind === 'error');
    if (!kind) return;
    var t = M.$('#rt-map-state-title'), d = M.$('#rt-map-state-text'), b = M.$('#rt-map-retry');
    if (t) t.textContent = title || '';
    if (d) d.textContent = text || '';
    if (b) b.hidden = !retry;
  }
  function loadSdk() {
    if (window.AMap && window.AMap.Map) { sdkState = 'ready'; setState(null); return Promise.resolve(); }
    if (sdkPromise) return sdkPromise;
    if (!keyConfigured()) {
      sdkState = 'error';
      setState('error', '需要配置高德地图 Key',
        '页内地图使用高德 JS API。请到高德开放平台（console.amap.com）申请「Web端(JS API)」Key，为其配置 Referer 域名白名单（localhost、127.0.0.1、2052517259.github.io、wbapp-4ahooqceit2m0ldsodoed0.app.workbuddy.host），然后把 js/config.js 中的 amapJsKey 替换为真实 Key；2021-12-02 后申请的 Key 还需填入 amapJsSecurityCode。现有「在高德中打开」与常用路线功能不受影响。');
      return Promise.reject({ type:'key' });
    }
    sdkState = 'loading';
    setState('loading', '地图加载中', '正在加载地图组件，请稍候…');
    applySecurityCode();
    sdkPromise = new Promise(function (resolve, reject) {
      var tag = null;
      function cleanup() { if (tag && tag.parentNode) tag.parentNode.removeChild(tag); tag = null; }
      var timer = setTimeout(function () {
        cleanup(); reject({ type:'timeout' });
      }, 15000);
      tag = document.createElement('script');
      tag.id = 'amap-js-sdk'; tag.async = true; tag.src = sdkUrl();
      tag.onload = function () {
        clearTimeout(timer);
        if (window.AMap && window.AMap.Map) resolve();
        else { cleanup(); reject({ type:'invalid' }); }
      };
      tag.onerror = function () { clearTimeout(timer); cleanup(); reject({ type:'network' }); };
      document.head.appendChild(tag);
    }).then(function () {
      sdkState = 'ready'; setState(null); return true;
    }).catch(function (e) {
      sdkState = 'error'; sdkPromise = null;
      var msg = e && e.type === 'timeout' ? '地图组件加载超时，请检查网络后重试。'
        : e && e.type === 'network' ? '地图脚本下载失败，请检查网络、域名白名单与安全密钥配置后重试。'
        : '地图组件初始化异常，请确认 Key、域名白名单与安全密钥均配置正确后重试。';
      setState('error', '地图加载失败', msg, true);
      throw e;
    });
    return sdkPromise;
  }
  function ensureMap() {
    return loadSdk().then(function () {
      if (!map) {
        map = new AMap.Map('rt-map', {
          zoom:12, center:new AMap.LngLat(120.1551, 30.2741), resizeEnable:true
        });
        map.on('click', onMapClick);
        if (window.ResizeObserver) {
          new ResizeObserver(function () { try { map.resize(); } catch (e) {} }).observe(M.$('#rt-map'));
        } else {
          window.addEventListener('resize', function () { try { map.resize(); } catch (e) {} });
        }
      }
      if (!geocoder && AMap.Geocoder) geocoder = new AMap.Geocoder({ city:F.city ? F.city.value : '', extensions:'base' });
      attachAutocomplete();
      setTimeout(function () { try { map.resize(); } catch (e) {} }, 80);
      return map;
    });
  }
  function attachAutocomplete() {
    if (!window.AMap || !AMap.Autocomplete) return;
    ['from', 'to'].forEach(function (k) {
      if (autos[k] || !F[k]) return;
      var ac = new AMap.Autocomplete({ input:F[k], city:(F.city && F.city.value) || '全国' });
      ac.on('select', function (e) {
        var p = e.poi || {}, loc = p.location;
        if (loc && isFinite(loc.lng) && isFinite(loc.lat)) {
          setPoint(k, { lng:loc.lng, lat:loc.lat, name:p.name || String(loc) });
        }
      });
      autos[k] = ac;
    });
  }

  /* ---------------- 地址解析 / 定位 / 点选 ---------------- */
  function resolvePoint(k, text, city, cb) {
    var coord = parseCoord(text);
    if (coord) { cb(null, { lng:coord.lng, lat:coord.lat, name:text }); return; }
    if (!geocoder) { cb({ message:'地理编码组件不可用' }, null); return; }
    try {
      if (city && geocoder.setCity) geocoder.setCity(city);
      geocoder.getLocation(text, function (status, result) {
        if (status === 'complete' && result && result.geocodes && result.geocodes.length) {
          var g = result.geocodes[0], loc = g.location;
          cb(null, { lng:loc.lng, lat:loc.lat, name:g.formattedAddress || text });
        } else {
          cb({ message:(result && result.info) || '未找到该地址' }, null);
        }
      });
    } catch (e) { cb(e, null); }
  }
  function resolveName(lnglat, cb) {
    if (!geocoder) { cb(''); return; }
    try {
      geocoder.getAddress(lnglat, function (status, result) {
        var name = '';
        if (status === 'complete' && result && result.regeocode) name = result.regeocode.formattedAddress || '';
        cb(name);
      });
    } catch (e) { cb(''); }
  }
  function onMapClick(e) {
    if (!pickMode || !e || !e.lnglat) return;
    var k = pickMode, ll = e.lnglat;
    setPickMode(null);
    resolveName(ll, function (name) {
      setPoint(k, { lng:ll.lng, lat:ll.lat, name:name || (ll.lng.toFixed(5) + ',' + ll.lat.toFixed(5)) });
      M.toast((k === 'from' ? '起点' : '终点') + '已设置', 'ok', 1600);
    });
  }
  function setPickMode(k) {
    pickMode = (pickMode === k) ? null : k;
    [['from', '#rt-pick-from'], ['to', '#rt-pick-to']].forEach(function (pair) {
      var b = M.$(pair[1]);
      if (b) b.setAttribute('aria-pressed', pickMode === pair[0] ? 'true' : 'false');
    });
    if (map && map.setDefaultCursor) map.setDefaultCursor(pickMode ? 'crosshair' : '');
    var hint = M.$('#rt-map-hint');
    if (hint) hint.textContent = pickMode
      ? '点选模式已开启：请在地图上点击选择' + (pickMode === 'from' ? '起点' : '终点') + '，再次点击按钮可取消。'
      : '选择「点选起点 / 点选终点」后点击地图可直接落点；输入地名时会弹出地点联想。定位需要 HTTPS 或 localhost 环境。';
  }
  function locate() {
    setState('loading', '正在定位', '正在获取当前位置，请稍候…');
    ensureMap().then(function () {
      if (!AMap.Geolocation) throw { type:'no-plugin' };
      if (!geoloc) geoloc = new AMap.Geolocation({
        enableHighAccuracy:true, timeout:10000, showButton:false, showMarker:false,
        panToLocation:true, zoomToAccuracy:false, convert:true
      });
      geoloc.getCurrentPosition(function (status, result) {
        setState(null);
        if (status !== 'complete' || !result || !result.position) {
          var reason = (result && result.info) || '定位失败';
          M.toast('定位失败：' + reason + '，可在下方手动点选起点', 'warn', 3200);
          return;
        }
        var p = result.position;
        setPoint('from', { lng:p.lng, lat:p.lat, name:result.formattedAddress || '当前位置' });
        try { map.setCenter(p); } catch (e) {}
        M.toast('已将当前位置设为起点', 'ok', 2000);
      });
    }).catch(function () {
      setState('error', '定位不可用', '定位组件或地图尚未就绪。请检查 Key 与网络，或使用「点选起点」在地图上手动选择。', true);
    });
  }

  /* ---------------- 路线规划与结果 ---------------- */
  function plan() {
    var v = readForm();
    if (!v.from || !v.to) { M.toast('请先填写起点和终点', 'warn'); return Promise.resolve(false); }
    var seq = ++planSeq;
    var btn = M.$('#rt-plan'); if (btn) btn.disabled = true;
    setState('loading', '正在规划路线', '正在解析起终点并计算驾车路线…');

    return ensureMap().then(function () {
      return Promise.all([
        new Promise(function (resolve, reject) {
          resolvePoint('from', v.from, v.city, function (err, p) { err ? reject(err) : resolve(p); });
        }),
        new Promise(function (resolve, reject) {
          resolvePoint('to', v.to, v.city, function (err, p) { err ? reject(err) : resolve(p); });
        })
      ]);
    }).then(function (ps) {
      if (seq !== planSeq) return false;
      setPoint('from', ps[0], { silent:true, noFit:true });
      setPoint('to', ps[1], { silent:true, noFit:true });
      return searchRoute(ps[0], ps[1], seq);
    }).catch(function (e) {
      if (seq !== planSeq) return false;
      setState(null);
      M.toast('地址解析失败：' + ((e && e.message) || '请检查地名或填写经纬度'), 'warn', 3200);
      return false;
    }).then(function (ok) {
      if (seq === planSeq && btn) btn.disabled = false;
      return !!ok;
    });
  }
  function searchRoute(from, to, seq) {
    if (!window.AMap || !AMap.Driving) {
      setState('error', '路线规划不可用', '路线规划组件未加载，请重新加载地图。', true);
      return Promise.resolve(false);
    }
    return new Promise(function (resolve) {
      var driving = new AMap.Driving({
        map:map, autoFitView:true, showTraffic:true,
        policy:AMap.DrivingPolicy.LEAST_TIME
      });
      driving.search(new AMap.LngLat(from.lng, from.lat), new AMap.LngLat(to.lng, to.lat), function (status, result) {
        if (seq !== planSeq) { resolve(false); return; }
        setState(null);
        if (status === 'complete' && result && result.routes && result.routes.length) {
          if (currentDriving && currentDriving !== driving) { try { currentDriving.clear(); } catch (e) {} }
          currentDriving = driving;
          renderResult(result.routes[0]);
          resolve(true);
        } else {
          var info = (result && result.info) || '';
          M.toast(status === 'no_data' ? '未找到可用驾车路线，请调整起终点' : '路线规划失败：' + info, 'warn', 3200);
          var hint = M.$('#rt-map-hint');
          if (hint) hint.textContent = '本次规划未成功（' + (info || status) + '）。原有地图画面已保留，可修改起终点后重试。';
          resolve(false);
        }
      });
    });
  }
  function renderResult(route) {
    var box = M.$('#rt-result'); if (!box) return;
    var dist = Number(route.distance) || 0;
    var secs = Number(route.time) || 0;
    var tolls = Number(route.tolls) || 0;
    var mins = Math.round(secs / 60);
    var timeText = mins >= 60 ? Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分' : mins + ' 分钟';
    var items = [
      { label:'路线距离', val:(dist / 1000).toFixed(1), unit:'km' },
      { label:'预计用时', val:timeText, unit:'' },
      { label:'过路费', val:'¥' + tolls.toFixed(0), unit:'' },
      { label:'规划策略', val:'最快捷', unit:'' }
    ];
    var mbox = M.$('#rt-metrics');
    if (mbox) mbox.innerHTML = items.map(function (it) {
      return '<div class="route-metric"><span>' + M.esc(it.label) + '</span><strong>' + M.esc(it.val) +
        (it.unit ? '<small>' + M.esc(it.unit) + '</small>' : '') + '</strong></div>';
    }).join('');
    var steps = (route.steps || []).slice(0, 5);
    var sbox = M.$('#rt-steps');
    if (sbox) sbox.innerHTML = steps.length ? steps.map(function (s, i) {
      var txt = String(s.instruction || s.road || '继续行驶');
      if (txt.length > 64) txt = txt.slice(0, 64) + '…';
      return '<div class="route-step"><i>' + (i + 1) + '</i><span>' + M.esc(txt) + '</span></div>';
    }).join('') : '<div class="route-step"><i>—</i><span>暂无分步导航信息</span></div>';
    box.hidden = false;
  }
  function clearAll() {
    planSeq++;
    points = { from:null, to:null };
    setPickMode(null);
    if (currentDriving) { try { currentDriving.clear(); } catch (e) {} currentDriving = null; }
    drawMarkers();
    [F.from, F.to].forEach(function (n) { if (n) n.value = ''; });
    markResolved();
    var box = M.$('#rt-result'); if (box) box.hidden = true;
    var hint = M.$('#rt-map-hint');
    if (hint) hint.textContent = '选择「点选起点 / 点选终点」后点击地图可直接落点；输入地名时会弹出地点联想。定位需要 HTTPS 或 localhost 环境。';
    setState(null);
  }

  /* ---------------- 初始化 ---------------- */
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
      var r = { id:M.uid(), name:v.name, from:v.from, to:v.to, city:v.city, note:v.note, createdAt:Date.now() };
      var all = list().slice(); all.unshift(r); saveAll(all); renderList();
      M.toast('已保存为常用路线', 'ok');
    });
    [F.from, F.to].forEach(function (n) {
      if (n) n.addEventListener('input', function () {
        var key = n === F.from ? 'from' : 'to';
        points[key] = null; markResolved();
      });
    });
    var pkF = M.$('#rt-pick-from'), pkT = M.$('#rt-pick-to');
    if (pkF) pkF.addEventListener('click', function () { ensureMap().then(function () { setPickMode('from'); }).catch(function () {}); });
    if (pkT) pkT.addEventListener('click', function () { ensureMap().then(function () { setPickMode('to'); }).catch(function () {}); });
    var loc = M.$('#rt-locate'); if (loc) loc.addEventListener('click', locate);
    var pl = M.$('#rt-plan'); if (pl) pl.addEventListener('click', function () { plan(); });
    var clr = M.$('#rt-clear'); if (clr) clr.addEventListener('click', clearAll);
    var retry = M.$('#rt-map-retry'); if (retry) retry.addEventListener('click', function () {
      sdkPromise = null; ensureMap().catch(function () {});
    });
  }
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
      var hint = (fc && tc) ? '坐标 · 精确导航' : '文本 · 地图检索';
      return '<div class="route-card" data-id="' + r.id + '">' +
        '<div class="route-top"><strong>' + M.esc(r.name) + '</strong>' +
          '<span class="route-hint">' + M.esc(hint) + '</span></div>' +
        '<div class="route-path"><span>' + M.esc(r.from) + '</span>' + M.icon('arrow') +
          '<span>' + M.esc(r.to) + '</span></div>' +
        (r.city ? '<div class="route-city">城市：' + M.esc(r.city) + '</div>' : '') +
        (r.note ? '<div class="route-note">' + M.esc(r.note) + '</div>' : '') +
        '<div class="route-acts">' +
          '<button type="button" class="btn btn--sm btn--outline" data-act="use">选用</button>' +
          '<button type="button" class="btn btn--sm btn--primary" data-act="plan">' + M.icon('route') + '<span>页内规划</span></button>' +
          '<button type="button" class="btn btn--sm btn--outline" data-act="open">' + M.icon('external') + '<span>高德</span></button>' +
          '<button type="button" class="btn btn--sm btn--outline btn--danger" data-act="del">删除</button>' +
        '</div></div>';
    }).join('');
    M.$$('.route-card', box).forEach(function (card) {
      var id = card.getAttribute('data-id');
      card.addEventListener('click', function (e) {
        var act = e.target.closest ? e.target.closest('[data-act]') : null;
        if (!act) return;
        var a = act.getAttribute('data-act');
        if (a === 'use') use(id);
        else if (a === 'plan') { use(id); plan(); }
        else if (a === 'open') { var r = list().filter(function (x) { return x.id === id; })[0]; open(r); }
        else if (a === 'del') remove(id);
      });
    });
  }
  function init() {
    if (initDone) return;
    initDone = true;
    renderForm(); renderList();
    // 进入「出行准备」即尝试加载页内地图；失败时页面内保留明确提示，不阻断其它功能。
    ensureMap().catch(function () {});
  }

  M.routes = {
    init:init, open:open, buildUrl:buildUrl, list:list,
    plan:plan, locate:locate, ensureMap:ensureMap, clear:clearAll, setPoint:setPoint,
    state:function () { return { sdk:sdkState, points:{ from:!!points.from, to:!!points.to }, map:!!map, keyConfigured:keyConfigured() }; }
  };
})(window.MOTO);
