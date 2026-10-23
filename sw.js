/* ============================================================
 * PWA Service Worker - 全量预缓存版 (最终完美版)
 * ============================================================ */
'use strict';

importScripts('./precache-manifest.js');

// ⚠️ 每次更新代码，只需要把这里换成新的日期或数字！
const CACHE_NAME = '202610231808';

// 1. 安装阶段：全量下载
self.addEventListener('install', function (e) {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            console.log(`[SW] 开始全量缓存 ${self.PRECACHE_ASSETS.length} 个文件...`);
            
            // ★ 绝不乱改 URL，用 cache: 'reload' 强制去服务器拉最新文件
            return Promise.all(
                self.PRECACHE_ASSETS.map(function(url) {
                    return fetch(url, { cache: 'reload' }).then(function(response) {
                        if (!response.ok) throw new Error('下载失败: ' + url);
                        // 用原始干净的 url 作为 Key 存入
                        return cache.put(url, response);
                    });
                })
            ).then(function() {
                console.log('[SW] ✅ 所有资源全量缓存完成！断网可秒开。');
            }).catch(function(err) {
                console.error('[SW] 缓存文件失败，请检查是否有路径错误或文件缺失:', err);
                throw err;
            });
        })
    );
});

// 2. 激活阶段：清理旧版本缓存
self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys().then(function (cacheNames) {
            return Promise.all(
                cacheNames.map(function (cacheName) {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] 正在删除旧缓存:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(function () {
            return self.clients.claim();
        })
    );
});

// 3. 拦截阶段：缓存优先，忽略版本号匹配
self.addEventListener('fetch', function (e) {
    if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) {
        return;
    }

    // 页面导航：网络优先，保证拿到最新 HTML；断网走缓存
    if (e.request.mode === 'navigate') {
        e.respondWith(
            fetch(e.request).catch(function() {
                return caches.match(e.request);
            })
        );
        return;
    }

    // 静态资源：忽略 ?v=xx 参数，匹配本地干净缓存
    e.respondWith(
        caches.match(e.request, { ignoreSearch: true }).then(function (cachedResponse) {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(e.request);
        })
    );
});