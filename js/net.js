/* ============================================================
 * 大师赛（联机）· 适配层   net.js
 *
 *   把"联机"抽象成一层可替换的接口，界面（master_ui.js）只依赖这一层：
 *
 *     · 现在 transport = 'mock'：房间 / 席位 / 准备 / 开始 全部在本机模拟
 *       （好友会在几秒后陆续"加入房间"并"准备"），目的是先把大师赛的
 *       界面与流程跑通，不需要服务器。
 *     · 以后接上权威服务器：把 transport 切到 'ws'，实现 send()，
 *       并在收到服务器消息时调用 applyServer(msg) —— 界面层一行都不用改。
 *
 *   数据模型（与将来服务端下发保持一致）：
 *     room   = { code, rule, hostId, status, seats[], seq }
 *     seat   = { role:'fight'|'watch', player }
 *     player = { id, name, avatar, title, deckName, deckIds, ready, self }
 *     status = 'waiting'（等加入） | 'playing'（已开始，界面进准备面板）
 * ========================================================== */
var Net = (function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  var SEAT_TOTAL = 4;          // 房间最多 4 个席位
  var FIGHT_SEATS = 2;         // 其中 2 个对战席位，其余为观战
  var RULES = [
    { id: 'bo1', name: '一局定胜负', need: 1 },
    { id: 'bo3', name: '三局两胜', need: 2 },
    { id: 'bo5', name: '五局三胜', need: 3 }
  ];

  var BUS = {};                // 事件订阅
  var room = null;             // 当前房间（null = 不在房间）
  var transport = 'mock';      // 'mock' 本机模拟 | 'ws' 将来接服务器
  var timers = [];             // mock 用的定时器（离开房间时全部清掉）

  /* ---------------- 事件 ---------------- */
  function on(evt, cb) { (BUS[evt] = BUS[evt] || []).push(cb); }
  function off(evt, cb) {
    var a = BUS[evt]; if (!a) return;
    var i = a.indexOf(cb); if (i >= 0) a.splice(i, 1);
  }
  function emit(evt, data) {
    (BUS[evt] || []).slice().forEach(function (f) {
      try { f(data); } catch (e) { if (window.console) console.error('[net]', e); }
    });
  }
  function after(ms, fn) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function clearTimers() { timers.forEach(function (t) { clearTimeout(t); }); timers = []; }
  function pushMsg(text) { emit('msg', text); }

  /* ---------------- 玩家资料 ---------------- */
  function iconOf(id) {
    try { if (window.Achievements && Achievements.iconOf) return Achievements.iconOf(id); } catch (e) { }
    return '图标/' + id + '.png';
  }
  function me() {
    var p = (window.SaveData && SaveData.getPlayer) ? (SaveData.getPlayer() || {}) : {};
    var d = (window.SaveData && SaveData.activeDeck) ? (SaveData.activeDeck() || {}) : {};
    return {
      id: 'me', name: p.name || '玩家', avatar: p.avatar || '初始头像1',
      title: p.title || '雪景学院新生',
      deckName: d.name || '默认卡组', deckIds: (d.cardIds || []).slice(),
      ready: false, self: true
    };
  }
  // mock 好友（接入服务器后这段可整体删除）
  var MOCK_PLAYERS = [
    { id: 'f1', name: '阿Ren哥', avatar: '初始头像2', title: '地牢常客', deckName: '突袭卡组', dk: 'raider' },
    { id: 'f2', name: '罐姐', avatar: '初始头像3', title: '雪景学院新生', deckName: '新手卡组', dk: 'starter' },
    { id: 'f3', name: '神秘的黑猫', avatar: '初始头像4', title: '遗物猎人', deckName: '突袭卡组', dk: 'raider' }
  ];
  function bot(i) {
    var m = MOCK_PLAYERS[i % MOCK_PLAYERS.length];
    var decks = (typeof PRESET_DECKS !== 'undefined') ? PRESET_DECKS : {};
    var dk = decks[m.dk] || [];
    return {
      id: m.id, name: m.name, avatar: m.avatar, title: m.title,
      deckName: m.deckName, deckIds: dk.slice(), ready: false, self: false
    };
  }

  /* ---------------- 房间 ---------------- */
  function randCode() { return String(1000 + Math.floor(Math.random() * 9000)); }
  function fire() { if (room) { room.seq = (room.seq || 0) + 1; emit('room', room); } }
  function seats() { return room ? room.seats : []; }
  function seatOf(id) { var r = seats(); for (var i = 0; i < r.length; i++) if (r[i].player && r[i].player.id === id) return r[i]; return null; }
  function freeSeat(role) { var r = seats(); for (var i = 0; i < r.length; i++) if (r[i].role === role && !r[i].player) return r[i]; return null; }
  function fighters() { var r = seats(); return r.filter(function (s) { return s.role === 'fight' && s.player; }).map(function (s) { return s.player; }); }
  /* 我坐的席位：本机模拟时"我"的 id 固定是 'me'，但联机时是服务器分配的会话 id，
   * 所以优先认服务器标记好的 self，其次再退回 id='me'（本机模拟）。 */
  function mySeat() {
    var r = seats(), i;
    for (i = 0; i < r.length; i++) if (r[i].player && r[i].player.self) return r[i];
    for (i = 0; i < r.length; i++) if (r[i].player && r[i].player.id === 'me') return r[i];
    return null;
  }
  function isHost() {
    if (!room) return false;
    if (room.hostId === 'me') return true;                 // 本机模拟：房主就是我
    var s = mySeat();                                      // 联机：房主身份按服务器会话 id 比对
    return !!(s && s.player && room.hostId && s.player.id === room.hostId);
  }
  function mySeatRole() { var s = mySeat(); return s ? s.role : null; }
  function allReady() {
    var f = fighters();
    return f.length === FIGHT_SEATS && f.every(function (p) { return !!p.ready; });
  }

  function mkRoom(code, hostId, locked) {
    var arr = [];
    for (var i = 0; i < SEAT_TOTAL; i++) arr.push({ role: i < FIGHT_SEATS ? 'fight' : 'watch', player: null });
    return { code: code, rule: 'bo1', hostId: hostId, status: 'waiting', seats: arr, seq: 0, locked: !!locked };
  }

  /* ---------------- 对外操作（将来这里改成往服务器发消息） ---------------- */
  function createRoom(pass) {
    if (isOnline()) { send({ t: 'create', pass: pass || '' }); return null; }   // 由服务器建房并广播
    clearTimers();
    room = mkRoom(randCode(), 'me', pass);
    room.seats[0].player = me();
    fire();
    pushMsg('房间已创建，等待好友加入…');
    // —— 以下为"本机模拟"，接上服务器后整段删除 ——
    after(2200, function () { var s = freeSeat('fight'); if (s) { s.player = bot(0); fire(); pushMsg(s.player.name + ' 加入了房间'); } });
    after(4200, function () { var s = freeSeat('watch'); if (s) { s.player = bot(1); fire(); pushMsg(s.player.name + ' 进入观战'); } });
    after(6400, function () { var s = freeSeat('watch'); if (s) { s.player = bot(2); fire(); pushMsg(s.player.name + ' 进入观战'); } });
    after(8600, function () { var f = fighters().filter(function (p) { return !p.self; })[0]; if (f) { f.ready = true; fire(); pushMsg(f.name + ' 已准备'); } });
    return room;
  }
  function joinRoom(code, pass) {
    if (isOnline()) { send({ t: 'join', code: String(code || ''), pass: pass || '' }); return null; }
    clearTimers();
    if (!code) return null;
    room = mkRoom(String(code).slice(0, 6), 'f0');
    room.seats[0].player = bot(0);        // 房主占一个对战席
    room.seats[1].player = me();          // 我进另一个对战席
    room.seats[2].player = bot(1);
    room.seats[3].player = bot(2);
    fire();
    pushMsg('已加入房间 ' + room.code);
    after(2500, function () { var h = room.seats[0].player; if (h) { h.ready = true; fire(); pushMsg(h.name + ' 已准备'); } });
    return room;
  }
  function leave() {
    if (isOnline()) send({ t: 'leave' });
    clearTimers(); room = null;
    netBattle = false; netSpectator = false;        // ★ 观战标志必须一起清（见下方 setNetBattle 注释）
    rankMode = false; rankDeadline = 0;             // ★ 排位标志同理：否则退到 PvE 还挂着回合计时
    emit('deadline', { deadline: 0, ranked: false });
    emit('leave', null);
  }
  function setRule(id) {
    if (isOnline()) { send({ t: 'rule', rule: id }); return true; }
    if (!room || !isHost()) return false;
    for (var i = 0; i < RULES.length; i++) if (RULES[i].id === id) { room.rule = id; fire(); return true; }
    return false;
  }
  function ready(v) {
    if (isOnline()) { send({ t: 'ready', v: v !== false }); return true; }
    var s = mySeat(); if (!s) return false;
    if (s.role === 'watch') return false;                 // 观战者不需要准备
    s.player.ready = (v !== false);
    fire();
    // mock：我一准备，对手过一会儿也准备（接服务器后删掉）
    if (transport === 'mock' && s.player.ready) {
      after(1800, function () {
        var f = fighters().filter(function (p) { return !p.self; })[0];
        if (f && !f.ready) { f.ready = true; fire(); pushMsg(f.name + ' 已准备'); }
      });
    }
    return true;
  }
  // 房主「确认开始」→ 进入准备面板（准备动作在准备面板里做，见 master_ui.js）
  function start(series) {
    if (!room || !isHost()) return false;
    if (isOnline()) {
      // 联机：把多局制的规则参数交给服务器 —— 比分与先手顺序由服务器权威维护，
      // 服务器再通知双方一起进准备面板。
      send({
        t: 'start',
        series: series ? { rule: series.rule, need: series.need, total: series.total } : null
      });
      return true;
    }
    room.status = 'playing';
    fire();
    emit('start', room);
    return true;
  }
  // 资料变了（比如在房间里换了卡组）→ 刷新"我"这个席位上的快照
  function refreshMe() {
    if (isOnline()) { sendProfile(); return; }      // 换卡组 → 告诉服务器
    if (!room) return;
    var s = mySeat();
    if (!s || !s.player) return;
    var m = me();
    s.player.name = m.name; s.player.avatar = m.avatar; s.player.title = m.title;
    s.player.deckName = m.deckName; s.player.deckIds = m.deckIds;
    fire();
  }
  // 一局打完 → 清空所有人的准备状态（多局制里下一局要重新准备）
  function resetReady() {
    if (!room) return;
    fighters().forEach(function (p) { p.ready = false; });
    fire();
  }
  // 切换"我想坐对战席 / 观战席"（服务端版本需校验席位占用）
  // 回应别人的交换席位申请：同意 → 服务端把两人席位互换
  function swapAnswer(ok) { if (isOnline()) send({ t: 'swap-answer', ok: !!ok }); }
  // 点席位：空着直接切过去；有人则发"交换申请"（能否交换由服务端判定）
  // idx = 具体第几个席位（点哪格就坐哪格）；不传则按 role 优先找空位
  function switchSeat(role, idx) {
    if (isOnline()) { send({ t: 'swap', role: role, idx: (idx == null ? null : idx) }); return true; }
    if (!room) return false;
    var mine = mySeat(); if (!mine) return false;
    if (mine.role === role) return false;
    var target = freeSeat(role); if (!target) return false;
    mine.player = null; target.player = me();
    fire();
    // mock：观战席 → 对战席时，把原来的 mock 对手挪到观战席，保证 2 个对战席位
    if (transport === 'mock' && role === 'fight') {
      var f = fighters().filter(function (p) { return !p.self; });
      if (f.length < FIGHT_SEATS) {
        var b = bot(0);
        var fs = freeSeat('fight');
        if (fs) { fs.player = b; fire(); }
      }
    }
    return true;
  }

  /* ================= 联机（WebSocket） =================
   * 在线时：所有写操作都发给服务器，房间/对局状态一律以服务器下发的为准；
   * 离线时（没连服务器）：退化成"本机模拟"，方便单机开发与演示。 */
  var ws = null, myId = null, hooked = false, netBattle = false, netSpectator = false;
  var SESSION_KEY = 'ds_net_session';     // 会话 id（存 sessionStorage：每个标签页各自独立，不互相覆盖）
  var reconnectTry = 0, reconnectTimer = null;
  /* ---------------- 延迟（ping / pong） ----------------
   * 每 3 秒发一次 { t:'ping', ts:Date.now() }，服务端原样把 ts 回传，
   * 客户端用 Date.now() - ts 得到 RTT。抖动大 → 指数平滑（新样本占 30%）。 */
  var latencyMs = -1, pingTimer = null;
  /* ---------------- 排位赛（随机匹配） ----------------
   * 段位：冠军积分 1~100，每 10 分一段，共九段。
   * 1-10 入门 / 11-20 常规 / 21-30 进阶 / 31-40 精英 / 41-50 名门 /
   * 51-60 大师 / 61-70 史诗 / 71-80 传奇 / 81+ 冠军（91-100 仍显示冠军选手）。 */
  var RANK_TIERS = ['入门选手', '常规选手', '进阶选手', '精英选手', '名门选手', '大师选手', '史诗选手', '传奇选手', '冠军选手'];
  function rankOf(score) {
    var s = Math.round(Number(score));
    if (!isFinite(s)) s = 1;
    s = Math.max(1, Math.min(100, s));
    var tier = Math.min(9, Math.ceil(s / 10));
    return { score: s, tier: tier, name: RANK_TIERS[tier - 1], next: tier >= 9 ? 0 : (tier * 10 + 1) };
  }
  var rankDeadline = 0, rankMode = false;
  var onlineN = 0;                 // 当前在线人数（服务端广播，见 broadcastOnline）
  var serverRanked = null;         // 服务端是否支持排位（hello.ranked；旧服务端没有该字段）
  var cardsMismatch = false;       // 本机卡表与服务器卡表是否不一致（hello.cards 指纹比对）
  /* ================= 客户端版本 =================
     PvP 开战前服务端会核对版本：低于服务端的客户端直接拒绝（并给下载地址）。
     这里把本地版本算好、在 hello 后主动上报，同时自己先比一次以便提前提示玩家。 */
  var verOutdated = false;         // 本机版本低于服务器
  var serverBuild = 0;             // 服务器版本号
  var downloadUrl = 'https://dms.spldream.com';
  function myBuildStr() {
    try { return (typeof Rules !== 'undefined' && Rules && Rules.BUILD) ? Rules.BUILD : ''; } catch (e) { return ''; }
  }
  function verOf(build) {
    var m = /v(\d+)/.exec(String(build || ''));
    return m ? Number(m[1]) : 0;
  }
  function myVer() { return verOf(myBuildStr()); }
  /* ================= PVP 快捷对话 =================
     id 形如 'greet.0'，服务端只校验这个格式（防自定义文本刷屏/注入），
     具体文案只在客户端这份表里 —— 改文案不用动服务端。
     两端版本不同时可能显示不同文案，但那是纯聊天内容，不影响对局。 */
  var EMOTES = {
    greet: [
      '你好，朋友',
      '再来一把吗',
      '我们下局见',
      '别灰心',
      '加油！',
      '看啊看啊这是谁来了'
    ],
    salute: [
      '向你致敬',
      '望胜者实至名归',
      '英勇献身的好日子',
      '向着胜利，前进！',
      '真是有趣的策略',
      '很有启发性'
    ],
    taunt: [
      '你就这点本事？',
      '尽你所能',
      '兵犹火也，不戢自焚',
      '考验膀胱的时候到了',
      '呸！！！',
      '给我看点新花样'
    ]
  };
  var EMOTE_LABEL = { greet: '问候', salute: '致敬', taunt: '嘲讽' };
  function emoteText(id) {
    var p = String(id || '').split('.');
    var arr = EMOTES[p[0]];
    if (!arr) return '';
    var i = parseInt(p[1], 10);
    return (i >= 0 && i < arr.length) ? arr[i] : '';
  }
  function sendEmote(id) {
    if (!isOnline()) { pushMsg('需要先连接服务器才能发送对话'); return false; }
    var txt = emoteText(id);
    if (!txt) return false;
    send({ t: 'emote', id: id });
    return true;
  }
  /* 本地卡表指纹 —— 必须与服务端 server.js 的 cardsSig() 用**完全相同的算法**
     （JSON.stringify(CARD_LIST) 后做 djb2），否则会误报不一致。 */
  function localCardsSig() {
    try {
      var list = (typeof CARD_LIST !== 'undefined' && CARD_LIST) || null;
      if (!list) return '';
      if (!localCardsSig._v) {
        var s = JSON.stringify(list), h = 5381;
        for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        localCardsSig._v = (h >>> 0).toString(16);
      }
      return localCardsSig._v;
    } catch (e) { return ''; }
  }
  function rankedQueue(score) {
    if (!isOnline()) { pushMsg('需要先连接服务器才能匹配'); return false; }
    // 服务端还是旧版时不支持排位：直接说清楚，别让玩家点完没反应
    if (serverRanked === false) { pushMsg('服务端还不支持排位赛（需要更新并重启服务器）'); return false; }
    send({ t: 'ranked', score: score });
    emit('ranked', 'queue', null);
    return true;
  }
  function onlineCount() { return onlineN; }
  function rankedCancel() {
    if (isOnline()) send({ t: 'ranked-cancel' });
    emit('ranked', 'idle', null);
  }
  function deadline() { return rankDeadline; }
  function isRanked() { return rankMode; }
  function startPing() {
    stopPing();
    // 极简沙箱（tools/ 里的假 DOM/假计时器）可能没有 setInterval —— 没有就跳过测延迟，
    // 不影响连接与联机本身。浏览器里一定有。
    if (typeof setInterval !== 'function') return;
    function once() {
      if (!ws || ws.readyState !== 1) return;
      try { ws.send(JSON.stringify({ t: 'ping', ts: Date.now() })); } catch (e) { }
    }
    once();                                        // 连上就先测一次，别让玩家看 3 秒 "--"
    pingTimer = setInterval(once, 3000);
  }
  function stopPing() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    latencyMs = -1;
  }
  function onPong(m) {
    if (!m || typeof m.ts !== 'number') return;
    var rtt = Date.now() - m.ts;
    if (rtt < 0 || rtt > 60000) return;            // 时钟异常 / 久挂的脏数据，直接丢
    latencyMs = (latencyMs < 0) ? rtt : Math.round(latencyMs * 0.7 + rtt * 0.3);
    emit('latency', latencyMs);
  }
  function latency() { return latencyMs; }

  function storeGet(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function storeSet(k, v) { try { sessionStorage.setItem(k, v || ''); } catch (e) { } }

  function isOnline() { return transport === 'ws' && !!ws && ws.readyState === 1; }
  function myPlayerId() { return myId; }
  function send(obj) {
    if (!isOnline()) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
  }
  function sendProfile() {
    var m = me();
    send({ t: 'profile', name: m.name, avatar: m.avatar, title: m.title, deckName: m.deckName, deckIds: m.deckIds });
  }
  /* 离线包（APK / 浏览器套壳）里页面是从"设备本地服务"加载的
   * （WebToApp 是 http://127.0.0.1:<随机端口>，Capacitor 是 https://localhost），
   * 此时 location.host 指向设备自己 —— 直接照抄会去连 127.0.0.1 的 ws，必然连不上。
   * 所以这里做三级判定：
   *   ① window.__NET_HOST 显式指定（壳注入 / 调试用）→ 一律走 wss
   *   ② 判定为"本地壳"（hostname 是 localhost/127.0.0.1 且端口不是我们自己 node 的 3000）
   *      → 连正式服 REMOTE_HOST，一律走 wss
   *   ③ 其余情况 = 老逻辑（页面从哪加载就连哪），线上部署零改动
   * ⚠ 本地壳必须是 wss：Apache 的 80 端口是 `Redirect permanent` 到 https，
   *   而 WebSocket 不跟随重定向 → 用 ws:// 会握手失败。 */
  var REMOTE_HOST = 'dms.spldream.com';           // 离线包默认连的正式服（改这里即可搬家）
  /* 是不是 Electron 桌面版（UA 里带 Electron/x.y.z）。
   * ⚠ 这条判定是必须的：桌面版把整个服务端塞进了 App，本地服务恰好起在 **3000** 端口，
   *   而下面"3000 = 开发者自测"的豁免会让它把 `ws://localhost:3000/ws`（它自己）当成服务器
   *   → 显示"已连接"、延迟正常、在线人数恒为 1，但官方服务器上根本看不到这个人（假连接）。
   *   所以 Electron 一律按"本地壳"处理 → 连正式服 REMOTE_HOST。 */
  /* 显式"连本机"开关 —— **只给开发者自测**：页面 URL 带 ?local=1，或 localStorage 里
   * dd2_net_local = '1'。除此之外，任何从 localhost / 127.0.0.1 打开的页面
   * （Electron 桌面版、APK 本地壳、python 静态预览……）**一律连正式服**。
   * ⚠ 之前按"端口 3000 = 本地自测"做豁免，结果桌面版把服务端起在 3000 时
   *   → 客户端连 `ws://localhost:3000/ws` = 连自己：显示"已连接"、延迟 0、断网也能连。
   *   现在不再有任何端口豁免，断网必然连不上（这是正确行为）。 */
  function forceLocal() {
    try {
      if (typeof location !== 'undefined' && /[?&]local=1(&|$)/.test(String(location.search || ''))) return true;
    } catch (e) { }
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('dd2_net_local') === '1') return true;
    } catch (e) { }
    return false;
  }
  function isLocalShell(loc) {
    if (!loc) return false;
    if (forceLocal()) return false;                        // 开发者显式要求连本机
    var hn = String(loc.hostname || '');
    if (!/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i.test(hn)) return false;
    return true;                                           // ★ 本地页面一律连正式服（无端口豁免）
  }
  /* 只算"要连哪"、不真正连接 —— 便于排查：离线包里在控制台执行 Net.endpoint()
   * 就能看出它准备连哪个地址（连不上时第一时间看这个）。 */
  function endpoint(url) {
    var loc = (typeof location !== 'undefined') ? location : null;
    // ★ 联机地址 = 浏览器地址栏里的 host（页面从哪加载，就连哪）：
    //     用 http://47.109.62.104:3000/ 打开 → 连 ws://47.109.62.104:3000/ws
    //     用 https://某域名/ 打开         → 连 wss://某域名/ws（需该域名反代 /ws）
    //   离线包由上面的 REMOTE_HOST 接管，见 isLocalShell 的注释。
    //   后面的 'localhost:3000' 只是【没有 location 时】的兜底，仅用于用 node
    //   直接跑测试脚本这类场景；浏览器里永远不会走到这里。
    var proto, host;
    var inj = (typeof window !== 'undefined' && window.__NET_HOST) ? String(window.__NET_HOST) : '';
    if (inj) {
      host = inj.replace(/^\w+:\/\//, '').replace(/\/.*$/, '');   // 允许直接写 'wss://dms.spldream.com'
      proto = 'wss://';
    } else if (isLocalShell(loc)) {
      host = REMOTE_HOST;
      proto = 'wss://';
    } else {
      proto = (loc && loc.protocol === 'https:') ? 'wss://' : 'ws://';
      host = (loc && loc.host) ? loc.host : 'localhost:3000';
    }
    return url || (proto + host + '/ws');
  }
  function connect(url) {
    if (isOnline()) return true;
    var u = endpoint(url);
    // 打出来便于排查"到底连的谁"：F12 控制台第一行就能看到
    try { if (typeof console !== 'undefined' && console.log) console.log('[net] 连接 ' + u); } catch (e) { }
    try { ws = new WebSocket(u); } catch (e) { pushMsg('无法创建连接'); return false; }
    transport = 'ws';
    hookEngine();
    ws.onopen = function () {
      pushMsg('已连接服务器');
      reconnectTry = 0;
      clearTimeout(reconnectTimer);
      // 刷新页面 / 掉线后：先尝试回到原来的席位（服务端会保留 60 秒），再同步资料
      var old = storeGet(SESSION_KEY);
      if (old) send({ t: 'resume', id: old });
      sendProfile();
      emit('online', true);
      startPing();                                  // 连上就开始测延迟（右上角显示用）
    };
    ws.onmessage = function (e) {
      var m = null;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m && m.t === 'pong') { onPong(m); return; }   // 心跳回包：只算 RTT，不进业务分发
      applyServer(m);
    };
    ws.onclose = function () {
      ws = null; transport = 'mock'; netBattle = false; netSpectator = false;
      stopPing(); emit('latency', -1);
      emit('online', false);
      // 自动重连（指数退避，最多 6 次）—— 服务端席位保留 60 秒，够用
      if (reconnectTry < 6) {
        reconnectTry += 1;
        var wait = Math.min(800 * Math.pow(1.7, reconnectTry - 1), 8000);
        pushMsg('与服务器断开连接，' + (wait / 1000).toFixed(1) + ' 秒后自动重连…（第 ' + reconnectTry + ' 次）');
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(function () { connect(); }, wait);
      } else {
        pushMsg('与服务器断开连接，自动重连失败');
        // 还在房间里 → 自动退出：否则会停在一个"假房间"上，点准备/开始全都发不出去，
        // 用户还以为是卡住了。（席位在服务端保留 60 秒，这里重试总计约 23 秒，够用）
        if (room) {
          leave();
          emit('dropped', null);
          pushMsg('已自动退出房间（无法连接服务器）。服务恢复后请重新创建 / 加入房间。');
        }
      }
    };
    ws.onerror = function () { pushMsg('连接服务器失败（请确认服务端已启动）'); };
    return true;
  }
  /* 联机对局期间，把引擎的"执行"接口改道到服务器：
   * ui.js 里所有 Engine.tryAction / resolvePrompt 的调用都不用改。 */
  function hookEngine() {
    if (hooked || typeof Engine === 'undefined' || !Engine.tryAction) return;
    hooked = true;
    var origTry = Engine.tryAction, origPrompt = Engine.resolvePrompt;
    Engine.tryAction = function (a) {
      // 观战者：静默忽略。以前这里会 pushMsg + 返回 ok:false，界面又 toast 一次，
      // 于是每点一下弹两遍"不能操作"，非常吵。
      if (netSpectator) return { ok: false, silent: true };
      if (!netBattle || !isOnline()) return origTry.call(Engine, a);
      // 非我方回合 / 有待决要处理 / 已分出胜负 → 也静默忽略：
      // 根本不发请求，服务端自然不会回"还没轮到你"，也就不会反复弹提示。
      // 注意：联机视角里"我"永远是 'A'（服务端已按视角翻转）。
      var st = Engine.state;
      if (st && (st.winner || st.active !== 'A' || st.pending)) return { ok: false, silent: true };
      var act = {}, k;
      for (k in a) if (Object.prototype.hasOwnProperty.call(a, k) && k !== '_ai') act[k] = a[k];
      send({ t: 'act', a: act });
      return { ok: true };                 // 乐观返回，真实结果由服务器广播
    };
    Engine.resolvePrompt = function (v) {
      if (netSpectator) return;
      if (!netBattle || !isOnline()) return origPrompt.call(Engine, v);
      send({ t: 'prompt', v: v === undefined ? false : v });
    };
  }
  /* ★ 退出联机对局时必须把「观战」标志一起清掉。
   *  netSpectator 一旦残留，本文件顶层那段被改写的 Engine.tryAction 会无差别
   *  静默忽略所有操作（返回 {ok:false, silent:true}），玩家在 PVE 里点什么都没反应 ——
   *  这正是「大师赛观战后，回联盟赛开始 PVE 显示观战状态无法操作」的成因。 */
  function setNetBattle(v) { netBattle = !!v; if (!netBattle) netSpectator = false; }
  function inNetBattle() { return netBattle; }
  // 房主点「开始本局」→ 交给服务器开局（先手由客户端算好传过去）
  function beginRound(first, seed) {
    if (!isOnline()) return false;
    return send({ t: 'begin', first: first === 'B' ? 'B' : 'A', seed: (seed >>> 0) || (Date.now() >>> 0) });
  }

  function setTransport(t) { transport = t; }
  function applyServer(msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'hello') {
      myId = msg.id;
      storeSet(SESSION_KEY, msg.id);               // 记住会话 id → 刷新页面后自动恢复
      serverRanked = (msg.ranked === true);        // 旧服务端没有该字段 → false
      if (typeof msg.n === 'number') { onlineN = msg.n; emit('onlineCount', onlineN); }
      /* ★ 卡表一致性检查。联机没有版本协商时，客户端/服务端卡表不一致会导致
         「显示与实际不符 / 卡组被拒 / 甚至渲染崩」，但表现往往只是"点了没反应"，
         玩家根本猜不到原因。这里在握手时就比对指纹并明确告知。
         旧服务端不发 cards 字段 → 跳过（保持向前兼容，不误报）。 */
      if (typeof msg.cards === 'string' && msg.cards) {
        var mine = localCardsSig();
        if (mine && mine !== msg.cards) {
          cardsMismatch = true;
          pushMsg('你的卡表与服务器不一致（客户端版本 ' + mine + ' / 服务器 ' + msg.cards +
            '）。双方规则以服务器为准，但你会看到错误的卡面数值，或部分操作无法使用。' +
            '请硬刷新页面（Ctrl+F5）；若服务器也旧，需要服务器更新并重启。');
        } else {
          cardsMismatch = false;
        }
      }
      /* ★ 版本核对：服务器版本比本机高 → 标记过期，并提前提示（不等开局才报错）。
         旧服务端不发 build 字段 → 跳过（向前兼容）。 */
      if (typeof msg.url === 'string' && msg.url) downloadUrl = msg.url;
      if (msg.build != null) {
        serverBuild = Number(msg.build) || 0;
        verOutdated = serverBuild > 0 && myVer() > 0 && myVer() < serverBuild;
        if (verOutdated) {
          pushMsg('你的游戏版本（v' + myVer() + '）低于服务器（v' + serverBuild +
            '），无法开始对局。请刷新页面；若仍提示，请到 ' + downloadUrl + ' 下载最新版。');
          emit('needUpdate', { yours: myVer(), latest: serverBuild, url: downloadUrl });
        }
      }
      // 主动上报自己的版本，供服务端在开战前核对
      send({ t: 'ver', build: myBuildStr() });
      if (msg.resumed) pushMsg('已恢复到原来的对局');
      return;
    }
    // 在线人数变化（连上/掉线都会广播）
    if (msg.t === 'online-count') {
      onlineN = Number(msg.n) || 0;
      emit('onlineCount', onlineN);
      return;
    }
    if (msg.t === 'resume-failed') { storeSet(SESSION_KEY, ''); pushMsg('原来的对局已结束或已超时，请重新加入房间'); return; }
    // 服务端判定本机版本过低、拒绝开战 → 交给界面弹「去下载」
    if (msg.t === 'need-update') {
      verOutdated = true;
      if (msg.latest) serverBuild = Number(msg.latest) || 0;
      if (typeof msg.url === 'string' && msg.url) downloadUrl = msg.url;
      emit('needUpdate', { yours: Number(msg.yours) || myVer(), latest: serverBuild, url: downloadUrl });
      return;
    }
    if (msg.t === 'swap-req') { emit('swapReq', msg); return; }   // 有人想和你交换席位 → 界面弹确认
    // PVP 快捷对话：服务端广播给房间内所有人（含发送者），界面按 from 判断从哪个名字弹出
    if (msg.t === 'emote') {
      var txt = emoteText(msg.id);
      if (txt) emit('emote', { fromSelf: msg.from === myId, text: txt, id: msg.id, name: msg.name || '' });
      return;
    }
    if (msg.t === 'room') { room = msg.room; fire(); return; }
    if (msg.t === 'msg') { pushMsg(msg.text); return; }
    if (msg.t === 'start') { emit('start', room); return; }
    if (msg.t === 'stage') { emit('stage', msg.stage); return; }   // 联机：服务器通知阶段（如双方一起进准备面板）
    if (msg.t === 'ranked-wait') { emit('ranked', 'waiting', msg); return; }
    if (msg.t === 'ranked-matched') { room = msg.room; fire(); emit('ranked', 'matched', msg); return; }
    if (msg.t === 'ranked-cancel') { emit('ranked', 'idle', msg); return; }
    if (msg.t === 'ranked-result') {
      netBattle = false; netSpectator = false;
      rankMode = false; rankDeadline = 0;
      emit('deadline', { deadline: 0, ranked: false });   // 收起右上角倒计时
      emit('rankedResult', msg);
      return;
    }
    if (msg.t === 'battle' || msg.t === 'state') {
      if (window.Engine && Engine.load) Engine.load(msg.s);      // 装进本地引擎 → 界面自动刷新
      netSpectator = !!msg.spectator;                            // 观战者：同一套界面但只读
      // 排位房：服务器下发本回合截止时间（其它模式恒为 0）→ 界面画倒计时 / 超时提示
      rankMode = (msg.mode === 'ranked');
      rankDeadline = Number(msg.deadline) || 0;
      emit('deadline', { deadline: rankDeadline, ranked: rankMode });
      if (msg.t === 'battle') { netBattle = true; emit('battle', msg); }
      return;
    }
    // 对局中途作废（对手离开 / 掉线超时判负）→ 服务端广播，所有人（含观战者）退出对局界面回房间。
    // 以前服务端只通知了「另一个对战者」，观战者收不到任何消息，界面就一直卡在对局中。
    if (msg.t === 'battle-end') {
      netBattle = false; netSpectator = false;
      rankMode = false; rankDeadline = 0;                 // 排位标志/倒计时一起清
      emit('deadline', { deadline: 0, ranked: false });
      emit('battleEnd', msg.reason || '');
      return;
    }
    if (msg.t === 'leave') { leave(); return; }
  }

  /* ---------------- 查询 ---------------- */
  function ruleOf(id) { for (var i = 0; i < RULES.length; i++) if (RULES[i].id === id) return RULES[i]; return RULES[0]; }
  function getRoom() { return room; }

  return {
    on: on, off: off,
    rules: function () { return RULES.slice(); },
    ruleOf: ruleOf,
    getRoom: getRoom,
    seatTotal: SEAT_TOTAL, fightSeats: FIGHT_SEATS,
    isHost: isHost, mySeatRole: mySeatRole, allReady: allReady,
    fighters: fighters, freeSeat: freeSeat, seatOf: seatOf,
    createRoom: createRoom, joinRoom: joinRoom, leave: leave,
    setRule: setRule, ready: ready, start: start, switchSeat: switchSeat, swapAnswer: swapAnswer,
    resetReady: resetReady, refreshMe: refreshMe,
    iconOf: iconOf, me: me,
    setTransport: setTransport, applyServer: applyServer, send: send,
    connect: connect, endpoint: endpoint, isOnline: isOnline, myPlayerId: myPlayerId,
    latency: latency,                                  // 当前平滑后的 RTT（毫秒，-1 = 还没测到）
    rankedQueue: rankedQueue, rankedCancel: rankedCancel,   // 排位赛：开始 / 取消匹配
    cardsMismatch: function () { return cardsMismatch; },   // 本机卡表与服务器是否不一致
    cardsSig: localCardsSig,                                // 本机卡表指纹（排查用）
    verOutdated: function () { return verOutdated; },       // 本机版本是否低于服务器
    myVer: myVer, serverVer: function () { return serverBuild; },   // 版本号（排查/界面用）
    downloadUrl: function () { return downloadUrl; },       // 更新下载地址
    EMOTES: EMOTES, emoteLabel: EMOTE_LABEL,                // PVP 快捷对话文案表
    emoteText: emoteText, sendEmote: sendEmote,             // 取文案 / 发送
    onlineCount: onlineCount,                               // 当前在线人数（服务端广播）
    rankOf: rankOf, deadline: deadline, isRanked: isRanked, // 段位换算 / 回合截止时间 / 是否排位房
    setNetBattle: setNetBattle, inNetBattle: inNetBattle, beginRound: beginRound,
    isSpectator: function () { return netSpectator; }
  };
})();
