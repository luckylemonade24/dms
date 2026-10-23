window.addEventListener('load', () => {
    setTimeout(() => {
        const runQueue = (urls, concurrency, onComplete) => {
            if (!urls || urls.length === 0) return onComplete && onComplete();
            let index = 0;
            
            const next = () => {
                if (index >= urls.length) return onComplete && onComplete();
                const batch = urls.slice(index, index + concurrency);
                index += concurrency;
                let finished = 0;
                
                batch.forEach(url => {
                    const img = new Image();
                    img.onload = img.onerror = () => {
                        finished++;
                        if (finished === batch.length) setTimeout(next, 50); // 50ms间隔防卡死
                    };
                    img.src = url;
                });
            };
            next();
        };

        // 先下缩略卡 (并发30，瞬间下完)
        runQueue(window.CARD_THUMBS, 30, () => {
            // 缩略卡全下完，再慢悠悠下高清卡 (并发30，不抢带宽)
            runQueue(window.CARD_HD, 30, () => {
                console.log('全部卡牌预加载完毕！');
            });
        });
    }, 1000); // 页面加载完等 2 秒再开始偷下
});