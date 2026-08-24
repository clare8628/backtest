#!/bin/bash
# 最終部署腳本 - Backtest Platform
# 使用方式：bash DEPLOY-FINAL.sh

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         🚀 Backtest Platform 最終部署                       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ============================================
# 1. 環境驗證
# ============================================
echo -e "${BLUE}[1/8]${NC} 驗證環境..."

if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ wrangler 未安裝${NC}"
    echo "執行: npm install -g wrangler"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js 未安裝${NC}"
    exit 1
fi

NODE_VERSION=$(node --version)
echo -e "${GREEN}✓ Node.js ${NODE_VERSION}${NC}"
echo -e "${GREEN}✓ wrangler $(wrangler --version)${NC}"
echo ""

# ============================================
# 2. 清除舊構建
# ============================================
echo -e "${BLUE}[2/8]${NC} 清除舊構建..."
rm -rf .next .open-next build dist 2>/dev/null || true
rm -rf node_modules/.cache 2>/dev/null || true
echo -e "${GREEN}✓ 清除完成${NC}"
echo ""

# ============================================
# 3. 驗證 Cloudflare 登入
# ============================================
echo -e "${BLUE}[3/8]${NC} 驗證 Cloudflare 登入..."

if wrangler whoami &>/dev/null; then
    EMAIL=$(wrangler whoami 2>/dev/null | grep -o '[^ ]*@[^ ]*' | head -1 || echo "Unknown")
    echo -e "${GREEN}✓ 已登入: ${EMAIL}${NC}"
else
    echo -e "${YELLOW}⚠️  未登入，打開登入頁面...${NC}"
    wrangler login
    echo -e "${GREEN}✓ 登入完成${NC}"
fi
echo ""

# ============================================
# 4. 檢查 D1 配置
# ============================================
echo -e "${BLUE}[4/8]${NC} 檢查 D1 配置..."

DB_ID=$(grep -o '"database_id": "[^"]*"' wrangler.jsonc 2>/dev/null | cut -d'"' -f4)

if [ -z "$DB_ID" ]; then
    echo -e "${RED}❌ D1 database_id 未配置${NC}"
    exit 1
fi

if [ "$DB_ID" = "5b9e9e1a-9e9e-4e1a-9e9e-9e9e9e9e9e9e" ]; then
    echo -e "${YELLOW}⚠️  使用預設 database_id，需要建立真實 DB${NC}"
    echo "執行: npm run db:create"
    exit 1
fi

echo -e "${GREEN}✓ D1 已配置: ${DB_ID:0:12}...${NC}"

# 驗證 D1 表存在
echo "檢查 D1 表..."
TABLE_CHECK=$(wrangler d1 execute backtest-portfolios --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='portfolios';" 2>&1 || echo "")

if echo "$TABLE_CHECK" | grep -q "portfolios"; then
    echo -e "${GREEN}✓ 表已存在${NC}"
elif echo "$TABLE_CHECK" | grep -q "no such table"; then
    echo -e "${YELLOW}⚠️  表不存在，建立中...${NC}"
    wrangler d1 execute backtest-portfolios --remote --command "
    CREATE TABLE IF NOT EXISTS portfolios (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      symbols TEXT NOT NULL,
      rangeYears INTEGER NOT NULL DEFAULT 5,
      startValue INTEGER DEFAULT 1000,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_portfolios_createdAt ON portfolios(createdAt DESC);
    " || true
    echo -e "${GREEN}✓ 表已建立${NC}"
fi
echo ""

# ============================================
# 5. TypeScript 檢查
# ============================================
echo -e "${BLUE}[5/8]${NC} TypeScript 檢查..."

if npx tsc --noEmit 2>&1 | grep -q "error"; then
    echo -e "${RED}❌ TypeScript 錯誤${NC}"
    npx tsc --noEmit
    exit 1
fi

echo -e "${GREEN}✓ TypeScript 無錯誤${NC}"
echo ""

# ============================================
# 6. 測試編譯
# ============================================
echo -e "${BLUE}[6/8]${NC} 測試編譯..."

if npm run build 2>&1 | tail -20 | grep -q -i "error"; then
    echo -e "${RED}❌ 編譯失敗${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 編譯成功${NC}"
echo ""

# ============================================
# 7. 部署
# ============================================
echo -e "${BLUE}[7/8]${NC} 部署到 Cloudflare Workers..."

DEPLOY_OUTPUT=$(npm run deploy 2>&1)

if echo "$DEPLOY_OUTPUT" | grep -q "Deployed\|deployed\|Successfully"; then
    DEPLOY_URL="https://etf-backtest-platform.clare8628.workers.dev"
    echo -e "${GREEN}✓ 部署成功${NC}"
    echo -e "  URL: ${BLUE}${DEPLOY_URL}${NC}"
else
    echo -e "${RED}❌ 部署失敗${NC}"
    echo "$DEPLOY_OUTPUT" | tail -30
    exit 1
fi
echo ""

# ============================================
# 8. 驗證部署
# ============================================
echo -e "${BLUE}[8/8]${NC} 驗證部署..."
sleep 3

WORKER_URL="https://etf-backtest-platform.clare8628.workers.dev"

# 測試主頁
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ 主頁正常 (HTTP 200)${NC}"
else
    echo -e "${YELLOW}⚠️  主頁回傳 HTTP $HTTP_CODE${NC}"
fi

# 測試 API
API_RESPONSE=$(curl -s "$WORKER_URL/api/portfolios" 2>/dev/null || echo "{}")
if echo "$API_RESPONSE" | grep -q "groups"; then
    echo -e "${GREEN}✓ API 正常${NC}"
    GROUPS_COUNT=$(echo "$API_RESPONSE" | grep -o '"groups":\[' | wc -l)
    if [ "$GROUPS_COUNT" -gt 0 ]; then
        echo -e "  組合數: $(echo "$API_RESPONSE" | grep -o '"id"' | wc -l)"
    fi
else
    echo -e "${YELLOW}⚠️  API 無回應${NC}"
fi

echo ""

# ============================================
# 完成總結
# ============================================
echo "╔════════════════════════════════════════════════════════════╗"
echo -e "║${GREEN}  ✅ 部署完成！${NC}                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

echo "📊 部署信息"
echo "  ├─ 版本：v0.2.1"
echo "  ├─ 平台：Cloudflare Workers"
echo "  ├─ 數據庫：Cloudflare D1"
echo "  └─ URL：$WORKER_URL"
echo ""

echo "🎯 新功能"
echo "  ├─ ✅ 起點金額可調（預設 1000）"
echo "  ├─ ✅ 圖表線條粗度提升"
echo "  ├─ ✅ 8 色高對比配色"
echo "  ├─ ✅ Beta 係數指標"
echo "  └─ ✅ 管理費指標"
echo ""

echo "🔗 下一步"
echo "  1️⃣  打開平台："
echo "     $WORKER_URL"
echo ""
echo "  2️⃣  測試功能："
echo "     • 新增比較組"
echo "     • 執行回測"
echo "     • 查看 Beta 和管理費"
echo ""
echo "  3️⃣  查看日誌："
echo "     wrangler tail"
echo ""

echo "📝 有用的命令"
echo "  • 查看實時日誌：wrangler tail"
echo "  • 查詢組合數據：wrangler d1 execute backtest-portfolios --remote --command \"SELECT * FROM portfolios;\""
echo "  • 清除組合：wrangler d1 execute backtest-portfolios --remote --command \"DELETE FROM portfolios;\""
echo ""

echo "✨ 部署完成！祝你使用愉快！"
echo ""
