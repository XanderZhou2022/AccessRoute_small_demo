# AccessRoute GenAI 接入手冊

四套 workflow 已接入本機 Express 後端和「智能導航助手」頁面。架構與匹配算法見 [genai-architecture.md](genai-architecture.md)。

## 啟動

在專案根目錄建立 `.env`，可從 `.env.example` 複製。填入後端使用的 `DASHSCOPE_API_KEY`：

```dotenv
DASHSCOPE_API_KEY=填入你的金鑰
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_TEXT_MODEL=qwen-plus
QWEN_VISION_MODEL=qwen-vl-max
```

```bash
npm ci
npm run dev
```

開啟 `http://127.0.0.1:5173/`。前端 5173，後端 8787；Vite 將 `/api` 代理到後端。後端啟動時讀取根目錄 `.env`，也支援已有環境變數。更改模型設定後重啟後端並刷新頁面。金鑰只在後端使用。

正式本機服務：`npm run build` 後 `npm start`，開啟 `http://127.0.0.1:8787/`。

目前 Qwen provider 使用相容的 chat completions 和 JSON mode。[Qwen 官方結構化輸出文件](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output)列出可用模型與 JSON mode 要求；模型名稱和區域端點可用環境變數設定。

## 操作

1. **出行需求**：輸入描述 → 開始處理 → 檢查結果 → 套用到導航。
2. **拍照報告路障**：拍照 / 選圖，可選目前樓層及取得 GPS → 辨識 → 若需確認，選具體候選 → 套用事件與改道。
3. **拍照找位置**：拍攝店名、設施編號或可辨識外觀 → 地圖匹配 → 選候選或套用明確匹配 → 更新起點。
4. **語音導航**：取得目前可行路段的指引 → 套用並播報。裝置需提供香港中文粵語聲線。

照片接受 JPEG / PNG / WebP，前端限制原檔 8 MB。路線或導航進度改變後重新執行 workflow。頁面的「查看辨識與匹配過程」顯示各步驟；「查看呼叫上下文」可供其他客戶端聯調。

## HTTP API

| 方法與路徑                               | 輸入                                       | 輸出                                |
| ---------------------------------------- | ------------------------------------------ | ----------------------------------- |
| `GET /api/genai/capabilities`            | 無                                         | 模型配置狀態及可用 workflow         |
| `POST /api/genai/workflows/preferences`  | `{context, text}`                          | 偏好結果                            |
| `POST /api/genai/workflows/obstacle`     | `{context, image, position?, level_id?}`   | 路障候選或事件提案                  |
| `POST /api/genai/workflows/localization` | `{context, image, position?, level_id?}`   | 位置候選或粗略地圖位置              |
| `POST /api/genai/workflows/guidance`     | `{context}`                                | 指引文字及播報計畫                  |
| `POST /api/genai/confirm`                | `{context, confirmation_id, candidate_id}` | 使用者確認的候選結果                |
| `POST /api/genai/validate`               | 1.0 結果 envelope                          | 校驗結果，不套用                    |
| `POST /api/events`                       | DynamicEvent                               | 保存路障事件，沿用既有地圖 API      |
| `POST /api/route`                        | `{sceneId, from, to, context}`             | route 與 segments，沿用既有地圖 API |

API handler 只處理 HTTP 邊界；agent workflow 由 `WorkflowService` 執行；外部 Qwen 請求由 `QwenProvider` 發送。

### Workflow context

```json
{
  "context_id": "使用目前頁面的值",
  "scene_id": "hysan-place",
  "current_node_id": "目前 graph node ID",
  "destination_node_id": "目的地 graph node ID",
  "phase": "planning",
  "routing": {
    "profile": "wheelchair",
    "rain": false,
    "strictAccessibility": false,
    "now": "2026-10-04T08:00:00Z",
    "events": []
  },
  "preferences": null,
  "segment_id": "segment-0"
}
```

`phase` 為 `planning/navigation/transit/complete`。workflow 用於 planning/navigation；`segment_id=null` 時不產生路段播報。後端從場景重算剩餘路線，前端无需提交整張地圖或候選設施。

`image` 是 `data:image/jpeg;base64,...` 格式；`position` 是 `{lat, lon, accuracy_m}`。`level_id` 來自正式地圖，不要求使用者知道待匹配的節點。

### Workflow response

```json
{
  "workflow": "localization",
  "status": "needs_confirmation",
  "result": null,
  "candidates": [],
  "trace": [{ "step": "vision-agent", "summary": "照片觀察摘要" }],
  "message": "請確認目前靠近哪個地標",
  "confirmation_id": "本次候選確認 ID"
}
```

`status` 有 `ready/needs_confirmation/no_match`。只有 ready 有 `result`；result 沿用 1.0 envelope，包含 `version/request_id/context_id/scene_id/agent/payload`。

候選包含真實地圖 `node_id/level_id/facility_id/edge_ids`、名稱、資料來源、距離、`score` 和可核對證據。score 是匹配分數，不是成功機率。

### 套用與持久化

workflow API 回傳計算結果，不修改頁面或保存事件。前端套用偏好、位置或事件後，共享規劃器重算。HTTP 地圖模式先用獨立 `POST /api/events` 保存路障，再套用至頁面；靜態模式只在本頁保存事件。

候選確認回傳 `match_method=user_confirmed`，保留原有分數。一般匹配使用 `map_evidence`。沒有該欄位的舊 JSON 示例仍可使用。

`guidance` 回傳 `speech={mode:"browser",language:"zh-HK",selection:"cantonese_female"}`。前端 speech 適配器播報。另接 TTS 服務時由 `SpeechProvider` 回傳 HTTPS `audio_url`（本機測試亦允許 loopback HTTP），與生成指引的 agent 分開。

## JavaScript

前端呼叫集中在 `frontend/src/api/genai.ts`：

```ts
const response = await runWorkflow('localization', context, {
  image: imageDataUrl,
  position: { lat, lon, accuracy_m },
});
if (response.status === 'needs_confirmation') {
  const confirmed = await confirmCandidate(response.confirmation_id!, chosenId, context);
  // 將 confirmed.result 交給導航結果套用層。
}
```

原來的 `window.accessrouteGenAI.getContext/getScene/getExamples/submit` 和 JSON 聯調面板仍可使用，供手工校驗 envelope。瀏覽器的舊 context 和新的 HTTP workflow context 不同；HTTP context 使用 `routing`，無需 `levels/facilities/segment`。

## Python

Python 現在只作 HTTP 客戶端，無需安裝 OpenAI、SpeechRecognition 或 edge-tts。

```bash
python3 services/accessroute_agents.py preferences --context context.json --text '我坐輪椅，落雨想行有蓋通道'
python3 services/accessroute_agents.py localization --context context.json --image services/test1.jpeg
python3 services/accessroute_agents.py obstacle --context context.json --image services/test1.jpeg
python3 services/accessroute_agents.py guidance --context context.json
```

`context.json` 請使用頁面「查看呼叫上下文」的目前內容。程式輸出整個 workflow response。候選確認可使用 `services/accessroute_api.py` 的 `confirm` 方法。

## 補充地標目錄

在 `data/landmarks/<scene_id>.json` 加入已核對的店名、別名及外觀描述：

```json
[
  {
    "id": "唯一地標ID",
    "scene_id": "hysan-place",
    "node_id": "附近公共通道的真實graph node ID",
    "level_id": "此node的真實level ID",
    "names": ["實際店名", "英文店名", "可核對別名"],
    "category": "shop",
    "descriptions": ["現場核對的招牌與門面特徵"],
    "source": "商場目錄網址或現場核對來源與日期"
  }
]
```

室外 node 省略 `level_id`。程式校驗 scene/node/level 及唯一 ID。官方 units / amenities 及 graph facilities 自動建立索引；不必複製原始 GeoJSON。

正式地標檔案目前為空，沒有把測試店鋪加入地圖。要測品牌店名或外觀定位，需要先補充對應資料。

## 錯誤與驗證

- `MODEL_NOT_CONFIGURED`：後端缺少 Qwen Key，HTTP 503。
- `MODEL_API_ERROR`：外部模型 API 返回錯誤，HTTP 502。
- `INVALID_PAYLOAD/INVALID_REFERENCE`：輸入或地圖引用不正確。
- `STALE_CONTEXT/CONFIRMATION_EXPIRED`：導航已改變或候選過期。
- `NO_ACTIVE_SEGMENT`：目前沒有可播報路段。

```bash
npm run check
```

測試使用可注入的模型 fixture，驗證 agent 順序、店名和模糊描述匹配、候選確認、置信度保留、路障改道、語音計畫及模型 transport。測試 fixture 不代表真實 VLM 辨識精度；配置 Key 後使用現場照片驗證。

GitHub Pages 只提供靜態頁面；四套 workflow 需要本機後端或另行部署的後端服務。

候選可按「在地圖查看」，以橙色標記檢查其位置與樓層。照片生成的電梯事件可用既有「恢復服務」解除；HTTP 模式同步保存解除狀態。
