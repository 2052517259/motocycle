/* MOTO // GARAGE — home wallpaper carousel
   外部图床按批（轮）动态获取照片；一轮内不重复、跨轮首张不与上轮末张重复；
   本轮全部展示后再取新一批；双图层交叉淡入；图片失败保留当前画面并自动重试，不阻塞切换。 */
(function (M) {
  'use strict';

  var C = M.CONFIG;
  var INTERVAL = C.wallpaperIntervalMs;
  var layerA, layerB, frontIsA = true;
  var batch = [], deck = [], history = [], shown = 0, round = 0, lastId = null;
  var supply = []; // 全局不重复供给队列：由整个图池洗牌而来，用尽后才重组
  var running = true, elapsed = 0, lastTs = 0, showToken = 0;
  var bootRetry = null;

  /* 从供给队列取一批：全局尽量不重复，只有整池用尽才重新洗牌 */
  function refillSupply() {
    supply = shuffle(C.photoPool);
    // 若上一张仍在池内，把它排到队尾，避免新一轮开头就与上一轮末张重复
    if (lastId) {
      var idx = supply.map(function (e) { return e.t + ':' + e.id; }).indexOf(lastId);
      if (idx > -1) supply.push(supply.splice(idx, 1)[0]);
    }
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function urlsOf(e) {
    var crop = C.photoCrops[Math.floor(Math.random() * C.photoCrops.length)];
    if (e.t === 'us') {
      var ub = 'https://images.unsplash.com/photo-' + e.id + '?fm=jpg&fit=crop&crop=' + crop;
      return { low: ub + '&w=480&q=45', hi: ub + '&w=1600&q=80' };
    }
    var pb = 'https://images.pexels.com/photos/' + e.id + '/pexels-photo-' + e.id + '.jpeg?auto=compress&cs=tinysrgb';
    return { low: pb + '&w=480&h=270', hi: pb + '&w=1600&h=900' };
  }

  function makePhoto(e) {
    var u = urlsOf(e);
    return { id: e.t + ':' + e.id, url: u.hi, lowUrl: u.low, source: e.t === 'us' ? 'Unsplash' : 'Pexels' };
  }

  /* 取新一批：优先从未用过的供给队列抽，耗尽后整池重组，显著降低重复 */
  function fetchBatch() {
    if (!C.photoPool.length) return Promise.resolve(null);
    if (!supply.length) refillSupply();
    var picks = supply.splice(0, Math.min(C.photoBatchSize, supply.length));
    return Promise.resolve(picks.map(makePhoto));
  }

  function preload(url, ms) {
    return new Promise(function (resolve) {
      var img = new Image();
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(false); } }, ms || C.photoLoadMs);
      img.onload = function () { if (!done) { done = true; clearTimeout(timer); resolve(true); } };
      img.onerror = function () { if (!done) { done = true; clearTimeout(timer); resolve(false); } };
      img.src = url;
    });
  }

  function fallbackGradient() {
    return 'linear-gradient(135deg,#1b2027,#0c0e11 60%,rgba(255,74,28,.35))';
  }

  function activeLayer() { return frontIsA ? layerA : layerB; }
  function hiddenLayer() { return frontIsA ? layerB : layerA; }

  function applyPhoto(p, url) {
    var back = hiddenLayer();
    back.style.backgroundImage = 'url("' + (url || p.url) + '")';
    void back.offsetWidth; // 强制回流以确保交叉淡入
    back.classList.add('is-live');
    activeLayer().classList.remove('is-live');
    frontIsA = !frontIsA;
    renderMeta();
  }

  /* 渐进加载：低清占位先上屏，高清在后台加载完成后无感替换当前显示层 */
  function upgradeHi(p, token) {
    if (!p.lowUrl || p.lowUrl === p.url) return;
    preload(p.url, C.photoLoadMs).then(function (ok) {
      if (!ok || token !== showToken) return; // 已切到别的图则放弃，避免闪回
      var live = activeLayer();
      if (live) live.style.backgroundImage = 'url("' + p.url + '")';
    });
  }

  function setStatus(text) {
    var el = M.$('#wp-caption');
    if (el) el.textContent = text;
  }

  function renderMeta() {
    M.$('#wp-index').textContent = M.pad2(Math.min(shown, batch.length || C.photoBatchSize));
    var total = M.$('.wp-total');
    if (total) total.textContent = '/ ' + M.pad2(batch.length || C.photoBatchSize);
    renderDots();
  }

  function renderDots() {
    var box = M.$('#wp-dots');
    if (!box) return;
    box.innerHTML = (batch.length ? batch : new Array(C.photoBatchSize)).map(function (_, i) {
      return '<button class="wp-dot' + (i === shown - 1 ? ' is-active' : '') + '" type="button" data-i="' + i + '" aria-label="第 ' + (i + 1) + ' 张"></button>';
    }).join('');
  }

  /* 开启新一轮：batch 为唯一照片集合；deck 为其洗牌序列。
     关键：在“已洗牌”的 deck 上保证 deck[0] ≠ 上轮末张，杜绝跨轮连续重复。 */
  function setRound(photos) {
    batch = photos.slice();
    deck = shuffle(photos.slice());
    if (lastId && deck.length > 1 && deck[0].id === lastId) {
      var j = 1 + Math.floor(Math.random() * (deck.length - 1));
      var t = deck[0]; deck[0] = deck[j]; deck[j] = t;
    }
    shown = 0;
    round++;
    renderDots();
    M.$('.wp-total').textContent = '/ ' + M.pad2(batch.length);
  }

  function loadRound() {
    return fetchBatch().then(function (photos) {
      if (!photos || !photos.length) return false;
      setRound(photos);
      return true;
    }).catch(function () {
      return false;
    });
  }

  function show(p) {
    if (!p) return Promise.resolve(false);
    var token = ++showToken;
    // 先加载低清占位（更快上屏），成功即显示并后台升级高清；低清失败则直接尝试高清
    var first = p.lowUrl || p.url;
    return preload(first, C.photoLoadMs).then(function (ok) {
      if (token !== showToken) return false;
      if (!ok && p.lowUrl) {
        return preload(p.url, C.photoLoadMs).then(function (ok2) {
          if (token !== showToken || !ok2) return false;
          applyPhoto(p, p.url);
          return true;
        });
      }
      if (!ok) return false;
      applyPhoto(p, first);
      upgradeHi(p, token);
      return true;
    });
  }

  /* 取牌堆下一张；若本批耗尽则加载新一批 */
  function nextPhoto() {
    if (!deck.length) {
      return loadRound().then(function (ok) {
        if (!ok) return null;
        return deck.length ? deck.shift() : null;
      });
    }
    return Promise.resolve(deck.shift());
  }

  function advance() {
    return nextPhoto().then(function (p) {
      if (!p) {
        // 本批耗尽且新一批未能取得：保留当前画面并稍后自动重试，不阻塞
        if (!lastId) { layerA.style.backgroundImage = fallbackGradient(); layerB.style.backgroundImage = fallbackGradient(); }
        setStatus('外部照片暂不可用 · 已保留当前画面，稍后自动重试');
        return false;
      }
      return show(p).then(function (ok) {
        if (ok) {
          lastId = p.id;
          if (history.length > 12) history.shift();
          history.push(p);
          shown++;
          setStatus('外部壁纸 · 第 ' + round + ' 批 · ' + p.source);
          return true;
        }
        // 这张加载失败：直接丢弃，尝试牌堆里的下一张（不阻塞、不重复、不卡死）。
        if (deck.length) return advance();
        return loadRound().then(function (ok2) {
          if (!ok2) { if (!lastId) { layerA.style.backgroundImage = fallbackGradient(); layerB.style.backgroundImage = fallbackGradient(); } setStatus('外部照片暂不可用 · 已保留当前画面，稍后自动重试'); return false; }
          return advance();
        });
      });
    });
  }

  function next() {
    advance().then(function (ok) { if (!ok && !lastId) scheduleBoot(); });
    restartTimer();
  }

  function prev() {
    var p = history.pop();
    if (!p || (lastId && p.id === lastId)) { next(); return; }
    if (deck.indexOf(p) === -1) deck.unshift(p); // 当前这张回到未展示队列，避免立刻重复
    show(p).then(function (ok) {
      if (ok) { lastId = p.id; shown = Math.min(shown + (shown < batch.length ? 1 : 0), batch.length); renderMeta(); }
    });
    restartTimer();
  }

  function goTo(i) {
    if (!batch.length || i < 0 || i >= batch.length) return;
    var p = batch[i];
    if (p.id === lastId) return;
    show(p).then(function (ok) {
      if (ok) { lastId = p.id; shown = i + 1; if (history.length > 12) history.shift(); history.push(p); renderMeta(); }
    });
    restartTimer();
  }

  /* 手动换一批：丢弃当前批次剩余内容，立刻加载新一批并切换 */
  function refreshBatch() {
    deck = [];
    batch = [];
    supply = [];
    loadRound().then(function (ok) {
      if (ok) {
        advance();
        setStatus('已换新一批 · 外部动态壁纸');
        if (M.toast) M.toast('已换一批新壁纸', 'ok', 1600);
      } else {
        setStatus('外部照片暂不可用 · 已保留当前画面，稍后自动重试');
        if (M.toast) M.toast('暂时无法获取新壁纸，已保留当前画面', 'warn', 2400);
      }
    });
    restartTimer();
  }

  function restartTimer() { elapsed = 0; lastTs = performance.now(); }

  function setRunning(v) {
    running = v;
    M.store.data.settings.wallpaperPaused = !v;
    M.store.save(['settings']);
    var btn = M.$('#wp-play');
    if (btn) { btn.innerHTML = M.icon(v ? 'pause' : 'play'); btn.setAttribute('aria-label', v ? '暂停轮播' : '继续轮播'); }
    var tag = M.$('.auto-tag');
    if (tag) tag.innerHTML = '<span class="led' + (v ? '' : ' led--amber') + '"></span> ' + (v ? 'AUTO · 30S' : 'PAUSED');
    lastTs = performance.now();
  }

  function tick(now) {
    if (running) {
      elapsed += Math.min(now - lastTs, 200);
      if (elapsed >= INTERVAL) { elapsed = 0; next(); }
      var fill = M.$('#wp-progress-fill');
      if (fill) fill.style.width = (elapsed / INTERVAL * 100).toFixed(2) + '%';
    }
    lastTs = now;
    requestAnimationFrame(tick);
  }

  function scheduleBoot() {
    if (bootRetry) clearTimeout(bootRetry);
    bootRetry = setTimeout(boot, 6000);
  }

  function boot() {
    if (bootRetry) { clearTimeout(bootRetry); bootRetry = null; }
    loadRound().then(function (ok) {
      if (!ok) {
        setStatus('外部照片暂不可用 · 已显示渐变背景，稍后自动重试');
        layerA.style.backgroundImage = fallbackGradient();
        layerB.style.backgroundImage = fallbackGradient();
        scheduleBoot();
        return;
      }
      advance();
    });
  }

  function init() {
    layerA = M.$('#wp-a'); layerB = M.$('#wp-b');
    if (!layerA || !layerB) return;
    renderDots();

    M.$('#wp-next').addEventListener('click', next);
    M.$('#wp-prev').addEventListener('click', prev);
    var refreshBtn = M.$('#wp-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', refreshBatch);
    M.$('#wp-play').addEventListener('click', function () { setRunning(!running); });
    var dots = M.$('#wp-dots');
    if (dots) dots.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.wp-dot');
      if (b) goTo(Number(b.getAttribute('data-i')));
    });

    if (M.store.data.settings.wallpaperPaused) setRunning(false);
    else { M.$('#wp-play').innerHTML = M.icon('pause'); }
    lastTs = performance.now();
    requestAnimationFrame(tick);
    boot();
  }

  M.wallpaper = {
    init: init, next: next, prev: prev, refreshBatch: refreshBatch,
    _state: function () {
      return {
        batch: batch.map(function (p) { return p.id; }),
        lastId: lastId, round: round, shown: shown,
        hasImage: !!(layerA.style.backgroundImage && layerA.style.backgroundImage !== 'none') ||
                  !!(layerB.style.backgroundImage && layerB.style.backgroundImage !== 'none')
      };
    }
  };
})(window.MOTO);
