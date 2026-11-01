const { app, BrowserWindow, Menu, dialog, protocol, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

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
// 2. 注册虚拟域名协议
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
  Menu.setApplicationMenu(null); // 隐藏默认菜单栏

  // 虚拟域名拦截
  protocol.handle('https', (request) => {
    const urlObj = new URL(request.url);
    if (urlObj.hostname === 'app.local') {
      let pathname = decodeURIComponent(urlObj.pathname);
      if (pathname === '/') pathname = '/index.html';
      const safePath = pathname.replace(/^(\.\.[\/\\])+/, '');
      const filePath = path.join(__dirname, safePath);
      return net.fetch(`file://${filePath}`);
    }
    return net.fetch(request);
  });

  mainWindow = new BrowserWindow({
    width: 1280, 
    height: 720,
    // 不使用无边框，保留原生窗口
    autoHideMenuBar: true, 
    webPreferences: { 
      nodeIntegration: true, 
      contextIsolation: false,
      backgroundThrottling: false // 切后台不降帧
    }
  });

  // 启动时直接最大化（铺满屏幕，但保留任务栏）
  mainWindow.maximize();

  mainWindow.loadURL('https://app.local/index.html');

  mainWindow.webContents.once('did-finish-load', () => {
    if (app.isPackaged) setupAutoUpdater();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});