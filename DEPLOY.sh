#!/bin/bash
# 完整部署腳本 - Backtest Platform to Cloudflare Workers + D1

set -e  # 任何錯誤即停止

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "═══════════════════════════════════════════════════════════"
echo "  🚀 Backtest Platform 部署到 Cloudflare Workers + D1"
echo "═══════════════════════════════════════════════════════════"
echo ""

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Step 1: 檢查前置條件
echo -e "${BLUE}[1/6]${NC} 檢查前置條件..."
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ wrangler 未安裝${NC}"
    echo "執行: npm install -g wrangler"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js 未安裝${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 依賴檢查通過${NC}"
echo ""

# Step 2: 驗證 Cloudflare 登入
echo -e "${BLUE}[2/6]${NC} 驗證 Cloudflare 認證..."
if wrangler whoami &> /dev/null; then
    ACCOUNT_EMAIL=$(wrangler whoami 2>/dev/null | grep -o '[^ ]*@[^ ]*' | head -1)
    echo -e "${GREEN}✓ 已登入: $ACCOUNT_EMAIL${NC}"
else
    echo -e "${YELLOW}⚠️  未登入 Cloudflare，正在打開登入頁面...${NC}"
    wrangler login
fi
echo ""

# Step 3: 建立/驗證 D1 資料庫
echo -e "${BLUE}[3/6]${NC} 檢查 D1 資料庫..."
DB_ID=$(grep -o '"database_id": "[^"]*"' wrangler.jsonc | cut -d'"' -f4)

if [ -z "$DB_ID" ] || [ "$DB_ID" = "5b9e9e1a-9e9e-4e1a-9e9e-9e9e9e9e9e9e" ]; then
    echo -e "${YELLOW}⚠️  需要建立新的 D1 資料庫...${NC}"

    # 建立資料庫
    echo "執行: wrangler d1 create backtest-portfolios"
    DB_OUTPUT=$(wrangler d1 create backtest-portfolios 2>&1)

    # 提取 database_id
    NEW_DB_ID=$(echo "$DB_OUTPUT" | grep -oP '(?<=id = ")[^"]*' | head -1)

    if [ -z "$NEW_DB_ID" ]; then
        echo -e "${RED}❌ 建立資料庫失敗${NC}"
        echo "$DB_OUTPUT"
        exit 1
    fi

    echo -e "${GREEN}✓ 資料庫建立成功${NC}"
    echo -e "  Database ID: ${BLUE}$NEW_DB_ID${NC}"

    # 更新 wrangler.jsonc
    echo -e "${YELLOW}⚠️  更新 wrangler.jsonc...${NC}"
    sed -i '' "s/\"database_id\": \"[^\"]*\"/\"database_id\": \"$NEW_DB_ID\"/" wrangler.jsonc
    echo -e "${GREEN}✓ 已更新 wrangler.jsonc${NC}"
    DB_ID=$NEW_DB_ID
else
    echo -e "${GREEN}✓ 使用既有資料庫 ID: $DB_ID${NC}"
fi
echo ""

# Step 4: 執行 Migration
echo -e "${BLUE}[4/6]${NC} 執行資料庫 Migration..."
echo "執行: wrangler d1 execute backtest-portfolios --file ./migrations/0001_create_portfolios.sql"

if wrangler d1 execute backtest-portfolios --file ./migrations/0001_create_portfolios.sql; then
    echo -e "${GREEN}✓ Migration 執行成功${NC}"
else
    echo -e "${YELLOW}⚠️  Migration 可能已執行或出錯，繼續部署...${NC}"
fi
echo ""

# Step 5: 構建與部署
echo -e "${BLUE}[5/6]${NC} 構建與部署到 Cloudflare Workers..."
echo "執行: npm run deploy"
echo ""

if npm run deploy; then
    DEPLOY_URL=$(npm run deploy 2>&1 | grep -o 'https://[^ ]*workers.dev' | head -1)
    echo -e "${GREEN}✓ 部署成功${NC}"
    if [ -n "$DEPLOY_URL" ]; then
        echo -e "  URL: ${BLUE}$DEPLOY_URL${NC}"
    fi
else
    echo -e "${RED}❌ 部署失敗${NC}"
    exit 1
fi
echo ""

# Step 6: 驗證部署
echo -e "${BLUE}[6/6]${NC} 驗證部署..."
sleep 2

# 取得 Worker URL
WORKER_URL="https://etf-backtest-platform.clare8628.workers.dev"

echo "測試 API 端點: $WORKER_URL/api/portfolios"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/api/portfolios")

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ API 端點正常 (HTTP $HTTP_CODE)${NC}"

    # 測試回傳內容
    RESPONSE=$(curl -s "$WORKER_URL/api/portfolios")
    echo -e "  回應: ${BLUE}$RESPONSE${NC}"
else
    echo -e "${YELLOW}⚠️  API 端點回傳 HTTP $HTTP_CODE (可能尚未完全上線，請稍候 1-2 分鐘)${NC}"
fi
echo ""

# 最終總結
echo "═══════════════════════════════════════════════════════════"
echo -e "${GREEN}✅ 部署完成！${NC}"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📊 部署信息："
echo "  Platform: Cloudflare Workers"
echo "  Database: Cloudflare D1"
echo "  Database ID: $DB_ID"
echo "  Worker URL: $WORKER_URL"
echo ""
echo "🔗 下一步："
echo "  1. 打開 $WORKER_URL"
echo "  2. 新增比較組並驗證功能"
echo "  3. 檢查即時日誌: wrangler tail"
echo ""
echo "📝 查看部署文檔："
echo "  - D1-SETUP.md"
echo "  - DEPLOYMENT.md"
echo "  - MIGRATION-REPORT.md"
echo ""
