/* ============================================================
 * 学院考核 · 界面  academy_ui.js
 *  入口（当前一届 / 报名 / 历届考核排名）→ 备战页（对手卡组 / 我的卡组 / 背包 / 等级 / 出售 / 商店）
 *  → 自动对战（UI.startAcademyBattle）→ 本轮战报 → 下一轮 / 最终排名
 * ========================================================== */
var AcademyUI = (function () {
  'use strict';

  var C = ACADEMY_CONF;
  var $ = function (id) { return document.getElementById(id); };
  var drag = null, ghost = null, dragMoved = false;
  var shopAutoRound = -1;      // 已自动打开过商店的轮次（每回合只自动开一次）

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function thumb(id) { return cardThumb(CARDS[id]); }
  function nm(id) { return CARDS[id] ? CARDS[id].name : id; }
  function toast(m) { if (window.UI) UI.toast(m); }

  /* ---------------- 屏幕切换 ---------------- */
  function open() {
    $('academy').classList.remove('hidden');
    ['menu', 'battle', 'deck', 'map', 'tour', 'runpanel'].forEach(function (id) { var e = $(id); if (e) e.classList.add('hidden'); });
  }
  function show() { open(); Academy.load(); render(); }
  function backToMenu() { $('academy').classList.add('hidden'); UI.showMenu(); }

  function render() {
    var st = Academy.get();
    if (!st || st.stage === 'done') return renderEntry();
    if (st.stage === 'battle') return;                 // 战斗由 UI.startAcademyBattle 接管
    if (st.stage === 'result') return renderResult();
    maybePerkPick();                                   // 有升级待选特技 → 先弹三选一
    return renderPrep();
  }

  /* ---------------- 升级三选一（特技） ----------------
   * 每次升级 Academy 会往 perkPick 里压一批候选；这里弹窗让玩家选一个。
   * 一次升多级 → 选完一批还有，会连续弹。 */
  function maybePerkPick() {
    if (typeof PERK_DATA === 'undefined' || !window.UI) return false;
    var E = Academy.me();
    if (!E || !E.perkPick || !E.perkPick.length) return false;
    var m = $('modal'); if (!m) return false;
    var ids = E.perkPick[0];
    m.classList.remove('hidden');
    var h = '<div class="mbox ac-perk"><h3>升级！选择一项特技</h3>' +
      '<p class="dim">稀有度越高的特技越强。本局已获得 ' + ((E.perks || []).length) + ' 项。</p>' +
      '<div class="ac-perklist">';
    ids.forEach(function (id, i) {
      var p = PERK_DATA.byId[id]; if (!p) return;
      var rare = PERK_DATA.RARITY[p.rarity], cat = PERK_DATA.CAT[p.cat];
      h += '<button class="ac-perkcard" data-pk="' + i + '" style="border-color:' + (rare ? rare.color : '#666') + '">' +
        '<span class="pk-top"><span class="pk-rar" style="color:' + (rare ? rare.color : '#fff') + '">' +
        (rare ? rare.name : '') + '</span><span class="pk-cat" style="color:' + (cat ? cat.color : '#fff') + '">' +
        (cat ? cat.name : '') + '</span></span>' +
        '<b>' + esc(p.name) + '</b><em>' + esc(p.desc) + '</em></button>';
    });
    h += '</div></div>';
    m.innerHTML = h;
    Array.prototype.forEach.call(m.querySelectorAll('[data-pk]'), function (btn) {
      btn.onclick = function () {
        Sfx.play('click');
        Academy.pickPerk(+btn.dataset.pk);
        m.classList.add('hidden');
        m.innerHTML = '';
        render();                                      // 还有待选就继续弹
      };
    });
    return true;
  }

  /* ---------------- 入口 / 历届 ---------------- */
  function renderEntry() {
    var st = Academy.get();
    var h = '<div class="ac-wrap ac-entry"><h1 class="ac-title">学院考核</h1>' +
      '<p class="dim">雪景学院的考核：8 位考生各持 ' + C.START_HP + ' 点生命。用「学时」运营等级与卡组，' +
      '双方 AI 自动对战比总输出，输出低者按差额扣生命，归零淘汰——比的是牌组构筑能力。</p>';
    if (st && st.stage !== 'done') {
      h += '<p class="ac-live">第 ' + st.no + ' 届进行中　·　第 ' + st.round + ' 轮　·　存活 ' + Academy.alive().length +
        ' 人　·　我的生命 ' + Academy.me().hp + '　·　等级 Lv' + Academy.me().lv + '</p>' +
        '<div class="ac-btns"><button id="acContinue" class="pxbtn">继续考核</button>' +
        '<button id="acAbandon" class="pxbtn ghost">放弃本届</button>' +
        '<button id="acHist" class="pxbtn ghost">历届考核排名</button>' +
        '<button id="acBack" class="pxbtn ghost">返回主菜单</button></div>';
    } else if (st && st.stage === 'done') {
      h += '<p class="ac-live">第 ' + st.no + ' 届已落幕　·　第一名 ' + esc(st.result.champion) + '　·　你的排名：第 ' + st.result.playerRank + ' 名</p>' +
        '<div class="ac-btns"><button id="acNew" class="pxbtn">参加下一届</button>' +
        '<button id="acHist" class="pxbtn ghost">历届考核排名</button>' +
        '<button id="acBack" class="pxbtn ghost">返回主菜单</button></div>';
    } else {
      h += '<div class="ac-btns"><button id="acNew" class="pxbtn">报名参加</button>' +
        '<button id="acHist" class="pxbtn ghost">历届考核排名</button>' +
        '<button id="acBack" class="pxbtn ghost">返回主菜单</button></div>';
    }
    h += '</div>';
    $('academy').innerHTML = h;
    if ($('acNew')) $('acNew').onclick = function () { Sfx.play('click'); Academy.startRun(); render(); };
    if ($('acContinue')) $('acContinue').onclick = function () { Sfx.play('click'); render(); };
    if ($('acAbandon')) $('acAbandon').onclick = function () {
      var doAbandon = function () { Academy.abandon(); render(); };
      if (window.UI && UI.confirm) UI.confirm('放弃本届考核？当前进度将丢失。', doAbandon, null, { yes: '放弃本届', no: '继续考核' });
      else if (window.confirm('放弃本届考核？当前进度将丢失。')) doAbandon();
    };
    if ($('acHist')) $('acHist').onclick = function () { Sfx.play('click'); renderHistory(); };
    if ($('acBack')) $('acBack').onclick = function () { Sfx.play('click'); backToMenu(); };
  }

  function renderHistory() {
    var hist = SaveData.getAcademyHistory();
    var h = '<div class="ac-wrap ac-entry"><h1 class="ac-title">历届考核排名</h1>';
    if (!hist.length) h += '<p class="dim">暂无历届记录。</p>';
    else {
      h += '<div class="ac-hist">';
      hist.slice().reverse().forEach(function (rec, ri) {
        var idx = hist.length - 1 - ri;
        h += '<div class="ac-histrow" data-hs="' + idx + '"><span class="ac-histno">第 ' + rec.no + ' 届</span>' +
          '<span class="ac-histchamp">第一名：' + esc(rec.champion) + (rec.championIsPlayer ? '（你）' : '') + '</span>' +
          '<span class="ac-histrank">我的排名：第 ' + rec.playerRank + ' 名</span></div>';
      });
      h += '</div>';
    }
    h += '<div class="ac-btns"><button id="acHistBack" class="pxbtn ghost">返回</button></div></div>';
    $('academy').innerHTML = h;
    Array.prototype.forEach.call($('academy').querySelectorAll('[data-hs]'), function (el) {
      el.onclick = function () { renderHistoryDetail(+el.dataset.hs); };
    });
    $('acHistBack').onclick = function () { render(); };
  }
  function renderHistoryDetail(idx) {
    var rec = SaveData.getAcademyHistory()[idx];
    if (!rec) return renderHistory();
    var h = '<div class="ac-wrap ac-entry"><h2 class="ac-title">第 ' + rec.no + ' 届 · 最终排名</h2>' +
      '<p class="ac-live">第一名 ' + esc(rec.champion) + '　·　你的排名：第 ' + rec.playerRank + ' 名</p><div class="ac-hist">';
    (rec.table || []).forEach(function (r) {
      h += '<div class="ac-histrow' + (r.isPlayer ? ' me' : '') + '"><span class="ac-rank">#' + r.rank + '</span>' +
        '<span>' + esc(r.name) + '</span><span class="dim">' + esc(r.arch || '') + '　Lv' + r.lv + '　剩余生命 ' + r.hp + '　累计输出 ' + r.total + '</span></div>';
    });
    h += '</div><div class="ac-btns"><button id="acHistBack" class="pxbtn ghost">返回历届考核排名</button></div></div>';
    $('academy').innerHTML = h;
    $('acHistBack').onclick = function () { renderHistory(); };
  }

  /* ---------------- 备战页 ---------------- */
  function cardRow(cards, zone, cls) {
    var h = '';
    if (!cards.length) h += '<span class="dim">（空）—— 点右下角「商店」购买卡牌</span>';
    cards.forEach(function (card, i) {
      var id = ACADEMY_DATA.idOf(card), star = ACADEMY_DATA.starOf(card);
      var cd = CARDS[id];
      // 3★ 觉醒词条：词条是【合成那一刻】抽定、并写在这张卡实例上的（academy.js tryMerge），
      // 所以备战页就能看到这张卡会觉醒成什么，不必等上场。
      var awId = ACADEMY_DATA.awakenOfEntry(card);
      var aw = (awId && typeof awakenInfo === 'function') ? awakenInfo(awId) : null;
      h += '<div class="ac-card' + (cls ? ' ' + cls : '') + '" data-zone="' + zone + '" data-idx="' + i + '" data-card="' + id + '" data-tip="' + id + '"' +
        (awId ? ' data-tip-aw="' + esc(awId) + '"' : '') + '>' +
        '<img src="' + thumb(id) + '">' + (cd.tier ? '<span class="tier t-' + cd.tier + '">' + cd.tier + '</span>' : '') +
        (star > 1 ? '<span class="ac-star">' + new Array(star + 1).join('★') + '</span>' : '') +
        (aw ? '<span class="ac-awaken" title="觉醒：' + esc(aw.desc) + '">' + esc(aw.name) + '</span>' : '') +
        '<span class="ac-cname">' + esc(cd.name) + '</span>' +
        '<span class="ac-price">售' + ACADEMY_DATA.sellOf(card) + '</span></div>';
    });
    return h;
  }

  function renderPrep() {
    var st = Academy.get(), me = Academy.me();
    var opp = Academy.oppOf(0);
    var cap = ACADEMY_DATA.deckCap(me.lv);
    var need = ACADEMY_DATA.expNeed(me.lv);
    // ac-prep：矮屏（手机横屏）专用布局钩子；三个 ac-sec 带 id，供 CSS 精确排位（见 academy.css 末尾）
    var h = '<div class="ac-wrap ac-prep">' +
      '<div class="ac-head"><span class="ac-title">' + C.NAME + ' · 第 ' + st.round + ' 轮</span>' +
      '<span class="ac-hp">生命 ' + me.hp + '/' + C.START_HP + '</span>' +
      '<span class="ac-xue">学时 ' + me.xue + '</span>' +
      '<span class="ac-lv">等级 Lv' + me.lv + '</span>' +
      '<span class="dim">存活 ' + Academy.alive().length + ' 人　·　战斗回合上限 ' + ACADEMY_DATA.roundLimit(st.round) + '</span>' +
      '<span class="spacer"></span>' +
      '<button id="acQuit" class="pxbtn ghost small">放弃本届</button></div>';

    // 上：下一个对手
    h += '<div class="ac-sec" id="acSecOpp"><div class="ac-sec-t">下一位对手：' + (opp ? esc(opp.name) : '—') +
      (opp ? '<span class="dim">　生命 ' + opp.hp + '　Lv' + opp.lv + '　卡组 ' + opp.deck.length + ' 张</span>' : '<span class="dim">本轮轮空，休息并领取补偿学时</span>') +
      '</div><div class="ac-cards" id="acOppDeck">' + (opp ? cardRow(opp.deck, 'opp', 'ro') : '<span class="dim">（轮空）</span>') + '</div></div>';

    // 中：我的卡组
    h += '<div class="ac-sec" id="acSecDeck"><div class="ac-sec-t">我的卡组' +
      '<span class="dim">　' + me.deck.length + '/' + cap + ' 张（战斗时洗入牌库）</span>' +
      '<span class="ac-tip">触屏：长按拖动 · 上下滑翻看</span></div>' +
      '<div class="ac-cards ac-drop" id="acMyDeck" data-drop="deck">' + cardRow(me.deck, 'deck') + '</div></div>';

    // 下：背包（上限含特技【背包扩容】bagAdd，否则拿了特技会显示"14/14 已满"却还能继续装）
    var bagCap = C.BAG_CAP + Academy.perkMod(me, 'bagAdd');
    h += '<div class="ac-sec" id="acSecBag"><div class="ac-sec-t">背包（未上场备用）' +
      '<span class="dim">　' + me.bag.length + '/' + bagCap + ' 张</span></div>' +
      '<div class="ac-cards ac-drop" id="acMyBag" data-drop="bag">' + cardRow(me.bag, 'bag') + '</div></div>';

    // 底部：等级（左）/ 出售区 / 商店与开战（右）
    h += '<div class="ac-bottom">' +
      '<div class="ac-bl ac-drop" data-drop="sell" id="acSellL">' +
      '<div class="ac-lvinfo"><span>等级 <b>Lv' + me.lv + '</b></span>' +
      '<span>经验 <b>' + me.exp + '/' + (me.lv >= C.MAX_LEVEL ? '—' : need) + '</b></span>' +
      '<span>卡组上限 <b>' + cap + '</b>　背包 ' + me.bag.length + '/' + bagCap + '</span></div>' +
      '<div class="ac-lvbtns">' +
      '<button id="acBuyExp" class="pxbtn small">购买经验（1 点 = ' + C.EXP_BUY_COST + ' 学时）</button>' +
      '<button id="acBuyLv" class="pxbtn small">直升下一级（' + (me.lv >= C.MAX_LEVEL ? '—' : ACADEMY_DATA.levelBuyCost(me) + ' 学时') + '）</button>' +
      '</div><div class="ac-sellhint">↙ 拖到左下或右下角出售（回价 ' + Math.round(C.SELL_RATIO * 100) + '%）</div></div>' +
      '<div class="ac-br ac-drop" data-drop="sell" id="acSellR">' +
      '<button id="acShopBtn" class="pxbtn">商店</button>' +
      '<button id="acStartBtn" class="pxbtn">开始本轮考核</button>' +
      '<div class="dim small">每回合自动刷新商店；' + (opp ? '对战：' + esc(opp.name) : '本轮轮空') + '</div></div>' +
      '</div></div>';

    $('academy').innerHTML = h;
    bindPrep();
    // 每回合开始时默认打开商店
    if (shopAutoRound !== st.round) { shopAutoRound = st.round; renderShop(); }
  }

  function bindPrep() {
    if ($('acQuit')) $('acQuit').onclick = function () {
      var doAbandon = function () { Academy.abandon(); render(); };
      if (window.UI && UI.confirm) UI.confirm('放弃本届考核？当前进度将丢失。', doAbandon, null, { yes: '放弃本届', no: '继续考核' });
      else if (window.confirm('放弃本届考核？当前进度将丢失。')) doAbandon();
    };
    if ($('acBuyExp')) $('acBuyExp').onclick = function () {
      Sfx.play('click');
      var r = Academy.buyExp(1);
      if (!r.ok) toast(r.msg); else if (r.up) toast('升级成功！');
      render();
    };
    if ($('acBuyLv')) $('acBuyLv').onclick = function () {
      Sfx.play('click');
      var r = Academy.buyLevel();
      toast(r.ok ? '已购买等级' : r.msg);
      render();
    };
    // 先关掉可能已自动打开的商店，否则会叠出第二个遮罩（关掉一个还剩一个）
    if ($('acShopBtn')) $('acShopBtn').onclick = function () { Sfx.play('click'); closeShop(); renderShop(); };
    if ($('acStartBtn')) $('acStartBtn').onclick = function () { Sfx.play('click'); startAcademyBattle(); };
    bindDrag();
  }

  /* ---------------- 商店 ---------------- */
  function renderShop() {
    var st = Academy.get(), me = Academy.me();
    var h = '<div class="ac-shop"><div class="ac-shopbox">' +
      '<h3>学院商店<span class="dim">　学时 ' + me.xue + '　等级 Lv' + me.lv + '</span></h3>';
    var allLocked = st.shop.slots.some(function (s) { return s && s.locked; });
    h += '<div class="ac-shopmain"><button id="acLockAll" class="pxbtn ghost ac-lockall' + (allLocked ? ' on' : '') + '" title="' +
      (allLocked ? '解锁整排商品（解锁后可购买）' : '锁定整排商品：保留到下轮，锁定期间不可购买') + '">' +
      '<span class="ac-lockico">' + (allLocked ? '🔒' : '🔓') + '</span><span>' + (allLocked ? '全部解锁' : '全部锁定') + '</span></button>' +
      '<div class="ac-shopgrid">';
    st.shop.slots.forEach(function (s, i) {
      if (!s) { h += '<div class="ac-slot empty">—</div>'; return; }
      var cd = CARDS[s.cardId];
      h += '<div class="ac-slot' + (s.bought ? ' bought' : '') + (s.locked ? ' locked' : '') + (me.xue >= s.price ? '' : ' poor') + '" data-buy="' + i + '" data-tip="' + s.cardId + '">' +
        '<img src="' + thumb(s.cardId) + '">' +
        '<div class="ac-slotname">' + esc(cd.name) + (cd.tier ? ' <span class="tier t-' + cd.tier + '">' + cd.tier + '</span>' : '') + '</div>' +
        '<div class="ac-slotprice">' + (s.bought ? '已售出' : (s.locked ? '已锁定' : s.price + ' 学时')) + '</div></div>';
    });
    h += '</div></div><div class="ac-odds">本等级刷出概率：' + ACADEMY_DATA.oddsText(me.lv) + '</div>' +
      '<p class="dim">每回合自动刷新 1 次；免费手动刷新剩 ' + st.shop.freeLeft + ' 次，之后第 ' + ((st.shop.paid || 0) + 1) + ' 次付费刷新 ' +
      Academy.nextRefreshCost() + ' 学时（每 2 次 +1）。点击卡牌即购买；<b>怪物卡</b>同名同星 2 张自动合成高一星（卡组与背包可跨区合成），道具/装备不参与升星。</p>' +
      '<div class="ac-btns"><button id="acRefresh" class="pxbtn">刷新商店（' +
      (st.shop.freeLeft > 0 ? '免费 ' + st.shop.freeLeft + ' 次' : Academy.nextRefreshCost() + ' 学时') + '）</button>' +
      '<button id="acShopClose" class="pxbtn ghost">关闭</button></div></div></div>';
    var box = document.createElement('div');
    box.innerHTML = h;
    $('academy').appendChild(box.firstChild);
    if ($('acLockAll')) $('acLockAll').onclick = function () {
      var r = Academy.toggleLockAll();
      if (r.ok) { Sfx.play('click'); toast(r.locked ? '已锁定整排商品：保留到下轮（解锁后可购买）' : '已解锁整排商品'); }
      closeShop(); render(); renderShop();
    };
    Array.prototype.forEach.call($('academy').querySelectorAll('[data-buy]'), function (el) {
      el.onclick = function (e) {
        var E = Academy.me();
        var before = E.deck.length + E.bag.length;
        var r = Academy.buySlot(+el.dataset.buy);
        if (!r.ok) { toast(r.msg); }
        else {
          Sfx.play('play');
          toast((E.deck.length + E.bag.length) < before ? '★ 升星成功！' : ('已购入 · 放入' + (r.where === 'deck' ? '卡组' : '背包')));
        }
        closeShop(); render(); renderShop();
      };
    });
    $('acRefresh').onclick = function () {
      var r = Academy.refreshShop();
      if (!r.ok) toast(r.msg);
      closeShop(); render(); renderShop();
    };
    $('acShopClose').onclick = function () { closeShop(); render(); };
  }
  function closeShop() { var e = $('academy').querySelector('.ac-shop'); if (e) e.parentNode.removeChild(e); }

  /* ---------------- 拖拽（卡组 / 背包 / 出售） ---------------- */
  // 触屏注意：① 触屏的 pointer 事件里 movementX/movementY 恒为 0，不能用来判断"是否拖动过"（否则拖动永远失效）
  //          ② 被系统手势打断会发 pointercancel，必须收尾，否则幽灵卡会永久留在页面上
  //          ③ 手指会挡住落点 → 幽灵卡与判定点统一上移 46px
  var AC_LIFT = 46, acTouch = false;
  // 触屏：卡片是拖拽源（touch-action: none，浏览器不会替我们滚），
  // 于是"翻看列表"和"拖卡"会抢同一个手势 → 用长按区分：按住不动 = 拖卡；先滑动 = 上下翻看列表
  var AC_HOLD_MS = 200, AC_MOVE_TOL = 8, hold = null;
  function acPt(e) { return { x: e.clientX, y: acTouch ? (e.clientY - AC_LIFT) : e.clientY }; }

  // 找到外层可滚动的容器：我的卡组/背包是纵向滚动，对手卡组在手机上被压成横向滚动条
  function scrollBox(el) {
    var n = el;
    while (n && n !== document.body) {
      var cs = getComputedStyle(n);
      var canY = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 2;
      var canX = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 2;
      if (canY || canX) return { el: n, canX: canX, canY: canY };
      n = n.parentNode;
    }
    return null;
  }
  function bindDrag() {
    Array.prototype.forEach.call($('academy').querySelectorAll('.ac-card'), function (el) {
      el.addEventListener('pointerdown', function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        acTouch = !!(e.pointerType && e.pointerType !== 'mouse');
        if (!acTouch) { startDrag(el, e); return; }          // 鼠标：按下即拖（行为不变）
        // 触屏：先挂起，等长按判定；期间滑动则改为翻看列表
        hold = { el: el, e: e, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, box: scrollBox(el), scrolled: false };
        hold.timer = setTimeout(function () {
          if (hold && !hold.scrolled) startDrag(hold.el, hold.e);
        }, AC_HOLD_MS);
        document.addEventListener('pointermove', onHoldMove);
        document.addEventListener('pointerup', onHoldUp);
        document.addEventListener('pointercancel', onHoldUp);
      });
    });
  }
  function endHold() {
    if (hold && hold.timer) clearTimeout(hold.timer);
    document.removeEventListener('pointermove', onHoldMove);
    document.removeEventListener('pointerup', onHoldUp);
    document.removeEventListener('pointercancel', onHoldUp);
  }
  // 判定为"翻看列表"：自己滚（浏览器不会替我们滚，因为卡是 touch-action:none）
  function onHoldMove(e) {
    if (!hold) return;
    if (!hold.scrolled && (Math.abs(e.clientX - hold.sx) > AC_MOVE_TOL || Math.abs(e.clientY - hold.sy) > AC_MOVE_TOL)) {
      hold.scrolled = true;
      clearTimeout(hold.timer);
    }
    if (hold.scrolled && hold.box) {
      if (hold.box.canY) hold.box.el.scrollTop -= (e.clientY - hold.ly);
      if (hold.box.canX) hold.box.el.scrollLeft -= (e.clientX - hold.lx);
    }
    hold.ly = e.clientY; hold.lx = e.clientX;
  }
  function onHoldUp() {
    var h = hold;
    endHold();
    hold = null;
    if (h && !h.scrolled && !drag) toast('长按卡片可拖到「卡组 / 背包 / 出售区」');   // 轻点：给个用法提示
  }
  /* ★ 多指：只认"开始拖拽的那一根手指"（与 js/ui.js 的战斗拖拽同一套修法）。
   *   旧实现 drag / ghost 都是单例：第二根手指拖另一张卡时会覆盖 ghost 变量，
   *   第一张的幽灵卡节点留在 body 里永远没人删 → 屏幕上"卡住一张卡"。 */
  function acSamePointer(e) {
    if (!drag) return true;
    if (drag.pid == null || !e || e.pointerId === undefined) return true;
    return e.pointerId === drag.pid;
  }
  function clearOrphanAcGhosts() {
    Array.prototype.forEach.call(document.querySelectorAll('.ac-ghost'), function (n) {
      if (n !== ghost && n.parentNode) n.parentNode.removeChild(n);
    });
  }
  function startDrag(el, e) {
    endHold();
    hold = null;
    if (drag) return;                        // ★ 已有一根手指在拖 → 忽略这一根，避免覆盖状态、留下孤儿幽灵卡
    drag = {
      zone: el.dataset.zone, idx: +el.dataset.idx, card: el.dataset.card,
      sx: e.clientX, sy: e.clientY, pid: (e.pointerId !== undefined) ? e.pointerId : null
    };
    dragMoved = false;
    clearOrphanAcGhosts();
    ghost = document.createElement('div');
    ghost.className = 'ac-ghost';
    ghost.innerHTML = '<img src="' + thumb(el.dataset.card) + '">';
    document.body.appendChild(ghost);
    moveGhost(e);
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragUp);
    document.addEventListener('pointercancel', onDragCancel);
  }
  function moveGhost(e) { if (ghost) { var p = acPt(e); ghost.style.left = p.x + 'px'; ghost.style.top = p.y + 'px'; } }
  function clearAcGhost() {
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragUp);
    document.removeEventListener('pointercancel', onDragCancel);
    Array.prototype.forEach.call(document.querySelectorAll('.ac-drop.hover'), function (n) { n.classList.remove('hover'); });
    if (ghost) { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); ghost = null; }
    // 兜底：任何残留的幽灵卡节点都清掉（多指/异常路径下不允许有孤儿留在 body 里）
    Array.prototype.forEach.call(document.querySelectorAll('.ac-ghost'), function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
  }
  function onDragCancel(e) {
    if (drag && e && !acSamePointer(e)) return;   // ★ 别的手指被取消 → 不影响本次拖拽
    clearAcGhost(); drag = null; dragMoved = false;
  }
  function onDragMove(e) {
    if (!drag || !acSamePointer(e)) return;
    if (Math.abs(e.clientX - drag.sx) > 6 || Math.abs(e.clientY - drag.sy) > 6) dragMoved = true;
    moveGhost(e);
    Array.prototype.forEach.call(document.querySelectorAll('.ac-drop.hover'), function (n) { n.classList.remove('hover'); });
    var p = acPt(e);
    var t = document.elementFromPoint(p.x, p.y);
    var z = t && t.closest ? t.closest('[data-drop]') : null;
    if (z) z.classList.add('hover');
  }
  function onDragUp(e) {
    if (drag && !acSamePointer(e)) return;        // ★ 别的手指抬起 → 不能结束本次拖拽
    var p = acPt(e);
    clearAcGhost();
    var d = drag; drag = null;
    if (!d) return;
    if (!dragMoved) { toast('长按卡片可拖到「卡组 / 背包 / 出售区」'); return; }
    var t = document.elementFromPoint(p.x, p.y);
    var z = t && t.closest ? t.closest('[data-drop]') : null;
    if (!z) return;
    var drop = z.dataset.drop;
    if (drop === 'sell') {
      var r = Academy.sellCard(d.zone, d.idx);
      toast(r.ok ? ('出售【' + nm(r.cardId) + '】+' + r.gold + ' 学时') : r.msg);
    } else if (drop === 'deck' || drop === 'bag') {
      if (drop === d.zone) { render(); return; }
      var r2 = Academy.moveCard(d.zone, d.idx, drop);
      if (!r2.ok) toast(r2.msg);
    }
    render();
  }

  /* ---------------- 开战 / 战报 ---------------- */
  function startAcademyBattle() {
    var st = Academy.get(), me = Academy.me();
    var opp = Academy.oppOf(0);
    st.stage = 'battle';
    if (!opp) {                                     // 轮空：直接结算（对方输出视为 0 比对）
      Academy.resolveRound(0, 0);
      render();
      return;
    }
    UI.startAcademyBattle({
      oppName: opp.name, oppDeck: opp.deck.slice(), myDeck: me.deck.slice(),
      limit: ACADEMY_DATA.roundLimit(st.round),
      seed: (st.seed + st.round * 7919 + opp.id) >>> 0,
      first: Academy.coinFirst(0, opp.id),                         // 抛硬币决定先后手
      lossCap: ACADEMY_DATA.lossCapOf(st.round),                   // 本轮扣血上限（按考核大轮次，含前期硬顶）
      // ⚠ 战斗 / 种族类特技必须在这里交给引擎（经济 / 升星 / 道具类在学院层就结算了，不受影响）。
      //   以前漏传 → 玩家这场（也就是玩家唯一真正在打的这场）里，
      //   【磨刀石】【元素亲和】这类"对局中己方怪物 +攻击/+生命"的特技**完全不生效**，
      //   而 AI 之间的模拟对局走的是 Academy.newBattleState（那边传了）→ 两边行为不一致。
      perkA: Academy.perkMods(me), perkB: Academy.perkMods(opp),
      onEnd: function (da, db, ha, hb, myDmg, ga, gb) {
        Academy.resolveRound(da, db, ha, hb, ga, gb);   // 后两个：双方【贪婪】觉醒学时
        var lb = Academy.get().lastBattle;
        if (lb && myDmg) lb.dmgBy = myDmg;          // 玩家这一场的输出归因 → 战报里显示输出排行
        open(); render();
      }
    });
  }

  function standingsHtml() {
    var st = Academy.get();
    return st.ents.slice().sort(function (a, b) {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return b.hp - a.hp;
    }).map(function (E) {
      return '<div class="ac-stand' + (E.isPlayer ? ' me' : '') + (E.alive ? '' : ' out') + '">' +
        '<span class="ac-standname">' + esc(E.name) + '</span>' +
        '<span class="dim">Lv' + E.lv + '　生命 ' + E.hp + '　卡组 ' + E.deck.length + '　累计输出 ' + E.total + '</span></div>';
    }).join('');
  }

  function renderResult() {
    var st = Academy.get(), lb = st.lastBattle, me = Academy.me();
    var h = '<div class="ac-wrap"><div class="ac-head"><span class="ac-title">第 ' + (lb ? lb.round : st.round) + ' 轮战报</span>' +
      '<span class="ac-hp">我的生命 ' + me.hp + '/' + C.START_HP + '</span>' +
      '<span class="ac-xue">学时 ' + me.xue + '</span><span class="ac-lv">等级 Lv' + me.lv + '</span></div>';
    h += '<div class="ac-reslist">';
    (lb ? lb.results : []).forEach(function (r) {
      var A = Academy.ent(r.a), B = Academy.ent(r.b);
      var ha = r.ha || 0, hb = r.hb || 0;
      var effA = Math.max(0, r.da - hb), effB = Math.max(0, r.db - ha);      // 治疗抵消后的有效输出
      var lose = effA > effB ? B : (effB > effA ? A : null);
      h += '<div class="ac-res' + ((A.isPlayer || B.isPlayer) ? ' mine' : '') + '">' +
        '<span class="ac-resA">' + esc(A.name) + '</span><span class="ac-score">' + effA + ' : ' + effB + '</span>' +
        '<span class="ac-resB">' + esc(B.name) + '</span>' +
        '<span class="dim">' + (lose
          ? '输出低者 ' + esc(lose.name) + ' -' + (r.loss || 0) + ' 生命' +
            ((r.diff != null && r.loss != null && r.loss < r.diff) ? '（差额 ' + r.diff + '，本轮扣血上限 ' + r.cap + '）' : '')
          : '平分秋色，无人扣血') +
        ((ha || hb) ? '　治疗抵消 ' + ha + ' / ' + hb : '') + '</span></div>';
    });
    h += '</div>';
    if (lb && lb.dmgBy) h += UI.dmgStatHtml(lb.dmgBy);   // 本轮我方的怪物卡输出排行（和大赛赛后同一套）
    h += '<div class="ac-sec-t">当前战况</div><div class="ac-standings">' + standingsHtml() + '</div>';
    h += '<div class="ac-btns">' + (me.alive
      ? '<button id="acNext" class="pxbtn">继续（第 ' + (st.round + 1) + ' 轮）</button>'
      : '<button id="acNext" class="pxbtn">查看最终结果</button>') +
      '<button id="acQuit" class="pxbtn ghost">放弃本届</button></div></div>';
    $('academy').innerHTML = h;
    if ($('acNext')) $('acNext').onclick = function () { Sfx.play('click'); Academy.nextRound(); render(); };
    if ($('acQuit')) $('acQuit').onclick = function () {
      var doAbandon = function () { Academy.abandon(); render(); };
      if (window.UI && UI.confirm) UI.confirm('放弃本届考核？当前进度将丢失。', doAbandon, null, { yes: '放弃本届', no: '继续考核' });
      else if (window.confirm('放弃本届考核？当前进度将丢失。')) doAbandon();
    };
  }

  /* ---------------- 绑定 ---------------- */
  function bind() {
    if ($('btnAcademy')) $('btnAcademy').onclick = function () { Sfx.play('click'); show(); };
  }

  return { show: show, render: render, bind: bind };
})();
