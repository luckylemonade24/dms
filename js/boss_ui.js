/* ============================================================
 * 晋升之路 · 界面  boss_ui.js
 *  - 关卡列表（已通关 / 可挑战 / 未解锁）
 *  - 挑战：用自己的卡组（大卡组 20~40 张）开局 BOSS 战
 *  - 结算：击破 BOSS → 通关并解锁称号
 * ========================================================== */
var BossUI = (function () {
  'use strict';

  var curNo = 0;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function toast(m) { if (window.UI && UI.toast) UI.toast(m); }

  function open() {
    ['menu', 'deck', 'tour', 'academy', 'battle', 'map', 'runpanel'].forEach(function (id) {
      var el = $(id); if (el) el.classList.add('hidden');
    });
    var el = $('boss'); if (el) el.classList.remove('hidden');
    render();
  }
  function close() { var el = $('boss'); if (el) el.classList.add('hidden'); }

  function deckInfo() {
    var d = SaveData.activeDeck();
    var v = DeckRules.validateBig(d.cardIds);
    return { deck: d, ok: v.ok, errors: v.errors, size: d.cardIds.length };
  }

  function render() {
    var el = $('boss'); if (!el) return;
    BossMode.ensure();
    var unlocked = BossMode.unlockedMax();
    var dk = deckInfo();
    var h = '<div style="position:fixed;inset:0;overflow:auto;padding:18px 22px;background:radial-gradient(1200px 700px at 50% 0%,#1b2233,#0d1119 70%);color:#e8edf6">' +
      '<div style="max-width:1080px;margin:0 auto">' +
      '<h2 style="margin:0 0 4px;letter-spacing:2px">晋升之路</h2>' +
      '<div style="opacity:.72;font-size:calc(13px * var(--fs, 1));margin-bottom:10px">用自己的卡组（大卡组模式 20~40 张）依次挑战 BOSS：<b>击破 BOSS 即通关</b>（对手本体锁血，打不死）；通关一关解锁下一关与一个称号。</div>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;font-size:calc(13px * var(--fs, 1))">' +
      '<span>当前卡组：<b>' + esc(dk.deck.name) + '</b>（' + dk.size + ' 张）</span>' +
      (dk.ok ? '<span style="color:#7fd6a0">✓ 合法</span>' : '<span style="color:#ff8f8f">✗ ' + esc(dk.errors.join('；')) + '</span>') +
      '<button id="bossDeckBtn" class="pxbtn ghost">去组卡器（大卡组模式）</button>' +
      '<span style="opacity:.6">已通关 ' + (BossMode.get().cleared || 0) + ' / ' + BOSS_DATA.playable() + ' 关</span>' +
      '</div><div id="bossList"></div>' +
      '<div class="mbtns" style="margin-top:16px"><button id="bossBack" class="pxbtn ghost">返回主菜单</button></div>' +
      '</div></div>';
    el.innerHTML = h;

    var list = $('bossList');
    var rows = '';
    BOSS_DATA.STAGES.forEach(function (s) {
      var locked = !!s.reserve || s.no > unlocked;
      var cleared = BossMode.isCleared(s.no);
      var bg = s.reserve ? '#161a22' : (cleared ? 'rgba(60,120,90,.22)' : (locked ? '#161a22' : 'rgba(60,90,140,.20)'));
      var border = s.reserve ? '#242a35' : (cleared ? '#3f7a5c' : (locked ? '#242a35' : '#3c5f96'));
      rows += '<div style="display:flex;gap:12px;align-items:flex-start;padding:10px 12px;margin-bottom:8px;border:1px solid ' + border + ';border-radius:10px;background:' + bg + ';opacity:' + (locked ? '.55' : '1') + '">' +
        '<div style="min-width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#0e1420;border:1px solid #2b3446;font-weight:700">' + s.no + '</div>' +
        '<div style="flex:1;min-width:0">' +
        '<div style="font-size:calc(15px * var(--fs, 1));font-weight:700">' + esc(s.name) +
        (s.threat && s.threat !== '—' ? ' <span style="font-size:calc(12px * var(--fs, 1));opacity:.7;border:1px solid #3a465c;border-radius:8px;padding:0 6px;margin-left:6px">' + esc(s.threat) + '</span>' : '') +
        (s.hp ? ' <span style="font-size:calc(12px * var(--fs, 1));opacity:.7;margin-left:6px">BOSS 生命 ' + s.hp + '</span>' : '') +
        (s.slot != null && s.slot !== 1 ? ' <span style="font-size:calc(12px * var(--fs, 1));opacity:.7;margin-left:6px">开局站位：' + ['最左', '中', '最右'][s.slot] + '</span>' : '') + '</div>' +
        '<div style="font-size:calc(12px * var(--fs, 1));opacity:.78;margin:4px 0;line-height:1.6">' +
        (s.skills || []).map(function (k) { return '<span style="color:#9fc4ff">【' + esc(k[0]) + '】</span>' + esc(k[1]); }).join('　') + '</div>' +
        '<div style="font-size:calc(12px * var(--fs, 1));opacity:.66">通关称号：<b>' + esc(s.title) + '</b>' + (cleared ? ' <span style="color:#7fd6a0">（已获得）</span>' : '') + '</div>' +
        '</div><div style="min-width:92px;text-align:right">' +
        (cleared ? '<button class="pxbtn bossGo" data-no="' + s.no + '">再战</button>'
            : locked ? '<span style="opacity:.6;font-size:calc(12px * var(--fs, 1))">未解锁</span>'
              : '<button class="pxbtn bossGo" data-no="' + s.no + '">挑战</button>') +
        '</div></div>';
    });
    list.innerHTML = rows;

    var gos = el.querySelectorAll('.bossGo');
    for (var i = 0; i < gos.length; i++) gos[i].onclick = function () { enter(+this.getAttribute('data-no')); };
    if ($('bossBack')) $('bossBack').onclick = function () { if (window.UI && UI.showMenu) UI.showMenu(); };
    if ($('bossDeckBtn')) $('bossDeckBtn').onclick = function () { if (window.DeckBuilder) DeckBuilder.show(); };
  }

  function enter(no) {
    if (!BossMode.canEnter(no)) { toast('该关卡尚未解锁'); return; }
    var dk = deckInfo();
    if (!dk.ok) { toast('卡组不合法：' + dk.errors[0] + '（可在组卡器开"大卡组模式"调整到 20~40 张）'); return; }
    var setup = BossMode.battleSetup(no, dk.deck.cardIds);
    if (!setup) { toast('关卡数据缺失'); return; }
    curNo = no;
    if (typeof Achievements !== 'undefined' && Achievements.onEnterMode) Achievements.onEnterMode('boss');
    UI.startBattle({
      playerDeck: setup.playerDeck, aiDeck: setup.deck,
      aiName: 'BOSS · ' + setup.name, playerName: SaveData.getPlayerName(),
      playerHp: 30, playerMax: 30, aiHp: 40, first: 'A',
      mode: 'boss', maxRounds: setup.roundCap,
      boss: setup.boss, bodyLock: true, bossHooks: setup.hooks
    });
  }

  // 对局结算（由 ui.js 弹窗的"查看结果"按钮触发）
  function onBattleEnd(win) {
    if (win) {
      var s = BossMode.stageOf(curNo);
      var r = BossMode.clearStage(curNo);
      open();
      if (r && r.achievement && r.achievement.isNew) toast('通关！解锁称号：' + r.achievement.name);
      else toast('通关！' + (s ? '（' + s.name + '）' : ''));
    } else {
      open();
      toast('挑战失败，可调整卡组后再战');
    }
  }

  function bind() {
    if ($('btnBoss')) $('btnBoss').onclick = function () { open(); };
  }

  return { open: open, close: close, render: render, enter: enter, onBattleEnd: onBattleEnd, bind: bind };
})();
