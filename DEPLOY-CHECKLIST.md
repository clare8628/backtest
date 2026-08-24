# 部署前檢查清單

## ✅ 代碼準備完成
- [x] TypeScript 編譯通過
- [x] 所有測試通過（22/22）
- [x] D1 migration SQL 檔案已建立
- [x] API 端點實現完成
- [x] localStorage 回退機制就位

## 🚀 部署步驟（在你的機器上執行）

### 前置：Cloudflare 認證
```bash
cd /Users/clare/cowork/develop/backtest
wrangler login
```

### 步驟 1: 建立 D1 資料庫
```bash
npm run db:create
```

**輸出示例**：
```
✓ Database created successfully!
✓ Database ID: 5b9e9e1a-9e9e-4e1a-9e9e-9e9e9e9e9e9e
```

**記下 database_id**（下一步需要）

### 步驟 2: 更新 wrangler.jsonc
編輯 `wrangler.jsonc`，將 `database_id` 替換為上面得到的值：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "backtest-portfolios",
    "database_id": "YOUR_DATABASE_ID_HERE"  // ← 替換此行
  }
]
```

### 步驟 3: 執行 Migration
```bash
npm run db:migrate
```

這會建立 `portfolios` 表。

**預期輸出**：
```
✓ Executed 0001_create_portfolios.sql (X ms)
```

### 步驟 4: 部署至 Cloudflare
```bash
npm run deploy
```

**預期輸出**：
```
✓ Uploaded worker successfully
✓ Deployed to https://etf-backtest-platform.clare8628.workers.dev
```

## 🔍 部署後驗證

### 驗證 API 運作
```bash
# 查看即時日誌
wrangler tail

# 在另一個終端測試 API
curl https://etf-backtest-platform.clare8628.workers.dev/api/portfolios

# 預期回應：
# {"groups":[]}  # 首次為空
```

### 檢查 D1 資料庫
```bash
# 列出資料庫
wrangler d1 list

# 查詢表
wrangler d1 execute backtest-portfolios --command "SELECT COUNT(*) as count FROM portfolios;"
```

### 在瀏覽器測試
1. 打開 https://etf-backtest-platform.clare8628.workers.dev
2. 新增一個比較組（例如 AAPL, MSFT）
3. 在另一個瀏覽器/標籤頁打開同一網址
4. **驗證**：新組合應該自動顯示（跨瀏覽器同步）

## ⚠️ 常見問題

### 問題 1: "DB binding not found"
**原因**：`database_id` 未正確配置  
**解決**：
1. 檢查 `wrangler.jsonc` 中的 `database_id` 是否與實際ID匹配
2. 重新執行 `npm run deploy`

### 問題 2: Migration 失敗
**原因**：資料庫不存在或SQL語法錯誤  
**解決**：
1. 檢查資料庫是否建立：`wrangler d1 list`
2. 如未建立，執行 `npm run db:create`

### 問題 3: API 回傳錯誤
**原因**：D1 查詢失敗  
**解決**：
1. 查看日誌：`wrangler tail`
2. 手動驗證SQL：`wrangler d1 execute backtest-portfolios --command "SELECT * FROM portfolios;"`

### 問題 4: 組合未同步
**原因**：API 失敗時回退到 localStorage  
**解決**：
1. 打開 DevTools Console，檢查錯誤訊息
2. 檢查 `/api/portfolios` 是否正常
3. 檢查 D1 binding 是否啟用

## 📋 備忘錄

- [ ] 記下 D1 database_id
- [ ] 更新 wrangler.jsonc
- [ ] 執行 migration
- [ ] 部署
- [ ] 驗證 API
- [ ] 在瀏覽器測試跨裝置同步

## 需要幫助？

查看完整文檔：
- **D1-SETUP.md** - 詳細設置指南
- **MIGRATION-REPORT.md** - 遷移技術報告
- **DEPLOYMENT.md** - 平台部署概況

---

**預計時間**：5-10 分鐘  
**難度**：⭐⭐☆☆☆ 簡單（複製貼上database_id即可）
