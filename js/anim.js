/* ============================================================
 * 动画队列  anim.js —— 仅负责表现层（策划案 6.4 渲染轮询）
 * 伤害/治疗飘字、卡牌移动等；与逻辑状态机解耦。
 * ========================================================== */
var Anim = (function () {
  'use strict';

  function floatAt(x, y, text, kind) {
    var layer = document.getElementById('floatLayer');
    if (!layer) return;
    var d = document.createElement('div');
    d.className = 'float ' + (kind || 'dmg');
    d.textContent = text;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    layer.appendChild(d);
    // 使用 Web Animations API（无依赖）
    if (d.animate) {
      d.animate([
        { transform: 'translate(-50%,0) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%,-24px) scale(1.15)', opacity: 1, offset: 0.3 },
        { transform: 'translate(-50%,-60px) scale(1)', opacity: 0 }
      ], { duration: 900, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = function () { d.remove(); };
      setTimeout(function () { if (d.parentNode) d.remove(); }, 1000);
    } else {
      setTimeout(function () { d.remove(); }, 900);
    }
  }

  // 简单的一次性闪烁类名
  function flash(el, cls, dur) {
    if (!el) return;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, dur || 400);
  }

  return { floatAt: floatAt, flash: flash };
})();
