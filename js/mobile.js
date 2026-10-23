(function() {
    let startArea = null;

    function getClientY(e) {
        return e.clientY !== undefined ? e.clientY : (e.touches && e.touches.length ? e.touches[0].clientY : 0);
    }

    document.addEventListener('pointerdown', function(e) {
        const battleEl = document.getElementById('battle');
        if (!battleEl || battleEl.classList.contains('hidden')) return;

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

    const clearDrag = function() {
        startArea = '';
        const cardtip = document.getElementById('cardtip');
        const preview = document.getElementById('preview');
        if (cardtip) cardtip.style.removeProperty('display');
        if (preview) preview.style.removeProperty('display');
    };

    document.addEventListener('pointerup', clearDrag, { passive: true });
    document.addEventListener('pointercancel', clearDrag, { passive: true });
})();