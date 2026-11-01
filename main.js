const { app, BrowserWindow, Menu, dialog, protocol } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs/promises');
const path = require('node:path');

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
// 2. 注册 app:// 协议
// standard: true  → 相对路径、localStorage、同源策略正常工作
// codeCache: true → 允许 V8 字节码缓存
// ==========================================
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true,
    },
  },
]);

// ==========================================
// 3. 自动更新
// ==========================================
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err.message);
  });

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info', title: '更新就绪',
      message: `新版本 ${info.version} 已下载完成，是否立即重启安装？`,
      buttons: ['立即重启', '稍后'], defaultId: 0, cancelId: 1,
    }).then((r) => {
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Initial update check failed:', err.message);
  });
}

// ==========================================
// 4. 启动
// ==========================================
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  // 本地文件服务：只接管 app://app.local/... 的请求
  protocol.handle('app', async (request) => {
    const urlObj = new URL(request.url);

    if (urlObj.hostname !== 'app.local') {
      return new Response('Not Found', { status: 404 });
    }

    let pathname = decodeURIComponent(urlObj.pathname);
    if (pathname === '/') pathname = '/index.html';

    const appRoot = path.resolve(__dirname);
    const resolved = path.resolve(appRoot, '.' + pathname);

    // containment 检查：防止 ../ 逃逸
    if (!resolved.startsWith(appRoot + path.sep) && resolved !== appRoot) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const stat = await fs.stat(resolved);

      if (!stat.isFile()) {
        return new Response('Not Found', { status: 404 });
      }

      // 304 短路：浏览器拿到的仍是 200 缓存判定链，V8 字节码缓存才能持久化
      const ims = request.headers.get('If-Modified-Since');
      if (ims) {
        const since = new Date(ims).getTime();
        const mtimeSec = Math.floor(stat.mtimeMs / 1000) * 1000;
        if (mtimeSec <= since) {
          return new Response(null, { status: 304 });
        }
      }

      const body = await fs.readFile(resolved);

      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': getMimeType(resolved),
          // 文件名固定、整包替换更新 → 用协商缓存，每次先问一下
          'Cache-Control': 'no-cache, must-revalidate',
          'Last-Modified': stat.mtime.toUTCString(),
        },
      });
    } catch (err) {
      console.error('Protocol handler error:', resolved, err.message);
      return new Response('Not Found', { status: 404 });
    }
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      sandbox: true,
      v8CacheOptions: 'code',
      spellcheck: false,
      enableWebSQL: false,
      enableBlinkFeatures: false,
    }
  });

  mainWindow.maximize();
  mainWindow.loadURL('app://app.local/index.html');

  mainWindow.webContents.once('did-finish-load', () => {
    if (app.isPackaged) setupAutoUpdater();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ==========================================
// 5. MIME 表
// ==========================================
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}