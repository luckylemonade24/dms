/* ============================================================
 * 入学手册（新手教程）· 界面  tutorial_ui.js
 *  - 主菜单入口「入学手册」；首次打开游戏时询问"是不是新手"，是则自动开启
 *  - 教练面板：当前步骤 / 目标高亮 / 退出
 *  - 推进方式（不用按钮）：
 *      mode 'read'：纯讲解 → 左键点击任意位置翻到下一步
 *      mode 'do'  ：需要操作 → 必须做完操作才自动翻页（点击无效）
 * ========================================================== */
var TutorialUI = (function () {
  'use strict';

  var panel = null;         // #tutPanel
  var bound = false;
  var graded = false;       // 本次教程是否已弹过毕业窗
  var clickLock = 0;        // 启动后的短锁：避免"开始那一下点击"直接把第 1 步翻过去

  function $(id) { return document.getElementById(id); }
  function sfx(name) { try { if (window.Sfx && Sfx.play) Sfx.play(name); } catch (e) { } }

  /* ---------------- 点击推进 ---------------- */
  // read 步骤：左键点击任意位置前进；do 步骤：必须做完操作（点击无效）
  function advanceByClick() {
    if (!window.Tutorial || !Tutorial.isActive()) return false;
    if (Date.now() < clickLock) return false;
    var st = Tutorial.current();
    if (!st || st.mode !== 'read' || Tutorial.isDone()) return false;
    sfx('click');
    Tutorial.next();
    refresh();
    return true;
  }
  function onDocClick(e) {
    var t = e.target;
    if (t && t.closest) {
      if (t.closest('#modal')) return;                                  // 弹窗（毕业 / 首次询问）内的点击不算
      if (t.closest('#tutPanel button')) return;                        // 面板上的按钮（退出）不算
      if (t.closest('#battleFsBtn, #battleSetBtn, #battleAutoBtn')) return;   // 顶栏按钮（全屏 / 设置 / 自动战斗）不该推进教程
      if (t.closest('#menu, #deck, #map, #tour, #academy, #runpanel')) return;
    }
    advanceByClick();
  }

  /* ---------------- 教练面板 ---------------- */
  function ensurePanel() {
    if (panel) return panel;
    var stage = $('stage');
    if (!stage) return null;
    panel = document.createElement('div');
    panel.id = 'tutPanel';
    panel.className = 'tut-panel hidden';
    // 面板内的点击不冒泡到舞台（否则会被当成"点击空白处取消选择"）；
    // 但点到面板空白处也算"继续"（read 步骤）
    panel.addEventListener('click', function (e) {
      e.stopPropagation();
      if (e.target && e.target.closest && e.target.closest('button')) return;
      advanceByClick();
    });
    stage.appendChild(panel);
    return panel;
  }
  function showPanel(on) {
    var p = ensurePanel();
    if (!p) return;
    if (on) p.classList.remove('hidden'); else p.classList.add('hidden');
  }

  function clearHighlight() {
    var els = document.querySelectorAll('.tut-target');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('tut-target');
  }
  function applyHighlight() {
    clearHighlight();
    if (!window.Tutorial || !Tutorial.isActive()) return;
    var st = Tutorial.current();
    if (!st || typeof st.targets !== 'function') return;
    (st.targets() || []).forEach(function (sel) {
      if (!sel) return;
      var els = document.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) els[i].classList.add('tut-target');
    });
  }

  function renderPanel(s) {
    var p = ensurePanel();
    if (!p || p.classList.contains('hidden')) return;
    var st = Tutorial.current();
    if (!st) return;
    // 步骤可用 side:'left' 指定助教框贴左侧（默认右下角）；介绍右侧日志栏那一步需要让开位置
    p.classList.toggle('tut-left', st.side === 'left');
    var n = Tutorial.stepIndex() + 1, total = Tutorial.count(), done = Tutorial.isDone();
    var dots = '';
    for (var i = 0; i < total; i++) dots += '<i class="' + (i < n - 1 ? 'ok' : (i === n - 1 ? 'on' : '')) + '"></i>';
    var phase = '';
    if (s) {
      phase = (s.active === 'A')
        ? (s.phase === 'PREP' ? '你的准备阶段' : '你的战斗阶段')
        : '对手回合（稍等）';
    }
    var status = done ? '已毕业'
      : (st.mode === 'read'
        ? '<span class="tut-go">▶ 左键点击任意位置继续</span>'
        : '完成上面的操作后自动进入下一步（本步点击不翻页）');
    p.innerHTML =
      '<div class="tut-head">' +
        '<span class="tut-ttl">入学手册</span>' +
        '<span class="tut-step">第 ' + n + ' / ' + total + ' 步</span>' +
        '<span class="tut-spacer"></span>' +
        '<button class="pxbtn ghost small" id="tutQuit">退出</button>' +
      '</div>' +
      '<div class="tut-dots">' + dots + '</div>' +
      '<h4 class="tut-t">' + st.title + '</h4>' +
      '<p class="tut-text">' + st.text + '</p>' +
      (st.tip ? '<p class="tut-tip">助教提示：' + st.tip + '</p>' : '') +
      '<div class="tut-status">' + status + (phase ? ('　·　当前：' + phase) : '') + '</div>' +
      (done ? '<div class="tut-foot"><button class="pxbtn" id="tutHome">返回主菜单</button></div>' : '');

    if ($('tutQuit')) $('tutQuit').onclick = function (e) { e.stopPropagation(); sfx('click'); quit(); };
    if ($('tutHome')) $('tutHome').onclick = function (e) { e.stopPropagation(); sfx('click'); if (window.UI) UI.showMenu(); };
  }

  var lastPanelSig = '';
  var lastStepIdx = -1;
  function refresh(s) {
    s = s || (window.Engine ? Engine.state : null);
    // 换步时教程会改动引擎状态（发/换手牌、摆怪）→ 必须重绘战场 DOM；
    // 否则界面还挂着上一份实例（iid 已失效）→ 拖牌会报「手牌中没有这张卡」
    if (window.Tutorial && Tutorial.isActive() && Tutorial.stepIndex() !== lastStepIdx) {
      lastStepIdx = Tutorial.stepIndex();
      if (window.UI && Engine.state) { try { UI.render(Engine.state); } catch (e) { } }
    }
    // 面板只在"步骤/阶段/血量变化"时重绘（引擎通知很频繁，避免闪烁）；
    // 高亮必须每次都重打：战场 DOM 每次渲染都会重建
    var sig = [Tutorial.isActive() ? 1 : 0, Tutorial.stepIndex(),
      s ? s.phase : '', s ? s.active : '', s ? s.players.A.hp : '',
      s ? s.players.B.hp : '', s ? s.round : ''].join('|');
    if (sig !== lastPanelSig) { lastPanelSig = sig; renderPanel(s); }
    applyHighlight();
    if (Tutorial.isActive() && Tutorial.isDone() && !graded) {
      graded = true;
      showGraduation();
    }
  }

  /* ---------------- 毕业 / 退出 ---------------- */
  function showGraduation() {
    var modal = $('modal');
    if (!modal) return;
    var win = Tutorial.lastBattleWin();
    var head = (win === false) ? '入学手册 · 完成' : '入学手册 · 毕业！';
    var line = (win === false)
      ? '这次输了没关系 —— 操作你都学会了，回头再来一局。'
      : '漂亮！你已经能独立完成一场决斗了。';
    modal.classList.remove('hidden');
    modal.innerHTML =
      '<div class="mbox tut-grad"><h3>' + head + '</h3>' +
      '<p>' + line + '</p>' +
      '<p class="dim">你已经掌握：召唤怪物 · 使用道具 · 装备强化 · 进入战斗 · 指挥攻击 · 结束回合。</p>' +
      '<div class="mbtns col">' +
        '<button id="tutGradHome" class="pxbtn">返回主菜单</button>' +
        '<button id="tutGradAgain" class="pxbtn ghost">再学一遍</button>' +
      '</div></div>';
    sfx('win');
    if ($('tutGradHome')) $('tutGradHome').onclick = function () { modal.classList.add('hidden'); if (window.UI) UI.showMenu(); };
    if ($('tutGradAgain')) $('tutGradAgain').onclick = function () { modal.classList.add('hidden'); start(); };
  }

  function quit() {
    var msg = '退出入学手册？随时可以在主菜单重新开始。';
    var doQuit = function () { if (window.UI) UI.showMenu(); };
    if (window.UI && UI.confirm) UI.confirm(msg, doQuit, null, { yes: '退出', no: '继续' });
    else if (window.confirm(msg)) doQuit();
  }

  /* ---------------- 启动 / 关闭 ---------------- */
  function start() {
    if (!window.UI || typeof TUTORIAL_DATA === 'undefined') return;
    graded = false; lastPanelSig = ''; lastStepIdx = -1;
    clickLock = Date.now() + 500;                           // 开始按钮那一下点击不要顺带翻页
    UI.startBattle({
      tutorial: true,
      diff: 'novice',                                       // 教学局用新手档
      playerDeck: TUTORIAL_DATA.PLAYER_DECK.slice(),
      aiDeck: TUTORIAL_DATA.FOE_DECK.slice(),
      aiHp: TUTORIAL_DATA.FOE_HP,
      aiName: '实习稻草人',
      seed: 4242, first: 'A'
    });
    showPanel(true);
    Tutorial.begin();          // 布置第 1 步的场景（清空初始发牌等）
    UI.render(Engine.state);   // 立刻按教程状态重绘：否则画面还停在新开局发到的手牌上
    refresh();
  }
  function close() {
    if (window.Tutorial) Tutorial.stop();
    showPanel(false);
    clearHighlight();
    graded = false; lastPanelSig = ''; lastStepIdx = -1;
  }

  /* ---------------- 首次进入询问 ---------------- */
  // 是否"全新玩家"：没被问过，且没有任何进度（跑图 / 大赛 / 学院考核的记录都为空）
  function isBrandNew() {
    if (typeof SaveData === 'undefined') return false;
    if (SaveData.isTutorAsked()) return false;
    if (SaveData.hasRun && SaveData.hasRun()) return false;
    if (SaveData.getTour && SaveData.getTour()) return false;
    if (SaveData.getAcademy && SaveData.getAcademy()) return false;
    if (SaveData.getTourHistory && SaveData.getTourHistory().length) return false;
    if (SaveData.getAcademyHistory && SaveData.getAcademyHistory().length) return false;
    return true;
  }
  function askFirstTime() {
    if (!isBrandNew()) return false;
    var modal = $('modal');
    if (!modal) return false;
    modal.classList.remove('hidden');
    modal.innerHTML =
      '<div class="mbox"><h3>第一次来吗？</h3>' +
      '<p>检测到你是<b>第一次</b>打开《地牢决斗师》。<br>' +
      '要不要先走一遍<b>「入学手册」</b>？大约 3 分钟，手把手教你召唤怪物、使用道具、装备、攻击。</p>' +
      '<div class="mbtns col">' +
        '<button id="tutYes" class="pxbtn">我是新手，带我上手</button>' +
        '<button id="tutNo" class="pxbtn ghost">我会玩，直接开始</button>' +
      '</div></div>';
    if ($('tutYes')) $('tutYes').onclick = function () {
      SaveData.markTutorAsked();
      modal.classList.add('hidden');
      sfx('click');
      start();
    };
    if ($('tutNo')) $('tutNo').onclick = function () {
      SaveData.markTutorAsked();
      modal.classList.add('hidden');
      if (window.UI) UI.toast('随时可在主菜单点「入学手册」复习');
    };
    return true;
  }

  /* ---------------- 绑定 ---------------- */
  function init() {
    if (bound) return;
    bound = true;
    var btn = $('btnTutorial');
    if (btn) btn.onclick = function () { sfx('click'); start(); };
    // 左键点击任意位置 = 推进"讲解"步骤（do 步骤不响应）
    document.addEventListener('click', onDocClick, false);
    // 引擎每次刷新：推进教程 + 重画面板 + 重打高亮（DOM 每次渲染都会重建，所以必须重打）
    Engine.on(function (s) {
      if (!window.Tutorial || !Tutorial.isActive()) return;
      if (window.__acSilent) return;
      Tutorial.onState(s);
      refresh(s);
    });
    // 首次进入：询问是否新手
    askFirstTime();
  }

  return {
    init: init, start: start, close: close, refresh: refresh,
    askFirstTime: askFirstTime, showGraduation: showGraduation, advanceByClick: advanceByClick
  };
})();
