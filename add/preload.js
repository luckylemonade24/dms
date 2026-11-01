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

        // 先下缩略卡 (并发50，瞬间下完)
        runQueue(window.CARD_THUMBS, 50, () => {
            // 缩略卡全下完，再慢悠悠下高清卡 (并发50，不抢带宽)
            runQueue(window.CARD_HD, 50, () => {
                console.log('全部卡牌预加载完毕！');
            });
        });
    }, 500); // 页面加载完等0.5秒再开始偷下
});