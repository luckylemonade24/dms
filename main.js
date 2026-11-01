const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

let mainWindow;

// MIME 类型映射
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

// 启动本地静态服务器
function startLocalServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let pathname = decodeURIComponent(url.parse(req.url).pathname);
      if (pathname === '/') pathname = '/index.html';

      // 防止路径穿越
      const safePath = pathname.replace(/^(\.\.[\/\\])+/, '');
      const filePath = path.join(__dirname, safePath);

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not Found');
        } else {
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
          res.end(data);
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve(port); // 随机分配一个空闲端口，防止冲突
    });
  });
}

app.whenReady().then(async () => {
  // 1. 启动静态服务器拿到端口
  const port = await startLocalServer();

  // 2. 创建窗口
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // 3. 加载本地服务
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});