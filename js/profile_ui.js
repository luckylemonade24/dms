/* ============================================================
 * 人物系统界面  profile_ui.js
 *  - 主菜单右上角：#menuProfile = 头像 + 名称 + 称号；点头像换头像、点名字改名、点称号看成就
 *  - 头像：5 个初始 + 成就解锁（未解锁置灰并显示解锁条件）
 *  - 称号：初始「雪景学院新生」+ 每个成就解锁一个同名称号
 *  - 存档：导出（下载 JSON + 可复制文本）/ 导入（选文件或粘贴）
 * ========================================================== */
var ProfileUI = (function () {
  'use strict';

  var bound = false;
  var tab = 'title';           // 成就面板当前页签：title / ach

  function $(id) { return document.getElementById(id); }
  function sfx(n) { try { if (window.Sfx && Sfx.play) Sfx.play(n); } catch (e) { } }
  function SD() { return (typeof SaveData !== 'undefined') ? SaveData : null; }
  function AC() { return (typeof Achievements !== 'undefined') ? Achievements : null; }
  function toast(m) { try { if (window.UI && UI.toast) UI.toast(m); } catch (e) { } }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function modal() { return $('modal'); }
  function closeModal() { var m = modal(); if (m) m.classList.add('hidden'); }

  /* ---------------- 人物信息读写 ---------------- */
  function player() {
    var s = SD();
    return s ? s.getPlayer() : { name: '玩家', avatar: '初始头像1', title: '雪景学院新生' };
  }
  function avatarIcon(id) {
    var a = AC();
    return a ? a.iconOf(id) : ('图标/' + id + '.png');
  }
  function avatars() {
    var a = AC();
    var list = a ? a.avatars() : [];
    if (!list.length) list = [{ id: '初始头像1', name: '初始头像1', icon: '图标/初始头像1.png', locked: false, achId: null }];
    return list;
  }
  function titles() {
    var a = AC();
    var list = a ? a.titles() : [];
    if (!list.length) list = [{ name: '雪景学院新生', locked: false, achId: null }];
    return list;
  }

  /* ---------------- 主菜单人物块 ---------------- */
  function mount() {
    var block = $('menuProfile');
    if (!block) return;
    if (block.dataset.mounted === '1') return;
    block.dataset.mounted = '1';
    block.innerHTML =
      '<div class="pf-zone" id="pfAvaBtn" title="点击更换头像">' +
        '<img class="pf-ava" id="pfAvaImg" src="" alt="头像">' +
      '</div>' +
      '<div class="pf-txt">' +
        '<div class="pf-zone pf-name" id="pfNameBtn" title="点击修改名称">名</div>' +
        '<div class="pf-zone pf-title" id="pfTitleBtn" title="点击查看成就并切换称号">称</div>' +
        '<div class="pf-hint">点头像换头像 · 点名字改名 · 点称号看成就</div>' +
      '</div>';
    $('pfAvaBtn').onclick = function () { sfx('click'); openAvatar(); };
    $('pfNameBtn').onclick = function () { sfx('click'); openName(); };
    $('pfTitleBtn').onclick = function () { sfx('click'); openAchievements('title'); };
  }

  function refresh() {
    var block = $('menuProfile');
    mount();
    if (!block) return;
    var p = player();
    var img = $('pfAvaImg');
    if (img) {
      var src = avatarIcon(p.avatar || '初始头像1');
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    }
    var nm = $('pfNameBtn'); if (nm) nm.textContent = p.name || '玩家';
    var tt = $('pfTitleBtn');
    if (tt) {
      var cs = 0, a = AC();
      if (a) cs = a.countUnlocked();
      tt.textContent = (p.title || '雪景学院新生');
      tt.title = '点击查看成就并切换称号（已解锁 ' + cs + ' 项成就）';
    }
    block.classList.remove('hidden');
  }

  /* ---------------- 头像选择 ---------------- */
  function openAvatar() {
    var m = modal(); if (!m) return;
    var p = player();
    var list = avatars();
    var cells = list.map(function (a, i) {
      var on = (a.id === p.avatar) ? ' on' : '';
      var lock = a.locked ? ' lock' : '';
      var tip = a.locked
        ? ('未解锁：完成成就【' + esc(a.achName) + '】—— ' + esc(a.achDesc))
        : '点击使用这个头像';
      return '<div class="pf-cell' + on + lock + '" data-i="' + i + '" title="' + tip + '">' +
        '<img src="' + esc(a.icon) + '" alt="">' +
        (a.locked ? '<span class="pf-lock">锁</span>' : '') +
        '</div>';
    }).join('');
    var got = list.filter(function (a) { return !a.locked; }).length;
    m.classList.remove('hidden');
    m.innerHTML =
      '<div class="mbox pf-box"><h3>更换头像</h3>' +
      '<p class="pf-note">初始 5 个头像随时可用，其余头像需要<b>达成对应成就</b>后解锁（当前已解锁 ' + got + ' / ' + list.length + '）。</p>' +
      '<div class="pf-grid">' + cells + '</div>' +
      '<div class="mbtns"><button id="pfAvaClose" class="pxbtn">关闭</button></div></div>';
    var grid = m.querySelector('.pf-grid');
    grid.onclick = function (e) {
      var cell = e.target.closest ? e.target.closest('.pf-cell') : null;
      if (!cell) return;
      var a = list[+cell.dataset.i];
      if (!a) return;
      if (a.locked) { toast('该头像未解锁：完成成就【' + a.achName + '】'); return; }
      var s = SD();
      if (s) s.setPlayer({ avatar: a.id });
      sfx('click');
      refresh();
      openAvatar();
      toast('头像已更换：' + a.name);
    };
    $('pfAvaClose').onclick = function () { sfx('click'); closeModal(); };
  }

  /* ---------------- 名称编辑 ---------------- */
  function openName() {
    var m = modal(); if (!m) return;
    var p = player();
    m.classList.remove('hidden');
    m.innerHTML =
      '<div class="mbox pf-box"><h3>修改名称</h3>' +
      '<p class="pf-note">这个名称会用在<b>对局界面</b>、<b>魔绫大赛</b>、<b>学院考核</b>里（最多 12 个字）。</p>' +
      '<input class="pf-name-input" id="pfNameInput" maxlength="12" value="' + esc(p.name) + '">' +
      '<div class="mbtns"><button id="pfNameSave" class="pxbtn">保存</button>' +
      '<button id="pfNameCancel" class="pxbtn ghost">取消</button></div></div>';
    var input = $('pfNameInput');
    if (input) { input.focus(); input.select(); }
    function doSave() {
      var v = (input && input.value || '').trim();
      if (!v) { toast('名称不能为空'); return; }
      var s = SD();
      if (s) s.setPlayer({ name: v.slice(0, 12) });
      sfx('click');
      closeModal();
      refresh();
      toast('名称已改为：' + v.slice(0, 12));
    }
    $('pfNameSave').onclick = doSave;
    if (input) input.onkeydown = function (e) { if (e.key === 'Enter') doSave(); };
    $('pfNameCancel').onclick = function () { sfx('click'); closeModal(); };
  }

  /* ---------------- 称号 / 成就面板 ---------------- */
  function openAchievements(which) {
    tab = which || tab;
    var m = modal(); if (!m) return;
    m.classList.remove('hidden');
    m.innerHTML =
      '<div class="mbox pf-box"><h3>称号 · 成就</h3>' +
      '<div class="pf-tabs">' +
        '<button class="pxbtn' + (tab === 'title' ? '' : ' ghost') + ' small" id="pfTabTitle">称号</button>' +
        '<button class="pxbtn' + (tab === 'ach' ? '' : ' ghost') + ' small" id="pfTabAch">成就</button>' +
      '</div>' +
      '<div class="pf-list" id="pfList"></div>' +
      '<div class="mbtns"><button id="pfAchClose" class="pxbtn">关闭</button></div></div>';
    renderList();
    $('pfTabTitle').onclick = function () { tab = 'title'; sfx('click'); openAchievements('title'); };
    $('pfTabAch').onclick = function () { tab = 'ach'; sfx('click'); openAchievements('ach'); };
    $('pfAchClose').onclick = function () { sfx('click'); closeModal(); };
  }

  function renderList() {
    var box = $('pfList');
    if (!box) return;
    var p = player();
    if (tab === 'title') {
      var list = titles();
      box.innerHTML = list.map(function (t, i) {
        var cur = (t.name === p.title);
        var cls = 'pf-row' + (t.locked ? '' : ' got') + (cur ? ' cur' : '');
        var btn = '';
        if (!t.locked) {
          btn = cur
            ? '<span class="pf-use dim">使用中</span>'
            : '<button class="pxbtn small pf-use" data-t="' + i + '">使用</button>';
        } else {
          btn = '<span class="pf-use dim">未解锁</span>';
        }
        return '<div class="' + cls + '"><div class="pf-bd">' +
          '<div class="pf-nm">' + esc(t.name) + '</div>' +
          '<div class="pf-ds">' + (t.locked ? ('解锁方式：完成成就【' + esc(t.name) + '】' + (t.desc ? (' —— ' + esc(t.desc)) : '')) : (t.achId ? '解锁方式：完成成就【' + esc(t.name) + '】' : '初始称号')) + '</div>' +
          '</div>' + btn + '</div>';
      }).join('');
      box.onclick = function (e) {
        var b = e.target.closest ? e.target.closest('button[data-t]') : null;
        if (!b) return;
        var t = titles()[+b.dataset.t];
        if (!t || t.locked) return;
        var s = SD();
        if (s) s.setPlayer({ title: t.name });
        sfx('click');
        refresh();
        renderList();
        toast('称号已切换：' + t.name);
      };
      return;
    }
    var a = AC();
    var arr = a ? a.list() : [];
    var got = 0;
    box.innerHTML = arr.map(function (x) {
      var ok = a ? a.unlocked(x.id) : false;
      if (ok) got++;
      var prog = (x.prog && !ok) ? ('<div class="pf-pg">进度：' + esc(x.prog()) + '</div>') : '';
      var ico = x.icon
        ? '<img class="pf-ico' + (ok ? '' : ' lock') + '" src="' + esc(a ? a.iconOf(x.name) : '') + '" alt="">'
        : '<div class="pf-ico"></div>';
      return '<div class="pf-row' + (ok ? ' got' : '') + '">' + ico +
        '<div class="pf-bd"><div class="pf-nm">' + (ok ? '【已解锁】' : '【未解锁】') + esc(x.name) + (x.icon ? ' <span class="pf-ds">（附带头像）</span>' : '') + '</div>' +
        '<div class="pf-ds">' + esc(x.desc) + '</div>' + prog + '</div></div>';
    }).join('');
    var head = document.createElement('div');
    head.className = 'pf-note';
    head.style.padding = '2px 8px';
    head.textContent = '已解锁 ' + got + ' / ' + arr.length + ' 项成就（每项成就都会解锁同名一个称号' + (arr.some(function (x) { return x.icon; }) ? '，部分成就还会解锁头像' : '') + '）';
    box.insertBefore(head, box.firstChild);
  }

  /* ---------------- 存档：导出 / 导入 ---------------- */
  function stamp() {
    var d = new Date(), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes());
  }
  function exportSave() {
    var s = SD();
    if (!s) { toast('存档不可用'); return; }
    var json = JSON.stringify(s.exportAll(), null, 2);
    var fname = '地牢决斗师-踏上征途存档_' + (s.getPlayerName() || '玩家') + '_' + stamp() + '.json';
    try {
      var blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { } }, 4000);
      toast('已导出：' + fname);
    } catch (e) {
      toast('浏览器拦截了下载，请用下面的文本框复制');
    }
    showTextPanel('导出存档', json, fname);
  }
  function showTextPanel(title, text, fname) {
    var m = modal(); if (!m) return;
    m.classList.remove('hidden');
    m.innerHTML =
      '<div class="mbox pf-box"><h3>' + esc(title) + '</h3>' +
      '<p class="pf-note">已尝试下载 <b>' + esc(fname || '') + '</b>。如果没有开始下载，请<b>全选复制</b>下面这段内容，粘贴到文件里保存（.json）。</p>' +
      '<textarea class="pf-paste" id="pfExpText" readonly></textarea>' +
      '<div class="mbtns"><button id="pfCopy" class="pxbtn">复制全部</button>' +
      '<button id="pfExpClose" class="pxbtn ghost">关闭</button></div></div>';
    var ta = $('pfExpText');
    if (ta) ta.value = text;
    $('pfCopy').onclick = function () {
      var ok = false;
      try { if (ta) { ta.select(); ta.setSelectionRange(0, text.length); ok = document.execCommand('copy'); } } catch (e) { ok = false; }
      if (!ok && navigator.clipboard) { navigator.clipboard.writeText(text).catch(function () { }); ok = true; }
      sfx('click');
      toast(ok ? '已复制存档内容' : '复制失败，请手动全选复制');
    };
    $('pfExpClose').onclick = function () { sfx('click'); closeModal(); refresh(); };
  }

  function importSave() {
    var m = modal(); if (!m) return;
    m.classList.remove('hidden');
    m.innerHTML =
      '<div class="mbox pf-box"><h3>导入存档</h3>' +
      '<p class="pf-note">选择导出的 <b>.json</b> 文件，或直接把内容粘贴到下面。<br>' +
      '<b>导入会覆盖当前存档</b>（卡组、跑图进度、大赛与考核记录、成就、人物信息全部替换）。</p>' +
      '<input type="file" id="pfFile" class="pf-file" accept=".json,application/json">' +
      '<textarea class="pf-paste" id="pfImportText" placeholder="在这里粘贴存档 JSON…"></textarea>' +
      '<div class="mbtns"><button id="pfDoImport" class="pxbtn">导入</button>' +
      '<button id="pfImportClose" class="pxbtn ghost">取消</button></div>' +
      '<p class="pf-note" id="pfImpMsg"></p></div>';
    var file = $('pfFile'), ta = $('pfImportText'), msg = $('pfImpMsg');
    if (file) file.onchange = function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { if (ta) ta.value = String(fr.result || ''); if (msg) msg.textContent = '已读取文件：' + f.name; };
      fr.onerror = function () { if (msg) msg.textContent = '文件读取失败'; };
      fr.readAsText(f);
    };
    $('pfDoImport').onclick = function () {
      var raw = (ta && ta.value || '').trim();
      if (!raw) { if (msg) msg.textContent = '请先选择文件或粘贴存档内容'; return; }
      var obj = null;
      try { obj = JSON.parse(raw); } catch (e) { if (msg) msg.textContent = 'JSON 解析失败：' + e.message; return; }
      var s = SD();
      if (!s) { if (msg) msg.textContent = '存档功能不可用'; return; }
      var r = s.importAll(obj);
      if (!r.ok) { if (msg) msg.textContent = '导入失败：' + r.msg; return; }
      sfx('win');
      closeModal();
      applyImported();
      toast('存档导入成功');
    };
    $('pfImportClose').onclick = function () { sfx('click'); closeModal(); };
  }

  // 导入后刷新所有界面（难度、菜单、人物块）
  function applyImported() {
    try { if (window.AI && AI.setDifficulty) AI.setDifficulty(SD().getDifficulty()); } catch (e) { }
    try { if (window.UI) { if (UI.refreshMenu) UI.refreshMenu(); else UI.showMenu(); } } catch (e) { }
    refresh();
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    if (bound) return;
    bound = true;
    var a = AC();
    if (a) {
      a.setUnlockListener(function (def) {
        toast('达成成就【' + def.name + '】' + (def.icon ? '：解锁头像与称号' : '：解锁称号'));
        refresh();
      });
    }
    mount();
    refresh();
  }

  return {
    init: init, refresh: refresh, mount: mount,
    openAvatar: openAvatar, openName: openName, openAchievements: openAchievements,
    exportSave: exportSave, importSave: importSave,
    playerName: function () { var s = SD(); return s ? s.getPlayerName() : '玩家'; },
    playerTitle: function () { return player().title || '雪景学院新生'; },
    label: function () { return ProfileUI.playerName() + ' · ' + ProfileUI.playerTitle(); }
  };
})();
