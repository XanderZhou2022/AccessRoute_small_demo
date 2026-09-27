# GitHub 上傳交付

目標：`git@github.com:XanderZhou2022/AccessRoute_small_demo.git`

版本庫根目錄為 `accessroute-hk/`，前端、後端和資料分別在 `frontend/`、`backend/`、`data/`。包含鎖定依賴的 package-lock.json、原始官方資料、場景、測試、驗收文件及 CI / Pages workflows。

不提交 node_modules、Python 虛擬環境、前端構建副本、運行時事件、環境私密設定、下載的參考 HTML 和原始 HTTP headers。後兩項可能包含範例 API key 或臨時 Cookie，僅在本機保留；來源 URL 與原始資料雜湊仍保存在 data/raw/requests.jsonl。

## 上傳

先檢查遠端，若為空倉庫：

```bash
git ls-remote origin
git push -u origin main
```

若已有提交，先 fetch 並檢查歷史，再整合或使用新分支；不要 force push。SSH 身份需對目標倉庫有寫入權限。此處的 push 僅上傳版本庫，Pages 保持手動部署。

## 新電腦驗證

```bash
git clone git@github.com:XanderZhou2022/AccessRoute_small_demo.git
cd AccessRoute_small_demo
npm ci
npm run check
npm run dev
```

使用 Node.js 22.12+。開啟 http://127.0.0.1:5173/。
