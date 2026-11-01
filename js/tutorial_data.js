/* ============================================================
 * 入学手册（新手教程）· 脚本数据  tutorial_data.js
 *  - 教学卡组（双方）+ 分步目标：每一步都通过"观察真实引擎状态"判定完成
 *  - 只依赖 Engine / CARDS / Rules，不碰 DOM（便于无头测试）
 *  - 步骤字段：
 *      id/title/text/tip   文案
 *      mode                'read' 纯讲解·认识界面 → 左键点击任意位置前进
 *                          'do'   需要操作 → 必须做完操作才自动进入下一步
 *      setup()             进入本步时布置场面（发手牌 / 摆怪）
 *      targets()           需要高亮的元素选择器数组（可为空）
 *      check(s, snap)      完成判定；snap = 进入本步时的状态快照
 * ========================================================== */
var TUTORIAL_DATA = (function () {
  'use strict';

  /* ---------------- 教学卡组 ---------------- */
  var PLAYER_DECK = [
    'a-005-2', 'a-005-2',                    // 大蜗牛 2/6（自愈 + 减伤2）→ 召唤/装备教学
    'a-045-2', 'a-045-2',                    // 食人鱼 4/6 → 输出主力
    'a-047-2', 'a-047-2',                    // 金色蜜蜂 3/8（我方生命＜30 时 +4 攻）
    'a-003-2', 'a-003-2',                    // 水道巨蛇 3/5（50% 闪避）
    'a-075-2',                                // DM-100 2/8（回合结束打非对位 5 伤）
    'a-013-2', 'a-013-2',                    // 神秘宝箱（抽 2）→ 道具教学
    'a-027-2', 'a-027-2',                    // 布甲（减伤1，要求血量上限≥6）→ 装备教学
    'a-015-2', 'a-015-2', 'a-015-2',         // 飞刀（投掷 2 伤）→ 投掷物教学
    'a-019-2', 'a-019-2',                    // 治疗药水
    'a-017-2', 'a-017-2'                     // 口粮
  ];
  // 「实习稻草人」：怪物很少、大部分是过牌/回血道具 → 常常空场，新手才抢得到"打脸"窗口
  var FOE_DECK = [
    'a-002-2', 'a-002-2',                          // 啮齿小鼠 3/8
    'a-003-2', 'a-003-2',                          // 水道巨蛇 3/5
    'a-013-2', 'a-013-2', 'a-013-2', 'a-013-2',    // 神秘宝箱（AI 会花回合过牌）
    'a-017-2', 'a-017-2', 'a-017-2', 'a-017-2',    // 口粮
    'a-019-2', 'a-019-2', 'a-019-2', 'a-019-2',    // 治疗药水
    'a-025-2', 'a-025-2',                          // 短剑
    'a-027-2', 'a-027-2'                           // 布甲
  ];
  // 对手（实习稻草人）的起手：固定给它"过牌 + 回血 + 一只弱怪"，可预期、不会把新手打崩
  var FOE_HAND = ['a-013-2', 'a-017-2', 'a-019-2', 'a-002-2'];
  var FOE_HP = 10;

  /* ---------------- 布置场景的小工具（只改手牌/场面） ---------------- */
  var _uid = 90000;
  function inst(id) { return { iid: _uid++, cardId: id, level: 0, star: 1 }; }
  function A() { return Engine.state.players.A; }
  function B() { return Engine.state.players.B; }

  // 严格摆好"本步该有的手牌"：只留引导需要的那几张，其余直接丢掉（**不回牌库**，
  // 否则牌库里会攒出一堆随机牌，每回合抽牌又会把教程搅乱）
  var _given = {};                            // 本步发到手牌的卡：cardId → iid（用于"用掉了没有"的判定）
  function handSet(ids) {
    var p = A();
    p.hand = ids.map(inst);
    _given = {};
    p.hand.forEach(function (c) { _given[c.cardId] = c.iid; });
  }
  // 摆好牌库（教程默认双方牌库为空：所有牌都由步骤发放，牌库不会"自己冒出牌"来干扰引导）
  function deckSet(ids) { A().deck = (ids || []).map(inst); }
  // 本步发的那张牌是否已经离开手牌（按实例判定；否则"又抽到一张同名卡"会误判）
  function givenUsed(id) {
    var iid = _given[id];
    if (iid == null) return false;
    return !A().hand.some(function (c) { return c.iid === iid; });
  }
  function foeHandSet(ids) { B().hand = ids.map(inst); }

  // 直接摆一只怪到场上（用一次真实召唤拿"成品"实例，再改写成目标卡，避免手搓数值出错）
  function placeMonster(key, id, slot, hpOverride) {
    var s = Engine.state, p = s.players[key], cd = CARDS[id];
    if (!cd) return null;
    var keepActive = s.active, keepPhase = s.phase;
    var keepLeft = p.summonsLeft;
    s.active = key; s.phase = 'PREP'; p.summonsLeft = 1;
    var mule = inst('a-005-2'); p.hand.push(mule);
    Engine.tryAction({ type: 'SUMMON', iid: mule.iid, slot: slot, _ai: !!p.isAI });
    s.active = keepActive; s.phase = keepPhase; p.summonsLeft = keepLeft;
    var o = p.board[slot];
    if (!o) return null;
    o.cardId = id; o.name = cd.name; o.tier = cd.tier;
    o.baseHp = cd.hp; o.maxHp = cd.hp; o.hp = (hpOverride != null ? hpOverride : cd.hp);
    o.baseAtk = cd.atk; o.atk = cd.atk;
    o.growthAtk = 0; o.tempAtk = 0; o.shield = 0; o.reduceCut = 0;
    o.weapon = null; o.armor = null;
    o.flags = { attacked: false, attacksMax: 1, tookDamageThisBattle: false };
    return o;
  }
  // 手牌中某张卡的 DOM 选择器（手牌元素只带 data-iid）
  function handSel(id) {
    var s = Engine.state, h = (s && s.players.A.hand) || [];
    for (var i = 0; i < h.length; i++) {
      if (h[i].cardId === id) return '#myHand .card[data-iid="' + h[i].iid + '"]';
    }
    return null;
  }
  // 对手场上没有怪时补一只（保证"打怪"这一步有目标可打）
  function ensureFoeMonster() {
    if (Engine.aliveMonsters('B').length) return;
    placeMonster('B', 'a-002-2', 1);
  }

  /* ---------------- 开局布置 ---------------- */
  function onBegin() {
    var s = Engine.state;
    if (!s) return;
    // 双方牌库清零：教程里的牌 100% 由步骤发放，不会再有"随机抽到的牌"搅局
    s.players.A.deck = []; s.players.A.discard = [];
    s.players.B.deck = []; s.players.B.discard = [];
    foeHandSet(FOE_HAND.slice());              // 对手手牌固定，可预期
    s.players.A.hp = 30;
    s.players.B.hp = FOE_HP;
    handSet(['a-005-2']);                      // 开局就发一张【大蜗牛】：认识手牌时手上有东西可看
  }

  /* ---------------- 步骤脚本 ----------------
   * 前 5 步是"认识界面"讲解（左键点击继续），后面全是"必须做完操作"的实战练习。
   */
  var STEPS = [
    {
      id: 'intro', title: '认识决斗场', mode: 'read',
      text: '欢迎来到《地牢决斗师》！我是你的助教，接下来一步步带你上手。<br>' +
        '一场决斗的目标很简单：<b>把对手的生命打完</b>。<br>' +
        '上面这条是<b>对手</b>的信息，下面这条是<b>你</b>的信息（名字、生命、牌库、弃牌堆都在这里）。',
      tip: '一个回合分两个阶段：<b>准备阶段</b>（召唤 / 用道具 / 装备）→ <b>战斗阶段</b>（指挥怪物攻击）。',
      targets: function () { return ['#oppInfo', '#myInfo']; },
      check: null
    },
    {
      id: 'ui-hand', title: '这里是你的手牌', mode: 'read',
      text: '战场最下面这一排是<b>手牌</b>。<br>' +
        '你手上已经有一张 <b>【大蜗牛】</b>：左下角的 2 是攻击力、右下角的 6 是生命。<br>' +
        '准备阶段要做的事，基本都是<b>从这里出牌</b>。',
      tip: '鼠标悬停在卡牌上，右侧会显示它的完整效果说明。',
      targets: function () { return [handSel('a-005-2'), '#myHand']; },
      check: null
    },
    {
      id: 'ui-board', title: '中间的战场：怪物放在这里', mode: 'read',
      text: '中间两排格子就是<b>战场</b>：下面 3 格是你的，上面 3 格是对手的。<br>' +
        '怪物放进格子里才能作战，<b>上下相对的格子</b>叫"对位"——很多技能只打对位。<br>' +
        '怪物生命就显示在怪物头顶的小横条上。',
      tip: '格子上写着「空」，表示这个位置可以放怪物。',
      targets: function () { return ['#myBoard', '#oppBoard']; },
      check: null
    },
    {
      id: 'ui-end', title: '中间这个按钮：结束准备 / 结束回合', mode: 'read',
      text: '战场正中间那颗按钮是本回合的<b>方向盘</b>：<br>' +
        '准备阶段它写着 <b>「结束准备」</b>，点它进入战斗阶段；<br>' +
        '战斗阶段它写着 <b>「结束回合」</b>，点它把回合交给对手。',
      tip: '按钮上方的横幅会显示当前处于哪个阶段。',
      targets: function () { return ['#endBtn', '#phaseBanner']; },
      check: null
    },
    {
      id: 'ui-log', title: '右侧的战斗日志', mode: 'read',
      side: 'left',        // 这一步讲的就是右侧日志栏：助教框临时挪到左边，别挡住要看的栏
      text: '右侧这一栏是<b>战斗日志</b>：谁抽了牌、谁挨了多少伤害、哪个技能触发了，都会一条条写在这里。<br>' +
        '看不懂发生了什么时，<b>先看日志</b>。',
      tip: '日志上方是：悬停卡牌预览、牌库/弃牌堆查看器。',
      targets: function () { return ['#logbox']; },
      check: null
    },
    {
      id: 'summon', title: '召唤怪物', mode: 'do',
      text: '先铺场！每回合只能手动召唤 <b>1 只</b> C/B 级怪物。<br>' +
        '把 <b>【大蜗牛】</b> 拖到你自己的空位（或点它、再点空位）。',
      tip: '大蜗牛 2/6：每回合开始自愈 6 点、战斗中受到伤害 -2，是很可靠的前排。',
      setup: function () { handSet(['a-005-2']); foeHandSet(FOE_HAND.slice()); },   // 只给这一张，避免干扰
      targets: function () { return [handSel('a-005-2'), '#myBoard .cell.empty']; },
      check: function (s) { return Engine.aliveMonsters('A').length >= 1; }
    },
    {
      id: 'item', title: '使用道具', mode: 'do',
      text: '手里的 <b>【神秘宝箱】</b> 是宝藏卡：准备阶段使用可以抽两张牌。<br>点它就能用（宝藏不限次数）。',
      tip: '食物 / 药水 / 卷轴每类每回合只能用 1 张；宝藏和投掷物不限量。',
      // 牌库里放两张确定的卡：让"宝箱抽两张"真的能抽到牌，同时依旧没有随机性
      setup: function () { handSet(['a-013-2']); deckSet(['a-045-2', 'a-047-2']); },
      targets: function () { return [handSel('a-013-2')]; },
      check: function (s) { return givenUsed('a-013-2'); }
    },
    {
      id: 'equip', title: '装备防具', mode: 'do',
      text: '把 <b>【布甲】</b> 拖到大蜗牛身上：它让大蜗牛在战斗阶段受到的伤害 -1。<br>' +
        '装备有<b>要求</b>——布甲要求"血量上限 ≥ 6"，大蜗牛 6 血刚好达标。',
      tip: '每只怪物只能装 1 件武器或防具，装上后不能更换，选好目标再动手。',
      setup: function () { handSet(['a-027-2']); deckSet([]); },      // 宝箱演示完，牌库恢复为空
      targets: function () { return [handSel('a-027-2'), '#myBoard .monster']; },
      check: function (s) { return Engine.aliveMonsters('A').some(function (m) { return !!m.armor; }); }
    },
    {
      id: 'battle', title: '进入战斗阶段', mode: 'do',
      text: '准备阶段能做的做完了，点中间下方的 <b>「结束准备」</b> 进入战斗阶段。',
      tip: '进入战斗阶段后本回合不能再召唤/用道具，但可以继续攻击。',
      setup: function () { handSet([]); },
      targets: function () { return ['#endBtn']; },
      check: function (s) { return s.phase === 'BATTLE'; }
    },
    {
      id: 'attack', title: '指挥攻击', mode: 'do',
      text: '战斗阶段：把大蜗牛拖到对手的怪物身上发起攻击。<br>' +
        '注意规则：<b>对手场上有怪物时只能打怪物</b>；把它的怪物清光后，才能直接攻击对手本体（"打脸"）。',
      tip: '攻击怪物不会挨反击，所以能清场就清场。',
      setup: function () { handSet([]); ensureFoeMonster(); },
      targets: function () { return ['#myBoard .monster', '#oppBoard .monster']; },
      check: function (s, snap) { return (s.dealt.A || 0) > snap.dealtA; }
    },
    {
      id: 'endturn', title: '结束回合', mode: 'do',
      text: '攻击完了，点 <b>「结束回合」</b>。<br>接着轮到对手行动：看它出牌、召唤、攻击——右侧日志会记下每一条结算。',
      tip: '看不懂发生了什么时，先看日志。',
      setup: function () { handSet([]); },
      targets: function () { return ['#endBtn']; },
      check: function (s, snap) { return (s.turnCount || 0) > snap.turnCount; }
    },
    {
      id: 'throw', title: '投掷物', mode: 'do',
      text: '回到你的准备阶段：手上有 <b>【飞刀】</b>。把它拖到对手的怪物身上，造成 2 点伤害。<br>' +
        '投掷物在准备阶段就能用，可以先削血、进战斗阶段再补刀。',
      tip: '投掷物还能打到"无法被攻击"的怪（例如怨灵、被暗影斗篷保护的目标）。',
      setup: function () { handSet(['a-015-2']); ensureFoeMonster(); },
      targets: function () { return [handSel('a-015-2'), '#oppBoard .monster']; },
      check: function (s) { return givenUsed('a-015-2'); }
    },
    {
      id: 'finish', title: '打倒对手', mode: 'do',
      text: '基本操作都学会了 —— 现在把对手的生命打到 0！<br>' +
        '稻草人已经没怪、只剩 2 点生命：<b>结束准备</b>进入战斗阶段后，把怪物拖到<b>对手本体</b>（打脸）就能结束战斗。',
      tip: '出牌思路：每回合尽量「多打伤害 + 少挨伤害」——先清光它的怪，再一起打脸。',
      setup: function () {
        handSet([]);                                               // 收尾不放多余手牌
        var s = Engine.state, b = s.players.B;
        b.hp = 2;                                                  // 残血：保证新手一定拿得到"致胜一击"
        b.board = [null, null, null];                              // 清空它的场面（打脸无需先清场）
        b.hand = [];                                               // 它也不能再回血/召怪（注意别塞进牌库，否则以后会被抽到）
        if (!Engine.aliveMonsters('A').length) placeMonster('A', 'a-005-2', 0);   // 我方无怪则补一只，保证能打脸
      },
      targets: function () { return ['#endBtn', '#myBoard .monster', '#oppInfo']; },
      check: function (s) { return !!s.winner; }
    },
    {
      id: 'done', title: '毕业 · 入学手册完成', mode: 'read', done: true,
      text: '恭喜！你已经掌握了决斗的基本流程：<br>' +
        '① 准备阶段召唤怪物 → ② 使用道具/装备强化 → ③ 进入战斗阶段攻击 → ④ 结束回合等对手行动。<br>' +
        '接下来可以试试「学院考核」（8 人同台的养成淘汰赛）、「魔绫大赛」（42 套流派卡组对战）或「踏上征途」（跑图）。',
      tip: '想复习随时回主菜单点「入学手册」。',
      targets: function () { return []; },
      check: null
    }
  ];

  return {
    PLAYER_DECK: PLAYER_DECK, FOE_DECK: FOE_DECK, FOE_HAND: FOE_HAND, FOE_HP: FOE_HP,
    STEPS: STEPS, onBegin: onBegin
  };
})();
