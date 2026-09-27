# 驗收報告

驗收日期：2026-09-27（香港時間）。本地開發及正式構建均已完成；目標倉庫已指定為 XanderZhou2022/AccessRoute_small_demo；Pages 已發布：https://xanderzhou2022.github.io/AccessRoute_small_demo/。

## 可直接驗收

正式構建：**http://127.0.0.1:8787/**。開發介面：**http://127.0.0.1:5173/**。若服務已結束，從根目錄 `npm run dev` 或雙擊 `啟動演示.command`。

| 任務書要求                                    | 結果 / 證據                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| 官方真實請求與保存響應                        | 已完成；39 份官方 JSON/CSV 快照，另有 headers、URL 與 SHA-256               |
| 至少五個候選                                  | 六個；data/candidates.csv                                                   |
| 選出兩個獨立場景                              | 希慎廣場 / 銅鑼灣；PopCorn 2 / 將軍澳                                       |
| 兩端離線資料包                                | 兩個 Scene Package 共約 5.5MB；本地幾何、圖和來源一併打包                   |
| 前後端及 data 分離                            | frontend/、backend/、data/、shared/，各有說明                               |
| 純路由核心、無場地分支                        | shared 與 renderers 不包含具體場地名稱                                      |
| Wheelchair / stroller 避開 stairs / escalator | 自動測試通過                                                                |
| Lift A 故障改走 Lift B                        | 兩場景真實圖測試通過；瀏覽器確認當前路段起點重算                            |
| 所有電梯故障顯示 no_route                     | 自動測試與瀏覽器均通過；下一步被禁用                                        |
| 嚴格模式阻擋未知属性                          | 瀏覽器確認顯示無可行路線，不降級成樓梯                                      |
| floor → transition → floor                    | 兩場景 segmenter 測試與瀏覽器確認                                           |
| 完整 A → A1 → Transit → B1 → B                | 瀏覽器逐步完成並顯示「已完成旅程演示」                                      |
| 第三個 mock 場景契約                          | 不改 core 的獨立 fixture 驗證及路由測試通過                                 |
| 雨天插件                                      | 模擬兩條路徑時切換選擇；無負權重                                            |
| static / HTTP provider swap                   | 自動契約測試及瀏覽器後端模式確認                                            |
| 後端事件持久化                                | 寫入後刷新仍為停用；測試驗證新 app 實例重讀及並行寫入                       |
| 桌面 / 手機                                   | 390px 手機，DOM scrollWidth=clientWidth=390，無横向溢出；電梯卡片及按鈕可用 |
| 正式構建 / TypeScript                         | 已通過；docs/qa/check-output.txt                                            |
| GitHub Pages 公開網址                         | **已發布**：[線上演示](https://xanderzhou2022.github.io/AccessRoute_small_demo/)；Actions 測試、構建及部署成功                       |

## 自動化結果

`npm run check`：**31 項測試、5 個測試文件全部通過**，TypeScript 檢查及 Vite production build 成功。

- routing：11 項（輪椅、不走扶梯、單向邊、零長路線、負權重拒絕、嚴格模式、分段、反向幾何、兩個真實場景改路）
- events：6 項（關閉、解除、過期、未生效、時間驗證、edge-target construction）
- policies：2 項（雨天成本及選路）
- scene-contract：7 項（第三場景、格式錯誤、路徑安全、provider 一致）
- API：5 項（健康/場景/route、輸入驗證、寫入限制、持久化、並行事件）

`docs/qa/scene-routes.json` 保存當前靜態圖的正常路線統計。預設總距離約 656m，包括兩端演示路段；不是全程公共交通距離，也不是經實地核實的導航距離。

## 浏览器證據

- desktop-overview.png：桌面概覽。
- mobile-390.png：390px 完整規劃頁。
- mobile-transition.png：手機樓層 / 電梯切換。
- production-overview.png：正式構建頁面。

開發中曾發現並修复 fetch 綁定、室外段重複拆分、SVG logo 尺寸為零、資料模式刷新丟失，以及開發熱更新重複 createRoot。最終版本重新構建並以正式服務驗收，避免把中間開發狀態作為交付。

## 必須保留的限制

1. 本期是**可追溯、可運行的研究演示**，不宣稱提供已認證的實地無障礙導航。所有圖邊均標記 unknown accessibility。
2. 官方樓層 / 單元 / 設施幾何是真實資料；電梯跨層配對、部分 G/F 交接點及站口連接為明示的演示補充。沒有用虛構 yes 掩盖缺資料。
3. 希慎廣場所選室外 query 返回 no solution；保留官方失敗 JSON，演示連線明確標為 manual/demo augmentation。PopCorn 2 有成功的室外 baseline，端點連接仍待核實。
4. 地圖為本地建築輪廓擠出，並非官方 photorealistic 3D Tiles；WebGL fallback 已實現，未在本次瀏覽器中強制製造 WebGL 故障。
5. 無真實 GPS / 室內定位；進度由「已到達」按鈕模擬。公共交通段為抽象卡片，不含真實換乘算法。
6. 後端只適用本機 demo。外部客戶端寫入不會即時推送至已開頁面；刷新可讀取。公開上線需正式部署與鑑權。

## 下一階段

優先實地核實入口與電梯服務，將有證據的通行属性逐邊升級；再考慮更多 Scene Package、官方設施事件 provider、交通規劃 provider 和定位。先補證據，不應為了讓嚴格模式有路而把 unknown 改成 yes。

最終正式服務 `http://127.0.0.1:8787/` 已成功載入，獨立瀏覽器頁面的 error log 為空。前後端已用最終代碼重新啟動；本次測試產生的電梯停用事件均已解除。

## Pages 上線驗證

2026-09-27：部署工作流 [36295560644](https://github.com/XanderZhou2022/AccessRoute_small_demo/actions/runs/36295560644) 成功。線上實測兩個場景載入、656 m 路線預覽、立體地圖與開始導航後的 1/F 樓層圖及下一步按鈕正常。Pages 使用靜態資料，無 Express 後端；演示事件在頁面記憶體處理。
