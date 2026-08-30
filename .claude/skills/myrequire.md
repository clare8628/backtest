---
name: myrequire
description: 自動部署至 Cloudflare、自動允許代碼修改
---

# 我的開發需求

## 1. 自動部署至 Cloudflare

配置已啟用（`.agents/rules/mydeploy.md` 設置 `trigger: always_on`）

**部署流程：**
1. git commit 觸發自動部署
2. 執行 `npm run deploy`（等同 `opennextjs-cloudflare build && opennextjs-cloudflare deploy`，這個專案是透過 OpenNext 部署，不能直接跑 `wrangler deploy`）
3. 部署至：https://etf-backtest-platform.clare8628.workers.dev

## 2. 自動允許代碼修改

在 `.claude/settings.json` 中配置權限：

```json
{
  "permissions": {
    "allow": [
      "Edit",
      "Write",
      "Bash(npm run lint)",
      "Bash(npm run build)",
      "Bash(git *)",
      ...其他權限
    ]
  }
}
```

**效果：**
- ✅ 自動允許文件編輯（Edit）
- ✅ 自動允許文件寫入（Write）
- ✅ 自動允許所有 git 操作（commit、push）
- ✅ 無需等待權限提示

## 工作流

| 步驟 | 動作 | 自動化 |
|------|------|--------|
| 1 | 代碼修改 | ✅ 自動允許（Edit/Write） |
| 2 | git commit | ✅ 自動允許（Bash git） |
| 3 | npm run build | ✅ 自動允許 |
| 4 | 部署至 Cloudflare | ✅ 自動觸發（mydeploy） |
| 5 | 驗證生產環境 | 手動檢查 |

## 相關文件

- `.claude/settings.json` — 權限配置
- `.agents/rules/mydeploy.md` — 部署規則
- `wrangler.jsonc` — Cloudflare Workers 配置
