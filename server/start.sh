#!/usr/bin/env bash
# ============================================================
# 地牢决斗师 · 联机服务端启动脚本（Linux / macOS）
#
#   用法：  bash server/start.sh
#   端口：  默认 3000，可用 PORT=8080 bash server/start.sh 改
#   停止：  Ctrl + C
#
#   服务端零依赖：只用 Node 内置模块，不需要 npm install。
# ============================================================
set -e
cd "$(dirname "$0")"

PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
export PORT HOST

# ---- 找可用的 node ----
NODE_BIN=""
for c in node nodejs; do
  if command -v "$c" >/dev/null 2>&1; then NODE_BIN="$c"; break; fi
done
if [ -z "$NODE_BIN" ]; then
  echo "[错误] 没有找到 Node.js。请先安装 Node.js 18 或更高版本：https://nodejs.org/"
  exit 1
fi

VER="$("$NODE_BIN" -v 2>/dev/null | sed 's/^v//')"
MAJOR="$(echo "$VER" | cut -d. -f1)"
if [ -z "$MAJOR" ] || [ "$MAJOR" -lt 18 ] 2>/dev/null; then
  echo "[错误] Node.js 版本过低（当前 v$VER，需要 18 以上）"
  exit 1
fi

echo "使用 $NODE_BIN (v$VER)"
echo "正在启动联机服务端，端口 $PORT ..."
echo "（启动后会打印本机地址，公网访问请用 http://服务器公网IP:$PORT/）"
echo

exec "$NODE_BIN" server.js
