/* ============================================================
 * 晋升之路 · 数据层  boss_data.js
 *  16 关 BOSS 闯关：玩家用自己的卡组（20~40 张）依次挑战
 *  - 每关一个 BOSS：固定在中位、大量血量；击破即通关（对手本体锁血，打不死）
 *  - 每通关一关解锁一个称号（共 16 个）
 *  - 16 关全部已设计（1~12 为原始关卡，13~16 为豺狼 / DM 系新关卡）
 *
 *  技能钩子（由 engine 在关键时机回调，api 见 engine.js 的 bossApi）：
 *    init        开局一次（放全局开关，如 fireElemMult / acidMul）
 *    aiTurnStart AI(B)回合开始
 *    foeTurnStart玩家(A)回合开始
 *    turnEnd     回合结束（第 2 参 = 刚行动的一方）
 *    bossDamaged 本体受到伤害后（未致死；【磁塔】等阈值机制即时触发）
 *    bossAllyLeft 己方(B)有怪物离场后（【保护】等依赖己方场面的技能即时刷新）
 *    bossDying   本体将死（可救回：把 flags.dead 置回 false 即取消本次死亡，如【意志】）
 *    bossLeave   BOSS 离开场上（返回手牌等）
 * ========================================================== */
var BOSS_DATA = (function () {
  'use strict';

  // 16 个称号（按关卡顺序解锁；16 关全部已设计）
  var TITLES = [
    '初阶见习生', '中阶见习生', '高阶见习生', '进修见习生',
    '初阶学士', '中阶学士', '高阶学士', '进修学士',
    '初阶决斗者', '中阶决斗者', '高阶决斗者', '进修决斗者',
    '一星决斗师', '二星决斗师', '三星决斗师', '荣誉决斗师'
  ];

  var BOX = 'a-013-2';   // 神秘宝箱（过牌）
  function rep(id, n) { var a = []; for (var i = 0; i < n; i++) a.push(id); return a; }
  function deck() { // 把多个数组拼成一个卡组
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (typeof a === 'string') out.push(a);
      else for (var j = 0; j < a.length; j++) out.push(a[j]);
    }
    return out;
  }

  /* ---------------- 技能实现 ---------------- */
  var SKILLS = {
    /* 1 巨钳蟹：格挡(固有) + 迟缓(卡组清空) + 成长 */
    crab: {
      aiTurnStart: function (api) {
        var b = api.boss(); if (!b) return;
        b.growthAtk += 1; api.recalc(b);
        api.log('BOSS 巨钳蟹【成长】：力量 +1（现 ' + b.atk + '）', 'eff');
      }
    },
    /* 2 豺狼猎手：暗镖(衍生苦无×2) + 藏刀(卡组全飞刀) + 计巧(回合结束+1盾) */
    jackal: {
      aiTurnStart: function (api) {
        api.derive('B', 'a-016-2'); api.derive('B', 'a-016-2');
        api.log('BOSS 豺狼猎手【暗镖】：手牌衍生 2 张【苦无】', 'eff');
      },
      turnEnd: function (api, key) {
        if (key !== 'B') return;
        var b = api.boss(); if (!b) return;
        b.shield += 1;
        api.log('BOSS 豺狼猎手【计巧】：获得 1 点护盾（现 ' + b.shield + '）', 'eff');
      }
    },
    /* 3 腐臭老鼠：毒瘤(玩家-3) + 麻痹(玩家随机怪少一次攻击) */
    rat: {
      aiTurnStart: function (api) {
        // 本体固有【腐臭】每回合使玩家 -1 → 这里再 -3，合计 4（对齐技能描述）
        api.damagePlayer('A', 3);
        api.log('BOSS 腐臭老鼠【毒瘤】：玩家失去 4 点生命（本体 3 点 + 固有【腐臭】1 点）', 'eff');
      },
      foeTurnStart: function (api) {
        var ms = api.alive('A'); if (!ms.length) return;
        var m = ms[api.rand() * ms.length | 0];
        m.flags.attacksMax = Math.max(0, (m.flags.attacksMax || 1) - 1);
        api.log('BOSS 腐臭老鼠【麻痹】：' + m.name + ' 失去一次攻击次数', 'eff');
      }
    },
    /* 4 黏咕：水性(回5) + 蓄力(50%:少一次攻击/得1层) + 蓄爆(40%:5×层数群伤) */
    gum: {
      aiTurnStart: function (api) {
        var b = api.boss(); if (!b) return;
        api.heal(b, 5); api.log('BOSS 黏咕【水性】：恢复 5 点生命', 'eff');
        var st = api.state.bossState;
        if (api.rand() < 0.5) {
          b.flags.attacksMax = Math.max(0, (b.flags.attacksMax || 1) - 1);   // 按文本：确实失去一次攻击（可降到 0，下回合恢复）
          st.gumCharge = (st.gumCharge || 0) + 1;
          api.log('BOSS 黏咕【蓄力】：失去一次攻击，获得 1 层蓄力（现 ' + st.gumCharge + ' 层）', 'eff');
        }
        if (api.rand() < 0.4 && (st.gumCharge || 0) > 0) {
          var d = 5 * st.gumCharge;
          api.log('BOSS 黏咕【蓄爆】：对玩家全场造成 ' + d + ' 点伤害并清空蓄力', 'eff');
          api.alive('A').slice().forEach(function (m) { api.damage(m, 'A', d); });
          st.gumCharge = 0;
        }
      }
    },
    /* 5 绿野精灵：成长(力量+1) + 腾跃(玩家抽1) */
    elf: {
      aiTurnStart: function (api) {
        var b = api.boss(); if (!b) return;
        b.growthAtk += 1; api.recalc(b);
        api.log('BOSS 绿野精灵【成长】：力量 +1（现 ' + b.atk + '）', 'eff');
      },
      foeTurnStart: function (api) { api.draw('A', 1); api.log('BOSS 绿野精灵【腾跃】：玩家抽一张牌', 'eff'); }
    },
    /* 6 腐烂之心：藤网(空位衍生腐烂触手) + 毒瘤(玩家毒气锁定999层) + 果实(触手+1并按本体效果结算) */
    rotHeart: {
      aiTurnStart: function (api) {
        var made = 0;   // 按文本：所有空位各衍生一只（不止一个空位）
        while (api.empty('B').length) { if (!api.token('B', 'a-080-2')) break; made++; }
        if (made) api.log('BOSS 腐烂之心【藤网】：在所有空位衍生 ' + made + ' 只【腐烂触手】', 'eff');
      },
      foeTurnStart: function (api) {
        var pa = api.player();
        pa.poison = 999;
        api.log('BOSS 腐烂之心【毒瘤】：玩家【毒气】锁定为 999 层', 'eff');
        // 果实：所有腐烂触手力量+1，并触发本体（腐烂之心 a-081-2）效果
        var touch = api.alive('B').filter(function (m) { return m.cardId === 'a-080-2'; });
        touch.forEach(function (m) { m.growthAtk += 1; api.recalc(m); });
        var bonus = Math.floor((pa.rotMarks || 0) / 2);
        if (touch.length) api.log('BOSS 腐烂之心【果实】：' + touch.length + ' 只腐烂触手力量 +1', 'eff');
        if (bonus > 0) { pa.poisonBonus = (pa.poisonBonus || 0) + bonus; pa.rotMarks = 0; api.log('BOSS 腐烂之心：玩家受到的【毒气】伤害 +' + bonus, 'eff'); }
      }
    },
    /* 7 克里弗斯之果：藤蔓(魔化藤在场→BOSS无法被攻击) + 毒瘤(生命<80→毒气伤害固定5) + 蛮发(每回合全场-2) */
    fruit: {
      tick: function (api) {
        var b = api.boss(); if (!b) return;
        var vine = api.alive('B').some(function (m) { return m.cardId === 'a-054-2'; });
        if (b.flags.untargetable !== vine) {
          b.flags.untargetable = vine; b.flags.untargetableInnate = vine;
          api.log(vine ? 'BOSS 克里弗斯之果【藤蔓】：魔化藤在场，本关 BOSS 无法被攻击' : 'BOSS 克里弗斯之果【藤蔓】：魔化藤已离场，BOSS 可被攻击', 'eff');
        }
        // 【毒瘤】：仅"玩家(A)"受到的毒气伤害固定为 5（本体一侧不受影响）
        var toxinOn = (b.hp < 80);
        var st = api.state.bossState;
        if (toxinOn !== st.toxinOn) {
          st.toxinOn = toxinOn;
          api.log(toxinOn ? 'BOSS 克里弗斯之果【毒瘤】：本体生命低于 80 → 玩家受到的【毒气】伤害固定为 5'
            : 'BOSS 克里弗斯之果【毒瘤】：本体生命回升至 80 以上 → 玩家毒气伤害恢复正常', 'eff');
        }
        api.state.poisonDmgFn = toxinOn ? function (k, pd) { return (k === 'A') ? 5 : pd; } : null;
        // 蛮发：场上所有怪物失去 2 点生命
        ['A', 'B'].forEach(function (k) { api.alive(k).slice().forEach(function (m) { api.damage(m, k, 2); }); });
      },
      aiTurnStart: function (api) { api.log('BOSS 克里弗斯之果【蛮发】：全场怪物 -2', 'eff'); SKILLS.fruit.tick(api); },
      foeTurnStart: function (api) { SKILLS.fruit.tick(api); }
    },
    /* 8 鼠王：懒惰(本体无法攻击，见 noAttack) + 独尊(清除其它S级卡并回血15) + 宝藏(玩家额外抽1) */
    ratKing: {
      foeTurnStart: function (api) {
        var b = api.boss(); if (!b) return;
        var killed = 0;
        ['A', 'B'].forEach(function (k) {
          api.alive(k).slice().forEach(function (m) {
            if (m.uid === b.uid) return;
            if (m.tier === 'S') { api.destroy(m, k); killed++; }
          });
        });
        api.heal(b, 15);
        api.log('BOSS 鼠王【独尊】：清除全场其它 S 级卡 ' + killed + ' 张，本体恢复 15 点生命', 'eff');
        api.draw('A', 1);
        api.log('BOSS 鼠王【宝藏】：玩家额外抽一张牌', 'eff');
      }
    },
    /* 9 疯狂强盗：逃跑(本体回手=玩家失败) + 独行(AI手牌除A/S外立即丢弃) + 藏刀(玩家全场-2) */
    bandit: {
      bossLeave: function (api) {
        if (api.state.winner) return;
        api.state.winner = 'B';
        api.log('—— BOSS 疯狂强盗【逃跑】：本体返回手牌，玩家立即失败 ——', 'hl');
      },
      aiTurnStart: function (api) {
        var p = api.foe(), out = [];
        p.hand = p.hand.filter(function (c) {
          var cd = CARDS[c.cardId];
          if (cd && cd.type === 'monster' && cd.tier !== 'A' && cd.tier !== 'S') { out.push(cd.name); return false; }
          return true;
        });
        if (out.length) api.log('BOSS 疯狂强盗【独行】：丢弃 ' + out.join('、'), 'eff');
      },
      foeTurnStart: function (api) {
        api.log('BOSS 疯狂强盗【藏刀】：玩家全场怪物 -2', 'eff');
        api.alive('A').slice().forEach(function (m) { api.damage(m, 'A', 2); });
      }
    },
    /* 10 新生火元素：燃火(本体效果×3) + 惧燃(玩家弃牌堆有冰霜药水→效果波及玩家本体) */
    fireElem: {
      init: function (api) { api.state.fireElemMult = 3; },
      aiTurnStart: function (api) {
        var hasIce = api.player().discard.some(function (c) { return c.cardId === 'a-062-2'; });
        api.state.fireElemToPlayer = hasIce;
        if (hasIce) api.log('BOSS 新生火元素【惧燃】：玩家弃牌堆有【冰霜药水】→ 燃火波及玩家本体', 'eff');
      }
    },
    /* 11 咒缚灵：虚无(本体无法被主动攻击，见 untargetable) + 怒怨(弃玩家手牌) + 傀儡(衍生怨灵) */
    curse: {
      aiTurnStart: function (api) {
        api.discardRandom('A', 1);
        api.log('BOSS 咒缚灵【怒怨】：随机弃置玩家一张手牌', 'eff');
        var made = 0;   // 按文本：所有空位各衍生一只（不止一个空位）
        while (api.empty('B').length) { if (!api.token('B', 'a-076-2')) break; made++; }
        if (made) api.log('BOSS 咒缚灵【傀儡】：在所有空位衍生 ' + made + ' 只【怨灵】', 'eff');
      }
    },
    /* 12 天狗：火(依次点杀玩家第N只怪3点) + 雷(每回合衍生炸弹，最多3次) + 雷惩(标记一格，每回合开始3点) */
    tengu: {
      aiTurnStart: function (api) {
        var st = api.state.bossState;
        var ms = api.alive('A');
        if (ms.length) {
          var idx = (st.tenguFire || 0) % ms.length;
          st.tenguFire = (st.tenguFire || 0) + 1;
          api.log('BOSS 天狗【火】：对玩家第 ' + (idx + 1) + ' 只怪物造成 3 点伤害', 'eff');
          api.damage(ms[idx], 'A', 3);
        }
        if ((st.tenguBomb || 0) < 3) { st.tenguBomb = (st.tenguBomb || 0) + 1; api.derive('B', 'a-086-2'); api.log('BOSS 天狗【雷】：手牌衍生【炸弹】(第 ' + st.tenguBomb + '/3 次)', 'eff'); }
        if (st.tenguMark == null) { st.tenguMark = (api.rand() * 3) | 0; api.log('BOSS 天狗【雷惩】：标记玩家第 ' + (st.tenguMark + 1) + ' 格（此格怪物每回合开始受 3 点伤害）', 'eff'); }
        var mk = api.player().board[st.tenguMark];
        if (mk) { api.log('BOSS 天狗【雷惩】：标记格上的 ' + mk.name + ' 受到 3 点伤害', 'eff'); api.damage(mk, 'A', 3); }
      }
    },
    /* 12 重甲暴徒：意志(死亡→1血+45盾，仅一次) + 暴怒(持有护盾时每回合+5攻) + 重甲(每损失10血→+5盾) */
    brute: {
      armor: function (api) {
        var b = api.boss(); if (!b) return;
        var step = Math.floor(Math.max(0, b.maxHp - b.hp) / 10);   // 已损失的"10 点生命"段数
        var st = api.state.bossState;
        if (step > (st.armorStep || 0)) {
          var add = (step - (st.armorStep || 0)) * 5;
          st.armorStep = step;
          b.shield += add;
          api.log('BOSS 重甲暴徒【重甲】：每损失 10 点生命获得 5 点护盾 → +' + add + '（现 ' + b.shield + '）', 'eff');
        }
      },
      bossDying: function (api) {
        var b = api.boss(); if (!b) return;
        if (b.flags.willDone) return;                             // 仅触发一次
        b.flags.willDone = true;
        b.flags.dead = false; b.hp = 1; b.shield += 45;
        api.log('BOSS 重甲暴徒【意志】：生命回到 1 点并获得 45 点护盾（仅触发一次）', 'hl');
      },
      bossDamaged: function (api) { SKILLS.brute.armor(api); },
      aiTurnStart: function (api) {
        var b = api.boss(); if (!b) return;
        SKILLS.brute.armor(api);
        if (b.shield > 0) {
          b.growthAtk += 5; api.recalc(b);
          api.log('BOSS 重甲暴徒【暴怒】：本体持有护盾，力量 +5（现 ' + b.atk + '）', 'eff');
        }
      },
      foeTurnStart: function (api) { SKILLS.brute.armor(api); }
    },
    /* 14 紫狼萨满：萨满王(本体自身卡牌效果提升 500% = ×6) + 呼唤(每回合随机空位衍生 1 张豺狼系) + 献祭(回合结束吞一只非本体怪回血) */
    wolfShaman: {
      init: function (api) {
        var b = api.boss();
        if (b) b.flags.effectMul = 6;                             // 【萨满王】：放大本体这张卡的效果（攻击-1/减伤-1 → ×6），不影响【呼唤】【献祭】
      },
      aiTurnStart: function (api) {
        var wolves = ['a-004-2', 'a-103-2', 'a-106-2', 'a-109-2', 'a-108-2', 'a-105-2', 'a-010-2'];
        var emp = api.empty('B'); if (!emp.length) return;
        var slot = emp[(api.rand() * emp.length) | 0];
        var m = api.tokenAt('B', wolves[(api.rand() * wolves.length) | 0], slot);
        if (m) api.log('BOSS 紫狼萨满【呼唤】：随机空位衍生 ' + m.name, 'eff');
      },
      turnEnd: function (api, key) {
        if (key !== 'B') return;
        var b = api.boss(); if (!b) return;
        var others = api.alive('B').filter(function (m) { return m.uid !== b.uid; });
        if (!others.length) return;
        var v = others[(api.rand() * others.length) | 0];
        var back = Math.round(v.hp * 0.5);                        // 以"被献祭怪物的剩余生命"为基数（非本体自身生命）
        api.log('BOSS 紫狼萨满【献祭】：献祭 ' + v.name + '（其剩余 ' + v.hp + ' 生命 ×50%）→ 本体回复 ' + back + ' 点生命', 'eff');
        api.destroy(v, 'B', { sacrifice: true });
        api.heal(b, back);
      }
    },
    /* 14 DM-201：酸蚀(本局酸气伤害翻倍) + 喷射(本体攻击次数永久0，玩家每回合+3毒气) + 故障(10%清空酸气，本体下回合获得等量攻击次数) */
    dm201: {
      init: function (api) {
        api.state.acidMul = 2;                                    // 【酸蚀】本局【酸气】伤害翻倍
        var b = api.boss(); if (b) b.flags.attacksMax = 0;
      },
      aiTurnStart: function (api) {
        var b = api.boss(); if (!b) return;
        var st = api.state.bossState;
        b.flags.attacksMax = 0;                                   // 【喷射】本体攻击次数永久为 0
        if (st.faultAtk) {
          b.flags.attacksMax = st.faultAtk;                       // 【故障】下回合获得酸气层数的攻击次数
          api.log('BOSS DM-201【故障】：本体本回合获得 ' + st.faultAtk + ' 次攻击', 'hl');
          st.faultAtk = 0;
        }
      },
      foeTurnStart: function (api) {
        var p = api.player();
        p.poison += 3;
        api.log('BOSS DM-201【喷射】：玩家叠加 3 层【毒气】', 'eff');
        if (p.acid > 0 && api.rand() < 0.1) {                     // 【故障】10% 概率
          var n = p.acid; p.acid = 0;
          api.state.bossState.faultAtk = n;
          api.log('BOSS DM-201【故障】：酸气层数被清空（' + n + ' 层），本体下回合获得 ' + n + ' 次攻击', 'hl');
        }
      }
    },
    /* 15 DM-300：磁塔(生命降到60/40/20以下→两侧换成能源塔+10盾) + 保护(有能源塔→本体无法选中、本体技能伤害永久+1) + 气舱(每回合触发一次召唤上场效果) */
    dm300: {
      init: function (api) { api.state.bossState.magnetStep = 0; },
      magnet: function (api) {
        var b = api.boss(); if (!b) return false;
        var st = api.state.bossState, TH = [60, 40, 20];
        while (st.magnetStep < TH.length && b.hp <= TH[st.magnetStep]) {
          var thr = TH[st.magnetStep]; st.magnetStep++;
          var idx = api.slotOf('B', b.uid);
          [idx - 1, idx + 1].forEach(function (s) {
            if (s < 0 || s > 2) return;
            var old = null;
            api.alive('B').forEach(function (m) { if (api.slotOf('B', m.uid) === s) old = m; });
            if (old) api.destroy(old, 'B', { sacrifice: true });   // 两侧有怪 → 替换掉
            var t = api.tokenAt('B', 'a-104-2', s);                // 空位 → 衍生【能源塔】
            if (t) {
              t.shield += 10;
              api.log('BOSS DM-300【磁塔】：' + (old ? old.name + ' → ' : '') + '【能源塔】出现在 ' + (s + 1) + ' 位并立即获得 10 点护盾', 'eff');
            }
          });
          api.log('BOSS DM-300【磁塔】：本体生命降到 ' + thr + ' 以下，触发第 ' + st.magnetStep + ' 次', 'hl');
        }
        var tower = api.alive('B').some(function (m) { return m.cardId === 'a-104-2'; });
        if (!!tower !== !!b.flags.untargetable) {
          b.flags.untargetable = tower; b.flags.untargetableInnate = tower;
          // 用词与卡面/引擎注释统一："无法被攻击"（而不是"无法被选中"——卡牌其实选得到它）
          api.log(tower ? 'BOSS DM-300【保护】：能源塔在场 → 本体无法被攻击' : 'BOSS DM-300【保护】：能源塔已离场 → 本体可被攻击', 'eff');
        }
        return tower;
      },
      bossDamaged: function (api) { SKILLS.dm300.magnet(api); },
      bossAllyLeft: function (api) { SKILLS.dm300.magnet(api); },   // 能源塔被打掉 → 立即刷新【保护】
      aiTurnStart: function (api) {
        var b = api.boss(); if (!b) return;
        if (SKILLS.dm300.magnet(api)) {
          var cur = api.state.protectBonus || 0;
          if (cur < 5) {   // 上限 +5（见关卡介绍）
            api.state.protectBonus = cur + 1;
            api.log('BOSS DM-300【保护】：能源塔在场 → 本体「对非攻击目标造成 6 点伤害」永久 +1（现 +' + (cur + 1) + '，上限 +5）', 'eff');
          }
        }
        api.summonEffect(b);                                      // 【气舱】触发一次"从手牌召唤上场"效果
        api.log('BOSS DM-300【气舱】：触发本体召唤上场效果', 'eff');
      },
      foeTurnStart: function (api) { SKILLS.dm300.magnet(api); }
    }
  };

  /* ---------------- 关卡表（16 关全部已设计） ---------------- */
  var STAGES = [
    {
      id: 'crab', no: 1, name: '巨钳蟹', threat: '低等威胁', cardId: 'a-008-2', hp: 100,
      roundCap: 60, deck: [],
      skills: [['格挡', '战斗阶段仅受到一次伤害（本体固有）'], ['迟缓', '本体卡组被清空'], ['成长', '本体回合开始时，力量 +1']]
    },
    {
      id: 'jackal', no: 2, name: '豺狼猎手', threat: '低等威胁', cardId: 'a-010-2', hp: 70,
      roundCap: 60, deck: rep('a-015-2', 20),
      skills: [['暗镖', '本体回合开始时，在手牌衍生 2 张【苦无】'], ['藏刀', '本体卡组全部替换为【飞刀】'], ['计巧', '本体回合结束时，获得 1 点护盾']]
    },
    {
      id: 'rat', no: 3, name: '腐臭老鼠', threat: '中等威胁', cardId: 'a-009-2', hp: 75,
      roundCap: 60, deck: deck(rep('a-002-2', 8), rep('a-044-2', 4), rep('a-001-2', 2), rep('a-013-2', 3), rep('a-019-2', 2), rep('a-015-2', 2)),
      skills: [['毒瘤', '本体回合开始时，玩家失去 4 点生命（本体 3 点 + 固有【腐臭】1 点）'], ['麻痹', '玩家回合开始时，玩家场上随机一张怪物失去一次攻击次数']]
    },
    {
      id: 'gum', no: 4, name: '黏咕', threat: '高等威胁', cardId: 'a-012-2', hp: 80,
      roundCap: 60, deck: deck(rep('a-049-2', 4), rep('a-057-2', 4), rep('a-056-2', 4), rep('a-054-2', 2), rep('a-019-2', 2), rep('a-059-2', 2), rep(BOX, 3)),
      skills: [['水性', '本体回合开始时，黏咕恢复 5 点生命'], ['蓄力', '本体回合开始时，50% 概率失去一次攻击次数并获得一层蓄力'], ['蓄爆', '本体回合开始时，40% 概率对玩家场上所有怪物造成 5×蓄力层数 的伤害，并清空蓄力']]
    },
    {
      id: 'elf', no: 5, name: '绿野精灵', threat: '中等威胁', cardId: 'a-053-2', hp: 70,
      roundCap: 60, deck: deck(rep('a-047-2', 4), rep('a-050-2', 3), rep('a-045-2', 3), rep('a-049-2', 3), rep('a-048-2', 2), rep('a-020-2', 2), rep(BOX, 3)),
      skills: [['成长', '本体回合开始时，绿野精灵力量 +1'], ['腾跃', '玩家回合开始时，抽一张牌']]
    },
    {
      id: 'rotHeart', no: 6, name: '腐烂之心', threat: '中等威胁', cardId: 'a-081-2', hp: 70,
      // 卡组改为纯道具（毒气/陷阱/投掷/药水）：本体不再靠自带怪物，全靠【藤网】衍生触手
      roundCap: 60, deck: deck(rep('a-115-2', 3), rep('a-089-2', 3), rep('a-117-2', 2), rep('a-022-2', 2), rep('a-016-2', 2), rep('a-061-2', 2), rep('a-019-2', 2), rep('a-020-2', 2), rep(BOX, 3)),
      skills: [['藤网', '本体回合开始时，在所有空位各衍生一只【腐烂触手】'], ['毒瘤', '玩家回合开始时，玩家【毒气】层数锁定为 999'], ['果实', '玩家回合开始时，场上所有腐烂触手力量 +1，并触发本体【腐烂之心】的卡牌效果']]
    },
    {
      id: 'fruit', no: 7, name: '克里弗斯之果', threat: '高等威胁', cardId: 'a-055-2', hp: 88,
      roundCap: 60, deck: deck(rep('a-054-2', 4), rep('a-080-2', 3), rep('a-048-2', 3), rep('a-115-2', 2), rep('a-019-2', 2), rep(BOX, 3), rep('a-015-2', 3)),
      skills: [['藤蔓', '【魔化藤】在场时，本关 BOSS 无法被攻击'], ['毒瘤', '本体生命低于 80 时，玩家受到的【毒气】伤害固定为 5'], ['蛮发', '每回合开始时，场上所有怪物失去 2 点生命']]
    },
    {
      id: 'ratKing', no: 8, name: '鼠王', threat: '高等威胁', cardId: 'a-058-2', hp: 84,
      roundCap: 60, deck: deck(rep('a-002-2', 8), rep('a-001-2', 4), rep(BOX, 4), rep('a-014-2', 2), rep('a-015-2', 2)),
      noAttack: true,
      skills: [['懒惰', '本体鼠王无法攻击'], ['独尊', '玩家回合开始时，场上除本体外所有 S 级卡移入弃牌堆，本体恢复 15 点生命'], ['宝藏', '玩家回合开始时，额外抽一张牌']]
    },
    {
      id: 'bandit', no: 9, name: '疯狂强盗', threat: '低等威胁', cardId: 'a-074-2', hp: 60,
      // slot:0 = 开局在最左侧（本体"攻击后向右移动一位，无法移动则返回手牌"→ 从中位只需 2 次攻击就回手判负，
      // 放最左给它 3 次攻击的余量；玩家也可用【虚无锁链】等位移卡把它移回左侧续命，故【逃跑】条件不变）
      roundCap: 60, slot: 0,
      // 卡组改为纯道具（投掷物 / 陷阱 / 药水 / 戒指），不含任何怪物卡
      deck: deck(rep('a-061-2', 3), rep('a-016-2', 2), rep('a-086-2', 2), rep('a-114-2', 2), rep('a-117-2', 3), rep('a-089-2', 2), rep('a-022-2', 2), rep('a-062-2', 1), rep('a-115-2', 1), rep('a-023-2', 1), rep('a-090-2', 1), rep(BOX, 2)),
      skills: [['逃跑', '本体返回手牌后，玩家立即失败'], ['独行', 'AI 手牌中存在 A 级以下的怪物卡时，立即丢弃'], ['藏刀', '玩家每回合开始时，其场上所有怪物失去 2 点生命']]
    },
    {
      id: 'fireElem', no: 10, name: '新生火元素', threat: '低等威胁', cardId: 'a-082-2', hp: 80,
      roundCap: 60, deck: deck(rep('a-104-2', 3), rep('a-047-2', 3), rep('a-020-2', 3), rep('a-015-2', 3), rep('a-086-2', 2), rep('a-025-2', 2), rep(BOX, 3)),
      skills: [['燃火', '本关新生火元素的卡牌效果提升至 300%'], ['惧燃', '玩家弃牌堆中存在【冰霜药水】时，燃火的效果将波及玩家本体']]
    },
    {
      id: 'curse', no: 11, name: '咒缚灵', threat: '中等威胁', cardId: 'a-077-2', hp: 70,
      roundCap: 60, untargetable: true,
      deck: deck(rep('a-076-2', 6), rep('a-078-2', 3), rep('a-079-2', 3), rep('a-071-2', 3), rep('a-085-2', 3), rep(BOX, 3)),
      skills: [['虚无', '本体咒缚灵无法被主动攻击（需用投掷物/法杖等非攻击手段击破）'], ['怒怨', '本体回合开始时，随机弃置玩家一张手牌'], ['傀儡', '本体回合开始时，在所有空位各衍生一只【怨灵】']]
    },
    {
      id: 'tengu', no: 12, name: '天狗', threat: '高等威胁', cardId: 'a-083-2', hp: 60,
      roundCap: 60, deck: deck(rep('a-016-2', 4), rep('a-061-2', 3), rep('a-086-2', 3), rep('a-114-2', 2), rep('a-090-2', 2), rep('a-025-2', 2), rep(BOX, 3)),
      skills: [['火', '本体回合开始时，按回合依次对玩家场上的怪物造成 3 点伤害（首回合从最左侧开始）'], ['雷', '本体回合开始时，在手牌衍生一张【炸弹】，最多触发 3 次'], ['雷惩', '随机标记玩家一个怪物栏位，此位置的怪物每回合开始时受到 3 点伤害']]
    },
    {
      id: 'brute', no: 13, name: '重甲暴徒', threat: '低等威胁', cardId: 'a-108-2', hp: 40,
      roundCap: 60, deck: deck(rep('a-105-2', 3), rep('a-103-2', 3), rep('a-004-2', 2), rep('a-108-2', 2), rep('a-016-2', 3), rep(BOX, 3)),
      skills: [['意志', '本体死亡时，恢复至 1 点生命并获得 45 点护盾，仅触发一次'], ['暴怒', '本体拥有护盾时，本体每回合开始时增加 5 点攻击力'], ['重甲', '每损失 10 点生命，获得 5 点护盾']]
    },
    {
      id: 'wolfShaman', no: 14, name: '紫狼萨满', threat: '中等威胁', cardId: 'a-109-2', hp: 60,
      roundCap: 60, deck: deck(rep('a-004-2', 2), rep('a-103-2', 3), rep('a-106-2', 3), rep('a-105-2', 3), rep('a-108-2', 2), rep('a-010-2', 2), rep('a-016-2', 2), rep(BOX, 3)),
      skills: [['萨满王', '本体的技能效果提升 500%'], ['呼唤', '本体每回合开始时，在己方随机空位衍生一张豺狼系怪物卡（豺狼巡查 / 赤狼萨满 / 青狼萨满 / 紫狼萨满 / 重甲暴徒 / 豺狼暴徒 / 豺狼猎手）'], ['献祭', '本体回合结束时，将己方的随机一张非本体怪物卡移入弃牌堆，本体恢复其 50% 的剩余生命']]
    },
    {
      id: 'dm201', no: 15, name: 'DM-201', threat: '中等威胁', cardId: 'a-110-2', hp: 75,
      roundCap: 60, deck: deck(rep('a-107-2', 3), rep('a-104-2', 3), rep('a-089-2', 3), rep('a-115-2', 2), rep('a-110-2', 2), rep('a-015-2', 3), rep(BOX, 3)),
      skills: [['酸蚀', '本局游戏中，【酸气】造成的伤害翻倍'], ['喷射', '本体攻击次数永久为 0，玩家每回合开始时叠加 3 层【毒气】'], ['故障', '玩家每回合开始时，有 10% 的概率清空酸气层数，但本体将在下回合获得酸气层数的攻击次数']]
    },
    {
      id: 'dm300', no: 16, name: 'DM-300', threat: '高等威胁', cardId: 'a-111-2', hp: 80,
      roundCap: 60, deck: deck(rep('a-089-2', 5), rep('a-104-2', 3), rep('a-107-2', 3), rep('a-110-2', 2), rep('a-115-2', 2), rep('a-111-2', 2), rep(BOX, 3)),
      skills: [['磁塔', '每当本体生命值降落到 60/40/20 以下时触发一次：将本体两侧的怪物卡替换（没有则衍生）成【能源塔】，并使其立即获得 10 点护盾'], ['保护', '场上存在【能源塔】时，本体处于无法选中的状态，并且每回合开始时，本体「对非攻击目标造成 6 点伤害」的效果永久 +1（上限 +5）'], ['气舱', '本体每回合开始时，触发一次其从手牌召唤上场的效果']]
    }
  ];
  // 绑定称号 + 技能钩子
  STAGES.forEach(function (s, i) {
    s.title = TITLES[i];
    s.hooks = s.reserve ? null : (SKILLS[s.id] || null);
    if (s.reserve) s.deck = [];
  });

  function stage(no) { return STAGES[no - 1] || null; }
  function count() { return STAGES.length; }
  function playable() { var n = 0; STAGES.forEach(function (s) { if (!s.reserve) n++; }); return n; }

  return {
    TITLES: TITLES, STAGES: STAGES,
    stage: stage, count: count, playable: playable
  };
})();
