/* ============================================================
 * 魔绫大赛 · 界面  tournament_ui.js
 *  入口（当前xx杯 / 报名参赛 / 历届排名）→ 赛程与对阵 → 对局 → 卡组奖励 → 历届排名详情
 * ========================================================== */
var TourUI = (function () {
  'use strict';

  var curMatchId = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function thumb(id) { return cardThumb(CARDS[id]); }
  function name(id) { return CARDS[id] ? CARDS[id].name : id; }

  function openTour() {
    $('tour').classList.remove('hidden');
    $('menu').classList.add('hidden');
    $('battle').classList.add('hidden');
    if ($('map')) $('map').classList.add('hidden');
    if ($('deck')) $('deck').classList.add('hidden');
    if ($('runpanel')) $('runpanel').classList.add('hidden');
  }
  function render(html) { openTour(); $('tour').innerHTML = '<div class="tour-wrap">' + html + '</div>'; }

  /* ---------------- 入口：当前 xx 杯 ---------------- */
  function showEntry() {
    var st = Tournament.get();
    var body;
    if (st && st.stage !== 'done') {
      body =
        '<div class="tour-cupname">第 ' + st.no + ' 届 · 『' + esc(st.cup.name) + '』</div>' +
        '<p class="dim">你已报名，赛事进行中。世界各地的决斗师齐聚于此，为夺得『' + esc(st.cup.name) + '』而战。</p>' +
        '<div class="tour-btns">' +
        '<button id="tContinue" class="pxbtn">进入赛事</button>' +
        '<button id="tGiveUp" class="pxbtn ghost">放弃本届</button>' +
        '<button id="tHistory" class="pxbtn ghost">历届排名</button>' +
        '<button id="tBack" class="pxbtn ghost">返回主菜单</button></div>';
    } else if (st && st.stage === 'done') {
      body =
        '<div class="tour-cupname">第 ' + st.no + ' 届 · 『' + esc(st.cup.name) + '』 已落幕</div>' +
        '<p class="tour-result">本届冠军：<b>' + esc(st.result.championName) + '</b>　·　你的排名：第 ' + st.result.playerRank + ' 名</p>' +
        '<div class="tour-btns">' +
        '<button id="tSignup" class="pxbtn">报名下一届</button>' +
        '<button id="tHistory" class="pxbtn ghost">历届排名</button>' +
        '<button id="tBack" class="pxbtn ghost">返回主菜单</button></div>';
    } else {
      var nextNo = SaveData.getTourHistory().length + 1;
      var previewName = Tournament.nextCupName();
      body =
        '<div class="tour-cupname">第 ' + nextNo + ' 届 · 『' + esc(previewName) + '』</div>' +
        '<p class="dim">世界各地的玩家们为了夺得魔绫杯来到这里。16 名选手、4 个小组、双败淘汰 —— 用你的卡组一路晋升，直到捧起冠军奖杯。</p>' +
        '<p class="dim">赛制：小组赛（每组 4 人，两败淘汰，出线 2 人）→ 8 强双败淘汰赛 → 魔绫总决赛。</p>' +
        '<div class="tour-btns">' +
        '<button id="tSignup" class="pxbtn">报名参赛</button>' +
        '<button id="tHistory" class="pxbtn ghost">历届排名</button>' +
        '<button id="tBack" class="pxbtn ghost">返回主菜单</button></div>';
    }
    render('<h1 class="tour-title">魔绫大赛</h1>' + body +
      '<p class="tour-tip dim">参赛需携带一套合法的 20 张卡组（当前卡组）</p>');

    if ($('tSignup')) $('tSignup').onclick = doSignup;
    if ($('tContinue')) $('tContinue').onclick = function () { Sfx.play('click'); showBracket(); };
    if ($('tGiveUp')) $('tGiveUp').onclick = function () {
      var doAbandon = function () { Tournament.abandon(); showEntry(); };
      if (window.UI && UI.confirm) UI.confirm('确定放弃本届赛事？当前进度将丢失。', doAbandon, null, { yes: '放弃赛事', no: '继续赛事' });
      else if (window.confirm('确定放弃本届赛事？当前进度将丢失。')) doAbandon();
    };
    if ($('tHistory')) $('tHistory').onclick = function () { Sfx.play('click'); showHistory(); };
    if ($('tBack')) $('tBack').onclick = function () { Sfx.play('click'); UI.showMenu(); };
  }

  function doSignup() {
    var d = SaveData.activeDeck();
    var v = DeckRules.validateStarter(d.cardIds);
    if (!v.ok) { UI.toast('卡组不合法：' + v.errors[0] + '（请进入组卡器调整）'); return; }
    Sfx.play('click');
    Tournament.signUp(d.cardIds.slice());
    showBracket();
  }

  /* ---------------- 赛程 / 对阵 ---------------- */
  function showBracket() {
    var st = Tournament.get();
    if (!st) { showEntry(); return; }
    var r = Tournament.readyPlayerMatch();   // 推进 AI 对局
    st = Tournament.get();
    var r2 = Tournament.readyPlayerMatch();

    var h = '<div class="tour-head"><span class="tour-cupname">第 ' + st.no + ' 届 · 『' + esc(st.cup.name) + '』</span>' +
      '<span class="dim">' + (st.phase === 'group' ? '小组赛' : '淘汰赛') + '</span></div>';

    h += renderGroups();

    if (st.phase === 'playoff') h += renderPlayoff();

    // 日志
    h += '<div class="tour-log"><div class="tour-log-t">赛事动态</div>' +
      (st.log || []).slice(-8).map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('') + '</div>';

    // 操作
    var actions = '';
    if (r2.type === 'player') {
      actions = '<button id="tPlay" class="pxbtn">开始我的对局</button>' +
        '<span class="dim tour-vs">对手：' + esc(entrantName(oppOf(r2.match))) + '（' + diffName(r2.match.diff) + '档）</span>';
    } else if (r2.type === 'done') {
      actions = '<button id="tDone" class="pxbtn">查看本届结果</button>';
    } else {
      actions = '<span class="dim">赛事推进中…</span>';
    }
    h += '<div class="tour-actions">' + actions +
      '<button id="tHistory" class="pxbtn ghost">历届排名</button>' +
      '<button id="tBack" class="pxbtn ghost">返回主菜单</button></div>';

    if (st.playerAlive === false) h += '<p class="tour-out">你已被淘汰，赛事仍在继续（结果将记入历届排名）。</p>';

    render(h);

    if ($('tPlay')) $('tPlay').onclick = function () { startMatch(r2.match); };
    if ($('tDone')) $('tDone').onclick = function () { showResult(); };
    if ($('tHistory')) $('tHistory').onclick = function () { showHistory(); };
    if ($('tBack')) $('tBack').onclick = function () { Sfx.play('click'); UI.showMenu(); };
  }

  function entrantName(id) { var st = Tournament.get(); var e = st && st.entrants[id]; return e ? e.name : '?'; }
  function oppOf(m) {
    var st = Tournament.get();
    var p = m.a && m.a.t === 'e' && m.a.id === 0;
    // 解析：玩家所在侧的另一侧
    function rs(side) { if (!side) return null; if (side.t === 'e') return side.id; var mm = st.matches[side.m]; if (!mm) return null; return side.t === 'w' ? mm.winner : mm.loser; }
    var a = rs(m.a), b = rs(m.b);
    return a === 0 ? b : a;
  }

  function renderGroups() {
    var st = Tournament.get();
    var h = '<div class="tour-sec-t">小组赛（每组两败淘汰，出线 2 人）</div><div class="tour-groups">';
    st.groups.forEach(function (g, gi) {
      h += '<div class="tour-group"><div class="tour-group-h">第 ' + (gi + 1) + ' 组</div>';
      g.forEach(function (id) {
        var E = st.entrants[id];
        var adv = (st.matches['g' + gi + '-3'].winner === id) || (st.matches['g' + gi + '-5'].winner === id);
        var out = E.eliminated || (st.matches['g' + gi + '-5'].loser === id) || (st.matches['g' + gi + '-4'].loser === id);
        var cls = 'tour-p' + (E.isPlayer ? ' me' : '') + (adv ? ' adv' : '') + (out ? ' out' : '');
        var tagl = adv ? '出线' : (out ? '淘汰' : '');
        h += '<div class="' + cls + '"><span class="tp-name">' + esc(E.name) + '</span><span class="tp-tag dim">' + tagl + '</span></div>';
      });
      h += '<div class="tour-group-m">';
      ['1', '2', '3', '4', '5'].forEach(function (n) {
        var m = st.matches['g' + gi + '-' + n]; if (!m) return;
        h += '<div class="tour-m' + (m.played ? ' done' : '') + '">' + matchVs(m) + '</div>';
      });
      h += '</div></div>';
    });
    return h + '</div>';
  }

  function matchVs(m) {
    var na = m.a && m.a.t === 'e' ? entrantName(m.a.id) : (m.a ? '<span class="dim">待定</span>' : '?');
    var nb = m.b && m.b.t === 'e' ? entrantName(m.b.id) : (m.b ? '<span class="dim">待定</span>' : '?');
    if (m.played) {
      var wa = m.winner === (m.a.t === 'e' ? m.a.id : resolveL(m.a));
      return '<span class="tm-w">' + esc(shortName(entrantName(m.winner))) + '</span> <span class="dim">胜</span>';
    }
    return '<span>' + na + '</span><span class="dim"> vs </span><span>' + nb + '</span>';
  }
  function resolveL(side) { var st = Tournament.get(); if (side.t === 'e') return side.id; var m = st.matches[side.m]; return side.t === 'w' ? m.winner : m.loser; }
  function shortName(n) { n = String(n); return n.length > 7 ? n.slice(0, 6) + '…' : n; }

  /* 淘汰赛（双败）对阵图：树枝状 八强 → 四强 → 决赛
   * 结构：两条横向"带"（胜者组 / 败者组），每条带里按轮次一列列排开；
   * 同一支线的比赛放进一个 .br-pair，右侧用 CSS 伪元素画连线接到下一轮（见 tour.css）。 */
  function renderPlayoff() {
    var st = Tournament.get();
    // 每场显示"双方两行"：赢了打 ✓ 变绿，输了的灰掉 + 划掉。
    // 旧版只显示胜者，败者会直接从表里消失 —— 既看不出谁输给了谁，也显得"某位选手只出现过一次"。
    function bm(id) {
      var m = st.matches[id]; if (!m) return '';
      var aId = m.a ? resolveL(m.a) : null, bId = m.b ? resolveL(m.b) : null;  // 'e'=直接是人；'w'/'l'=某场的胜/负者
      var me = (aId === 0 || bId === 0);                                       // 0 = 玩家（与 oppOf 一致）
      function row(idv) {
        var nm = idv == null ? '待定' : shortName(entrantName(idv));
        var cls = 'bm-row';
        if (m.played && idv != null) cls += (m.winner === idv ? ' win' : ' lose');
        return '<span class="' + cls + '">' + esc(nm) + '</span>';
      }
      return '<div class="tour-bm' + (m.played ? ' done' : '') + (me ? ' me' : '') + '">' +
        '<span class="bm-l dim">' + esc(m.label) + '</span>' + row(aId) + row(bId) + '</div>';
    }
    function col(title, pairs, last) {
      var h = '<div class="br-col' + (last ? ' br-last' : '') + '"><div class="br-colhead">' + title + '</div>';
      pairs.forEach(function (p) {
        h += '<div class="br-pair' + (p.length < 2 ? ' br-single' : '') + '">' + p.map(bm).join('') + '</div>';
      });
      return h + '</div>';
    }
    function band(title, cols, note) {
      return '<div class="br-band"><div class="br-band-t">' + title + '</div><div class="br-cols">' + cols + '</div>' +
        (note ? '<div class="br-note">' + note + '</div>' : '') + '</div>';
    }
    return '<div class="tour-sec-t">双败淘汰赛（八强起，败次重置，两败淘汰）</div><div class="br-wrap">' +
      band('胜者组',
        col('八强', [['w1', 'w2'], ['w3', 'w4']]) +
        col('四强', [['w5', 'w6']]) +
        col('胜者组决赛', [['w7']]) +
        col('总决赛', [['f1']], true),
        '胜者组冠军与败者组冠军争夺总冠军') +
      band('败者组',
        col('第一轮', [['l1', 'l2']]) +
        col('第二轮', [['l3', 'l4']]) +
        col('半决赛', [['l5']]) +
        col('败者组决赛', [['l6']], true),
        '败者组冠军进入总决赛') +
      '</div>';
  }

  /* ---------------- 开始对局 ---------------- */
  function startMatch(match) {
    var st = Tournament.get();
    var info = Tournament.matchInfo(match);
    if (!info) return;
    curMatchId = info.matchId;
    Sfx.play('click');
    var seed = hashSeed(st.seed, hashStrLocal(info.matchId));
    UI.startBattle({
      playerDeck: st.entrants[0].deck.slice(),
      aiDeck: info.opponentDeck,
      playerHp: 40, playerMax: 40, aiHp: 40,
      aiName: info.opponentName,
      diff: info.diff,
      first: info.playerFirst ? 'A' : 'B',
      seed: seed,
      tournament: true,
      mode: 'tour'
    });
  }
  function hashStrLocal(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // 放弃本局：本场判负（不退出整届赛事），返回赛程继续
  function forfeitMatch() {
    if (!curMatchId) { showBracket(); return; }
    Tournament.recordPlayerMatch(curMatchId, false);
    Tournament.skipReward();
    curMatchId = null;
    showBracket();
  }

  // UI 在对局结束（确认结果）后回调
  function onMatchEnd(win) {
    var reward = Tournament.recordPlayerMatch(curMatchId, win);
    if (reward && reward.full) showRewardFull();
    else if (reward) showRewardPick(reward);
    else showBracket();
  }

  /* ---------------- 卡组奖励 ---------------- */
  function showRewardPick(reward) {
    var st = Tournament.get();
    var myDeck = st.entrants[0].deck;
    var h = '<h2 class="tour-title">' + (reward.win ? '胜利奖励' : '鏖战后补给') + '</h2>' +
      '<p class="dim">' + (reward.win ? '胜者' : '败者') + '可从系统随机 ' + (reward.win ? 30 : 20) + ' 张中挑选 ' + reward.pick +
      ' 张加入卡组（当前卡组 ' + myDeck.length + '/30）</p><div class="rw-cards">';
    reward.pool.forEach(function (id, i) {
      h += '<div class="rw-card" data-pick="' + i + '" data-tip="' + id + '"><img src="' + thumb(id) + '"><span>' + esc(name(id)) + '</span></div>';
    });
    h += '</div><div class="tour-actions"><button id="rwConfirm" class="pxbtn" disabled>确认加入（0/' + reward.pick + '）</button>' +
      '<button id="rwSkip" class="pxbtn ghost">跳过</button></div>';
    render(h);

    var sel = [];
    var cards = $('tour').querySelectorAll('[data-pick]');
    Array.prototype.forEach.call(cards, function (el) {
      el.onclick = function () {
        var i = +el.dataset.pick, k = sel.indexOf(i);
        if (k >= 0) { sel.splice(k, 1); el.classList.remove('picked'); }
        else { if (sel.length >= reward.pick) { UI.toast('最多选 ' + reward.pick + ' 张'); return; } sel.push(i); el.classList.add('picked'); }
        var btn = $('rwConfirm'); btn.disabled = sel.length === 0; btn.textContent = '确认加入（' + sel.length + '/' + reward.pick + '）';
      };
    });
    $('rwConfirm').onclick = function () {
      var ids = sel.map(function (i) { return reward.pool[i]; });
      Tournament.applyPlayerReward(ids);
      Sfx.play('play'); showBracket();
    };
    $('rwSkip').onclick = function () { Tournament.skipReward(); showBracket(); };
  }

  function showRewardFull() {
    var st = Tournament.get();
    var myDeck = st.entrants[0].deck.slice();
    var h = '<h2 class="tour-title">卡组已满（30 张）</h2>' +
      '<p class="dim">可以选择跳过，或删除任意张牌。勾选要删除的牌后点击"完成"。</p><div class="pk-list">';
    myDeck.forEach(function (id, i) {
      h += '<div class="pk-row" data-rm="' + i + '" data-tip="' + id + '"><img src="' + thumb(id) + '"><span>' + esc(name(id)) + '</span></div>';
    });
    h += '</div><div class="tour-actions"><button id="rfDone" class="pxbtn">完成（删除 0 张）</button>' +
      '<button id="rfSkip" class="pxbtn ghost">跳过</button></div>';
    render(h);

    var sel = [];
    Array.prototype.forEach.call($('tour').querySelectorAll('[data-rm]'), function (el) {
      el.onclick = function () {
        var i = +el.dataset.rm, k = sel.indexOf(i);
        if (k >= 0) { sel.splice(k, 1); el.classList.remove('picked'); } else { sel.push(i); el.classList.add('picked'); }
        $('rfDone').textContent = '完成（删除 ' + sel.length + ' 张）';
      };
    });
    $('rfDone').onclick = function () {
      sel.sort(function (a, b) { return b - a; }).forEach(function (i) { Tournament.playerRemoveCard(i); });
      Tournament.skipReward(); showBracket();
    };
    $('rfSkip').onclick = function () { Tournament.skipReward(); showBracket(); };
  }

  /* ---------------- 结果 / 历届排名 ---------------- */
  function showResult() {
    var st = Tournament.get();
    var r = st.result;
    var h = '<h2 class="tour-title">『' + esc(st.cup.name) + '』战报</h2>' +
      '<p class="tour-result">冠军：<b>' + esc(r.championName) + '</b>　·　你的排名：<b>第 ' + r.playerRank + ' 名</b></p>' +
      '<div class="tour-sec-t">最终排名</div><div class="pk-list">';
    (r.table || []).forEach(function (row) {
      h += '<div class="pk-row' + (row.isPlayer ? ' me' : '') + '"><span class="tr-rank">#' + row.rank + '</span><span>' + esc(row.name) + '</span><span class="dim">' + esc(row.arch || '') + '</span></div>';
    });
    h += '</div><div class="tour-actions"><button id="tAgain" class="pxbtn">报名下一届</button>' +
      '<button id="tHistory" class="pxbtn ghost">历届排名</button>' +
      '<button id="tBack" class="pxbtn ghost">返回主菜单</button></div>';
    render(h);
    $('tAgain').onclick = function () { doSignup(); };
    $('tHistory').onclick = function () { showHistory(); };
    $('tBack').onclick = function () { UI.showMenu(); };
  }

  function showHistory() {
    var hist = SaveData.getTourHistory();
    var h = '<h2 class="tour-title">历届排名</h2>';
    if (!hist.length) h += '<p class="dim">暂无历届赛事记录。</p>';
    else {
      h += '<div class="hs-list">';
      hist.slice().reverse().forEach(function (rec, ri) {
        var idx = hist.length - 1 - ri;
        h += '<div class="hs-row" data-hs="' + idx + '"><span class="hs-no">第 ' + rec.no + ' 届</span>' +
          '<span class="hs-name">' + esc(rec.name) + '</span>' +
          '<span class="hs-champ">冠军：' + esc(rec.champion) + (rec.championIsPlayer ? '（你）' : '') + '</span>' +
          '<span class="hs-rank">我的排名：第 ' + rec.playerRank + ' 名</span></div>';
      });
      h += '</div>';
    }
    h += '<div class="tour-actions"><button id="tBack" class="pxbtn ghost">返回</button></div>';
    render(h);
    Array.prototype.forEach.call($('tour').querySelectorAll('[data-hs]'), function (el) {
      el.onclick = function () { showHistoryDetail(+el.dataset.hs); };
    });
    $('tBack').onclick = function () { showEntry(); };
  }

  function showHistoryDetail(idx) {
    var rec = SaveData.getTourHistory()[idx];
    if (!rec) { showHistory(); return; }
    var h = '<h2 class="tour-title">第 ' + rec.no + ' 届 · 『' + esc(rec.name) + '』</h2>' +
      '<p class="tour-result">冠军：<b>' + esc(rec.champion) + '</b>　·　你的排名：第 ' + rec.playerRank + ' 名</p>' +
      '<div class="pk-list">';
    (rec.table || []).forEach(function (row) {
      h += '<div class="pk-row' + (row.isPlayer ? ' me' : '') + '"><span class="tr-rank">#' + row.rank + '</span><span>' + esc(row.name) + '</span><span class="dim">' + esc(row.arch || '') + '</span></div>';
    });
    h += '</div><div class="tour-actions"><button id="tBack" class="pxbtn ghost">返回历届排名</button></div>';
    render(h);
    $('tBack').onclick = function () { showHistory(); };
  }

  function diffName(d) { return ({ novice: '新手', amateur: '业余', pro: '专业', champion: '冠军' })[d] || '新手'; }

  return {
    showEntry: showEntry, showBracket: showBracket, startMatch: startMatch,
    onMatchEnd: onMatchEnd, showHistory: showHistory, forfeitMatch: forfeitMatch
  };
})();
