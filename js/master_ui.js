/* ============================================================
 * 大师赛（联机）· 界面   master_ui.js
 *
 *   主菜单「魔绫大赛」→ 弹窗选择：联盟赛（PVE，走原 tournament_ui）/
 *                              大师赛（PVP，本文件）
 *   大师赛面板：【排名赛】（待开发）【友谊赛】【赛事纪录】
 *   友谊赛：创建 / 加入房间 → 房间（2 对战席 + 2 观战席，房主可改胜负规则）
 *          → 准备面板（双方头像/名字/称号/卡组名/准备状态）→ 对战 → 回房间
 *
 *   本文件只依赖 net.js 暴露的接口（房间数据 + 事件），
 *   将来接上权威服务器时，界面这一层不需要改动。
 * ========================================================== */
var MasterUI = (function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  var view = 'entry';      // entry | friendly | room | prep | records | battle
  var lastMsg = '';
  var series = null;       // 当前对战系列（多局制）

  /* ---------------- 容器切换 ---------------- */
  var OTHERS = ['menu', 'battle', 'deck', 'map', 'runpanel', 'tour', 'academy', 'boss'];
  function open() {
    OTHERS.forEach(function (id) { var el = $(id); if (el) el.classList.add('hidden'); });
    var m = $('master'); if (m) m.classList.remove('hidden');
  }
  function render(html) { open(); var m = $('master'); if (m) m.innerHTML = '<div class="ms-wrap">' + html + '</div>'; }
  /* 大师赛界面当前是否真的可见。
   * 用于"重连刷新"类事件：重连成功时服务器会把 room 重发一遍，
   * 这时只有玩家本来就看着大师赛界面才该重绘 —— 否则在组卡器 / 主菜单里
   * 也会被强行拽回大师赛界面。 */
  function masterVisible() {
    var m = $('master');
    return !!(m && !m.classList.contains('hidden'));
  }
  function toMenu() { var m = $('master'); if (m) m.classList.add('hidden'); if (window.UI) UI.showMenu(); }

  /* ---------------- 小工具 ---------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(t) {
    var d = new Date(t || 0);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function ava(p, cls) { return '<span class="ms-ava ' + (cls || '') + '"><img src="' + Net.iconOf((p && p.avatar) || '初始头像1') + '" alt=""></span>'; }
  function playerLine(p, extra) {
    return ava(p) + '<span class="ms-pl"><b>' + esc(p.name) + '</b><em>' + esc(p.title || '—') + '</em>' + (extra || '') + '</span>';
  }
  function mePlayer() {
    var f = Net.fighters().filter(function (p) { return p.self; })[0];
    return f || Net.me();
  }
  function oppPlayer() {
    var f = Net.fighters().filter(function (p) { return !p.self; })[0];
    return f || { name: '等待对手…', avatar: '初始头像2', title: '—', deckName: '—', deckIds: [] };
  }

  /* ---------------- 房间内切换卡组 ---------------- */
  // 点自己的卡组名 → 弹出卡组列表（也支持手机：行高够大、弹窗内部滚动）
  function openDeckPick() {
    var m = $('modal'); if (!m) return;
    var s = (window.SaveData && SaveData.get) ? SaveData.get() : { decks: [] };
    var curIdx = (window.SaveData && SaveData.get) ? SaveData.get().activeDeck : 0;
    var h = '<div class="mbox ms-deckpick"><h3>选择卡组</h3>' +
      '<p class="dim">本场对局使用的卡组（当前：' + esc((s.decks[curIdx] || {}).name || '—') + '）</p>' +
      '<div class="ms-dplist">';
    (s.decks || []).forEach(function (d, i) {
      h += '<div class="ms-dprow' + (i === curIdx ? ' cur' : '') + '" data-dp="' + i + '">' +
        '<span class="ms-dpn">' + esc(d.name) + '</span>' +
        '<span class="ms-dpc">' + (d.cardIds || []).length + ' 张' + (d.big ? ' · 大卡组' : '') + '</span>' +
        '<span class="ms-dpb">' + (i === curIdx ? '使用中' : '选择') + '</span></div>';
    });
    h += '</div><div class="mbtns"><button id="msDpClose" class="pxbtn ghost">关闭</button></div></div>';
    m.innerHTML = h;
    m.classList.remove('hidden');
    if ($('msDpClose')) $('msDpClose').onclick = function () { Sfx.play('click'); m.classList.add('hidden'); };
    Array.prototype.forEach.call(m.querySelectorAll('[data-dp]'), function (el) {
      el.onclick = function () {
        var i = +el.getAttribute('data-dp');
        var d = SaveData.get().decks[i];
        if (!d || i === SaveData.get().activeDeck) { m.classList.add('hidden'); return; }
        Sfx.play('click');
        SaveData.setActiveDeck(i);
        Net.refreshMe();                      // 同步到房间里"我"这个席位
        m.classList.add('hidden');
        UI.toast('已切换到【' + d.name + '】');
        if (view === 'prep') showPrep(); else if (view === 'room') showRoom();
      };
    });
  }
  function bindDeckPick() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-msdeck]'), function (el) {
      el.onclick = function (e) { if (e && e.stopPropagation) e.stopPropagation(); Sfx.play('click'); openDeckPick(); };
    });
  }

  /* ---------------- 入口分流（主菜单点「魔绫大赛」） ---------------- */
  function showCupChoice() {
    var m = $('modal'); if (!m) return;
    m.classList.remove('hidden');
    m.innerHTML =
      '<div class="mbox cup-choice">' +
        '<h3>魔绫大赛</h3>' +
        '<p class="dim">请选择赛制</p>' +
        '<div class="cc-list">' +
          '<button class="cc-card" id="ccLeague">' +
            '<span class="cc-badge pve">PVE</span><b>联盟赛</b>' +
            '<span class="cc-desc">单人闯关 · 16 名选手双败淘汰</span>' +
          '</button>' +
          '<button class="cc-card" id="ccMaster">' +
            '<span class="cc-badge pvp">PVP</span><b>大师赛</b>' +
            '<span class="cc-desc">联机对战 · 与朋友开房切磋</span>' +
          '</button>' +
        '</div>' +
        '<div class="mbtns"><button id="ccBack" class="pxbtn ghost">返回主菜单</button></div>' +
      '</div>';
    if (window.Sfx) Sfx.play('click');
    if ($('ccLeague')) $('ccLeague').onclick = function () {
      Sfx.play('click'); m.classList.add('hidden');
      if (window.TourUI) TourUI.showEntry();
    };
    if ($('ccMaster')) $('ccMaster').onclick = function () { Sfx.play('click'); m.classList.add('hidden'); showEntry(); };
    if ($('ccBack')) $('ccBack').onclick = function () { Sfx.play('click'); m.classList.add('hidden'); };
  }

  /* ---------------- 联机连接（进入大师赛时自动尝试一次） ---------------- */
  var connTried = false;
  function ensureOnline() {
    if (connTried || !Net.connect) return;
    connTried = true;
    Net.connect();          // 连不上会自动退回"本机模拟"，不影响界面试用
  }

  /* ---------------- 大师赛主面板 ---------------- */
  function showEntry() {
    view = 'entry';
    ensureOnline();
    var p = Net.me();
    var online = !!(Net.isOnline && Net.isOnline());
    render(
      '<h1 class="ms-title">大师赛</h1>' +
      '<p class="ms-sub">联机对战 · 与好友切磋</p>' +
      '<div class="ms-net' + (online ? ' on' : '') + '" id="msNet">' +
        (online ? '已连接服务器 · 可以和好友联机对战'
          : '未连接服务器（当前为本机模拟模式）　<b>点这里重试连接</b>') +
      '</div>' +
      // 当前在线人数（服务端广播，含对局中的玩家；断线会立刻减一）
      '<div class="ms-online" id="msOnline">当前在线人数：' + (Net.onlineCount ? Net.onlineCount() : 0) + '</div>' +
      '<div class="ms-me">' + playerLine(p, '<span class="ms-deck">卡组：' + esc(p.deckName) + '</span>') + '</div>' +
      '<div class="ms-menu">' +
        '<button class="ms-item" id="msRank">' +
          '<b>排名赛</b>' +
          '<span class="ms-desc">随机匹配 · 冠军积分排名 · 对局内每回合 80 秒</span>' +
        '</button>' +
        '<button class="ms-item" id="msFriendly">' +
          '<b>友谊赛</b><span class="ms-desc">开房间和朋友联机玩</span>' +
        '</button>' +
        '<button class="ms-item" id="msRecords">' +
          '<b>赛事纪录</b><span class="ms-desc">最近 20 场联机对战记录</span>' +
        '</button>' +
      '</div>' +
      '<div class="ms-actions"><button id="msBack" class="pxbtn ghost">返回主菜单</button></div>'
    );
    if ($('msNet')) $('msNet').onclick = function () {      // 没连上时点一下即可重试
      if (Net.isOnline && Net.isOnline()) return;
      connTried = false; ensureOnline(); UI.toast('正在连接服务器…');
    };
    if ($('msRank')) $('msRank').onclick = function () { Sfx.play('click'); showRanked(); };
    if ($('msFriendly')) $('msFriendly').onclick = function () { Sfx.play('click'); showFriendly(); };
    if ($('msRecords')) $('msRecords').onclick = function () { Sfx.play('click'); showRecords(); };
    if ($('msBack')) $('msBack').onclick = function () { Sfx.play('click'); toMenu(); };
  }

  /* ---------------- 排名赛（随机匹配，服务端撮合） ----------------
   * 流程：点「开始匹配」→ Net.rankedQueue(我的分) → 服务器按 ±10 分找对手
   *   · 没人 → {t:'ranked-wait'} → 显示"匹配中…已等待 N 秒"
   *   · 有人 → 服务器直接建房并开局 → {t:'ranked-matched'} + {t:'battle'} → 进战斗界面
   * 一局定胜负；结束时服务器下发 {t:'ranked-result', win, delta, score}，这里存分并提示。
   * ⚠ 80 秒回合计时只在 mode==='ranked' 的房间生效（服务端保证），好友房/PvE 没有时限。 */
  var rankWaitTimer = null, rankWaitStart = 0;
  function clearRankWait() { if (rankWaitTimer) { clearInterval(rankWaitTimer); rankWaitTimer = null; } }
  function rankInfo() {
    var score = (window.SaveData && SaveData.getRankedScore) ? SaveData.getRankedScore() : 1;
    return (Net.rankOf ? Net.rankOf(score) : { score: score, tier: 1, name: '入门选手', next: 11 });
  }
  function showRanked() {
    view = 'ranked';
    clearRankWait();
    ensureOnline();
    var r = rankInfo();
    render(
      '<h2 class="ms-title">排名赛</h2>' +
      '<p class="ms-sub">随机匹配 · 一局定胜负 · 赢 +1 分 / 输 -1 分</p>' +
      '<div class="ms-rank">' +
        '<div class="ms-rank-tier">' + esc(r.name) + '</div>' +
        '<div class="ms-rank-score">冠军积分 <b>' + r.score + '</b> / 100</div>' +
        (r.tier >= 9 ? '<div class="ms-rank-next">已达最高段位</div>'
          : '<div class="ms-rank-next">再赢 ' + (r.next - r.score) + ' 分升段</div>') +
      '</div>' +
      '<p class="ms-sub">对局内每回合限时 80 秒，超时自动结束回合</p>' +
      '<div class="ms-menu">' +
        '<button class="ms-item" id="msRankStart"><b>开始匹配</b>' +
          '<span class="ms-desc">优先匹配分数相近的对手（±10 分）</span></button>' +
      '</div>' +
      '<div class="ms-actions"><button id="msRankBack" class="pxbtn ghost">返回</button></div>'
    );
    if ($('msRankStart')) $('msRankStart').onclick = function () {
      Sfx.play('click');
      if (!(Net.isOnline && Net.isOnline())) { UI.toast('未连接服务器，无法匹配'); return; }
      if (Net.rankedQueue) Net.rankedQueue(r.score);
    };
    if ($('msRankBack')) $('msRankBack').onclick = function () { Sfx.play('click'); showEntry(); };
  }
  function showRankWaiting() {
    view = 'ranked-wait';
    rankWaitStart = Date.now();
    var r = rankInfo();
    render(
      '<h2 class="ms-title">匹配中…</h2>' +
      '<p class="ms-sub">正在寻找对手 · 等待越久段位条件越宽松（40 秒后不限段位）</p>' +
      '<div class="ms-rank">' +
        '<div class="ms-rank-tier">' + esc(r.name) + '</div>' +
        '<div class="ms-rank-score">冠军积分 <b>' + r.score + '</b></div>' +
      '</div>' +
      '<div class="ms-wait"><span id="msWaitTxt">已等待 0 秒</span></div>' +
      '<div class="ms-actions"><button id="msRankCancel" class="pxbtn ghost">取消匹配</button></div>'
    );
    clearRankWait();
    // 与服务端 rankRangeFor 的阶梯保持一致，让玩家看得见"条件正在放宽"，不会以为卡住了
    rankWaitTimer = setInterval(function () {
      var el = $('msWaitTxt');
      if (!el) { clearRankWait(); return; }
      var sec = Math.floor((Date.now() - rankWaitStart) / 1000);
      var tag = sec >= 40 ? ' · 已不限段位' : sec >= 25 ? ' · 已大幅放宽' : sec >= 12 ? ' · 已放宽段位' : '';
      el.textContent = '已等待 ' + sec + ' 秒' + tag;
    }, 500);
    if ($('msRankCancel')) $('msRankCancel').onclick = function () {
      Sfx.play('click');
      clearRankWait();
      if (Net.rankedCancel) Net.rankedCancel();
      showRanked();
    };
  }

  /* ---------------- 友谊赛：创建 / 加入 ---------------- */
  function showFriendly() {
    view = 'friendly';
    render(
      '<h2 class="ms-title">友谊赛</h2>' +
      '<p class="ms-sub">创建房间邀请朋友，或输入房号加入</p>' +
      '<div class="ms-menu">' +
        '<button class="ms-item" id="msCreate"><b>创建房间</b>' +
          '<span class="ms-desc">你当房主 · ' + Net.fightSeats + ' 人对战 + ' + (Net.seatTotal - Net.fightSeats) + ' 人观战</span></button>' +
        '<div class="ms-join">' +
          '<input id="msCode" class="ms-input" maxlength="4" inputmode="numeric" placeholder="4 位房号">' +
          '<input id="msPass" class="ms-input ms-pass" maxlength="12" placeholder="密码（可留空）">' +
          '<button id="msJoin" class="pxbtn">加入房间</button>' +
        '</div>' +
        '<p class="ms-sub ms-tip">密码框：创建房间时填 = 给房间上锁；加入房间时填 = 解锁（不设密码就留空）</p>' +
      '</div>' +
      '<div class="ms-actions"><button id="msBack2" class="pxbtn ghost">返回</button></div>'
    );
    // 同一个密码框：创建时 = 给房间上锁，加入时 = 解锁
    var passOf = function () { return $('msPass') ? String($('msPass').value || '') : ''; };
    if ($('msCreate')) $('msCreate').onclick = function () {
      Sfx.play('click'); Net.createRoom(passOf());
      if (!(Net.isOnline && Net.isOnline())) showRoom();   // 联机：等服务器回房号后再进房间
    };
    if ($('msJoin')) $('msJoin').onclick = function () {
      var code = ($('msCode').value || '').replace(/\D/g, '');
      if (code.length !== 4) { UI.toast('请输入 4 位房号'); return; }
      Sfx.play('click'); Net.joinRoom(code, passOf());
      if (!(Net.isOnline && Net.isOnline())) showRoom();
    };
    if ($('msBack2')) $('msBack2').onclick = function () { Sfx.play('click'); showEntry(); };
  }

  /* ---------------- 房间 ---------------- */
  function seatCard(seat, idx) {
    var p = seat.player;
    var mine = !!(p && p.self);
    var h = '<div class="ms-seat ' + seat.role + (mine ? ' me' : '') + (p ? '' : ' empty') + '" data-seat="' + seat.role + '" data-seat-index="' + idx + '">' +
      '<div class="ms-seat-tag">' + (seat.role === 'fight' ? '对战席' : '观战席') + '</div>';
    if (p) {
      // 自己的卡组名可点（切卡组），别人的只是个显示
      h += playerLine(p, '<span class="ms-deck' + (mine ? ' ms-deckbtn' : '') + '"' + (mine ? ' data-msdeck="1"' : '') + '>' +
        esc(p.deckName) + (mine ? '　切换' : '') + '</span>');
      h += seat.role === 'fight'
        ? '<div class="ms-ready' + (p.ready ? ' on' : '') + '">' + (p.ready ? '已准备' : '未准备') + '</div>'
        : '<div class="ms-ready watch">观战中</div>';
      if (!mine) h += '<div class="ms-seat-act">点击切换到此席位</div>';
    } else {
      h += '<div class="ms-wait">点击坐到这里</div>';
    }
    return h + '</div>';
  }

  function roomBtns() {
    var isHost = Net.isHost(), myRole = Net.mySeatRole();
    var meF = Net.fighters().filter(function (p) { return p.self; })[0];
    var h = '';
    if (myRole === 'fight') {
      h += '<button id="msReady" class="pxbtn' + (meF && meF.ready ? ' on' : '') + '">' +
        (meF && meF.ready ? '已准备（点击取消）' : '准备') + '</button>';
    } else {
      h += '<button id="msSwitch" class="pxbtn">切换到对战席</button>';
    }
    // 房主无论在哪个席位都能推进流程（切到观战席时也能点）
    if (isHost) h += '<button id="msStart" class="pxbtn">确认开始</button>';
    else h += '<span class="ms-note">等待房主开始</span>';
    h += '<button id="msRec2" class="pxbtn ghost">赛事纪录</button>';
    h += '<button id="msLeave" class="pxbtn ghost">离开房间</button>';
    return h;
  }

  function showRoom() {
    var r = Net.getRoom();
    if (!r) { showFriendly(); return; }
    view = 'room';
    var isHost = Net.isHost();
    // 房主可能不在第 1 个席位（联机时切过席位）→ 按服务器给的 hostId 找本人
    var hostSeat = r.seats.filter(function (s) { return s.player && s.player.id === r.hostId; })[0];
    var hostName = (hostSeat && hostSeat.player.name) || (r.seats[0].player || {}).name || '—';
    render(
      '<h2 class="ms-title">房间 <span class="ms-code">' + esc(r.code) + '</span>' +
        (r.locked ? '<span class="ms-lock">已设密码</span>' : '') + '</h2>' +
      '<p class="ms-sub">' + (isHost ? '你是房主' : '房主：' + esc(hostName)) +
        '　·　最多 ' + Net.seatTotal + ' 人（' + Net.fightSeats + ' 对战 + ' + (Net.seatTotal - Net.fightSeats) + ' 观战）</p>' +
      '<div class="ms-seats">' + r.seats.map(function (s, i) { return seatCard(s, i); }).join('') + '</div>' +
      '<div class="ms-rule-wrap"><div class="ms-rule-t">胜负规则' + (isHost ? '（房主可改）' : '') + '</div>' +
        '<div class="ms-rules">' + Net.rules().map(function (x) {
          return '<button class="ms-chip' + (r.rule === x.id ? ' on' : '') + '" data-rule="' + x.id + '"' +
            (isHost ? '' : ' disabled') + '>' + x.name + '</button>';
        }).join('') + '</div></div>' +
      '<div class="ms-actions">' + roomBtns() + '</div>' +
      '<div class="ms-hint" id="msHint">' + esc(lastMsg || '等待玩家加入…') + '</div>'
    );
    Array.prototype.forEach.call(document.querySelectorAll('.ms-chip[data-rule]'), function (b) {
      b.onclick = function () { if (!isHost) return; Sfx.play('click'); Net.setRule(b.getAttribute('data-rule')); };
    });
    var meF = Net.fighters().filter(function (p) { return p.self; })[0];
    if ($('msReady')) $('msReady').onclick = function () { Sfx.play('click'); Net.ready(!(meF && meF.ready)); };
    if ($('msStart')) $('msStart').onclick = function () {
      Sfx.play('click');
      var ser = newSeries();      // 用房间当前的规则算出 need / total，交给服务器建立系列
      Net.start(ser ? { rule: ser.rule, need: ser.need, total: ser.total } : null);
    };
    if ($('msSwitch')) $('msSwitch').onclick = function () { Sfx.play('click'); Net.switchSeat(Net.mySeatRole() === 'fight' ? 'watch' : 'fight'); };
    if ($('msRec2')) $('msRec2').onclick = function () { Sfx.play('click'); showRecords(); };
    if ($('msLeave')) $('msLeave').onclick = function () {
      var doLeave = function () { Sfx.play('click'); Net.leave(); series = null; showFriendly(); };
      if (window.UI && UI.confirm) UI.confirm('确定离开房间？', doLeave, null, { yes: '离开房间', no: '留在房间' });
      else if (window.confirm('确定离开房间？')) doLeave();
    };
    // 点席位：空位 → 直接坐过去；有人 → 发送交换申请（对方同意才互换）
    Array.prototype.forEach.call(document.querySelectorAll('.ms-seat[data-seat]'), function (el) {
      el.onclick = function () {
        var role = el.getAttribute('data-seat');
        var idx = parseInt(el.getAttribute('data-seat-index'), 10);
        var r2 = Net.getRoom(); if (!r2) return;
        if (el.classList.contains('me')) { UI.toast('你已经坐在这个席位了'); return; }
        var seatHere = r2.seats[idx];
        var occupied = !!(seatHere && seatHere.player);
        Sfx.play('click');
        Net.switchSeat(role, idx);          // 点哪格就坐哪格；那格有人则申请和"那个人"交换
        if (occupied) UI.toast('已向该席位的玩家发送交换申请，等待对方同意…');
      };
    });
    bindDeckPick();      // 点自己的卡组名 → 切换卡组
  }

  /* ---------------- 准备面板 ---------------- */
  function newSeries() {
    var r = Net.getRoom(); if (!r) return null;
    var rule = Net.ruleOf(r.rule);
    var total = rule.need * 2 - 1;
    var firsts = [];
    for (var i = 0; i < total; i++) firsts.push(firstOf(i, total));
    return { rule: r.rule, need: rule.need, total: total, win: 0, lose: 0, round: 0, firsts: firsts };
  }
  // 先手：多局时轮流先手；最后一局随机；单局直接随机
  function firstOf(gameIdx, total) {
    if (total <= 1 || gameIdx >= total - 1) return Math.random() < 0.5 ? 'A' : 'B';
    return gameIdx % 2 === 0 ? 'A' : 'B';
  }
  function sideCard(p, isMe) {
    return '<div class="ms-sidecard' + (isMe ? ' me' : '') + '">' + ava(p, 'big') +
      '<div class="ms-sidename">' + esc(p.name) + '</div>' +
      '<div class="ms-sidetitle">' + esc(p.title || '—') + '</div>' +
      '<div class="ms-sidedeck' + (isMe ? ' ms-deckbtn' : '') + '"' + (isMe ? ' data-msdeck="1"' : '') + '>卡组：' +
        esc(p.deckName || '—') + (isMe ? '　切换' : '') + '</div>' +
      '<div class="ms-sideready' + (p.ready ? ' on' : '') + '">' + (p.ready ? '已准备' : '未准备') + '</div>' +
      '</div>';
  }
  function prepBtns() {
    var isHost = Net.isHost();
    var meF = Net.fighters().filter(function (p) { return p.self; })[0];
    var h = '';
    if (Net.mySeatRole() === 'fight') {
      h += '<button id="msReady" class="pxbtn' + (meF && meF.ready ? ' on' : '') + '">' +
        (meF && meF.ready ? '已准备（点击取消）' : '准备') + '</button>';
      // 双方都准备好后，对战席任意一方都能开局
      // （房主可能已切到观战席，这时就由对战席玩家来推进）
      h += '<button id="msGo" class="pxbtn"' + (Net.allReady() ? '' : ' disabled') + '>开始本局</button>';
      if (!Net.allReady()) h += '<span class="ms-note">双方都准备好即可开始</span>';
    } else {
      h += '<span class="ms-note">观战席 · 对战开始后实时旁观（只能看，不能操作）</span>';
    }
    h += '<button id="msBackRoom" class="pxbtn ghost">返回房间</button>';
    return h;
  }
  function showPrep() {
    var r = Net.getRoom();
    if (!r) { showFriendly(); return; }
    if (!series) { series = newSeries(); if (!series) { showFriendly(); return; } }
    view = 'prep';
    var rule = Net.ruleOf(series.rule);
    var me = mePlayer(), opp = oppPlayer();
    var first = (series.firsts && series.firsts[series.round]) || 'A';
    render(
      '<h2 class="ms-title">' + esc(rule.name) + ' · 第 ' + (series.round + 1) + ' 局</h2>' +
      '<p class="ms-sub">最多 ' + series.total + ' 局 · 双方都点「准备」后由房主开始本局</p>' +
      '<div class="ms-vs">' +
        '<div class="ms-vs-side">' + sideCard(me, true) + '</div>' +
        '<div class="ms-vs-mid">VS</div>' +
        '<div class="ms-vs-side">' + sideCard(opp, false) + '</div>' +
      '</div>' +
      '<div class="ms-scorebar"><span class="ms-score me">' + series.win + '</span>' +
        '<span class="ms-score-sep">:</span><span class="ms-score opp">' + series.lose + '</span></div>' +
      '<div class="ms-info2">本局先手：<b>' + (first === 'A' ? '你' : '对手') + '</b>' +
        (series.round >= series.total - 1 && series.total > 1 ? '（决胜局随机）' : '') +
        '　·　胜负规则：<b>' + esc(rule.name) + '</b></div>' +
      '<div class="ms-actions">' + prepBtns() + '</div>' +
      '<div class="ms-hint">' + (Net.allReady() ? '双方已准备，可以开始了' : '等待双方准备…') + '</div>'
    );
    var meF = Net.fighters().filter(function (p) { return p.self; })[0];
    if ($('msReady')) $('msReady').onclick = function () { Sfx.play('click'); Net.ready(!(meF && meF.ready)); };
    if ($('msGo')) $('msGo').onclick = function () { Sfx.play('click'); beginRound(); };
    if ($('msBackRoom')) $('msBackRoom').onclick = function () { Sfx.play('click'); showRoom(); };
    bindDeckPick();      // 准备面板里也能直接切卡组
  }

  /* ---------------- 开始一局（联机对战入口） ---------------- */
  function beginRound() {
    var r = Net.getRoom();
    if (!r || !series) return;
    if (!Net.allReady()) { UI.toast('双方都准备好后才能开始'); return; }
    /* 卡组合法性：**非法卡组不允许开战**（2026-10-22 起，含"宝藏卡每种最多 2 张"）。
       组卡器里已经拦了保存/使用，但旧存档可能存着超限的卡组（localStorage 里的 4 张宝箱），
       这里是联机入口的最后一道客户端拦截 —— 用 validate（20~50 + 单卡上限），
       不要求恰好 20 张（好友房允许大卡组）。 */
    if (window.DeckRules && window.SaveData && SaveData.activeDeck) {
      var _d = SaveData.activeDeck();
      var _v = DeckRules.validate(_d.cardIds);
      if (!_v.ok) { UI.toast('卡组不合法：' + _v.errors[0] + '（请到组卡器调整）'); return; }
    }
    var me = mePlayer(), opp = oppPlayer();
    var first = (series.firsts && series.firsts[series.round]) || 'A';
    var seed = (Date.now() ^ ((series.round + 1) * 7919)) >>> 0;
    if (Net.isOnline && Net.isOnline()) {
      // 联机：交给服务器开局，双方会各自收到 battle 状态（先手由这边算好传过去）
      Net.beginRound(first, seed);
      return;
    }
    view = 'battle';
    var m = $('master'); if (m) m.classList.add('hidden');
    var myDeck = (me.deckIds && me.deckIds.length) ? me.deckIds : ((SaveData.activeDeck() || {}).cardIds || []);
    UI.startBattle({
      playerDeck: myDeck.slice(),
      aiDeck: (opp.deckIds || []).slice(),
      aiName: opp.name,
      playerHp: 40, playerMax: 40, aiHp: 40,
      diff: 'pro',
      first: first,
      seed: seed,
      mode: 'master',
      master: true                       // 交给 ui.js → 结算后回调 MasterUI.onMatchEnd
    });
  }

  // 一局打完（由 ui.js 的对局结算回调）
  function onMatchEnd(win) {
    if (Net.setNetBattle) Net.setNetBattle(false);     // 离开联机对局状态（之后的操作不再发服务器）
    var r = Net.getRoom();
    // 排位房：一局定胜负，比分/积分由服务器结算（ranked-result），这里只回入口，不做系列记账
    if (r && r.mode === 'ranked') {
      series = null;
      if (Net.resetReady) Net.resetReady();
      // ★ 主动放弃（对局内设置 → 放弃本局）也要通知服务器，否则服务端以为还在打：
      //   服务端收到 leave 会按"主动退出"判负（-1），对手 +1。
      //   正常分出胜负的路径下这条只是顺手退房，排位房本来就一次性。
      if (Net.leave) Net.leave();
      showEntry();
      return;
    }
    if (!r || !series) { series = null; showEntry(); return; }
    // 单机（本机模拟）才本地记账；联机时比分由服务器结算并随房间下发，这里不重复累加
    if (!(Net.isOnline && Net.isOnline())) {
      series.round++;
      if (win) series.win++; else series.lose++;
    }
    var opp = oppPlayer();
    if (series.win >= series.need || series.lose >= series.need || series.round >= series.total) {
      var rec = {
        t: Date.now(), rule: series.rule, win: series.win > series.lose,
        myScore: series.win, oppScore: series.lose, rounds: series.round,
        opp: { name: opp.name, avatar: opp.avatar, title: opp.title, deckName: opp.deckName }
      };
      if (window.SaveData && SaveData.addMasterRecord) SaveData.addMasterRecord(rec);   // 近 20 场
      var txt = '系列结束：你 ' + series.win + ' : ' + series.lose + ' ' + opp.name + '（' + (rec.win ? '胜' : '负') + '）';
      series = null;
      if (Net.resetReady) Net.resetReady();
      lastMsg = txt;
      UI.toast(txt);
      showRoom();                        // 对战结束 → 回到房间
      return;
    }
    if (Net.resetReady) Net.resetReady();
    UI.toast('本局' + (win ? '胜' : '负') + '，当前比分 ' + series.win + ' : ' + series.lose);
    showPrep();                          // 未结束 → 回准备面板打下一局
  }

  /* ---------------- 赛事纪录 ---------------- */
  function showRecords() {
    view = 'records';
    var list = (window.SaveData && SaveData.getMasterHistory) ? SaveData.getMasterHistory() : [];
    var body;
    if (!list.length) {
      body = '<div class="ms-norec">还没有联机对战记录<br><span class="dim">去「友谊赛」开一局吧</span></div>';
    } else {
      body = '<div class="ms-recs">' + list.map(function (x) {
        var o = x.opp || {};
        return '<div class="ms-rec">' +
          '<span class="ms-rec-res ' + (x.win ? 'win' : 'lose') + '">' + (x.win ? '胜' : '负') + '</span>' +
          '<span class="ms-ava sm"><img src="' + Net.iconOf(o.avatar || '初始头像2') + '" alt=""></span>' +
          '<span class="ms-rec-main"><b>' + esc(o.name || '对手') + '</b><em>' + esc(o.title || '') + '</em></span>' +
          '<span class="ms-rec-score">' + (x.myScore | 0) + ' : ' + (x.oppScore | 0) + '</span>' +
          '<span class="ms-rec-dim">' + esc(Net.ruleOf(x.rule).name) + '<br>' + fmtTime(x.t) + '</span>' +
          '</div>';
      }).join('') + '</div>';
    }
    render(
      '<h2 class="ms-title">赛事纪录</h2>' +
      '<p class="ms-sub">最近 20 场联机对战记录</p>' + body +
      '<div class="ms-actions"><button id="msBack3" class="pxbtn ghost">返回</button></div>'
    );
    if ($('msBack3')) $('msBack3').onclick = function () {
      Sfx.play('click');
      if (Net.getRoom()) showRoom(); else showEntry();
    };
  }

  /* ---------------- 订阅联机事件 ---------------- */
  Net.on('room', function () {
    var r = Net.getRoom();
    if (!r) return;
    // 多局制比分以服务器为准：有就采用，没有就清掉（别留着上一局的比分）
    if (Net.isOnline && Net.isOnline()) series = r.series || null;
    // ★ 只在玩家正看着大师赛界面时才重绘：数据照常更新，但不抢界面。
    //   重连成功后服务器会重发 room，若照旧无条件 showRoom/showPrep，
    //   玩家正在组卡器 / 主菜单里也会被强行拽回大师赛界面。
    if (!masterVisible()) return;
    if (view === 'room') showRoom();
    else if (view === 'prep') showPrep();
    else if (view === 'friendly') showRoom();     // 联机时房号是服务器回的 → 收到就进房间
  });
  Net.on('msg', function (t) {
    lastMsg = t;
    // 只更新这一行，不整页重绘。
    // （以前只赋值不刷新 → 服务器消息比房间数据后到，界面就停在旧文字上，
    //   典型症状：再建一个房间，底部还显示上一个房间的房号。）
    var hint = $('msHint');
    if (hint) hint.textContent = t;
    if (window.UI && UI.toast) UI.toast(t);
  });
  // 服务器开局 → 用服务器下发的状态进入对战界面
  Net.on('battle', function (msg) {
    view = 'battle';
    if (window.UI && UI.startNetBattle) UI.startNetBattle();
    if (msg && msg.spectator && window.UI && UI.toast) UI.toast('观战中：只能观看，不能操作');
  });

  /* 对局中途作废（对手离开房间 / 掉线超时判负）→ 服务端广播 battle-end，所有人都回房间。
   * 以前服务端只给「另一个对战者」发了文字消息，观战者收不到任何东西，
   * 界面就一直停在对局里出不来（就是"一方放弃判负，观战人员卡在对局中"）。 */
  Net.on('battleEnd', function (reason) {
    if (Net.setNetBattle) Net.setNetBattle(false);      // 连观战标志一起清
    series = null;                                      // 服务端已把本局系列作废
    if (window.UI && UI.closeOverlays) UI.closeOverlays();
    if (window.UI && UI.toast && reason) UI.toast(reason);
    var rEnd = Net.getRoom && Net.getRoom();
    // 排位局：服务器已判负并销毁房间 → 不回"房间"界面（排位房没有房间页），直接回入口
    if (rEnd && rEnd.mode === 'ranked') {
      if (Net.leave) Net.leave();
      showEntry();
      return;
    }
    if (rEnd) showRoom(); else showEntry();
  });

  /* 排位赛状态机：等待 / 匹配成功 / 取消 */
  Net.on('ranked', function (state) {
    if (state === 'waiting') { if (view !== 'ranked-wait') showRankWaiting(); return; }
    if (state === 'matched') { clearRankWait(); view = 'battle'; return; }   // 随后会收到 'battle'
    if (state === 'idle') { clearRankWait(); if (view === 'ranked-wait') showRanked(); }
  });
  /* 排位结算：分数由服务器算好下发，这里只存 + 提示（一局定胜负，赢 +1 / 输 -1） */
  Net.on('rankedResult', function (msg) {
    clearRankWait();
    if (!msg) return;
    var score = (window.SaveData && SaveData.setRankedScore) ? SaveData.setRankedScore(msg.score) : msg.score;
    var r = (Net.rankOf ? Net.rankOf(score) : { name: '', score: score });
    // forfeit=true 表示这一局是"掉线/主动退出"判负（服务端标记），提示要说清楚，否则玩家以为自己正常输了
    var txt = (msg.win ? '排位胜利 +1 分'
      : (msg.forfeit ? '掉线/退出判负 -1 分' : '排位失败 -1 分'))
      + '　当前 ' + score + ' 分（' + r.name + '）';
    lastMsg = txt;
    if (window.UI && UI.toast) UI.toast(txt);
    if (window.SaveData && SaveData.addMasterRecord) {
      SaveData.addMasterRecord({
        t: Date.now(), rule: 'ranked', win: !!msg.win,
        myScore: msg.win ? 1 : 0, oppScore: msg.win ? 0 : 1, rounds: 1,
        opp: { name: '排位对手', avatar: '初始头像3', title: '—', deckName: '' }
      });
    }
  });

  // 连接状态变化（连上/断开）→ 主面板那行提示跟着变
  // 离开房间（主动退出 / 重连失败自动退出）→ 清掉残留提示，
  // 否则下次建房时会先闪出上一个房间的房号
  Net.on('leave', function () { lastMsg = ''; });
  /* 在线人数变化：只更新那一行，不整页重绘（避免把正在看的界面抖一下） */
  Net.on('onlineCount', function (n) {
    var el = $('msOnline');
    if (el) el.textContent = '当前在线人数：' + n;
  });
  Net.on('online', function (on) {
    lastMsg = on ? '已连接服务器' : '与服务器断开连接';
    // 连接状态变化只更新提示（那行文字 + toast），不抢界面：
    // 重连提示已由 Net.on('msg') 弹出，没必要把玩家从组卡器拽回大师赛。
    if (!masterVisible()) return;
    if (view === 'entry') showEntry();
  });
  // 重连彻底失败 → net.js 已自动退出房间，这里把界面也收回来并说明原因
  Net.on('dropped', function () {
    var wasBattle = (view === 'battle');
    view = 'entry';
    lastMsg = '与服务器断开连接，已自动退出房间';
    if (window.UI && UI.toast) UI.toast('与服务器断开连接，已自动退出房间');
    // 玩家不在大师赛界面（组卡器 / 主菜单…）→ 只弹提示，不抢界面
    if (!masterVisible()) return;
    if (wasBattle && window.UI && UI.showMenu) UI.showMenu();   // 对局中掉线 → 回主菜单
    else showEntry();                                           // 房间页 / 准备面板 → 回大师赛入口
  });
  Net.on('start', function () {
    // 只有"对局仍在进行中"才忽略；结算界面（已分出胜负）也该能进准备面板
    if (view === 'battle' && !(window.Engine && Engine.state && Engine.state.winner)) return;
    series = newSeries();
    if (!series) return;
    if (window.UI && UI.closeOverlays) UI.closeOverlays();
    showPrep();
  });
  // 联机：房主点「确认开始」→ 服务器通知房间内所有人，一起进入准备面板
  Net.on('stage', function (stage) {
    if (stage !== 'prep') return;
    // ★ 以前这里是 if (view === 'battle') return; —— 如果某一方还停在结算界面
    //   （view 仍是 'battle'），这条通知就被直接丢掉，看起来就像"跳过了准备阶段"。
    //   现在只有"对局确实还在进行中"才忽略。
    if (view === 'battle' && !(window.Engine && Engine.state && Engine.state.winner)) return;
    // 观战者不进准备面板（那里显示的是"我的卡组/对手"，对观战者没意义）
    if (Net.mySeatRole && Net.mySeatRole() === 'watch') { showRoom(); return; }
    var r = Net.getRoom();
    series = (r && r.series) ? r.series : newSeries();   // 联机用服务器下发的，单机才本地建
    if (!series) return;
    if (window.UI && UI.closeOverlays) UI.closeOverlays();   // 清掉结算弹窗，别盖住准备面板
    showPrep();
  });
  // 有人想和你交换席位 → 弹确认框
  Net.on('swapReq', function (m) {
    var modal = $('modal'); if (!modal) return;
    var zh = function (r) { return r === 'fight' ? '对战席' : '观战席'; };
    modal.classList.remove('hidden');
    modal.innerHTML = '<div class="mbox"><h3>交换席位申请</h3>' +
      '<p><b>' + esc(m.from) + '</b> 想和你交换席位：' + zh(m.fromRole) + ' ↔ ' + zh(m.toRole) + '</p>' +
      '<div class="mbtns"><button id="swOk" class="pxbtn">同意交换</button>' +
      '<button id="swNo" class="pxbtn ghost">拒绝</button></div></div>';
    $('swOk').onclick = function () { modal.classList.add('hidden'); Net.swapAnswer(true); };
    $('swNo').onclick = function () { modal.classList.add('hidden'); Net.swapAnswer(false); };
  });

  return {
    showCupChoice: showCupChoice,
    showEntry: showEntry,
    onMatchEnd: onMatchEnd,
    // 观战结束（本局分出胜负）→ 直接回房间看下一局，不记比分
    // ★ 这里必须把联机 / 观战标志一起清掉。以前只 showRoom()，netSpectator 会一直留着，
    //   接着去玩单机模式（联盟赛 / 跑图 / 学院 / 自由对战）时，被改写的 Engine.tryAction
    //   会静默忽略所有操作 —— 表现就是"大师赛观战后，回联盟赛开始 PVE 显示观战状态无法操作"。
    onSpectateEnd: function () {
      if (Net.setNetBattle) Net.setNetBattle(false);
      series = null;
      showRoom();
    },
    getView: function () { return view; },
    reset: function () { series = null; if (Net.getRoom()) Net.leave(); }
  };
})();
