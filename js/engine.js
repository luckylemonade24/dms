/* ============================================================
 * 《地牢决斗师-踏上征途》对局引擎  engine.js
 * 事件驱动状态机 + 触发窗口效果栈（策划案 2.6 / 6.4）
 * 所有规则数值以 Rules / cards.js 为准，勿在此处自创。
 * 对外接口：Engine.newGame(opts) / Engine.tryAction(action) /
 *           Engine.resolvePrompt(accept) / Engine.state
 * ========================================================== */
var Engine = (function () {
  'use strict';

  var state = null;
  var iid = 1, uid = 1;
  var listeners = [];

  // 种子随机：本局所有"抽取/概率"都由 seed 决定，同种子可复现
  var seedVal = 0;
  var rngFn = Math.random;
  function rand() { return rngFn(); }
  function seedRandom(seed) {
    seedVal = (seed >>> 0) || 1;
    rngFn = makeRng(seedVal);
    return seedVal;
  }

  /* ---------------- 工具 ---------------- */
  function other(k) { return k === 'A' ? 'B' : 'A'; }
  function ln(i) { return i === 0 ? '左' : i === 2 ? '右' : '中'; }
  function rnd(n) { return Math.floor(rand() * n); }
  function pick(arr) { return arr.length ? arr[rnd(arr.length)] : null; }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // 成就用：每次刷新扫一遍己方场面，记录"达到过的最高值"（攻击力 / 护盾 / 场上数量）
  function achScan() {
    var a = state.ach;
    if (!a || a.off) return;
    var mine = aliveMonsters('A');
    if (mine.length > a.maxBoard) a.maxBoard = mine.length;
    for (var i = 0; i < mine.length; i++) {
      var m = mine[i];
      if (m.atk > a.maxAtk) a.maxAtk = m.atk;
      if (m.cardId === 'a-083-2' && m.atk > a.tenguMax) a.tenguMax = m.atk;
      if (m.cardId === 'a-005-2' && m.atk > a.snailMax) a.snailMax = m.atk;
      if (m.shield > a.maxShield) a.maxShield = m.shield;
    }
  }
  function notify() {
    try { sweepDeadMonsters(); } catch (e) { }      // 渲染前补一次负血清扫（见 sweepDeadMonsters 注释）
    achScan();
    for (var i = 0; i < listeners.length; i++) listeners[i](state);
  }
  function on(fn) { listeners.push(fn); }
  function log(text, cls) { state.log.push({ text: text, cls: cls || '' }); if (state.log.length > 200) state.log.shift(); }
  function emit(evt) { state.events.push(evt); }

  /* ---------------- 卡牌实例 ---------------- */
  // star：怪物星级（学院考核合成用）：1★ = 原始数值，2★ = ×2，3★ = ×3
  // awaken：3★ 觉醒词条 id（学院考核专属）。跟着实例走 —— 回手 / 复生 / 镜像都不丢。
  function makeInstance(cardId, level, star, awaken) {
    return { iid: iid++, cardId: cardId, level: level || 0, star: star || 1, awaken: awaken || null };
  }
  function cardOf(inst) { return CARDS[inst.cardId]; }
  /* 兜底掷词条：只在"3★ 实例上没有 awaken"时用（预设卡组 / 测试直接造 3★ 的情况）。
   * 正常流程下词条是学院【合成 3★】时抽定并写在实例上的，引擎只负责沿用。
   * 用引擎自己的 seeded rand()，同一颗种子结果可复现。 */
  function rollAwaken() {
    if (typeof AWAKEN_ORDER === 'undefined' || !AWAKEN_ORDER || !AWAKEN_ORDER.length) return null;
    return AWAKEN_ORDER[Math.floor(rand() * AWAKEN_ORDER.length)];
  }

  function makePlayer(key, name, isAI, deckIds) {
    // 卡组元素可以是卡牌 id，也可以是 {id, star}（学院考核的升星卡）
    var deck = deckIds.map(function (cid) {
      if (cid && typeof cid === 'object') return makeInstance(cid.id, 0, cid.star || 1, cid.awaken);
      return makeInstance(cid);
    });
    return {
      key: key, name: name, isAI: isAI,
      hp: Rules.PLAYER_HP, maxHp: Rules.PLAYER_HP,
      deck: deck, hand: [], discard: [],
      board: [null, null, null],
      wand: null, artifacts: [], bombs: [],
      poison: 0, acid: 0, rotMarks: 0, poisonBonus: 0,
      summonsLeft: 0, summonsMax: 0, castsLeft: 0, castsMax: 0,
      flags: {}
    };
  }

  /* ---------------- 联机：装载服务器下发的状态 ----------------
   * 联机模式下客户端不参与结算，只把服务器发来的状态放进这个引擎实例当"渲染容器"。
   * 这样 ui.js 里所有 Engine.state 的读法完全不用改 —— 单机/联机共用同一套界面代码。 */
  function load(snap) {
    if (!snap || typeof snap !== 'object') return false;
    state = snap;
    if (typeof snap._iid === 'number') iid = snap._iid;   // 服务端若带了实例计数器就一并同步
    if (typeof snap._uid === 'number') uid = snap._uid;
    notify();
    return true;
  }

  /* ---------------- 建立对局 ---------------- */
  function newGame(opts) {
    opts = opts || {};
    iid = 1; uid = 1;
    pendingQueue.length = 0;          // 清空上一局残留的待决请求
    state = {
      round: 1, active: 'A', phase: 'PREP',
      players: {
        A: makePlayer('A', opts.playerName || '玩家', false, opts.playerDeck || PRESET_DECKS.starter),
        B: makePlayer('B', opts.aiName || '对手', true, opts.aiDeck || PRESET_DECKS.raider)
      },
      winner: null, log: [], events: [], pending: null, busy: false, seed: 0,
      // 待决选择队列也要跟着重置，否则上一局残留的请求会串到新局
      maxRounds: (opts.maxRounds != null ? opts.maxRounds : Rules.MAX_ROUNDS),   // 可按模式覆盖（学院考核：4~12 回合上限）
      noHpFloor: !!opts.noHpFloor,                                                // 学院考核：血量无下限、不因血量≤0提前结束（比的是总输出）
      dealt: { A: 0, B: 0 },                                                     // 双方"造成的总伤害"（学院考核按输出判定胜负）
      healed: { A: 0, B: 0 },                                                    // 双方"恢复的玩家生命"（学院考核里可抵消对手的输出）
      dmgBy: { A: {}, B: {} },                                                   // 按"怪物卡"归因的伤害（key → {卡id: 伤害}），大赛赛后输出排行用
      playerDmgMult: (opts.playerDmgMult != null ? opts.playerDmgMult : 1),      // 对玩家本体的伤害在输出统计里的倍率（学院考核 = 2）
      // ---- 学院特技（战斗 / 种族类）：按阵营打包的 mod 表，由 academy.js 的 newBattleState 传入 ----
      perk: { A: opts.perkA || null, B: opts.perkB || null },
      // ---- 成就统计（由 achievements.js 读取；off = 本局不计入成就，例如学院考核的模拟对局）----
      ach: {
        off: !!opts.achOff, mode: opts.mode || 'battle', done: false,
        throwKills: 0, bombsThisTurn: 0, bombsMax: 0, stolen: 0,
        killsThisTurn: 0, killsMaxTurn: 0, maxHit: 0, maxAtk: 0, maxShield: 0, maxBoard: 0,
        tenguMax: 0, snailMax: 0, crabStreak: 0, crabAttackedTurn: -1, crabReTurn: -1,
        potion: 0, food: 0, scroll: 0, playerAttacked: 0
      }
    };
    // 本局种子：决定洗牌与所有概率判定（同种子可完全复现）
    state.seed = seedRandom(opts.seed != null ? opts.seed : randomSeed());
    // 初始生命（跑图时玩家生命跨战斗继承；难度可调整对手生命）
    if (opts.playerMax) { state.players.A.maxHp = opts.playerMax; state.players.A.hp = opts.playerMax; }
    if (opts.playerHp != null) state.players.A.hp = Math.max(1, Math.min(opts.playerHp, state.players.A.maxHp));
    if (opts.aiHp) { state.players.B.maxHp = opts.aiHp; state.players.B.hp = opts.aiHp; }
    // 神器（遗物）直接置入神器栏，不参与洗牌与抽牌
    // 其余卡牌按种子洗牌后再起手抽 4 张
    ['A', 'B'].forEach(function (k) {
      var p = state.players[k];
      p.artifacts = p.deck.filter(function (c) { return cardOf(c).type === 'artifact'; });
      p.deck = p.deck.filter(function (c) { return cardOf(c).type !== 'artifact'; });
      shuffle(p.deck);
      p.discard = [];
    });
    state.tutorial = !!opts.tutorial;                                          // 教程局：牌库空的提示不刷屏（教程的牌都由步骤发放）
    // ---- BOSS 闯关（晋升之路）：预置 BOSS + 本体锁血 + 技能钩子 ----
    state.bodyLock = !!opts.bodyLock;                                           // 对手本体锁血（不低于 1，永远打不死 → 只能击破 BOSS 取胜）
    state.bossHooks = (opts.bossHooks && typeof opts.bossHooks === 'object') ? opts.bossHooks : null;
    state.bossState = {};
    if (opts.boss) { placeBoss(opts.boss); bossHook('init'); }
    draw('A', Rules.START_HAND, true, { deal: true });
    draw('B', Rules.START_HAND, true, { deal: true });
    var firstKey = (opts.first === 'B') ? 'B' : 'A';
    state.active = firstKey;
    // 后手补偿（通用规则，双方适用）：后手方的初始手牌必定至少含 1 张 C/B 怪物卡
    secondHandCompensate(other(firstKey));
    // AI 起手整备（策略通道）：如"冠军"档的 A 卡 / 过牌保底（由 ai.js 决定，引擎不关心规则）
    if (aiPolicy && aiPolicy.handRig) {
      ['A', 'B'].forEach(function (k) { aiPolicy.handRig(k, state.players[k]); });
    }
    log('—— 对局开始：第 1 大回合，' + state.players[firstKey].name + '先手 ——', 'hl');
    log('本局种子：' + state.seed, 'dim');
    startTurn(firstKey, true);
    notify();
    return state;
  }

  /* 后手补偿：后手方初始手牌保底 1 张 C/B 怪物卡（用 1 换 1，不改变牌库/手牌总数）。
   * 若牌库里没有 C/B 怪则不做任何事（例如纯道具卡组）。 */
  function secondHandCompensate(key) {
    var p = state.players[key];
    if (!p) return;
    var hasBody = p.hand.some(function (c) { var cd = cardOf(c); return cd.type === 'monster' && (cd.tier === 'C' || cd.tier === 'B'); });
    if (hasBody) return;
    var di = -1;
    for (var i = 0; i < p.deck.length; i++) {
      var d = cardOf(p.deck[i]);
      if (d.type === 'monster' && (d.tier === 'C' || d.tier === 'B')) { di = i; break; }
    }
    if (di < 0) return;
    var got = p.deck.splice(di, 1)[0];
    var back = 0;                                  // 换出：优先换掉非怪物卡
    for (var h = 0; h < p.hand.length; h++) { if (cardOf(p.hand[h]).type !== 'monster') { back = h; break; } }
    var out = p.hand.splice(back, 1)[0];
    p.deck.push(out);
    p.hand.push(got);
    log(p.name + '（后手补偿）：初始手牌保底 1 张 C/B 怪物卡', 'eff');
  }

  function removeFromHand(p, iidv, silent) {
    for (var i = 0; i < p.hand.length; i++) {
      if (p.hand[i].iid === iidv) { var c = p.hand.splice(i, 1)[0]; if (!silent) {} return c; }
    }
    return null;
  }
  function removeFromBoard(p, uidv) {
    for (var i = 0; i < p.board.length; i++) if (p.board[i] && p.board[i].uid === uidv) { var m = p.board[i]; p.board[i] = null; return { inst: m, slot: i }; }
    return null;
  }

  /* ---------------- 抽牌 / 弃牌 ---------------- */
  function draw(key, n, silent, opts) {
    var p = state.players[key];
    for (var i = 0; i < n; i++) {
      if (p.deck.length === 0) { if (!silent && !state.tutorial) log(p.name + ' 牌库已空，无法抽牌（不判负）', 'dim'); break; }
      // 「希望抽卡」（AI 策略通道，见 ai.js 的 champion 档）：由 AI 决定是否直接从牌库里取走"最想要的那张"。
      // 挂在 draw() 里，因此**所有抽牌**（每回合抽牌、宝箱/过牌效果）都会经过它 → 过牌越多越容易连锁拿到希望卡。
      // 开局发牌（opts.deal）不走这里——开局由"起手保底"规则单独负责，避免双重叠加。
      var c = null;
      // 手牌已满时不要挑希望卡：否则挑走的好牌会立刻被"手牌上限溢出"洗回牌库底，等于白白浪费一次机会
      if (p.isAI && aiPolicy && aiPolicy.hopePick && !(opts && opts.deal) && p.hand.length < Rules.HAND_LIMIT) {
        var hope = aiPolicy.hopePick(key, p);
        if (hope && hope.iid != null) {
          for (var di = 0; di < p.deck.length; di++) {
            if (p.deck[di].iid === hope.iid) { c = p.deck.splice(di, 1)[0]; break; }
          }
          // 静默计数（仅内部遥测，不写日志、不显示给玩家：属于隐蔽的难度补偿）
          if (c) state.hopeDraws = (state.hopeDraws || 0) + 1;
        }
      }
      if (!c) c = p.deck.pop();
      if (p.hand.length >= Rules.HAND_LIMIT) {
        // 手牌上限溢出：洗回牌库底
        p.deck.unshift(c);
        if (!silent) log(p.name + ' 手牌已满，' + cardOf(c).name + ' 洗回牌库', 'dim');
        continue;
      }
      p.hand.push(c);
      if (!silent) log(p.name + ' 抽了一张牌');
      // 灵能弓：抽牌时对随机敌方怪物造成1点伤害
      var w = findWeaponWith(cardOf(c), 'onDrawDmg') || weaponOnDraw(p);
      if (w) triggerWeaponDraw(w, key);
    }
  }
  function weaponOnDraw(p) {
    for (var i = 0; i < p.board.length; i++) {
      var m = p.board[i];
      if (m && m.weapon && cardOf(m.weapon).mods && cardOf(m.weapon).mods.onDrawDmg) return m;
    }
    return null;
  }
  function findWeaponWith(card, prop) { return null; }
  function triggerWeaponDraw(m, key) {
    var oppKey = other(key);
    var targets = aliveMonsters(oppKey);
    if (!targets.length) return;
    var t = pick(targets);
    log(cardOf(m.weapon).name + ' 触发：对 ' + t.name + ' 造成 ' + cardOf(m.weapon).mods.onDrawDmg + ' 点伤害', 'eff');
    damageMonster(t, oppKey, cardOf(m.weapon).mods.onDrawDmg, {});
  }

  function discardCard(key, iidv, reason) {
    var p = state.players[key];
    var c = removeFromHand(p, iidv);
    if (!c) return null;
    toDiscard(key, c, false);
    var cd = cardOf(c);
    // 露珠：回合结束若存于手牌则进弃牌堆（此处用于通用弃牌时不需要）
    if (reason !== 'hand') log('弃置 ' + cd.name, 'dim');
    return c;
  }
  function discardRandom(key, n) {
    var p = state.players[key];
    for (var i = 0; i < n; i++) {
      if (!p.hand.length) break;
      var idx = rnd(p.hand.length);
      var c = p.hand.splice(idx, 1)[0];
      c.flags = c.flags || {}; c.flags.byOpp = true;   // 随机弃置都是被效果逼的（自然之靴判定）
      toDiscard(key, c, false);
      log(p.name + ' 随机弃置 ' + cardOf(c).name, 'dim');
    }
  }
  // 「进入弃牌堆时」效果：卡面未写「从场上」者，手牌/场上进入弃牌堆均触发
  function onDiscard(inst, key, fromField) {
    var cid = inst.cardId, opp = other(key), op = state.players[opp];
    // 破损纹章补偿：被贴了纹章、且当前等级>0 的防具进入弃牌堆时，在手牌衍生【升级卷轴】
    if (CARDS[cid].type === 'armor' && inst.flags && inst.flags.emblem && inst.level > 0) {
      deriveCard(key, 'a-029-2', inst);
      log('破损纹章补偿：' + cardOf(inst).name + '（Lv' + inst.level + '）进入弃牌堆 → 衍生【升级卷轴】', 'eff');
    }
    switch (cid) {
      case 'a-001-2': draw(key, 1); break;                                  // 宝箱怪：抽1
      case 'a-049-2': searchDeckRandom(key, function (c) { var cd = CARDS[c.cardId]; return cd.type === 'monster' && (cd.tags || []).indexOf('🫒') >= 0; }, 1); break;  // 繁花史莱姆（随机🫒怪物）
      /* 黄昏史莱姆：**仅限「从手牌进入弃牌堆」**才触发（2026-10-25 削弱）。
         fromField=true 表示从场上进弃牌堆（战死 / 被献祭 / 被夺走）→ 不触发。
         触发时由对方玩家自己选择弃置一张手牌。 */
      case 'a-056-2':
        if (fromField) {
          log('黄昏史莱姆：从场上进入弃牌堆，不触发', 'dim');
          break;
        }
        log('黄昏史莱姆：从手牌进入弃牌堆 → 对方选择弃置一张手牌', 'eff');
        requestChoices(opp, [{ from: 'hand', count: 1, exact: true, label: '黄昏史莱姆：选择一张手牌弃置' }]);
        break;
      case 'a-127-02': {   // 矮人武僧：进入弃牌堆时，**自身**攻击力永久+2
        // 成长记在弃牌堆里这个实例上（spawnMonster 会读 cardInst.growthAtk），
        // 所以之后被「国王获得弃牌堆怪物卡 / 澪检索」捞回手牌再上场时，攻击带着 +2。
        inst.growthAtk = (inst.growthAtk || 0) + 2;
        log('矮人武僧：进入弃牌堆，攻击永久+2（' + CARDS[inst.cardId].atk + ' → ' + (CARDS[inst.cardId].atk + inst.growthAtk) + '）', 'eff');
        break;
      }
      case 'a-057-2': { var t2 = pick(aliveMonsters(opp)); if (t2) damageMonster(t2, opp, 3, {}); break; }  // 血红史莱姆
      case 'a-077-2': requestChoices(key, [{ from: 'deck', count: 1, pred: function (c) { return CARDS[c.cardId].type === 'weapon'; }, label: '检索一张武器' }]); break;  // 咒缚灵（定向检索）
      default: break;
    }
  }
  /* 卡牌的「原主」：被疯狂小偷/强盗夺走的手牌、被腐化转移控制权的怪物，
     离开时一律回到**原主**的弃牌堆，而不是当前持有者（玩家裁定）。
     实例上的 origOwner 在夺牌/转移那一刻记下，之后一直跟着它走。 */
  function discardOwnerOf(inst, fallbackKey) {
    var k = inst && inst.origOwner;
    return (k && state.players[k]) ? k : fallbackKey;
  }
  /* 卡被**正常使用**后进弃牌堆（食物/药水/卷轴/投掷物/宝藏打出的那一份）。
     原逻辑是直接 push、不触发「进入弃牌堆时」，这里保持同样的语义，
     只把入堆目标按原主走 —— 腐化怪衍生出来的卡由腐化者使用，用掉后进**原主**弃牌堆（玩家裁定）。 */
  function discardUsed(key, inst) {
    /* virtual：无序魔典 / 炼金工具箱 借用 useScroll / usePotion 跑效果时造的"幽灵实例"，
       它本来就不在任何区域里，用完不能凭空多出一张真卡。 */
    if (inst && inst.virtual) return;
    var rk = discardOwnerOf(inst, key);
    state.players[rk].discard.push(inst);
  }
  // 统一入口：卡牌进入弃牌堆 + 触发「进入弃牌堆时」效果
  function toDiscard(ownerKey, inst, fromField) {
    if (inst && inst.virtual) return;      // 幽灵实例（魔典/工具箱借用的卡）不落堆
    var realKey = discardOwnerOf(inst, ownerKey);
    /* 自然之靴（神器 a-140-02）：因**对手卡牌效果**而进入弃牌堆的**手牌**，
       改为返回牌堆，并在牌堆中增加一张【露珠】（玩家裁定）。
       触发标记 flags.byOpp 由 applyChoice / discardRandom 在"被迫弃牌"时打上。 */
    if (!fromField && inst && inst.flags && inst.flags.byOpp) {
      var bp = state.players[realKey];
      delete inst.flags.byOpp;
      if (bp.artifacts.some(function (a) { return a.cardId === 'a-140-02'; })) {
        /* "返回牌堆"必须**洗进去**，不能 push 到末尾 —— draw 用的是 `deck.pop()`（从末尾抽），
           push 到末尾等于"下一抽立刻原样拿回来"，与卡面语义完全不符。 */
        bp.deck.splice(rnd(bp.deck.length + 1), 0, inst);
        bp.deck.splice(rnd(bp.deck.length + 1), 0, makeInstance('a-018-2'));
        log('自然之靴：' + cardOf(inst).name + ' 返回牌堆，牌堆中增加一张【露珠】', 'eff');
        return;
      }
    }
    if (inst && inst.flags) delete inst.flags.byOpp;
    state.players[realKey].discard.push(inst);
    onDiscard(inst, realKey, !!fromField);
  }

  /* ============================================================
   * 2026-10-23 新卡 131~140 的公共机制
   * ========================================================== */

  /* ---- 净化药水 a-132-02：负面状态免疫 ----
   * 卡面「你的下回合结束前，免疫自身的负面状态」。用 turnCount 记账：
   * 自己回合 T 使用 → 对手 T+1 → 自己 T+2 结束前有效，所以记到 T+2。
   * 覆盖：毒气/酸气、无法攻击（催眠卷轴/时停/觉醒等 p.flags.noAttack 与怪物 flags.noAttack）、
   *       禁止投掷物/法杖（tsNoThrowWand 与 banTW）、禁锢（stunRound）、麻痹陷阱（发动时判定）。
   * **不覆盖**冰霜药水的召唤次数-1 —— 那是资源压制不是负面状态（玩家裁定）。 */
  function cleanseUntilSet(key) {
    var p = state.players[key];
    p.flags.cleanseUntil = (state.turnCount || 1) + 2;
    /* ⚠ 只**免疫**、不**清除**（玩家 2026-10-23 裁定）：
       已有的毒气/酸气层数保留、对手照样能继续往上叠，只是这段时间里对使用者"不生效"——
       毒气/酸气不结算伤害、催眠/时停/封锁/禁锢/麻痹陷阱都施加不上。
       免疫结束后，残留的层数会照常开始结算。 */
    log('净化药水：免疫负面状态（直到 ' + p.name + ' 的下回合结束；已有的层数不清除）', 'eff');
  }
  function negImmune(key) {
    var p = state.players && state.players[key];
    return !!(p && p.flags.cleanseUntil && (state.turnCount || 1) <= p.flags.cleanseUntil);
  }
  /* ============================================================
   * 2026-10-25 恶魔体系 141、143~150 的辅助
   * ========================================================== */

  /* 兜底清扫：正常路径里 hp<=0 的怪应该在 damageMonster / cupStrike 里就被 destroyMonster 处理掉，
     但新卡的「衍生 / 转移 / 替换 / 承担伤害」链路（血巢、撕裂者立刻攻击、古神之拳、YOG 幼虫…）
     加上对局结束时不再有 tryAction，fuzz 里抓到过 board 上残留 hp=-1/-2/-3 的怪。
     每次操作结束、以及每次 notify 前都补一遍，保证没有负血的活怪。 */
  /* 巨型蝎子 a-144-02：**随时自动判定**（玩家 2026-10-25 裁定）——
     只要对位出现敌方怪物，就立刻挪到「己方空位且对位也空」的位置；找不到就返回手牌。
     由 tryAction 的 finally 统一调用：任何能改变棋盘的操作（召唤 / 移动 / 衍生 / 腐化转移）
     让对位出现怪，都会在操作结束时立刻响应，不再等回合结束。 */
  function checkScorpions() {
    if (!state || !state.players) return;
    ['A', 'B'].forEach(function (k) {
      var opp = other(k);
      var p = state.players[k], op = state.players[opp];
      p.board.slice().forEach(function (m) {
        if (!m || m.cardId !== 'a-144-02' || (m.flags && m.flags.dead)) return;
        var s = slotOf(k, m.uid);
        if (s < 0 || !op.board[s]) return;
        var free = [];
        for (var i = 0; i < 3; i++) if (!p.board[i] && !op.board[i]) free.push(i);
        if (free.length) {
          moveMonsterTo(k, m, free[0]);
          log('巨型蝎子：对位出现敌人，立刻移到第 ' + (free[0] + 1) + ' 位', 'eff');
        } else {
          log('巨型蝎子：对位有敌人且无处可移，返回手牌', 'dim');
          leaveBoard(m, k, false);
        }
      });
    });
  }

  function sweepDeadMonsters() {
    if (!state || !state.players) return;
    for (var pass = 0; pass < 5; pass++) {
      var dirty = false;
      ['A', 'B'].forEach(function (k) {
        var bd = state.players[k].board;
        for (var i = 0; i < bd.length; i++) {
          var m = bd[i];
          if (!m) continue;
          /* ① 已经判过死、但位置还占着 → 直接清位（不能再 destroy，否则重复产卡）
             ② 血量掉到 0 以下却没判死 → 补一次死亡结算
             ⚠ 每只单独 try/catch：某只怪的死亡效果抛异常时不能把后面的一起拖下水
               （之前就是被 notify 里的外层 try 吞掉，负血残留没清干净）。 */
          if (m.flags && m.flags.dead) {
            dirty = true; bd[i] = null; break;
          }
          if (!isFinite(m.hp) || m.hp <= 0) {
            dirty = true;
            try { destroyMonster(m, k, {}); } catch (e) { bd[i] = null; }
            break;                       // board 已被改动，重新扫一轮
          }
        }
      });
      if (!dirty) return;
    }
  }

  /* 恶魔撕裂者 a-143-02：立刻攻击对位；对位为空就直接进弃牌堆。
     ⚠ onSummon（手牌召唤）和【恶魔血巢】的衍生都走这里 —— 衍生出来的 token 不触发 onSummon。 */
  function tearStrike(inst, key) {
    var s = slotOf(key, inst.uid);
    if (s < 0) return;
    var foe = state.players[other(key)].board[s];
    if (!foe) {
      log('恶魔撕裂者：对位为空，立即进入弃牌堆', 'dim');
      destroyMonster(inst, key, {});
    } else {
      log('恶魔撕裂者：立刻攻击对位 ' + foe.name, 'eff');
      damageMonster(foe, other(key), inst.atk, { attack: true });
    }
  }

  /* 黑檀宝箱 a-151-02：从牌库**随机**抽一张装备卡（武器/防具）+ 一张升级卷轴进手牌。
     玩家 2026-10-25：使用**不再需要弃牌**，所以这里没有弃牌环节，直接用。
     ⚠ 必须按**实例引用**删牌，不能先记下标再删 —— 删掉第一张后后面的下标全偏移了。 */
  function ebonyDraw(key) {
    var ep = state.players[key];
    var gotEq = null, gotUp = null;
    var eqPool = [], upPool = [];
    for (var i = 0; i < ep.deck.length; i++) {
      var t = cardOf(ep.deck[i]).type;
      if (t === 'weapon' || t === 'armor') eqPool.push(ep.deck[i]);
      if (ep.deck[i].cardId === 'a-029-2') upPool.push(ep.deck[i]);
    }
    if (eqPool.length) {
      var pe = eqPool[rnd(eqPool.length)];
      gotEq = ep.deck.splice(ep.deck.indexOf(pe), 1)[0];
    }
    if (upPool.length) {
      var pu = upPool[rnd(upPool.length)];
      gotUp = ep.deck.splice(ep.deck.indexOf(pu), 1)[0];
    }
    /* ⚠ 手牌满时不能"抽出来又不给" —— 那样这张牌会从牌库凭空消失（玩家会认为宝箱吞卡）。
       放回牌堆，并明确提示。 */
    if (gotEq) {
      if (ep.hand.length < Rules.HAND_LIMIT) {
        ep.hand.push(gotEq); log('黑檀宝箱：获得装备卡 ' + cardOf(gotEq).name, 'eff');
      } else {
        ep.deck.push(gotEq);
        log('黑檀宝箱：手牌已满，装备卡留在牌堆', 'dim');
      }
    }
    if (gotUp) {
      if (ep.hand.length < Rules.HAND_LIMIT) {
        ep.hand.push(gotUp); log('黑檀宝箱：获得【升级卷轴】', 'eff');
      } else {
        ep.deck.push(gotUp);
        log('黑檀宝箱：手牌已满，升级卷轴留在牌堆', 'dim');
      }
    }
    if (!gotEq) log('黑檀宝箱：牌库里没有装备卡（本次没有抽到东西）', 'warn');
    if (!gotUp) log('黑檀宝箱：牌库里没有【升级卷轴】（本次没有抽到东西）', 'warn');
  }

  /* 恶魔血巢 a-148-02：在「己方空位、且该位对方有怪」的格子上衍生一张【恶魔撕裂者】 */
  function nestSpawnTear(m, key) {
    var opp = other(key);
    var slots = [];
    for (var i = 0; i < 3; i++) {
      if (!state.players[key].board[i] && state.players[opp].board[i]) slots.push(i);
    }
    if (!slots.length) { log('恶魔血巢：没有「对位非空」的己方空位', 'dim'); return; }
    var s = slots[rnd(slots.length)];
    var t = summonToken(key, 'a-143-02', { slot: s });
    if (t) {
      log('恶魔血巢：在第 ' + (s + 1) + ' 位衍生【恶魔撕裂者】', 'eff');
      tearStrike(t, key);
    }
  }

  /* ============================================================
   * 2026-10-25 新卡 151~160 的公共机制
   * ========================================================== */

  /* 灵视药水 a-155-02：N 回合内能攻击「无法选中」的目标。
     ⚠ 不是解除对方状态（那是觉醒【灵视】），只是自己看得见 —— 所以判定记在**攻击方**身上。 */
  function seeThrough(key) {
    var p = state.players && state.players[key];
    return !!(p && p.flags.seeThrough && (state.turnCount || 1) <= p.flags.seeThrough);
  }

  /* 充能戒指 a-152-02：在手牌中持续生效（施法无需弃牌），用一次进冷却 2 回合 */
  function chargedRingReady(p) {
    var ring = p.hand.filter(function (c) { return c.cardId === 'a-152-02'; })[0];
    if (!ring) return null;
    if ((p.flags.ringCD || 0) > 0) return null;
    return ring;
  }

  /* 魔典 / 工具箱 可随机到的效果池。
     **包含需要二次选目标的效果**（升级卷轴要选装备、镜像卷轴要选怪、复仇/隐身要选怪）——
     幽灵实例照样能走 requestChoices，只是选的时候要用玩家自己的场况。
     真没目标时由 virtualTargetOk() 拦下并提示「效果无目标」，**次数照样消耗**（玩家 2026-10-25 要求）。 */
  var TOME_SCROLL_POOL = ['a-030-2', 'a-063-2', 'a-088-2', 'a-133-02', 'a-153-02', 'a-029-2', 'a-116-2', 'a-154-02'];
  var TOME_POTION_POOL = ['a-062-2', 'a-087-2', 'a-115-2', 'a-132-02', 'a-155-02', 'a-156-02'];

  /* 需要二次选目标的效果，先看当前场况有没有合法目标。
     返回 false = 无目标（调用方提示「效果无目标」，但次数已经扣掉了）。 */
  function virtualTargetOk(key, cardId) {
    var p = state.players[key];
    if (cardId === 'a-029-2') {          // 升级卷轴：场上有装备，或法杖栏有法杖
      var hasEquip = aliveMonsters(key).some(function (m) { return m.weapon || m.armor; });
      return hasEquip || !!p.wand;
    }
    if (cardId === 'a-116-2') {          // 镜像卷轴：己方有怪 + 有空格
      return aliveMonsters(key).length > 0 && emptySlots(key).length > 0;
    }
    if (cardId === 'a-154-02') return aliveMonsters(key).length > 0;                       // 复仇：要有己方怪
    if (cardId === 'a-156-02') return aliveMonsters(key).some(function (m) { return m.hp <= 9; });  // 隐身：≤9 血
    return true;
  }

  /* 用一个「幽灵实例」跑某张卷轴/药水的效果（不落堆、不进手牌，见 discardUsed/toDiscard 的 virtual 判定） */
  function runVirtualCard(key, cardId, kind) {
    var ghost = { iid: 'ghost' + (++uid), cardId: cardId, level: 0, star: 1, awaken: null, virtual: true };
    var cd = CARDS[cardId];
    if (!cd) return;
    if (kind === 'scroll') useScroll(key, ghost, cd, {});
    else usePotion(key, ghost, cd);
  }

  /* 羊群陷阱 a-158-02：对手使用宝藏/药水卡时**可发动** → 双方所有空位各衍生一张【魔法绵羊】a-142-02。
     「可发动」一律要问持有者（玩家 2026-10-25 定的规矩：所有"可发动"都走弹窗），AI 直接判定发动。 */
  function fireSheepTrap(holderKey, trap) {
    var hp = state.players[holderKey];
    removeFromHand(hp, trap.iid);
    discardUsed(holderKey, trap);
    emit({ type: 'trap', key: holderKey, cardId: 'a-158-02' });
    log((holderKey === 'A' ? '羊群陷阱' : '对手的羊群陷阱') + ' 发动：双方所有空位衍生【魔法绵羊】', 'eff');
    ['A', 'B'].forEach(function (k) {
      emptySlots(k).slice().forEach(function (s) { summonToken(k, 'a-142-02', { slot: s }); });
    });
  }
  function checkSheepTrap(usedKey, usedType) {
    if (usedType !== 'treasure' && usedType !== 'potion') return;
    var holderKey = other(usedKey);
    var hp = state.players[holderKey];
    var trap = hp.hand.filter(function (c) { return c.cardId === 'a-158-02'; })[0];
    if (!trap) return;
    if (hp.isAI) { fireSheepTrap(holderKey, trap); return; }
    state.pending = { kind: 'TRAP_SHEEP', trapIid: trap.iid, actorKey: holderKey };
  }

  /* 无序魔典 a-159-02 / 炼金工具箱 a-160-02：准备阶段点击发动。
     从池里随机三个效果让玩家选一个，**消耗对应种类（卷轴/药水）本回合的使用次数** ——
     次数已耗尽就不能用（玩家 2026-10-25 明确要求）。 */
  function actUseTome(key, action) {
    var p = state.players[key];
    if (state.phase !== 'PREP') return fail('仅准备阶段可使用');
    var kind = action.kind === 'potion' ? 'potion' : 'scroll';
    var artId = kind === 'scroll' ? 'a-159-02' : 'a-160-02';
    var art = p.artifacts.filter(function (a) { return a.cardId === artId; })[0];
    if (!art) return fail('未装备【' + (kind === 'scroll' ? '无序魔典' : '炼金工具箱') + '】');
    if ((art.flags && art.flags.cd) > 0) return fail('冷却中：还需 ' + art.flags.cd + ' 回合');
    var used = p.flags.used || (p.flags.used = {});
    if (used[kind]) return fail('本回合' + (kind === 'scroll' ? '卷轴' : '药水') + '使用次数已耗尽（发动会消耗该类次数）');
    var pool = (kind === 'scroll' ? TOME_SCROLL_POOL : TOME_POTION_POOL).slice();
    var picks = [];
    for (var i = 0; i < 3 && pool.length; i++) picks.push(pool.splice(rnd(pool.length), 1)[0]);
    var cands = picks.map(function (id) {
      return { iid: id, cardId: id, name: CARDS[id].name, type: CARDS[id].type };
    });
    log((kind === 'scroll' ? '无序魔典' : '炼金工具箱') + '：翻开三个' +
      (kind === 'scroll' ? '卷轴' : '药水') + '效果', 'eff');
    requestChoices(key, [{
      cands: cands, action: 'tomePick', count: 1, kind: kind, artIid: art.iid,
      label: '选择其一并发动（消耗本回合该类使用次数）'
    }]);
    return ok();
  }

  /* 统一的「这只怪现在能不能攻击」判定。返回空串 = 可以攻击，否则返回给玩家看的原因。
     ⚠ 必须所有"发起攻击"的入口都走这里，不只 actAttack：
       监狱守卫 a-072-2 是**召唤时（准备阶段）立刻攻击**，老实现直接 damageMonster，
       于是催眠卷轴 / 时光沙漏 / 禁锢 全都管不住它（玩家反馈）。
       注意：新生火元素那种"生命 -1"是**效果伤害**不是攻击，不该受这里限制。 */
  function attackBlockReason(key, inst) {
    var p = state.players && state.players[key];
    if (!p) return '';
    if (negImmune(key)) return '';          // 净化药水：免疫期间一切"禁止攻击"都不生效
    if (p.flags.noAttack) return '受催眠卷轴影响，无法攻击';
    if (p.flags.tsNoAttack) return '时停中：场上所有怪物无法攻击';
    if (inst && inst.flags && inst.flags.noAttack) return '该怪物无法攻击';      // BOSS 技能（懒惰等）
    if (inst && inst.flags && inst.flags.stunRound === state.round) return '该怪物被【禁锢】，本回合无法攻击';
    return '';
  }

  /* 叠加毒气/酸气的统一入口。
     ⚠ 净化状态**不拦叠层**（玩家裁定：对手照样能正常叠加），免疫只体现在"结算时不掉血"——
       见 resolveBuffSettlement。 */
  function addPoison(key, n) {
    if (!(n > 0)) return 0;
    state.players[key].poison += n;
    return n;
  }
  function addAcid(key, n) {
    if (!(n > 0)) return 0;
    state.players[key].acid += n;
    return n;
  }

  /* ---- 投掷物 / 法杖封锁 ----
   * 时停（时光沙漏）与 137 棱光法杖 / 138 闪光陷阱 的「N 回合不能用」统一判定。
   * 返回空串 = 可用；否则返回给玩家看的原因。 */
  function throwWandBanReason(key) {
    var p = state.players[key];
    if (!p) return '';
    /* 净化状态：已有的封锁**不生效**（但标记保留，免疫结束后继续算） */
    if (negImmune(key)) return '';
    if (p.flags.tsNoThrowWand) return '时停中：无法使用投掷物/法杖';
    if (p.flags.banTW > 0) return '被封锁：还需 ' + p.flags.banTW + ' 回合才能使用投掷物/法杖';
    return '';
  }
  function banThrowWand(key, n) {
    if (negImmune(key)) { log(state.players[key].name + ' 处于净化状态，封锁无效', 'dim'); return false; }
    var p = state.players[key];
    p.flags.banTW = Math.max(p.flags.banTW || 0, n);
    log(p.name + ' 接下来 ' + n + ' 回合无法使用投掷物/法杖', 'eff');
    return true;
  }

  /* ---- 蓄血圣杯 a-139-02 ----
   * 失去当前回合数的生命、获得等量生命上限。给这只怪打 cup 标记，
   * 离场（进弃牌堆 / 返回手牌）时把标记和上限收益一起清掉，下次出场可重新吃。
   * 「每只怪物限一次」由 flags.cupUsed 记，离场时一并复位。 */
  function cupStrike(inst, key) {
    var n = state.round || 1;
    /* 失去的生命**可以把它抽干** —— 过度使用圣杯会致死（玩家 2026-10-23 裁定，
       之前"最多掉到 1 点"的保护已去除）。 */
    var lose = Math.min(n, Math.max(0, inst.hp || 0));
    inst.hp -= lose;
    inst.maxHp += lose;
    inst.baseHp = (inst.baseHp || 0) + lose;
    inst.flags.cupGain = (inst.flags.cupGain || 0) + lose;
    inst.flags.cupUsed = true;
    log('蓄血圣杯：' + inst.name + ' 失去 ' + lose + ' 点生命，生命上限 +' + lose +
      '（' + Math.max(0, inst.hp) + '/' + inst.maxHp + '）', 'eff');
    emit({ type: 'float', uid: inst.uid, text: '+' + lose + '上限', kind: 'heal' });
    if (inst.hp <= 0) {
      log('蓄血圣杯：' + inst.name + ' 的生命被抽干', 'death');
      destroyMonster(inst, key, {});
    }
    return lose;
  }
  function stripCupGain(inst) {
    if (!inst || !inst.flags) return;
    var g = inst.flags.cupGain || 0;
    if (g > 0) {
      inst.maxHp = Math.max(1, (inst.maxHp || 1) - g);
      inst.baseHp = Math.max(1, (inst.baseHp || inst.maxHp) - g);
      if (inst.hp > inst.maxHp) inst.hp = inst.maxHp;
    }
    inst.flags.cupGain = 0;
    inst.flags.cupUsed = false;        // 离场后清 tag，下次出场可重新使用圣杯
  }

  /* ---- 腐化 a-136-02 ----
   * 腐化层数 > 当前生命 → 转移到**施法方**（= 当前持有者的对手）随机空位。
   * 玩家裁定：转移后**清空层数**、保留转移那一刻的血量与攻击；
   * 这只怪以后死亡仍进**原主**弃牌堆（origOwner，见 toDiscard）。 */
  function corruptCheck(inst, ownerKey) {
    if (!inst || inst.flags.dead || inst.hp <= 0) return false;
    var c = inst.flags.corrupt || 0;
    if (c <= 0 || c <= inst.hp) return false;
    var toKey = other(ownerKey), slots = emptySlots(toKey);
    if (!slots.length) {
      log('【腐化】' + inst.name + ' 层数(' + c + ')已高于生命，但对方没有空位，暂不转移', 'dim');
      return false;
    }
    var fromSlot = slotOf(ownerKey, inst.uid);
    var toSlot = slots[rnd(slots.length)];
    state.players[ownerKey].board[fromSlot] = null;
    state.players[toKey].board[toSlot] = inst;
    inst.slot = toSlot;
    inst.flags.corrupt = 0;                                // 转移后清空层数
    inst.flags.attacked = false;                           // 换边后本回合的攻击状态重置
    if (!inst.origOwner) inst.origOwner = ownerKey;        // 死亡回原主弃牌堆
    log('【腐化】' + inst.name + ' 层数(' + c + ')高于其生命(' + inst.hp + ')，转移到我方第 ' +
      (toSlot + 1) + ' 位（层数清空，血量攻击不变）', 'eff');
    emit({ type: 'move', uid: inst.uid, key: toKey, slot: toSlot });
    return true;
  }

  /* 觉醒词条：实例生成时的效果（【庞大】改生命、【号令】给友军加攻） */
  function applyAwakenSpawn(inst, key) {
    if (inst.awaken === 'titan') {               // 【庞大】生命在三星基础上翻倍
      inst.maxHp = inst.maxHp * 2;
      inst.hp = inst.maxHp;
    }
    // 【暴怒】的攻击次数也要在这里设一次：回合开始的重置只覆盖"已在场"的怪，
    // 而准备阶段当回合召唤出来的暴怒怪拿到的是创建时的 1，于是当回合只能打一次。
    if (inst.awaken === 'fury') inst.flags.attacksMax = 2;
    // 【号令】召唤时随机一只友军攻击力翻倍（不含自己；已被号令过的跳过，避免叠加）
    if (inst.awaken === 'command') {
      var mates = aliveMonsters(key).filter(function (m) {
        return m.uid !== inst.uid && !m.flags.commanded;
      });
      if (mates.length) {
        var m2 = mates[Math.floor(rand() * mates.length)];
        m2.flags.commanded = true;
        m2.baseAtk = m2.baseAtk * 2;
        recalc(m2);
        log('【号令】' + inst.name + '：' + m2.name + ' 攻击力翻倍（→' + m2.atk + '）', 'eff');
      }
    }
  }

  /* ---------------- 怪物实例化 ---------------- */
  function spawnMonster(key, cardInst, slot) {
    var p = state.players[key], cd = cardOf(cardInst);
    var star = cardInst.star || 1;                 // 星级：2★ 数值 ×2，3★ 数值 ×3
    var bHp = cd.hp * star, bAtk = cd.atk * star;
    // 3★ 觉醒词条（只可能在学院考核出现）：沿用实例上【合成那一刻抽定】的那一个。
    // 召唤 / 回手 / 复活 / 镜像复制都带着它走 —— 一张卡觉醒成什么，在它被合出来时就定死了。
    // 只有实例上确实没有词条时才现掷一次（预设卡组 / 测试直接造 3★），并写回实例，
    // 保证"同一个实例永远是同一个词条"。
    var awaken = cardInst.awaken || null;
    if (!awaken && star >= 3) { awaken = rollAwaken(); cardInst.awaken = awaken; }
    var inst = {
      uid: uid++, cardId: cd.id, name: cd.name, tier: cd.tier, star: star,
      awaken: awaken,
      baseHp: bHp, maxHp: bHp, hp: bHp,
      baseAtk: bAtk, atk: bAtk, growthAtk: cardInst.growthAtk || 0, tempAtk: 0,
      level: 0, weapon: null, armor: null, shield: 0,
      buffs: {}, flags: { attacked: false, attacksMax: 1 },
      slot: slot
    };
    if (awaken) applyAwakenSpawn(inst, key);
    // 学院特技（战斗 / 种族类）的生命加成
    var _pHp = perkHpBonus(CARDS[inst.cardId], key);
    if (_pHp) { inst.maxHp += _pHp; inst.hp += _pHp; }
    if (slot === undefined || slot === null || p.board[slot]) slot = firstEmpty(p);
    p.board[slot] = inst;
    applyInnateFlags(inst);
    recalc(inst);
    log(key === 'A' ? '召唤 ' + cd.name + ' 到' + ln(slot) + '位' : '对手召唤 ' + cd.name + ' 到' + ln(slot) + '位', 'summon');
    emit({ type: 'summon', uid: inst.uid, key: key, cardId: inst.cardId, slot: slot });
    onSummon(inst, key);
    // 召唤陷阱 / 爆炸陷阱：对方召唤后触发
    checkSummonTrap(other(key), key, inst);
    return inst;
  }
  /* 需要「指定一只怪物作为目标」的法杖 —— **单一来源**。
     本清单同时被引擎（actActivateWand 的 needTarget）和 UI（wandNeedsTarget → 选目标模式）读取。
     2026-10-27 的 bug：UI 里自己抄了一份 ['a-021-2','a-091-2']，漏了 136 腐化法杖与
     137 棱光法杖 → 点法杖不进入选目标模式、直接空目标施法被引擎拒绝，表现为「无法选择目标」。
     以后新增这类法杖只改这里，别在 ui.js 再写一份。 */
  var WAND_TARGET_IDS = ['a-021-2', 'a-091-2', 'a-136-02', 'a-137-02'];
  function wandNeedsTargetCard(id) { return WAND_TARGET_IDS.indexOf(id) >= 0; }

  /* 攻击次数的「基础值」。两个地方必须共用它，否则会出现 2026-10-27 那个 bug：
     - 回合开始：把 attacksMax 重置为纯基础值（清掉上一回合的临时加成）
     - 怪物落场（applyInnateFlags）：召唤/衍生的**当回合**就要有正确次数
     以前只写了回合开始那份，召唤当回合停在实例初始值 1。 */
  function baseAttacksMax(m) {
    var n = (m.awaken === 'fury') ? 2 : 1;                          // 觉醒【暴怒】：固定 2 次
    if (m.cardId === 'a-144-02') n = Math.max(n, 3);                // 巨型蝎子：额外 2 次
    if (m.cardId === 'a-147-02') n = Math.max(n, 2);                // 酸液蝎子：额外 1 次
    return n;
  }
  // 固有状态：怨灵在战斗阶段永久无法被攻击（标记为"固有"，暗影斗篷/极影铃虹的临时免疫到期时不会误清）
  function applyInnateFlags(inst) {
    if (inst.cardId === 'a-076-2') { inst.flags.untargetable = true; inst.flags.untargetableInnate = true; }
    /* 魔法绵羊 a-142-02：无法作为目标（攻击 / 投掷物 / 法杖都选不到它）。
       innate 标记确保回合开始的"临时免疫到期"不会把它清掉。 */
    if (inst.cardId === 'a-142-02') { inst.flags.untargetable = true; inst.flags.untargetableInnate = true; }
    /* ★ 攻击次数基础值（2026-10-27 修 bug）：
       以前只有「回合开始」会给 attacksMax 赋值，实例创建时一律是 1 ——
       于是**召唤当回合**巨型蝎子只能攻击 1 次、酸液蝎子 1 次、觉醒【暴怒】1 次，
       要等下个回合才恢复正常。本函数在每一条"怪物进入棋盘"的路径上都会被调用
       （召唤 757 / BOSS 799 / 幼虫衍生 2029 / 衍生 token 2157 / 镜像 3325），
       所以基础值在这里定最不会漏。
       ⚠ 用 Math.max 而不是直接赋值：镜像体是按 src.flags.attacksMax 继承的，
          若源怪被狂怒戒指加成过（4 次），镜像该保 4 而不是被压回 3。 */
    inst.flags.attacksMax = Math.max(inst.flags.attacksMax || 1, baseAttacksMax(inst));
  }
  function firstEmpty(p) { for (var i = 0; i < p.board.length; i++) if (!p.board[i]) return i; return -1; }
  function emptySlots(key) { var p = state.players[key], r = []; for (var i = 0; i < p.board.length; i++) if (!p.board[i]) r.push(i); return r; }
  function aliveMonsters(key) { return state.players[key].board.filter(Boolean); }
  function findMonster(key, uidv) { var b = state.players[key].board; for (var i = 0; i < b.length; i++) if (b[i] && b[i].uid === uidv) return b[i]; return null; }
  function slotOf(key, uidv) { var b = state.players[key].board; for (var i = 0; i < b.length; i++) if (b[i] && b[i].uid === uidv) return i; return -1; }

  /* ---------------- BOSS 闯关（晋升之路）支援 ----------------
   * placeBoss：把 BOSS 预置到对手中位（自定义血量，不触发"召唤时"效果）
   * bossHook：在关键时机（回合开始/结束、BOSS 离场等）回调模式提供的技能
   * bossApi ：暴露给技能实现的安全接口
   */
  function placeBoss(cfg) {
    var p = state.players.B, cd = CARDS[cfg.cardId];
    if (!cd) return null;
    var slot = (cfg.slot != null) ? cfg.slot : 1;                    // 默认中位
    var hp = (cfg.hp != null) ? cfg.hp : cd.hp;
    var atk = (cfg.atk != null) ? cfg.atk : cd.atk;
    var inst = {
      uid: uid++, cardId: cd.id, name: cd.name, tier: cd.tier, star: 1,
      baseHp: hp, maxHp: hp, hp: hp, baseAtk: atk, atk: atk,
      growthAtk: 0, tempAtk: 0, level: 0, weapon: null, armor: null, shield: 0,
      buffs: {}, flags: { attacked: false, attacksMax: 1, isBoss: true }, slot: slot, isBoss: true
    };
    if (cfg.untargetable) { inst.flags.untargetable = true; inst.flags.untargetableInnate = true; }
    if (cfg.noAttack) inst.flags.noAttack = true;
    p.board[slot] = inst;
    applyInnateFlags(inst);
    recalc(inst);
    state.bossUid = inst.uid;
    log('★ BOSS【' + cd.name + '】降临（生命 ' + hp + '）', 'hl');
    emit({ type: 'summon', uid: inst.uid, key: 'B', cardId: inst.cardId, slot: slot });
    return inst;
  }
  function bossInst() { return state.bossUid ? findMonster('B', state.bossUid) : null; }
  function bossApi() {
    return {
      state: state,
      boss: bossInst,
      player: function () { return state.players.A; },
      foe: function () { return state.players.B; },
      alive: function (k) { return aliveMonsters(k); },
      empty: function (k) { return emptySlots(k); },
      slotOf: slotOf,
      damage: function (m, k, n) { return damageMonster(m, k || 'A', n || 0, {}); },
      damagePlayer: function (k, n) { damagePlayer(k || 'A', n || 0, {}); },
      heal: function (m, n) { healMonster(m, n || 0); },
      derive: function (k, id) { deriveCard(k, id); },
      token: function (k, id) { return summonToken(k, id); },
      tokenAt: function (k, id, slot) { return summonToken(k, id, { slot: slot }); },   // 指定栏位衍生（该位必须为空）
      summonEffect: function (m) { if (m && CARDS[m.cardId]) onSummon(m, 'B'); },        // 触发"从手牌召唤上场时"效果
      draw: function (k, n) { draw(k, n || 1); },
      discardRandom: function (k, n) { discardRandom(k, n || 1); },
      destroy: function (m, k, o) { destroyMonster(m, k || 'B', o || {}); },
      recalc: function (m) { recalc(m); },
      rand: rand, log: log
    };
  }
  function bossHook(name, arg) {
    if (!state.bossHooks || state.winner) return;
    var fn = state.bossHooks[name];
    if (typeof fn === 'function') fn(bossApi(), arg);
  }

  /* ---------------- 数值重算 ---------------- */
  // 装备数值随等级替换（策划案：升级提升行数值直接替换基准值）
  function eqModValue(eq, key) {
    if (!eq) return 0;
    var m = CARDS[eq.cardId].mods || {};
    var v = m[key] || 0;
    if (eq.level > 0 && m.upgrade) {
      var u = m.upgrade[Math.min(eq.level, m.upgrade.length) - 1];
      if (u && u[key] != null) v = u[key];
    }
    return v;
  }
  /* 学院特技（战斗 / 种族类）的加成查询。
   * 战斗类：atkAll / hpAll（全场）+ summonAdd（每回合多召唤）
   * 种族类：tagAtk / tagHp 按卡面 tags（🫒 💰 💎…）匹配；tagAllAtk / tagAllHp 对"带任意标签"的怪生效 */
  function perkOf(key, k) {
    var pk = state.perk && state.perk[key];
    return (pk && pk[k]) ? pk[k] : 0;
  }
  function perkAtkBonus(cd, key) {
    var pk = state.perk && state.perk[key];
    if (!pk) return 0;
    var b = pk.atkAll || 0, tags = cd.tags || [];
    if (pk.tagAtk) tags.forEach(function (t) { b += pk.tagAtk[t] || 0; });
    if (pk.tagAllAtk && tags.length) b += pk.tagAllAtk;
    return b;
  }
  function perkHpBonus(cd, key) {
    var pk = state.perk && state.perk[key];
    if (!pk) return 0;
    var b = pk.hpAll || 0, tags = cd.tags || [];
    if (pk.tagHp) tags.forEach(function (t) { b += pk.tagHp[t] || 0; });
    if (pk.tagAllHp && tags.length) b += pk.tagAllHp;
    return b;
  }
  function recalc(inst) {
    var cd = CARDS[inst.cardId], owner = null, ownerKey = null;
    ['A', 'B'].forEach(function (k) { if (findMonster(k, inst.uid)) { owner = state.players[k]; ownerKey = k; } });
    var atk = inst.baseAtk + inst.growthAtk + inst.tempAtk;
    atk += eqModValue(inst.weapon, 'atkBonus');
    atk += eqModValue(inst.armor, 'atkBonus');
    // 金色蜜蜂：我方玩家生命 < 30 时攻击+4（卡面固定阈值 30，不随跑图继承的最大生命变化）
    if (cd.id === 'a-047-2' && owner && owner.hp < Rules.PLAYER_HP) atk += 4;
    // 喷毒花：对位存在怪物且我方场上仅有此卡时攻击+5
    if (cd.id === 'a-048-2' && ownerKey) {
      var opp = state.players[other(ownerKey)];
      var myIdx = slotOf(ownerKey, inst.uid);
      if (aliveMonsters(ownerKey).length === 1 && opp.board[myIdx]) atk += 5;
    }
    if (inst.awaken === 'elite') atk *= 2;      // 觉醒【精英】：攻击力在三星基础上翻倍
    if (ownerKey) atk += perkAtkBonus(cd, ownerKey);   // 学院特技：全场 / 按标签的攻击加成
    inst.atk = Math.max(0, atk);
  }
  function recalcAll() { ['A', 'B'].forEach(function (k) { aliveMonsters(k).forEach(recalc); }); }
  function dmgReduce(inst) {
    var raw = 0;
    raw += eqModValue(inst.armor, 'dmgReduce');
    if (inst.armor && inst.armor.flags) raw += (inst.armor.flags.emblemReduce || 0);   // 破损纹章：每张 +1 减伤（不改变防具等级）
    if (inst.cardId === 'a-005-2') raw += 2;      // 大蜗牛：战斗阶段受到伤害-2
    if (inst.cardId === 'a-032-2') raw += 1;      // 战士B：受到伤害-1
    if (inst.awaken === 'armor8') raw += 8;       // 觉醒【重甲】：自带 8 点减伤
    if (inst.flags && inst.flags.eyeShield) raw += inst.flags.eyeShield;   // 邪恶之眼 a-146-02：回合结束获得的临时减伤
    /* 狼萨满系削减减伤（每层 -1）。★ 必须在这里**回写**掉越界部分：
       reduceCut 是"已被削掉的点数"，如果它涨到超过 raw（比如减伤 3 被削 3 次后又因术士 -2
       把防具降级、raw 掉到 1），就会留下 2 点"负欠账"。表面显示是 0，但之后每当获得新减伤，
       都要先还这 2 点债才能看见正数 —— 玩家体验就是"加了减伤却没涨"。
       这里把 reduceCut 钳到 raw，欠账立即清零，新减伤马上生效。 */
    var cut = inst.reduceCut || 0;
    if (cut > raw) { inst.reduceCut = cut = raw; }
    return Math.max(0, raw - cut);
  }
  // 狼萨满系（青狼B a-106-2 / 紫狼A a-109-2）：主动攻击后，若目标减伤＞1，则其减伤-1
  // mul：卡牌效果倍率（紫狼萨满作 BOSS 时由【萨满王】放大，见 atk.flags.effectMul）
  function cutTargetReduce(t, srcId, mul) {
    if (!t || t.flags.dead) return;
    mul = mul || 1;
    if (dmgReduce(t) > 1) {
      // 写入时也钳制：削减量不能超过「不含削减的原始减伤」，否则会留下负欠账（见 dmgReduce）
      var raw = dmgReduce(t) + (t.reduceCut || 0);
      t.reduceCut = Math.min((t.reduceCut || 0) + mul, raw);
      log(CARDS[srcId].name + '：' + t.name + ' 减伤-' + mul + '（现减伤 ' + dmgReduce(t) + '）', 'eff');
    }
  }

  /* ---------------- 伤害 ---------------- */
  // 伤害归因：记录"某一方造成的总伤害"（学院考核比总输出用；credit 传 null 表示自伤，不计给任何一方）
  function creditDamage(side, n) {
    if (!side || !(n > 0)) return;
    state.dealt[side] = (state.dealt[side] || 0) + n;
  }
  /* 伤害来源记账：记"某张怪物卡打出了多少伤害"（大赛赛后输出排行用）。
   * 只有由怪物主动攻击（含攻击附带的追加伤害、打脸）产生的伤害才带 opts.src；
   * 反击（黏咕/遗言）、毒气、投掷物、法杖等不传 src → 不计入排行。 */
  function creditSrc(src, n) {
    if (!src || !src.card || !(n > 0)) return;
    var by = src.by || 'A';
    var m = state.dmgBy[by] || (state.dmgBy[by] = {});
    m[src.card] = (m[src.card] || 0) + n;
  }
  // 记录"局内恢复的玩家生命"：学院考核结算时用来抵消对手输出
  function creditHeal(side, n) {
    if (!side || !(n > 0) || !state.healed) return;
    state.healed[side] = (state.healed[side] || 0) + n;
  }
  function damageMonster(inst, ownerKey, amount, opts) {
    opts = opts || {};
    if (inst.flags.dead) return 0;
    /* 魔法绵羊 a-142-02：无法受到任何伤害（攻击 / 投掷物 / 法杖 / 效果伤害一律免疫） */
    if (inst.cardId === 'a-142-02' && amount > 0) { log('魔法绵羊：无法受到任何伤害', 'dim'); return 0; }
    /* 古神之拳 a-149-02：为中位的怪物承担伤害 —— 中位那只友方怪挨打时，伤害改由拳来吃 */
    if (inst.cardId !== 'a-149-02' && !opts.fromGuard && slotOf(ownerKey, inst.uid) === 1) {
      var fistGuard = aliveMonsters(ownerKey).filter(function (x) { return x.cardId === 'a-149-02'; })[0];
      if (fistGuard) {
        log('古神之拳：为中位的 ' + inst.name + ' 承担伤害', 'eff');
        return damageMonster(fistGuard, ownerKey, amount, Object.assign({}, opts, { fromGuard: true }));
      }
    }
    var dmg = amount;
    // 锈蚀形态：每次受到伤害至多 6 点
    if (inst.cardId === 'a-149-02' && inst.flags.fistForm === 'rust' && dmg > 6) {
      log('古神之拳（锈蚀）：伤害 ' + dmg + ' → 6', 'eff');
      dmg = 6;
    }
    if (opts.attack) {
      // 巨钳蟹：战斗阶段中仅受到一次伤害
      if (inst.cardId === 'a-008-2') {
        if (inst.flags.tookDamageThisBattle) { log('巨钳蟹 本战斗阶段已受伤，免疫该次伤害', 'eff'); return 0; }
        inst.flags.tookDamageThisBattle = true;
      }
      // 闪避（水道巨蛇）
      if (inst.cardId === 'a-003-2' && rand() < 0.4) { log(inst.name + ' 触发【闪避】', 'eff'); emit({ type: 'float', uid: inst.uid, text: '闪避', kind: 'dodge' }); return 0; }
      // 反伤（卡面带【反伤】词缀，当前卡库暂无，预留）
    }
    /* 减伤：主动攻击（opts.attack）与**投掷物**（opts.reduce）都吃。
       ★ 以前这行写在 `if (opts.attack) { … }` 里面 —— 投掷物走的是 `damageMonster(t, opp, dmg, {})`，
         于是苦无/飞刀/飞斧打在有减伤的怪身上是**满伤害**，与"减伤"的直觉完全相反。
         玩家裁定：投掷物也要受减伤影响（战士B 自带 1 减伤 → 苦无 3 点只打 2 点）。
       觉醒【破甲】opts.ignoreReduce 仍然无视减伤。 */
    if ((opts.attack || opts.reduce) && !opts.ignoreReduce) {
      var cut = dmgReduce(inst);
      if (cut > 0 && dmg > 0) {
        // 投掷物补一条日志：否则玩家只看到"苦无 3 点"却掉了 2 血，会以为是 bug
        if (opts.reduce) log(inst.name + ' 减伤 -' + cut + '（' + dmg + ' → ' + Math.max(0, dmg - cut) + '）', 'dim');
        dmg = Math.max(0, dmg - cut);
      }
    }
    if (dmg <= 0 && (opts.attack || opts.reduce)) { emit({ type: 'float', uid: inst.uid, text: '0', kind: 'dmg' }); return 0; }
    // 护盾优先吸收
    if (inst.shield > 0 && dmg > 0) {
      var absorb = Math.min(inst.shield, dmg);
      inst.shield -= absorb; dmg -= absorb;
      log(inst.name + ' 护盾吸收 ' + absorb + ' 点（剩余护盾 ' + inst.shield + '）', 'eff');
      if (dmg <= 0) { emit({ type: 'float', uid: inst.uid, text: '盾', kind: 'dodge' }); return 0; }
    }
    /* 矮人武僧 / 武僧大师：每回合受到的**首次**伤害减半 */
    if ((inst.cardId === 'a-127-02' || inst.cardId === 'a-128-02') && !inst.flags.halfDone && dmg > 0) {
      inst.flags.halfDone = true;
      var half = Math.ceil(dmg / 2);
      log(inst.name + '：【首次伤害减半】' + dmg + ' → ' + half, 'eff');
      dmg = half;
    }
    /* 矮人国王：己方有国王且"名字带矮人"的怪≥2 时，伤害由它们分摊（先减伤、后分摊，余数归原目标）。
       ⚠ 判定用 isNameDwarf（文字口径），不是 isDwarf（💎 种族图标）——
         否则魔像/能源塔这些💎但名字不带"矮人"的怪受伤也会被拉进分摊。 */
    if (dmg > 0 && !opts.shared && isNameDwarf(inst) && dwarfShareOn(ownerKey)) {
      dmg = shareDwarfDamage(inst, ownerKey, dmg, opts);
    }
    inst.hp -= dmg;
    creditDamage((opts.credit !== undefined) ? opts.credit : other(ownerKey), dmg);
    creditSrc(opts.src, dmg);                                   // 按怪物卡归因（攻击流程才带 src）
    emit({ type: 'float', uid: inst.uid, text: '-' + dmg, kind: 'dmg' });
    log(inst.name + ' 受到 ' + dmg + ' 点伤害（剩余 ' + Math.max(0, inst.hp) + '）', 'dmg');
    // 新卡：豺狼暴徒（B）/ 重甲暴徒（A）—— 生命跌破阈值时获得 4 点护盾与攻击加成；
    // 回血到阈值以上后标记解除（同黏咕），再次跌破可再次发动
    if (inst.hp > 0 && (inst.cardId === 'a-105-2' || inst.cardId === 'a-108-2') && !inst.flags.thugBuff) {
      var thr = (inst.cardId === 'a-105-2') ? 4 : 6;
      if (inst.hp < thr) {
        var ab = (inst.cardId === 'a-105-2') ? 3 : 5;
        inst.flags.thugBuff = true;
        inst.shield += 4; inst.baseAtk += ab; recalc(inst);
        log(inst.name + ' 触发：生命＜' + thr + ' → 获得 4 点护盾，攻击+' + ab, 'eff');
        emit({ type: 'float', uid: inst.uid, text: '+4盾', kind: 'heal' });
      }
    }
    // 苍蝇群：仅"本体"（非衍生体）在生命＜6 时可衍生一张 1/1 苍蝇群；恢复至 ≥6 后可再次触发
    if (inst.cardId === 'a-007-2' && !inst.flags.token) {
      if (inst.hp >= 6) inst.flags.flySpawned = false;
      else if (inst.hp > 0 && !inst.flags.flySpawned) {
        inst.flags.flySpawned = true;
        if (emptySlots(ownerKey).length) { summonToken(ownerKey, 'a-007-2', { hp: 1, atk: 1 }); log('苍蝇群：衍生一张 1/1 苍蝇群', 'eff'); }
      }
    }
    // 克里弗斯之果：受到主动攻击时，对方叠加 2 层【毒气】+ 我方每张 🫒 怪额外 +1
    if (opts.attack && inst.cardId === 'a-055-2') {
      // 「我方场上每有一张🫒类怪物额外+1层」：含自身（自身也带🫒标签）
      var olives = aliveMonsters(ownerKey).filter(function (m) { return (CARDS[m.cardId].tags || []).indexOf('🫒') >= 0; }).length;
      var addP = 2 + olives;
      addPoison(other(ownerKey), addP);
      log('克里弗斯之果：对方叠加 ' + addP + ' 层【毒气】', 'eff');
    }
    // 天狗：受到伤害时移动
    if (inst.cardId === 'a-083-2' && inst.hp > 0) tenguMove(inst, ownerKey);
    // 黏咕：生命≤10 时对敌方所有怪物造成10点伤害
    if (inst.cardId === 'a-012-2' && inst.hp <= 10 && !inst.flags.gumBurst) {
      inst.flags.gumBurst = true;
      log('黏咕 触发：对敌方所有怪物造成 10 点伤害', 'eff');
      aliveMonsters(other(ownerKey)).slice().forEach(function (m) { damageMonster(m, other(ownerKey), 10, {}); });
    }
    /* 2026-10-25 恶魔体系：受伤触发的衍生（每回合各限一次，避免互相触发无限循环） */
    if (inst.hp > 0 && !inst.flags.dead) {
      /* 血巢的衍生改到下面单独处理（不再有"每回合一次"限制） */
      /* YOG a-150-02：卡面是「每当受到伤害时」→ **每次受伤都衍生**，不限制每回合一次
         （玩家 2026-10-25 指出同回合被连打不会多生幼虫）。 */
      if (inst.cardId === 'a-150-02') {
        var larvaSlots = emptySlots(ownerKey);
        if (larvaSlots.length) {
          summonToken(ownerKey, 'a-141-02', { slot: larvaSlots[rnd(larvaSlots.length)] });
          log('YOG：受到伤害，在己方空位衍生【古神幼虫】', 'eff');
        } else {
          log('YOG：己方没有空位，无法衍生幼虫', 'dim');
        }
      }
      /* 恶魔血巢 a-148-02：**不受每回合一次约束**（玩家 2026-10-25 裁定）——
         每次受伤都衍生。加一个同帧深度保护，避免「血巢受伤 → 撕裂者攻击 → 又打血巢」无限递归。 */
      if (inst.cardId === 'a-148-02') {
        if (!state._nestDepth) state._nestDepth = 0;
        if (state._nestDepth < 3) {
          state._nestDepth += 1;
          try { nestSpawnTear(inst, ownerKey); } finally { state._nestDepth -= 1; }
        } else {
          log('恶魔血巢：本次受伤的衍生已到递归上限，跳过', 'dim');
        }
      }
    }
    /* 腐化（a-136-02）：受伤让生命下降后，层数可能反过来高于当前生命 → 立刻判定转移。
       放在死亡判定之前：还活着才可能被腐化带走。 */
    if (inst.hp > 0 && inst.flags.corrupt > 0) corruptCheck(inst, ownerKey);
    if (!inst.flags.dead && inst.hp <= 0) destroyMonster(inst, ownerKey, opts);
    // BOSS 技能：本体受伤后（【磁塔】等"生命降到阈值以下"需即时触发，会影响本回合后续攻击）
    else if (state.bossUid && inst.uid === state.bossUid) bossHook('bossDamaged', inst);
    return dmg;
  }
  function damagePlayer(key, amount, opts) {
    opts = opts || {};
    var p = state.players[key];
    if (state.winner) return;
    p.hp -= amount;
    creditDamage(other(key), amount * (state.playerDmgMult || 1));   // 打脸输出可加倍（学院考核 ×2）
    creditSrc(opts.src, amount);                                     // 打脸也算该怪物卡的输出
    // BOSS 闯关：对手本体锁血（不低于 1，永远打不死 → 只能靠击破 BOSS 取胜）
    if (state.bodyLock && key === 'B' && p.hp < 1) p.hp = 1;
    emit({ type: 'float', player: key, text: '-' + amount, kind: 'dmg' });
    log(p.name + ' 受到 ' + amount + ' 点伤害（剩余 ' + (state.noHpFloor ? p.hp : Math.max(0, p.hp)) + '）', 'dmg');
    if (state.bodyLock && key === 'B') return;                        // 锁血方不参与胜负判定
    // 学院考核（noHpFloor）：血量可以扣成负数，对局继续打满回合上限，只比双方累计输出
    if (!state.noHpFloor && p.hp <= 0) { p.hp = 0; state.winner = other(key); log('—— ' + state.players[state.winner].name + ' 获胜！——', 'hl'); }
  }
  function healMonster(inst, amount) {
    var before = inst.hp; inst.hp = Math.min(inst.maxHp, inst.hp + amount);
    var d = inst.hp - before; if (d > 0) { emit({ type: 'float', uid: inst.uid, text: '+' + d, kind: 'heal' }); log(inst.name + ' 恢复 ' + d + ' 点生命', 'heal'); }
    // 苍蝇群本体：恢复到 ≥6 生命后，可再次触发衍生
    if (inst.cardId === 'a-007-2' && inst.hp >= 6) inst.flags.flySpawned = false;
    // 黏咕：回血到 >10 后重新具备"生命≤10 时群体10伤"的引爆能力（可二次引爆）
    if (inst.cardId === 'a-012-2' && inst.hp > 10) inst.flags.gumBurst = false;
    // 豺狼暴徒 a-105-2（阈值 4）/ 重甲暴徒 a-108-2（阈值 6）：回血到阈值以上后，重新具备
    // 「生命＜阈值时获得 4 点护盾并攻击提升」的能力 → 与黏咕一致，可再次发动
    if (inst.flags.thugBuff) {
      var thugThr = (inst.cardId === 'a-105-2') ? 4 : (inst.cardId === 'a-108-2') ? 6 : 0;
      if (thugThr && inst.hp >= thugThr) {
        inst.flags.thugBuff = false;
        log(inst.name + '：生命回到 ' + inst.hp + '（≥' + thugThr + '），技能可再次发动', 'dim');
      }
    }
  }
  function healPlayer(key, amount) {
    var p = state.players[key], before = p.hp; p.hp = Math.min(p.maxHp, p.hp + amount);
    var d = p.hp - before;
    if (d > 0) { creditHeal(key, d); emit({ type: 'float', player: key, text: '+' + d, kind: 'heal' }); log(p.name + ' 恢复 ' + d + ' 点生命', 'heal'); }
  }

  /* ---------------- 死亡 / 弃置 ---------------- */
  // 收牌：手牌未满则进手牌，满了洗回牌库（遵循"溢出洗回"规则）
  function gainCard(p, card, label) {
    if (p.hand.length >= Rules.HAND_LIMIT) { p.deck.unshift(card); log((label || '') + '手牌已满，' + cardOf(card).name + ' 洗回牌库', 'dim'); }
    else p.hand.push(card);
  }
  // 统一处理：怪物离开场上（死亡/献祭/返回手牌/离场）时，其装备必须回归手牌并保留等级
  function returnEquipment(m, ownerKey) {
    var p = state.players[ownerKey];
    // 镜像卷轴带来的装备：离场时直接消失，不回手
    if (m.weapon && m.weapon.isMirror) { log('镜像装备 ' + cardOf(m.weapon).name + ' 随镜像一同消失', 'dim'); m.weapon = null; }
    if (m.armor && m.armor.isMirror) { log('镜像装备 ' + cardOf(m.armor).name + ' 随镜像一同消失', 'dim'); m.armor = null; }
    if (m.weapon) { var w = m.weapon; m.weapon = null; log(m.name + ' 的 ' + cardOf(w).name + ' 回归手牌（保留 Lv' + (w.level || 0) + '）', 'dim'); gainCard(p, w, m.name + ' 的装备'); }
    if (m.armor) { var a = m.armor; m.armor = null; log(m.name + ' 的 ' + cardOf(a).name + ' 回归手牌（保留 Lv' + (a.level || 0) + '）', 'dim'); gainCard(p, a, m.name + ' 的装备'); }
  }
  // 怪物离场（返回手牌 / 进入弃牌堆）：装备统一归还，本体按去向处理
  function leaveBoard(m, ownerKey, toDisc) {
    var p = state.players[ownerKey];
    var i = slotOf(ownerKey, m.uid);
    if (i >= 0) p.board[i] = null;
    stripCupGain(m);          // 蓄血圣杯：离场即清除 cup 标记与上限收益（下次出场可重新吃）
    if (state.bossUid && m.uid === state.bossUid) bossHook('bossLeave', m);   // BOSS 离场（如疯狂强盗回手）
    returnEquipment(m, ownerKey);
    m.flags.offBoard = true;
    // ★ 镜像体（镜像卷轴 a-116-2 / 觉醒【幻象】产生）永远不会变成手牌：
    //   任何"返回手牌"一律视作销毁（进弃牌堆）—— 否则镜像的 深蓝蝾螈 / 喷毒花 / 疯狂小偷 等
    //   "回合结束返回手牌"的怪会把复制体送回手牌，等于凭空多出一张真卡。
    if (!toDisc && m.flags.mirror) { log('镜像体 ' + m.name + ' 无法返回手牌 → 视作销毁', 'eff'); toDisc = true; }
    if (toDisc) {
      // 镜像体不是卡：离场即消散，不能变成弃牌堆里的真卡（同 destroyMonster）
      if (m.flags.mirror) { log('镜像体 ' + m.name + ' 消散（复制品不进入弃牌堆）', 'dim'); return null; }
      // 进弃牌堆也要带着永久成长（武僧的 +2 需要能叠加）
      var dc = makeInstance(m.cardId, m.level, m.star, m.awaken);
      dc.growthAtk = m.growthAtk || 0;
      if (m.origOwner) dc.origOwner = m.origOwner;      // 被腐化转移的怪：回原主弃牌堆
      toDiscard(ownerKey, dc, true);
      return null;
    }
    var ni = makeInstance(m.cardId, m.level, m.star, m.awaken);
    ni.growthAtk = m.growthAtk || 0;
    if (m.origOwner) ni.origOwner = m.origOwner;
    ni.returnedTurn = state.turnCount;      // 「本回合被回手」标记：供 AI 识别"反复出场回手"的自我循环
    gainCard(p, ni, m.name + ' 返回手牌：');
    return ni;
  }

  function destroyMonster(inst, ownerKey, opts) {
    opts = opts || {};
    inst.flags.dead = true;
    var p = state.players[ownerKey];
    var slot = slotOf(ownerKey, inst.uid);
    /* 蓄血圣杯：**任何**死亡路径都要先清 cup 标记与上限收益 —— 包括下面澪 / 觉醒复生这些
       "提前 return 的复活分支"（那里也是先死了一次）。否则复活后会出现 hp > maxHp 的非法状态
       （实测：澪吃了圣杯被打死 → 复活 hp 10 但 maxHp 还带着圣杯加的 8）。 */
    stripCupGain(inst);
    /* 澪：首次从场上进入弃牌堆后复活，**并从弃牌堆检索任意一张怪物卡/药水卡**
       （旧实现是原地满血复活、不进弃牌堆、也没有检索；卡面已改）

       ★ 镜像体（镜像卷轴 / 觉醒【幻象】的复制品）**同样能触发这条效果**（用户裁定），
         但它是复制品、不是卡，所以：
         ① **不执行 toDiscard** —— 否则弃牌堆会凭空多一张真澪（实测就是这么漏的）
         ② 复活时生命上限从 1 提到 10 —— 镜像体上限本来是 1（`createMirror` 里 baseHp/maxHp/hp 全是 1），
            只把 hp 写成 10 会显示成「♥10/1」
         ③ `flags.revived` 照常置位 → 它复活后再死一次就走下面 `inst.flags.mirror` 的
            **消散**分支，不会进弃牌堆（用户要求）
         ④ 复制时是否拥有这次复活机会，由 `createMirror` 复制本体的 `flags.revived` 决定
            （本体已经用掉 → 复制品没有） */
    if (inst.cardId === 'a-100-2' && !inst.flags.revived) {
      inst.flags.revived = true;
      p.board[slot] = null;                            // 真的先离场
      returnEquipment(inst, ownerKey);
      var ghost = null;
      if (!inst.flags.mirror) {
        ghost = makeInstance(inst.cardId, inst.level, inst.star, inst.awaken);
        /* ghost 也要带上原主标记：被腐化转移的澪，这张卡要进**原主**的弃牌堆
           （否则 toDiscard 会按当前持有者入堆，和"复活回原主"自相矛盾）。 */
        if (inst.origOwner) ghost.origOwner = inst.origOwner;
        toDiscard(ownerKey, ghost, true);              // 进入弃牌堆（触发「进入弃牌堆时」）
        log('澪：首次进入弃牌堆 → 复活（10 点生命）', 'eff');
      } else {
        inst.maxHp = Math.max(inst.maxHp || 1, 10);    // 复制品：上限 1 → 10
        inst.baseHp = inst.maxHp;
        log('澪（镜像体）：复活（10 点生命），复制品不进入弃牌堆', 'eff');
      }
      /* 复活是回到 10 点生命，上限必须至少 10，否则会造出 hp > maxHp 的非法状态
         （真澪卡面上限 20 时这里不起作用；但被削过上限 / 外部构造的实例需要兜底）。 */
      inst.maxHp = Math.max(inst.maxHp || 1, 10);
      inst.baseHp = Math.max(inst.baseHp || 1, 10);
      inst.hp = 10; inst.flags.dead = false;
      /* ★ 复活落点 = **当前控制者**（不是原主）：澪的复活用的是"场上这只怪"，它还处在腐化控制之下，
         所以复活在腐化者场上、也只给腐化者检索（玩家 2026-10-23 裁定）。
         只有它**真正死亡**（第二次、`flags.revived` 已置位）时，那张卡才按 origOwner 回原主弃牌堆
         —— 见下面的 deathCard 分支。这与矮人尸群的"延迟复活"不同：尸群是从**弃牌堆里那张卡**
         拉回来的（卡已归原主），所以它在原主场复活。 */
      var slot2 = (p.board[slot] === null) ? slot : emptySlots(ownerKey)[0];
      if (slot2 !== undefined && slot2 !== null) {
        p.board[slot2] = inst;
        emit({ type: 'float', uid: inst.uid, text: '复活', kind: 'heal' });
      } else {
        log('澪：场上没有空位，留在弃牌堆', 'dim');
      }
      requestChoices(ownerKey, [{
        from: 'discard', count: 1,
        pred: function (c) {
          return (!ghost || c.iid !== ghost.iid) &&
            (cardOf(c).type === 'monster' || cardOf(c).type === 'potion');
        },
        label: '澪：从弃牌堆检索一张怪物卡/药水卡'
      }]);
      return;
    }
    // 觉醒【复生】：死亡时以 10 点生命复活一次（照 a-100-2 的范式）
    if (inst.awaken === 'reborn' && !inst.flags.reborned) {
      inst.flags.reborned = true;
      inst.hp = Math.min(10, inst.maxHp);
      inst.flags.dead = false;
      log('【复生】' + inst.name + ' 以 ' + inst.hp + ' 点生命复活', 'eff');
      emit({ type: 'float', uid: inst.uid, text: '复生', kind: 'heal' });
      return;
    }
    // BOSS 技能：本体将死（可被技能救回，如【意志】；救回后本次死亡取消）
    if (state.bossUid && inst.uid === state.bossUid) {
      bossHook('bossDying', inst);
      if (!inst.flags.dead) return;
    }
    // 成就「双杀」：本回合击破敌方怪物数（献祭等自己消除的不算）
    if (state.ach && !state.ach.off && ownerKey === 'B' && !opts.sacrifice) {
      state.ach.killsThisTurn += 1;
      if (state.ach.killsThisTurn > state.ach.killsMaxTurn) state.ach.killsMaxTurn = state.ach.killsThisTurn;
    }
    p.board[slot] = null;
    // （圣杯收益已在函数开头统一清过，见上面的注释）
    // 装备回归手牌并保留升级等级
    returnEquipment(inst, ownerKey);
    /* ★ 镜像体（镜像卷轴 / 觉醒【幻象】的复制品）**不是卡**，死亡时直接消散、绝不能进弃牌堆。
       否则「镜像体 → 弃牌堆里的真卡 → 国王准备阶段取牌 / 澪检索 / 尸群复活」就会凭空多出一张真卡
       （实测：镜像的矮人尸群被打死 → 弃牌堆 +1 张真尸群，而且进了复活队列，到期再复活一张）。
       遗言类效果（骷髅打对位等）仍然照常走 onDeath —— 它们不产生卡，且符合"复制品也有该效果"的直觉。 */
    if (inst.flags.mirror) {
      log('镜像体 ' + inst.name + ' 消散（复制品不进入弃牌堆）', 'dim');
      emit({ type: 'death', uid: inst.uid });
      onDeath(inst, ownerKey, slot, opts);
      checkVictory();
      return;
    }
    /* 怪物卡进弃牌堆（触发「进入弃牌堆时」效果）。
       ⚠ 必须把场上的「永久成长」带进弃牌堆的那个实例，否则成长会在死亡这一步丢掉：
         矮人武僧「进入弃牌堆时攻击+2」要求**可叠加**（弃牌堆→检索回手牌→再上场→再死 → 4/6/8…），
         之前这里 makeInstance(...) 新建实例、growthAtk 从 0 开始，每次死亡都只 +2，永远叠不起来。 */
    var deathCard = makeInstance(inst.cardId, inst.level, inst.star, inst.awaken);
    deathCard.growthAtk = inst.growthAtk || 0;
    if (inst.origOwner) deathCard.origOwner = inst.origOwner;   // 被腐化转移的怪：进原主弃牌堆
    toDiscard(ownerKey, deathCard, true);
    log(inst.name + ' 被击破', 'death');
    emit({ type: 'death', uid: inst.uid });
    // BOSS 闯关：击破 BOSS 立即通关（无需击败对手本体）
    if (state.bossUid && inst.uid === state.bossUid && !state.winner) {
      state.bossDown = true;
      state.winner = 'A';
      log('—— ★ BOSS【' + inst.name + '】被击破，通关！——', 'hl');
    }
    onDeath(inst, ownerKey, slot, opts);
    checkVictory();
  }

  /* ---------------- 回合流程 ---------------- */
  /* 本回合的法杖施法次数上限 = 基础 1 + 场上法师B ×N + 法杖栏里的老法杖。
   * ⚠ 抽成函数是因为它**不该只在回合开始时才算**：这回合中途把老法杖放进法杖栏
   *   （actPlaceWand）、或召唤出法师B（actSummon），都要立刻补上次数 ——
   *   否则"装备上去的那一回合没有加成，要等下回合才生效"。 */
  function castsMaxOf(key) {
    var p = state.players[key], n = Rules.WAND_BASE_CASTS;
    aliveMonsters(key).forEach(function (m) {
      if (m.cardId === 'a-035-2') n += 1;                    // 法师B
    });
    if (p.wand && p.wand.cardId === 'a-036-2') n += 1;       // 老法杖（只能入法杖栏，不能装备到怪物）
    return n;
  }
  /* 上限变化时刷新剩余次数：**保留本回合已经用掉的次数**，只调整余量。
   * 直接写 castsLeft = 上限 会把已用次数抹掉（等于白送次数）。 */
  function refreshCasts(key) {
    var p = state.players[key];
    if (p.castsMax == null) { p.castsMax = castsMaxOf(key); p.castsLeft = p.castsMax; return; }
    var used = Math.max(0, p.castsMax - (p.castsLeft || 0));
    p.castsMax = castsMaxOf(key);
    p.castsLeft = Math.max(0, p.castsMax - used);
  }
  function startTurn(key, silent) {
    var p = state.players[key], opp = state.players[other(key)];
    state.active = key; state.phase = 'PREP';
    // 回合计数与坐标系无关：turnCount = 双方各自已过的回合数之和，round = 第几个大回合。
    // 这样"大回合上限"天然让双方回合数相等（旧实现固定按 A 方递增 → B 先手时会多打一回合）。
    state.turnCount = (state.turnCount || 0) + 1;
    state.round = Math.ceil(state.turnCount / 2);
    // 成就：重置"本回合"计数；并在玩家新回合开始时结算「你被骗了」（水道螃蟹EX 连续未触发再攻击）
    if (state.ach && !state.ach.off && key === 'A') {
      var ach = state.ach, prevTurn = (state.turnCount || 0) - 2;   // 上一个属于 A 的回合
      if (ach.crabAttackedTurn === prevTurn) ach.crabStreak = (ach.crabReTurn === prevTurn) ? 0 : ach.crabStreak + 1;
      else ach.crabStreak = 0;
      ach.bombsThisTurn = 0;
      ach.killsThisTurn = 0;
    }
    p.summonsMax = Rules.SUMMON_PER_TURN + perkOf(key, 'summonAdd');   // 学院特技：每回合多召唤 N 次
    p.summonsLeft = p.summonsMax;
    p.flags.used = { food: 0, potion: 0, scroll: 0, weapon: 0, armor: 0 };  // 每回合各类限1张的计数
    /* 2026-10-25 新卡：充能戒指冷却 / 充能卷轴"首次施法免费"当回合有效 / 神器冷却（魔典·工具箱） */
    if (p.flags.ringCD > 0) { p.flags.ringCD -= 1; if (p.flags.ringCD <= 0) { p.flags.ringCD = 0; log('充能戒指：冷却结束', 'dim'); } }
    p.flags.freeCast = 0;
    p.flags.castCount = 0;          // 充能卷轴：本回合是否已经施过法
    (p.artifacts || []).forEach(function (a) {
      if (a.flags && a.flags.cd > 0) { a.flags.cd -= 1; if (a.flags.cd <= 0) a.flags.cd = 0; }
    });
    // 冰霜药水：本回合召唤次数-1（一次性）
    if (p.flags.summonDebuff) { p.summonsLeft = Math.max(0, p.summonsLeft - p.flags.summonDebuff); log(p.name + ' 受冰霜药水影响：召唤次数 -' + p.flags.summonDebuff, 'eff'); p.flags.summonDebuff = 0; }
    // 法杖施法次数 = 基础1 + 场上提供+1的卡（法师B / 法杖栏中的老法杖），可叠加无上限
    // 回合开始 = 重置为满次数（具体算法见 castsMaxOf）
    p.castsMax = castsMaxOf(key);
    p.castsLeft = p.castsMax;
    // 重置怪物攻击次数 & 战斗阶段临时状态
    aliveMonsters(key).forEach(function (m) {
      m.flags.attacked = false;
    m.flags.halfDone = false;                            // 武僧系：每回合首次伤害减半，回合开始重置
      // 觉醒【禁锢】：解除"已经过期"的禁锢。
      // ⚠ 不能写成一进自己回合就清 —— 那样被禁锢的怪轮到自己时早解锁了，禁锢等于不存在。
      //   stunRound 记的是"第几大轮不能攻击"（A/B 在同一 round 内各有一个回合，
      //   所以 A 在 round N 被禁锢 → 它的下个回合正好也是 round N+1）。
      if (m.flags.stunRound && m.flags.stunRound < state.round) m.flags.stunRound = 0;
      m.flags.attacksMax = baseAttacksMax(m);   // 回合开始重置为基础值（觉醒暴怒 2 / 蝎子 3、2）
      /* 邪恶之眼 a-146-02：不再在回合开始清（它要持续到"自己下个回合结束"），
         到期判定在 turnEndMonster 的 a-146 case 里。 */
      m.flags.charmedBy = 0;        // 魅魔 a-145-02 的魅惑只持续一回合（charmedOnce 永久保留）
      m.flags.noMove = false;       // 古神之拳（大地）的禁移动
      m.flags.tookDamageThisBattle = false;
      m.flags.hunterDrawn = false;                        // 女猎B 每回合可再触发一次
      m.flags.robbedPlayer = false;                       // 疯狂小偷：本回合是否打脸夺到手牌
      m.flags.reattacked = false;                         // 螃蟹/水道螃蟹EX 的【再攻击】每回合可再触发
      // 盗贼B：上个对方回合若处于"无法被攻击"，则本次攻击+3（同一段"无法被攻击"只结算一次，避免与暗影斗篷的即时加成重复）
      if (m.cardId === 'a-038-2' && m.flags.untargetable && !m.flags.rogueBonusGranted) m.flags.rogueBonus = true;
      // 临时免疫到期（暗影斗篷 / 极影铃虹 / 食人鱼中位）：只撤销"临时"来源，保留固有【无法被攻击】
      if (m.flags.untargetableUntilOwnerTurn) {
        m.flags.untargetableUntilOwnerTurn = false;
        m.flags.untargetable = !!m.flags.untargetableInnate;
        m.flags.rogueBonusGranted = false;
      }
    });
    p.flags.voidChainUsed = 0;                            // 虚空锁链：准备阶段限一次
    p.flags.artifactCupUsed = 0;                          // 蓄血圣杯 a-139-02：准备阶段限一次
    /* 投掷物/法杖封锁（137 棱光法杖 / 138 闪光陷阱）的回合数递减。
       ⚠ 放在**回合开始时**而不是结束时：banTW=N 表示"接下来 N 个自己的回合不能用"，
         本回合开始就先判定（此时还没减），到下一个回合开始才 -1，正好 N 个回合。 */
    if (p.flags.banTW > 0) { p.flags.banTW -= 1; if (p.flags.banTW <= 0) { p.flags.banTW = 0; log('投掷物/法杖封锁已解除', 'dim'); } }
    /* 净化药水到期：cleanseUntil 用 turnCount 记账，过期就清掉标记 */
    if (p.flags.cleanseUntil && (state.turnCount || 1) > p.flags.cleanseUntil) {
      delete p.flags.cleanseUntil;
      log('净化药水的免疫效果到期', 'dim');
    }
    // 时光沙漏（新卡神器 a-120-2）：冷却递减；若是"由自己发动"的时停 → 在自己回合开始时解除
    p.artifacts.forEach(function (a) {
      if (a.flags && a.flags.cd > 0) a.flags.cd -= 1;
      if (a.cardId === 'a-120-2' && a.flags && a.flags.active) {
        a.flags.active = false;
        state.players.A.flags.tsNoAttack = 0; state.players.B.flags.tsNoAttack = 0;
        state.players.A.flags.tsNoThrowWand = 0; state.players.B.flags.tsNoThrowWand = 0;
        log('时光沙漏：时停结束（' + p.name + ' 的回合开始）', 'eff');
      }
    });
    // 回旋镖（新卡）：持有者回合开始时，从弃牌堆返回手牌
    for (var dq = p.discard.length - 1; dq >= 0; dq--) {
      var dcard = p.discard[dq];
      if (dcard.returnAtTurn) {
        dcard.returnAtTurn = false;
        p.discard.splice(dq, 1);
        if (p.hand.length < Rules.HAND_LIMIT) { p.hand.push(dcard); log('回旋镖返回手牌', 'eff'); }
        else { p.deck.unshift(dcard); log('回旋镖：手牌已满，洗回牌库', 'dim'); }
      }
    }
    if (!silent) log('—— ' + p.name + ' 的回合（第 ' + state.round + ' 大回合）——', 'hl');
    // ① 全局状态 Buff 结算（毒气 / 酸气，作用于该玩家自己的怪物）
    resolveBuffSettlement(key);
    // ② 准备阶段开始时效果
    log(p.name + ' 进入准备阶段', 'phase');
    resolvePrepStart(key);
    // BOSS 技能：回合开始时（B = AI 回合 / A = 玩家回合）
    bossHook(key === 'B' ? 'aiTurnStart' : 'foeTurnStart');
    if (state.winner) { notify(); return; }
    // ③ 抽 1 张
    draw(key, Rules.DRAW_PER_TURN, false);
    if (!state.winner) notify();
  }

  // 毒气 / 酸气：己方回合开始时，己方所有在场怪物掉血；层数递减（对称机制）
  function resolveBuffSettlement(key) {
    var p = state.players[key];
    /* 净化药水（a-132-02）：处于免疫窗口时，毒气/酸气**层数照常消耗、但不结算伤害**
       （玩家 2026-10-23 裁定：药水是"免疫"不是"清除"，对手照样能叠加，只是这段时间不生效）。 */
    var immune = negImmune(key);
    if (p.poison > 0) {
      var pd = 2 + (p.poisonBonus || 0);
      if (typeof state.poisonDmgFn === 'function') pd = state.poisonDmgFn(key, pd);   // BOSS 技能可改写毒气伤害
      if (immune) {
        log(p.name + ' 处于净化状态，免疫【毒气】伤害（' + p.poison + ' 层 → ' + (p.poison - 1) + '）', 'eff');
      } else {
        log(p.name + ' 结算【毒气】' + p.poison + ' 层：己方所有怪物生命 -' + pd, 'eff');
        aliveMonsters(key).slice().forEach(function (m) {
          if (m.cardId === 'a-045-2') return; // 食人鱼免疫
          damageMonster(m, key, pd, {});
        });
      }
      p.poison -= 1;
    }
    if (p.acid > 0) {
      var dmg = Math.ceil(p.acid / 2) * (state.acidMul || 1);   // DM-201【酸蚀】：本局【酸气】造成的伤害翻倍
      if (immune) {
        log(p.name + ' 处于净化状态，免疫【酸气】伤害（' + p.acid + ' 层 → ' + Math.floor(p.acid / 2) + '）', 'eff');
      } else {
        log(p.name + ' 结算【酸气】' + p.acid + ' 层：己方所有怪物生命 -' + dmg, 'eff');
        aliveMonsters(key).slice().forEach(function (m) {
          if (m.cardId === 'a-045-2') return;
          damageMonster(m, key, dmg, {});
        });
      }
      p.acid = Math.floor(p.acid / 2);
    }
  }

  function resolvePrepStart(key) {
    var p = state.players[key];
    // 炸弹延迟爆破：在你的下一个准备阶段开始时，对敌方原位置及其十字方向各造成伤害
    if (p.bombs && p.bombs.length) {
      var ob = state.players[other(key)].board, oppKey = other(key);
      var mb = state.players[key].board;   // 纵向：同一列对侧（投掷者己方）的怪物
      var bombs = p.bombs; p.bombs = [];
      bombs.forEach(function (b) {
        log('炸弹爆破：第 ' + (b.slot + 1) + ' 位（左右）及对位受 ' + Rules.BOMB_DAMAGE + ' 点伤害', 'eff');
        // 十字横向：原位置及其左右（炸弹是投掷物 → 同样吃减伤）
        [b.slot - 1, b.slot, b.slot + 1].forEach(function (idx) {
          if (idx < 0 || idx >= ob.length) return;
          if (ob[idx]) damageMonster(ob[idx], oppKey, Rules.BOMB_DAMAGE, { reduce: true });
        });
        // 十字纵向：同一列对侧（投掷者己方）的怪物
        if (b.slot >= 0 && b.slot < mb.length && mb[b.slot]) damageMonster(mb[b.slot], key, Rules.BOMB_DAMAGE, { reduce: true, credit: null });   // 己方同列自伤：不计入任何一方的输出
      });
    }
    // 戒指 / 神器 / 怪物 PREP_START
    // 财富戒指：在手牌则额外抽一张
    if (p.hand.some(function (c) { return c.cardId === 'a-023-2'; })) { log('财富戒指 触发：额外抽一张牌', 'eff'); draw(key, 1); }
    // 先见护符
    if (p.artifacts.some(function (a) { return a.cardId === 'a-070-2'; }) && aliveMonsters(key).length > 1) {
      var opp = state.players[other(key)];
      var traps = opp.hand.filter(function (c) { return cardOf(c).type === 'trap'; });
      if (traps.length) {
        var t = pick(traps);
        removeFromHand(opp, t.iid);
        // 这是"被对手（护符持有者）的效果弃置" → 打 byOpp 标记，自然之靴才能生效
        t.flags = t.flags || {}; t.flags.byOpp = true;
        toDiscard(other(key), t, false);      // ⚠ 这里要传 key 字符串，不是 player 对象
        log('先见护符 触发：弃置对方陷阱 ' + cardOf(t).name, 'eff');
      }
    }
    // 极速戒指：随机召唤手牌一张 C 级怪
    if (p.hand.some(function (c) { return c.cardId === 'a-065-2'; }) && emptySlots(key).length) {
      var cs = p.hand.filter(function (c) { var cd = cardOf(c); return cd.type === 'monster' && cd.tier === 'C'; });
      if (cs.length) { var cc = pick(cs); removeFromHand(p, cc.iid); log('极速戒指 触发：随机召唤 C 级怪物', 'eff'); spawnMonster(key, cc, null); }
    }
    // 狂怒戒指：己方随机一张B级怪攻击次数+1
    if (p.hand.some(function (c) { return c.cardId === 'a-066-2'; })) {
      var bs = aliveMonsters(key).filter(function (m) { return m.tier === 'B'; });
      if (bs.length) {
        var b = pick(bs);
        b.flags.attacksMax += 1;
        // 日志要写明"哪一格"生效 —— 玩家得能在场上对应到具体是哪只怪
        log('狂怒戒指 触发：' + ln(slotOf(key, b.uid)) + '位 ' + b.name + ' 攻击次数+1（→ ' + b.flags.attacksMax + ' 次）', 'eff');
      }
    }
    // 怪物自身 PREP_START
    aliveMonsters(key).slice().forEach(function (m) { prepStartMonster(m, key); });
  }

  function endTurn(key) {
    var p = state.players[key];
    bossHook('turnEnd', key);            // BOSS 技能：回合结束时（key = 刚行动的方）
    if (state.winner) { notify(); return; }
    // 回合结束时效果
    aliveMonsters(key).slice().forEach(function (m) { turnEndMonster(m, key); });
    /* 魔法绵羊 a-142-02：**任何一方**回合结束都会消散（玩家 2026-10-25 修正）——
       它在谁的回合被生出来，那一回合结束就没了，不用等到自己回合。 */
    ['A', 'B'].forEach(function (kk) {
      var bd = state.players[kk].board;
      for (var si = 0; si < bd.length; si++) {
        if (bd[si] && bd[si].cardId === 'a-142-02') {
          log('魔法绵羊：回合结束，消散', 'dim');
          bd[si] = null;
        }
      }
    });
    // 露珠：若回合结束存于手牌则进弃牌堆
    for (var i = p.hand.length - 1; i >= 0; i--) {
      if (p.hand[i].cardId === 'a-018-2') { var c = p.hand.splice(i, 1)[0]; p.discard.push(c); log('露珠 回合结束进入弃牌堆', 'dim'); }
    }
    resolveReviveQueue(key);      // 矮人尸群：到期的延迟复活
    // DM-100 已在 turnEndMonster 处理
    p.flags.noAttack = false; // 催眠卷轴效果在该玩家回合结束时失效
    if (state.winner) { notify(); return; }
    var nk = other(key);
    // 大回合上限：按"累计回合数"判停 —— 双方各打到上限回合数后结束，回合数恒等
    // （旧实现固定按"A 方"递增、且在交给 A 方时判停 → B 先手时 B 白拿一整个回合 → 学院按累计输出判分时系统性偏袒 B 槽）
    if ((state.turnCount || 0) >= 2 * (state.maxRounds || Rules.MAX_ROUNDS)) { finishByHp(); notify(); return; }
    startTurn(nk, false);
    notify();
  }

  // 回合上限结算：血量高者胜；相同则平局
  function finishByHp() {
    var lim = state.maxRounds || Rules.MAX_ROUNDS;
    // BOSS 闯关：本体锁血 → 不能按血量判胜负；回合上限到了 BOSS 仍存活即为挑战失败
    if (state.bodyLock) {
      var bi = bossInst();
      log('已达 ' + lim + ' 大回合上限，BOSS【' + (bi ? bi.name : '—') + '】仍存活 → 挑战失败', 'hl');
      state.winner = 'B';
      return;
    }
    var a = state.players.A.hp, b = state.players.B.hp;
    log('已达 ' + lim + ' 大回合上限，按血量结算：' + state.players.A.name + ' ' + a + ' vs ' + state.players.B.name + ' ' + b, 'hl');
    if (a > b) state.winner = 'A';
    else if (b > a) state.winner = 'B';
    else state.winner = 'draw';
  }

  /* ---------------- 各卡牌效果实现 ---------------- */
  function onSummon(inst, key) {
    var opp = other(key), cd = CARDS[inst.cardId], p = state.players[key];
    switch (inst.cardId) {
      case 'a-107-2': {   // DM-200（新卡）：对方叠加 2 层毒气 + 其场上怪物各 1 点伤害
        var op2 = state.players[opp];
        addPoison(opp, 2);
        log('DM-200：对方叠加 2 层【毒气】，其场上怪物受到 1 点伤害', 'eff');
        aliveMonsters(opp).slice().forEach(function (x) { damageMonster(x, opp, 1, {}); });
        break;
      }
      case 'a-111-2': {   // DM-300（新卡）：令对手的毒气/酸气层数翻倍
        var op3 = state.players[opp];
        if (negImmune(opp)) { log('DM-300：对方处于净化状态，毒气/酸气翻倍无效', 'dim'); break; }
        log('DM-300：对方【毒气】' + op3.poison + ' → ' + (op3.poison * 2) + '，【酸气】' + op3.acid + ' → ' + (op3.acid * 2), 'eff');
        op3.poison *= 2; op3.acid *= 2;
        break;
      }
      case 'a-031-2': deriveCard(key, 'a-033-2'); break;                    // 战士C → 破损纹章
      case 'a-034-2': deriveCard(key, 'a-036-2'); break;                    // 法师C → 老法杖
      case 'a-037-2': deriveCard(key, 'a-039-2'); break;                    // 盗贼C → 暗影斗篷
      case 'a-040-2': deriveCard(key, 'a-042-2'); break;                    // 女猎C → 灵能弓
      case 'a-002-2': draw(key, 1); break;                                  // 啮齿小鼠：抽1
      case 'a-010-2': requestChoices(key, [{ from: 'deck', count: 2, pred: function (c) { return CARDS[c.cardId].type === 'throw'; }, label: '检索两张投掷物' }]); break; // 豺狼猎手（定向检索）
      case 'a-043-2': requestChoices(key, [{ from: 'deck', count: 1, pred: function (c) { return CARDS[c.cardId].type === 'weapon'; }, label: '检索一张武器' }]); break; // 活化石像（定向检索）
      case 'a-004-2': { // 豺狼巡查：可选技能（弃 1 张手牌 → 检索 1 张"💰"怪）
        var jackalSteps = [
          { from: 'hand', count: 1, pred: function () { return true; }, label: '弃置一张手牌' },
          { from: 'deck', count: 1, pred: function (c) { return CARDS[c.cardId].type === 'monster' && (CARDS[c.cardId].tags || []).indexOf('💰') >= 0; }, label: '检索一张"💰"类怪物' }
        ];
        if (!p.deck.some(jackalSteps[1].pred)) { log('豺狼巡查：牌库已无"💰"怪物，技能不发动', 'dim'); break; }
        if (p.isAI) {
          // AI：按"手牌代价 vs 牌库价值"自行决定发不发动
          var wantIt = !aiPolicy || !aiPolicy.optional || aiPolicy.optional(key, inst, jackalSteps);
          if (!wantIt) { log('豺狼巡查：不发动技能（保留手牌）', 'dim'); break; }
          requestChoices(key, jackalSteps);
          break;
        }
        // 人类玩家：弹出"是否发动"选择
        state.pending = {
          kind: 'OPTION_SKILL', actorKey: key, label: '豺狼巡查', steps: jackalSteps,
          desc: '弃置一张手牌，从牌库检索一张"💰"类怪物加入手牌。'
        };
        break;
      }
      case 'a-128-02': {   // 武僧大师：获得弃牌堆最上层怪物的攻击力
        var dm = null;
        for (var di = p.discard.length - 1; di >= 0; di--) {
          if (CARDS[p.discard[di].cardId].type === 'monster') { dm = p.discard[di]; break; }
        }
        if (dm) {
          /* 卡面写的是「获得…怪物的**攻击力**」，不是卡面基础攻击力 ——
             弃牌堆里那个实例可能带着永久成长（矮人武僧进弃牌堆时 +2，且可叠加），
             必须按「基础 + growthAtk」取当前攻击力，否则武僧大师只能拿到 4 而不是 6/8/10。 */
          var dBase = CARDS[dm.cardId].atk || 0;
          var dAtk = dBase + (dm.growthAtk || 0);
          inst.baseAtk += dAtk; recalc(inst);
          log('武僧大师：获得弃牌堆最上层怪物【' + CARDS[dm.cardId].name + '】的攻击力 +' + dAtk
            + (dm.growthAtk ? ('（基础 ' + dBase + ' + 成长 ' + dm.growthAtk + '）') : ''), 'eff');
        } else log('武僧大师：弃牌堆没有怪物卡，无加成', 'dim');
        break;
      }
      case 'a-125-02': {   // 矮人术士：可选 —— 先调一张装备/法杖等级，再牺牲己方一只怪物
        var eqCands = [];
        ['A', 'B'].forEach(function (kk) {
          var pl2 = state.players[kk];
          if (pl2.wand) {
            eqCands.push({
              iid: pl2.wand.iid, cardId: pl2.wand.cardId, tier: '', type: 'wand',
              key: kk, level: pl2.wand.level || 0,
              name: CARDS[pl2.wand.cardId].name + '（' + (kk === key ? '我方' : '对方') + '法杖 Lv' + (pl2.wand.level || 0) + '）'
            });
          }
          pl2.board.forEach(function (mm) {
            if (!mm || mm.flags.dead) return;
            if (mm.weapon) eqCands.push({
              iid: mm.weapon.iid, cardId: mm.weapon.cardId, tier: '', type: 'weapon',
              key: kk, level: mm.weapon.level || 0,
              name: CARDS[mm.weapon.cardId].name + '（' + mm.name + ' 武器 Lv' + (mm.weapon.level || 0) + '）'
            });
            if (mm.armor) eqCands.push({
              iid: mm.armor.iid, cardId: mm.armor.cardId, tier: '', type: 'armor',
              key: kk, level: mm.armor.level || 0,
              name: CARDS[mm.armor.cardId].name + '（' + mm.name + ' 防具 Lv' + (mm.armor.level || 0) + '）'
            });
          });
        });
        /* ⚠ 魔法绵羊 a-142-02 卡面写明「不可用于献祭/牺牲」→ 不能出现在术士的牺牲候选里
           （它同时是 untargetable，若只靠"能不能被打"来判断会漏掉）。 */
        var sacCands = aliveMonsters(key)
          .filter(function (x) { return x.uid !== inst.uid && x.cardId !== 'a-142-02'; })
          .map(function (x) {
            return { iid: x.uid, cardId: x.cardId, name: x.name, tier: x.tier, type: 'monster', atk: x.atk, hp: x.hp };
          });
        if (!eqCands.length || !sacCands.length) {
          log('矮人术士：场上没有装备/法杖，或没有可牺牲的怪物 → 技能不发动', 'dim');
          break;
        }
        var sorcSteps = [
          { cands: eqCands, count: 1, action: 'sorcererTarget', label: '选择要调整等级的装备/法杖' },
          { cands: [
            { iid: 1, cardId: '', name: '+2 级', tier: '', type: '' },
            { iid: 2, cardId: '', name: '-2 级', tier: '', type: '' }
          ], count: 1, action: 'sorcererSign', label: '选择等级变化' },
          { cands: sacCands, count: 1, action: 'sorcererSac', label: '选择要牺牲的己方怪物' }
        ];
        if (p.isAI) {
          var wantS = !aiPolicy || !aiPolicy.optional || aiPolicy.optional(key, inst, sorcSteps);
          if (!wantS) { log('矮人术士：不发动技能', 'dim'); break; }
          requestChoices(key, sorcSteps);
          break;
        }
        state.pending = {
          kind: 'OPTION_SKILL', actorKey: key, label: '矮人术士', steps: sorcSteps,
          desc: '先令一张装备/法杖等级 +2 或 -2，再牺牲己方场上一只怪物（被牺牲怪物的装备会带着新等级回到手牌）。'
        };
        break;
      }
      /* 恶魔撕裂者 a-143-02：召唤后立即攻击对位；对位为空则直接进弃牌堆 */
      case 'a-143-02': tearStrike(inst, key); break;
      /* 古神之拳 a-149-02：己方场上有【YOG】时可选择转变为六种形态之一 */
      case 'a-149-02': {
        if (!aliveMonsters(key).some(function (x) { return x.cardId === 'a-150-02'; })) {
          log('古神之拳：己方场上没有【YOG】，保持默认形态', 'dim');
          break;
        }
        var fistForms = [
          { iid: 'burn', name: '燃烧形态', cardId: '', tier: '', type: '' },
          { iid: 'earth', name: '大地形态', cardId: '', tier: '', type: '' },
          { iid: 'rot', name: '腐烂形态', cardId: '', tier: '', type: '' },
          { iid: 'rust', name: '锈蚀形态', cardId: '', tier: '', type: '' },
          { iid: 'glory', name: '辉耀形态', cardId: '', tier: '', type: '' },
          { iid: 'shadow', name: '暗影形态', cardId: '', tier: '', type: '' }
        ];
        log('古神之拳：受【YOG】影响，可以选择形态', 'eff');
        requestChoices(key, [{
          cands: fistForms, action: 'fistForm', count: 1, fistUid: inst.uid,
          label: '选择古神之拳的形态'
        }]);
        break;
      }
      case 'a-072-2': prisonGuard(inst, key); break;                        // 监狱守卫
      case 'a-081-2': { // 腐烂之心：每 2 层腐烂标记使对手受到的毒气伤害+1，然后清空
        var p2 = state.players[opp], bonus = Math.floor(p2.rotMarks / 2);
        if (bonus > 0) { p2.poisonBonus = (p2.poisonBonus || 0) + bonus; log('腐烂之心：对手受到的【毒气】伤害 +' + bonus + '（腐烂标记 ' + p2.rotMarks + ' 已清空）', 'eff'); }
        p2.rotMarks = 0; break;
      }
      default: break;
    }
    // 食人鱼：召唤于中位的回合无法被攻击（持续至我方下个回合开始）
    if (inst.cardId === 'a-045-2' && slotOf(key, inst.uid) === 1) { inst.flags.untargetable = true; inst.flags.untargetableUntilOwnerTurn = true; }
    recalcAll();
  }

  /* 觉醒词条：回合开始时的效果（自愈 / 潜伏 / 幻象）。只对己方怪物调用。 */
  function applyAwakenPrep(m, key, opp, op) {
    // 【自愈】每回合开始恢复 30% 生命
    if (m.awaken === 'regen' && m.hp < m.maxHp) {
      var amt = Math.ceil(m.maxHp * 0.3);
      log('【自愈】' + m.name + ' 恢复 ' + amt + ' 点生命', 'eff');
      healMonster(m, amt);
    }
    // 【潜伏】每隔一回合进入不可选中（每次到自己回合翻转一次；固有不可选中不会被误清）
    if (m.awaken === 'stealth') {
      m.flags.stealthOn = !m.flags.stealthOn;
      if (m.flags.stealthOn) {
        m.flags.untargetable = true;
        log('【潜伏】' + m.name + ' 进入不可选中状态', 'eff');
      } else if (!m.flags.untargetableInnate) {
        m.flags.untargetable = false;
      }
    }
    // 【幻象】在己方随机空位衍生一张 1 命同攻的同名怪（镜像卷轴效果）
    if (m.awaken === 'mirror') {
      var es = emptySlots(key);
      if (es.length) {
        log('【幻象】' + m.name + ' 衍生镜像', 'eff');
        createMirror(key, m, pick(es));
      }
    }
  }

  /* ================= 2026-10-20 新卡辅助 ================= */
  var chaosCtx = null;              // 混沌元素：攻击中途要选弃牌堆元素卡，这里暂存攻击上下文
  var sorcererRef = null;           // 矮人术士：暂存"选中的装备/法杖"
  var sorcererSign = 2;             // 矮人术士：+2 / -2

  /* ⚠ 这里有两套「矮人」口径，别混用：
     ① isDwarf      —— **种族**，卡面用【💎】图标表示（tags 含 💎）。用户明确：只要卡面画了图标，就是种族。
                        目前 11 张：4 张名字带"矮人" + DM-100/200/201/300 + 能源塔 + 魔像 + 武僧大师。
                        用它的地方：能源塔给【💎】类怪物加护盾。
     ② isNameDwarf  —— **名字带"矮人"**，卡面用文字【矮人】表示（用户明确：写文字就是按名字）。
                        只有 4 张：矮人尸群 / 矮人术士 / 矮人武僧 / 矮人国王。
                        用它的地方：**国王的伤害分摊**。
     ③ 尸群的复活条件后来单独收窄了：卡面改成【矮人尸群】，所以只认**同名卡**（见 resolveReviveQueue）。
     两者是包含关系（名字带矮人 ⊂ 种族），所以"国王 + 魔像"这种组合**不**触发分摊。 */
  function isDwarf(m) {
    return !!m && (CARDS[m.cardId].tags || []).indexOf('💎') >= 0;
  }
  function isNameDwarf(m) {
    return !!m && String(CARDS[m.cardId].name || '').indexOf('矮人') >= 0;
  }
  /* 矮人国王在不在场（该方） */
  function kingAlive(key) {
    return aliveMonsters(key).some(function (m) { return m.cardId === 'a-130-02'; });
  }
  /* 分摊条件：己方场上有国王 + 至少两只"名字带矮人"的怪 */
  function dwarfShareOn(key) {
    if (!kingAlive(key)) return false;
    return aliveMonsters(key).filter(isNameDwarf).length >= 2;
  }
  /* 伤害分摊：先减伤（调用前已完成）→ 平均分给全体名字带"矮人"的怪，余数给原目标 */
  function shareDwarfDamage(inst, ownerKey, dmg, opts) {
    var mates = aliveMonsters(ownerKey).filter(isNameDwarf);
    var n = mates.length;
    if (n < 2) return dmg;
    var share = Math.floor(dmg / n);
    var rem = dmg - share * n;
    log('矮人国王：' + dmg + ' 点伤害由己方 ' + n + ' 只矮人分摊（各 ' + share + (rem ? ('，余 ' + rem + ' 归 ' + inst.name) : '') + '）', 'eff');
    mates.forEach(function (m) {
      if (m === inst) return;
      if (share > 0) damageMonster(m, ownerKey, share, { shared: true, credit: opts.credit });
    });
    return share + rem;
  }

  /* 找到某个 iid 对应的装备/法杖（用于矮人术士） */
  function findEquipRef(iid) {
    var keys = ['A', 'B'];
    for (var ki = 0; ki < keys.length; ki++) {
      var k = keys[ki], pl = state.players[k];
      if (pl.wand && pl.wand.iid === iid) return { kind: 'wand', ownerKey: k, inst: pl.wand };
      for (var i = 0; i < pl.board.length; i++) {
        var m = pl.board[i];
        if (!m) continue;
        if (m.weapon && m.weapon.iid === iid) return { kind: 'weapon', ownerKey: k, inst: m.weapon, holder: m };
        if (m.armor && m.armor.iid === iid) return { kind: 'armor', ownerKey: k, inst: m.armor, holder: m };
      }
    }
    return null;
  }
  /* 装备/法杖的等级上限 = 卡面 mods.upgrade 的档数（Lv0 之外还有几档）。
     ⚠ 这个上限是**必须**的：矮人术士可以反复 +2，若不封顶就会把 level 推到
       upgrade 数组之外，之后所有读 `mods.upgrade[level-1].xxx` 的地方
       （长矛 splash / 碧灰双刃 procChance / 镶钉手套 procChance）都会吃到 undefined 而崩。
       实测崩溃：跑图模式下术士把碧灰双刃推到 Lv2+ → postAttackProps 报
       "Cannot read properties of undefined (reading 'procChance')"。 */
  function maxEquipLevel(cardId) {
    var cd = CARDS[cardId];
    var up = (cd && cd.mods && cd.mods.upgrade) || [];
    return up.length;
  }
  function clampEquipLevel(cardId, lv) {
    return Math.max(0, Math.min(maxEquipLevel(cardId), lv));
  }
  /* 安全读取「某等级下的装备数值」。
     ⚠ 只钳制写入是不够的：等级还可能来自旧存档 / 联机下发的状态 / 被外部污染，
       所以**读取点也必须兜底**——读不到就退回基础值，绝不返回 undefined。
       受影响的三处读取：长矛 splash、碧灰双刃 procChance、镶钉手套 procChance。 */
  function modAtLevel(mods, level, key) {
    if (!mods) return undefined;
    var base = mods[key];
    var lv = (typeof level === 'number' && isFinite(level)) ? level : 0;
    if (lv < 1) return base;
    var up = mods.upgrade || [];
    if (!up.length) return base;
    var idx = Math.min(Math.floor(lv) - 1, up.length - 1);
    if (idx < 0) return base;
    var v = up[idx] ? up[idx][key] : undefined;
    return (v === undefined || v === null) ? base : v;
  }
  function levelEquipRef(ref, delta) {
    if (!ref) return;
    var cap = maxEquipLevel(ref.inst.cardId);
    var lv0 = ref.inst.level || 0;
    var lv1 = clampEquipLevel(ref.inst.cardId, lv0 + delta);
    var label = (ref.kind === 'wand' ? '法杖' : '装备') + '【' + CARDS[ref.inst.cardId].name + '】';
    if (lv1 === lv0) {
      log(label + (cap <= 0 ? '不可升级（无升级档位）' : ('已到' + (delta > 0 ? '上限' : '下限') + ' Lv' + cap)), 'dim');
      return;
    }
    ref.inst.level = lv1;
    recalcAll();
    log(label + '等级 ' + lv0 + ' → ' + lv1, 'eff');
  }

  /* 混沌元素：复制弃牌堆里一张【元素】卡的攻击后效果。
     ⚠ 「元素」= **名字里带"元素"的怪物卡**（用户口径），不只是新做的三张：
       火元素 / 冰霜元素 / 电击元素 / 纯晶元素(a-052-2) / 新生火元素(a-082-2)。
       混沌元素自己（a-129-02）不列入 —— 否则会无限递归复制。
       纯晶元素、新生火元素的原始触发时机不是"攻击后"（一个是战斗阶段攻击时、
       一个是准备阶段开始），按用户要求**挪用**到攻击后立即结算。 */
  var ELEM_IDS = ['a-121-02', 'a-122-02', 'a-123-02', 'a-052-2', 'a-082-2'];
  function chaosCopy(key, atk, t, opp) {
    var p = state.players[key];
    var ELEM = ELEM_IDS;
    var cands = [];
    p.discard.forEach(function (c) {
      if (ELEM.indexOf(c.cardId) >= 0) {
        // tier 用真实稀有度（纯晶元素 B、新生火元素 A），不要写死 'C'
        cands.push({ iid: c.iid, cardId: c.cardId, name: CARDS[c.cardId].name, tier: CARDS[c.cardId].tier, type: 'monster' });
      }
    });
    if (!cands.length) { log('混沌元素：弃牌堆里没有【元素】卡，效果不发动', 'dim'); return; }
    chaosCtx = { key: key, opp: opp, targetUid: t ? t.uid : null };
    requestChoices(key, [{ cands: cands, count: 1, action: 'chaos', label: '混沌元素：选择一张【元素】卡的效果发动' }]);
  }
  function chaosApply(cardId) {
    var ctx = chaosCtx; chaosCtx = null;
    if (!ctx) return;
    var key = ctx.key, opp = ctx.opp;
    if (cardId === 'a-121-02') {
      log('混沌元素：复制【火元素】→ 令对手弃置一张卷轴卡', 'eff');
      requestChoices(opp, [{ from: 'hand', count: 1, exact: true, pred: function (c) { return cardOf(c).type === 'scroll'; }, label: '混沌元素：选择弃置一张卷轴卡' }]);
    } else if (cardId === 'a-122-02') {
      log('混沌元素：复制【冰霜元素】→ 令对手弃置一张药水卡', 'eff');
      requestChoices(opp, [{ from: 'hand', count: 1, exact: true, pred: function (c) { return cardOf(c).type === 'potion'; }, label: '混沌元素：选择弃置一张药水卡' }]);
    } else if (cardId === 'a-123-02') {
      var t = ctx.targetUid ? findMonster(opp, ctx.targetUid) : null;
      if (t && !t.flags.dead && t.atk < 4) {
        t.flags.stunRound = state.round + 1;
        log('混沌元素：复制【电击元素】→ ' + t.name + ' 下回合无法攻击', 'eff');
      } else {
        log('混沌元素：复制【电击元素】——目标攻击力≥4 或已消失，无效果', 'dim');
      }
    } else if (cardId === 'a-052-2') {
      /* 纯晶元素：对方玩家随机一张手牌中的怪物返回卡组。
         原本也是"攻击时"，挪用过来语义天然一致。 */
      var p2 = state.players[opp];
      var mons = p2.hand.filter(function (c) { return CARDS[c.cardId].type === 'monster'; });
      if (mons.length) {
        var mc = pick(mons);
        removeFromHand(p2, mc.iid);
        var di = Math.floor(rand() * (p2.deck.length + 1));
        p2.deck.splice(di, 0, mc);
        log('混沌元素：复制【纯晶元素】→ 对方一张手牌怪物【' + CARDS[mc.cardId].name + '】洗回卡组（随机位置）', 'eff');
      } else {
        log('混沌元素：复制【纯晶元素】——对方手牌没有怪物卡，无效果', 'dim');
      }
    } else if (cardId === 'a-082-2') {
      /* 新生火元素：原本是"准备阶段开始时"，按用户要求**挪用**到攻击后立即结算 ——
         对方场上每有一只怪物，对方场上所有怪物生命 -1（战役倍率 fireElemMult 一并沿用）。 */
      var n = aliveMonsters(opp).length;
      if (n > 0) {
        var feDmg = (state.fireElemMult || 1);
        log('混沌元素：复制【新生火元素】→ 对方场上 ' + n + ' 只怪物各 -' + feDmg, 'eff');
        aliveMonsters(opp).slice().forEach(function (x) { damageMonster(x, opp, feDmg, {}); });
      } else {
        log('混沌元素：复制【新生火元素】——对方场上没有怪物，无效果', 'dim');
      }
    }
  }

  /* 矮人尸群：回合结束时结算延迟复活 */
  function resolveReviveQueue(key) {
    var p = state.players[key];
    if (!p.reviveQueue || !p.reviveQueue.length) return;
    var due = p.reviveQueue.filter(function (e) { return (e.dueTurn || 0) <= (state.turnCount || 0); });
    p.reviveQueue = p.reviveQueue.filter(function (e) { return (e.dueTurn || 0) > (state.turnCount || 0); });
    due.forEach(function (e) {
      // 卡面写【矮人尸群】= 必须场上有**另一张**矮人尸群（自己已经进弃牌堆了）
      var hasSwarm = aliveMonsters(key).some(function (x) { return x.cardId === 'a-124-02'; });
      var slot = emptySlots(key);
      if (!hasSwarm) { log('矮人尸群：回合结束时场上没有【矮人尸群】，不复活', 'dim'); return; }
      if (!slot.length) { log('矮人尸群：己方没有空位，不复活', 'dim'); return; }
      // 从弃牌堆把这一张**取出来**再上场（旧实现是 makeInstance 新建，弃牌堆那份没删 → 凭空多一张）
      var idx = -1;
      if (e.iid != null) idx = p.discard.findIndex(function (c) { return c.iid === e.iid; });
      if (idx < 0) idx = p.discard.findIndex(function (c) { return c.cardId === e.cardId; });
      var cardInst = (idx >= 0) ? p.discard.splice(idx, 1)[0]
        : makeInstance(e.cardId, e.level || 0, e.star || 1, null);
      spawnMonster(key, cardInst, pick(slot));
      log('矮人尸群：在随机空位复活', 'eff');
    });
  }

  function prepStartMonster(m, key) {
    var opp = other(key), op = state.players[opp];
    if (m.awaken) applyAwakenPrep(m, key, opp, op);
    switch (m.cardId) {
      case 'a-104-2': {   // 能源塔：对对位怪物 **5** 点伤害，己方💎类怪物各获得 **3** 点护盾
        var ei = slotOf(key, m.uid);
        var om = (ei >= 0) ? op.board[ei] : null;
        if (om) { log('能源塔：对对位 ' + om.name + ' 造成 5 点伤害', 'eff'); damageMonster(om, opp, 5, {}); }
        var gems = aliveMonsters(key).filter(function (x) { return (CARDS[x.cardId].tags || []).indexOf('💎') >= 0; });
        gems.forEach(function (x) { x.shield += 3; });
        if (gems.length) log('能源塔：己方 ' + gems.length + ' 张【💎】类怪物各获得 3 点护盾', 'eff');
        break;
      }
      /* 恶魔血巢 a-148-02：回合开始 → 在「对位非空」的己方空位衍生撕裂者 */
      case 'a-148-02': nestSpawnTear(m, key); break;
      /* YOG a-150-02：准备阶段开始时，对上回合**对手发起攻击的位置**造成 8-10 点伤害 */
      case 'a-150-02': {
        var yogOpp = other(key);
        var hitSlots = (state.prevAtk && state.prevAtk[yogOpp]) || [];
        var hitAny = false;
        hitSlots.forEach(function (s) {
          var t = state.players[yogOpp].board[s];
          if (!t) return;
          var dd = 8 + rnd(3);
          hitAny = true;
          log('YOG：上回合的攻击位置 ' + (s + 1) + ' 位 → ' + t.name + ' 受到 ' + dd + ' 点伤害', 'eff');
          damageMonster(t, yogOpp, dd, {});
        });
        if (!hitAny) log('YOG：上回合没有可追击的攻击位置', 'dim');
        break;
      }
      case 'a-126-02': {   // 魔像：准备阶段移动到己方随机空位
        var gs = emptySlots(key);
        if (gs.length) { log('魔像：移动到己方随机空位', 'eff'); moveMonsterTo(key, m, pick(gs)); }
        break;
      }
      case 'a-130-02': {   // 矮人国王：准备阶段获得弃牌堆中随机一张怪物卡
        var kp = state.players[key];
        var dmons = kp.discard.filter(function (c) { return CARDS[c.cardId].type === 'monster'; });
        if (!dmons.length) { log('矮人国王：弃牌堆没有怪物卡', 'dim'); break; }
        if (kp.hand.length >= Rules.HAND_LIMIT) { log('矮人国王：手牌已满，无法取回怪物卡', 'warn'); break; }
        var dmd = pick(dmons);
        kp.discard.splice(kp.discard.indexOf(dmd), 1);
        kp.hand.push(dmd);
        log('矮人国王：从弃牌堆获得【' + CARDS[dmd.cardId].name + '】', 'eff');
        break;
      }
      case 'a-005-2': healMonster(m, 6); break;                             // 大蜗牛
      case 'a-046-2': { var t = pick(aliveMonsters(opp)); if (t) { log('血色哨卫：对 ' + t.name + ' 造成 8 点伤害', 'eff'); damageMonster(t, opp, 8, {}); } break; }
      case 'a-078-2': if (emptySlots(key).length) summonToken(key, 'a-076-2'); break;  // 招魂法师 → 怨灵
      case 'a-079-2': necro(m, key); break;                                 // 死灵法师
      case 'a-054-2': addPoison(opp, 1); log('魔化藤：对方叠加 1 层【毒气】', 'eff'); break;
      case 'a-009-2': damagePlayer(opp, 2, {}); break;                      // 腐臭老鼠：准备阶段对方玩家 -2（原 -1）
      case 'a-082-2': {
        var n = aliveMonsters(opp).length;
        if (n > 0) {
          var feDmg = (state.fireElemMult || 1);                      // 晋升之路·新生火元素【燃火】：效果 ×3
          log('新生火元素：对方场上 ' + n + ' 只怪物各 -' + feDmg, 'eff');
          aliveMonsters(opp).slice().forEach(function (x) { damageMonster(x, opp, feDmg, {}); });
          if (state.fireElemToPlayer) damagePlayer(opp, n * feDmg, {});   // 【惧燃】：效果同时影响玩家本体
        }
        break;
      }
      case 'a-041-2': { var p = state.players[key]; if (!m.flags.hunterDrawn && p.hand.some(function (c) { return CARDS[c.cardId].type === 'throw'; })) { m.flags.hunterDrawn = true; log('女猎B：手牌含投掷物，抽一张牌', 'eff'); draw(key, 1); } break; }
      case 'a-058-2': { // 鼠王：准备阶段开始时，在手牌「衍生」一张神秘宝箱 + 一张名字含"鼠"的怪物（凭空造卡，从所有含"鼠"怪物中随机）
        deriveCard(key, 'a-013-2', m);
        var ratIds = Object.keys(CARDS).filter(function (id) { var cd = CARDS[id]; return cd.type === 'monster' && cd.name.indexOf('鼠') >= 0; });
        if (ratIds.length) deriveCard(key, ratIds[rnd(ratIds.length)], m);
        break;
      }
      default: break;
    }
  }

  function turnEndMonster(m, key) {
    var opp = other(key), op = state.players[opp];
    switch (m.cardId) {
      /* 魔法绵羊 a-142-02：己方回合结束时**消散** —— 直接从场上抹掉，不进弃牌堆、不产卡
         （它是 token，不是真卡；走 destroyMonster 会在弃牌堆凭空多一张）。 */
      case 'a-142-02': {
        var sheepSlot = slotOf(key, m.uid);
        if (sheepSlot >= 0) state.players[key].board[sheepSlot] = null;
        log('魔法绵羊：回合结束，消散', 'dim');
        emit({ type: 'death', uid: m.uid });
        break;
      }
      /* 古神幼虫 a-141-02：回合结束攻击 +2；己方场上有【恶魔血巢】时变成随机 B 级恶魔 */
      case 'a-141-02': {
        m.growthAtk = (m.growthAtk || 0) + 2; recalc(m);
        log('古神幼虫：回合结束，攻击+2', 'eff');
        if (aliveMonsters(key).some(function (x) { return x.cardId === 'a-148-02'; })) {
          var demonPool = Object.keys(CARDS).filter(function (id) {
            var dd = CARDS[id];
            return dd.type === 'monster' && dd.tier === 'B' && (dd.tags || []).indexOf('👿') >= 0;
          });
          if (demonPool.length) {
            var larvSlot = slotOf(key, m.uid);
            var newId = demonPool[rnd(demonPool.length)];
            var nd = CARDS[newId];
            var larvNew = {
              uid: ++uid, cardId: newId, name: nd.name, tier: nd.tier,
              baseHp: nd.hp, maxHp: nd.hp, hp: nd.hp, baseAtk: nd.atk, atk: nd.atk,
              growthAtk: 0, tempAtk: 0, level: 0, weapon: null, armor: null, shield: 0,
              buffs: {}, flags: { attacked: false, attacksMax: 1 }, awaken: null, star: 1
            };
            state.players[key].board[larvSlot] = larvNew;
            applyInnateFlags(larvNew); recalc(larvNew);
            log('古神幼虫：受【恶魔血巢】影响，变为【' + nd.name + '】', 'eff');
            emit({ type: 'summon', uid: larvNew.uid, key: key, cardId: newId, slot: larvSlot });
          }
        }
        break;
      }
      /* 巨型蝎子 a-144-02：**随时自动判定**（玩家 2026-10-25 裁定）——
         只要对位出现怪物就立刻挪走，不再等到回合结束。判定写在 checkScorpions()，
         由 tryAction 的 finally 统一触发，这里不需要再处理。 */
      case 'a-144-02': break;
      /* 邪恶之眼 a-146-02：回合结束仍留有攻击次数 → 4 点减伤 + 两倍伤害（无视减伤）。
         ★ 持续时间按玩家 2026-10-25 裁定：**对手回合就生效**，到**自己下个回合结束**才失效。
           所以不在这里"获得后一回合清"，而是记一个到期回合 eyeUntilTurn，
           由同一张卡在自己下个回合结束时判断到期。 */
      case 'a-146-02': {
        if (m.flags.eyeUntilTurn && (state.turnCount || 1) >= m.flags.eyeUntilTurn) {
          m.flags.eyeShield = 0; m.flags.eyeDouble = false; m.flags.eyeUntilTurn = 0;
          log('邪恶之眼：减伤与双倍伤害加成到期', 'dim');
          break;
        }
        if (!m.flags.eyeUntilTurn && (m.flags.attacked || 0) < (m.flags.attacksMax || 1)) {
          m.flags.eyeShield = 4;
          m.flags.eyeDouble = true;
          m.flags.eyeUntilTurn = (state.turnCount || 1) + 2;
          log('邪恶之眼：回合结束仍留有攻击次数 → 获得 4 点减伤与两倍伤害（持续到你的下个回合结束）', 'eff');
        }
        break;
      }
      case 'a-075-2': { // DM-100
        var myIdx = slotOf(key, m.uid);
        var cands = aliveMonsters(opp).filter(function (x) { return slotOf(opp, x.uid) !== myIdx; });
        if (cands.length) { var t = pick(cands); log('DM-100：对 ' + t.name + ' 造成 5 点伤害', 'eff'); damageMonster(t, opp, 5, {}); }
        break;
      }
      case 'a-048-2': { // 喷毒花：仅当"攻击力提升条件满足"（我方仅此一怪 且 对位有敌 → +5）时回合结束返回手牌；否则留在场上
        var poisonIdx = slotOf(key, m.uid);
        var boosted = aliveMonsters(key).length === 1 && op.board[poisonIdx];
        if (boosted) { log('喷毒花 回合结束返回手牌', 'dim'); leaveBoard(m, key, false); }
        else log('喷毒花：加成条件未满足，留在场上', 'dim');
        break;
      }
      case 'a-051-2': { // 深蓝蝾螈：返回手牌 + 攻击永久+1（装备一并归还）
        log('深蓝蝾螈 返回手牌（攻击+1）', 'dim');
        var ni = leaveBoard(m, key, false);
        if (ni) ni.growthAtk = (m.growthAtk || 0) + 1;
        break;
      }
      case 'a-073-2': // 疯狂小偷：仅"本回合攻击玩家且夺到手牌"时才返回手牌；攻击怪物不返回，继续驻场
        if (m.flags.robbedPlayer) { log('疯狂小偷 已夺取手牌，回合结束返回手牌', 'dim'); leaveBoard(m, key, false); }
        else log('疯狂小偷：本回合未夺取手牌（打怪/没抢到不算），留在场上', 'dim');
        break;
      case 'a-083-2': tenguMove(m, key); break; // 天狗移动
      default: break;
    }
  }

  // 仅处理卡面写明「从场上进入弃牌堆时」的效果（其余「进入弃牌堆时」效果见 onDiscard）
  function onDeath(inst, key, slot, opts) {
    var opp = other(key), op = state.players[opp];
    switch (inst.cardId) {
      case 'a-071-2': { var t = op.board[slot]; if (t) { log('骷髅遗言：对位 ' + t.name + ' 造成 4 点伤害', 'eff'); damageMonster(t, opp, 4, {}); } break; }  // 骷髅（从场上）
      case 'a-080-2': addPoison(opp, 1); op.rotMarks += 1; log('腐烂触手：对方 +1 层【毒气】、+1 腐烂标记', 'eff'); break;  // 腐烂触手（从场上）
      case 'a-124-02': {   // 矮人尸群：下回合结束时若场上有【矮人尸群】（另一张同名卡），在随机空位复活
        // 镜像体不进弃牌堆 → 也就不该进复活队列（否则复活出来是一张真卡）
        if (inst.flags.mirror) break;
        /* ⚠ 队列必须记在**原主**身上：这里的 key 是"死亡当时的持有者"，
           被腐化转移到我方的尸群如果按 key 排队，就会在**我方**场上复活（玩家指出应该是原主那边）。
           卡的归属统一走 discardOwnerOf（与 toDiscard 入堆目标一致）。 */
        var rk = discardOwnerOf(inst, key);
        var pk = state.players[rk];
        pk.reviveQueue = pk.reviveQueue || [];
        // 复活时必须把**弃牌堆里这一张**移走再上场，否则同一次死亡会变成"弃牌堆留一张 + 场上再站一张"
        // （实测就是这样凭空多出一张）。这里记下刚进弃牌堆那个实例的 iid，复活时按 iid 精准取回，
        // 顺带保住它的 growthAtk / level / star。
        var dref = null;
        for (var di = pk.discard.length - 1; di >= 0; di--) {
          if (pk.discard[di].cardId === 'a-124-02') { dref = pk.discard[di]; break; }
        }
        // turnCount 每次 startTurn +1，且「回合结束」发生在 startTurn 之前，
        // 所以：死在**原主自己**的回合 → 下一个原主回合是 +2；死在别人回合 → +1。
        pk.reviveQueue.push({
          cardId: 'a-124-02', iid: dref ? dref.iid : null,
          level: inst.level || 0, star: inst.star || 1,
          dueTurn: (state.turnCount || 0) + (state.active === rk ? 2 : 1)
        });
        log('矮人尸群：下回合结束时若己方场上有【矮人尸群】，将在随机空位复活', 'eff');
        break;
      }
      default: break;
    }
    // 觉醒【自爆】：死亡时对手场上的随机两只怪物死亡
    // （带递归深度保护：被炸死的怪若也带【自爆】，最多连锁 3 层，不会无限炸下去）
    if (inst.awaken === 'boom') {
      var bd = (opts && opts.boomDepth) || 0;
      if (bd < 3) {
        var foes = aliveMonsters(opp).slice();
        var take = Math.min(2, foes.length);
        for (var bi = 0; bi < take; bi++) {
          var fi = Math.floor(rand() * foes.length);
          var fb = foes.splice(fi, 1)[0];
          if (fb) {
            log('【自爆】' + inst.name + ' 带走 ' + fb.name, 'eff');
            destroyMonster(fb, opp, { boomDepth: bd + 1 });
          }
        }
      }
    }
    // BOSS 技能：己方（B）有怪物离场后重新评估本体状态（【保护】依赖【能源塔】是否存活）
    if (state.bossUid && key === 'B') bossHook('bossAllyLeft', inst);
  }

  function summonToken(key, cardId, override) {
    var p = state.players[key], cd = CARDS[cardId];
    if (!cd) return null;
    var s = -1;
    // override.slot：指定栏位衍生（BOSS 技能用，如【呼唤】随机空位、【磁塔】按位替换）
    if (override && override.slot != null) {
      s = override.slot;
      if (s < 0 || s >= p.board.length || p.board[s]) return null;
    } else {
      if (!emptySlots(key).length) return null;
      s = firstEmpty(p);
    }
    var hp = (override && override.hp != null) ? override.hp : cd.hp;
    var atk = (override && override.atk != null) ? override.atk : cd.atk;
    var inst = { uid: uid++, cardId: cardId, name: cd.name, tier: cd.tier, baseHp: hp, maxHp: hp, hp: hp, baseAtk: atk, atk: atk, growthAtk: 0, tempAtk: 0, level: 0, weapon: null, armor: null, shield: 0, buffs: {}, flags: { attacked: false, attacksMax: 1, token: true } };
    p.board[s] = inst;
    applyInnateFlags(inst);
    recalc(inst);
    log('衍生：' + cd.name + ' 出现在' + ln(s) + '位', 'eff');
    return inst;
  }
  function necro(m, key) {
    var p = state.players[key];
    var hasSkel = aliveMonsters(key).some(function (x) { return x.cardId === 'a-071-2'; });
    if (!hasSkel) { if (emptySlots(key).length) summonToken(key, 'a-071-2'); }
    else { aliveMonsters(key).filter(function (x) { return x.cardId === 'a-071-2'; }).forEach(function (s) { s.growthAtk += 1; log('死灵法师：骷髅攻击+1', 'eff'); }); }
  }
  function prisonGuard(inst, key) {
    var opp = other(key), op = state.players[opp];
    var cands = aliveMonsters(opp);
    if (!cands.length) return;
    var t = pick(cands);
    var mySlot = slotOf(key, inst.uid);
    if (op.board[mySlot]) { /* 对位被占，跳过移动 */ }
    else { moveMonsterTo(opp, t, mySlot); log('监狱守卫：将 ' + t.name + ' 移动到对位', 'eff'); }
    /* 「立刻攻击」也算攻击 —— 催眠卷轴 / 时光沙漏 / 禁锢 一样要管得住它。
       移动照常（那不是攻击行为），只把攻击这一段取消掉。 */
    var blockGuard = attackBlockReason(key, inst);
    if (blockGuard) {
      log('监狱守卫：' + blockGuard + '，本次攻击取消', 'eff');
      return;
    }
    log('监狱守卫 立刻攻击 ' + t.name, 'eff');
    damageMonster(t, opp, inst.atk, { attack: true });
  }
  // ★ 天狗成长：移动到任意位置都会触发（不只自己的回合结束 / 受伤害）。
  //   所有「移动怪物」的入口（见 moveMonsterTo）都会调用它，所以被虚空锁链 / 监狱守卫 /
  //   冲击波法杖等移动时也会成长。
  function tenguGrow(m, key) {
    m.growthAtk += 1; m.maxHp += 1; m.hp += 1;
    deriveCard(key, 'a-016-2', m);
    log('天狗：移动至' + ln(slotOf(key, m.uid)) + '位，攻击+1、生命+1，衍生【苦无】', 'eff');
  }
  // 统一的「把一只怪物移动到本方某空位」入口。
  // ⚠ 所有移动方式都必须走这里，否则天狗的成长就不会触发（本次修复的根因：
  //   锁链 / 监狱守卫 / 冲击波法杖之前都是裸操作棋盘，绕过了 tenguMove）。
  // noGrow：这次位移**不算**天狗的「移动时机」（同一次结算里它已经因为"受到伤害"成长过了）。
  function moveMonsterTo(mKey, inst, to, noGrow) {
    var bp = state.players[mKey];
    var from = slotOf(mKey, inst.uid);
    if (from === to) return;
    if (inst.flags && inst.flags.noMove) { log(inst.name + ' 被【大地】禁锢，无法移动', 'dim'); return; }   // 古神之拳（大地）
    bp.board[from] = null;
    bp.board[to] = inst;
    if (inst.cardId === 'a-083-2' && !noGrow) tenguGrow(inst, mKey);   // 天狗：被任意方式移动都成长
  }
  function tenguMove(m, key) {
    var empt = emptySlots(key);
    if (!empt.length) return;
    moveMonsterTo(key, m, pick(empt));
  }

  /* ---------------- 检索 / 衍生 ---------------- */
  /* fromInst：触发这次衍生的怪物（可选）。
     腐化怪衍生出来的卡：**归腐化者使用**，但用掉之后要进**原主**弃牌堆（玩家裁定），
     所以把源怪的原主标记抄给新卡 —— 手牌归属不变，只影响 toDiscard 的入堆目标。 */
  function deriveCard(key, cardId, fromInst) {
    var p = state.players[key];
    if (p.hand.length >= Rules.HAND_LIMIT) {
      /* 手牌满 → 衍生失败。以前用 'dim' 暗色，玩家以为是"卡没生效"；
         改成 'warn'（醒目色）并给出可执行建议，避免"八张遗骸零怨灵"这种无从判断的情况。 */
      log('手牌已满（' + p.hand.length + '/' + Rules.HAND_LIMIT + '），【' + CARDS[cardId].name + '】没能进入手牌——先打掉几张再试', 'warn');
      return;
    }
    var ni = makeInstance(cardId);
    if (fromInst && fromInst.origOwner) ni.origOwner = fromInst.origOwner;
    p.hand.push(ni);
    log('衍生：' + CARDS[cardId].name + ' 加入手牌', 'eff');
  }
  function searchDeckToHand(key, pred, n) {
    var p = state.players[key], got = 0;
    for (var i = p.deck.length - 1; i >= 0 && got < n; i--) {
      if (pred(p.deck[i])) {
        if (p.hand.length >= Rules.HAND_LIMIT) break;
        var c = p.deck.splice(i, 1)[0]; p.hand.push(c); got++;
        log('检索：' + CARDS[c.cardId].name + ' 加入手牌', 'eff');
      }
    }
    if (!got) log('检索：卡组中没有满足条件的卡', 'dim');
  }
  // 随机检索（仅用于卡面明确写「随机」的卡，如 繁花史莱姆 / 补给箱）
  function searchDeckRandom(key, pred, n) {
    var p = state.players[key], got = 0;
    var cands = p.deck.filter(pred);
    for (var k = 0; k < n && cands.length; k++) {
      if (p.hand.length >= Rules.HAND_LIMIT) break;
      var c = cands.splice(rnd(cands.length), 1)[0];
      var di = p.deck.indexOf(c); if (di >= 0) p.deck.splice(di, 1);
      p.hand.push(c); got++;
      log('检索（随机）：' + CARDS[c.cardId].name + ' 加入手牌', 'eff');
    }
    if (!got) log('检索：卡组中没有满足条件的卡', 'dim');
  }
  // 定向选择：让 actorKey 从卡组/手牌中「自行选择」若干张卡（检索 / 弃置）
  // steps: [{ from:'deck'|'hand', count:N, pred:function(inst){}, label:'...' }]
  // 人类玩家 → 弹出选择提示（state.pending）；AI → 自动选择（取候选前 N 张），流程不阻塞。
  /* 选择来源：手牌 / 牌库 / 弃牌堆（澪复活后「从弃牌堆检索」用得到） */
  function zoneOf(p, from) {
    return from === 'deck' ? p.deck : (from === 'discard' ? p.discard : p.hand);
  }
  /* 待决队列：一次结算里可能连开两个选择请求
   * （例：焰浪法杖弃掉黄昏史莱姆 → 史莱姆要对方选一张弃掉 → 法杖自己又要对方选一张）。
   * 以前直接覆盖 state.pending，前一个选择会被静默丢弃。 */
  var pendingQueue = [];

  function requestChoices(actorKey, steps, done) {
    var p = state.players[actorKey];
    var valid = [];
    steps.forEach(function (st) {
      /* 自定义候选（装备 / 法杖 / 祭品 / 弃牌堆元素卡）：直接用 cands，不走 hand/deck/discard */
      if (st.cands && st.cands.length) {
        /* 透传**全部**字段（用 Object.assign 而不是逐个列）：以前只挑固定几项，
           新加的 kind / artIid 这类参数会被悄悄丢掉，applyChoice 那边拿到 undefined。
           ⚠ cands 分支不带 pred（函数无法 JSON 传输），所以整体浅拷贝是安全的。 */
        valid.push(Object.assign({}, st, { from: st.from || 'custom', count: st.count, exact: !!st.exact }));
        return;
      }
      var zone = zoneOf(p, st.from);
      var hits = zone.filter(st.pred || function () { return true; });   // 无 pred = 任意卡
      if (hits.length) {
        // 候选一并算成**纯数据**存进 pending：联机时 pending 要经过 JSON 传输，函数会丢，
        // 客户端没法再用 pred 过滤（以前会直接导致"渲染异常"）。
        valid.push({
          from: st.from, count: st.count, pred: st.pred, label: st.label, to: st.to,
          exact: !!st.exact,      // ★ true = 必须选够 count 张（焰浪法杖等），见 applyChoice
          cands: hits.map(function (c) {
            var cd = cardOf(c);
            return { iid: c.iid, cardId: c.cardId, name: cd.name, tier: cd.tier || '', type: cd.type };
          })
        });
      } else log((st.label || '检索') + '：没有满足条件的卡', 'dim');
    });
    if (!valid.length) { if (done) done(); return; }
    if (p.isAI) {
      valid.forEach(function (st) { applyChoice(actorKey, st, chooseAuto(actorKey, st)); });
      if (done) done();
      return;
    }
    var pdNew = { kind: 'CHOOSE_CARDS', actorKey: actorKey, steps: valid, idx: 0, done: done || function () { } };
    if (state.pending) { pendingQueue.push(pdNew); return; }   // 已有待决 → 排队，别覆盖
    state.pending = pdNew;
  }
  // to: 'hand'(检索入牌,默认) | 'discard'(弃置,默认) | 'summon'(召唤上场)
  function applyChoice(actorKey, st, iids) {
    var p = state.players[actorKey];
    iids = iids || [];
    /* 先去重：联机客户端可能把同一个 iid 报两次。重复项会让下面的"补足"误判成已选够，
     * 而实际只处理一张（第二遍 findIndex 已经找不到它了）→ 又变成"少弃"。 */
    var seen = {};
    iids = iids.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; });
    /* ★ exact 步骤（卡面写着"必须弃掉 N 张"的，如焰浪法杖）：
     *   count 从「最多 N 张」变成「恰好 N 张」——选少了就从候选里补足（手牌不足时按可选项数封顶）。
     *   补足放在这里而不是 UI：AI 路径、联机被绕过 UI 的调用、旧客户端，全都统一生效。
     *   未标记 exact 的（检索类）保持原来的"最多 N 张"语义，不强制。 */
    var need = 0;
    if (st && st.exact) need = Math.min(st.count || 0, (st.cands && st.cands.length) || 0);
    if (iids.length < need) {
      var has = {};
      iids.forEach(function (x) { has[x] = 1; });
      (st.cands || []).forEach(function (c) {
        if (iids.length < need && !has[c.iid]) { iids.push(c.iid); has[c.iid] = 1; }
      });
    }
    /* ---- 自定义动作（不按 hand/deck/discard 处理）---- */
    if (st && st.action) {
      if (st.action === 'chaos') {
        var cc = (st.cands || []).filter(function (c) { return c.iid === iids[0]; })[0];
        if (cc) chaosApply(cc.cardId);
        return;
      }
      if (st.action === 'sorcererTarget') { sorcererRef = findEquipRef(iids[0]); return; }
      if (st.action === 'sorcererSign') {
        sorcererSign = (iids[0] === 1) ? 2 : -2;
        if (sorcererRef) levelEquipRef(sorcererRef, sorcererSign);
        return;
      }
      if (st.action === 'sorcererSac') {
        var vic = findMonster(actorKey, iids[0]);
        if (vic && vic.cardId === 'a-142-02') { log('【魔法绵羊】不可用于献祭/牺牲', 'dim'); return; }
        if (vic) {
          log('矮人术士：牺牲 ' + vic.name, 'eff');
          destroyMonster(vic, actorKey, { sacrifice: true });
        }
        return;
      }
      /* 恐惧卷轴（a-133-02）：对手选中的 B/C 级怪物返回其手牌 */
      if (st.action === 'fearReturn') {
        var fv = findMonster(actorKey, iids[0]);
        if (fv) { log('恐惧卷轴：' + fv.name + ' 返回手牌', 'eff'); leaveBoard(fv, actorKey, false); }
        return;
      }
      /* 古神之拳（腐烂形态）：攻击方选择叠毒气还是酸气 */
      if (st.action === 'fistRot') {
        var rotOpp = other(actorKey);
        if (iids[0] === 'poison') {
          addPoison(rotOpp, 2);
          log('古神之拳（腐烂）：对手叠加 2 层【毒气】', 'eff');
        } else {
          addAcid(rotOpp, 1);
          log('古神之拳（腐烂）：对手叠加 1 层【酸气】', 'eff');
        }
        return;
      }
      /* 古神之拳 a-149-02：选定形态 */
      if (st.action === 'fistForm') {
        var fistM = findMonster(actorKey, st.fistUid);
        if (fistM) {
          /* ⚠ 容错：UI 曾经用 `+dataset.iid` 把 'burn' 强转成 NaN（日志里的"NaN形态"）。
             这里接受「字符串形态名」和「数字下标」两种，取不到就退回 default。 */
          var FIST_KEYS = ['default', 'burn', 'earth', 'rot', 'rust', 'glory', 'shadow'];
          var fv = iids[0];
          if (FIST_KEYS.indexOf(fv) < 0) fv = FIST_KEYS[Number(fv)] || 'default';
          fistM.flags.fistForm = fv;
          var formName = { default: '默认', burn: '燃烧', earth: '大地', rot: '腐烂', rust: '锈蚀', glory: '辉耀', shadow: '暗影' }[fv] || '默认';
          log('古神之拳：转变为【' + formName + '形态】', 'eff');
        }
        return;
      }
      /* 复仇卷轴（a-154-02）：己方选中的怪物 → 对对手随机怪造成「其已损失生命」的伤害 */
      if (st.action === 'revengePick') {
        var rsrc = findMonster(actorKey, iids[0]);
        if (rsrc) {
          var lost = Math.max(0, (rsrc.maxHp || 0) - (rsrc.hp || 0));
          var foes = aliveMonsters(other(actorKey));
          if (lost > 0 && foes.length) {
            var rtgt = foes[rnd(foes.length)];
            log('复仇卷轴：' + rsrc.name + ' 已损失 ' + lost + ' 生命 → ' + rtgt.name + ' 受到等量伤害', 'eff');
            damageMonster(rtgt, other(actorKey), lost, {});
          } else log('复仇卷轴：没有损失生命或对手场上没有怪物，无效果', 'dim');
        }
        return;
      }
      /* 炖肉 a-084-2：回 4 生命 + 攻击永久+1 */
      if (st.action === 'meatPick') {
        var mt = findMonster(actorKey, iids[0]);
        if (mt) {
          healMonster(mt, 4);
          mt.growthAtk = (mt.growthAtk || 0) + 1;
          recalc(mt);
          log('炖肉：' + mt.name + ' 恢复 4 生命且攻击+1', 'eff');
        }
        return;
      }
      /* 口粮 a-017-2：回 4 生命 + 2 点护盾 */
      if (st.action === 'rationPick') {
        var rt = findMonster(actorKey, iids[0]);
        if (rt) {
          healMonster(rt, 4);
          rt.shield = (rt.shield || 0) + 2;
          log('口粮：' + rt.name + ' 恢复 4 生命并获得 2 点护盾', 'eff');
          emit({ type: 'float', uid: rt.uid, text: '+2 盾', kind: 'shield' });
        }
        return;
      }
      /* 隐身药水（a-156-02）：己方选中的怪物一回合无法选中 */
      if (st.action === 'hidePick') {
        var hv = findMonster(actorKey, iids[0]);
        if (hv) {
          hv.flags.untargetable = true;
          hv.flags.untargetableUntilOwnerTurn = true;
          log('隐身药水：' + hv.name + ' 一回合内无法选中', 'eff');
        }
        return;
      }
      /* 无味果（a-157-02）一阶段：弃掉所选药水，把效果**存到那张无味果实例上**（不立刻发动） */
      if (st.action === 'copyPotion') {
        var fp = state.players[actorKey];
        var pc = fp.hand.filter(function (c) { return c.iid === iids[0]; })[0];
        var fruit = fp.hand.filter(function (c) { return c.iid === st.copyIid; })[0];
        if (pc && fruit) {
          var pcd = cardOf(pc);
          removeFromHand(fp, pc.iid);
          discardUsed(actorKey, pc);
          fruit.flags = fruit.flags || {};
          fruit.flags.copiedCardId = pc.cardId;          // 标记：这张无味果进入"二阶段"
          log('无味果：弃置【' + pcd.name + '】，获得其效果（再次使用即可发动，且不消耗次数）', 'eff');
        }
        return;
      }
      /* ebonyDiscard 分支已移除：黑檀宝箱改为**直接**随机抽取（逻辑见 ebonyDraw） */
      /* 无序魔典 / 炼金工具箱：选中的效果 → 消耗对应种类次数 + 进冷却 + 执行 */
      if (st.action === 'tomePick') {
        var tp = state.players[actorKey];
        var pick = (st.cands || []).filter(function (c) { return c.iid === iids[0]; })[0];
        if (!pick) return;
        var tkind = st.kind === 'potion' ? 'potion' : 'scroll';
        var tu = tp.flags.used || (tp.flags.used = {});
        tu[tkind] = 1;                                   // 消耗该种类本回合的使用次数
        var tart = tp.artifacts.filter(function (a) { return a.iid === st.artIid; })[0];
        if (tart) { tart.flags = tart.flags || {}; tart.flags.cd = 5; }
        log((tkind === 'scroll' ? '无序魔典' : '炼金工具箱') + '：发动【' + pick.name + '】，进入 5 回合冷却', 'eff');
        /* 需要二次选目标的效果：当前场况没目标就提示并作废（次数已经扣了，玩家裁定） */
        if (!virtualTargetOk(actorKey, pick.cardId)) {
          log('【' + pick.name + '】效果无目标，本次发动没有产生效果（使用次数已消耗）', 'warn');
          return;
        }
        runVirtualCard(actorKey, pick.cardId, tkind);
        return;
      }
    }
    iids.forEach(function (iid) {
      if (st.from === 'deck') {
        var i = p.deck.findIndex(function (c) { return c.iid === iid; });
        if (i >= 0 && p.hand.length < Rules.HAND_LIMIT) { var c = p.deck.splice(i, 1)[0]; p.hand.push(c); log('检索：' + cardOf(c).name + ' 加入手牌', 'eff'); }
      } else if (st.from === 'discard') {
        /* 从弃牌堆检索（澪）：取出来放进手牌，不是再弃一次 */
        if (p.hand.length >= Rules.HAND_LIMIT) { log('手牌已满，无法从弃牌堆取回', 'dim'); return; }
        var k = p.discard.findIndex(function (c) { return c.iid === iid; });
        if (k >= 0) {
          var c3 = p.discard.splice(k, 1)[0];
          p.hand.push(c3);
          log('检索：' + cardOf(c3).name + ' 从弃牌堆加入手牌', 'eff');
        }
      } else {
        var j = p.hand.findIndex(function (c) { return c.iid === iid; });
        if (j >= 0) {
          var c2 = p.hand.splice(j, 1)[0];
          if (st.to === 'summon') { log('召唤陷阱：召唤 ' + cardOf(c2).name, 'eff'); spawnMonster(actorKey, c2, null); }
          else {
            /* 打「因对手效果被弃置」标记（自然之靴 a-140-02 判定用）。
               requestChoices 的 hand 弃置都是被效果逼着弃的；黄金宝箱那种"自己选一张代价"
               不走这里（它用 action.discardIid）。 */
            c2.flags = c2.flags || {}; c2.flags.byOpp = true;
            toDiscard(actorKey, c2, false);
            log('弃置：' + cardOf(c2).name, 'dim');
          }
        }
      }
    });
  }
  /* ---------------- AI 选牌 / 可选技能策略（由 ai.js 注册） ---------------- */
  // 未注册时退化为"取候选前 N 张"（旧行为）
  var aiPolicy = null;
  function setAIPolicy(p) { aiPolicy = p; }
  function chooseAuto(actorKey, st) {
    var p = state.players[actorKey];
    // ★ 优先用引擎算好的自定义候选（from:'custom'）。
    //   矮人术士的「选装备/法杖、选±2、选牺牲目标」和混沌元素的「选要复制的元素卡」
    //   都是 cands 而不是某个 zone，若这里把 'custom' 当成手牌，AI/自动战斗会拿手牌 iid 去匹配，
    //   结果一步都匹配不上 → 技能静默空转（不报错但也不生效）。
    var cands;
    if (st.cands && st.cands.length) cands = st.cands;
    else cands = zoneOf(p, st.from).filter(st.pred || function () { return true; });
    if (aiPolicy && aiPolicy.pickChoice) {
      var picked = aiPolicy.pickChoice(actorKey, st, cands);
      if (picked && picked.length) return picked.slice(0, st.count);
    }
    return cands.slice(0, st.count).map(function (c) { return c.iid; });
  }

  /* ---------------- 召唤陷阱 ---------------- */
  function checkSummonTrap(holderKey, summonedKey, summoned) {
    var p = state.players[holderKey];
    // 召唤陷阱：将手牌一张C级怪召唤到己方随机空位（C级怪物由持卡者定向选择）
    var st = p.hand.filter(function (c) { return c.cardId === 'a-064-2'; })[0];
    if (st && emptySlots(holderKey).length) {
      var cs = p.hand.filter(function (c) { var cd = CARDS[c.cardId]; return cd.type === 'monster' && cd.tier === 'C'; });
      if (cs.length) {
        removeFromHand(p, st.iid); p.discard.push(st);
        log(holderKey === 'A' ? '召唤陷阱 发动！' : '对手发动 召唤陷阱！', 'eff');
        emit({ type: 'trap', key: holderKey, cardId: 'a-064-2' });
        requestChoices(holderKey, [{ from: 'hand', count: 1, pred: function (c) { var cd = CARDS[c.cardId]; return cd.type === 'monster' && cd.tier === 'C'; }, label: '选择一张 C 级怪物召唤', to: 'summon' }]);
      }
    }
    // 毒气陷阱：对方叠加3层毒气
    var gt = p.hand.filter(function (c) { return c.cardId === 'a-089-2'; })[0];
    if (gt) {
      removeFromHand(p, gt.iid); p.discard.push(gt);
      addPoison(summonedKey, 3);
      log((holderKey === 'A' ? '毒气陷阱' : '对手的毒气陷阱') + ' 发动：对方叠加 3 层【毒气】', 'eff');
      emit({ type: 'trap', key: holderKey, cardId: 'a-089-2' });
    }
    /* 闪光陷阱（新卡 a-138-02）：对手召唤怪物时**可**发动 → 其接下来 2 回合无法使用投掷物/法杖。
       卡面是"可发动"，所以人类持有者要弹窗询问（同麻痹陷阱）；AI 直接判定发动。
       封锁记在**召唤者**身上（summonedKey），净化状态 → 直接不发动、陷阱留在手里。 */
    var ft = p.hand.filter(function (c) { return c.cardId === 'a-138-02'; })[0];
    if (ft) {
      var ftTurns = CARDS['a-138-02'].mods.banTW;
      if (negImmune(summonedKey)) {
        log('闪光陷阱：' + state.players[summonedKey].name + ' 处于净化状态，封锁无效（陷阱保留）', 'dim');
      } else if (p.isAI) {
        removeFromHand(p, ft.iid); discardUsed(holderKey, ft);
        emit({ type: 'trap', key: holderKey, cardId: 'a-138-02' });
        log((holderKey === 'A' ? '闪光陷阱' : '对手的闪光陷阱') + ' 发动！', 'eff');
        banThrowWand(summonedKey, ftTurns);
      } else {
        state.pending = {
          kind: 'TRAP_FLASH', trapIid: ft.iid,
          actorKey: holderKey, victimKey: summonedKey, turns: ftTurns
        };
      }
    }
    // 爆炸陷阱（新卡 a-117-2）：对手召唤怪物时立即发动，对该怪物造成 8 点伤害
    var bt = p.hand.filter(function (c) { return c.cardId === 'a-117-2'; })[0];
    if (bt && summoned && !summoned.flags.dead) {
      removeFromHand(p, bt.iid); p.discard.push(bt);
      log((holderKey === 'A' ? '爆炸陷阱' : '对手的爆炸陷阱') + ' 发动：' + summoned.name + ' 受到 ' + CARDS['a-117-2'].mods.dmg + ' 点伤害', 'eff');
      emit({ type: 'trap', key: holderKey, cardId: 'a-117-2' });
      damageMonster(summoned, summonedKey, CARDS['a-117-2'].mods.dmg, {});
    }
  }

  /* ---------------- 玩家操作 ---------------- */
  function tryAction(action) {
    if (!state || state.winner) return fail('对局已结束');
    if (state.pending) return fail('请先处理弹出的提示');
    var a = state.active, p = state.players[a];
    if (p.isAI && !action._ai) return fail('当前不是你的回合');
    state.events = [];
    try {
      switch (action.type) {
        case 'SUMMON': return actSummon(a, action);
        case 'SACRIFICE': return actSacrifice(a, action);
        case 'USE': return actUse(a, action);
        case 'EQUIP': return actEquip(a, action);
        case 'PLACE_WAND': return actPlaceWand(a, action);
        case 'ACTIVATE_WAND': return actActivateWand(a, action);
        case 'ATTACK': return actAttack(a, action);
        case 'MOVE_MONSTER': return actMoveMonster(a, action);
        case 'TIME_STOP': return actTimeStop(a);
        case 'USE_CUP': return actUseCup(a, action);          // 蓄血圣杯（a-139-02）
        case 'USE_TOME': return actUseTome(a, action);        // 无序魔典 / 炼金工具箱（a-159-02 / a-160-02）
        case 'CONFIRM_BATTLE': return actConfirmBattle(a);
        case 'END_TURN': return actEndTurn(a);
        default: return fail('未知操作');
      }
    } finally {
      recalcAll();
      /* 兜底清理：正常路径里 hp<=0 的怪应该在 damageMonster 里就被 destroyMonster 处理掉，
         但新卡的一些"衍生/转移/替换"链路（血巢衍生、撕裂者立刻攻击、古神之拳承担伤害…）
         可能让某个实例扣到负血却没走死亡判定（fuzz 里抓到过 board 上残留 hp=-1）。
         这里在每次操作结束时补一次清扫，保证不会出现负血的活怪。 */
      checkScorpions();          // 巨型蝎子：对位一出现敌人就挪走（随时判定）
      sweepDeadMonsters();
      if (!state.pending) notify();
      else notify();
    }
  }
  function ok(msg) { notify(); return { ok: true, msg: msg || '' }; }
  function fail(msg) { return { ok: false, msg: msg || '操作不合法' }; }

  function actSummon(key, action) {
    var p = state.players[key];
    if (state.phase !== 'PREP') return fail('仅准备阶段可召唤');
    var inst = p.hand.filter(function (c) { return c.iid === action.iid; })[0];
    if (!inst) return fail('手牌中没有该卡');
    var cd = cardOf(inst);
    if (cd.type !== 'monster') return fail('该卡不是怪物卡');
    if (cd.tier === 'A' || cd.tier === 'S') return fail('该等级需献祭召唤');
    // YOG a-150-02：己方唯一（场上已有一张就不能再上）
    if (cd.id === 'a-150-02' && aliveMonsters(key).some(function (m) { return m.cardId === 'a-150-02'; })) {
      return fail('【YOG】具有己方唯一性，场上已有一张');
    }
    if (p.summonsLeft <= 0) return fail('本阶段已召唤');
    if (!emptySlots(key).length) return fail('己方怪物区已满');
    var slot = (action.slot != null && !p.board[action.slot]) ? action.slot : firstEmpty(p);
    removeFromHand(p, inst.iid);
    // 觉醒【迅捷】：召唤这张卡不消耗召唤次数（手牌实例上还没掷词条，这里按规则现算）
    // 觉醒【迅捷】：词条就在实例上（学院合成 3★ 时抽定的），直接读即可。
    var awSummon = inst.awaken || null;
    if (awSummon !== 'swift') p.summonsLeft -= 1;
    spawnMonster(key, inst, slot);
    refreshCasts(key);      // 召唤出的是法师B → 本回合立刻多 1 次施法
    return ok();
  }

  function actSacrifice(key, action) {
    var p = state.players[key];
    if (state.phase !== 'PREP') return fail('仅准备阶段可召唤');
    var inst = p.hand.filter(function (c) { return c.iid === action.iid; })[0];
    if (!inst) return fail('手牌中没有该卡');
    var cd = cardOf(inst);
    if (cd.type !== 'monster' || (cd.tier !== 'A' && cd.tier !== 'S')) return fail('该卡无法献祭召唤');
    var victim = findMonster(key, action.targetUid);
    if (!victim) return fail('需献祭己方场上怪物');
    if (victim.cardId === 'a-142-02') return fail('【魔法绵羊】不可用于献祭/牺牲');
    if (cd.tier === 'A' && !(victim.tier === 'C' || victim.tier === 'B')) return fail('A 级需献祭 C/B 级怪物');
    if (cd.tier === 'S' && victim.tier !== 'A') return fail('S 级需献祭 A 级怪物');
    if (cardOf(inst).id === 'a-150-02' && aliveMonsters(key).some(function (m) { return m.cardId === 'a-150-02'; })) {
      return fail('【YOG】具有己方唯一性，场上已有一张');
    }
    if (p.summonsLeft <= 0) return fail('本阶段已召唤');
    var slot = slotOf(key, victim.uid);
    removeFromHand(p, inst.iid);
    p.summonsLeft -= 1;
    log('献祭 ' + victim.name + ' 召唤 ' + cd.name, 'eff');
    var wasGhost = victim.cardId;   // 记录祭品，用于进化继承判定
    destroyMonster(victim, key, { sacrifice: true });
    var nM = spawnMonster(key, inst, slot);
    // 咒缚灵：由【怨灵】献祭进化时，继承怨灵的【无法被攻击】
    if (cd.id === 'a-077-2' && wasGhost === 'a-076-2') { nM.flags.untargetable = true; nM.flags.untargetableInnate = true; log('咒缚灵 进化：继承【怨灵】的【无法被攻击】', 'eff'); }
    refreshCasts(key);      // 献祭召唤出法师B → 同样要立刻多 1 次施法
    return ok();
  }

  function actUse(key, action) {
    var p = state.players[key];
    var inst = p.hand.filter(function (c) { return c.iid === action.iid; })[0];
    if (!inst) return fail('手牌中没有该卡');
    var cd = cardOf(inst);
    var opp = other(key), op = state.players[opp];
    if (state.phase !== 'PREP') return fail('仅准备阶段可使用');
    /* 每回合限制：食物 / 药水 / 卷轴 各限 1 张（宝藏/投掷物不限量）。
       ★ 例外：无味果 a-157-02 的**二阶段**（已经存了某个药水效果）发动时**不消耗任何种类次数**
         （玩家 2026-10-25 裁定）；一阶段（还没存效果）照常消耗食物次数。 */
    var fopStage2 = (cd.id === 'a-157-02' && inst.flags && inst.flags.copiedCardId);
    var limited = !fopStage2 && ['food', 'potion', 'scroll'].indexOf(cd.type) >= 0;
    var used = p.flags.used || (p.flags.used = {});
    if (limited && used[cd.type]) return fail('本回合该种卡使用次数已耗尽');
    var okflag = false;
    switch (cd.type) {
      case 'treasure': okflag = useTreasure(key, inst, cd, action); break;
      case 'throw': okflag = useThrow(key, inst, cd, action); break;
      case 'food': okflag = useFood(key, inst, cd); break;
      case 'potion': okflag = usePotion(key, inst, cd); break;
      case 'scroll': okflag = useScroll(key, inst, cd, action); break;
      case 'ring': return fail('戒指在手牌中持续生效，无需使用');
      case 'trap': return fail('陷阱需在对手回合条件触发');
      default: return fail('该卡不能直接使用');
    }
    if (okflag === true) {
      if (limited) used[cd.type] = 1;
      // 羊群陷阱（a-158-02）：对手用了宝藏/药水卡 → 双方空位衍生魔法绵羊
      checkSheepTrap(key, cd.type);
      // 成就：各类道具使用次数（药师 / 食神 / 卷轴学者）
      if (key === 'A' && state.ach && !state.ach.off) {
        if (cd.type === 'potion') state.ach.potion += 1;
        else if (cd.type === 'food') state.ach.food += 1;
        else if (cd.type === 'scroll') state.ach.scroll += 1;
      }
      emit({ type: 'play', key: key, cardId: cd.id, verb: '使用' });   // 供 UI 回放"谁打出了哪张牌"
      return ok();
    }
    // 子函数可用 fail() 返回具体原因（如"该防具已贴过纹章"），此处原样透出，不再统一吞成"使用条件不满足"
    if (okflag && okflag.ok === false) return okflag;
    return fail('使用条件不满足');
  }

  function useTreasure(key, inst, cd, action) {
    var p = state.players[key], m = cd.mods || {};
    /* 坟墓（新卡 a-131-02）：从弃牌堆查看**随机三张**，选一张加入手牌。
       自己刚打出就要进堆，所以要排除掉它自己（否则会出现"坟墓捡回坟墓"）。
       候选走 from:'discard' + cands —— applyChoice 的 discard 分支会把选中的卡取进手牌。 */
    /* 黑檀宝箱（a-151-02）：**使用不再需要弃牌**（玩家 2026-10-25），
       直接随机抽一张装备卡 + 一张升级卷轴。 */
    if (cd.id === 'a-151-02') {
      removeFromHand(p, inst.iid);
      discardUsed(key, inst);
      log('黑檀宝箱：随机抽取牌堆中一张装备卡与一张升级卷轴', 'eff');
      ebonyDraw(key);
      return true;
    }
    if (cd.id === 'a-131-02') {
      removeFromHand(p, inst.iid);
      discardUsed(key, inst);
      var pool = p.discard.filter(function (c) { return c.iid !== inst.iid; });
      if (!pool.length) { log('坟墓：弃牌堆里没有其他卡牌', 'dim'); return true; }
      var gcopy = pool.slice(), gpicks = [];
      for (var gi = 0; gi < (m.gravePick || 3) && gcopy.length; gi++) gpicks.push(gcopy.splice(rnd(gcopy.length), 1)[0]);
      var gcands = gpicks.map(function (c) {
        return { iid: c.iid, cardId: c.cardId, name: CARDS[c.cardId].name, type: CARDS[c.cardId].type };
      });
      log('坟墓：从弃牌堆查看随机 ' + gcands.length + ' 张卡牌', 'eff');
      requestChoices(key, [{ from: 'discard', count: 1, cands: gcands, label: '坟墓：选择一张加入手牌' }]);
      return true;
    }
    if (cd.id === 'a-033-2') { // 破损纹章：对"一张防具卡"使用（可选手牌中的防具，或已装备在怪物上的防具）
      var armor = null, where = '';
      if (action.targetUid != null) {                       // 已装备的防具
        var mm = findMonster(key, action.targetUid);
        if (mm && mm.armor && CARDS[mm.armor.cardId].type === 'armor') { armor = mm.armor; where = mm.name + ' 的'; }
      }
      if (!armor && action.targetIid != null) {             // 手牌中的防具卡
        armor = p.hand.filter(function (c) { return c.iid === action.targetIid && CARDS[c.cardId].type === 'armor'; })[0] || null;
      }
      if (!armor) return false;
      // 限制：同一张防具最多贴 1 张【破损纹章】（不能叠加）。
      // 必须在"消耗纹章"之前判定 —— 否则纹章会被白烧掉一张。
      if (armor.flags && armor.flags.emblemReduce > 0) return fail('该防具已贴过【破损纹章】，无法叠加（同一防具限 1 张）');
      removeFromHand(p, inst.iid); discardUsed(key, inst);
      // 破损纹章只提升「减伤能力 +1」，不改动防具等级（等级只由升级卷轴/灌注提升；等级仍单独用于"弃置补偿"判定）
      armor.flags = armor.flags || {};
      armor.flags.emblem = true;
      armor.flags.emblemReduce = 1;
      log('破损纹章：' + where + CARDS[armor.cardId].name + ' 减伤能力 +1（现额外减伤 1 点，防具 Lv' + (armor.level || 0) + '）', 'eff');
      return true;
    }
    if (cd.id === 'a-014-2') { // 黄金宝箱：必须由玩家选择弃置一张手牌（不能随机），然后抽三张
      if (inst.iid === undefined || p.hand.length < 2) return false;
      var cost = p.hand.filter(function (c) { return c.iid === action.discardIid && c.iid !== inst.iid; })[0];
      if (!cost) return false;                              // 未指定弃置目标
      removeFromHand(p, inst.iid); discardUsed(key, inst);
      removeFromHand(p, cost.iid); toDiscard(key, cost, false);
      log(cd.name + '：弃置 ' + cardOf(cost).name + '，抽 ' + (m.draw || 3) + ' 张牌', 'eff');
      draw(key, m.draw || 3);
      return true;
    }
    removeFromHand(p, inst.iid); discardUsed(key, inst);
    if (m.draw) { if (m.discard) discardRandom(key, m.discard); log(cd.name + '：抽 ' + m.draw + ' 张牌', 'eff'); draw(key, m.draw); }
    if (cd.id === 'a-060-2') searchDeckRandom(key, function (c) { var t = CARDS[c.cardId].type; return t === 'food' || t === 'potion' || t === 'scroll'; }, 1);
    if (cd.id === 'a-113-2') searchDeckRandom(key, function (c) { var t = CARDS[c.cardId].type; return t === 'wand' || t === 'ring'; }, 1);   // 水晶宝箱（新卡）：随机检索法杖/戒指
    if (cd.id === 'a-085-2') {
      /* ★ 顺序必须是「先掷 50% 衍生，再抽牌」。
       *   旧写法是"先抽 1 张、再衍生"：遗骸施放时手牌 -1，抽牌正好把牌补回上限 10，
       *   于是 deriveCard 里 `hand.length >= HAND_LIMIT` 直接 return →
       *   **满手牌时遗骸 100% 产不出怨灵**（实测：手牌 5 张时 50.0%，满手 3.5%）。
       *   玩家看不到那条暗色提示，只觉得"遗骸抽了牌但从来不给怨灵"。
       *   先衍生：满手时会先拿到怨灵（9→10），抽的那张再按既有溢出规则洗回牌库。 */
      if (rand() < 0.5) deriveCard(key, 'a-076-2');
      draw(key, 1);
    }
    return true;
  }
  function useThrow(key, inst, cd, action) {
    var opp = other(key);
    var p = state.players[key];
    // 时停 / 棱光法杖 / 闪光陷阱：统一封锁判定
    var throwBan = throwWandBanReason(key);
    if (throwBan) { log(throwBan, 'dim'); return false; }
    var t = findMonster(opp, action.targetUid);
    if (!t) return false;
    /* 飞斧 a-061-2：**只能对已受伤的敌方怪物使用**（2026-10-25 改）。
       ⚠ 校验必须在 removeFromHand 之前 —— 否则卡先没了但没效果。 */
    if (cd.id === 'a-061-2' && t.hp >= t.maxHp) {
      log('飞斧：只能对已受伤的敌方怪物使用', 'dim');
      return false;
    }
    removeFromHand(p, inst.iid); discardUsed(key, inst);
    if (cd.id === 'a-086-2') { // 炸弹：埋设，在你的下一个准备阶段开始时对原位置及十字方向（左右）各造成 6 点伤害
      var slot = slotOf(opp, t.uid);
      p.bombs = p.bombs || [];
      p.bombs.push({ slot: slot });
      // 成就「买一送一」：本回合使用的炸弹数
      if (key === 'A' && state.ach && !state.ach.off) {
        state.ach.bombsThisTurn += 1;
        if (state.ach.bombsThisTurn > state.ach.bombsMax) state.ach.bombsMax = state.ach.bombsThisTurn;
      }
      log('炸弹已埋设：你的下一个准备阶段开始时，对敌方第 ' + (slot + 1) + ' 位及其左右各造成 ' + Rules.BOMB_DAMAGE + ' 点伤害', 'eff');
      return true;
    }
    var dmg = cd.mods.dmg;
    /* 飞刀 a-015-2：目标**未受伤**（满血）时伤害翻倍（2026-10-25 新增）。 */
    if (cd.id === 'a-015-2' && t.hp >= t.maxHp) {
      dmg = dmg * 2;
      log('飞刀：目标未受伤害 → 伤害翻倍（' + cd.mods.dmg + ' → ' + dmg + '）', 'eff');
    }
    /* reduce: true —— 投掷物也受怪物减伤影响（玩家裁定，见 damageMonster 里的说明）。
       日志用**实际伤害**：被减伤时写成「苦无：对 X 造成 2 点伤害（减伤 1）」。 */
    var dealt = damageMonster(t, opp, dmg, { reduce: true });
    log(cd.name + '：对 ' + t.name + ' 造成 ' + dealt + ' 点伤害' +
      (dealt < dmg ? '（减伤 ' + (dmg - dealt) + '）' : ''), 'eff');
    // 成就：投掷物击杀数 / 单次最高伤害（按实际打出的伤害计）
    if (key === 'A' && state.ach && !state.ach.off) {
      if (dealt > state.ach.maxHit) state.ach.maxHit = dealt;
      if (t.flags.dead) state.ach.throwKills += 1;
    }
    // 回旋镖（新卡 a-114-2）：你的下一个回合开始时返回手牌
    if (cd.mods && cd.mods.returnToHand) { inst.returnAtTurn = true; log('回旋镖：将在你的下一个回合开始时返回手牌', 'dim'); }
    // 姬莲梅錵：每使用一张投掷物恢复5生命
    healOnThrowUsed(key);
    // 神射戒指计数
    countThrowForRing(key);
    return true;
  }
  // 姬莲梅錵：每使用一张投掷物卡，我方姬莲梅錵恢复 5 点生命
  function healOnThrowUsed(key) {
    aliveMonsters(key).forEach(function (x) { if (x.cardId === 'a-98-2') { healMonster(x, 5); log('姬莲梅錵：投掷物结算后恢复 5 点生命', 'eff'); } });
  }
  // 神射戒指：在手牌时，每打出三张投掷物卡，从弃牌堆随机回收一张投掷物
  function countThrowForRing(key) {
    var p = state.players[key];
    if (!p.hand.some(function (c) { return c.cardId === 'a-090-2'; })) return;
    p.flags.throwCount = (p.flags.throwCount || 0) + 1;
    if (p.flags.throwCount % 3 === 0) {
      // 卡面：从弃牌堆"随机"选中一张投掷物卡返回手牌
      var ths = p.discard.filter(function (c) { return CARDS[c.cardId].type === 'throw'; });
      var rc = pick(ths);
      if (rc) {
        var ii = p.discard.indexOf(rc); if (ii >= 0) p.discard.splice(ii, 1);
        // 回旋镖：已被"提前捞回"手牌 → 清除待回手标记，否则日后以非使用方式被弃置会异常回手
        if (rc.returnAtTurn) { rc.returnAtTurn = false; log('回旋镖已被回收，取消本次回手', 'dim'); }
        p.hand.push(rc);
        log('神射戒指：从弃牌堆随机回收投掷物 ' + CARDS[rc.cardId].name, 'eff');
      }
    }
  }
  function useFood(key, inst, cd) {
    var p = state.players[key];
    /* ⚠ 无味果 a-157-02 的**一阶段**（还没存效果）要留在手牌里"获得效果"，
       不能走这里的统一移除；二阶段才是真正消耗掉这张卡。 */
    var keepFruitInHand = (cd.id === 'a-157-02' && !(inst.flags && inst.flags.copiedCardId));
    if (!keepFruitInHand) { removeFromHand(p, inst.iid); discardUsed(key, inst); }
    var m = cd.mods || {};
    if (m.healPlayer) healPlayer(key, m.healPlayer);
    /* 炖肉 a-084-2：**选择**己方场上一只（2026-10-25 由"随机"改为"选择"） */
    if (cd.id === 'a-084-2') {
      var mcands = aliveMonsters(key).map(function (t2) {
        return { iid: t2.uid, name: t2.name, cardId: t2.cardId, slot: slotOf(key, t2.uid), hp: t2.hp, atk: t2.atk };
      });
      if (!mcands.length) { log('炖肉：己方场上没有怪物', 'dim'); return true; }
      log('炖肉：选择一只己方怪物（回 4 血且攻击+1）', 'eff');
      requestChoices(key, [{ cands: mcands, action: 'meatPick', count: 1, label: '炖肉：选择己方一只怪物' }]);
      return true;
    }
    /* 口粮 a-017-2：选己方一只怪 → 回 4 生命 + 2 点护盾（2026-10-25 改版，不再给玩家回血） */
    if (cd.id === 'a-017-2') {
      var rcands = aliveMonsters(key).map(function (t2) {
        return { iid: t2.uid, name: t2.name, cardId: t2.cardId, slot: slotOf(key, t2.uid), hp: t2.hp, atk: t2.atk };
      });
      if (!rcands.length) { log('口粮：己方场上没有怪物', 'dim'); return true; }
      log('口粮：选择一只己方怪物（回 4 生命 + 2 点护盾）', 'eff');
      requestChoices(key, [{ cands: rcands, action: 'rationPick', count: 1, label: '口粮：选择己方一只怪物' }]);
      return true;
    }
    if (cd.id === 'a-059-2') { healPlayer(key, 4); aliveMonsters(key).forEach(function (t) { healMonster(t, 4); }); }
    /* 无味果 a-157-02 —— **两阶段**（玩家 2026-10-25 裁定）：
       ① 一阶段（还没存效果）：弃手牌一张药水卡 → 这张无味果**获得**该药水效果（存起来，暂不发动），
          本次使用照常消耗「食物」次数。
       ② 二阶段（已存效果）：直接使用即发动该药水效果，**不消耗任何种类次数**、也不用再弃牌。
       二阶段的判定在 actUse 的 limited 里（fopStage2）。 */
    if (cd.id === 'a-157-02') {
      if (inst.flags && inst.flags.copiedCardId) {
        var fcid = inst.flags.copiedCardId;
        var fcd = CARDS[fcid];
        /* ⚠ 不能再 removeFromHand/discardUsed —— useFood 开头（keepFruitInHand=false 时）
           已经把这张卡移出手牌并进了弃牌堆，这里再推一次会让弃牌堆出现**重复 iid**。 */
        log('无味果：发动已获得的【' + (fcd ? fcd.name : fcid) + '】效果（不消耗次数）', 'eff');
        runVirtualCard(key, fcid, 'potion');
        return true;
      }
      var pcands = p.hand.filter(function (c) { return CARDS[c.cardId].type === 'potion'; })
        .map(function (c) { return { iid: c.iid, name: CARDS[c.cardId].name, cardId: c.cardId }; });
      if (!pcands.length) { log('无味果：手牌中没有药水卡，无效果', 'dim'); return true; }
      log('无味果：选择一张手牌药水卡，弃置并让这张无味果获得其效果', 'eff');
      requestChoices(key, [{
        cands: pcands, action: 'copyPotion', count: 1, copyIid: inst.iid,
        label: '无味果：选择一张药水卡（获得其效果，之后再用即发动）'
      }]);
      return true;
    }
    // 全肉大饼（a-112-2）：丢一张【肉馅饼】→ 己方全场怪攻击**+3**；没有肉馅饼 → 己方怪仅恢复 4 生命
    if (cd.id === 'a-112-2') {
      var pie = p.hand.filter(function (c) { return c.cardId === 'a-059-2'; })[0];
      if (pie) {
        removeFromHand(p, pie.iid);          // 必须先从手牌移除，否则【肉馅饼】会留在手里
        toDiscard(key, pie, false);
        aliveMonsters(key).forEach(function (t2) { t2.growthAtk += 3; recalc(t2); });   // 2026-10-25 由 +2 改 +3
        log('全肉大饼：丢弃【肉馅饼】，己方所有怪物攻击+3', 'eff');
      } else {
        aliveMonsters(key).forEach(function (t2) { healMonster(t2, 4); });
        log('全肉大饼：手牌中没有【肉馅饼】，己方怪物恢复 4 点生命', 'eff');
      }
    }
    // 丰饶号角：每使用一张食物抽一张
    if (p.artifacts.some(function (a) { return a.cardId === 'a-024-2'; })) { log('丰饶号角 触发：抽一张牌', 'eff'); draw(key, 1); }
    return true;
  }
  function usePotion(key, inst, cd) {
    var p = state.players[key], opp = other(key);
    removeFromHand(p, inst.iid); discardUsed(key, inst);
    var m = cd.mods || {};
    if (m.healMonsters) aliveMonsters(key).forEach(function (t) { healMonster(t, m.healMonsters); });
    if (m.buffAtkAll) aliveMonsters(key).forEach(function (t) { t.growthAtk += m.buffAtkAll; log(t.name + ' 攻击+1', 'eff'); });
    if (cd.id === 'a-062-2') { state.players[opp].flags.summonDebuff = (state.players[opp].flags.summonDebuff || 0) + 1; log('冰霜药水：对方下回合召唤次数-1', 'eff'); }
    if (cd.id === 'a-087-2') { if ((state.turnCount || 1) <= 1) { log('疾速药水：首回合使用无效果', 'dim'); } else { p.summonsLeft += 1; log('疾速药水：本回合召唤次数+1', 'eff'); } }
    // 毒气药水（新卡 a-115-2）：对方叠加 3 层【毒气】
    if (m.poisonStacks) { addPoison(opp, m.poisonStacks); log('毒气药水：对方叠加 ' + m.poisonStacks + ' 层【毒气】', 'eff'); }
    // 净化药水（新卡 a-132-02）：清除并免疫负面状态
    if (m.cleanse) cleanseUntilSet(key);
    // 灵视药水（新卡 a-155-02）：2 回合内能攻击「无法选中」的目标
    if (cd.id === 'a-155-02') {
      p.flags.seeThrough = (state.turnCount || 1) + 2;
      log('灵视药水：2 回合内可攻击无法选中的怪物', 'eff');
    }
    // 隐身药水（新卡 a-156-02）：选己方一只 ≤9 血怪，一回合无法选中
    if (cd.id === 'a-156-02') {
      var hcands = aliveMonsters(key).filter(function (t) { return t.hp <= 9; })
        .map(function (t) { return { iid: t.uid, name: t.name, cardId: t.cardId, slot: slotOf(key, t.uid) }; });
      if (!hcands.length) { log('隐身药水：己方没有生命 9 以下的怪物', 'dim'); return true; }
      log('隐身药水：选择一只生命 9 以下的己方怪物', 'eff');
      requestChoices(key, [{ cands: hcands, action: 'hidePick', count: 1, label: '隐身药水：选择己方怪物' }]);
      return true;
    }
    return true;
  }
  function useScroll(key, inst, cd, action) {
    var p = state.players[key], opp = other(key);
    /* 极影铃虹：**使用任何卷轴卡后**触发（持续一回合无法被攻击，限 3 次）。
     * ⚠ 早期实现只写在本函数末尾，而「升级卷轴 / 镜像卷轴」在中间就 return true 了
     *   → 用这两张卷轴时极影铃虹完全不触发（玩家反馈的"镜像卷轴无法触发极影铃虹"）。
     *   现在收成一个函数，所有卷轴分支都必须调它。 */
    function afterScroll() {
      aliveMonsters(key).forEach(function (t) {
        if (t.cardId === 'a-97-2' && (t.flags.shadowUsed || 0) < 3) {
          t.flags.shadowUsed = (t.flags.shadowUsed || 0) + 1;
          t.flags.untargetable = true;
          t.flags.untargetableUntilOwnerTurn = true;
          log('极影铃虹：持续一回合无法被攻击（第 ' + t.flags.shadowUsed + '/3 次）', 'eff');
        }
      });
    }
    if (cd.id === 'a-029-2') { // 升级卷轴：对武器/防具/法杖使用，等级+1（由玩家指定目标）
      var target = null, kind = '';
      if (action.targetKind === 'wand') {
        if (!p.wand || !CARDS[p.wand.cardId].upgradable || p.wand.level >= 2) return false;
        target = p.wand; kind = '法杖栏';
      } else if (action.targetUid != null) {
        var mm = findMonster(key, action.targetUid);
        if (!mm) return false;
        if (mm.weapon && CARDS[mm.weapon.cardId].upgradable && mm.weapon.level < maxEquipLevel(mm.weapon.cardId)) { target = mm.weapon; kind = mm.name + ' 的武器'; }
        else if (mm.armor && CARDS[mm.armor.cardId].upgradable && mm.armor.level < maxEquipLevel(mm.armor.cardId)) { target = mm.armor; kind = mm.name + ' 的防具'; }
        else return false;
      } else return false;  // 未指定升级目标
      removeFromHand(p, inst.iid); discardUsed(key, inst);
      target.level = clampEquipLevel(target.cardId, target.level + 1);
      log('升级卷轴：' + kind + ' ' + CARDS[target.cardId].name + ' 升至 Lv' + target.level, 'eff');
      recalcAll();
      afterScroll();          // 卷轴已使用 → 极影铃虹也要触发
      return true;
    }
    // 镜像卷轴（新卡 a-116-2）：对一张我方怪物使用，在我方随机空位衍生一张同名怪物（攻击同本体、生命为 1）
    if (cd.id === 'a-116-2') {
      var src = (action.targetUid != null) ? findMonster(key, action.targetUid) : null;
      if (!src) return false;
      var empt = emptySlots(key);
      if (!empt.length) return false;
      removeFromHand(p, inst.iid); discardUsed(key, inst);
      createMirror(key, src, pick(empt));
      afterScroll();          // 卷轴已使用 → 极影铃虹也要触发（镜像卷轴同样算卷轴）
      return true;
    }
    /* 恐惧卷轴（新卡 a-133-02）：由**对手自己**选一只 B/C 级怪物返回其手牌。
       候选是场上怪物 → 用 uid 当 iid、走 cands + action:'fearReturn'（applyChoice 里处理）。 */
    if (cd.id === 'a-133-02') {
      var fcands = aliveMonsters(opp).filter(function (t) { return t.tier === 'B' || t.tier === 'C'; })
        .map(function (t) { return { iid: t.uid, name: t.name, cardId: t.cardId, tier: t.tier, slot: slotOf(opp, t.uid) }; });
      removeFromHand(p, inst.iid); discardUsed(key, inst);
      afterScroll();
      if (!fcands.length) { log('恐惧卷轴：对手场上没有 B/C 级怪物', 'dim'); return true; }
      log('恐惧卷轴：对手需选择一只 B/C 级怪物返回手牌', 'eff');
      requestChoices(opp, [{ cands: fcands, action: 'fearReturn', count: 1, label: '恐惧卷轴：选择一只 B/C 级怪物返回手牌' }]);
      return true;
    }
    /* 复仇卷轴（新卡 a-154-02）：选己方一只怪 → 对对手随机怪造成「其已损失生命」的伤害 */
    if (cd.id === 'a-154-02') {
      var rcands = aliveMonsters(key).map(function (t) {
        return { iid: t.uid, name: t.name, cardId: t.cardId, slot: slotOf(key, t.uid) };
      });
      removeFromHand(p, inst.iid); discardUsed(key, inst);
      afterScroll();
      if (!rcands.length) { log('复仇卷轴：己方场上没有怪物', 'dim'); return true; }
      log('复仇卷轴：选择一只己方怪物（按它已损失的生命造成伤害）', 'eff');
      requestChoices(key, [{ cands: rcands, action: 'revengePick', count: 1, label: '复仇卷轴：选择己方怪物' }]);
      return true;
    }
    removeFromHand(p, inst.iid); discardUsed(key, inst);
    var m = cd.mods || {};
    /* 充能卷轴 a-153-02：本回合施法次数 +1，且**该回合首次施法**无需弃牌。
       ⚠ 玩家 2026-10-25 强调：是"该回合**首次**施法"，不是"任何一次施法减 1 份代价"。
         所以 freeCast 只在 `castCount === 0`（本回合还没施过法）时才算数，
         本回合已经施过法再用卷轴，免弃效果不会落在第二次施法上。 */
    if (cd.id === 'a-153-02') {
      p.castsLeft += 1;
      p.flags.freeCast = (p.flags.freeCast || 0) + 1;
      log('充能卷轴：本回合施法次数+1；若本回合尚未施法，首次施法无需弃牌', 'eff');
    }
    /* 传送卷轴（a-030-2）：**双方**把各自手牌洗回牌堆，然后各抽**等量**。
       2026-10-25 玩家改版（原效果是"弃置所有手牌，抽四张"）。
       ⚠ 是"洗回牌堆"不是"进弃牌堆" —— 所以不能走 toDiscard，也不会触发"进入弃牌堆时"效果。 */
    if (cd.id === 'a-030-2') {
      ['A', 'B'].forEach(function (k) {
        var pp = state.players[k];
        var n = pp.hand.length;
        if (!n) { log('传送卷轴：' + (k === key ? '你' : '对手') + ' 没有手牌可洗', 'dim'); return; }
        pp.hand.forEach(function (c) { pp.deck.push(c); });
        pp.hand = [];
        shuffle(pp.deck);
        draw(k, n);
        log('传送卷轴：' + (k === key ? '你' : '对手') + ' 的 ' + n + ' 张手牌洗回牌堆，重抽 ' + n + ' 张', 'eff');
      });
      return true;
    }
    if (m.discardAll) { var snap = p.hand.slice(); p.hand = []; snap.forEach(function (c) { toDiscard(key, c, false); }); log('传送卷轴：弃置所有手牌', 'eff'); draw(key, m.draw); }
    if (cd.id === 'a-063-2') {
      // 催眠卷轴：卡面 =「你的下回合开始前，**场上所有怪物**无法攻击」→ 双方都要标记（含使用者自身）。
      // 时长由 endTurn 的 `p.flags.noAttack = false` 保证：各自在自己回合结束时解除，
      // 因此使用者的战斗阶段（本回合）与对方的战斗阶段（其下回合）都被封住，正好等于"到使用者下回合开始前"。
      // 净化药水（a-132-02）：处于净化状态的一方不吃"无法攻击"（睡眠）
      ['A', 'B'].forEach(function (k2) {
        if (negImmune(k2)) log('催眠卷轴：' + state.players[k2].name + ' 处于净化状态，不受影响', 'dim');
        else state.players[k2].flags.noAttack = true;
      });
      log('催眠卷轴：你的下回合开始前，场上所有怪物无法攻击', 'eff');
    }
    if (cd.id === 'a-088-2') { // 盛怒卷轴：全场每只怪物「各自」随机选一只怪物（可含自身）的攻击力作为伤害来源
      var pool = aliveMonsters('A').concat(aliveMonsters('B'));
      if (pool.length) {
        pool.slice().forEach(function (t) {
          var src = pick(pool), k = findMonster('A', t.uid) ? 'A' : 'B';
          log('盛怒卷轴：' + t.name + ' 受到（随机来源 ' + src.name + ' 的）' + src.atk + ' 点伤害', 'eff');
          damageMonster(t, k, src.atk, {});
        });
      }
    }
    afterScroll();          // 极影铃虹：使用卷轴后触发
    return true;
  }

  function actEquip(key, action) {
    var p = state.players[key];
    var inst = p.hand.filter(function (c) { return c.iid === action.iid; })[0];
    if (!inst) return fail('手牌中没有该卡');
    var cd = cardOf(inst);
    if (cd.type !== 'weapon' && cd.type !== 'armor') return fail('该卡不是装备');
    if (state.phase !== 'PREP') return fail('仅准备阶段可装备');
    // 每回合限制：武器 / 防具 各限打出 1 张
    var used = p.flags.used || (p.flags.used = {});
    if (used[cd.type]) return fail('本回合已打出' + (cd.type === 'weapon' ? '武器' : '防具') + '（限 1 张）');
    var t = findMonster(key, action.targetUid);
    if (!t) return fail('需指定己方怪物');
    // 每只怪物仅可携带一件装备（武器或防具二选一），且不可主动卸下/替换
    if (t.weapon) return fail('该怪物已装备武器（每只怪物仅可装备一件）');
    if (t.armor) return fail('该怪物已装备防具（每只怪物仅可装备一件）');
    // 装备要求校验
    var eq = cd.equip;
    if (eq) {
      // 计算装备要求时，把后天的攻击提升（力量药水/成长等）也计入攻击力
      var val = eq.stat === 'atk' ? (t.baseAtk + (t.growthAtk || 0) + (t.tempAtk || 0)) : t.maxHp;
      if (val < eq.min) return fail('不满足装备要求（' + (eq.stat === 'atk' ? '攻击力' : '血量上限') + '≥' + eq.min + '）');
    }
    removeFromHand(p, inst.iid);
    if (cd.type === 'weapon') t.weapon = inst; else t.armor = inst;
    // 暗影斗篷：装备后该怪物无法被攻击。盗贼B 一进入「无法被攻击」立即获得本次攻击+3（不再延迟到下一回合）
    if (cd.id === 'a-039-2') { t.flags.untargetable = true; t.flags.untargetableUntilOwnerTurn = true; if (t.cardId === 'a-038-2') { t.flags.rogueBonus = true; t.flags.rogueBonusGranted = true; } }
    used[cd.type] = 1;
    log('为 ' + t.name + ' 装备 ' + cd.name, 'eff');
    emit({ type: 'play', key: key, cardId: cd.id, verb: '装备' });
    recalcAll();
    return ok();
  }

  function actPlaceWand(key, action) {
    var p = state.players[key];
    var inst = p.hand.filter(function (c) { return c.iid === action.iid; })[0];
    if (!inst) return fail('手牌中没有该卡');
    if (cardOf(inst).type !== 'wand') return fail('该卡不是法杖');
    if (state.phase !== 'PREP') return fail('仅准备阶段可放置法杖');
    removeFromHand(p, inst.iid);
    if (p.wand) { p.discard.push(p.wand); log('替换法杖，旧的 ' + cardOf(p.wand).name + ' 进入弃牌堆', 'dim'); }
    p.wand = inst;
    log('将 ' + cardOf(inst).name + ' 放入法杖栏', 'eff');
    emit({ type: 'play', key: key, cardId: inst.cardId, verb: '放置' });
    refreshCasts(key);      // 放的是老法杖 → 本回合立刻多 1 次施法（不能等到下回合）
    return ok();
  }

  function actActivateWand(key, action) {
    var p = state.players[key];
    if (!p.wand) return fail('法杖栏为空');
    if (state.phase !== 'PREP') return fail('仅准备阶段可发动法杖');
    // 时停（时光沙漏）/ 棱光法杖 / 闪光陷阱：统一的"禁止使用投掷物/法杖"判定
    var banWand = throwWandBanReason(key);
    if (banWand) return fail(banWand);
    if (p.castsLeft <= 0) return fail('本回合施法次数已用尽');
    var cd = cardOf(p.wand), opp = other(key);
    // 老法杖：未灌注时，选择手牌中另一张法杖进行灌注（继承其能力并提升法杖等级）
    if (cd.id === 'a-036-2' && !p.wand.inheritId) {
      // ⚠ 不能拿另一张【老法杖】来灌注自己：老法杖本身没有可继承的施法能力，
      //   灌注它只会白加一次法杖等级，纯属浪费（而且很容易误操作）。
      var pick = p.hand.filter(function (c) { return c.iid === action.absorbIid; })[0];
      if (pick && pick.cardId === 'a-036-2') return fail('老法杖不能灌注老法杖，请选择其他法杖');
      var abs = p.hand.filter(function (c) { return c.iid === action.absorbIid && CARDS[c.cardId].type === 'wand'; })[0];
      if (!abs) return fail('老法杖需选择一张手牌中的法杖进行灌注');
      removeFromHand(p, abs.iid); p.discard.push(abs);
      p.wand.inheritId = abs.cardId;
      p.wand.level = Math.min(2, p.wand.level + 1);
      log('老法杖 灌注 ' + CARDS[abs.cardId].name + '：继承其能力，法杖等级升至 Lv' + p.wand.level, 'eff');
      emit({ type: 'play', key: key, cardId: abs.cardId, verb: '灌注' });
      p.castsLeft -= 1;
    p.flags.castCount = (p.flags.castCount || 0) + 1;   // 本回合已施法次数（充能卷轴的"首次"判定用）
      grantBingShield(key);
      return ok();
    }
    /* 充能戒指 a-152-02（在手牌中持续生效）与充能卷轴 a-153-02 的「首次施法无需弃牌」：
       本次施法可以跳过"弃一张手牌"的代价。 */
    var ringFree = !!chargedRingReady(p);
    /* 充能卷轴：**只有本回合还没施过法**时才算"首次施法免弃"（玩家 2026-10-25 强调） */
    var freeByScroll = (p.flags.freeCast || 0) > 0 && (p.flags.castCount || 0) === 0;
    var noCost = ringFree || freeByScroll;
    var cost = null;
    if (!noCost) {
      if (!p.hand.length) return fail('发动法杖需弃置一张手牌作为代价');
      cost = p.hand.filter(function (c) { return c.iid === action.discardIid; })[0];
      if (!cost) return fail('请先选择要弃置的手牌作为代价');
    }
    // 老法杖已灌注 → 以继承的法杖能力发动
    var effCd = (cd.id === 'a-036-2' && p.wand.inheritId) ? CARDS[p.wand.inheritId] : cd;
    var lv = p.wand.level;
    // 136 腐化法杖 / 137 棱光法杖 都要指定敌方怪物为目标（137 的伤害走下方通用 m.dmg）
    var needTarget = wandNeedsTargetCard(effCd.id);
    var tgt = null, tgtKey = opp;
    if (needTarget) {
      /* 冲击波法杖：自己这边的怪物也能选（会把己方怪向右推一位） */
      tgt = findMonster(opp, action.targetUid);
      if (tgt) { tgtKey = opp; }
      else if (effCd.id === 'a-091-2') {
        tgt = findMonster(key, action.targetUid);
        if (tgt) tgtKey = key;
      }
      if (!tgt) return fail('请先选择一张怪物作为目标');
    }
    if (cost) {
      removeFromHand(p, cost.iid); toDiscard(key, cost, false);   // 作为代价弃置：需触发「进入弃牌堆时」效果
      log('发动 ' + cd.name + (effCd !== cd ? '（灌注：' + effCd.name + '）' : '') + '：弃置 ' + cardOf(cost).name + ' 作为代价', 'eff');
    } else {
      /* ⚠ 两种免费手段**只消耗一种**：先花卷轴的 freeCast，没有了才动戒指的冷却。
         否则「卷轴 + 戒指」同时在手时，第一次施法会把两个都用掉，第二次就没了。 */
      if (freeByScroll) {
        p.flags.freeCast = Math.max(0, (p.flags.freeCast || 0) - 1);
        log('发动 ' + cd.name + (effCd !== cd ? '（灌注：' + effCd.name + '）' : '') +
          '：【充能卷轴】使本次施法无需弃牌', 'eff');
      } else if (ringFree) {
        p.flags.ringCD = 2;                      // 用一次进 2 回合冷却
        log('发动 ' + cd.name + (effCd !== cd ? '（灌注：' + effCd.name + '）' : '') +
          '：【充能戒指】使本次施法无需弃牌', 'eff');
      }
    }
    var m = effCd.mods || {};
    var dmg = m.dmg ? (lv >= 1 && m.upgrade && m.upgrade[0].dmg ? m.upgrade[0].dmg : m.dmg) : 0;
    if (dmg && tgt) { log('对 ' + tgt.name + ' 造成 ' + dmg + ' 点伤害', 'eff'); damageMonster(tgt, tgtKey, dmg, {}); }
    // ★ 焰浪法杖：卡面写的是"弃置对方 N 张手牌"，必须是**恰好 N 张**（对手手牌不足时才少弃）。
    //   以前 count 只被当成"最多"，对手点 1 张就能确定 → 实际强度与卡面严重不符（联机更容易被钻）。
    if (effCd.id === 'a-067-2') {
      var n = lv >= 1 ? 2 : 1;
      /* 新卡面：对手只能弃「卷轴 / 食物 / 药水」卡；升级后要弃 2 张。
         对手手里没有这类卡时 requestChoices 会记一条"没有满足条件的卡"并跳过（不强制弃普通卡）。 */
      requestChoices(opp, [{
        from: 'hand', count: n, exact: true,
        pred: function (c) { var t = cardOf(c).type; return t === 'scroll' || t === 'food' || t === 'potion'; },
        label: '选择弃置 ' + n + ' 张卷轴/食物/药水卡'
      }]);
    }
    if (effCd.id === 'a-068-2') { var base = 2, en = aliveMonsters(opp).slice(); en.forEach(function (t2, i) { var d = base + i * (lv >= 1 ? 4 : 2); log('解离法杖穿透 ' + t2.name + ' ' + d + ' 点', 'eff'); damageMonster(t2, opp, d, {}); }); }
    /* 冲击波法杖：伤害已由上方通用 m.dmg 结算（卡面 2 点 / 升级 4 点），这里只负责「向右移动一位」；
       切勿再 damageMonster，否则会与上面重复结算（修复前：同一次发动打了两遍伤害）。

       noGrow = true：打的是【天狗】时，"受到伤害"那一下已经让它随机移动并成长过（+1攻/+1血 + 1张苦无），
       这次"向右推一位"是**同一次结算里的平面位移**，不能再算一次「移动时机」——
       否则天狗会 +2/+2 并衍生 2 张苦无，而且是否触发取决于随机落位（0/1 位常常只 +1，2 位就 +2），
       表现极不稳定（玩家反馈"冲击波打天狗会多成长一次"）。 */
    if (effCd.id === 'a-091-2' && tgt) { moveRight(tgtKey, tgt, true); }
    /* 腐化法杖（新卡 a-136-02）：目标攻击-1 + 叠 2 层【腐化】（升级 3 层）。
       层数一旦高于其当前生命就转移到**施法方**随机空位（清空层数、保留血量攻击，见 corruptCheck）。 */
    if (effCd.id === 'a-136-02' && tgt) {
      var cn = lv >= 1 ? 3 : 2;
      tgt.flags.corrupt = (tgt.flags.corrupt || 0) + cn;
      tgt.growthAtk = (tgt.growthAtk || 0) - 1;
      recalc(tgt);
      log('腐化法杖：' + tgt.name + ' 攻击-1，叠加 ' + cn + ' 层【腐化】（共 ' + tgt.flags.corrupt + ' 层）', 'eff');
      emit({ type: 'float', uid: tgt.uid, text: '-' + cn + '腐化', kind: 'dmg' });
      corruptCheck(tgt, tgtKey);
    }
    /* 棱光法杖（新卡 a-137-02）：伤害走上方通用分支（mods.dmg=2，升级后 upgrade[0].dmg=4），
       这里只负责"对方下 1 回合无法使用投掷物/法杖"—— 封锁回合数**不随升级变化**（玩家 10-23 改）。 */
    if (effCd.id === 'a-137-02') { banThrowWand(tgtKey, (effCd.mods && effCd.mods.banTW) || 1); }
    emit({ type: 'play', key: key, cardId: effCd.id, verb: '施法', wand: cd.id });
    p.castsLeft -= 1;
    p.flags.castCount = (p.flags.castCount || 0) + 1;   // 本回合已施法次数（充能卷轴的"首次"判定用）
    grantBingShield(key);
    return ok();
  }
  // 茉莉伊洛：每使用一次法杖获得 2 点护盾
  function grantBingShield(key) {
    aliveMonsters(key).forEach(function (x) { if (x.cardId === 'a-96-2') { x.shield += 2; log('茉莉伊洛：获得 2 点护盾', 'eff'); } });
  }
  // 虚空锁链（神器）：准备阶段限一次，将场上任意一只怪物移动到其本方空位
  function actMoveMonster(key, action) {
    var p = state.players[key];
    if (state.phase !== 'PREP') return fail('仅准备阶段可发动');
    if (!p.artifacts.some(function (a) { return a.cardId === 'a-094-2'; })) return fail('未装备【虚空锁链】');
    if (p.flags.voidChainUsed) return fail('虚空锁链每回合限用一次');
    var mKey = null, inst = null;
    ['A', 'B'].forEach(function (k) { var f = findMonster(k, action.uid); if (f) { mKey = k; inst = f; } });
    if (!inst) return fail('未找到目标怪物');
    var bp = state.players[mKey];
    var to = action.slot;
    if (to == null || to < 0 || to >= bp.board.length || bp.board[to]) return fail('目标位置不合法（需为其本方空位）');
    moveMonsterTo(mKey, inst, to);
    p.flags.voidChainUsed = 1;
    log('虚空锁链：' + inst.name + ' 移动至' + ln(to) + '位', 'eff');
    return ok();
  }
  /* 蓄血圣杯（新卡神器 a-139-02）：准备阶段限一次，令己方场上一只怪物
     失去「当前回合数」的生命、获得等量生命上限。每只怪物限一次。 */
  function actUseCup(key, action) {
    var p = state.players[key];
    if (state.phase !== 'PREP') return fail('仅准备阶段可发动');
    if (!p.artifacts.some(function (a) { return a.cardId === 'a-139-02'; })) return fail('未装备【蓄血圣杯】');
    if (p.flags.artifactCupUsed) return fail('蓄血圣杯每回合限用一次');
    var t = findMonster(key, action.targetUid);
    if (!t) return fail('需指定己方场上一只怪物');
    if (t.flags.cupUsed) return fail('该怪物已经接受过蓄血圣杯（每只限一次）');
    p.flags.artifactCupUsed = 1;
    cupStrike(t, key);
    emit({ type: 'play', key: key, cardId: 'a-139-02', verb: '发动' });
    recalc(t);
    return ok();
  }
  // 时光沙漏（新卡神器 a-120-2）：准备阶段发动 —— 直到你的下回合开始前，双方无法使用投掷物/法杖，场上所有怪物无法攻击；冷却 6 回合
  function actTimeStop(key) {
    var p = state.players[key];
    if (state.phase !== 'PREP') return fail('仅准备阶段可发动');
    var art = p.artifacts.filter(function (a) { return a.cardId === 'a-120-2'; })[0];
    if (!art) return fail('未装备【时光沙漏】');
    var left = (art.flags && art.flags.cd) || 0;
    if (left > 0) return fail('时光沙漏冷却中（还需 ' + left + ' 回合）');
    art.flags = art.flags || {};
    art.flags.cd = CARDS['a-120-2'].mods.cooldown;
    art.flags.active = true;
    /* 净化药水（a-132-02）：处于净化状态的一方不吃时停的两条限制
       （无法攻击 / 无法使用投掷物法杖）—— 属于"负面状态"（玩家裁定）。 */
    [key, other(key)].forEach(function (k2) {
      if (negImmune(k2)) { log('时光沙漏：' + state.players[k2].name + ' 处于净化状态，时停对其无效', 'dim'); return; }
      state.players[k2].flags.tsNoThrowWand = 1;
      state.players[k2].flags.tsNoAttack = 1;
    });
    log('时光沙漏 发动：时停 —— 直到 ' + p.name + ' 的下回合开始前，双方无法使用投掷物/法杖，场上所有怪物无法攻击', 'eff');
    emit({ type: 'play', key: key, cardId: 'a-120-2', verb: '发动' });
    return ok();
  }
  // 镜像卷轴：衍生体（同名、攻击同本体、生命 1；继承装备与状态；镜像装备离场时直接消失）
  function cloneMirrorEquip(e) {
    var c = makeInstance(e.cardId, e.level || 0, e.star || 1, e.awaken);
    c.isMirror = true;
    if (e.flags) { try { c.flags = JSON.parse(JSON.stringify(e.flags)); } catch (err) { c.flags = {}; } }
    return c;
  }
  function createMirror(key, src, slot) {
    var p = state.players[key], cd = CARDS[src.cardId];
    var inst = {
      uid: uid++, cardId: cd.id, name: cd.name, tier: cd.tier, star: src.star || 1,
      baseHp: 1, maxHp: 1, hp: 1,
      baseAtk: src.baseAtk, atk: src.baseAtk, growthAtk: src.growthAtk || 0, tempAtk: src.tempAtk || 0,
      level: src.level || 0, weapon: null, armor: null, shield: src.shield || 0,
      buffs: {}, flags: { attacked: false, attacksMax: src.flags.attacksMax || 1, token: true, mirror: true },
      reduceCut: src.reduceCut || 0
    };
    if (src.flags.untargetable) {
      inst.flags.untargetable = true;
      inst.flags.untargetableInnate = !!src.flags.untargetableInnate;
      // 只要源怪不是【固有免疫】，镜像体一律给一个"到拥有者下回合开始"的到期标记。
      // ⚠ 不能只照抄源怪的 untargetableUntilOwnerTurn：
      //   觉醒【潜伏】(stealth, 见 applyAwakenPrep) 是"只写 untargetable、靠自己的 awaken 逻辑
      //   每回合翻转"的**合法**写法（源怪不需要 until 标记），但镜像体没有 awaken（上面的 inst 里
      //   没有 awaken 字段），照抄只会得到 until=false → 回合开始的清理（startTurn）永远不命中
      //   → 镜像体永久【无法被攻击】+ 永久挡脸。这就是玩家反馈的"对面的镜像一直无法选中"。
      //   innate=true（怨灵 / 咒缚灵 / BOSS）保持永久，符合"按卡面效果来"。
      inst.flags.untargetableUntilOwnerTurn = src.flags.untargetableInnate ? false : true;
    }
    /* 一次性效果的"配额"要跟着本体走：澪 a-100-2 的复活是「首次进入弃牌堆」才有的机会。
       本体已经用掉（`flags.revived = true`）→ 此刻复制出来的镜像体**不该再有**复活机会；
       本体还没用掉 → 复制品也带着这次机会。
       （玩家裁定：镜像体复制时要复制本体澪的这个状态。） */
    if (src.flags.revived) inst.flags.revived = true;
    applyInnateFlags(inst);
    if (src.weapon) inst.weapon = cloneMirrorEquip(src.weapon);
    if (src.armor) inst.armor = cloneMirrorEquip(src.armor);
    p.board[slot] = inst;
    recalc(inst);
    emit({ type: 'summon', uid: inst.uid, key: key, cardId: inst.cardId, slot: slot });
    log('镜像卷轴：在' + ln(slot) + '位衍生镜像 ' + cd.name + '（攻击 ' + inst.atk + ' / 生命 1）', 'eff');
    return inst;
  }
  // noGrow 透传给 moveMonsterTo：冲击波法杖那条路要传 true（见调用处说明）
  function moveRight(key, inst, noGrow) {
    var p = state.players[key]; var i = slotOf(key, inst.uid);
    if (i >= 0 && i < 2 && !p.board[i + 1]) { moveMonsterTo(key, inst, i + 1, noGrow); log(inst.name + ' 向右移动一位', 'dim'); return true; }
    return false;
  }

  function actAttack(key, action) {
    if (state.phase !== 'BATTLE') return fail('仅战斗阶段可攻击');
    var p = state.players[key], opp = other(key), op = state.players[opp];
    var atk = findMonster(key, action.attackerUid);
    if (!atk) return fail('未找到攻击者');
    /* 魔像：只能攻击对位怪物（对方空场也不能打玩家） */
    if (atk.cardId === 'a-126-02') {
      var mySlot = slotOf(key, atk.uid);
      var mTgt = action.targetUid ? findMonster(opp, action.targetUid) : null;
      if (!mTgt) return fail('魔像只能攻击对位怪物（不能攻击玩家）');
      if (slotOf(opp, mTgt.uid) !== mySlot) return fail('魔像只能攻击对位怪物');
    }
    /* 净化药水（a-132-02）：免疫期间的"无法攻击/禁锢"一律不生效 ——
       标记本身保留（免疫结束后继续算），只是这段时间不管用。 */
    /* 统一的"禁止攻击"判定 —— 战斗阶段和**准备阶段的立刻攻击**（监狱守卫）都用它，
       否则催眠卷轴/时光沙漏/禁锢只能管住战斗阶段（玩家反馈的老问题）。 */
    if (atk.cardId === 'a-142-02') return fail('【魔法绵羊】无法攻击');
    var blockAtk = attackBlockReason(key, atk);
    if (blockAtk) return fail(blockAtk);
    if (atk.flags.attacked && atk.flags.attacksMax <= 1) return fail('该怪物本回合已攻击');
    if (atk.flags.attacked >= atk.flags.attacksMax) return fail('该怪物攻击次数已用尽');
    // 对方场上有怪物（含"无法被攻击"者）时，只能攻击怪物；无法被攻击的怪需靠投掷物等非攻击手段清除
    var hasEnemy = aliveMonsters(opp).length > 0;
    if (action.targetUid) {
      var t = findMonster(opp, action.targetUid);
      if (!t) return fail('未找到目标');
      // 灵视药水（a-155-02）：自己处于灵视状态时，可以攻击「无法选中」的目标
      if (t.flags.untargetable && !seeThrough(key)) return fail('该目标无法被攻击');
      if (t.flags.untargetable && seeThrough(key)) log('灵视药水：无视【无法选中】，正常攻击 ' + t.name, 'eff');
      /* 魅魔 a-145-02：被魅惑的怪物一回合内不能攻击**任何**魅魔
         （玩家 2026-10-25 修正：以前只限制"不能打魅惑它的那只"，实际是禁攻击这类卡） */
      if (atk.flags.charmedBy && t.cardId === 'a-145-02') return fail('该怪物被【魅惑】，无法攻击魅魔');
      /* 觉醒【牺牲】：对方场上有【牺牲】怪时，本次攻击**强制改判**到牺牲怪身上（多张时任选其一）。
       * ⚠ 旧写法是直接 fail（"必须优先攻击它"）—— 但 AI 选目标时并不知道这条规则，
       *   被拒之后常常直接放弃本回合，表现出来就是"对手有牺牲怪 → 完全不攻击了"。
       *   改成自动改判：攻击照常打出，只是目标落在牺牲怪上。 */
      var sacs = aliveMonsters(opp).filter(function (m) { return m.awaken === 'sacrifice' && !m.flags.untargetable; });
      if (sacs.length && t.awaken !== 'sacrifice') {
        var forced = sacs[0];
        log('【牺牲】' + forced.name + ' 吸引攻击（' + t.name + ' → ' + forced.name + '）', 'eff');
        t = forced;
      }
      doAttack(key, atk, t, false);
    } else if (action.targetKey === opp) {
      if (hasEnemy) return fail('对方场上有怪物，只能攻击怪物');
      doAttackPlayer(key, atk);
    } else return fail('目标不合法');
    atk.flags.attacked = (atk.flags.attacked || 0) + 1;
    recalcAll();
    checkVictory();
    return ok();
  }

  function doAttack(key, atk, t, isRe) {
    var opp = other(key);
    /* 记录**YOG 自己打过的格子**（记在防守方名下）。
       玩家 2026-10-25 明确：YOG 追的是「上回合**被 YOG 打的**格子」，
       不是其他怪打的 —— 所以只有攻击者是 a-150-02 时才记录。 */
    if (atk.cardId === 'a-150-02') {
      state.curAtk = state.curAtk || { A: [], B: [] };
      var recSlot = slotOf(opp, t.uid);
      if (recSlot >= 0 && state.curAtk[opp].indexOf(recSlot) < 0) state.curAtk[opp].push(recSlot);
    }
    var SRC = { by: key, card: atk.cardId };        // 本次攻击的输出都归到这张怪物卡
    var dmg = Math.max(0, atk.atk);
    /* 邪恶之眼 a-146-02：上一回合结束时攒下的「两倍伤害 + 无视减伤」，用一次就消耗掉 */
    var eyeDoubled = !!atk.flags.eyeDouble;
    if (eyeDoubled) { dmg *= 2; atk.flags.eyeDouble = false; log('邪恶之眼：本击伤害翻倍且无视减伤', 'eff'); }
    if (atk.cardId === 'a-038-2' && atk.flags.rogueBonus) { dmg += 3; atk.flags.rogueBonus = false; log('盗贼B：本次攻击 +3（此前处于无法被攻击）', 'eff'); }
    log(atk.name + ' 攻击 ' + t.name + '（' + dmg + ' 点）', 'attack');
    // 带上"位置"信息：目标可能被这一击打死（DOM 已消失），UI 需要用格子回退定位才能画出连线
    emit({
      type: 'attack', from: atk.uid, to: t.uid,
      fromKey: key, fromSlot: slotOf(key, atk.uid), toKey: opp, toSlot: slotOf(opp, t.uid)
    });
    var oppCntAtDeclare = aliveMonsters(opp).length;   // 攻击宣言时对方场上怪物数（蚱蜢按"攻击时"判定）
    var dealt = damageMonster(t, opp, dmg, { attack: true, src: SRC, ignoreReduce: atk.awaken === 'sunder' || eyeDoubled });
    if (key === 'A' && state.ach && !state.ach.off && dealt > state.ach.maxHit) state.ach.maxHit = dealt;   // 成就「秒杀」
    // 攻击后附加效果
    postAttackProps(key, atk, t, opp, oppCntAtDeclare, dealt);
    // 澪：攻击后额外对目标造成7点伤害
    if (atk.cardId === 'a-100-2' && !t.flags.dead) { log('澪：额外对 ' + t.name + ' 造成 7 点伤害', 'eff'); damageMonster(t, opp, 7, { src: SRC }); }
    // 再攻击：攻击后 50% 获得一次额外攻击机会（由玩家/AI 再次选择目标，不自动追打同一目标）
    // 丛林螃蟹 a-006-2：每回合触发一次；水道螃蟹EX a-011-2：可反复触发（每次攻击后均可再判定）
    if (atk.cardId === 'a-011-2' || atk.cardId === 'a-006-2') {
      var oncePerTurn = atk.cardId === 'a-006-2';
      var reOk = false;
      if (!(oncePerTurn && atk.flags.reattacked) && rand() < 0.5) {
        reOk = true;
        atk.flags.reattacked = true;
        atk.flags.attacksMax = (atk.flags.attacksMax || 1) + 1;
        log(atk.name + ' 触发【再攻击】：获得一次额外攻击机会', 'eff');
      }
      // 成就「你被骗了」：记录水道螃蟹EX 本回合攻击过 / 是否触发再攻击
      if (atk.cardId === 'a-011-2' && key === 'A' && state.ach && !state.ach.off) {
        state.ach.crabAttackedTurn = state.turnCount;
        if (reOk) state.ach.crabReTurn = state.turnCount;
      }
    }
    // 蕾零安洁：击杀敌方怪物后获得一次【再攻击】机会（与螃蟹一致：给额外攻击机会，由玩家/AI 再次选择目标）
    if (atk.cardId === 'a-95-2' && t.flags.dead) {
      atk.flags.attacksMax = (atk.flags.attacksMax || 1) + 1;
      log('蕾零安洁 击杀后触发【再攻击】：获得一次额外攻击机会', 'eff');
    }
    // ---- 觉醒词条（学院专属，只在 3★ 卡上存在）----
    // 【穿透】攻击怪物时对对手本体造成等量伤害（用实际造成的伤害 dealt，自动排除减伤/闪避/护盾）
    if (atk.awaken === 'pierce' && dealt > 0) {
      log('【穿透】' + atk.name + '：对本体造成 ' + dealt + ' 点伤害', 'eff');
      damagePlayer(opp, dealt, { src: SRC });
    }
    // 【荆棘】受到伤害时对攻击者造成"该卡攻击力"等量的伤害
    if (t.awaken === 'thorn' && !t.flags.dead) {
      log('【荆棘】' + t.name + '：对 ' + atk.name + ' 造成 ' + t.atk + ' 点伤害', 'eff');
      damageMonster(atk, key, t.atk, { src: { by: opp, card: t.cardId } });
    }
    // 【禁锢】攻击这张卡的怪物下回合无法攻击（记轮次号，而不是布尔标记）
    if (t.awaken === 'bind' && !atk.flags.dead) {
      if (negImmune(key)) log('【禁锢】' + state.players[key].name + ' 处于净化状态，无效', 'dim');
      else { atk.flags.stunRound = state.round + 1; log('【禁锢】' + atk.name + ' 下一轮无法攻击', 'eff'); }
    }
    // 【汲取】每击杀一只怪物，永久获得其 50% 攻击力（向下取整）
    if (atk.awaken === 'drain' && t.flags.dead) {
      var gain = Math.floor((t.atk || 0) * 0.5);
      if (gain > 0) {
        atk.growthAtk = (atk.growthAtk || 0) + gain;
        recalc(atk);
        log('【汲取】' + atk.name + ' 永久 +' + gain + ' 攻击（吞噬 ' + t.name + '）', 'eff');
      }
    }
    // 【贪婪】击杀怪物时额外获得 6 学时（学院专属：引擎只记账，学院结算时发给对应的学生）
    if (atk.awaken === 'greed' && t.flags.dead) {
      state.greedGain = state.greedGain || { A: 0, B: 0 };
      state.greedGain[key] = (state.greedGain[key] || 0) + 6;
      log('【贪婪】' + atk.name + ' 击杀 ' + t.name + '：额外获得 6 学时', 'eff');
    }
  }
  /* 攻击后附加效果。
     ⚠ t 可能为 **null**（直接攻击玩家 = 打脸）。卡面写「主动攻击后」的效果不分攻击对象，
       打怪和打脸都要走（疯狂强盗早就按这个口径单独修过）。所以这里所有"需要目标"的分支
       都必须自己判 t，不需要目标的分支（火/冰元素令对手弃牌、混沌元素、DM-201…）打脸时照常触发。 */
  function postAttackProps(key, atk, t, opp, oppCntAtDeclare, dealt) {
    var SRC = { by: key, card: atk.cardId };        // 攻击附带的追加伤害也算这张卡的输出
    /* ---- 2026-10-20 新卡：元素三兄弟（主动攻击后）---- */
    if (atk.cardId === 'a-121-02') {
      log('火元素：令对手弃置一张卷轴卡', 'eff');
      requestChoices(opp, [{ from: 'hand', count: 1, exact: true, pred: function (c) { return cardOf(c).type === 'scroll'; }, label: '火元素：选择弃置一张卷轴卡' }]);
    }
    if (atk.cardId === 'a-122-02') {
      log('冰霜元素：令对手弃置一张药水卡', 'eff');
      requestChoices(opp, [{ from: 'hand', count: 1, exact: true, pred: function (c) { return cardOf(c).type === 'potion'; }, label: '冰霜元素：选择弃置一张药水卡' }]);
    }
    if (atk.cardId === 'a-123-02' && t && !t.flags.dead && t.atk < 4) {
      if (negImmune(opp)) log('电击元素：' + state.players[opp].name + ' 处于净化状态，【禁锢】无效', 'dim');
      else { t.flags.stunRound = state.round + 1; log('电击元素：' + t.name + ' 攻击力＜4 → 下回合无法攻击', 'eff'); }
    }
    if (atk.cardId === 'a-129-02') chaosCopy(key, atk, t, opp);
    /* 古神之拳 a-149-02：六种形态的攻击后效果 */
    if (atk.cardId === 'a-149-02' && atk.flags.fistForm && t && !t.flags.dead) {
      var ff = atk.flags.fistForm;
      if (ff === 'burn') {
        requestChoices(opp, [{
          from: 'hand', count: 1, exact: true,
          pred: function (c) { return CARDS[c.cardId].type === 'ring'; },
          label: '燃烧形态：弃置一张戒指卡'
        }]);
      } else if (ff === 'earth') {
        t.flags.noMove = true;
        log('古神之拳（大地）：' + t.name + ' 一回合无法移动', 'eff');
      } else if (ff === 'rot') {
        /* 腐烂形态：**由攻击方自己选**叠毒气还是酸气（玩家 2026-10-25 要求，原来是 50% 随机）。
           候选 iid 用字符串标识，applyChoice 按它分支；联机下 pending.actorKey = 攻击方，
           所以弹窗只会出现在出手那一侧，对手收到 WAIT_OPPONENT。 */
        requestChoices(key, [{
          cands: [
            { iid: 'poison', name: '毒气 +2', cardId: 'a-149-02', type: '' },
            { iid: 'acid', name: '酸气 +1', cardId: 'a-149-02', type: '' }
          ],
          action: 'fistRot', count: 1,
          label: '腐烂形态：选择让对手叠加【毒气 2 层】还是【酸气 1 层】'
        }]);
      } else if (ff === 'glory') {
        if (rand() < 0.4) { banThrowWand(opp, 1); log('古神之拳（辉耀）：对手下回合无法使用投掷物/法杖', 'eff'); }
      } else if (ff === 'shadow') {
        if (rand() < 0.4) { banThrowWand(opp, 1); log('古神之拳（暗影）：对手下回合无法使用投掷物/法杖', 'eff'); }
      }
    }
    /* 魅魔 a-145-02：攻击目标被【魅惑】，一回合内无法攻击这只魅魔（每个目标一生限一次） */
    if (atk.cardId === 'a-145-02' && t && !t.flags.dead && !t.flags.charmedOnce) {
      t.flags.charmedOnce = true;
      t.flags.charmedBy = atk.uid;
      log('魅魔：' + t.name + ' 被【魅惑】，一回合内无法攻击魅魔', 'eff');
    }
    /* 酸液蝎子 a-147-02：主动攻击「对位」目标时，对手叠加 2 层【酸气】 */
    if (atk.cardId === 'a-147-02' && t && !t.flags.dead) {
      var acidSlot = slotOf(key, atk.uid);
      if (slotOf(opp, t.uid) === acidSlot) {
        addAcid(opp, 2);
        log('酸液蝎子：目标处于对位 → 对手叠加 2 层【酸气】', 'eff');
      }
    }
    // ---- 新卡：攻击后效果 ----
    // a-101 吸血蝙蝠：自身与相邻友方恢复"造成伤害"的等量生命
    if (atk.cardId === 'a-101-2' && dealt > 0) {
      var batIdx = slotOf(key, atk.uid);
      var healedN = 0;
      aliveMonsters(key).slice().forEach(function (m) {
        var mi = slotOf(key, m.uid);
        if (mi === batIdx || Math.abs(mi - batIdx) === 1) { var before = m.hp; healMonster(m, dealt); if (m.hp > before) healedN++; }
      });
      if (healedN) log('吸血蝙蝠：自身与相邻友方怪物恢复 ' + dealt + ' 点生命', 'eff');
    }
    // a-102 矿洞蜘蛛：对方每有一层【毒气】，其场上怪物受到 1 点伤害
    // ⚠ 必须"一次性结算 stacks 点"，绝不能循环 stacks 次打 1 点：
    //   伤害【次数】会触发一切"受到伤害时"的效果，最典型的是天狗
    //   （受到伤害时移动 → 攻击+1、生命+1）。3 层毒气循环打就是让天狗一次受伤 3 回 =
    //   攻+3 血+3，反而白赚（"秒恢复 + 超高成长"）。减伤等仍按一次伤害正常结算。
    if (atk.cardId === 'a-102-2') {
      var stacks = state.players[opp].poison || 0;
      if (stacks > 0) {
        log('矿洞蜘蛛：借对方 ' + stacks + ' 层【毒气】对其全场造成 ' + stacks + ' 点伤害', 'eff');
        aliveMonsters(opp).slice().forEach(function (m) { damageMonster(m, opp, stacks, { src: SRC }); });
      }
    }
    // a-103 赤狼萨满：目标攻击-1；（a-109 紫狼萨满：攻击-1 且削减减伤）
    // flags.effectMul：本体自身卡牌效果倍率（【萨满王】提升 500% → ×6，仅作用于本体这张卡）
    if ((atk.cardId === 'a-103-2' || atk.cardId === 'a-109-2') && t && !t.flags.dead) {
      var aMul = (atk.cardId === 'a-109-2') ? (atk.flags.effectMul || 1) : 1;
      t.baseAtk -= aMul; recalc(t);
      log(CARDS[atk.cardId].name + '：' + t.name + ' 攻击-' + aMul + '（现 ' + t.atk + '）', 'eff');
    }
    // a-106 青狼萨满 / a-109 紫狼萨满：若目标减伤＞1，其减伤-1
    if ((atk.cardId === 'a-106-2' || atk.cardId === 'a-109-2') && t && !t.flags.dead) {
      cutTargetReduce(t, atk.cardId, (atk.cardId === 'a-109-2') ? (atk.flags.effectMul || 1) : 1);
    }
    // a-110 DM-201：对方叠加 3 层【酸气】
    if (atk.cardId === 'a-110-2') { addAcid(opp, 3); log('DM-201：对方叠加 3 层【酸气】', 'eff'); }
    // a-111 DM-300：主动攻击时，令"非目标"的敌方怪物卡受到 6 点伤害（晋升之路【保护】可永久放大，上限 +5）
    if (atk.cardId === 'a-111-2') {
      var dm = 6 + Math.min(5, state.protectBonus || 0);
      log('DM-300：歼灭模式 —— 非目标敌方怪物受到 ' + dm + ' 点伤害', 'eff');
      aliveMonsters(opp).slice().forEach(function (m) { if (!t || m.uid !== t.uid) damageMonster(m, opp, dm, { src: SRC }); });
    }
    if (atk.cardId === 'a-044-2' && t) { log('白化小鼠：目标生命-2', 'eff'); if (!t.flags.dead) damageMonster(t, opp, 2, { src: SRC }); }
    // 蚱蜢：条件按"攻击时对方场上有怪物"判定（即使这一击打死了最后一只怪，也照常 -3 并弃置）
    if (atk.cardId === 'a-050-2' && oppCntAtDeclare > 0) { log('蚱蜢：对方玩家生命-3，蚱蜢进入弃牌堆', 'eff'); damagePlayer(opp, 3, { src: SRC }); leaveBoard(atk, key, true); }
    if (atk.cardId === 'a-052-2') { var p2 = state.players[opp]; var mons = p2.hand.filter(function (c) { return CARDS[c.cardId].type === 'monster'; }); if (mons.length) { var mc = pick(mons); removeFromHand(p2, mc.iid); var di = Math.floor(rand() * (p2.deck.length + 1)); p2.deck.splice(di, 0, mc); log('纯晶元素：对方一张手牌怪物洗回卡组（随机位置）', 'eff'); } }
    if (atk.cardId === 'a-074-2' && t) { // 疯狂强盗：夺取目标装备，然后右移；无法右移则返回手牌
      // ⚠ 打脸（t=null）时不要走这里：doAttackPlayer 里已单独调 banditAfterAttack，否则会右移两次
      var owner = state.players[key];
      if (!t.flags.dead && owner.hand.length < Rules.HAND_LIMIT) {
        if (t.weapon) { owner.hand.push(t.weapon); log('疯狂强盗：夺取 ' + t.name + ' 的 ' + cardOf(t.weapon).name, 'eff'); t.weapon = null; }
        else if (t.armor) { owner.hand.push(t.armor); log('疯狂强盗：夺取 ' + t.name + ' 的 ' + cardOf(t.armor).name, 'eff'); t.armor = null; }
      }
      banditAfterAttack(key, atk);
    }
    // 长矛：仅当目标"非对位"时追加伤害（等级越高追加越多：Lv0=1 / Lv1=2 / Lv2=4）
    if (atk.weapon && atk.weapon.cardId === 'a-093-2' && t && !t.flags.dead) {
      var lsw = CARDS['a-093-2'].mods;
      var s = modAtLevel(lsw, atk.weapon.level, 'splash');
      var as = slotOf(key, atk.uid), ts = slotOf(opp, t.uid);
      if (as >= 0 && ts >= 0 && as !== ts) { log('长矛：目标非对位，追加 ' + s + ' 点伤害', 'eff'); damageMonster(t, opp, s, { src: SRC }); }
      else log('长矛：目标为对位，不触发追加伤害', 'dim');
    }
    // 碧灰双刃/镶钉手套 概率效果
    if (atk.weapon && atk.weapon.cardId === 'a-99-2' && t) { var mm = CARDS['a-99-2'].mods; var ch = modAtLevel(mm, atk.weapon.level, 'procChance'); if (!t.flags.dead && rand() < ch) { log('碧灰双刃：额外造成 ' + mm.procDmg + ' 点伤害', 'eff'); damageMonster(t, opp, mm.procDmg, { src: SRC }); } }
  }
  /* a-074 疯狂强盗：攻击后向右移动一位，无法移动则返回手牌。
   * 卡面写的是"攻击后"，**不分攻击对象** —— 打怪（doAttack）和打脸（doAttackPlayer）都要走。
   * ⚠ 以前只在 doAttack 里调：打脸时既不移动也不回手。最直接的受害者是 BOSS 版疯狂强盗——
   *   【独行】会把玩家手里的非 A/S 怪丢光，玩家场上没有 A/S 怪时 BOSS 只能打脸，
   *   于是它永远不会"走不动而回手"。【逃跑】（本体回手 = 玩家失败）形同虚设。 */
  function banditAfterAttack(key, atk) {
    if (!moveRight(key, atk)) { log('疯狂强盗无法右移，返回手牌', 'dim'); leaveBoard(atk, key, false); }
  }
  function doAttackPlayer(key, atk) {
    var opp = other(key);
    var dmg = Math.max(0, atk.atk);
    if (atk.flags.eyeDouble) { dmg *= 2; atk.flags.eyeDouble = false; log('邪恶之眼：本击伤害翻倍', 'eff'); }   // a-146-02
    if (atk.cardId === 'a-038-2' && atk.flags.rogueBonus) { dmg += 3; atk.flags.rogueBonus = false; log('盗贼B：本次攻击 +3（此前处于无法被攻击）', 'eff'); }
    log(atk.name + ' 直接攻击 ' + state.players[opp].name + '（' + dmg + ' 点）', 'attack');
    emit({ type: 'attack', from: atk.uid, toPlayer: opp, fromKey: key, fromSlot: slotOf(key, atk.uid) });   // 供 UI 画"打向玩家"的连线
    damagePlayer(opp, dmg, { src: { by: key, card: atk.cardId } });
    if (opp === 'A' && state.ach && !state.ach.off) state.ach.playerAttacked += 1;   // 成就「皇家卫士」用
    // 疯狂小偷 / 疯狂强盗：对玩家攻击时获得其一张手牌
    // 疯狂小偷的「回合结束返回手牌」以此为准：只有真的打脸夺到手牌才返回（攻击怪物不返回）
    if (atk.cardId === 'a-073-2' || atk.cardId === 'a-074-2') {
      var op = state.players[opp];
      var thief = atk.cardId === 'a-073-2' ? '疯狂小偷' : '疯狂强盗';
      if (op.hand.length && state.players[key].hand.length < Rules.HAND_LIMIT) {
        var c = op.hand.splice(rnd(op.hand.length), 1)[0];
        /* 记下原主：这张卡以后无论被打出还是被弃置，进入的都是**原主**的弃牌堆
           （玩家裁定，见 toDiscard / discardOwnerOf）。 */
        if (!c.origOwner) c.origOwner = opp;
        state.players[key].hand.push(c);
        atk.flags.robbedPlayer = true;
        if (key === 'A' && atk.cardId === 'a-073-2' && state.ach && !state.ach.off) state.ach.stolen += 1;   // 成就「妙手神偷」
        log(thief + '：获得对方一张手牌（' + cardOf(c).name + '）', 'eff');
      } else {
        log(thief + '：对方无手牌可取（或我方手牌已满），本次未夺牌', 'dim');
      }
    }
    // 疯狂强盗：打脸同样要"攻击后右移、走不动则回手"（与打怪保持一致，见 banditAfterAttack）
    if (atk.cardId === 'a-074-2') banditAfterAttack(key, atk);
    /* 攻击后附加效果：打脸也要走（t 传 null）。
       卡面「主动攻击后」不分攻击对象 —— 火元素令对手弃卷轴、冰霜元素弃药水、混沌元素复制效果
       这些在打脸时同样该发动。此前只挂在 doAttack（打怪）上，打脸一律不触发。 */
    postAttackProps(key, atk, null, opp, 0, dmg);
  }

  function actConfirmBattle(key) {
    if (state.phase !== 'PREP') return fail('当前不在准备阶段');
    beginBattle(key);
    return { ok: true };
  }
  function beginBattle(key) {
    state.phase = 'BATTLE';
    log(state.players[key].name + ' 进入战斗阶段', 'phase');
    // 巨钳蟹：免疫标记按"战斗阶段"重置（攻守双方都重置，避免它在对方战斗阶段仍被当作"本阶段已受伤"而完全免疫）
    ['A', 'B'].forEach(function (k) { aliveMonsters(k).forEach(function (m) { m.flags.tookDamageThisBattle = false; }); });
    // 觉醒【灵视】：战斗阶段开始时，永久清除一只敌方怪物的不可选中状态
    ['A', 'B'].forEach(function (k) {
      var seer = aliveMonsters(k).filter(function (m) { return m.awaken === 'insight'; })[0];
      if (!seer) return;
      var foe = aliveMonsters(other(k)).filter(function (m) { return m.flags.untargetable; })[0];
      if (!foe) return;
      foe.flags.untargetable = false;
      foe.flags.untargetableInnate = false;               // 永久解除
      foe.flags.untargetableUntilOwnerTurn = false;
      log('【灵视】' + seer.name + '：解除 ' + foe.name + ' 的不可选中状态', 'eff');
    });
    // 镶钉手套：战斗阶段开始时概率抽一张牌
    aliveMonsters(key).forEach(function (m) {
      if (m.weapon && m.weapon.cardId === 'a-069-2') {
        var mm = CARDS['a-069-2'].mods;
        var ch = modAtLevel(mm, m.weapon.level, 'procChance');
        if (rand() < ch) { log('镶钉手套 触发：抽一张牌', 'eff'); draw(key, 1); }
      }
    });
    checkVictory();
    var opp = other(key);
    var op = state.players[opp];
    // 麻痹陷阱：对方进入战斗阶段时立刻发动，结束对方回合
    var trap = op.hand.filter(function (c) { return c.cardId === 'a-022-2'; })[0];
    if (!trap) { notify(); return; }
    /* 净化药水（a-132-02）：处于净化状态时【麻痹陷阱】**发动无效**
       —— 陷阱留在手里不弃，也不会结束回合（玩家裁定："麻痹"属于可免疫的负面状态）。 */
    if (negImmune(key)) {
      log('净化药水：免疫【麻痹陷阱】，本次发动无效', 'eff');
      emit({ type: 'trap', key: opp, cardId: 'a-022-2' });
      notify(); return;
    }
    if (op.isAI) {
      // AI 判断：若对方场上有怪物则发动
      if (aliveMonsters(key).length > 0) {
        removeFromHand(op, trap.iid); op.discard.push(trap);
        log('对手发动【麻痹陷阱】：结束你的回合', 'eff');
        emit({ type: 'trap', key: opp, cardId: 'a-022-2' });
        endTurn(key); // 跳过战斗阶段
      } else notify();
    } else {
      // actorKey 必须是**要做决定的人**（陷阱持有者 opp）。以前误写成 key（被麻痹的一方），
      // 导致联机时"等你选择"的弹窗发到了被麻痹者那边，持有者反而看不到；被麻痹的人另存 victimKey。
      state.pending = { kind: 'TRAP_PARALYZE', trapIid: trap.iid, actorKey: opp, victimKey: key };
      notify();
    }
  }
  /* 多步选择在推进到下一步时**重算候选**。
     为什么必须重算：`requestChoices` 会在调用瞬间把所有步骤的候选算成快照。但上一步的选择
     可能已经改变了牌库/手牌 —— 最典型的是「豺狼巡查」：第一步弃掉【宝箱怪】，宝箱怪「进入弃牌堆时
     抽一张牌」立刻把牌库顶那张抽到手上，而第二步（检索 💰 怪）的候选还是弃牌前的快照，
     于是**已经被抽走的那张仍显示在检索页**，玩家选它却找不到卡。
     （服务端沙箱里 pred 函数是活的，所以能完整重算；下发到客户端的只是结果的 JSON 拷贝。） */
  function refreshStepCands(actorKey, st) {
    if (!st || st.action) return;                       // 术士/混沌的自定义候选不重算
    if (!st.from || st.from === 'custom') return;
    var p = state.players[actorKey];
    if (!p) return;
    var zone = zoneOf(p, st.from);
    var keep = zone.filter(st.pred || function () { return true; });
    st.cands = keep.map(function (c) {
      var cd = cardOf(c);
      return { iid: c.iid, cardId: c.cardId, name: cd.name, tier: cd.tier || '', type: cd.type };
    });
  }

  function resolvePrompt(accept) {
    if (!state.pending) return;
    var pd = state.pending;
    // 定向选择：accept 可传 { iids:[...] } 或 [iids]；未指定时自动选择（兼容旧驱动）
    if (pd.kind === 'CHOOSE_CARDS') {
      var st = pd.steps[pd.idx];
      var iids = null;
      if (accept && typeof accept === 'object' && Array.isArray(accept.iids)) iids = accept.iids;
      else if (Array.isArray(accept)) iids = accept;
      if (!iids) iids = chooseAuto(pd.actorKey, st);
      applyChoice(pd.actorKey, st, iids);
      pd.idx += 1;
      /* 进入下一步前重算候选（上一步的后果可能已经改动了牌库/手牌）。
         重算后如果这一步已经没有可选卡，就继续往后跳 —— 否则会弹一个空窗口卡住玩家。 */
      while (pd.idx < pd.steps.length) {
        var nxt = pd.steps[pd.idx];
        refreshStepCands(pd.actorKey, nxt);
        if (!nxt.action && (!nxt.cands || !nxt.cands.length)) {
          log((nxt.label || '选择') + '：没有满足条件的卡，跳过', 'dim');
          pd.idx += 1;
          continue;
        }
        break;
      }
      if (pd.idx >= pd.steps.length) {
        state.pending = null;
        pd.done();
        // 排队的下一个选择（例如史莱姆 → 法杖两个请求连开）
        if (!state.pending && pendingQueue.length) state.pending = pendingQueue.shift();
      }
      notify();
      return;
    }
    state.pending = null;
    if (pd.kind === 'OPTION_SKILL') {
      // 可选技能（豺狼巡查）：发动 → 进入选牌流程；不发动 → 直接跳过
      // 必须补一次 notify()：requestChoices 只是写了 state.pending，靠 notify 才会弹弃牌窗口。
      // 否则点「发动」后没反应，要等玩家再点别的（例如任意手牌）触发一次渲染才弹出来。
      if (accept) { requestChoices(pd.actorKey, pd.steps); notify(); }
      else { log('放弃发动【' + pd.label + '】的技能', 'dim'); notify(); }
      return;
    }
    if (pd.kind === 'TRAP_PARALYZE') {
      var holder = pd.actorKey;                              // 决定者 = 陷阱持有者
      var victim = pd.victimKey || other(pd.actorKey);       // 被麻痹的人（旧数据兜底）
      if (accept) {
        var hp = state.players[holder];
        removeFromHand(hp, pd.trapIid); hp.discard.push(makeInstance('a-022-2'));
        log(state.players[holder].name + ' 发动【麻痹陷阱】：结束对方回合', 'eff');
        emit({ type: 'trap', key: holder, cardId: 'a-022-2' });
        endTurn(victim);
      } else { log('放弃发动【麻痹陷阱】', 'dim'); notify(); }
    }
    /* 羊群陷阱（a-158-02）：卡面"可发动" → 同样由持有者决定；放弃则陷阱留在手里。 */
    if (pd.kind === 'TRAP_SHEEP') {
      var sHolder = pd.actorKey;
      var shp = state.players[sHolder];
      var sTrap = shp.hand.filter(function (c) { return c.iid === pd.trapIid; })[0];
      if (accept && sTrap) fireSheepTrap(sHolder, sTrap);
      else log('放弃发动【羊群陷阱】', 'dim');
      notify();
    }
    /* 闪光陷阱（a-138-02）：卡面"可发动" → 由持有者决定。
       发动 = 弃掉陷阱 + 给召唤者上 2 回合封锁；放弃 = 陷阱留在手里（以后还能用）。 */
    if (pd.kind === 'TRAP_FLASH') {
      var fHolder = pd.actorKey, fVictim = pd.victimKey || other(pd.actorKey);
      var fh = state.players[fHolder];
      if (accept) {
        var fTrap = fh.hand.filter(function (c) { return c.iid === pd.trapIid; })[0];
        if (fTrap) {
          removeFromHand(fh, fTrap.iid);
          discardUsed(fHolder, fTrap);
          emit({ type: 'trap', key: fHolder, cardId: 'a-138-02' });
          log(state.players[fHolder].name + ' 发动【闪光陷阱】', 'eff');
          banThrowWand(fVictim, pd.turns || CARDS['a-138-02'].mods.banTW);
        }
      } else log('放弃发动【闪光陷阱】', 'dim');
      notify();
    }
  }

  function actEndTurn(key) {
    if (state.phase === 'PREP') { beginBattle(key); return { ok: true }; }
    /* 回合结束时把本回合的攻击位置存成「上回合记录」（YOG a-150-02 用） */
    state.prevAtk = state.prevAtk || { A: [], B: [] };
    state.prevAtk[key] = (state.curAtk && state.curAtk[key]) ? state.curAtk[key].slice() : [];
    state.curAtk = state.curAtk || { A: [], B: [] };
    state.curAtk[key] = [];
    endTurn(key);
    return { ok: true };
  }

  function checkVictory() {
    if (state.noHpFloor) return;                 // 学院考核：血量无下限，不在这里判胜负
    ['A', 'B'].forEach(function (k) { if (state.players[k].hp <= 0 && !state.winner) { state.winner = other(k); log('—— ' + state.players[state.winner].name + ' 获胜！——', 'hl'); } });
    if (state.players.A.hp <= 0) state.players.A.hp = 0;
    if (state.players.B.hp <= 0) state.players.B.hp = 0;
  }

  /* ---------------- 查询接口（供 UI / AI 使用） ---------------- */
  function canSummonNormally(key) { return state.players[key].summonsLeft > 0 && emptySlots(key).length > 0; }
  function handCard(key, iidv) { return state.players[key].hand.filter(function (c) { return c.iid === iidv; })[0] || null; }

  return {
    get state() { return state; },
    load: load,                                     // 联机：装载服务器下发的状态
    newGame: newGame, tryAction: tryAction, resolvePrompt: resolvePrompt,
    on: on, notify: notify,
    setAIPolicy: setAIPolicy,
    rand: rand, seedRandom: seedRandom, other: other, ln: ln,
    rnd: rnd, pick: pick, shuffle: shuffle, clone: clone,
    achScan: achScan, log: log, emit: emit, makeInstance: makeInstance,
    cardOf: cardOf, rollAwaken: rollAwaken, makePlayer: makePlayer, secondHandCompensate: secondHandCompensate,
    removeFromHand: removeFromHand, removeFromBoard: removeFromBoard, draw: draw, weaponOnDraw: weaponOnDraw,
    findWeaponWith: findWeaponWith, triggerWeaponDraw: triggerWeaponDraw, discardCard: discardCard, discardRandom: discardRandom,
    onDiscard: onDiscard, discardOwnerOf: discardOwnerOf, discardUsed: discardUsed, toDiscard: toDiscard,
    cleanseUntilSet: cleanseUntilSet, negImmune: negImmune, tearStrike: tearStrike, nestSpawnTear: nestSpawnTear,
    seeThrough: seeThrough, chargedRingReady: chargedRingReady, virtualTargetOk: virtualTargetOk, runVirtualCard: runVirtualCard,
    fireSheepTrap: fireSheepTrap, checkSheepTrap: checkSheepTrap, actUseTome: actUseTome, attackBlockReason: attackBlockReason,
    addPoison: addPoison, addAcid: addAcid, throwWandBanReason: throwWandBanReason, banThrowWand: banThrowWand,
    cupStrike: cupStrike, stripCupGain: stripCupGain, corruptCheck: corruptCheck, applyAwakenSpawn: applyAwakenSpawn,
    spawnMonster: spawnMonster, applyInnateFlags: applyInnateFlags, baseAttacksMax: baseAttacksMax,
  wandNeedsTargetCard: wandNeedsTargetCard, WAND_TARGET_IDS: WAND_TARGET_IDS,
  firstEmpty: firstEmpty, emptySlots: emptySlots,
    aliveMonsters: aliveMonsters, findMonster: findMonster, slotOf: slotOf, placeBoss: placeBoss,
    bossInst: bossInst, bossApi: bossApi, bossHook: bossHook, eqModValue: eqModValue,
    perkOf: perkOf, perkAtkBonus: perkAtkBonus, perkHpBonus: perkHpBonus, recalc: recalc,
    recalcAll: recalcAll, dmgReduce: dmgReduce, cutTargetReduce: cutTargetReduce, creditDamage: creditDamage,
    creditSrc: creditSrc, creditHeal: creditHeal, damageMonster: damageMonster, damagePlayer: damagePlayer,
    healMonster: healMonster, healPlayer: healPlayer, gainCard: gainCard, returnEquipment: returnEquipment,
    leaveBoard: leaveBoard, destroyMonster: destroyMonster, castsMaxOf: castsMaxOf, refreshCasts: refreshCasts,
    startTurn: startTurn, resolveBuffSettlement: resolveBuffSettlement, resolvePrepStart: resolvePrepStart, endTurn: endTurn,
    finishByHp: finishByHp, onSummon: onSummon, applyAwakenPrep: applyAwakenPrep, isDwarf: isDwarf,
    isNameDwarf: isNameDwarf, kingAlive: kingAlive, dwarfShareOn: dwarfShareOn, shareDwarfDamage: shareDwarfDamage,
    findEquipRef: findEquipRef, maxEquipLevel: maxEquipLevel, clampEquipLevel: clampEquipLevel, modAtLevel: modAtLevel,
    levelEquipRef: levelEquipRef, chaosCopy: chaosCopy, chaosApply: chaosApply, resolveReviveQueue: resolveReviveQueue,
    prepStartMonster: prepStartMonster, turnEndMonster: turnEndMonster, onDeath: onDeath, summonToken: summonToken,
    necro: necro, prisonGuard: prisonGuard, tenguGrow: tenguGrow, moveMonsterTo: moveMonsterTo,
    tenguMove: tenguMove, deriveCard: deriveCard, searchDeckToHand: searchDeckToHand, searchDeckRandom: searchDeckRandom,
    zoneOf: zoneOf, requestChoices: requestChoices, applyChoice: applyChoice, chooseAuto: chooseAuto,
    checkSummonTrap: checkSummonTrap, ok: ok, fail: fail, actSummon: actSummon,
    actSacrifice: actSacrifice, actUse: actUse, useTreasure: useTreasure, useThrow: useThrow,
    healOnThrowUsed: healOnThrowUsed, countThrowForRing: countThrowForRing, useFood: useFood, usePotion: usePotion,
    useScroll: useScroll, actEquip: actEquip, actPlaceWand: actPlaceWand, actActivateWand: actActivateWand,
    grantBingShield: grantBingShield, actMoveMonster: actMoveMonster, actUseCup: actUseCup, actTimeStop: actTimeStop,
    cloneMirrorEquip: cloneMirrorEquip, createMirror: createMirror, moveRight: moveRight, actAttack: actAttack,
    doAttack: doAttack, postAttackProps: postAttackProps, banditAfterAttack: banditAfterAttack, doAttackPlayer: doAttackPlayer,
    actConfirmBattle: actConfirmBattle, beginBattle: beginBattle, refreshStepCands: refreshStepCands, actEndTurn: actEndTurn,
    checkVictory: checkVictory, canSummonNormally: canSummonNormally, handCard: handCard,
  };
})();
