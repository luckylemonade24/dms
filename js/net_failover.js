/* ============================================================
 * 联机备用服务器并发测速兜底  net_failover.js
 * ========================================================== */
(function() {
  'use strict';

  // ★ 参数开关：设为 true 才允许降级到 HTTP 长轮询；设为 false 则 WSS 全挂直接报错
  var ENABLE_HTTP_POLLING = true; 
  
  // 只保留本站的备用域名
  var backupHosts = [
    'dms-gu.pages.dev'
  ];

  if (!window.__NET_HOST) return;

  var OriginalWebSocket = window.WebSocket;
  var activeConnections = []; 

  // 记录新创建的 WebSocket，用于后续掐断卡死的连接
  window.WebSocket = function(url, protocols) {
    var ws = new OriginalWebSocket(url, protocols);
    activeConnections.push(ws);
    return ws;
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  function testHost(host) {
    return new Promise(function(resolve) {
      var ws;
      try { 
        // 直接拿域名拼 wss
        ws = new OriginalWebSocket('wss://' + host + '/ws'); 
      } catch(e) { 
        resolve(false); 
        return; 
      }

      var timer = setTimeout(function() { 
        try { ws.close(); } catch(e) {} 
        resolve(false); 
      }, 2000);
      
      ws.onopen = function() { 
        clearTimeout(timer); 
        try { ws.close(); } catch(e) {} 
        resolve(true); 
      };
      
      ws.onerror = function() { 
        clearTimeout(timer); 
        resolve(false); 
      };
    });
  }

  console.log('[Failover] 并发测试所有节点中...');
  var allHosts = [window.__NET_HOST].concat(backupHosts);

  Promise.all(allHosts.map(testHost)).then(function(results) {
    var success = false;

    if (results[0] === true) {
      success = true;
      console.log('✅ 主服务器可用。');
    } else {
      for (var i = 0; i < backupHosts.length; i++) {
        if (results[i + 1] === true) {
          window.__NET_HOST = backupHosts[i];
          success = true;
          console.log('✅ 已切换至本站备用: ' + window.__NET_HOST);
          break;
        }
      }
    }

    // ★ 如果 WSS 全挂，检查开关决定是否降级到 HTTP 轮询
    if (!success) {
      if (ENABLE_HTTP_POLLING && window.PollingWebSocket) {
        console.warn('[Failover] WSS 节点阵亡，已开启开关，强制启用 HTTP 轮询！');
        window.WebSocket = window.PollingWebSocket;
        window.__NET_HOST = 'dms-gu.pages.dev'; // 走 Pages 的普通 HTTPS
        success = true; 
      } else if (!ENABLE_HTTP_POLLING) {
        console.error('[Failover] WSS 节点阵亡，且 HTTP 轮询开关未开启，停止重试。');
      } else {
        console.error('[Failover] PollingWebSocket 未加载！请检查 HTML 引入顺序。');
      }
    }

    // 强行掐断之前卡在 CONNECTING(0) 状态的旧连接，逼 net.js 自动重连
    activeConnections.forEach(function(ws) {
      if (ws.readyState === 0) { 
        console.log('[Failover] 强制断开卡死连接，触发自动重连...');
        try { ws.close(); } catch(e) {}
      }
    });
    activeConnections = [];
  });
})();