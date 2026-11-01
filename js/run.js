/* ============================================================
 * 肉鸽跑图  run.js
 *  - 分层分支地图（杀戮尖塔式）：每行若干节点，连线通往下一行，玩家选路
 *  - 节点类型：战斗 / 精英 / 商店 / 休息 / 事件 / BOSS
 *  - 三幕，每幕结尾一个 BOSS；生命、卡组、金币、遗物跨战斗继承
 *  - 状态经 SaveData.setRun 持久化
 * ========================================================== */
var NODE_META = {
  battle: { icon: '战', label: '战斗', cls: 'n-battle' },
  elite: { icon: '精', label: '精英', cls: 'n-elite' },
  boss: { icon: '主', label: 'BOSS', cls: 'n-boss' },
  shop: { icon: '商', label: '商店', cls: 'n-shop' },
  rest: { icon: '休', label: '休息', cls: 'n-rest' },
  event: { icon: '事', label: '事件', cls: 'n-event' }
};

var RunData = (function () {
  'use strict';

  var ROW_PLAN = [
    { types: ['battle'], n: 2 },
    { types: ['battle', 'event'], n: 3 },
    { types: ['battle', 'event', 'shop'], n: 3 },
    { types: ['battle', 'elite'], n: 2 },
    { types: ['rest', 'shop'], n: 2 },
    { types: ['battle', 'event'], n: 3 },
    { types: ['battle', 'elite'], n: 2 },
    { types: ['shop', 'event', 'battle'], n: 3 },
    { types: ['rest'], n: 2 },
    { types: ['battle', 'elite'], n: 3 },
    { types: ['battle', 'event'], n: 3 },
    { types: ['battle', 'shop'], n: 2 },
    { types: ['rest'], n: 2 },
    { types: ['boss'], n: 1 }
  ];

  function monstersByTier(t) { return CARD_LIST.filter(function (c) { return c.type === 'monster' && c.tier === t; }).map(function (c) { return c.id; }); }
  function itemsByType(t) { return CARD_LIST.filter(function (c) { return c.type === t; }).map(function (c) { return c.id; }); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function rndInt(n) { return Math.floor(Math.random() * n); }

  // BOSS 卡组剔除的杂鱼卡：咒缚灵(1血)、怨灵(1血1攻) 等低价值垃圾卡，避免污染 BOSS 卡组
  var BOSS_BANNED = ['a-077-2', 'a-076-2'];
  function bossClean(pool) {
    var out = pool.filter(function (id) { return BOSS_BANNED.indexOf(id) < 0; });
    return out.length ? out : pool;
  }
  // 只保留"高强度高数值的战斗类怪物"（血/攻双高），用于强化 BOSS 与第三幕卡组
  function combatOnly(pool, minHp, minAtk) {
    var out = pool.filter(function (id) {
      var c = CARDS[id];
      return c && (c.hp || 0) >= minHp && (c.atk || 0) >= minAtk;
    });
    return out.length ? out : pool;
  }
  // BOSS / 第三幕精英偏爱携带的强力道具：提速 / 强控 / 复制（原普通遭遇不带的也解禁）
  var POWER_ITEMS = ['a-087-2', 'a-022-2', 'a-062-2', 'a-063-2', 'a-116-2',
    'a-020-2', 'a-115-2', 'a-088-2', 'a-086-2', 'a-117-2'];

  /* ---------------- 敌方遭遇卡组 ----------------
   * 张数（幕×类型）：小怪 一层8-12 / 二层20-25 / 三层34；精英 18/30/40；BOSS 28/40/48
   * 构成：怪物卡 40%~60%（BOSS 与第三幕取上限 60%），其余为道具/装备/神器等（含特殊卡）
   * BOSS：剔除杂鱼垃圾卡 + 只带高数值战斗怪 + 怪物占比 60% + 概率携带强力道具
   * 第三幕：怪物换成高数值战斗怪；精英额外概率携带强力道具
   */
  function deckTotal(act, kind) {
    if (kind === 'normal') return act <= 1 ? 8 + rndInt(5) : act === 2 ? 20 + rndInt(6) : 34;   // 一幕小怪 8~12（削弱）
    if (kind === 'elite') return act <= 1 ? 18 : act === 2 ? 30 : 40;                            // 一幕精英 18（削弱），三幕 40
    return act <= 1 ? 28 : act === 2 ? 40 : 48;   // boss：张数全面上调，三幕最多
  }
  /* ★ AI 用不好的卡（踏上征途的敌人卡组里**不放**）。
     池子是按 tier 自动生成的，新卡一加进来就会被随机塞进敌人卡组 ——
     但有几类卡对 AI 完全是负担：0 攻的生产型怪、必须配合特定卡才生效的怪、
     需要"选目标/选牌"才能用的道具（AI 只会打出去空转）。
     ⚠ 加新卡时**默认不写这里**，只有确认 AI 用不好才加。 */
  var AI_BAD_CARDS = [
    'a-142-02',   // 魔法绵羊：0 攻 1 血，纯 token
    'a-148-02',   // 恶魔血巢：0 攻，只会生撕裂者
    'a-149-02',   // 古神之拳：要场上先有 YOG 才能变形，单卡很弱
    'a-150-02',   // YOG：0 攻 + 己方唯一，AI 带多张纯浪费
    'a-141-02',   // 古神幼虫：要靠血巢才变身，单独带没有意义
    'a-151-02',   // 黑檀宝箱：要先弃一张手牌再检索，AI 不会选
    'a-152-02',   // 充能戒指：在手牌持续生效，AI 不会"留牌"
    'a-157-02',   // 无味果：要选一张药水复制，AI 不会选
    'a-155-02',   // 灵视药水：只在对方有不可选中怪时才有意义
    'a-156-02'    // 隐身药水：要选己方 ≤9 血怪
  ];
  function aiOk(id) { return AI_BAD_CARDS.indexOf(id) < 0; }

  // extraCards：必定加入且计入总张数的牌（如 BOSS 招牌卡），其类型参与 40%~60% 占比计算
  function encounterDeck(act, kind, extraCards) {
    act = Math.min(Math.max(act || 1, 1), 3);
    var extra = (extraCards || []).filter(function (id) { return !!CARDS[id]; });
    var Cm = monstersByTier('C').filter(aiOk), Bm = monstersByTier('B').filter(aiOk);
    var Am = monstersByTier('A').filter(aiOk), Sm = monstersByTier('S').filter(aiOk);
    var allMon = [].concat(Cm, Bm, Am, Sm);
    // 防具池中排除【暗影斗篷】：它会让怪物"无法被攻击"，普通遭遇里容易出现硬锁
    var armors = itemsByType('armor').filter(function (id) { return id !== 'a-039-2'; });
    var items = [].concat(itemsByType('throw'), itemsByType('food'), itemsByType('potion'),
      itemsByType('treasure'), itemsByType('scroll'), itemsByType('weapon'), armors)
      // 催眠卷轴/冰霜药水（强控/削弱）：普通遭遇不带（改为精英/BOSS 概率携带）
      .filter(function (id) { return id !== 'a-063-2' && id !== 'a-062-2'; })
      .filter(aiOk);                       // 同上：需要"选目标/选牌"的道具不给 AI 带
    var deck = [];

    var total = deckTotal(act, kind);
    // 怪物 40%~60%（含 extra 中的怪物），其余为道具/装备等（用上下界取整严格落在 40%~60%）
    var loMon = Math.ceil(total * 0.4), hiMon = Math.floor(total * 0.6);
    if (hiMon < loMon) hiMon = loMon;
    var monsterTarget = (kind === 'boss' || act >= 3) ? hiMon : loMon + rndInt(hiMon - loMon + 1);   // BOSS/第三幕取怪物占比上限
    var extraMon = extra.filter(function (id) { return CARDS[id].type === 'monster'; }).length;
    var extraItem = extra.length - extraMon;
    var itemTarget = total - monsterTarget;                       // 最终"其他"张数
    var needMon = Math.max(0, Math.min(monsterTarget - extraMon, total - extra.length));

    // 特殊卡（属于"其他"份额）：暗影斗篷：BOSS 必带、精英 35%；
    // 催眠卷轴/冰霜药水：精英各 35%、BOSS 各 50%
    var specials = [];
    if (kind === 'boss') {
      specials.push('a-039-2');
      specials.push('a-063-2');   // 催眠卷轴：BOSS 必带
      specials.push('a-062-2');   // 冰霜药水：BOSS 必带
    } else if (kind === 'elite') {
      if (Math.random() < 0.35) specials.push('a-039-2');
      if (Math.random() < 0.35) specials.push('a-063-2');
      if (Math.random() < 0.35) specials.push('a-062-2');
    }

    // 怪物按幕/类型加权抽取
    var mix;
    if (act <= 1) mix = kind === 'boss' ? [['B', 0.75], ['A', 0.25]]
      : [['C', 0.85], ['B', 0.15]];                                 // 第一幕小怪/精英进一步削弱
    else if (act === 2) mix = kind === 'boss' ? [['A', 0.5], ['B', 0.35], ['S', 0.15]]
      : kind === 'normal' ? [['B', 0.6], ['C', 0.4]] : [['A', 0.5], ['B', 0.5]];
    else mix = kind === 'boss' ? [['A', 0.55], ['S', 0.35], ['B', 0.1]]
      : kind === 'elite' ? [['A', 0.85], ['S', 0.15]] : [['A', 0.8], ['B', 0.2]];   // 第三幕整体加强
    var tierPool = { C: Cm, B: Bm, A: Am, S: Sm };
    if (kind === 'boss') {
      // BOSS：剔除垃圾卡 + A/B 只保留高数值战斗怪（S 级本就强，不筛）
      tierPool = { C: bossClean(Cm), B: combatOnly(bossClean(Bm), 10, 4), A: combatOnly(bossClean(Am), 10, 4), S: bossClean(Sm) };
    } else if (act >= 3) {
      // 第三幕：A/B 怪物也换成高数值战斗怪
      tierPool = { C: Cm, B: combatOnly(Bm, 10, 4), A: combatOnly(Am, 10, 4), S: Sm };
    }
    for (var i = 0; i < needMon; i++) {
      var r = Math.random(), acc = 0, t = mix[0][0];
      for (var k = 0; k < mix.length; k++) { acc += mix[k][1]; if (r <= acc) { t = mix[k][0]; break; } }
      var pool = tierPool[t];
      deck.push(pool && pool.length ? pick(pool) : (allMon.length ? pick(allMon) : null));
    }
    // 道具/装备 + 特殊卡，补齐"其他"份额（给 extra 预留位置）
    var needItem = Math.max(0, itemTarget - extraItem);
    var bodyItems = Math.max(0, needItem - specials.length);
    // BOSS / 第三幕精英：道具份额按概率换成强力道具（提速/控制/复制），普通遭遇维持原样
    var powerBias = kind === 'boss' ? 0.7 : (act >= 3 && kind === 'elite' ? 0.4 : 0);
    for (var j = 0; j < bodyItems; j++) {
      if (powerBias && Math.random() < powerBias) deck.push(pick(POWER_ITEMS));
      else if (items.length) deck.push(pick(items));
    }
    for (var s = 0; s < specials.length; s++) { if (deck.length < total - extra.length) deck.push(specials[s]); }
    // 追加必定加入的牌（BOSS 招牌卡等）
    for (var e = 0; e < extra.length; e++) { if (deck.length < total) deck.push(extra[e]); }
    // 兜底补齐/裁剪到精确张数
    while (deck.length < total && items.length) deck.push(pick(items));
    while (deck.length > total) deck.pop();
    // 剔除空（池为空时的极端情况）
    return deck.filter(function (x) { return !!x; });
  }

  var BOSSES = [
    { act: 1, name: '鼠王 · 下水道之主', hp: 50, cards: ['a-058-2', 'a-013-2', 'a-013-2'], gold: 70 },
    { act: 2, name: '黏咕 · 腐化黏液', hp: 70, cards: ['a-012-2', 'a-055-2', 'a-054-2', 'a-089-2'], gold: 95 },
    { act: 3, name: '天狗 · 影之刃', hp: 95, cards: ['a-083-2', 'a-111-2', 'a-055-2', 'a-016-2', 'a-061-2'], gold: 130 }
  ];
  function bossInfo(act) { return BOSSES[Math.min(act, BOSSES.length) - 1]; }

  /* ---------------- 地图生成（由种子决定，同种子同地图） ---------------- */
  function genMap(act, seedBase) {
    var rng = makeRng(hashSeed(seedBase == null ? 1 : seedBase, 0x9e37 + act));
    function rpick(a) { return a[Math.floor(rng() * a.length)]; }
    function rrnd(n) { return Math.floor(rng() * n); }
    var rows = [];
    ROW_PLAN.forEach(function (plan, r) {
      var arr = [];
      for (var c = 0; c < plan.n; c++) {
        var type = plan.types.length === 1 ? plan.types[0] : rpick(plan.types);
        arr.push({ id: act * 1000 + r * 10 + c, row: r, col: c, type: type, next: [], prev: [], cx: 0, cy: 0 });
      }
      rows.push(arr);
    });
    // 计算归一化坐标（0..1），供 UI 定位
    var H = rows.length;
    rows.forEach(function (arr, r) {
      var W = arr.length;
      arr.forEach(function (n, c) {
        n.cx = (c + 1) / (W + 1);
        n.cy = H > 1 ? r / (H - 1) : 0;
      });
    });
    // 连边：保证下一行每个节点都有入边、当前行每个节点都有出边
    for (var i = 0; i < rows.length - 1; i++) {
      var A = rows[i], B = rows[i + 1];
      B.forEach(function (bn, bi) {
        var ai = B.length === 1 ? rrnd(A.length) : Math.round(bi * (A.length - 1) / (B.length - 1));
        link(A[Math.max(0, Math.min(A.length - 1, ai))], bn);
      });
      A.forEach(function (an, ai) {
        if (!an.next.length) {
          var bi = A.length === 1 ? rrnd(B.length) : Math.round(ai * (B.length - 1) / (A.length - 1));
          link(an, B[Math.max(0, Math.min(B.length - 1, bi))]);
        }
        if (rng() < 0.42) link(an, B[rrnd(B.length)]);
      });
    }
    function link(a, b) {
      if (a.next.indexOf(b.id) < 0) a.next.push(b.id);
      if (b.prev.indexOf(a.id) < 0) b.prev.push(a.id);
    }
    return { act: act, rows: rows };
  }

  function allNodes(map) { var r = []; map.rows.forEach(function (a) { a.forEach(function (n) { r.push(n); }); }); return r; }
  function nodeById(map, id) { var f = null; allNodes(map).forEach(function (n) { if (n.id === id) f = n; }); return f; }

  return {
    genMap: genMap, nodeById: nodeById, allNodes: allNodes,
    encounterDeck: encounterDeck, bossInfo: bossInfo, BOSSES: BOSSES
  };
})();

/* ============================================================
 * 跑图管理
 * ========================================================== */
var RunManager = (function () {
  'use strict';

  var run = null;

  function save() { if (run) SaveData.setRun(run); }

  function newRun(deckIds, difficulty, baseHp, seed) {
    run = {
      seed: (seed != null && seed !== '' && !isNaN(seed)) ? ((+seed) >>> 0) : randomSeed(),
      act: 1,
      difficulty: difficulty || 'normal',
      deck: deckIds.slice(),
      relics: [],
      gold: 0,
      hp: baseHp || 30,
      maxHp: baseHp || 30,
      battles: 0,             // 已进入的战斗次数（用于派生每场战斗的种子）
      map: null,
      currentId: null,
      done: [],
      status: 'map',          // map | battle | over | complete
      battle: null,           // 当前战斗节点 id
      battleKind: null        // normal | elite | boss
    };
    run.map = RunData.genMap(1, run.seed);
    save();
    return run;
  }
  function load() {
    var s = SaveData.get();
    if (s.run && s.run.map && s.run.map.rows) { run = s.run; resumeIfInterrupted(); return run; }
    run = null;
    return null;
  }
  function get() { return run; }
  /* 中途刷新 / 退出对局的恢复：
   * 战斗进行中会把 status 置为 'battle'，但对局本身没有存盘。刷新后 status 仍是 'battle'，
   * 而 canEnter() 要求 status === 'map' → 地图上一个节点都进不去（提示"该节点无法到达"）。
   * 这里把状态退回上一个节点（prevId），让那场战斗可以重新挑战。 */
  function resumeIfInterrupted() {
    if (!run || run.status !== 'battle') return false;
    run.currentId = (run.prevId != null) ? run.prevId : null;
    run.battle = null;
    run.battleKind = null;
    run.status = 'map';
    save();
    return true;
  }
  function isActive() { return !!run && run.status !== 'over' && run.status !== 'complete'; }
  function map() { return run ? run.map : null; }
  function currentNode() { return run && run.currentId != null ? RunData.nodeById(run.map, run.currentId) : null; }
  function reachable() {
    if (!run) return [];
    if (run.currentId == null) return run.map.rows[0].slice();
    var n = RunData.nodeById(run.map, run.currentId);
    if (!n) return [];
    var out = [];
    n.next.forEach(function (id) { var m = RunData.nodeById(run.map, id); if (m) out.push(m); });
    return out;
  }
  function canEnter(id) {
    if (!run || run.status !== 'map') return false;
    return reachable().some(function (n) { return n.id === id; });
  }

  function enter(id) {
    if (!canEnter(id)) return null;
    var n = RunData.nodeById(run.map, id);
    run.prevId = run.currentId;             // 记住来路：中途刷新/退出时可退回来重选（战斗不存盘，只能重打）
    run.currentId = id;
    if (n.type === 'battle' || n.type === 'elite' || n.type === 'boss') {
      run.status = 'battle';
      run.battle = id;
      run.battleKind = n.type === 'boss' ? 'boss' : (n.type === 'elite' ? 'elite' : 'normal');
      run.battles = (run.battles || 0) + 1;   // 每场战斗派生不同种子
    }
    save();
    return n;
  }

  // 战斗结束：win / hp / gold
  function finishBattle(win, endHp, gold) {
    if (!run) return;
    run.battle = null;
    if (!win) {
      run.status = 'over'; save();
      if (typeof Achievements !== 'undefined') Achievements.onRunDeath(run);   // 成就：小资历 / 老资历，并打断连续通关
      return;
    }
    run.hp = Math.max(0, Math.min(endHp, run.maxHp));
    run.gold += (gold || 0);
    run.goldEarned = (run.goldEarned || 0) + Math.max(0, gold || 0);            // 成就「财迷」：本趟累计获得的金币
    var node = RunData.nodeById(run.map, run.currentId);
    if (run.done.indexOf(run.currentId) < 0) run.done.push(run.currentId);
    if (node && node.type === 'boss') {
      run.act += 1;
      if (run.act > RunData.BOSSES.length) {
        run.status = 'complete'; save();
        if (typeof Achievements !== 'undefined') Achievements.onRunClear(run);   // 成就：通关类（法师/矿工/大胃袋/大富翁…）
        return;
      }
      run.map = RunData.genMap(run.act, run.seed);
      run.currentId = null;
      run.status = 'map';
      if (run.act === 3) run.act3Clean = true;                                // 进入第三幕：重置「全程未被攻击」标记
    } else {
      run.status = 'map';
    }
    save();
  }

  function resolveNode() {   // 非战斗节点处理完毕
    if (!run) return;
    if (run.done.indexOf(run.currentId) < 0) run.done.push(run.currentId);
    run.status = 'map';
    save();
  }

  function addCard(id) { if (run) { run.deck.push(id); save(); } }
  function addRelic(id) { if (run && run.relics.indexOf(id) < 0) { run.relics.push(id); save(); } }
  function removeCardIdx(i) { if (run && i >= 0 && i < run.deck.length) { run.deck.splice(i, 1); save(); } }
  function heal(n) { if (run) { run.hp = Math.min(run.maxHp, run.hp + n); save(); } }
  function damage(n) { if (run) { run.hp = Math.max(1, run.hp - n); save(); } }
  function buffMaxHp(n) { if (run) { run.maxHp += n; run.hp += n; save(); } }
  function spendGold(n) { if (run && run.gold >= n) { run.gold -= n; save(); return true; } return false; }
  function gainGold(n) { if (run) { run.gold += n; save(); } }

  // 战斗开局参数
  function battleSetup() {
    var kind = run.battleKind || 'normal';
    var deck, aiHp, bossName = null;
    if (kind === 'boss') {
      var b = RunData.bossInfo(run.act);
      // BOSS 招牌卡计入总张数（25/35/40），不再额外追加
      deck = RunData.encounterDeck(Math.min(run.act, 3), 'boss', b.cards);
      aiHp = b.hp; bossName = b.name;
    } else {
      deck = RunData.encounterDeck(Math.min(run.act, 3), kind);
      aiHp = kind === 'elite' ? (30 + run.act * 8) : (24 + run.act * 5);
    }
    // 本场战斗的种子：由跑图种子 + 战斗序号派生（同一跑图同种子可复现）
    var seed = hashSeed(run.seed, 0x51ed, run.battles || 1, run.act);
    return { deck: deck, aiHp: aiHp, bossName: bossName, kind: kind, seed: seed };
  }

  function goldReward(kind) {
    var t = { normal: [11, 20], elite: [30, 46], boss: [70, 95] }[kind] || [10, 18];
    return t[0] + Math.floor(Math.random() * (t[1] - t[0] + 1));
  }

  // 战后卡牌奖励：按幕数取合适的怪物/道具池，返回 3 张不重复
  function cardReward() {
    var act = Math.min(run ? run.act : 1, 3);
    var pool = [];
    if (act <= 1) pool = pool.concat(byTier('C'), byTier('B'));
    else if (act === 2) pool = pool.concat(byTier('B'), byTier('A'));
    else pool = pool.concat(byTier('A'), byTier('B'), byTier('S'));
    pool = pool.concat(byType('throw'), byType('food'), byType('potion'), byType('treasure'),
      byType('scroll'), byType('weapon'), byType('armor'), byType('wand'), byType('ring'), byType('trap'));
    var out = [], guard = 0;
    while (out.length < 3 && guard++ < 200) {
      var id = pool[Math.floor(Math.random() * pool.length)];
      if (out.indexOf(id) < 0) out.push(id);
    }
    return out;
  }
  function byTier(t) { return CARD_LIST.filter(function (c) { return c.type === 'monster' && c.tier === t; }).map(function (c) { return c.id; }); }
  function byType(t) { return CARD_LIST.filter(function (c) { return c.type === t; }).map(function (c) { return c.id; }); }

  // 可作为遗物的神器（未拥有的）
  function relicChoices(n) {
    var owned = (run ? run.relics : []);
    var pool = CARD_LIST.filter(function (c) { return c.type === 'artifact' && owned.indexOf(c.id) < 0; }).map(function (c) { return c.id; });
    var out = [];
    while (out.length < n && pool.length) { out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]); }
    return out;
  }

  return {
    newRun: newRun, load: load, get: get, isActive: isActive,
    map: map, currentNode: currentNode, reachable: reachable, canEnter: canEnter, enter: enter,
    finishBattle: finishBattle, resolveNode: resolveNode,
    resumeIfInterrupted: resumeIfInterrupted,
    addCard: addCard, addRelic: addRelic, removeCardIdx: removeCardIdx,
    heal: heal, damage: damage, buffMaxHp: buffMaxHp, spendGold: spendGold, gainGold: gainGold,
    battleSetup: battleSetup, goldReward: goldReward, cardReward: cardReward, relicChoices: relicChoices
  };
})();
