/* ============================================================
 * 跑图界面  runui.js
 *  - 分层地图渲染与选路
 *  - 节点面板：战斗 / 精英 / BOSS / 商店 / 休息 / 事件
 *  - 战后奖励：3 选 1 卡牌 + 金币 +（精英/BOSS）遗物
 * ========================================================== */
var RunUI = (function () {
  'use strict';

  var activeNode = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  /* ---------------- 地图 ---------------- */
  function showMap() {
    var run = RunManager.get();
    if (!run) { returnToMenu(); return; }
    // 中途刷新/退出过对局：退回上一个节点，让那场战斗可以重新挑战（否则地图上一个节点都进不去）
    if (RunManager.resumeIfInterrupted && RunManager.resumeIfInterrupted()) {
      if (window.UI) UI.toast('上一场战斗未保存，已退回该节点，可重新挑战');
    }
    $('map').classList.remove('hidden');
    $('runpanel').classList.add('hidden');
    $('menu').classList.add('hidden');
    $('battle').classList.add('hidden');
    $('deck').classList.add('hidden');
    renderMap();
    if (Sfx.isEnabled()) Sfx.bgmStart();
  }
  function hideMap() { $('map').classList.add('hidden'); }

  // 跑图顶栏（幕数 / 生命 / 金币 / 卡组 / 种子 / 遗物）单独抽出来：
  // 商店、事件里花掉金币只重绘面板，顶栏不会自己更新 —— 面板每次刷新时同步一次，
  // 免得买完东西要关掉面板、背景上的金币才跳（面板里的数字一直是对的，看着像"背景没同步"）。
  function syncHud() {
    var run = RunManager.get(); if (!run) return;
    $('mapAct').textContent = '第 ' + run.act + ' 幕 / 共 ' + RunData.BOSSES.length + ' 幕';
    $('mapHp').textContent = '生命 ' + run.hp + '/' + run.maxHp;
    $('mapGold').textContent = '金币 ' + run.gold;
    $('mapDeckInfo').textContent = '卡组 ' + run.deck.length;
    $('mapSeed').textContent = '种子 ' + run.seed;
    $('mapRelics').innerHTML = run.relics.length
      ? run.relics.map(function (id) { return '<div class="relic" title="' + esc(CARDS[id].name + '：' + CARDS[id].effect) + '"><img src="' + cardThumb(CARDS[id]) + '"></div>'; }).join('')
      : '<span class="dim">无遗物</span>';
  }

  function renderMap() {
    var run = RunManager.get(); if (!run) return;
    syncHud();

    var reach = RunManager.reachable().map(function (n) { return n.id; });
    var svg = '<svg class="map-lines" viewBox="0 0 100 100" preserveAspectRatio="none">';
    RunData.allNodes(run.map).forEach(function (n) {
      // 只点亮"真正走过的那条线"：源节点已在已走路径里，且目标就是它的下一站。
      // （原来只判"源节点走过"，于是当前节点通向所有岔路的线全变成黄色 —— 没选的那几条也亮着）
      var i = run.done.indexOf(n.id);
      var chosen = (i >= 0 && i + 1 < run.done.length) ? run.done[i + 1] : null;
      n.next.forEach(function (nid) {
        var m = RunData.nodeById(run.map, nid); if (!m) return;
        svg += '<line class="' + (nid === chosen ? 'el-on' : '') + '" x1="' + (n.cx * 100) + '" y1="' + ((1 - n.cy) * 100) +
          '" x2="' + (m.cx * 100) + '" y2="' + ((1 - m.cy) * 100) + '"/>';
      });
    });
    svg += '</svg>';

    var nodes = '';
    RunData.allNodes(run.map).forEach(function (n) {
      var meta = NODE_META[n.type];
      var cls = 'map-node ' + meta.cls;
      if (run.done.indexOf(n.id) >= 0) cls += ' done';
      if (n.id === run.currentId) cls += ' cur';
      if (reach.indexOf(n.id) >= 0) cls += ' reach';
      nodes += '<div class="' + cls + '" data-node="' + n.id + '" title="' + meta.label +
        '" style="left:' + (n.cx * 100) + '%;top:' + ((1 - n.cy) * 100) + '%">' +
        '<span class="mn-ico">' + meta.icon + '</span></div>';
    });
    $('mapCanvas').innerHTML = svg + nodes;

    // 滚动到当前节点 / 起始位置
    var wrap = $('mapCanvas').parentNode;
    setTimeout(function () {
      if (!wrap) return;
      var cur2 = RunManager.currentNode();
      var y = cur2 ? (1 - cur2.cy) * 1620 : 1620;
      wrap.scrollTop = Math.max(0, y - wrap.clientHeight * 0.55);
    }, 0);

    var cur = RunManager.currentNode();
    $('mapHint').textContent = cur ? ('当前位置：' + NODE_META[cur.type].label + '　—　请选择一条支线继续前进')
      : '请选择一条支线开始前进';
  }

  function onMapClick(e) {
    var el = e.target.closest && e.target.closest('[data-node]');
    if (!el) return;
    var id = +el.dataset.node;
    if (!RunManager.canEnter(id)) { if (window.UI) UI.toast('该节点无法到达'); return; }
    Sfx.play('click');
    var n = RunManager.enter(id);
    if (!n) return;
    renderMap();   // 立刻按新位置重算"可走支线"高亮：否则刚走过时那几个兄弟节点会一直保持黄色
    if (n.type === 'battle' || n.type === 'elite' || n.type === 'boss') startBattle(n);
    else if (n.type === 'shop') showShop(true);
    else if (n.type === 'rest') showRest();
    else showEvent();
  }

  /* ---------------- 战斗 ---------------- */
  function startBattle(node) {
    var run = RunManager.get();
    var setup = RunManager.battleSetup();
    hideMap(); closePanel();
    UI.startBattle({
      playerDeck: run.deck.concat(run.relics),   // 遗物注入：引擎会自动置入遗物栏
      aiDeck: setup.deck,
      playerHp: run.hp,
      playerMax: run.maxHp,
      aiHp: setup.aiHp,
      aiName: setup.bossName || (setup.kind === 'elite' ? '精英对手' : '对手'),
      seed: setup.seed,
      run: true,
      mode: 'run'
    });
  }

  // 重开本局：同一节点、换一个种子重新开局（生命仍为该场战斗开始时的值）
  function restartBattle() {
    var run = RunManager.get();
    if (!run || run.status !== 'battle') { if (window.UI) UI.toast('当前不在对局中'); return; }
    run.battles = (run.battles || 0) + 1;
    SaveData.setRun(run);
    startBattle(RunManager.currentNode());
  }

  // 由 UI 在对局结束时调用
  function onBattleEnd(win) {
    var run = RunManager.get();
    if (!run) return false;
    var kind = run.battleKind || 'normal';
    // 成就：原始力量（第一幕精英 + 初始新手卡组）/ 第三幕是否被怪物攻击过（必须在 finishBattle 之前取节点）
    if (typeof Achievements !== 'undefined') Achievements.onRunBattleEnd(win, Engine.state, RunManager.currentNode());
    if (!win) { RunManager.finishBattle(false, 0, 0); showDefeat(); return true; }
    var endHp = Engine.state.players.A.hp;
    var gold = RunManager.goldReward(kind);
    RunManager.finishBattle(true, endHp, gold);
    Sfx.play('win');
    if (RunManager.get().status === 'complete') { showVictory(); return true; }
    showReward(kind, gold);
    return true;
  }

  /* ---------------- 面板 ---------------- */
  function panel(html) {
    $('runpanel').classList.remove('hidden');
    $('runpanel').innerHTML = '<div class="rp-box">' + html + '</div>';
    syncHud();     // 面板每次刷新都同步一次背景顶栏（金币/生命/卡组数）
  }
  function closePanel() { $('runpanel').classList.add('hidden'); $('runpanel').innerHTML = ''; $('runpanel').onclick = null; }

  function showReward(kind, gold) {
    var cards = RunManager.cardReward();
    var relics = (kind === 'elite' || kind === 'boss') ? RunManager.relicChoices(1) : [];
    // 触屏：点卡牌只"选中并看详情"，再由「确认选择」落地（避免一碰就进卡组、长按又弹浏览器菜单）
    var touch = !!(window.UI && UI.isTouch && UI.isTouch());
    var h = '<h3>战斗胜利</h3>';
    h += '<p class="rp-gain">金币 +' + gold + (relics.length ? '　·　可获得一件遗物' : '') + '</p>';
    h += '<p class="dim">' + (touch
      ? '点一下卡牌看详情，再点「确认选择」才会加入卡组（或直接继续前进）'
      : '选择一张卡加入卡组（悬停查看详情，点击选取，或跳过）') + '</p><div class="rw-cards">';
    cards.forEach(function (id) {
      h += '<div class="rw-card" data-card="' + id + '" data-tip="' + id + '"><img src="' + cardThumb(CARDS[id]) + '"><span>' + esc(CARDS[id].name) + '</span></div>';
    });
    h += '</div>';
    if (relics.length) {
      h += '<p class="dim">遗物</p><div class="rw-cards">';
      relics.forEach(function (id) {
        h += '<div class="rw-card rw-relic" data-relic="' + id + '" data-tip="' + id + '"><img src="' + cardThumb(CARDS[id]) + '"><span>' + esc(CARDS[id].name) + '</span></div>';
      });
      h += '</div>';
    }
    h += '<div class="rp-btns">' +
      (touch ? '<button id="rwConfirm" class="pxbtn" disabled>确认选择</button>' : '') +
      '<button id="rwDone" class="pxbtn' + (touch ? ' ghost' : '') + '">' + (touch ? '跳过 / 继续前进' : '继续前进') + '</button>' +
      '</div>';
    panel(h);

    var pickedCard = false, pickedRelic = false;
    var selCard = null, selRelic = null;          // 触屏下"已选中但还没确认"的目标
    function paint() {
      Array.prototype.forEach.call($('runpanel').querySelectorAll('.rw-card'), function (n) { n.classList.remove('picked'); });
      if (selCard) selCard.classList.add('picked');
      if (selRelic) selRelic.classList.add('picked');
      var b = $('rwConfirm'); if (!b) return;
      var n = (selCard ? 1 : 0) + (selRelic ? 1 : 0);
      b.disabled = n === 0;
      b.textContent = n ? '确认选择（已选 ' + n + ' 项）' : '确认选择';
    }
    $('runpanel').onclick = function (e) {
      var c = e.target.closest && e.target.closest('[data-card]');
      var r = e.target.closest && e.target.closest('[data-relic]');
      if (touch) {
        // 点卡牌 = 选中（同时 tab/点按都会显示右栏详情）→ 确认按钮才真正加入
        if (c && !pickedCard) { selCard = (selCard === c) ? null : c; paint(); return; }
        if (r && !pickedRelic) { selRelic = (selRelic === r) ? null : r; paint(); return; }
        if (e.target.id === 'rwConfirm') {
          if (selCard) { pickedCard = true; RunManager.addCard(selCard.dataset.card); selCard.classList.remove('picked'); selCard.classList.add('rw-taken'); selCard = null; Sfx.play('play'); }
          if (selRelic) { pickedRelic = true; RunManager.addRelic(selRelic.dataset.relic); selRelic.classList.remove('picked'); selRelic.classList.add('rw-taken'); selRelic = null; Sfx.play('relic'); }
          paint();
          return;
        }
        if (e.target.id === 'rwDone') { closePanel(); showMap(); }
        return;
      }
      // 桌面：点即取（原行为不变）
      if (c && !pickedCard) { pickedCard = true; RunManager.addCard(c.dataset.card); c.classList.add('picked'); Sfx.play('play'); return; }
      if (r && !pickedRelic) { pickedRelic = true; RunManager.addRelic(r.dataset.relic); r.classList.add('picked'); Sfx.play('relic'); return; }
      if (e.target.id === 'rwDone') { closePanel(); showMap(); }
    };
    paint();
  }

  var shopSold = {};
  var shopState = null;   // { offers:[], sold:{} } —— 单次到店固定货品
  function showShop(fresh) {
    if (fresh || !shopState) {
      var offers = [];
      RunManager.cardReward().forEach(function (id) { offers.push({ kind: 'card', id: id, price: 30 }); });
      var relic = RunManager.relicChoices(1)[0];
      if (relic) offers.push({ kind: 'relic', id: relic, price: 62 });
      offers.push({ kind: 'heal', price: 20, value: 10 });
      offers.push({ kind: 'maxhp', price: 45, value: 3 });
      offers.push({ kind: 'remove', price: 40 });
      shopState = { offers: offers, sold: {} };
    }
    var run = RunManager.get();
    var list = shopState.offers, sold = shopState.sold;

    var h = '<h3>地牢商店</h3><p class="dim">你的金币：<b>' + run.gold + '</b></p><div class="sh-list">';
    list.forEach(function (o, i) {
      var name, img, desc, tip = '';
      if (o.kind === 'card') { name = CARDS[o.id].name; img = '<img src="' + cardThumb(CARDS[o.id]) + '">'; desc = CARDS[o.id].effect; tip = ' data-tip="' + o.id + '"'; }
      else if (o.kind === 'relic') { name = CARDS[o.id].name + '（遗物）'; img = '<img src="' + cardThumb(CARDS[o.id]) + '">'; desc = CARDS[o.id].effect; tip = ' data-tip="' + o.id + '"'; }
      else if (o.kind === 'heal') { name = '治疗服务'; img = '<span class="sh-ico">药</span>'; desc = '恢复 ' + o.value + ' 点生命'; }
      else if (o.kind === 'maxhp') { name = '强化仪式'; img = '<span class="sh-ico">心</span>'; desc = '最大生命 +' + o.value; }
      else { name = '移除卡牌'; img = '<span class="sh-ico">删</span>'; desc = '从卡组中移除一张卡（永久）'; }
      h += '<div class="sh-row' + (sold[i] ? ' sold' : '') + '" data-offer="' + i + '"' + tip + '>' + img +
        '<div class="sh-mid"><div class="sh-name">' + esc(name) + '</div><div class="sh-desc">' + esc(desc) + '</div></div>' +
        '<button class="pxbtn small">' + o.price + ' 金</button></div>';
    });
    h += '</div><div class="rp-btns"><button id="shLeave" class="pxbtn ghost">离开商店</button></div>';
    panel(h);

    $('runpanel').onclick = function (e) {
      var row = e.target.closest && e.target.closest('[data-offer]');
      if (row) {
        var i = +row.dataset.offer;
        if (sold[i]) { if (window.UI) UI.toast('已售出'); return; }
        var o = list[i];
        if (RunManager.get().gold < o.price) { if (window.UI) UI.toast('金币不足'); return; }
        if (o.kind === 'remove') {   // 花费金币移除一张卡：弹出卡组选择
          RunManager.spendGold(o.price); sold[i] = true; Sfx.play('coin');
          pickFromDeck('已支付 ' + o.price + ' 金：选择要移除的卡', function (idx) {
            RunManager.removeCardIdx(idx); Sfx.play('click'); showShop(false);
          }, function () { showShop(false); });
          return;
        }
        RunManager.spendGold(o.price);
        sold[i] = true;
        if (o.kind === 'card') RunManager.addCard(o.id);
        else if (o.kind === 'relic') RunManager.addRelic(o.id);
        else if (o.kind === 'heal') RunManager.heal(o.value);
        else if (o.kind === 'maxhp') RunManager.buffMaxHp(o.value);
        Sfx.play(o.kind === 'relic' ? 'relic' : 'coin');
        showShop(false);   // 刷新（保留货品与已售状态）
        return;
      }
      if (e.target.id === 'shLeave') { shopState = null; RunManager.resolveNode(); closePanel(); showMap(); }
    };
  }

  function showRest() {
    var run = RunManager.get();
    var h = '<h3>休息营地</h3><p class="dim">篝火噼啪作响，你可以稍作调整。当前生命 ' + run.hp + '/' + run.maxHp + '</p>' +
      '<div class="rp-btns col">' +
      '<button id="restHeal" class="pxbtn">恢复生命（+12）</button>' +
      '<button id="restMax" class="pxbtn ghost">强化体魄（最大生命 +3）</button>' +
      '<button id="restRemove" class="pxbtn ghost">移除一张卡</button>' +
      '</div>';
    panel(h);
    $('runpanel').onclick = function (e) {
      var id = e.target.id;
      if (id === 'restHeal') { RunManager.heal(12); Sfx.play('heal'); done('恢复了 12 点生命'); }
      else if (id === 'restMax') { RunManager.buffMaxHp(3); Sfx.play('heal'); done('最大生命 +3'); }
      else if (id === 'restRemove') { pickFromDeck('选择要移除的卡', function (idx) { RunManager.removeCardIdx(idx); done('已移除一张卡'); }); }
    };
  }

  /* ---------------- 事件 ----------------
   * 规则：凡是"能拿到卡"的分支，一律走 kind:'pick'（从提供的 3 张里挑 1），不允许直接塞一张随机卡。
   * choice 形态：
   *   { label, act:function() }                       普通分支，返回结算文案
   *   { label, kind:'remove', price }                 从卡组里移除一张（可选付费）
   *   { label, kind:'pick', pool:function(){…}, cost:{gold|hp}, pickTitle, pickNote, skipText }
   *                                                  从 pool() 提供的卡里挑 1（代价在"确认选择"时才扣除）
   *   { label, kind:'give', gold }                    先选一张自己的卡交出去，再拿金币
   *   { label, kind:'copy' }                          复制卡组里的一张卡
   */
  var EVENTS = [
    /* ---- 既有事件（给卡的两处已改成可挑） ---- */
    {
      title: '神秘祭坛', desc: '石台上刻满古老符文，似乎在渴求生命的献祭。',
      choices: [
        { label: '献出 5 点生命，换一张稀有卡（三选一）', kind: 'pick', pool: function () { return rarePool(3); }, cost: { hp: 5 },
          pickTitle: '祭坛的馈赠', pickNote: '从三张稀有怪中挑一张加入卡组（确认后扣除 5 点生命）', skipText: '你收回了手，祭坛重归沉寂。' },
        { label: '转身离开', act: function () { return '你离开了祭坛。'; } }
      ]
    },
    {
      title: '被遗弃的宝箱', desc: '箱子半开着，缝隙里透出微弱的光。',
      choices: [
        { label: '打开它（获得 35 金币）', act: function () { RunManager.gainGold(35); Sfx.play('coin'); return '获得 35 金币'; } },
        { label: '粗暴踢开（失去 6 生命，三选一拿一张卡）', kind: 'pick', pool: function () { return RunManager.cardReward(); }, cost: { hp: 6 },
          pickTitle: '箱中之物', pickNote: '从三张卡中挑一张（确认后扣除 6 点生命）', skipText: '你忍住了，箱子依旧半开着。' }
      ]
    },
    {
      title: '治疗泉', desc: '清澈的泉水散发着温暖的光晕。',
      choices: [
        { label: '饮用（恢复 14 生命）', act: function () { RunManager.heal(14); Sfx.play('heal'); return '恢复 14 生命'; } },
        { label: '装满水袋（最大生命 +2）', act: function () { RunManager.buffMaxHp(2); Sfx.play('heal'); return '最大生命 +2'; } },
        { label: '净化卡组（移除一张卡）', kind: 'remove' }
      ]
    },
    {
      title: '地牢商贩', desc: '一个戴兜帽的商人向你招手，摊位上摆着不知名的货品。',
      choices: [
        { label: '花 25 金币买一张卡（三选一）', kind: 'pick', pool: function () { return RunManager.cardReward(); }, cost: { gold: 25 },
          pickTitle: '商贩的货品', pickNote: '从三张卡中挑一张（确认后扣除 25 金）', skipText: '你摇了摇头，商人耸了耸肩。' },
        { label: '花 20 金币治疗（+8 生命）', act: function () { if (RunManager.get().gold < 20) return '金币不足。'; RunManager.spendGold(20); RunManager.heal(8); Sfx.play('heal'); return '恢复 8 生命'; } },
        { label: '花 30 金币移除一张卡', kind: 'remove', price: 30 },
        { label: '离开', act: function () { return '你走过摊位。'; } }
      ]
    },

    /* ---- 新增·好事件 ---- */
    {
      title: '古旧书库', desc: '倒塌的书架间散落着泛黄的卷册，有人在这里读过很久很久。',
      choices: [
        { label: '誊抄一页（复制卡组中的一张卡）', kind: 'copy' },
        { label: '把书页卖给收藏家（获得 45 金币）', act: function () { RunManager.gainGold(45); Sfx.play('coin'); return '获得 45 金币'; } },
        { label: '静静离开', act: function () { return '你把书页放回了原处。'; } }
      ]
    },
    {
      title: '流浪铁匠', desc: '铁砧旁堆着半成品的护甲，铁匠打量着你的装备。',
      choices: [
        { label: '花 30 金币加固护甲（最大生命 +5）', act: function () { if (RunManager.get().gold < 30) return '金币不足，铁匠摇摇头。'; RunManager.spendGold(30); RunManager.buffMaxHp(5); Sfx.play('heal'); return '最大生命 +5'; } },
        { label: '花 45 金币买下他的私藏（一件遗物）', act: function () { if (RunManager.get().gold < 45) return '金币不足。'; var r = RunManager.relicChoices(1)[0]; if (!r) return '他摊开手：没什么可卖的了。'; RunManager.spendGold(45); RunManager.addRelic(r); Sfx.play('relic'); return '获得遗物【' + CARDS[r].name + '】'; } },
        { label: '请他包扎伤口（免费恢复 8 生命）', act: function () { RunManager.heal(8); Sfx.play('heal'); return '恢复 8 生命'; } },
        { label: '道别', act: function () { return '铁匠继续敲打他的铁砧。'; } }
      ]
    },
    {
      title: '遗忘之地', desc: '一处安静的凹室，墙上刻满旅人留下的名字。',
      choices: [
        { label: '冥想（免费移除一张卡）', kind: 'remove' },
        { label: '拾荒（获得 30 金币）', act: function () { RunManager.gainGold(30); Sfx.play('coin'); return '获得 30 金币'; } },
        { label: '静修（支付 20 金币，最大生命 +4）', act: function () { if (RunManager.get().gold < 20) return '金币不足。'; RunManager.spendGold(20); RunManager.buffMaxHp(4); Sfx.play('heal'); return '最大生命 +4'; } }
      ]
    },
    {
      title: '落难学者', desc: '一个衣衫褴褛的学者缩在角落，怀里抱着几卷笔记。',
      choices: [
        { label: '资助他 25 金币（三选一拿一张卡）', kind: 'pick', pool: function () { return RunManager.cardReward(); }, cost: { gold: 25 },
          pickTitle: '学者的谢礼', pickNote: '从三张卡中挑一张（确认后支付 25 金）', skipText: '你把钱袋收了回去。' },
        { label: '赠他一张卡（获得 40 金币）', kind: 'give', gold: 40 },
        { label: '视而不见', act: function () { return '你从他身边走过。'; } }
      ]
    },

    /* ---- 新增·坏事件 / 风险事件 ---- */
    {
      title: '溃烂的尸体', desc: '一具尚未冷却的冒险者尸体，散发着刺鼻的气味。',
      choices: [
        { label: '仔细搜刮（失去 8 生命，获得 55 金币）', act: function () { if (RunManager.get().hp <= 8) return '你的状态撑不住翻找尸体。'; RunManager.damage(8); RunManager.gainGold(55); Sfx.play('coin'); return '失去 8 生命，获得 55 金币'; } },
        { label: '谨慎翻找（失去 3 生命，获得 18 金币）', act: function () { if (RunManager.get().hp <= 3) return '你的状态撑不住翻找尸体。'; RunManager.damage(3); RunManager.gainGold(18); Sfx.play('coin'); return '失去 3 生命，获得 18 金币'; } },
        { label: '绕开', act: function () { return '你捂着鼻子快步走过。'; } }
      ]
    },
    {
      title: '腐化图腾', desc: '一根缠满藤蔓的石柱，表面渗着暗红色的汁液。它想要点什么。',
      choices: [
        { label: '献出 8 点生命（三选一，从稀有怪中挑一张）', kind: 'pick', pool: function () { return rarePool(3); }, cost: { hp: 8 },
          pickTitle: '图腾的回礼', pickNote: '从三张稀有怪中挑一张（确认后扣除 8 点生命）', skipText: '你后退一步，藤蔓缓缓缩了回去。' },
        { label: '献出一张卡（获得 50 金币）', kind: 'give', gold: 50 },
        { label: '头也不回地离开', act: function () { return '你离开了那根石柱。'; } }
      ]
    },
    {
      title: '赌徒的骰子', desc: '骰盅在桌面中央咔哒作响，对面的人咧嘴笑着：押一把？',
      choices: [
        { label: '押 30 金币（一半机会赢得 70 金币）', act: function () {
            if (RunManager.get().gold < 30) return '你掏不出 30 金币。';
            RunManager.spendGold(30);
            if (Math.random() < 0.5) { RunManager.gainGold(70); Sfx.play('coin'); return '骰子停下——你赢了，获得 70 金币（净 +40）'; }
            Sfx.play('lose'); return '骰子停下——你输了，失去押金 30 金币';
          } },
        { label: '押 10 金币（一半机会赢得 22 金币）', act: function () {
            if (RunManager.get().gold < 10) return '你连 10 金币都拿不出。';
            RunManager.spendGold(10);
            if (Math.random() < 0.5) { RunManager.gainGold(22); Sfx.play('coin'); return '小赌怡情，获得 22 金币（净 +12）'; }
            Sfx.play('lose'); return '小赌也输了，失去 10 金币';
          } },
        { label: '不赌', act: function () { return '你推开骰盅走开了。'; } }
      ]
    },
    {
      title: '迷雾回廊', desc: '走廊被浓雾填满，脚下时不时传来机关的轻响。',
      choices: [
        { label: '硬闯（失去 10 生命，获得 60 金币）', act: function () { if (RunManager.get().hp <= 10) return '你不敢在这么虚弱时硬闯。'; RunManager.damage(10); RunManager.gainGold(60); Sfx.play('coin'); return '失去 10 生命，找到 60 金币'; } },
        { label: '摸索前进（失去 5 生命，获得 25 金币）', act: function () { if (RunManager.get().hp <= 5) return '你不敢在这么虚弱时摸黑前进。'; RunManager.damage(5); RunManager.gainGold(25); Sfx.play('coin'); return '失去 5 生命，找到 25 金币'; } },
        { label: '原路返回（失去 3 生命）', act: function () { RunManager.damage(3); return '你退了回去，被碎砖绊了一下，失去 3 生命'; } }
      ]
    }
  ];
  // 稀有怪池（A / S 不重复）
  function rarePool(n) {
    var pool = CARD_LIST.filter(function (c) { return c.type === 'monster' && (c.tier === 'A' || c.tier === 'S'); }).map(function (c) { return c.id; });
    for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    return pool.slice(0, n);
  }
  function rareCard() { return rarePool(1)[0]; }

  // forceEv 可选：直接指定事件（工具脚本/调试用；正常流程由地图随机抽取）
  function showEvent(forceEv) {
    var ev = forceEv || EVENTS[Math.floor(Math.random() * EVENTS.length)];
    activeNode = ev;
    renderEvent(ev, null);
  }
  function renderEvent(ev, resultText) {
    var h = '<h3>' + esc(ev.title) + '</h3><p class="rp-desc">' + esc(ev.desc) + '</p>';
    if (resultText) h += '<p class="rp-gain">' + esc(resultText) + '</p>';
    h += '<div class="rp-btns col">';
    if (resultText) h += '<button id="evOk" class="pxbtn">继续前进</button>';
    else ev.choices.forEach(function (c, i) { h += '<button class="pxbtn ghost" data-choice="' + i + '">' + esc(c.label) + '</button>'; });
    h += '</div>';
    panel(h);
    $('runpanel').onclick = function (e) {
      if (e.target.id === 'evOk') { RunManager.resolveNode(); closePanel(); showMap(); return; }
      var b = e.target.closest && e.target.closest('[data-choice]');
      if (b) {
        var ch = ev.choices[+b.dataset.choice];
        if (ch.kind === 'remove') {   // 移除一张卡（可能需付费）
          if (ch.price && RunManager.get().gold < ch.price) { Sfx.play('click'); renderEvent(ev, '金币不足，无法支付 ' + ch.price + ' 金。'); return; }
          if (ch.price) RunManager.spendGold(ch.price);
          pickFromDeck('选择要移除的卡' + (ch.price ? '（已支付 ' + ch.price + ' 金）' : ''), function (idx) {
            RunManager.removeCardIdx(idx); Sfx.play('click'); renderEvent(ev, '已从卡组中移除一张卡。');
          }, function () { renderEvent(ev, null); });
          return;
        }
        if (ch.kind === 'pick') {     // 从提供的卡里挑 1 张（代价在"确认选择"时才扣：放弃不扣）
          var cost = ch.cost || {}, run2 = RunManager.get();
          if (cost.gold && run2.gold < cost.gold) { Sfx.play('click'); renderEvent(ev, '金币不足，需要 ' + cost.gold + ' 金。'); return; }
          if (cost.hp && run2.hp <= cost.hp) { Sfx.play('click'); renderEvent(ev, '生命不足（要先付出 ' + cost.hp + ' 点生命）。'); return; }
          renderCardPick(ch.pickTitle || '选择一张卡',
            ch.pickNote || '从这几张里挑一张加入卡组（放弃则什么也不发生）',
            ch.pool(),
            function (id) {
              if (cost.gold) RunManager.spendGold(cost.gold);
              if (cost.hp) RunManager.damage(cost.hp);
              RunManager.addCard(id);
              Sfx.play('play');
              var msg = '获得【' + CARDS[id].name + '】';
              if (cost.gold) msg += '（支付 ' + cost.gold + ' 金）';
              if (cost.hp) msg += '（失去 ' + cost.hp + ' 生命）';
              if (RunManager.get().status === 'over') { showDefeat(); return; }
              renderEvent(ev, msg);
            },
            function () { renderEvent(ev, ch.skipText || '你放弃了这个机会。'); });
          return;
        }
        if (ch.kind === 'give') {     // 交出自己的一张卡，换金币
          pickFromDeck('选择要交出的卡（换取 ' + ch.gold + ' 金币）', function (idx) {
            var id = RunManager.get().deck[idx];
            RunManager.removeCardIdx(idx); RunManager.gainGold(ch.gold); Sfx.play('coin');
            renderEvent(ev, '交出【' + CARDS[id].name + '】，获得 ' + ch.gold + ' 金币');
          }, function () { renderEvent(ev, null); });
          return;
        }
        if (ch.kind === 'copy') {     // 复制卡组里的一张卡
          pickFromDeck('选择要复制的卡', function (idx) {
            var id = RunManager.get().deck[idx];
            RunManager.addCard(id); Sfx.play('play');
            renderEvent(ev, '复制了一张【' + CARDS[id].name + '】');
          }, function () { renderEvent(ev, null); });
          return;
        }
        var res = ch.act();
        if (RunManager.get().status === 'over') { showDefeat(); return; }
        Sfx.play('click');
        renderEvent(ev, res || '……');
      }
    };
  }

  /* ---------------- 卡组选择（移除卡牌） ---------------- */
  function pickFromDeck(title, onPick, onBack) {
    var run = RunManager.get();
    var h = '<h3>' + esc(title) + '</h3><p class="dim">当前卡组共 ' + run.deck.length + ' 张（悬停查看详情）</p><div class="pk-list">';
    run.deck.forEach(function (id, i) {
      h += '<div class="pk-row" data-idx="' + i + '" data-tip="' + id + '"><img src="' + cardThumb(CARDS[id]) + '"><span>' + esc(CARDS[id].name) + '</span></div>';
    });
    h += '</div><div class="rp-btns"><button id="pkCancel" class="pxbtn ghost">取消</button></div>';
    panel(h);
    $('runpanel').onclick = function (e) {
      if (e.target.id === 'pkCancel') { (onBack || showRest)(); return; }
      var row = e.target.closest && e.target.closest('[data-idx]');
      if (row) { Sfx.play('click'); onPick(+row.dataset.idx); }
    };
  }
  /* ---------------- 从"事件提供的几张卡"里挑一张 ----------------
   * 桌面：点即取；触屏：先选中看详情 → 点「确认选择」才落地（与战后奖励一致的操作手感） */
  function renderCardPick(title, note, pool, onPick, onBack) {
    var touch = !!(window.UI && UI.isTouch && UI.isTouch());
    var h = '<h3>' + esc(title) + '</h3><p class="dim">' + esc(note) + '</p><div class="rw-cards">';
    pool.forEach(function (id, i) {
      h += '<div class="rw-card" data-pick="' + i + '" data-tip="' + id + '"><img src="' + cardThumb(CARDS[id]) + '"><span>' + esc(CARDS[id].name) + '</span></div>';
    });
    h += '</div><div class="rp-btns">' +
      (touch ? '<button id="pkConfirm" class="pxbtn" disabled>确认选择</button>' : '') +
      '<button id="pkSkip" class="pxbtn ghost">放弃</button></div>';
    panel(h);
    var sel = null;
    function paint() {
      Array.prototype.forEach.call($('runpanel').querySelectorAll('.rw-card'), function (n) { n.classList.remove('picked'); });
      if (sel) sel.classList.add('picked');
      var b = $('pkConfirm'); if (!b) return;
      b.disabled = !sel;
      b.textContent = sel ? '确认选择' : '确认选择（先点一张卡）';
    }
    $('runpanel').onclick = function (e) {
      if (e.target.id === 'pkSkip') { (onBack || function () { })(); return; }
      var card = e.target.closest && e.target.closest('[data-pick]');
      if (touch) {
        if (card) { sel = (sel === card) ? null : card; paint(); return; }
        if (e.target.id === 'pkConfirm' && sel) { onPick(pool[+sel.dataset.pick]); }
        return;
      }
      if (card) { onPick(pool[+card.dataset.pick]); }
    };
    paint();
  }

  function done(msg) {
    RunManager.resolveNode();
    panel('<h3>已处理</h3><p class="rp-gain">' + esc(msg) + '</p><div class="rp-btns"><button id="dnOk" class="pxbtn">继续前进</button></div>');
    $('runpanel').onclick = function (e) { if (e.target.id === 'dnOk') { closePanel(); showMap(); } };
  }

  /* ---------------- 结局 ---------------- */
  function showDefeat() {
    hideMap();
    panel('<h3 class="rp-lose">跑图失败</h3><p class="rp-desc">你的冒险在第 ' + RunManager.get().act + ' 幕戛然而止……</p>' +
      '<div class="rp-btns"><button id="dfQuit" class="pxbtn">返回主菜单</button></div>');
    Sfx.play('lose'); Sfx.bgmStop();
    $('runpanel').onclick = function (e) { if (e.target.id === 'dfQuit') { SaveData.clearRun(); closePanel(); returnToMenu(); } };
  }
  function showVictory() {
    hideMap();
    var run = RunManager.get();
    panel('<h3 class="rp-win">通关！</h3><p class="rp-desc">你击败了三幕的全部 BOSS，成为真正的地牢决斗师！</p>' +
      '<p class="rp-gain">最终卡组 ' + run.deck.length + ' 张　遗物 ' + run.relics.length + ' 件　生命 ' + run.hp + '/' + run.maxHp + '　金币 ' + run.gold + '</p>' +
      '<div class="rp-btns"><button id="wcQuit" class="pxbtn">返回主菜单</button></div>');
    Sfx.play('win'); Sfx.bgmStop();
    $('runpanel').onclick = function (e) { if (e.target.id === 'wcQuit') { SaveData.clearRun(); closePanel(); returnToMenu(); } };
  }

  function returnToMenu() {
    $('map').classList.add('hidden');
    closePanel();
    Sfx.bgmStop();
    if (window.UI) UI.showMenu();
  }

  function bind() {
    $('mapCanvas').addEventListener('click', onMapClick);
    // 返回主菜单：保留跑图进度（可随时用"继续存档"回到地图）
    $('mapHome').addEventListener('click', function () {
      if (RunManager.get()) SaveData.setRun(RunManager.get());
      returnToMenu();
    });
    $('mapQuit').addEventListener('click', function () {
      var doQuit = function () { SaveData.clearRun(); returnToMenu(); };
      if (window.UI && UI.confirm) UI.confirm('确定放弃本次跑图？进度将被清除。', doQuit, null, { yes: '放弃跑图', no: '继续跑图' });
      else if (window.confirm('确定放弃本次跑图？进度将被清除。')) doQuit();
    });
    // 面板内统一支持"悬停查看卡牌详情"（奖励 / 商店 / 移除卡牌）
    var tipEl = null;
    var rp = $('runpanel');
    rp.addEventListener('mouseover', function (e) {
      var el = e.target.closest && e.target.closest('[data-tip]');
      if (!el || el === tipEl) return;
      tipEl = el;
      CardTip.show(el.getAttribute('data-tip'), e.clientX, e.clientY);
    });
    rp.addEventListener('mousemove', function (e) { if (tipEl) CardTip.move(e.clientX, e.clientY); });
    rp.addEventListener('mouseout', function (e) {
      if (e.target.closest && e.target.closest('[data-tip]')) { tipEl = null; CardTip.hide(); }
    });
    rp.addEventListener('click', function () { tipEl = null; CardTip.hide(); });
    // 触屏（踏上征途的奖励 / 商店 / 移除卡牌）：按下即显示卡牌详情，点空白处收起
    rp.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      var el = e.target.closest && e.target.closest('[data-tip]');
      if (!el) { tipEl = null; CardTip.hide(); return; }
      tipEl = el;
      CardTip.show(el.getAttribute('data-tip'), e.clientX, e.clientY);
    });
  }

  return {
    showMap: showMap, hideMap: hideMap, renderMap: renderMap,
    startBattle: startBattle, restartBattle: restartBattle, onBattleEnd: onBattleEnd,
    showDefeat: showDefeat, showVictory: showVictory,
    returnToMenu: returnToMenu, bind: bind,
    showEvent: showEvent, EVENTS: EVENTS, renderCardPick: renderCardPick, pickFromDeck: pickFromDeck
  };
})();
