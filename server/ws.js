/* ============================================================
 * server/ws.js —— 零依赖 WebSocket 服务端（RFC6455 最小可用实现）
 *
 *   只用 Node 内置模块（crypto / net），不需要 npm install：
 *     · 握手（Sec-WebSocket-Accept）
 *     · 文本帧收发、客户端掩码解码、分片拼接
 *     · ping / pong 心跳、close
 *   本游戏的消息都是 JSON 文本帧（不大），所以不做二进制与压缩扩展。
 * ========================================================== */
'use strict';

const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 1 << 20;          // 单帧上限 1MB（防异常大帧撑爆内存）

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

class WsConn {
  constructor(socket, req) {
    this.socket = socket;
    this.req = req;                 // 升级请求（可取 url / headers）
    this.url = req && req.url ? req.url : '/';
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragOp = 0;
    this.closed = false;
    this.isAlive = true;
    this.onMessage = null;          // (text) => void
    this.onClose = null;            // () => void

    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  /* ---------------- 收 ---------------- */
  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const f = this._readFrame();
      if (!f) break;
      this._handleFrame(f);
      if (this.closed) break;
    }
  }

  _readFrame() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < off + 2) return null;
      len = b.readUInt16BE(off); off += 2;
    } else if (len === 127) {
      if (b.length < off + 8) return null;
      len = Number(b.readBigUInt64BE(off)); off += 8;
    }
    if (len > MAX_FRAME) { this.close(1009, 'frame too large'); return null; }
    let mask = null;
    if (masked) {
      if (b.length < off + 4) return null;
      mask = b.subarray(off, off + 4); off += 4;
    }
    if (b.length < off + len) return null;
    let payload = Buffer.from(b.subarray(off, off + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this.buf = b.subarray(off + len);
    return { fin, op, payload };
  }

  _handleFrame(f) {
    if (f.op === 0x8) { this.close(1000, ''); return; }              // close
    if (f.op === 0x9) { this._send(0xA, f.payload); return; }        // ping → pong
    if (f.op === 0xA) { this.isAlive = true; return; }               // pong
    if (f.op === 0x0) this.frags.push(f.payload);                    // 分片续帧
    else { this.frags = [f.payload]; this.fragOp = f.op; }
    if (!f.fin) return;
    const data = Buffer.concat(this.frags);
    this.frags = [];
    if (this.fragOp === 0x1) {                                       // 文本帧
      const text = data.toString('utf8');
      if (this.onMessage) {
        try { this.onMessage(text); } catch (e) { console.error('[ws] onMessage 异常', e); }
      }
    }
  }

  /* ---------------- 发 ---------------- */
  _send(op, payload) {
    if (this.closed || !this.socket.writable) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | op;
    try { this.socket.write(Buffer.concat([head, payload])); } catch (e) { this._closed(); }
  }
  sendText(text) { this._send(0x1, Buffer.from(String(text), 'utf8')); }
  sendJSON(obj) { this.sendText(JSON.stringify(obj)); }
  ping() { this._send(0x9, Buffer.alloc(0)); }

  close(code, reason) {
    if (this.closed) return;
    const r = Buffer.from(String(reason || ''), 'utf8');
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code || 1000, 0);
    r.copy(p, 2);
    this._send(0x8, p);
    this.closed = true;
    this.socket.end();
    this._closed();
  }

  _closed() {
    if (this._notified) return;
    this._notified = true;
    this.closed = true;
    if (this.onClose) { try { this.onClose(); } catch (e) { /* ignore */ } }
    try { this.socket.destroy(); } catch (e) { /* ignore */ }
  }
}

/* 把 HTTP 升级请求变成一条 WebSocket 连接（握手） */
function upgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade !== 'websocket' || !key) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return null;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n' +
    '\r\n'
  );
  return new WsConn(socket, req);
}

module.exports = { WsConn, upgrade, acceptKey };
