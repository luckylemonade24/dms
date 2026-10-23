/* ============================================================
 * server/server.js —— 地牢决斗师 · 联机服务端（P0）
 *
 *   一件事：把游戏文件托管出去，并以"权威服务器"的方式跑对局 ——
 *     客户端只发送操作（{t:'act', a:{...}}），真正的结算在服务端用
 *     **和客户端完全同一份 engine.js / cards.js / card_play.js** 进行，
 *     然后把结果状态回传，双方各自渲染。
 *
 *   为什么这样设计：
 *     · 规则同源 → 永远不会出现"服务端算的和客户端不一样"
 *     · 权威服务器 → 客户端改不了结果（防作弊）
 *     · 每个房间一个独立的引擎沙箱（vm context），互不干扰
 *
 *   启动：node server/server.js        （或双击 server/start.bat）
 *   访问：http://localhost:3000/       （同一局域网用 http://本机IP:3000/）
 *
 *   P1 进度（全部完成）：
 *     ✓ 出牌动画事件流：状态里带上"本次新增事件"，客户端自动播音效 / 攻击箭头 / 对手出牌展示
 *     ✓ 观战席实时画面（双方手牌脱敏、待决选项不下发，观战者只能看）
 *     ✓ 断线重连（快照恢复，席位保留 60 秒；重连彻底失败则自动退出房间）
 *     ✓ 对局中隐藏对手手牌内容（防 F12 偷看）
 *
 *   公网化加固（上线前必做）：
 *     ✓ 房间密码 / 鉴权：密码只存服务端、只做等值比对，**绝不下发**（只给 locked 标记）
 *     ✓ 限流与防刷：令牌桶（每秒回填 20 / 桶 60），超限丢弃、持续刷屏则断开；另有房间数上限
 *     · 日志与监控（落日志文件 + 简单统计）
 * ========================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { upgrade } = require('./ws.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

/* ---------------- 1. 先把游戏逻辑源码读进来（每个房间一个沙箱复用） ---------------- */
const ENGINE_FILES = [
  'js/rules.js', 'js/cards.js', 'js/tournament_data.js', 'js/academy_data.js',
  'js/awaken_data.js',                       // 3★ 觉醒词条表（engine 要用，必须在它之前）
  'js/card_play.js', 'js/engine.js', 'js/ai.js'
];
const SRC = {};
ENGINE_FILES.forEach((f) => { SRC[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });

// 每个房间一个沙箱：同一份代码、各自独立的状态
function createSandbox() {
  const store = {};
  const ctx = {
    console, Math, JSON, Date, isFinite, isNaN, parseInt, parseFloat, Array, Object, String, Number, Boolean,
    Error, RegExp, setTimeout, clearTimeout,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ENGINE_FILES.forEach((f) => vm.runInContext(SRC[f], ctx, { filename: f }));
  return ctx;
}

/* ---------------- 2. 静态托管游戏文件（页面与 ws 同源，最省事） ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
const server = http.createServer((req, res) => {
  let u = decodeURIComponent((req.url || '/').split('?')[0]);
  // ---- 监控接口：只读，且不含任何房间/玩家内容（可用于探活与容量观察）----
  if (u === '/health') { sendJson(res, { ok: true, uptimeSec: upSec() }); return; }
  if (u === '/stats') { sendJson(res, statsSnapshot()); return; }
  if (u === '/') u = '/index.html';
  const f = path.normalize(path.join(ROOT, u.replace(/^\//, '')));
  if (!f.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403');
    return;
  }
  /* 异步取文件信息。
   * 以前用的是 existsSync + statSync —— 同步 IO 会阻塞事件循环，
   * 几十张卡图并发加载时服务端直接排队，表现就是"切界面 / 弹窗特别慢"。 */
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    const ext = path.extname(f).toLowerCase();
    // 页面类不缓存（改了立刻生效）；其它静态资源（卡图 / js / css / 字体）长缓存 + ETag。
    // 有了 ETag，浏览器下次只发一个 If-None-Match，命中就回 304 —— 一个字节都不重传。
    const noCache = (ext === '.html' || ext === '.webmanifest');
    const etag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=2592000',
      'ETag': etag,
      'Last-Modified': st.mtime.toUTCString()
    };
    const inm = req.headers['if-none-match'];
    const ims = req.headers['if-modified-since'];
    const fresh = (inm && inm === etag) ||
      (!inm && ims && st.mtime.getTime() <= Date.parse(ims) + 999);   // HTTP 日期只有秒精度
    if (fresh) { res.writeHead(304, headers); res.end(); return; }
    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    const rs = fs.createReadStream(f);
    rs.on('error', () => { try { res.destroy(); } catch (e) { } });
    rs.pipe(res);
  });
});

/* ---------------- 日志与监控 ----------------
 * 只记"关键事件"（建房 / 加入 / 开局 / 拒绝 / 刷屏 / 异常），量很小，不记每条消息。
 * 控制台 + 按天分文件；落盘失败不影响服务。 */
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, 'logs');
const LOG_TO_FILE = process.env.LOG_TO_FILE !== '0';
const startedAt = Date.now();
const STATS = { rooms: 0, games: 0, acts: 0, denied: 0, floods: 0, errors: 0 };

function upSec() { return Math.round((Date.now() - startedAt) / 1000); }
function pad2(n) { return String(n).padStart(2, '0'); }
function dayStamp(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

function logLine(tag, text) {
  const d = new Date();
  const line = '[' + dayStamp(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + '] [' + tag + '] ' + text;
  console.log(line);
  if (!LOG_TO_FILE) return;
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, 'server-' + dayStamp(d) + '.log'), line + '\n');
  } catch (e) { /* 落盘失败不影响服务 */ }
}

/* 只读监控快照：只给聚合数字，不含任何房间 / 玩家内容 */
function statsSnapshot() {
  const mem = process.memoryUsage();
  let seated = 0;
  ROOMS.forEach((r) => r.seats.forEach((s) => { if (s.player) seated++; }));
  return {
    ok: true,
    now: new Date().toISOString(),
    uptimeSec: upSec(),
    rooms: ROOMS.size,
    playersInRooms: seated,
    liveConnections: CONNS.size,
    waitingReconnect: OFFLINE.size,
    sessionsTotal: nextPid - 1,
    roomsCreated: STATS.rooms,
    gamesStarted: STATS.games,
    actions: STATS.acts,
    denied: STATS.denied,
    floods: STATS.floods,
    errors: STATS.errors,
    rssMB: Math.round(mem.rss / 1048576)
  };
}
function sendJson(res, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/* ---------------- 3. 房间 ---------------- */
const ROOMS = new Map();                                   // code → room
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 500);    // 防"狂建房"把内存吃光
const CONNS = new Set();                                   // 所有在线会话
let nextPid = 1;

/* ---------------- 在线人数 ----------------
 * 以 CONNS.size 为唯一真相（**不要用 ++/-- 计数器**：重连会 doResume 复用会话对象，
 * 计数器一旦漏减就会越滚越大）。CONNS 是 Set<session>：
 *   连接建立 → add；断开 → delete；重连 → delete(新会话) + add(旧会话) → size 不变。
 * 所以反复掉线重连也不会重复计数。 */
function onlineCount() { return CONNS.size; }
function broadcastOnline() {
  const n = CONNS.size;
  CONNS.forEach((s) => { try { send(s, { t: 'online-count', n: n }); } catch (e) { } });
}

/* 房间密码：只在服务端保存、只做等值比对，**绝不下发**给任何客户端
 * （pubRoomFor 只给一个 locked 布尔值）。留空 = 不设密码。 */
function normPass(p) { return String(p == null ? '' : p).trim().slice(0, 12); }
function mkRoom(code, pass) {
  const seats = [];
  for (let i = 0; i < 4; i++) seats.push({ role: i < 2 ? 'fight' : 'watch', player: null });
  return {
    code, rule: 'bo1', hostId: null, status: 'waiting', seats, seq: 0, round: 0, game: null,
    pass: normPass(pass), series: null,
    /* mode: 'friendly'（好友房，默认）| 'ranked'（排位赛：随机匹配、不出现在房间列表、有回合计时） */
    mode: 'friendly',
    rank: null,          // 排位房：{ scoreA, scoreB }
    rankTimer: null,     // 回合计时器
    rankDeadline: 0,     // 本回合截止时间戳（下发给客户端画倒计时）
    rankTag: null        // 当前计时对应的"回合标记"（同一回合内不重置计时）
  };
}

/* ---------------- 排位赛（随机匹配 · 一局定胜负 · 每回合 80 秒） ----------------
 * 规则（与客户端约定）：
 *   · 客户端发 {t:'ranked', score:N} → 服务器按分差 ≤ RANK_RANGE 找等待中的对手
 *   · 找不到就把自己挂进 RANK_QUEUE，回 {t:'ranked-wait'}（客户端显示"匹配中"）
 *   · 匹配成功 → 建一个 mode:'ranked' 的房（不进房间列表、无密码、不给人 join），
 *     两人直接坐进对战席，服务器立刻开局（客户端不需要准备/开始）
 *   · ⚠ 只有 mode==='ranked' 才挂 80 秒回合计时；好友房/PvE 一律没有时限
 *   · 一局定胜负：结束时按 st.winner 给双方 ±1 分，广播 {t:'ranked-result', win, delta, score}
 * 分数存在客户端（存档里），服务端只做 clamp 与结算 —— 与项目现有"进度存本地"的策略一致。
 */
const RANK_QUEUE = new Map();                                  // sess.id → { sess, score, since }
const RANK_RANGE = 10;                                         // 分差 ≤ 10（约一个段位）
const RANK_TURN_MS = Number(process.env.RANK_TURN_MS || 80000); // 回合计时（测试可用环境变量缩短）

/* 排位赛卡组校验：必须**恰好 DECK_START(20) 张**的合法卡组（大卡组 20~40 张一律拒绝）。
 * 客户端组卡器用的是 storage.js 的 DeckRules，但**服务端沙箱没有加载 storage.js**，
 * 所以这里用沙箱里的 CARDS + Rules 自己复算一遍（懒创建一个 ctx 复用，别每局都 new）。 */
let DECK_CTX = null;
function deckCtx() { if (!DECK_CTX) DECK_CTX = createSandbox(); return DECK_CTX; }
function checkRankedDeck(ids) {
  const ctx = deckCtx();
  const need = (ctx.Rules && ctx.Rules.DECK_START) || 20;
  if (!Array.isArray(ids) || !ids.length) return '排位赛需要先选择卡组';
  if (ids.length !== need) return '排位赛必须使用 ' + need + ' 张卡组（当前 ' + ids.length + ' 张），请到组卡器调整';
  const CARDS = ctx.CARDS, cnt = {};
  for (let i = 0; i < ids.length; i++) {
    const cd = CARDS[ids[i]];
    if (!cd) return '卡组里有不存在的卡：' + ids[i];
    cnt[ids[i]] = (cnt[ids[i]] || 0) + 1;
    const cap = cd.maxCopies || 0;
    if (cap && cnt[ids[i]] > cap) return '卡组超出张数上限：' + cd.name + ' ×' + cnt[ids[i]] + '（上限 ' + cap + '）';
  }
  return null;
}

function rankClamp(n) {
  n = Math.round(Number(n));
  if (!isFinite(n)) n = 1;
  return Math.max(1, Math.min(100, n));
}
function clearRankTimer(room) {
  if (!room) return;
  if (room.rankTimer) { clearTimeout(room.rankTimer); room.rankTimer = null; }
  room.rankDeadline = 0;
}
/* 每个"新回合"挂一次 80 秒计时：同一回合内的动作不重置计时，
 * 否则玩家只要不停操作就能无限拖时间。 */
function armRankTimer(room) {
  if (!room || room.mode !== 'ranked') return;
  const g = room.game;
  if (!g) { clearRankTimer(room); return; }
  const st = g.engine.state;
  if (st.winner) { clearRankTimer(room); return; }
  /* ★ 计时归属于"现在该谁动"：
   *   有待决选择（弹窗让某人选牌/选目标）= pending.actorKey（被问的那个人）；
   *   否则 = active（当前回合方）。
   *   旧实现只看 st.active → "我用法杖、对手做选择"期间跑的是**我的**时间，
   *   反过来"对手用法杖、我选牌"跑的是**他的**时间，两边都算错了人。
   *   现在 pending 一出现/一消失都会换新 tag → 给当下该动的人重新挂满 80 秒。 */
  const who = st.pending ? st.pending.actorKey : st.active;
  const tag = (st.turnCount || 0) + ':' + st.active + ':' + (st.pending ? 'P' + st.pending.actorKey : 'R');
  if (room.rankTag === tag && room.rankTimer) return;           // 同一阶段，计时继续走
  clearRankTimer(room);
  room.rankTag = tag;
  room.rankWho = who;
  room.rankDeadline = Date.now() + RANK_TURN_MS;
  room.rankTimer = setTimeout(() => onRankTimeout(room), RANK_TURN_MS);
}
function onRankTimeout(room) {
  room.rankTimer = null;
  const g = room.game;
  if (!g) return;
  let st = g.engine.state;
  if (st.winner) { clearRankTimer(room); sendState(room, false); return; }
  // 超时时若还挂着一个"待决选择"（弃牌/选目标），自动按默认处理，否则 END_TURN 会被拒
  if (st.pending) {
    try { g.engine.resolvePrompt(); } catch (e) { }
    st = g.engine.state;
  }
  if (st.winner) { clearRankTimer(room); sendState(room, false); return; }
  let r = null;
  try { r = g.engine.tryAction({ type: 'END_TURN' }); } catch (e) { }
  if (r && r.ok) { sendState(room, false); return; }
  // 还被卡着（极少见）→ 5 秒后重试，别让房间永远僵住
  room.rankTimer = setTimeout(() => onRankTimeout(room), 5000);
}
/* 排位结算：赢 +1 / 输 -1。
 * loserSess：主动退出/掉线判负时用 —— 那时该玩家的座位已经被清空，
 *   sessionOfPlayer() 找不到人，必须用调用方手里的会话兜底，
 *   否则"退出者自己"收不到 -1，客户端存档里的分数会停在旧值。 */
function settleRanked(room, winnerKey, loserSess) {
  const g = room.game;
  if (!g || !room.rank) return;
  const winA = winnerKey === 'A';
  const byForfeit = !!loserSess;
  const put = (pid, win, base, forfeit) => {
    let sess = sessionOfPlayer(room, pid);
    if (!sess && loserSess && loserSess.id === pid) sess = loserSess;
    if (!sess) return;
    const delta = win ? 1 : -1;
    send(sess, {
      t: 'ranked-result', win, delta,
      score: rankClamp(base + delta), mode: 'ranked', forfeit: !!forfeit
    });
  };
  put(g.A, winA, room.rank.scoreA, byForfeit && !winA);
  put(g.B, !winA, room.rank.scoreB, byForfeit && winA);
  clearRankTimer(room);
  logLine('ranked', '排位结算 ' + room.code + '：' + (winA ? 'A' : 'B') + ' 胜（' +
    room.rank.scoreA + (winA ? '+1' : '-1') + ' vs ' + room.rank.scoreB + (winA ? '-1' : '+1') + '）' +
    (byForfeit ? '（判负）' : ''));
}

function startRankedMatch(a, b) {
  if (ROOMS.size >= MAX_ROOMS) {
    sendMsg(a, '服务器房间数已达上限，请稍后再试');
    sendMsg(b, '服务器房间数已达上限，请稍后再试');
    return;
  }
  const sa = rankClamp(a.rankScore), sb = rankClamp(b.rankScore);
  /* 卡组二次校验：排队期间可能换过卡组。不合规的一方收到原因，合规的一方放回队列（不用重排）。 */
  const badA = checkRankedDeck(a.profile && a.profile.deckIds);
  const badB = checkRankedDeck(b.profile && b.profile.deckIds);
  if (badA || badB) {
    if (badA) sendMsg(a, badA);
    else { RANK_QUEUE.set(a.id, { sess: a, score: sa, since: Date.now() }); send(a, { t: 'ranked-wait', score: sa, queue: RANK_QUEUE.size, range: RANK_RANGE }); }
    if (badB) sendMsg(b, badB);
    else { RANK_QUEUE.set(b.id, { sess: b, score: sb, since: Date.now() }); send(b, { t: 'ranked-wait', score: sb, queue: RANK_QUEUE.size, range: RANK_RANGE }); }
    return;
  }
  leaveRoom(a, false);
  leaveRoom(b, false);
  const room = mkRoom(randCode(), '');
  room.mode = 'ranked';
  room.hostId = a.id;
  room.status = 'playing';
  room.rank = { scoreA: sa, scoreB: sb };
  a.profile = a.profile || normProfile({}, null);
  b.profile = b.profile || normProfile({}, null);
  room.seats[0].player = Object.assign({}, a.profile, { id: a.id, sess: a, ready: true });
  room.seats[1].player = Object.assign({}, b.profile, { id: b.id, sess: b, ready: true });
  ROOMS.set(room.code, room);
  a.room = room.code; b.room = room.code;
  room.series = newServerSeries({ rule: 'bo1', need: 1, total: 1 });
  broadcastRoom(room);
  send(a, { t: 'ranked-matched', room: pubRoomFor(room, a.id), score: sa });
  send(b, { t: 'ranked-matched', room: pubRoomFor(room, b.id), score: sb });
  logLine('ranked', '匹配成功 ' + room.code + '：' + sa + ' 分 vs ' + sb + ' 分');
  beginBattle(a, { first: Math.random() < 0.5 ? 'A' : 'B', seed: (Date.now() >>> 0) });
}

function doRankedQueue(sess, m) {
  const score = rankClamp(m && m.score);
  // ★ 排位赛只接受 20 张的合法卡组（大卡组一律拒绝）—— 在入队前就挡掉
  const deckWhy = checkRankedDeck(sess.profile && sess.profile.deckIds);
  if (deckWhy) { sendMsg(sess, deckWhy); return; }
  sess.rankScore = score;
  if (sess.room) leaveRoom(sess, false);          // 排位不接受手动房间：先退房再匹配
  RANK_QUEUE.delete(sess.id);
  let best = null;
  RANK_QUEUE.forEach((e) => {
    if (!e || !e.sess || e.sess.id === sess.id) return;
    if (!e.sess.conn) return;
    const d = Math.abs(e.score - score);
    if (d > RANK_RANGE) return;
    if (!best || d < best.d) best = { e: e, d: d };
  });
  if (best) {
    RANK_QUEUE.delete(best.e.sess.id);
    startRankedMatch(best.e.sess, sess);
    return;
  }
  RANK_QUEUE.set(sess.id, { sess: sess, score: score, since: Date.now() });
  send(sess, { t: 'ranked-wait', score: score, queue: RANK_QUEUE.size, range: RANK_RANGE });
  logLine('ranked', sess.id.slice(0, 6) + ' 进入匹配队列（' + score + ' 分，队列 ' + RANK_QUEUE.size + '）');
}
function doRankedCancel(sess) {
  RANK_QUEUE.delete(sess.id);
  send(sess, { t: 'ranked-cancel' });
  logLine('ranked', sess.id.slice(0, 6) + ' 取消匹配');
}

/* ---------------- 多局制（series）：由服务器权威维护 ----------------
 * 以前 series（比分 / 第几局 / 先手顺序）是客户端各算各的 —— 两端一旦有出入就再也对不上，
 * 观战者也完全看不到进度。现在：
 *   · 房主点「确认开始」→ 服务器建立 series（规则参数由客户端提供，先手由服务器摇）
 *   · 每局结束 → 服务器结算比分并广播
 *   · 下发给每个视角时按"我"换算 win / lose（观战者看 A 视角） */
function firstOf(gameIdx, total) {
  if (total <= 1 || gameIdx >= total - 1) return Math.random() < 0.5 ? 'A' : 'B';   // 单局 / 决胜局随机
  return gameIdx % 2 === 0 ? 'A' : 'B';                                            // 其余轮流先手
}
function newServerSeries(arg) {
  let total = Number(arg && arg.total) || 1;
  let need = Number(arg && arg.need) || 1;
  total = Math.max(1, Math.min(9, total));
  need = Math.max(1, Math.min(total, need));
  const firsts = [];
  // 允许显式指定先手顺序（自动化测试用）；对战客户端不传 → 由服务器摇
  const given = (arg && Array.isArray(arg.firsts)) ? arg.firsts : null;
  for (let i = 0; i < total; i++) {
    const g = given && (given[i] === 'A' || given[i] === 'B') ? given[i] : null;
    firsts.push(g || firstOf(i, total));
  }
  return { rule: String((arg && arg.rule) || 'bo1'), need, total, round: 0, wins: { A: 0, B: 0 }, firsts, over: false };
}
function seriesFor(room, viewerId) {
  const s = room.series;
  if (!s) return null;
  // 我是 A 还是 B：优先看对局里的座位，没开局就按"对战席第 1/2 位"判断
  let mine = 'A';
  if (room.game) mine = (room.game.A === viewerId) ? 'A' : ((room.game.B === viewerId) ? 'B' : 'A');
  else if (room.seats[0] && room.seats[0].player && room.seats[0].player.id === viewerId) mine = 'A';
  else if (room.seats[1] && room.seats[1].player && room.seats[1].player.id === viewerId) mine = 'B';
  return {
    rule: s.rule, need: s.need, total: s.total, round: s.round, over: s.over,
    win: (mine === 'B' ? s.wins.B : s.wins.A),
    lose: (mine === 'B' ? s.wins.A : s.wins.B),
    firsts: s.firsts.slice()
  };
}
function randCode() {
  for (let i = 0; i < 200; i++) {
    const c = String(1000 + Math.floor(Math.random() * 9000));
    if (!ROOMS.has(c)) return c;
  }
  return String(Date.now() % 10000);
}
function seatOfPlayer(room, pid) {
  return room.seats.find((s) => s.player && s.player.id === pid) || null;
}
function sessionOfPlayer(room, pid) {
  const s = seatOfPlayer(room, pid);
  return s ? s.player.sess : null;
}
function fighters(room) {
  return room.seats.filter((s) => s.role === 'fight' && s.player).map((s) => s.player);
}
function send(sess, obj) { if (sess && sess.conn) sess.conn.sendJSON(obj); }
function sendMsg(sess, text) { send(sess, { t: 'msg', text }); }
function sendErr(sess, text) { send(sess, { t: 'msg', text: text }); }

// 房间对外发布：只把自己那份 deckIds 带上（别人的卡组只给名字，避免被人看到卡表）
function pubRoomFor(room, viewerId) {
  room.seq++;
  return {
    code: room.code, rule: room.rule, hostId: room.hostId, status: room.status, seq: room.seq,
    mode: room.mode,                          // 'friendly' | 'ranked'（客户端据此决定要不要显示倒计时/段位）
    locked: !!room.pass,                      // 只告诉"有没有密码"，密码本身不下发
    series: seriesFor(room, viewerId),        // 多局制比分：服务器权威，按视角换算 win/lose
    seats: room.seats.map((s) => ({
      role: s.role,
      player: s.player ? {
        id: s.player.id, name: s.player.name, avatar: s.player.avatar, title: s.player.title,
        deckName: s.player.deckName, ready: !!s.player.ready,
        self: s.player.id === viewerId,
        deckIds: s.player.id === viewerId ? s.player.deckIds.slice() : undefined
      } : null
    }))
  };
}
function broadcastRoom(room) {
  room.seats.forEach((s) => {
    if (!s.player) return;
    send(s.player.sess, { t: 'room', room: pubRoomFor(room, s.player.id) });
  });
}

/* 递归翻转对象/数组里所有取值为 'A' / 'B' 的字段。
 * 事件流（events）是嵌套结构，必须深度处理，否则客户端播出来的
 * "对手出牌 / 攻击连线"会指向错误的一侧。 */
function flipSideDeep(o) {
  if (o === 'A') return 'B';
  if (o === 'B') return 'A';
  if (!o || typeof o !== 'object') return o;
  if (Array.isArray(o)) return o.map(flipSideDeep);
  const out = {};
  Object.keys(o).forEach((k) => { out[k] = flipSideDeep(o[k]); });
  return out;
}

/* ---------------- 4. 对局：权威结算 + 双视角下发 ---------------- */
// 客户端永远"自己在下方"（视图里的 A 就是自己），所以给 B 方下发前把状态翻一下
function flipInPlace(s) {
  const a = s.players.A; s.players.A = s.players.B; s.players.B = a;
  s.players.A.key = 'A'; s.players.B.key = 'B';
  s.active = s.active === 'A' ? 'B' : (s.active === 'B' ? 'A' : s.active);
  // 胜负结果同样要翻：客户端里 'A' 永远代表"自己"。
  // 漏了这条 → 赢家看到"失败"、输家也看到"失败"；或某个方向下双方都显示"自己赢了"。
  if (s.winner === 'A') s.winner = 'B';
  else if (s.winner === 'B') s.winner = 'A';
  if (s.pending) {
    if (s.pending.actorKey) s.pending.actorKey = s.pending.actorKey === 'A' ? 'B' : 'A';
    if (s.pending.victimKey) s.pending.victimKey = s.pending.victimKey === 'A' ? 'B' : 'A';
  }
  ['dealt', 'healed'].forEach((k) => { if (s[k]) { const t = s[k].A; s[k].A = s[k].B; s[k].B = t; } });
  if (s.dmgBy) { const t = s.dmgBy.A; s.dmgBy.A = s.dmgBy.B; s.dmgBy.B = t; }
  // 事件流也要翻：客户端拿它播动画 / 音效 / 攻击连线，
  // 里面的 key / player / toPlayer / fromKey… 都是阵营字段
  if (Array.isArray(s.events)) s.events = flipSideDeep(s.events);
  return s;
}
/* spectate=true → 生成"观战视角"：沿用 A 的构图（房主在下），但
 *   · 双方手牌全部脱敏（只留张数，界面渲染成背面）
 *   · 待决提示不给具体选项（观战者不该看到别人的选择内容） */
function snapshotFor(room, key, spectate) {
  const raw = room.game.engine.state;
  const copy = JSON.parse(JSON.stringify(raw));
  if (key === 'B') flipInPlace(copy);
  // 只留张数的脱敏：手牌（卡背）/ 牌库（对手接下来摸什么，是隐藏信息）
  const maskPile = (arr) => (Array.isArray(arr) ? arr.map(() => ({ iid: null, cardId: null })) : arr);
  if (spectate) {
    ['A', 'B'].forEach((k) => {
      const p = copy.players[k];
      if (!p) return;
      p.hand = maskPile(p.hand);
      p.deck = maskPile(p.deck);      // 观战者也不能看到牌库顺序（防串通）
    });
  } else {
    // 对战中的玩家：只脱敏"对手"的手牌 + 牌库（翻转后 players.B 恒为对手）。
    // 以前手牌是明文 → F12 能偷看手牌；牌库同样没脱敏 → 还能看到对手接下来摸什么。
    // 弃牌堆（discard）是公开信息，故意不脱敏。
    const opp = copy.players.B;
    if (opp) { opp.hand = maskPile(opp.hand); opp.deck = maskPile(opp.deck); }
  }
  // 待决提示只发给"该做决定的人"（翻转后视角里 'A' 就是自己）。
  // 另一位（以及观战者）不能拿到完整选项（那里有对手的手牌/卡组内容），
  // 但也不该一点提示都没有 —— 发一个只读空壳，界面会显示"对手正在抉择…"。
  if (copy.pending && (spectate || copy.pending.actorKey !== 'A')) {
    copy.pending = { kind: 'WAIT_OPPONENT', actorKey: copy.pending.actorKey };
  }
  // 注意：**不要删 events**。联机对局的过程表现（音效 / 攻击箭头 / 对手出牌展示）
  // 全靠它，ui.js 的 processEvents() 单机与联机共用同一套逻辑。
  // 每次操作前引擎会把 state.events 清空（tryAction），所以这里天然是"本次新增"。
  return copy;
}
function sendState(room, initial) {
  const g = room.game;
  if (!g) return;
  const st = g.engine.state;
  /* 排位房：先把本回合的 deadline 算好再下发 —— 否则开局第一包（t:'battle'）里
   * deadline 还是 0，客户端要等下一次操作才看到倒计时。 */
  armRankTimer(room);
  if (st.winner && !room.ended) {          // 一局只记一次
    room.ended = true;
    logLine('game', '对局结束 ' + room.code + '：胜者 ' + st.winner);
    if (room.mode === 'ranked') settleRanked(room, st.winner);   // 排位：±1 分并单独下发
    // 多局制：由服务器结算比分并广播（两端 + 观战者看到的一定是同一份）
    const s = room.series;
    if (s && !s.over) {
      s.wins[st.winner] = (s.wins[st.winner] || 0) + 1;
      s.round++;
      if (s.wins.A >= s.need || s.wins.B >= s.need || s.round >= s.total) s.over = true;
      logLine('game', '系列比分 ' + room.code + '：A ' + s.wins.A + ' : B ' + s.wins.B +
        (s.over ? '（系列结束）' : '（准备第 ' + (s.round + 1) + ' 局）'));
      broadcastRoom(room);
    }
  }
  [['A', g.A], ['B', g.B]].forEach(([key, pid]) => {
    const sess = sessionOfPlayer(room, pid);
    if (!sess) return;
    send(sess, {
      t: initial ? 'battle' : 'state',
      s: snapshotFor(room, key),
      over: !!st.winner, winner: st.winner || null,
      mode: room.mode,
      // 排位房：本回合截止时间戳（客户端据此画倒计时；其它模式恒为 0，客户端不显示）
      deadline: room.mode === 'ranked' ? (room.rankDeadline || 0) : 0
    });
  });
  // 观战者：同一套状态（A 视角构图），但手牌脱敏、不给待决选项 → 只能看
  room.seats.forEach((s) => {
    if (!s.player || s.role !== 'watch' || !s.player.sess) return;
    send(s.player.sess, {
      t: initial ? 'battle' : 'state',
      s: snapshotFor(room, 'A', true),
      over: !!st.winner, winner: st.winner || null,
      spectator: true
    });
  });
  st.events = [];
}

/* ---------------- 5. 会话与消息处理 ---------------- */
/* 掉线宽限期：刷新页面 / 短暂断网时可以重连回原来的席位（不会立刻被踢出房间）。
 * 可用环境变量 OFFLINE_GRACE_MS 覆盖（测试时缩短）。 */
const OFFLINE_GRACE_MS = Number(process.env.OFFLINE_GRACE_MS || 60000);
const OFFLINE = new Map();          // 会话 id → 等待重连的会话

/* 简单的令牌桶限流（防刷）：
 *   每个连接每秒回填 RATE 个令牌、桶容量 BURST；每条消息耗 1 个。
 *   超限的消息**直接丢弃**（不断线 —— 网络抖动/连点不该被踢）；
 *   但持续刷屏（累计超限太多次）就断开连接。 */
const MSG_RATE = Number(process.env.MSG_RATE || 20);
const MSG_BURST = Number(process.env.MSG_BURST || 60);
const MSG_OVER_LIMIT = Number(process.env.MSG_OVER_LIMIT || 300);
function allowMsg(sess) {
  const now = Date.now();
  const b = sess.bucket || (sess.bucket = { tokens: MSG_BURST, at: now });
  b.tokens = Math.min(MSG_BURST, b.tokens + ((now - b.at) / 1000) * MSG_RATE);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function bindConn(sess) {
  const conn = sess.conn;
  conn.onMessage = (text) => {
    let m = null;
    try { m = JSON.parse(text); } catch (e) { return; }
    if (!allowMsg(sess)) {
      sess.over = (sess.over || 0) + 1;
      STATS.floods++;
      if (sess.over === 1 || sess.over % 100 === 0) {
        logLine('flood', sess.id.slice(0, 6) + ' 消息超速（累计 ' + sess.over + ' 次），已丢弃');
      }
      if (sess.over > MSG_OVER_LIMIT) {
        logLine('flood', sess.id.slice(0, 6) + ' 持续刷屏，断开连接');
        try { conn.close(); } catch (e) { }
      }
      return;
    }
    if (!m || !m.t) return;
    // 应用层心跳 / 延迟测量：把客户端带来的 ts 原样回传，客户端据此算 RTT
    if (m.t === 'ping') { conn.sendJSON({ t: 'pong', ts: m.ts }); return; }
    try { handle(sess, m); } catch (e) {
      console.error('[server] 处理消息异常', m.t, e);
      sendMsg(sess, '服务器处理出错：' + e.message);
    }
  };
  conn.onClose = () => {
    CONNS.delete(sess);
    broadcastOnline();                             // 掉线立刻广播，人数马上减一（用 Set.size，不会叠加）
    RANK_QUEUE.delete(sess.id);                    // 断线 → 立刻退出匹配队列（不让别人匹到幽灵）
    if (!sess.room) return;                        // 不在房间里：直接结束
    // 在房间里 → 先保留席位，等一会儿看是否重连
    sess.offline = true;
    clearTimeout(sess.timer);
    sess.timer = setTimeout(() => {
      OFFLINE.delete(sess.id);
      leaveRoom(sess, true);                       // 宽限期到还没回来 → 正式离开
      console.log('[room] ' + sess.id + ' 掉线超时，已离开房间');
    }, OFFLINE_GRACE_MS);
    OFFLINE.set(sess.id, sess);
    const room = ROOMS.get(sess.room);
    if (room) {
      const secs = Math.round(OFFLINE_GRACE_MS / 1000);
      const other = room.seats.map((s) => s.player).filter((p) => p && p.id !== sess.id && p.sess)[0];
      if (other) sendMsg(other.sess, '对手掉线了，正在等待重连…（' + secs + ' 秒内回来可继续）');
      broadcastRoom(room);
    }
    console.log('[room] ' + sess.id + ' 掉线，保留席位 ' + Math.round(OFFLINE_GRACE_MS / 1000) + ' 秒等待重连');
  };
}

function onConn(conn) {
  const sess = { conn, id: 'p' + (nextPid++), room: null, profile: null, offline: false, timer: null };
  CONNS.add(sess);
  // ranked: 服务端是否支持排位（旧服务端没有这个字段 → 客户端据此提示"服务端版本过旧"）
  // n: 当前在线人数，连上就立刻告诉客户端（不用等下一次广播）
  conn.sendJSON({ t: 'hello', id: sess.id, ranked: true, n: CONNS.size });
  bindConn(sess);
  broadcastOnline();                             // 有人连上 → 广播最新在线人数
}

/* 重连：把新连接接到"等待重连的旧会话"上。
 * 关键点：**沿用旧会话对象和它的 id** —— 房间席位、对局里的 A/B 引用都是按 id 记的，
 * 只把底层连接换掉，其它状态自动全部恢复，不需要迁移。 */
function doResume(newSess, oldId) {
  const old = OFFLINE.get(String(oldId || ''));
  if (!old || !old.offline) {
    newSess.conn.sendJSON({ t: 'resume-failed' });
    console.log('[server] 重连失败：' + oldId + ' 没有等待中的会话');
    return;
  }
  clearTimeout(old.timer);
  OFFLINE.delete(old.id);
  old.timer = null;
  old.offline = false;
  // 新连接交给旧会话，新会话作废
  old.conn = newSess.conn;
  newSess.conn = null;
  CONNS.delete(newSess);
  CONNS.add(old);
  bindConn(old);
  old.conn.sendJSON({ t: 'hello', id: old.id, resumed: true, ranked: true, n: CONNS.size });
  const room = old.room && ROOMS.get(old.room);
  if (room) {
    broadcastRoom(room);
    if (room.game) sendState(room, true);          // 对局中 → 直接把当前局面推回去
    const other = room.seats.map((s) => s.player).filter((p) => p && p.id !== old.id && p.sess)[0];
    if (other) sendMsg(other.sess, '对手已重新连接，继续对局');
    console.log('[room ' + room.code + '] ' + old.id + ' 重连成功');
  } else {
    console.log('[server] ' + old.id + ' 重连成功（不在房间）');
  }
}

function normProfile(m, old) {
  const p = old || {};
  return {
    id: p.id,
    name: String(m.name || p.name || '玩家').slice(0, 12),
    avatar: String(m.avatar || p.avatar || '初始头像1').slice(0, 40),
    title: String(m.title || p.title || '雪景学院新生').slice(0, 20),
    deckName: String(m.deckName || p.deckName || '卡组').slice(0, 12),
    deckIds: Array.isArray(m.deckIds) ? m.deckIds.filter((x) => typeof x === 'string').slice(0, 40)
      : (p.deckIds || []).slice(),
    ready: false
  };
}

/* 资料变了（比如房间里换了卡组）→ 同步到席位并广播。
 * 旧实现只更新 sess.profile 就结束了，导致"卡组换成功、房间里还显示旧卡组"。 */
function syncProfileToSeat(sess) {
  const room = sess.room && ROOMS.get(sess.room);
  if (!room || !sess.profile) return;
  const seat = seatOfPlayer(room, sess.id);
  if (!seat) return;
  Object.assign(seat.player, {
    name: sess.profile.name, avatar: sess.profile.avatar, title: sess.profile.title,
    deckName: sess.profile.deckName, deckIds: (sess.profile.deckIds || []).slice()
  });
  seat.player.ready = false;                     // 换了资料/卡组 → 需要重新准备
  broadcastRoom(room);
}

function handle(sess, m) {
  switch (m.t) {
    case 'resume': doResume(sess, m.id); break;      // 断线重连：把本次连接接到等待中的旧会话上
    case 'profile': sess.profile = normProfile(m, sess.profile); syncProfileToSeat(sess); break;
    case 'create': doCreate(sess, m.pass); break;
    case 'join': doJoin(sess, m.code, m.pass); break;
    case 'leave': leaveRoom(sess, false); break;
    case 'rule': setRule(sess, m.rule); break;
    case 'seat':
    case 'swap': doSwapRequest(sess, m.role, m.idx); break;   // 点席位：空着直接换，有人则发交换申请
    case 'swap-answer': doSwapAnswer(sess, m.ok); break;      // 回应交换席位申请
    case 'ready': setReady(sess, m.v); break;
    case 'deck': setDeck(sess, m); break;
    case 'start': doStart(sess, m.series); break;
    case 'begin': beginBattle(sess, m); break;
    case 'act': doAct(sess, m.a); break;
    case 'prompt': doPrompt(sess, m.v); break;
    case 'ranked': doRankedQueue(sess, m); break;        // 排位赛：开始匹配
    case 'ranked-cancel': doRankedCancel(sess); break;   // 排位赛：取消匹配
    default: break;
  }
}

function doCreate(sess, pass) {
  if (ROOMS.size >= MAX_ROOMS) { sendMsg(sess, '服务器房间数已达上限，请稍后再试'); return; }
  leaveRoom(sess, false);
  const room = mkRoom(randCode(), pass);
  sess.profile = sess.profile || normProfile({}, null);
  room.hostId = sess.id;
  const p = Object.assign({}, sess.profile, { id: sess.id, sess, ready: false });   // id 必须用会话 id
  room.seats[0].player = p;
  ROOMS.set(room.code, room);
  sess.room = room.code;
  broadcastRoom(room);
  STATS.rooms++;
  logLine('room', '建房 ' + room.code + (room.pass ? '（已设密码）' : '') + ' by ' + sess.id.slice(0, 6) + '，当前房间数 ' + ROOMS.size);
  sendMsg(sess, '房间已创建，房号 ' + room.code + (room.pass ? '（已设密码，加入的人要输密码）' : '') + '（把房号发给朋友即可加入）');
}

function doJoin(sess, code, pass) {
  const room = ROOMS.get(String(code || '').trim());
  if (!room) { sendMsg(sess, '没有找到房号 ' + code + ' 的房间'); return; }
  // 排位房是服务器撮合出来的，不允许用房号加入（否则别人能插进排位局）
  if (room.mode === 'ranked') { sendMsg(sess, '该房间不可加入'); return; }
  // 设了密码的房间：密码不对一律进不来（对战席 / 观战席都一样）
  if (room.pass && room.pass !== normPass(pass)) {
    STATS.denied++;
    logLine('deny', '密码错误，拒绝加入 ' + room.code + ' by ' + sess.id.slice(0, 6));
    sendMsg(sess, '密码不正确 —— 房间 ' + room.code + ' 已设密码，请向房主确认后重试');
    return;
  }
  if (seatOfPlayer(room, sess.id)) { sendMsg(sess, '你已经在这个房间里了'); return; }
  const free = room.seats.find((s) => !s.player);
  if (!free) { sendMsg(sess, '房间已满（最多 4 人）'); return; }
  leaveRoom(sess, false);
  sess.profile = sess.profile || normProfile({}, null);
  sess.room = room.code;
  free.player = Object.assign({}, sess.profile, { id: sess.id, sess, ready: false });   // id 必须用会话 id
  broadcastRoom(room);
  logLine('room', '加入 ' + room.code + ' by ' + sess.id.slice(0, 6) + '（' + (free.role === 'fight' ? '对战席' : '观战席') + '）');
  sendMsg(sess, '已加入房间 ' + room.code);
}

function leaveRoom(sess, silentQuit) {
  RANK_QUEUE.delete(sess.id);                       // 退房/离开 → 一并退出匹配队列
  if (!sess.room) return;
  const room = ROOMS.get(sess.room);
  sess.room = null;
  if (!room) return;
  const seat = seatOfPlayer(room, sess.id);
  if (!seat) return;
  const wasFight = seat.role === 'fight';
  const other = fighters(room).find((p) => p.id !== sess.id);
  seat.player = null;

  if (room.game && wasFight) {
    /* ★ 排位赛：掉线 / 主动退出 = 判负（对手 +1，退出者 -1）。
     *   必须在 room.game = null 之前结算 —— 否则拿不到 A/B 和双方分数。
     *   退出者的座位在上面已经被清空，所以把他的会话（sess）作为兜底传给 settleRanked，
     *   这样"自己主动退出"时（连接还在）他也能立刻收到 -1 并更新本地存档。
     *   掉线走的是同一条路径：conn.onClose → 宽限期到 → leaveRoom(sess, true)。 */
    if (room.mode === 'ranked') {
      const st = room.game.engine && room.game.engine.state;
      const loserKey = room.game.A === sess.id ? 'A' : (room.game.B === sess.id ? 'B' : null);
      if (loserKey && st && !st.winner) {
        settleRanked(room, loserKey === 'A' ? 'B' : 'A', sess);
        logLine('ranked', '排位判负 ' + room.code + '：' + sess.id.slice(0, 6) + (silentQuit ? ' 掉线' : ' 主动退出'));
      }
      clearRankTimer(room);
      room.game = null;
      room.series = null;
      room.ended = true;
      room.status = 'waiting';
      room.seats.forEach((s) => {
        if (s.player) {
          send(s.player.sess, { t: 'battle-end', reason: '对手已离开，本局判负' });
          s.player.ready = false;
        }
      });
      // 排位房是一次性的：剩下的人请出去、房间直接销毁（不可复用、不可加入）
      room.seats.forEach((s) => {
        if (s.player) { s.player.sess.room = null; s.player = null; }
      });
      ROOMS.delete(room.code);
      return;
    }
    // 好友房：对局中离开 → 判负，对局作废，回到等待（多局制的系列也一并作废）
    clearRankTimer(room);
    room.game = null;
    room.series = null;
    room.ended = false;
    room.status = 'waiting';
    room.seats.forEach((s) => { if (s.player) s.player.ready = false; });
    if (other) sendMsg(other.sess, '对手已离开房间，本局作废');
    /* ★ 还要广播「对局作废」给房间里的每一个人（含观战者）。
     *   以前只给另一个对战者发了一句文字，观战者收不到任何消息，
     *   客户端就一直停在对局界面出不来（"一方放弃判负，观战人员卡在对局中"）。 */
    room.seats.forEach((s) => {
      if (s.player) send(s.player.sess, { t: 'battle-end', reason: '对手已离开，本局作废' });
    });
  }
  if (silentQuit && other) sendMsg(other.sess, '有玩家断线离开了房间');

  const left = room.seats.some((s) => s.player);
  if (!left) { clearRankTimer(room); ROOMS.delete(room.code); return; }
  // ---- 房主离开 → 自动转让 ----
  // seats 的顺序是"对战席 ×2 在前、观战席 ×2 在后"，所以 find 天然会把房主
  // 优先交给对战席上的人（只有对战席都空了才轮到观战者）。
  if (room.hostId === sess.id) {
    const np = room.seats.find((s) => s.player);
    room.hostId = np ? np.player.id : null;
    if (np) {
      logLine('room', '房主转让 ' + room.code + ' → ' + np.player.id.slice(0, 6) +
        '（' + (np.role === 'fight' ? '对战席' : '观战席') + '）');
      room.seats.forEach((s) => {
        if (s.player) sendMsg(s.player.sess, '房主已离开，房主转让给 ' + np.player.name);
      });
    }
  }
  broadcastRoom(room);
}

// 房主点「确认开始」→ 通知房间里所有人一起进入准备面板（准备动作在准备面板里做）
function doStart(sess, arg) {
  const room = ROOMS.get(sess.room);
  if (!room) return;
  if (room.hostId !== sess.id) { sendMsg(sess, '只有房主可以开始'); return; }
  room.series = newServerSeries(arg);        // 服务器建立多局制（比分 / 先手都由服务器定）
  room.ended = false;
  broadcastRoom(room);
  room.seats.forEach((s) => { if (s.player) send(s.player.sess, { t: 'stage', stage: 'prep' }); });
  logLine('game', '系列开始 ' + room.code + '：' + room.series.total + ' 局制（先胜 ' + room.series.need + ' 局）');
}

function setRule(sess, rule) {
  const room = ROOMS.get(sess.room);
  if (!room || room.hostId !== sess.id) return;
  if (['bo1', 'bo3', 'bo5'].indexOf(rule) < 0) return;
  room.rule = rule;
  broadcastRoom(room);
}

function setReady(sess, v) {
  const room = ROOMS.get(sess.room);
  if (!room) return;
  const seat = seatOfPlayer(room, sess.id);
  if (!seat || seat.role !== 'fight') return;
  seat.player.ready = v !== false;
  broadcastRoom(room);
}

function setDeck(sess, m) {
  const room = ROOMS.get(sess.room);
  if (!room) return;
  const seat = seatOfPlayer(room, sess.id);
  if (!seat) return;
  seat.player.deckName = String(m.deckName || '卡组').slice(0, 12);
  seat.player.deckIds = Array.isArray(m.deckIds) ? m.deckIds.slice(0, 40) : [];
  seat.player.ready = false;                       // 换卡组 → 重新准备
  sess.profile = Object.assign({}, sess.profile, { deckName: seat.player.deckName, deckIds: seat.player.deckIds.slice() });
  broadcastRoom(room);
}

/* 点席位（对战席 / 观战席）：
 *   · 目标席位空着 → 直接切过去
 *   · 目标席位有人   → 给对方发"交换申请"，对方同意才互换
 * 房主身份跟着人走（room.hostId 存的是会话 id，换席位不受影响）。 */
function doSwapRequest(sess, role, idx) {
  const room = ROOMS.get(sess.room);
  if (!room) return;
  if (role !== 'fight' && role !== 'watch') return;
  const mine = seatOfPlayer(room, sess.id);
  if (!mine) return;
  const pick = (idx != null && room.seats[idx] && room.seats[idx].role === role) ? room.seats[idx] : null;
  if (pick === mine || (mine.role === role && !pick)) { sendMsg(sess, '你已经坐在这个席位了'); return; }
  // 指定了具体席位（点哪格就坐哪格）：空着直接坐，有人就申请和"那个人"交换
  if (pick) {
    if (!pick.player) {
      pick.player = mine.player;
      mine.player = null;
      pick.player.ready = false;
      broadcastRoom(room);
      sendMsg(sess, '已切换到' + (role === 'fight' ? '对战席' : '观战席'));
      console.log('[room ' + room.code + '] ' + sess.id + ' 切换到 ' + role + '#' + idx);
      return;
    }
    room.swapReq = { from: sess.id, to: pick.player.id };
    send(pick.player.sess, { t: 'swap-req', from: mine.player.name, fromRole: mine.role, toRole: role });
    sendMsg(sess, '已向 ' + pick.player.name + ' 发送交换席位申请…');
    console.log('[room ' + room.code + '] ' + sess.id + ' 申请与 ' + pick.player.id + ' 交换席位');
    return;
  }
  // 没指定席位：优先坐空位（这一排还有空位就直接过去）；整排都满了才向其中一位发交换申请
  const free = room.seats.find((s) => s.role === role && !s.player);
  if (free) {
    free.player = mine.player;
    mine.player = null;
    free.player.ready = false;
    broadcastRoom(room);
    sendMsg(sess, '已切换到' + (role === 'fight' ? '对战席' : '观战席'));
    console.log('[room ' + room.code + '] ' + sess.id + ' 切换到 ' + role);
    return;
  }
  const occupied = room.seats.find((s) => s.role === role && s.player);
  if (!occupied) { sendMsg(sess, '该席位已满'); return; }
  room.swapReq = { from: sess.id, to: occupied.player.id };
  send(occupied.player.sess, {
    t: 'swap-req', from: mine.player.name, fromRole: mine.role, toRole: role
  });
  sendMsg(sess, '已向 ' + occupied.player.name + ' 发送交换席位申请…');
  console.log('[room ' + room.code + '] ' + sess.id + ' 申请与 ' + occupied.player.id + ' 交换席位');
}

function doSwapAnswer(sess, ok) {
  const room = ROOMS.get(sess.room);
  if (!room) return;
  const req = room.swapReq;
  if (!req || req.to !== sess.id) { sendMsg(sess, '没有待处理的交换申请'); return; }
  room.swapReq = null;
  const a = seatOfPlayer(room, req.from);
  const b = seatOfPlayer(room, req.to);
  if (!ok) {
    if (a && a.player) sendMsg(a.player.sess, '对方拒绝了交换席位的申请');
    console.log('[room ' + room.code + '] 交换席位申请被拒绝');
    return;
  }
  if (!a || !b || !a.player || !b.player) { sendMsg(sess, '对方已不在房间'); return; }
  const pa = a.player, pb = b.player;
  a.player = pb; b.player = pa;
  pa.ready = false; pb.ready = false;
  broadcastRoom(room);
  sendMsg(pa.sess, '已与 ' + pb.name + ' 交换席位');
  sendMsg(pb.sess, '已与 ' + pa.name + ' 交换席位');
  console.log('[room ' + room.code + '] ' + pa.id + ' 与 ' + pb.id + ' 交换席位成功');
}

function beginBattle(sess, m) {
  const room = ROOMS.get(sess.room);
  if (!room) return;
  // 只要双方都准备好，房间内任意玩家都能开始。
  // （房主可能已经切到观战席，这时由对战席玩家来按「开始本局」）
  if (!seatOfPlayer(room, sess.id)) { sendMsg(sess, '你不在这个房间里'); return; }
  const fs2 = room.seats.filter((s) => s.role === 'fight' && s.player);
  if (fs2.length !== 2) { sendMsg(sess, '需要两名对战玩家（房主 + 一名对手）'); return; }
  if (!fs2.every((s) => s.player.ready)) { sendMsg(sess, '双方都点「准备」后才能开始'); return; }
  if (!fs2[0].player.deckIds.length || !fs2[1].player.deckIds.length) { sendMsg(sess, '有玩家的卡组是空的'); return; }

  const A = fs2[0].player, B = fs2[1].player;
  const ctx = createSandbox();
  const eng = ctx.Engine;
  eng.newGame({
    playerDeck: A.deckIds.slice(), aiDeck: B.deckIds.slice(),
    playerName: A.name, aiName: B.name,
    playerHp: 40, playerMax: 40, aiHp: 40,
    // 先手以服务器的 series 为准（客户端传的 first 只在自己单机时用得上）
    first: room.series ? (room.series.firsts[room.series.round] || 'A') : ((m && m.first === 'B') ? 'B' : 'A'),
    seed: Number(m && m.seed) || (Date.now() >>> 0),
    mode: 'battle', tutorial: false
  });
  // 双方都是真人 → 关掉引擎里的 AI 自动决策，否则弹窗会被自动选掉
  eng.state.players.A.isAI = false;
  eng.state.players.B.isAI = false;
  eng.state.ach.off = true;                      // 联机对局不计入单机成就

  room.round++;
  room.game = { ctx, engine: eng, A: A.id, B: B.id };
  room.status = 'playing';
  /* ⚠ 必须复位"本局是否已结算"这个闸门。
   * sendState 里用 `if (st.winner && !room.ended)` 保证一局只记一次分，
   * 但 ended 只在「系列开始 doStart」和「有人离开 leave」时被清 ——
   * 新一局开始时不清的话：第 2 局打完 ended 还是 true → 不记分 → 比分卡在第 1 分，
   * 五局三胜永远停在 0:1。（每局都要重新开一次，所以复位点必须在这里。） */
  room.ended = false;
  fs2.forEach((s) => { s.player.ready = false; });   // 多局制：下一局要重新准备
  broadcastRoom(room);
  STATS.games++;
  logLine('game', '开局 ' + room.code + '：' + A.name + ' vs ' + B.name + '（先手 ' + ((m && m.first === 'B') ? 'B' : 'A') + '）');
  // 注意：这里**不要**发 {t:'start'} —— 客户端把 'start' 当成"进入准备面板"，
  // 发了会让界面闪回准备面板，还会把多局制的 series（比分）重置掉。切到对战界面靠下面的 battle 状态。
  sendState(room, true);
  console.log('[room ' + room.code + '] 开局：' + A.name + ' vs ' + B.name + '（先手 ' + eng.state.active + '）');
}

/* 视角还原：下发状态给 B 方前会整体翻一次（客户端里"自己永远显示为 A"），
 * 所以 B 发上来的阵营字段是**他自己视角**的（他的"对手"标成 'B'）。
 * 执行前必须换回服务器视角，否则 B 攻击对家会被判成"攻击自己 → 目标不合法"。
 * 只翻转取值恰好为 'A' / 'B' 的字段（卡 id 是小写字母，不会误伤）。 */
function flipSides(o) {
  if (o === 'A') return 'B';
  if (o === 'B') return 'A';
  if (!o || typeof o !== 'object') return o;
  const out = {};
  Object.keys(o).forEach((k) => {
    const v = o[k];
    out[k] = (v === 'A') ? 'B' : (v === 'B' ? 'A' : v);
  });
  return out;
}

function doAct(sess, a) {
  const room = ROOMS.get(sess.room);
  const g = room && room.game;
  if (!g) { sendMsg(sess, '当前不在对局中'); return; }
  const myKey = g.A === sess.id ? 'A' : (g.B === sess.id ? 'B' : null);
  if (!myKey) { STATS.denied++; sendMsg(sess, '你是观战者，不能操作'); return; }
  const st = g.engine.state;
  STATS.acts++;
  if (st.winner) { STATS.denied++; sendMsg(sess, '对局已结束'); return; }
  if (st.active !== myKey) { STATS.denied++; sendMsg(sess, '还没轮到你'); return; }
  if (st.pending) { STATS.denied++; sendMsg(sess, '请先处理弹出的选择'); return; }
  const act = Object.assign({}, a);
  delete act._ai;                                 // 服务器是权威，不需要 AI 标记
  const r = g.engine.tryAction(myKey === 'B' ? flipSides(act) : act);
  if (!r || !r.ok) { sendMsg(sess, '操作无效：' + ((r && (r.msg || r.reason)) || '未知原因')); return; }
  sendState(room, false);
}

function doPrompt(sess, v) {
  const room = ROOMS.get(sess.room);
  const g = room && room.game;
  if (!g) return;
  const st = g.engine.state;
  if (!st.pending) return;
  const myKey = g.A === sess.id ? 'A' : (g.B === sess.id ? 'B' : null);
  if (st.pending.actorKey !== myKey) { sendMsg(sess, '现在不是在等你做选择'); return; }
  g.engine.resolvePrompt(myKey === 'B' ? flipSides(v) : v);
  sendState(room, false);
}

/* ---------------- 6. 启动 ---------------- */
server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => { });
  const u = (req.url || '').split('?')[0];
  if (u !== '/ws') { socket.destroy(); return; }
  const conn = upgrade(req, socket);
  if (conn) onConn(conn);
});

// 心跳：30 秒没有响应就断开（浏览器也会自己发应用层 ping）
setInterval(() => {
  CONNS.forEach((sess) => {
    const c = sess.conn;
    if (!c.isAlive) { c.close(1001, 'timeout'); return; }
    c.isAlive = false;
    c.ping();
  });
}, 30000);

function lanIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach((k) => {
    (ifs[k] || []).forEach((a) => { if (a.family === 'IPv4' && !a.internal) out.push(a.address); });
  });
  return out;
}

server.listen(PORT, HOST, () => {
  console.log('');
  // 未捕获异常也落日志（否则服务半夜挂掉只剩一句控制台报错）
  process.on('uncaughtException', (e) => { STATS.errors++; logLine('error', '未捕获异常：' + ((e && e.stack) || e)); });
  process.on('unhandledRejection', (e) => { STATS.errors++; logLine('error', '未处理的 Promise 拒绝：' + ((e && e.stack) || e)); });

  logLine('boot', '服务启动 | 端口 ' + PORT + ' | 房间上限 ' + MAX_ROOMS + ' | 限流 ' + MSG_RATE + '/s 桶 ' + MSG_BURST + ' | 日志 ' + (LOG_TO_FILE ? LOG_DIR : '仅控制台'));
  console.log('  ===== 地牢决斗师 · 联机服务端已启动 =====');
  console.log('  本机自测：  http://localhost:' + PORT + '/   （只有这台服务器自己打开时才用它）');
  lanIPs().forEach((ip) => console.log('  局域网访问：http://' + ip + ':' + PORT + '/  （同一 WiFi 下的朋友用这个）'));
  console.log('  公网访问：  http://<这台服务器的公网IP>:' + PORT + '/   ← 把这个地址发给朋友');
  console.log('');
  console.log('  ★ 重要：让朋友【直接用上面这个 IP:端口 打开页面】。');
  console.log('     页面里的联机地址是自动取的 —— 用 IP:端口 打开就连 ws://IP:端口/ws；');
  console.log('     如果用别的域名打开，它就会去连那个域名的 /ws，而那条路必须由域名');
  console.log('     反向代理把 /ws 转发到本端口，没配就会一直显示"连接服务器失败"。');
  console.log('  ★ 服务端本身不需要配置任何"服务器地址"，只监听端口。');
  console.log('  停止服务：  Ctrl + C');
  console.log('');
});
