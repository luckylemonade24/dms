/* ============================================================
 * 卡牌详情悬停浮窗  tooltip.js
 * 用于组卡器 / 战后奖励 / 商店等"需要看卡牌详情"的界面。
 * 用法：CardTip.attach(element, cardId)  或  CardTip.attachCard(element, cardId)
 * ========================================================== */
var CardTip = (function () {
  'use strict';

  var el = null;
  var lastX = 0, lastY = 0;   // 最近一次显示的坐标（图片异步加载完成后要按新高度重新贴边）

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'cardtip';
    el.className = 'hidden';
    document.body.appendChild(el);
    return el;
  }

  /* show(card, mx, my, awId?)
   *   awId：3★ 觉醒词条 id（可选）。备战页按卡 id 推算，对局内直接传实例上的 awaken。
   *   注意 tooltip.js 在 awaken_data.js 之前加载，所以必须做 typeof 守卫。 */
  function show(card, mx, my, awId) {
    var c = (typeof card === 'string') ? CARDS[card] : card;
    if (!c) return;
    var t = ensure();
    var aw = awId ? lookupAwaken(awId) : null;
    t.innerHTML =
      '<div class="ct-name">' + c.name +
      (c.tier ? ' <span class="tier t-' + c.tier + '">' + c.tier + '</span>' : '') +
      (c.maxCopies ? '<span class="ct-max">上限 ' + c.maxCopies + '</span>' : '') + '</div>' +
      '<img src="' + cardDetail(c) + '" alt="' + c.name + '">' +
      '<div class="ct-meta">' + (Rules.TYPE_NAME[c.type] || '') +
      (c.hp != null ? '　♥' + c.hp + '　⚔' + c.atk : '') + '</div>' +
      '<div class="ct-eff">' + c.effect + '</div>' +
      (aw ? '<div class="ct-awaken"><div class="ct-aw-h">觉醒 · ' + aw.name + '</div>' + aw.desc + '</div>' : '') +
      (c.equip ? '<div class="ct-eq">装备要求：怪物' + (c.equip.stat === 'atk' ? '攻击力' : '血量上限') + ' ≥ ' + c.equip.min + '</div>' : '');
    t.style.overflow = '';
    t.classList.remove('hidden');
    bindTouchHide();                    // 直接 show() 时也要能"点别处收起"（触屏无 hover）
    lastX = mx; lastY = my;
    var im = t.querySelector('img');
    if (im) {
      im.style.maxHeight = '';                    // 清掉上一次的压缩值
      if (!im.complete) {                         // 详情图异步加载：加载完高度才准确，届时重新贴边
        im.addEventListener('load', refit);
        im.addEventListener('error', refit);
      }
    }
    refit();
  }

  function move(mx, my) {
    if (!el) return;
    var w = el.offsetWidth || 280, h = el.offsetHeight || 420;
    var x = mx + 20, y = my - h * 0.5;
    if (x + w > window.innerWidth - 8) x = mx - w - 20;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  // 矮屏（手机横屏）兜底：内容高于视口时逐步压缩详情图（再不行就裁切），保证浮窗整体留在屏内
  function refit() {
    if (!el) return;
    var vh = window.innerHeight || 0;
    if (!vh) return;
    var maxH = vh - 16, im = el.querySelector('img'), guard = 0;
    while (im && el.offsetHeight > maxH && guard++ < 14) {
      var cur = im.getBoundingClientRect().height || im.offsetHeight || 320;
      var next = Math.max(44, Math.round(cur * 0.85));
      if (next >= cur) break;
      im.style.maxHeight = next + 'px';
    }
    el.style.overflow = (el.offsetHeight > maxH) ? 'hidden' : '';
    move(lastX, lastY);
  }

  function hide() { if (el) el.classList.add('hidden'); }

  // 词条 id → {name, desc}；awaken_data.js 未加载时返回 null（安静降级，不报错）
  function lookupAwaken(id) {
    if (!id || typeof awakenInfo !== 'function') return null;
    return awakenInfo(id);
  }

  var touchHideBound = false;
  // 触屏：点其它位置收起浮窗（capture 先跑 → 随后目标元素的 pointerdown 再显示，互不冲突）
  function bindTouchHide() {
    if (touchHideBound) return;
    touchHideBound = true;
    document.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') hide(); }, true);
    // 手指离开屏幕（或手势被系统取消）→ 详情立刻消失。
    // 触屏没有 hover，不这样做浮窗会一直留在屏幕上挡住界面。
    document.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') hide(); }, true);
    document.addEventListener('pointercancel', function (e) { if (e.pointerType !== 'mouse') hide(); }, true);
  }

  // 给任意元素绑定：移入显示卡牌详情，移出隐藏；触屏（无 hover）改为"按下即显示"
  function attach(node, card) {
    if (!node || !card) return node;
    node.addEventListener('mouseenter', function (e) { show(card, e.clientX, e.clientY); });
    node.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    node.addEventListener('mouseleave', hide);
    node.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;          // 桌面走 hover，不重复处理
      show(card, e.clientX, e.clientY);
    });
    bindTouchHide();
    return node;
  }

  return { show: show, hide: hide, move: move, attach: attach, lookupAwaken: lookupAwaken };
})();

/* ============================================================
 * 状态说明浮窗  StatTip
 *
 * 对局内的状态标签（玩家状态栏的 毒气/酸气/腐烂，怪物身上的 盾/不可选中/★/觉醒…）
 * 在桌面悬停、移动端按住时，用小浮窗说明"这个状态到底做什么"。
 * 与 CardTip 分开：那边要渲染整张卡（图 + 数值 + 词条），这里只是一段说明文字。
 *
 * 用法：
 *   StatTip.show({ title: '毒气', body: '<p>…</p>' }, x, y)
 *   StatTip.move(x, y) / StatTip.hide()
 * ========================================================== */
var StatTip = (function () {
  'use strict';

  var el = null, lx = 0, ly = 0;

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'stattip';
    el.className = 'hidden';
    document.body.appendChild(el);
    return el;
  }

  function show(info, mx, my) {
    if (!info || !info.title) return;
    var t = ensure();
    t.innerHTML = '<div class="st-h">' + info.title + '</div>' + (info.body || '');
    t.classList.remove('hidden');
    lx = mx; ly = my;
    bindTouchHide();
    move(mx, my);
  }

  var hideBound = false;
  /* 触屏：松手 / 手势取消 / 点到别处 → 立刻收起。
   * 没有 hover 的屏幕上不这样做，浮窗会一直粘着挡住界面。
   * 用 capture 先收，调用方在 bubble 阶段再 show，顺序天然正确。 */
  function bindTouchHide() {
    if (hideBound) return;
    hideBound = true;
    ['pointerdown', 'pointerup', 'pointercancel'].forEach(function (ev) {
      document.addEventListener(ev, function (e) { if (e.pointerType !== 'mouse') hide(); }, true);
    });
  }

  // 跟随光标并避让视口边缘（优先右下，放不下就翻到左上）
  function move(mx, my) {
    if (!el || el.classList.contains('hidden')) return;
    lx = mx; ly = my;
    var w = el.offsetWidth || 240, h = el.offsetHeight || 90;
    var x = mx + 16, y = my + 16;
    if (x + w > window.innerWidth - 8) x = Math.max(8, mx - w - 16);
    if (y + h > window.innerHeight - 8) y = Math.max(8, my - h - 16);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  function hide() { if (el) el.classList.add('hidden'); }

  return { show: show, move: move, hide: hide };
})();
