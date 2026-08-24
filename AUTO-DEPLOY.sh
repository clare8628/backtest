#!/bin/bash
# 自動化部署腳本 - Backtest Platform v0.2.1
# 執行：bash AUTO-DEPLOY.sh

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "═══════════════════════════════════════════════════════════"
echo "  🚀 Backtest Platform v0.2.1 自動化部署"
echo "═══════════════════════════════════════════════════════════"
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Step 1: 環境檢查
echo -e "${BLUE}[1/7]${NC} 檢查環境..."
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ wrangler 未安裝${NC}"
    exit 1
fi
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js 未安裝${NC}"
    exit 1
fi
echo -e "${GREEN}✓ 環境正常${NC}"
echo ""

# Step 2: 清除舊構建
echo -e "${BLUE}[2/7]${NC} 清除舊構建..."
rm -rf .next .open-next 2>/dev/null || true
echo -e "${GREEN}✓ 清除完成${NC}"
echo ""

# Step 3: 驗證登入
echo -e "${BLUE}[3/7]${NC} 驗證 Cloudflare 登入..."
if wrangler whoami &> /dev/null; then
    EMAIL=$(wrangler whoami 2>/dev/null | grep -o '[^ ]*@[^ ]*' | head -1)
    echo -e "${GREEN}✓ 已登入: $EMAIL${NC}"
else
    echo -e "${YELLOW}⚠️  未登入，打開登入頁面...${NC}"
    wrangler login
fi
echo ""

# Step 4: 驗證 D1 配置
echo -e "${BLUE}[4/7]${NC} 驗證 D1 配置..."
DB_ID=$(grep -o '"database_id": "[^"]*"' wrangler.jsonc | cut -d'"' -f4)
if [ -z "$DB_ID" ] || [ "$DB_ID" = "5b9e9e1a-9e9e-4e1a-9e9e-9e9e9e9e9e9e" ]; then
    echo -e "${YELLOW}⚠️  D1 database_id 未配置或使用預設值${NC}"
    echo "執行以下命令取得實際 ID："
    echo "  npm run db:create"
    echo "並更新 wrangler.jsonc"
    exit 1
fi
echo -e "${GREEN}✓ D1 配置正常: $DB_ID${NC}"
echo ""

# Step 5: TypeScript 檢查
echo -e "${BLUE}[5/7]${NC} TypeScript 檢查..."
if npx tsc --noEmit 2>&1 | grep -q "error"; then
    echo -e "${RED}❌ TypeScript 錯誤${NC}"
    npx tsc --noEmit
    exit 1
fi
echo -e "${GREEN}✓ TypeScript 無錯誤${NC}"
echo ""

# Step 6: 構建
echo -e "${BLUE}[6/7]${NC} 構建應用..."
if npm run deploy 2>&1 | tee deploy.log | grep -q "Deployed"; then
    DEPLOY_URL=$(grep -o 'https://[^ ]*workers.dev' deploy.log | head -1)
    echo -e "${GREEN}✓ 部署成功${NC}"
    if [ -n "$DEPLOY_URL" ]; then
        echo -e "  URL: ${BLUE}$DEPLOY_URL${NC}"
    fi
else
    echo -e "${RED}❌ 部署失敗${NC}"
    tail -20 deploy.log
    exit 1
fi
echo ""

# Step 7: 驗證
echo -e "${BLUE}[7/7]${NC} 驗證部署..."
sleep 2

WORKER_URL="https://etf-backtest-platform.clare8628.workers.dev"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/api/portfolios" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ API 端點正常 (HTTP 200)${NC}"
else
    echo -e "${YELLOW}⚠️  API 回傳 HTTP $HTTP_CODE (可能尚未完全上線，請稍候 1-2 分鐘)${NC}"
fi
echo ""

# 最終總結
echo "═══════════════════════════════════════════════════════════"
echo -e "${GREEN}✅ 部署完成！${NC}"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📊 部署信息："
echo "  版本：v0.2.1"
echo "  Platform：Cloudflare Workers"
echo "  Database：Cloudflare D1"
echo "  Worker URL：$WORKER_URL"
echo ""
echo "📝 功能更新："
echo "  ✅ 起點金額可調（預設 1000）"
echo "  ✅ 圖表線條粗度提升（3px）"
echo "  ✅ 8 色高對比配色"
echo "  ✅ Beta 係數指標"
echo "  ✅ 管理費指標"
echo ""
echo "🔗 下一步："
echo "  1. 打開 $WORKER_URL"
echo "  2. 新增比較組測試功能"
echo "  3. 檢查即時日誌: wrangler tail"
echo ""
echo "📖 文檔："
echo "  - FEATURE-UPDATE-v2.md（功能詳解）"
echo "  - DEPLOYMENT.md（部署概況）"
echo ""
