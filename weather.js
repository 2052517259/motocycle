/* MOTO // GARAGE — 骑行天气
   出发前查看当日天气概况与骑行适宜度。
   数据源（按 config.weatherProvider 与可用性自动编排）：
     - Open-Meteo（默认，免 key、支持跨域）
     - wttr.in（备源，免 key、按城市名，全球 CDN）
     - 和风天气 QWeather（可选，config 配置 key 后启用，国内最稳）
   健壮性：单源失败自动重试；多源依次兜底；结果缓存优先展示，永不空白；
           异常给出明确状态且不影响其他模块。 */
(function (M) {
  'use strict';

  var C = M.CONFIG;
  // 预设城市：[纬度, 经度]
  var PRESETS = {
    '广州':[23.1291,113.2644], '深圳':[22.5431,114.0579], '北京':[39.9042,116.4074],
    '上海':[31.2304,121.4737], '成都':[30.5728,104.0668], '杭州':[30.2741,120.1551],
    '武汉':[30.5928,114.3055], '西安':[34.3416,108.9398], '重庆':[29.5630,106.5516],
    '昆明':[25.0389,102.7183], '南京':[32.0603,118.7969], '长沙':[28.2282,112.9388],
    '苏州':[31.2989,120.5853], '天津':[39.0842,117.2009], '青岛':[36.0671,120.3826],
    '厦门':[24.4798,118.0894], '哈尔滨':[45.8038,126.5349], '拉萨':[29.6520,91.1721]
  };
  // WMO 天气代码 → [中文, 等级]
  var WMO = {
    0:['晴','ok'], 1:['大致晴朗','ok'], 2:['局部多云','ok'], 3:['阴','ok'],
    45:['雾','caution'], 48:['雾凇','caution'],
    51:['小毛毛雨','caution'], 53:['毛毛雨','caution'], 55:['中毛毛雨','caution'],
    56:['冻毛雨','bad'], 57:['冻毛雨','bad'],
    61:['小雨','caution'], 63:['中雨','bad'], 65:['大雨','bad'],
    66:['冻雨','bad'], 67:['冻雨','bad'],
    71:['小雪','caution'], 73:['中雪','bad'], 75:['大雪','bad'], 77:['雪粒','bad'],
    80:['阵雨','caution'], 81:['强阵雨','bad'], 82:['暴雨','bad'],
    85:['阵雪','caution'], 86:['强阵雪','bad'],
    95:['雷阵雨','bad'], 96:['雷阵雨伴冰雹','bad'], 99:['强雷暴冰雹','bad']
  };

  var state = {
    place:null, payload:null, ts:0, status:'idle', message:'', advice:null,
    fromCache:false, loading:false, background:false, softError:false,
    progress:'', lastOkSource:null, fileProto:false
  };
  var seq = 0;

  function wmoText(code) { return (WMO[code] || ['未知','caution'])[0]; }
  function wmoLevel(code) { return (WMO[code] || ['未知','caution'])[1]; }
  function num(v, d) { if (v === null || v === undefined || isNaN(v)) return '—'; return Number(v).toFixed(d === undefined ? 0 : d); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function assess(payload) {
    var cur = payload.current, daily = payload.daily;
    var code = cur.weather_code;
    var wind = cur.wind_speed_10m || 0;
    var pop = (daily && daily.precipitation_probability_max && daily.precipitation_probability_max[0]) || 0;
    var level = wmoLevel(code);
    var advice = [];
    var label;
    if (level === 'bad') { label = '暂不适宜骑行'; advice.push('当前天气对骑行不够友好，建议改期或谨慎评估。'); }
    else if (level === 'caution') { label = '可骑行 · 需做好准备'; advice.push('天气尚可，但请提前做好准备再出发。'); }
    else { label = '适宜骑行'; advice.push('天气条件不错，出发前简单检查即可。'); }
    if (pop >= 60) { advice.push('降水概率高达 ' + pop + '%，带好雨衣并留意路面湿滑。'); level = (level === 'bad') ? 'bad' : 'caution'; if (level === 'caution') label = '可骑行 · 需做好准备'; }
    else if (pop >= 30) { advice.push('有 ' + pop + '% 降水概率，建议随身带一件轻薄雨衣。'); }
    if (wind >= 40) { advice.push('风力较大（' + Math.round(wind) + ' km/h），注意横风与车身稳定。'); level = (level === 'bad') ? 'bad' : 'caution'; if (level === 'caution') label = '可骑行 · 需做好准备'; }
    else if (wind >= 25) { advice.push('风偏大（' + Math.round(wind) + ' km/h），高速路段握稳车把。'); }
    var t = cur.temperature_2m;
    if (t <= 5) advice.push('气温偏低（' + Math.round(t) + '℃），注意保暖与轮胎胎压。');
    else if (t >= 33) advice.push('高温（' + Math.round(t) + '℃），多补水、避开正午暴晒。');
    return { level:level, label:label, advice:advice };
  }

  /* ---------------- 数据源定义 ---------------- */
  // 每个源：name / needKey / fetch(place)→raw / normalize(raw)→{current,daily,source}
  var SOURCE_DEFS = {
    openmeteo: {
      name: 'Open-Meteo', needKey: false,
      fetch: fetchOpenMeteo, normalize: normOpenMeteo
    },
    wttr: {
      name: 'wttr.in', needKey: false,
      fetch: fetchWttr, normalize: normWttr
    },
    qweather: {
      name: '和风天气', needKey: true,
      fetch: fetchQweather, normalize: normQweather
    }
  };

  function reqUrl(p) {
    return C.weatherApi + '?latitude=' + p.lat + '&longitude=' + p.lng +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code' +
      '&timezone=auto&forecast_days=1';
  }
  function geoUrl(name) { return C.geocodeApi + '?name=' + encodeURIComponent(name) + '&count=1&language=zh&format=json'; }

  function fetchOpenMeteo(place) {
    return M.fetchTimeout(reqUrl(place), C.weatherRequestMs)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { if (!j || !j.current || !j.daily) throw new Error('返回数据缺失'); return j; });
  }
  function normOpenMeteo(j) { return { current: j.current, daily: j.daily, source: 'openmeteo' }; }

  function fetchWttr(place) {
    var name = encodeURIComponent(place.name || 'Beijing');
    return M.fetchTimeout('https://wttr.in/' + name + '?format=j1', C.weatherRequestMs)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { if (!j || !j.current_condition || !j.current_condition[0]) throw new Error('返回数据缺失'); return j; });
  }
  function normWttr(j) {
    var cc = j.current_condition[0];
    var w = (j.weather && j.weather[0]) || {};
    var hourly = w.hourly || [];
    var pop = 0;
    hourly.forEach(function (h) { var v = parseInt(h.chanceofrain, 10); if (!isNaN(v) && v > pop) pop = v; });
    var code = parseInt(cc.weatherCode, 10) || 3;
    return {
      current: {
        temperature_2m: parseFloat(cc.temp_C),
        apparent_temperature: parseFloat(cc.FeelsLikeC),
        relative_humidity_2m: parseFloat(cc.humidity),
        wind_speed_10m: parseFloat(cc.windspeedKmph),
        weather_code: code
      },
      daily: {
        temperature_2m_max: [parseFloat(w.maxtempC)],
        temperature_2m_min: [parseFloat(w.mintempC)],
        precipitation_probability_max: [pop],
        weather_code: [code]
      },
      source: 'wttr'
    };
  }

  function fetchQweather(place) {
    var loc = place.lng + ',' + place.lat;
    var base = (C.weatherApiHost || 'https://api.qweather.com').replace(/\/$/, '');
    var k = C.weatherKey;
    var nowU = base + '/v7/weather/now?location=' + encodeURIComponent(loc) + '&key=' + k;
    var d3U = base + '/v7/weather/3d?location=' + encodeURIComponent(loc) + '&key=' + k;
    var hU = base + '/v7/weather/24h?location=' + encodeURIComponent(loc) + '&key=' + k;
    return Promise.all([
      M.fetchTimeout(nowU, C.weatherRequestMs).then(function (r) { if (!r.ok) throw new Error('now HTTP ' + r.status); return r.json(); }),
      M.fetchTimeout(d3U, C.weatherRequestMs).then(function (r) { if (!r.ok) throw new Error('3d HTTP ' + r.status); return r.json(); }),
      M.fetchTimeout(hU, C.weatherRequestMs).then(function (r) { if (!r.ok) throw new Error('24h HTTP ' + r.status); return r.json(); })
    ]).then(function (arr) {
      if (!arr[0] || !arr[0].now) throw new Error('和风返回异常');
      return { now: arr[0], d3: arr[1], h: arr[2] };
    });
  }
  function wmoFromText(text) {
    text = text || '';
    if (/雷/.test(text)) return 95;
    if (/暴雨|大暴雨|特大暴雨/.test(text)) return 65;
    if (/雨夹雪|冻雨/.test(text)) return 66;
    if (/小雪|中雪|大雪|暴雪|雪/.test(text)) return 73;
    if (/阵雨|小雨|中雨/.test(text)) return 61;
    if (/雾|霾|沙尘/.test(text)) return 45;
    if (/阴|多云/.test(text)) return 3;
    if (/晴/.test(text)) return 0;
    if (/云/.test(text)) return 2;
    return 3;
  }
  function normQweather(o) {
    var now = o.now.now;
    var d = (o.d3 && o.d3.daily && o.d3.daily[0]);
    var hp = 0;
    if (o.h && o.h.hourly) o.h.hourly.forEach(function (x) { var v = parseInt(x.pop, 10); if (!isNaN(v) && v > hp) hp = v; });
    var code = wmoFromText(now.text);
    return {
      current: {
        temperature_2m: parseFloat(now.temp),
        apparent_temperature: parseFloat(now.feelsLike),
        relative_humidity_2m: parseFloat(now.humidity),
        wind_speed_10m: parseFloat(now.windSpeed),
        weather_code: code
      },
      daily: {
        temperature_2m_max: [d ? parseFloat(d.tempMax) : NaN],
        temperature_2m_min: [d ? parseFloat(d.tempMin) : NaN],
        precipitation_probability_max: [hp],
        weather_code: [d ? wmoFromText(d.textDay) : code]
      },
      source: 'qweather'
    };
  }

  function sourceUsable(key) {
    var d = SOURCE_DEFS[key];
    if (!d) return false;
    if (d.needKey && key === 'qweather' && !C.weatherKey) return false;
    return true;
  }
  function activeSources() {
    var list = [];
    var provider = C.weatherProvider || 'openmeteo';
    // 上次成功的源优先，降低延迟
    if (state.lastOkSource && sourceUsable(state.lastOkSource) && list.indexOf(state.lastOkSource) < 0) list.push(state.lastOkSource);
    if (provider === 'qweather' && C.weatherKey) {
      if (list.indexOf('qweather') < 0) list.push('qweather');
      if (list.indexOf('openmeteo') < 0) list.push('openmeteo');
    } else {
      if (list.indexOf('openmeteo') < 0) list.push('openmeteo');
    }
    if (list.indexOf('wttr') < 0) list.push('wttr'); // 始终保留一个免 key 备源
    return list.filter(sourceUsable);
  }

  function withRetry(fn, n, onRetry) {
    return fn().catch(function (err) {
      if (n <= 0) return Promise.reject(err);
      if (onRetry) onRetry(n);
      return sleep(500 + (C.weatherRetries - n) * 400).then(function () { return withRetry(fn, n - 1, onRetry); });
    });
  }

  function runSources(place, sources) {
    var i = 0;
    function step() {
      if (i >= sources.length) return Promise.reject(new Error('所有天气源均不可用'));
      var key = sources[i], def = SOURCE_DEFS[key];
      state.progress = '正在通过 ' + def.name + ' 获取天气…';
      if (!state.background) render();
      return withRetry(function () { return def.fetch(place); }, C.weatherRetries || 1, function (left) {
        state.progress = def.name + ' 获取失败，正在重试（剩 ' + left + ' 次）…';
        if (!state.background) render();
      }).then(function (raw) {
        var payload = def.normalize(raw);
        payload.source = key;
        state.lastOkSource = key;
        return payload;
      }).catch(function (err) {
        i++;
        state.progress = def.name + ' 暂不可用，尝试下一个数据源…';
        if (!state.background) render();
        return sleep(250).then(step);
      });
    }
    return step();
  }

  /* ---------------- 缓存 ---------------- */
  function saveCache(payload, place) {
    try {
      M.store.data.weatherCache = { ts: Date.now(), place: place, payload: payload, source: payload.source };
      M.store.save(['weatherCache']);
    } catch (e) { /* ignore */ }
  }
  function loadCache() {
    var c = M.store.data.weatherCache;
    if (!c || !c.payload || (Date.now() - (c.ts || 0)) >= C.weatherCacheTtlMs) return false;
    // 仅当缓存属于当前选择的城市时才复用，避免旧默认城市（如广州）的缓存覆盖新默认（杭州）
    if (!c.place || c.place.name !== (M.store.data.settings.weatherCity || '杭州')) return false;
    state.payload = c.payload; state.place = c.place; state.ts = c.ts;
    state.fromCache = true; state.status = 'ok'; state.advice = assess(c.payload);
    if (c.source) state.lastOkSource = c.source;
    return true;
  }

  /* ---------------- 刷新编排 ---------------- */
  function refresh(place, opts) {
    opts = opts || {};
    state.place = place;
    state.background = !!opts.background;
    state.softError = false;
    if (!state.background) { state.loading = true; }
    render();
    var my = ++seq;
    runSources(place, activeSources())
      .then(function (payload) {
        if (my !== seq) return;
        state.payload = payload; state.ts = Date.now(); state.fromCache = false;
        state.loading = false; state.background = false; state.status = 'ok'; state.softError = false;
        state.advice = assess(payload);
        state.progress = '';
        saveCache(payload, place);
        render();
      })
      .catch(function (e) {
        if (my !== seq) return;
        state.loading = false; state.background = false; state.status = 'error';
        state.message = (e && e.message) ? e.message : '网络异常';
        state.progress = '';
        if (state.payload) { state.softError = true; } // 有旧数据，保留并提示
        else { M.toast('天气获取失败：' + state.message + '（其他功能不受影响）', 'warn', 3600); }
        render();
      });
  }

  function goCity(name) {
    var coord = PRESETS[name];
    if (!coord) { M.toast('暂不支持该预设城市，可直接搜索', 'warn'); return; }
    M.store.data.settings.weatherCity = name; M.store.save(['settings']);
    refresh({ name: name, lat: coord[0], lng: coord[1] });
  }

  function searchCity(raw) {
    var name = String(raw || '').trim();
    if (!name) return;
    state.loading = true; render();
    var my = ++seq;
    M.fetchTimeout(geoUrl(name), C.weatherRequestMs)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        if (my !== seq) return;
        var res = j && j.results && j.results[0];
        if (!res) throw new Error('未找到该城市');
        M.store.data.settings.weatherCity = name; M.store.save(['settings']);
        refresh({ name: res.name, lat: res.latitude, lng: res.longitude });
      })
      .catch(function (e) {
        if (my !== seq) return;
        state.loading = false; state.status = 'error';
        state.message = (e && e.message) ? e.message : '城市查询失败';
        M.toast('未找到「' + name + '」，已保留当前城市', 'warn', 3200);
        render();
      });
  }

  function doGeolocate() {
    if (!navigator.geolocation) { M.toast('当前浏览器不支持定位', 'warn'); return; }
    M.toast('正在定位…', 'info', 1500);
    navigator.geolocation.getCurrentPosition(function (pos) {
      var p = { name: '我的位置', lat: pos.coords.latitude, lng: pos.coords.longitude };
      refresh(p);
    }, function () { M.toast('定位失败，请手动选择城市', 'warn', 3000); }, { timeout: 8000, enableHighAccuracy: false });
  }

  /* ---------------- 渲染 ---------------- */
  function metric(label, val) {
    return '<div class="wx-metric"><span class="wx-metric-label">' + label + '</span><strong>' + val + '</strong></div>';
  }

  function resultHTML() {
    var p = state.payload, place = state.place;
    if (state.loading && !p) {
      return '<div class="wx-loading">' + M.icon('clock') + '<span>' + M.esc(state.progress || ('正在获取 ' + (place ? place.name : '') + ' 的天气…')) + '</span></div>';
    }
    if (!p) {
      return '<div class="wx-error">' + M.icon('warn') +
        '<div><strong>天气获取失败</strong>' +
        '<p>' + M.esc(state.message || '未知错误') + '</p>' +
        (state.fileProto ? '<p class="wx-sub">检测到以本地文件方式打开，部分浏览器会限制网络请求。建议用本地服务器打开（如：<code>python -m http.server</code>）。</p>' : '') +
        '<p class="wx-sub">其他功能不受影响，可稍后点击「刷新天气」或下方按钮重试。</p>' +
        '<button type="button" class="btn btn--sm btn--solid" id="wx-retry">立即重试</button></div></div>';
    }
    // 有数据但有刷新失败：明确提示，同时保留上次数据
    var banner = (state.softError)
      ? '<div class="wx-error wx-error--soft">' + M.icon('warn') + '<div><strong>天气刷新失败</strong>' +
        '<p>' + M.esc(state.message || '网络异常') + ' · 以下为上次数据，其他功能不受影响。</p></div></div>'
      : '';
    var cur = p.current, daily = p.daily, a = state.advice;
    var hi = (daily.temperature_2m_max || [])[0], lo = (daily.temperature_2m_min || [])[0];
    var pop = (daily.precipitation_probability_max || [])[0] || 0;
    var lc = a.level === 'bad' ? 'is-bad' : (a.level === 'caution' ? 'is-caution' : 'is-ok');
    var ico = a.level === 'bad' ? 'warn' : (a.level === 'caution' ? 'warn' : 'check');
    var srcLabel = (p.source === 'qweather') ? '和风' : (p.source === 'wttr') ? 'wttr' : (state.fromCache ? '缓存' : 'Open-Meteo');
    return banner +
      '<div class="wx-now">' +
        '<div class="wx-temp"><strong>' + num(cur.temperature_2m, 1) + '</strong><span>℃</span></div>' +
        '<div class="wx-now-meta"><strong>' + wmoText(cur.weather_code) + '</strong>' +
          '<span>体感 ' + num(cur.apparent_temperature, 1) + '℃ · ' + M.esc(place ? place.name : '—') + ' · ' + M.esc(srcLabel) + '</span></div>' +
      '</div>' +
      '<div class="wx-metrics">' +
        metric('相对湿度', num(cur.relative_humidity_2m, 0) + '%') +
        metric('风力', num(cur.wind_speed_10m, 0) + ' km/h') +
        metric('降水概率', num(pop, 0) + '%') +
        metric('最高/最低', num(hi, 0) + '° / ' + num(lo, 0) + '°') +
      '</div>' +
      '<div class="wx-suit ' + lc + '">' + M.icon(ico) + '<div><strong>' + a.label + '</strong><ul>' +
        a.advice.map(function (s) { return '<li>' + M.esc(s) + '</li>'; }).join('') + '</ul></div></div>' +
      (state.fromCache ? '<p class="wx-cache-note">当前为本地缓存（' + M.fmtDate(state.ts) + '），点击「刷新天气」获取最新。</p>' : '');
  }

  function renderPanel() {
    var body = M.$('#wx-body'); if (!body) return;
    var place = state.place;
    var controls =
      '<div class="wx-controls">' +
        '<div class="wx-cities" id="wx-cities">' +
          Object.keys(PRESETS).map(function (c) {
            return '<button type="button" class="cat-pill' + (place && place.name === c ? ' is-active' : '') + '" data-city="' + M.esc(c) + '">' + M.esc(c) + '</button>';
          }).join('') +
        '</div>' +
        '<div class="wx-search"><span class="field-ic">' + M.icon('search') + '</span>' +
          '<input type="search" id="wx-city-input" placeholder="输入其他城市后回车…" autocomplete="off">' +
          '<button type="button" class="btn btn--sm btn--outline" id="wx-city-go">查询</button></div>' +
        '<div class="wx-actions">' +
          '<button type="button" class="btn btn--sm btn--outline" id="wx-refresh">' + M.icon('refresh') + '<span>刷新天气</span></button>' +
          '<button type="button" class="btn btn--sm btn--outline" id="wx-geo">' + M.icon('gauge') + '<span>定位</span></button>' +
        '</div>' +
      '</div>';
    body.innerHTML = controls + '<div class="wx-result" id="wx-result">' + resultHTML() + '</div>';

    M.$$('#wx-cities .cat-pill', body).forEach(function (b) {
      b.addEventListener('click', function () { goCity(b.getAttribute('data-city')); });
    });
    var input = M.$('#wx-city-input', body);
    var go = M.$('#wx-city-go', body);
    if (go) go.addEventListener('click', function () { searchCity(input ? input.value : ''); });
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') searchCity(input.value); });
    var rf = M.$('#wx-refresh', body);
    if (rf) rf.addEventListener('click', function () { if (state.place) refresh(state.place); });
    var geo = M.$('#wx-geo', body);
    if (geo) geo.addEventListener('click', doGeolocate);
    var retry = M.$('#wx-retry', body);
    if (retry) retry.addEventListener('click', function () { if (state.place) refresh(state.place); });
  }

  function renderHome() {
    var el = M.$('#home-wx'); if (!el) return;
    var p = state.payload, place = state.place, a = state.advice;
    if (state.loading && !p) {
      el.innerHTML = '<div class="home-wx-row"><span class="home-wx-loading">' + M.icon('clock') + ' ' + M.esc(state.progress || '正在获取骑行天气…') + '</span></div>';
      return;
    }
    if (!p) {
      el.innerHTML = '<div class="home-wx-row">' +
        '<span class="home-wx-loading">' + M.icon('warn') + ' 天气暂不可用（' + M.esc(state.message || '异常') + '）</span>' +
        '<a class="btn btn--sm btn--outline" href="#/ride">前往出行准备 →</a></div>';
      return;
    }
    var cur = p.current;
    var lc = a.level === 'bad' ? 'is-bad' : (a.level === 'caution' ? 'is-caution' : 'is-ok');
    var ico = a.level === 'bad' ? 'warn' : (a.level === 'caution' ? 'warn' : 'check');
    el.innerHTML =
      '<div class="home-wx-row">' +
        '<div class="home-wx-now"><span class="home-wx-temp">' + num(cur.temperature_2m, 1) + '°</span>' +
          '<div class="home-wx-meta"><strong>' + wmoText(cur.weather_code) + '</strong>' +
          '<span>' + M.esc(place ? place.name : '—') + (state.fromCache ? ' · 缓存' : '') + '</span></div></div>' +
        '<div class="home-wx-suit ' + lc + '">' + M.icon(ico) + '<span>' + M.esc(a.label) + '</span></div>' +
        '<a class="btn btn--sm btn--outline" href="#/ride">完整天气与路线 →</a>' +
      '</div>';
  }

  function render() { renderPanel(); renderHome(); }

  function init() {
    var city = M.store.data.settings.weatherCity || '杭州';
    var coord = PRESETS[city] || PRESETS['杭州'];
    state.place = { name: city, lat: coord[0], lng: coord[1] };
    if (window.location && window.location.protocol === 'file:') state.fileProto = true;
    var hadCache = loadCache();
    if (hadCache) render();
    refresh(state.place, { background: !!hadCache });
  }

  M.weather = { init: init, refresh: refresh, setCity: goCity, get state() { return state; } };
})(window.MOTO);
