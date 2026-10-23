'use strict';
const { app, BrowserWindow, Menu } = require('electron');
const http = require('http');
const net  = require('net');
const path = require('path');

// 强制关闭服务端日志落盘，防止在玩家电脑上乱写文件
process.env.LOG_TO_FILE = '0';

let win = null, splash = null;

// 自动寻找可用端口（防端口冲突）
function findPort(start) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const s = net.createServer();
      s.once('error', () => tryPort(p + 1));
      s.once('listening', () => s.close(() => resolve(p)));
      s.listen(p, '127.0.0.1');
    };
    tryPort(start);
  });
}

// 轮询等待本地服务启动完毕
function waitForServer(port) {
  return new Promise((resolve) => {
    const ping = () => {
      const req = http.get('http://127.0.0.1:' + port + '/health', (res) => {
        if (res.statusCode === 200) resolve(); else setTimeout(ping, 200);
      });
      req.on('error', () => setTimeout(ping, 200));
      req.setTimeout(1000, () => { req.destroy(); setTimeout(ping, 200); });
    };
    ping();
  });
}

// 启动画面
function createSplash() {
  splash = new BrowserWindow({
    width: 420, height: 280, frame: false, resizable: false,
    alwaysOnTop: true, transparent: false, backgroundColor: '#0a0a0a',
    webPreferences: { nodeIntegration: false }
  });
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0a0a0a;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:'Microsoft YaHei',sans-serif;color:#e0c080}
    .title{font-size:22px;font-weight:bold;margin-bottom:24px;letter-spacing:2px}
    .bar{width:280px;height:6px;background:#222;border-radius:3px;overflow:hidden}
    .fill{width:0%;height:100%;background:linear-gradient(90deg,#c8963e,#f0d080);border-radius:3px;animation:load 1.8s ease-in-out infinite}
    @keyframes load{0%{width:10%}50%{width:85%}100%{width:10%}}
    .tip{margin-top:16px;font-size:13px;color:#888}
  </style></head><body>
    <div class="title">⚔ 地牢决斗师 ⚔</div>
    <div class="bar"><div class="fill"></div></div>
    <div class="tip">正在部署游戏，请稍候...</div>
  </body></html>`;
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  splash.center();
}

async function bootstrap() {
  createSplash();
  const port = await findPort(3000);
  process.env.PORT = String(port);
  
  // 启动你项目里的后端（极简 server.js 或完整版 server.js 都可以）
  require('./server/server.js');
  
  await waitForServer(port);
  
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    autoHideMenuBar: true, backgroundColor: '#0a0a0a', show: false,
    title: '地牢决斗师：踏上征途',
    icon: path.join(__dirname, 'app.ico'),
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  Menu.setApplicationMenu(null);
  
  // 加载本地服务
  win.loadURL('http://localhost:' + port + '/');
  
  win.webContents.once('did-finish-load', () => {
    if (splash) { splash.close(); splash = null; }
    win.show();
  });
  
  win.on('closed', () => { win = null; app.quit(); });
}

app.whenReady().then(bootstrap);
app.on('window-all-closed', () => app.quit());