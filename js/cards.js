/* ============================================================
 * 《地牢决斗师-踏上征途》卡牌数据库  cards.js
 * 数据来源：策划案第九章「全卡牌数据表」（100 张，逐张转录）
 * 图片命名规则：缩略卡/《stem》.png ｜ 高清卡/《stem》详情.png
 *   注意：个别卡的文件名与卡名不一致（见 thumb/detail 覆盖字段）
 * 字段说明：
 *   id/name/type/tier/hp/atk/effect  卡面基础信息
 *   stem     图片文件名主干
 *   thumb/detail 图片路径覆盖（命名不一致时使用）
 *   maxCopies 卡组同名单卡上限
 *   upgradable 可被升级卷轴升级（武器/防具/法杖）
 *   equip    装备要求 {stat:'atk'|'hp', min:number}
 *   mods     装备/道具的结构化数值（供引擎直接使用）
 *   tags     怪物标签 💰/🍖/🫒/💎
 * ========================================================== */
var CARD_LIST = [
  /* ---------------- C 级怪 ×22（含新卡 4） ---------------- */
  {id:'a-005-2', name:'大蜗牛', type:'monster', tier:'C', hp:6, atk:2, stem:'大蜗牛C', effect:'准备阶段开始时，该卡恢复6生命；该卡于战斗阶段中受到伤害-2。'},
  {id:'a-031-2', name:'战士', type:'monster', tier:'C', hp:8, atk:4, stem:'战士C', effect:'该卡从手牌召唤时，在手牌衍生一张【破损纹章】。'},
  {id:'a-034-2', name:'法师', type:'monster', tier:'C', hp:8, atk:4, stem:'法师C', effect:'该卡从手牌召唤时，在手牌衍生一张【老法杖】。'},
  {id:'a-037-2', name:'盗贼', type:'monster', tier:'C', hp:8, atk:4, stem:'盗贼C', effect:'该卡从手牌召唤时，在手牌衍生一张【暗影斗篷】。'},
  {id:'a-040-2', name:'女猎', type:'monster', tier:'C', hp:8, atk:4, stem:'女猎C', effect:'该卡从手牌召唤时，在手牌衍生一张【灵能弓】。'},
  {id:'a-002-2', name:'啮齿小鼠', type:'monster', tier:'C', hp:8, atk:3, stem:'啮齿小鼠C', detail:'卡牌/高清卡/啮齿小鼠详情.png', effect:'该卡从手牌召唤时，抽一张牌。', tags:['🍖']},
  {id:'a-003-2', name:'水道巨蛇', type:'monster', tier:'C', hp:5, atk:3, stem:'水道巨蛇C', effect:'该卡于战斗阶段中受到攻击时，50%概率触发【闪避】使伤害降为0。', tags:['🍖']},
  {id:'a-045-2', name:'食人鱼', type:'monster', tier:'C', hp:6, atk:4, stem:'食人鱼C', effect:'免疫【毒气】【酸气】；召唤于中位的回合无法被攻击。', tags:['🍖']},
  {id:'a-047-2', name:'金色蜜蜂', type:'monster', tier:'C', hp:8, atk:3, stem:'金色蜜蜂C', effect:'我方玩家生命＜30时，我方金色蜜蜂攻击+4。', tags:['🫒']},
  {id:'a-048-2', name:'喷毒花', type:'monster', tier:'C', hp:8, atk:3, stem:'喷毒花C', effect:'对位存在怪物且我方场上仅有此卡时，攻击+5；回合结束返回手牌。', tags:['🫒']},
  {id:'a-049-2', name:'繁花史莱姆', type:'monster', tier:'C', hp:8, atk:4, stem:'繁花史莱姆C', effect:'进入弃牌堆时，将卡组中随机一张“🫒”类怪物加入手牌。', tags:['🫒']},
  {id:'a-050-2', name:'蚱蜢', type:'monster', tier:'C', hp:8, atk:3, stem:'蚱蜢C', effect:'对方场上存在怪物时，攻击后对方玩家生命-3，并进入弃牌堆。', tags:['🫒']},
  {id:'a-056-2', name:'黄昏史莱姆', type:'monster', tier:'C', hp:6, atk:3, stem:'黄昏史莱姆C', effect:'从手牌进入弃牌堆时，对方玩家选择弃置一张手牌。', tags:['💰']},
  {id:'a-057-2', name:'血红史莱姆', type:'monster', tier:'C', hp:6, atk:3, stem:'血红史莱姆C', effect:'进入弃牌堆时，对方随机怪物生命-3。', tags:['💰']},
  {id:'a-075-2', name:'DM-100', type:'monster', tier:'C', hp:8, atk:2, stem:'DM100C', effect:'回合结束时，对一个非对位的随机敌方怪物卡造成5点伤害。', tags:['💎']},
  {id:'a-076-2', name:'怨灵', type:'monster', tier:'C', hp:1, atk:1, stem:'怨灵C', effect:'战斗阶段中无法被攻击。'},
  {id:'a-080-2', name:'腐烂触手', type:'monster', tier:'C', hp:8, atk:3, stem:'腐烂触手C', effect:'从场上进入弃牌堆时，对方叠加一层【毒气】并获得一层腐烂标记。', tags:['🫒']},
  {id:'a-073-2', name:'疯狂小偷', type:'monster', tier:'C', hp:8, atk:2, stem:'疯狂小偷C', effect:'对玩家攻击时，获得其一张手牌；回合结束返回手牌。', tags:['💰']},
  {id:'a-101-2', name:'吸血蝙蝠', type:'monster', tier:'C', hp:8, atk:3, stem:'吸血蝙蝠C', effect:'主动攻击后，自身与相邻的友方怪物恢复造成伤害的等量生命。', tags:['🍖']},
  {id:'a-102-2', name:'矿洞蜘蛛', type:'monster', tier:'C', hp:8, atk:1, stem:'矿洞蜘蛛C', effect:'主动攻击后，对方每有一层【毒气】，其场上怪物受到1点伤害。', tags:['🫒']},
  {id:'a-103-2', name:'赤狼萨满', type:'monster', tier:'C', hp:7, atk:2, stem:'赤狼萨满C', effect:'主动攻击后，使目标攻击-1。', tags:['💰']},
  {id:'a-104-2', name:'能源塔', type:'monster', tier:'C', hp:8, atk:0, stem:'能源塔C', effect:'准备阶段开始时，对对位怪物造成5点伤害，并使己方【💎】类怪物获得3点护盾。', tags:['💎']},

  /* ---------------- B 级怪 ×21（含新卡 3） ---------------- */
  {id:'a-004-2', name:'豺狼巡查', type:'monster', tier:'B', hp:10, atk:6, stem:'豺狼巡查B', effect:'该卡从手牌召唤时，弃置一张手牌，检索一张“💰”类怪物。', tags:['💰']},
  {id:'a-006-2', name:'丛林螃蟹', type:'monster', tier:'B', hp:10, atk:4, stem:'密林螃蟹B', effect:'该卡于战斗阶段中攻击后有50%概率触发【再攻击】，每回合触发一次。', tags:['🍖']},
  {id:'a-007-2', name:'苍蝇群', type:'monster', tier:'B', hp:10, atk:2, stem:'苍蝇群B', effect:'该卡生命＜6时，在我方空位衍生一张1血1攻的苍蝇群。', tags:['💰']},
  {id:'a-043-2', name:'活化石像', type:'monster', tier:'B', hp:10, atk:6, stem:'活化石像B', effect:'从手牌召唤时，检索一张武器。'},
  {id:'a-044-2', name:'白化小鼠', type:'monster', tier:'B', hp:10, atk:5, stem:'白化小鼠B', effect:'战斗阶段中攻击后，攻击的目标生命-2。', tags:['🍖']},
  {id:'a-046-2', name:'血色哨卫', type:'monster', tier:'B', hp:10, atk:0, stem:'血色哨卫B', effect:'准备阶段开始时，对随机敌方怪物卡造成8点伤害。', tags:['💰']},
  {id:'a-001-2', name:'宝箱怪', type:'monster', tier:'B', hp:10, atk:6, stem:'宝箱怪B', effect:'进入弃牌堆时，抽一张牌。', tags:['💰']},
  {id:'a-071-2', name:'骷髅', type:'monster', tier:'B', hp:10, atk:4, stem:'骷髅B', effect:'从场上进入弃牌堆时，对位怪物受到4伤害。', tags:['💰']},
  {id:'a-032-2', name:'战士', type:'monster', tier:'B', hp:10, atk:7, stem:'战士B', effect:'该卡于战斗阶段中受到伤害-1。'},
  {id:'a-035-2', name:'法师', type:'monster', tier:'B', hp:10, atk:4, stem:'法师B', effect:'该卡在我方场上时，每回合施法次数+1。'},
  {id:'a-038-2', name:'盗贼', type:'monster', tier:'B', hp:10, atk:5, stem:'盗贼B', effect:'若该卡无法被攻击，则该卡下一次攻击造成的伤害+3。'},
  {id:'a-041-2', name:'女猎', type:'monster', tier:'B', hp:10, atk:6, stem:'女猎B', effect:'该卡在场，且手牌存在【投掷物】，则抽一张牌，每回合触发一次。'},
  {id:'a-072-2', name:'监狱守卫', type:'monster', tier:'B', hp:10, atk:4, stem:'监狱守卫B', effect:'从手牌召唤上场时，将对方场上随机一张怪物卡移动至自己的对位，并立刻攻击其一次。'},
  {id:'a-078-2', name:'招魂法师', type:'monster', tier:'B', hp:10, atk:0, stem:'招魂法师B', effect:'准备阶段开始时，在己方空位衍生一张【怨灵】。'},
  {id:'a-079-2', name:'死灵法师', type:'monster', tier:'B', hp:10, atk:0, stem:'死灵法师B', effect:'准备阶段开始时，若己方场上没有【骷髅】，则在随机空位衍生一张；否则己方【骷髅】攻击+1。'},
  {id:'a-051-2', name:'深蓝蝾螈', type:'monster', tier:'B', hp:10, atk:5, stem:'深蓝蝾螈B', effect:'回合结束时在场上则返回手牌，这张卡攻击+1。', tags:['🫒']},
  {id:'a-052-2', name:'纯晶元素', type:'monster', tier:'B', hp:10, atk:0, stem:'纯晶元素B', effect:'战斗阶段攻击时，对方玩家随机一张手牌中的怪物返回卡组。', tags:['🫒']},
  {id:'a-054-2', name:'魔化藤', type:'monster', tier:'B', hp:10, atk:3, stem:'魔化藤B', effect:'准备阶段开始时，对方叠加一层【毒气】。', tags:['🫒']},
  {id:'a-105-2', name:'豺狼暴徒', type:'monster', tier:'B', hp:10, atk:4, stem:'豺狼暴徒B', effect:'这张卡生命＜4时，获得4点护盾并且攻击+3。', tags:['💰']},
  {id:'a-106-2', name:'青狼萨满', type:'monster', tier:'B', hp:10, atk:2, stem:'青狼萨满B', effect:'主动攻击后，若目标减伤＞1，其减伤-1。', tags:['💰']},
  {id:'a-107-2', name:'DM-200', type:'monster', tier:'B', hp:10, atk:3, stem:'DM-200B', effect:'从手牌召唤上场时，对方叠加2层【毒气】，并令其场上所有怪物受到1点伤害。', tags:['💎']},

  /* ---------------- A 级怪 ×11（含新卡 3） ---------------- */
  {id:'a-008-2', name:'巨钳蟹', type:'monster', tier:'A', hp:11, atk:5, stem:'巨钳蟹A', effect:'该卡于战斗阶段中仅受到一次伤害。'},
  {id:'a-009-2', name:'腐臭老鼠', type:'monster', tier:'A', hp:16, atk:6, stem:'腐臭老鼠A', effect:'准备阶段开始时，若该卡在场，则对方玩家生命-2。', tags:['🍖']},
  {id:'a-010-2', name:'豺狼猎手', type:'monster', tier:'A', hp:14, atk:6, stem:'豺狼猎手A', effect:'该卡从手牌召唤时，检索两张投掷物。', tags:['💰']},
  {id:'a-074-2', name:'疯狂强盗', type:'monster', tier:'A', hp:14, atk:5, stem:'疯狂强盗A', effect:'对怪物/玩家攻击时，获得其一张装备/手牌；攻击后向右移动一位，无法移动时返回手牌。', tags:['💰']},
  {id:'a-081-2', name:'腐烂之心', type:'monster', tier:'A', hp:14, atk:6, stem:'腐烂之心A', effect:'从手牌召唤上场时，当前每有两层腐烂标记，对手受到【毒气】伤害+1，然后清空腐烂标记。', tags:['🫒']},
  {id:'a-082-2', name:'新生火元素', type:'monster', tier:'A', hp:14, atk:6, stem:'新生火元素A', effect:'准备阶段开始时，对方场上每有一只怪物，对方场上所有怪物生命-1。', tags:['🫒']},
  {id:'a-053-2', name:'绿野精灵', type:'monster', tier:'A', hp:16, atk:8, stem:'绿野精灵A', effect:'纯粹的强大。', tags:['🫒']},
  {id:'a-077-2', name:'咒缚灵', type:'monster', tier:'A', hp:1, atk:4, stem:'咒缚灵A', effect:'进入弃牌堆时，检索一张武器；由【怨灵】进化时，继承其技能。'},
  {id:'a-108-2', name:'重甲暴徒', type:'monster', tier:'A', hp:14, atk:4, stem:'重甲暴徒A', effect:'这张卡生命＜6时，获得4点护盾，并且攻击+5。', tags:['💰']},
  {id:'a-109-2', name:'紫狼萨满', type:'monster', tier:'A', hp:14, atk:2, stem:'紫狼萨满A', effect:'主动攻击后，使目标攻击-1；若其减伤＞1，则其减伤-1。', tags:['💰']},
  {id:'a-110-2', name:'DM-201', type:'monster', tier:'A', hp:14, atk:3, stem:'DM-201A', effect:'主动攻击后，对方叠加3层【酸气】。', tags:['💎']},

  /* ---------------- S 级怪 ×6（含新卡 1） ---------------- */
  {id:'a-058-2', name:'鼠王', type:'monster', tier:'S', hp:18, atk:5, stem:'鼠王S', effect:'准备阶段开始时，在手牌衍生一张神秘宝箱与一张名字含“鼠”的怪物。', tags:['💰']},
  {id:'a-011-2', name:'水道螃蟹EX', type:'monster', tier:'S', hp:20, atk:5, stem:'水道螃蟹S', effect:'该卡于战斗阶段中攻击后有50%概率触发【再攻击】。'},
  {id:'a-012-2', name:'黏咕', type:'monster', tier:'S', hp:20, atk:6, stem:'黏咕S', effect:'该卡生命≤10时，对敌方场上所有怪物卡造成10点伤害。', tags:['💰']},
  {id:'a-083-2', name:'天狗', type:'monster', tier:'S', hp:15, atk:4, stem:'天狗S', effect:'回合结束时或受到伤害时，移动至我方随机空位，并在手牌衍生1张【苦无】；移动时攻击+1、生命+1。', tags:['💰']},
  {id:'a-055-2', name:'克里弗斯之果', type:'monster', tier:'S', hp:20, atk:6, stem:'克里弗斯之果S', effect:'受到主动攻击时，对方叠加两层【毒气】；我方场上每有一张“🫒”类怪物，额外加一层。', tags:['🫒']},
  {id:'a-111-2', name:'DM-300', type:'monster', tier:'S', hp:20, atk:6, stem:'DM-300S', effect:'从手牌召唤上场时，令对手的【毒气】与【酸气】层数翻倍；主动攻击时，令非目标的敌方怪物卡受到6点伤害。', tags:['💎']},

  /* ---------------- 典藏系列 ×6 ---------------- */
  {id:'a-95-2', name:'蕾零安洁', type:'monster', tier:'A', hp:14, atk:7, stem:'蕾零安洁A典藏', effect:'战斗阶段中，击杀敌方怪物后进行【再攻击】。'},
  {id:'a-96-2', name:'茉莉伊洛', type:'monster', tier:'A', hp:14, atk:4, stem:'茉莉伊洛A典藏', effect:'准备阶段中，每使用一次法杖，获得2点护盾。'},
  {id:'a-97-2', name:'极影铃虹', type:'monster', tier:'A', hp:14, atk:5, stem:'极影铃虹A典藏', effect:'准备阶段使用卷轴卡后，持续一回合无法被攻击（仅能发动3次）。'},
  {id:'a-98-2', name:'姬莲梅錵', type:'monster', tier:'A', hp:14, atk:6, stem:'姬莲梅錵A典藏', effect:'每使用一张投掷物卡，这张卡恢复5点生命。'},
  {id:'a-99-2', name:'碧灰双刃', type:'weapon', stem:'碧灰双刃典藏', effect:'准备阶段为一只怪物装备，攻击后30%概率对目标造成4点额外伤害。', upgradable:true, equip:{stat:'atk', min:0}, mods:{atkBonus:0, procChance:0.3, procDmg:4, upgrade:[{procChance:0.5},{procChance:1.0}]}},
  {id:'a-100-2', name:'澪', type:'monster', tier:'S', hp:20, atk:0, stem:'澪S典藏', thumb:'卡牌/缩略卡/lingSdaincang.png', effect:'攻击后对目标造成7点伤害；这张卡首次从场上进入弃牌堆后复活，并从弃牌堆检索任意一张怪物卡/药水卡。'},

  /* ---------------- 宝藏 ×4 ---------------- */
  {id:'a-013-2', name:'神秘宝箱', type:'treasure', stem:'神秘宝箱', effect:'准备阶段时使用该卡，抽两张牌。', mods:{draw:2}},
  {id:'a-014-2', name:'黄金宝箱', type:'treasure', stem:'黄金宝箱', effect:'准备阶段时使用该卡，弃置一张手牌，抽三张牌。', mods:{draw:3, discard:1}},
  {id:'a-060-2', name:'补给箱', type:'treasure', stem:'补给箱', effect:'准备阶段时使用，将卡组中随机一张食物/药水/卷轴卡加入手牌。'},
  {id:'a-085-2', name:'遗骸', type:'treasure', stem:'遗骸', effect:'准备阶段时使用，抽一张牌，并50%概率在手牌衍生一张【怨灵】。'},
  {id:'a-033-2', name:'破损纹章', type:'treasure', stem:'破损纹章', effect:'准备阶段时对一张防具卡使用，其减伤能力+1（同一防具最多 1 张）；若其等级＞0，进入弃牌堆时在手牌衍生【升级卷轴】。'},
  {id:'a-113-2', name:'水晶宝箱', type:'treasure', stem:'水晶宝箱', effect:'准备阶段时使用，将卡组中随机一张法杖/戒指卡加入手牌。'},

  /* ---------------- 投掷物 ×5 ---------------- */
  {id:'a-015-2', name:'飞刀', type:'throw', stem:'飞刀', effect:'准备阶段时对一张敌方怪物卡使用，造成3点伤害；若目标未受伤害则伤害翻倍。', mods:{dmg:3}},
  {id:'a-016-2', name:'苦无', type:'throw', stem:'苦无', effect:'准备阶段时对一张敌方怪物卡使用，对其造成3点伤害。', mods:{dmg:3}},
  {id:'a-061-2', name:'飞斧', type:'throw', stem:'飞斧', effect:'准备阶段时对一张已受伤的敌方怪物使用，对其造成5点伤害。', mods:{dmg:5}},
  {id:'a-086-2', name:'炸弹', type:'throw', stem:'炸弹', effect:'准备阶段时对一张敌方怪物卡使用，你的下一个准备阶段开始时，对其原位置及其十字方向造成6点伤害。'},
  {id:'a-114-2', name:'回旋镖', type:'throw', stem:'回旋镖', effect:'准备阶段时对一张敌方怪物卡使用，对其造成1点伤害；你的下一个回合开始时，这张卡返回手牌。', mods:{dmg:1, returnToHand:true}},

  /* ---------------- 食物 ×5 ---------------- */
  {id:'a-017-2', name:'口粮', type:'food', stem:'口粮', effect:'准备阶段时使用，选择己方一只怪物，恢复4点生命并获得2点护盾。'},
  {id:'a-018-2', name:'露珠', type:'food', stem:'露珠', effect:'准备阶段时使用该卡，玩家恢复6点生命；若回合结束时存于手牌，则进入弃牌堆。', mods:{healPlayer:6}},
  {id:'a-084-2', name:'炖肉', type:'food', stem:'炖肉', effect:'准备阶段时使用，选择己方场上一只怪物恢复4点生命，且攻击+1。'},
  {id:'a-059-2', name:'肉馅饼', type:'food', stem:'肉馅饼', effect:'准备阶段时使用，己方场上所有怪物与玩家恢复4点生命。'},
  {id:'a-112-2', name:'全肉大饼', type:'food', stem:'全肉大饼', effect:'准备阶段时使用，丢弃手牌中一张【肉馅饼】，己方所有怪物攻击+3；若手牌中没有【肉馅饼】，己方场上所有怪物仅恢复4点生命。'},

  /* ---------------- 药水 ×5 ---------------- */
  {id:'a-019-2', name:'治疗药水', type:'potion', stem:'治疗药水', effect:'准备阶段时使用该卡，我方场上所有怪物卡恢复10点生命。', mods:{healMonsters:10}},
  {id:'a-020-2', name:'力量药水', type:'potion', stem:'力量药水', effect:'准备阶段时使用该卡，我方场上所有怪物卡攻击+1。', mods:{buffAtkAll:1}},
  {id:'a-062-2', name:'冰霜药水', type:'potion', stem:'冰霜药水', effect:'准备阶段使用，对方下一回合召唤次数-1。'},
  {id:'a-087-2', name:'疾速药水', type:'potion', stem:'疾速药水', effect:'准备阶段使用，本回合召唤次数+1（首回合使用无效果）。'},
  {id:'a-115-2', name:'毒气药水', type:'potion', stem:'毒气药水', effect:'准备阶段时使用，对方叠加3层【毒气】。', mods:{poisonStacks:3}},

  /* ---------------- 法杖 ×5 ---------------- */
  {id:'a-021-2', name:'魔弹法杖', type:'wand', stem:'魔弹法杖', effect:'准备阶段时使用该卡：弃置一张手牌，对场上一张敌方怪物卡造成3点伤害。', upgradable:true, mods:{dmg:3, upgrade:[{dmg:5}]}},
  {id:'a-036-2', name:'老法杖', type:'wand', stem:'老法杖', effect:'已装备的该卡可灌注其余法杖，灌注后继承其能力并提升法杖等级；该卡在我方场上时，每回合施法次数+1。'},
  {id:'a-067-2', name:'焰浪法杖', type:'wand', stem:'焰浪法杖', effect:'准备阶段时使用该卡，弃置一张手牌，对手选择弃置一张卷轴/食物/药水卡（升级后 2 张）。', upgradable:true, mods:{discardEnemy:1, upgrade:[{discardEnemy:2}]}},
  {id:'a-068-2', name:'解离法杖', type:'wand', stem:'解离法杖', effect:'准备阶段时使用，弃置一张手牌，从左至右依次对敌方怪物穿透造成2点伤害，每次穿透额外增加2点伤害。', upgradable:true, mods:{pierce:2, pierceStep:2, upgrade:[{pierceStep:4}]}},
  {id:'a-091-2', name:'冲击波法杖', type:'wand', stem:'冲击波法杖', effect:'准备阶段时使用，弃置一张手牌，对场上的一张怪物卡造成2点伤害并向右移动一位。', upgradable:true, mods:{dmg:2, upgrade:[{dmg:4}]}},

  /* ---------------- 陷阱 ×4 ---------------- */
  {id:'a-022-2', name:'麻痹陷阱', type:'trap', stem:'麻痹陷阱', effect:'若对方进入战斗阶段，该卡在手牌则立刻发动，结束对方回合。'},
  {id:'a-064-2', name:'召唤陷阱', type:'trap', stem:'召唤陷阱', effect:'对方召唤怪物后，这张卡在手牌则立即发动，将手牌中的一张C级怪物召唤至己方随机空位上。'},
  {id:'a-089-2', name:'毒气陷阱', type:'trap', stem:'毒气陷阱', effect:'对方召唤怪物后，若这张卡在手牌，则立即发动，对方叠加3层【毒气】。'},
  {id:'a-117-2', name:'爆炸陷阱', type:'trap', stem:'爆炸陷阱', effect:'对方召唤怪物时，若这张卡在手牌则立即发动，对该怪物造成8点伤害。', mods:{dmg:8}},

  /* ---------------- 戒指 ×4 ---------------- */
  {id:'a-023-2', name:'财富戒指', type:'ring', stem:'财富戒指', effect:'准备阶段时，该卡在手牌则额外抽一张牌。'},
  {id:'a-065-2', name:'极速戒指', type:'ring', stem:'极速戒指', effect:'准备阶段开始时，若这张卡在手牌，则将手牌中随机一张C级怪物召唤。'},
  {id:'a-066-2', name:'狂怒戒指', type:'ring', stem:'狂怒戒指', effect:'准备阶段开始时，若这张卡在手牌，则己方场上随机一张B级怪物攻击次数+1。'},
  {id:'a-090-2', name:'神射戒指', type:'ring', stem:'神射戒指', effect:'这张卡在手牌时，每打出三张投掷物卡，从弃牌堆随机选中一张投掷物卡返回手牌。'},

  /* ---------------- 神器 ×4 ---------------- */
  {id:'a-024-2', name:'丰饶号角', type:'artifact', stem:'丰饶号角', effect:'准备阶段时，每使用一张食物卡，可以抽取一张牌。', maxCopies:1},
  {id:'a-070-2', name:'先见护符', type:'artifact', stem:'先见护符', effect:'若对方手牌含有陷阱卡，这张卡将红光提示；准备阶段开始时，若己方场上怪物数＞1，随机弃置一张对方手牌中的陷阱卡。', maxCopies:1},
  {id:'a-094-2', name:'虚空锁链', type:'artifact', stem:'虚空锁链', effect:'准备阶段限一次，将场上任意一只怪物移动至其场上空位。', maxCopies:1},
  {id:'a-120-2', name:'时光沙漏', type:'artifact', stem:'时光沙漏', effect:'准备阶段使用：直到你的下回合开始前，双方无法使用投掷物与法杖，场上所有怪物无法攻击；使用后冷却6回合。', mods:{cooldown:6}, maxCopies:1},

  /* ---------------- 武器 ×5 + 衍生2 ---------------- */
  {id:'a-025-2', name:'短剑', type:'weapon', stem:'短剑', effect:'准备阶段时为一只怪物装备，其攻击+1。【装备要求：怪物攻击力≥3】', upgradable:true, equip:{stat:'atk', min:3}, mods:{atkBonus:1, upgrade:[{atkBonus:2},{atkBonus:4}]}},
  {id:'a-093-2', name:'长矛', type:'weapon', stem:'长矛', effect:'准备阶段时为一只怪物装备；对非对位怪物攻击后，对其造成1点伤害。【装备要求：怪物攻击力≥5】', upgradable:true, equip:{stat:'atk', min:5}, mods:{atkBonus:0, splash:1, upgrade:[{splash:2},{splash:4}]}},
  {id:'a-069-2', name:'镶钉手套', type:'weapon', stem:'镶钉手套', effect:'准备阶段时为一只怪物装备，其攻击+1；自战斗阶段开始时20%概率抽一张牌。【装备要求：怪物攻击力≥1】', upgradable:true, equip:{stat:'atk', min:1}, mods:{atkBonus:1, procChance:0.2, upgrade:[{procChance:0.5},{procChance:1.0}]}},
  {id:'a-042-2', name:'灵能弓', type:'weapon', stem:'灵能弓', effect:'准备阶段时为一只怪物装备；抽牌时，该卡对一张随机的敌方怪物卡造成1点伤害。【装备要求：怪物攻击力≥0】', equip:{stat:'atk', min:0}, mods:{atkBonus:0, onDrawDmg:1}},
  {id:'a-119-2', name:'硬头锤', type:'weapon', stem:'硬头锤', effect:'准备阶段时为一只怪物装备，其攻击+2。【装备要求：怪物攻击力≥5】', upgradable:true, equip:{stat:'atk', min:5}, mods:{atkBonus:2, upgrade:[{atkBonus:3},{atkBonus:5}]}},

  /* ---------------- 防具 ×6 + 衍生1 ---------------- */
  /* 圆盾是**武器**（攻防一体），不是防具 —— 2026-10-22 玩家指出：
     它此前被标成 armor，于是能吃【破损纹章】（那张卡只对防具生效）。
     type 改成 weapon 后自动与纹章隔离；mods 里同时带 atkBonus 与 dmgReduce，
     引擎的 eqModValue 对武器/防具两个槽都会读，所以效果数值不受影响。 */
  {id:'a-026-2', name:'圆盾', type:'weapon', stem:'圆盾', effect:'准备阶段时为一只怪物装备：其攻击+1，战斗阶段受到伤害-1。【装备要求：怪物攻击力≥3】', upgradable:true, equip:{stat:'atk', min:3}, mods:{atkBonus:1, dmgReduce:1, upgrade:[{atkBonus:2, dmgReduce:1},{atkBonus:3, dmgReduce:2}]}},
  {id:'a-027-2', name:'布甲', type:'armor', stem:'布甲', effect:'准备阶段时为一只怪物装备，其战斗阶段受到伤害-1。【装备要求：怪物血量上限≥6】', upgradable:true, equip:{stat:'hp', min:6}, mods:{dmgReduce:1, upgrade:[{dmgReduce:2},{dmgReduce:3}]}},
  {id:'a-028-2', name:'皮甲', type:'armor', stem:'皮甲', effect:'准备阶段时为一只怪物装备，其战斗阶段受到伤害-2。【装备要求：怪物血量上限≥10】', upgradable:true, equip:{stat:'hp', min:10}, mods:{dmgReduce:2, upgrade:[{dmgReduce:3},{dmgReduce:4}]}},
  {id:'a-092-2', name:'链甲', type:'armor', stem:'链甲', effect:'准备阶段时为一只怪物装备，其战斗阶段受到伤害-1。【装备要求：怪物血量上限≥14】', upgradable:true, equip:{stat:'hp', min:14}, mods:{dmgReduce:1, upgrade:[{dmgReduce:3},{dmgReduce:5}]}},
  {id:'a-039-2', name:'暗影斗篷', type:'armor', stem:'暗影斗篷', effect:'准备阶段时为一只怪物装备，在你的下个回合开始前，该怪物无法被攻击。【装备要求：任意怪物】', equip:{stat:'hp', min:0}, mods:{untargetable:true}},
  {id:'a-118-2', name:'鳞甲', type:'armor', stem:'鳞甲', effect:'准备阶段时为一只怪物装备，其战斗阶段受到伤害-1。【装备要求：怪物血量上限≥15】', upgradable:true, equip:{stat:'hp', min:15}, mods:{dmgReduce:1, upgrade:[{dmgReduce:4},{dmgReduce:6}]}},

  /* ---------------- 卷轴 ×5 ---------------- */
  {id:'a-029-2', name:'升级卷轴', type:'scroll', stem:'升级卷轴', effect:'准备阶段时对装备或法杖使用，其等级+1。'},
  {id:'a-030-2', name:'传送卷轴', type:'scroll', stem:'传送卷轴', effect:'准备阶段时使用，双方将手牌洗回牌堆，并抽取等量手牌。'},
  {id:'a-063-2', name:'催眠卷轴', type:'scroll', stem:'催眠卷轴', effect:'准备阶段时使用，你的下回合开始前，场上所有怪物无法攻击。'},
  {id:'a-088-2', name:'盛怒卷轴', type:'scroll', stem:'盛怒卷轴', effect:'准备阶段时使用，场上所有怪物立即受到一次场上随机怪物的力量的伤害。'},
  {id:'a-116-2', name:'镜像卷轴', type:'scroll', stem:'镜像卷轴', effect:'准备阶段时对一张我方怪物使用，在我方随机空位衍生一张同名怪物（攻击与本体相同、生命为1）；复制体继承本体的装备与状态，但镜像带来的装备在其离开场上时直接消失。'}
,
  {id:'a-121-02', name:'火元素', type:'monster', tier:'C', hp:6, atk:2, stem:'火元素C', effect:'主动攻击后，令对手弃置一张卷轴卡。', tags:['🫒']},
  {id:'a-122-02', name:'冰霜元素', type:'monster', tier:'C', hp:6, atk:2, stem:'冰霜元素C', effect:'主动攻击后，令对手弃置一张药水卡。', tags:['🫒']},
  {id:'a-123-02', name:'电击元素', type:'monster', tier:'C', hp:6, atk:2, stem:'电击元素C', effect:'主动攻击后，若目标攻击力＜4，则其下回合无法攻击。', tags:['🫒']},
  {id:'a-124-02', name:'矮人尸群', type:'monster', tier:'C', hp:6, atk:3, stem:'矮人尸群C', effect:'从场上进入弃牌堆后，若你的下回合结束时己方场上存在【矮人尸群】，在己方随机空位复活。', tags:['💎']},
  {id:'a-125-02', name:'矮人术士', type:'monster', tier:'B', hp:10, atk:3, stem:'矮人术士B', effect:'从手牌召唤上场时，可牺牲己方场上一只怪物，并令一张装备/法杖卡等级+2或-2。', tags:['💎']},
  {id:'a-126-02', name:'魔像', type:'monster', tier:'B', hp:10, atk:8, stem:'魔像B', effect:'这张卡只能攻击对位怪物。准备阶段开始时，移动到己方随机空位。', tags:['💎']},
  {id:'a-127-02', name:'矮人武僧', type:'monster', tier:'B', hp:10, atk:4, stem:'矮人武僧B', effect:'每回合受到的首次伤害减半。进入弃牌堆时攻击力+2。', tags:['💎']},
  {id:'a-128-02', name:'武僧大师', type:'monster', tier:'A', hp:14, atk:2, stem:'武僧大师A', effect:'每回合受到的首次伤害减半。从手牌召唤上场时，获得弃牌堆最上层怪物的攻击力。', tags:['💎']},
  {id:'a-129-02', name:'混沌元素', type:'monster', tier:'A', hp:14, atk:4, stem:'混沌元素A', effect:'主动攻击时，选择弃牌堆中一张【元素】怪物卡的卡牌效果发动。', tags:['🫒']},
  {id:'a-130-02', name:'矮人国王', type:'monster', tier:'S', hp:26, atk:0, stem:'矮人国王S', effect:'己方场上存在其余矮人时，受到的伤害由己方矮人共同分摊。准备阶段开始时获得弃牌堆中随机一张怪物卡。', tags:['💎']},

  /* ---------------- 2026-10-23 新卡 131~140 ---------------- */
  /* 131 宝藏：从弃牌堆随机查看三张，选一张加入手牌（不含刚打出的这张自己） */
  {id:'a-131-02', name:'坟墓', type:'treasure', stem:'坟墓', effect:'准备阶段时使用，从弃牌堆查看随机三张卡牌，选取一张加入手牌。', mods:{gravePick:3}},
  /* 132 药水：净化 —— 清除并用免疫"负面状态"（毒气/酸气/无法攻击/禁止投掷物法杖/禁锢/麻痹），
     不含冰霜药水的召唤次数-1（那是资源压制，不是负面状态） */
  {id:'a-132-02', name:'净化药水', type:'potion', stem:'净化药水', effect:'准备阶段时使用，你的下回合结束前，免疫自身的负面状态。', mods:{cleanse:true}},
  /* 133 卷轴：对手自己选一只 B/C 级怪物收回手牌 */
  {id:'a-133-02', name:'恐惧卷轴', type:'scroll', stem:'恐惧卷轴', effect:'准备阶段时使用，对手选择其场上的一只B/C级怪物卡返回其手牌。'},
  /* 134 武器：攻击力要求 8+，+2 / +4 / +6 */
  {id:'a-134-02', name:'关刀', type:'weapon', stem:'关刀', effect:'准备阶段时为一只怪物装备，其攻击+2。【装备要求：怪物攻击力≥8】', upgradable:true, equip:{stat:'atk', min:8}, mods:{atkBonus:2, upgrade:[{atkBonus:4},{atkBonus:6}]}},
  /* 135 防具：生命上限要求 18+，减伤 2 / 5 / 6 */
  {id:'a-135-02', name:'板甲', type:'armor', stem:'板甲', effect:'准备阶段时为一只怪物装备，其战斗阶段受到伤害-2。【装备要求：怪物血量上限≥18】', upgradable:true, equip:{stat:'hp', min:18}, mods:{dmgReduce:2, upgrade:[{dmgReduce:5},{dmgReduce:6}]}},
  /* 136 法杖：攻击-1 + 叠腐化；层数高于当前生命时转移到施法方随机空位（清空层数、保留血量攻击） */
  {id:'a-136-02', name:'腐化法杖', type:'wand', stem:'腐化法杖', effect:'准备阶段时使用，弃置一张手牌，令对手场上一只怪物攻击-1并叠加2层【腐化】（升级后3层）。（腐化层数高于其当前生命时，转移到我方随机空位。）', upgradable:true, mods:{corrupt:2, upgrade:[{corrupt:3}]}},
  /* 137 法杖：2 点伤害（升级后 4 点）+ 禁止对方投掷物/法杖。封锁回合数**不随升级变化**（玩家 10-23 改）
     ⚠ upgrade 里只放 dmg：引擎的通用伤害取值就是 `lv>=1 && upgrade[0].dmg ? upgrade[0].dmg : dmg` */
  {id:'a-137-02', name:'棱光法杖', type:'wand', stem:'棱光法杖', effect:'准备阶段时使用，弃置一张手牌，对场上一张敌方怪物卡造成2点伤害（升级后4点）；对方下1回合无法使用投掷物/法杖。', upgradable:true, mods:{dmg:2, banTW:1, upgrade:[{dmg:4}]}},
  /* 138 陷阱：对手召唤怪物时发动，其 2 回合内无法使用投掷物/法杖（玩家 10-23 由 3 改为 2） */
  {id:'a-138-02', name:'闪光陷阱', type:'trap', stem:'闪光陷阱', effect:'对手召唤怪物时可发动，其接下来的2回合内无法使用投掷物/法杖卡。', mods:{banTW:2}},
  /* 139 神器：牺牲当前回合数的生命换等量生命上限（打 cup 标记，离场清理） */
  {id:'a-139-02', name:'蓄血圣杯', type:'artifact', stem:'蓄血圣杯', effect:'准备阶段限一次，令己方场上一只怪物失去当前回合数的生命，并获得等量的生命上限；每只怪物限一次。', maxCopies:1},
  /* 140 神器：手牌被对手效果弃置时回牌堆 + 加一张露珠 */
  {id:'a-140-02', name:'自然之靴', type:'artifact', stem:'自然之靴', effect:'因对手卡牌效果而进入弃牌堆的手牌，将返回牌堆并在其中增加一张【露珠】。', maxCopies:1},

  /* ---------------- 2026-10-25 恶魔体系 141、143~150 ---------------- */
  /* 141 C：回合结束攻击+2；己方场上有【恶魔血巢】时变成随机 B 级恶魔 */
  {id:'a-141-02', name:'古神幼虫', type:'monster', tier:'C', hp:6, atk:2, stem:'古神幼虫C', tags:['👿'], effect:'回合结束时攻击力+2；若己方场上存在【恶魔血巢】，变换为随机 B 级恶魔类怪物。'},
  /* 142 魔法绵羊（羊群陷阱 a-158-02 衍生）—— 无法受伤 / 不可献祭 / 无法攻击且不可被选为目标 / 己方回合结束消散 */
  {id:'a-142-02', name:'魔法绵羊', type:'monster', tier:'C', hp:1, atk:0, stem:'魔法绵羊C', effect:'无法受到任何伤害；不可用于献祭/牺牲；无法攻击、也无法作为目标；己方回合结束时消散。'},
  /* 143 C：召唤后立刻攻击对位；对位为空则直接进弃牌堆 */
  {id:'a-143-02', name:'恶魔撕裂者', type:'monster', tier:'C', hp:8, atk:4, stem:'恶魔撕裂者C', tags:['👿'], effect:'召唤后立即攻击对位；若此时其对位为空，则立即进入弃牌堆。'},
  /* 144 B：额外 2 次攻击；对位有怪时移到己方空位，否则返回手牌 */
  {id:'a-144-02', name:'巨型蝎子', type:'monster', tier:'B', hp:10, atk:2, stem:'巨型蝎子B', tags:['👿'], effect:'额外拥有2次攻击次数；对位存在怪物时，移到己方对位为空的空位，否则返回手牌。'},
  /* 145 B：攻击目标被魅惑（一回合内无法攻击魅魔，每个目标限一次） */
  {id:'a-145-02', name:'魅魔', type:'monster', tier:'B', hp:10, atk:4, stem:'魅魔B', tags:['👿'], effect:'攻击目标将被【魅惑】，一回合内无法攻击【魅魔】，每个目标最多魅惑一次。'},
  /* 146 B：回合结束若留有攻击次数 → 一回合临时 4 点减伤 + 无视减伤的两倍伤害 */
  {id:'a-146-02', name:'邪恶之眼', type:'monster', tier:'B', hp:10, atk:4, stem:'邪恶之眼B', tags:['👿'], effect:'回合结束时若留有攻击次数，获得一回合临时4点减伤与无视减伤的两倍伤害加成。'},
  /* 147 A：额外 1 次攻击；主动攻击对位目标时对手叠 2 层酸气 */
  {id:'a-147-02', name:'酸液蝎子', type:'monster', tier:'A', hp:14, atk:3, stem:'酸液蝎子A', tags:['👿'], effect:'额外拥有1次攻击次数；主动攻击时若目标处于对位，对手叠加2层【酸气】。'},
  /* 148 A：回合开始或受到伤害时，在对位非空的空位衍生【恶魔撕裂者】 */
  {id:'a-148-02', name:'恶魔血巢', type:'monster', tier:'A', hp:16, atk:0, stem:'恶魔血巢A', tags:['👿'], effect:'回合开始或受到伤害时，在己方对位非空的空位衍生一张【恶魔撕裂者】。'},
  /* 149 A：为中位怪物承担伤害；召唤时若己方有【YOG】可变为六种形态之一 */
  {id:'a-149-02', name:'古神之拳', type:'monster', tier:'A', hp:14, atk:4, stem:'古神之拳A-default', tags:['👿'], effect:'这张卡为中位的怪物承担伤害；召唤时若己方场上有【YOG】，可选择转变为六种形态之一。',
    /* 六种形态的效果文本：详情弹窗按当前形态显示的**文字**（卡面图上本来也印着，这里是为了文字区不跟图打架） */
    forms: {
      burn: '【燃烧形态】为中位怪物承担伤害；主动攻击时令对手选择弃置一张戒指卡。',
      earth: '【大地形态】为中位怪物承担伤害；主动攻击时令攻击目标持续一回合无法移动。',
      rot: '【腐烂形态】为中位怪物承担伤害；主动攻击时对手叠加 2 层【毒气】或 1 层【酸气】。',
      rust: '【锈蚀形态】为中位怪物承担伤害；这张卡每次受到伤害至多 6 点。',
      glory: '【辉耀形态】为中位怪物承担伤害；主动攻击后对手有 40% 概率下回合无法使用法杖。',
      shadow: '【暗影形态】为中位怪物承担伤害；主动攻击后对手有 40% 概率下回合无法使用投掷物。'
    }},
  /* 150 S：己方唯一；受伤时衍生【古神幼虫】；准备阶段对上回合的攻击位置造成 8-10 伤害 */
  /* ⚠ 不要加 maxCopies：卡面写的「唯一性」指**己方场上只能有一张**（引擎在召唤/献祭时判定），
     组卡器里它和别的 S 卡一样可以带 2 张。 */
  {id:'a-150-02', name:'YOG', type:'monster', tier:'S', hp:20, atk:0, stem:'YOGS', tags:['👿'], effect:'这张卡具有己方唯一性；每当受到伤害时在己方空位衍生【古神幼虫】；准备阶段开始时对上回合的攻击位置造成 8-10 点伤害。'},

  /* ---------------- 2026-10-25 新卡 151~160 ---------------- */
  /* 151 宝藏：弃一张手牌 → 牌库检索一张装备卡 + 一张升级卷轴 */
  {id:'a-151-02', name:'黑檀宝箱', type:'treasure', stem:'黑檀宝箱', effect:'准备阶段时使用，随机抽取牌堆中一张装备卡与一张升级卷轴。'},
  /* 152 戒指：在手牌中持续生效，施法无需弃牌，冷却 2 回合 */
  {id:'a-152-02', name:'充能戒指', type:'ring', stem:'充能戒指', effect:'在手牌中持续生效：施法时无需弃牌，冷却 2 回合。'},
  /* 153 卷轴：本回合施法次数+1，首次施法无需弃牌 */
  {id:'a-153-02', name:'充能卷轴', type:'scroll', stem:'充能卷轴', effect:'准备阶段时使用，本回合施法次数+1，首次施法无需弃牌。'},
  /* 154 卷轴：选己方一只怪 → 对对手随机怪造成"其已损失生命"的伤害 */
  {id:'a-154-02', name:'复仇卷轴', type:'scroll', stem:'复仇卷轴', effect:'准备阶段时使用，选择己方场上一只怪物，对对手随机怪物造成其已损失生命的伤害。'},
  /* 155 药水：能攻击"无法选中"的怪，持续 2 回合 */
  {id:'a-155-02', name:'灵视药水', type:'potion', stem:'灵视药水', effect:'准备阶段时使用，能够攻击无法选中的怪物，持续 2 回合。'},
  /* 156 药水：选己方 ≤9 血怪，一回合无法选中 */
  {id:'a-156-02', name:'隐身药水', type:'potion', stem:'隐身药水', effect:'准备阶段时使用，选择己方场上一只生命 9 以下的怪物，使其一回合无法选中。'},
  /* 157 食物：弃一张手牌药水 → 这张卡获得相同效果 */
  {id:'a-157-02', name:'无味果', type:'food', stem:'无味果', effect:'准备阶段时使用，弃置手牌中一张药水卡，这张卡获得相同效果。'},
  /* 158 陷阱：对手使用宝藏/药水卡时可发动 → 双方所有空位衍生魔法绵羊 */
  {id:'a-158-02', name:'羊群陷阱', type:'trap', stem:'羊群陷阱', effect:'对手使用宝藏/药水卡时可发动，在双方所有空位衍生【魔法绵羊】。'},
  /* 159 神器：三选一随机卷轴效果（消耗本回合卷轴次数），冷却 5 回合 */
  {id:'a-159-02', name:'无序魔典', type:'artifact', stem:'无序魔典', effect:'准备阶段时使用，从三个随机卷轴效果中选择其一并发动；消耗本回合的卷轴使用次数，冷却 5 回合。', maxCopies:1},
  /* 160 神器：三选一随机药水效果（消耗本回合药水次数），冷却 5 回合 */
  {id:'a-160-02', name:'炼金工具箱', type:'artifact', stem:'炼金工具箱', effect:'准备阶段时使用，从三个随机药水效果中选择其一并发动；消耗本回合的药水使用次数，冷却 5 回合。', maxCopies:1}
];

/* ---------- 建立索引 & 图片路径工具 ---------- */
var CARDS = {};
CARD_LIST.forEach(function (c) {
  /* 同名单卡上限。宝藏单独一档（≤2）：它全是纯过牌/检索，
     按道具的 4 张走会让"抽牌"类套牌过强，也会把 20 张卡组塞满。
     ⚠ 这里算出来的 maxCopies 是全局唯一定义，卡组校验（storage.js 的
       validate/canAdd）、服务端开局校验（server.js）、组卡器显示（×n/上限）、
       卡牌提示（tooltip「上限 n」）全部读它 —— 改一处即全生效。 */
  if (!c.maxCopies) c.maxCopies = (c.type === 'artifact') ? Rules.ARTIFACT_MAX
    : (c.type === 'treasure') ? Rules.TREASURE_MAX
    : (c.type === 'monster' ? (Rules.TIER_MAX[c.tier] || 4) : Rules.ITEM_MAX);
  if (c.type === 'monster' && c.upgradable === undefined) c.upgradable = false;
  CARDS[c.id] = c;
});

// 缩略卡路径（手牌显示，130×182 NEAREST）
/* form：多形态卡（古神之拳）按形态换图。stem 里带 `-default` 的才替换，
   其它卡没有这个后缀，传了 form 也不受影响。 */
function stemOf(c, form) {
  var st = c.stem;
  if (form && /-default$/.test(st)) st = st.replace(/-default$/, '-' + form);
  return st;
}
function cardThumb(c, form) { return c.thumb || ('卡牌/缩略卡/' + stemOf(c, form) + '.png'); }
// 高清卡路径（悬停右侧大图）
function cardDetail(c, form) { return c.detail || ('卡牌/高清卡/' + stemOf(c, form) + '详情.png'); }
function cardImg(c) { return cardThumb(c); }
function getCard(id) { return CARDS[id]; }
