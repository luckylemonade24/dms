$ErrorActionPreference = 'Stop'

$root    = $PSScriptRoot
$staging = Join-Path $root '.build-electron'
$dist    = Join-Path $root 'dist'
$exeOut  = Join-Path $dist '地牢决斗师.exe'

$env:ELECTRON_MIRROR                  = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
$env:npm_config_registry              = 'https://registry.npmmirror.com'

function Write-Bar {
    param([int]$Done, [int]$Total, [string]$Label)
    if ($Total -le 0) { $Total = 1 }
    $pct = [math]::Round($Done / $Total * 100)
    $n = [math]::Round($pct / 2)
    if ($n -lt 0) { $n = 0 }; if ($n -gt 50) { $n = 50 }
    $bar = ('█' * $n) + ('░' * (50 - $n))
    Write-Host "`r  $Label [$bar] $pct%  " -NoNewline -ForegroundColor Cyan
}

function Wait-JobBar {
    param([System.Management.Automation.Job]$Job, [string]$Label)
    $i = 0
    while ($Job.State -eq 'Running') {
        $bar = ''
        for ($j = 0; $j -lt 50; $j++) { $bar += @('░','▒','▓','█')[($i+$j)%4] }
        Write-Host "`r  $Label [$bar] " -NoNewline -ForegroundColor Cyan
        Start-Sleep -Milliseconds 100
        $i++
    }
    Write-Host "`r  $Label [██████████████████████████████████████████] 完成" -NoNewline -ForegroundColor Green
    Write-Host ""
}

Write-Host ""
Write-Host "  地牢决斗师 · 桌面版打包" -ForegroundColor Cyan

if ($args.Count -gt 0) {
    $version = $args[0]
} else {
    $version = Read-Host "  请输入版本号（回车默认 0.0.8）"
    if ([string]::IsNullOrWhiteSpace($version)) { $version = '0.0.8' }
}

foreach ($cmd in @('node','npm')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "  [错误] 未找到 $cmd" -ForegroundColor Red; exit 1
    }
}

Write-Host "  清理旧文件... " -NoNewline -ForegroundColor Yellow
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
if (Test-Path $dist)    { Remove-Item $dist    -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null
New-Item -ItemType Directory -Path $dist    | Out-Null
Write-Host "完成" -ForegroundColor Green

$excludeDirs = @('logs','.build-electron','dist','.git','node_modules')
$excludeExt  = @('.ps1','.sh','.log','.exe')
$allFiles = Get-ChildItem $root -Recurse -File | Where-Object {
    $p = $_.FullName
    -not ($excludeDirs | Where-Object { $p -like "*\$_\*" }) -and
    ($excludeExt -notcontains $_.Extension.ToLower())
}
$total = $allFiles.Count
$done = 0
foreach ($f in $allFiles) {
    $rel = $f.FullName.Substring($root.Length).TrimStart('\')
    $dest = Join-Path $staging $rel
    $destDir = Split-Path $dest -Parent
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    Copy-Item $f.FullName $dest -Force
    $done++
    Write-Bar $done $total '拷贝文件'
}
Write-Host ""

Write-Host "  写入配置... " -NoNewline -ForegroundColor Yellow
$mainJs = @'
'use strict';
const { app, BrowserWindow, Menu } = require('electron');
const http = require('http');
const net  = require('net');
const path = require('path');
process.env.LOG_TO_FILE = '0';
let win = null, splash = null;
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
  win.loadURL('http://localhost:' + port + '/');
  win.webContents.once('did-finish-load', () => {
    if (splash) { splash.close(); splash = null; }
    win.show();
  });
  win.on('closed', () => { win = null; app.quit(); });
}
app.whenReady().then(bootstrap);
app.on('window-all-closed', () => app.quit());
'@
Set-Content -Path (Join-Path $staging 'main.js') -Value $mainJs -Encoding UTF8

$packageJson = @"
{
  "name": "dungeon-duelist",
  "version": "$version",
  "description": "地牢决斗师：踏上征途",
  "main": "main.js",
  "author": "",
  "license": "UNLICENSED",
  "build": {
    "appId": "com.dungeonduelist.app",
    "productName": "地牢决斗师",
    "directories": { "output": "dist" },
    "files": ["**/*", "!**/*.log", "!**/build-exe.ps1"],
    "win": { "target": "nsis", "icon": "app.ico" },
    "nsis": {
      "oneClick": true,
      "perMachine": false,
      "allowToChangeInstallationDirectory": false,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "runAfterFinish": true,
      "shortcutName": "地牢决斗师",
      "artifactName": "地牢决斗师-Setup.exe"
    },
    "asar": true,
    "compression": "maximum"
  }
}
"@
Set-Content -Path (Join-Path $staging 'package.json') -Value $packageJson -Encoding UTF8
Write-Host "完成" -ForegroundColor Green

$nodeExe = (Get-Command node).Source
$nodeDir = Split-Path $nodeExe
$npmCli = @(
    (Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'),
    (Join-Path $nodeDir 'node\node_modules\npm\bin\npm-cli.js')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $npmCli) { throw "找不到 npm-cli.js" }

$job = Start-Job -ScriptBlock {
    param($nodeExe, $npmCli, $staging, $m1, $m2, $reg)
    $env:ELECTRON_MIRROR = $m1
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = $m2
    $env:npm_config_registry = $reg
    Set-Location $staging
    & $nodeExe $npmCli install --save-dev electron electron-builder sharp --no-audit --no-fund --loglevel=error 2>&1
} -ArgumentList $nodeExe, $npmCli, $staging, $env:ELECTRON_MIRROR, $env:ELECTRON_BUILDER_BINARIES_MIRROR, $env:npm_config_registry
Wait-JobBar $job '安装依赖'
$jobOut = Receive-Job $job
if ($job.State -eq 'Failed') { $jobOut; throw "npm install 失败" }
Remove-Job $job

$iconJs = @'
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = path.join(__dirname, '图标', 'icon.png');
  const sizes = [16, 32, 48, 64, 128, 256];
  const imgs = await Promise.all(sizes.map(s => sharp(src).resize(s, s).png().toBuffer()));
  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(0,0); hdr.writeUInt16LE(1,2); hdr.writeUInt16LE(sizes.length,4);
  const entries = []; let off = 6 + sizes.length*16;
  for (let i=0;i<sizes.length;i++) {
    const e = Buffer.alloc(16);
    e.writeUInt8(sizes[i]>=256?0:sizes[i],0);
    e.writeUInt8(sizes[i]>=256?0:sizes[i],1);
    e.writeUInt16LE(1,4); e.writeUInt16LE(32,6);
    e.writeUInt32LE(imgs[i].length,8); e.writeUInt32LE(off,12);
    off += imgs[i].length; entries.push(e);
  }
  fs.writeFileSync(path.join(__dirname,'app.ico'), Buffer.concat([hdr,...entries,...imgs]));
})().catch(e=>{console.error(e);process.exit(1);});
'@
Set-Content -Path (Join-Path $staging 'gen-icon.js') -Value $iconJs -Encoding UTF8
Write-Host "  生成图标... " -NoNewline -ForegroundColor Yellow
& $nodeExe (Join-Path $staging 'gen-icon.js')
if ($LASTEXITCODE -ne 0) { throw "图标生成失败" }
Write-Host "完成" -ForegroundColor Green

# === 原本这里的图片压缩代码 $compressJs 已经被彻底删除，不再强制覆盖任何图片 ===

$ebCli = Join-Path $staging 'node_modules\electron-builder\out\cli\cli.js'
$job2 = Start-Job -ScriptBlock {
    param($nodeExe, $ebCli, $staging, $m1, $m2, $reg)
    $env:ELECTRON_MIRROR = $m1
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = $m2
    $env:npm_config_registry = $reg
    Set-Location $staging
    & $nodeExe $ebCli --win nsis 2>&1
} -ArgumentList $nodeExe, $ebCli, $staging, $env:ELECTRON_MIRROR, $env:ELECTRON_BUILDER_BINARIES_MIRROR, $env:npm_config_registry
Wait-JobBar $job2 '打包 exe'
$jobOut2 = Receive-Job $job2
if ($job2.State -eq 'Failed') { $jobOut2; throw "electron-builder 失败" }
Remove-Job $job2

$builtExe = Join-Path $staging 'dist\地牢决斗师-Setup.exe'
$exeOut = Join-Path $dist '地牢决斗师-Setup.exe'
Move-Item $builtExe $exeOut -Force
Remove-Item $staging -Recurse -Force

$sizeMB = [math]::Round((Get-Item $exeOut).Length / 1MB, 1)
Write-Host ""
Write-Host "  打包完成！$exeOut  ($sizeMB MB)" -ForegroundColor Green
Write-Host ""
Read-Host "  按回车键退出"