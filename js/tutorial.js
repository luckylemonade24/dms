/* ============================================================
 * 入学手册（新手教程）· 核心状态机  tutorial.js
 *  - 只做"步骤推进 / 完成判定 / 进度持久化"，不碰 DOM（便于无头测试）
 *  - 完成判定 = 拿"进入本步时的状态快照"与当前引擎状态比较（见 tutorial_data.js 的 check）
 *  - 界面由 tutorial_ui.js 负责
 * ========================================================== */
var Tutorial = (function () {
  'use strict';

  var active = false;      // 教程是否进行中
  var idx = 0;             // 当前步骤下标
  var snap = null;         // 进入当前步骤时的状态快照
  var busy = false;        // 布置场景期间忽略引擎通知（避免误判完成）
  var onChange = null;     // 面板刷新回调
  var lastWin = null;      // 本局结果（true = 玩家赢）
  var lastSig = '';        // 面板刷新节流用
  var lastState = null;    // 上一次看到的对局（对象换了 = 对局被重开 → 教程从头开始）

  function steps() { return (typeof TUTORIAL_DATA !== 'undefined') ? TUTORIAL_DATA.STEPS : []; }
  function count() { return steps().length; }
  function current() { return steps()[Math.min(idx, Math.max(0, count() - 1))] || null; }
  function isActive() { return active; }
  function stepIndex() { return idx; }
  function isDone() { return idx >= count() - 1; }        // 已停在"毕业"这一步
  function lastBattleWin() { return lastWin; }
  function setChangeListener(fn) { onChange = fn; }
  function save(patch) { if (typeof SaveData !== 'undefined' && SaveData.setTutor) SaveData.setTutor(patch); }

  function fire(s) {
    var st = s || (typeof Engine !== 'undefined' ? Engine.state : null);
    var sig = [idx, st ? st.phase : '', st ? st.active : '', st ? st.round : '',
      st ? st.players.A.hp : '', st ? st.players.B.hp : '', active ? 1 : 0].join('|');
    if (sig === lastSig) return;      // 同一步/同一局面下不重复重绘
    lastSig = sig;
    if (onChange) { try { onChange(st); } catch (e) { console.error('[入学手册] 面板刷新失败', e); } }
  }

  function snapshot(s) {
    if (!s) return {};
    return {
      board: Engine.aliveMonsters('A').length,
      foeBoard: Engine.aliveMonsters('B').length,
      dealtA: (s.dealt && s.dealt.A) || 0,
      turnCount: s.turnCount || 0,
      round: s.round || 1,
      hp: s.players.A.hp
    };
  }

  // 进入某一步：布置场景 → 记录快照 → 通知面板
  function enter() {
    busy = true;
    try {
      var st = current();
      if (st && typeof st.setup === 'function') st.setup();
      snap = snapshot(Engine.state);
    } finally { busy = false; }
    lastSig = '';                      // 强制刷新面板
    save({ step: idx });
    fire();
  }

  function begin() {
    active = true; lastWin = null; idx = 0;
    if (typeof TUTORIAL_DATA !== 'undefined' && TUTORIAL_DATA.onBegin) TUTORIAL_DATA.onBegin();
    lastState = Engine.state;            // 记住本局对象
    enter();
  }
  function stop() { active = false; lastSig = ''; fire(); }
  function go(i) { if (!active) return; idx = Math.max(0, Math.min(i, count() - 1)); enter(); }
  function next() { if (idx < count() - 1) go(idx + 1); }
  function back() { if (idx > 0) go(idx - 1); }
  function skip() { next(); }

  // 对局每次刷新时由 UI 调用：判断是否满足当前步骤的目标
  function onState(s) {
    if (!active || busy || !s) return;
    // 对局被"重开本局"换成了新对象 → 教程从头来（不要用回合数判断：开局也是第 1 回合）
    if (s !== lastState) {
      lastState = s;
      if (idx > 0) { begin(); return; }
    }

    if (s.winner) {                    // 打完（赢或输）→ 直接进"毕业"
      if (lastWin === null) {
        lastWin = (s.winner === 'A');
        if (typeof SaveData !== 'undefined' && SaveData.markTutorDone) SaveData.markTutorDone();
        if (typeof Achievements !== 'undefined') Achievements.onTutorialDone();   // 成就「初出茅庐」
      }
      if (idx < count() - 1) { go(count() - 1); return; }
      fire(s);
      return;
    }

    var st = current();
    if (st && typeof st.check === 'function' && st.check(s, snap)) { next(); return; }
    fire(s);
  }

  return {
    begin: begin, stop: stop, next: next, back: back, skip: skip, go: go, onState: onState,
    current: current, stepIndex: stepIndex, count: count,
    isActive: isActive, isDone: isDone, lastBattleWin: lastBattleWin,
    setChangeListener: setChangeListener
  };
})();
