/* ============================================================
 * js/community.js —— 「社区」面板（公告 / 卡组社区 / 加入官群）
 *
 * 内容全部来自 js/community_data.js（纯数据文件，服务器可直接替换更新）。
 * 本文件只负责界面与交互，正常不需要改：
 *   · 左上角「社区」按钮（#btnCommunity，与全屏按钮同款 .fsbtn 风格）
 *   · 三个板块切换
 *   · 一键复制官方群号
 *   · 把社区卡组加进自己的组卡器方案（SaveData.decks）
 *
 * 依赖：CARDS（cards.js）、SaveData（storage.js）、DeckRules（rules.js）、
 *       UI.toast（ui.js，缺失时静默）—— 所以本文件放在 ui.js 之后加载。
 * ========================================================== */
(function () {
  'use strict';

  var TABS = [
    { key: 'news', name: '公告' },
    { key: 'decks', name: '卡组社区' },
    { key: 'group', name: '加入官群' }
  ];

  var el = null;          // 面板根节点（首次打开时创建）
  var curTab = 'news';

  /* ---------------- 小工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
  function toast(msg) {
    if (window.UI && UI.toast) UI.toast(msg);
    else if (window.console) console.log('[社区] ' + msg);
  }
  function clickSfx() { if (window.Sfx && Sfx.play) Sfx.play('click'); }
  function data() { return window.COMMUNITY_DATA || {}; }
  function list(k) { var v = data()[k]; return Array.isArray(v) ? v : []; }

  /* 复制文本：优先 Clipboard API，失败降级到临时 textarea + execCommand。
   * （http 环境（非 localhost）拿不到 navigator.clipboard，必须有降级，
   *   否则"复制群号"在一部分手机上会静默失效。） */
  function copyText(text, onDone) {
    var done = function () { toast('已复制：' + text); if (onDone) onDone(); };
    var legacy = function () {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        var ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) done();
        else toast('复制失败，请长按选中群号手动复制');
      } catch (e) { toast('复制失败，请长按选中群号手动复制'); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        navigator.clipboard.writeText(text).then(done, legacy);
      } catch (e) { legacy(); }
    } else legacy();
  }

  /* ---------------- 卡组展示 ---------------- */
  // 卡组内容：怪物 / 其它 分两组，同名牌合并成 ×N，按品阶上色
  function deckCardsHtml(cardIds) {
    var seen = {}, order = [];
    (cardIds || []).forEach(function (id) {
      if (!CARDS || !CARDS[id]) return;
      if (seen[id] == null) { seen[id] = 0; order.push(id); }
      seen[id] += 1;
    });
    var mons = [], items = [];
    order.forEach(function (id) {
      var c = CARDS[id];
      var n = seen[id];
      var chip = '<span class="cm-chip t-' + esc(c.tier || 'C') + '" data-tip="' + esc(id) + '">' +
        esc(c.name) + (n > 1 ? '<b>×' + n + '</b>' : '') + '</span>';
      (c.type === 'monster' ? mons : items).push(chip);
    });
    var h = '';
    if (mons.length) h += '<div class="cm-grp"><span class="cm-grp-t">怪物 ' + mons.length + ' 种</span>' + mons.join('') + '</div>';
    if (items.length) h += '<div class="cm-grp"><span class="cm-grp-t">道具 ' + items.length + ' 种</span>' + items.join('') + '</div>';
    if (!h) h = '<div class="cm-grp dim">（卡表为空）</div>';
    return h;
  }

  // 点击卡组里的卡名 → 复用对局里的卡牌详情浮层（#preview），没有就忽略
  function tipOf(id) {
    if (window.UI && UI.previewCard) return UI.previewCard;
    return null;
  }

  /* ---------------- 三个板块 ---------------- */
  function newsHtml() {
    var arr = list('ANNOUNCEMENTS');
    if (!arr.length) return '<div class="cm-empty">暂无公告</div>';
    return arr.map(function (a) {
      return '<div class="cm-ann">' +
        '<div class="cm-ann-h">' +
        (a.tag ? '<span class="cm-tag">' + esc(a.tag) + '</span>' : '') +
        '<span class="cm-ann-t">' + esc(a.title || '公告') + '</span>' +
        (a.date ? '<span class="cm-ann-d">' + esc(a.date) + '</span>' : '') +
        '</div>' +
        (a.body ? '<div class="cm-ann-b">' + nl2br(a.body) + '</div>' : '') +
        '</div>';
    }).join('');
  }

  function decksHtml() {
    var arr = list('DECKS');
    if (!arr.length) return '<div class="cm-empty">暂无玩家卡组</div>';
    return arr.map(function (d, i) {
      var ids = (d.cardIds || []).filter(function (id) { return !CARDS || !!CARDS[id]; });
      var bad = (d.cardIds || []).length - ids.length;
      return '<div class="cm-deck" data-deck="' + i + '">' +
        '<div class="cm-deck-h">' +
        '<span class="cm-deck-n">' + esc(d.name || '未命名卡组') + '</span>' +
        (d.big ? '<span class="cm-deck-big">大卡组</span>' : '') +
        '<span class="cm-deck-a">提供者：' + esc(d.author || '匿名') + '</span>' +
        '</div>' +
        (d.desc ? '<div class="cm-deck-d">' + esc(d.desc) + '</div>' : '') +
        '<div class="cm-deck-c">' + deckCardsHtml(d.cardIds) + '</div>' +
        '<div class="cm-deck-f">' +
        '<span class="cm-deck-cnt">' + ids.length + ' 张' +
        (bad > 0 ? '<span class="cm-warn">（' + bad + ' 张本版本没有，将跳过）</span>' : '') + '</span>' +
        '<button class="pxbtn small cm-add" data-add="' + i + '">加入我的卡组</button>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function groupHtml() {
    var g = data().GROUP;
    if (!g || !g.qq) return '<div class="cm-empty">暂无群信息</div>';
    return '<div class="cm-group">' +
      '<div class="cm-g-ico">💬</div>' +
      '<div class="cm-g-name">' + esc(g.name || '官方群') + '</div>' +
      '<div class="cm-g-qq" id="cmQQ">' + esc(g.qq) + '</div>' +
      '<button class="pxbtn cm-copy" id="cmCopy">复制群号</button>' +
      (g.desc ? '<div class="cm-g-desc">' + nl2br(g.desc) + '</div>' : '') +
      '</div>';
  }

  function bodyHtml() {
    if (curTab === 'decks') return decksHtml();
    if (curTab === 'group') return groupHtml();
    return newsHtml();
  }

  /* ---------------- 面板 DOM ---------------- */
  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'community';
    el.className = 'hidden';
    el.innerHTML =
      '<div class="cm-mask" data-close="1"></div>' +
      '<div class="cm-wrap">' +
      '<div class="cm-head">' +
      '<div class="cm-title">社区</div>' +
      '<div class="cm-tabs">' +
      TABS.map(function (t) {
        return '<button class="cm-tab" data-tab="' + t.key + '">' + t.name + '</button>';
      }).join('') +
      '</div>' +
      '<button class="cm-x" data-close="1" title="关闭">✕</button>' +
      '</div>' +
      '<div class="cm-body"></div>' +
      '<div class="cm-foot dim">内容版本 <span id="cmVer"></span>　·　由 js/community_data.js 提供</div>' +
      '</div>';
    document.body.appendChild(el);

    // 关闭：✕ 或 点遮罩空白
    el.addEventListener('click', function (e) {
      var t = e.target;
      var c = t.getAttribute && t.getAttribute('data-close');
      if (c) { clickSfx(); close(); return; }
      var tb = t.getAttribute && t.getAttribute('data-tab');
      if (tb) { clickSfx(); curTab = tb; render(); return; }
      var ad = t.getAttribute && t.getAttribute('data-add');
      if (ad != null) { clickSfx(); addDeckToMine(+ad, t); return; }
      if (t.id === 'cmCopy') { clickSfx(); copyText((data().GROUP || {}).qq || '', function () { flash(t); }); return; }
      // 卡名 → 卡牌详情浮层
      var cp = t.closest ? t.closest('.cm-chip') : null;
      if (cp && cp.getAttribute('data-tip')) {
        var fn = tipOf();
        if (fn) fn(CARDS[cp.getAttribute('data-tip')]);
      }
    });
    return el;
  }

  function flash(btn) {
    if (!btn) return;
    var old = btn.textContent;
    btn.textContent = '已复制 ✓';
    btn.disabled = true;
    setTimeout(function () { btn.textContent = old; btn.disabled = false; }, 1200);
  }

  function render() {
    ensure();
    var tabs = el.querySelectorAll ? el.querySelectorAll('.cm-tab') : [];
    Array.prototype.forEach.call(tabs, function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === curTab);
    });
    var body = el.querySelector('.cm-body');
    if (body) body.innerHTML = bodyHtml();
    var ver = el.querySelector('#cmVer');
    if (ver) ver.textContent = data().VERSION || '—';
  }

  /* ---------------- 加入卡组器 ---------------- */
  // 把社区卡组复制成自己的一个组卡器方案。
  // 无效卡 id（本版本还没有的卡）跳过；跳过后若不满足构筑规则，仍然允许加入
  // —— 但会明确提示，避免玩家一脸茫然地带着废卡组去打。
  function addDeckToMine(idx, btn) {
    var d = list('DECKS')[idx];
    if (!d) return;
    var src = d.cardIds || [];
    if (!window.SaveData || !SaveData.addDeck) { toast('存档模块不可用'); return; }
    var ids = src.filter(function (id) { return !CARDS || !!CARDS[id]; });
    var skipped = src.length - ids.length;
    if (!ids.length) { toast('这套卡组在当前版本没有可用的卡'); return; }
    var big = !!d.big;
    var v = (window.DeckRules && DeckRules[big ? 'validateBig' : 'validateStarter'])
      ? DeckRules[big ? 'validateBig' : 'validateStarter'](ids) : { ok: true, errors: [] };
    SaveData.addDeck(d.name || '社区卡组', ids, big);
    var msg = '已加入卡组方案【' + (d.name || '社区卡组') + '】' + ids.length + ' 张';
    if (skipped > 0) msg += '；跳过 ' + skipped + ' 张本版本没有的卡';
    if (v && v.ok === false && v.errors && v.errors.length) msg += '。注意：' + v.errors[0];
    toast(msg);
    if (btn) { btn.textContent = '已加入 ✓'; btn.disabled = true; }
    // 通知组卡界面刷新（若正开着）
    if (window.DeckBuilder && DeckBuilder.render) { try { DeckBuilder.render(); } catch (e) { } }
  }

  /* ---------------- 开关 ---------------- */
  function isOpen() { return !!el && !el.classList.contains('hidden'); }
  function open(tab) {
    ensure();
    if (tab) curTab = tab;
    render();
    el.classList.remove('hidden');
    if (window.Sfx && Sfx.play) Sfx.play('click');
  }
  function close() {
    if (!el) return;
    el.classList.add('hidden');
  }
  function toggle() { isOpen() ? close() : open(); }

  /* ---------------- 初始化 ---------------- */
  function init() {
    var btn = document.getElementById('btnCommunity');
    if (btn) btn.addEventListener('click', function () { clickSfx(); toggle(); });
    // Esc 关闭（桌面）
    document.addEventListener('keydown', function (e) {
      if (isOpen() && (e.key === 'Escape' || e.keyCode === 27)) { close(); }
    });
  }
  init();

  window.Community = {
    open: open, close: close, toggle: toggle, isOpen: isOpen,
    render: render, addDeckToMine: addDeckToMine,
    _tab: function () { return curTab; },
    _setTab: function (t) { curTab = t; },
    _html: function () { return bodyHtml(); }      // 供自检：直接取某板块的 HTML
  };
})();
