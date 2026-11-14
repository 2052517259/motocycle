/* MOTO // GARAGE — bookmarks */
(function (M) {
  'use strict';

  var activeCat = 'all', gridEl, catsEl, searchEl;

  function data() { return M.store.data; }
  function cats() { return data().linkCats; }
  function links() { return data().links; }
  function catName(id) { var c = cats().filter(function (x) { return x.id === id; })[0]; return c ? c.name : '未分类'; }

  function renderCats() {
    var html = '<button class="cat-pill ' + (activeCat === 'all' ? 'is-active' : '') + '" data-cat="all">全部 <span class="cnt">' + links().length + '</span></button>';
    html += cats().map(function (c) {
      var n = links().filter(function (l) { return l.categoryId === c.id; }).length;
      return '<button class="cat-pill ' + (activeCat === c.id ? 'is-active' : '') + '" data-cat="' + M.esc(c.id) + '">' + M.esc(c.name) + ' <span class="cnt">' + n + '</span></button>';
    }).join('');
    html += '<button class="cat-pill cat-pill--add" id="cat-add">' + M.icon('plus') + '<span>新分类</span></button>';
    catsEl.innerHTML = html;
  }

  function renderGrid() {
    var q = (searchEl.value || '').trim().toLowerCase();
    var arr = links().filter(function (l) {
      var inCat = activeCat === 'all' || l.categoryId === activeCat;
      var inQuery = !q || (l.title + ' ' + l.url + ' ' + (l.desc || '')).toLowerCase().indexOf(q) > -1;
      return inCat && inQuery;
    }).sort(function (a, b) { return b.createdAt - a.createdAt; });
    M.$('#link-count').textContent = arr.length + ' 个链接 / 共 ' + links().length + ' 个';
    M.$('#links-empty').hidden = arr.length > 0;
    gridEl.innerHTML = arr.map(function (l) {
      var host = M.hostOf(l.url);
      var letter = (l.title || host || '?').trim().charAt(0).toUpperCase();
      return '<article class="link-card" data-id="' + M.esc(l.id) + '">' +
        '<div class="link-top"><div class="link-favicon"><img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=64" alt="" data-fav><span data-letter>' + M.esc(letter) + '</span></div>' +
        '<div style="min-width:0;flex:1"><div class="link-title">' + M.esc(l.title || host) + '</div><span class="link-url">' + M.esc(host) + '</span></div></div>' +
        '<p class="link-desc">' + M.esc(l.desc || '暂无描述') + '</p>' +
        '<div class="link-foot"><span class="link-cat">' + M.esc(catName(l.categoryId)) + '</span><div class="link-actions">' +
        '<a class="icon-btn" href="' + M.esc(l.url) + '" target="_blank" rel="noopener noreferrer" title="打开" aria-label="打开">' + M.icon('external') + '</a>' +
        '<button class="icon-btn" data-act="edit" title="编辑" aria-label="编辑">' + M.icon('edit') + '</button>' +
        '<button class="icon-btn" data-act="del" title="删除" aria-label="删除">' + M.icon('trash') + '</button>' +
        '</div></div></article>';
    }).join('');
    M.$$('[data-fav]', gridEl).forEach(function (img) {
      var letter = img.parentElement.querySelector('[data-letter]');
      img.addEventListener('load', function () { if (letter) letter.style.display = 'none'; });
      img.addEventListener('error', function () { img.remove(); });
    });
    updateStats();
  }

  function updateStats() {
    M.$('#stat-links').textContent = links().length;
    M.$('#stat-cats').textContent = cats().length + ' 个分类';
  }

  function linkModal(existing) {
    var l = existing || { title:'', url:'', desc:'', categoryId: cats()[0] ? cats()[0].id : '' };
    var options = cats().map(function (c) {
      return '<option value="' + M.esc(c.id) + '"' + (c.id === l.categoryId ? ' selected' : '') + '>' + M.esc(c.name) + '</option>';
    }).join('');
    var m = M.modal({
      title: existing ? '编辑收藏' : '添加网址',
      body:
        '<label class="modal-field"><span>名称 *</span><input type="text" id="lf-title" maxlength="80" placeholder="例如：机车壁纸大全" value="' + M.esc(l.title) + '"></label>' +
        '<label class="modal-field"><span>网址 *</span><input type="text" id="lf-url" placeholder="https://example.com" value="' + M.esc(l.url) + '"></label>' +
        '<label class="modal-field"><span>备注</span><input type="text" id="lf-desc" maxlength="160" placeholder="一句话说明" value="' + M.esc(l.desc || '') + '"></label>' +
        '<label class="modal-field"><span>分类</span><select id="lf-cat">' + options + '</select></label>' +
        '<div id="lf-msg" style="font-size:calc(11.5px * var(--ui-scale));color:var(--danger);min-height:18px"></div>' +
        '<p class="modal-note">网址会自动补全 https:// 前缀；保存后即时生效并写入本机存储。</p>',
      footer: '<button class="btn btn--outline" data-no>取消</button><button class="btn btn--primary" data-ok>' + M.icon('check') + '<span>保存</span></button>',
      onMount: function (api) {
        M.$('[data-no]', api.el).addEventListener('click', api.close);
        M.$('#lf-title', api.el).focus();
        M.$('[data-ok]', api.el).addEventListener('click', function () {
          var title = M.$('#lf-title', api.el).value.trim();
          var url = M.normalizeUrl(M.$('#lf-url', api.el).value);
          var msg = M.$('#lf-msg', api.el);
          if (!title) { msg.textContent = '请填写名称'; return; }
          if (!url) { msg.textContent = '请填写有效的网址'; return; }
          var desc = M.$('#lf-desc', api.el).value.trim();
          var cat = M.$('#lf-cat', api.el).value;
          if (existing) {
            Object.assign(existing, { title:title, url:url, desc:desc, categoryId:cat });
          } else {
            links().unshift({ id:M.uid(), title:title, url:url, desc:desc, categoryId:cat, createdAt:Date.now() });
          }
          M.store.save(['links']);
          renderCats(); renderGrid(); api.close();
          M.toast(existing ? '收藏已更新' : '收藏已添加', 'ok', 1800);
        });
      }
    });
    return m;
  }

  function catModal() {
    function rows() {
      return cats().map(function (c) {
        var n = links().filter(function (l) { return l.categoryId === c.id; }).length;
        return '<div class="cat-manage-row" data-id="' + M.esc(c.id) + '">' +
          '<input type="text" class="cat-name" maxlength="24" value="' + M.esc(c.name) + '">' +
          '<span class="count">' + n + ' 条</span>' +
          '<button class="icon-btn" data-del title="删除分类" aria-label="删除分类">' + M.icon('trash') + '</button></div>';
      }).join('');
    }
    var m = M.modal({
      title: '管理分类',
      body: '<div class="cat-manage-list" id="cat-rows">' + rows() + '</div>' +
        '<button class="btn btn--outline btn--sm" id="cat-new" style="margin-top:14px">' + M.icon('plus') + '<span>新增分类</span></button>' +
        '<p class="modal-note">删除分类时，其中的链接会移动到第一个剩余分类，不会丢失。</p>',
      footer: '<button class="btn btn--outline" data-no>取消</button><button class="btn btn--primary" data-ok>' + M.icon('check') + '<span>保存分类</span></button>',
      onMount: function (api) {
        var rowsEl = M.$('#cat-rows', api.el);
        function bind() {
          M.$$('[data-del]', rowsEl).forEach(function (b) {
            b.onclick = function () {
              var row = b.closest('.cat-manage-row'), id = row.getAttribute('data-id');
              var rest = cats().filter(function (c) { return c.id !== id; });
              M.store.data.linkCats = rest;
              var fallback = rest[0] ? rest[0].id : '';
              links().forEach(function (l) { if (l.categoryId === id) l.categoryId = fallback; });
              if (activeCat === id) activeCat = 'all';
              M.store.save(['linkCats','links']);
              rowsEl.innerHTML = rows(); bind(); renderCats(); renderGrid();
            };
          });
        }
        bind();
        M.$('#cat-new', api.el).addEventListener('click', function () {
          cats().push({ id:M.uid(), name:'新分类' });
          M.store.save(['linkCats']);
          rowsEl.innerHTML = rows(); bind(); renderCats();
          var inputs = M.$$('.cat-name', rowsEl);
          if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
        });
        M.$('[data-no]', api.el).addEventListener('click', api.close);
        M.$('[data-ok]', api.el).addEventListener('click', function () {
          M.$$('.cat-manage-row', rowsEl).forEach(function (row) {
            var id = row.getAttribute('data-id'), name = M.$('.cat-name', row).value.trim();
            var c = cats().filter(function (x) { return x.id === id; })[0];
            if (c && name) c.name = name.slice(0, 24);
          });
          M.store.save(['linkCats']);
          renderCats(); renderGrid(); api.close(); M.toast('分类已保存', 'ok', 1600);
        });
      }
    });
    return m;
  }

  function init() {
    gridEl = M.$('#links-grid'); catsEl = M.$('#link-cats'); searchEl = M.$('#link-search');
    M.$('#link-new').addEventListener('click', function () { linkModal(null); });
    M.$('#link-new-2').addEventListener('click', function () { linkModal(null); });
    M.$('#cat-manage').addEventListener('click', catModal);
    searchEl.addEventListener('input', renderGrid);
    catsEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cat]');
      if (b) { activeCat = b.getAttribute('data-cat'); renderCats(); renderGrid(); return; }
      if (e.target.closest('#cat-add')) catModal();
    });
    gridEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var card = b.closest('.link-card'), id = card.getAttribute('data-id');
      var l = links().filter(function (x) { return x.id === id; })[0];
      if (!l) return;
      if (b.getAttribute('data-act') === 'edit') linkModal(l);
      else M.confirm('删除收藏', '确定删除「' + l.title + '」吗？', function () {
        M.store.data.links = links().filter(function (x) { return x.id !== id; });
        M.store.save(['links']); renderCats(); renderGrid(); M.toast('已删除收藏', 'info');
      });
    });
    M.on('cloud:pulled', function () { activeCat = 'all'; renderCats(); renderGrid(); });
    renderCats(); renderGrid();
  }

  M.links = { init: init, render: renderGrid, updateStats: updateStats };
})(window.MOTO);
