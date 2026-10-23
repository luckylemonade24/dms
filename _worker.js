export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. 如果是 WebSocket 升级请求，交给服务绑定处理
    if (url.pathname === '/ws') {
      return env.BACKEND.fetch(request);
    }

    // 2. ★ 关键补充：如果是 HTTP 轮询请求，也走服务绑定丢给 Worker
    if (url.pathname.startsWith('/api/')) {
      return env.BACKEND.fetch(request);
    }

    // 3. 其他普通网页、图片请求，走 Pages 静态资源
    return env.ASSETS.fetch(request);
  }
};