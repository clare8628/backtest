# 本地構建修復指南

## 問題

在沙箱環境中遇到以下錯誤：
- ❌ "Cannot find native binding" (vitest + rolldown)
- ❌ "getaddrinfo EAI_AGAIN" (網絡限制)
- ❌ FUSE mount 限制無法刪除文件

## 解決方案

**所有部署步驟必須在你的 Mac 本地執行，而非沙箱。**

---

## 🔧 本地修復步驟 (在你的 Mac 上執行)

### 1️⃣ 修復 node_modules (1分鐘)

```bash
cd ~/cowork/develop/backtest

# 完全清除
rm -rf node_modules package-lock.json .next .open-next

# 重新安裝（確保 ARM64 workerd）
npm install
```

### 2️⃣ 驗證構建 (2分鐘)

```bash
# TypeScript 檢查
npx tsc --noEmit

# 應無輸出或無錯誤
```

### 3️⃣ 本地開發驗證 (可選)

```bash
# 啟動開發伺服器
npm run dev

# 打開 http://localhost:3000
# 測試組合新增 & 回測功能
```

### 4️⃣ 部署 (5分鐘)

按照 `QUICK-DEPLOY.md` 執行：

```bash
# 方法 A: 自動化
bash DEPLOY.sh

# 方法 B: 手動逐步
npm run db:create
# ... 編輯 wrangler.jsonc ...
npm run db:migrate
npm run deploy
```

---

## ✅ 預期結果

執行完本地步驟後：

```bash
# 構建成功
✓ TypeScript 無錯誤
✓ Next.js 編譯完成

# 部署成功
✓ D1 資料庫建立
✓ Migration 執行完成
✓ Worker 上線
✓ API 正常回應
```

---

## 🚨 常見錯誤

### 錯誤 1: "workerd on another platform"
```bash
# 完全清除
rm -rf node_modules package-lock.json

# 重新安裝
npm install

# 驗證
npm ls @cloudflare/workerd-darwin-arm64
# 應列出版本
```

### 錯誤 2: "Cannot find native binding"
這是沙箱問題，**忽略**。在本地機器上執行 `npm install` 會自動解決。

### 錯誤 3: "getaddrinfo EAI_AGAIN"
沙箱網絡限制，**無需修復**。本地網絡正常。

---

## 📝 最終部署清單

在你的 Mac 上執行：

```bash
cd ~/cowork/develop/backtest

# 1. 清除舊 node_modules
rm -rf node_modules package-lock.json .next .open-next

# 2. 重新安裝依賴
npm install

# 3. 驗證構建
npx tsc --noEmit
echo "✅ TypeScript 檢查通過"

# 4. 部署
bash DEPLOY.sh

# 5. 驗證 API
curl https://etf-backtest-platform.clare8628.workers.dev/api/portfolios
# 預期: {"groups":[]}
```

---

## ⏱️ 預計時間

| 步驟 | 時間 |
|------|------|
| 清除 + 重新安裝 | 3-5 分鐘 |
| 驗證構建 | 1 分鐘 |
| D1 建立 + Migration | 2 分鐘 |
| 部署 | 2-3 分鐘 |
| **總計** | **8-11 分鐘** |

---

## ✨ 完成

部署完成後，打開：
```
https://etf-backtest-platform.clare8628.workers.dev
```

組合將自動保存到 D1，跨瀏覽器同步！

---

**重點**：所有命令都應在 **你的 Mac 本地** 執行，不是沙箱。
