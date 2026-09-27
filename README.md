# AccessRoute HK

香港首末段無障礙導航研究演示。包含獨立前端、可運行後端、可追溯官方原始資料及可插拔路由核心。

## 本機啟動與驗收

已安裝依賴的這台電腦，在本目錄執行：

```bash
npm run dev
```

開啟 **http://127.0.0.1:5173/**。前端 5173，後端 8787，兩者只監聽本機。可雙擊 `啟動演示.command`。如端口已被本項目佔用，直接打開網址即可。

新電腦需 Node.js 22.12+（建議 Node 22 LTS）：

```bash
npm ci
npm run dev
```

正式構建與本機完整服務：

```bash
npm run build
npm start
```

此時前端與 API 都在 **http://127.0.0.1:8787/**。靜態前端無需後端亦可運行；切換「本機後端 API」會使用場景 API 並持久保存演示電梯事件。

## 建議驗收流程

1. 保持「輪椅」，查看希慎廣場 → 銅鑼灣站 → 公共交通示意 → 將軍澳站 → PopCorn 2。
2. 點「開始導航演示」，查看 1/F 官方平面圖；點「已到達」推進至 Lift A。
3. 在乘電梯前，點 Lift A 的「模擬停用」。路線從目前路段起點重算，改走 Lift B。
4. 同時停用 Lift B，確認出現「暫無可行無障礙路線」。恢復任一部電梯後可繼續。
5. 恢復兩部電梯，重設旅程，按提示完成 G/F、交通接駁、PopCorn 2 G/F → 1/F，直到「已完成旅程演示」。
6. 開啟「僅使用已核實通道」：因通行属性未知，應顯示無可行路線，不能偷偷放行。
7. 切換長者、嬰兒車、雨天情境，交換起終點，查看不同樓層。
8. 切換「本機後端 API」，停用電梯後刷新；事件應仍保留。點「恢復服務」清除演示影響。靜態模式的事件只保存在當次頁面記憶體。
9. 查看「資料與說明」。完整測試及限制在 `docs/acceptance.md`。

## 目錄

```text
frontend/              React + Vite + TypeScript UI、樓層 SVG、MapLibre 地圖
backend/               Express API、事件持久化、本機生產靜態服務
shared/                不依賴 React 的 domain / routing / journey / providers
  domain/              Zod schemas、canonical types、場景驗證
  routing/             純 Dijkstra、策略插件、不可變事件 overlay
  journey/             路由 → floor / transition / outdoor / bridge 分段
  providers/           Static / HTTP 同一場景契約
data/
  raw/                 官方資料原文、請求 URL、SHA-256（headers 僅本機保存）
  scenes/              兩個正式 Scene Package，唯一可編輯的規範化資料來源
  candidates.json/csv  六個候選場景的量化比較
  runtime/             本機後端事件（運行時建立，不提交版本庫）
scripts/               資料下載、候選掃描、圖生成、啟動及靜態資料同步
tests/                 路由、策略、事件、場景契約、後端 API 測試
docs/                  架構、API 發現、選址、可視化選擇、驗收報告
.github/workflows/     測試與手動 GitHub Pages 部署流程
```

`frontend/public/data/` 是 `data/scenes/` 的構建副本，請勿手工修改。`npm run dev` 和 `npm run build` 會自動同步。任務書 PDF 不包含在版本庫內。

## 已實現

- 兩個真實場景的官方樓層、單元、開口與設施圖層；場景間公共交通段以統一 Leg 契約示意。
- 512 節點 / 1523 邊的希慎廣場圖；2081 節點 / 6308 邊的 PopCorn 2 圖。
- 兩場景各兩部可模擬停用的電梯、樓層切換、剩餘路線重算和 no_route。
- 輪椅 / 長者 / 嬰兒車策略、模擬雨天插件、嚴格通行属性模式。
- 本地 GeoJSON 3D 建築擠出；WebGL 失敗時自動退回 SVG 宏觀圖。地圖、字體和資料不依賴第三方 CDN。
- 後端健康、場景、路由、事件 API；事件按來源和有效時間處理，原始圖不變。
- 可離線使用的靜態產物、手機佈局、可讀資料說明、官方地圖署名。

## 明確限制

**這是演示，不是已認證的實地無障礙導航。** 所有 graph edges 的 `wheelchair` 均如實設為 `unknown`。官方幾何不等於門寬、坡度、公共通行權或電梯服務已核實。

- 室內連線從官方公共走廊 / 大堂 / 電梯幾何推導，採 1.6m 網格及 0.25m 精度容差；跨層電梯配對和建築到站口的連接明確標為 `manual/demo augmentation`。
- 建築端點為公共走廊演示點。當所選連通分量沒有可附接的官方入口點時，G/F 交接點亦明確標記為待核實；並非宣稱建築入口已驗證。
- PopCorn 2 室外線使用已保存的官方 Barrier Free Path 幾何作 baseline，兩端吸附連接仍待核實。希慎廣場至所選站口的官方請求返回 no solution，已保存失敗證據；其銜接保留明示的演示補充。
- 地圖只包括官方已下載建築輪廓，不是完整街道底圖或 photorealistic 3D Tiles。
- 沒有真實定位、即時電梯狀態、天氣、眾包、帳號、GenAI 或完整公共交通換乘算法。
- 後端事件寫入限本機 demo；公開後端前須加入正式身份驗證。GitHub Pages 只部署靜態前端。

## 測試及開發

```bash
npm test              # 路由 / 策略 / 事件 / 場景契約 / API
npm run build         # 類型檢查、資料同步、前端正式構建
npm run check         # test + build
npm run format        # 源碼格式化，不改 raw data
```

原始資料已凍結，不需要重新下載便可驗收。重建資料的方法見 `data/README.md`。API 契約見 `backend/README.md`。新增場景的方法見 `docs/architecture.md`。

## 部署

目標倉庫：[XanderZhou2022/AccessRoute_small_demo](https://github.com/XanderZhou2022/AccessRoute_small_demo)。

GitHub Pages 尚未發布。在倉庫 Settings → Pages 將 Source 設為 GitHub Actions，再手動運行 `Deploy static demo to GitHub Pages`。workflow 會運行測試、構建並只發布 `frontend/dist/`；只上傳源碼不會自動發布網站。Pages 使用靜態資料，Express 後端需另外運行。

提交範圍與上傳步驟見 [docs/upload.md](docs/upload.md)。

資料與署名見 [DATA_SOURCES.md](DATA_SOURCES.md)。
