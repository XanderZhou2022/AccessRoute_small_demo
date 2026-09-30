# Backend

Express + TypeScript。與瀏覽器共用 `shared/` 的 schemas、路由核心、策略和 segmenter，避免前後端算法分叉。

```bash
npm start
# 或開發時同時啟動前後端
npm run dev
```

預設 `127.0.0.1:8787`。`HOST`、`PORT`、`EVENT_FILE`、`ALLOW_EVENT_WRITES` 由環境變數提供；`.env.example` 是模板，不會自動載入。

| 方法 | 路徑              | 用途                                          |
| ---- | ----------------- | --------------------------------------------- |
| GET  | `/api/health`     | 健康狀態、版本、事件寫入狀態                  |
| GET  | `/api/scenes`     | SceneManifest 陣列                            |
| GET  | `/api/scenes/:id` | 完整且驗證後的 Scene                          |
| POST | `/api/route`      | 規劃路線及分段                                |
| GET  | `/api/events`     | 讀取所有演示事件，包含已解除事件              |
| POST | `/api/events`     | 依事件 ID 新增 / 取代；`status=resolved` 解除 |

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

前端 HTTP 模式通過 API 加載場景和存取事件；路由仍使用共用核心在瀏覽器即時計算。`POST /api/route` 提供相同服務供外部客戶端或未來遠程路由 provider 使用。此版本不輪詢其他客戶端的事件；外部更改後刷新可讀取。

不包含生產鑑權、多人同步或公開寫入；如需公開完整後端，可在可信 Node 主機運行只讀服務，將前端 `/api` 反向代理到該服務，再增設正式事件寫入鑑權。

## GenAI 結果校驗

新增 `POST /api/genai/validate`，驗證四個 Agent JSON 及場景引用，返回 `{status:"validated",applied:false,result}`。不儲存、不控制瀏覽器；上下文與路段時效由前端 bridge 校驗。詳見 [接入手冊](../docs/genai-integration.md)。
