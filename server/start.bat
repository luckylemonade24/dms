@echo off
chcp 65001 >nul
title 地牢决斗师 · 联机服务端

rem ===============================================================
rem  ★ 想换端口，就改下面这一行的数字（改完保存，再双击本脚本）
rem    改完记得在【Windows 防火墙】和【云服务器安全组】里
rem    放行同一个端口，否则外面连不上。
rem ===============================================================
if not defined PORT set "PORT=3000"

rem 切到项目根目录（server.js 里用自身位置定位游戏文件，这里只是让日志路径更清楚）
cd /d "%~dp0.."

rem ===== 自动查找一个「能正常工作」的 Node 运行环境 =====
rem 本机可能装了多个 Node，也可能一个都没装（只装了编辑器/IDE）。
rem 这里逐个试探，并做一次真实运行自检，跳过损坏的版本，取第一个可用的。
set "NODE_EXE="
set "NODE_BAD="
set "NODE_BAD_N=0"
set "NODE_FALLBACK="

rem ① 系统 PATH 里的 node（正常安装过 Node.js 的情况；可能有多个）
for /f "delims=" %%i in ('where node.exe 2^>nul') do call :try_node "%%i" 0

rem ② 常见安装路径（个别安装方式不会写进 PATH）
set "PF86=%ProgramFiles(x86)%"
call :try_node "%ProgramFiles%\nodejs\node.exe" 0
call :try_node "%PF86%\nodejs\node.exe" 0
call :try_node "%LOCALAPPDATA%\Programs\nodejs\node.exe" 0

rem ③ 兜底：借用本机其它程序自带的 node 运行时（装了编辑器/IDE 时常见；按版本从新到旧试）
for /f "delims=" %%d in ('dir /b /ad /o-n "%USERPROFILE%\.workbuddy\binaries\node\versions" 2^>nul') do call :try_node "%USERPROFILE%\.workbuddy\binaries\node\versions\%%d\node.exe" 1
call :try_node "%ProgramFiles%\Microsoft VS Code\resources\app\node.exe" 1

if not defined NODE_EXE (
  echo.
  echo   [错误] 没有找到可用的 Node.js 运行环境。
  echo.
  echo   请安装 Node.js 18 或更高版本后，再重新双击本脚本：
  echo     https://nodejs.org/zh-cn/download
  echo.
  echo   安装时保持默认选项即可（会自动配好环境变量），无需其它设置。
  echo.
  pause
  exit /b 1
)

if %NODE_BAD_N% GTR 0 (
  echo.
  echo   [提示] 已跳过 %NODE_BAD_N% 个无法正常运行的 Node.js：
  echo          %NODE_BAD%
)
if defined NODE_FALLBACK (
  echo.
  echo   [提示] 未检测到独立安装的 Node.js，将借用已有运行时启动：
  echo          %NODE_EXE%
  echo          这样用完全没问题；如果以后要长期开服，建议安装官方 Node.js。
)

echo.
echo   正在启动联机服务端...  端口 %PORT%
echo   （启动后会显示本机地址和局域网地址，把局域网地址发给朋友即可）
echo   （想改端口：用记事本打开本文件，改最上面 PORT 那一行的数字）
echo.
"%NODE_EXE%" server\server.js

echo.
echo   服务端已停止。
pause
exit /b 0

rem ---------------------------------------------------------------
rem 子过程：试探 %~1 这个 node 能不能正常工作（%~2=1 表示是"借用"来的）
rem ---------------------------------------------------------------
:try_node
if defined NODE_EXE goto :eof
if not exist "%~1" goto :eof
rem 自检：真跑一次（注意用 || 判断——损坏的 node 退出码可能是负数，if errorlevel 会漏判）
"%~1" -e "require('vm');require('http');require('fs')" >nul 2>nul || goto :node_bad
set "NODE_EXE=%~1"
if "%~2"=="1" set "NODE_FALLBACK=1"
goto :eof
:node_bad
set /a NODE_BAD_N+=1
if not defined NODE_BAD set "NODE_BAD=%~1"
goto :eof
