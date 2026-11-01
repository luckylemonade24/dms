window.__NET_HOST = 'dms.spldream.com';

(function() {
    const PREFIX = '卡牌/缩略卡/';
    
    function fixPath(url) {
        if (typeof url !== 'string' || !url.includes(PREFIX)) return url;
        
        let cardName = url.split(PREFIX)[1].replace(/\.(png|webp|jpg)$/i, '');
        
        if (cardName === 'lingSdaincang') cardName = '澪S典藏';
        else if (cardName === '啮齿小鼠C') cardName = '啮齿小鼠';
        
        let prefix = url.split(PREFIX)[0];
        return prefix + '卡牌/高清卡/' + cardName + '详情.png';
    }

    const originalSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
        set: function(val) { originalSrc.set.call(this, fixPath(val)); },
        get: originalSrc.get
    });

    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        if (this.tagName === 'IMG' && name.toLowerCase() === 'src') {
            value = fixPath(value);
        }
        originalSetAttribute.call(this, name, value);
    };

    const originalInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(Element.prototype, 'innerHTML', {
        set: function(val) {
            if (typeof val === 'string' && val.includes(PREFIX)) {
                val = val.replace(/(src=["'])([^"']*?卡牌\/缩略卡\/[^"']*?)(["'])/g, function(match, p1, p2, p3) {
                    return p1 + fixPath(p2) + p3;
                });
            }
            originalInnerHTML.set.call(this, val);
        },
        get: originalInnerHTML.get
    });
})();