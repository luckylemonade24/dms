const { app, BrowserWindow, Menu, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

let mainWindow;

// ==========================================
// 1. 单实例锁：防止重复打开
// ==========================================
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// MIME 类型映射 (给本地静态服务器用)
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

// ==========================================
// 2. 本地静态服务器：替代原本的 server 文件夹
// ==========================================
function startLocalServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let pathname = decodeURIComponent(url.parse(req.url).pathname);
      if (pathname === '/') pathname = '/index.html';

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
      resolve(server.address().port);
    });
  });
}

// ==========================================
// 3. 自动更新逻辑
// ==========================================
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('error', (err) => {
    console.error('[updater] 出错:', err);
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] 发现新版本:', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] 已是最新版本');
  });

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新就绪',
      message: `新版本 ${info.version} 已下载完成，是否立即重启安装？`,
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
    }).then((r) => {
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.checkForUpdates();
}

// ==========================================
// 4. 启动应用
// ==========================================
app.whenReady().then(async () => {
  // 隐藏默认的 File / Edit / View 等菜单栏
  Menu.setApplicationMenu(null);

  // 启动本地服务并获取随机端口
  const port = await startLocalServer();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // 加载本地服务地址
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  // 页面加载完成后，执行自动更新检查
  mainWindow.webContents.once('did-finish-load', () => {
    // 防止在开发环境（npm start）下因为找不到 app-update.yml 报错
    if (app.isPackaged) {
      setupAutoUpdater();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});