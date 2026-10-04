# AccessRoute HK

香港首末段無障礙導航研究演示。包含獨立前端、可運行後端、可追溯官方原始資料及可插拔路由核心。

**線上演示：[開啟 AccessRoute HK](https://xanderzhou2022.github.io/AccessRoute_small_demo/)**

## 12 地點資料擴充（2026-10-04）

已註冊 12 個可選場景、132 個有方向起終點配對，包含又一城—九龍塘站天橋、長者服務設施、政府合署和街市。11 個場景有官方單元平面；又一城使用官方分層路網中心線。醫院完整室內圖仍待補充，候補資料已保存。

選址、資料完整度、下游入口與重建方式見 [12 地點說明](docs/location-expansion.md)，機器可讀目錄見 `data/location-catalog.json`。下文兩地示例仍可用。

## 本機啟動與驗收

離線案例入口：**http://127.0.0.1:8787/?demo=1**。已準備 48 個人物故事、384 個階段、496 條尋路知識、14 張有授權的實景歷史參考照片；可完整展示需求、雨天、故障、定位與到達。`npm run demo:preview` 提供沒有模型及 workflow 後端的 8788 靜態演示。完整素材、情境假設與講解見 [Demo 手冊](docs/demo-playbook.md) 和 [例子庫](data/demo/README.md)。

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
4. 同時停用 Lift B，確認改走「演示緩坡通道」。再停用所有可用跨層設施，才會出現無可行路線。
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
  scenes/              12 個正式 Scene Package，規範化資料來源
  candidates.json/csv  候選場景的量化比較
  runtime/             本機後端事件（運行時建立，不提交版本庫）
scripts/               資料下載、候選掃描、圖生成、啟動及靜態資料同步
tests/                 路由、策略、事件、場景契約、後端 API 測試
docs/                  架構、API 發現、選址、可視化選擇、驗收報告
.github/workflows/     測試與手動 GitHub Pages 部署流程
```

`frontend/public/data/` 是 `data/scenes/` 的構建副本，請勿手工修改。`npm run dev` 和 `npm run build` 會自動同步。任務書 PDF 不包含在版本庫內。

## GenAI 智能導航助手

頁面已接上四套独立 workflow：出行意圖、照片路障、照片定位和粵語指引。定位與路障由 VLM 觀察照片，再檢索目前位置和路線附近的地圖，交由地圖匹配 agent 比較證據。匹配不明確時提供候選確認，保留原始匹配分數。

- 在根目錄 `.env` 配置 `DASHSCOPE_API_KEY` 後啟動 `npm run dev`，後端自動讀取設定。
- [架構與匹配算法](docs/genai-architecture.md)、[HTTP 接入操作手冊](docs/genai-integration.md)。
- `backend/api/` 為 HTTP 路由，`backend/providers/` 為模型與語音接口，`backend/agents/` 為單一角色，`backend/workflows/` 為流程組合，`backend/retrieval/` 為地圖檢索。
- `data/landmarks/` 可補充已核對的店名和外觀；官方資料不足時不生成虛構店鋪。
- 粵語播報使用裝置語音；語音適配器與指引生成分開。Python 程式已改為同一套後端的 HTTP 客戶端。
- 原有 JSON 聯調面板、1.0 結果契約和 `/api/genai/validate` 保持相容。

## 已實現

- 12 個正式場景：11 個官方樓層平面場景、1 個官方分層路網場景；132 個有方向配對的站間公共交通段以統一 Leg 契約示意。
- 512 節點 / 1523 邊的希慎廣場圖；2081 節點 / 6308 邊的 PopCorn 2 圖。
- 各場景電梯停用模擬、樓層切換、剩餘路線重算和 no_route。
- 輪椅 / 長者 / 嬰兒車策略、最少露天／室內／距離／體力／時間選線、嚴格通行属性模式。
- 本地 GeoJSON 3D 建築擠出；WebGL 失敗時自動退回 SVG 宏觀圖。地圖、字體和資料不依賴第三方 CDN。
- 後端健康、場景、路由、事件 API；事件按來源和有效時間處理，原始圖不變。
- 可離線使用的靜態產物、手機佈局、可讀資料說明、官方地圖署名。

## 明確限制

**這是演示，不是已認證的實地無障礙導航。** 所有 graph edges 的 `wheelchair` 均如實設為 `unknown`。官方幾何不等於門寬、坡度、公共通行權或電梯服務已核實。

- 11 個平面圖場景的室內連線從官方公共走廊 / 大堂 / 電梯幾何推導，採 1.6m 網格及 0.25m 精度容差；跨層電梯配對和短距離吸附明確標為演示補充。又一城使用官方三維路網；新增 9 個建築的室外接駁使用官方路網，詳見 [擴展說明](docs/location-expansion.md)。
- 建築端點為公共走廊演示點。當所選連通分量沒有可附接的官方入口點時，G/F 交接點亦明確標記為待核實；並非宣稱建築入口已驗證。
- PopCorn 2 室外線使用已保存的官方 Barrier Free Path 幾何作 baseline，兩端吸附連接仍待核實。希慎廣場至所選站口的官方請求返回 no solution，已保存失敗證據；其銜接保留明示的演示補充。
- 地圖只包括官方已下載建築輪廓，不是完整街道底圖或 photorealistic 3D Tiles。
- 照片定位提供地標附近粗略位置，尚未完成實景精度評估；沒有持續即時定位、即時官方電梯狀態、天氣、眾包、帳號或完整公共交通換乘算法。
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

GitHub Pages 已發布，Source 已設為 GitHub Actions。後續更新時，先推送代碼，再在 Actions 手動運行 `Deploy static demo to GitHub Pages`。workflow 會運行測試、構建並只發布 `frontend/dist/`；只上傳源碼不會自動發布網站。Pages 使用靜態資料，Express 後端需另外運行。

提交範圍與上傳步驟見 [docs/upload.md](docs/upload.md)。

資料與署名見 [DATA_SOURCES.md](DATA_SOURCES.md)。
