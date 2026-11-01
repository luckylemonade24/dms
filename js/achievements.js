/* ============================================================
 * 成就系统  achievements.js
 *  - 定义成就（id / 名称 / 说明 / 是否附带头像）；头像素材取 图标/<成就名>.png
 *  - 两类触发：
 *      · 战斗内：引擎在 state.ach 里累计计数（投掷击杀 / 窃取 / 炸弹 / 成长…），
 *                由 checkBattle(state) 结算（UI 每次渲染都会调，幂等；一局只结算一次）
 *      · 模式级：各模式在关键节点调用 onRunClear / onRunDeath / onTournamentCup / onAcademyCup…
 *  - 解锁写入 SaveData；在没有 SaveData 的环境（tools 下的无头脚本）自动降级为"只判定不解锁"
 * ========================================================== */
var Achievements = (function () {
  'use strict';

  var AVATAR_DIR = '图标/';   // 头像素材目录
  var INIT_AVATARS = ['初始头像1', '初始头像2', '初始头像3', '初始头像4', '初始头像5'];
  var INIT_TITLE = '雪景学院新生';

  /* ---------------- 成就表 ----------------
   * icon: true → 解锁同名头像（图标/<名称>.png）
   * unit/prog → 仅供界面显示进度
   */
  var LIST = [
    /* ===== 解锁新头像的成就 ===== */
    { id: 'run-first', name: '踏上征途', icon: true, desc: '首次通关「踏上征途」模式' },
    { id: 'run-scroll-5', name: '传奇法师', icon: true, desc: '通关「踏上征途」时，卡组内至少有 5 张卷轴卡' },
    { id: 'run-treasure-5', name: '传奇矿工', icon: true, desc: '通关「踏上征途」时，卡组内至少有 5 张宝藏卡' },
    { id: 'run-food-5', name: '大胃袋', icon: true, desc: '通关「踏上征途」时，卡组内至少有 5 张食物卡' },
    { id: 'run-gold-500', name: '大富翁', icon: true, desc: '通关「踏上征途」时仍持有 500 金币未花' },
    { id: 'run-act3-noattacked', name: '皇家卫士', icon: true, desc: '在「踏上征途」第三幕内直到通关，玩家未曾受到任何怪物攻击' },
    { id: 'run-die-10', name: '小资历', icon: true, desc: '在「踏上征途」中累计死亡 10 次', prog: function () { return stat('runDeaths') + ' / 10'; } },
    { id: 'run-die-100', name: '老资历', icon: true, desc: '在「踏上征途」中累计死亡 100 次', prog: function () { return stat('runDeaths') + ' / 100'; } },
    { id: 'run-streak-3', name: '凯旋英雄', icon: true, desc: '在「踏上征途」中连续通关 3 次', prog: function () { return '当前连续 ' + stat('runClearStreak') + ' 次'; } },
    { id: 'run-starter-elite', name: '原始力量', icon: true, desc: '使用纯粹的初始新手卡组，通关「踏上征途」第一幕的一只精英' },
    { id: 'throw-kill-6', name: '传奇猎手', icon: true, desc: '在一局内，用投掷物卡击杀至少 6 只怪物' },
    { id: 'tengu-20', name: '传奇天狗', icon: true, desc: '在一局内，让天狗成长至 20 点攻击力' },
    { id: 'monster-atk-30', name: '大力士', icon: true, desc: '在非学院考核模式下，一局内将一只怪物成长至 30 点攻击力' },
    { id: 'bomb-2-turn', name: '买一送一', icon: true, desc: '在一个回合内使用两个炸弹' },
    { id: 'bee-3-win', name: '蜜蜂罐罐', icon: true, desc: '击败对手时，己方场上有 3 只蜜蜂' },
    { id: 'thief-3', name: '妙手神偷', icon: true, desc: '在一局内用疯狂小偷窃取对手 3 张手牌' },
    { id: 'crab-3-fail', name: '你被骗了', icon: true, desc: '连续三个回合，使用水道螃蟹EX攻击都没有触发再攻击' },
    { id: 'tour-9', name: '九冠王', icon: true, desc: '在「魔绫大赛」中连续九届拿到冠军', prog: function () { return '最佳连续 ' + stat('tourBestStreak') + ' 届'; } },
    { id: 'tour-mio-3', name: '魔绫之主', icon: true, desc: '在「魔绫大赛」中夺冠时卡组内含有「澪」，累计 3 次', prog: function () { return stat('tourMioWins') + ' / 3'; } },
    { id: 'academy-3', name: '优秀毕业生', icon: true, desc: '在「学院考核」中连续三次获得考核第一名', prog: function () { return '最佳连续 ' + stat('academyBestStreak') + ' 次'; } },

    /* ===== 只解锁称号的成就 ===== */
    { id: 'tutor-done', name: '初出茅庐', desc: '完成「入学手册」，掌握基本操作' },
    { id: 'win-first', name: '首胜', desc: '赢得第一场决斗' },
    { id: 'win-100', name: '百战老兵', desc: '累计赢得 100 场决斗', prog: function () { return stat('battleWins') + ' / 100'; } },
    { id: 'shield-10', name: '铁壁', desc: '在一局内让一只怪物的护盾叠到 10 点' },
    { id: 'kill-2-turn', name: '双杀', desc: '在同一个回合内击破 2 只敌方怪物' },
    { id: 'hit-10', name: '秒杀', desc: '单次造成 10 点以上伤害' },
    { id: 'board-3', name: '人海战术', desc: '在一局内让自己场上同时有 3 只怪物' },
    { id: 'snail-6', name: '蜗牛骑士', desc: '在一局内把大蜗牛的攻击力成长到 6' },
    { id: 'low-hp-win', name: '绝地反击', desc: '在自己生命 ≤5 时赢下一局' },
    { id: 'potion-3', name: '药师', desc: '在一局内使用 3 张药水' },
    { id: 'food-3', name: '食神', desc: '在一局内使用 3 张食物' },
    { id: 'scroll-4', name: '卷轴学者', desc: '在一局内使用 4 张卷轴' },
    { id: 'run-clear-5', name: '探险家', desc: '累计通关「踏上征途」5 次', prog: function () { return stat('runClears') + ' / 5'; } },
    { id: 'run-gold-1000', name: '财迷', desc: '在一趟「踏上征途」中累计获得 1000 金币' },
    { id: 'run-deck-30', name: '收藏家', desc: '通关「踏上征途」时，卡组内卡牌数 ≥ 30' },
    { id: 'run-full-hp', name: '满血通关', desc: '满血通关一趟「踏上征途」' },
    { id: 'tour-join', name: '大赛新人', desc: '首次参加「魔绫大赛」' },
    { id: 'academy-join', name: '学院新生', desc: '首次参加「学院考核」' },
    /* ===== 晋升之路：16 个称号（按关卡顺序解锁） ===== */
    { id: 'boss-01', name: '初阶见习生', desc: '通关「晋升之路」第 1 关' },
    { id: 'boss-02', name: '中阶见习生', desc: '通关「晋升之路」第 2 关' },
    { id: 'boss-03', name: '高阶见习生', desc: '通关「晋升之路」第 3 关' },
    { id: 'boss-04', name: '进修见习生', desc: '通关「晋升之路」第 4 关' },
    { id: 'boss-05', name: '初阶学士', desc: '通关「晋升之路」第 5 关' },
    { id: 'boss-06', name: '中阶学士', desc: '通关「晋升之路」第 6 关' },
    { id: 'boss-07', name: '高阶学士', desc: '通关「晋升之路」第 7 关' },
    { id: 'boss-08', name: '进修学士', desc: '通关「晋升之路」第 8 关' },
    { id: 'boss-09', name: '初阶决斗者', desc: '通关「晋升之路」第 9 关' },
    { id: 'boss-10', name: '中阶决斗者', desc: '通关「晋升之路」第 10 关' },
    { id: 'boss-11', name: '高阶决斗者', desc: '通关「晋升之路」第 11 关' },
    { id: 'boss-12', name: '进修决斗者', desc: '通关「晋升之路」第 12 关' },
    { id: 'boss-13', name: '一星决斗师', desc: '通关「晋升之路」第 13 关' },
    { id: 'boss-14', name: '二星决斗师', desc: '通关「晋升之路」第 14 关' },
    { id: 'boss-15', name: '三星决斗师', desc: '通关「晋升之路」第 15 关' },
    { id: 'boss-16', name: '荣誉决斗师', desc: '通关「晋升之路」第 16 关' }
  ];

  var MAP = {};
  LIST.forEach(function (a) { MAP[a.id] = a; });

  /* ---------------- 存档桥（无 SaveData 时降级） ---------------- */
  var unlockCb = null;
  function SD() { return (typeof SaveData !== 'undefined' && SaveData) ? SaveData : null; }
  function stat(k, d) { var s = SD(); return s ? s.getStat(k, d) : (d || 0); }
  function setStat(k, v) { var s = SD(); if (s) s.setStat(k, v); return v; }
  function bump(k, n) { var s = SD(); if (s) return s.bumpStat(k, n); return (n || 1); }
  function unlocked(id) { var s = SD(); return s ? s.hasAchievement(id) : false; }
  function unlock(id) {
    var def = MAP[id];
    if (!def) return false;
    var s = SD();
    if (!s || !s.unlockAchievement(id)) return false;
    if (unlockCb) { try { unlockCb(def); } catch (e) { } }
    return true;
  }

  /* ---------------- 查询 ---------------- */
  function list() { return LIST; }
  function byId(id) { return MAP[id] || null; }
  function iconOf(name) { return AVATAR_DIR + name + '.png'; }
  function countUnlocked() { return LIST.filter(function (a) { return unlocked(a.id); }).length; }
  // 头像列表：5 个初始 + 每个"带头像的成就"各一张（未解锁的 locked=true，仍显示但置灰）
  function avatars() {
    var out = INIT_AVATARS.map(function (n) { return { id: n, name: n, icon: iconOf(n), locked: false, achId: null }; });
    LIST.forEach(function (a) {
      if (!a.icon) return;
      out.push({ id: a.name, name: a.name, icon: iconOf(a.name), locked: !unlocked(a.id), achId: a.id, achName: a.name, achDesc: a.desc });
    });
    return out;
  }
  // 称号列表：初始称号 + 每个成就解锁一个同名称号
  function titles() {
    var out = [{ name: INIT_TITLE, locked: false, achId: null }];
    LIST.forEach(function (a) { out.push({ name: a.name, locked: !unlocked(a.id), achId: a.id, desc: a.desc }); });
    return out;
  }
  function titleUnlocked(name) {
    if (name === INIT_TITLE) return true;
    var def = null;
    for (var i = 0; i < LIST.length; i++) if (LIST[i].name === name) { def = LIST[i]; break; }
    return def ? unlocked(def.id) : false;
  }

  /* ---------------- 战斗内结算（UI 每次渲染都会调，幂等） ---------------- */
  function checkBattle(s) {
    if (!s || !s.ach || s.ach.off) return;
    var a = s.ach;
    if (a.tenguMax >= 20) unlock('tengu-20');
    if (a.snailMax >= 6) unlock('snail-6');
    if (a.maxAtk >= 30 && a.mode !== 'academy') unlock('monster-atk-30');
    if (a.maxShield >= 10) unlock('shield-10');
    if (a.maxBoard >= 3) unlock('board-3');
    if (a.killsMaxTurn >= 2) unlock('kill-2-turn');
    if (a.maxHit >= 10) unlock('hit-10');
    if (a.throwKills >= 6) unlock('throw-kill-6');
    if (a.stolen >= 3) unlock('thief-3');
    if (a.bombsMax >= 2) unlock('bomb-2-turn');
    if (a.crabStreak >= 3) unlock('crab-3-fail');
    if (a.potion >= 3) unlock('potion-3');
    if (a.food >= 3) unlock('food-3');
    if (a.scroll >= 4) unlock('scroll-4');

    if (!s.winner || a.done) return;
    a.done = true;                       // 本局只结算一次（state 换新则自动重置）
    if (s.winner === 'A') {
      var wins = bump('battleWins', 1);
      if (wins >= 1) unlock('win-first');
      if (wins >= 100) unlock('win-100');
      if (s.players.A.hp <= 5) unlock('low-hp-win');
      var bees = (s.players.A.board || []).filter(function (m) { return m && !m.flags.dead && m.cardId === 'a-047-2'; }).length;
      if (bees >= 3) unlock('bee-3-win');
    }
  }

  /* ---------------- 踏上征途 ---------------- */
  function deckCount(run, pred) {
    var deck = (run && run.deck) || [];
    return deck.filter(function (id) { return CARDS[id] && pred(CARDS[id]); }).length;
  }
  function sameDeck(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    var m = {};
    a.forEach(function (x) { m[x] = (m[x] || 0) + 1; });
    for (var i = 0; i < b.length; i++) { if (!m[b[i]]) return false; m[b[i]]--; }
    return true;
  }
  function onRunClear(run) {
    if (!run) return;
    unlock('run-first');
    if (deckCount(run, function (c) { return c.type === 'scroll'; }) >= 5) unlock('run-scroll-5');
    if (deckCount(run, function (c) { return c.type === 'treasure'; }) >= 5) unlock('run-treasure-5');
    if (deckCount(run, function (c) { return c.type === 'food'; }) >= 5) unlock('run-food-5');
    if (deckCount(run, function (c) { return !!c; }) >= 30) unlock('run-deck-30');
    if ((run.gold || 0) >= 500) unlock('run-gold-500');
    if ((run.goldEarned || 0) >= 1000) unlock('run-gold-1000');
    if ((run.hp || 0) >= (run.maxHp || 30)) unlock('run-full-hp');
    if (run.act3Clean) unlock('run-act3-noattacked');
    var streak = setStat('runClearStreak', stat('runClearStreak') + 1);
    if (streak > stat('runBestStreak')) setStat('runBestStreak', streak);
    if (streak >= 3) unlock('run-streak-3');
    var total = bump('runClears', 1);
    if (total >= 5) unlock('run-clear-5');
  }
  function onRunDeath() {
    setStat('runClearStreak', 0);                    // 死亡打断"连续通关"
    var n = bump('runDeaths', 1);
    if (n >= 10) unlock('run-die-10');
    if (n >= 100) unlock('run-die-100');
  }
  // 跑图每场战斗结束时调用（runui.js）：原始力量 + 第三幕无伤记录
  function onRunBattleEnd(win, engineState, node) {
    var s = SD();
    var run = (s && s.getRun) ? s.getRun() : null;
    if (!run) return;
    if (run.act === 3 && engineState && engineState.ach && engineState.ach.playerAttacked > 0) {
      run.act3Clean = false;
      s.setRun(run);
    }
    if (win && node && node.type === 'elite' && (run.act || 1) === 1 &&
      sameDeck(run.deck, (typeof PRESET_DECKS !== 'undefined' ? PRESET_DECKS.starter : null))) {
      unlock('run-starter-elite');
    }
  }

  /* ---------------- 魔绫大赛 ---------------- */
  function onTournamentCup(st, hist) {
    if (!st || !st.result) return;
    var champ = !!st.result.championIsPlayer;
    var streak = 0;
    for (var i = (hist || []).length - 1; i >= 0; i--) {
      if (hist[i] && hist[i].championIsPlayer) streak++; else break;
    }
    if (streak > stat('tourBestStreak')) setStat('tourBestStreak', streak);
    if (streak >= 9) unlock('tour-9');
    if (!champ) return;
    var deck = [];
    (st.entrants || []).forEach(function (e) { if (e && e.isPlayer) deck = e.deck || []; });
    if (deck.indexOf('a-100-2') >= 0) {
      var n = bump('tourMioWins', 1);
      if (n >= 3) unlock('tour-mio-3');
    }
  }

  /* ---------------- 学院考核 ---------------- */
  function onAcademyCup(st, hist) {
    if (!st || !st.result) return;
    var first = !!st.result.championIsPlayer;
    var streak = 0;
    for (var i = (hist || []).length - 1; i >= 0; i--) {
      if (hist[i] && hist[i].championIsPlayer) streak++; else break;
    }
    if (streak > stat('academyBestStreak')) setStat('academyBestStreak', streak);
    if (streak >= 3) unlock('academy-3');
    if (first && (st.result.playerRank || 0) === 1) { /* 与 streak 判定一致，无需额外处理 */ }
  }

  /* ---------------- 晋升之路 ---------------- */
  // 通关第 no 关 → 解锁对应称号（boss-01 ~ boss-16）
  function onBossClear(no, title) {
    no = Math.max(1, Math.min(16, no | 0));
    var id = 'boss-' + (no < 10 ? '0' + no : no);
    var had = unlocked(id);
    var ok = unlock(id);
    var e = (typeof BOSS_DATA !== 'undefined') ? BOSS_DATA.stage(no) : null;
    return { id: id, name: (e && e.title) || title || '', isNew: !had && ok };
  }

  /* ---------------- 其它入口 ---------------- */
  function onTutorialDone() { unlock('tutor-done'); }
  function onEnterMode(mode) {
    if (mode === 'tour') unlock('tour-join');
    if (mode === 'academy') unlock('academy-join');
  }
  function setUnlockListener(fn) { unlockCb = fn; }

  return {
    AVATAR_DIR: AVATAR_DIR, INIT_AVATARS: INIT_AVATARS, INIT_TITLE: INIT_TITLE,
    list: list, byId: byId, unlocked: unlocked, countUnlocked: countUnlocked, total: function () { return LIST.length; },
    avatars: avatars, titles: titles, titleUnlocked: titleUnlocked, iconOf: iconOf,
    checkBattle: checkBattle,
    onRunClear: onRunClear, onRunDeath: onRunDeath, onRunBattleEnd: onRunBattleEnd,
    onTournamentCup: onTournamentCup, onAcademyCup: onAcademyCup,
    onBossClear: onBossClear,
    onTutorialDone: onTutorialDone, onEnterMode: onEnterMode,
    setUnlockListener: setUnlockListener
  };
})();
