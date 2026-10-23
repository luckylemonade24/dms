@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
set "OUTPUT_FILE=precache-manifest.js"

echo self.PRECACHE_ASSETS = [ > %OUTPUT_FILE%

rem ★ 核心：排除了 _headers 和 _worker.js，防止后端配置被前端缓存
for /f "delims=" %%a in ('dir /b /s /a-d ^| findstr /v /i /e "\.bat \.tar\.gz sw\.js precache-manifest\.js _headers _worker\.js" ^| findstr /v /i "\.git\\ node_modules\\"') do (
    set "FILEPATH=%%a"
    set "FILEPATH=!FILEPATH:%~dp0=!"
    set "FILEPATH=!FILEPATH:\=/!"
    echo   './!FILEPATH!', >> %OUTPUT_FILE%
)

echo ]; >> %OUTPUT_FILE%
echo ✅ 清单生成完毕！
pause