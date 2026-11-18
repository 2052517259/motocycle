/* MOTO // GARAGE — persistence layer (localStorage + IndexedDB) */
(function (M) {
  'use strict';

  var KEY = 'moto.garage.v1';
  var memoryFallback = null;

  function seed() {
    var now = Date.now();
    return {
      version: 1,
      notes: [{
        id: 'welcome', title: '欢迎来到车库', content: '这里是你的个人骑行工作台。\n\n· 首页壁纸每 30 秒自动切换，且不重复循环\n· 记事本会自动保存，关掉页面回来还在\n· 油耗计算器会自己抓实时油价\n· 网址收藏和媒体文件都可以按分类整理\n\n左侧导航随便点点，或者按右上角开启云同步，把数据带到别的设备。',
        tags: ['指南', 'MOTO'], createdAt: now, updatedAt: now
      }],
      activeNoteId: 'welcome',
      linkCats: [
        { id:'c-tool', name:'日常工具' }, { id:'c-moto', name:'机车相关' },
        { id:'c-design', name:'设计灵感' }, { id:'c-dev', name:'开发资源' }
      ],
      links: [
        { id:'l1', title:'Unsplash · 机车壁纸', url:'https://unsplash.com/s/photos/motorcycle', categoryId:'c-design', desc:'高质量机车摄影，首页壁纸来源', createdAt:now },
        { id:'l2', title:'国家发展和改革委员会', url:'https://www.ndrc.gov.cn', categoryId:'c-tool', desc:'成品油调价官方发布', createdAt:now },
        { id:'l3', title:'MDN Web Docs', url:'https://developer.mozilla.org', categoryId:'c-dev', desc:'前端开发参考文档', createdAt:now },
        { id:'l4', title:'Google Fonts', url:'https://fonts.google.com', categoryId:'c-design', desc:'本站标题字体 Barlow Condensed', createdAt:now }
      ],
      mediaCats: [
        { id:'m-ride', name:'骑行记录' }, { id:'m-bike', name:'车辆照片' },
        { id:'m-mod', name:'改装参考' }, { id:'m-other', name:'其他' }
      ],
      mediaIndex: [],
      routes: [],
      weatherCache: null,
      settings: { province:'浙江', oil:'95', manualPrice:false, manualPriceValue:'', wallpaperPaused:false, weatherCity:'杭州', defaultsV2:true },
      priceCache: null,
      fuelDraft: { distance:'', fuel:'' },
      fuelLogs: [],
      lastSync: 0
    };
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return seed();
      var obj = JSON.parse(raw);
      var base = seed();
      // 先记录是否已做过 v2 默认值升级（须在合并种子字段之前，否则标志会被种子值提前补上）
      var hadV2 = !!(obj.settings && obj.settings.defaultsV2);
      // 合并缺省字段，保证旧数据也能平滑升级
      Object.keys(base).forEach(function (k) { if (obj[k] === undefined) obj[k] = base[k]; });
      if (!obj.settings) obj.settings = base.settings;
      Object.keys(base.settings).forEach(function (k) { if (obj.settings[k] === undefined) obj.settings[k] = base.settings[k]; });
      // 一次性默认值升级（v2：浙江省 · 95# 汽油 · 杭州）：
      // 仅当旧值仍是 v1 默认值（用户从未手动改过）时才替换，改过则尊重用户选择
      if (!hadV2) {
        if (obj.settings.province === '广东' && obj.settings.oil === '92' && obj.settings.weatherCity === '广州') {
          obj.settings.province = '浙江';
          obj.settings.oil = '95';
          obj.settings.weatherCity = '杭州';
        }
        obj.settings.defaultsV2 = true;
        try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e2) {}
      }
      // v3：新增加油历史 fuelLogs（看板数据源）。缺省字段已由种子合并补齐，
      // 这里只负责把已落盘的旧数据也标注升级版本，便于以后继续演进。
      if (!obj.defaultsV3) {
        if (!Array.isArray(obj.fuelLogs)) obj.fuelLogs = [];
        obj.defaultsV3 = true;
        try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e3) {}
      }
      return obj;
    } catch (e) {
      console.warn('[MOTO] localStorage unavailable', e);
      return memoryFallback || seed();
    }
  }

  var data = read();

  var store = {
    get data() { return data; },
    reload: function () { data = read(); },
    save: function (parts) {
      try { localStorage.setItem(KEY, JSON.stringify(data)); }
      catch (e) { memoryFallback = data; console.warn('[MOTO] persist failed', e); }
      M.emit('store:change', { parts: parts || [], data: data });
    },
    patch: function (obj, parts) { Object.assign(data, obj); store.save(parts); },
    replaceData: function (next) {
      // 重置/云同步覆盖：顶层整体替换，settings 按键合并——
      // 未指定的字段回落到默认值（浙江 · 95# 汽油 · 杭州），避免部分数据把默认设置冲掉
      var merged = Object.assign({}, seed().settings, (next && next.settings) || {});
      data = Object.assign(seed(), next, { version: 1, settings: merged });
      store.save(['all']);
    }
  };
  M.store = store;

  /* ---------------- IndexedDB for media blobs ---------------- */
  var DB_NAME = 'moto-garage-media';
  var STORE = 'files';
  var dbPromise = null;

  function openDB() {
    return new Promise(function (resolve) {
      if (!('indexedDB' in window)) return resolve(null);
      var req;
      try { req = indexedDB.open(DB_NAME, 1); }
      catch (e) { return resolve(null); }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
  }

  function withStore(mode, fn) {
    return new Promise(function (resolve, reject) {
      openDB().then(function (db) {
        if (!db) return reject(new Error('IndexedDB 不可用'));
        var tx = db.transaction(STORE, mode);
        var os = tx.objectStore(STORE);
        var out;
        try { out = fn(os); } catch (e) { return reject(e); }
        tx.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        tx.onerror = function () { reject(tx.error || new Error('IndexedDB 事务失败')); };
        tx.onabort = function () { reject(tx.error || new Error('IndexedDB 事务被中止（可能空间不足）')); };
      });
    });
  }

  M.db = {
    available: function () { return openDB().then(function (db) { return !!db; }); },
    put: function (rec) { return withStore('readwrite', function (os) { return os.put(rec); }); },
    get: function (id) { return withStore('readonly', function (os) { return os.get(id); }); },
    all: function () { return withStore('readonly', function (os) { return os.getAll(); }); },
    del: function (id) { return withStore('readwrite', function (os) { return os.delete(id); }); },
    estimate: function () {
      if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate();
      return Promise.resolve({ usage: 0, quota: 0 });
    }
  };

})(window.MOTO);
