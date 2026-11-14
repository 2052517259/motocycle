/* MOTO // GARAGE — notebook */
(function (M) {
  'use strict';

  var listEl, emptyEl, bodyEl, layoutEl, searchEl;
  var titleEl, contentEl, tagsEl;
  var saveTimer = null, activeId = null;

  function notes() { return M.store.data.notes; }
  function sorted() { return notes().slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }); }
  function find(id) { return notes().filter(function (n) { return n.id === id; })[0]; }

  function renderList() {
    var q = (searchEl.value || '').trim().toLowerCase();
    var arr = sorted().filter(function (n) {
      return !q || (n.title + ' ' + n.content + ' ' + (n.tags || []).join(' ')).toLowerCase().indexOf(q) > -1;
    });
    M.$('#note-count').textContent = notes().length + ' 条笔记' + (q ? ' / 命中 ' + arr.length : '');
    if (!arr.length) {
      listEl.innerHTML = '<div class="list-empty">' + (q ? '没有匹配的笔记' : '还没有笔记，点「新建笔记」开始') + '</div>';
      return;
    }
    listEl.innerHTML = arr.map(function (n) {
      var excerpt = (n.content || '').replace(/\s+/g, ' ').slice(0, 90) || '（空白笔记）';
      var tags = (n.tags || []).slice(0, 2).map(function (t) { return '<span class="mini-tag">' + M.esc(t) + '</span>'; }).join('');
      return '<button class="note-item ' + (n.id === activeId ? 'is-active' : '') + '" type="button" data-id="' + M.esc(n.id) + '">' +
        '<div class="note-item-top"><span class="note-item-title">' + M.esc(n.title || '无标题笔记') + '</span>' +
        '<span class="note-item-date">' + M.esc(M.fmtDate(n.updatedAt)) + '</span></div>' +
        '<div class="note-item-excerpt">' + M.esc(excerpt) + '</div>' +
        (tags ? '<div class="note-tags-mini">' + tags + '</div>' : '') + '</button>';
    }).join('');
  }

  function setSaveState(state) {
    var el = M.$('#save-state');
    if (!el) return;
    el.classList.toggle('is-dirty', state === 'dirty');
    el.innerHTML = state === 'dirty'
      ? '<span class="led"></span> 未保存…'
      : '<span class="led"></span> 已保存 ' + M.clockText();
  }

  function open(id, fromMobile) {
    var n = find(id);
    if (!n) return;
    activeId = id;
    M.store.data.activeNoteId = id;
    M.store.save(['activeNoteId']);
    emptyEl.hidden = true; bodyEl.hidden = false;
    titleEl.value = n.title || '';
    contentEl.value = n.content || '';
    tagsEl.value = (n.tags || []).join(', ');
    M.$('#editor-meta').textContent = '创建于 ' + M.fmtDate(n.createdAt);
    updateWordCount(); setSaveState('saved'); renderList();
    if (fromMobile) layoutEl.classList.add('is-editing');
  }

  function create() {
    var now = Date.now();
    var n = { id: M.uid(), title: '', content: '', tags: [], createdAt: now, updatedAt: now };
    notes().unshift(n);
    M.store.save(['notes']);
    open(n.id, true);
    titleEl.focus();
    M.toast('已新建笔记', 'ok', 1800);
  }

  function flush() {
    if (!activeId) return;
    var n = find(activeId);
    if (!n) return;
    n.title = titleEl.value;
    n.content = contentEl.value;
    n.tags = tagsEl.value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 8);
    n.updatedAt = Date.now();
    M.store.save(['notes']);
    setSaveState('saved');
    renderList();
    updateHomeStats();
  }

  function markDirty() {
    setSaveState('dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 650);
  }

  function updateWordCount() {
    var t = contentEl.value.replace(/\s/g, '').length;
    M.$('#word-count').textContent = t + ' 字';
  }
  function updateHomeStats() {
    var s = M.$('#stat-notes'); if (s) s.textContent = notes().length;
  }

  function remove() {
    if (!activeId) return;
    var n = find(activeId);
    M.confirm('删除笔记', '确定要删除「' + (n && (n.title || '无标题笔记')) + '」吗？此操作不可撤销。', function () {
      clearTimeout(saveTimer);
      M.store.data.notes = notes().filter(function (x) { return x.id !== activeId; });
      M.store.save(['notes']);
      activeId = null;
      emptyEl.hidden = false; bodyEl.hidden = true;
      layoutEl.classList.remove('is-editing');
      renderList(); updateHomeStats();
      M.toast('笔记已删除', 'info');
    });
  }

  function init() {
    listEl = M.$('#notes-list'); emptyEl = M.$('#editor-empty'); bodyEl = M.$('#editor-body');
    layoutEl = M.$('#notes-layout'); searchEl = M.$('#note-search');
    titleEl = M.$('#note-title'); contentEl = M.$('#note-content'); tagsEl = M.$('#note-tags');

    M.$('#note-new').addEventListener('click', create);
    M.$('#note-new-2').addEventListener('click', create);
    M.$('#note-save').addEventListener('click', function () { flush(); M.toast('笔记已保存', 'ok', 1600); });
    M.$('#note-delete').addEventListener('click', remove);
    M.$('#note-back').addEventListener('click', function () { flush(); layoutEl.classList.remove('is-editing'); });
    searchEl.addEventListener('input', renderList);
    listEl.addEventListener('click', function (e) {
      var b = e.target.closest('.note-item');
      if (b) { flush(); open(b.getAttribute('data-id'), true); }
    });
    [titleEl, contentEl, tagsEl].forEach(function (el) {
      el.addEventListener('input', function () { updateWordCount(); markDirty(); });
    });
    window.addEventListener('beforeunload', function () { if (saveTimer) flush(); });
    M.on('cloud:pulled', function () {
      clearTimeout(saveTimer);
      activeId = find(M.store.data.activeNoteId) ? M.store.data.activeNoteId : null;
      if (activeId) open(activeId); else { emptyEl.hidden = false; bodyEl.hidden = true; renderList(); }
      updateHomeStats();
    });
    M.on('route:change', function (r) { if (r !== 'notes' && saveTimer) flush(); });

    var initial = M.store.data.activeNoteId;
    if (initial && find(initial)) open(initial);
    else { renderList(); updateHomeStats(); }
  }

  M.notes = { init: init, render: renderList, updateStats: updateHomeStats };
})(window.MOTO);
