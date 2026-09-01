# PROGRESS

- [x] 架構：Next.js 16 (App Router, TS) 前後端一體
- [x] 資料源：Yahoo Finance chart API（主）+ Stooq CSV（備援），修復 Stooq 反爬蟲導致抓取失敗問題
- [x] 回測引擎：報酬/波動度/回撤/夏普比率
- [x] AI推薦：規則式多指標加權評分排名
- [x] UI：搜尋加入、多組儲存(localStorage)、命名、雙語(zh/en)、RWD、日系配色
- [x] API: POST /api/backtest
- [x] 已儲存比較組可編輯標的（新增/刪除，即時重跑）
- [x] 回測期間改為拖拉滑桿（新建與已儲存皆適用，debounce 自動重跑）
- [x] 績效走勢圖（純 SVG 折線圖，指數化至100，無額外套件依賴）
- [x] 單元測試：18/18 通過 (vitest)
- [x] TypeScript typecheck 通過
- [x] Next build 編譯/typecheck/靜態頁生成成功（sandbox fuse mount 清理階段有 EPERM，非程式問題，雲端部署不受影響）
- [x] 雲端部署：Cloudflare Workers (OpenNext adapter)，已驗證 Endpoint
  - URL: https://etf-backtest-platform.clare8628.workers.dev
- [x] 數據持久化：遷移 localStorage → Cloudflare D1 (SQLite)
  - 新增 /api/portfolios CRUD API
  - storage.ts 改為 async 操作，自動回退 localStorage
  - 支持跨瀏覽器/裝置同步比較組

已知限制：非美股代號可能需加市場後綴(如 .tw)；AI推薦為規則式評分，非LLM生成。

修復紀錄 (2026-08-10)：
- QQQ 等標的回測失敗：Stooq 反爬蟲限制 → 改主要用 Yahoo Finance chart API
- 組合數據丟失：localStorage 只能單瀏覽器保存 → 遷移至 Cloudflare D1
- API 路由類型檢查失敗：Next.js RouteHandler 簽名不匹配 → 修復為標準 GET/POST/DELETE
- 部署準備：生成完整部署文檔與自動化腳本，待本地執行部署

更新 (2026-09-01)：
- 台股代號全面加註基金名稱並去除交易所後綴（表格/圖例/tooltip/標籤/排名/組名/Beta 基準），如 00687B(國泰20年美債)；查無名稱者保留完整代號
- 基金規模：同組含美股+台股時一律換算 USD（採快照日匯率），單一市場維持原幣別；取不到匯率則保留原幣別不推測
- 補齊 22 檔股票型 ETF 的淨資產快照（原僅債券 ETF 有值）；00687B、00790B 來源無資料仍顯示「—」
- 測試 77/77 通過、typecheck/build 通過、已部署
