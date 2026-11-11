# Kyle 錯題本 · DSE 複習

DSE 化學／生物／數學錯題速記與模擬卷練習的靜態網站，資料讀寫經 Cloudflare Worker 轉發到私有資料倉庫。

- 線上：<https://makise-kurisu-d.github.io/kyle-dse-quiz/>
- 資料 API：<https://snowy-cake-a0a7.3355718646.workers.dev>

## 結構

| 路徑 | 說明 |
| --- | --- |
| `index.html` | 入口；`window.QUIZ_SYNC_API` 指向 Worker |
| `app.js` / `library.js` | 主應用與題庫瀏覽 |
| `paper-reader.js` / `study-experience.js` | 試卷閱讀器與學習體驗 |
| `appearance.js` / `*.css` | 主題、版面與首頁場景 |
| `sync-worker/` | Cloudflare Worker：登入、同步、AI 批改 |
| `tests/` | 瀏覽器回歸測試（Playwright） |
| `demo/` | 合成的公開示範資料，不含私人題庫 |

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

需要 Node 22 以上（使用內建 `node:test`）。瀏覽器回歸測試另需 Playwright：

```bash
python3 -m pip install playwright==1.55.0
python3 -m playwright install --with-deps chromium
python3 -B tests/experience_browser.py --suite all
```

## 發布

| 改動範圍 | 觸發方式 | 結果 |
| --- | --- | --- |
| 任意檔案合併進 `main` | GitHub Pages（來源 `main` 分支根目錄） | 約 40 秒後線上更新 |
| `sync-worker/**`、`subject-config.js` | `.github/workflows/deploy-worker.yml` | 跑測試 → 部署 Worker → 健康檢查 → 真帳號登入驗證 |

Worker 部署需要倉庫 secrets：`CLOUDFLARE_API_TOKEN`、`KYLE_SITE_PASSWORD`、`YEELAM_SITE_PASSWORD`。
`main` 目前沒有分支保護，推送即上線，發布前請先跑測試。

## 授權

私人專案，未授權轉載題庫內容。
