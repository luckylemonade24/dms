/* ============================================================
 * 学院考核 · 模式引擎  academy.js
 *  8 人（玩家 + 7 AI）同台，全员从 0 张卡、0 级起步，靠学时经营：
 *    商店购卡（同名同星 3 张自动合成高一星：2★ 数值 ×2，3★ ×3）
 *    → 双方 AI 自动对战（回合上限 4/6/8/10/12）→ 比「造成的总伤害」，
 *      输出低者按差额扣 100 点生命（打脸伤害 ×2 计），归零淘汰 → 最后存活者为第一。
 *  状态经 SaveData.setAcademy 持久化；完赛写入历届考核排名。
 * ========================================================== */
var Academy = (function () {
  'use strict';

  var C = ACADEMY_CONF;
  var D = ACADEMY_DATA;
  var PLAYER = 0;
  var st = null;

  /* ---------------- 存档 ---------------- */
  function save() { if (st) SaveData.setAcademy(st); }
  // 方案 A：只有怪物卡参与升星 —— 旧存档里带星的非怪物卡（武器/防具/道具等）一律归回 1★
  function normalizeStars() {
    if (!st || !st.ents) return false;
    var changed = false;
    st.ents.forEach(function (E) {
      ['deck', 'bag'].forEach(function (zone) {
        (E[zone] || []).forEach(function (e) {
          if (e && typeof e === 'object' && D.starOf(e) > 1 && !D.isMonster(D.idOf(e))) { e.star = 1; changed = true; }
        });
      });
    });
    return changed;
  }
  function load() {
    st = SaveData.getAcademy();
    if (normalizeStars()) save();
    return st;
  }
  function get() { return st; }
  function hasActive() { return !!st && st.stage !== 'done'; }
  function addLog(text) { if (!st) return; st.log = st.log || []; st.log.push(text); if (st.log.length > 300) st.log.shift(); }
  function ent(id) { return st.ents[id]; }
  function alive() { return st.ents.filter(function (E) { return E.alive; }); }
  function me() { return ent(PLAYER); }
  function rngOf() { var a = Array.prototype.slice.call(arguments); return makeRng(hashSeed.apply(null, a)); }
  function idsOf(deck) { return deck.map(function (e) { return D.idOf(e); }); }

  /* ---------------- 开始一届考核 ---------------- */
  function startRun(seed) {
    var sd = ((seed != null ? seed : randomSeed()) >>> 0);
    var rng = makeRng(sd);
    var names = TOUR_DATA.AI_NAMES.slice();
    for (var i = names.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = names[i]; names[i] = names[j]; names[j] = t; }
    var archs = TOUR_DATA.ARCHETYPES.map(function (_, k) { return k; });
    for (var k = archs.length - 1; k > 0; k--) { var j2 = Math.floor(rng() * (k + 1)); var t2 = archs[k]; archs[k] = archs[j2]; archs[j2] = t2; }

    if (typeof Achievements !== 'undefined') Achievements.onEnterMode('academy');   // 成就「学院新生」
    var ents = [];
    ents.push({
      id: PLAYER,
      name: (typeof SaveData !== 'undefined' && SaveData.getPlayerName ? SaveData.getPlayerName() : '你'),
      isPlayer: true, arch: -1, hp: C.START_HP, lv: 0, exp: 0, xue: 0,
      perks: [], perkPick: null, perkSeq: 0, _pm: null,     // 特技：已拥有 / 待选（玩家）/ 抽取序号 / mod 缓存
      deck: [], bag: [], alive: true, wins: 0, losses: 0, total: 0, lastOpp: null, rank: 0
    });
    for (var n = 0; n < C.PLAYERS - 1; n++) {
      var arch = archs[n % archs.length];
      ents.push({
        id: 1 + n, name: names[n], isPlayer: false, arch: arch, hp: C.START_HP, lv: 0, exp: 0, xue: 0,
        perks: [], perkPick: null, perkSeq: 0, _pm: null,
        deck: [], bag: [], alive: true, wins: 0, losses: 0, total: 0, lastOpp: null, rank: 0
      });
    }
    st = {
      no: SaveData.getAcademyHistory().length + 1, seed: sd, round: 0, ents: ents,
      pairs: [], bye: null, shop: null, log: [], stage: 'prep', result: null, lastBattle: null
    };
    addLog('第 ' + st.no + ' 届『' + C.NAME + '』开始：8 位考生各持 ' + C.START_HP + ' 点生命、0 张卡登场（一切从商店买起）。');
    beginRound();
    save();
    return st;
  }

  /* ---------------- 特技（升级三选一） ----------------
   * 每次升级都从特技库随机抽 3 个（互不重复、排除已拥有）：
   *   · 玩家 → 存进 E.perkPick 队列，由学院界面弹出三选一（一次升多级就连续弹）
   *   · AI   → 立刻按 PERK_DATA.aiPick 自动选一个
   * 效果分两层落地：经济/升星/道具类在学院层（本文件 + academy_data.js），
   * 战斗/种族类在 newBattleState 里打包成 perkMods 交给引擎。 */
  function perkMods(E) {
    if (!E) return {};
    if (!E._pm) E._pm = (typeof PERK_DATA !== 'undefined') ? PERK_DATA.modsOf(E.perks || []) : {};
    return E._pm;
  }
  function perkMod(E, k, dflt) { var v = perkMods(E)[k]; return (v == null ? (dflt == null ? 0 : dflt) : v); }
  // 背包上限（含特技 bagAdd）
  function bagCapOf(E) { return C.BAG_CAP + perkMod(E, 'bagAdd'); }
  // 买卡价格（含特技 priceMul 折扣；至少 1 学时）
  function priceFor(E, id) { return Math.max(1, Math.ceil(D.priceOf(id) * perkMod(E, 'priceMul', 1))); }
  function grantPerk(E) {
    if (typeof PERK_DATA === 'undefined') return null;
    var choices = PERK_DATA.roll(E.lv, rngOf(st.seed, st.round, E.id, 'perk' + (E.perkSeq++)), E.perks || [], 3);
    if (!choices.length) return null;
    var ids = choices.map(function (p) { return p.id; });
    if (E.isPlayer) {
      if (!E.perkPick) E.perkPick = [];
      E.perkPick.push(ids);
      save();
    } else {
      var pick = PERK_DATA.aiPick(choices, rngOf(st.seed, st.round, E.id, 'perkPick' + E.perkSeq));
      if (pick) { E.perks.push(pick.id); E._pm = null; applyInstantPerk(E, pick.id); }
    }
    return ids;
  }
  /* 玩家选特技（学院界面调用）。idx 是当前这批候选里的下标。 */
  function pickPerk(idx) {
    var E = me();
    if (!E.perkPick || !E.perkPick.length) return { ok: false, msg: '没有待选特技' };
    var ids = E.perkPick[0];
    if (!(idx >= 0 && idx < ids.length)) return { ok: false, msg: '无效选择' };
    var p = (typeof PERK_DATA !== 'undefined') ? PERK_DATA.byId[ids[idx]] : null;
    E.perks.push(ids[idx]);
    E.perkPick.shift();
    E._pm = null;
    addLog('你获得了特技【' + ((p && p.name) || ids[idx]) + '】');
    applyInstantPerk(E, ids[idx]);
    save();
    return { ok: true, perk: ids[idx] };
  }
  /* 特技【道具类】的"每轮免费获得"：随机一张对应类别的卡，直接进背包（不花学时）。
   * kind: 'item' 任意道具 / 'potion' 药水 / 'monster' C 级怪（合星材料）。 */
  function grantFree(E, kind) {
    var pool = null;
    if (kind === 'monster') pool = D.poolOf('C');
    else if (kind === 'potion') pool = D.poolOf('potion');
    else {
      pool = [];
      ['equip', 'food', 'throw', 'wand', 'scroll'].forEach(function (k) {
        pool = pool.concat(D.poolOf(k));
      });
    }
    if (!pool || !pool.length) return null;
    E.freeSeq = (E.freeSeq || 0) + 1;
    var rng = rngOf(st.seed, st.round, E.id, 'free' + kind + E.freeSeq);
    var made = D.mk(pool[Math.floor(rng() * pool.length)], 1);
    if ((E.bag || []).length < bagCapOf(E)) E.bag.push(made);
    else if (E.deck.length < D.deckCap(E.lv)) E.deck.push(made);
    else return null;
    tryMerge(E);
    return D.idOf(made);
  }
  /* 拿到特技时的"一次性"效果（xueStart 立刻给学时 / startMonStar2 立刻升星）。
   * 注意：这两条不能做成"开局生效"—— 特技是升级才拿到的，开局时手上还没卡也没钱。 */
  function applyInstantPerk(E, id) {
    var p = (typeof PERK_DATA !== 'undefined') ? PERK_DATA.byId[id] : null;
    if (!p || !p.mod) return;
    if (p.mod.xueStart) {
      E.xue += p.mod.xueStart;
      addLog('特技【' + p.name + '】立即获得 ' + p.mod.xueStart + ' 学时');
    }
    if (p.mod.startMonStar2) {
      var n = 0;
      ['deck', 'bag'].forEach(function (zone) {
        var arr = E[zone] || [];
        arr.forEach(function (e, i) {
          if (D.isMonster(D.idOf(e)) && D.starOf(e) < 2) { arr[i] = D.mk(D.idOf(e), 2); n++; }
        });
      });
      tryMerge(E);
      if (n) addLog('特技【' + p.name + '】把 ' + n + ' 张怪物提升为 2★（最高 3★ 依旧要自己合）');
    }
  }

  /* ---------------- 回合流程 ---------------- */
  function beginRound() {
    st.round += 1;
    st.stage = 'prep';
    st.lastBattle = null;
    // 学时收入：基础 + 特技【经济类】的每轮加成
    st.ents.forEach(function (E) { if (E.alive) E.xue += D.xuePerRound(E.lv) + perkMod(E, 'xueAdd'); });
    // 特技【道具类】：每轮免费获得若干道具 / 药水 / 1★ 怪物（不花学时，直接进背包）
    st.ents.forEach(function (E) {
      if (!E.alive) return;
      var fi = perkMod(E, 'freeItem'), fp = perkMod(E, 'freePotion'), fm = perkMod(E, 'freeMonPerRound');
      for (var i = 0; i < fi; i++) grantFree(E, 'item');
      for (var i2 = 0; i2 < fp; i2++) grantFree(E, 'potion');
      for (var i3 = 0; i3 < fm; i3++) grantFree(E, 'monster');
    });
    var oldSlots = (st.shop && st.shop.slots) ? st.shop.slots : null;
    st.shop = {
      slots: [], rolls: (st.shop ? st.shop.rolls : 0), paid: 0,
      freeLeft: C.FREE_REFRESH + perkMod(me(), 'freeRefresh')      // 特技【道具类】：免费刷新 +N
    };
    rollShop(oldSlots);        // 锁定的商品会保留到下一轮
    pairUp();
    st.ents.forEach(function (E) { if (E.alive && !E.isPlayer) aiEconomy(E); });
    var opp = oppOf(PLAYER);
    addLog('第 ' + st.round + ' 轮开始：战斗回合上限 ' + D.roundLimit(st.round) +
      (opp ? '；你的对手：' + opp.name : '；本轮轮空'));
    save();
  }

  function pairUp() {
    var ids = alive().map(function (E) { return E.id; });
    var best = null;
    for (var attempt = 0; attempt < 16; attempt++) {
      var rng = rngOf(st.seed, st.round, 'pair', attempt);
      var sh = ids.slice();
      for (var i = sh.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = sh[i]; sh[i] = sh[j]; sh[j] = t; }
      var pairs = [], rematch = 0;
      for (var k = 0; k + 1 < sh.length; k += 2) {
        pairs.push([sh[k], sh[k + 1]]);
        if (isRematch(sh[k], sh[k + 1])) rematch++;
      }
      if (!best || rematch < best.rematch) best = { pairs: pairs, rematch: rematch, bye: (sh.length % 2 ? sh[sh.length - 1] : null) };
      if (rematch === 0) break;
    }
    st.pairs = best.pairs;
    st.bye = best.bye;
    if (st.bye != null) { var B = ent(st.bye); B.xue += C.BYE_XUE; }
  }
  function isRematch(a, b) { return ent(a).lastOpp === b || ent(b).lastOpp === a; }
  function oppOf(id) {
    for (var i = 0; i < st.pairs.length; i++) {
      var p = st.pairs[i];
      if (p[0] === id) return ent(p[1]);
      if (p[1] === id) return ent(p[0]);
    }
    return null;
  }
  function pairOf(id) {
    for (var i = 0; i < st.pairs.length; i++) { var p = st.pairs[i]; if (p[0] === id || p[1] === id) return p; }
    return null;
  }

  /* ---------------- 商店 ---------------- */
  // prevSlots：传入上一轮/刷新前的商品数组时，其中被锁定的商品原样保留
  function rollShop(prevSlots) {
    var E = me();
    var prev = prevSlots || null;
    var rng = rngOf(st.seed, st.round, st.shop.rolls, 'shop');
    var pm = perkMods(E);
    // 特技【道具类】slotsAdd：商品位 +N。
    // ⚠ 这里曾经硬编码 C.SHOP_SLOTS —— 玩家侧的「免费刷新 +商品位」「万能商店」两个
    //   特技商品位部分因此完全没生效（AI 侧的 rollPoolFor 早就有 +slotsAdd，两边不一致）。
    var slotN = C.SHOP_SLOTS + ((pm && pm.slotsAdd) || 0);
    var slots = [];
    for (var i = 0; i < slotN; i++) {
      if (prev && prev[i] && prev[i].locked) { slots.push(prev[i]); continue; }   // 锁定：保留原商品
      var id = D.rollCard(E.lv, rng);
      // 特技【升星类】ownMonWeight：刷到怪物时按权重换成"你已经拥有的同名怪"。
      // ⚠ 同一个坑：以前只有 AI 的 rollPoolFor 调了 perkBiasCard，玩家商店没调 →
      //   玩家拿升星类特技（熟门熟路 / 成套采购 / 定向寻购 / 量产线 / 星辰加冕）
      //   在商店里完全看不到任何变化（star-1 更是因此整条白给）。
      //   perkBiasCard 在 w<=1 时提前返回、不消耗 rng，所以没这条特技的玩家分布不变。
      if (id) id = perkBiasCard(E, id, pm, rng);
      slots.push(id ? { cardId: id, price: priceFor(me(), id), bought: false, locked: false } : null);
    }
    st.shop.slots = slots;
    st.shop.rolls += 1;
  }
  // 锁定 / 解锁某格商品
  function toggleLock(idx) {
    var s = st.shop && st.shop.slots[idx];
    if (!s) return { ok: false, msg: '该格为空' };
    s.locked = !s.locked;
    save();
    return { ok: true, locked: !!s.locked, cardId: s.cardId };
  }
  // 统一锁定 / 解锁整排商品（只要有任意一格已锁定 → 全部解锁，否则全部锁定）
  function toggleLockAll() {
    var slots = st.shop ? st.shop.slots : [];
    var any = slots.some(function (s) { return s && s.locked; });
    slots.forEach(function (s) { if (s) s.locked = !any; });
    save();
    return { ok: true, locked: !any };
  }
  // 付费刷新价格阶梯：前 3 次 1 学时，之后每 2 次 +1
  function nextRefreshCost() { return D.refreshCost((st.shop.paid || 0) + 1); }
  function refreshShop() {
    var E = me();
    if (st.shop.freeLeft > 0) { st.shop.freeLeft -= 1; rollShop(st.shop.slots); save(); return { ok: true, free: true }; }
    var cost = nextRefreshCost();
    if (E.xue < cost) return { ok: false, msg: '学时不足（需 ' + cost + '）' };
    E.xue -= cost;
    st.shop.paid = (st.shop.paid || 0) + 1;
    rollShop(st.shop.slots); save();      // 锁定的商品不参与刷新
    return { ok: true, free: false, cost: cost };
  }
  function buySlot(idx) {
    var s = st.shop.slots[idx];
    if (!s || s.bought) return { ok: false, msg: '该格已售出' };
    if (s.locked && C.LOCK_BLOCKS_BUY) return { ok: false, msg: '该商品已锁定：保留到下轮，解锁后才能购买' };
    var E = me();
    if (E.xue < s.price) return { ok: false, msg: '学时不足（需 ' + s.price + '）' };
    // 两种失败要分清：① 这张卡本身到数量上限 ② 卡组/背包都放不下（原来都提示"满了"，容易误解）
    if (!canAdd(E, s.cardId)) return { ok: false, msg: '该卡已抵达上限（最多 ' + CARDS[s.cardId].maxCopies + ' 张）' };
    var where = placeCard(E, s.cardId);
    if (!where) return { ok: false, msg: '卡组与背包都满了（先出售或升级）' };
    E.xue -= s.price;
    s.bought = true;
    addLog('你购买了【' + CARDS[s.cardId].name + '】(' + s.price + ' 学时) → ' + (where === 'deck' ? '卡组' : '背包'));
    save();
    return { ok: true, where: where, cardId: s.cardId };
  }

  /* ---------------- 卡组 / 背包 / 升星 ---------------- */
  // 同名卡占有量：按「卡位」计（升星会占掉 3 个卡位再并成 1 个，不会被 maxCopies 卡死）
  function countOwned(E, cardId) {
    var n = 0;
    E.deck.concat(E.bag).forEach(function (e) { if (D.idOf(e) === cardId) n += 1; });
    return n;
  }
  // 能否再收一张：普通卡受 maxCopies 约束；【怪物卡】在考核模式不受此限。
  //   ⚠ 必须放开怪物卡上限：合星要按 2^星 张同名卡（凑满 2 单位→2★、4 单位→3★）来堆，
  //     而 maxCopies 是给「20 张卡组」定的（C6/B4/A3/S2）——A 级只准 3 张、S 级只准 2 张，
  //     永远凑不满 4 单位，合星链被硬卡在 2★ 上不去，还会连带把"买新卡"一起挡掉。
  //     放开后由卡组容量（deckCap）/ 背包容量（bagCap）兜底，不会无限膨胀。
  function canAdd(E, cardId) {
    if (!CARDS[cardId]) return false;
    if (D.isMonster(cardId)) return true;
    return countOwned(E, cardId) < CARDS[cardId].maxCopies;
  }
  // preferBag：卡组怪物偏多时，优先把卡放进背包（背包里的同名卡仍可与卡组合成升星）
  function placeCard(E, cardId, preferBag) {
    if (!canAdd(E, cardId)) return null;
    var where = null;
    if (!preferBag && E.deck.length < D.deckCap(E.lv)) { E.deck.push(D.mk(cardId, 1)); where = 'deck'; }
    else if (preferBag && E.bag.length < bagCapOf(E)) { E.bag.push(D.mk(cardId, 1)); where = 'bag'; }
    else if (E.deck.length < D.deckCap(E.lv)) { E.deck.push(D.mk(cardId, 1)); where = 'deck'; }
    else if (E.bag.length < bagCapOf(E)) { E.bag.push(D.mk(cardId, 1)); where = 'bag'; }
    else return null;
    tryMerge(E);
    return where;
  }
  // 同名同星 STAR_MERGE 张 → 1 张高一星（可连锁）；卡组与背包一起统计，可跨区合成
  function tryMerge(E) {
    var merged = 0, guard = 0;
    while (guard++ < 16) {
      var did = false;
      for (var star = 1; star < C.STAR_MAX && !did; star++) {
        var groups = {};
        ['deck', 'bag'].forEach(function (zone) {
          E[zone].forEach(function (e, i) {
            if (D.starOf(e) === star) (groups[D.idOf(e)] = groups[D.idOf(e)] || []).push({ z: zone, i: i });
          });
        });
        for (var id in groups) {
          if (!D.isMonster(id)) continue;                       // 方案 A：升星只对怪物卡生效
          if (groups[id].length >= C.STAR_MERGE) {
            groups[id].slice(0, C.STAR_MERGE).sort(function (a, b) { return b.i - a.i; })
              .forEach(function (p) { E[p.z].splice(p.i, 1); });          // 每个区各自按下标从大到小删，避免位移
            var nStar = star + 1;
            // ★ 觉醒词条就在"合成出 3★"的这一刻抽定，写在这张卡的实例上。
            //   之后无论召唤 / 回手 / 复活 / 镜像复制，都沿用这一个 —— 不会再变。
            //   （rand 用学院的可复现 rng：同一届同一轮结果一致，方便回放与测试）
            var aw = null;
            if (nStar >= D.awakenStar()) {
              var awSeq = st ? (st.awSeed = (st.awSeed || 0) + 1) : 1;
              aw = D.rollAwaken(rngOf(st ? st.seed : 0, awSeq, 'aw'));
            }
            var made = D.mk(id, nStar, aw);
            if (E.deck.length < D.deckCap(E.lv)) E.deck.push(made);
            else E.bag.push(made);
            merged++; did = true;
            if (E.isPlayer) {
              var awName = (aw && typeof awakenInfo === 'function' && awakenInfo(aw)) ? awakenInfo(aw).name : aw;
              addLog('升星：【' + CARDS[id].name + '】' + C.STAR_MERGE + ' 张 ' + star + '★ 合成 1 张 ' + nStar + '★' +
                (awName ? '　觉醒 · ' + awName : ''));
            }
            break;
          }
        }
      }
      if (!did) break;
    }
    // 卡组超上限（升星会腾出空间；保险）→ 移入背包或出售
    while (E.deck.length > D.deckCap(E.lv)) {
      var idx = weakestIdx(E);
      if (idx < 0) break;
      var card = E.deck.splice(idx, 1)[0];
      if (E.bag.length < bagCapOf(E)) E.bag.push(card);
      else E.xue += D.sellOf(card);
    }
    return merged;
  }
  function weakestIdx(E) {
    var arr = E.deck, best = -1, bs = Infinity;
    arr.forEach(function (e, i) {
      var s = keepValue(E, e);                                  // 星级越高越不该卖（合星门票同样受保护）
      if (s < bs) { bs = s; best = i; }
    });
    return best;
  }

  /* ---------------- AI 学生：后期清仓（卖弱卡） ---------------- */
  // 「这张卡留在卡组里值多少」——卖卡专用评分，与 aiScore（买卡评分）彻底分开。
  // aiScore 里含"构成增量"项（怪物过多时给怪物 -14 等），那是"还要不要再买一张"的信号，
  // 不是"这张卡值不值钱"——拿它当留存价值会把 2★ 怪判成最弱（实测卖掉 1100+ 张 2★ 怪，正好卖反了）。
  // 故这里直接按"实战价值"算：
  function keepValue(E, e) {
    var id = D.idOf(e), c = CARDS[id], star = D.starOf(e);
    if (D.isMonster(id)) {
      var v = ((c.atk || 0) * 2 + (c.hp || 0)) * star;                 // 实战数值（2★ ×2、3★ ×3）
      v += ({ S: 12, A: 8, B: 4, C: 0 }[c.tier] || 0);                 // 档次加成
      if (star === 1) {                                                // 手里唯一的 1★ 同名卡 = 合星门票，别卖
        var same1 = E.deck.concat(E.bag || []).filter(function (x) { return D.idOf(x) === id && D.starOf(x) === 1; }).length;
        if (same1 <= 1) v += 14;
        // S/A 的 1★ 更是升星门票（少卡高星路线的核心目标），绝不能当废牌卖掉
        if (c.tier === 'S' || c.tier === 'A') v += 16;
      }
      if (D.isHighAtk(id)) v += 4;                                     // 高攻怪：前期节奏全靠它
      return v;
    }
    var u = 6;                                                         // 非怪物：底价
    if (D.isDraw(id)) u += 10;                                         // 过牌：小卡组收益极高
    if (D.isRemoval(id)) u += 7;                                       // 解场
    if (c.type === 'weapon' || c.type === 'armor') u += 6;             // 装备：能给怪加数值，别当废牌卖
    if (c.type === 'food' || c.type === 'potion') u += 1;
    return u;
  }
  function scoreOfEntry(E, e) { return keepValue(E, e); }
  // 弱卡判据：明显低于"卡组均分"，且低于绝对上限（均分虚高时也不误伤好卡）
  function isWeakCard(E, sc) {
    var arr = E.deck.concat(E.bag || []);
    if (!arr.length) return false;
    var sum = 0;
    arr.forEach(function (e) { sum += scoreOfEntry(E, e); });
    return sc < (sum / arr.length) * C.AI.SELL_RATIO && sc < C.AI.SELL_ABS_MAX;
  }
  function weakestBagIdx(E) {
    var bi = -1, bs = Infinity;
    (E.bag || []).forEach(function (e, i) { var s = scoreOfEntry(E, e); if (s < bs) { bs = s; bi = i; } });
    return bi;
  }
  // 卖掉这张后怪物占比是否还站得住（低于"下限 -0.1"就不卖；且至少留 1 只怪）
  function sellKeepsComp(E, idx) {
    var e = E.deck[idx];
    if (!e || !D.isMonster(D.idOf(e))) return true;               // 卖道具/装备不影响怪物占比
    var mon = E.deck.filter(function (x) { return D.isMonster(D.idOf(x)); }).length;
    if (mon <= 1 || E.deck.length <= 1) return false;
    return (mon - 1) / (E.deck.length - 1) >= C.AI.MON_RATIO[0] - 0.1;
  }
  // 后期主动清仓：先卖背包（不参与对战，纯赚学时）→ 再卖卡组（保底张数 + 不破坏构成）
  // 卖出的学时紧接着用于本轮采购；腾出的卡组位会在下一步 3) 由背包里的好卡补上
  function sellWeakCards(E) {
    var sold = 0, cfg = C.AI;
    while (sold < cfg.SELL_PER_ROUND && (E.bag || []).length) {
      var bi = weakestBagIdx(E);
      if (bi < 0 || !isWeakCard(E, scoreOfEntry(E, E.bag[bi]))) break;
      E.xue += D.sellOf(E.bag.splice(bi, 1)[0]);
      sold++;
    }
    if (!cfg.SELL_FROM_DECK) return sold;      // 默认只清背包：卖卡组里的牌实测是净亏（见配置注释）
    var keepN = Math.max(cfg.SELL_KEEP_MIN, Math.ceil(D.deckCap(E.lv) * cfg.SELL_KEEP_RATIO));
    while (sold < cfg.SELL_PER_ROUND && E.deck.length > keepN) {
      var di = weakestIdx(E);
      if (di < 0) break;
      if (!isWeakCard(E, scoreOfEntry(E, E.deck[di]))) break;
      if (!sellKeepsComp(E, di)) break;
      E.xue += D.sellOf(E.deck.splice(di, 1)[0]);
      sold++;
    }
    return sold;
  }
  function moveCard(fromZone, idx, toZone) {
    var E = me();
    var src = fromZone === 'deck' ? E.deck : E.bag, dst = toZone === 'deck' ? E.deck : E.bag;
    if (idx < 0 || idx >= src.length) return { ok: false, msg: '卡牌不存在' };
    if (src === dst) return { ok: false, msg: '位置未变化' };
    if (toZone === 'deck' && E.deck.length >= D.deckCap(E.lv)) return { ok: false, msg: '卡组已满（等级上限 ' + D.deckCap(E.lv) + ' 张）' };
    if (toZone === 'bag' && E.bag.length >= bagCapOf(E)) return { ok: false, msg: '背包已满（' + bagCapOf(E) + ' 张）' };
    var card = src.splice(idx, 1)[0];
    dst.push(card);
    tryMerge(E);
    save();
    return { ok: true };
  }
  function sellCard(zone, idx) {
    var E = me();
    var arr = zone === 'deck' ? E.deck : E.bag;
    if (idx < 0 || idx >= arr.length) return { ok: false, msg: '卡牌不存在' };
    if (zone === 'deck' && E.deck.length <= 1) return { ok: false, msg: '卡组至少要留 1 张' };
    var card = arr.splice(idx, 1)[0];
    var gold = D.sellOf(card);
    E.xue += gold;
    addLog('出售【' + CARDS[D.idOf(card)].name + '】' + (D.starOf(card) > 1 ? D.starOf(card) + '★' : '') + ' +' + gold + ' 学时');
    save();
    return { ok: true, gold: gold, cardId: D.idOf(card) };
  }

  /* ---------------- 等级 / 经验 ---------------- */
  function checkLevel(E) {
    var up = 0;
    while (E.lv < C.MAX_LEVEL && E.exp >= D.expNeed(E.lv)) { E.exp -= D.expNeed(E.lv); E.lv += 1; up += 1; }
    if (up) {
      addLog(E.name + ' 升到 ' + E.lv + ' 级（卡组上限 ' + D.deckCap(E.lv) + '）');
      for (var i = 0; i < up; i++) grantPerk(E);      // 每升一级 → 一次特技三选一
    }
    return up;
  }
  function buyExp(n) {
    var E = me();
    n = Math.max(1, Math.floor(n || 1));
    var cost = n * C.EXP_BUY_COST;
    if (E.xue < cost) return { ok: false, msg: '学时不足（需 ' + cost + '）' };
    E.xue -= cost; E.exp += n;
    var up = checkLevel(E);
    save();
    return { ok: true, up: up };
  }
  function buyLevel() {
    var E = me();
    if (E.lv >= C.MAX_LEVEL) return { ok: false, msg: '已满级' };
    var cost = D.levelBuyCost(E);
    if (E.xue < cost) return { ok: false, msg: '学时不足（需 ' + cost + '）' };
    E.xue -= cost;
    E.exp = 0;
    E.lv += 1;
    addLog('你花费 ' + cost + ' 学时直升 ' + E.lv + ' 级（卡组上限 ' + D.deckCap(E.lv) + '）');
    grantPerk(E);                                       // 直接买等级同样触发特技三选一
    save();
    return { ok: true, cost: cost };
  }

  /* ---------------- AI 学生：经济运营 ---------------- */
  // 1) 买等级（留一点学时买卡）
  function buyLevels(E) {
    var guard = 0, up = 0;
    while (E.lv < C.MAX_LEVEL && guard++ < 10) {
      var cost = D.levelBuyCost(E);
      if (E.xue >= cost + C.AI.LEVEL_BUFFER) { E.xue -= cost; E.exp = 0; E.lv += 1; up += 1; grantPerk(E); }
      else break;
    }
    return up;
  }
  // AI 自己的商品位（每轮独立掷一批，不占用玩家商店）
  function rollPoolFor(E, rng) {
    var pool = [];
    var slots = C.SHOP_SLOTS + perkMod(E, 'slotsAdd');    // 特技【道具类】：每轮商品位 +N
    var pm = perkMods(E);
    for (var i = 0; i < slots; i++) {
      var id = D.rollCard(E.lv, rng);
      if (id) pool.push(perkBiasCard(E, id, pm, rng));
    }
    return pool;
  }
  /* 特技【升星类】ownMonWeight：抽到怪物时，按权重换成"你已经有的同名怪"。
   * 这是"更容易合出高星"最直接的手段 —— 商店本来是"按类别权重抽类目 → 再从该类池里
   * 均匀随机"，刷到某张特定同名卡的概率极低，只能靠刷新堆次数。倍率 w 越大，
   * 命中已有怪的概率 (w-1)/w 越高（1.5 → 33%，2.5 → 60%，3 → 67%）。 */
  function perkBiasCard(E, id, pm, rng) {
    var w = (pm && pm.ownMonWeight) || 1;
    if (w <= 1 || !D.isMonster(id)) return id;
    var mine = {};
    E.deck.concat(E.bag || []).forEach(function (e) { if (D.isMonster(D.idOf(e))) mine[D.idOf(e)] = 1; });
    var ids = Object.keys(mine);
    if (!ids.length || mine[id]) return id;               // 手上没怪 / 本来就是自己的 → 不换
    if (rng() >= (w - 1) / w) return id;
    return ids[Math.floor(rng() * ids.length)];
  }
  // 正在"待合星"的链数：手里只有 1 张同名 1★、还没凑成对的怪物种类数
  //（这类卡数值最低，凑不齐第二张就永远停在 1★，堆多了就是纯稀释抽牌）
  // "正在推进、但还没到 3★"的合星链条数（按同名总投入单位 1★=1 / 2★=2 / 3★=4 统计）
  function loneChains(E) {
    var all = E.deck.concat(E.bag || []), u = {};
    all.forEach(function (e) {
      var id = D.idOf(e);
      if (!D.isMonster(id)) return;
      var s = D.starOf(e);
      u[id] = (u[id] || 0) + (s >= 3 ? 4 : (s === 2 ? 2 : 1));
    });
    var n = 0;
    for (var k in u) if (u[k] > 0 && u[k] < 4) n += 1;
    return n;
  }
  // 后期是否该拦下这张卡：
  //   不拦 → ① 非怪物 ② A/S 怪（本身就强）③ 已在推进的合星链（补第二张即可合成）
  //          ④ 怪物占比还没到下限（1v1 没怪＝送分，必须补怪）
  //   拦   → 后期 + C/B 怪 + 会新开一条待合星链 + 待合星链已达上限
  function isLoneJunkLate(E, id) {
    if (st.round < C.AI.NO_LONE_AFTER || !D.isMonster(id)) return false;
    var c = CARDS[id];
    if (c.tier === 'A' || c.tier === 'S') return false;
    // 用「同名总投入单位」判断，而不是"同名 1★ 的个数"：
    //   以前只数 1★ → 手里合成出 1 张 2★ 后 same1 归 0，被误判成"开新链"拦掉，
    //   于是 2★ 永远推不到 3★（3★ 只有 0.25 张的直接原因）。
    var all = E.deck.concat(E.bag || []);
    var mon = all.filter(function (x) { return D.isMonster(D.idOf(x)); }).length;
    if (mon < Math.max(2, Math.ceil(D.deckCap(E.lv) * 0.6))) return false;   // 怪不够 → 先补怪（跟着卡位走）
    var u = D.chainUnits(E.deck, E.bag, id);
    if (u >= 4) return true;                                    // 已经 3★ → 再买纯属浪费，拦
    if (u > 0) return false;                                    // 链上（1~3 单位）→ 放行，继续深挖
    return C.AI.MAX_LONE_CHAIN > 0 && loneChains(E) >= C.AI.MAX_LONE_CHAIN;   // 在推进的链已够 → 不开新链
  }
  // 后期起点：从该轮起"待合星的 1★"优先留在背包
  function lateBagPending() { return st.round >= C.AI.BAG_PENDING_AFTER; }
  // 卡组里怪物占比是否还够（不够就不能再把 1★ 怪挪走）
  function deckMonRatioOK(E) {
    var mon = E.deck.filter(function (x) { return D.isMonster(D.idOf(x)); }).length;
    return mon >= 2 && (mon / Math.max(1, E.deck.length)) >= C.AI.MON_RATIO[0] - 0.05;
  }
  // 买下这张卡后是否会立刻合星 —— 用「同名总投入单位」判断（1★=1 / 2★=2 / 3★=4）：
  //   已有 1 单位 → 买下凑成 2★；已有 3 单位 → 买下凑成 3★。
  // 会立刻升星的卡直接进卡组（不占额外位置）；否则属于"待合星"，先放背包。
  function willMergeNow(E, id) {
    if (!D.isMonster(id)) return false;
    var u = D.chainUnits(E.deck, E.bag, id);
    return u === 1 || u === 3;
  }
  /* ---------------- 卡位取舍（卡位收紧后的核心） ---------------- */
  // 还在"前期"吗 —— 卡位很紧（0 级只有 2 张），但前期牌库太空会没法打，所以早期放宽。
  function isEarlyStage(E) { return st.round <= C.AI.EARLY_ROUNDS || E.lv <= 1; }

  /* 这张卡配不配占一个卡位。
   *  · 怪物：3★ 无条件占位；2★ 占位；1★ 只有"前期"才占位 ——
   *    中后期一律撤到背包等合星（"6 个位里放 5 张 3★"也没问题，只要是 3★ 就能放）。
   *  · 道具：只留【强力道具】（疾速药水 / 冰霜药水 / 麻痹陷阱 / 炸弹…），弱的不占位。
   *  · 例外：买下就能立刻升星的卡（1★ 但马上合掉）永远值得。 */
  function deckWorthy(E, e) {
    var id = D.idOf(e), star = D.starOf(e);
    if (D.isMonster(id)) {
      if (star >= 2) return true;
      return isEarlyStage(E);
    }
    return D.isStrongItem(id);
  }
  // 买下的这张卡会不会"先进背包"（1★ 且已经过了前期 → 先囤着等合星）
  function goesToBag(E, id) {
    if (!CARDS[id] || !D.isMonster(id)) return false;   // 道具不能升星 → 没有"等合星"一说
    if (willMergeNow(E, id)) return false;              // 买下立刻升星 → 直接进卡组
    if (E.deck.length < 4) return false;                // 牌库太空 → 先塞满
    return !deckWorthy(E, D.mk(id, 1));
  }
  /* 中后期：把"不值得占卡位"的卡挪进背包，腾位给高星怪 / 强力道具。
   * 卡位收紧后这是刚需 —— 卡位满了就再也买不进新卡，必须主动腾。
   * 判据是 deckWorthy：过了前期的 1★ 怪、弱道具都会被挪走；
   * 合星是跨卡组/背包的，挪走不影响它继续凑对，凑齐后 tryMerge 会把高星放回卡组。 */
  function demoteWeakCards(E) {
    // 保底 2 张即可：卡位是给"高星怪 + 强力道具"的，1★ 材料/弱道具撤得越干净越好
    //（撤下来的卡进背包继续凑对，合星是跨卡组/背包的）
    var moved = 0, floorN = Math.max(2, Math.ceil(D.deckCap(E.lv) * 0.3));
    while (moved < C.AI.DEMOTE_PER_ROUND && (E.bag || []).length < bagCapOf(E) && E.deck.length > floorN) {
      var di = -1, dv = Infinity;
      var deckMon = E.deck.filter(function (e) { return D.isMonster(D.idOf(e)); }).length;
      E.deck.forEach(function (e, i) {
        if (deckWorthy(E, e)) return;                               // 值得占位 → 不动
        if (D.isMonster(D.idOf(e)) && deckMon <= 1) return;          // 卡组快没怪了 → 不挪
        var v = keepValue(E, e);
        if (v < dv) { dv = v; di = i; }
      });
      if (di < 0) break;
      E.bag.push(E.deck.splice(di, 1)[0]);
      moved += 1;
    }
    return moved;
  }
  // 卡组现有卡牌的平均"买卡评分"（不含 E 的合星加成，保证与新卡同口径比较）
  function avgDeckScore(E, deckIds) {
    var all = E.deck.concat(E.bag || []);
    if (!all.length) return 0;
    var s = 0;
    all.forEach(function (e) { s += D.aiScore(D.idOf(e), E.arch, deckIds); });
    return s / all.length;
  }
  // 前期（1~2 级）以升星为主：道具（武器/防具/食物/药水等）只少量补，数量到顶就不再买。
  // 过牌 / 解场任何时候都值得留几张，不受此限；升到 ITEM_FREE_LEVEL 后完全放开（中后期再补道具）。
  function itemsTooManyEarly(E, id) {
    if (E.lv >= C.AI.ITEM_FREE_LEVEL || D.isMonster(id)) return false;
    if (D.isDraw(id) || D.isRemoval(id)) return false;
    if (E.xue >= C.AI.EARLY_SPARE_XUE) return false;      // 学时花不出去就别硬憋着（烂在手里更亏）
    var n = 0;
    E.deck.concat(E.bag || []).forEach(function (e) {
      var x = D.idOf(e);
      if (!D.isMonster(x) && !D.isDraw(x) && !D.isRemoval(x)) n += 1;
    });
    return n >= C.AI.EARLY_ITEM_MAX[Math.max(0, Math.min(1, E.lv - 1))];
  }
  // AI 刷新商品位：先用免费次数，再按与玩家相同的价格阶梯付费（付费次数跨轮累计）
  //   urgent=true：手上有"再买一张同名就升星"的链 —— 这时刷新的期望收益最高，
  //   把留手线压到 1 学时也要刷（普通情况仍留 REFRESH_MIN_XUE，别为刷新牺牲当轮采购）。
  function aiTryRefresh(E, urgent) {
    if ((E.freeRefresh || 0) > 0) { E.freeRefresh -= 1; return true; }
    var cost = D.refreshCost((E.refreshPaid || 0) + 1);
    var keep = urgent ? 1 : C.AI.REFRESH_MIN_XUE;               // 留够买卡的钱再刷
    if (E.xue < cost + keep) return false;
    E.xue -= cost;
    E.refreshPaid = (E.refreshPaid || 0) + 1;
    return true;
  }
  // 是否存在"再买一张同名卡就能升星"的链（同名总投入 3 单位 → 第 4 张即合成 3★）
  function hasOneAwayChain(E) {
    var u = {};
    E.deck.concat(E.bag || []).forEach(function (e) {
      var id = D.idOf(e);
      if (!D.isMonster(id)) return;
      var s = D.starOf(e);
      u[id] = (u[id] || 0) + (s >= 3 ? 4 : (s === 2 ? 2 : 1));
    });
    // 只认"差 1 张到 3★"（3 单位）；1 单位那种"差 1 张到 2★"的链太多，会让 AI 一直紧急刷
    for (var k in u) if (u[k] === 3) return true;
    return false;
  }
  // 清理"僵尸链"：手里的同名卡只有 1 张 1★、又推不动的链。
  // 为什么必须清：开局那几轮"怪还不够 4 只"时不设链上限，AI 会一次买 4 张不同的怪，
  // 留下 4 条废链；等怪够了开始限链，这些废链却永久占着名额 —— 主力链只能凑到 ≈3 张，
  // 永远差那一张到不了 3★（实测 3★ 只有 0.7 张）。卖掉它们＝腾名额 + 回笼学时。
  function pruneDeadChains(E) {
    if (!(C.AI.MAX_LONE_CHAIN > 0)) return 0;
    var sold = 0, guard = 0;
    while (guard++ < 4 && loneChains(E) > C.AI.MAX_LONE_CHAIN && (E.bag || []).length < bagCapOf(E)) {
      var groups = {};
      E.deck.concat(E.bag || []).forEach(function (e) {
        var id = D.idOf(e);
        if (!D.isMonster(id)) return;
        (groups[id] = groups[id] || []).push(e);
      });
      var dead = null;                                        // 找单位最少的那条链
      for (var gid in groups) {
        var u = 0;
        groups[gid].forEach(function (e) { var s = D.starOf(e); u += (s >= 3 ? 4 : (s === 2 ? 2 : 1)); });
        if (u >= 4) continue;                                  // 已 3★：是好链，别动
        if (!D.isMonster(gid)) continue;
        if (!dead || u < dead.u) dead = { id: gid, u: u };
      }
      if (!dead) break;
      var bi = -1;
      (E.bag || []).forEach(function (e, i) { if (bi < 0 && D.idOf(e) === dead.id) bi = i; });
      if (bi >= 0) { E.xue += D.sellOf(E.bag.splice(bi, 1)[0]); sold++; continue; }
      var di = -1;
      E.deck.forEach(function (e, i) { if (di < 0 && D.idOf(e) === dead.id) di = i; });
      if (di >= 0 && E.deck.length > 1) { E.xue += D.sellOf(E.deck.splice(di, 1)[0]); sold++; continue; }
      break;
    }
    return sold;
  }

  function aiEconomy(E) {
    buyLevels(E);
    pruneDeadChains(E);       // 先清废链（腾链名额 + 回笼学时，紧接着用于本轮采购）
    // 1.5) 后期清仓：主动卖掉明显拖后腿的弱卡（放在"买卡"之前 → 卖出的学时立刻能用于本轮采购）
    if (C.AI.SELL_PER_ROUND > 0 && st.round >= C.AI.SELL_AFTER_ROUND) {
      if (sellWeakCards(E) && C.AI.SELL_TO_LEVEL) buyLevels(E);   // 清仓所得是否补等级（默认否：见 SELL_TO_LEVEL 注释）
    }
    // 2) 本回合自己的商品位 → 按「构筑评分」买卡（前期补高攻战斗怪 → 中期干扰道具 → 后期过牌/解场）
    //    后期若刷出来的都是"孤立的 1★ 单卡"（合不了星），改为把学时花在刷新上，去找高阶卡 / 能合星的同名卡
    E.freeRefresh = C.FREE_REFRESH + perkMod(E, 'freeRefresh');   // 每轮免费刷新次数（含特技加成）
    var pool = rollPoolFor(E, rngOf(st.seed, st.round, E.id, 'shop'));
    var bought = 0, refreshed = 0;
    for (var round2 = 0; round2 < C.AI.BUY_PER_ROUND + 2 + C.AI.REFRESH_PER_ROUND && bought < C.AI.BUY_PER_ROUND; round2++) {
      var deckIds = idsOf(E.deck);
      var deckMons = E.deck.filter(function (e) { return D.isMonster(D.idOf(e)); }).length;
      var cands = pool.filter(function (x) {
        if (!(E.xue >= priceFor(E, x) && canAdd(E, x))) return false;
        // 这张卡最终会落在哪：会先进背包的不占战斗牌库，就不该受卡组构成约束；
        // 会真正进卡组"加张"的，才走构成守门。
        // ★ 卡位满了 → **一律**可以先放背包（背包装不下才轮得到"替换"）。
        //   旧写法只把"中后期的 1★ 怪"当 toBag，卡位一满，2★ / 道具 / 新怪
        //   全被下面那行过滤掉 → 可买范围砍半、材料断供（实测 3★ 2.05→1.15）。
        var toBag = E.deck.length >= D.deckCap(E.lv) || goesToBag(E, x);
        // 少卡高星：卡组够厚之后只接受"买下立刻升星"的卡 —— 不加张数，只提星数
        if (!toBag && E.deck.length >= D.deckCap(E.lv) && !willMergeNow(E, x)) return false;
        if (!toBag && !D.aiAddOk(deckIds, x)) return false;
        return !isLoneJunkLate(E, x, deckIds) && !itemsTooManyEarly(E, x);
      });
      if (!cands.length) {
        if (refreshed < C.AI.REFRESH_PER_ROUND && st.round >= C.AI.NO_LONE_AFTER && aiTryRefresh(E)) {
          refreshed += 1;
          pool = rollPoolFor(E, rngOf(st.seed, st.round, E.id, 'shop' + refreshed));   // 换一批商品（种子可复现）
          continue;
        }
        break;
      }
      // 每次重新评估（买完一张会改变构成需求）
      cands.sort(function (a, b) { return D.aiScore(b, E.arch, deckIds, E) - D.aiScore(a, E.arch, deckIds, E); });
      var cid = cands[0], price = priceFor(E, cid);
      /* ★ 为「凑链」主动刷新（少卡高星路线的关键）。
       * 用户点名："有适合的牌应当花学时刷新来获得更多升星机会"。
       * 触发条件（两种）：
       *   ① 存在"再买一张同名就出 3★"的链，而当前最优候选**不是那张卡** —— 刷它出来；
       *   ② 最优候选**不在任何推进中的链上**（同名投入 0 或已 3★），但手上还有链 —— 别拿杂卡充数。
       * 前提：卡组已立起来（≥6 张、怪 ≥ MON_FLOOR）——前期先保证有怪可打；
       *      受 REFRESH_PER_ROUND 限额；①情形允许把留手线压到 1 学时（aiTryRefresh 的 urgent）。 */
      if (E.deck.length >= 4 && deckMons >= Math.max(1, Math.ceil(D.deckCap(E.lv) * 0.5)) && loneChains(E) > 0 &&
        refreshed < C.AI.REFRESH_PER_ROUND) {
        var u0 = D.chainUnits(E.deck, E.bag, cid);
        var near = hasOneAwayChain(E);                 // 有"差 1 张到 3★"的链
        var onTarget = (u0 === 3);                     // 候选正是那条链要的卡 → 直接买
        if (!onTarget && (near || !(u0 > 0 && u0 < 4)) && aiTryRefresh(E, near)) {
          refreshed += 1;
          pool = rollPoolFor(E, rngOf(st.seed, st.round, E.id, 'shop' + refreshed));
          continue;
        }
      }
      // 最高分候选仍达不到门槛 → 与其买一张 1★ 摊薄牌库，不如刷新去找
      // "再买一张就能升星"的同名卡；刷不出来才收手（钱不留着烂手里）。
      if (D.aiScore(cid, E.arch, deckIds, E) < C.AI.MIN_BUY_SCORE) {
        if (refreshed < C.AI.REFRESH_PER_ROUND && aiTryRefresh(E)) {
          refreshed += 1;
          pool = rollPoolFor(E, rngOf(st.seed, st.round, E.id, 'shop' + refreshed));
          continue;
        }
        break;
      }
      // 后期：最佳候选还不如"卡组现有平均水平" → 买了也是拖后腿，不如把学时花在刷新上碰更好的
      if (st.round >= C.AI.NO_LONE_AFTER && refreshed < C.AI.REFRESH_PER_ROUND &&
        D.aiScore(cid, E.arch, deckIds) < avgDeckScore(E, deckIds) && aiTryRefresh(E)) {
        refreshed += 1;
        pool = rollPoolFor(E, rngOf(st.seed, st.round, E.id, 'shop' + refreshed));
        continue;
      }
      // 少卡高星路线：1★ 怪先放背包等合星，不占战斗牌库的卡位（含 1★ 的 S/A —— 用户点名"至少 2★ 再进卡组"）。
      //   例外：① 买下立刻升星的（合完就不是 1★ 了）；② 卡组里怪还太少（1v1 没怪＝送分）。
      var preferBag = goesToBag(E, cid);
      var where = placeCard(E, cid, preferBag);
      if (where) { E.xue -= price; bought++; continue; }
      // 卡组与背包都满：用更强的卡替换卡组最弱卡（被替换的折价卖出）
      var wi = weakestIdx(E);
      if (wi >= 0) {
        var cs = D.aiScore(cid, E.arch, deckIds, E), ws = D.aiScore(D.idOf(E.deck[wi]), E.arch, deckIds);
        if (cs > ws + C.AI.REPLACE_MARGIN) {
          var out = E.deck.splice(wi, 1)[0];
          E.xue += D.sellOf(out);
          E.xue -= price;
          E.deck.push(D.mk(cid, 1));
          tryMerge(E);
          bought++;
        } else break;
      } else break;
    }
    // 3.5) 后期：先把卡组里"待合星的 1★"挪进背包，腾出卡位（放前面，好让 3) 用更强的卡补上空位）
    if (lateBagPending()) demoteWeakCards(E);
    // 3) 背包空着且卡组没满时，把背包里较好的卡换上场（不破坏构成才换）
    var moved = 0;
    while (E.bag.length && E.deck.length < D.deckCap(E.lv) && moved++ < 6) {
      var bi = -1, bs = -Infinity;
      var dids = idsOf(E.deck);
      E.bag.forEach(function (e, idx) {
        var id = D.idOf(e);
        if (!D.aiAddOk(dids, id)) return;                      // 上场会破坏构成 → 跳过
        // 1★ 怪不上场：继续留在背包等合星，别抬回卡组占位置 —— 全程生效（少卡高星路线）
        //（卡组里怪不够时例外：没怪＝1v1 送分）
        if (D.isMonster(id) && D.starOf(e) === 1 && deckMonRatioOK(E)) return;
        var s = D.aiScore(id, E.arch, dids) * D.starOf(e);
        if (s > bs) { bs = s; bi = idx; }
      });
      if (bi < 0) break;
      E.deck.push(E.bag.splice(bi, 1)[0]);
    }
    // 4) 背包里 2★ 以上的卡，顶掉卡组里还停在 1★ 的卡 —— 张数不变、星数上升。
    //    （少卡高星的关键一步：卡组张数已经够了，光靠"上场"补不进来，得靠换。）
    var swapped = 0;
    while (swapped++ < 3) {
      var d1i = -1, d1v = Infinity;
      E.deck.forEach(function (e, i) {
        if (D.starOf(e) !== 1) return;                          // 只换 1★
        var v = D.aiScore(D.idOf(e), E.arch, idsOf(E.deck));
        if (v < d1v) { d1v = v; d1i = i; }
      });
      if (d1i < 0) break;
      var bbi = -1, bbv = -Infinity, dids3 = idsOf(E.deck);
      E.bag.forEach(function (e, i) {
        if (D.starOf(e) < 2) return;                            // 只抬 2★ 以上
        var sc2 = D.aiScore(D.idOf(e), E.arch, dids3) * D.starOf(e);
        if (sc2 > bbv) { bbv = sc2; bbi = i; }
      });
      if (bbi < 0 || bbv <= d1v) break;                          // 背包里没有更强的 → 不换
      var outCard = E.deck.splice(d1i, 1)[0];
      E.deck.push(E.bag.splice(bbi, 1)[0]);
      E.bag.push(outCard);                                       // 1★ 换回背包继续等合星
    }
    tryMerge(E);
  }

  /* ---------------- 自动战斗（双方 AI 代打） ---------------- */
  function flipKey(s) {
    var a = s.players.A, b = s.players.B;
    s.players.A = b; s.players.B = a;
    a.key = 'B'; b.key = 'A';
    s.active = (s.active === 'A' ? 'B' : (s.active === 'B' ? 'A' : s.active));
    if (s.pending) {
      s.pending.actorKey = (s.pending.actorKey === 'A' ? 'B' : (s.pending.actorKey === 'B' ? 'A' : s.pending.actorKey));
      s.pending.victimKey = (s.pending.victimKey === 'A' ? 'B' : (s.pending.victimKey === 'B' ? 'A' : s.pending.victimKey));
    }
    // dealt / healed 都要一起换：否则翻转视角期间产生的治疗会被记到错误的一方（治疗抵消错位）
    if (s.dealt) { var d = s.dealt.A; s.dealt.A = s.dealt.B; s.dealt.B = d; }
    /* ⚠ perk 也必须一起换。它是按"A/B 座位"存的学院特技加成表（战斗/种族类）。
     *   漏了它 → 翻转视角（让 AI 替另一个座位行动）期间双方加成互换：
     *   己方怪物按对手的特技算、对手按己方的算 —— 表现就是攻击力随回合来回浮动
     *   （"敌方回合正常、回到自己回合就不加成"），而且翻转期间 AI 的决策与伤害结算
     *   全都建立在错位的数值上。注意 spawnMonster 的生命加成也是按当时座位取的，
     *   同样要靠这里一起换才对齐。 */
    if (s.perk) { var pk = s.perk.A; s.perk.A = s.perk.B; s.perk.B = pk; }
    if (s.healed) { var h = s.healed.A; s.healed.A = s.healed.B; s.healed.B = h; }
    // dmgBy 同理：翻转视角期间 AI 是以另一个 key 记账的，不换就会记到错误的一方
    if (s.dmgBy) { var g = s.dmgBy.A; s.dmgBy.A = s.dmgBy.B; s.dmgBy.B = g; }
    // 注：大回合计数（turnCount/round）与坐标系无关，翻转时无需额外处理
  }
  // 翻转期间产生的事件里记的是"翻转后的阵营"，这里换回真实阵营（否则界面会把箭头指向自己人）
  var translated = (typeof WeakSet !== 'undefined') ? new WeakSet() : null;
  function translateEvents(s) {
    var ev = s.events || [];
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (!e || typeof e !== 'object') continue;
      if (translated) { if (translated.has(e)) continue; translated.add(e); }
      ['key', 'fromKey', 'toKey', 'toPlayer'].forEach(function (f) {
        if (e[f] === 'A') e[f] = 'B'; else if (e[f] === 'B') e[f] = 'A';
      });
    }
  }
  function botStep(s) {
    if (!s || s.winner) return false;
    if (s.pending) {
      Engine.resolvePrompt(s.pending.kind === 'CHOOSE_CARDS' ? null : false);
      return true;
    }
    var flip = (s.active === 'A');
    if (flip) flipKey(s);
    var acted = false;
    try { acted = AI.step(); }
    finally {
      if (flip) {
        translateEvents(s);
        if (s.winner === 'A') s.winner = 'B'; else if (s.winner === 'B') s.winner = 'A';
        flipKey(s);
      }
    }
    return acted;
  }
  // 无头跑完一整场（后台模拟：置 __acSilent 让界面完全静默）
  function runBot(s) {
    var prev = (typeof window !== 'undefined') ? window.__acSilent : undefined;
    if (typeof window !== 'undefined') window.__acSilent = true;
    try { return runBotInner(s); }
    finally { if (typeof window !== 'undefined') window.__acSilent = prev; }
  }
  function runBotInner(s) {
    var steps = 0, stall = 0, last = '';
    while (!s.winner && steps++ < 14000) {
      var sig = [s.active, s.phase, s.round, s.log.length, s.players.A.hp, s.players.B.hp].join('|');
      var acted = botStep(s);
      while (s.pending) Engine.resolvePrompt(s.pending.kind === 'CHOOSE_CARDS' ? null : false);
      if (s.winner) break;
      stall = (sig === last) ? stall + 1 : 0;
      last = sig;
      if ((!acted && stall > 6) || steps > 13000) {
        var t = s.phase === 'PREP' ? 'CONFIRM_BATTLE' : 'END_TURN';
        var r = Engine.tryAction({ type: t, _ai: true });
        if (!r || !r.ok) Engine.tryAction({ type: 'END_TURN', _ai: true });
        stall = 0;
      }
    }
    return {
      a: s.dealt.A, b: s.dealt.B,
      healA: (s.healed ? s.healed.A : 0), healB: (s.healed ? s.healed.B : 0),
      greedA: (s.greedGain ? s.greedGain.A : 0), greedB: (s.greedGain ? s.greedGain.B : 0),
      winner: s.winner, rounds: s.round
    };
  }
  // 抛硬币决定先后手（同一轮同一对手结果固定，可复现）
  function coinFirst(idA, idB) { return rngOf(st.seed, st.round, 'coin', idA, idB)() < 0.5 ? 'A' : 'B'; }
  function newBattleState(idA, idB) {
    var A = ent(idA), B = ent(idB);
    var s = Engine.newGame({
      mode: 'academy', achOff: true,               // 学院考核的模拟对局：不计入成就
      seed: hashSeed(st.seed, st.round, idA, idB) >>> 0,
      first: coinFirst(idA, idB),
      playerDeck: A.deck.slice(), aiDeck: B.deck.slice(),
      playerName: A.name, aiName: B.name,
      playerHp: C.BATTLE_HP, aiHp: C.BATTLE_HP,
      maxRounds: D.roundLimit(st.round),
      playerDmgMult: C.PLAYER_DMG_MULT,
      noHpFloor: true,                     // 局内血量无下限：打满回合上限，只比累计输出
      perkA: perkMods(A), perkB: perkMods(B)   // 学院特技的战斗/种族类加成（引擎侧应用）
    });
    s.players.A.isAI = true; s.players.B.isAI = true;
    return s;
  }

  /* ---------------- 结算 ---------------- */
  function resolveRound(myDealtA, myDealtB, myHealA, myHealB, myGreedA, myGreedB) {
    var results = [];
    var myPair = pairOf(PLAYER);
    if (myPair) {
      var myIdx = (myPair[0] === PLAYER) ? 0 : 1;
      results.push({
        a: myPair[myIdx], b: myPair[1 - myIdx],
        da: myDealtA, db: myDealtB, ha: (myHealA || 0), hb: (myHealB || 0),
        greedA: (myGreedA || 0), greedB: (myGreedB || 0), mine: true
      });
    }
    st.pairs.forEach(function (p) {
      if (myPair && p === myPair) return;
      var r = runBot(newBattleState(p[0], p[1]));
      // 注意：greedA / greedB 必须一起带上 —— 漏了的话 AI 对局里【贪婪】觉醒的额外学时
      // 会被静默丢弃（applyResults 有消费逻辑，但上游没数据，永远拿 0）。
      results.push({
        a: p[0], b: p[1], da: r.a, db: r.b, ha: r.healA || 0, hb: r.healB || 0,
        greedA: r.greedA || 0, greedB: r.greedB || 0, mine: false
      });
    });
    applyResults(results);
    st.lastBattle = { results: results, round: st.round };
    st.stage = 'result';
    save();
    return st.lastBattle;
  }
  function applyResults(results) {
    results.forEach(function (r) {
      var A = ent(r.a), B = ent(r.b);
      // 局内恢复的玩家生命可以抵消对手的输出（对手伤害减少，结算时生效）
      var effA = Math.max(0, r.da - (r.hb || 0));
      var effB = Math.max(0, r.db - (r.ha || 0));
      A.total += effA; B.total += effB;
      // 觉醒【贪婪】：击杀额外学时（引擎在 termGreed 里记的账，这里发给对应的学生）
      if (r.greedA) { A.xue += r.greedA; addLog(A.name + ' 的【贪婪】觉醒额外获得 ' + r.greedA + ' 学时'); }
      if (r.greedB) { B.xue += r.greedB; addLog(B.name + ' 的【贪婪】觉醒额外获得 ' + r.greedB + ' 学时'); }
      var diff = Math.abs(effA - effB);
      var loser = null, winner = null;
      if (effA > effB) { winner = A; loser = B; }
      else if (effB > effA) { winner = B; loser = A; }
      if (loser) {
        var cap = D.lossCapOf(st.round);      // 每轮扣血上限 = min(轮次 × 3, 前期硬顶 CAP_TIERS)
        var real = Math.min(diff, cap);
        loser.hp = Math.max(0, loser.hp - real);
        loser.losses += 1; winner.wins += 1;
        loser.exp += C.LOSE_EXP + perkMod(loser, 'expFlat'); winner.exp += C.WIN_EXP + perkMod(winner, 'expFlat');
        r.loss = real; r.cap = cap; r.diff = diff; r.rawA = r.da; r.rawB = r.db;
        addLog(A.name + ' ' + effA + ' : ' + effB + ' ' + B.name + ' → ' + loser.name + ' -' + real +
          (real < diff ? '（差额 ' + diff + '，本轮上限 ' + cap + '）' : '') + ' 生命（剩余 ' + loser.hp + '）' +
          ((r.ha || r.hb) ? '［治疗抵消：' + A.name + ' 抵消 ' + (r.ha || 0) + '，' + B.name + ' 抵消 ' + (r.hb || 0) + '］' : ''));
      } else {
        r.loss = 0; r.diff = 0; r.rawA = r.da; r.rawB = r.db;
        A.exp += C.LOSE_EXP + perkMod(A, 'expFlat'); B.exp += C.LOSE_EXP + perkMod(B, 'expFlat');
        addLog(A.name + ' ' + effA + ' : ' + effB + ' ' + B.name + ' → 平局，无人扣血');
      }
      checkLevel(A); checkLevel(B);
      A.lastOpp = B.id; B.lastOpp = A.id;
    });
    var before = alive().length;
    st.ents.forEach(function (E) {
      if (E.alive && E.hp <= 0) {
        E.alive = false; E.rank = before; before -= 1;
        addLog('★ ' + E.name + ' 生命归零，淘汰（第 ' + E.rank + ' 名）');
      }
    });
  }
  function nextRound() {
    var al = alive();
    if (al.length <= 1) { finishRun(al[0]); return { type: 'done' }; }
    if (!me().alive) { finishRun(null); return { type: 'out' }; }
    beginRound();
    save();
    return { type: 'round', round: st.round };
  }
  function finishRun(champ) {
    if (st.result) return st.result;
    if (!champ) {
      var guard = 0;
      while (alive().length > 1 && guard++ < 40) {
        pairUp();
        var res = [];
        st.pairs.forEach(function (p) { var r = runBot(newBattleState(p[0], p[1])); res.push({ a: p[0], b: p[1], da: r.a, db: r.b }); });
        st.round += 1;
        applyResults(res);
      }
      champ = alive()[0];
    }
    if (champ) champ.rank = 1;
    var table = st.ents.slice().sort(function (a, b) { return (a.rank || 99) - (b.rank || 99); }).map(function (E) {
      return { name: E.name, isPlayer: E.isPlayer, rank: E.rank || 99, arch: D.addrOf(E), lv: E.lv, hp: E.hp, total: E.total, deck: E.deck.length };
    });
    st.result = { champion: champ ? champ.name : '—', championIsPlayer: champ ? champ.isPlayer : false, table: table, playerRank: me().rank || (me().alive ? 1 : 99) };
    st.stage = 'done';
    addLog('『' + C.NAME + '』第 ' + st.no + ' 届落幕：第一名 ' + st.result.champion + '；你的排名：第 ' + st.result.playerRank + ' 名。');
    var hist = SaveData.getAcademyHistory();
    hist.push({
      no: st.no, name: C.NAME + '·第 ' + st.no + ' 届', date: Date.now(),
      champion: st.result.champion, championIsPlayer: st.result.championIsPlayer,
      playerRank: st.result.playerRank, table: table
    });
    SaveData.setAcademyHistory(hist);
    save();
    if (typeof Achievements !== 'undefined') Achievements.onAcademyCup(st, hist);   // 成就：优秀毕业生
    return st.result;
  }
  function abandon() { st = null; SaveData.setAcademy(null); }

  return {
    load: load, get: get, hasActive: hasActive, startRun: startRun, abandon: abandon,
    refreshShop: refreshShop, buySlot: buySlot, toggleLock: toggleLock, toggleLockAll: toggleLockAll,
    coinFirst: coinFirst, moveCard: moveCard, sellCard: sellCard,
    buyExp: buyExp, buyLevel: buyLevel, nextRefreshCost: function () { return nextRefreshCost(); },
    pickPerk: pickPerk, perkMods: perkMods, perkMod: perkMod,   // 特技：选择接口 + 效果读取
    checkLevel: checkLevel,
    botStep: botStep, newBattleState: newBattleState, resolveRound: resolveRound, nextRound: nextRound,
    oppOf: oppOf, pairOf: pairOf, alive: alive, me: me, ent: ent,
    flipKey: flipKey           // 视角翻转（供测试：必须连 perk 一起换，否则特技加成会错位）
  };
})();
