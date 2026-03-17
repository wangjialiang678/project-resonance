#!/usr/bin/env bash
# ============================================
# 共鸣 Project Resonance — 原生构建脚本
# 用法: bash scripts/build-apk.sh [android|ios|both]
# ============================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PLATFORM="${1:-}"

echo -e "${GREEN}🔧 共鸣 原生构建脚本${NC}"
echo "──────────────────────────────"

# 0. 平台选择
if [ -z "$PLATFORM" ]; then
  echo ""
  echo "请选择目标平台:"
  echo "  1) android"
  echo "  2) ios"
  echo "  3) both (两者都构建)"
  read -p "输入选项 (1/2/3): " -n 1 -r
  echo
  case $REPLY in
    1) PLATFORM="android" ;;
    2) PLATFORM="ios" ;;
    3) PLATFORM="both" ;;
    *) echo -e "${RED}❌ 无效选项${NC}"; exit 1 ;;
  esac
fi

echo -e "${CYAN}📱 目标平台: ${PLATFORM}${NC}"

# 1. 检查 Node 版本 (Capacitor 8 需要 Node 22+)
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo -e "${RED}❌ Node.js 版本过低 (当前: $(node -v))${NC}"
  echo "   Capacitor 8 需要 Node.js >= 22"
  echo "   请运行: nvm install 22 && nvm use 22"
  exit 1
fi
echo -e "${GREEN}✅ Node.js $(node -v)${NC}"

# 2. 检查 .env 文件
if [ ! -f .env ]; then
  echo -e "${RED}❌ 错误: 项目根目录缺少 .env 文件${NC}"
  echo ""
  echo "请创建 .env 并填入以下内容:"
  echo "  VITE_API_URL=https://project-resonance-api.project-resonance.workers.dev"
  exit 1
fi

missing=()
for var in VITE_API_URL; do
  if ! grep -q "^${var}=" .env; then
    missing+=("$var")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo -e "${RED}❌ .env 缺少必需变量:${NC}"
  for v in "${missing[@]}"; do echo "   - $v"; done
  exit 1
fi
echo -e "${GREEN}✅ .env 检查通过${NC}"

# 3. 检查 capacitor.config.ts 中 server 配置
if grep -E '^\s*server\s*:' capacitor.config.ts 2>/dev/null | grep -v '//' > /dev/null 2>&1; then
  echo -e "${YELLOW}⚠️  警告: capacitor.config.ts 中 server 配置未注释${NC}"
  echo "   APK/IPA 将连接远程服务器而非本地资源"
  read -p "是否继续? (y/N) " -n 1 -r
  echo
  [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

# 4. iOS 专属检查
if [[ "$PLATFORM" == "ios" || "$PLATFORM" == "both" ]]; then
  if [[ "$(uname)" != "Darwin" ]]; then
    echo -e "${RED}❌ iOS 构建仅支持 macOS${NC}"
    [[ "$PLATFORM" == "both" ]] && PLATFORM="android" && echo -e "${YELLOW}⚠️  将仅构建 Android${NC}" || exit 1
  else
    if ! command -v xcodebuild &> /dev/null; then
      echo -e "${RED}❌ 未检测到 Xcode，请先安装 Xcode${NC}"
      [[ "$PLATFORM" == "both" ]] && PLATFORM="android" && echo -e "${YELLOW}⚠️  将仅构建 Android${NC}" || exit 1
    else
      echo -e "${GREEN}✅ Xcode $(xcodebuild -version | head -1 | awk '{print $2}')${NC}"
    fi
  fi
fi

# 5. 安装依赖
echo ""
echo -e "${GREEN}📦 安装依赖...${NC}"
npm install

# 6. 构建
echo ""
echo -e "${GREEN}🏗️  执行生产构建...${NC}"
npm run build

if [ ! -d dist ]; then
  echo -e "${RED}❌ 构建失败: dist 目录不存在${NC}"
  exit 1
fi
echo -e "${GREEN}✅ 构建完成 (dist/)${NC}"

# 7. Capacitor 同步
echo ""
echo -e "${GREEN}📱 同步到原生平台...${NC}"
npx cap sync

echo ""
echo "──────────────────────────────"
echo -e "${GREEN}🎉 构建完成！${NC}"
echo ""

if [[ "$PLATFORM" == "android" || "$PLATFORM" == "both" ]]; then
  echo -e "${CYAN}▶ Android:${NC}"
  echo "  运行: npx cap run android"
  echo "  打开 IDE: npx cap open android"
  echo ""
fi

if [[ "$PLATFORM" == "ios" || "$PLATFORM" == "both" ]]; then
  echo -e "${CYAN}▶ iOS:${NC}"
  echo "  运行: npx cap run ios"
  echo "  打开 Xcode: npx cap open ios"
  echo ""
fi
