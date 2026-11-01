/* ============================================================
 * 组卡器  deckbuilder.js
 * 卡池（全部 100 张）→ 卡组（20–50，单卡上限、神器 ≤1）
 * 多套卡组管理，数据经 SaveData 持久化到 localStorage。
 * ========================================================== */
var DeckBuilder = (function () {
  'use strict';

  var editing = { index: 0, name: '', cardIds: [] };
  var filterType = 'all';
  var filterText = '';
  var dirty = false;
  var bigMode = false;   // 大卡组模式：允许 20~40 张（晋升之路用）

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function cardOrder(id) { for (var i = 0; i < CARD_LIST.length; i++) if (CARD_LIST[i].id === id) return i; return 999; }

  /* ---------------- 打开 / 关闭 ---------------- */
  function show() {
    var s = SaveData.get();
    var d = SaveData.activeDeck();
    editing = { index: s.activeDeck, name: d.name, cardIds: d.cardIds.slice() };
    bigMode = !!d.big;
    filterType = 'all'; filterText = ''; dirty = false;
    if ($('dkType')) $('dkType').value = 'all';
    if ($('dkSearch')) $('dkSearch').value = '';
    $('deck').classList.remove('hidden');
    // 竖屏单栏每次打开都回到「卡池」（用户要求：顶部 UI + 剩余大部分都是卡池）
    $('deck').classList.remove('show-deck');
    var tg = $('dkToggle'); if (tg) { tg.textContent = '‹'; tg.title = '查看我的卡组'; }
    curDetail.left = curDetail.right = null;
    var f = $('dkFloat'); if (f) f.classList.add('hidden');
    render();
  }
  function hide() {
    $('deck').classList.add('hidden');
    var f = $('dkFloat'); if (f) f.classList.add('hidden');   // 别把详情浮层留在屏幕上
  }
  function isOpen() { return !$('deck').classList.contains('hidden'); }

  /* "卡组未保存"确认：改用局内确认框（原生 confirm 会把浏览器踢出全屏）。
   * 确认框是异步的 → 改成回调式：confirmDiscard(function () { ...确认后继续... });
   * dirty=false 时仍是同步直接执行，调用方语义不变。 */
  function confirmDiscard(onOK) {
    if (!dirty) { if (onOK) onOK(); return; }
    var msg = '当前卡组尚未保存，确定放弃修改吗？';
    if (window.UI && UI.confirm) UI.confirm(msg, onOK, null, { yes: '放弃修改', no: '继续编辑' });
    else if (window.confirm(msg)) { if (onOK) onOK(); }
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    /* 注意：这里**不**强制复位详情态。
       #dkDetail / #dkPoolDetail 是列表的兄弟节点，不在 innerHTML 重建范围里，
       所以详情内容不会被打乱；而"鼠标还停在卡上时继续显示详情"才是符合直觉的
       （用户移动鼠标离开时由 mouseleave 恢复列表）。 */
    /* ★ 记住滚动位置（2026-10-27 玩家反馈"点卡入卡组时整个卡池上下跳动"）：
       renderPool / renderDeck 是整块 innerHTML 重建，滚动位置会被浏览器重置为 0，
       列表一长就表现为"点一下跳回顶部"。渲染前后保存/恢复即可。 */
    var poolEl = $('dkPool'), deckEl = $('dkDeck');
    var poolScroll = poolEl ? poolEl.scrollTop : 0;
    var deckScroll = deckEl ? deckEl.scrollTop : 0;
    renderTop(); renderTabs(); renderPool(); renderDeck();
    if (poolEl) poolEl.scrollTop = poolScroll;
    if (deckEl) deckEl.scrollTop = deckScroll;
    /* 同步恢复还不够：卡图解码/布局会在下一帧再跑一次，滚动位置会被再次挤动
       （实测点一下从 260 变成 350）。下一帧再校准一次，用户就感觉不到跳动。 */
    if (poolEl || deckEl) {
      if (window.requestAnimationFrame) {
        requestAnimationFrame(function () {
          if (poolEl) poolEl.scrollTop = poolScroll;
          if (deckEl) deckEl.scrollTop = deckScroll;
        });
      }
    }
  }

  function renderTop() {
    if ($('dkNameTxt')) $('dkNameTxt').textContent = editing.name || '未命名';
    var v = bigMode ? DeckRules.validateBig(editing.cardIds) : DeckRules.validateStarter(editing.cardIds);
    var cap = bigMode ? DeckRules.BIG_MAX : Rules.DECK_START;
    $('dkCount').textContent = editing.cardIds.length + ' / ' + cap + ' 张';
    $('dkCount').className = 'dk-count ' + (v.ok ? 'ok' : 'bad');
    $('dkMsg').textContent = v.ok ? '卡组合法 ✓' : v.errors[0];
    $('dkMsg').className = 'dk-msg ' + (v.ok ? 'ok' : 'bad');
    $('dkUse').classList.toggle('disabled', !v.ok);
    // 大卡组模式开关
    var msgEl = $('dkMsg'), host = msgEl.parentNode;
    var tgl = $('dkBig');
    if (!tgl) {
      tgl = document.createElement('button');
      tgl.id = 'dkBig'; tgl.className = 'pxbtn small';
      tgl.style.marginLeft = '8px';
      host.insertBefore(tgl, msgEl.nextSibling);
      tgl.onclick = function () { bigMode = !bigMode; dirty = true; render(); };
    }
    tgl.textContent = bigMode ? '大卡组模式：开（20~40 张）' : '大卡组模式：关（固定 20 张）';
    tgl.style.opacity = bigMode ? '1' : '.75';
  }

  function renderTabs() {
    var s = SaveData.get(), h = '<span class="dk-tablabel">已存卡组</span>';
    s.decks.forEach(function (d, i) {
      h += '<button class="dk-tab' + (i === editing.index ? ' on' : '') + '" data-deck="' + i + '">' +
        esc(d.name) + '<span class="dk-tabn">' + d.cardIds.length + '</span></button>';
    });
    $('dkTabs').innerHTML = h;
  }

  /* 卡池排序：怪物按稀有度 C → B → A → S；道具按卡表里的**类型分块顺序**
     （宝藏 → 投掷物 → 食物 → 药水 → 法杖 → 陷阱 → 戒指 → 神器 → 武器 → 防具 → 卷轴），
     同组内部保持卡表原顺序。
     ⚠ 只按 tier 排会踩坑：道具没有 tier，全都落到兜底档 → 新追加的道具卡（131~140 这批）
       会整批挤到列表最末，而不是回到各自的类型分块里。所以道具必须再按类型分一次组。 */
  var TIER_RANK = { C: 0, B: 1, A: 2, S: 3 };
  var CARD_ORDER = {}, TYPE_RANK = {};
  CARD_LIST.forEach(function (c, i) {
    CARD_ORDER[c.id] = i;
    /* 类型分块顺序直接取"该类型在卡表里第一次出现的位置"，卡表加新块时这里自动跟上 */
    if (c.type !== 'monster' && TYPE_RANK[c.type] === undefined) TYPE_RANK[c.type] = i;
  });
  function groupKey(c) {
    if (c.type === 'monster') {
      var r = TIER_RANK[c.tier];
      return (r === undefined) ? 8 : r;          /* 0~3 = C/B/A/S，无 tier 的怪物排在同组末 */
    }
    var t = TYPE_RANK[c.type];
    return 1000 + (t === undefined ? 9999 : t);   /* 道具整体排在怪物之后，内部按类型分块 */
  }
  function poolList() {
    var arr = CARD_LIST.filter(function (c) {
      if (filterType !== 'all' && c.type !== filterType) return false;
      if (filterText && c.name.toLowerCase().indexOf(filterText.toLowerCase()) < 0) return false;
      return true;
    });
    arr.sort(function (a, b) {
      var ga = groupKey(a), gb = groupKey(b);
      if (ga !== gb) return ga - gb;
      return (CARD_ORDER[a.id] || 0) - (CARD_ORDER[b.id] || 0);
    });
    return arr;
  }

  function renderPool() {
    var cnt = DeckRules.counts(editing.cardIds), h = '';
    poolList().forEach(function (c) {
      var n = cnt[c.id] || 0;
      var can = bigMode ? DeckRules.canAddBig(editing.cardIds, c.id) : DeckRules.canAddStarter(editing.cardIds, c.id);
      h += '<div class="dk-card' + (n > 0 ? ' owned' : '') + (can ? '' : ' full') + '" data-add="' + c.id + '" title="' + esc(c.name + '：' + c.effect) + '">' +
        '<img src="' + cardThumb(c) + '">' +
        '<span class="dk-n">' + (n ? '×' + n : '') + '</span>' +
        '<span class="dk-cn">' + esc(c.name) + (c.tier ? '·' + c.tier : '') + '</span>' +
        '</div>';
    });
    $('dkPool').innerHTML = h || '<div class="dim">没有符合条件的卡牌</div>';
  }

  function renderDeck() {
    var m = DeckRules.counts(editing.cardIds);
    var ids = Object.keys(m).sort(function (a, b) { return cardOrder(a) - cardOrder(b); });
    var h = '';
    ids.forEach(function (id) {
      var c = CARDS[id];
      h += '<div class="dk-row" data-del="' + id + '" title="点击移除一张">' +
        '<img src="' + cardThumb(c) + '">' +
        '<span class="dk-rn">' + esc(c.name) + (c.tier ? ' · ' + c.tier : '') + '</span>' +
        '<span class="dk-rc">×' + m[id] + '<i>/' + c.maxCopies + '</i></span>' +
        '</div>';
    });
    $('dkDeck').innerHTML = h || '<div class="dim">从左侧点击卡牌加入卡组</div>';
    $('dkDeckCount').textContent = '共 ' + editing.cardIds.length + ' 张';
  }

  /* ---------------- 操作 ---------------- */
  function add(id) {
    var ok = bigMode ? DeckRules.canAddBig(editing.cardIds, id) : DeckRules.canAddStarter(editing.cardIds, id);
    if (!ok) {
      var cd = CARDS[id];
      var cnt = DeckRules.counts(editing.cardIds)[id] || 0;
      var cap = bigMode ? DeckRules.BIG_MAX : Rules.DECK_START;
      if (editing.cardIds.length >= cap) { window.UI && UI.toast(bigMode ? ('大卡组最多 ' + cap + ' 张') : ('初始卡组固定 ' + cap + ' 张')); }
      else if (cd && cd.type === 'artifact') { window.UI && UI.toast('神器最多携带 ' + Rules.ARTIFACT_MAX + ' 张'); }
      else { window.UI && UI.toast('【' + (cd ? cd.name : id) + '】已达上限 ' + (cd ? cd.maxCopies : '') + ' 张（当前 ' + cnt + '）'); }
      return;
    }
    editing.cardIds.push(id); dirty = true; render();
  }
  function remove(id) {
    var i = editing.cardIds.indexOf(id);
    if (i >= 0) { editing.cardIds.splice(i, 1); dirty = true; render(); }
  }
  function saveCurrent(quiet) {
    var v = bigMode ? DeckRules.validateBig(editing.cardIds) : DeckRules.validateStarter(editing.cardIds);
    if (!v.ok) { window.UI && UI.toast('卡组不合法：' + v.errors[0]); return false; }
    SaveData.updateDeck(editing.index, editing.name || '卡组', editing.cardIds, bigMode);
    SaveData.setActiveDeck(editing.index);
    dirty = false;
    if (!quiet) { render(); window.UI && UI.toast('已保存卡组【' + (editing.name || '卡组') + '】'); }
    return true;
  }

  /* ---------------- 事件绑定（委托） ---------------- */
  /* ================= 卡牌详情：悬停/滑动即「换掉对面那一栏」 =================
   * 用户明确要求：不再用长按弹浮层，而是
   *   · 鼠标移到/手指滑到 **卡池** 的卡上 → **卡组那一栏** 换成这张卡的详情；离开恢复卡组
   *   · 反过来进 **卡组** 的卡上 → **卡池那一栏** 换成详情；离开恢复卡池
   * 实现上用两个常驻容器 + hidden 切换，不重建 innerHTML（避免闪烁与重排）。
   */
  /* 多形态卡（古神之拳）：组卡器里"按住卡牌 → 循环切换形态预览"。
     ⚠ 只影响**查看**，editing.cardIds 里始终是同一个卡 id，加入卡组的卡不变。 */
  var FIST_FORMS = ['default', 'burn', 'earth', 'rot', 'rust', 'glory', 'shadow'];
  var FIST_NAMES = { default: '默认', burn: '燃烧', earth: '大地', rot: '腐烂', rust: '锈蚀', glory: '辉耀', shadow: '暗影' };
  var fistForm = 'default';
  function formOf(id) { return id === 'a-149-02' ? fistForm : undefined; }

  function detailHtml(id, form) {
    var cd = CARDS[id];
    if (!cd) return '<div class="dim">未知卡</div>';
    var meta = (Rules.TYPE_NAME && Rules.TYPE_NAME[cd.type]) || cd.type || '';
    if (cd.hp != null) meta += ' ｜ ♥' + cd.hp + ' ⚔' + cd.atk;
    var aw = null;
    try { if (typeof awakenOfStar === 'function') aw = awakenOfStar(null); } catch (e) { }
    return '<div class="pv-title">' + esc(cd.name) +
        (cd.tier ? ' <span class="tier t-' + cd.tier + '">' + cd.tier + '</span>' : '') + '</div>' +
      '<img class="pv-img" src="' + cardDetail(cd, form) + '">' +
      '<div class="pv-meta">' + esc(meta) + '</div>' +
      /* 形态卡：文字跟着形态一起换（否则"图上写燃烧、下面写默认"自相矛盾） */
      '<div class="pv-effect">' + ((cd.forms && form && cd.forms[form]) || cd.effect || '') + '</div>' +
      (aw ? '<div class="pv-awaken"><div class="pv-aw-h">觉醒 · ' + aw.name + '</div>' + aw.desc + '</div>' : '') +
      (cd.id === 'a-149-02'
        ? '<div class="dk-detailfoot dim">当前：' + (FIST_NAMES[form || 'default'] || '默认') + '形态　·　按住卡牌或点下方按钮切换</div>' +
          '<button class="pxbtn dk-fist-btn" data-fist-cycle="1">切换形态</button>'
        : '<div class="dk-detailfoot dim">离开卡牌即可返回列表</div>');
  }
  // side: 'right' = 卡池的卡 → 详情显示在卡组栏；'left' = 卡组的卡 → 详情显示在卡池栏
  var curDetail = { left: null, right: null };

  /* 竖屏（body.portrait-mode）下只有一栏，"换掉对面那一栏"不成立，
     改成 body 级浮层 #dkFloat，并**贴到所看卡牌的另一半屏**（卡在上半屏 → 浮层贴下，
     卡在下半屏 → 浮层贴上），保证详情永远不盖住正在看的那张卡（用户要求）。 */
  function isPortrait() {
    return document.body && document.body.classList.contains('portrait-mode');
  }
  /* ★ 详情自适应：渲染后测量内容 vs 容器，超出就整体 scale 压进去 ——
     用户 2026-10-26 要求「无需滑动即可看清全貌」，三个详情容器（#dkDetail /
     #dkPoolDetail / #dkFloat）统一走这套。卡图异步加载完高度会变，load 后重算。 */
  function applyFit(box, inner) {
    inner.style.transform = 'none';
    var aw = box.clientWidth, ah = box.clientHeight;
    if (!aw || !ah) return;
    var nh = inner.scrollHeight, nw = inner.scrollWidth;
    var k = Math.min(1, ah / Math.max(1, nh), aw / Math.max(1, nw));
    if (k < 1) inner.style.transform = 'scale(' + k + ')';
  }
  function fitDetailInto(box) {
    if (!box) return;
    var inner = box.querySelector('.pv-fit');
    if (!inner) return;
    applyFit(box, inner);
    /* 卡图异步加载完高度会变 → load 后重算。缓存图 complete=true 不会再发 load，
       直接补测一次（applyFit 不绑事件，不会无限递归）。 */
    var imgs = inner.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      (function (im) {
        function refit() { applyFit(box, inner); }
        if (im.complete) refit();
        else { im.addEventListener('load', refit); im.addEventListener('error', refit); }
      })(imgs[i]);
    }
  }
  /* ★ 覆盖式详情：让详情窗精确叠在列表框上（位置、大小 = 原框，分毫不差）。
     用户 2026-10-26 要求：不得大于原出现框、不改变原框、不替代整栏 —— 列表保持可见，
     详情只是浮在上面。定位相对列表的父容器（.dk-right）计算，窗口缩放后下次显示会重算。 */
  function overlayDetail(detEl, listEl) {
    var host = listEl.parentNode;
    if (!host || !host.getBoundingClientRect) return;
    var hr = host.getBoundingClientRect(), lr = listEl.getBoundingClientRect();
    if (!hr.height && !hr.width) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    detEl.style.position = 'absolute';
    detEl.style.left = (lr.left - hr.left) + 'px';
    detEl.style.top = (lr.top - hr.top) + 'px';
    detEl.style.width = lr.width + 'px';
    detEl.style.height = lr.height + 'px';
    detEl.style.maxHeight = 'none';
  }
  function showFloat(id, srcEl) {
    var f = $('dkFloat');
    if (!f) return false;
    var mid = (window.innerHeight || 720) / 2;
    var y = null;
    if (srcEl && srcEl.getBoundingClientRect) {
      var r = srcEl.getBoundingClientRect();
      if (r.height || r.top) y = r.top + r.height / 2;
    }
    if (y == null) y = mid;                       // 拿不到位置就居中分屏：卡多半在列表里，安全
    var h = f.offsetHeight || Math.round((window.innerHeight || 720) * 0.46);
    var top;
    if (y < mid) top = Math.min((window.innerHeight || 720) - h - 6, mid + 6);  // 卡在上半 → 浮层贴下
    else top = 6;                                                                  // 卡在下半 → 浮层贴上
    top = Math.max(6, top);
    f.style.top = top + 'px';
    f.style.maxHeight = Math.max(120, mid - 12) + 'px';
    f.innerHTML = '<div class="pv-fit">' + detailHtml(id, formOf(id)) + '</div>';
    f.classList.remove('hidden');
    fitDetailInto(f);
    return true;
  }
  function hideFloat() {
    var f = $('dkFloat');
    if (f) f.classList.add('hidden');
  }
  function showDetail(side, id, srcEl) {
    var fEl = $('dkFloat');
    // 同一张卡且浮层已经显示着 → 不用重画（省掉每像素抖动时的重复布局）
    if (curDetail[side] === id && (!isPortrait() || (fEl && !fEl.classList.contains('hidden')))) return;
    curDetail[side] = id;
    if (isPortrait()) { if (showFloat(id, srcEl)) return; }
    var listEl = $(side === 'right' ? 'dkDeck' : 'dkPool');
    var detEl = $(side === 'right' ? 'dkDetail' : 'dkPoolDetail');
    if (!listEl || !detEl) return;
    detEl.innerHTML = '<div class="pv-fit">' + detailHtml(id, formOf(id)) + '</div>';
    /* ★ 不再把对面整栏换掉（用户 2026-10-26 反馈）：列表保持可见，
       详情浮层**覆盖**在它应当出现的位置上（= 列表框原样），大小不超原框。
       side='right'（卡池点卡）→ 详情覆盖卡组栏列表；
       side='left'（卡组点卡）→ #dkPoolDetail 原本就是卡池上方的居中浮窗，维持 CSS 定位。 */
    if (side === 'right') overlayDetail(detEl, listEl);
    detEl.classList.remove('hidden');
    fitDetailInto(detEl);
  }
  function hideDetail(side) {
    if (curDetail[side] == null) return;
    curDetail[side] = null;
    if (isPortrait()) { hideFloat(); return; }
    var detEl = $(side === 'right' ? 'dkDetail' : 'dkPoolDetail');
    if (detEl) detEl.classList.add('hidden');
  }
  function hideAllDetail() {
    curDetail.left = curDetail.right = null;
    hideFloat();
    var ld = $('dkDetail'), rd = $('dkPoolDetail');
    if (ld) ld.classList.add('hidden');
    if (rd) rd.classList.add('hidden');
  }

  /* 给一侧列表绑「悬停 / 手指滑过 → 对面换详情」。
   * attr：卡牌元素上的属性名（data-add / data-del）
   * side：详情要显示到哪一栏（'right' 卡池 → 卡组栏；'left' 卡组 → 卡池栏）
   *
   * 触屏要点：pointermove 的 target 始终是按下时的元素（隐式指针捕获），
   * 所以手指滑过卡牌时必须用 elementFromPoint 重新取"现在指到哪张卡"。
   */
  function hoverDetail(containerId, attr, side) {
    var box = $(containerId);
    if (!box) return;
    function cardAt(e) {
      if (e.pointerType && e.pointerType !== 'mouse') {
        var el = document.elementFromPoint(e.clientX, e.clientY);
        return el && el.closest ? el.closest('[' + attr + ']') : null;
      }
      return e.target && e.target.closest ? e.target.closest('[' + attr + ']') : null;
    }
    box.addEventListener('mousemove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      var el = cardAt(e);
      if (el) showDetail(side, el.getAttribute(attr), el);
      else hideDetail(side);
    });
    box.addEventListener('mouseleave', function () { hideDetail(side); });
    // 触屏：按下即看，滑动时跟着手指换卡，抬手恢复
    // ⚠ 同时要把"这次手势滑动过"记到 gestureMoved：轻点加入/移除靠它过滤误触
    //   （手指滑过卡池浏览时，pointerup 后浏览器仍会补一个 click）。
    var touching = false, sx = 0, sy = 0;
    box.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      touching = true; gestureMoved = false; sx = e.clientX; sy = e.clientY;
      var el = cardAt(e);
      if (el) showDetail(side, el.getAttribute(attr), el);
    });
    box.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'mouse' || !touching) return;
      if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) gestureMoved = true;
      var el = cardAt(e);
      if (el) showDetail(side, el.getAttribute(attr), el);
      else hideDetail(side);
    });
    function end(e) {
      if (!touching) return;
      touching = false;
      hideDetail(side);
    }
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('pointerleave', end);
  }

  // 触屏：轻点即加入 / 移除。用"这次手势有没有滑动过 / 有没有触发长按看详情"过滤误触，
  // 不再要求双击 —— 翻看卡池时手指抬起产生的 click 不会误加卡（滑动、长按都被排除在外）。
  // 按"最近一次输入是不是手指"判断，而不是按设备 —— 带触摸屏的电脑用鼠标时行为一致。
  var lastInputTouch = false, gestureMoved = false, gestureHeld = false;
  document.addEventListener('pointerdown', function (e) {
    lastInputTouch = (e.pointerType === 'touch');
    /* ★ 每次新手势都清掉上一手势的「长按查看」标记 ——
       之前 gestureHeld 只在长按古神之拳切形态时置 true、从不重置，
       只要按住超过 450ms 一次，之后 tapAdd 就把**所有**点击当成长按，
       表现为「点击卡牌无法加入/移除卡组」（用户 2026-10-26 反馈）。
       cycle() 的 450ms 定时器在本事件之后才触发，顺序不受影响。 */
    gestureHeld = false;
  }, true);
  function tapAdd(fn) {
    if (lastInputTouch && (gestureMoved || gestureHeld)) return;   // 滑动浏览 / 长按看详情 → 不算轻点
    fn();
  }

  /* ---------------- 切换卡组 / 改名面板 ----------------
   * 手机端：顶栏被收进最左一栏，"已存卡组"标签挤在窄栏里很难点到，
   * 故在卡组名旁加一个入口，点开即可改名 + 看到完整卡组列表并切换（弹窗沿用全局 #modal，已做限高滚动）。 */
  function openSwitch() {
    var m = $('modal');
    if (!m) return;
    var s = SaveData.get();
    var h = '<div class="mbox dk-switch">' +
      '<h3>切换卡组 / 改名</h3>' +
      '<div class="pf-note">当前编辑：' + esc(editing.name) + '（' + editing.cardIds.length + ' 张）</div>' +
      '<div class="dk-swname">' +
      '<input id="dkSwName" class="pf-name-input" maxlength="12" value="' + esc(editing.name) + '" placeholder="卡组名">' +
      '<button id="dkSwRename" class="pxbtn">改名</button></div>' +
      '<div class="dk-swlist">';
    s.decks.forEach(function (d, i) {
      var cur = (i === editing.index);
      h += '<div class="dk-swrow' + (cur ? ' cur' : '') + '" data-sw="' + i + '">' +
        '<span class="dk-swn">' + esc(d.name) + '</span>' +
        '<span class="dk-swc">' + d.cardIds.length + ' 张' + (d.big ? '　大卡组' : '') + '</span>' +
        '<span class="dk-swb">' + (cur ? '编辑中' : '切换 ▶') + '</span></div>';
    });
    h += '</div><div class="mbtns"><button id="dkSwClose" class="pxbtn ghost">关闭</button></div></div>';
    m.innerHTML = h;
    m.classList.remove('hidden');
    $('dkSwClose').onclick = function () { m.classList.add('hidden'); };
    $('dkSwRename').onclick = function () {
      var v = ($('dkSwName').value || '').trim();
      if (!v) { window.UI && UI.toast('卡组名不能为空'); return; }
      editing.name = v; dirty = true; render();
      var ok = saveCurrent(true);        // 改名即保存：不需要再手动点一次「保存卡组」
      openSwitch();
      window.UI && UI.toast(ok ? ('已改名为【' + v + '】并保存') : ('已改名【' + v + '】，但卡组还不合法，未保存'));
    };
    Array.prototype.forEach.call(m.querySelectorAll('[data-sw]'), function (el) {
      el.onclick = function () {
        var i = +el.dataset.sw;
        if (i === editing.index) { m.classList.add('hidden'); return; }
        confirmDiscard(function () {
          var d = SaveData.get().decks[i];
          editing = { index: i, name: d.name, cardIds: d.cardIds.slice() };
          SaveData.setActiveDeck(i);
          dirty = false; render();
          m.classList.add('hidden');
          window.UI && UI.toast('已切换到【' + d.name + '】');
        });
      };
    });
  }
  function closeSwitch() { var m = $('modal'); if (m) m.classList.add('hidden'); }

  /* ===== 古神之拳：按住卡池里的卡 450ms → 循环切换形态预览 =====
     ⚠ 只改**显示**（卡片缩略图 + 详情图），editing.cardIds 里始终是同一个 a-149-02，
       加入卡组的永远是同一张卡，不受预览形态影响。 */
  (function bindFistFormHold() {
    var timer = null;
    /* 卡池（data-add）和卡组栏（data-del）**都能**按住切换 ——
       之前只绑了卡池，所以"按住卡组里那张"没反应。 */
    var SEL = '[data-add="a-149-02"],[data-del="a-149-02"]';
    function cycle(el) {
      var i = FIST_FORMS.indexOf(fistForm);
      fistForm = FIST_FORMS[(i + 1) % FIST_FORMS.length];
      if (el) {
        var img = el.querySelector('img');
        if (img) img.src = cardThumb(CARDS['a-149-02'], fistForm === 'default' ? '' : fistForm);
      }
      /* 两边的缩略图都刷一下（卡池 + 卡组栏），保持同步 */
      var all = document.querySelectorAll(SEL);
      for (var k = 0; k < all.length; k++) {
        var im2 = all[k].querySelector('img');
        if (im2) im2.src = cardThumb(CARDS['a-149-02'], fistForm === 'default' ? '' : fistForm);
      }
      curDetail.right = null; curDetail.left = null;         // showDetail 对"同一张卡"会短路，这里强制重画
      /* ⚠ 详情画在哪一侧取决于卡片来自哪一栏：
         卡池（data-add）→ 显示在**卡组栏**（side='right'）；
         卡组（data-del）→ 显示在**卡池栏**（side='left'）。
         之前一律传 'right'，在卡组栏右键时详情被画到另一侧，用户看到的那块完全没变。 */
      var side = (el && el.hasAttribute && el.hasAttribute('data-del')) ? 'left' : 'right';
      showDetail(side, 'a-149-02', el);
      gestureHeld = true;                                    // 让 tapAdd 把这次手势当"长按查看"，不误加卡
      if (window.UI && UI.toast) UI.toast('古神之拳：' + (FIST_NAMES[fistForm] || '默认') + '形态');
    }
    function disarm() { if (timer) { clearTimeout(timer); timer = null; } }
    document.addEventListener('pointerdown', function (e) {
      var el = e.target && e.target.closest ? e.target.closest(SEL) : null;
      if (!el) return;
      disarm();
      timer = setTimeout(function () { timer = null; cycle(el); }, 450);
    }, true);
    /* 电脑端主入口：**右键点击**卡牌切换形态。
       详情浮层在另一栏，鼠标一离开源卡片就收起来了，里面的按钮根本点不到（玩家反馈）。 */
    document.addEventListener('contextmenu', function (e) {
      var el = e.target && e.target.closest ? e.target.closest(SEL) : null;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      cycle(el);
    }, true);
    /* 按钮兜底（触屏/浮层常驻时可用） */
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-fist-cycle]') : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      cycle(null);
    }, true);
    document.addEventListener('pointerup', disarm, true);
    document.addEventListener('pointercancel', disarm, true);
    document.addEventListener('pointerleave', disarm, true);
  })();

  function bind() {
    /* 悬停/滑过 → 对面那一栏换成详情（取代原来的长按浮层）。
       卡池的卡 → 显示在卡组栏；卡组的卡 → 显示在卡池栏。
       竖屏（body.portrait-mode）下只有一栏，改由 #dkFloat 浮层接手（见 showDetail）。 */
    hoverDetail('dkPool', 'data-add', 'right');
    hoverDetail('dkDeck', 'data-del', 'left');
    if ($('dkName')) $('dkName').addEventListener('click', openSwitch);   // 点卡组名 → 改名 / 切换卡组
    /* 竖屏单栏：#dkToggle 在「卡池」与「我的卡组」之间来回切（横屏下按钮 display:none，不生效）。 */
    if ($('dkToggle')) $('dkToggle').addEventListener('click', function () {
      hideAllDetail();                       // 切换前收起详情，避免残留半屏浮层
      var d = $('deck');
      var toDeck = !d.classList.contains('show-deck');
      d.classList.toggle('show-deck', toDeck);
      this.textContent = toDeck ? '›' : '‹';   // 竖排字形：› = 回到卡池，‹ = 去看卡组
      this.title = toDeck ? '回到卡池' : '查看我的卡组';
    });
    $('dkPool').addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-add]');
      if (el) tapAdd(function () { add(el.dataset.add); });
    });
    $('dkDeck').addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-del]');
      if (el) tapAdd(function () { remove(el.dataset.del); });
    });
    $('dkTabs').addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-deck]');
      if (!el) return;
      var i = +el.dataset.deck;
      confirmDiscard(function () {
        var d = SaveData.get().decks[i];
        editing = { index: i, name: d.name, cardIds: d.cardIds.slice() };
        SaveData.setActiveDeck(i);
        dirty = false; render();
      });
    });

    $('dkType').addEventListener('change', function () { filterType = $('dkType').value; renderPool(); });
    $('dkSearch').addEventListener('input', function () { filterText = $('dkSearch').value; renderPool(); });
    $('dkClear').addEventListener('click', function () {
      if (!editing.cardIds.length) return;
      var doClear = function () { editing.cardIds = []; dirty = true; render(); };
      if (window.UI && UI.confirm) UI.confirm('确定清空当前卡组？', doClear);
      else if (window.confirm('确定清空当前卡组？')) doClear();
    });
    $('dkSave').addEventListener('click', function () { saveCurrent(false); });
    $('dkNew').addEventListener('click', function () {
      confirmDiscard(function () {
        var i = SaveData.addDeck('新卡组', []);
        editing = { index: i, name: '新卡组', cardIds: [] };
        dirty = false; render();
      });
    });
    $('dkDelete').addEventListener('click', function () {
      if (SaveData.get().decks.length <= 1) { window.UI && UI.toast('至少保留一套卡组'); return; }
      var doDel = function () {
        SaveData.removeDeck(editing.index);
        var s = SaveData.get(), d = s.decks[Math.min(editing.index, s.decks.length - 1)];
        editing = { index: s.decks.indexOf(d), name: d.name, cardIds: d.cardIds.slice() };
        dirty = false; render();
      };
      var delMsg = '确定删除卡组【' + editing.name + '】？';
      if (window.UI && UI.confirm) UI.confirm(delMsg, doDel, null, { yes: '删除', no: '取消' });
      else if (window.confirm(delMsg)) doDel();
    });
    $('dkUse').addEventListener('click', function () {
      if (!saveCurrent(true)) return;
      window.UI && UI.toast('已选用【' + editing.name + '】');
      hide();
      if (window.UI) UI.refreshMenu();
    });
    $('dkClose').addEventListener('click', function () {
      confirmDiscard(function () {
        hide();
        if (window.UI) UI.refreshMenu();
      });
    });
  }

  return { show: show, hide: hide, isOpen: isOpen, bind: bind, render: render,
    openSwitch: openSwitch, closeSwitch: closeSwitch };
})();
