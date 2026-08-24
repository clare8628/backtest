# D1 資料庫連接失敗 — 根因分析與修復（更新版）

**日期**：2026-08-10  
**狀態**：✅ 已修復（第二輪）

## 🔍 問題演進

### 第一輪錯誤
```typescript
// ❌ globalThis.DB 永遠是 undefined
const db = globalThis.DB || (global as any).DB;
```
API 靜默失敗，回傳 `{"groups":[]}`，無錯誤訊息。

### 第二輪錯誤
改用官方 `getCloudflareContext()` API 後，`wrangler tail` 顯示：
```
(error) ⨯ TypeError: Cannot read properties of undefined (reading 'default')
```

## 🎯 真正根因

在 route 檔案中加了：
```typescript
export const runtime = "edge";
```

這是**錯誤的設定**。OpenNext（`@opennextjs/cloudflare`）已經把整個 Next.js server（包含所有 API routes）打包成**單一 worker**，並在 worker entrypoint 啟動時把 Cloudflare context（含所有 bindings）注入到 global scope。

當某個 route 被額外標記 `runtime = "edge"`，Next.js 會用**不同的編譯/打包路徑**處理它，這會干擾 OpenNext 原本的 context 注入機制，導致 `getCloudflareContext()` 內部依賴的動態 `import("wrangler")` 邏輯被錯誤地打包進最終產物，運行時因為找不到對應模組而拋出：
```
Cannot read properties of undefined (reading 'default')
```

查看套件原始碼確認（`node_modules/@opennextjs/cloudflare/dist/api/cloudflare-context.js` 第 158 行註解）：
> "In production the cloudflare context is initialized by the worker so it is always available."

也就是說，**只要不干擾 OpenNext 的打包流程，production 環境下 context 應該自動可用**，完全不需要手動指定 runtime。

## ✅ 修復

移除誤加的 runtime 宣告：

```diff
export const dynamic = "force-dynamic";
- export const runtime = "edge";

async function getDB() {
  const { env } = await getCloudflareContext({ async: true });
  return env.DB;
}
```

保留 `dynamic = "force-dynamic"` 是合理的——這確保 route 不會被當成靜態頁面處理（D1 查詢必須在每次請求時動態執行）。

## 📚 教訓

在 OpenNext + Cloudflare Workers 架構下：
- ❌ 不要在個別 route 加 `export const runtime = "edge"` — 這是 Vercel Edge Runtime 的慣例，不適用於 OpenNext
- ✅ OpenNext 統一用 Node.js compat 模式打包整個 app 成一個 worker
- ✅ 存取 bindings 一律用 `getCloudflareContext()`，且不需額外的 runtime 宣告
- ✅ 需要動態行為（如資料庫查詢）時用 `export const dynamic = "force-dynamic"` 即可

## 🧪 驗證方式

部署後：

```bash
# 1. 查詢 D1 確認資料存在
wrangler d1 execute backtest-portfolios --remote --command "SELECT * FROM portfolios;"

# 2. 測試 API
curl https://etf-backtest-platform.clare8628.workers.dev/api/portfolios

# 應該回傳實際資料，不再是空陣列，也不再出現 500 錯誤
```

### 即時日誌監控
```bash
wrangler tail
```
若仍有問題，我加的 `console.error` 會印出具體原因：
- `"D1 binding 'DB' not found in Cloudflare env"` → wrangler.jsonc 的 d1_databases 設定有誤
- `"Failed to get Cloudflare context:"` + 錯誤堆疊 → context 注入本身失敗

## ✅ 下一步

在你的 Mac 執行：

```bash
cd ~/cowork/develop/backtest
rm -rf .next .open-next
npm run deploy
```

（建議先清除 `.next`、`.open-next` 快取，確保這次的修改確實生效，而非用到舊的打包產物）

部署完成後驗證：
```bash
curl https://etf-backtest-platform.clare8628.workers.dev/api/portfolios
```

若仍失敗，請把 `wrangler tail` 的完整輸出貼給我。
