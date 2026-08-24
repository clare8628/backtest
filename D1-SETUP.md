# Cloudflare D1 設置指南

## 概述
backtest平台已從 `localStorage` 遷移到 **Cloudflare D1（SQLite）**，實現跨瀏覽器/裝置的組合數據同步。

## 架構
```
Frontend (page.tsx)
    ↓
/api/portfolios (API Route)
    ↓
Cloudflare D1 (SQLite)
```

## 本地開發

### 開發時無需設置 D1
本地開發會自動回退到 `localStorage`：
```bash
npm run dev
```

前端會嘗試調用 `/api/portfolios` API，失敗後自動使用 `localStorage`。

## 生產部署

### 步驟 1: 建立 D1 資料庫
```bash
wrangler login  # 如未登入
npm run db:create
```

輸出示例：
```
✓ Database created successfully!
✓ Database ID: 5b9e9e1a-9e9e-4e1a-9e9e-9e9e9e9e9e9e
```

### 步驟 2: 更新 wrangler.jsonc
將輸出的 `database_id` 複製到 `wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "backtest-portfolios",
    "database_id": "5b9e9e1a-9e9e-4e1a-9e9e-9e9e9e9e9e9e"  // ← 替換這個
  }
]
```

### 步驟 3: 執行 Migration
```bash
npm run db:migrate
```

此命令會執行 `migrations/0001_create_portfolios.sql`，建立以下表：
```sql
CREATE TABLE portfolios (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  symbols TEXT NOT NULL,         -- JSON array 儲存
  rangeYears INTEGER DEFAULT 5,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
```

### 步驟 4: 部署
```bash
npm run deploy
```

部署時會自動：
1. 編譯 Next.js
2. 構建 OpenNext worker
3. 綁定 D1 環境變數
4. 上傳至 Cloudflare Workers

## API 端點

### GET /api/portfolios
取得所有已保存的比較組

**回應**：
```json
{
  "groups": [
    {
      "id": "grp_123_abc",
      "title": "Tech Stocks",
      "symbols": ["AAPL", "MSFT"],
      "rangeYears": 5,
      "createdAt": "2026-08-10T12:00:00Z"
    }
  ]
}
```

### POST /api/portfolios
新增或更新比較組

**請求**：
```json
{
  "id": "grp_123_abc",
  "title": "Tech Stocks",
  "symbols": ["AAPL", "MSFT"],
  "rangeYears": 5,
  "createdAt": "2026-08-10T12:00:00Z"
}
```

### DELETE /api/portfolios?id=grp_123_abc
刪除指定比較組

## 故障排除

### D1 未綁定
```
error: D1 binding not found
```

**解決**：確認 `wrangler.jsonc` 的 `d1_databases` 配置正確，且 `database_id` 匹配。

### Migration 失敗
```
error: Failed to execute SQL migration
```

**解決**：
1. 確認資料庫已建立：`wrangler d1 list`
2. 手動檢查SQL：`cat migrations/0001_create_portfolios.sql`

### 組合數據未同步
1. 檢查瀏覽器Console是否有API錯誤
2. 檢查 Cloudflare Workers 日誌：`wrangler tail`
3. 確認D1 binding 正常：嘗試通過 CLI 查詢
```bash
wrangler d1 execute backtest-portfolios --command "SELECT * FROM portfolios;"
```

## 備份與遷移

### 備份資料
```bash
wrangler d1 execute backtest-portfolios --command "SELECT * FROM portfolios;" > portfolios-backup.json
```

### 從 localStorage 遷移
若想將舊版本的 localStorage 數據遷移到 D1：

1. 在舊版本瀏覽器中，開啟DevTools Console：
```javascript
JSON.parse(localStorage.getItem('etf-backtest-groups-v1'))
```

2. 複製JSON，在新版本逐個新增到D1（通過UI）

## 監控

### 查看 D1 統計
```bash
wrangler d1 insights backtest-portfolios
```

### 實時日誌
```bash
wrangler tail --format pretty
```

過濾 portfolios API 日誌：
```bash
wrangler tail | grep portfolios
```

## 成本考量
- **D1 儲存**：100GB 免費額度
- **讀寫操作**：免費額度內 1M+/天
- 對於小型個人項目無成本

## 下一步
- [ ] 設置 GitHub Actions CI/CD 自動部署
- [ ] 新增用戶認證（Cloudflare Access）
- [ ] 實現數據匯出/匯入功能
- [ ] 定期備份到外部存儲
