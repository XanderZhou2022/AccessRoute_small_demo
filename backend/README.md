# Backend

Express + TypeScript。與瀏覽器共用 `shared/` 的 schemas、路由核心、策略和 segmenter，避免前後端算法分叉。

```bash
npm start
# 或開發時同時啟動前後端
npm run dev
```

預設 `127.0.0.1:8787`。`HOST`、`PORT`、`EVENT_FILE`、`ALLOW_EVENT_WRITES` 由環境變數提供；`.env.example` 是模板，不會自動載入。

Capacitor Android builds load scene data and route locally, and call this API for Qwen workflows and HKO weather. Set `ACCESSROUTE_CORS_ORIGINS=https://localhost` for the Android WebView origin. CORS only controls browser access; it is not authentication. Do not expose this demo backend publicly without authentication and rate limiting.

| 方法 | 路徑                                          | 用途                                                                                                  |
| ---- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET  | `/api/health`                                 | 健康狀態、版本、事件寫入狀態                                                                          |
| GET  | `/api/scenes`                                 | SceneManifest 陣列                                                                                    |
| GET  | `/api/scenes/:id`                             | 完整且驗證後的 Scene                                                                                  |
| GET  | `/api/knowledge/:sceneId?q=名稱&level=樓層ID` | 尋路知識庫與文字候選，不呼叫模型                                                                      |
| POST | `/api/route`                                  | 規劃路線及分段                                                                                        |
| GET  | `/api/events`                                 | 讀取所有演示事件，包含已解除事件                                                                      |
| POST | `/api/events`                                 | 依事件 ID 新增 / 取代；`status=resolved` 解除                                                         |
| POST | `/api/sessions`                               | 建立持久化行程 session 並回傳 session ID                                                              |
| GET  | `/api/sessions/:id`                           | 讀取 session 狀態及 revision                                                                          |
| GET  | `/api/sessions/:id/facilities`                | 讀取此行程兩端場景的設施清單                                                                          |
| POST | `/api/sessions/:id/commands`                  | 以 operation ID 和 expected revision 提交行程命令                                                     |
| GET  | `/api/sessions/:id/stream`                    | 以 SSE 傳送初始及後續 session 狀態                                                                    |
| GET  | `/api/weather`                                | 讀取香港天文台目前天氣、天氣預測及警告；成功回應快取五分鐘。可選 `latitude`、`longitude` 查詢附近觀測 |

`set_facility_event` session 命令只影響該行程，會重算目前場景的剩餘路段；若沒有可行路線，回應會保留原有步驟並標記 `routeStatus: "no_route"`，且不接受後續 `advance`。恢復設施會以剩餘路段再次計算。

`/api/weather` 預設使用全港觀測。部署在 Vercel 並由平台設定 `VERCEL=1` 時，無 GPS 座標的請求會讀取平台產生的 `x-vercel-ip-country`、`x-vercel-ip-latitude` 和 `x-vercel-ip-longitude` 標頭；只有國家為 HK 且座標在香港範圍內才用於選擇附近觀測，否則回退全港資料。不要在其他部署環境啟用此設定，除非該平台會覆寫／清除客戶端同名標頭。IP 推算位置可能不準確；應用程式不保存原始 IP 或位置座標，託管平台仍可能按其政策處理連線 IP。使用者亦可主動允許瀏覽器 GPS 查詢附近觀測；座標只用於該次請求、不持久化。附近站點以近似座標作選擇錨點，並非精確感測覆蓋邊界；附近 HKO 觀測缺少時回退全港數值並標示 scope。

GitHub Pages 只提供靜態前端，沒有 Express API 或平台座標標頭；IP 附近天氣須在提供上述可信標頭的動態後端部署後才可使用。沒有可用位置資訊時仍使用全港天氣。

路由輸入：

```json
{
  "sceneId": "hysan-place",
  "from": "請使用 manifest.defaultStart",
  "to": "請使用 manifest.defaultEnd",
  "context": {
    "profile": "wheelchair",
    "rain": false,
    "strictAccessibility": false,
    "now": "2026-09-27T00:00:00Z",
    "events": []
  }
}
```

回應 `{ "route": RouteResult, "segments": RouteSegment[] }`。無路是成功計算結果 `route.status = "no_route"`，不是 HTTP 500。非法 schema / endpoint 回 400；不存在場景回 404。

事件輸入示例：

```json
{
  "id": "demo-hysan-place-lift-a",
  "type": "facility_closed",
  "target": { "facilityId": "hysan-place-lift-a" },
  "status": "active",
  "validFrom": "2026-09-26T00:00:00Z",
  "source": "demo",
  "confidence": 1
}
```

本機 server 啟用事件写入；非 loopback HOST 自動禁止。`createApp()` 的默认值也是只讀。事件只接受 `source=demo`，限制 JSON body 大小及瀏覽器 Origin；透過序列化寫入與 temp-file rename，避免同一進程中並行寫入丟失資料。未設置 eventFile 的測試实例用記憶體，正式本機 server 用 `data/runtime/events.json`。

行程 session 同樣用序列化更新和原子檔案替換，正式本機 server 儲存於 `data/runtime/sessions.json`（可用 `SESSIONS_FILE` 改路徑）。命令有 revision 衝突檢查及 operation ID 冪等保護；`allowWrites` 關閉時建立和修改 session 均會拒絕。SSE 僅在單一 Node 程序內推送，並非多實例部署方案。公開前仍必須加入身分驗證、授權、流量限制，以及可跨程序共用的持久化與 pub/sub。

前端 HTTP 模式通過 API 加載場景和存取事件；路由仍使用共用核心在瀏覽器即時計算。`POST /api/route` 提供相同服務供外部客戶端或未來遠程路由 provider 使用。此版本不輪詢其他客戶端的事件；外部更改後刷新可讀取。

不包含生產鑑權、多人同步或公開寫入；如需公開完整後端，可在可信 Node 主機運行只讀服務，將前端 `/api` 反向代理到該服務，再增設正式事件寫入鑑權。

## GenAI 結果校驗

新增 `POST /api/genai/validate`，驗證四個 Agent JSON 及場景引用，返回 `{status:"validated",applied:false,result}`。不儲存、不控制瀏覽器；上下文與路段時效由前端 bridge 校驗。詳見 [接入手冊](../docs/genai-integration.md)。

## GenAI workflow 與分層

四套 workflow 位於 `backend/workflows/`，HTTP 路由位於 `backend/api/genai.ts`，模型 transport 位於 `backend/providers/qwen.ts`。地圖 HTTP 路由位於 `backend/api/map.ts`，場景與事件讀寫位於 `backend/repositories/`。`app.ts` 只組裝依賴與中介層。

詳見 [GenAI API 手冊](../docs/genai-integration.md)和 [架構](../docs/genai-architecture.md)。`createApp({model, speech, landmarkRoot})` 可注入測試或其他供應商適配器。

### Azure 粵語語音

設定後端環境變數 `AZURE_SPEECH_KEY` 和 `AZURE_SPEECH_REGION` 後，導航播報會使用 Azure Speech 的香港粵語神經語音；金鑰只存於後端。未設定時會使用裝置／瀏覽器語音。`POST /api/genai/speech` 只接受待朗讀文字及聲線選擇，回傳 MP3 音訊。

### 自架香港粵語語音

可用 `canto-tts` 在運行 AccessRoute 的電腦上本機合成粵語 WAV，不需要 TTS API key。需使用 Python 3.10 或以上；首次啟動會從 Hugging Face 下載模型權重：

```bash
python3 -m venv .venv-tts
source .venv-tts/bin/activate
python -m pip install -r services/requirements-tts.txt
npm run dev:canto-tts
```

在 `.env` 設定 `CANTO_TTS_URL=http://127.0.0.1:8000/synthesize`，再啟動／重啟 AccessRoute 後端。Node 後端會代理音訊給手機；TTS 服務只綁定 `127.0.0.1`，手機不需要也不應直接連接 8000 port。若同時設定 Azure，`CANTO_TTS_URL` 優先。

此模型目前只有一把預設聲線，所以男聲／女聲偏好不會改變聲音。沒有配置 `CANTO_TTS_URL` 時仍沿用 Azure 或瀏覽器語音。自架服務失敗會明確回報錯誤，不會偷偷切換成其他語言。
