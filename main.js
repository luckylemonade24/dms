const { app, BrowserWindow, Menu, dialog, protocol, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

let mainWindow;

// ==========================================
// 1. 单实例锁
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

// ==========================================
// 2. 注册虚拟域名协议 (必须在 app.ready 之前)
// ==========================================
protocol.registerSchemesAsPrivileged([
  { scheme: 'https', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

// ==========================================
// 3. 自动更新
// ==========================================
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info', title: '更新就绪',
      message: `新版本 ${info.version} 已下载完成，是否立即重启安装？`,
      buttons: ['立即重启', '稍后'], defaultId: 0, cancelId: 1,
    }).then((r) => {
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.checkForUpdates();
}

// ==========================================
// 4. 启动
// ==========================================
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  // ★ 核心：拦截 https://app.local 请求，映射到本地目录
  protocol.handle('https', (request) => {
    const urlObj = new URL(request.url);
    
    // 如果是我们虚拟的本地域名，就去读文件
    if (urlObj.hostname === 'app.local') {
      let pathname = decodeURIComponent(urlObj.pathname);
      if (pathname === '/') pathname = '/index.html';

      // 防止路径穿越
      const safePath = pathname.replace(/^(\.\.[\/\\])+/, '');
      const filePath = path.join(__dirname, safePath);

      // 使用 Electron 的 net.fetch 返回文件，它会自动处理 MIME 类型
      return net.fetch(`file://${filePath}`);
    }
    
    // 其他正常的网络请求（比如联机服务器）放行
    return net.fetch(request);
  });

  mainWindow = new BrowserWindow({
    width: 1280, height: 720, autoHideMenuBar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  // 加载虚拟域名，Origin 永远是 https://app.local，存档稳如泰山
  mainWindow.loadURL('https://app.local/index.html');

  mainWindow.webContents.once('did-finish-load', () => {
    if (app.isPackaged) setupAutoUpdater();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});