/* MOTO // GARAGE — 骑行数据看板
   聚合加油日志 / 路线 / 天气 / 笔记，生成本地可视化。
   只读展示，不修改任何业务数据；任一数据源异常都不影响其它卡片。 */
(function (M) {
  'use strict';

  var C = M.CONFIG;
  var el = null;

  function fmt(n, d) { return Number(n).toFixed(d == null ? 1 : d); }
  function money(n) { return '¥' + Number(n).toFixed(2); }
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + M.pad2(d.getMonth() + 1) + '-' + M.pad2(d.getDate()); }
  function monthKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + M.pad2(d.getMonth() + 1); }

  /* ---------- 聚合计算 ---------- */
  function aggregate() {
    var d = M.store.data;
    var logs = (d.fuelLogs || []).slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    var totalKm = 0, totalL = 0, totalCost = 0, consSum = 0, consN = 0;
    var byMonth = {}, byDay = {};

    logs.forEach(function (r) {
      var km = Number(r.distance) || 0, L = Number(r.fuel) || 0, cost = Number(r.total) || 0;
      var cons = Number(r.consumption);
      totalKm += km; totalL += L; totalCost += cost;
      if (isFinite(cons) && cons > 0) { consSum += cons; consN++; }
      var mk = monthKey(r.at), dk = dayKey(r.at);
      if (!byMonth[mk]) byMonth[mk] = { km:0, cost:0, n:0 };
      byMonth[mk].km += km; byMonth[mk].cost += cost; byMonth[mk].n++;
      byDay[dk] = (byDay[dk] || 0) + km;
    });

    var months = Object.keys(byMonth).sort().slice(-12);
    var avgCons = consN ? consSum / consN : 0;
    var avgCostKm = totalKm ? totalCost / totalKm : 0;
    var rideDays = Object.keys(byDay).length;

    // 连续骑行天数（截至最近一次记录）
    var streak = 0;
    if (logs.length) {
      var cursor = new Date(logs[logs.length - 1].at);
      cursor.setHours(0, 0, 0, 0);
      while (true) {
        var k = cursor.getFullYear() + '-' + M.pad2(cursor.getMonth() + 1) + '-' + M.pad2(cursor.getDate());
        if (!byDay[k]) break;
        streak++; cursor.setDate(cursor.getDate() - 1);
      }
    }

    // 天气分布：从日志时间匹配天气缓存（仅当缓存 place 属于当前城市时作参考）
    var wx = d.weatherCache;
    var wxValid = wx && wx.payload && wx.place && wx.place.name === (d.settings.weatherCity || '');
    var weather = null;
    if (wxValid) {
      var cur = wx.payload.current || {};
      weather = { code:cur.weather_code, temp:cur.temperature_2m, city:wx.place.name, ts:wx.ts };
    }

    return {
      logs: logs, totalKm: totalKm, totalL: totalL, totalCost: totalCost,
      avgCons: avgCons, avgCostKm: avgCostKm, rideDays: rideDays, streak: streak,
      months: months, byMonth: byMonth, weather: weather,
      routes: (d.routes || []).length, notes: (d.notes || []).length,
      firstAt: logs.length ? logs[0].at : 0, lastAt: logs.length ? logs[logs.length - 1].at : 0
    };
  }

  /* ---------- SVG 折线图：油耗趋势 ---------- */
  function lineChart(logs) {
    var data = logs.slice(-14);
    if (data.length < 2) return emptyChart('至少记录 2 次后显示趋势');
    var W = 620, H = 180, padL = 42, padR = 14, padT = 16, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    var vals = data.map(function (r) { return Number(r.consumption) || 0; });
    var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
    var hi = Math.ceil(Math.max(max, 8) + 1), lo = Math.max(0, Math.floor(Math.min(min, 3) - 1));
    var span = hi - lo || 1;
    var pts = vals.map(function (v, i) {
      var x = padL + (data.length === 1 ? iw / 2 : i * iw / (data.length - 1));
      var y = padT + ih - ((v - lo) / span) * ih;
      return [x, y];
    });
    var poly = pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    var area = 'M' + pts[0][0].toFixed(1) + ',' + (padT + ih) + ' L' + poly.replace(/ /g, ' L') + ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + (padT + ih) + ' Z';
    var grid = '';
    [0, 0.5, 1].forEach(function (t) {
      var y = padT + ih * t, v = hi - span * t;
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="var(--line-soft)" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="db-axis">' + v.toFixed(0) + '</text>';
    });
    var dots = pts.map(function (p, i) {
      return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5" fill="var(--bg)" stroke="var(--accent)" stroke-width="2"><title>' +
        M.esc(dayKey(data[i].at)) + ' · ' + fmt(vals[i], 2) + ' L/100km</title></circle>';
    }).join('');
    var labels = data.map(function (r, i) {
      if (data.length > 8 && i % 2 === 1) return '';
      var x = pts[i][0].toFixed(1);
      var d = new Date(r.at);
      return '<text x="' + x + '" y="' + (H - 8) + '" text-anchor="middle" class="db-axis">' + (d.getMonth() + 1) + '/' + d.getDate() + '</text>';
    }).join('');
    return '<svg class="db-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="百公里油耗趋势图">' +
      grid + '<path d="' + area + '" fill="var(--accent-soft, rgba(255,74,28,.10))" stroke="none"/>' +
      '<polyline points="' + poly + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + labels + '</svg>';
  }

  /* ---------- SVG 柱状图：月度里程 ---------- */
  function barChart(a) {
    if (!a.months.length) return emptyChart('记录后显示月度里程');
    var data = a.months.map(function (m) { return { m:m, km:a.byMonth[m].km }; });
    var W = 620, H = 180, padL = 42, padR = 14, padT = 16, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    var max = Math.max.apply(null, data.map(function (x) { return x.km; }));
    var hi = Math.max(10, Math.ceil(max / 50) * 50);
    var bw = Math.min(46, iw / data.length * 0.62);
    var bars = data.map(function (x, i) {
      var cx = padL + (i + 0.5) * iw / data.length;
      var h = (x.km / hi) * ih;
      var y = padT + ih - h;
      return '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(h, 1).toFixed(1) + '" fill="var(--accent)" opacity=".85" rx="2"><title>' + M.esc(x.m) + ' · ' + fmt(x.km, 0) + ' km</title></rect>' +
        '<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="db-axis">' + x.m.slice(2) + '</text>' +
        (x.km > 0 ? '<text x="' + cx.toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle" class="db-bar-val">' + fmt(x.km, 0) + '</text>' : '');
    }).join('');
    var grid = '';
    [0, 0.5, 1].forEach(function (t) {
      var y = padT + ih * t, v = hi - hi * t;
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="var(--line-soft)" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="db-axis">' + v.toFixed(0) + '</text>';
    });
    return '<svg class="db-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="月度里程柱状图">' + grid + bars + '</svg>';
  }

  function emptyChart(msg) {
    return '<div class="db-chart-empty"><svg class="icon"><use href="#i-gauge"/></svg><span>' + M.esc(msg) + '</span></div>';
  }

  /* ---------- 最近记录 ---------- */
  function recentHTML(a) {
    if (!a.logs.length) return '<div class="db-empty"><svg class="icon"><use href="#i-gauge"/></svg><strong>还没有加油记录</strong><p>到「油耗计算」填入里程与油量，点「记一笔」即可开始积累数据。</p><a class="btn btn--outline btn--sm" href="#/fuel">去记录 →</a></div>';
    var rows = a.logs.slice(-6).reverse().map(function (r) {
      var d = new Date(r.at);
      return '<tr><td>' + (d.getMonth() + 1) + '/' + d.getDate() + '</td>' +
        '<td>' + fmt(r.distance, 0) + ' km</td>' +
        '<td>' + fmt(r.fuel, 2) + ' L</td>' +
        '<td>' + fmt(r.consumption, 2) + ' L/100km</td>' +
        '<td class="db-cost">' + money(r.total) + '</td></tr>';
    }).join('');
    return '<div class="db-table-wrap"><table class="db-table"><thead><tr><th>日期</th><th>里程</th><th>油量</th><th>油耗</th><th>油费</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* ---------- 渲染 ---------- */
  function render() {
    if (!el) return;
    var a = aggregate();
    var span = a.firstAt ? dayKey(a.firstAt) + ' 起' : '尚无数据';

    var kpis = [
      { label:'累计里程', val:fmt(a.totalKm, 0), unit:'km', foot:span, icon:'i-route' },
      { label:'累计油费', val:money(a.totalCost), unit:'', foot:a.logs.length + ' 次记录', icon:'i-fuel' },
      { label:'平均油耗', val:fmt(a.avgCons, 2), unit:'L/100km', foot:'按记录均值', icon:'i-gauge' },
      { label:'每公里成本', val:fmt(a.avgCostKm, 3), unit:'¥/km', foot:a.rideDays + ' 个骑行日', icon:'i-arrow' }
    ];
    M.$('#db-kpis').innerHTML = kpis.map(function (k) {
      return '<div class="db-kpi"><div class="db-kpi-top"><span class="db-kpi-label">' + M.esc(k.label) + '</span><svg class="icon"><use href="#' + k.icon + '"/></svg></div>' +
        '<div class="db-kpi-val">' + M.esc(k.val) + (k.unit ? '<span>' + M.esc(k.unit) + '</span>' : '') + '</div>' +
        '<div class="db-kpi-foot">' + M.esc(k.foot) + '</div></div>';
    }).join('');

    M.$('#db-chart-cons').innerHTML = lineChart(a.logs);
    M.$('#db-chart-km').innerHTML = barChart(a);
    M.$('#db-recent').innerHTML = recentHTML(a);

    var side = [
      { label:'骑行天数', val:a.rideDays, unit:'天' },
      { label:'连续骑行', val:a.streak, unit:'天' },
      { label:'常用路线', val:a.routes, unit:'条' },
      { label:'骑行笔记', val:a.notes, unit:'篇' }
    ];
    M.$('#db-side').innerHTML = side.map(function (s) {
      return '<div class="db-side-item"><strong>' + s.val + '</strong><span>' + M.esc(s.unit) + '</span><em>' + M.esc(s.label) + '</em></div>';
    }).join('');

    var wxBox = M.$('#db-weather');
    if (a.weather) {
      var a2 = M.weather && M.weather.state ? M.weather.state.advice : null;
      wxBox.innerHTML = '<div class="db-wx-row"><span class="db-wx-temp">' + fmt(a.weather.temp, 0) + '°</span>' +
        '<div><strong>' + M.esc(a.weather.city) + ' · 骑行参考</strong><span>' + (a2 ? M.esc(a2.label) : '当前天气') + ' · 数据来自最近一次天气缓存</span></div></div>' +
        '<p class="db-wx-note">天气为当日概况，仅作骑行参考；出发前请查看「出行准备」中的实时天气。</p>';
    } else {
      wxBox.innerHTML = '<div class="db-wx-empty"><svg class="icon"><use href="#i-cloud"/></svg><span>暂无天气数据，打开「出行准备」获取一次后即可在此显示。</span></div>';
    }

    M.$('#db-empty-banner').hidden = a.logs.length > 0;
  }

  function init() {
    el = M.$('#view-dashboard');
    if (!el) return;
    M.on('store:change', function (ev) {
      if (ev.parts && (ev.parts.indexOf('fuelLogs') > -1 || ev.parts.indexOf('all') > -1)) render();
    });
    M.on('cloud:pulled', render);
    M.on('route:change', function (key) { if (key === 'dashboard') render(); });
    render();
  }

  M.dashboard = { init: init, render: render, aggregate: aggregate };
})(window.MOTO);
