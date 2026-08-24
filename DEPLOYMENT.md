# Backtest平台部署指南

## 當前部署狀態
✅ **已部署到 Cloudflare Workers**
- URL: https://etf-backtest-platform.clare8628.workers.dev
- 部署日期：2026-08-10
- 狀態：正常運作

## 技術棧
- **框架**：Next.js 16 + App Router + TypeScript
- **部署平台**：Cloudflare Workers
- **適配器**：OpenNextJS (@opennextjs/cloudflare)
- **前端**：React 19 + Tailwind CSS 4
- **測試**：Vitest (18/18 通過)

## 部署步驟 (本地/CI/CD)

### 前置條件
1. 安裝dependencies：
```bash
npm install
```

2. 設定Cloudflare認證（如未認證）：
```bash
npx wrangler login
```

### 部署命令

**開發預覽**：
```bash
npm run preview
```

**生產部署**：
```bash
npm run deploy
```

此命令會：
1. 編譯Next.js應用 (`next build`)
2. 使用OpenNextJS轉換為Cloudflare Workers格式
3. 上傳至Cloudflare Workers平台

### 無需登入部署
```bash
npx wrangler deploy --temporary
```

## 專案結構
```
backtest/
├── app/              # Next.js App Router
│   ├── page.tsx      # 主頁面（搜尋、組合管理）
│   └── api/
│       └── backtest/ # POST /api/backtest 回測API
├── components/       # React元件
├── lib/              # 工具函數、回測引擎、資料抓取
├── public/           # 靜態資源
├── tests/            # 單元測試
├── wrangler.jsonc    # Cloudflare Workers配置
└── package.json
```

## API端點

**POST** `/api/backtest`
- 參數：symbols (股票代碼陣列)、rangeYears
- 回傳：績效指標（報酬、波動度、回撤、夏普比率）+ 日線數據

**GET** `/api/portfolios`
- 回傳：所有已保存的比較組（從D1資料庫讀取）

**POST** `/api/portfolios`
- 參數：id, title, symbols, rangeYears, createdAt
- 新增或更新比較組到D1

**DELETE** `/api/portfolios?id=xxx`
- 刪除指定比較組

## 已知限制
- 非美股需加市場後綴（如 `.tw` for台股）
- Stooq API對資料中心IP有反爬蟲限制，已改用Yahoo Finance為主、Stooq為備援
- AI推薦為規則式評分（非LLM）

## 故障排除

### 構建失敗 (FUSE錯誤)
本地沙箱環境會出現FUSE mount錯誤，但不影響雲端部署。

解決方案：在雲端平台（GitHub Actions/Cloudflare Pages等）部署，無此問題。

### 回測無數據
確保股票代號正確：
- 美股：直接使用代碼 (QQQ, VOO, AAPL)
- 台股：加 `.tw` 後綴 (2330.tw)
- 其他市場：查詢正確後綴

### 部署驗證
```bash
# 檢查部署狀況
npx wrangler deployments list

# 查看最近部署日誌
npx wrangler tail
```

## D1 資料庫設置

### 本地開發
無需額外設置，API會回退到 localStorage。

### 生產部署
1. 建立 D1 資料庫：
```bash
npm run db:create
```

2. 運行 migration：
```bash
npm run db:migrate
```

3. 更新 `wrangler.jsonc` 的 `database_id`（上面命令輸出會提供）

4. 部署時會自動綁定 DB 環境變數：
```bash
npm run deploy
```

## 環境變數
D1 binding 已在 `wrangler.jsonc` 配置，會自動注入為 `DB` 環境變數。

## 下一步優化
- [ ] 設定CD管道（GitHub Actions自動部署）
- [ ] 實裝LLM型AI推薦（替代規則式評分）
- [ ] 效能監控（Cloudflare Analytics Engine）
- [ ] 用戶認證（Cloudflare Access）
