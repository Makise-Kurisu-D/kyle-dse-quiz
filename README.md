# 拾題 · DSE 學習手冊

面向香港 Form 6 學生的錯題複習網站。Kyle（化學／生物／數學）與 Yeelam（數學／M2／物理）共用介面，登入、科目、答案、草稿及記錄按帳號隔離。靜態前端；私人資料僅經登入保護的 Cloudflare Worker 存取，不放進公開倉庫。

以「今天值得做的下一步」為首頁核心：繼續草稿 → 短練習 → 核對錯因與給分點 → 保存 → 間隔再練。暖紙白、墨綠與少量赭紅建立單一、內容優先的學習手冊；不再提供舊版完整版／精簡版、日夜場景或角色主題。

- 無需登入的純模擬演示：<https://makise-kurisu-d.github.io/kyle-dse-quiz/demo/>
- 設計、相容邊界與驗證方式：[重設計說明](docs/notebook-redesign.md)

- 線上：<https://makise-kurisu-d.github.io/kyle-dse-quiz/>
- 資料 API：<https://snowy-cake-a0a7.3355718646.workers.dev>

## 結構

| 路徑 | 說明 |
| --- | --- |
| `index.html` | 入口；`window.QUIZ_SYNC_API` 指向 Worker |
| `app.js` / `library.js` | 主應用與題庫瀏覽 |
| `paper-reader.js` / `study-experience.js` | 試卷閱讀器與學習體驗 |
| `notebook.js` / `notebook.css` / `notebook-mark.svg` | 全新單一視覺系統、響應式殼層、科目圖示與無障礙 |
| `sync-worker/` | Cloudflare Worker：登入、同步、AI 批改 |
| `tests/redesign_browser.py` | 真正 Chrome／Chromium 的合成旅程與 5 種視口檢查；Python 標準庫 CDP，禁止外網及私人路徑 |
| `notebook-data.test.mjs` | 週期、同步分區、帳號綁定備份與草稿保留的合成回歸 |
| `demo/` | 合成資料與本機模擬 API；共用正式版程式，獨立儲存空間，拒絕對外 API 連線 |

站點本身**不需要建置**：改完原始碼直接發布，`index.html` 以 `?v=` 查詢字串做資源快取失效。

## 本地開發

```bash
# 任意靜態伺服器，例如
python3 -m http.server 8123
# 開啟 http://127.0.0.1:8123/index.html
```

本地頁面預設連線**線上** Worker，登入與資料都會碰到真實環境；只想看畫面時可使用 `demo/` 的示範資料。

## 測試

```bash
node --test *.test.mjs sync-worker/worker.test.mjs
```

需要 Node 22 以上（使用內建 `node:test`）。瀏覽器回歸使用 Python 3 與已安裝的 Chrome／Chromium，**不需安裝 Python 或 Node 套件**：

```bash
# macOS 會自動偵測 /Applications/Google Chrome.app；Linux 可指定 --chrome /path/to/chromium
python3 -B tests/redesign_browser.py --suite all --screenshots
```

輸出位於系統暫存目錄的 `dse-redesign-browser/`。測試自建只提供公開原始碼和合成資料的 loopback 服務，拒絕外網及私人目錄。CI 直接使用 Ubuntu runner 已內置的 Chrome 執行同一支標準庫測試，無需額外下載 Playwright 或透過 apt 安裝瀏覽器依賴。舊的 `tests/experience_browser.py` 與舊主題資產留作歷史參考，不是新介面的驗收或載入相依。

演示版的答案、草稿與模擬同步以 `dse_demo_` 為儲存前綴；不會接觸正式版資料。沒有預先填入的練習成績，所有示例題、原答及試卷均明確標記為模擬。

## 發布

| 改動範圍 | 觸發方式 | 結果 |
| --- | --- | --- |
| 任意檔案合併進 `main` | GitHub Pages（來源 `main` 分支根目錄） | 約 40 秒後線上更新 |
| `sync-worker/**`、`subject-config.js` | `.github/workflows/deploy-worker.yml` | 跑測試 → 部署 Worker → 健康檢查 → 真帳號登入驗證 |

Worker 部署需要倉庫 secrets：`CLOUDFLARE_API_TOKEN`、`KYLE_SITE_PASSWORD`、`YEELAM_SITE_PASSWORD`。
`main` 目前沒有分支保護，推送即上線，發布前請先跑測試。

## 授權

私人專案，未授權轉載題庫內容。
