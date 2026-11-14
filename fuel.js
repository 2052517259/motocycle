/* MOTO // GARAGE — fuel calculator + live oil price */
(function (M) {
  'use strict';

  var OIL_ENDPOINTS = [
    'https://cn.apihz.cn/api/jinrong/youjia.php?id=88888888&key=88888888&sheng=',
    'https://api.apihz.cn/api/jinrong/youjia.php?id=88888888&key=88888888&sheng='
  ];
  var els = {}, fetching = false, lastFetchAt = 0, pollTimer = null;

  function settings() { return M.store.data.settings; }
  function num(id) { var v = parseFloat(els[id].value); return isFinite(v) ? v : null; }
  function priceValue() { var v = parseFloat(els.price.value); return isFinite(v) && v > 0 ? v : null; }

  /* ---------- price fetching ---------- */
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
    M.$('#stat-price').textContent = p != null && isFinite(p) ? Number(p).toFixed(2) : '--.--';
    M.$('#stat-price-foot').textContent = (meta && meta.foot) || '实时油价';
    calculate();
    if (meta && meta.announce && isFinite(prev) && Math.abs(prev - p) > 0.0001) {
      M.toast('检测到油价变动，已自动更新为 ¥' + Number(p).toFixed(2) + '/L', 'ok', 4200);
    }
  }
  function setSource(text, kind) {
    els.source.textContent = text;
    els.led.className = 'led' + (kind === 'live' ? '' : kind === 'error' ? ' led--off' : ' led--amber');
    var badge = M.$('#auto-badge');
    badge.textContent = kind === 'manual' ? '手动输入' : kind === 'cache' ? '缓存价格' : kind === 'error' ? '接口异常' : '自动获取';
    badge.classList.toggle('is-manual', kind !== 'live');
    var alert = M.$('#price-alert');
    if (kind === 'live') { alert.hidden = true; }
    else {
      alert.hidden = false;
      alert.classList.toggle('is-error', kind === 'error');
      M.$('#price-alert-text').textContent =
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
        // 该油品在本地无报价：保留其它油品的价格表，但提示切换
        var avail = Object.keys(M.OIL_LABELS).filter(function (k) { return isFinite(parseFloat(res.prices[k])); });
        if (c) c.prices = res.prices;
        setSource('已连接，但「' + (M.OIL_LABELS[key] || key) + '」在该地区暂无报价', 'error');
        M.$('#price-alert-text').textContent = '该地区没有此油品报价，可切换为：' + avail.map(function (k) { return M.OIL_LABELS[k]; }).join(' / ') + '，或改用手动输入油价。';
        if (!priceValue()) enableManual(true);
        return false;
      }
      var old = c && c.prices ? parseFloat(c.prices[key]) : NaN;
      M.store.data.priceCache = { province: province, prices: res.prices, date: res.date, zone: res.zone, ts: Date.now() };
      M.store.save(['priceCache']);
      var foot = province + ' · ' + (M.OIL_LABELS[key] || key) + (res.date ? ' · 调价 ' + res.date : '');
      setSource('数据来源：公开油价接口 · ' + province + (res.zone ? ' / ' + res.zone : '') + (res.date ? ' · 调价 ' + res.date : '') + ' · 更新于 ' + M.clockText(), 'live');
      if (!settings().manualPrice) applyPrice(p, { foot: foot, announce: opts.announce && isFinite(old) && Math.abs(old - p) > 0.0001 });
      return true;
    }).catch(function (e) {
      fetching = false; if (btn) btn.disabled = false;
      var c = cacheFor(settings().province);
      var p = c && c.prices ? parseFloat(c.prices[settings().oil]) : NaN;
      if (isFinite(p) && p > 0) {
        setSource('接口暂不可用（' + (e.message || '网络异常') + '），使用 ' + M.fmtDate(c.ts) + ' 的缓存价', 'cache');
        if (!settings().manualPrice) applyPrice(p, { foot: settings().province + ' · 缓存价' });
      } else {
        setSource('接口请求失败：' + (e.message || '网络异常'), 'error');
        applyPrice(null, { foot: '油价待获取' });
        enableManual(true);
      }
      return false;
    });
  }

  function useCacheOrFetch(opts) {
    var c = cacheFor(settings().province);
    var p = c && c.prices ? parseFloat(c.prices[settings().oil]) : NaN;
    if (isFinite(p) && p > 0 && !settings().manualPrice) {
      applyPrice(p, { foot: settings().province + ' · ' + (c.date ? '调价 ' + c.date : '缓存价') });
      setSource('已读取本机缓存 · ' + M.fmtDate(c.ts) + ' 更新，正在后台核对最新价…', 'live');
      fetchPrice({ force: true, announce: true });
      return;
    }
    fetchPrice({ force: !!(opts && opts.force), announce: !!(opts && opts.announce) });
  }

  /* ---------- manual mode ---------- */
  function enableManual(on) {
    settings().manualPrice = on;
    settings().manualPriceValue = on ? (els.price.value || '') : '';
    M.store.save(['settings']);
    els.price.disabled = !on;
    M.$('#manual-toggle').textContent = on ? '← 返回自动获取' : '手动输入油价 →';
    M.$('#hint-price').textContent = on ? '手动填写每升油价，计算会立即更新' : '由联网接口自动填入，油价变动时自动刷新';
    M.$('#auto-badge').textContent = on ? '手动输入' : '自动获取';
    M.$('#auto-badge').classList.toggle('is-manual', on);
    if (on) {
      var p = priceValue();
      els.live.textContent = p ? p.toFixed(2) : '--.--';
      setSource('手动输入模式 · 自动刷新已暂停', 'manual');
      els.price.focus();
    } else {
      useCacheOrFetch({ force: true, announce: false });
    }
    calculate();
  }

  /* ---------- calculation ---------- */
  function setOut(id, val, empty) {
    var el = M.$('#' + id);
    el.textContent = val;
    if (id === 'out-consumption' || id === 'out-perkm') el.classList.toggle('is-empty', !!empty);
  }
  function calculate() {
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
    emptyBox.hidden = ok;
    M.$('#result-empty-text').textContent = msg;

    M.$('#hint-distance').textContent = (d != null && d <= 0) ? '里程必须大于 0' : '上次加满油到这次加满油之间跑的公里数';
    M.$('#hint-distance').classList.toggle('is-error', d != null && d <= 0);
    M.$('#hint-fuel').textContent = (f != null && f <= 0) ? '油耗量必须大于 0' : '本次加进油箱的升数';
    M.$('#hint-fuel').classList.toggle('is-error', f != null && f <= 0);

    if (!ok) {
      ['out-consumption','out-perkm'].forEach(function (id) { setOut(id, id === 'out-consumption' ? '--.-' : '-.--', true); });
      setOut('out-total', '¥ --.--'); setOut('out-kmpl', '--.- km'); setOut('out-100cost', '¥ --.--');
      setOut('out-distance', d > 0 ? d + ' km' : '-- km');
      M.$('#gauge-fill').setAttribute('d', 'M0 11 H0');
      M.$('#cost-bar-fill').style.width = '0%';
      setJudge('等待输入数据…', '');
      M.$('#out-cost-note').textContent = '按当前实时油价计算';
      return;
    }

    var cons = f / d * 100;
    var perkm = f * p / d;
    var total = f * p;
    setOut('out-consumption', cons.toFixed(2), false);
    setOut('out-perkm', perkm.toFixed(3), false);
    setOut('out-total', '¥ ' + total.toFixed(2));
    setOut('out-kmpl', (d / f).toFixed(2) + ' km');
    setOut('out-100cost', '¥ ' + (cons * p).toFixed(2));
    setOut('out-distance', d + ' km');
    M.$('#gauge-fill').setAttribute('d', 'M0 11 H' + Math.min(cons / 9, 1) * 200);
    M.$('#cost-bar-fill').style.width = (Math.min(perkm / 1.2, 1) * 100).toFixed(1) + '%';
    setJudge(cons < 3 ? '低于 3L/100km，相当省油' : cons <= 6 ? '处于常见机车油耗区间（3–6L）' : '油耗偏高，检查胎压与驾驶习惯', cons < 3 ? 'is-good' : cons > 6 ? 'is-high' : '');
    M.$('#out-cost-note').textContent = '按 ¥' + p.toFixed(2) + '/L · ' + (settings().manualPrice ? '手动价' : '实时价') + ' 计算';
  }
  function setJudge(text, cls) {
    var el = M.$('#out-judge');
    el.textContent = text; el.className = 'result-judge ' + (cls || '');
  }

  function persistDraft() {
    M.store.data.fuelDraft = { distance: els.distance.value, fuel: els.fuel.value };
    M.store.save(['fuelDraft']);
  }

  function buildSelectors() {
    els.province.innerHTML = M.PROVINCES.map(function (p) {
      return '<option value="' + p + '"' + (p === settings().province ? ' selected' : '') + '>' + p + '</option>';
    }).join('');
    els.oil.value = settings().oil;
  }

  function init() {
    els = {
      distance:M.$('#in-distance'), fuel:M.$('#in-fuel'), price:M.$('#in-price'),
      province:M.$('#province-sel'), oil:M.$('#oil-sel'),
      live:M.$('#live-price'), liveOilLabel:M.$('#live-oil-label'),
      source:M.$('#price-source'), led:M.$('#price-led')
    };
    buildSelectors();
    var draft = M.store.data.fuelDraft || {};
    els.distance.value = draft.distance || '';
    els.fuel.value = draft.fuel || '';

    [els.distance, els.fuel].forEach(function (el) {
      el.addEventListener('input', function () { persistDraft(); calculate(); });
    });
    els.price.addEventListener('input', function () {
      if (settings().manualPrice) {
        settings().manualPriceValue = els.price.value;
        M.store.save(['settings']);
        var p = priceValue();
        els.live.textContent = p ? p.toFixed(2) : '--.--';
        M.$('#stat-price').textContent = p ? p.toFixed(2) : '--.--';
      }
      calculate();
    });
    els.province.addEventListener('change', function () {
      settings().province = els.province.value; M.store.save(['settings']);
      if (!settings().manualPrice) useCacheOrFetch({ force: true, announce: true });
    });
    els.oil.addEventListener('change', function () {
      settings().oil = els.oil.value; M.store.save(['settings']);
      els.liveOilLabel.textContent = M.OIL_LABELS[settings().oil] || '油价';
      if (settings().manualPrice) calculate();
      else useCacheOrFetch({ force: false, announce: false });
    });
    M.$('#manual-toggle').addEventListener('click', function () { enableManual(!settings().manualPrice); });
    M.$('#price-refresh').addEventListener('click', function () {
      if (settings().manualPrice) { M.toast('当前是手动模式，请先返回自动获取', 'info'); return; }
      fetchPrice({ force: true, announce: true }).then(function (ok) { if (ok) M.toast('油价已刷新', 'ok', 1800); });
    });
    M.$('#fuel-reset').addEventListener('click', function () {
      els.distance.value = ''; els.fuel.value = '';
      persistDraft(); calculate(); M.toast('已清空本次数据', 'info', 1600);
    });

    if (settings().manualPrice) {
      els.price.disabled = false;
      els.price.value = settings().manualPriceValue || '';
      M.$('#manual-toggle').textContent = '← 返回自动获取';
      setSource('手动输入模式 · 自动刷新已暂停', 'manual');
      els.live.textContent = priceValue() ? priceValue().toFixed(2) : '--.--';
    } else {
      els.price.disabled = true;
      useCacheOrFetch({ force: false, announce: false });
    }
    calculate();

    // 油价变动时自动刷新：定时轮询 + 回到页面 + 恢复联网
    clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (!settings().manualPrice && !document.hidden) fetchPrice({ force: true, announce: true });
    }, M.CONFIG.oilRefreshMs);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !settings().manualPrice && Date.now() - lastFetchAt > 2 * 60 * 1000) fetchPrice({ force: true, announce: true });
    });
    window.addEventListener('online', function () {
      if (!settings().manualPrice) fetchPrice({ force: true, announce: true });
    });
    M.on('cloud:pulled', function () {
      buildSelectors();
      els.distance.value = (M.store.data.fuelDraft || {}).distance || '';
      els.fuel.value = (M.store.data.fuelDraft || {}).fuel || '';
      if (settings().manualPrice) { els.price.disabled = false; els.price.value = settings().manualPriceValue || ''; }
      else { els.price.disabled = true; useCacheOrFetch({ force: false }); }
      calculate();
    });
  }

  M.fuel = { init: init, refresh: function () { return fetchPrice({ force: true, announce: true }); } };
})(window.MOTO);
