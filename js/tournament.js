/* ============================================================
 * 魔绫大赛 · 赛事引擎  tournament.js
 *  赛制：16 人（1 玩家 + 15 AI）分 4 组；小组赛两败淘汰，每组出 2；8 强双败淘汰赛；总决赛。
 *  - 玩家对局由界面驱动（Engine 实战）；AI 对局按卡组强度模拟
 *  - 每场后：胜者从随机 30 张选 2、败者从随机 20 张选 2（卡组满 30 后可跳过/删牌）
 *  - 状态经 SaveData.setTour 持久化；完赛写入历届排名
 * ========================================================== */
var Tournament = (function () {
  'use strict';

  var PLAYER = 0;          // 玩家选手 id
  var st = null;           // 当前赛事状态

  /* ---------------- 存档 ---------------- */
  function save() { if (st) SaveData.setTour(st); }
  function load() { st = SaveData.getTour(); return st; }
  function get() { return st; }
  function hasActive() { return !!st && st.stage !== 'done'; }

  function addLog(text) { if (st) { st.log = st.log || []; st.log.push(text); if (st.log.length > 200) st.log.shift(); } }

  /* ---------------- 下一届杯名（与届数绑定，报名前后一致） ---------------- */
  function nextCupName() {
    var hist = SaveData.getTourHistory();
    var rng = makeRng(hashSeed(0x9e3779b9, hist.length));
    return TOUR_DATA.randomCupName(rng);
  }

  /* ---------------- 报名：建立赛事 ---------------- */
  function signUp(playerDeck, seed) {
    var rng = makeRng((seed != null ? seed : randomSeed()) >>> 0);
    if (typeof Achievements !== 'undefined') Achievements.onEnterMode('tour');   // 成就「大赛新人」
    var entrants = [{
      id: PLAYER,
      name: (typeof SaveData !== 'undefined' && SaveData.getPlayerName ? SaveData.getPlayerName() : '你'),
      isPlayer: true, arch: -1, deck: playerDeck.slice(), losses: 0, group: -1
    }];
    var names = TOUR_DATA.AI_NAMES.slice();
    var archIdx = TOUR_DATA.ARCHETYPES.map(function (_, i) { return i; });
    // 洗牌
    for (var i = names.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = names[i]; names[i] = names[j]; names[j] = t; }
    for (var k = archIdx.length - 1; k > 0; k--) { var j2 = Math.floor(rng() * (k + 1)); var t2 = archIdx[k]; archIdx[k] = archIdx[j2]; archIdx[j2] = t2; }
    for (var n = 0; n < 15; n++) {
      var ai = archIdx[n];
      entrants.push({
        id: 1 + n, name: names[n], isPlayer: false, arch: ai,
        deck: TOUR_DATA.buildDeck(TOUR_DATA.ARCHETYPES[ai], rng), losses: 0, group: -1
      });
    }
    // 分 4 组
    var ids = entrants.map(function (e) { return e.id; });
    for (var s = ids.length - 1; s > 0; s--) { var j3 = Math.floor(rng() * (s + 1)); var t3 = ids[s]; ids[s] = ids[j3]; ids[j3] = t3; }
    var groups = [[], [], [], []];
    ids.forEach(function (id, idx) { groups[idx % 4].push(id); entrants[id].group = idx % 4; });

    st = {
      no: (SaveData.getTourHistory().length + 1),
      cup: { name: nextCupName(), seed: (seed != null ? seed : randomSeed()) >>> 0 },
      seed: (seed != null ? seed : randomSeed()) >>> 0,
      stage: 'group',
      entrants: entrants, groups: groups,
      matches: {}, order: [], phase: 'group',
      playerAlive: true, pendingReward: null,
      log: [], result: null
    };
    buildGroupMatches();
    addLog('『' + st.cup.name + '』开赛，16 位选手就位。');
    save();
    return st;
  }

  function buildGroupMatches() {
    st.groups.forEach(function (g, gi) {
      addMatch('g' + gi + '-1', 'group', '小组赛 首轮', e(g[0]), e(g[1]), 'amateur', 0);
      addMatch('g' + gi + '-2', 'group', '小组赛 首轮', e(g[2]), e(g[3]), 'amateur', 0);
      addMatch('g' + gi + '-3', 'group', '胜者组决赛', w('g' + gi + '-1'), w('g' + gi + '-2'), 'amateur', 1);
      addMatch('g' + gi + '-4', 'group', '败者组决赛', l('g' + gi + '-1'), l('g' + gi + '-2'), 'amateur', 1);
      addMatch('g' + gi + '-5', 'group', '出线生死战', l('g' + gi + '-3'), w('g' + gi + '-4'), 'amateur', 2);
    });
  }

  // 小组赛结束后建立 8 强双败淘汰赛
  function buildPlayoff() {
    var adv = [];   // 8 名：每组第1、第2
    for (var gi = 0; gi < 4; gi++) {
      var first = resolveWinner('g' + gi + '-3'), second = resolveWinner('g' + gi + '-5');
      adv.push(first); adv.push(second);
    }
    // 种子：4 组第1 = s0..s3；4 组第2 = s4..s7
    var s = adv.slice();
    addMatch('w1', 'wb', '八强 · 胜者组', e(s[0]), e(s[5]), 'amateur', 3);
    addMatch('w2', 'wb', '八强 · 胜者组', e(s[1]), e(s[4]), 'amateur', 3);
    addMatch('w3', 'wb', '八强 · 胜者组', e(s[2]), e(s[7]), 'amateur', 3);
    addMatch('w4', 'wb', '八强 · 胜者组', e(s[3]), e(s[6]), 'amateur', 3);
    addMatch('w5', 'wb', '四强 · 胜者组', w('w1'), w('w2'), 'pro', 4);
    addMatch('w6', 'wb', '四强 · 胜者组', w('w3'), w('w4'), 'pro', 4);
    addMatch('w7', 'wb', '胜者组决赛', w('w5'), w('w6'), 'pro', 5);
    addMatch('l1', 'lb', '败者组 第一轮', l('w1'), l('w2'), 'amateur', 4);
    addMatch('l2', 'lb', '败者组 第一轮', l('w3'), l('w4'), 'amateur', 4);
    addMatch('l3', 'lb', '败者组 第二轮', l('w5'), w('l1'), 'pro', 5);
    addMatch('l4', 'lb', '败者组 第二轮', l('w6'), w('l2'), 'pro', 5);
    addMatch('l5', 'lb', '败者组 半决赛', w('l3'), w('l4'), 'pro', 6);
    addMatch('l6', 'lb', '败者组决赛', l('w7'), w('l5'), 'pro', 7);
    addMatch('f1', 'gf', '魔绫总决赛', w('w7'), w('l6'), 'champion', 8);   // 总决赛＝冠军档
    st.matches['f1'].finalWB = 'w7';   // 记录：胜者组晋级者拥有先手
    st.phase = 'playoff';
    addLog('小组赛结束，八强诞生，进入双败淘汰赛。');
  }

  /* ---------------- 比赛节点 ---------------- */
  function e(id) { return { t: 'e', id: id }; }
  function w(m) { return { t: 'w', m: m }; }
  function l(m) { return { t: 'l', m: m }; }
  function addMatch(id, stage, label, a, b, diff, wave) {
    st.matches[id] = { id: id, stage: stage, label: label, a: a, b: b, diff: diff, wave: wave || 0, winner: null, loser: null, first: null, played: false };
    st.order.push(id);
  }
  function resolveSide(side) {
    if (!side) return null;
    if (side.t === 'e') return side.id;
    var m = st.matches[side.m]; if (!m) return null;
    if (side.t === 'w') return m.winner;
    if (side.t === 'l') return m.loser;
    return null;
  }
  function resolveWinner(id) { var m = st.matches[id]; return m ? m.winner : null; }
  function isReady(m) { return m && !m.played && resolveSide(m.a) != null && resolveSide(m.b) != null; }
  function sideOf(m, entrantId) { return resolveSide(m.a) === entrantId ? 'a' : (resolveSide(m.b) === entrantId ? 'b' : null); }
  function entrant(id) { return st.entrants[id]; }

  /* ---------------- 推进 / 模拟 ---------------- */
  // 按波次推进：同一轮里，先由玩家实战自己那场，其余同轮对局随后才结算（赛事与玩家同步）
  function sync() {
    var guard = 0;
    while (guard++ < 900) {
      // 小组赛跑完 → 建立淘汰赛
      if (st.phase === 'group' && groupDone()) { buildPlayoff(); save(); continue; }
      // 当前波次 = 含未完成对局的最小 wave
      var W = null;
      for (var i = 0; i < st.order.length; i++) {
        var mm = st.matches[st.order[i]];
        if (!mm.played && (W == null || mm.wave < W)) W = mm.wave;
      }
      if (W == null) { finishCup(); return { type: 'done', result: st.result }; }   // 全部完成
      var waveMatches = st.order.map(function (id) { return st.matches[id]; }).filter(function (m) { return m.wave === W && !m.played; });
      var ready = waveMatches.filter(isReady);
      if (!ready.length) break;   // 依赖未就绪（异常保护）
      // 玩家在该波次的对局：先打，其余同轮暂不结算
      if (st.playerAlive) {
        var pm = ready.filter(function (m) { return sideOf(m, PLAYER) != null; })[0];
        if (pm) return { type: 'player', match: pm };
      }
      var sims = ready.filter(function (m) { return sideOf(m, PLAYER) == null; });
      if (sims.length) { sims.forEach(simulate); continue; }
      break;
    }
    if (allPlayed()) { finishCup(); return { type: 'done', result: st.result }; }
    return { type: null };
  }

  function groupDone() {
    for (var gi = 0; gi < 4; gi++) {
      if (!st.matches['g' + gi + '-3'].played || !st.matches['g' + gi + '-4'].played || !st.matches['g' + gi + '-5'].played) return false;
    }
    return true;
  }
  function allPlayed() { return st.order.every(function (id) { return st.matches[id].played; }); }

  function simulate(m) {
    var a = resolveSide(m.a), b = resolveSide(m.b);
    var A = entrant(a), B = entrant(b);
    var rng = makeRng(hashSeed(st.seed, hashStr(m.id)));
    var pa = TOUR_DATA.deckPower(A.deck) * diffFactor(A, m.diff);
    var pb = TOUR_DATA.deckPower(B.deck) * diffFactor(B, m.diff);
    var probA = pa / (pa + pb);
    var winner = (rng() < probA) ? a : b;
    recordResult(m, winner, winner === a ? b : a, false);
  }
  function diffFactor(E, diff) { return 1; }   // 保留：AI 难度不改变模拟强度（公平）
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // 记录一场结果（含双方卡组奖励）
  function recordResult(m, winnerId, loserId, isPlayer) {
    m.winner = winnerId; m.loser = loserId; m.played = true;
    var W = entrant(winnerId), L = entrant(loserId);
    // AI 卡组成长（玩家奖励由界面处理）
    if (!W.isPlayer) grantAiReward(W, true);
    if (!L.isPlayer) grantAiReward(L, false);
    // 淘汰判定：小组赛两败淘汰（8强阶段败次重置）；淘汰赛败者组/总决赛落败即出局
    if (m.stage === 'group') { L.losses += 1; if (L.losses >= 2) markEliminated(L); }
    else if (m.stage === 'lb' || m.stage === 'gf') { markEliminated(L); }
    else if (m.stage === 'wb') { L.glosses = (L.glosses || 0) + 1; }
    if (winnerId === PLAYER || loserId === PLAYER) {
      addLog('第 ' + (st.no) + ' 届·' + m.label + '：你 ' + (winnerId === PLAYER ? '获胜' : '落败') + '（对阵 ' + (winnerId === PLAYER ? L.name : W.name) + '）');
    }
  }
  function markEliminated(E) { E.eliminated = true; if (E.isPlayer) st.playerAlive = false; }

  function grantAiReward(E, win) {
    var arch = TOUR_DATA.ARCHETYPES[E.arch];
    var rng = makeRng(hashSeed(st.seed, E.id, E.deck.length, win ? 1 : 0));
    var pool = TOUR_DATA.rewardPool(win ? 30 : 20, rng, function (c) {
      var own = E.deck.filter(function (x) { return x === c.id; }).length;
      return own < c.maxCopies;
    });
    if (!pool.length) return;
    if (E.deck.length < 30) {
      // 未满 30：按"套路贴合 + 卡组构成 + 种子扰动"挑 2 张加入
      var picks = TOUR_DATA.aiChoose(pool, arch, E.deck, 2, rng);
      picks.forEach(function (id) { if (E.deck.length < 30) E.deck.push(id); });
    } else {
      // 已满 30：候选明显强于卡组最弱卡、且替换后构成仍达标时才替换（AI 卡组持续优化）
      TOUR_DATA.tryReplace(E.deck, arch, pool, rng);
    }
  }

  /* ---------------- 玩家对局接口 ---------------- */
  // 返回当前需要玩家进行的对局（自动模拟其余 AI 对局后）
  function readyPlayerMatch() {
    var r = sync();
    save();
    return r;
  }
  // 玩家对局信息（用于开局）
  function matchInfo(m) {
    var side = sideOf(m, PLAYER);
    var mySide = side;
    var oppId = resolveSide(mySide === 'a' ? m.b : m.a);
    var opp = entrant(oppId);
    // 先手：总决赛胜者组晋级者先手；其余抛硬币
    var first;
    if (m.finalWB && resolveSide(m.a) === resolveWinner(m.finalWB)) first = 'a';
    else if (m.finalWB && resolveSide(m.b) === resolveWinner(m.finalWB)) first = 'b';
    else { var rng = makeRng(hashSeed(st.seed, hashStr(m.id), 'coin')); first = rng() < 0.5 ? 'a' : 'b'; }
    m.first = first;
    var playerFirst = (mySide === first);
    return {
      opponentName: opp.name, opponentDeck: opp.deck.slice(), opponentArch: opp.arch,
      diff: m.diff, playerFirst: playerFirst, matchId: m.id, label: m.label
    };
  }
  // 玩家对局结束
  function recordPlayerMatch(matchId, win) {
    var m = st.matches[matchId];
    var side = sideOf(m, PLAYER);
    var oppId = resolveSide(side === 'a' ? m.b : m.a);
    if (win) recordResult(m, PLAYER, oppId, true); else recordResult(m, oppId, PLAYER, true);
    // 生成玩家奖励
    var deckLen = entrant(PLAYER).deck.length;
    if (deckLen >= 30) {
      st.pendingReward = { full: true };
    } else {
      var rng = makeRng(hashSeed(st.seed, 'reward', matchId));
      var pool = TOUR_DATA.rewardPool(win ? 30 : 20, rng, function (c) {
        var own = entrant(PLAYER).deck.filter(function (x) { return x === c.id; }).length;
        return own < c.maxCopies;
      });
      st.pendingReward = { full: false, win: win, pool: pool, pick: Math.min(2, pool.length) };
    }
    save();
    return st.pendingReward;
  }
  function applyPlayerReward(chosenIds) {
    var E = entrant(PLAYER);
    (chosenIds || []).forEach(function (id) { if (E.deck.length < 30 && CARDS[id]) E.deck.push(id); });
    st.pendingReward = null; save();
  }
  function playerRemoveCard(idx) {
    var E = entrant(PLAYER);
    if (idx >= 0 && idx < E.deck.length) { E.deck.splice(idx, 1); save(); }
  }
  function skipReward() { st.pendingReward = null; save(); }

  /* ---------------- 结束与排名 ---------------- */
  function finishCup() {
    if (st.result) return;
    var champ = resolveWinner('f1');
    var ranks = computeRanks(champ);
    st.result = { champion: champ, championName: entrant(champ).name, ranks: ranks, playerRank: ranks[PLAYER], table: computeTable(ranks) };
    st.stage = 'done';
    addLog('『' + st.cup.name + '』落幕，冠军：' + entrant(champ).name + '。你的排名：第 ' + ranks[PLAYER] + ' 名。');
    // 写入历届排名
    var hist = SaveData.getTourHistory();
    hist.push({
      no: st.no, name: st.cup.name, date: Date.now(),
      champion: entrant(champ).name, championIsPlayer: champ === PLAYER,
      playerRank: ranks[PLAYER],
      table: computeTable(ranks)
    });
    SaveData.setTourHistory(hist);
    save();
    if (typeof Achievements !== 'undefined') Achievements.onTournamentCup(st, hist);   // 成就：九冠王 / 魔绫之主
  }
  function computeRanks(champ) {
    var ranks = {};
    ranks[champ] = 1;
    function give(id, r) { if (id != null && ranks[id] == null) ranks[id] = r; }
    give(st.matches['f1'].loser, 2);
    give(st.matches['l6'].loser, 3);
    give(st.matches['l5'].loser, 4);
    give(st.matches['l3'].loser, 5); give(st.matches['l4'].loser, 5);
    give(st.matches['l1'].loser, 7); give(st.matches['l2'].loser, 7);
    // 小组赛淘汰：第3名 → 9~12；第4名 → 13~16
    for (var gi = 0; gi < 4; gi++) {
      give(st.matches['g' + gi + '-5'].loser, 9);
      give(st.matches['g' + gi + '-4'].loser, 13);
    }
    // 未赋值的兜底
    st.entrants.forEach(function (E) { if (ranks[E.id] == null) ranks[E.id] = 16; });
    return ranks;
  }
  function computeTable(ranks) {
    return st.entrants.slice().sort(function (a, b) { return ranks[a.id] - ranks[b.id]; }).map(function (E) {
      return { name: E.name, isPlayer: E.isPlayer, rank: ranks[E.id], arch: E.arch >= 0 ? TOUR_DATA.ARCHETYPES[E.arch].n : '' };
    });
  }

  /* ---------------- 放弃 / 重开 ---------------- */
  function abandon() { st = null; SaveData.setTour(null); }

  return {
    load: load, get: get, hasActive: hasActive, nextCupName: nextCupName,
    signUp: signUp, readyPlayerMatch: readyPlayerMatch,
    matchInfo: matchInfo, recordPlayerMatch: recordPlayerMatch,
    applyPlayerReward: applyPlayerReward, playerRemoveCard: playerRemoveCard, skipReward: skipReward,
    abandon: abandon
  };
})();
