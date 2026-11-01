/* ============================================================
 * Service Worker —— 最小实现（故意的）
 *
 * 存在的唯一目的：让浏览器认为"这个站点可以安装到主屏"。
 *   Chrome 的规则是「有 manifest + 有 Service Worker + SW 里有 fetch 处理」
 *   才会触发 beforeinstallprompt（"添加到主屏幕"按钮才会出现）。
 *   iOS Safari 的"添加到主屏幕"是浏览器菜单自带功能，不需要 SW。
 *
 * ★ 故意不做任何缓存：
 *   本站是本地/自建服务器部署、资源带版本号（?v=）更新，
 *   一旦 SW 缓存了旧文件，就会出现"改了代码但用户还是老版本"这类经典麻烦。
 *   这里让所有请求直接走网络，只保留"可安装"这一个能力。
 * ============================================================ */
'use strict';

self.addEventListener('install', function () {
  self.skipWaiting();               // 新版本立即接管，不等旧页面关闭
});

self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim()); // 立即接管所有已打开的页面
});

// 有 fetch 监听是 Chrome 判定"可安装"的必要条件之一；
// 这里什么都不做，请求照常走网络（不缓存、不改写）。
self.addEventListener('fetch', function () {
  /* pass-through */
});
