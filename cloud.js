/* MOTO // GARAGE — optional cloud sync (Auth + Database + Storage)
   本地浏览器始终是第一落点；登录后在已发布域名上把笔记/收藏/媒体索引同步到云端。
   任何云端异常都不会阻断本地功能，且会明确提示。 */
(function (M) {
  'use strict';

  var C = M.CONFIG.cloud;
  var state = { client:null, session:null, mode:'local', message:'本地模式', loading:false };
  var pendingOtp = null;
  var suppress = false;

  function isOnlineOrigin() {
    var h = location.hostname;
    return /^https?:$/.test(location.protocol) && h && !/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(h);
  }

  function setMode(mode, message) {
    state.mode = mode; state.message = message;
    M.emit('cloud:status', { mode:mode, message:message });
    var chip = M.$('#sync-chip'), label = M.$('#sync-label'), led = M.$('#sync-led'), side = M.$('#side-mode');
    if (chip) chip.classList.toggle('is-online', mode === 'online');
    if (label) label.textContent = message;
    if (led) { led.classList.toggle('led--amber', mode !== 'online'); led.classList.toggle('led--off', mode === 'error'); }
    if (side) side.textContent = mode === 'online' ? 'CLOUD SYNC' : 'LOCAL';
  }

  function loadSDK() {
    if (window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud) return Promise.resolve(window.WorkBuddyCloud);
    return new Promise(function (resolve, reject) {
      var old = document.querySelector('script[data-cloud-sdk]');
      if (old) old.remove();
      var s = document.createElement('script');
      s.src = C.sdk; s.async = true; s.setAttribute('data-cloud-sdk', '1');
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; reject(new Error('云端组件加载超时')); } }, 12000);
      s.onload = function () {
        if (done) return; done = true; clearTimeout(timer);
        if (window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud) resolve(window.WorkBuddyCloud);
        else reject(new Error('云端组件不可用'));
      };
      s.onerror = function () { if (!done) { done = true; clearTimeout(timer); reject(new Error('云端组件加载失败')); } };
      document.head.appendChild(s);
    });
  }

  function ensureClient() {
    if (state.client) return Promise.resolve(state.client);
    if (state.loading) return new Promise(function (resolve, reject) {
      var n = 0, t = setInterval(function () {
        if (state.client) { clearInterval(t); resolve(state.client); }
        else if (!state.loading) { clearInterval(t); reject(new Error('云端初始化失败')); }
        else if (++n > 60) { clearInterval(t); reject(new Error('云端初始化超时')); }
      }, 100);
    });
    state.loading = true;
    return loadSDK().then(function (g) {
      state.client = g.createWorkBuddyCloud({
        endpoint: C.endpoint,
        oauthRelayBaseUrl: C.oauthRelayBaseUrl,
        publishableKey: C.publishableKey
      });
      state.loading = false;
      return state.client;
    }).catch(function (e) { state.loading = false; throw e; });
  }

  function snapshot() {
    var d = M.store.data;
    return {
      notes: d.notes, links: d.links, linkCats: d.linkCats,
      mediaCats: d.mediaCats, mediaIndex: d.mediaIndex,
      routes: d.routes, weatherCache: d.weatherCache,
      settings: d.settings, fuelDraft: d.fuelDraft,
      appearance: M.appearance ? M.appearance.get() : null,
      updatedAt: Date.now()
    };
  }

  function push() {
    if (state.mode !== 'online' || !state.session) return Promise.resolve(false);
    return ensureClient().then(function (cloud) {
      var s = snapshot();
      return cloud.database.from('garage_state').upsert({
        id: 'snapshot',
        owner_name: (state.session.user && state.session.user.name) || null,
        payload: s,
        updated_at: new Date().toISOString()
      }).select();
    }).then(function (res) {
      if (res && res.error) throw res.error;
      M.store.data.lastSync = Date.now();
      suppress = true; M.store.save([]); suppress = false;
      M.toast('已同步到云端', 'ok');
      return true;
    }).catch(function (e) {
      M.toast('云同步失败：' + (e.message || '网络异常') + '（本地数据已保留）', 'warn', 4500);
      setMode('error', '同步异常');
      return false;
    });
  }

  function pull(interactive) {
    if (state.mode !== 'online' || !state.session) return Promise.resolve(false);
    return ensureClient().then(function (cloud) {
      return cloud.database.from('garage_state').select('*').eq('id', 'snapshot').maybeSingle();
    }).then(function (res) {
      if (res && res.error) throw res.error;
      var row = res && res.data;
      if (!row || !row.payload) {
        if (interactive) M.toast('云端暂无备份，已上传本机数据', 'info');
        return push();
      }
      var remote = row.payload, localTime = M.store.data.lastSync || 0;
      if ((remote.updatedAt || 0) > localTime) {
        suppress = true;
        M.store.replaceData({
          notes: remote.notes || [], links: remote.links || [],
          linkCats: remote.linkCats || [], mediaCats: remote.mediaCats || [],
          mediaIndex: remote.mediaIndex || [], routes: remote.routes || [],
          weatherCache: remote.weatherCache || null, settings: remote.settings,
          fuelDraft: remote.fuelDraft, lastSync: Date.now()
        });
        if (remote.appearance && M.appearance) M.appearance.set(remote.appearance);
        suppress = false;
        M.emit('cloud:pulled', {});
        M.toast('已从云端恢复数据', 'ok');
      } else if (interactive) {
        return push();
      }
      return true;
    }).catch(function (e) {
      M.toast('读取云端数据失败：' + (e.message || '网络异常'), 'warn', 4200);
      return false;
    });
  }

  function afterLogin(session) {
    state.session = session;
    setMode('online', '云同步已连接');
    return pull(false);
  }

  function autoRestore() {
    if (!isOnlineOrigin()) return;
    setMode('local', '连接中…');
    ensureClient().then(function (cloud) {
      return cloud.auth.getSession();
    }).then(function (res) {
      if (res && res.data) return afterLogin(res.data);
      setMode('local', '本地模式');
    }).catch(function () { setMode('local', '本地模式'); });
  }

  /* ---------------- Sync panel ---------------- */
  function panelHTML() {
    if (state.mode === 'online' && state.session) {
      var email = (state.session.user && (state.session.user.email || state.session.user.name)) || '已登录账号';
      return '<div style="display:flex;align-items:center;gap:12px;padding:14px;border:1px solid rgba(75,208,139,.3);background:rgba(75,208,139,.07);margin-bottom:18px">' +
        '<span class="led"></span><div><strong style="font-size:calc(13px * var(--ui-scale))">' + M.esc(email) + '</strong><div style="font-family:var(--font-mono);font-size:calc(10px * var(--ui-scale));color:var(--muted)">CLOUD SESSION ACTIVE</div></div></div>' +
        '<p style="font-size:calc(12px * var(--ui-scale));color:var(--text-2);line-height:1.9;margin:0 0 18px">笔记、网址收藏、分类与媒体索引会自动备份到云端；本机文件仍保存在浏览器中，离线也能查看。</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn--outline btn--sm" data-act="push">' + M.icon('cloud') + '<span>立即备份</span></button>' +
        '<button class="btn btn--outline btn--sm" data-act="pull">' + M.icon('refresh') + '<span>从云端恢复</span></button>' +
        '<button class="btn btn--outline btn--sm btn--danger" data-act="out">' + M.icon('close') + '<span>退出登录</span></button></div>' +
        '<p class="modal-note">云端仅保存结构化数据；媒体原文件体积较大，默认存放在本机浏览器数据库中。</p>';
    }
    var hint = isOnlineOrigin() ? '' :
      '<p class="modal-note" style="color:var(--amber)">当前是本地预览地址，云服务要求站点发布后的固定域名才能通过安全校验。发布后登录即可同步；在此之前所有内容照常保存在本机浏览器，不会丢失。</p>';
    var dis = isOnlineOrigin() ? '' : ' disabled';
    return '<p style="font-size:calc(12px * var(--ui-scale));color:var(--text-2);line-height:1.9;margin:0 0 18px">登录后可把笔记、收藏与分类备份到云端，在其他设备恢复。不登录也完全可用——所有内容会保存在本机浏览器。</p>' +
      '<label class="modal-field"><span>邮箱</span><input type="email" id="cloud-email" placeholder="you@example.com" autocomplete="email"></label>' +
      '<div style="display:flex;gap:8px"><button class="btn btn--outline btn--sm" type="button" data-act="code" style="flex:none"' + dis + '>获取验证码</button>' +
      '<input type="text" id="cloud-code" placeholder="输入验证码" inputmode="numeric" maxlength="8" style="flex:1"></div>' +
      '<div id="cloud-msg" style="margin-top:12px;font-size:calc(11.5px * var(--ui-scale));color:var(--amber);min-height:18px"></div>' + hint;
  }

  function openPanel() {
    var m = M.modal({
      title: '云同步 / CLOUD SYNC',
      body: panelHTML(),
      footer: state.mode === 'online' ? '<button class="btn btn--outline" data-close2>关闭</button>'
        : '<button class="btn btn--outline" data-close2>稍后再说</button><button class="btn btn--primary" data-act="login"' + (isOnlineOrigin() ? '' : ' disabled') + '>' + M.icon('cloud') + '<span>登录并同步</span></button>',
      onMount: function (api) {
        var msg = M.$('#cloud-msg', api.el);
        var close2 = M.$('[data-close2]', api.el);
        if (close2) close2.addEventListener('click', api.close);

        function show(t) { if (msg) msg.textContent = t; }

        M.$$('[data-act]', api.el).forEach(function (b) {
          b.addEventListener('click', function () {
            var act = b.getAttribute('data-act');
            if (act === 'push') { push(); return; }
            if (act === 'pull') { pull(true); return; }
            if (act === 'out') {
              ensureClient().then(function (c) { return c.auth.signOut(); }).then(function () {
                state.session = null; setMode('local', '本地模式'); api.close(); M.toast('已退出登录，本地数据保留', 'info');
              }).catch(function () { M.toast('退出失败，请稍后重试', 'warn'); });
              return;
            }
            if (act === 'code') {
              var email = (M.$('#cloud-email', api.el).value || '').trim();
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { show('请先填写正确的邮箱地址'); return; }
              show('正在发送验证码…'); b.disabled = true;
              ensureClient().then(function (c) { return c.auth.sendOtp({ email: email }); })
                .then(function (sent) {
                  b.disabled = false;
                  if (sent.error) throw sent.error;
                  pendingOtp = Object.assign({ email: email }, sent.data);
                  show('验证码已发送，请查收邮件（新邮箱将自动创建账号）');
                }).catch(function (e) { b.disabled = false; show('发送失败：' + (e.message || '网络异常')); });
              return;
            }
            if (act === 'login') {
              var mail = (M.$('#cloud-email', api.el).value || '').trim();
              var code = (M.$('#cloud-code', api.el).value || '').trim();
              if (!pendingOtp || pendingOtp.email !== mail) { show('请先点击「获取验证码」'); return; }
              if (!code) { show('请输入验证码'); return; }
              show('正在验证…'); b.disabled = true;
              ensureClient().then(function (c) {
                return c.auth.verifyOtp({
                  email: pendingOtp.email,
                  verificationId: pendingOtp.verificationId,
                  isExistingUser: pendingOtp.isExistingUser,
                  token: code
                });
              }).then(function (res) {
                b.disabled = false;
                if (res.error) throw res.error;
                pendingOtp = null;
                var session = res.data && (res.data.session || res.data);
                return afterLogin(session).then(function () { api.close(); });
              }).catch(function (e) { b.disabled = false; show('登录失败：' + (e.message || '验证码不正确')); });
            }
          });
        });
      }
    });
    return m;
  }

  /* ---------------- Media cloud storage (best effort) ---------------- */
  function withTimeout(p, ms, label) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error(label || 'timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function uploadMedia(id, file, opts) {
    opts = opts || {};
    if (state.mode !== 'online' || !state.session) return Promise.resolve(null);
    var uid = state.session.user && state.session.user.id;
    if (!uid) return Promise.resolve(null);
    var safe = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
    var timeoutMs = (C && C.mediaUploadMs) || 120000;
    return withTimeout(
      ensureClient().then(function (c) {
        var path = c.storage.userPath(uid, 'media/' + id + '-' + safe);
        var upOpts = { contentType: file.type || 'application/octet-stream' };
        if (typeof opts.onProgress === 'function') upOpts.onProgress = opts.onProgress;
        return c.storage.upload(path, file, upOpts)
          .then(function (r) { if (r && r.error) throw r.error; return path; });
      }),
      timeoutMs,
      'cloud-media-timeout'
    ).catch(function (e) {
      console.warn('[MOTO] cloud media upload skipped', (e && e.message) || e);
      return null;
    });
  }
  function removeMedia(path) {
    if (!path || state.mode !== 'online') return Promise.resolve();
    return ensureClient().then(function (c) { return c.storage.remove([path]); }).catch(function () {});
  }
  function getMediaUrl(path) {
    if (!path || state.mode !== 'online') return Promise.resolve(null);
    return ensureClient().then(function (c) {
      return c.storage.createSignedUrl(path, 600);
    }).then(function (r) {
      if (!r || r.error) return null;
      return r.data && (r.data.signedUrl || r.data.url) ? (r.data.signedUrl || r.data.url) : (typeof r.data === 'string' ? r.data : null);
    }).catch(function () { return null; });
  }

  /* ---------------- auto sync ---------------- */
  var autoPush = M.debounce(function () { push(); }, 2200);
  M.on('store:change', function (ev) {
    if (suppress || state.mode !== 'online') return;
    if (ev.parts.indexOf('all') > -1) return;
    autoPush();
  });

  M.cloud = {
    state: state,
    init: autoRestore,
    openPanel: openPanel,
    push: push,
    pull: pull,
    uploadMedia: uploadMedia,
    removeMedia: removeMedia,
    getMediaUrl: getMediaUrl,
    isOnline: function () { return state.mode === 'online'; }
  };

})(window.MOTO);
