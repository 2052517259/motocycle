/* MOTO // GARAGE — 出行准备 / 地图路线
   页内合规地图（高德 JS API）+ 起终点联想/点选/定位 + 五种交通方式多方案规划
   + 方案对比与一键导航。未配置 Key 或 SDK 加载失败时给出明确提示与重试，
   并保留原有外部跳转能力；常用路线仍保存在本地并随云同步。
   说明：高德 JS API 无摩托算路（其摩托规划属原生导航 SDK 付费能力），
   摩托模式基于驾车路网给出参考方案，并在界面明确标注限制。 */
(function (M) {
  'use strict';

  var C = M.CONFIG;
  var F = {};
  var sdkPromise = null, sdkState = 'idle';       // idle / loading / ready / error
  var map = null, currentLayer = null, geocoder = null, geoloc = null;
  var markers = {}, autos = {};
  var points = { from:null, to:null };
  var pickMode = null, planSeq = 0, initDone = false;

  /* 交通方式：key 为内部标识，uri 为高德 URI API 的 mode 值。
     高德 URI 仅支持 car / bus / walk / ride，摩托按 car 调起并在提示中说明。 */
  var MODES = [
    { key:'car',  name:'驾车', short:'驾车', uri:'car',  icon:'i-ride',  note:'驾车方案含过路费与实时路况，具体以导航 App 为准。' },
    { key:'bus',  name:'公交', short:'公交', uri:'bus',  icon:'i-route', note:'公交方案含票价、换乘与步行距离，票价以当地票制为准。' },
    { key:'walk', name:'步行', short:'步行', uri:'walk', icon:'i-route', note:'步行方案按人行路网规划，夜间请注意路段照明与通行条件。' },
    { key:'moto', name:'摩托', short:'摩托', uri:'car',  icon:'i-ride',  note:'摩托参考方案基于驾车路网估算：高德 JS API 不提供摩托专用算路，也未规避禁摩/限行；请自行确认当地法规，导航调起后可在高德 App 内切换摩托。' },
    { key:'ride', name:'骑行', short:'骑行', uri:'ride', icon:'i-ride',  note:'骑行方案按自行车路网规划；骑行调起客户端仅在高德 App 内有效。' }
  ];
  var mode = 'car';                 // 当前交通方式
  var schemes = [];                 // 归一化后的多条方案
  var selected = 0;                 // 当前选中方案下标
  var lastPlan = null;              // { from, to, mode }，用于切换方式后自动重算

  function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }
  function parseCoord(s) {
    var m = String(s || '').split(',');
    if (m.length === 2) {
      var a = Number(m[0].trim()), b = Number(m[1].trim());
      if (isFinite(a) && isFinite(b) && Math.abs(a) <= 180 && Math.abs(b) <= 90) return { lng:a, lat:b };
    }
    return null;
  }
  function getMode(k) {
    var key = k || mode;
    for (var i = 0; i < MODES.length; i++) if (MODES[i].key === key) return MODES[i];
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
  function buildNavUrl(from, to, modeKey) {
    var m = getMode(modeKey);
    var fn = (from && from.name) || '起点', tn = (to && to.name) || '终点';
    return (C.amapUri || 'https://uri.amap.com/navigation') +
      '?from=' + from.lng + ',' + from.lat + ',' + enc(fn) +
      '&to=' + to.lng + ',' + to.lat + ',' + enc(tn) +
      '&mode=' + m.uri + '&policy=0&src=' + enc(C.amapSrc || 'moto-garage') +
      '&coordinate=gaode&callnative=1';
  }
  function buildUrl(r) {
    var f = parseCoord(r.from), t = parseCoord(r.to);
    if (f && t) {
      var m = getMode();
      return C.amapUri + '?from=' + f.lng + ',' + f.lat + ',' + enc(r.from) +
        '&to=' + t.lng + ',' + t.lat + ',' + enc(r.to) +
        '&mode=' + m.uri + '&policy=0&src=' + C.amapSrc + '&coordinate=gaode&callnative=1';
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
  /* 一键导航：优先用页内规划得到的精确坐标与选中方案；无规划结果时回退到文本/已解析坐标 */
  function navigate() {
    var s = schemes[selected];
    var from = points.from, to = points.to;
    if (!from || !to) {
      var v = readForm();
      from = parseCoord(v.from) || null; to = parseCoord(v.to) || null;
      if (from && v.from && !from.name) from.name = v.from;
      if (to && v.to && !to.name) to.name = v.to;
    }
    if (!from || !to) { M.toast('请先填写起点和终点，或在地图上点选', 'warn'); return; }
    var m = getMode();
    window.open(buildNavUrl(from, to, m.key), '_blank', 'noopener');
    M.toast(m.key === 'moto' ? '已调起驾车导航，请在高德 App 内切换摩托模式' :
      '已发起「' + m.name + '」导航', 'ok', m.key === 'moto' ? 3200 : 2000);
    renderResultNote();
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
    lastPlan = null; clearSchemes();
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
    if (!opts.noFit && points.from && points.to && map && !currentLayer) fitPoints();
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
      : defaultHint();
  }
  function defaultHint() {
    return '选择「点选起点 / 点选终点」后点击地图可直接落点；输入地名时会弹出地点联想。切换交通方式后若已确定起终点会自动重新规划。';
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

  /* ---------------- 方案归一化 ---------------- */
  function arr(v) { return Array.isArray(v) ? v : []; }
  function llList(steps) {
    var out = [];
    var list = arr(steps);
    if (!list.length && steps && Array.isArray(steps.rides)) list = steps.rides;
    list.forEach(function (s) {
      arr(s.path).forEach(function (p) {
        if (p && isFinite(p.lng) && isFinite(p.lat)) out.push([p.lng, p.lat]);
      });
    });
    if (!out.length && steps && Array.isArray(steps.path)) {
      steps.path.forEach(function (p) {
        if (p && isFinite(p.lng) && isFinite(p.lat)) out.push([p.lng, p.lat]);
      });
    }
    return out;
  }
  function stepList(steps) {
    /* 骑行的路段字段叫 rides，其余为 steps；统一兼容 */
    var list = arr(steps);
    if (!list.length && steps && Array.isArray(steps.rides)) list = steps.rides;
    return list.map(function (s) {
      return {
        text:String(s.instruction || s.road || (s.transit && s.transit.lines && s.transit.lines[0] && s.transit.lines[0].name) || '继续前行'),
        distance:Number(s.distance) || 0, time:Number(s.time) || 0
      };
    });
  }
  function trafficList(steps) {
    var smooth = 0, slow = 0, jam = 0, seen = false;
    arr(steps).forEach(function (s) {
      arr(s.tmcs).forEach(function (t) {
        seen = true;
        var d = Number(t.distance) || 0;
        if (t.status === '拥堵') jam += d;
        else if (t.status === '缓行') slow += d;
        else smooth += d;
      });
    });
    if (!seen) return '';
    var parts = [];
    if (smooth) parts.push('畅通 ' + fmtKm(smooth));
    if (slow) parts.push('缓行 ' + fmtKm(slow));
    if (jam) parts.push('拥堵 ' + fmtKm(jam));
    return parts.length ? parts.join(' · ') : '路况未知';
  }
  function fmtKm(m) {
    var km = (Number(m) || 0) / 1000;
    return km < 1 ? Math.round(Number(m) || 0) + ' m' : km.toFixed(1) + ' km';
  }
  function fmtTime(sec) {
    var mins = Math.round((Number(sec) || 0) / 60);
    return mins >= 60 ? Math.floor(mins / 60) + ' 小时 ' + (mins % 60 ? (mins % 60) + ' 分' : '') : mins + ' 分钟';
  }
  function normDriving(r, tag, isMoto) {
    return {
      tag:tag, distance:Number(r.distance) || 0, time:Number(r.time) || 0,
      cost:Number(r.tolls) || 0, extra:Number(r.tolls_distance) ? '收费路段 ' + fmtKm(r.tolls_distance) : '无收费路段',
      traffic:trafficList(r.steps),
      steps:stepList(r.steps), path:llList(r.steps),
      restriction:Number(r.restriction) || 0, isMoto:!!isMoto, raw:r
    };
  }
  function normWalkRide(p, tag) {
    var segs = p.steps || p.rides || [];
    return {
      tag:tag, distance:Number(p.distance) || 0, time:Number(p.time) || 0,
      cost:0, extra:'免费', traffic:'', steps:stepList(segs), path:llList(segs), raw:p
    };
  }
  function normBus(p, tag) {
    var lines = [], walk = Number(p.walking_distance) || 0;
    arr(p.segments).forEach(function (seg) {
      var t = seg.transit || {};
      arr(t.lines).forEach(function (l) { if (l && l.name) lines.push(l.name); });
    });
    return {
      tag:tag, distance:Number(p.distance) || 0, time:Number(p.time) || 0,
      cost:Number(p.cost) || 0,
      extra:'步行 ' + fmtKm(walk) + ' · ' + arr(p.segments).length + ' 段',
      lines:lines, traffic:'', steps:stepList(p.segments),
      path:arr(p.path).map(function (x) { return [x.lng, x.lat]; }), raw:p
    };
  }
  function dedupe(list) {
    var seen = {}, out = [];
    list.forEach(function (s) {
      /* 仅去除几乎完全相同的路线（距离差 <50m 且用时差 <30s），保留不同策略的可比方案 */
      var key = Math.round(s.distance / 50) + '|' + Math.round(s.time / 30);
      if (seen[key]) return;
      seen[key] = true; out.push(s);
    });
    return out;
  }

  /* ---------------- 路线规划：按交通方式请求并归一化为多条方案 ---------------- */
  function serviceSearch(Ctor, opts, from, to) {
    return new Promise(function (resolve) {
      var svc;
      try { svc = new Ctor(opts); }
      catch (e) { resolve([]); return; }
      try {
        svc.search(new AMap.LngLat(from.lng, from.lat), new AMap.LngLat(to.lng, to.lat), function (status, result) {
          if (status !== 'complete' || !result) { resolve([]); return; }
          resolve(result);
        });
      } catch (e) { resolve([]); }
    });
  }
  function searchSchemes(from, to, seq) {
    var mk = mode, meta = getMode(mk);
    var tasks = [];

    if (mk === 'car' || mk === 'moto') {
      /* 驾车/摩托：串行请求三种策略（避开个人 Key 的并发限流），
         得到「最快捷 / 少收费 / 距离短」多条可比方案，再统一去重。 */
      var policies = [
        { p:(AMap.DrivingPolicy && AMap.DrivingPolicy.LEAST_TIME) || 0, tag:'最快捷' },
        { p:(AMap.DrivingPolicy && AMap.DrivingPolicy.LEAST_FEE) || 1, tag:'少收费' },
        { p:(AMap.DrivingPolicy && AMap.DrivingPolicy.LEAST_DISTANCE) || 2, tag:'距离短' }
      ];
      var list = [];
      var chain = Promise.resolve();
      policies.forEach(function (cfg) {
        chain = chain.then(function () {
          return serviceSearch(AMap.Driving, {
            policy:cfg.p, extensions:'all', showTraffic:true, hideMarkers:true
          }, from, to).then(function (result) {
            arr(result && (result.routes || result.paths)).slice(0, 1).forEach(function (r) {
              list.push(normDriving(r, cfg.tag, mk === 'moto'));
            });
          });
        });
      });
      tasks = [chain.then(function () { return list; })];
    } else if (mk === 'bus') {
      if (!AMap.Transfer) return Promise.resolve([]);
      var city = (F.city && F.city.value || '').trim() || '杭州';
      tasks = [serviceSearch(AMap.Transfer, {
        city:city, policy:(AMap.TransferPolicy && AMap.TransferPolicy.LEAST_TIME) || 0,
        extensions:'all', autoFitView:false, hideMarkers:true
      }, from, to).then(function (result) {
        return arr(result && (result.plans || result.transits)).slice(0, 5).map(function (p, i) {
          return normBus(p, i === 0 ? '推荐' : '方案 ' + (i + 1));
        });
      })];
    } else {
      var Ctor = mk === 'walk' ? AMap.Walking : AMap.Riding;
      if (!Ctor) return Promise.resolve([]);
      tasks = [serviceSearch(Ctor, { autoFitView:false, hideMarkers:true }, from, to).then(function (result) {
        return arr(result && (result.paths || result.routes)).slice(0, 5).map(function (p, i) {
          return normWalkRide(p, i === 0 ? '推荐' : '方案 ' + (i + 1));
        });
      })];
      /* 步行/骑行插件若未加载，回退到「驾车路网 + 方式标注」给出参考方案 */
      tasks[0] = tasks[0].then(function (list) {
        if (list.length) return list;
        return serviceSearch(AMap.Driving, { policy:0, hideMarkers:true }, from, to).then(function (result) {
          return arr(result && result.routes).slice(0, 3).map(function (r, i) {
            var s = normDriving(r, i === 0 ? '参考' : '参考 ' + (i + 1), false);
            s.extra = '步行/骑行专用算路不可用，此为驾车路网参考';
            return s;
          });
        });
      });
    }

    return Promise.all(tasks.map(function (t) { return t.catch(function () { return []; }); }))
      .then(function (groups) {
        if (seq !== planSeq) return null;
        var all = [];
        groups.forEach(function (g) { g.forEach(function (s) { all.push(s); }); });
        if (!all.length && (mk === 'car' || mk === 'moto')) {
          /* 并发策略可能因限流全部失败，串行重试一次最简请求 */
          return serviceSearch(AMap.Driving, { policy:0 }, from, to).then(function (result) {
            return arr(result && result.routes).slice(0, 3).map(function (r, i) {
              var s = normDriving(r, i === 0 ? '推荐' : '方案 ' + (i + 1), mk === 'moto');
              if (mk === 'moto') s.extra = '摩托参考方案 · 未规避禁摩与限行';
              return s;
            });
          });
        }
        return dedupe(all).slice(0, 6);
      });
  }

  function plan() {
    var v = readForm();
    if (!v.from || !v.to) { M.toast('请先填写起点和终点', 'warn'); return Promise.resolve(false); }
    var seq = ++planSeq;
    var btn = M.$('#rt-plan'); if (btn) btn.disabled = true;
    setPlanLoading(true, '正在规划' + getMode().name + '路线…');

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
      lastPlan = { from:ps[0], to:ps[1], mode:mode };
      return searchSchemes(ps[0], ps[1], seq).then(function (list) {
        if (seq !== planSeq || !list) return false;
        if (!list.length) {
          setPlanLoading(false);
          showEmpty(urlInfo());
          M.toast('未找到可用' + getMode().name + '方案，请调整起终点或切换方式', 'warn', 3200);
          return false;
        }
        schemes = list; selected = 0;
        setPlanLoading(false);
        renderSchemes(); renderSelected();
        return true;
      });
    }).catch(function (e) {
      if (seq !== planSeq) return false;
      setPlanLoading(false);
      M.toast('地址解析失败：' + ((e && e.message) || '请检查地名或填写经纬度'), 'warn', 3200);
      return false;
    }).then(function (ok) {
      if (seq === planSeq && btn) btn.disabled = false;
      return !!ok;
    });
  }
  function urlInfo() {
    return '未找到可用方案（' + getMode().name + '）。可调整起终点、城市或切换交通方式后重试。';
  }

  /* ---------------- 方案列表与选中态 ---------------- */
  function setPlanLoading(on, text) {
    var box = M.$('#rt-schemes'); if (!box) return;
    if (!on) {
      box.classList.remove('is-loading');
      if (schemes.length) renderSchemes();
      return;
    }
    box.classList.add('is-loading');
    box.innerHTML = '<div class="route-scheme-loading"><span class="rt-spinner"></span><span>' + M.esc(text || '正在计算方案…') + '</span></div>';
  }
  function showEmpty(msg) {
    schemes = []; selected = 0; clearLayer();
    var box = M.$('#rt-schemes');
    if (box) {
      box.classList.remove('is-loading');
      box.innerHTML = '<div class="route-scheme-empty">' + M.esc(msg) + '</div>';
    }
    var box2 = M.$('#rt-result'); if (box2) box2.hidden = false;
    var met = M.$('#rt-metrics'); if (met) met.innerHTML = '';
    var st = M.$('#rt-steps'); if (st) st.innerHTML = '';
    var nav = M.$('#rt-nav'); if (nav) nav.disabled = true;
    var hint = M.$('#rt-map-hint'); if (hint) hint.textContent = msg;
  }
  function clearLayer() {
    if (!currentLayer) return;
    try { map.remove(currentLayer); } catch (e) {}
    currentLayer = null;
  }
  function drawScheme(s) {
    clearLayer();
    if (!map || !window.AMap || !AMap.Polyline || !s || s.path.length < 2) return;
    try {
      currentLayer = new AMap.Polyline({
        map:map, path:s.path, strokeColor:'#4bd08b', strokeWeight:6, strokeOpacity:.88,
        isOutline:true, outlineColor:'rgba(8,10,14,.85)', zIndex:90, bubble:true
      });
      map.setFitView([currentLayer], false, [60, 60, 60, 60]);
    } catch (e) {}
  }
  function renderSchemes() {
    var box = M.$('#rt-schemes'); if (!box) return;
    box.classList.remove('is-loading');
    box.innerHTML = schemes.map(function (s, i) {
      var active = i === selected;
      var fact = s.lines && s.lines.length ? M.esc(s.lines.slice(0, 3).join(' → ')) : (s.traffic || s.extra || '');
      return '<button type="button" class="route-scheme' + (active ? ' is-active' : '') +
        '" data-scheme="' + i + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
        '<span class="scheme-top"><strong>' + M.esc(s.tag || ('方案 ' + (i + 1))) + '</strong>' +
          (i === 0 ? '<em>推荐</em>' : '') + '</span>' +
        '<span class="scheme-main"><b>' + fmtKm(s.distance) + '</b>' +
          '<span>' + fmtTime(s.time) + '</span>' +
          '<span>' + (s.cost > 0 ? '¥' + s.cost.toFixed(0) : '免费') + '</span></span>' +
        (fact ? '<span class="scheme-fact">' + fact + '</span>' : '') +
        '</button>';
    }).join('');
    M.$$('.route-scheme', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-scheme'));
        if (i === selected || !schemes[i]) return;
        selected = i;
        renderSchemes(); renderSelected();
        M.toast('已切换到方案 ' + (i + 1) + ' · ' + (schemes[i].tag || ''), 'info', 1400);
      });
    });
  }
  function renderSelected() {
    var s = schemes[selected]; if (!s) return;
    drawScheme(s);
    var box = M.$('#rt-result'); if (box) box.hidden = false;
    var meta = getMode();
    var pol = M.$('#rt-policy');
    if (pol) pol.textContent = meta.name + ' · ' + (s.tag || ('方案 ' + (selected + 1)));
    var costLabel = meta.key === 'bus' ? '参考票价' : (meta.key === 'car' || meta.key === 'moto') ? '过路费' : '费用';
    var diffLabel = meta.key === 'car' || meta.key === 'moto' ? '路况' : meta.key === 'bus' ? '换乘与步行' : '路线说明';
    var items = [
      { label:'路线距离', val:fmtKm(s.distance) },
      { label:'预计用时', val:fmtTime(s.time) },
      { label:costLabel, val:s.cost > 0 ? '¥' + s.cost.toFixed(0) : '免费' },
      { label:diffLabel, val:s.traffic || s.extra || '—' }
    ];
    var mbox = M.$('#rt-metrics');
    if (mbox) mbox.innerHTML = items.map(function (it) {
      return '<div class="route-metric"><span>' + M.esc(it.label) + '</span><strong>' + M.esc(it.val) + '</strong></div>';
    }).join('');
    var steps = s.steps.slice(0, 5);
    var sbox = M.$('#rt-steps');
    if (sbox) sbox.innerHTML = steps.length ? steps.map(function (st, i) {
      var txt = st.text;
      if (txt.length > 64) txt = txt.slice(0, 64) + '…';
      return '<div class="route-step"><i>' + (i + 1) + '</i><span>' + M.esc(txt) + '</span></div>';
    }).join('') : '<div class="route-step"><i>—</i><span>暂无分步信息，可在导航 App 中查看完整指引</span></div>';
    var nav = M.$('#rt-nav'); if (nav) nav.disabled = false;
    renderResultNote();
    var hint = M.$('#rt-map-hint');
    if (hint) hint.textContent = '已展示 ' + schemes.length + ' 条' + meta.name + '方案，点击方案卡可即时切换地图路线；「开始导航」将用当前起终点直接调起高德。';
  }
  function renderResultNote() {
    var note = M.$('#rt-result-note'); if (!note) return;
    var meta = getMode();
    note.textContent = meta.note;
    note.classList.toggle('is-warn', meta.key === 'moto');
  }
  function clearSchemes() {
    schemeClear();
  }
  function schemeClear() {
    planSeq++;
    schemes = []; selected = 0; clearLayer();
    var box = M.$('#rt-schemes');
    if (box) { box.classList.remove('is-loading'); box.innerHTML = ''; }
    var res = M.$('#rt-result'); if (res) res.hidden = true;
    var nav = M.$('#rt-nav'); if (nav) nav.disabled = true;
  }
  function clearAll() {
    planSeq++;
    points = { from:null, to:null };
    lastPlan = null;
    setPickMode(null);
    clearLayer();
    drawMarkers();
    [F.from, F.to].forEach(function (n) { if (n) n.value = ''; });
    markResolved();
    schemeClear();
    var hint = M.$('#rt-map-hint'); if (hint) hint.textContent = defaultHint();
    setState(null);
    var btn = M.$('#rt-plan'); if (btn) btn.disabled = false;
  }

  /* ---------------- 交通方式切换 ---------------- */
  function renderModeTabs() {
    var box = M.$('#rt-mode-tabs'); if (!box) return;
    box.innerHTML = MODES.map(function (m) {
      var active = m.key === mode;
      return '<button type="button" class="route-mode' + (active ? ' is-active' : '') +
        '" data-mode="' + m.key + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
        M.esc(m.short) + '</button>';
    }).join('');
    M.$$('.route-mode', box).forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
    });
  }
  function setMode(k) {
    var next = getMode(k);
    if (!next || next.key === mode) return;
    mode = k;
    renderModeTabs(); renderResultNote();
    var hint = M.$('#rt-map-hint');
    if (hint) hint.textContent = '已切换为「' + getMode().name + '」。' + getMode().note;
    if (points.from && points.to) {
      M.toast('已切换为' + getMode().name + '，正在重新规划…', 'info', 1500);
      plan();
    } else {
      schemeClear();
    }
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
    var nav = M.$('#rt-nav'); if (nav) { nav.disabled = true; nav.addEventListener('click', navigate); }
    var clr = M.$('#rt-clear'); if (clr) clr.addEventListener('click', clearAll);
    var retry = M.$('#rt-map-retry'); if (retry) retry.addEventListener('click', function () {
      sdkPromise = null; ensureMap().catch(function () {});
    });
    renderModeTabs(); renderResultNote();
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
    init:init, open:open, buildUrl:buildUrl, buildNavUrl:buildNavUrl, list:list,
    plan:plan, locate:locate, ensureMap:ensureMap, clear:clearAll, setPoint:setPoint,
    navigate:navigate, setMode:setMode,
    schemes:function () { return schemes.slice(); },
    selected:function () { return schemes[selected] || null; },
    state:function () {
      return {
        sdk:sdkState, points:{ from:!!points.from, to:!!points.to },
        map:!!map, keyConfigured:keyConfigured(), mode:mode,
        schemes:schemes.length, selected:selected
      };
    }
  };
})(window.MOTO);
