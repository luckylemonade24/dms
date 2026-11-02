/* ============================================================
 * 界面渲染与交互  ui.js
 * 布局见策划案 10.2；交互见 10.3（拖拽为主，点击为辅）
 * 通过 Engine.on(render) 订阅状态变化后全量刷新。
 * ========================================================== */
var UI = (function () {
  'use strict';

  var selected = null;   // {kind:'hand'|'board', key, iid|uid, cardId}
  var drag = null;
  var aiTimer = null;
  var AI_STEP_MS = 900;              // AI 每步间隔：留出"看清对手打出了什么牌"的时间
  var feed = [], feedBusy = false;   // 出牌横幅队列
  var viewer = null;                 // 牌库/弃牌堆查看器 {key:'A'|'B', zone:'deck'|'discard'}
  var autoSkip = false;              // 自动跳过己方回合（持续开关）
  var skipTimer = null;
  var settingsOpen = false;          // 对局设置面板展开中（避免被状态刷新覆盖）
  var pausedNotice = false;          // 自动跳过因待决提示而暂停的提醒只提示一次
  var suspendRender = false;         // 自动对战：翻转视角期间挂起渲染，避免画面抖成对手视角
  var autoBattle = null;             // 学院考核自动对战 { limit, onEnd, timer, done, stall }
  var autoPlay = false;              // 踏上征途：自动战斗（业余档 AI 代打我方）
  var autoPlayTimer = null;
  var runBattle = false;             // 当前对局是否为「踏上征途」对局（决定自动战斗按钮是否显示）
  var scaleK = 1;                    // 舞台缩放系数（表现层坐标换算用）
  var tournamentBattle = false;   // 当前对局是否为魔绫大赛（联盟赛）对局
  var masterBattle = false;       // 当前对局是否为大师赛（联机）对局
  var tutorialBattle = false;     // 当前对局是否为入学手册（新手教程）对局
  // 需要指定目标的操作模式（法杖弃牌/选目标、升级卷轴、破损纹章）
  // { mode:'wand-discard'|'wand-target'|'upgrade'|'emblem', iid, cardId, discardIid }
  var pend = null;

  function $(id) { return document.getElementById(id); }
  /* 卡定义查询。观战 / 脱敏手牌里 cardId 为空 → 返回空壳，
   * 这样各处读 .type / .name 都不会崩（真实数据由服务器权威下发）。
   * ⚠ 字段要**补全**：客户端与服务端版本不一致时（旧客户端 + 新服务端），
   *   状态里会出现本地卡表没有的新卡 id → C() 返回空壳。空壳缺哪个字段，
   *   读它的地方就崩哪（实测缺 thumb 会让 monsterEl 直接抛
   *   "Cannot read properties of undefined (reading 'thumb')"，整个战场渲染挂掉）。 */
  var EMPTY_CARD = {
    name: '未知卡', type: '', tier: '', value: 0, hp: 0, atk: 0,
    thumb: '', stem: '', effect: '', quote: '', tags: [], maxCopies: 0,
    upgradable: false, mods: {}, equip: null, sprite: ''
  };
  function C(inst) { return (inst && CARDS[inst.cardId]) || EMPTY_CARD; }

  /* ================= 屏幕缩放（等比铺满） =================
   * 移动端要点：
   *  · 优先取 visualViewport 尺寸——手机上地址栏收放 / 旋转时 innerHeight 会滞后或不准，舞台会错位留白
   *  · 旋转、地址栏收放、从后台返回都要重算（见 boot 里的监听）
   */
  function viewSize() {
    var vv = window.visualViewport;
    // 玩家双指放大中：不重算舞台，否则会把缩放"顶回去"（缩回 1 倍时会再触发一次 resize 自动复位）
    if (vv && vv.scale && vv.scale > 1.02) return null;
    return {
      w: Math.round((vv && vv.width) ? vv.width : window.innerWidth),
      h: Math.round((vv && vv.height) ? vv.height : window.innerHeight)
    };
  }
  function isTouchDevice() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || ((navigator.msMaxTouchPoints || 0) > 0);
  }

  /* ---- CSS 兜底自愈 ------------------------------------------------
   * 现象：设置里明明显示"手机布局已生效"，组卡器 / 学院商店却还是桌面版排版。
   * 原因：HTML/JS 每次打开都会被浏览器重新校验（改了就生效），CSS 却可能被本地预览服务或
   *       浏览器缓存住（甚至拿到写到一半的旧副本）—— 样式文件末尾的手机布局媒体块整段缺失，
   *       而 CSS 允许"读到一半就结束"，于是排版静默回退成桌面版，看不出任何报错。
   * 处理：翻已解析的样式表，找不到手机布局媒体块时，用带时间戳的地址把同样的 CSS 再要一遍
   *       （只做一次，正常情况零开销）。这样即使缓存里连 HTML 都是旧的，也能自愈。
   */
  function mobileCssParsed() {
    try {
      for (var i = 0; i < document.styleSheets.length; i++) {
        var rs = document.styleSheets[i].cssRules;
        if (!rs) continue;
        for (var j = 0; j < rs.length; j++) {
          var mt = (rs[j].media && rs[j].media.mediaText) || '';
          if (mt.indexOf('pointer: coarse') >= 0) return true;
        }
      }
      return false;
    } catch (e) { return null; }            // 读不到规则（以本地文件方式打开）→ 不做判断
  }
  function reloadCssOnce() {
    if (reloadCssOnce.done) return false;
    reloadCssOnce.done = true;
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      (function (l) {
        var href = l.getAttribute('href') || '';
        if (!href || /[?&]r=/.test(href)) return;
        var nl = document.createElement('link');
        nl.rel = 'stylesheet';
        nl.href = href + (href.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now() + i;
        nl.onload = function () { if (l.parentNode) l.parentNode.removeChild(l); };   // 新的解析完再摘掉旧的，避免闪一下无样式
        document.head.appendChild(nl);
      })(links[i]);
    }
    return true;
  }
  /* 竖屏提示：仅触屏设备竖着拿时显示（桌面窄窗口不打扰）。
   * 提示里唯一的按钮 = 进入全屏 —— 浏览器进全屏后自带转向，所以原先那个「画面转 90°」
   * 手动开关（#btnRot / #rhRotate + #stage.rot90）已经去掉。
   * 用户点过按钮就记住（localStorage），不再反复打扰。 */
  var ROT_SKIP_KEY = 'dd_rotate_hint_skipped';
  function rotateHintSkipped() {
    try { return localStorage.getItem(ROT_SKIP_KEY) === '1'; } catch (e) { return false; }
  }
  function skipRotateHint() {
    try { localStorage.setItem(ROT_SKIP_KEY, '1'); } catch (e) { }
    var el = $('rotateHint');
    if (el) el.classList.add('hidden');
  }
  // 竖屏提示的按钮：进全屏（浏览器全屏时会自带转向 / 允许锁横屏）。
  // 无论全屏成功与否都先记下"已知晓"并收起提示 —— iOS Safari 至今不支持 requestFullscreen，
  // 不这样做的话玩家点完按钮遮罩还在，等于点不掉。
  function rotateHintFullscreen() {
    skipRotateHint();
    enterFullscreen();
  }
  function updateRotateHint(vs) {
    var el = $('rotateHint');
    if (!el) return;
    // 开了竖屏模式就不要再提示"请把手机横过来"——那正是玩家主动关掉的东西
    var show = isTouchDevice() && vs.h > vs.w && !rotateHintSkipped() && !portraitMode;
    if (el.classList.contains('hidden') === show) el.classList.toggle('hidden', !show);
  }

  /* ================= 竖屏模式（用户手动切换） =================
   * 默认关闭 = 完全保持原来的横屏排版与行为。
   * 打开后：#stage 的设计尺寸宽高互换（720×1280），战斗界面与组卡器换成
   * 专门的竖屏排版（见 battle.css 的 #stage.portrait 段、deck.css 的
   * body.portrait-mode 段）；其余界面沿用原排版，不做特殊处理。
   * 状态存 localStorage，下次打开记住。 */
  var PORTRAIT_KEY = 'dd_portrait_mode';
  var portraitMode = false;
  try { portraitMode = (localStorage.getItem(PORTRAIT_KEY) === '1'); } catch (e) { }
  /* 己方信息栏按模式换位置：
   *   横屏（含手机紧凑布局 .phone）→ 留在战场列原位置（#myBoard 之后、#myHand 之前）。
   *     phone 布局由 CSS 自己用 grid 把它放到左列下半部分，UI 与以前完全一致。
   *   竖屏 → 搬进右栏 .sidebar（与日志并排当底部条，CSS 里两者各自绝对定位）
   * 只搬节点本身：#emotePanel 是它的子节点会一起走，绑在节点上的 onclick 也不会丢。 */
  function moveInfoRow() {
    var info = $('myInfo'), side = document.querySelector('.sidebar');
    var col = document.querySelector('.battlecol'), hand = $('myHand');
    if (!info || !side || !col || !hand) return;
    if (portraitMode) {
      if (info.parentNode !== side) side.appendChild(info);
    } else if (info.parentNode !== col) {
      col.insertBefore(info, hand);
    }
  }
  function applyPortraitClass() {
    document.body.classList.toggle('portrait-mode', !!portraitMode);
    moveInfoRow();
    var btn = $('btnRotate');
    if (btn) {
      btn.textContent = portraitMode ? '⟲' : '⟳';
      btn.title = portraitMode ? '切换回横屏' : '切换竖屏';
      btn.classList.toggle('on', !!portraitMode);
    }
  }
  function setPortraitMode(on, quiet) {
    portraitMode = !!on;
    try { localStorage.setItem(PORTRAIT_KEY, portraitMode ? '1' : '0'); } catch (e) { }
    /* 方向锁跟着切换（尽力而为，浏览器不允许时静默）：
       竖屏模式必须解除横屏锁，否则屏幕被系统钉死在横向，body 排版切了也白切；
       切回横屏时重新锁上，保持默认体验。 */
    try {
      var so = window.screen && screen.orientation;
      if (so) {
        if (portraitMode && so.unlock) so.unlock();
        else if (!portraitMode && so.lock) {
          var lp = so.lock('landscape');
          if (lp && lp.catch) lp.catch(function () { });
        }
      }
    } catch (e) { }
    applyPortraitClass();
    fitScreen();
    if (Engine.state) render(Engine.state);
    if (!quiet) { try { toast(portraitMode ? '已切换到竖屏模式' : '已切回横屏模式'); } catch (e) { } }
  }

  /* ---- 手机横屏「紧凑布局」 ----
   * 屏幕很宽而矮（横屏手机）时，16:9 的舞台只能按高度缩放（0.44 左右），左右两条大黑边白扔。
   * 于是竖屏 ≤620px 时改用紧凑布局：把玩家/对手信息栏与对手手牌挪到左侧独立一列（见 battle.css
   * 的 #stage.phone 规则），舞台的设计高度就只需 ~500px，与屏幕比例接近 → 缩放升到 0.64 上下，
   * 所有 UI 等效放大约 45%。桌面/平板视口高度 >620px，完全走原布局，不受影响。
   */
  function phoneLayout(vs) { return vs.h <= 620 && vs.w > vs.h; }
  function designH(vs) {
    if (!phoneLayout(vs)) return Rules.DESIGN_H;
    return Math.max(500, Math.min(Rules.DESIGN_H, Math.round(Rules.DESIGN_W * vs.h / vs.w)));
  }
  function fitScreen() {
    var stage = $('stage');
    if (!stage) return;
    var vs = viewSize();
    if (!vs) return;                     // 双指放大中：保持现状
    /* ★ 竖屏模式：设计尺寸宽高互换（720 宽 × 1280 高）。
       舞台宽高用内联样式覆盖 CSS 的 1280×720，其余计算与原逻辑同构。 */
    if (portraitMode) {
      var pw = Rules.DESIGN_H, ph = Rules.DESIGN_W;
      stage.classList.add('portrait');
      stage.classList.remove('phone');
      stage.style.width = pw + 'px';
      stage.style.height = ph + 'px';
      if (stage.style.setProperty) stage.style.setProperty('--ph', ph + 'px');
      var kp = Math.min(vs.w / pw, vs.h / ph);
      scaleK = kp || 1;
      stage.style.transform = 'scale(' + kp + ')';
      stage.style.left = ((vs.w - pw * kp) / 2) + 'px';
      stage.style.top = ((vs.h - ph * kp) / 2) + 'px';
      updateRotateHint(vs);
      moveInfoRow();    // 竖屏：己方信息栏搬进右栏，与日志并排
      return;
    }
    stage.classList.remove('portrait');
    if (stage.style.width) stage.style.width = '';   // 回到 CSS 里定义的 1280
    var dh = designH(vs);
    if (phoneLayout(vs)) {
      stage.classList.add('phone');
      stage.style.height = dh + 'px';
      if (stage.style.setProperty) stage.style.setProperty('--ph', dh + 'px');   // 供 CSS 算右栏高清图上限（见 battle.css）
    } else {
      stage.classList.remove('phone');
      stage.style.height = '';
      if (stage.style.removeProperty) stage.style.removeProperty('--ph');
    }
    // 设计宽适配视口宽、设计高适配视口高，取小者等比缩放，再居中摆放
    var k = Math.min(vs.w / Rules.DESIGN_W, vs.h / dh);
    scaleK = k || 1;
    stage.style.transform = 'scale(' + k + ')';
    stage.style.left = ((vs.w - Rules.DESIGN_W * k) / 2) + 'px';
    stage.style.top = ((vs.h - dh * k) / 2) + 'px';
    updateRotateHint(vs);
    moveInfoRow();      // 竖屏/横屏切换后把己方信息栏搬回对应位置
  }

  /* ================= 全屏（手机画面太小的主要补救手段） =================
   * 舞台是按屏高等比缩放的：手机横屏时屏高被浏览器地址栏吃掉一部分，缩放被压到 ~0.44。
   * 全屏后地址栏消失，屏高变高 → 同一套布局自动放大约 20~25%（见 fitScreen 的重算）。
   */
  function fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function fsSupported() {
    var el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }
  /* 强制横屏（尽力而为）：浏览器只允许"全屏状态下"锁方向，且要用户操作触发。
   * Chrome / Edge Android 支持；iOS Safari 不支持 → 失败静默，靠竖屏提示兜底。
   * 已"添加到主屏幕"的情况由 manifest 的 orientation:landscape 直接搞定，不依赖这段。 */
  function lockLandscape() {
    try {
      var so = window.screen && screen.orientation;
      if (!so || !so.lock) return;
      var p = so.lock('landscape');
      if (p && p.catch) p.catch(function () { });
    } catch (e) { }
  }
  function toggleFullscreen() {
    var el = document.documentElement;
    var p = null;
    try {
      if (fsEl()) p = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else { p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el); if (!portraitMode) lockLandscape(); }
    } catch (e) { }
    if (p && p.catch) p.catch(function () { });
    setTimeout(fitScreen, 120); setTimeout(fitScreen, 480);   // 进出全屏后屏高会变 → 重新缩放
  }
  /* 只进不出（竖屏提示用）。已在全屏时只重算缩放，不做退出 ——
   * 提示上的按钮语义是"进入全屏横屏"，不该把它变成一个开关。 */
  function enterFullscreen() {
    if (fsEl()) { setTimeout(fitScreen, 120); return; }
    var el = document.documentElement, p = null;
    try { p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el); if (!portraitMode) lockLandscape(); } catch (e) { }
    if (p && p.catch) p.catch(function () { });
    setTimeout(fitScreen, 120); setTimeout(fitScreen, 480);
  }
  var fsHinted = false;
  function maybeHintFullscreen() {
    if (fsHinted || !isTouchDevice() || !fsSupported() || fsEl()) return;
    fsHinted = true;
    setTimeout(function () { toast('手机画面小？点右上角「全屏」可再放大约 20%'); }, 1200);
  }
  /* ---- 手机端"默认全屏" ----
   * 浏览器不允许页面自己在加载时进全屏（防滥用），必须借一次用户操作。
   * 于是第一次触摸/点击时自动请求一次全屏；玩家自己退出过就不再自动请求（本页内有效）。
   * 全屏后地址栏消失、屏高变大，舞台缩放会从 ~0.44 提到 ~0.55，整体更清楚。 */
  var autoFsTried = false, autoFsOff = false;
  function tryAutoFullscreen() {
    if (autoFsTried || autoFsOff) return;
    if (!isTouchDevice() || !fsSupported() || fsEl()) return;
    autoFsTried = true;
    enterFullscreen();
  }
  document.addEventListener('fullscreenchange', function () {
    if (!fsEl() && autoFsTried) autoFsOff = true;      // 手动退出过 → 本页不再自动进全屏
  });

  /* ================= 主菜单 ================= */
  var battleResolved = false;   // 对局结果是否已被玩家确认（避免弹窗反复出现）

  function showMenu() {
    $('menu').classList.remove('hidden');
    $('battle').classList.add('hidden');
    if ($('deck')) $('deck').classList.add('hidden');
    if ($('map')) $('map').classList.add('hidden');
    if ($('tour')) $('tour').classList.add('hidden');
    if ($('academy')) $('academy').classList.add('hidden');
    if ($('boss')) $('boss').classList.add('hidden');
    if ($('runpanel')) { $('runpanel').classList.add('hidden'); $('runpanel').innerHTML = ''; }
    if ($('master')) $('master').classList.add('hidden');
    tournamentBattle = false;
    masterBattle = false;
    if (tutorialBattle) tutorialBattle = false;
    if (window.TutorialUI) TutorialUI.close();   // 入学手册：关闭教练面板
    stopAI();
    autoSkip = false; settingsOpen = false; viewer = null;
    stopAutoSkip();
    autoPlay = false; stopAutoPlay(); runBattle = false;   // 自动战斗：离开对局即关闭
    AI.setDifficulty(SaveData.getDifficulty());            // 兜底：学院固定专业档，离开学院/回到主菜单时恢复玩家难度
    if (autoBattle) { stopAutoTimer(); autoBattle = null; }
    feed = []; feedBusy = false;
    var pf = $('playFeed'); if (pf) pf.innerHTML = '';
    refreshMenu();
  }
  function showBattle() {
    $('menu').classList.add('hidden');
    if ($('master')) $('master').classList.add('hidden');   // 联机对局：把大师赛面板收起，否则会盖住对战界面
    if ($('tour')) $('tour').classList.add('hidden');
    if ($('academy')) $('academy').classList.add('hidden');
    if ($('boss')) $('boss').classList.add('hidden');
    applyBattleBg();                      // 每场随机换一张同类场景背景图
    $('battle').classList.remove('hidden');
    fitScreen();
    lastTurnShown = ''; lastTurnSeen = 0;   // 新对局：让"第 x 回合"提示重新开始放
    maybeHintFullscreen();                // 触屏首次进对局：提示可全屏放大
  }

  /* ---------------- 局内背景：同系列像素场景图，每场按概率随机 ---------------- */
  // 第一项为权重（相对概率）：数值越大出现越多。同一套画风的场景图共 4 张
  // （洞窟 / 城市 / 大厅 / 监狱，都是 1280×720、51~66 色的像素场景）。
  // 背景/ 里另有 forest.png、major.png（280/189 色的绿色写实风）与 木板.png、UI板-sewer.png（纯 UI 素材），
  // 想要就按同样格式往数组里加一行即可。
  var BATTLE_BGS = [
    ['背景/caves_background.png', 1],
    ['背景/city_background.png', 1],
    ['背景/halls_background.png', 1],
    ['背景/prison_background.png', 1]
  ];
  /* ⚠ 局内背景的**暗色叠层由这里决定**（`applyBattleBg` 会覆盖 #battle 的 background-image），
     改 style.css 里的 .82 是没用的 —— 2026-10-25 就是因为这个，玩家反馈"战斗界面没变化"。
     要调亮度改这一个数：越小越亮。 */
  var BATTLE_BG_SHADE = 0.25;
  var lastBg = null;
  function pickBattleBg() {
    var total = 0, i;
    for (i = 0; i < BATTLE_BGS.length; i++) total += BATTLE_BGS[i][1];
    var pick = null;
    for (var tryN = 0; tryN < 2; tryN++) {           // 至多抽两次：第二次是为了尽量不与上一场重复
      var r = Math.random() * total;
      pick = BATTLE_BGS[BATTLE_BGS.length - 1][0];
      for (i = 0; i < BATTLE_BGS.length; i++) { r -= BATTLE_BGS[i][1]; if (r < 0) { pick = BATTLE_BGS[i][0]; break; } }
      if (pick !== lastBg || BATTLE_BGS.length === 1) break;
    }
    return pick;
  }
  function applyBattleBg() {
    var el = $('battle');
    if (!el) return;
    var url = pickBattleBg();
    lastBg = url;
    // 暗色叠层用 BATTLE_BG_SHADE（与 style.css 的默认值保持一致）；位置/裁切沿用 center/cover no-repeat
    el.style.backgroundImage = 'linear-gradient(rgba(8,8,10,' + BATTLE_BG_SHADE + '), rgba(8,8,10,' +
      BATTLE_BG_SHADE + ')), url("' + url + '")';
  }

  function refreshMenu() {
    var md = $('menuDeck');
    if (md) {
      var d = SaveData.activeDeck();
      var v = DeckRules.validateStarter(d.cardIds);
      md.textContent = '当前卡组：' + d.name + '（' + d.cardIds.length + ' 张）' + (v.ok ? '' : ' ⚠ ' + v.errors[0]);
      md.className = 'sub deckinfo' + (v.ok ? '' : ' warn');
    }
    var bc = $('btnContinue');
    if (bc) bc.className = 'mbtn' + (SaveData.hasRun() ? '' : ' disabled');
    if (window.ProfileUI) ProfileUI.refresh();          // 人物系统：头像 / 名称 / 称号
  }

  function diffHp(d) { return ({ novice: 28, amateur: 32, pro: 34, champion: 36 })[d] || 28; }
  function diffNameOf(d) { return ({ novice: '新手', amateur: '业余', pro: '专业', champion: '冠军' })[d] || '新手'; }

  // 开始跑图：以当前卡组建立新跑图
  function startRun() {
    var d = SaveData.activeDeck();
    var v = DeckRules.validateStarter(d.cardIds);
    if (!v.ok) { toast('卡组不合法：' + v.errors[0] + '（请进入组卡器调整）'); return; }
    Sfx.play('click');
    var st = SaveData.getSeedText().trim();
    var seed = st === '' ? null : st;
    RunManager.newRun(d.cardIds, SaveData.getDifficulty(), Rules.PLAYER_HP, seed);
    var r = RunManager.get();
    toast(seed == null ? ('随机种子：' + r.seed) : ('指定种子：' + r.seed));
    RunUI.showMap();
  }
  // 继续存档：恢复跑图地图
  function continueRun() {
    var r = RunManager.load();
    if (!r || !RunManager.isActive()) { toast('暂无存档'); return; }
    Sfx.play('click');
    RunUI.showMap();
  }

  // 由 RunUI 调用：按跑图参数开局战斗
  function startBattle(opts) {
    opts = opts || {};
    AI.setDifficulty(opts.diff || SaveData.getDifficulty());
    /* ★ 根治「把 PVP 的东西带进 PVE」：只要这一局不是大师赛联机局，进来先清掉
     *   Net 的联机 / 观战标志。否则在大师赛观过战之后 netSpectator 残留，
     *   被改写的 Engine.tryAction 会静默忽略一切操作 —— 表现就是"观战完回联盟赛，
     *   开始 PVE 后显示观战状态、点什么都没反应"。 */
    if (!opts.master && window.Net && Net.setNetBattle) Net.setNetBattle(false);
    tournamentBattle = !!opts.tournament;
    masterBattle = !!opts.master;           // 大师赛（联机）对局：结算后回到房间
    tutorialBattle = !!opts.tutorial;          // 入学手册对局：结算弹窗交给教程面板
    runBattle = !!opts.run;                    // 踏上征途对局：顶栏显示"自动战斗"按钮
    Engine.newGame({
      playerDeck: (opts.playerDeck || SaveData.activeDeck().cardIds).slice(),
      aiDeck: (opts.aiDeck || PRESET_DECKS.raider).slice(),
      playerHp: opts.playerHp,
      playerMax: opts.playerMax,
      aiHp: opts.aiHp || diffHp(SaveData.getDifficulty()),
      aiName: opts.aiName || '对手',
      playerName: opts.playerName || SaveData.getPlayerName(),   // 玩家名称（人物系统）
      tutorial: !!opts.tutorial,                 // 教程局：牌库空提示静默（见 engine.js 的 draw）
      mode: opts.mode || 'battle',               // 供成就系统区分模式（run / tour / academy / tutorial / boss）
      achOff: !!opts.achOff,
      seed: opts.seed,
      first: opts.first,
      maxRounds: opts.maxRounds,                 // 晋升之路：每关回合上限（缺省用 Rules.MAX_ROUNDS）
      boss: opts.boss || null,                   // 晋升之路：预置 BOSS（对手中位）
      bodyLock: !!opts.bodyLock,                 // 晋升之路：对手本体锁血
      bossHooks: opts.bossHooks || null          // 晋升之路：BOSS 技能钩子
    });
    selected = null; pend = null; battleResolved = false;
    autoSkip = false; settingsOpen = false; viewer = null; feed = []; feedBusy = false;
    stopAutoSkip();
    if ($('playFeed')) $('playFeed').innerHTML = '';
    showBattle();
    render(Engine.state);
  }

  /* 联机对局（大师赛）：状态已经由 net.js 的 Engine.load() 装进引擎，这里只负责切到对战界面。
   * 对手是真人 → 不启动本地 AI 定时器（此时 Engine.tryAction 也已改道到服务器）。 */
  function startNetBattle() {
    tournamentBattle = false;
    masterBattle = true;                     // 结算后回房间
    tutorialBattle = false;
    runBattle = false;
    autoBattle = null; autoPlay = false;
    selected = null; pend = null; battleResolved = false;
    autoSkip = false; settingsOpen = false; viewer = null; feed = []; feedBusy = false;
    stopAutoSkip(); stopAI(); stopAutoPlay();
    if ($('playFeed')) $('playFeed').innerHTML = '';
    showBattle();
    // 观战者：盖一层遮罩，界面上的点击/拖拽一律不再响应（服务端也会拒绝，这里是双保险）
    if ($('specMask')) $('specMask').classList.toggle('hidden', !(window.Net && Net.isSpectator && Net.isSpectator()));
    render(Engine.state);
  }

  /* ================= 回合提示：战场中央"第 x 回合"淡入淡出 ================= */
  var lastTurnShown = '', lastTurnSeen = 0;
  // 摆放位置：以"两块怪物区的外框中心"为准。
  // 舞台整宽居中会偏右 —— 桌面端右栏固定占 320px，手机紧凑布局左栏占 196px，两边不对称。
  function bannerAnchor() {
    var stg = $('stage'); if (!stg) return null;
    var s = stg.getBoundingClientRect();
    if (!s.width) return null;
    var l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
    ['oppBoard', 'centerZone', 'myBoard'].forEach(function (id) {
      var e = $(id); if (!e) return;
      var q = e.getBoundingClientRect();
      if (!q.width && !q.height) return;
      l = Math.min(l, q.left); r = Math.max(r, q.right);
      t = Math.min(t, q.top); b = Math.max(b, q.bottom);
    });
    if (l === Infinity) return null;
    /* 舞台等比缩放的倍率。⚠ 不能写死 Rules.DESIGN_W —— 竖屏模式下舞台设计宽度是
       DESIGN_H(720)，写死会把坐标算大 1.78 倍，"第 x 回合"横幅直接飞出屏幕。 */
    var pw = parseFloat(stg.style.width) || Rules.DESIGN_W;
    var k = s.width / pw;
    if (!k) return null;
    return { x: ((l + r) / 2 - s.left) / k, y: ((t + b) / 2 - s.top) / k };
  }
  function showTurnBanner(s) {
    var el = $('turnBanner');
    if (!el || !s || s.winner) return;
    if ($('battle').classList.contains('hidden')) return;   // 只在战场上提示
    var tc = (s.turnCount != null) ? s.turnCount : 0;
    // 只有"紧接上一步 +1"的推进才算刚开一个新回合：
    // 否则中途补渲染（例如 AI 对打几回合后才第一次 render）会蹦出"第 6 回合"这种怪数字
    var fresh = (tc === lastTurnSeen + 1);
    lastTurnSeen = tc;
    if (!fresh) return;
    if (s.active !== 'A') return;                           // 只在"自己回合开始"时提示
    var key = String(tc);
    if (key === lastTurnShown) return;                      // 同一次回合只放一次（render 会被反复调用）
    lastTurnShown = key;
    var a = bannerAnchor();
    if (a) { el.style.left = a.x + 'px'; el.style.top = a.y + 'px'; }
    el.textContent = '第 ' + s.round + ' 回合';
    el.classList.remove('show');
    void el.offsetWidth;                                    // 强制回流，让动画能重新触发
    el.classList.add('show');
  }

  /* ================= 赛后：本轮输出排行 =================
   * 数据来自引擎的伤害归因记账 state.dmgBy（只统计"怪物卡攻击"产生的伤害：
   * 主动攻击 + 攻击附带的追加伤害 + 打脸；投掷物 / 法杖 / 毒气 / 炸弹不计入）。
   * 列表单独包一层 .ds-list 并限高滚动：排行再长也不会把弹窗撑高，
   * 底部的按钮位置固定（手机上手点得到）。 */
  function dmgStatHtml(by) {
    by = by || {};
    var rows = [];
    Object.keys(by).forEach(function (id) {
      var d = by[id] || 0;
      if (d <= 0) return;
      var cd = CARDS[id] || null;
      rows.push({ id: id, name: cd ? cd.name : id, tier: (cd && cd.tier) || '', dmg: d });
    });
    if (!rows.length) return '';
    rows.sort(function (a, b) { return b.dmg - a.dmg; });
    var nameN = {};                       // 同名不同版本（如 C 级/B 级「战士」）→ 加等级后缀区分
    rows.forEach(function (r) { nameN[r.name] = (nameN[r.name] || 0) + 1; });
    var total = 0; rows.forEach(function (r) { total += r.dmg; });
    var h = '<div class="dmgstat"><div class="ds-t">本轮输出排行<span>我方怪物卡 · 合计 ' + total + '</span></div><div class="ds-list">';
    rows.forEach(function (r, i) {
      var pct = total ? Math.max(2, Math.round(r.dmg / total * 100)) : 0;
      var nm = r.name + ((nameN[r.name] > 1 && r.tier) ? '（' + r.tier + '级）' : '');
      h += '<div class="ds-row">' +
        '<span class="ds-no">' + (i + 1) + '</span>' +
        '<span class="ds-name" data-tip="' + r.id + '">' + nm + '</span>' +
        '<span class="ds-bar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="ds-val">' + r.dmg + '<em>' + pct + '%</em></span></div>';
    });
    h += '</div><div class="ds-note">仅统计怪物卡攻击造成的伤害（不含投掷物 / 法杖 / 毒气 / 炸弹）</div></div>';
    return h;
  }

  /* ================= 渲染 ================= */
  /* 联机延迟（对局右上角）：只在自己连着服务器、且处于对局中时显示。
   * 阈值：<80ms 绿（顺滑）/ <180ms 黄（有感觉但可接受）/ 其余红（明显延迟）。 */
  function renderPing(ms) {
    var el = $('netPing');
    if (!el) return;
    var online = !!(window.Net && Net.isOnline && Net.isOnline());
    // 只在【联机对局中】显示：用 Net.inNetBattle() 而不是 Engine.state，
    // 否则单机对局/退到菜单残局时也会挂一个无意义的 "--"。
    var inBattle = !!(window.Net && Net.inNetBattle && Net.inNetBattle());
    var v = (typeof ms === 'number') ? ms : ((window.Net && Net.latency) ? Net.latency() : -1);
    if (!online || !inBattle || v < 0) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden', 'ok', 'mid', 'bad');
    el.classList.add(v < 80 ? 'ok' : (v < 180 ? 'mid' : 'bad'));
    var tv = $('netPingVal');
    if (tv) tv.textContent = v;
  }
  /* 排位赛回合计时（右上角）：服务器下发本回合截止时间戳，这里只按秒刷新。
   * ⚠ 只在 Net.isRanked() 为真（排位房）时显示；好友房 / PvE 的 deadline 恒为 0。
   * 服务端到点会自动结束回合，客户端只负责显示，不参与判定。 */
  var rankTickTimer = null;
  function renderRankTimer() {
    var el = $('rankTimer');
    if (!el) return;
    var ranked = !!(window.Net && Net.isRanked && Net.isRanked());
    var dl = (window.Net && Net.deadline) ? Net.deadline() : 0;
    if (!ranked || !dl) { el.classList.add('hidden'); return; }
    var left = Math.max(0, Math.ceil((dl - Date.now()) / 1000));
    el.classList.remove('hidden', 'warn', 'danger');
    if (left <= 10) el.classList.add('danger');
    else if (left <= 20) el.classList.add('warn');
    el.textContent = '⏱ ' + left + 's';
  }
  function startRankTick() {
    if (rankTickTimer) return;
    rankTickTimer = setInterval(renderRankTimer, 250);
  }
  function render(s) {
    if (!s) return;
    renderPing();                                  // 联机对局：右上角延迟
    renderRankTimer();                             // 排位赛：回合计时
    renderTopbar(s);
    renderOpponent(s);
    renderMine(s);
    renderCenter(s);
    showTurnBanner(s);
    renderLog(s);
    renderViewerPanel(s);
    // 观战遮罩：观战时盖住对局界面（点击/拖拽都被接住）；结算时收起，好让"返回房间"能点
    if ($('specMask')) {
      var specNow = !!(window.Net && Net.isSpectator && Net.isSpectator());
      $('specMask').classList.toggle('hidden', !specNow || !!s.winner);
    }
    processEvents(s);
    syncEmoteBtn(s);                 // PVP 快捷对话按钮：仅在线 PvP 且未分胜负时显示
    renderModal(s);
    applyPendHighlight(s);
    scheduleAI(s);
    tickAutoSkip(s);
    tickAutoPlay(s);
  }

  /* ================= 目标选择模式高亮 ================= */
  function canUpgradeMonster(m) {
    if (!m) return false;
    if (m.weapon && CARDS[m.weapon.cardId].upgradable && m.weapon.level < 2) return true;
    if (m.armor && CARDS[m.armor.cardId].upgradable && m.armor.level < 2) return true;
    return false;
  }
  function canUpgradeWand(p) { return !!(p.wand && CARDS[p.wand.cardId].upgradable && p.wand.level < 2); }

  function applyPendHighlight(s) {
    // 每次渲染先清除所有目标高亮，避免任何模式（如升级卷轴的法杖栏）残留
    var marked = document.querySelectorAll('.targetable');
    for (var mi = 0; mi < marked.length; mi++) marked[mi].classList.remove('targetable');
    if (!pend) return;
    var p = s.players.A;
    if (pend.mode === 'chest-discard') {
      // 黄金宝箱：选择要弃置的手牌（不能选宝箱自身）
      document.querySelectorAll('#myHand .card').forEach(function (n) {
        if (+n.dataset.iid !== pend.iid) n.classList.add('targetable');
      });
    } else if (pend.mode === 'wand-discard') {
      var needWandOnly = wandNeedsAbsorb();
      document.querySelectorAll('#myHand .card').forEach(function (n) {
        var iid = +n.dataset.iid;
        var c = p.hand.filter(function (x) { return x.iid === iid; })[0];
        if (!needWandOnly || (c && C(c).type === 'wand')) n.classList.add('targetable');
      });
    } else if (pend.mode === 'void-src') {
      document.querySelectorAll('.monster').forEach(function (n) { n.classList.add('targetable'); });
    } else if (pend.mode === 'cup-target') {
      document.querySelectorAll('#myBoard .monster').forEach(function (n) { n.classList.add('targetable'); });
    } else if (pend.mode === 'void-dst') {
      var sel = pend.srcKey === 'A' ? '#myBoard' : '#oppBoard';
      document.querySelectorAll(sel + ' .cell.empty').forEach(function (n) { n.classList.add('targetable'); });
    } else if (pend.mode === 'emblem') {
      // 破损纹章：可选 手牌中的防具卡 或 已装备防具的己方怪物（已贴过纹章的不再高亮：同一防具限 1 张）
      document.querySelectorAll('#myHand .card').forEach(function (n) {
        var iid = +n.dataset.iid;
        var c = p.hand.filter(function (x) { return x.iid === iid; })[0];
        if (c && C(c).type === 'armor' && !(c.flags && c.flags.emblemReduce > 0)) n.classList.add('targetable');
      });
      document.querySelectorAll('#myBoard .monster').forEach(function (n) {
        var mm = Engine.findMonster('A', +n.dataset.uid);
        if (mm && mm.armor && !(mm.armor.flags && mm.armor.flags.emblemReduce > 0)) n.classList.add('targetable');
      });
    } else if (pend.mode === 'upgrade') {
      document.querySelectorAll('#myBoard .monster').forEach(function (n) {
        if (canUpgradeMonster(Engine.findMonster('A', +n.dataset.uid))) n.classList.add('targetable');
      });
      if (canUpgradeWand(p)) $('wandSlot').classList.add('targetable');
    } else if (pend.mode === 'wand-target') {
      document.querySelectorAll('#oppBoard .monster').forEach(function (n) { n.classList.add('targetable'); });
      // 冲击波法杖：己方怪物同样是合法目标，要一起高亮
      if (wandAllowSelfTarget()) document.querySelectorAll('#myBoard .monster').forEach(function (n) { n.classList.add('targetable'); });
    } else if (pend.mode === 'mirror') {
      // 镜像卷轴：只能选我方怪物作为复制目标
      document.querySelectorAll('#myBoard .monster').forEach(function (n) { n.classList.add('targetable'); });
    }
  }

  function cancelPend(msg) {
    if (!pend) return;
    pend = null; selected = null;
    if (msg) toast(msg);
    render(Engine.state);
  }

  function renderTopbar(s) {
    // 顶部遗物栏：玩家神器
    if ($('seedInfo')) $('seedInfo').textContent = s.seed ? ('种子 ' + s.seed) : '';
    var bar = $('relicBar');
    bar.innerHTML = '';
    var arts = s.players.A.artifacts;
    // 先见护符：对方手牌含有陷阱卡时，遗物图标红光提示
    var oppHasTrap = s.players.B.hand.some(function (c) { return C(c).type === 'trap'; });
    if (!arts.length) { bar.innerHTML = '<span class="dim">遗物栏（空）</span>'; }
    arts.forEach(function (a) {
      var d = document.createElement('div');
      d.className = 'relic';
      d.innerHTML = '<img src="' + cardThumb(C(a)) + '">';
      d.title = C(a).name + '：' + C(a).effect;
      if (a.cardId === 'a-070-2') {          // 先见护符：红光提示对方手牌中有陷阱
        if (oppHasTrap) { d.classList.add('relic-alert'); d.title += '（红光：对方手牌中有陷阱卡！）'; }
        else d.title += '（对方手牌中没有陷阱卡）';
      }
      onHoverPreview(d, function () { previewCard(C(a)); });
      if (a.cardId === 'a-094-2') {   // 虚空锁链：点击发动
        d.classList.add('relic-btn');
        d.addEventListener('click', function () { startVoidChain(); });
      }
      if (a.cardId === 'a-120-2') {   // 时光沙漏：点击发动（冷却中置灰并提示剩余回合）
        d.classList.add('relic-btn');
        var cdLeft = (a.flags && a.flags.cd) || 0;
        if (cdLeft > 0) { d.classList.add('relic-cd'); d.title += '（冷却中：还需 ' + cdLeft + ' 回合）'; }
        d.addEventListener('click', function () { startTimeStop(); });
      }
      if (a.cardId === 'a-139-02') {  // 蓄血圣杯：点击发动（准备阶段，每回合一次 / 每只怪一次）
        d.classList.add('relic-btn');
        if (s.players.A.flags.artifactCupUsed) { d.classList.add('relic-cd'); d.title += '（本回合已使用）'; }
        d.addEventListener('click', function () { startCup(); });
      }
      /* 无序魔典 a-159-02 / 炼金工具箱 a-160-02：点击发动（冷却 5 回合，会消耗对应种类使用次数） */
      if (a.cardId === 'a-159-02' || a.cardId === 'a-160-02') {
        d.classList.add('relic-btn');
        var tomeKind = a.cardId === 'a-159-02' ? 'scroll' : 'potion';
        var tomeCd = (a.flags && a.flags.cd) || 0;
        if (tomeCd > 0) { d.classList.add('relic-cd'); d.title += '（冷却中：还需 ' + tomeCd + ' 回合）'; }
        d.addEventListener('click', function () { startTome(tomeKind); });
      }
      bar.appendChild(d);
    });
    // 设置按钮同时显示"自动跳过"状态
    var bs = $('battleSetBtn');
    if (bs) {
      bs.textContent = autoSkip ? '设置 · 自动跳过中' : '设置';
      bs.className = 'pxbtn small' + (autoSkip ? ' on' : ' ghost');
    }
    // 全屏按钮：仅触屏设备显示（桌面浏览器窗口本身就是满的，不需要）
    var fb = $('battleFsBtn');
    if (fb) {
      fb.classList.toggle('hidden', !isTouchDevice() || !fsSupported());
      fb.textContent = fsEl() ? '退出全屏' : '全屏';
    }
  }

  /* ================= 牌库 / 弃牌堆查看器（右栏，不遮挡战场） ================= */
  var TYPE_ORDER = ['monster', 'treasure', 'throw', 'food', 'potion', 'wand', 'trap', 'ring', 'artifact', 'weapon', 'armor', 'scroll'];
  function openViewer(key, zone) {
    viewer = { key: key, zone: zone };
    render(Engine.state);
  }
  function closeViewer() { viewer = null; render(Engine.state); }
  function renderViewerPanel(s) {
    var panel = $('viewer'), logbox = $('logbox');
    if (!panel || !logbox) return;
    if (!viewer) { panel.classList.add('hidden'); logbox.classList.remove('hidden'); return; }
    panel.classList.remove('hidden'); logbox.classList.add('hidden');
    var p = s.players[viewer.key], zone = viewer.zone;
    var cards = (zone === 'deck' ? p.deck : p.discard).slice();
    var isDeck = zone === 'deck';
    var who = viewer.key === 'A' ? '我方' : '对手';
    var h = '<div class="vw-head"><span class="vw-title">' + who + (isDeck ? '牌库' : '弃牌堆') + '（' + cards.length + '）</span>' +
      '<span class="vw-tabs">' +
      '<button class="vw-tab' + (isDeck ? ' on' : '') + '" data-vw="deck">牌库</button>' +
      '<button class="vw-tab' + (!isDeck ? ' on' : '') + '" data-vw="discard">弃牌堆</button>' +
      '</span><button class="vw-x" id="vwClose" title="关闭">✕</button></div>' +
      '<div class="vw-hint">' + (isDeck ? '按卡名归类 · 不显示牌顺序' : '按进入弃牌堆的先后顺序') + '</div>';
    if (!cards.length) h += '<div class="vw-empty">（空）</div>';
    else if (isDeck) {
      var map = {}, ord = {};
      cards.forEach(function (c) { map[c.cardId] = (map[c.cardId] || 0) + 1; });
      var ids = Object.keys(map).sort(function (a, b) {
        var ca = CARDS[a], cb = CARDS[b];
        var ta = TYPE_ORDER.indexOf(ca.type), tb = TYPE_ORDER.indexOf(cb.type);
        if (ta !== tb) return ta - tb;
        if ((ca.tier || 'Z') !== (cb.tier || 'Z')) return (ca.tier || 'Z') < (cb.tier || 'Z') ? -1 : 1;
        return ca.name < cb.name ? -1 : 1;
      });
      h += '<div class="vw-grid">';
      ids.forEach(function (id) {
        var cd = CARDS[id];
        h += '<div class="vw-card" data-tip="' + id + '" title="' + cd.name + '"><img src="' + cardThumb(cd) + '">' +
          '<span class="vc-n">×' + map[id] + '</span><span class="vc-name">' + cd.name + '</span></div>';
      });
      h += '</div>';
    } else {
      h += '<div class="vw-grid">';
      cards.forEach(function (c, i) {
        var cd = C(c);
        var vwAw = c.awaken || null;
        h += '<div class="vw-card" data-tip="' + c.cardId + '"' + (vwAw ? ' data-tip-aw="' + vwAw + '"' : '') + ' title="' + cd.name + '"><span class="vc-ord">' + (i + 1) + '</span>' +
          '<img src="' + cardThumb(cd) + '"><span class="vc-name">' + cd.name + (c.level ? ' Lv' + c.level : '') + (c.star > 1 ? ' ★' + c.star : '') + '</span></div>';
      });
      h += '</div>';
    }
    panel.innerHTML = h;
    Array.prototype.forEach.call(panel.querySelectorAll('.vw-card'), function (el) {
      onHoverPreview(el, function () { previewCard(CARDS[el.dataset.tip], null, el.dataset.tipAw); });
      // 触屏：手机上查看器会盖住右栏预览 → 用浮窗显示高清详情图（点别处自动收起）
      el.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse') return;
        CardTip.show(el.dataset.tip, e.clientX, e.clientY);
      });
    });
    Array.prototype.forEach.call(panel.querySelectorAll('[data-vw]'), function (b) {
      b.onclick = function () { Sfx.play('click'); viewer.zone = b.dataset.vw; render(Engine.state); };
    });
    if ($('vwClose')) $('vwClose').onclick = function () { Sfx.play('click'); closeViewer(); };
  }

  function renderOpponent(s) {
    var p = s.players.B;
    $('oppName').textContent = p.name;
    $('oppHP').textContent = 'HP ' + p.hp + '/' + p.maxHp;
    $('oppHP').classList.toggle('neg', p.hp < 0);                   // 学院考核血量可为负
    $('oppHPBar').style.width = Math.max(0, 100 * p.hp / p.maxHp) + '%';
    $('oppDeck').textContent = '牌库 ' + p.deck.length;
    $('oppHandCount').textContent = '手牌 ' + p.hand.length;
    if ($('oppDiscard')) $('oppDiscard').textContent = '弃牌 ' + p.discard.length;
    $('oppStatus').innerHTML = statusChips(p);
    // 对手手牌：卡背横排
    var oh = $('oppHand'); oh.innerHTML = '';
    p.hand.forEach(function () {
      var d = document.createElement('div'); d.className = 'cardback';
      d.innerHTML = '<img src="卡牌/缩略卡/卡背2.png">';
      oh.appendChild(d);
    });
    // 对手怪物区
    renderBoard($('oppBoard'), s, 'B');
  }

  function renderMine(s) {
    var p = s.players.A;
    // 人物系统：己方信息栏显示玩家名称（悬停可见称号）
    var nmEl = $('myName');
    if (nmEl) {
      nmEl.textContent = p.name;
      nmEl.title = (window.ProfileUI ? ProfileUI.playerTitle() : '');
    }
    $('myHP').textContent = 'HP ' + p.hp + '/' + p.maxHp;
    $('myHP').classList.toggle('neg', p.hp < 0);                    // 学院考核血量可为负
    $('myHPBar').style.width = Math.max(0, 100 * p.hp / p.maxHp) + '%';
    $('myDeck').textContent = '牌库 ' + p.deck.length;
    $('myHandCount').textContent = '手牌 ' + p.hand.length;
    $('myDiscard').textContent = '弃牌 ' + p.discard.length;
    renderBoard($('myBoard'), s, 'A');
    // 法杖栏
    var ws = $('wandSlot');
    ws.innerHTML = '';
    ws.dataset.drop = 'wand';
    if (p.wand) {
      var d = document.createElement('div'); d.className = 'wandcard';
      d.innerHTML = '<img src="' + cardThumb(C(p.wand)) + '"><span class="wl">' + (p.wand.level ? 'Lv' + p.wand.level : '') + '</span>';
      onHoverPreview(d, function () { previewCard(C(p.wand)); });
      ws.appendChild(d);
    } else {
      ws.innerHTML = '<span class="dim">法杖栏</span>';
    }
    $('castInfo').textContent = '施法 ' + p.castsLeft;
    // 召唤次数：受冰霜药水影响时闪蓝（本回合 -N / 下回合待生效）
    var si = $('summonInfo');
    var iceNow = (s.active === 'A' && p.summonsLeft < Rules.SUMMON_PER_TURN);
    var iceNext = p.flags.summonDebuff || 0;
    si.textContent = '召唤 ' + p.summonsLeft + (iceNow ? ' ❄' : '') + (iceNext ? ' ❄-' + iceNext + '↓' : '');
    si.className = 'stat' + ((iceNow || iceNext) ? ' ice' : '');
    // 己方手牌
    var mh = $('myHand'); mh.innerHTML = '';
    p.hand.forEach(function (card) {
      // 观战 / 脱敏手牌（cardId 为空）→ 显示卡背，避免看到别人手牌
      if (!CARDS[card.cardId]) {
        var back = document.createElement('div');
        back.className = 'cardback';
        back.innerHTML = '<img src="卡牌/缩略卡/卡背2.png">';
        mh.appendChild(back);
        return;
      }
      mh.appendChild(handCardEl(card, s));
    });
    // 状态条（毒气/酸气/腐烂）
    var st = $('myStatus');
    st.innerHTML = statusChips(p);
  }

  // 状态标签。data-stat / data-side / data-n 供悬停（桌面）与按住（触屏）时弹出效果说明，
  // 见 statTipOf()。带数字的状态一律把数字写进 data-n，浮窗会给出"按当前层数的实际结算"。
  function statusChips(p) {
    var h = '';
    function chip(cls, stat, label, n) {
      return '<span class="chip ' + cls + '" data-stat="' + stat + '" data-side="' + p.key + '"' +
        (n != null ? ' data-n="' + n + '"' : '') + '>' + label + '</span>';
    }
    if (p.poison > 0) h += chip('poison', 'poison', '毒气×' + p.poison, p.poison);
    if (p.acid > 0) h += chip('acid', 'acid', '酸气×' + p.acid, p.acid);
    if (p.rotMarks > 0) h += chip('rot', 'rot', '腐烂×' + p.rotMarks, p.rotMarks);
    return h;
  }

  /* ================= 状态效果说明（悬停 / 按住显示） =================
   * ⚠ 下面每一段文案都必须与 engine.js 的实际结算保持一致，改规则时记得同步：
   *   毒气 / 酸气 → resolveBuffSettlement()
   *   腐烂标记  → onSummon 的 a-081-2（腐烂之心）与 a-080-2（腐烂触手）
   *   护盾      → damageMonster() 里的"护盾优先吸收"
   *   不可选中  → 目标选择校验（hasEnemy / 攻击目标判定）
   * 不这样做的话，就正好复刻了"卡面描述与实战不符"那类问题。 */
  var STAT_INFO = {
    poison: {
      title: '毒气',
      body: function (n, p) {
        var extra = (p && p.poisonBonus) || 0;
        var per = 2 + extra;
        return '<p>己方回合开始时结算：己方<b>所有在场怪物</b>各受 <b>' + per + '</b> 点伤害，然后毒气层数 −1。</p>' +
          (extra ? '<p class="dim">其中 ' + extra + ' 点来自【腐烂之心】的强化（毒气伤害 +' + extra + '）。</p>' : '') +
          '<p class="dim">现在 ' + n + ' 层：本回合结算 −' + per + ' 点，之后剩 ' + Math.max(0, n - 1) + ' 层。只要层数还在，每回合都会再结算一次。</p>' +
          '<p class="dim">来源：毒气陷阱 / 毒气药水 / 魔化藤 / 腐烂触手 / DM-200 等。食人鱼免疫毒气。</p>';
      }
    },
    acid: {
      title: '酸气',
      body: function (n) {
        var per = Math.ceil(n / 2);
        return '<p>己方回合开始时结算：己方<b>所有在场怪物</b>各受 <b>' + per + '</b> 点伤害，然后酸气层数减半（向下取整）。</p>' +
          '<p class="dim">现在 ' + n + ' 层：结算 −' + per + ' 点，之后剩 ' + Math.floor(n / 2) + ' 层。层数堆得越高单次伤害越痛，但它会自行衰减。</p>' +
          '<p class="dim">来源：酸蚀类效果。若对手场上有 DM-201，本局酸气伤害翻倍。食人鱼免疫酸气。</p>';
      }
    },
    rot: {
      title: '腐烂标记',
      body: function (n) {
        return '<p>腐烂标记<b>本身不造成任何伤害</b>，是被【腐烂之心】消费的资源。</p>' +
          '<p>对手召唤【腐烂之心】时：你每 2 层腐烂标记 → 使你受到的毒气伤害 <b>永久 +1</b>，随后标记清空。</p>' +
          '<p class="dim">现在 ' + n + ' 层：若对手此刻打出【腐烂之心】，你的毒气伤害会被 +' + Math.floor(n / 2) + '。</p>' +
          '<p class="dim">来源：对手的【腐烂触手】从场上阵亡时，给你 +1 层腐烂标记和 +1 层毒气。</p>';
      }
    },
    shield: {
      title: '护盾',
      body: function (n) {
        return '<p>受到伤害时<b>优先抵消</b>：每 1 点护盾吃掉 1 点伤害，抵消完剩下的才扣生命。</p>' +
          '<p class="dim">当前 ' + n + ' 点：接下来受到的 ' + n + ' 点伤害都会被它挡下（护盾不会随时间恢复）。</p>' +
          '<p class="dim">结算顺序：先算减伤（防具 / 大蜗牛等），再由护盾抵消。</p>' +
          '<p class="dim">来源：能源塔、茉莉伊洛（每次施法 +2）、部分怪物残血时自己获得。</p>';
      }
    },
    unt: {
      title: '不可选中',
      body: '<p>这只怪物<b>无法被【攻击】选为目标</b> —— 对手的主动攻击打不到它。</p>' +
        '<p><b>但卡牌照样能选它</b>：投掷物、法杖、陷阱等不受影响，仍可对它使用。</p>' +
        '<p>它也<b>不会给对手让出"打脸"的路</b>：只要它（或场上任何一张怪）还在，对手就无法直接攻击玩家。</p>' +
        '<p class="dim">照常参与结算（中毒气 / 酸气一样掉血）。来源：暗影斗篷、怨灵（固有）、食人鱼站中位、觉醒【潜伏】、极影铃虹等；觉醒【灵视】可永久解除。</p>'
    },
    star: {
      title: '星级',
      body: function (n) {
        return '<p>学院考核的升星标记：<b>★' + n + '</b>。星级会提升这张卡的攻击与生命，面板上显示的就是已算入星级后的数值。</p>' +
          '<p class="dim">升星来自学院里的【合星】，与对局内的升级卷轴 / 装备互不冲突，可以叠加。</p>';
      }
    },
    awk: {
      title: '觉醒词条',
      body: function (n, p, st, awkId) {
        var aw = (awkId && typeof awakenInfo === 'function') ? awakenInfo(awkId) : null;
        return '<p>' + ((aw && aw.desc) || '3★ 觉醒词条。') + '</p>' +
          '<p class="dim">怪物升到 3★ 时获得，只对这只怪物生效。</p>';
      }
    }
  };

  // 由状态标签元素生成浮窗内容（浅色的"按当前数值会怎样"由这里实时算）
  /* 生成某个状态的说明内容（纯数据、不碰 DOM → 测试可直接调用它核对文案）。
   *   stat  : 'poison' | 'acid' | 'rot' | 'shield' | 'unt' | 'star' | 'awk'
   *   n     : 标签上的数字（层数 / 护盾值 / 星级），没有就传 0
   *   side  : 'A' | 'B'（仅玩家状态栏的标签有，用来取 poisonBonus 这类实时值）
   *   awkId : 觉醒词条 id（只有 awk 用得到）
   * 返回 { title, body }；未知 stat 返回 null。 */
  function statInfoOf(stat, n, side, awkId) {
    var info = STAT_INFO[stat];
    if (!info) return null;
    n = n || 0;
    var st = Engine.state;
    var p = (st && side) ? st.players[side] : null;
    var body = (typeof info.body === 'function') ? info.body(n, p, st, awkId) : (info.body || '');
    return { title: n ? (info.title + '　×' + n) : info.title, body: body };
  }

  // 由状态标签元素生成浮窗内容
  function statTipOf(el) {
    if (!el) return null;
    return statInfoOf(el.getAttribute('data-stat'),
      +(el.getAttribute('data-n') || 0),
      el.getAttribute('data-side'),
      el.getAttribute('data-aw'));
  }

  /* 对局内状态标签：桌面悬停显示，触屏按住显示。
   * 状态栏与怪物区都是每次 render 全量重建的，所以用事件委托挂一次即可（挂在 body 上，
   * 因为 renderBoard 的容器也会被换掉）。 */
  function bindStatTips() {
    if (typeof StatTip === 'undefined') return;           // tooltip.js 未加载 → 安静降级
    if (document.__statTipBound) return;
    document.__statTipBound = true;
    var cur = null;
    document.addEventListener('mouseover', function (e) {
      var el = e.target && e.target.closest && e.target.closest('[data-stat]');
      if (!el || el === cur) return;
      cur = el;
      var info = statTipOf(el);
      if (info) StatTip.show(info, e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', function (e) { if (cur) StatTip.move(e.clientX, e.clientY); });
    document.addEventListener('mouseout', function (e) {
      var el = e.target && e.target.closest && e.target.closest('[data-stat]');
      if (!el) return;
      cur = null; StatTip.hide();
    });
    // 触屏：按住就显示（状态标签很小，不需要靠长按区分滑动），松手由 StatTip 侧的全局 pointerup 收起
    document.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;              // 桌面走 hover
      var el = e.target && e.target.closest && e.target.closest('[data-stat]');
      if (!el) return;
      cur = el;
      var info = statTipOf(el);
      if (info) StatTip.show(info, e.clientX, e.clientY);
    });
  }

  function renderBoard(container, s, key) {
    container.innerHTML = '';
    var p = s.players[key];
    for (var i = 0; i < Rules.BOARD_SIZE; i++) {
      var m = p.board[i];
      var cell = document.createElement('div');
      cell.className = 'cell';
      // 所有格子都记录位置：攻击连线在目标被打死后仍能靠格子定位
      cell.dataset.key = key; cell.dataset.slot = i;
      if (m) {
        cell.appendChild(monsterEl(m, key, s));
      } else {
        cell.classList.add('empty');
        cell.dataset.drop = key === 'A' ? 'self-slot' : 'enemy-slot';
        cell.innerHTML = '<span class="slotlabel">' + (key === 'A' ? '空位' : '—') + '</span>';
        if (key === 'B') cell.dataset.drop = 'enemy-player-zone';
        // 注意：必须从 DOM 读取 slot，闭包里的 i 在循环结束后已越界（曾导致虚空锁链"目标不合法"）
        cell.addEventListener('click', function (e) { onEmptyCellClick(e, key, +this.dataset.slot, s); });
      }
      applyBombMarks(cell, s, key, i);
      highlight(cell);
      container.appendChild(cell);
    }
    // 对手半屏整体可作为“直击玩家”的落点
    if (key === 'B') {
      container.dataset.drop = 'enemy-player-zone';
      container.dataset.key = 'B';
    }
  }

  function monsterEl(m, key, s) {
    // 用 C() 而不是裸 CARDS[...]：卡表版本不一致时会返回「未知卡」空壳，不至于整片战场渲染崩掉
    var cd = C(m);
    var d = document.createElement('div');
    d.className = 'monster' + (key === 'B' ? ' foe' : '');
    d.dataset.uid = m.uid; d.dataset.key = key;
    d.dataset.drop = key === 'A' ? 'self-monster' : 'enemy-monster';
    if (m.flags.attacked >= m.flags.attacksMax) d.classList.add('used');
    var eq = '';
    if (m.weapon) eq += '<span class="eq w" title="' + C(m.weapon).name + (m.weapon.level ? ' Lv' + m.weapon.level : '') + '">⚔' + (m.weapon.level ? '<i>' + m.weapon.level + '</i>' : '') + '</span>';
    if (m.armor) eq += '<span class="eq a" title="' + C(m.armor).name + (m.armor.level ? ' Lv' + m.armor.level : '') + '">🛡' + (m.armor.level ? '<i>' + m.armor.level + '</i>' : '') + '</span>';
    // 怪物身上的状态标记（data-stat 供悬停 / 按住看说明，见 STAT_INFO）
    var chips = '';
    if (m.shield > 0) chips += '<span class="chip shield" data-stat="shield" data-n="' + m.shield + '">盾' + m.shield + '</span>';
    if (m.flags.untargetable) chips += '<span class="chip unt" data-stat="unt">不可选中</span>';
    if ((m.star || 1) > 1) chips += '<span class="chip star" data-stat="star" data-n="' + m.star + '">★' + m.star + '</span>';   // 学院考核升星怪
    // 3★ 觉醒词条：直接在棋盘上标出来（否则对局中完全看不到这只怪带了什么词条）
    var awChip = awakenOfStar(m.awaken);
    if (awChip) chips += '<span class="chip awk" data-stat="awk" data-aw="' + m.awaken + '">' + awChip.name + '</span>';
    /* 古神之拳的形态：**不加任何角标/徽章**（玩家 2026-10-25 明确反对），
       形态只体现在卡面图本身（monsterEl 的 portrait 已按 flags.fistForm 换图）。 */
    // 催眠卷轴：全场怪物无法攻击 → 💤
    var sleep = (s.players.A.flags.noAttack || s.players.B.flags.noAttack) ? '<div class="msleep">💤</div>' : '';
    d.innerHTML =
      /* 古神之拳：按实例记录的第 flags.fistForm 换卡面（其它卡没有这个字段，传 undefined 无影响） */
      '<div class="portrait"><img src="' + cardThumb(cd, m.flags && m.flags.fistForm) + '"></div>' +
      '<div class="mstats"><span class="hp">♥' + Math.max(0, m.hp) + '</span><span class="atk">⚔' + m.atk + '</span></div>' +
      '<div class="mname">' + m.name + (m.tier ? '<span class="tier t-' + m.tier + '">' + m.tier + '</span>' : '') + '</div>' +
      '<div class="meq">' + eq + '</div>' +
      '<div class="mchips">' + chips + '</div>' + sleep;
    onHoverPreview(d, function () { previewMonster(m); });
    bindPreview(d, function () { previewMonster(m); });   // 触屏：按下即看怪物详情
    // 右上角装备图标（⚔ 武器 / 🛡 防具）：悬停时在卡牌详情处显示该装备的详情，移开还原怪物详情
    hookEquipPreview(d, 'w', m.weapon, m);
    hookEquipPreview(d, 'a', m.armor, m);
    d.addEventListener('pointerdown', function (e) { onBoardDown(e, m, key, s); });
    d.addEventListener('click', function (e) { onMonsterClick(e, m, key, s); });
    highlight(d);
    return d;
  }
  // 把"装备图标"与卡牌详情绑定（设备可能是普通对象，勿改其结构）
  function hookEquipPreview(root, kind, eqInst, owner) {
    if (!eqInst || !root.querySelector) return;
    var el = root.querySelector('.meq .' + kind);
    if (!el || !el.addEventListener) return;
    el.style.cursor = 'help';
    el.addEventListener('mouseenter', function (e) { trackPointer(e); previewCard(C(eqInst), owner.name); });
    el.addEventListener('mouseleave', function () { previewMonster(owner); });
    // 触屏：按装备图标 → 看装备详情（阻止冒泡，避免被怪物自身的"按下预览"覆盖）
    el.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      previewCard(C(eqInst), owner.name);
    });
  }

  function handCardEl(card, s) {
    var cd = C(card);
    var d = document.createElement('div');
    d.className = 'card';
    d.dataset.iid = card.iid;
    d.innerHTML =
      (cd.tier ? '<span class="tier t-' + cd.tier + '">' + cd.tier + '</span>' : '') +
      '<img class="thumb" src="' + cardThumb(cd) + '">' +
      '<span class="cname">' + cd.name + '</span>' +
      (card.level ? '<span class="lv">Lv' + card.level + '</span>' : '');
    // 手牌上的 3★：词条由卡 id 推算（实例进场上阵时才写 awaken，这里先给玩家看会出什么）
    var handAw = card.awaken || null;    // 词条合成时就抽定在实例上，直接读
    onHoverPreview(d, function () { previewCard(cd, null, handAw); });
    bindPreview(d, function () { previewCard(cd, null, handAw); });   // 触屏：按下即看手牌详情（拖动时也能顺带看到）
    d.addEventListener('pointerdown', function (e) { onHandDown(e, card, s); });
    d.addEventListener('click', function (e) { onHandCardClick(e, card, s); });
    highlight(d);
    return d;
  }

  function renderCenter(s) {
    var banner = $('phaseBanner');
    if (autoBattle) {                    // 学院考核：双方 AI 自动对战 → 显示输出 HUD
      banner.textContent = '考核对战 · 第 ' + s.round + '/' + autoBattle.limit + ' 回合';
      banner.className = 'banner' + (s.winner ? ' over' : ' battle');
      var eb = $('endBtn');
      eb.classList.add('disabled'); eb.textContent = '自动对战中…';
      $('centerZone').dataset.drop = 'use';
      var gc0 = $('globalChips');
      var hl = s.healed || { A: 0, B: 0 };
      // 上限按「考核大轮次」计（战斗内小回合数不影响）
      var cap = autoBattle.lossCap || ACADEMY_DATA.lossCapOf(s.round);
      if (gc0) gc0.innerHTML =
        '<span class="gchip warn">本场输出　我方 ' + (s.dealt.A || 0) + ' : 对手 ' + (s.dealt.B || 0) + '</span>' +
        ((hl.A || hl.B) ? '<span class="gchip ice">治疗抵消　我方 ' + hl.A + ' / 对手 ' + hl.B + '</span>' : '') +
        '<span class="gchip">输出低者按差额扣血（本轮上限 ' + cap + '，按考核轮次计）</span>';
      return;
    }
    if (s.winner) { banner.textContent = '对局结束'; banner.className = 'banner over'; }
    else if (s.active === 'B') { banner.textContent = '对手回合 · 思考中…'; banner.className = 'banner opp'; }
    else if (s.phase === 'PREP') { banner.textContent = '你的回合 · 准备阶段（绿）'; banner.className = 'banner prep'; }
    else { banner.textContent = '你的回合 · 战斗阶段（红）'; banner.className = 'banner battle'; }
    var btn = $('endBtn');
    if (s.winner || s.active === 'B') { btn.classList.add('disabled'); btn.textContent = s.winner ? '—' : '对手行动中…'; }
    else {
      btn.classList.remove('disabled');
      btn.textContent = s.phase === 'PREP' ? '结束准备' : '结束战斗';
    }
    $('centerZone').dataset.drop = 'use';
    // 全局效果提示（对玩家有影响的牌在此常驻提示）
    var gc = $('globalChips');
    if (gc) {
      var gh = '';
      if (s.players.A.flags.noAttack || s.players.B.flags.noAttack) gh += '<span class="gchip sleep">💤 全场无法攻击</span>';
      if (s.players.A.flags.tsNoAttack || s.players.B.flags.tsNoAttack) gh += '<span class="gchip sleep">⏳ 时停：全场无法攻击</span>';
      if (s.players.A.flags.tsNoThrowWand || s.players.B.flags.tsNoThrowWand) gh += '<span class="gchip ice">⏳ 时停：禁投掷物/法杖</span>';
      if ((s.players.B.bombs || []).length) gh += '<span class="gchip bomb">💣 对手已埋炸弹：闪红格下个准备阶段爆 ' + Rules.BOMB_DAMAGE + ' 点</span>';
      if ((s.players.A.bombs || []).length) gh += '<span class="gchip warn">💣 你已埋炸弹（己方同列也会被炸）</span>';
      if (s.players.A.flags.summonDebuff) gh += '<span class="gchip ice">❄ 你的下回合召唤 -' + s.players.A.flags.summonDebuff + '</span>';
      if (s.players.B.flags.summonDebuff) gh += '<span class="gchip ice">❄ 对手下回合召唤 -' + s.players.B.flags.summonDebuff + '</span>';
      gc.innerHTML = gh;
    }
  }

  // 炸弹位置提示：对方（投掷者）炸弹覆盖的十字格闪红；自家炸弹的"同列对位"格提示会自伤
  function applyBombMarks(cell, s, key, slot) {
    var foes = (s.players[Engine.other(key)].bombs || []);
    for (var i = 0; i < foes.length; i++) {
      if (Math.abs(foes[i].slot - slot) <= 1) { cell.classList.add('bomb-threat'); break; }
    }
    var mine = (s.players[key].bombs || []);
    for (var j = 0; j < mine.length; j++) {
      if (mine[j].slot === slot) { cell.classList.add('bomb-self'); break; }
    }
  }

  function renderLog(s) {
    var box = $('logbox');
    box.innerHTML = '';
    s.log.slice(-60).forEach(function (e) {
      var d = document.createElement('div');
      d.className = 'logline ' + (e.cls || '');
      d.textContent = e.text;
      box.appendChild(d);
    });
    box.scrollTop = box.scrollHeight;
  }

  /* ================= 悬停预览 ================= */
  /* 竖屏模式：#stage.portrait 下右栏被压成覆盖层、#preview 默认隐藏，
     所以把"卡牌详情"改成浮层（.on），并且**永远贴在手指/鼠标的另一半屏**：
     指针在上半屏 → 浮层落下方（.on-my）；指针在下半屏 → 浮层落上方。
     这样拖拽时详情不会盖住正在拖的那张卡、点怪物也不会被手牌挡住。
     hold=true 表示拖拽期间：不设自动收起计时（拖完由 endDrag 收）。*/
  var pvTimer = null;
  var pvStopTimer = null;                 // 拖拽中"手指停住"的收起计时
  /* 立刻收起卡牌详情。两条触发路径都要用到：
   *   · 鼠标离开卡牌（桌面 hover 看完就走）
   *   · 触屏拖拽中手指停住 / 抬起（浮层不再挡视野）
   * 横屏右栏的 #preview 也一并复位成占位提示，否则会一直挂着上一张卡的详情。 */
  /* 只收浮层、**不动内容**。拖拽中"手指停住"走这条：
     如果连内容一起复位成占位，继续挪动时 moveGhost 会重新打开浮层，
     但里面只剩"悬停卡牌查看详情" → 屏幕上就是**一个巨大的空黑框**（用户反馈过）。 */
  function closePortraitFloat() {
    if (pvTimer) { clearTimeout(pvTimer); pvTimer = null; }
    portraitPreview(false);
  }
  function hidePreview() {
    if (pvStopTimer) { clearTimeout(pvStopTimer); pvStopTimer = null; }
    closePortraitFloat();
    var p = $('preview');
    if (p) p.innerHTML = '<div class="dim">悬停卡牌查看详情</div>';
  }
  /* 给"悬停看详情"的元素补上"离开就收"（mouseenter 由各调用处自己绑）。 */
  function bindPreviewLeave(el) {
    if (!el || !el.addEventListener) return;
    el.addEventListener('mouseleave', function () { hidePreview(); });
  }
  /* 拖拽中手指停住 → 400ms 后收起详情（继续挪动会由 moveGhost 重新弹出）。
   * 为什么不立刻收：慢慢拖的时候指针本来就会一顿一顿的，立刻收会疯狂闪烁。 */
  function previewStopWatch() {
    if (pvStopTimer) clearTimeout(pvStopTimer);
    pvStopTimer = setTimeout(closePortraitFloat, 400);   // 只收浮层，内容留着给下一次重新弹出
  }
  function portraitPreview(on, atBottom, hold) {
    if (!portraitMode) return;
    var el = $('preview'); if (!el) return;
    if (pvTimer) { clearTimeout(pvTimer); pvTimer = null; }
    if (!on) { el.classList.remove('on', 'on-my'); return; }
    /* 兜底：里面没有真正的卡详情（只有占位文字）就不要弹 —— 否则是一个空的大黑框 */
    if (!el.querySelector('.pv-title')) { el.classList.remove('on', 'on-my'); return; }
    el.classList.add('on');
    el.classList.toggle('on-my', !!atBottom);
    if (!hold) pvTimer = setTimeout(function () { el.classList.remove('on', 'on-my'); pvTimer = null; }, 1800);
  }
  function portraitPreviewFollow(clientY, hold) {
    var mid = (window.innerHeight || 720) / 2;
    portraitPreview(true, clientY != null && clientY < mid, hold);
  }
  /* 最近一次指针位置：mouseenter 触发的路径（悬停手牌 / 场上怪物）拿不到坐标，
     只能靠这个记录判断"指针在上半屏还是下半屏"，好把浮层放到另一半屏去。
     ⚠ 只在悬停事件里顺手记录，**不要往 document 上挂常驻 pointermove** ——
       拖拽逻辑会统计 document 上的监听数量来判断有没有泄漏（mobile_check 有这条断言）。 */
  var lastPtr = { x: 0, y: 0 };
  function trackPointer(e) { if (e && e.clientX != null) { lastPtr.x = e.clientX; lastPtr.y = e.clientY; } }
  /* 竖屏浮层：按指针位置贴到另一半屏（悬停对手场 → 浮层落下方；悬停己方场 → 落上方） */
  function portraitPreviewByPointer(hold) {
    if (!portraitMode) return;
    var mid = (window.innerHeight || 720) / 2;
    portraitPreview(true, lastPtr.y > 0 && lastPtr.y < mid, hold);
  }
  /* 「悬停看详情」统一入口：记指针位置 + 显示预览 + 离开即收 */
  function onHoverPreview(el, fn) {
    if (!el || !el.addEventListener) return;
    el.addEventListener('mouseenter', function (e) { trackPointer(e); fn(); });
    bindPreviewLeave(el);
  }

  // 触屏没有 hover → 按下即显示预览（桌面用鼠标按下时也顺带显示，无副作用）
  function bindPreview(el, fn) {
    if (!el || !el.addEventListener) return;
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      fn();
      // 竖屏：浮层贴在手指的另一半屏（手指/鼠标在上半屏 → 浮层落下方，反之落上方）
      if (portraitMode && e.clientY != null) {
        var mid = (window.innerHeight || 720) / 2;
        portraitPreview(true, e.clientY < mid);
      }
    });
  }
  // 3★ 觉醒词条 → {name, desc}；awaken_data.js 未加载时安静返回 null
  function awakenOfStar(awId) {
    if (!awId || typeof awakenInfo !== 'function') return null;
    return awakenInfo(awId);
  }
  /* cur：场上怪物的【当前实际数值】{hp, maxHp, atk, star}。
   * 传了 → 显示"当前 ♥x/y ⚔z"并附卡面基础值做对照；不传 → 只显示卡面值
   * （手牌 / 商店 / 牌库查看器看的是"这张卡本身"，没有对局内状态可言）。
   * ⚠ 以前这里一律显示 cd.atk / cd.hp（1★ 卡面值）。玩家点开场上 3★ 丛林螃蟹，
   *   预览写的是 ⚔4，而它实际是 ⚔20（3★ ×3 再叠学院特技 +8）→
   *   看起来像"星级 / 装备 / 觉醒 / 学院特技全都没生效"。其实只是这里没读实例。
   *   凡是"后天的"攻击/生命变化（星阶、成长、力量药水、装备、觉醒、学院特技）
   *   都只体现在实例的 atk / maxHp 上，卡面数据永远不变。 */
  function previewCard(cd, ownerName, awId, cur) {
    var aw = awakenOfStar(awId);
    var meta = Rules.TYPE_NAME[cd.type];
    if (cd.hp != null) {
      meta += cur
        ? (' ｜ ' + (cur.star > 1 ? '★' + cur.star + '　' : '') +
           '当前 ♥' + Math.max(0, cur.hp) + '/' + Math.max(0, cur.maxHp) + ' ⚔' + cur.atk +
           '　（卡面基础 ♥' + cd.hp + ' ⚔' + cd.atk + '）')
        : (' ｜ ♥' + cd.hp + ' ⚔' + cd.atk);
    }
    $('preview').innerHTML =
      '<div class="pv-title">' + cd.name + (cd.tier ? ' <span class="tier t-' + cd.tier + '">' + cd.tier + '</span>' : '') + '</div>' +
      (ownerName ? '<div class="pv-owner">装备于：' + ownerName + '</div>' : '') +
      '<img class="pv-img" src="' + cardDetail(cd, cur && cur.form) + '">' +
      '<div class="pv-meta">' + meta + '</div>' +
      /* 多形态卡（古神之拳）：文字也按当前形态换，否则会出现"图上写燃烧、下面文字写默认"的矛盾 */
      '<div class="pv-effect">' + ((cd.forms && cur && cur.form && cd.forms[cur.form]) || cd.effect) + '</div>' +
      (aw ? '<div class="pv-awaken"><div class="pv-aw-h">觉醒 · ' + aw.name + '</div>' + aw.desc + '</div>' : '');
    /* 竖屏：右栏没有常驻位置 → 显示成浮层，位置按指针贴到另一半屏。
       hold=true：悬停期间**常驻**，由 mouseleave 立刻收（用户要求"离开卡牌即消失"）。
       以前这里是 1.8s 自动收 —— 慢慢看卡时浮层会自己消失，很突兀。
       触屏按下（bindPreview 的 pointerdown）会再调一次 portraitPreview 不带 hold，
       那条路径仍保留"按住 1.8 秒 / 拖完就收"的原有节奏。 */
    portraitPreviewByPointer(true);
  }
  function previewMonster(m) {
    var cd = C(m);          // 同 monsterEl：卡表不一致时退回「未知卡」空壳
    // 场上怪物：显示"当前实际数值"（m.atk / m.maxHp 已含星级倍率、装备、成长、觉醒、学院特技）
    previewCard(cd, null, m.awaken,
      { hp: m.hp, maxHp: m.maxHp, atk: m.atk, star: m.star || 1, form: m.flags && m.flags.fistForm });
    var extra = [];
    if (m.weapon) extra.push('武器：' + C(m.weapon).name + (m.weapon.level ? '（Lv' + m.weapon.level + '）' : ''));
    if (m.armor) extra.push('防具：' + C(m.armor).name + (m.armor.level ? '（Lv' + m.armor.level + '）' : ''));
    if (extra.length) $('preview').insertAdjacentHTML('beforeend', '<div class="pv-extra">' + extra.join('　') + '</div>');
  }

  /* ================= 事件 → 飘字 + 音效 ================= */
  var lastSfx = 0;
  function sfxThrottled(name, ms) {
    var now = Date.now();
    if (now - lastSfx < (ms || 70)) return;
    lastSfx = now;
    Sfx.play(name);
  }
  function processEvents(s) {
    var evts = s.events || [];
    s.events = [];                      // 先清空再播放：某条播放出错也不会残留、反复重播（联机下尤其重要）
    evts.forEach(function (ev) {
      if (ev.type === 'float') {
        if (ev.kind === 'heal') Sfx.play('heal');
        else if (ev.kind === 'dmg') { sfxThrottled('hit', 70); if (ev.uid) Anim.flash(document.querySelector('[data-uid="' + ev.uid + '"]'), 'hitflash', 340); }
        var el = null;
        if (ev.uid) el = document.querySelector('[data-uid="' + ev.uid + '"]');
        else if (ev.player) el = $(ev.player === 'A' ? 'myInfo' : 'oppInfo');
        if (!el) return;
        var r = el.getBoundingClientRect();
        Anim.floatAt(r.left + r.width / 2, r.top + r.height / 2 - 10, ev.text, ev.kind);
      } else if (ev.type === 'attack') {
        Sfx.play('attack');
        drawAttack(ev);                               // 谁打谁：连线 + 箭头
      } else if (ev.type === 'summon') {
        Sfx.play('summon');
        var mEl = document.querySelector('[data-uid="' + ev.uid + '"]');
        if (mEl) mEl.classList.add('spawn-in');
        if (ev.key === 'B') pushPlay({ cardId: ev.cardId, verb: '召唤', mine: false });
      } else if (ev.type === 'play') {
        if (ev.key === 'B') { pushPlay({ cardId: ev.cardId, verb: ev.verb || '使用', mine: false }); afterFoePlay(ev.cardId); }
      } else if (ev.type === 'trap') {
        if (ev.key === 'B') { pushPlay({ cardId: ev.cardId, verb: '发动陷阱', mine: false }); Anim.flash($('phaseBanner'), 'trapflash', 900); }
      } else if (ev.type === 'death') {
        sfxThrottled('death', 120);
      }
    });
    s.events = [];
  }

  // 对手打出这些牌时，额外给玩家一次显眼提醒
  function afterFoePlay(cardId) {
    if (cardId === 'a-062-2') { Anim.flash($('summonInfo'), 'ice', 2600); toast('对手使用【冰霜药水】：你下回合召唤 -1'); }
    else if (cardId === 'a-063-2') { Anim.flash($('phaseBanner'), 'trapflash', 900); toast('对手使用【催眠卷轴】：全场怪物无法攻击'); }
    else if (cardId === 'a-086-2') { toast('对手埋下【炸弹】：闪红格将在其下个准备阶段受到 ' + Rules.BOMB_DAMAGE + ' 点伤害'); }
    else if (cardId === 'a-030-2') { toast('对手使用【传送卷轴】：弃置全部手牌并抽 4 张'); }
  }

  /* ================= 交互：拖拽 / 点击 ================= */
  function payloadOfHand(card) { return { kind: 'hand', iid: card.iid, cardId: card.cardId }; }
  function payloadOfBoard(m, key) { return { kind: 'board', uid: m.uid, key: key, cardId: m.cardId }; }

  function onHandDown(e, card, s) {
    if (autoBattle) return;           // 自动对战：玩家不操作
    if (pend) return;                 // 目标选择模式下禁用拖拽
    if (s.active !== 'A' || s.winner) return;
    startDrag(e, payloadOfHand(card), '<img src="' + cardThumb(C(card)) + '">');
  }
  function onBoardDown(e, m, key, s) {
    if (autoBattle) return;
    if (pend) return;
    if (s.active !== 'A' || s.winner) return;
    if (key !== 'A') return;
    if (s.phase === 'BATTLE') startDrag(e, payloadOfBoard(m, key), '<img src="' + cardThumb(C(m), m.flags && m.flags.fistForm) + '">');
  }

  /* ---- 需要目标的两张卡：进入目标选择模式 ---- */
  function startEmblem(iid, cardId) {
    var s = Engine.state;
    if (s.phase !== 'PREP') { toast('仅准备阶段可使用'); return; }
    var p = s.players.A;
    // 同一防具只能贴 1 张纹章 → 已贴过的防具不算有效目标
    var hasArmor = p.hand.some(function (c) { return C(c).type === 'armor' && !(c.flags && c.flags.emblemReduce > 0); }) ||
      p.board.some(function (m) { return m && m.armor && !(m.armor.flags && m.armor.flags.emblemReduce > 0); });
    if (!hasArmor) { toast('没有可作为目标的防具卡（同一防具只能贴 1 张纹章）'); return; }
    pend = { mode: 'emblem', iid: iid, cardId: cardId };
    render(s); toast('请点击手牌/场上的防具卡作为强化目标');
  }
  // 每回合同类道具（食物/药水/卷轴）限 1 张，计数在引擎的 p.flags.used 里。
  // 目的：在"进入选目标模式之前"就先判，避免玩家白选一通目标才被告知次数已用尽。
  function useLimitReached() {
    var p = Engine.state && Engine.state.players && Engine.state.players.A;
    return !!(p && p.flags && p.flags.used && p.flags.used.scroll);
  }
  function startUpgrade(iid, cardId) {
    var s = Engine.state;
    if (s.phase !== 'PREP') { toast('仅准备阶段可使用'); return; }
    if (useLimitReached()) { toast('本回合该种卡使用次数已耗尽'); return; }
    var p = s.players.A;
    if (!p.board.some(canUpgradeMonster) && !canUpgradeWand(p)) { toast('没有可升级的装备或法杖'); return; }
    pend = { mode: 'upgrade', iid: iid, cardId: cardId };
    render(s); toast('请点击装备了可升级武器/防具的己方怪物，或法杖栏');
  }
  function doUpgradeTarget(payload) {
    // 先清空 pend 再结算：避免结算途中触发的 render 仍按 upgrade 模式重新高亮法杖栏
    var iid = pend ? pend.iid : null;
    pend = null; selected = null;
    var res = iid != null ? Engine.tryAction({ type: 'USE', iid: iid, targetUid: payload.targetUid, targetKind: payload.targetKind }) : null;
    if (res && !res.ok && !res.silent) toast(res.msg);
    render(Engine.state);
  }
  function doEmblemTarget(payload) {
    var res = Engine.tryAction({ type: 'USE', iid: pend.iid, targetIid: payload.targetIid, targetUid: payload.targetUid });
    pend = null; selected = null;
    if (res && !res.ok && !res.silent) toast(res.msg);
    render(Engine.state);
  }
  // 镜像卷轴（a-116-2）：必须先选一只我方怪物，否则引擎会判"使用条件不满足"
  function startMirror(iid, cardId) {
    var s = Engine.state;
    if (s.phase !== 'PREP') { toast('仅准备阶段可使用'); return; }
    if (useLimitReached()) { toast('本回合该种卡使用次数已耗尽'); return; }   // 次数已用尽：立刻提示，不进选目标
    var p = s.players.A;
    if (!p.board.some(function (m) { return m; })) { toast('我方场上没有可复制的怪物'); return; }
    if (!Engine.emptySlots('A').length) { toast('我方没有空位，无法衍生镜像'); return; }
    pend = { mode: 'mirror', iid: iid, cardId: cardId };
    render(s); toast('请点击一张我方怪物作为复制目标（衍生体生命为 1）');
  }
  function doMirrorTarget(payload) {
    var iid = pend ? pend.iid : null;
    pend = null; selected = null;
    var res = iid != null ? Engine.tryAction({ type: 'USE', iid: iid, targetUid: payload.targetUid }) : null;
    if (res && !res.ok && !res.silent) toast(res.msg);
    render(Engine.state);
  }

  /* ---- 法杖发动：先选弃置的手牌（或老法杖灌注），再选目标 ---- */
  function wandNeedsAbsorb() {
    var p = Engine.state.players.A;
    return !!(p.wand && p.wand.cardId === 'a-036-2' && !p.wand.inheritId);
  }
  function wandEffId() {
    var p = Engine.state.players.A;
    if (!p.wand) return null;
    if (p.wand.cardId === 'a-036-2' && p.wand.inheritId) return p.wand.inheritId;
    return p.wand.cardId;
  }
  function wandNeedsTarget() {
    /* 单一来源：直接问引擎，别在这里另抄一份清单 ——
       2026-10-27 腐化法杖/棱光法杖「无法选择目标」就是因为这里漏了 136、137：
       UI 认为不需要目标 → 不进入 wand-target 模式 → 空目标施法被引擎拒绝 → 只能弹提示。 */
    return !!(Engine.wandNeedsTargetCard && Engine.wandNeedsTargetCard(wandEffId()));
  }
  /* 冲击波法杖（a-091-2）：对一张怪物造成伤害并向右移动一位 —— 己方怪物也能选。
     引擎 actActivateWand 早就支持（先查对手、查不到再查己方），是 UI 层一直只放敌方。
     ⚠ 改动必须三处同步：高亮、点击分发、提示文案。 */
  function wandAllowSelfTarget() { return wandEffId() === 'a-091-2'; }
  function startWand() {
    var s = Engine.state, p = s.players.A;
    if (!p.wand) { toast('法杖栏为空'); return; }
    if (s.phase !== 'PREP') { toast('仅准备阶段可发动法杖'); return; }
    if (p.castsLeft <= 0) { toast('本回合施法次数已用尽'); return; }
    if (wandNeedsAbsorb()) {
      if (!p.hand.some(function (c) { return C(c).type === 'wand'; })) { toast('老法杖需一张手牌中的法杖进行灌注'); return; }
      pend = { mode: 'wand-discard' };
      render(s); toast('请点击一张手牌中的法杖进行灌注');
      return;
    }
    if (!p.hand.length) { toast('发动法杖需弃置一张手牌作为代价'); return; }
    pend = { mode: 'wand-discard' };
    render(s); toast('请点击一张手牌作为弃置代价');
  }
  function chooseWandDiscard(card) {
    if (wandNeedsAbsorb()) {
      // 老法杖不能灌注老法杖（引擎同样会拒，这里先拦一下好给出更准确的提示）
      if (card.cardId === 'a-036-2') { toast('老法杖不能灌注老法杖，请选择其他法杖'); return; }
      if (C(card).type !== 'wand') { toast('请选择一张法杖进行灌注'); return; }
      doWandAction({ absorbIid: card.iid });
      return;
    }
    pend.discardIid = card.iid;
    if (wandNeedsTarget()) { pend.mode = 'wand-target'; render(Engine.state); toast(wandAllowSelfTarget() ? '请点击一张怪物作为法杖目标（双方都可以）' : '请点击一张敌方怪物作为法杖目标'); }
    else doWandAction({});
  }
  function doWandTarget(uid) { doWandAction({ targetUid: uid }); }
  function doWandAction(extra) {
    var act = { type: 'ACTIVATE_WAND' };
    if (pend && pend.discardIid != null) act.discardIid = pend.discardIid;
    if (extra && extra.absorbIid != null) act.absorbIid = extra.absorbIid;
    if (extra && extra.targetUid != null) act.targetUid = extra.targetUid;
    var res = Engine.tryAction(act);
    pend = null;
    if (res && !res.ok && !res.silent) toast(res.msg);
    render(Engine.state);
  }

  /* ---- 虚空锁链：点选怪物 → 点选其本方空位 ---- */
  function startVoidChain() {
    var s = Engine.state, p = s.players.A;
    if (!p.artifacts.some(function (a) { return a.cardId === 'a-094-2'; })) return;
    if (s.phase !== 'PREP') { toast('仅准备阶段可发动虚空锁链'); return; }
    if (p.flags.voidChainUsed) { toast('虚空锁链每回合限用一次'); return; }
    var hasMon = Engine.aliveMonsters('A').length + Engine.aliveMonsters('B').length > 0;
    if (!hasMon) { toast('场上没有可移动的怪物'); return; }
    pend = { mode: 'void-src' };
    render(s); toast('请点击任意一只怪物');
  }
  /* ---- 时光沙漏：点击遗物图标发动（准备阶段，冷却 6 回合） ---- */
  function startTimeStop() {
    var s = Engine.state, p = s.players.A;
    if (!p.artifacts.some(function (a) { return a.cardId === 'a-120-2'; })) return;
    if (s.phase !== 'PREP') { toast('仅准备阶段可发动时光沙漏'); return; }
    var res = Engine.tryAction({ type: 'TIME_STOP' });
    if (res && !res.ok && !res.silent) toast(res.msg);
    render(Engine.state);
  }
  /* ---- 蓄血圣杯（a-139-02）：点遗物图标 → 点选一只己方怪物 ---- */
  function startCup() {
    var s = Engine.state, p = s.players.A;
    if (!p.artifacts.some(function (a) { return a.cardId === 'a-139-02'; })) return;
    if (s.phase !== 'PREP') { toast('仅准备阶段可发动蓄血圣杯'); return; }
    if (p.flags.artifactCupUsed) { toast('蓄血圣杯每回合限用一次'); return; }
    var usable = Engine.aliveMonsters('A').filter(function (m) { return !m.flags.cupUsed; });
    if (!usable.length) { toast('己方场上没有可用圣杯的怪物（每只限一次）'); return; }
    pend = { mode: 'cup-target' };
    render(s); toast('请点击一只我方怪物（失去当前回合数的生命，换等量生命上限）');
  }
  function doCupTarget(uid) {
    var res = Engine.tryAction({ type: 'USE_CUP', targetUid: uid });
    pend = null;
    if (res && !res.ok && !res.silent) toast(res.msg);
    render(Engine.state);
  }
  /* ---- 无序魔典 / 炼金工具箱（a-159-02 / a-160-02）：点遗物 → 三选一弹窗 ---- */
  function startTome(kind) {
    var res = Engine.tryAction({ type: 'USE_TOME', kind: kind });
    if (res && !res.ok && !res.silent) toast(res.msg);
    render(Engine.state);
  }

  /* ---- 手牌点击分发 ---- */
  function onHandCardClick(e, card, s) {
    if (justDragged) { justDragged = false; return; }
    if (s.active !== 'A' || s.winner) return;
    var cd = C(card);
    if (pend) {
      if (pend.mode === 'wand-discard') { chooseWandDiscard(card); return; }
      if (pend.mode === 'chest-discard') {
        if (card.iid === pend.iid) { toast('不能弃置宝箱自身'); return; }
        doChestDiscard(card); return;
      }
      if (pend.mode === 'emblem') {
        if (cd.type === 'armor') { doEmblemTarget({ targetIid: card.iid }); return; }
        toast('请点击一张防具卡作为目标'); return;
      }
      toast('请先选择目标，或点击空白处取消'); return;
    }
    if (cd.id === 'a-033-2') { startEmblem(card.iid, card.cardId); return; }   // 破损纹章：选防具
    if (cd.id === 'a-029-2') { startUpgrade(card.iid, card.cardId); return; }  // 升级卷轴：选目标
    if (cd.id === 'a-116-2') { startMirror(card.iid, card.cardId); return; }   // 镜像卷轴：选我方怪物
    if (cd.id === 'a-014-2') { startChest(card.iid, card.cardId); return; }    // 黄金宝箱：选择弃置
    if (cd.type === 'wand') {                                                  // 法杖：点击直接放入/替换法杖栏
      if (s.phase !== 'PREP') { toast('仅准备阶段可放置法杖'); return; }
      var cur = s.players.A.wand;
      if (cur && cur.cardId === cd.id) { toast('法杖栏已是该法杖'); return; }
      if (cur) {
        confirmBox('替换法杖栏中的【' + C(cur).name + '】？旧法杖将进入弃牌堆。', function () {
          execute({ kind: 'hand', iid: card.iid, cardId: card.cardId }, { drop: 'wand' });
        }, null, { yes: '替换', no: '取消' });
        return;
      }
      execute({ kind: 'hand', iid: card.iid, cardId: card.cardId }, { drop: 'wand' });
      return;
    }
    if (cd.type === 'treasure' || cd.type === 'food' || cd.type === 'potion' || cd.type === 'scroll') {
      if (s.phase !== 'PREP') { toast('仅准备阶段可使用'); return; }
      execute({ kind: 'hand', iid: card.iid, cardId: card.cardId }, { drop: 'use' });
      return;
    }
    selected = payloadOfHand(card);
    render(s);
    hintFor(selected);
  }

  /* ---- 黄金宝箱：手动选择弃置的手牌 ---- */
  function startChest(iid, cardId) {
    var s = Engine.state, p = s.players.A;
    if (s.phase !== 'PREP') { toast('仅准备阶段可使用'); return; }
    if (p.hand.length < 2) { toast('手牌不足，无法弃置'); return; }
    pend = { mode: 'chest-discard', iid: iid, cardId: cardId };
    render(s); toast('请选择要弃置的一张手牌');
  }
  function doChestDiscard(card) {
    var res = Engine.tryAction({ type: 'USE', iid: pend.iid, discardIid: card.iid });
    pend = null;
    if (res && !res.ok && !res.silent) toast(res.msg);
    render(Engine.state);
  }
  /* 虚空锁链第 2 步：把选中的怪移到它本方空位。
     ⚠ 2026-10-27：这个函数之前**被误删了**（只剩 onEmptyCellClick 里的调用），
     点空位时直接 ReferenceError → 锁链看起来"选完怪就没反应"。 */
  function doVoidMove(slot) {
    var res = Engine.tryAction({ type: 'MOVE_MONSTER', uid: pend.srcUid, slot: slot });
    pend = null;
    if (res && !res.ok && !res.silent) toast(res.msg);
    render(Engine.state);
  }

  /* ---- 场上怪物点击分发 ---- */
  function onMonsterClick(e, m, key, s) {
    if (justDragged) { justDragged = false; return; }
    if (s.winner || s.active !== 'A') return;
    if (pend) {
      if (pend.mode === 'upgrade') {
        if (key === 'A' && canUpgradeMonster(m)) doUpgradeTarget({ targetUid: m.uid });
        else toast('请选择装备了可升级武器/防具的己方怪物');
        return;
      }
      if (pend.mode === 'wand-target') {
        var _allowSelf = wandAllowSelfTarget();
        if (key === 'B' || (_allowSelf && key === 'A')) doWandTarget(m.uid);
        else toast(_allowSelf ? '请选择一张怪物作为法杖目标（双方都可以）' : '请选择一张敌方怪物作为法杖目标');
        return;
      }
      if (pend.mode === 'emblem') {
        if (key === 'A' && m.armor) doEmblemTarget({ targetUid: m.uid });
        else toast('请点击一张防具卡作为目标');
        return;
      }
      if (pend.mode === 'mirror') {
        if (key === 'A') doMirrorTarget({ targetUid: m.uid });
        else toast('请点击一张我方怪物作为复制目标');
        return;
      }
      if (pend.mode === 'void-src') {
        pend.srcUid = m.uid; pend.srcKey = key; pend.mode = 'void-dst';
        render(s);
        toast(key === 'A' ? '请点击我方的一个空位' : '请点击对手的一个空位');
        return;
      }
      if (pend.mode === 'cup-target') {
        if (key !== 'A') { toast('请点击我方怪物'); return; }
        doCupTarget(m.uid);
        return;
      }
      if (pend.mode === 'wand-discard') { toast('请点击一张手牌'); return; }
      toast('请先完成当前目标选择'); return;
    }
    onBoardClick(e, m, key, s);
  }
  function onBoardClick(e, m, key, s) {
    if (justDragged) { justDragged = false; return; }
    if (s.winner) return;
    // 若已选中投掷/攻击，点到目标则执行
    var tgt = { drop: key === 'A' ? 'self-monster' : 'enemy-monster', key: key, uid: m.uid };
    if (selected) { execute(selected, tgt); return; }
    if (s.active === 'A' && key === 'A' && s.phase === 'BATTLE') {
      selected = payloadOfBoard(m, key); render(s); hintFor(selected);
    }
  }
  function onEmptyCellClick(e, key, slot, s) {
    if (justDragged) { justDragged = false; return; }
    if (s.winner || s.active !== 'A') return;
    if (pend) {
      if (pend.mode === 'void-dst') {
        if (key !== pend.srcKey) { toast('请点击该怪物本方的空位'); return; }
        doVoidMove(slot);
        return;
      }
      if (pend.mode === 'void-src') { toast('请点击一只怪物'); return; }
      if (pend.mode === 'wand-target') { toast(wandAllowSelfTarget() ? '请点击一张怪物作为法杖目标（双方都可以）' : '请选择一张敌方怪物作为法杖目标'); return; }
      cancelPend('已取消'); return;
    }
    // 已选中卡牌时，点击己方空位可直接召唤
    if (selected && key === 'A') execute(selected, { drop: 'self-slot', key: 'A', slot: slot });
    /* 战斗阶段选中己方怪物后，点击**对方空位** = 攻击对手本体。
       ⚠ 以前这里只处理己方空位 → 对面场上没怪物时，点哪里都没反应
         （玩家反馈"点击对手空场无法攻击对手本体"，只能拖到对手战场才行）。 */
    else if (selected && selected.kind === 'board' && key === 'B') {
      execute(selected, { drop: 'enemy-player-zone', key: 'B' });
    }
  }

  var dragMoved = false;
  var justDragged = false;   // 拖拽结束后抑制紧随其后的 click
  var dragTouch = false;     // 本次拖拽是否为触屏
  var DRAG_LIFT = 46;        // 触屏时幽灵卡上移像素：避免手指把落点挡住
  // 触屏用"抬起的点"做落点判定与幽灵卡定位（与眼睛看到的位置一致）
  function pt(e) {
    return { x: e.clientX, y: dragTouch ? (e.clientY - DRAG_LIFT) : e.clientY };
  }
  /* ★ 多指（手机）只认"开始拖拽的那一根手指"。
   *   历史 bug：战斗阶段先用一根手指拖 A 卡、再用第二根手指拖 B 卡 —— 第二根会覆盖 `drag`
   *   （第一张的幽灵卡留在 DOM 里没人管），而 pointerup 又不看 pointerId，于是第一根手指抬起时
   *   收掉的是 **B 的幽灵卡** → A 的幽灵卡永久贴在屏幕上（玩家反馈的"第一张卡住了"）。
   *   修法：① 已有拖拽进行中时忽略新手势 ② 用 pointerId 过滤 move/up/cancel
   *        ③ 起手前清掉任何历史残留的幽灵卡（异常路径兜底） */
  function samePointer(e) {
    if (!drag) return true;
    if (drag.pid == null || !e || e.pointerId === undefined) return true;   // 环境不支持 pointerId → 不过滤
    return e.pointerId === drag.pid;
  }
  function clearGhosts() {
    var layer = $('dragLayer');
    if (!layer) return;
    Array.prototype.slice.call(layer.querySelectorAll('.dragghost')).forEach(function (n) { n.remove(); });
  }
  function startDrag(e, payload, ghostHtml) {
    if (e.button !== undefined && e.button !== 0) return;
    if (drag) {
      /* 已有一个拖拽在跑，分三种情况：
         · 同一根手指重复按下 → 忽略（多指保护，见上面那段注释）
         · 另一根手指按下 → 说明旧拖拽的 pointerup 丢了，强制清理后继续
         · 超过 8 秒没有任何 pointermove → 同样视为脏状态（切后台/来电/系统手势都可能吞掉 up）
         不清的话 `drag` 永远非空，而本函数第一行就会 return ——
         玩家看到的现象就是「所有模式都拖不动卡，只能点击发动，重启才恢复」。 */
      var staleByPid = (drag.pid != null && e.pointerId !== undefined && drag.pid !== e.pointerId);
      var staleByTime = (Date.now() - (drag.at || 0) > 8000);
      if (!staleByPid && !staleByTime) return;
      resetDragState();
    }
    drag = payload; dragMoved = false;
    drag.at = Date.now();
    dragTouch = !!(e.pointerType && e.pointerType !== 'mouse');
    drag.pid = (e.pointerId !== undefined) ? e.pointerId : null;
    /* 建幽灵卡的每一步都可能在极端情况下抛错（dragLayer 被别处挪走、innerHTML 里带了坏字符…）。
       放在 try 里，失败就立刻回滚状态 —— 绝不能让 drag 带着半截状态卡住。 */
    try {
      clearGhosts();
      var g = document.createElement('div');
      g.className = 'dragghost';
      g.innerHTML = ghostHtml;
      $('dragLayer').appendChild(g);
      drag.ghost = g;
    } catch (err) {
      resetDragState();
      return;
    }
    drag.sx = e.clientX; drag.sy = e.clientY;
    try { moveGhost(e); } catch (err) { }
    try { portraitPreviewFollow(e.clientY, true); } catch (err) { }   // 竖屏：拖拽期间详情浮层跟着手指换上下半屏
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', cancelDrag);   // 触屏被系统手势打断时必须收尾，否则幽灵卡残留、后续拖拽失效
  }
  function onMove(e) {
    if (!drag || !samePointer(e)) return;
    drag.at = Date.now();                     // 心跳：给 startDrag 判断"这个拖拽是不是已经僵死"
    if (Math.abs(e.clientX - drag.sx) > 6 || Math.abs(e.clientY - drag.sy) > 6) dragMoved = true;
    try { moveGhost(e); } catch (err) { }
    try { markHover(e); } catch (err) { }
    previewStopWatch();                       // 竖屏：手指停住就收起详情浮层（继续挪动会重新弹出）
  }
  function moveGhost(e) {
    if (!drag || !drag.ghost) return;
    var p = pt(e);
    drag.ghost.style.left = p.x + 'px';
    drag.ghost.style.top = p.y + 'px';
    portraitPreviewFollow(e.clientY, true);   // 竖屏：浮层跟手，永远不压住手指 / 正在拖的那张卡
  }
  function markHover(e) {
    document.querySelectorAll('.droppable').forEach(function (n) { n.classList.remove('droppable'); });
    var t = hitTest(e);
    if (t) { t.classList.add('droppable'); }
  }
  function hitTest(e) {
    var p = pt(e);
    var el = document.elementFromPoint(p.x, p.y);
    if (!el) return null;
    return el.closest('[data-drop]');
  }
  // 收尾（正常抬起 / 触屏被取消共用）
  function endDrag() {
    try { document.removeEventListener('pointermove', onMove); } catch (e) { }
    try { document.removeEventListener('pointerup', onUp); } catch (e) { }
    try { document.removeEventListener('pointercancel', cancelDrag); } catch (e) { }
    try { document.querySelectorAll('.droppable').forEach(function (n) { n.classList.remove('droppable'); }); } catch (e) { }
    try { clearGhosts(); } catch (e) { }                // ★ 兜底：拖拽结束时幽灵卡层必须是空的
    /* 拖完立刻收起详情浮层。但"只是点一下"（没挪动）时不立刻收 —— 那样触屏就看不到详情了。
       ⚠ 这条路径上的浮层是 hold=true 打开的（startDrag/moveGhost），1.8s 计时已被清掉，
         所以这里必须自己挂一个自动收，否则"点一下手牌"会让浮层一直挂在屏幕上挡视野。 */
    if (dragMoved) { hidePreview(); }
    else {
      if (pvStopTimer) { clearTimeout(pvStopTimer); pvStopTimer = null; }
      if (portraitMode && !pvTimer) {
        pvTimer = setTimeout(function () { pvTimer = null; portraitPreview(false); }, 2600);
      }
    }
  }
  /* 把拖拽状态彻底复位：监听、幽灵卡、高亮、drag 变量。
     每一步都单独 try —— 这里是在"出问题之后"跑的，不能因为某一步再抛错而半途停下。 */
  function resetDragState() {
    try { document.removeEventListener('pointermove', onMove); } catch (e) { }
    try { document.removeEventListener('pointerup', onUp); } catch (e) { }
    try { document.removeEventListener('pointercancel', cancelDrag); } catch (e) { }
    try { clearGhosts(); } catch (e) { }
    try {
      document.querySelectorAll('.droppable').forEach(function (n) { n.classList.remove('droppable'); });
    } catch (e) { }
    drag = null; dragMoved = false;
  }
  function cancelDrag(e) {
    if (drag && e && !samePointer(e)) return;          // ★ 别的手指被取消 → 不影响本次拖拽
    hidePreview();                                     // 被系统手势打断：详情浮层也要收，不能留在屏幕上
    resetDragState();
    endDrag();
  }
  // 切后台 / 窗口失焦：pointerup 十有八九收不到 → 主动收尾，别让 drag 僵在那儿
  window.addEventListener('blur', function () { if (drag) cancelDrag(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && drag) cancelDrag();
  });
  function onUp(e) {
    if (drag && !samePointer(e)) return;               // ★ 别的手指抬起 → 不能结束本次拖拽
    var t = null;
    try { t = hitTest(e); } catch (err) { t = null; }   // 取落点万一抛错，也不能把 drag 留在非空状态
    var ghost = drag && drag.ghost;
    if (ghost) { try { ghost.remove(); } catch (err) { } }
    var payload = drag; drag = null;
    endDrag();
    if (!payload) return;
    if (!dragMoved) { // 当作点击处理
      dragMoved = false;
      // 点击逻辑已在 click 事件处理
      return;
    }
    dragMoved = false;
    justDragged = true;
    // 触屏抬起后浏览器可能还会补一个 click（tap 容差约 10px）→ 抑制窗口给足，避免"拖完又打出一张"
    setTimeout(function () { justDragged = false; }, 320);
    if (!t) { clearSelect(); return; }
    var tgt = { drop: t.dataset.drop, key: t.dataset.key, uid: t.dataset.uid, slot: t.dataset.slot };
    execute(payload, tgt);
  }

  // 统一落点分发
  function execute(payload, tgt) {
    if (autoBattle) return;
    if (!payload || !tgt) { clearSelect(); return; }
    var s = Engine.state;
    if (s.active !== 'A' || s.winner) { clearSelect(); return; }
    if (pend) { toast('请先完成目标选择，或点击空白处取消'); return; }
    var cd = CARDS[payload.cardId] || EMPTY_CARD;   // 卡表不一致时兜底
    var res = null;
    if (payload.kind === 'hand') {
      if (cd.type === 'monster') {
        if ((cd.tier === 'A' || cd.tier === 'S') && tgt.drop === 'self-monster') {
          res = Engine.tryAction({ type: 'SACRIFICE', iid: payload.iid, targetUid: +tgt.uid });
        } else if (tgt.drop === 'self-slot') {
          res = Engine.tryAction({ type: 'SUMMON', iid: payload.iid, slot: tgt.slot != null ? +tgt.slot : undefined });
        } else if (tgt.drop === 'self-monster' && cd.tier === 'C') {
          res = Engine.tryAction({ type: 'SUMMON', iid: payload.iid, slot: undefined });
        }
      } else if (cd.type === 'weapon' || cd.type === 'armor') {
        if (tgt.drop === 'self-monster') res = Engine.tryAction({ type: 'EQUIP', iid: payload.iid, targetUid: +tgt.uid });
      } else if (cd.type === 'wand') {
        if (tgt.drop === 'wand') res = Engine.tryAction({ type: 'PLACE_WAND', iid: payload.iid });
      } else if (cd.type === 'throw') {
        if (tgt.drop === 'enemy-monster') res = Engine.tryAction({ type: 'USE', iid: payload.iid, targetUid: +tgt.uid });
      } else if (cd.type === 'treasure' || cd.type === 'food' || cd.type === 'potion' || cd.type === 'scroll') {
        if (cd.id === 'a-033-2') { startEmblem(payload.iid, payload.cardId); return; }   // 破损纹章需选防具
        if (cd.id === 'a-029-2') { startUpgrade(payload.iid, payload.cardId); return; }  // 升级卷轴需选目标
        if (cd.id === 'a-116-2') { startMirror(payload.iid, payload.cardId); return; }    // 镜像卷轴需选我方怪物
        if (cd.id === 'a-014-2') { startChest(payload.iid, payload.cardId); return; }    // 黄金宝箱需选弃牌
        res = Engine.tryAction({ type: 'USE', iid: payload.iid });
      }
    } else if (payload.kind === 'board') {
      if (tgt.drop === 'enemy-monster') res = Engine.tryAction({ type: 'ATTACK', attackerUid: payload.uid, targetUid: +tgt.uid });
      else if (tgt.drop === 'enemy-player-zone') res = Engine.tryAction({ type: 'ATTACK', attackerUid: payload.uid, targetKey: 'B' });
    }
    if (res && !res.ok && !res.silent) toast(res.msg);
    clearSelect();
  }

  function hintFor(payload) {
    var cd = CARDS[payload.cardId] || EMPTY_CARD;   // 卡表不一致时兜底
    var msg = '';
    /* ⚠ 必须先区分「手牌里的怪物」和「场上已出场的怪物」：
       两边的 cardId 都是怪物卡，但意图完全不同 ——
       手牌是"要召唤"，场上（战斗阶段选中）是"要攻击"。
       之前不区分，战斗阶段点己方怪物会提示"点击己方空位召唤"，纯误导。 */
    if (payload.kind === 'board') {
      msg = '已选中我方怪物 —— 点击敌方怪物，或点击对手空场攻击本体';
    } else if (cd.type === 'monster') msg = (cd.tier === 'A' || cd.tier === 'S') ? '点击己方场上怪物进行献祭召唤' : '点击己方空位召唤';
    else if (cd.type === 'weapon' || cd.type === 'armor') msg = '点击己方怪物装备（每只怪物仅可装备一件）';
    else if (cd.type === 'throw') msg = '点击敌方怪物投掷';
    else if (cd.type === 'wand') msg = '点击法杖栏放置';
    else if (cd.type === 'trap') msg = '陷阱：条件满足时自动触发，无需主动使用';
    else if (cd.type === 'ring') msg = '戒指：在手牌中持续生效，无需使用';
    else msg = '已选中，拖到中央或点击任意处使用';
    toast(msg);
  }

  function highlight(el) {}
  function clearSelect() { selected = null; if (Engine.state) render(Engine.state); }
  function markHover2() {}

  /* ================= 出牌横幅 / 攻击连线（表现层） ================= */
  function pushPlay(e) { feed.push(e); pumpFeed(); }
  function pumpFeed() {
    if (feedBusy || !feed.length) return;
    var box = $('playFeed');
    if (!box) { feed = []; return; }
    var e = feed.shift(), cd = CARDS[e.cardId];
    if (!cd) return;
    feedBusy = true;
    var d = document.createElement('div');
    d.className = 'pfc' + (e.mine ? ' mine' : '');
    d.innerHTML = '<img src="' + cardThumb(cd) + '"><div class="pf-txt">' + (e.mine ? '你' : '对手') +
      (e.verb || '使用') + '<b>' + cd.name + '</b></div>';
    box.appendChild(d);
    Sfx.play('play');
    setTimeout(function () {
      d.classList.add('out');
      setTimeout(function () {
        if (d.parentNode) d.parentNode.removeChild(d);
        feedBusy = false;
        pumpFeed();
      }, 300);
    }, 1200);
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  /* 舞台当前的设计尺寸。竖屏模式下宽高是互换的（720×1280），
     写死 Rules.DESIGN_W/H 会让画布只有 1280×720 —— SVG 默认 overflow:hidden，
     y>720 的连线（打己方场/己方头像那条箭头）会被整段裁掉，看起来就是"箭头不显示"。 */
  function stageDesignSize() {
    var st = $('stage') || {};
    var w = parseFloat(st.style && st.style.width) || Rules.DESIGN_W;
    var h = parseFloat(st.style && st.style.height) || Rules.DESIGN_H;
    return { w: w, h: h };
  }
  function fxSvg() {
    var layer = $('fxLayer'); if (!layer) return null;
    var svg = layer.querySelector('svg');
    if (!svg) {
      svg = document.createElementNS(SVGNS, 'svg');
      svg.style.position = 'absolute'; svg.style.left = '0'; svg.style.top = '0';
      layer.appendChild(svg);
    }
    // 每次都按当前舞台尺寸校正（竖屏/横屏切换后画布要跟着变）
    var d = stageDesignSize();
    if (svg.getAttribute('width') !== String(d.w)) svg.setAttribute('width', d.w);
    if (svg.getAttribute('height') !== String(d.h)) svg.setAttribute('height', d.h);
    return svg;
  }
  // 元素中心 → 舞台坐标系（舞台整体缩放过，需除以缩放系数）
  function stagePoint(el) {
    var r = el.getBoundingClientRect(), st = $('stage').getBoundingClientRect();
    return { x: (r.left - st.left + r.width / 2) / scaleK, y: (r.top - st.top + r.height / 2) / scaleK };
  }
  // 定位一个战场元素：优先按怪物 uid；怪物已被击破/返回手牌时，退回按格子定位
  function fxElAt(key, uid, slot) {
    if (uid != null) {
      var m = document.querySelector('[data-uid="' + uid + '"]');
      if (m) return m;
    }
    if (key && slot != null && slot >= 0) {
      return document.querySelector((key === 'A' ? '#myBoard' : '#oppBoard') + ' .cell[data-slot="' + slot + '"]');
    }
    return null;
  }
  // 攻击连线：一眼看清"哪个怪打哪个"（目标被打死也能画出来）
  // 目标半场以「攻击者实际所在的半场」为准推导，避免事件里的阵营键把箭头指向自己/队友
  function drawAttack(ev) {
    var svg = fxSvg(); if (!svg) return;
    var from = fxElAt(ev.fromKey, ev.from, ev.fromSlot);
    var fromSide = from ? (from.closest('#myBoard') ? 'A' : (from.closest('#oppBoard') ? 'B' : null)) : null;
    if (!fromSide) fromSide = ev.fromKey;
    var tgtSide = fromSide === 'A' ? 'B' : (fromSide === 'B' ? 'A' : (ev.toKey || ev.toPlayer));
    var to = null;
    if (ev.to != null) to = document.querySelector('[data-uid="' + ev.to + '"]') || fxElAt(tgtSide, null, ev.toSlot);
    else to = (tgtSide === 'A' ? $('myInfo') : $('oppInfo'));
    if (!from || !to) return;
    var p1 = stagePoint(from), p2 = stagePoint(to);
    var g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'fx-fade');
    var line = document.createElementNS(SVGNS, 'line');
    line.setAttribute('class', 'atkline');
    line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y);
    line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
    var dx = p2.x - p1.x, dy = p2.y - p1.y;
    var len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    line.style.strokeDasharray = String(len);
    line.style.strokeDashoffset = String(len);
    line.style.transition = 'stroke-dashoffset .26s ease-out';
    g.appendChild(line);
    var ang = Math.atan2(dy, dx), hl = 17;
    var head = document.createElementNS(SVGNS, 'polygon');
    head.setAttribute('class', 'atkhead');
    head.setAttribute('points', [
      p2.x + ',' + p2.y,
      (p2.x - hl * Math.cos(ang - 0.42)) + ',' + (p2.y - hl * Math.sin(ang - 0.42)),
      (p2.x - hl * Math.cos(ang + 0.42)) + ',' + (p2.y - hl * Math.sin(ang + 0.42))
    ].join(' '));
    g.appendChild(head);
    svg.appendChild(g);
    requestAnimationFrame(function () { line.style.strokeDashoffset = '0'; });
    Anim.flash(from, 'hitflash', 360);
    setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 1000);
  }

  /* ================= 自动跳过己方回合（持续开关） ================= */
  // 用轮询定时器驱动：点一下持续跳过，直到对局结束或再次点开关闭
  function startAutoSkip() {
    stopAutoSkip();
    skipTimer = setInterval(autoSkipStep, 260);
  }
  function stopAutoSkip() { if (skipTimer) { clearInterval(skipTimer); skipTimer = null; } }
  function autoSkipStep() {
    var st = Engine.state;
    if (!autoSkip) { stopAutoSkip(); return; }
    if (!st || st.winner) { if (st && st.winner) stopAutoSkip(); return; }
    if (st.active !== 'A' || st.pending) return;   // 对手回合 / 需要你决定 → 等
    if (st.phase === 'PREP') Engine.tryAction({ type: 'CONFIRM_BATTLE' });
    if (!Engine.state.pending && !Engine.state.winner) Engine.tryAction({ type: 'END_TURN' });
  }
  function tickAutoSkip() {
    if (autoSkip && !skipTimer) startAutoSkip();
    if (!autoSkip && skipTimer) stopAutoSkip();
  }

  /* ================= 踏上征途：自动战斗（业余档 AI 代打我方） ================= */
  // ai.js 是以"B 方视角"写的（内部大量以 B 为自己、A 为对手），所以代打我方时借学院考核的
  // 现成机制 Academy.botStep：翻转双方阵营 → AI 以 B 身份行动（实际操作的是我方数据）→ 翻回并翻译事件。
  // 翻面期间挂起渲染（suspendRender），画面不会切成对手视角。
  function setAutoPlay(on) {
    if (!runBattle) { toast('「自动战斗」只在踏上征途的对局里可用'); return; }
    autoPlay = !!on;
    if (autoPlay) {
      autoSkip = false; stopAutoSkip();                 // 与"自动跳过己方回合"互斥
      var s0 = Engine.state;
      // 代打期间阵营会被翻转，引擎里按"A = 我方"记的成就计数会记错 → 本局不计入成就
      if (s0 && s0.ach) s0.ach.off = true;
      startAutoPlay();
      toast('自动战斗：开（我方交给业余档 AI 代打；本局不计入成就）');
    } else {
      stopAutoPlay();
      toast('自动战斗：关');
    }
    Sfx.play('click');
    if (Engine.state) render(Engine.state);
  }
  function startAutoPlay() {
    stopAutoPlay();
    autoPlayTimer = setInterval(autoPlayTick, 620);
  }
  function stopAutoPlay() { if (autoPlayTimer) { clearInterval(autoPlayTimer); autoPlayTimer = null; } }
  function autoPlayTick() {
    var s = Engine.state;
    if (!autoPlay || !runBattle) { stopAutoPlay(); return; }
    if (!s) return;
    if (s.winner) { autoPlay = false; stopAutoPlay(); render(s); return; }
    if (s.active !== 'A') return;                        // 对手回合：交给常规 AI 计时器
    if (feedBusy) return;                                // 出牌横幅还在播 → 等它播完
    if (s.pending) {                                     // 待决提示：自动按保守选项处理
      suspendRender = true;
      try { Engine.resolvePrompt(s.pending.kind === 'CHOOSE_CARDS' ? null : false); }
      finally { suspendRender = false; }
      render(Engine.state);
      return;
    }
    var prevDiff = AI.getDifficulty();                    // 记住玩家/对手原本的档位
    suspendRender = true;
    try {
      AI.setDifficulty('amateur');                       // 代打固定用业余档
      Academy.botStep(s);                                // 翻面 → AI.step() → 翻回 + 事件翻译
    } catch (e) {
      console.error('[自动战斗]', e);
    } finally {
      AI.setDifficulty(prevDiff);                         // 还原档位：对手仍按玩家选的难度行动
      suspendRender = false;
    }
    render(Engine.state);
  }
  // 每次渲染同步：按钮显隐/文案 + 计时器启停
  function tickAutoPlay(s) {
    if (autoPlay && (!runBattle || !s || s.winner)) { autoPlay = false; stopAutoPlay(); }
    if (autoPlay && !autoPlayTimer) startAutoPlay();
    var btn = $('battleAutoBtn');
    if (btn) {
      btn.textContent = autoPlay ? '自动战斗：开' : '自动战斗';
      btn.className = 'pxbtn small' + (autoPlay ? ' on' : ' ghost') + (runBattle ? '' : ' hidden');
    }
  }

  /* ================= 学院考核：双方 AI 自动对战（可观看） ================= */
  function startAcademyBattle(opts) {
    // ★ 学院考核同样是"单机局"，进来先清掉观战/联机标志（同 startBattle 的理由）
    if (window.Net && Net.setNetBattle) Net.setNetBattle(false);
    // 学院考核固定「专业」档：双方 AI 都按专业难度打（不受玩家自己的难度设置影响）。
    // 对局结束（endAcademyBattle）或离开学院（showMenu）时恢复成玩家设置，其它模式照旧遵循玩家选择。
    AI.setDifficulty('pro');
    var s = Engine.newGame({
      playerDeck: opts.myDeck.slice(), aiDeck: opts.oppDeck.slice(),
      playerName: SaveData.getPlayerName(), aiName: opts.oppName,
      mode: 'academy', achOff: true,                   // 学院考核是双方自动对战 → 不计入成就（成就由考核结算负责）
      playerHp: ACADEMY_CONF.BATTLE_HP, aiHp: ACADEMY_CONF.BATTLE_HP,
      maxRounds: opts.limit, seed: opts.seed,
      first: opts.first || 'A',                        // 先后手由学院考核抛硬币决定
      noHpFloor: true,                                 // 学院考核：血量无下限，打到回合上限再比输出
      playerDmgMult: ACADEMY_CONF.PLAYER_DMG_MULT,     // 打脸伤害在输出结算里 ×2（与后台模拟一致）
      // 学院特技（战斗 / 种族类）：由 academy_ui 传入双方的 mod 表。
      // ⚠ 漏了这两行 → 玩家在学院里选到的【磨刀石】【元素亲和】等对局内加成完全无效，
      //   而玩家唯一真正亲手打的也就是这一场（AI 之间是 Academy.newBattleState 在跑，那边有传）。
      perkA: opts.perkA || null, perkB: opts.perkB || null
    });
    s.players.A.isAI = true; s.players.B.isAI = true;
    autoBattle = { limit: opts.limit, onEnd: opts.onEnd, timer: null, done: false, stall: 0, lossCap: opts.lossCap || 0 };
    selected = null; pend = null; battleResolved = false;
    autoSkip = false; settingsOpen = false; viewer = null; feed = []; feedBusy = false;
    stopAutoSkip(); stopAI();
    runBattle = false; autoPlay = false; stopAutoPlay();   // 学院考核用自带的双方代打，不用"自动战斗"
    showBattle();
    render(Engine.state);
    startAutoTimer();
  }
  function startAutoTimer() {
    stopAutoTimer();
    if (!autoBattle) return;
    autoBattle.timer = setInterval(autoBattleTick, 620);
  }
  function stopAutoTimer() { if (autoBattle && autoBattle.timer) { clearInterval(autoBattle.timer); autoBattle.timer = null; } }
  function autoBattleTick() {
    var ab = autoBattle; if (!ab || ab.done) return;
    var s = Engine.state;
    if (!s) return;
    if (s.winner) { endAcademyBattle(); return; }
    if (feedBusy) return;                    // 出牌横幅还在播 → 等一下再走下一步
    var acted = false;
    suspendRender = true;                    // 翻转视角期间挂起渲染，避免画面抖到对手视角
    try { acted = Academy.botStep(s); }
    catch (e) { console.error('[自动对战]', e); }
    finally { suspendRender = false; }
    while (s.pending) {
      suspendRender = true;
      try { Engine.resolvePrompt(s.pending.kind === 'CHOOSE_CARDS' ? null : false); }
      finally { suspendRender = false; }
    }
    if (s.winner) { render(s); endAcademyBattle(); return; }
    ab.stall = acted ? 0 : ab.stall + 1;
    if (!acted && ab.stall > 4) {            // 兜底：AI 无动作时强制推进
      ab.stall = 0;
      var t = s.phase === 'PREP' ? 'CONFIRM_BATTLE' : 'END_TURN';
      var r = Engine.tryAction({ type: t, _ai: true });
      if (!r || !r.ok) Engine.tryAction({ type: 'END_TURN', _ai: true });
    }
    render(Engine.state);
  }
  function endAcademyBattle() {
    var ab = autoBattle; if (!ab || ab.done) return;
    ab.done = true; stopAutoTimer();
    AI.setDifficulty(SaveData.getDifficulty());   // 学院固定专业档 → 打完恢复玩家难度
    var s = Engine.state;
    var da = s ? (s.dealt.A || 0) : 0, db = s ? (s.dealt.B || 0) : 0;
    var ha = (s && s.healed) ? (s.healed.A || 0) : 0, hb = (s && s.healed) ? (s.healed.B || 0) : 0;
    // 觉醒【贪婪】在引擎里按 A/B 记了账（s.greedGain），这里一起带出去。
    // 漏掉的话玩家局的贪婪学时会被静默丢弃（学院后台模拟那条链是另一个入口，两边都要传）。
    var ga = (s && s.greedGain) ? (s.greedGain.A || 0) : 0;
    var gb = (s && s.greedGain) ? (s.greedGain.B || 0) : 0;
    setTimeout(function () {
      var cb = ab.onEnd;
      // 第 5 个参数：我方（玩家）这一场的输出归因，供学院战报显示排行
      // 第 6、7 个参数：双方【贪婪】觉醒额外获得的学时
      if (cb) cb(da, db, ha, hb, (s && s.dmgBy) ? s.dmgBy.A : null, ga, gb);
      autoBattle = null;
    }, 900);
  }

  /* ================= 对局内设置面板 ================= */
  function battleSettings() {
    var modal = $('modal'), s = Engine.state;
    settingsOpen = true;
    modal.classList.remove('hidden');
    var au = SaveData.getAudio();
    var rm = RunManager.get();
    var acad = !!autoBattle;                       // 学院考核自动对战：只有音效可调
    var canRestart = !acad && !tournamentBattle && !!(rm && rm.status === 'battle');
    var h = '<div class="mbox"><h3>' + (acad ? '考核对战' : '对局设置') + '</h3>';
    if (acad) {
      // 两个难度都写出来：前者是"AI 实际在跑的档"（学院固定专业），后者是玩家自己的设置。
      // 觉得"己方 AI 不像专业"时看这一行就能分清：是档位没生效，还是加载了旧脚本。
      h += '<p class="dim">双方 AI 自动对战进行中（按总输出差额扣减生命）　AI 实际难度：' + diffName() +
        '　（你的难度设置：' + diffNameOf(SaveData.getDifficulty()) + '）</p>';
    } else if (tournamentBattle || masterBattle) {
      // 联盟赛 / 大师赛：不用「自动战斗」（我方要自己打），但要能「自动跳过己方回合」
      var skipRow = '<div class="setrow"><span>自动跳过己方回合</span><button id="bsSkip" class="pxbtn' + (autoSkip ? '' : ' ghost') + '">' + (autoSkip ? '开' : '关') + '</button></div>' +
        '<p class="dim">开启后持续跳过你的回合（准备+战斗），直到对局结束或你再次点开关闭；遇到需要你选择卡牌 / 是否发动陷阱时会暂停等待。</p>';
      h += '<p class="dim">' + (masterBattle ? '大师赛对局' : '魔绫大赛对局') + '（不可重开）　对手：' + (s ? s.players.B.name : '') + '　难度：' + diffName() + '</p>' + skipRow;
    } else {
      h += '<p class="dim">对手：' + (s ? s.players.B.name : '') + '　难度：' + diffName() + '　第 ' + (s ? s.round : 1) + ' 大回合</p>' +
        '<div class="setrow"><span>自动跳过己方回合</span><button id="bsSkip" class="pxbtn' + (autoSkip ? '' : ' ghost') + '">' + (autoSkip ? '开' : '关') + '</button></div>' +
        '<p class="dim">开启后持续跳过你的回合（准备+战斗），直到对局结束或你再次点开关闭；遇到需要你选择卡牌 / 是否发动陷阱时会暂停等待。</p>';
    }
    h += '<div class="setrow"><span>音效开关</span><button id="bsSound" class="pxbtn' + (au.on ? '' : ' ghost') + '">' + (au.on ? '开' : '关') + '</button></div>';
    h += '<div class="mbtns">';
    if (canRestart) h += '<button id="bsRestart" class="pxbtn ghost">重开本局</button>';
    // 返回主菜单：普通对局也能走（否则对局中按返回只能开设置、再按只能关设置，出不去）。
    //   学院（acad）是自动对战时间轴，中断会丢结算 → 不给；
    //   联机大师赛（masterBattle）用下面的「放弃本局（判负并回房间）」→ 不给。
    if (!acad && !masterBattle) h += '<button id="bsHome" class="pxbtn ghost">' + (tournamentBattle ? '退出到主页' : '返回主菜单') + '</button>';
    if ((tournamentBattle || masterBattle) && !acad) h += '<button id="bsForfeit" class="pxbtn ghost">' + (masterBattle ? '放弃本局（判负并回房间）' : '放弃本局（判负）') + '</button>';
    h += '<button id="bsClose" class="pxbtn">关闭</button></div></div>';
    modal.innerHTML = h;
    if ($('bsSkip')) $('bsSkip').onclick = function () {
      autoSkip = !autoSkip; Sfx.play('click');
      if (autoSkip) startAutoSkip(); else stopAutoSkip();
      toast(autoSkip ? '自动跳过己方回合：开（再点关闭）' : '自动跳过己方回合：关');
      if (Engine.state) render(Engine.state);
      battleSettings();
    };
    // 返回主菜单 / 魔绫大赛：退出到主页（大赛进度已持久化，可随时从"魔绫大赛"继续）
    if ($('bsHome')) $('bsHome').onclick = function () {
      settingsOpen = false; modal.classList.add('hidden');
      // 跑图对局中途退出：先把跑图状态退回上一个节点。
      // 否则 run.status 停在 'battle'，下次打开地图会以为"战斗还没打完"，
      // 而 canEnter() 要求 status === 'map' → 所有节点都进不去（"该节点无法到达"）。
      // 退回后那场战斗可重新挑战，进度不丢。
      if (window.RunManager && RunManager.resumeIfInterrupted) RunManager.resumeIfInterrupted();
      showMenu();
    };
    if ($('bsForfeit')) $('bsForfeit').onclick = function () {
      confirmBox('放弃本局将判本场为负，确定？', function () {
        settingsOpen = false; modal.classList.add('hidden');
        if (masterBattle && window.MasterUI) { masterBattle = false; MasterUI.onMatchEnd(false); }
        else if (window.TourUI && TourUI.forfeitMatch) TourUI.forfeitMatch(); else showMenu();
      }, null, { yes: '放弃本局', no: '继续对局' });
    };
    $('bsSound').onclick = function () {
      var o = SaveData.setAudio({ on: !SaveData.getAudio().on });
      Sfx.setEnabled(o.on);
      if (o.on) { Sfx.unlock(); Sfx.bgmStart(); } else Sfx.bgmStop();
      battleSettings();
    };
    if ($('bsRestart')) $('bsRestart').onclick = function () {
      confirmBox('确定重开本局？当前对局进度将被放弃。', function () {
        settingsOpen = false; autoSkip = false;
        modal.classList.add('hidden');
        RunUI.restartBattle();
      }, null, { yes: '重开', no: '取消' });
    };
    $('bsClose').onclick = function () {
      settingsOpen = false; modal.classList.add('hidden');
      if (Engine.state) render(Engine.state);   // 若有待决提示（如麻痹陷阱），关面板后要能重新看到
    };
  }

  /* ================= 卡牌详情悬停（学院考核 / 魔绫大赛奖励等） ================= */
  function bindCardTips(box) {
    if (!box || box.__tipBound) return;
    box.__tipBound = true;
    var cur = null;
    box.addEventListener('mouseover', function (e) {
      var el = e.target.closest && e.target.closest('[data-tip]');
      if (!el || el === cur) return;
      cur = el;
      CardTip.show(el.getAttribute('data-tip'), e.clientX, e.clientY, el.getAttribute('data-tip-aw'));
    });
    box.addEventListener('mousemove', function (e) { if (cur) CardTip.move(e.clientX, e.clientY); });
    box.addEventListener('mouseout', function (e) {
      if (e.target.closest && e.target.closest('[data-tip]')) { cur = null; CardTip.hide(); }
    });
    box.addEventListener('pointerdown', function () { cur = null; CardTip.hide(); });
    // 触屏（组卡器/商店/奖励卡池等）：按下即显示卡牌详情；点到非卡牌处则保持收起
    box.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;                 // 桌面走 hover
      var el = e.target.closest && e.target.closest('[data-tip]');
      if (!el) { cur = null; CardTip.hide(); return; }
      cur = el;
      CardTip.show(el.getAttribute('data-tip'), e.clientX, e.clientY, el.getAttribute('data-tip-aw'));
    });
  }

  /* ================= 提示 / 弹窗 ================= */
  // 同一条提示短时间内反复出现时只显示一次（避免"还没轮到你"这类提示刷屏）
  var lastToastMsg = '', lastToastAt = 0;
  function toast(msg) {
    if (!msg) return;
    var now = Date.now();
    if (msg === lastToastMsg && now - lastToastAt < 2200) return;
    lastToastMsg = msg; lastToastAt = now;
    var t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, 1600);
  }
  /* 关掉所有浮层（结算弹窗等）—— 联机时服务器通知进入下一阶段要用到，
   * 否则结算弹窗会盖在准备面板上。 */
  function closeOverlays() {
    var m = $('modal');
    if (m) { m.innerHTML = ''; m.classList.add('hidden'); }
    var t2 = $('toast');
    if (t2) t2.classList.remove('show');
    portraitPreview(false);            // 竖屏：详情浮层也属于"浮层"，进下一阶段时一并收掉
    var f = $('dkFloat'); if (f) f.classList.add('hidden');
  }

  function renderModal(s) {
    var modal = $('modal');
    if (s.pending || s.winner) settingsOpen = false;   // 有提示 / 结算时，设置面板自动收起
    if (!s.pending) pausedNotice = false;
    if (s.pending && autoSkip && !pausedNotice) { pausedNotice = true; toast('自动跳过已暂停：需要你的决定'); }
    // 联机：对手正在做选择（服务器只发来只读空壳，不给任何按钮）
    if (s.pending && s.pending.kind === 'WAIT_OPPONENT') {
      modal.classList.remove('hidden');
      modal.innerHTML = '<div class="mbox"><h3>对手正在抉择…</h3>' +
        '<p class="dim">等待对手完成选择（陷阱 / 召唤技能 / 检索）</p></div>';
      return;
    }
    if (s.pending && s.pending.kind === 'CHOOSE_CARDS') {
      var pd = s.pending, actor = s.players[pd.actorKey], step = pd.steps[pd.idx];
      if (!actor || !step) { modal.classList.add('hidden'); return; }
      var zone = step.from === 'deck' ? actor.deck : (step.from === 'discard' ? actor.discard : actor.hand);
      // 候选优先用引擎算好的纯数据（联机只有这个）；本机旧数据才回退到 pred 过滤
      var cands = step.cands || (step.pred ? zone.filter(step.pred).map(function (c) {
        var cd0 = C(c);
        return { iid: c.iid, cardId: c.cardId, name: cd0.name, tier: cd0.tier || '', type: cd0.type };
      }) : []);
      var sel = [];
      modal.classList.remove('hidden');
      // exact 步骤（焰浪法杖等）：必须选够 N 张（候选不足时按实际可选项数封顶）
      var needN = step.exact ? Math.min(step.count || 0, cands.length) : 0;
      var cntTip = needN ? ('（需选 ' + needN + ' 张，已选 <b>0</b>/' + needN + '）') : ('（最多 ' + step.count + ' 张）');
      var h = '<div class="mbox"><h3>' + (pd.actorKey === 'A' ? '请选择卡牌' : '对手正在选择卡牌') + '</h3>' +
        '<p>' + (step.label || '选择卡牌') + '<span id="ckCnt">' + cntTip + '</span></p><div class="choices">';
      cands.forEach(function (c) {
        h += '<button class="pxbtn ghost cand" data-iid="' + c.iid + '">' + c.name + (c.type === 'monster' && c.tier ? ' [' + c.tier + ']' : '') + '</button>';
      });
      h += '</div><div class="mbtns"><button id="ckOk" class="pxbtn">确定</button></div></div>';
      modal.innerHTML = h;
      function refreshCnt() {
        var el = $('ckCnt');
        if (el && needN) el.innerHTML = '（需选 ' + needN + ' 张，已选 <b>' + sel.length + '</b>/' + needN + '）';
      }
      Array.prototype.forEach.call(modal.querySelectorAll('.cand'), function (btn) {
        btn.onclick = function () {
          /* ⚠ 不能无脑 `+dataset.iid`：古神之拳的形态候选 iid 是字符串（'burn'/'earth'…），
             强转数字会变成 NaN，回传后 applyChoice 拿到 NaN → 形态永远设不上（日志里"NaN形态"）。
             这里只把纯数字串转成数字，其余原样保留。 */
          var _raw = btn.dataset.iid;
          var iid = /^\d+$/.test(_raw) ? +_raw : _raw;
          var k = sel.indexOf(iid);
          if (k >= 0) { sel.splice(k, 1); btn.style.outline = ''; }
          else { if (sel.length >= step.count) { toast('最多选择 ' + step.count + ' 张'); return; } sel.push(iid); btn.style.outline = '3px solid #ffd166'; }
          refreshCnt();
        };
      });
      $('ckOk').onclick = function () {
        if (!sel.length) { toast('请选择卡牌'); return; }
        // ★ 卡面写着"必须弃掉 N 张"的，选不够不许确定（以前只要 ≥1 张就放行，
        //   于是焰浪法杖升级后本该弃 2 张，对手点 1 张也能过）
        if (needN && sel.length < needN) { toast('必须选择 ' + needN + ' 张（当前已选 ' + sel.length + ' 张）'); return; }
        modal.classList.add('hidden');
        Engine.resolvePrompt({ iids: sel });
      };
      return;
    }
    // 可选技能（如豺狼巡查）：由召唤者决定发不发动
    if (s.pending && s.pending.kind === 'OPTION_SKILL') {
      var pdSkill = s.pending;
      modal.classList.remove('hidden');
      modal.innerHTML = '<div class="mbox"><h3>' + pdSkill.label + '</h3>' +
        '<p>是否发动其召唤技能？</p>' +
        '<p class="dim">' + (pdSkill.desc || '') + '</p>' +
        '<div class="mbtns"><button id="os1" class="pxbtn">发动</button><button id="os0" class="pxbtn ghost">不发动</button></div></div>';
      $('os1').onclick = function () { modal.classList.add('hidden'); Engine.resolvePrompt(true); };
      $('os0').onclick = function () { modal.classList.add('hidden'); Engine.resolvePrompt(false); };
      return;
    }
    if (s.pending && s.pending.kind === 'TRAP_PARALYZE') {
      modal.classList.remove('hidden');
      modal.innerHTML = '<div class="mbox"><h3>对手进入战斗阶段</h3>' +
        '<p>你手牌中的【麻痹陷阱】满足条件，是否发动？</p>' +
        '<p class="dim">发动后立即结束对手的回合（跳过其战斗阶段）</p>' +
        '<div class="mbtns"><button id="pk1" class="pxbtn">发动</button><button id="pk0" class="pxbtn ghost">不发动</button></div></div>';
      $('pk1').onclick = function () { modal.classList.add('hidden'); Engine.resolvePrompt(true); };
      $('pk0').onclick = function () { modal.classList.add('hidden'); Engine.resolvePrompt(false); };
      return;
    }
    /* 羊群陷阱（a-158-02）：卡面"可发动" —— 同样由你决定，不发动则留手牌 */
    if (s.pending && s.pending.kind === 'TRAP_SHEEP') {
      modal.classList.remove('hidden');
      modal.innerHTML = '<div class="mbox"><h3>对手使用了宝藏/药水卡</h3>' +
        '<p>你手牌中的【羊群陷阱】满足条件，是否发动？</p>' +
        '<p class="dim">发动后双方所有空位各衍生一张【魔法绵羊】；不发动则陷阱留在手牌</p>' +
        '<div class="mbtns"><button id="sp1" class="pxbtn">发动</button>' +
        '<button id="sp0" class="pxbtn ghost">不发动</button></div></div>';
      $('sp1').onclick = function () { modal.classList.add('hidden'); Engine.resolvePrompt(true); };
      $('sp0').onclick = function () { modal.classList.add('hidden'); Engine.resolvePrompt(false); };
      return;
    }
    /* 闪光陷阱（a-138-02）：卡面"**可**发动" → 由你决定（不发动时陷阱留在手里，以后还能用） */
    if (s.pending && s.pending.kind === 'TRAP_FLASH') {
      var pdlf = s.pending;
      modal.classList.remove('hidden');
      modal.innerHTML = '<div class="mbox"><h3>对手召唤了怪物</h3>' +
        '<p>你手牌中的【闪光陷阱】满足条件，是否发动？</p>' +
        '<p class="dim">发动后，对手接下来 ' + (pdlf.turns || 2) + ' 回合内无法使用投掷物/法杖卡' +
        '；不发动则陷阱留在手牌（以后仍可发动）</p>' +
        '<div class="mbtns"><button id="fl1" class="pxbtn">发动</button>' +
        '<button id="fl0" class="pxbtn ghost">不发动</button></div></div>';
      $('fl1').onclick = function () { modal.classList.add('hidden'); Engine.resolvePrompt(true); };
      $('fl0').onclick = function () { modal.classList.add('hidden'); Engine.resolvePrompt(false); };
      return;
    }
    if (s.winner) {
      // 观战者：不用"自己"的口吻播报（否则会显示"你赢了/你输了"），改成"XX 击败了 XX"
      if (window.Net && Net.isSpectator && Net.isSpectator()) {
        if (battleResolved) { modal.classList.add('hidden'); return; }
        battleResolved = true;
        modal.classList.remove('hidden');
        var escN = function (t) {
          return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
          });
        };
        var winA = (s.winner === 'A');
        var wName = ((winA ? s.players.A : s.players.B) || {}).name || '一方';
        var lName = ((winA ? s.players.B : s.players.A) || {}).name || '另一方';
        modal.innerHTML = '<div class="mbox"><h3>' +
          (s.winner === 'draw' ? '平局' : (escN(wName) + ' 击败了 ' + escN(lName))) + '</h3>' +
          '<p class="dim">本局结束</p>' +
          '<div class="mbtns"><button id="masterOkBtn" class="pxbtn">返回房间</button></div></div>';
        Sfx.play('win');
        if ($('masterOkBtn')) $('masterOkBtn').onclick = function () {
          modal.classList.add('hidden');
          if (window.MasterUI && MasterUI.onSpectateEnd) MasterUI.onSpectateEnd();
        };
        return;
      }
      if (autoBattle) { modal.classList.add('hidden'); return; }   // 考核对战：结算由学院考核界面负责
      // 入学手册：结算与毕业弹窗由教程负责 → 这里直接返回（并**不动**模态框，免得把毕业弹窗盖掉）
      if (tutorialBattle) return;
      if (battleResolved) { modal.classList.add('hidden'); return; }
      modal.classList.remove('hidden');
      var rm = RunManager.get();
      var runBattle = !!(rm && rm.status === 'battle');
      var head, bodyTxt;
      var isBoss = !!s.bossUid;                    // 晋升之路：BOSS 关（以 BOSS 是否被击破判定）
      if (isBoss) {
        head = (s.winner === 'A') ? '通关！' : '挑战失败…';
        bodyTxt = (s.winner === 'A') ? '你击破了本关 BOSS！' : '本关 BOSS 未被击破（第 ' + s.round + ' 回合）。';
      } else if (s.winner === 'draw') {
        head = '平局';
        bodyTxt = '已达 ' + Rules.MAX_ROUNDS + ' 大回合上限，双方血量相同。';
      } else if (s.winner === 'A') {
        head = '胜利！'; bodyTxt = '你击败了 ' + s.players.B.name + '。';
      } else {
        head = '失败…'; bodyTxt = '你被 ' + s.players.B.name + ' 击败了。';
      }
      var kind = isBoss ? 'boss' : (runBattle ? 'run' : (tournamentBattle ? 'tour' : (masterBattle ? 'master' : 'menu')));
      // 赛后输出排行：联盟赛与大师赛都显示（同一套伤害归因数据）
      var stat = (kind === 'tour' || kind === 'master') ? dmgStatHtml(s.dmgBy && s.dmgBy.A) : '';
      var btns = kind === 'run'
        ? '<div class="mbtns"><button id="nextBtn" class="pxbtn">' + (s.winner === 'A' ? '继续前进' : '查看结果') + '</button></div>'
        : kind === 'tour'
          ? '<div class="mbtns"><button id="tourOkBtn" class="pxbtn">查看结果</button></div>'
          : kind === 'master'
            ? '<div class="mbtns"><button id="masterOkBtn" class="pxbtn">返回房间</button></div>'
            : kind === 'boss'
              ? '<div class="mbtns"><button id="bossOkBtn" class="pxbtn">查看结果</button></div>'
              : '<div class="mbtns"><button id="menuBtn" class="pxbtn">返回主菜单</button></div>';
      modal.innerHTML = '<div class="mbox"><h3>' + head + '</h3><p>' + bodyTxt + '</p>' + stat + btns + '</div>';
      if (stat) bindCardTips(modal);                        // 排行里的卡名可悬停看详情
      Sfx.play(s.winner === 'A' ? 'win' : 'lose');
      var resolve = function () {
        battleResolved = true;
        modal.classList.add('hidden');
        if (kind === 'run') RunUI.onBattleEnd(s.winner === 'A');
        else if (kind === 'tour') { tournamentBattle = false; if (window.TourUI) TourUI.onMatchEnd(s.winner === 'A'); }
        else if (kind === 'master') {
      masterBattle = false;
      if (window.MasterUI) {
        // 观战者只看结局、直接回房间（不计比分）
        if (Net.isSpectator && Net.isSpectator()) MasterUI.onSpectateEnd();
        else MasterUI.onMatchEnd(s.winner === 'A');
      }
    }
        else if (kind === 'boss') { if (window.BossUI) BossUI.onBattleEnd(s.winner === 'A'); else showMenu(); }
        else showMenu();
      };
      if ($('nextBtn')) $('nextBtn').onclick = resolve;
      if ($('tourOkBtn')) $('tourOkBtn').onclick = resolve;
      if ($('masterOkBtn')) $('masterOkBtn').onclick = resolve;
      if ($('bossOkBtn')) $('bossOkBtn').onclick = resolve;
      if ($('menuBtn')) $('menuBtn').onclick = resolve;
      return;
    }
    if (settingsOpen) return;    // 设置面板展开时保持显示
    modal.classList.add('hidden');
  }

  /* ================= AI 驱动 ================= */
  function scheduleAI(s) {
    if (window.__acSilent) { stopAI(); return; }   // 后台模拟中：不启动常规 AI 计时器
    if (s.winner || s.pending) { stopAI(); return; }
    if (s.active !== 'B') { stopAI(); return; }
    if (aiTimer) return;
    aiTimer = setInterval(function () {
      var st = Engine.state;
      if (!st || st.winner || st.active !== 'B' || st.pending) { stopAI(); return; }
      if (feedBusy) return;      // 出牌动画还在播放 → 等它播完，玩家才看得清
      var more = AI.step();
      if (!more) {
        // 若无后续动作，AI 已 dispatch 了 END_TURN/CONFIRM_BATTLE
      }
    }, AI_STEP_MS);
  }
  function stopAI() { if (aiTimer) { clearInterval(aiTimer); aiTimer = null; } }

  function diffName() { return ({ novice: '新手', amateur: '业余', pro: '专业', champion: '冠军' })[AI.getDifficulty()] || '新手'; }

  /* ================= 绑定 ================= */
  /* ================= 接管"返回"（浏览器后退按钮 / 手机返回键 / 左滑手势） =================
   * 问题：整个站点只有一个历史条目，按返回就直接离开游戏（退到进入前的页面、甚至空白页），
   *      对局打到一半被"撤走"，看起来像丢档。
   * 做法：压一个"哨兵"历史条目；用户返回 → popstate → 不离开，而是按层级执行游戏内的返回，
   *      然后立刻补回哨兵（一 pop 一 push，历史长度恒定，不会越滚越长）。
   * 层级（从高到低）：
   *   ① 对局设置面板打开   → 关掉面板，回到对局
   *   ② 待决选择 / 结算面板 → 消化按键但不动（必须做决定，关掉会卡住）
   *   ③ 卡牌查看器浮层     → 关掉浮层
   *   ④ 在对局里           → 打开设置面板（不是直接退出对局）
   *   ⑤ 其它子界面         → 回主菜单
   *   ⑥ 已在主菜单         → 放行，允许退出页面
   * 这样只有"已经在主菜单"时按返回才真的离开页面，符合直觉。 */
  var BACK_SENTINEL = { ddBack: 1 };
  function overlayVisible(id) {
    var el = $(id);
    return !!(el && !el.classList.contains('hidden'));
  }
  function inMenu() { return overlayVisible('menu'); }   // showMenu() 会隐藏所有子界面 → menu 可见 == 在主菜单
  function inBattle() { return overlayVisible('battle'); }
  // 关掉对局设置面板（与面板里「关闭」按钮完全同一套逻辑）
  function closeBattleSettings() {
    settingsOpen = false;
    var m = $('modal');
    if (m) m.classList.add('hidden');
    if (Engine.state) render(Engine.state);   // 若有待决提示（如麻痹陷阱），关面板后要能重新看到
  }
  function handleBackKey() {
    // ⓪ 社区面板：独立浮层（不在 #modal 里）→ 优先关它
    if (window.Community && Community.isOpen && Community.isOpen()) { Community.close(); return true; }
    if (overlayVisible('modal')) {
      // ① 对局设置面板 → 关掉它，回到对局（对局里按返回 = 开设置，再按返回 = 回对局）
      if (settingsOpen) { closeBattleSettings(); return true; }
      // ② 待决选择 / 结算面板：必须由玩家做决定，关掉会卡住 → 消化掉按键，但不动面板
      return true;
    }
    if (viewer) { closeViewer(); return true; }          // ③ 卡牌查看器浮层
    if (inBattle()) { battleSettings(); return true; }   // ④ 对局中 → 打开设置面板（而不是直接退出对局）
    if (!inMenu()) { showMenu(); return true; }          // ⑤ 其它子界面 → 回主菜单（与"返回主菜单"按钮一致）
    return false;                                        // ⑥ 已在主菜单 → 放行，允许退出页面
  }
  function armBackSentinel() {
    try {
      if (!history.state || !history.state.ddBack) history.pushState(BACK_SENTINEL, '');
      window.addEventListener('popstate', function () {
        if (handleBackKey()) {
          try { history.pushState(BACK_SENTINEL, ''); } catch (e) { }   // 消化掉了 → 补回哨兵
        }
        // 没消化 → 不补，用户真的退回上一页（只有主菜单时会发生）
      });
    } catch (e) { }
  }
  /* ================= PVP 快捷对话 =================
   * 按钮：只有「在线 PvP 对局」才显示（单机 / 观战 / 已分胜负时隐藏）。
   * 面板：三档（问候 / 致敬 / 嘲讽）→ 点一条即发送。
   * 展示：气泡从**说那句话的人**的名字旁弹出（自己→#myName，对手→#oppName），随后淡出。
   *   气泡坐标用 getBoundingClientRect（视口坐标），与 #bubbleLayer 的 fixed inset:0 同一坐标系，
   *   所以舞台缩放/全屏都不影响对准。
   */
  var emoteType = 'greet';
  function renderEmoteList(type) {
    var list = $('emoteList'); if (!list) return;
    var arr = (window.Net && Net.EMOTES && Net.EMOTES[type]) || [];
    list.innerHTML = '';
    arr.forEach(function (txt, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = txt;
      b.onclick = function () {
        if (window.Net && Net.sendEmote) Net.sendEmote(type + '.' + i);
        var p = $('emotePanel'); if (p) p.classList.add('hidden');
        try { Sfx.play('click'); } catch (e) { }
      };
      list.appendChild(b);
    });
    var tabs = document.querySelectorAll('#emotePanel .emote-tabs button');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].dataset.et === type);
  }
  function toggleEmotePanel(force) {
    var p = $('emotePanel'); if (!p) return;
    var willOpen = (force === true) ? true : ((force === false) ? false : p.classList.contains('hidden'));
    p.classList.toggle('hidden', !willOpen);
    if (willOpen) { emoteType = 'greet'; renderEmoteList(emoteType); clampIntoStage(p); }
  }
  /* 把浮层夹进舞台可视区（2026-10-27：手机竖屏下对话面板贴父容器右沿，
     而父容器比面板窄 → 向左溢出，左边一小截被舞台裁掉、玩家看不到）。
     换算：getBoundingClientRect 是**屏幕坐标**，left/right 是设计坐标 → 除以 scaleK。 */
  function clampIntoStage(el) {
    var stage = $('stage');
    if (!el || !stage || !el.getBoundingClientRect) return;
    el.style.left = ''; el.style.right = '';       // 先按 CSS 归位，再测量
    var er = el.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    var pad = 6 * (scaleK || 1);
    var dx = 0;
    if (er.left < sr.left + pad) dx = (sr.left + pad) - er.left;              // 左侧溢出 → 右移
    else if (er.right > sr.right - pad) dx = (sr.right - pad) - er.right;     // 右侧溢出 → 左移
    if (!dx) return;
    var k = scaleK || 1;
    /* offsetLeft 就是"现在实际渲染在哪"（相对 offsetParent，设计坐标），
       加上屏幕位移 dx/scaleK 换算回设计坐标即可。 */
    el.style.right = 'auto';
    el.style.left = Math.round(el.offsetLeft + dx / k) + 'px';
  }
  /* 气泡：从人物名称处冒出，3.4s 后由 CSS 动画淡出（动画结束即移除节点） */
  function showBubble(text, fromSelf) {
    var layer = $('bubbleLayer'); if (!layer || !text) return;
    var nameEl = $(fromSelf ? 'myName' : 'oppName');
    var host = (nameEl && nameEl.getBoundingClientRect) ? nameEl : $('myInfo');
    if (!host) return;
    var d = document.createElement('div');
    d.className = 'bubble' + (fromSelf ? '' : ' foe');
    d.textContent = text;
    layer.appendChild(d);                       // 先入 DOM 才能量宽高
    var r = host.getBoundingClientRect();
    var w = d.offsetWidth, h = d.offsetHeight;
    var TAIL = 14;                              // 与 .bubble::after 的 left 一致
    var left = r.left + r.width / 2 - TAIL;
    var top = r.top - h - 10;                   // 默认浮在名字上方
    var vw = window.innerWidth || 1280, vh = window.innerHeight || 720;
    left = Math.max(6, Math.min(vw - w - 6, left));
    if (top < 6) top = r.bottom + 10;           // 上方放不下 → 放到名字下方
    if (top + h > vh - 6) top = Math.max(6, vh - h - 6);
    d.style.left = Math.round(left) + 'px';
    d.style.top = Math.round(top) + 'px';
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 3600);
  }
  function bindEmote() {
    var btn = $('emoteBtn');
    if (btn) btn.onclick = function () { try { Sfx.play('click'); } catch (e) { } toggleEmotePanel(); };
    var tabs = document.querySelectorAll('#emotePanel .emote-tabs button');
    for (var i = 0; i < tabs.length; i++) {
      (function (tb) {
        tb.onclick = function () {
          emoteType = tb.dataset.et || 'greet';
          try { Sfx.play('click'); } catch (e) { }
          renderEmoteList(emoteType);
        };
      })(tabs[i]);
    }
    // 点面板外的空白处收起（面板自身与按钮除外）
    document.addEventListener('pointerdown', function (ev) {
      var p = $('emotePanel');
      if (!p || p.classList.contains('hidden')) return;
      var t = ev.target;
      if (p.contains(t) || (btn && btn.contains(t))) return;
      p.classList.add('hidden');
    }, true);
    // 收到（自己或对手的）对话 → 从对应名字旁弹出
    if (window.Net && Net.on) {
      Net.on('emote', function (e) { if (e && e.text) showBubble(e.text, !!e.fromSelf); });
    }
  }
  /* 按钮显隐：仅在线 PvP 且对局未结束时显示 */
  function syncEmoteBtn(s) {
    var btn = $('emoteBtn'); if (!btn) return;
    var online = !!(window.Net && Net.isOnline && Net.isOnline());
    var spec = !!(window.Net && Net.isSpectator && Net.isSpectator());
    var show = online && !spec && !(s && s.winner);
    if (btn.classList.contains('hidden') === show) btn.classList.toggle('hidden', !show);
    if (!show) {
      var p = $('emotePanel');
      if (p && !p.classList.contains('hidden')) p.classList.add('hidden');
    }
  }

  /* ================= PvP 版本过低提示 =================
   * 服务端在开战前会核对版本，低于服务器直接拒绝（好友房 + 排位都拦）。
   * 这里负责把原因讲清楚并给出下载地址 —— 否则玩家只会看到"点了开始没反应"。
   * 同一版本只弹一次，避免 hello 与 need-update 各弹一遍。 */
  var verTipShownFor = 0;
  function bindVersionGate() {
    if (!window.Net || !Net.on) return;
    Net.on('needUpdate', function (e) {
      var latest = (e && e.latest) || 0;
      if (!latest || verTipShownFor === latest) return;
      verTipShownFor = latest;
      var url = (e && e.url) || (Net.downloadUrl && Net.downloadUrl()) || 'https://dms.spldream.com';
      var yours = (e && e.yours) || (Net.myVer ? Net.myVer() : 0);
      try {
        confirmBox(
          '你的游戏版本（v' + (yours || '?') + '）低于服务器（v' + latest + '），无法开始联机对局。\n\n' +
          '请先刷新页面（电脑按 Ctrl+F5，手机下拉刷新）；如果还是这个提示，' +
          '说明本地文件过旧，请到下面地址下载最新版：\n' + url,
          function () { try { window.open(url, '_blank'); } catch (err) { location.href = url; } },
          null,
          { yes: '去下载', no: '稍后再说' }
        );
      } catch (err) {
        toast('版本过低（v' + (yours || '?') + ' < v' + latest + '），无法联机。请刷新或到 ' + url + ' 下载最新版');
      }
    });
  }

  function boot() {
    armBackSentinel();               // 先接管返回键（避免开局就被撤走）
    /* 对手半屏的**空白处**（三个格子之外的内边距）也要能点：
       战斗阶段选中己方怪物后点它 = 攻击对手本体。
       格子内部的点击由 onEmptyCellClick 负责，这里只兜住容器里格子之外的区域
       （以前这些空白点下去毫无反应，玩家会以为"点对手空场没用来打本体"）。
       只绑一次 —— renderBoard 每次重绘都会给容器设 data-drop，所以不能写在那里。 */
    (function () {
      var ob = $('oppBoard');
      if (!ob || !ob.addEventListener) return;
      ob.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('.cell')) return;   // 格子交给 onEmptyCellClick
        if (justDragged) { justDragged = false; return; }
        var s = Engine.state;
        if (!s || s.winner || s.active !== 'A') return;
        if (!selected || selected.kind !== 'board') return;
        execute(selected, { drop: 'enemy-player-zone', key: 'B' });
      });
    })();
    window.addEventListener('resize', fitScreen);
    // 移动端：旋转 / 地址栏收放 / 从后台返回都要重算舞台缩放（iOS 首次 innerHeight 也不准，故延后补算两次）
    window.addEventListener('orientationchange', function () { setTimeout(fitScreen, 60); setTimeout(fitScreen, 320); });
    window.addEventListener('pageshow', fitScreen);
    // 触屏长按：屏蔽浏览器的右键/长按菜单（游戏内没有右键功能；输入框除外——粘贴存档要用）
    document.addEventListener('contextmenu', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('input,textarea')) return;
      e.preventDefault();
    });
    // 长按看图时"存储图片"的兜底：个别浏览器（微信/某些国产内核）不认 contextmenu 的
    // preventDefault，再拦一道 dragstart —— 配合 style.css 里 img 的 pointer-events:none。
    document.addEventListener('dragstart', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'IMG' || (t.closest && t.closest('img')))) e.preventDefault();
    });
    // 双指缩放的兜底：iOS Safari 会无视 user-scalable=no，只能拦它的 gesture 事件
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
      document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
    });
    // 进出全屏时屏高会变 → 重新算舞台缩放
    document.addEventListener('fullscreenchange', function () { setTimeout(fitScreen, 60); setTimeout(fitScreen, 320); });
    document.addEventListener('webkitfullscreenchange', function () { setTimeout(fitScreen, 60); setTimeout(fitScreen, 320); });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', fitScreen);
      window.visualViewport.addEventListener('scroll', fitScreen);
    }
    setTimeout(fitScreen, 0);
    setTimeout(fitScreen, 260);
    // 样式表被缓存成旧副本时自愈（正常情况这一步什么都不做）
    if (mobileCssParsed() === false) reloadCssOnce();
    SaveData.load();
    applyFontScale(SaveData.getFontScale());      // 字号设置：进游戏立刻应用，避免首屏闪一下默认大小
    // 联机延迟：Net 每 3 秒测一次 RTT，回来后刷新右上角显示
    if (window.Net && Net.on) {
      Net.on('latency', renderPing);
      Net.on('online', function () { renderPing(); });
      // 排位房回合计时：服务器每次下发状态都会带新的 deadline
      Net.on('deadline', function () { renderRankTimer(); startRankTick(); });
    }
    AI.setDifficulty(SaveData.getDifficulty());
    DeckBuilder.bind();
    RunUI.bind();
    // 音频初始化（首次交互后解锁，规避浏览器自动播放限制）
    var au = SaveData.getAudio();
    Sfx.setEnabled(au.on); Sfx.setVolumes(au.sfx, au.bgm);
    var unlockOnce = function () {
      Sfx.unlock();
      if (Sfx.isEnabled()) Sfx.bgmStart();
      //tryAutoFullscreen();          // 手机端：借第一次操作进全屏（浏览器只允许这样）
      document.removeEventListener('pointerdown', unlockOnce);
    };
    document.addEventListener('pointerdown', unlockOnce);
    // 主菜单
    $('btnRun').onclick = function () { startRun(); };
    $('btnDeck').onclick = function () { DeckBuilder.show(); };
    $('btnSettings').onclick = function () { showSettings(); };
    $('btnContinue').onclick = function () { continueRun(); };
    // 魔绫大赛：先让玩家选赛制（联盟赛 = PVE 原赛制 / 大师赛 = PVP 联机）
    if ($('btnTour')) $('btnTour').onclick = function () {
      Sfx.play('click');
      if (window.MasterUI && MasterUI.showCupChoice) MasterUI.showCupChoice();
      else if (window.TourUI) TourUI.showEntry();
    };
    if (window.AcademyUI) AcademyUI.bind();   // 学院考核入口
    if (window.BossUI) BossUI.bind();         // 晋升之路入口
    if (window.TutorialUI) TutorialUI.init(); // 入学手册：菜单入口 + 首次进入询问"是不是新手"
    if (window.ProfileUI) ProfileUI.init();   // 人物系统：主菜单右上角头像 + 名称 + 称号
    bindCardTips($('academy'));               // 学院考核：卡牌悬停详情
    bindCardTips($('tour'));                  // 魔绫大赛（含赛后奖励）：卡牌悬停详情
    bindStatTips();                           // 对局内状态标签：悬停 / 按住看效果说明（毒气·酸气·腐烂·盾·不可选中…）
    // 结束回合按钮
    $('endBtn').onclick = function () {
      if (autoBattle) { toast('考核对战由 AI 自动进行'); return; }
      var s = Engine.state;
      if (!s || s.winner || s.active !== 'A') return;
      Sfx.play('click');
      var act = s.phase === 'PREP' ? 'CONFIRM_BATTLE' : 'END_TURN';
      var r = Engine.tryAction({ type: act });
      if (r && !r.ok && !r.silent) toast(r.msg);
      clearSelect();
    };
    bindEmote();                              // PVP 快捷对话：按钮/面板/气泡（仅在线 PvP 显示）
    bindVersionGate();                        // PVP 版本过低：弹「去下载」提示（服务端硬拦）
    applyPortraitClass();                     // 恢复上次的竖屏/横屏选择（默认横屏）
    if ($('btnRotate')) $('btnRotate').onclick = function () {
      try { Sfx.play('click'); } catch (e) { }
      setPortraitMode(!portraitMode);
    };
    // 右上角统一入口：对局设置（重开本局 / 自动跳过己方回合 / 音效）
    if ($('battleSetBtn')) $('battleSetBtn').onclick = function () { Sfx.play('click'); battleSettings(); };
    // 右上角：全屏开关（触屏设备显示；手机画面太小时的主要补救手段）
    if ($('battleFsBtn')) $('battleFsBtn').onclick = function () { Sfx.play('click'); toggleFullscreen(); };
    // 首页左上角：全屏开关（复用对局内同一个 toggleFullscreen，含进出全屏后的重新缩放）
    // 注意：按钮【始终显示】（手机、桌面都有）；但 iOS Safari 至今不支持 requestFullscreen，
    // 那种浏览器点了会毫无反应、看着像坏了 —— 所以先探一次能力，不支持就点出提示，
    // 而不是让按钮"假死"（也不隐藏它：用户找不到入口会更困惑）。
    if ($('btnFull')) {
      var fsOK = fsSupported();
      $('btnFull').onclick = function () {
        Sfx.play('click');
        if (!fsOK) { toast('当前浏览器不支持网页全屏：iOS 可「添加到主屏幕」后自动全屏'); return; }
        toggleFullscreen();
      };
      var syncFsBtn = function () {
        var on = !!fsEl();
        $('btnFull').textContent = on ? '⤢' : '⛶';
        $('btnFull').classList.toggle('on', on);
        $('btnFull').title = on ? '退出全屏' : '全屏';
      };
      syncFsBtn();
      // 浏览器全屏状态可能被 F11 / Esc 改掉，这里跟随同步图标
      ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
        document.addEventListener(ev, syncFsBtn);
      });
    }
    // 竖屏提示：唯一按钮 = 进入全屏（浏览器全屏后自带转向，比手动转 90° 省事）
    if ($('rhFull')) $('rhFull').onclick = function () { Sfx.play('click'); rotateHintFullscreen(); };
    // 自动战斗开关（踏上征途对局内显示，位于设置按钮左侧）
    if ($('battleAutoBtn')) $('battleAutoBtn').onclick = function () { setAutoPlay(!autoPlay); };
    // 牌库 / 弃牌堆查看（点数字即可查看）
    if ($('myDeck')) $('myDeck').onclick = function () { Sfx.play('click'); openViewer('A', 'deck'); };
    if ($('myDiscard')) $('myDiscard').onclick = function () { Sfx.play('click'); openViewer('A', 'discard'); };
    // PVP（联机对战）不允许查看对手牌库：牌库顺序是隐藏信息，能看就等于知道对手接下来摸什么。
    // 服务端也已对对手牌库做脱敏，这里是界面层的双保险（观战者不受限，那是旁观模式）。
    if ($('oppDeck')) $('oppDeck').onclick = function () {
      Sfx.play('click');
      /* 只在"本局是联机对局"时禁止查看对手牌库。
       * ⚠ 判据必须是 inNetBattle()（这一局是不是联机打的），不能用 isOnline()（有没有连着服务器）——
       *   只要在大师赛里连过一次服务器，isOnline() 就会一直为 true，于是回到 PVE
       *   （联盟赛 / 跑图 / 学院 / 自由对战）点对手牌库也会被拦掉，根本看不了。
       *   观战者本来就可以看（旁观模式，服务器也未对其脱敏）→ 用 isSpectator() 放行。 */
      var netPvp = window.Net && Net.inNetBattle && Net.inNetBattle()
        && !(Net.isSpectator && Net.isSpectator());
      if (netPvp) { toast('联机对战中看不到对手牌库'); return; }
      openViewer('B', 'deck');
    };
    if ($('oppDiscard')) $('oppDiscard').onclick = function () { Sfx.play('click'); openViewer('B', 'discard'); };
    // 法杖栏点击：进入法杖发动流程 / 作为升级卷轴目标
    $('wandSlot').addEventListener('click', function () {
      if (autoBattle) return;
      var s = Engine.state;
      if (!s || s.active !== 'A' || s.winner) return;
      if (pend && pend.mode === 'upgrade') { doUpgradeTarget({ targetKind: 'wand' }); return; }
      if (pend) { toast('请先完成当前目标选择'); return; }
      if (!s.players.A.wand) {   // 空法杖栏：若已选中手牌法杖则直接放入
        if (selected && C(selected.cardId) && C(selected.cardId).type === 'wand') { execute(selected, { drop: 'wand' }); return; }
        toast('法杖栏为空：点击手牌中的法杖即可放入');
        return;
      }
      startWand();
    });
    // 点击空白处取消目标选择 / 取消已选中的卡
    $('stage').addEventListener('click', function (e) {
      var el = e.target;
      // 内部点击处理器若在本次点击中重渲染了 DOM，e.target 会脱离文档；该次点击已被处理，不应再当作"点击空白处"取消
      if (el && !document.contains(el)) return;
      if (el.closest && (el.closest('.card') || el.closest('.monster') || el.closest('#wandSlot') || el.closest('.wandcard') || el.closest('#endBtn') || el.closest('.relic') || el.closest('#myInfo') || el.closest('#oppInfo') || el.closest('.topbar') || el.closest('#viewer'))) return;
      if (pend) { cancelPend('已取消'); return; }
      if (selected) clearSelect();
    });
    // 渲染订阅：单点异常不应导致整个界面空白，捕获并提示
    Engine.on(function (s) {
      if (suspendRender) return;      // 自动对战翻转视角期间不渲染（由驱动方主动 render）
      if (window.__acSilent) return;  // 学院考核后台模拟对局：完全静默
      if (window.Achievements) { try { Achievements.checkBattle(s); } catch (e) { } }   // 成就结算（幂等）
      try { render(s); }
      catch (err) { console.error('[渲染错误]', err); try { toast('渲染异常，详见控制台'); } catch (e) { } }
    });
    refreshMenu();
  }

  /* 局内确认框（替代 window.confirm）。
   * 为什么必须自建：原生 confirm/alert 会让浏览器**退出全屏** —— 玩家全屏玩到一半被踢出来，
   * 回来还得重新点全屏；而且原生弹窗样式和像素风完全不搭。
   * 用法（回调式，改动最小）：UI.confirm('确定离开房间？', function () { ...确认后执行... });
   *                        UI.confirm(msg, onYes, onNo, { yes:'确定', no:'取消' });
   * 也返回 Promise<boolean>，方便 async 场景。
   * 挂在 <body> 上（不在 #stage 内）→ 不受舞台缩放/旋转影响；
   * z-index 1400 高于 #modal(990) 与 #cardtip(1200)，叠在设置面板之上也能显示。 */
  function confirmBox(msg, onYes, onNo, opts) {
    opts = opts || {};
    var old = document.getElementById('confirmBox');
    if (old && old.parentNode) old.parentNode.removeChild(old);      // 同时只留一个
    var box = document.createElement('div');
    box.id = 'confirmBox';
    box.innerHTML =
      '<div class="cf-box">' +
      '<p class="cf-msg">' + String(msg == null ? '' : msg) + '</p>' +
      '<div class="mbtns">' +
      '<button class="pxbtn ghost" data-cf="no">' + (opts.no || '取消') + '</button>' +
      '<button class="pxbtn" data-cf="yes">' + (opts.yes || '确定') + '</button>' +
      '</div></div>';
    document.body.appendChild(box);

    var done = false, resolveP = null;
    function finish(ok) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      if (box.parentNode) box.parentNode.removeChild(box);
      try { Sfx.play('click'); } catch (e) { }
      if (resolveP) resolveP(!!ok);
      if (ok) { if (onYes) onYes(); } else if (onNo) onNo();
    }
    function onKey(e) {
      if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); finish(false); }
      else if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); finish(true); }
    }
    box.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('[data-cf]');
      if (b) { finish(b.getAttribute('data-cf') === 'yes'); return; }
      if (e.target === box) finish(false);                          // 点遮罩 = 取消
    });
    document.addEventListener('keydown', onKey, true);
    var p = new Promise(function (res) { resolveP = res; });
    var btn = box.querySelector('[data-cf="yes"]');
    if (btn && btn.focus) { try { btn.focus(); } catch (e) { } }
    return p;
  }
  /* 字号倍率（设置 → 字号）：写到 <html> 的内联 style 上。
   * CSS 里所有"正文级" font-size 都是 calc(Npx * var(--fs, 1))，默认 --fs:1 ⇒ 与历史版本完全一致。 */
  function applyFontScale(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) n = 1;
    var d = document.documentElement;
    if (d && d.style && d.style.setProperty) d.style.setProperty('--fs', String(n));
  }
  function fontScaleLabel(v) {
    if (Math.abs(v - 0.9) < 0.01) return '小';
    if (Math.abs(v - 1) < 0.01) return '默认';
    if (Math.abs(v - 1.15) < 0.01) return '大';
    if (Math.abs(v - 1.3) < 0.01) return '特大';
    return String(v);
  }
  function showSettings() {
    var modal = $('modal');
    modal.classList.remove('hidden');
    var cur = SaveData.getDifficulty(), au = SaveData.getAudio();
    var fsNow = SaveData.getFontScale();
    function cls(d) { return 'pxbtn' + (cur === d ? '' : ' ghost'); }
    function fsCls(v) { return 'pxbtn' + (Math.abs(fsNow - v) < 0.001 ? '' : ' ghost'); }
    modal.innerHTML = '<div class="mbox"><h3>设置</h3>' +
      '<p class="dim">AI 难度（影响出牌质量与初始生命：新手 28 / 业余 32 / 专业 34 / 冠军 36）</p>' +
      '<div class="mbtns col">' +
      '<button class="' + cls('novice') + '" data-d="novice">新手</button>' +
      '<button class="' + cls('amateur') + '" data-d="amateur">业余</button>' +
      '<button class="' + cls('pro') + '" data-d="pro">专业</button>' +
      '<button class="' + cls('champion') + '" data-d="champion">冠军</button>' +
      '</div>' +
      '<p class="dim">音效</p>' +
      '<div class="setrow"><span>音效开关</span><button id="setSound" class="' + (au.on ? 'pxbtn' : 'pxbtn ghost') + '">' + (au.on ? '开' : '关') + '</button></div>' +
      '<div class="setrow"><span>音效音量</span><input type="range" id="setSfx" min="0" max="100" value="' + Math.round(au.sfx * 100) + '"></div>' +
      '<div class="setrow"><span>BGM 音量</span><input type="range" id="setBgm" min="0" max="100" value="' + Math.round(au.bgm * 100) + '"></div>' +
      '<p class="dim">字号（手机上嫌字小可以调大；「默认」就是原来的大小）</p>' +
      '<div class="mbtns">' +
      '<button class="' + fsCls(0.9) + '" data-fs="0.9">小</button>' +
      '<button class="' + fsCls(1) + '" data-fs="1">默认</button>' +
      '<button class="' + fsCls(1.15) + '" data-fs="1.15">大</button>' +
      '<button class="' + fsCls(1.3) + '" data-fs="1.3">特大</button>' +
      '</div>' +
      '<p class="dim">竖屏模式（默认横屏；打开后战斗与组卡器改成竖排，适合竖着拿手机）</p>' +
      '<div class="setrow"><span>竖屏模式</span><button id="setPortrait" class="' + (portraitMode ? 'pxbtn' : 'pxbtn ghost') + '">' + (portraitMode ? '开' : '关') + '</button></div>' +
      '<p class="dim">跑图种子（留空 = 每次随机；填写数字则按该种子决定地图与抽牌）</p>' +
      '<div class="setrow"><span>种子</span><input id="setSeed" class="dk-search" maxlength="12" placeholder="留空随机" value="' + SaveData.getSeedText() + '"></div>' +
      '<p class="dim">存档（导出为 JSON 文件，可在别的设备/浏览器导入）</p>' +
      '<div class="mbtns"><button id="setExport" class="pxbtn">导出存档</button>' +
      '<button id="setImport" class="pxbtn">导入存档</button></div>' +
      '<div class="mbtns"><button id="setReset" class="pxbtn ghost">重置存档（卡组与进度）</button></div>' +
      '<p class="dim" id="setBuild" style="font-size:calc(11px * var(--fs, 1));line-height:1.5"></p>' +
      '<div class="mbtns"><button id="setClose" class="pxbtn">关闭</button></div></div>';
    /* 手机布局的 CSS 到底加载了没有：直接翻已解析的样式表，找新版手机布局的媒体块。
     * 手机上反馈"布局没变"时，多数不是视口判定错，而是浏览器/预览服务还在用缓存的旧 CSS
     * （JS 是新的、CSS 是旧的 —— 表现就是"提示已生效，界面照旧"）。这里让界面自己说话。 */
    function mobileCssState() {
      var st = mobileCssParsed();
      if (st === true) return '手机布局 CSS 已加载 ✓' + (reloadCssOnce.done ? '（曾自动重载）' : '');
      if (st === null) return '手机布局 CSS 无法检测（以本地文件方式打开）';
      return '手机布局 CSS 未加载（浏览器仍用旧缓存 ✗ 请强制刷新 Ctrl+F5）';
    }

    // 构建与视口信息：排查"手机布局没生效"这类问题时，一眼能看出跑的是哪份构建、设备报的视口多大
    (function () {
      var el = $('setBuild');
      if (!el) return;
      var touch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      var pass = window.matchMedia && window.matchMedia('(max-height: 560px), (pointer: coarse), (max-width: 1100px)').matches;
      el.textContent = '构建 ' + ((typeof Rules !== 'undefined' && Rules.BUILD) || '—') +
        '　视口 ' + window.innerWidth + '×' + window.innerHeight +
        '　' + (touch ? '触屏' : '鼠标') + (coarse ? '(coarse)' : '(fine)') +
        '　手机布局' + (pass ? '已生效' : '未生效') +
        '　' + mobileCssState();
    })();
    modal.querySelectorAll('[data-d]').forEach(function (b) {
      b.onclick = function () {
        SaveData.setDifficulty(b.dataset.d); AI.setDifficulty(b.dataset.d);
        toast('难度：' + diffNameOf(b.dataset.d));
        showSettings();
      };
    });
    modal.querySelectorAll('[data-fs]').forEach(function (b) {
      b.onclick = function () {
        var v = SaveData.setFontScale(+b.dataset.fs);
        applyFontScale(v);
        Sfx.play('click');
        toast('字号：' + fontScaleLabel(v));
        showSettings();                        // 重新渲染 → 更新按钮高亮
      };
    });
    $('setSound').onclick = function () {
      var o = SaveData.setAudio({ on: !SaveData.getAudio().on });
      Sfx.setEnabled(o.on);
      if (o.on) { Sfx.unlock(); Sfx.bgmStart(); } else Sfx.bgmStop();
      toast('音效：' + (o.on ? '开' : '关'));
      showSettings();
    };
    $('setPortrait').onclick = function () {
      Sfx.play('click');
      var to = !portraitMode;
      var m2 = $('modal');
      setPortraitMode(to, true);       // 自己重画设置框，避免 toast 抢在按钮高亮前面
      if (m2) m2.classList.add('hidden');
      toast(to ? '已切换到竖屏模式' : '已切回横屏模式');
    };
    $('setSeed').oninput = function () { SaveData.setSeedText(this.value.replace(/[^0-9]/g, '')); };
    $('setSeed').onblur = function () { this.value = SaveData.getSeedText(); if (this.value) toast('种子已设为 ' + this.value + '（下次开始跑图生效）'); };
    $('setSfx').oninput = function () { var v = +this.value / 100; SaveData.setAudio({ sfx: v }); Sfx.setVolumes(v, null); };
    $('setSfx').onchange = function () { Sfx.play('click'); };
    $('setBgm').oninput = function () { var v = +this.value / 100; SaveData.setAudio({ bgm: v }); Sfx.setVolumes(null, v); };
    $('setExport').onclick = function () {
      Sfx.play('click');
      if (!window.ProfileUI) { toast('导出功能不可用'); return; }
      ProfileUI.exportSave();                      // 下载 JSON + 给出可复制文本
    };
    $('setImport').onclick = function () {
      Sfx.play('click');
      if (!window.ProfileUI) { toast('导入功能不可用'); return; }
      ProfileUI.importSave();                      // 选文件或粘贴
    };
    $('setReset').onclick = function () {
      confirmBox('确定重置存档？将恢复默认卡组并清除跑图进度。', function () {
        SaveData.reset(); AI.setDifficulty(SaveData.getDifficulty());
        modal.classList.add('hidden'); toast('存档已重置'); refreshMenu();
      }, null, { yes: '重置存档', no: '取消' });
    };
    $('setClose').onclick = function () { modal.classList.add('hidden'); };
  }

  return {
    boot: boot, render: render, fitScreen: fitScreen, showMenu: showMenu,
    confirm: confirmBox,                       // 局内确认框（替代 window.confirm，不会踢出全屏）
    startBattle: startBattle, startAcademyBattle: startAcademyBattle,
    startNetBattle: startNetBattle,          // 联机对局：用服务器下发的状态进入对战界面
    toast: toast, closeOverlays: closeOverlays, refreshMenu: refreshMenu,
    dmgStatHtml: dmgStatHtml,     // 输出排行（大赛弹窗 / 学院战报共用）
    isTouch: isTouchDevice,       // 供其它界面判断"触屏 → 用点选 + 确认"的交互
    handleBackKey: handleBackKey,  // 返回键的分层处理（供测试 / 原生壳复用）
    statInfoOf: statInfoOf,        // 状态说明文案（供测试：核对文案里的计算式与引擎结算一致）
    rotateHintFullscreen: rotateHintFullscreen,  // 竖屏提示按钮的行为（供测试）
    isPortrait: function () { return !!portraitMode; },      // 当前是否竖屏模式（供测试 / 组卡器）
    setPortraitMode: setPortraitMode,            // 切换竖屏模式（供测试 / 设置面板）
    portraitPreview: portraitPreview,            // 竖屏详情浮层（供测试：位置不覆盖正在看的卡）
    hidePreview: hidePreview,                    // 立刻收起卡牌详情（供测试：鼠标离开/手指停住即消失）
    previewMonster: previewMonster// 场上怪物详情（供测试：应显示当前实际数值）
  };
})();

window.addEventListener('DOMContentLoaded', function () { UI.boot(); UI.showMenu(); });
