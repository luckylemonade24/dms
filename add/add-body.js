(function() {
    let tempPortraitActivated = false;
    const deckEl = document.getElementById('deck');
    if (!deckEl) return;

    function checkAndEnable() {
        if (!window.UI) return;
        const isPhysicalPortrait = window.innerHeight > window.innerWidth;
        if (isPhysicalPortrait && !UI.isPortrait()) {
            tempPortraitActivated = true;
            UI.setPortraitMode(true, true); 
        }
    }

    const observer = new MutationObserver(function() {
        if (!deckEl.classList.contains('hidden')) {
            checkAndEnable();
        } else {
            if (tempPortraitActivated) {
                if (window.UI) UI.setPortraitMode(false, true); 
                tempPortraitActivated = false;
            }
        }
    });
    observer.observe(deckEl, { attributes: true, attributeFilter: ['class'] });
})();