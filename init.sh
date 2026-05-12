#!/usr/bin/env bash
# Claudio FM — 初始化脚本
# 用法：bash init.sh
# 设置 RUN_START_COMMAND=1 直接启动后端服务

set -e

INSTALL_CMD="npm install"
VERIFY_CMD="npm test"
START_CMD="npm start"

echo "=============================="
echo "  Claudio FM — 初始化"
echo "=============================="
echo ""
echo "📁 当前目录: $(pwd)"
echo ""

# 确认在正确目录
if [ ! -f "package.json" ]; then
  echo "❌ 错误：未找到 package.json，请在项目根目录运行此脚本"
  exit 1
fi

if [ ! -f "electron-main.js" ]; then
  echo "❌ 错误：未找到 electron-main.js，确认这是 Claudio FM 项目根目录"
  exit 1
fi

# 安装依赖
echo "📦 安装依赖..."
$INSTALL_CMD
echo "✅ 依赖安装完成"
echo ""

# 检查 yt-dlp（非必须，但功能依赖）
if command -v yt-dlp &> /dev/null; then
  echo "✅ yt-dlp 已安装: $(yt-dlp --version)"
else
  echo "⚠️  yt-dlp 未找到 — 音乐播放功能将受限"
  echo "   安装方法: pip install yt-dlp 或 winget install yt-dlp"
fi
echo ""

# 运行验证
echo "🧪 运行测试..."
if $VERIFY_CMD; then
  echo "✅ 所有测试通过"
else
  echo "❌ 测试失败 — 请先修复再继续"
  echo "   命令: npm test"
  exit 1
fi
echo ""

echo "=============================="
echo "  初始化完成"
echo "=============================="
echo ""
echo "启动命令："
echo "  后端服务:    $START_CMD"
echo "  Electron:    npm run desktop  （需先启动后端）"
echo "  浏览器访问:  http://localhost:3000"
echo ""

# 可选：直接启动
if [ "${RUN_START_COMMAND:-0}" = "1" ]; then
  echo "🚀 启动后端服务..."
  $START_CMD
fi
