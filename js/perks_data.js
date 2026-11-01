/* js/perks_data.js —— 学院考核「特技」库
 *
 * 【获取方式】每次升级进入三选一：从库里随机抽 3 个（互不重复、且排除已拥有的），
 *   玩家选 1 个，AI 按 ai 评分自动选 1 个。一次升多级就连续三选一。
 *
 * 【稀有度】普通 common / 优良 fine / 卓越 great / 史诗 epic / 传奇 legend
 *   等级越高，抽到高稀有度的概率越大（见 PERK_LEVEL_WEIGHT）。
 *
 * 【类别】经济 eco / 种族 race / 战斗 battle / 升星 star / 道具 item
 *
 * 【mod 字段 → 效果落地对照】
 *   ── 经济 eco ──
 *   xueAdd       每轮结束时额外获得 N 学时
 *   xueStart     开局立刻获得 N 学时（一次性）
 *   priceMul     买卡价格 ×N（<1 为折扣）
 *   lvCostMul    买等级花费 ×N
 *   expFlat      对战结算时，每场经验 +N（注：不是 expMul —— 那是"按倍率乘"，
 *                本库没有特技用它；modsOf 里仍保留该键的特判，供以后扩展）
 *
 * 【保留键】modsOf 会特殊处理、但当前没有任何特技使用：
 *   expMul / itemWeight / potionWeight / mergeRefund
 *   （历史遗留；写新特技时想用"乘算/对象累加"语义可以直接用，但别以为它们已经在生效）
 *   ── 升星 star（目标：更容易合出高星，不做"返还学时"那种经济效果）──
 *   ownMonWeight   商店里「已拥有的怪物」出现权重 ×N → 直接提高同名卡命中率
 *   freeMonPerRound 每轮白得 N 张随机 1★ 怪物（进背包）= 白送合星材料
 *   chainScore     推进合星链的卡在买卡评分里 +N
 *   bagAdd         背包上限 +N
 *   startMonStar2  开局卡组里的怪物全部提升为 2★
 *   ── 道具 item ──
 *   itemWeight   道具类卡在商店的出现权重 ×N
 *   potionWeight 药水类卡在商店的出现权重 ×N
 *   freeItem     每轮免费获得 N 张道具（随机，不花学时）
 *   freePotion   每轮免费获得 N 张药水（随机，不花学时）
 *   slotsAdd     每轮商品位 +N
 *   freeRefresh  每轮免费刷新次数 +N
 *   ── 战斗 battle ──
 *   atkAll       对局中己方全场怪物攻击 +N
 *   hpAll        对局中己方全场怪物生命 +N
 *   summonAdd    对局中每回合额外召唤 N 次
 *   ── 种族 race（按卡牌 tags 匹配：🫒 橄榄 / 💰 财宝 / 💎 宝石）──
 *   tagAtk       { '🫒': n }：对应标签的怪物攻击 +n
 *   tagHp        { '🫒': n }：对应标签的怪物生命 +n
 *   tagAllAtk    带任意标签的怪物攻击 +N
 *   tagAllHp     带任意标签的怪物生命 +N
 */
(function () {
  'use strict';

  /* 稀有度元信息：名字 + 配色 + 抽取顺序（越大越稀有） */
  var PERK_RARITY = {
    common: { key: 'common', name: '普通', color: '#b9b3a4', rank: 0 },
    fine: { key: 'fine', name: '优良', color: '#6fbf5f', rank: 1 },
    great: { key: 'great', name: '卓越', color: '#5aa8ff', rank: 2 },
    epic: { key: 'epic', name: '史诗', color: '#c07aff', rank: 3 },
    legend: { key: 'legend', name: '传奇', color: '#f0b83c', rank: 4 }
  };
  var PERK_RARITY_ORDER = ['common', 'fine', 'great', 'epic', 'legend'];

  /* 类别元信息 */
  var PERK_CAT = {
    eco: { key: 'eco', name: '经济', color: '#8fd0ff' },
    star: { key: 'star', name: '升星', color: '#f0b83c' },
    item: { key: 'item', name: '道具', color: '#6fbf5f' },
    battle: { key: 'battle', name: '战斗', color: '#ff7a6a' },
    race: { key: 'race', name: '种族', color: '#c07aff' }
  };

  /* 各等级升级时，各稀有度的抽取权重（等级越高，高稀有度越常见）
   *   1 级：只有普通/优良
   *   3 级：开始能见到卓越
   *   4 级：史诗登场、传奇有 1% 念想
   *   5 级：传奇 6% */
  var PERK_LEVEL_WEIGHT = {
    1: { common: 80, fine: 20 },
    2: { common: 58, fine: 35, great: 7 },
    3: { common: 36, fine: 42, great: 20, epic: 2 },
    4: { common: 16, fine: 38, great: 33, epic: 12, legend: 1 },
    5: { common: 4, fine: 20, great: 41, epic: 29, legend: 6 }
  };

  /* ---------------- 特技库 ----------------
   * ai：AI 学生的取用优先级（越小越不爱选）；同类里高稀有度给得更高。
   *      这是"AI 自动选择"的唯一依据，改数值只影响 AI，不影响玩家。 */
  var PERKS = [
    /* ===== 经济 ===== */
    { id: 'eco-1', name: '勤工俭学', rarity: 'common', cat: 'eco', ai: 7,
      desc: '每轮结束时额外获得 2 学时。', mod: { xueAdd: 2 } },
    { id: 'eco-2', name: '精打细算', rarity: 'fine', cat: 'eco', ai: 13,
      desc: '购买卡牌的价格降低 15%。', mod: { priceMul: 0.85 } },
    { id: 'eco-3', name: '奖学金', rarity: 'great', cat: 'eco', ai: 22,
      desc: '每轮结束时额外获得 5 学时，且开局立刻获得 8 学时。', mod: { xueAdd: 5, xueStart: 8 } },
    { id: 'eco-4', name: '师承名门', rarity: 'epic', cat: 'eco', ai: 32,
      desc: '购买等级的花费降低 35%，且对战获得的经验 +1。', mod: { lvCostMul: 0.65, expFlat: 1 } },
    { id: 'eco-5', name: '富可敌国', rarity: 'legend', cat: 'eco', ai: 44,
      desc: '每轮结束时额外获得 9 学时，卡牌价格降低 12%。', mod: { xueAdd: 9, priceMul: 0.88 } },

    /* ===== 升星 ===== */
    /* 升星类不做"返还学时"（那本质是经济类），一律做成「更容易合出高星」：
     * ownMonWeight 商店里"你已经拥有的怪物"出现权重倍率 → 直接提高同名卡命中率；
     * freeMonPerRound 每轮白得 1 张随机 1★ 怪物（进背包）→ 白送一份合星材料；
     * startMonStar2 开局卡组怪物直接 2★。 */
    { id: 'star-1', name: '熟门熟路', rarity: 'common', cat: 'star', ai: 8,
      desc: '商店里「你已经拥有的怪物」出现权重 ×1.5（更容易刷到同名卡）。',
      mod: { ownMonWeight: 1.5 } },
    { id: 'star-2', name: '成套采购', rarity: 'fine', cat: 'star', ai: 15,
      desc: '商店同名卡出现权重 ×2，且推进合星链的卡评分 +10。',
      mod: { ownMonWeight: 2, chainScore: 10 } },
    { id: 'star-3', name: '定向寻购', rarity: 'great', cat: 'star', ai: 25,
      desc: '商店同名卡出现权重 ×2.5，且每轮免费刷新 +1。',
      mod: { ownMonWeight: 2.5, freeRefresh: 1 } },
    { id: 'star-4', name: '量产线', rarity: 'epic', cat: 'star', ai: 36,
      desc: '每轮开始时白得 1 张随机 1★ 怪物卡（放入背包）；商店同名卡权重 ×2。',
      mod: { freeMonPerRound: 1, ownMonWeight: 2 } },
    { id: 'star-5', name: '星辰加冕', rarity: 'legend', cat: 'star', ai: 48,
      desc: '开局时卡组里的怪物全部提升为 2★；商店同名卡出现权重 ×3。',
      mod: { startMonStar2: true, ownMonWeight: 3 } },

    /* ===== 道具 ===== */
    { id: 'item-1', name: '道具行家', rarity: 'common', cat: 'item', ai: 9,
      desc: '每轮免费获得 1 张道具（自动入手，不花学时）。', mod: { freeItem: 1 } },
    { id: 'item-2', name: '药水收藏', rarity: 'fine', cat: 'item', ai: 16,
      desc: '每轮免费获得 1 张药水（疾速 / 冰霜 / 毒气等）。', mod: { freePotion: 1 } },
    { id: 'item-3', name: '背包扩容', rarity: 'great', cat: 'item', ai: 24,
      desc: '背包上限 +3（卡位收紧后，材料全靠背包囤）。', mod: { bagAdd: 3 } },
    { id: 'item-4', name: '免费刷新', rarity: 'epic', cat: 'item', ai: 34,
      desc: '每轮免费刷新次数 +2，商品位 +1。', mod: { freeRefresh: 2, slotsAdd: 1 } },
    { id: 'item-5', name: '万能商店', rarity: 'legend', cat: 'item', ai: 46,
      desc: '每轮商品位 +2、免费刷新 +2，并免费获得 1 张道具与 1 张药水。',
      mod: { slotsAdd: 2, freeRefresh: 2, freeItem: 1, freePotion: 1 } },

    /* ===== 战斗 ===== */
    { id: 'battle-1', name: '磨刀石', rarity: 'common', cat: 'battle', ai: 8,
      desc: '对局中，己方全场怪物攻击力 +3。', mod: { atkAll: 3 } },
    { id: 'battle-2', name: '铁甲护具', rarity: 'fine', cat: 'battle', ai: 15,
      desc: '对局中，己方全场怪物生命 +9。', mod: { hpAll: 9 } },
    { id: 'battle-3', name: '锐锋', rarity: 'great', cat: 'battle', ai: 26,
      desc: '对局中，己方全场怪物攻击 +6、生命 +12。', mod: { atkAll: 6, hpAll: 12 } },
    { id: 'battle-4', name: '战阵演练', rarity: 'epic', cat: 'battle', ai: 36,
      desc: '对局中，己方每回合额外召唤 1 次，且全场攻击 +3。', mod: { summonAdd: 1, atkAll: 3 } },
    { id: 'battle-5', name: '军神', rarity: 'legend', cat: 'battle', ai: 48,
      desc: '对局中，己方全场攻击 +10、生命 +24，且每回合额外召唤 1 次。',
      mod: { atkAll: 10, hpAll: 24, summonAdd: 1 } },

    /* ===== 种族（按卡牌 tags 匹配）===== */
    { id: 'race-1', name: '橄榄园', rarity: 'common', cat: 'race', ai: 8,
      desc: '对局中，己方 🫒 类怪物攻击 +4、生命 +8。', mod: { tagAtk: { '🫒': 4 }, tagHp: { '🫒': 8 } } },
    { id: 'race-2', name: '矿脉开采', rarity: 'fine', cat: 'race', ai: 15,
      desc: '对局中，己方 💎 类怪物攻击 +8。', mod: { tagAtk: { '💎': 8 } } },
    { id: 'race-3', name: '佣兵契约', rarity: 'great', cat: 'race', ai: 26,
      desc: '对局中，己方 💰 类怪物攻击 +8、生命 +12。', mod: { tagAtk: { '💰': 8 }, tagHp: { '💰': 12 } } },
    { id: 'race-4', name: '元素亲和', rarity: 'epic', cat: 'race', ai: 36,
      desc: '对局中，己方所有带标签的怪物攻击 +8、生命 +12。', mod: { tagAllAtk: 8, tagAllHp: 12 } },
    { id: 'race-5', name: '万灵之约', rarity: 'legend', cat: 'race', ai: 48,
      desc: '对局中，己方 🫒/💰/💎 类怪物攻击 +12、生命 +20。',
      mod: { tagAtk: { '🫒': 12, '💰': 12, '💎': 12 }, tagHp: { '🫒': 20, '💰': 20, '💎': 20 } } }
  ];

  var PERK_BY_ID = {};
  PERKS.forEach(function (p) { PERK_BY_ID[p.id] = p; });

  /* ---------------- 抽取 ---------------- */
  function weightTableOf(lv) {
    var k = Math.max(1, Math.min(5, Math.round(lv || 1)));
    return PERK_LEVEL_WEIGHT[k] || PERK_LEVEL_WEIGHT[1];
  }
  function pickRarity(lv, rng) {
    var w = weightTableOf(lv), total = 0, k;
    for (k in w) total += w[k];
    var r = rng() * total, acc = 0;
    for (k in w) { acc += w[k]; if (r < acc) return k; }
    return 'common';
  }
  /* 抽 n 个候选：互不重复、排除已拥有；指定稀有度抽不到就从剩余里补 */
  function rollPerkChoices(lv, rng, owned, n) {
    n = n || 3;
    var have = {};
    (owned || []).forEach(function (id) { have[id] = 1; });
    var pool = PERKS.filter(function (p) { return !have[p.id]; });
    var out = [];
    while (out.length < n && pool.length) {
      var want = pickRarity(lv, rng);
      var cands = pool.filter(function (p) { return p.rarity === want; });
      if (!cands.length) cands = pool;                     // 该稀有度已抽光 → 从剩余里取
      var pick = cands[Math.floor(rng() * cands.length)];
      out.push(pick);
      pool = pool.filter(function (p) { return p.id !== pick.id; });
    }
    return out;
  }
  /* AI 自动选择（取 ai 评分最高；同分随机）
   * ★ 升星类特技额外加权：AI 学生天生不爱攒高星（升星 = 长期投入，短期看不如强卡/学时），
   *   导致模拟对局里 AI 常年停在 1★/2★、高星链推不上去。给升星类 +STAR_AI_BONUS：
   *     · 同稀有度里升星类稳居首选；
   *     · 【跨一级稀有度仍首选】—— 升星类压过"高它一级"的非升星类
   *       （卓越升星 25+13=38 > 史诗非升星 36）；
   *     · 但不越两级（38 < 传奇非升星 44），升星类内部仍按稀有度排序（传奇升星最高）。
   *   只影响 AI（aiPick 仅 AI 调用），玩家三选一不受影响。
   *   取值依据：非升星类各档最高分 common9 / fine16 / great26 / epic36 / legend48，
   *   升星类基础分 8/15/25/36/48 —— 取 +13 恰好让每一项都压过"高一级"的最高分
   *   （最低档 8+13=21>16，最高档 36+13=49>48），而不会越两级。 */
  var STAR_AI_BONUS = 13;
  function aiPick(choices, rng) {
    if (!choices || !choices.length) return null;
    var best = -1, bestList = [];
    choices.forEach(function (p) {
      var s = (p.ai || 0) + (p.cat === 'star' ? STAR_AI_BONUS : 0);
      if (s > best) { best = s; bestList = [p]; }
      else if (s === best) bestList.push(p);
    });
    return bestList[Math.floor((rng ? rng() : Math.random()) * bestList.length)];
  }
  /* 把一组特技 id 汇总成一份 mod 表（同类效果相加、乘数连乘） */
  function modsOf(ids) {
    var out = {};
    (ids || []).forEach(function (id) {
      var p = PERK_BY_ID[id];
      if (!p || !p.mod) return;
      for (var k in p.mod) {
        var v = p.mod[k];
        // 倍率键：连乘。其中 itemWeight / potionWeight / expMul 目前无特技使用（保留键）。
        if (k === 'priceMul' || k === 'lvCostMul' || k === 'itemWeight' || k === 'potionWeight'
          || k === 'expMul' || k === 'ownMonWeight') {
          out[k] = (out[k] == null ? 1 : out[k]) * v;     // 倍率类：连乘
        } else if (k === 'tagAtk' || k === 'tagHp' || k === 'mergeRefund') {
          out[k] = out[k] || {};
          for (var t in v) out[k][t] = (out[k][t] || 0) + v[t];
        } else {
          out[k] = (out[k] || 0) + v;
        }
      }
    });
    return out;
  }

  window.PERK_DATA = {
    RARITY: PERK_RARITY, RARITY_ORDER: PERK_RARITY_ORDER, CAT: PERK_CAT,
    LEVEL_WEIGHT: PERK_LEVEL_WEIGHT,
    list: PERKS, byId: PERK_BY_ID,
    weightTableOf: weightTableOf, pickRarity: pickRarity,
    roll: rollPerkChoices, aiPick: aiPick, modsOf: modsOf,
    // 升星类 AI 加权值：读取或设置（测试用来做"加权开 / 关"对照）；不传参时返回当前值
    starBonus: function (v) { if (v != null) STAR_AI_BONUS = v; return STAR_AI_BONUS; },
    rarityName: function (r) { return (PERK_RARITY[r] || {}).name || r; },
    catName: function (c) { return (PERK_CAT[c] || {}).name || c; }
  };
})();
