/* ============================================================
 * 晋升之路 · 模式管理  boss.js
 *  - 玩家用自己的卡组（大卡组模式 20~40 张）依次挑战 BOSS 关卡
 *  - 通关第 N 关才解锁第 N+1 关；每通关一关解锁一个称号
 *  - 进度经 SaveData.setBoss 持久化（随整档导出/导入）
 * ========================================================== */
var BossMode = (function () {
  'use strict';

  var st = null;                       // { cleared: 已通关最高关卡 }

  function save() { SaveData.setBoss(st); }
  function load() { st = SaveData.getBoss() || { cleared: 0 }; return st; }
  function get() { if (!st) load(); return st; }
  function ensure() { if (!st) load(); return st; }

  // 已解锁到第几关（通关 N 关 → 解锁 N+1）
  function unlockedMax() {
    var cl = ensure().cleared || 0;
    return Math.min(BOSS_DATA.playable(), cl + 1);
  }
  function stageOf(no) { return BOSS_DATA.stage(no); }
  function isCleared(no) { return (ensure().cleared || 0) >= no; }
  function canEnter(no) {
    var s = stageOf(no);
    return !!s && !s.reserve && no <= unlockedMax();
  }
  // 通关：更新进度 + 解锁称号
  function clearStage(no) {
    var s = stageOf(no);
    if (!s || s.reserve) return null;
    var e = ensure(), first = (no > (e.cleared || 0));
    if (first) { e.cleared = no; save(); }
    var ach = (typeof Achievements !== 'undefined' && Achievements.onBossClear) ? Achievements.onBossClear(no, s.title) : null;
    return { title: s.title, first: first, achievement: ach };
  }
  function reset() { st = { cleared: 0 }; save(); }

  // 开局参数（引擎 + UI 共用）
  function battleSetup(no, deckIds) {
    var s = stageOf(no);
    if (!s || s.reserve) return null;
    return {
      no: no, name: s.name, threat: s.threat, hp: s.hp, bossCardId: s.cardId,
      title: s.title, skills: s.skills || [], roundCap: s.roundCap || 60,
      deck: (s.deck || []).slice(), playerDeck: (deckIds || []).slice(),
      // 开局站位：默认中位(1)，关卡可用 slot:0/2 覆盖（0 = 最左侧）
      boss: { cardId: s.cardId, hp: s.hp, slot: (s.slot != null ? s.slot : 1), noAttack: !!s.noAttack, untargetable: !!s.untargetable },
      hooks: s.hooks || null
    };
  }

  return {
    load: load, get: get, ensure: ensure,
    unlockedMax: unlockedMax, stageOf: stageOf, isCleared: isCleared, canEnter: canEnter,
    clearStage: clearStage, reset: reset, battleSetup: battleSetup
  };
})();
