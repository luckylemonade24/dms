/* ============================================================
 * HTTP 长轮询伪装 WebSocket  js/polling.js
 * ========================================================== */
(function() {
  const OriginalWebSocket = window.WebSocket;
  
  window.PollingWebSocket = function(url) {
    this.url = url || '';
    this.readyState = 0; // 0 = CONNECTING
    this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
    
    const baseUrl = this.url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'https://').replace(/\/ws$/, '');
    const sid = 'poll_' + Math.random().toString(36).substring(7);
    let isClosed = false;

    // ★ 核心：先发一个真实的请求探路，验证后端是否连通
    (async () => {
      try {
        const res = await fetch(`${baseUrl}/api/send?sid=${sid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ t: 'ping', ts: Date.now() })
        });

        // 如果后端返回了 405 或其他错误，直接抛错，不提示“已连接”
        if (!res.ok) throw new Error('Connect failed: ' + res.status);

        if (isClosed) return;
        this.readyState = 1;
        if (this.onopen) this.onopen(); // 探路成功，告诉 net.js 已连接
        
        this.poll(); // 开始挂机拉取消息

      } catch (e) {
        if (isClosed) return;
        this.readyState = 3;
        if (this.onerror) this.onerror(e);
        if (this.onclose) this.onclose();
      }
    })();

    // 发送消息（POST 请求）
    this.send = (data) => {
      if (isClosed || this.readyState !== 1) return;
      fetch(`${baseUrl}/api/send?sid=${sid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: data
      }).catch(e => console.error('轮询发送失败', e));
    };

    // 接收消息（GET 长轮询）
    this.poll = async () => {
      if (isClosed) return;
      try {
        const res = await fetch(`${baseUrl}/api/poll?sid=${sid}`);
        if (res.status === 204) {
          if (!isClosed) this.poll(); // 20秒超时无消息，重新发起
          return;
        }
        const text = await res.text();
        if (text && this.onmessage) {
          this.onmessage({ data: text });
        }
        if (!isClosed) setTimeout(() => this.poll(), 10); 
      } catch (e) {
        if (!isClosed) {
          this.readyState = 3;
          if (this.onerror) this.onerror(e);
          if (this.onclose) this.onclose();
        }
      }
    };

    this.close = () => {
      isClosed = true;
      this.readyState = 3;
      if (this.onclose) this.onclose();
    };
  };
})();