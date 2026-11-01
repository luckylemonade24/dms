/* ============================================================
 * 存档与卡组校验  storage.js
 *  - SaveData：localStorage 持久化（卡组 / 当前卡组 / 难度 / 跑图进度）
 *  - DeckRules：卡组合法性校验（20–50 张、单卡上限、神器 ≤1）
 * ========================================================== */

/* ---------------- 卡组校验 ---------------- */
var DeckRules = (function () {
  'use strict';

  function counts(cardIds) {
    var m = {};
    cardIds.forEach(function (id) { m[id] = (m[id] || 0) + 1; });
    return m;
  }

  function validate(cardIds) {
    var errors = [], m = counts(cardIds), size = cardIds.length;
    if (size < Rules.DECK_MIN) errors.push('卡组至少 ' + Rules.DECK_MIN + ' 张（当前 ' + size + '）');
    if (size > Rules.DECK_MAX) errors.push('卡组最多 ' + Rules.DECK_MAX + ' 张（当前 ' + size + '）');
    var artifacts = 0;
    for (var id in m) {
      var cd = CARDS[id];
      if (!cd) { errors.push('存在未知卡牌：' + id); continue; }
      if (m[id] > cd.maxCopies) errors.push('【' + cd.name + '】超出上限（' + m[id] + '/' + cd.maxCopies + '）');
      if (cd.type === 'artifact') artifacts += m[id];
    }
    if (artifacts > Rules.ARTIFACT_MAX) errors.push('神器最多携带 ' + Rules.ARTIFACT_MAX + ' 张');
    return { ok: errors.length === 0, errors: errors, size: size, counts: m };
  }

  // 是否还能再加一张该卡（用于卡池点击拦截）
  function canAdd(cardIds, id) {
    var cd = CARDS[id];
    if (!cd) return false;
    if (cardIds.length >= Rules.DECK_MAX) return false;
    var m = counts(cardIds);
    if ((m[id] || 0) >= cd.maxCopies) return false;
    if (cd.type === 'artifact') {
      var arts = 0;
      for (var k in m) if (CARDS[k] && CARDS[k].type === 'artifact') arts += m[k];
      if (arts >= Rules.ARTIFACT_MAX) return false;
    }
    return true;
  }

  // 组卡器（初始卡组）专用：在原 20–50 校验基础上，要求恰好为 DECK_START 张
  function validateStarter(cardIds) {
    var v = validate(cardIds);
    var errors = v.errors.slice();
    if (cardIds.length !== Rules.DECK_START) errors.push('初始卡组需为 ' + Rules.DECK_START + ' 张（当前 ' + cardIds.length + '）');
    return { ok: errors.length === 0, errors: errors, size: v.size, counts: v.counts };
  }
  // 组卡器是否还能再加一张（受 DECK_START 上限约束）
  function canAddStarter(cardIds, id) {
    if (cardIds.length >= Rules.DECK_START) return false;
    return canAdd(cardIds, id);
  }

  /* ---- 大卡组模式（晋升之路）：允许 20~40 张 ---- */
  var BIG_MIN = 20, BIG_MAX = 40;
  function validateBig(cardIds) {
    var errors = [], m = counts(cardIds), size = cardIds.length;
    if (size < BIG_MIN) errors.push('大卡组至少 ' + BIG_MIN + ' 张（当前 ' + size + '）');
    if (size > BIG_MAX) errors.push('大卡组最多 ' + BIG_MAX + ' 张（当前 ' + size + '）');
    var artifacts = 0;
    for (var id in m) {
      var cd = CARDS[id];
      if (!cd) { errors.push('存在未知卡牌：' + id); continue; }
      if (m[id] > cd.maxCopies) errors.push('【' + cd.name + '】超出上限（' + m[id] + '/' + cd.maxCopies + '）');
      if (cd.type === 'artifact') artifacts += m[id];
    }
    if (artifacts > Rules.ARTIFACT_MAX) errors.push('神器最多携带 ' + Rules.ARTIFACT_MAX + ' 张');
    return { ok: errors.length === 0, errors: errors, size: size, counts: m };
  }
  function canAddBig(cardIds, id) {
    if (cardIds.length >= BIG_MAX) return false;
    var cd = CARDS[id]; if (!cd) return false;
    var m = counts(cardIds);
    if ((m[id] || 0) >= cd.maxCopies) return false;
    if (cd.type === 'artifact') {
      var arts = 0;
      for (var k in m) if (CARDS[k] && CARDS[k].type === 'artifact') arts += m[k];
      if (arts >= Rules.ARTIFACT_MAX) return false;
    }
    return true;
  }

  return { validate: validate, validateStarter: validateStarter, canAdd: canAdd, canAddStarter: canAddStarter, counts: counts,
    BIG_MIN: BIG_MIN, BIG_MAX: BIG_MAX, validateBig: validateBig, canAddBig: canAddBig };
})();

/* ---------------- 持久化 ---------------- */
var SaveData = (function () {
  'use strict';

  var KEY = 'dd2_save_v1';
  var state = null;

  /* 字号倍率（设置 → 字号）：0.85 ~ 1.4，1 = 默认大小。
     实际生效靠 CSS 里的 calc(Npx * var(--fs, 1))（见 style.css 的 :root）。 */
  var FS_MIN = 0.85, FS_MAX = 1.4;
  function defaults() {
    return {
      version: 2,
      decks: [
        { name: '新手卡组', cardIds: PRESET_DECKS.starter.slice() },
        { name: '突袭卡组', cardIds: PRESET_DECKS.raider.slice() }
      ],
      activeDeck: 0,
      difficulty: 'novice',
      fontScale: 1,        // 字号倍率（1 = 默认大小，见设置面板）
      ranked: { score: 1 },// 排位赛冠军积分 1~100（赢 +1 / 输 -1，服务器结算后写回）
      run: null,           // 跑图进度（见 run.js RunManager）
      tour: null,          // 魔绫大赛进行中的赛事（见 tournament.js）
      tourHistory: [],     // 历届魔绫大赛排名
      masterHistory: [],   // 大师赛（联机）近 20 场对战记录
      academy: null,       // 学院考核进行中的一届（见 academy.js）
      academyHistory: [],  // 历届学院考核排名
      boss: { cleared: 0 }, // 晋升之路进度：已通关最高关卡（见 boss.js）
      seedText: '',        // 手动指定的跑图种子（留空 = 随机）
      tutor: { asked: false, done: false, step: 0 },   // 入学手册：是否已询问过新手 / 是否毕业 / 上次进度
      audio: { on: true, sfx: 0.55, bgm: 0.18 },
      player: { name: '玩家', avatar: '初始头像1', title: '雪景学院新生' },   // 人物系统：头像 / 名称 / 称号
      achievements: {},   // 已解锁成就：{ 成就id: 解锁时间戳 }
      stats: {}           // 跨局统计计数（征途通关/死亡/连续、大赛连冠、决斗胜场…）
    };
  }

  function sanitize(d) {
    var s = defaults();
    if (!d || typeof d !== 'object') return s;
    if (Array.isArray(d.decks)) {
      var decks = d.decks.filter(function (x) { return x && Array.isArray(x.cardIds); }).map(function (x) {
        return { name: String(x.name || '卡组').slice(0, 12), cardIds: x.cardIds.filter(function (id) { return !!CARDS[id]; }), big: !!x.big };
      });
      if (decks.length) s.decks = decks;
    }
    if (typeof d.activeDeck === 'number' && d.activeDeck >= 0 && d.activeDeck < s.decks.length) s.activeDeck = d.activeDeck;
    // 难度：novice(新手)/amateur(业余)/pro(专业)/champion(冠军)
    // 旧版本存档按版本号迁移（hobby→novice / amateur→hobby / pro→amateur）；更旧的 easy/normal/hard → novice
    var _dmMap = { hobby: 'novice', amateur: 'hobby', pro: 'amateur' };
    var _oldVer = (typeof d.version === 'number') ? d.version : 0;
    if (['novice', 'hobby', 'amateur', 'pro', 'champion'].indexOf(d.difficulty) >= 0) {
      s.difficulty = (_oldVer < 2 && _dmMap[d.difficulty]) ? _dmMap[d.difficulty] : d.difficulty;
    } else if (['easy', 'normal', 'hard'].indexOf(d.difficulty) >= 0) {
      s.difficulty = 'novice';
    }
    if (s.difficulty === 'hobby') s.difficulty = 'amateur';   // 「爱好者」档已移除 → 归入业余档
    // 跑图存档：保留 run.js 的完整结构（地图 / 生命 / 金币 / 卡组 / 遗物 / 种子）
    var r = d.run;
    if (r && typeof r === 'object' && Array.isArray(r.deck) && r.map && Array.isArray(r.map.rows) && r.map.rows.length) {
      s.run = r;
      if (typeof s.run.seed !== 'number') s.run.seed = 1;
      if (typeof s.run.battles !== 'number') s.run.battles = 0;
      if (!Array.isArray(s.run.relics)) s.run.relics = [];
      if (typeof s.run.gold !== 'number') s.run.gold = 0;
      if (typeof s.run.hp !== 'number') s.run.hp = 30;
      if (typeof s.run.maxHp !== 'number') s.run.maxHp = 30;
      if (!Array.isArray(s.run.done)) s.run.done = [];
      if (typeof s.run.act !== 'number') s.run.act = 1;
    } else {
      s.run = null;   // 旧版/损坏存档：丢弃
    }
    if (d.audio && typeof d.audio === 'object') {
      s.audio = {
        on: d.audio.on !== false,
        sfx: typeof d.audio.sfx === 'number' ? Math.max(0, Math.min(1, d.audio.sfx)) : 0.55,
        bgm: typeof d.audio.bgm === 'number' ? Math.max(0, Math.min(1, d.audio.bgm)) : 0.18
      };
    }
    // 字号倍率：老存档没有这个字段 → 保持默认 1（视觉与改动前完全一致）
    if (typeof d.fontScale === 'number' && isFinite(d.fontScale)) {
      s.fontScale = Math.max(FS_MIN, Math.min(FS_MAX, d.fontScale));
    }
    // 排位积分：老存档没有 → 从 1 分（入门选手）开始
    if (d.ranked && typeof d.ranked.score === 'number' && isFinite(d.ranked.score)) {
      s.ranked = { score: Math.max(1, Math.min(100, Math.round(d.ranked.score))) };
    }
    if (d.seedText != null) s.seedText = String(d.seedText).slice(0, 12);
    // 入学手册：新旧存档都要有这块（旧存档 = 还没被问过，下次进游戏就会问）
    var t = d.tutor;
    if (t && typeof t === 'object') {
      s.tutor.asked = !!t.asked;
      s.tutor.done = !!t.done;
      s.tutor.step = (typeof t.step === 'number' && t.step >= 0) ? Math.floor(t.step) : 0;
    }
    // 魔绫大赛：进行中的赛事与历届排名
    if (d.tour && typeof d.tour === 'object' && Array.isArray(d.tour.order) && Array.isArray(d.tour.entrants)) s.tour = d.tour;
    else s.tour = null;
    if (Array.isArray(d.tourHistory)) s.tourHistory = d.tourHistory.filter(function (x) { return x && typeof x === 'object' && x.name; });
    // 大师赛（联机）：只保留最近 20 场
    if (Array.isArray(d.masterHistory)) s.masterHistory = d.masterHistory.filter(function (x) { return x && typeof x === 'object'; }).slice(0, 20);
    // 学院考核：进行中的一届与历届排名
    if (d.academy && typeof d.academy === 'object' && Array.isArray(d.academy.ents)) s.academy = d.academy;
    else s.academy = null;
    if (Array.isArray(d.academyHistory)) s.academyHistory = d.academyHistory.filter(function (x) { return x && typeof x === 'object' && x.name; });
    // 晋升之路：进度（已通关最高关卡）；随整档导出/导入
    var bs = d.boss;
    if (bs && typeof bs === 'object') {
      var cl = (typeof bs.cleared === 'number' && isFinite(bs.cleared)) ? Math.floor(bs.cleared) : 0;
      s.boss = { cleared: Math.max(0, Math.min(16, cl)) };
    } else s.boss = { cleared: 0 };
    // 人物系统（头像 / 名称 / 称号）
    var pl = d.player;
    if (pl && typeof pl === 'object') {
      if (typeof pl.name === 'string' && pl.name.trim()) s.player.name = pl.name.trim().slice(0, 12);
      if (typeof pl.avatar === 'string' && pl.avatar) s.player.avatar = pl.avatar.slice(0, 40);
      if (typeof pl.title === 'string' && pl.title) s.player.title = pl.title.slice(0, 20);
    }
    // 成就解锁表
    if (d.achievements && typeof d.achievements === 'object') {
      var ach = {};
      for (var ak in d.achievements) { if (d.achievements[ak]) ach[String(ak).slice(0, 40)] = d.achievements[ak]; }
      s.achievements = ach;
    }
    // 跨局统计
    if (d.stats && typeof d.stats === 'object') {
      var st = {};
      for (var sk in d.stats) { var sv = d.stats[sk]; if (typeof sv === 'number' && isFinite(sv)) st[String(sk).slice(0, 40)] = sv; }
      s.stats = st;
    }
    return s;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      try { state = sanitize(JSON.parse(raw)); return state; } catch (e) { /* 损坏则重建 */ }
    }
    state = defaults();
    save();
    return state;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 隐私模式等忽略 */ }
  }
  function get() { if (!state) load(); return state; }
  function reset() { state = defaults(); save(); }

  function activeDeck() { var s = get(); return s.decks[s.activeDeck] || s.decks[0]; }
  // 卡组变动也要通知联机（席位名片上带卡组名 / 卡表，换卡组后对手看到的不该是旧的）
  function setActiveDeck(i) { var s = get(); if (i >= 0 && i < s.decks.length) { s.activeDeck = i; save(); notifyNet(); } }
  function addDeck(name, cardIds, big) { var s = get(); s.decks.push({ name: String(name || '新卡组').slice(0, 12), cardIds: cardIds.slice(), big: !!big }); s.activeDeck = s.decks.length - 1; save(); notifyNet(); return s.activeDeck; }
  function updateDeck(i, name, cardIds, big) { var s = get(); if (s.decks[i]) { s.decks[i] = { name: String(name || '卡组').slice(0, 12), cardIds: cardIds.slice(), big: !!big }; save(); notifyNet(); } }
  function removeDeck(i) { var s = get(); if (s.decks.length <= 1) return false; if (s.decks[i]) { s.decks.splice(i, 1); if (s.activeDeck >= s.decks.length) s.activeDeck = s.decks.length - 1; save(); notifyNet(); } return true; }

  function setDifficulty(d) { get().difficulty = d; save(); }
  function getDifficulty() { return get().difficulty; }

  /* 字号倍率：可调字体（设置面板）。返回实际生效值（已 clamp）。 */
  function setFontScale(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 1;
    get().fontScale = Math.max(FS_MIN, Math.min(FS_MAX, n));
    save();
    return get().fontScale;
  }
  function getFontScale() {
    var v = get().fontScale;
    return (typeof v === 'number' && isFinite(v)) ? Math.max(FS_MIN, Math.min(FS_MAX, v)) : 1;
  }

  /* 排位赛冠军积分（1~100）：一局定胜负，赢 +1 / 输 -1。
   * 结算由服务器下发（{t:'ranked-result'}），这里只负责存与读。 */
  function getRankedScore() {
    var r = get().ranked;
    var v = (r && typeof r.score === 'number') ? r.score : 1;
    if (!isFinite(v)) v = 1;
    return Math.max(1, Math.min(100, Math.round(v)));
  }
  function setRankedScore(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 1;
    get().ranked = { score: Math.max(1, Math.min(100, Math.round(n))) };
    save();
    return get().ranked.score;
  }

  function setRun(r) { get().run = r; save(); }
  function getRun() { return get().run; }
  function clearRun() { get().run = null; save(); }
  function hasRun() { return !!get().run; }

  // 大师赛（联机）战绩：新记录放最前，只留最近 20 场
  function getMasterHistory() { return get().masterHistory || []; }
  function addMasterRecord(rec) {
    if (!rec || typeof rec !== 'object') return;
    var s = get();
    s.masterHistory = s.masterHistory || [];
    s.masterHistory.unshift(rec);
    if (s.masterHistory.length > 20) s.masterHistory.length = 20;
    save();
  }

  function setTour(t) { get().tour = t; save(); }
  function getTour() { return get().tour; }
  function setTourHistory(h) { get().tourHistory = Array.isArray(h) ? h : []; save(); }
  function getTourHistory() { return get().tourHistory || []; }

  function setBoss(b) { get().boss = b; save(); }
  function getBoss() { return get().boss || { cleared: 0 }; }

  function setAcademy(a) { get().academy = a; save(); }
  function getAcademy() { return get().academy; }
  function setAcademyHistory(h) { get().academyHistory = Array.isArray(h) ? h : []; save(); }
  function getAcademyHistory() { return get().academyHistory || []; }

  function getSeedText() { return get().seedText || ''; }
  function setSeedText(t) { get().seedText = String(t == null ? '' : t).slice(0, 12); save(); }

  // ---- 入学手册（新手教程）----
  function getTutor() { return get().tutor || { asked: false, done: false, step: 0 }; }
  function setTutor(o) {
    var t = getTutor();
    if (o && typeof o === 'object') {
      if (o.asked != null) t.asked = !!o.asked;
      if (o.done != null) t.done = !!o.done;
      if (o.step != null) t.step = Math.max(0, Math.floor(o.step));
    }
    get().tutor = t; save(); return t;
  }
  function isTutorAsked() { return !!getTutor().asked; }
  function markTutorAsked() { setTutor({ asked: true }); }
  function isTutorDone() { return !!getTutor().done; }
  function markTutorDone() { setTutor({ done: true, step: 0 }); }

  function getAudio() { return get().audio; }
  function setAudio(o) {
    var a = get().audio;
    if (o && typeof o === 'object') {
      if (o.on != null) a.on = !!o.on;
      if (o.sfx != null) a.sfx = Math.max(0, Math.min(1, o.sfx));
      if (o.bgm != null) a.bgm = Math.max(0, Math.min(1, o.bgm));
    }
    save();
    return a;
  }

  /* ---------------- 人物系统（头像 / 名称 / 称号） ---------------- */
  // 人物资料 / 卡组一变，就顺手告诉联机层重新发名片（否则房间里还挂着旧昵称）。
  // 放在这里是因为改名、换头像、换称号、换卡组最终都走这几个函数 —— 一处覆盖全部。
  // 用 typeof 守卫：存档模块不该硬依赖联机模块；未联机时 Net.refreshMe() 会安静返回。
  function notifyNet() {
    if (typeof window !== 'undefined' && window.Net && typeof window.Net.refreshMe === 'function') {
      try { window.Net.refreshMe(); } catch (e) { /* 联机层异常不该影响存盘 */ }
    }
  }
  function getPlayer() { return get().player; }
  function setPlayer(o) {
    var p = getPlayer();
    if (o && typeof o === 'object') {
      if (typeof o.name === 'string') { var nm = o.name.trim().slice(0, 12); if (nm) p.name = nm; }
      if (typeof o.avatar === 'string' && o.avatar) p.avatar = o.avatar.slice(0, 40);
      if (typeof o.title === 'string' && o.title) p.title = o.title.slice(0, 20);
    }
    save(); notifyNet(); return p;
  }
  function getPlayerName() { var p = getPlayer(); return (p && p.name) || '玩家'; }

  /* ---------------- 成就 ---------------- */
  function getAchievements() { return get().achievements || {}; }
  function hasAchievement(id) { return !!getAchievements()[id]; }
  function unlockAchievement(id) {
    var a = getAchievements();
    if (a[id]) return false;
    a[id] = Date.now(); get().achievements = a; save();
    return true;
  }

  /* ---------------- 跨局统计 ---------------- */
  function getStats() { return get().stats || {}; }
  function getStat(k, def) { var v = getStats()[k]; return typeof v === 'number' ? v : (def == null ? 0 : def); }
  function setStat(k, v) { get().stats[k] = v; save(); return v; }
  function bumpStat(k, n) { return setStat(k, getStat(k) + (n == null ? 1 : n)); }

  /* ---------------- 整档导出 / 导入 ---------------- */
  function exportAll() {
    return {
      app: '地牢决斗师-踏上征途', kind: 'dd2-save', version: 1,
      exportedAt: new Date().toISOString(),
      data: JSON.parse(JSON.stringify(get()))
    };
  }
  // 兼容两种写法：{app,data:{...}} 或直接给 data 本体
  function importAll(obj) {
    var d = (obj && obj.data) ? obj.data : obj;
    if (!d || typeof d !== 'object' || !Array.isArray(d.decks) || !d.decks.length) {
      return { ok: false, msg: '不是有效的存档文件（缺少卡组数据）' };
    }
    state = sanitize(d);
    save();
    return { ok: true, data: state };
  }

  return {
    load: load, save: save, get: get, reset: reset,
    getPlayer: getPlayer, setPlayer: setPlayer, getPlayerName: getPlayerName,
    getAchievements: getAchievements, hasAchievement: hasAchievement, unlockAchievement: unlockAchievement,
    getStats: getStats, getStat: getStat, setStat: setStat, bumpStat: bumpStat,
    exportAll: exportAll, importAll: importAll,
    activeDeck: activeDeck, setActiveDeck: setActiveDeck,
    addDeck: addDeck, updateDeck: updateDeck, removeDeck: removeDeck,
    setDifficulty: setDifficulty, getDifficulty: getDifficulty,
    setFontScale: setFontScale, getFontScale: getFontScale,
    getRankedScore: getRankedScore, setRankedScore: setRankedScore,
    setRun: setRun, getRun: getRun, clearRun: clearRun, hasRun: hasRun,
    setTour: setTour, getTour: getTour, setTourHistory: setTourHistory, getTourHistory: getTourHistory,
    getMasterHistory: getMasterHistory, addMasterRecord: addMasterRecord,
    setAcademy: setAcademy, getAcademy: getAcademy, setAcademyHistory: setAcademyHistory, getAcademyHistory: getAcademyHistory,
    setBoss: setBoss, getBoss: getBoss,
    getAudio: getAudio, setAudio: setAudio,
    getSeedText: getSeedText, setSeedText: setSeedText,
    getTutor: getTutor, setTutor: setTutor,
    isTutorAsked: isTutorAsked, markTutorAsked: markTutorAsked,
    isTutorDone: isTutorDone, markTutorDone: markTutorDone
  };
})();
