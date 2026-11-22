/* MOTO // GARAGE — 油耗看板（Fuel Board）
   单一模块：实时油价、油耗测算、加油记录（补录 / 删除）、总 / 日 / 月骑行数据统计与可视化。
   统一数据源：M.store.data.fuelLogs；统一计算口径：
     平均油耗 = 累计油量 ÷ 累计里程 × 100
     每公里成本 = 累计油费 ÷ 累计里程
   统计卡与所有图表共用同一次 aggregate() 结果，避免多套统计实现口径不一致。 */
(function (M) {
  'use strict';

  /* ============================ 常量与工具 ============================ */
  var OIL_ENDPOINTS = [
    'https://cn.apihz.cn/api/jinrong/youjia.php?id=88888888&key=88888888&sheng=',
    'https://api.apihz.cn/api/jinrong/youjia.php?id=88888888&key=88888888&sheng='
  ];
  var STAT_LABELS = { total:'总骑行数据', day:'日骑行数据', month:'月骑行数据' };

  var els = {}, fetching = false, lastFetchAt = 0, pollTimer = null;
  var current = null;                 // 当前有效测算结果，供「记一笔」使用
  var activeRange = 'all';            // 时间筛选：30 / 90 / 365 / all
  var activeStatTab = 'total';        // 统计卡视图：total / day / month
  var el = null;                      // #view-fuel

  function fmt(n, d) { return Number(n).toFixed(d == null ? 1 : d); }
  function money(n) { return '¥' + Number(n).toFixed(2); }
  function fmtNum(n, d) { var v = Number(n); return isFinite(v) ? v.toFixed(d == null ? 1 : d) : '—'; }
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + M.pad2(d.getMonth() + 1) + '-' + M.pad2(d.getDate()); }
  function monthKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + M.pad2(d.getMonth() + 1); }
  function byAt(a, b) { return (a.at || 0) - (b.at || 0); }
  function settings() { return M.store.data.settings; }
  function num(id) { var v = parseFloat(els[id].value); return isFinite(v) ? v : null; }
  function priceValue() { var v = parseFloat(els.price.value); return isFinite(v) && v > 0 ? v : null; }

  /* ============================ 记录日期（补录） ============================ */
  function localDateStr(ts) {
    var d = ts == null ? new Date() : new Date(ts);
    return d.getFullYear() + '-' + M.pad2(d.getMonth() + 1) + '-' + M.pad2(d.getDate());
  }
  function dateToTs(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || '');
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0); // 正午，避免时区跨日
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  function selectedTs() {
    var val = els.date ? els.date.value : '';
    var ts = dateToTs(val);
    var today = localDateStr();
    if (ts == null || val > today) {
      if (els.date) els.date.value = today;
      return Date.now();
    }
    return val === today ? Date.now() : ts;
  }
  function isBackfill() { return !!(els.date && els.date.value && els.date.value !== localDateStr()); }
  function syncDateBadge() {
    var badge = M.$('#date-badge');
    if (!badge || !els.date) return;
    var back = isBackfill();
    badge.textContent = back ? '补录' : '今天';
    badge.classList.toggle('is-manual', back);
    var hint = M.$('#hint-date');
    if (hint) hint.textContent = back
      ? '将保存为 ' + els.date.value + ' 的历史记录，统计与图表按该日期归档'
      : '默认今天；忘记记录时可选择实际发生日期补录，数据会归入所选日期';
  }

  /* ============================ 实时油价 ============================ */
  function cacheFor(province) {
    var c = M.store.data.priceCache;
    return c && c.province === province ? c : null;
  }
  function applyPrice(p, meta) {
    var prev = parseFloat(els.price.value);
    if (settings().manualPrice) return;
    els.price.value = p != null && isFinite(p) ? Number(p).toFixed(2) : '';
    els.live.textContent = p != null && isFinite(p) ? Number(p).toFixed(2) : '--.--';
    els.liveOilLabel.textContent = M.OIL_LABELS[settings().oil] || '油价';
    var sp = M.$('#stat-price'); if (sp) sp.textContent = p != null && isFinite(p) ? Number(p).toFixed(2) : '--.--';
    var sf = M.$('#stat-price-foot'); if (sf) sf.textContent = (meta && meta.foot) || '实时油价';
    calculate();
    if (meta && meta.announce && isFinite(prev) && Math.abs(prev - p) > 0.0001) {
      M.toast('检测到油价变动，已自动更新为 ¥' + Number(p).toFixed(2) + '/L', 'ok', 4200);
    }
  }
  function setSource(text, kind) {
    els.source.textContent = text;
    els.led.className = 'led' + (kind === 'live' ? '' : kind === 'error' ? ' led--off' : ' led--amber');
    var badge = M.$('#auto-badge');
    if (badge) {
      badge.textContent = kind === 'manual' ? '手动输入' : kind === 'cache' ? '缓存价格' : kind === 'error' ? '接口异常' : '自动获取';
      badge.classList.toggle('is-manual', kind !== 'live');
    }
    var alert = M.$('#price-alert');
    if (!alert) return;
    if (kind === 'live') { alert.hidden = true; }
    else {
      alert.hidden = false;
      alert.classList.toggle('is-error', kind === 'error');
      var txt = M.$('#price-alert-text');
      if (txt) txt.textContent =
        kind === 'cache' ? '实时接口暂时不可用，正在使用最近一次成功获取的缓存油价；恢复联网后会自动刷新。'
        : kind === 'manual' ? '当前为手动输入模式：油价不再自动更新。点击「返回自动获取」可恢复。'
        : '油价接口请求失败且无可用缓存。请手动填写油价，或稍后点击「刷新油价」重试；已填写的里程与油耗不会丢失。';
    }
  }
  function parsePayload(json) {
    if (!json || String(json.code) !== '200' || !json.data) return null;
    var zones = Object.keys(json.data).filter(function (k) { return /^data\d+$/.test(k); }).sort();
    if (!zones.length) return null;
    return { prices: json.data[zones[0]], date: json.date || '', zone: (json.data[zones[0]].jq || '') };
  }
  function fetchPrice(opts) {
    opts = opts || {};
    if (fetching) return Promise.resolve(false);
    if (!opts.force && Date.now() - lastFetchAt < 60 * 1000) return Promise.resolve(false);
    fetching = true; lastFetchAt = Date.now();
    var province = settings().province;
    var btn = M.$('#price-refresh');
    if (btn) btn.disabled = true;
    els.source.textContent = '正在连接油价接口…';

    var chain = Promise.reject(new Error('start'));
    OIL_ENDPOINTS.forEach(function (base) {
      chain = chain.catch(function () {
        var url = base + encodeURIComponent(province) + '&_=' + Date.now();
        return M.fetchTimeout(url, 11000, { headers: { 'Accept': 'application/json' } })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (json) {
            var parsed = parsePayload(json);
            if (!parsed) throw new Error('数据格式异常');
            return parsed;
          });
      });
    });

    return chain.then(function (res) {
      fetching = false; if (btn) btn.disabled = false;
      var key = settings().oil;
      var p = res.prices ? parseFloat(res.prices[key]) : NaN;
      var c = M.store.data.priceCache;
      if (!isFinite(p) || p <= 0) {
        var avail = Object.keys(M.OIL_LABELS).filter(function (k) { return isFinite(parseFloat(res.prices[k])); });
        if (c) c.prices = res.prices;
        setSource('已连接，但「' + (M.OIL_LABELS[key] || key) + '」在该地区暂无报价', 'error');
        var txt = M.$('#price-alert-text');
        if (txt) txt.textContent = '该地区没有此油品报价，可切换为：' + avail.map(function (k) { return M.OIL_LABELS[k]; }).join(' / ') + '，或改用手动输入油价。';
        if (!priceValue()) enableManual(true);
        return false;
      }
      var old = c && c.prices ? parseFloat(c.prices[key]) : NaN;
      M.store.data.priceCache = { province:province, prices:res.prices, date:res.date, zone:res.zone, ts:Date.now() };
      M.store.save(['priceCache']);
      var foot = province + ' · ' + (M.OIL_LABELS[key] || key) + (res.date ? ' · 调价 ' + res.date : '');
      setSource('数据来源：公开油价接口 · ' + province + (res.zone ? ' / ' + res.zone : '') + (res.date ? ' · 调价 ' + res.date : '') + ' · 更新于 ' + M.clockText(), 'live');
      if (!settings().manualPrice) applyPrice(p, { foot:foot, announce:opts.announce && isFinite(old) && Math.abs(old - p) > 0.0001 });
      return true;
    }).catch(function (e) {
      fetching = false; if (btn) btn.disabled = false;
      var c = cacheFor(settings().province);
      var p = c && c.prices ? parseFloat(c.prices[settings().oil]) : NaN;
      if (isFinite(p) && p > 0) {
        setSource('接口暂不可用（' + (e.message || '网络异常') + '），使用 ' + M.fmtDate(c.ts) + ' 的缓存价', 'cache');
        if (!settings().manualPrice) applyPrice(p, { foot:settings().province + ' · 缓存价' });
      } else {
        setSource('接口请求失败：' + (e.message || '网络异常'), 'error');
        applyPrice(null, { foot:'油价待获取' });
        enableManual(true);
      }
      return false;
    });
  }
  function useCacheOrFetch(opts) {
    var c = cacheFor(settings().province);
    var p = c && c.prices ? parseFloat(c.prices[settings().oil]) : NaN;
    if (isFinite(p) && p > 0 && !settings().manualPrice) {
      applyPrice(p, { foot:settings().province + ' · ' + (c.date ? '调价 ' + c.date : '缓存价') });
      setSource('已读取本机缓存 · ' + M.fmtDate(c.ts) + ' 更新，正在后台核对最新价…', 'live');
      fetchPrice({ force:true, announce:true });
      return;
    }
    fetchPrice({ force:!!(opts && opts.force), announce:!!(opts && opts.announce) });
  }
  function enableManual(on) {
    settings().manualPrice = on;
    settings().manualPriceValue = on ? (els.price.value || '') : '';
    M.store.save(['settings']);
    els.price.disabled = !on;
    M.$('#manual-toggle').textContent = on ? '← 返回自动获取' : '手动输入油价 →';
    var hp = M.$('#hint-price'); if (hp) hp.textContent = on ? '手动填写每升油价，计算会立即更新' : '由联网接口自动填入，油价变动时自动刷新';
    var ab = M.$('#auto-badge');
    if (ab) { ab.textContent = on ? '手动输入' : '自动获取'; ab.classList.toggle('is-manual', on); }
    if (on) {
      var p = priceValue();
      els.live.textContent = p ? p.toFixed(2) : '--.--';
      setSource('手动输入模式 · 自动刷新已暂停', 'manual');
      els.price.focus();
    } else {
      useCacheOrFetch({ force:true, announce:false });
    }
    calculate();
  }

  /* ============================ 油耗测算 ============================ */
  function setOut(id, val, empty) {
    var n = M.$('#' + id);
    if (!n) return;
    n.textContent = val;
    if (id === 'out-consumption' || id === 'out-perkm') n.classList.toggle('is-empty', !!empty);
  }
  function setJudge(text, cls) {
    var n = M.$('#out-judge');
    if (!n) return;
    n.textContent = text; n.className = 'result-judge ' + (cls || '');
  }
  function calculate() {
    if (!els.distance || !els.fuel) return;
    var d = num('distance'), f = num('fuel'), p = priceValue();
    var msg = '', ok = d > 0 && f > 0 && p > 0;
    if (!ok) {
      if (d != null && d <= 0) msg = '里程需大于 0 km';
      else if (f != null && f <= 0) msg = '油耗量需大于 0 L';
      else if (!p) msg = settings().manualPrice ? '请填写有效的油价' : '等待实时油价，或切换为手动输入';
      else msg = '请填写里程与油耗量后查看结果';
    } else if (f / d * 100 > 40) {
      msg = '数值看起来不太合理，请确认里程(km)与油耗(L)的单位';
    }
    var emptyBox = M.$('#result-empty');
    if (emptyBox) emptyBox.hidden = ok;
    var emptyText = M.$('#result-empty-text'); if (emptyText) emptyText.textContent = msg;

    var hd = M.$('#hint-distance');
    if (hd) { hd.textContent = (d != null && d <= 0) ? '里程必须大于 0' : '上次加满油到这次加满油之间跑的公里数'; hd.classList.toggle('is-error', d != null && d <= 0); }
    var hf = M.$('#hint-fuel');
    if (hf) { hf.textContent = (f != null && f <= 0) ? '油耗量必须大于 0' : '本次加进油箱的升数'; hf.classList.toggle('is-error', f != null && f <= 0); }

    if (!ok) {
      current = null; syncSaveBtn();
      setOut('out-consumption', '--.-', true); setOut('out-perkm', '-.--', true);
      setOut('out-total', '¥ --.--'); setOut('out-kmpl', '--.- km'); setOut('out-100cost', '¥ --.--');
      setOut('out-distance', d > 0 ? d + ' km' : '-- km');
      var gf = M.$('#gauge-fill'); if (gf) gf.setAttribute('d', 'M0 11 H0');
      var cb = M.$('#cost-bar-fill'); if (cb) cb.style.width = '0%';
      setJudge('等待输入数据…', '');
      var cn = M.$('#out-cost-note'); if (cn) cn.textContent = '按当前实时油价计算';
      return;
    }

    var cons = f / d * 100, perkm = f * p / d, total = f * p;
    current = { distance:d, fuel:f, price:p, consumption:cons, perKm:perkm, total:total, at:selectedTs(), backfilled:isBackfill() };
    syncSaveBtn();
    setOut('out-consumption', cons.toFixed(2), false);
    setOut('out-perkm', perkm.toFixed(3), false);
    setOut('out-total', '¥ ' + total.toFixed(2));
    setOut('out-kmpl', (d / f).toFixed(2) + ' km');
    setOut('out-100cost', '¥ ' + (cons * p).toFixed(2));
    setOut('out-distance', d + ' km');
    var gfill = M.$('#gauge-fill'); if (gfill) gfill.setAttribute('d', 'M0 11 H' + Math.min(cons / 9, 1) * 200);
    var cbfill = M.$('#cost-bar-fill'); if (cbfill) cbfill.style.width = (Math.min(perkm / 1.2, 1) * 100).toFixed(1) + '%';
    setJudge(cons < 3 ? '低于 3L/100km，相当省油' : cons <= 6 ? '处于常见机车油耗区间（3–6L）' : '油耗偏高，检查胎压与驾驶习惯', cons < 3 ? 'is-good' : cons > 6 ? 'is-high' : '');
    var note = M.$('#out-cost-note'); if (note) note.textContent = '按 ¥' + p.toFixed(2) + '/L · ' + (settings().manualPrice ? '手动价' : '实时价') + ' 计算';
  }
  function syncSaveBtn() {
    var b = M.$('#fuel-save-log');
    if (b) b.disabled = !current;
  }
  function saveLog() {
    if (!current) { M.toast('请先填写有效的里程与油耗', 'warn'); return; }
    var logs = M.store.data.fuelLogs || (M.store.data.fuelLogs = []);
    logs.push({
      id:M.uid(), distance:current.distance, fuel:current.fuel,
      price:current.price, consumption:current.consumption,
      perKm:current.perKm, total:current.total, at:current.at,
      backfilled:!!current.backfilled,
      province:settings().province, oil:settings().oil
    });
    logs.sort(byAt);
    if (logs.length > 500) logs.splice(0, logs.length - 500);
    M.store.save(['fuelLogs']);
    var when = current.backfilled ? localDateStr(current.at) + '（补录）' : '今天';
    M.toast('已记入 ' + when + ' 的加油日志，骑行数据已更新', 'ok', 3200);
  }
  function deleteLog(id) {
    var logs = M.store.data.fuelLogs || [];
    var rec = logs.filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    var day = localDateStr(rec.at);
    M.confirm('删除加油记录', '确定删除 ' + day + ' 的这条记录吗？删除后总 / 日 / 月骑行数据会立即重算，此操作不可撤销。', function () {
      M.store.data.fuelLogs = logs.filter(function (r) { return r.id !== id; });
      M.store.save(['fuelLogs']);
      M.toast('记录已删除，统计已重算', 'ok', 2400);
    }, '确认删除');
  }

  /* ============================ 统一聚合（唯一统计口径） ============================ */
  function rangeLabel(r) {
    return { '30':'近 30 天', '90':'近 90 天', '365':'近 1 年', 'all':'全部时间' }[r] || '全部时间';
  }
  function inRange(logs) {
    if (activeRange === 'all') return logs;
    var cutoff = Date.now() - parseInt(activeRange, 10) * 86400000;
    return logs.filter(function (r) { return (r.at || 0) >= cutoff; });
  }
  // 所有统计视图共用此换算：油耗 = 油量 / 里程 × 100；每公里成本 = 费用 / 里程
  function makeScope(km, fuel, cost, label) {
    km = Number(km) || 0; fuel = Number(fuel) || 0; cost = Number(cost) || 0;
    return {
      km:km, fuel:fuel, cost:cost,
      cons:km > 0 ? fuel / km * 100 : 0,
      perKm:km > 0 ? cost / km : 0,
      scopeLabel:label
    };
  }
  function aggregate() {
    var d = M.store.data;
    var allLogs = (d.fuelLogs || []).slice().sort(byAt);
    var logs = inRange(allLogs);
    var totalKm = 0, totalL = 0, totalCost = 0;
    var byDay = {}, byMonth = {}, dayFuel = {}, dayCost = {};

    logs.forEach(function (r) {
      var km = Number(r.distance) || 0, L = Number(r.fuel) || 0, cost = Number(r.total) || 0;
      var dk = dayKey(r.at), mk = monthKey(r.at);
      totalKm += km; totalL += L; totalCost += cost;
      byDay[dk] = (byDay[dk] || 0) + km;
      dayFuel[dk] = (dayFuel[dk] || 0) + L;
      dayCost[dk] = (dayCost[dk] || 0) + cost;
      if (!byMonth[mk]) byMonth[mk] = { km:0, fuel:0, cost:0, n:0 };
      byMonth[mk].km += km; byMonth[mk].fuel += L; byMonth[mk].cost += cost; byMonth[mk].n++;
    });

    var days = Object.keys(byDay).sort();
    var allMonths = Object.keys(byMonth).sort();
    var months = allMonths.slice(-12);
    var lastDay = days.length ? days[days.length - 1] : null;
    var lastMonth = allMonths.length ? allMonths[allMonths.length - 1] : null;

    // 三类统计视图：同一数据源、同一换算公式，仅统计范围不同
    var scopes = {
      total: makeScope(totalKm, totalL, totalCost, rangeLabel(activeRange) + ' · ' + logs.length + ' 条记录'),
      day: makeScope(lastDay ? byDay[lastDay] : 0, lastDay ? dayFuel[lastDay] : 0, lastDay ? dayCost[lastDay] : 0,
        lastDay ? lastDay + ' 当日' : '暂无记录'),
      month: makeScope(lastMonth ? byMonth[lastMonth].km : 0, lastMonth ? byMonth[lastMonth].fuel : 0, lastMonth ? byMonth[lastMonth].cost : 0,
        lastMonth ? lastMonth + ' 当月' : '暂无记录')
    };

    // 逐月累计序列（供累计里程 / 累计油量趋势图）
    var cumL = 0, cumKm = 0;
    var cum = months.map(function (m) {
      cumL += byMonth[m].fuel; cumKm += byMonth[m].km;
      return { m:m, value:cumL, cumKm:cumKm };
    });

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

    // 天气参考：仅当缓存城市与当前设置一致时显示
    var wx = d.weatherCache;
    var wxValid = wx && wx.payload && wx.place && wx.place.name === (d.settings.weatherCity || '');
    var weather = null;
    if (wxValid) {
      var cur = wx.payload.current || {};
      weather = { code:cur.weather_code, temp:cur.temperature_2m, city:wx.place.name, ts:wx.ts };
    }

    return {
      logs:logs, allCount:allLogs.length, range:activeRange,
      totalKm:totalKm, totalL:totalL, totalCost:totalCost,
      avgCons:scopes.total.cons, avgCostKm:scopes.total.perKm,
      rideDays:days.length, streak:streak, scopes:scopes,
      days:days, byDay:byDay, dayFuel:dayFuel, dayCost:dayCost,
      months:months, allMonths:allMonths, byMonth:byMonth, cum:cum,
      weather:weather,
      routes:(d.routes || []).length, notes:(d.notes || []).length,
      firstAt:logs.length ? logs[0].at : 0, lastAt:logs.length ? logs[logs.length - 1].at : 0
    };
  }
  function summarize() {
    var a = aggregate();
    var t = a.scopes.total;
    return { n:a.logs.length, km:t.km, L:t.fuel, cost:t.cost, cons:t.cons, perKm:t.perKm };
  }

  /* ============================ 坐标轴：按数据自适应 ============================ */
  function niceStep(rough) {
    if (!(rough > 0)) return 1;
    var exp = Math.floor(Math.log(rough) / Math.LN10), mag = Math.pow(10, exp), f = rough / mag;
    var nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nice * mag;
  }
  function lineBounds(values, minPadRatio) {
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    var span = hi - lo;
    var pad = span > 1e-9 ? span * (minPadRatio == null ? 0.18 : minPadRatio) : Math.max(Math.abs(hi) * 0.12, 0.3);
    var top = hi + pad, bottom = Math.max(0, lo - pad);
    var step = niceStep((top - bottom) / 3);
    bottom = Math.floor(bottom / step) * step;
    top = Math.ceil(top / step) * step;
    if (top <= bottom) top = bottom + step;
    return { lo:bottom, hi:top, step:step };
  }
  var NICE_FINE = [1, 1.1, 1.2, 1.4, 1.5, 1.75, 2, 2.25, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9, 10];
  function barCeil(max) {
    if (!(max > 0)) return 10;
    var v = max * 1.02;
    var exp = Math.floor(Math.log(v) / Math.LN10), mag = Math.pow(10, exp), f = v / mag;
    for (var i = 0; i < NICE_FINE.length; i++) if (NICE_FINE[i] + 1e-9 >= f) return NICE_FINE[i] * mag;
    return 10 * mag;
  }
  function tickDigits(step) { return step >= 1 ? 0 : step >= 0.1 ? 1 : 2; }
  function emptyChart(msg) {
    return '<div class="fb-chart-empty"><svg class="icon"><use href="#i-gauge"/></svg><span>' + M.esc(msg) + '</span></div>';
  }
  function lineChart(data, opt) {
    if (data.length < 2) return emptyChart(opt.atLeast || '至少记录 2 项后显示趋势');
    var W = 620, H = 180, padL = 44, padR = 14, padT = 16, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    var vals = data.map(function (p) { return p.value; });
    var b = lineBounds(vals, opt.pad), span = b.hi - b.lo;
    var pts = vals.map(function (v, i) {
      return [padL + (data.length === 1 ? iw / 2 : i * iw / (data.length - 1)), padT + ih - ((v - b.lo) / span) * ih];
    });
    var poly = pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    var area = 'M' + pts[0][0].toFixed(1) + ',' + (padT + ih) + ' L' + poly.replace(/ /g, ' L') + ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + (padT + ih) + ' Z';
    var grid = '', dg = tickDigits(b.step);
    [0, 0.5, 1].forEach(function (t) {
      var y = padT + ih * t, v = b.hi - span * t;
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="var(--line-soft)" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="fb-axis">' + v.toFixed(dg) + '</text>';
    });
    var dots = pts.map(function (p, i) {
      return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5" fill="var(--bg)" stroke="var(--accent)" stroke-width="2"><title>' +
        M.esc(data[i].label) + ' · ' + fmt(vals[i], dg) + (opt.unit ? ' ' + opt.unit : '') + '</title></circle>';
    }).join('');
    var labels = data.map(function (p, i) {
      if (data.length > 8 && i % 2 === 1) return '';
      return '<text x="' + pts[i][0].toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="fb-axis">' + M.esc(p.axis || p.label) + '</text>';
    }).join('');
    return '<svg class="fb-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + M.esc(opt.aria || '趋势图') + '">' +
      grid + '<path d="' + area + '" fill="var(--accent-soft, rgba(255,74,28,.10))" stroke="none"/>' +
      '<polyline points="' + poly + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + labels + '</svg>';
  }
  function barChart(data, opt) {
    if (!data.length) return emptyChart(opt.empty || '记录后显示图表');
    var W = 620, H = 180, padL = 44, padR = 14, padT = 16, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    var max = Math.max.apply(null, data.map(function (x) { return x.value; }));
    var hi = barCeil(max), bw = Math.min(46, iw / data.length * 0.62), dg = tickDigits(niceStep(hi / 3));
    var bars = data.map(function (x, i) {
      var cx = padL + (i + 0.5) * iw / data.length;
      var h = (x.value / hi) * ih, y = padT + ih - h;
      return '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(h, 1).toFixed(1) + '" fill="var(--accent)" opacity=".85" rx="2"><title>' + M.esc(x.label) + ' · ' + fmt(x.value, dg) + (opt.unit ? ' ' + opt.unit : '') + '</title></rect>' +
        '<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="fb-axis">' + M.esc(x.axis || x.label) + '</text>' +
        (x.value > 0 ? '<text x="' + cx.toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle" class="fb-bar-val">' + fmt(x.value, dg) + '</text>' : '');
    }).join('');
    var grid = '';
    [0, 0.5, 1].forEach(function (t) {
      var y = padT + ih * t, v = hi - hi * t;
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="var(--line-soft)" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="fb-axis">' + v.toFixed(dg) + '</text>';
    });
    return '<svg class="fb-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + M.esc(opt.aria || '柱状图') + '">' + grid + bars + '</svg>';
  }

  /* ============================ 图表适配 ============================ */
  function consumptionChart(a) {
    var data = a.logs.slice(-14).map(function (r) {
      var dt = new Date(r.at);
      return { label:dayKey(r.at), axis:(dt.getMonth() + 1) + '/' + dt.getDate(), value:Number(r.consumption) || 0 };
    }).filter(function (p) { return p.value > 0; });
    return lineChart(data, { unit:'L/100km', aria:'百公里油耗趋势图', atLeast:'至少记录 2 次后显示趋势' });
  }
  function mileageChart(a) {
    return barChart(a.months.map(function (m) { return { label:m, axis:m.slice(2), value:a.byMonth[m].km }; }),
      { unit:'km', aria:'月度里程柱状图', empty:'记录后显示月度里程' });
  }
  function dailyKmChart(a) {
    // 新增：每日里程图，按真实骑行日聚合，纵轴动态贴合数据
    return barChart(a.days.slice(-14).map(function (k) { return { label:k, axis:k.slice(5), value:a.byDay[k] }; }),
      { unit:'km', aria:'每日里程柱状图', empty:'记录后显示每日里程' });
  }
  function cumulativeKmChart(a) {
    return lineChart(a.cum.map(function (x) { return { label:x.m, axis:x.m.slice(2), value:x.cumKm }; }),
      { unit:'km', aria:'累计里程趋势图', atLeast:'记录满 2 个月后显示累计里程趋势' });
  }
  function dailyConsChart(a) {
    var data = a.days.map(function (k) {
      return { label:k, axis:k.slice(5), value:a.byDay[k] > 0 ? (a.dayFuel[k] || 0) / a.byDay[k] * 100 : 0 };
    }).filter(function (p) { return p.value > 0; }).slice(-14);
    return lineChart(data, { unit:'L/100km', aria:'每日油耗趋势图', atLeast:'记录满 2 天后显示每日油耗趋势' });
  }
  function monthlyFuelChart(a) {
    return lineChart(a.cum.map(function (x) { return { label:x.m, axis:x.m.slice(2), value:x.value }; }),
      { unit:'L', aria:'月累计油量趋势图', atLeast:'记录满 2 个月后显示月累计油量趋势' });
  }

  /* ============================ 统计卡（总 / 日 / 月切换） ============================ */
  function renderStatCard(a) {
    var s = a.scopes[activeStatTab] || a.scopes.total;
    var items = [
      { label:'累计里程', val:fmt(s.km, 0), unit:'km', foot:s.scopeLabel },
      { label:'累计油量', val:fmt(s.fuel, 2), unit:'L', foot:s.scopeLabel },
      { label:'累计油费', val:money(s.cost), unit:'', foot:s.scopeLabel },
      { label:'平均油耗', val:s.cons ? fmt(s.cons, 2) : '—', unit:s.cons ? 'L/100km' : '', foot:'油量 ÷ 里程 × 100' },
      { label:'每公里成本', val:s.perKm ? fmt(s.perKm, 3) : '—', unit:s.perKm ? '¥/km' : '', foot:'油费 ÷ 里程' }
    ];
    var box = M.$('#fb-total');
    if (box) box.innerHTML = items.map(function (k) {
      return '<div class="fb-total-item"><span class="fb-total-label">' + M.esc(k.label) + '</span>' +
        '<span class="fb-total-val">' + M.esc(k.val) + (k.unit ? '<small>' + M.esc(k.unit) + '</small>' : '') + '</span>' +
        '<span class="fb-total-foot">' + M.esc(k.foot) + '</span></div>';
    }).join('');

    var tabs = M.$('#fb-stat-tabs');
    if (tabs) {
      Array.prototype.forEach.call(tabs.querySelectorAll('.fb-tab'), function (btn) {
        var on = btn.getAttribute('data-tab') === activeStatTab;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    var code = M.$('#fb-stat-code');
    if (code) code.textContent = (STAT_LABELS[activeStatTab] || STAT_LABELS.total) + ' / ' + a.logs.length + ' REC';

    var chart = M.$('#fb-chart-stat');
    if (chart) chart.innerHTML = activeStatTab === 'day' ? dailyConsChart(a)
      : activeStatTab === 'month' ? monthlyFuelChart(a) : cumulativeKmChart(a);
  }

  /* ============================ 记录明细 ============================ */
  function renderHistory(a) {
    var box = M.$('#fb-history');
    if (!box) return;
    var logs = a.logs.slice().sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
    var count = M.$('#fb-history-count');
    if (count) count.textContent = logs.length + ' 条记录';
    var head = '<div class="fbh-head"><strong>加油记录</strong><span>' + rangeLabel(a.range) + ' · 共 ' + logs.length + ' 条 · 删除后统计实时重算</span></div>';
    if (!logs.length) {
      box.innerHTML = head + '<div class="fbh-empty">当前范围暂无记录。填入里程与油量并点「记一笔」，或切换到「全部」时间范围。</div>';
      return;
    }
    var rows = logs.slice(0, 30).map(function (r) {
      var d = new Date(r.at || Date.now());
      var day = d.getFullYear() + '-' + M.pad2(d.getMonth() + 1) + '-' + M.pad2(d.getDate());
      return '<div class="fbh-row" data-id="' + M.esc(r.id) + '">' +
        '<span class="fbh-date">' + day + '</span>' +
        (r.backfilled ? '<span class="fbh-backfill">补录</span>' : '') +
        '<span class="fbh-data"><span>里程 <b>' + fmtNum(r.distance, 0) + ' km</b></span>' +
        '<span>油量 <b>' + fmtNum(r.fuel, 2) + ' L</b></span>' +
        '<span>油耗 <b>' + fmtNum(r.consumption, 2) + '</b></span>' +
        '<span>油费 <b>¥' + fmtNum(r.total, 2) + '</b></span></span>' +
        '<button class="fbh-del" type="button" data-del="' + M.esc(r.id) + '" aria-label="删除这条记录" title="删除这条记录">' + M.icon('trash') + '</button></div>';
    }).join('');
    if (logs.length > 30) rows += '<div class="fbh-empty">仅显示最近 30 条，共 ' + logs.length + ' 条记录。</div>';
    box.innerHTML = head + '<div class="fbh-list">' + rows + '</div>';
  }

  /* ============================ 总渲染 ============================ */
  function render() {
    if (!el) return;
    var a = aggregate();

    var rangeBox = M.$('#fb-range');
    if (rangeBox) {
      Array.prototype.forEach.call(rangeBox.querySelectorAll('.fb-range-btn'), function (btn) {
        var on = btn.getAttribute('data-range') === activeRange;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    var info = M.$('#fb-range-info');
    if (info) info.textContent = rangeLabel(activeRange) + ' · ' + a.logs.length + ' 条记录' +
      (activeRange !== 'all' && a.allCount > a.logs.length ? '（共 ' + a.allCount + ' 条）' : '');

    renderStatCard(a);
    var cons = M.$('#fb-chart-cons'); if (cons) cons.innerHTML = consumptionChart(a);
    var km = M.$('#fb-chart-km'); if (km) km.innerHTML = mileageChart(a);
    var dkm = M.$('#fb-chart-daily-km'); if (dkm) dkm.innerHTML = dailyKmChart(a);
    renderHistory(a);

    var side = [
      { label:'骑行天数', val:a.rideDays, unit:'天' },
      { label:'连续骑行', val:a.streak, unit:'天' },
      { label:'常用路线', val:a.routes, unit:'条' },
      { label:'骑行笔记', val:a.notes, unit:'篇' }
    ];
    var sideBox = M.$('#fb-side');
    if (sideBox) sideBox.innerHTML = side.map(function (s) {
      return '<div class="fb-side-item"><strong>' + s.val + '</strong><span>' + M.esc(s.unit) + '</span><em>' + M.esc(s.label) + '</em></div>';
    }).join('');

    var wxBox = M.$('#fb-weather');
    if (wxBox) {
      if (a.weather) {
        var advice = M.weather && M.weather.state ? M.weather.state.advice : null;
        wxBox.innerHTML = '<div class="fb-wx-row"><span class="fb-wx-temp">' + fmt(a.weather.temp, 0) + '°</span>' +
          '<div><strong>' + M.esc(a.weather.city) + ' · 骑行参考</strong><span>' + (advice ? M.esc(advice.label) : '当前天气') + ' · 数据来自最近一次天气缓存</span></div></div>' +
          '<p class="fb-wx-note">天气为当日概况，仅作骑行参考；出发前请查看「出行准备」中的实时天气。</p>';
      } else {
        wxBox.innerHTML = '<div class="fb-wx-empty"><svg class="icon"><use href="#i-cloud"/></svg><span>暂无天气数据，打开「出行准备」获取一次后即可在此显示。</span></div>';
      }
    }
    var banner = M.$('#fb-empty-banner');
    if (banner) banner.hidden = a.logs.length > 0 || a.allCount > 0;
  }
  function refreshStats() { render(); }

  function onRangeClick(ev) {
    var btn = ev.target.closest ? ev.target.closest('.fb-range-btn') : null;
    if (!btn) return;
    var next = btn.getAttribute('data-range');
    if (!next || next === activeRange) return;
    activeRange = next; render();
  }
  function onStatTabClick(ev) {
    var btn = ev.target.closest ? ev.target.closest('.fb-tab') : null;
    if (!btn) return;
    var next = btn.getAttribute('data-tab');
    if (!next || next === activeStatTab) return;
    activeStatTab = next; render();
  }

  /* ============================ 初始化 ============================ */
  function buildSelectors() {
    els.province.innerHTML = M.PROVINCES.map(function (p) {
      return '<option value="' + p + '"' + (p === settings().province ? ' selected' : '') + '>' + p + '</option>';
    }).join('');
    els.oil.value = settings().oil;
  }
  function syncFormFromStore() {
    var draft = M.store.data.fuelDraft || {};
    if (els.distance) els.distance.value = draft.distance || '';
    if (els.fuel) els.fuel.value = draft.fuel || '';
    if (els.date) {
      els.date.max = localDateStr();
      els.date.value = draft.date || localDateStr();
      if (els.date.value > els.date.max) els.date.value = els.date.max;
      syncDateBadge();
    }
    if (settings().manualPrice) {
      els.price.disabled = false; els.price.value = settings().manualPriceValue || '';
      var mt = M.$('#manual-toggle'); if (mt) mt.textContent = '← 返回自动获取';
      setSource('手动输入模式 · 自动刷新已暂停', 'manual');
      els.live.textContent = priceValue() ? priceValue().toFixed(2) : '--.--';
    } else {
      els.price.disabled = true;
      useCacheOrFetch({ force:false });
    }
    calculate();
  }
  function persistDraft() {
    M.store.data.fuelDraft = { distance:els.distance.value, fuel:els.fuel.value, date:els.date ? els.date.value : '' };
    M.store.save(['fuelDraft']);
  }

  function init() {
    el = M.$('#view-fuel');
    if (!el) return;
    els = {
      distance:M.$('#in-distance'), fuel:M.$('#in-fuel'), price:M.$('#in-price'),
      province:M.$('#province-sel'), oil:M.$('#oil-sel'),
      live:M.$('#live-price'), liveOilLabel:M.$('#live-oil-label'),
      source:M.$('#price-source'), led:M.$('#price-led'), date:M.$('#in-date')
    };
    if (!els.distance || !els.price) return;
    buildSelectors();
    syncFormFromStore();

    if (els.date) els.date.addEventListener('change', function () {
      if (els.date.value > els.date.max) els.date.value = els.date.max;
      if (!els.date.value) els.date.value = localDateStr();
      syncDateBadge(); calculate();
    });
    [els.distance, els.fuel].forEach(function (n) {
      n.addEventListener('input', function () { persistDraft(); calculate(); });
    });
    els.price.addEventListener('input', function () {
      if (settings().manualPrice) {
        settings().manualPriceValue = els.price.value;
        M.store.save(['settings']);
        var p = priceValue();
        els.live.textContent = p ? p.toFixed(2) : '--.--';
        var sp = M.$('#stat-price'); if (sp) sp.textContent = p ? p.toFixed(2) : '--.--';
      }
      calculate();
    });
    els.province.addEventListener('change', function () {
      settings().province = els.province.value; M.store.save(['settings']);
      if (!settings().manualPrice) useCacheOrFetch({ force:true, announce:true });
    });
    els.oil.addEventListener('change', function () {
      settings().oil = els.oil.value; M.store.save(['settings']);
      els.liveOilLabel.textContent = M.OIL_LABELS[settings().oil] || '油价';
      if (settings().manualPrice) calculate(); else useCacheOrFetch({ force:false, announce:false });
    });
    var mt = M.$('#manual-toggle'); if (mt) mt.addEventListener('click', function () { enableManual(!settings().manualPrice); });
    var pr = M.$('#price-refresh'); if (pr) pr.addEventListener('click', function () {
      if (settings().manualPrice) { M.toast('当前是手动模式，请先返回自动获取', 'info'); return; }
      fetchPrice({ force:true, announce:true }).then(function (ok) { if (ok) M.toast('油价已刷新', 'ok', 1800); });
    });
    var reset = M.$('#fuel-reset'); if (reset) reset.addEventListener('click', function () {
      els.distance.value = ''; els.fuel.value = '';
      persistDraft(); calculate(); M.toast('已清空本次数据', 'info', 1600);
    });
    var saveBtn = M.$('#fuel-save-log'); if (saveBtn) saveBtn.addEventListener('click', saveLog);
    var focusBtn = M.$('#fb-focus-form'); if (focusBtn) focusBtn.addEventListener('click', function () {
      els.distance.scrollIntoView({ behavior:'smooth', block:'center' });
      setTimeout(function () { try { els.distance.focus(); } catch (e) {} }, 350);
    });
    var rangeBox = M.$('#fb-range'); if (rangeBox) rangeBox.addEventListener('click', onRangeClick);
    var statTabs = M.$('#fb-stat-tabs'); if (statTabs) statTabs.addEventListener('click', onStatTabClick);
    var hist = M.$('#fb-history'); if (hist) hist.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-del]') : null;
      if (b) deleteLog(b.getAttribute('data-del'));
    });

    M.on('store:change', function (ev) {
      if (!ev.parts) return;
      if (ev.parts.indexOf('fuelLogs') > -1 || ev.parts.indexOf('all') > -1) render();
    });
    M.on('cloud:pulled', function () {
      buildSelectors(); syncFormFromStore(); render();
    });
    M.on('route:change', function (key) { if (key === 'fuel') render(); });

    render(); syncSaveBtn();

    clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (!settings().manualPrice && !document.hidden) fetchPrice({ force:true, announce:true });
    }, M.CONFIG.oilRefreshMs);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !settings().manualPrice && Date.now() - lastFetchAt > 2 * 60 * 1000) fetchPrice({ force:true, announce:true });
    });
    window.addEventListener('online', function () {
      if (!settings().manualPrice) fetchPrice({ force:true, announce:true });
    });
  }

  M.fuelBoard = {
    init:init, render:render, aggregate:aggregate, refreshStats:refreshStats,
    summarize:summarize, saveLog:saveLog, deleteLog:deleteLog,
    localDateStr:localDateStr,
    refresh:function () { return fetchPrice({ force:true, announce:true }); }
  };
})(window.MOTO);
