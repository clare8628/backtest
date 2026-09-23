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

更新 (2026-09-03)：
- 視覺改版：design3.md（Letters 藍色漸層）→ design.md（Equals 編輯風）
- Token 更名：matsu/shu/washi → orchid/amber/surface；亮色品牌值另備 ink 變體供文字使用（AA 4.5:1+）
- 版面：暖白畫布 #FAF9F5、襯線大標題（黑字claim+灰字elaboration）、mono 編號 eyebrow、hero 邊緣漸層方塊、白卡片細線框、AI 排名改細線分隔列、結尾淡紫 band 併入 footer
- typecheck 通過、lint 無新增問題
- 環境修復：node_modules 原為 darwin-x64（本機 arm64），改由 npm cache 離線補裝 lightningcss-darwin-arm64@1.32.0（未寫入 package.json/lock）
- build 通過、dev 實機確認、已部署 https://etf-backtest-platform.clare8628.workers.dev（Version d0ef0d66）

更新 (2026-09-03b)：
- 已儲存的比較組改為 gallery grid：每組一張卡（auto-fill minmax 280px），縮圖 = 指數化 sparkline（新增 components/Sparkline.tsx，色盤沿用 PerformanceChart 的 SERIES_COLORS）
- 卡面只留標題／標的／縮圖／領先者一行；展開後該卡 grid-column 1/-1 佔滿整列，才顯示編輯、區間控制、走勢圖、指標表、AI 排名
- 一次只展開一張；按「執行回測」會自動展開該組
- typecheck/lint 通過、本機實測 3 組、已部署 Version cab39c52
- 注意：next dev 下無 D1 binding，/api/portfolios GET 回空陣列且 POST 假成功，storage.ts 因此不會落到 localStorage → 本機重整比較組會消失（既有行為，非本次改動）

更新 (2026-09-03c)：
- vitest 修復：registry 恢復後以 tarball 解壓補入 @rolldown/binding-darwin-arm64@1.2.3（不動 package.json/lock，避免 npm install 剪掉同樣手動補的 lightningcss-darwin-arm64）→ 測試 77/77 通過
- 重新部署 Version a05b0a03（內容同 cab39c52，本次僅補測試與文件）；home/api 皆 200

更新 (2026-09-06)：
- 目錄新增：美股高護城河股 11 檔（V/MA/AXP/KO/PEP/COST/WMT/MCD/PG/UNH/JNJ）；黃金 ETF 14 檔（實體 GLD/IAU/GLDM/SGOL/IAUM/BAR/AAAU/OUNZ、礦業 GDX/GDXJ/RING/SGDM、台股期信 00635U.TW/00708L.TW），分類 Gold ETF / Gold Miner ETF
- 搜尋排序：新增「代號完全相符」為最高階，短代號（V、MA）不再被 VOO/VTI… 前綴同分擠出 8 筆上限
- 自動回測年數：每組首次回測時 rangeYears 自動吸附到「最短標的可回測年數」無條件進位（18.43→19），後端再夾回實際資料；手動拉桿即永久 opt-out。新增 ComparisonGroup.rangeFitted（D1 欄位）
- rangeFitted 欄位由 route.ts 首次請求時 lazy ALTER TABLE 自動補上（吞 duplicate column name），migrations/0003 僅供全新 DB
- typecheck、77/77 測試通過；已部署 Version dbd36f11；prod D1 已確認 rangeFitted 欄位存在

更新 (2026-09-06b)：
- 比較組標的上限放寬：由 10 檔放寬至 15 檔（route.ts 與 page.tsx 一致），美股高護城河股（11 檔）與 QQQ 可完整同組回測
- 編輯標的介面優化：在已儲存群組的「編輯標的」輸入框旁增加實體「加入」按鈕，除 Enter 外亦可直接點擊加入
- 上限防呆提示：新增滿額提示字串（maxSymbolsReached，中/英雙語），達 15 檔上限時即時阻擋並提示
- 新建比較組自動展開：saveDraftAsGroup 儲存後自動展開新建立的群組卡片，立即呈現資產矩陣與圖表
- 增強前端與 API 錯誤防禦：回測失敗時回傳完整安全結構，前端避免 TypeError 崩潰
- 測試 77/77 通過、TypeScript 檢查通過、已部署 Version a0a384cc（https://etf-backtest-platform.clare8628.workers.dev）

更新 (2026-09-07)：
- 標的庫擴充：全面納入台灣市場所有主流高股息 ETF（共 23 檔，含使用者指定之 00713 元大台灣高息低波）
  - 新增 19 檔：00713.TW（元大台灣高息低波）、00915.TW（凱基優選高股息30）、00918.TW（大華優利高填息30）、00939.TW（統一台灣高息動能）、00940.TW（元大台灣價值高息）、00934.TW（中信成長高股息）、00936.TW（台新臺灣AI優息動能）、00944.TW（野村趨勢動能高股息）、00946.TW（群益科技高息成長）、00900.TW（富邦特選高股息30）、00701.TW（國泰股利精選30）、00730.TW（富邦臺灣優質高息）、00731.TW（復華富時高息低波）、00907.TW（永豐優息存股）、00930.TW（永豐ESG低碳高息）、00932.TW（兆豐永續高息等權）、00943.TW（兆豐電子高息等權）、00961.TW（FT臺灣永續高息）、00927.TW（群益半導體收益）
  - 既有 4 檔：0056.TW（元大高股息）、00878.TW（國泰永續高股息）、00919.TW（群益台灣精選高息）、00929.TW（復華台灣科技優息）
  - 搜尋優化：支援輸入 5 碼純數字（如 `00713`）或後綴代號（如 `00713.TW`）自動快速匹配
- 測試與建置：單元測試 77/77 全數通過、TypeScript 型別檢查無錯誤
- 雲端部署：依據全域部署規範自動發布至 Cloudflare Workers（Version ID: `300a86e1-17c7-4c66-b13e-df99b69a32de`，端點健康檢查 HTTP 200）

更新 (2026-09-07b)：
- 資產矩陣字體放大：依需求將比較組展開後的資產矩陣表格（`MetricsTable`）內文文字與行高再等比例放大 1.1 倍（累計 1.331 倍，即 1.1 × 1.1 × 1.1）
  - 基礎內文（表頭指標名、代號、數值）：由 16.94px 提升至 18.63px（`calc(0.875rem * 1.331)`）
  - 次級標籤（指標名稱 row label、標的中文名稱、分組標題）：由 14.52px 提升至 15.97px（`calc(0.75rem * 1.331)` / `calc(12px * 1.331)`）
- 雲端部署：已自動發布至 Cloudflare Workers（Version ID: `55bf272f-bbe1-4073-8a1c-0777e68af02f`，HTTP 200）

更新 (2026-09-07c)：
- 資產矩陣指標擴充：
  - 欄位命名更新：原「投資最終價值」更新為「目標金額（萬）」（英文：Target Amount (10k)）
  - 新增計算列：在「目標金額（萬）」正下方新增「目標金額佔比」（英文：Target Amount Share），依該標的目標金額佔當組所有標的總目標金額之百分比（保留兩位小數如 33.33%）即時動態計算
- 測試與部署：單元測試 77/77 通過、TypeScript 檢查通過、已自動部署至 Cloudflare Workers（Version ID: `1eff1cdf-ae5b-4342-8336-68878ba5e4a9`，HTTP 200）





更新 (2026-09-07d)：
- 回退資產矩陣指標：移除「目標金額佔比」計算列，「目標金額（萬）」欄名還原為「投資最終價值」（英文 Final Value）
- 清理：移除僅供佔比計算的 totalFinalValue 與 metricSections 的 metrics 參數
- 測試 77/77 通過、TypeScript 檢查通過、已自動部署至 Cloudflare Workers（Version ID: b6124713-7035-4d5c-8842-2d5a97100ab8，HTTP 200）

更新 (2026-09-07e)：
- 標的庫新增 9 檔美股短債 ETF（皆美國公債，AA+ 主權）：SGOV（iShares 0-3個月美國公債）、BIL（SPDR 1-3個月國庫券）、SHV（iShares 短期美債）、GBIL（GS Access 0-1年美債）、USFR / TFLO（浮動利率公債）、VGSH / SCHO / SPTS（短期美債）
  - expenseRatio 採各基金公告淨值（SGOV 為費用減免後 0.09%）；fundSizeSnapshot 從缺（FUND_SIZE_AS_OF 快照未重跑），UI 顯示破折號而非猜測值
- 測試 77/77 通過、TypeScript 檢查通過、已部署 Cloudflare Workers（Version ID: ebf625c4-242a-4634-91a2-bd8b2f7b489d，HTTP 200）

更新 (2026-09-09)：
- 修復 BRK.B 類股抓取失敗：Yahoo/Stooq chart API 只認連字號形式（BRK-B），點號形式回「symbol may be delisted」。新增 toYahooSymbol()，US 類股票代號（字母.字母）於 Yahoo 與 Stooq 查詢時轉為連字號，目錄與 UI 仍顯示 BRK.B。
- 測試 80/80 通過、tsc 通過、已部署 Cloudflare Workers（Version ID: 308f14df-5069-4c8e-8bde-b0791f07fad7），線上實測 BRK.B 回測 errors: []。

更新 (2026-09-23)：
- 標的庫新增 VGLT（Vanguard 長期美國公債 ETF / Vanguard Long-Term Treasury ETF）：
  - 類別：Bond ETF，資產類別：美國公債，信用評級：AA+（美國主權），內扣費用率：0.03%
  - 支援搜尋（代號、英文名、中文名）與快速加入回測
- 測試 83/83 通過、TypeScript 檢查通過、建置成功。
