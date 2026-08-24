#!/bin/bash
# 驗證部署狀態

WORKER_URL="https://etf-backtest-platform.clare8628.workers.dev"

echo "🔍 驗證 Backtest 部署狀態..."
echo ""

# 檢查 API
echo "1️⃣  測試 API 端點..."
API_RESPONSE=$(curl -s "$WORKER_URL/api/portfolios" 2>&1)
API_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/api/portfolios")

if [ "$API_CODE" = "200" ]; then
    echo "   ✅ API 正常 (HTTP 200)"
    echo "   回應: $API_RESPONSE"
else
    echo "   ❌ API 異常 (HTTP $API_CODE)"
    echo "   回應: $API_RESPONSE"
fi
echo ""

# 檢查 Worker 狀態
echo "2️⃣  查看 Worker 即時日誌..."
echo "   執行: wrangler tail"
echo ""

# 檢查 D1 資料庫
echo "3️⃣  檢查 D1 資料庫..."
echo "   執行: wrangler d1 execute backtest-portfolios --command \"SELECT COUNT(*) as count FROM portfolios;\""
echo ""

echo "4️⃣  在瀏覽器測試..."
echo "   打開: $WORKER_URL"
echo "   • 新增比較組 (例如: QQQ, VOO, SPY)"
echo "   • 執行回測"
echo "   • 關閉瀏覽器，重新打開，確認組合還在"
echo ""

echo "✅ 驗證完成！"
