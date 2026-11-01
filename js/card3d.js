/* 卡牌伪 3D（pointer 跟手倾斜 + 镜面高光）  card3d.js
 *
 * 为什么这么做：
 *   项目里卡牌是纯 DOM + <img>，做"真 3D"要重写拖拽/命中/布局，成本极高；
 *   而"伪 3D"（CSS perspective + 轻微倾斜 + 跟手高光）用一行 transform 就能拿到
 *   九成的立体观感，体积 0 增长、移动端也是合成层动画，不掉帧。
 *
 * 分工：
 *   · CSS（css/battle.css 的 .card）：抬升用 translate，倾斜用 transform（互不覆盖）
 *   · 本文件：把指针在卡面内的相对位置换算成 --rx / --ry（角度）与 --gx / --gy（高光位置）
 *
 * 只在「有鼠标」的设备启用（hover: hover + pointer: fine）：
 *   触屏上手指一动就是在拖牌，再叠倾斜会让人分不清"我要拖"还是"我要看"。
 */
(function () {
  'use strict';

  var MAX = 10;                       // 最大倾角（度）：再大就晕，像素风也不适合强透视

  function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }

  /* 纯函数（tools/card3d_check.js 直接单测）：
   * nx / ny = 指针在卡面内的相对坐标，-0.5 是左/上边缘，+0.5 是右/下边缘。
   * 让"指针下的那一角往里倒"（像用手指按住卡牌的一角），所以：
   *   指针偏上 → rotateX 为正（上边缘向后倒）；指针偏右 → rotateY 为正（右边缘向后倒）。
   * 返回 gx/gy 是百分比，给 CSS 的 radial-gradient 定位高光。 */
  function tiltFor(nx, ny, max) {
    max = (typeof max === 'number' && isFinite(max)) ? max : MAX;
    var x = clamp(Number(nx) || 0, -0.5, 0.5);
    var y = clamp(Number(ny) || 0, -0.5, 0.5);
    return {
      rx: +(-y * 2 * max).toFixed(2),
      ry: +(x * 2 * max).toFixed(2),
      gx: +((x + 0.5) * 100).toFixed(1),
      gy: +((y + 0.5) * 100).toFixed(1)
    };
  }

  var canHover = true, reduce = false;
  try {
    if (typeof matchMedia === 'function') {
      canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
      reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
  } catch (e) { }

  var active = null;      // 当前指针所在的卡
  var lastEvt = null;
  var pending = false;

  function setVars(card, t) {
    var s = card.style;
    if (!s || !s.setProperty) return;
    s.setProperty('--rx', t.rx + 'deg');
    s.setProperty('--ry', t.ry + 'deg');
    s.setProperty('--gx', t.gx + '%');
    s.setProperty('--gy', t.gy + '%');
  }
  function reset(card) {
    if (!card) return;
    setVars(card, { rx: 0, ry: 0, gx: 50, gy: 50 });
    if (card.classList) card.classList.remove('c3d-on');
  }

  function schedule() {
    if (pending) return;
    pending = true;
    var fn = function () {
      pending = false;
      if (!active || !lastEvt) return;
      var r = active.getBoundingClientRect();
      if (!r.width || !r.height) return;
      setVars(active, tiltFor(
        (lastEvt.clientX - r.left) / r.width - 0.5,
        (lastEvt.clientY - r.top) / r.height - 0.5,
        MAX
      ));
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  }

  function onMove(e) {
    var el = (e.target && e.target.closest) ? e.target.closest('.card') : null;
    if (el !== active) {
      if (active) reset(active);
      active = el;
      if (el && el.classList) el.classList.add('c3d-on');
    }
    if (!el) return;
    lastEvt = e;
    schedule();
  }

  function onLeave(e) {
    // 指针移出卡片（或移出窗口）→ 复位；用 relatedTarget 判断，避免鼠标在卡内子元素间移动时闪回
    var to = e.relatedTarget;
    if (active && (!to || !(to.closest && to.closest('.card') === active))) {
      reset(active);
      active = null;
    }
  }

  function onDown() { if (active) reset(active); }   // 开始拖牌时先摆正，别让倾斜干扰拖拽观感

  if (canHover && !reduce && typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerout', onLeave, { passive: true });
    document.addEventListener('pointerdown', onDown, { passive: true });
    // 窗口失焦时兜底复位（例如 Alt+Tab 出去）
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('blur', function () { reset(active); active = null; });
    }
  }

  var api = { tiltFor: tiltFor, MAX: MAX, enabled: canHover && !reduce };
  if (typeof window !== 'undefined') window.Card3D = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
