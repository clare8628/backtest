# 快速部署指南 (5分鐘)

## 📋 前置要求
- [ ] 已修復 workerd 架構問題（執行過 `rm -rf node_modules && npm install`）
- [ ] 已登入 Cloudflare：`wrangler login`
- [ ] 確認 `npm run build` 通過

## 🚀 一鍵部署

### 方法 1: 自動化腳本（推薦）

```bash
cd ~/cowork/develop/backtest

# 執行自動部署腳本
bash DEPLOY.sh
```

**腳本會自動執行：**
1. ✅ 檢查 Cloudflare 登入
2. ✅ 建立 D1 資料庫（如不存在）
3. ✅ 更新 `wrangler.jsonc`
4. ✅ 執行 migration
5. ✅ 構建與部署
6. ✅ 驗證生產環境

### 方法 2: 手動逐步部署

**步驟 1: 建立 D1 資料庫**
```bash
npm run db:create
```

記下輸出的 `database_id`，例如：
```
✓ Database ID: 5b9e9e1a-9e9e-4e1a-9e9e-9e9e9e9e9e9e
```

**步驟 2: 更新 wrangler.jsonc**

編輯 `wrangler.jsonc`，替換 `database_id`：
```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "backtest-portfolios",
    "database_id": "YOUR_DATABASE_ID_HERE"  // ← 貼上上面的 ID
  }
]
```

**步驟 3: 執行 Migration**
```bash
npm run db:migrate
```

預期輸出：
```
✓ Executed 0001_create_portfolios.sql
```

**步驟 4: 部署**
```bash
npm run deploy
```

預期輸出：
```
✓ Uploaded worker successfully
✓ Deployed to https://etf-backtest-platform.clare8628.workers.dev
```

## ✅ 驗證部署

### 檢查 API
```bash
# 應回傳 {"groups":[]}
curl https://etf-backtest-platform.clare8628.workers.dev/api/portfolios
```

### 在瀏覽器測試
1. 打開 https://etf-backtest-platform.clare8628.workers.dev
2. 新增比較組（例如 QQQ, VOO）
3. 執行回測
4. **關閉瀏覽器**，再用另一個瀏覽器打開同網址
5. **驗證**：組合應該還在（因為存在D1）✅

### 查看實時日誌
```bash
wrangler tail
```

## 🔧 故障排除

### 錯誤 1: "You installed workerd on another platform"
```bash
rm -rf node_modules package-lock.json
npm install
```

### 錯誤 2: "D1 binding not found"
確認 `wrangler.jsonc` 的 `database_id` 正確無誤

### 錯誤 3: "Migration failed"
```bash
# 檢查資料庫是否存在
wrangler d1 list

# 查詢表是否建立
wrangler d1 execute backtest-portfolios --command "SELECT name FROM sqlite_master WHERE type='table';"
```

### 錯誤 4: API 超時或 502
- 給 Worker 1-2 分鐘完全上線
- 檢查 `wrangler tail` 中的錯誤
- 檢查 D1 connection 是否正常

## 📊 預期部署結果

```
✅ 部署完成！

Platform: Cloudflare Workers
Database: Cloudflare D1
Worker URL: https://etf-backtest-platform.clare8628.workers.dev

✓ API /api/portfolios 正常
✓ 組合數據持久化到 D1
✓ 跨瀏覽器同步正常
```

## 下一步

- [ ] 定期檢查日誌：`wrangler tail`
- [ ] 定期備份數據：`wrangler d1 execute backtest-portfolios --command "SELECT * FROM portfolios;"`
- [ ] 監控成本：https://dash.cloudflare.com (D1使用量)

## 需要幫助？

查看詳細文檔：
- `DEPLOY-CHECKLIST.md` — 完整檢查清單
- `D1-SETUP.md` — D1詳細配置
- `MIGRATION-REPORT.md` — 技術報告

---

**預計時間**：5 分鐘（自動腳本）或 10 分鐘（手動）
