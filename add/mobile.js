(function() {
    let startArea = null;
    let pointerStartX = 0, pointerStartY = 0;

    function getClientY(e) {
        return e.clientY !== undefined ? e.clientY : (e.touches && e.touches.length ? e.touches[0].clientY : 0);
    }

    document.addEventListener('pointerdown', function(e) {
        const battleEl = document.getElementById('battle');
        if (!battleEl || battleEl.classList.contains('hidden')) return;

        // 记录按下时的坐标，用于判断是点击还是滑动
        pointerStartX = e.clientX;
        pointerStartY = e.clientY;

        if (e.target.closest('#myHand')) {
            startArea = 'bottom';
        } else if (e.target.closest('#myBoard') || e.target.closest('#oppBoard') || e.target.closest('#centerZone') || e.target.closest('#oppInfo') || e.target.closest('#myInfo')) {
            startArea = 'top';
        } else {
            startArea = '';
        }
    }, { passive: true });

    document.addEventListener('pointermove', function(e) {
        if (!startArea) return;
        if (!document.querySelector('.dragghost')) return;

        const myInfo = document.getElementById('myInfo');
        if (!myInfo) return;

        const y = getClientY(e);
        const boundary = myInfo.getBoundingClientRect().top;
        const currentArea = y < boundary ? 'top' : 'bottom';

        const cardtip = document.getElementById('cardtip');
        const preview = document.getElementById('preview');

        if (startArea !== currentArea) {
            if (cardtip) {
                cardtip.style.setProperty('display', 'none', 'important');
                cardtip.classList.add('hidden');
            }
            if (preview) {
                preview.style.setProperty('display', 'none', 'important');
            }
        }
    }, { passive: true });

    const clearDrag = function(e) {
        startArea = '';
        const cardtip = document.getElementById('cardtip');
        const preview = document.getElementById('preview');
        if (cardtip) cardtip.style.removeProperty('display');
        if (preview) preview.style.removeProperty('display');

        // ★ 核心修复：如果手指位移极小（属于单纯点击），立刻清理预览，防止使用卡牌后预览卡住
        if (e && e.clientX !== undefined) {
            const dx = Math.abs(e.clientX - pointerStartX);
            const dy = Math.abs(e.clientY - pointerStartY);
            if (dx < 10 && dy < 10) {
                if (window.UI && UI.hidePreview) {
                    UI.hidePreview();
                }
            }
        }
    };

    document.addEventListener('pointerup', clearDrag, { passive: true });
    document.addEventListener('pointercancel', clearDrag, { passive: true });
})();