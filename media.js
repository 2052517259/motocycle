/* MOTO // GARAGE — media vault (IndexedDB blobs + categories) */
(function (M) {
  'use strict';

  var activeCat = 'all', objectUrls = [], gridEl, catsEl, dropEl, fileEl;

  function data() { return M.store.data; }
  function cats() { return data().mediaCats; }
  function index() { return data().mediaIndex; }
  function catName(id) { var c = cats().filter(function (x) { return x.id === id; })[0]; return c ? c.name : '未分类'; }
  function mediaKind(rec) {
    var t = rec.type || '', n = rec.name || '';
    if (/^image\//.test(t) || /\.(jpg|jpeg|png|webp|gif|bmp|avif|svg|heic|heif|tif|tiff)$/i.test(n)) return 'image';
    if (/^video\//.test(t) || /\.(mp4|webm|mov|m4v|ogv|mkv|avi|wmv|flv)$/i.test(n)) return 'video';
    if (/^audio\//.test(t) || /\.(mp3|wav|ogg|m4a|flac|aac|wma|opus)$/i.test(n)) return 'audio';
    return 'file';
  }
  function isImage(rec) { return mediaKind(rec) === 'image'; }
  function fileIcon(kind) { return kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'file'; }
  function extLabel(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toUpperCase() : 'FILE';
  }

  function revokeUrls() { objectUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); objectUrls = []; }
  function objUrl(blob) { if (!blob) return ''; var u = URL.createObjectURL(blob); objectUrls.push(u); return u; }

  /* ---------- video thumbnail ---------- */
  function videoThumb(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var v = document.createElement('video');
      var done = false;
      function finish(val) {
        if (done) return; done = true;
        try { URL.revokeObjectURL(url); } catch (e) {}
        v.removeAttribute('src'); v.load();
        resolve(val);
      }
      var timer = setTimeout(function () { finish(null); }, 6000);
      v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
      v.addEventListener('loadedmetadata', function () {
        try { v.currentTime = Math.min(0.6, (v.duration || 1) / 3); } catch (e) { finish(null); }
      });
      v.addEventListener('seeked', function () {
        try {
          var c = document.createElement('canvas');
          var w = 360, h = Math.round(w * (v.videoHeight / v.videoWidth || 0.75));
          c.width = w; c.height = h || 270;
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          clearTimeout(timer); finish(c.toDataURL('image/jpeg', 0.72));
        } catch (e) { clearTimeout(timer); finish(null); }
      });
      v.addEventListener('error', function () { clearTimeout(timer); finish(null); });
    });
  }

  /* ---------- categories ---------- */
  function renderCats() {
    var html = '<button class="cat-pill ' + (activeCat === 'all' ? 'is-active' : '') + '" data-cat="all">全部 <span class="cnt">' + index().length + '</span></button>';
    html += cats().map(function (c) {
      var n = index().filter(function (m) { return m.categoryId === c.id; }).length;
      return '<button class="cat-pill ' + (activeCat === c.id ? 'is-active' : '') + '" data-cat="' + M.esc(c.id) + '">' + M.esc(c.name) + ' <span class="cnt">' + n + '</span></button>';
    }).join('');
    html += '<button class="cat-pill cat-pill--add" id="mcat-add">' + M.icon('plus') + '<span>新分类</span></button>';
    catsEl.innerHTML = html;
  }

  function catModal() {
    function rows() {
      return cats().map(function (c) {
        var n = index().filter(function (m) { return m.categoryId === c.id; }).length;
        return '<div class="cat-manage-row" data-id="' + M.esc(c.id) + '">' +
          '<input type="text" class="cat-name" maxlength="24" value="' + M.esc(c.name) + '">' +
          '<span class="count">' + n + ' 个</span>' +
          '<button class="icon-btn" data-del aria-label="删除分类">' + M.icon('trash') + '</button></div>';
      }).join('');
    }
    M.modal({
      title: '管理媒体分类',
      body: '<div class="cat-manage-list" id="mcat-rows">' + rows() + '</div>' +
        '<button class="btn btn--outline btn--sm" id="mcat-new" style="margin-top:14px">' + M.icon('plus') + '<span>新增分类</span></button>' +
        '<p class="modal-note">删除分类后，其中的文件会移动到第一个剩余分类，文件本身不会删除。</p>',
      footer: '<button class="btn btn--outline" data-no>取消</button><button class="btn btn--primary" data-ok>' + M.icon('check') + '<span>保存分类</span></button>',
      onMount: function (api) {
        var rowsEl = M.$('#mcat-rows', api.el);
        function bind() {
          M.$$('[data-del]', rowsEl).forEach(function (b) {
            b.onclick = function () {
              var row = b.closest('.cat-manage-row'), id = row.getAttribute('data-id');
              var rest = cats().filter(function (c) { return c.id !== id; });
              M.store.data.mediaCats = rest;
              var fb = rest[0] ? rest[0].id : '';
              index().forEach(function (m) { if (m.categoryId === id) m.categoryId = fb; });
              if (activeCat === id) activeCat = 'all';
              M.store.save(['mediaCats','mediaIndex']);
              rowsEl.innerHTML = rows(); bind(); renderCats(); render();
            };
          });
        }
        bind();
        M.$('#mcat-new', api.el).addEventListener('click', function () {
          cats().push({ id:M.uid(), name:'新分类' }); M.store.save(['mediaCats']);
          rowsEl.innerHTML = rows(); bind(); renderCats();
          var ins = M.$$('.cat-name', rowsEl); if (ins.length) { ins[ins.length - 1].focus(); ins[ins.length - 1].select(); }
        });
        M.$('[data-no]', api.el).addEventListener('click', api.close);
        M.$('[data-ok]', api.el).addEventListener('click', function () {
          M.$$('.cat-manage-row', rowsEl).forEach(function (row) {
            var id = row.getAttribute('data-id'), name = M.$('.cat-name', row).value.trim();
            var c = cats().filter(function (x) { return x.id === id; })[0];
            if (c && name) c.name = name.slice(0, 24);
          });
          M.store.save(['mediaCats']); renderCats(); render(); api.close(); M.toast('分类已保存', 'ok', 1600);
        });
      }
    });
  }

  /* ---------- render ---------- */
  function render() {
    revokeUrls();
    var arr = index().filter(function (m) { return activeCat === 'all' || m.categoryId === activeCat; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
    M.$('#media-count').textContent = arr.length + ' 个文件 / 共 ' + index().length + ' 个';
    M.$('#media-empty').hidden = arr.length > 0;

    M.db.all().then(function (files) {
      var map = {};
      (files || []).forEach(function (f) { map[f.id] = f; });
      var options = cats().map(function (c) { return '<option value="' + M.esc(c.id) + '">' + M.esc(c.name) + '</option>'; }).join('');
      gridEl.innerHTML = arr.map(function (rec) {
        var f = map[rec.id];
        var kind = mediaKind(rec), local = f && f.blob;
        var thumb = (kind === 'image' && local) ? objUrl(local) : (f && f.thumb ? f.thumb : '');
        var media = thumb
          ? '<img src="' + M.esc(thumb) + '" alt="' + M.esc(rec.name) + '" loading="lazy">'
          : '<div class="ph ph-' + kind + '">' + M.icon(fileIcon(kind)) + '<span class="ph-ext">' + M.esc(extLabel(rec.name)) + '</span></div>';
        var play = kind === 'video' ? '<span class="play-badge">' + M.icon('play') + '</span>' : '';
        var kindTag = kind === 'image' ? 'IMAGE' : kind === 'video' ? 'VIDEO' : kind === 'audio' ? 'AUDIO' : 'FILE';
        return '<article class="media-card" data-id="' + M.esc(rec.id) + '">' +
          '<div class="media-thumb" data-open>' + media + play +
          '<span class="media-type-tag">' + kindTag + '</span></div>' +
          '<div class="media-info"><div class="media-name" title="' + M.esc(rec.name) + '">' + M.esc(rec.name) + '</div>' +
          '<div class="media-sub"><span>' + M.fmtSize(rec.size) + '</span><span>' + M.esc(M.fmtDate(rec.createdAt)) + '</span></div></div>' +
          '<div class="media-foot"><select data-cat-sel>' + options + '</select>' +
          '<button class="icon-btn" data-del title="删除" aria-label="删除">' + M.icon('trash') + '</button></div></article>';
      }).join('');
      M.$$('[data-cat-sel]', gridEl).forEach(function (sel) {
        var id = sel.closest('.media-card').getAttribute('data-id');
        var rec = index().filter(function (m) { return m.id === id; })[0];
        if (rec) sel.value = rec.categoryId || '';
      });
    }).catch(function () {
      gridEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-glyph">' + M.icon('warn') + '</div><h3>本机文件数据库不可用</h3><p>请确认浏览器允许站点存储数据（不要使用无痕模式）。</p></div>';
    });
    updateUsage();
    updateStats();
  }

  function updateUsage() {
    var total = index().reduce(function (s, m) { return s + (m.size || 0); }, 0);
    M.db.estimate().then(function (est) {
      var quota = est && est.quota ? est.quota : 0;
      var pct = quota ? Math.min(total / quota * 100, 100) : Math.min(total / (500 * 1024 * 1024) * 100, 100);
      M.$('#media-usage-text').textContent = '本机已用 ' + M.fmtSize(total) + (quota ? ' / ' + M.fmtSize(quota) : '');
      M.$('#usage-fill').style.width = Math.max(pct, 1.5) + '%';
    }).catch(function () { M.$('#media-usage-text').textContent = '本机已用 ' + M.fmtSize(total); });
  }
  function updateStats() {
    M.$('#stat-media').textContent = index().length;
    var total = index().reduce(function (s, m) { return s + (m.size || 0); }, 0);
    M.$('#stat-media-size').textContent = M.fmtSize(total);
  }

  /* ---------- upload ---------- */
  var upQueue = [], upActive = 0, upConcurrency = 3, upPanelEl = null, upListEl = null, upTitleEl = null;

  function isFileObj(f) {
    try { return !!(f && (f instanceof window.File || f instanceof window.Blob) && typeof f.size === 'number'); }
    catch (e) { return !!(f && typeof f.size === 'number'); }
  }

  function ensureQueueEls() {
    if (!upPanelEl) {
      upPanelEl = M.$('#upload-queue');
      upListEl = M.$('#uq-list');
      upTitleEl = M.$('#uq-title');
    }
    return upPanelEl;
  }

  function renderQueue() {
    if (!ensureQueueEls()) return;
    if (!upQueue.length) { upPanelEl.hidden = true; upListEl.innerHTML = ''; return; }
    var total = upQueue.length;
    var done = upQueue.filter(function (q) { return q.status === 'done' || q.status === 'error'; }).length;
    var errs = upQueue.filter(function (q) { return q.status === 'error'; }).length;
    var pending = upQueue.some(function (q) { return q.status === 'queued' || q.status === 'saving' || q.status === 'cloud'; });
    upPanelEl.hidden = false;
    upPanelEl.classList.toggle('is-collapsed', !!upPanelEl.__collapsed);
    upTitleEl.textContent = '上传任务：' + done + ' / ' + total + (errs ? '（' + errs + ' 个失败）' : '');
    var clr = M.$('#uq-clear'); if (clr) clr.hidden = pending;
    var labels = { queued:'排队中', saving:'保存到本机…', cloud:'已保存 · 同步云端中', done:'已保存', error:'失败' };
    upListEl.innerHTML = upQueue.map(function (q) {
      var barCls = 'uq-fill' + (q.status === 'done' ? ' is-done' : q.status === 'error' ? ' is-error' : (q.status === 'queued' ? ' is-idle' : ' is-pending'));
      var pct = q.status === 'done' ? 100 : (q.status === 'error' ? 100 : (q.pct != null ? q.pct : 0));
      return '<div class="uq-item uq-' + q.status + '" data-id="' + M.esc(q.id) + '">' +
        '<span class="uq-icon">' + M.icon(fileIcon(q.kind)) + '</span>' +
        '<div class="uq-body"><div class="uq-row1"><span class="uq-name" title="' + M.esc(q.name) + '">' + M.esc(q.name) + '</span>' +
        '<span class="uq-size">' + M.fmtSize(q.size) + '</span></div>' +
        '<div class="uq-bar"><span class="' + barCls + '" style="width:' + pct + '%"></span></div>' +
        '<div class="uq-status">' + M.esc(q.msg || labels[q.status] || '') + '</div></div></div>';
    }).join('');
  }

  function setItem(id, patch) {
    for (var i = 0; i < upQueue.length; i++) {
      if (upQueue[i].id === id) { Object.keys(patch).forEach(function (k) { upQueue[i][k] = patch[k]; }); break; }
    }
    renderQueue();
  }

  function upload(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var accepted = [], skipped = 0;
    list.forEach(function (f) {
      if (isFileObj(f) && (f.name || f.type)) accepted.push(f);
      else skipped++;
    });
    if (skipped) M.toast('已跳过 ' + skipped + ' 个无效文件', 'warn', 2600);
    if (!accepted.length) { M.toast('没有可上传的文件', 'warn'); return; }

    M.db.available().then(function (ok) {
      if (!ok) throw new Error('本机文件数据库不可用');
      accepted.forEach(function (file) {
        var id = M.uid();
        upQueue.push({
          id: id, file: file, name: file.name || ('文件-' + id.slice(0, 6)),
          size: file.size || 0, kind: mediaKind({ name: file.name, type: file.type }),
          status: 'queued', pct: null, msg: ''
        });
      });
      renderQueue();
      runPool();
    }).catch(function (e) {
      M.toast('无法开始上传：' + (e.message || '浏览器存储不可用') + '（请确认站点允许存储，且未处于无痕模式）', 'err', 5200);
    });
  }

  function runPool() {
    while (upActive < upConcurrency) {
      var next = null;
      for (var i = 0; i < upQueue.length; i++) { if (upQueue[i].status === 'queued') { next = upQueue[i]; break; } }
      if (!next) break;
      upActive++;
      processOne(next).then(finishOne, finishOne);
    }
  }
  function finishOne() {
    upActive = Math.max(0, upActive - 1);
    if (upActive === 0 && upQueue.length && upQueue.every(function (q) { return q.status === 'done' || q.status === 'error'; })) {
      var okN = upQueue.filter(function (q) { return q.status === 'done'; }).length;
      var errN = upQueue.filter(function (q) { return q.status === 'error'; }).length;
      setTimeout(function () {
        if (errN) M.toast('上传完成：成功 ' + okN + ' 个，失败 ' + errN + ' 个', 'warn', 4200);
        else M.toast('上传完成：' + okN + ' 个文件已保存', 'ok');
      }, 350);
    }
    runPool();
  }

  function processOne(q) {
    setItem(q.id, { status: 'saving', msg: '' });
    var file = q.file, id = q.id;
    var thumbP = (q.kind === 'video') ? videoThumb(file) : Promise.resolve(null);
    return thumbP.then(function (thumb) {
      return M.db.put({ id: id, blob: file, thumb: thumb }).then(function () {
        var rec = {
          id: id, name: file.name || q.name, type: file.type || 'application/octet-stream',
          size: file.size || 0,
          categoryId: activeCat !== 'all' ? activeCat : (cats()[0] ? cats()[0].id : ''),
          createdAt: Date.now(), cloudPath: null
        };
        index().unshift(rec);
        M.store.save(['mediaIndex']);
        renderCats(); render();
        if (M.cloud.isOnline()) {
          setItem(q.id, { status: 'cloud', pct: null, msg: '已保存 · 同步云端中' });
          cloudSync(id, file, rec, q);
        } else {
          setItem(q.id, { status: 'done', pct: 100, msg: '已保存（本地）' });
        }
      });
    }).catch(function (e) {
      var reason = (e && /quota|exceeded|空间|abort/i.test(e.message || '')) ? '浏览器存储空间不足，无法保存该文件' : (e.message || '存储不可用');
      setItem(q.id, { status: 'error', pct: null, msg: '保存失败：' + reason });
    });
  }

  function cloudSync(id, file, rec, q) {
    M.cloud.uploadMedia(id, file, {
      onProgress: function (p) { if (typeof p === 'number' && p >= 0 && p <= 1) setItem(q.id, { pct: Math.round(p * 100), msg: '已保存 · 云端同步中 ' + Math.round(p * 100) + '%' }); }
    }).then(function (path) {
      if (path) { rec.cloudPath = path; setItem(q.id, { status: 'done', pct: 100, msg: '已保存并同步云端' }); }
      else setItem(q.id, { status: 'done', pct: 100, msg: '已保存（云端同步跳过）' });
    }).catch(function () {
      setItem(q.id, { status: 'done', pct: 100, msg: '已保存（云端同步跳过）' });
    });
  }

  /* ---------- preview / delete ---------- */
  function openPreview(id) {
    var rec = index().filter(function (m) { return m.id === id; })[0];
    if (!rec) return;
    var kind = mediaKind(rec);
    M.db.get(id).then(function (f) {
      var blob = f && f.blob;
      var url = blob ? objUrl(blob) : '';
      if (!url && rec.cloudPath && M.cloud.getMediaUrl) {
        return M.cloud.getMediaUrl(rec.cloudPath).then(function (u) { return show(u || '', kind, rec); });
      }
      return show(url, kind, rec);
    }).catch(function () { M.toast('文件读取失败', 'err'); });

    function show(url, k, rec) {
      if (!url) { M.toast('本机文件已丢失，且云端没有可用副本', 'warn', 4200); return; }
      var body;
      if (k === 'image') body = '<img class="lightbox-media" src="' + M.esc(url) + '" alt="' + M.esc(rec.name) + '">';
      else if (k === 'video') body = '<video class="lightbox-media" src="' + M.esc(url) + '" controls autoplay playsinline></video>';
      else if (k === 'audio') body = '<audio class="lightbox-media" src="' + M.esc(url) + '" controls autoplay></audio>';
      else body = '<div class="file-preview">' +
        '<span class="fp-icon">' + M.icon('file') + '</span>' +
        '<div class="fp-meta"><strong>' + M.esc(rec.name) + '</strong>' +
        '<p>' + M.fmtSize(rec.size) + ' · ' + M.esc(catName(rec.categoryId)) + ' · ' + M.esc(M.fmtDate(rec.createdAt)) + '</p>' +
        '<a class="btn btn--outline btn--sm" href="' + M.esc(url) + '" target="_blank" rel="noopener" download>' + M.icon('external') + '<span>打开 / 下载文件</span></a></div></div>';
      M.modal({
        wide: k !== 'file', title: rec.name,
        body: body + (k === 'file' ? '' : '<p class="modal-note">' + M.fmtSize(rec.size) + ' · ' + M.esc(catName(rec.categoryId)) + ' · ' + M.esc(M.fmtDate(rec.createdAt)) + '</p>'),
        footer: '<button class="btn btn--outline" data-close2>关闭</button>',
        onMount: function (api) { M.$('[data-close2]', api.el).addEventListener('click', api.close); }
      });
    }
  }

  function remove(id) {
    var rec = index().filter(function (m) { return m.id === id; })[0];
    if (!rec) return;
    M.confirm('删除文件', '确定删除「' + rec.name + '」吗？文件会从本机存储中移除，且不可恢复。', function () {
      M.db.del(id).catch(function () {});
      if (rec.cloudPath) M.cloud.removeMedia(rec.cloudPath);
      M.store.data.mediaIndex = index().filter(function (m) { return m.id !== id; });
      M.store.save(['mediaIndex']);
      renderCats(); render(); M.toast('文件已删除', 'info');
    });
  }

  function init() {
    gridEl = M.$('#media-grid'); catsEl = M.$('#media-cats');
    dropEl = M.$('#dropzone'); fileEl = M.$('#media-input');

    function pick() { fileEl.click(); }
    M.$('#media-pick').addEventListener('click', pick);
    M.$('#media-pick-2').addEventListener('click', pick);
    fileEl.addEventListener('change', function () { upload(fileEl.files); fileEl.value = ''; });
    ['dragenter','dragover'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.add('is-over'); });
    });
    ['dragleave','drop'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.remove('is-over'); });
    });
    dropEl.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) upload(e.dataTransfer.files);
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    catsEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cat]');
      if (b) { activeCat = b.getAttribute('data-cat'); renderCats(); render(); return; }
      if (e.target.closest('#mcat-add')) catModal();
    });
    var uqPanel = M.$('#upload-queue');
    if (uqPanel) {
      var uqMin = M.$('#uq-min'), uqClear = M.$('#uq-clear');
      if (uqMin) uqMin.addEventListener('click', function () {
        uqPanel.__collapsed = !uqPanel.__collapsed;
        uqPanel.classList.toggle('is-collapsed', !!uqPanel.__collapsed);
        uqMin.textContent = uqPanel.__collapsed ? '展开' : '收起';
      });
      if (uqClear) uqClear.addEventListener('click', function () {
        upQueue = []; upActive = 0; if (uqPanel) { uqPanel.__collapsed = false; uqPanel.hidden = true; }
      });
    }
    M.$('#media-cat-manage').addEventListener('click', catModal);
    gridEl.addEventListener('click', function (e) {
      var card = e.target.closest('.media-card'); if (!card) return;
      var id = card.getAttribute('data-id');
      if (e.target.closest('[data-del]')) { remove(id); return; }
      if (e.target.closest('[data-open]')) openPreview(id);
    });
    gridEl.addEventListener('change', function (e) {
      var sel = e.target.closest('[data-cat-sel]'); if (!sel) return;
      var id = sel.closest('.media-card').getAttribute('data-id');
      var rec = index().filter(function (m) { return m.id === id; })[0];
      if (rec) { rec.categoryId = sel.value; M.store.save(['mediaIndex']); renderCats(); M.toast('分类已更新', 'ok', 1400); }
    });
    M.on('cloud:pulled', function () { activeCat = 'all'; renderCats(); render(); });
    renderCats(); render();
  }

  M.media = { init: init, render: render, updateStats: updateStats };
})(window.MOTO);
