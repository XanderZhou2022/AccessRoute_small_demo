# AccessRoute HK：四個 GenAI Agent 接入操作手冊

契約版本：1.0。這份手冊交給負責 Qwen、STT、TTS、視覺識別的同事即可。此版本已實作結果接收、校驗、導航更新及聯調面板；模型推理、錄音拍照、GPS 採集、地標匹配服務由同事接入。未配置任何模型密鑰，不會自行呼叫 Qwen。

## 1. 五分鐘跑通

在項目根目錄使用 Node.js 22.12+：

```bash
npm ci
npm run dev
```

開啟 http://127.0.0.1:5173/，展開頂部「GenAI 接入 · 四個 Agent 聯調」。依次點擊任一示例和「校驗並套用到導航」。每次套用後重新點擊下一個示例，取得最新 context_id。

- 示例 1：輪椅、避階梯、避陡坡、偏好有蓋及粵語女聲進入本頁狀態與路由策略。
- 示例 2：關閉當前場景 Lift A，導航改走 Lift B。恢復時重新載入示例，保持 event_id 與 target 不變，改 has_obstacle=false、barrier_type="none"。
- 示例 3：使用當前路段起點作為模擬室內定位錨點，切到樓層圖。可將節點及 level_id 改成 getScene().graph.nodes 中同一場景的其他有效室內節點。
- 示例 4：顯示粵語指引；加入可访问的 audio_url 後出現播放器，需點播放，不會自動播放。

「清除本頁 GenAI 結果」可移除本頁 GenAI 路障、額外偏好及指引，保留目前出行類型（可手動切換）。

此面板與正式程式接入口走同一條校驗／套用流程。所有 Agent 效果目前僅保存在本頁記憶體，包括選擇「本機後端 API」時；刷新或切換資料 provider 會清除 GenAI 路障事件。既有人工電梯按鈕仍按原有機制持久化自己的事件。不要混用兩個來源來解除同一設施：GenAI 停用時人工按鈕會禁用並提示由接入口解除。

## 2. 端口與地址

| 服務 | 地址／端口 | 狀態與用途 |
| --- | --- | --- |
| 前端開發 | http://127.0.0.1:5173 | 已實作；Vite 將 /api 代理至 8787 |
| 本機後端 | http://127.0.0.1:8787 | 已實作；Express API |
| 正式本機預覽 | http://127.0.0.1:8787 | npm run build 後 npm start，同源前端和 API |
| GitHub Pages | https://xanderzhou2022.github.io/AccessRoute_small_demo/ | 靜態前端；本次改動需由項目擁有者 push 並手動部署後才生效 |
| 同事模型服務 | 例如 http://127.0.0.1:8000 | 建議的開發端口，**本項目未實作或啟動**；實際地址由同事決定 |
| Qwen／STT／TTS | 由同事後端呼叫供應商 HTTPS API | 密鑰只放同事後端環境變數，不放 VITE_*、Pages 或瀏覽器 |

Pages 沒有 /api/genai/validate 或其他 Express API。Pages 上可直接用面板或 window.accessrouteGenAI 接入；不要向 Pages 域名 POST API。連接遠端模型服務時需 HTTPS、服務端允許前端 Origin（本機 http://127.0.0.1:5173 或 Pages https://xanderzhou2022.github.io），JSON POST 需處理 OPTIONS 預檢。現有 Express 未開放跨域，開發時走 Vite 同源代理。Pages 不保證能連接本機 HTTP 服务，建議本機聯調或部署 HTTPS 模型後端。

## 3. 對接入口：瀏覽器 Bridge

場景載入完成後，以下 API 可用於現有前端代碼或瀏覽器開發者 Console。它不跨瀏覽器、不跨分頁，不是 HTTP 或 WebSocket 服務。

| 方法 | 返回與作用 |
| --- | --- |
| window.accessrouteGenAI.getContext() | 當前場景、context_id、階段、偏好、起點、終點、當前路段、樓層、設施的副本 |
| window.accessrouteGenAI.getScene() | 當前 Scene 副本：graph.nodes/edges/facilities、官方 units/amenities 等地圖資料 |
| window.accessrouteGenAI.getExamples() | 四份使用真實場景 ID、最新 context_id、新 request_id 及有效時間的 JSON |
| window.accessrouteGenAI.submit(result) | 同步校驗並安排 React 狀態更新；返回 applied / ignored / rejected 回執 |

```javascript
// 在 AccessRoute 頁面的 Console 執行；不需要模型密鑰。
const bridge = window.accessrouteGenAI;
if (!bridge) throw new Error('先等待場景載入');
const preferenceResult = bridge.getExamples()[0];
console.log(bridge.submit(preferenceResult));
// { status: 'applied', request_id: '...', message: '...' }
```

一筆結果只含一個 Agent。套用後等下一個畫面更新，再重新讀取 window.accessrouteGenAI；不要長期保存舊 bridge 或連續同步套用四份舊示例。畫面改變會讓舊 context_id 失效。

### Agent 1：從自然語言到現有路由

例如「我推輪椅，唔好行樓梯同斜路，最好有瓦遮頭，用女聲講」由同事轉為 payload。接收方式：

```javascript
const c = window.accessrouteGenAI.getContext();
const result = {
  version: '1.0', request_id: crypto.randomUUID(),
  context_id: c.context_id, scene_id: c.scene_id, agent: 'preferences',
  payload: {
    mobility_type: 'manual_wheelchair',
    avoid_stairs: true,
    avoid_steep_slopes: true,
    prefer_covered_shelter: true,
    tts_selection: 'cantonese_female'
  }
};
window.accessrouteGenAI.submit(result);
```

| 同事返回字段 | 我們系統中的效果 |
| --- | --- |
| mobility_type | wheelchair / manual_wheelchair 映射 profile=wheelchair；elderly、stroller 原樣映射 |
| avoid_stairs | 傳入 RoutingContext.avoidStairs，禁止樓梯和扶梯；false 不會解除輪椅／嬰兒車既有禁行規則 |
| avoid_steep_slopes | 傳入 avoidSteepSlopes，阻擋已知坡度絕對值 > 0.0833 的邊；未知坡度仍未知 |
| prefer_covered_shelter | 傳入 preferCoveredShelter，不需開啟雨天開關也會增加非室內且未標示有蓋邊的成本（距離 × 2 的額外懲罰） |
| tts_selection | cantonese_female / cantonese_male / text_only；提供给 Agent 4，text_only 隱藏播放器；本頁不自行合成或更換聲線 |

所有字段必填且 boolean 必須是真布林值。Agent 1 不修改 strictAccessibility，不能把 unknown 無障礙属性變成 yes。避雨偏好是成本偏好，不保證存在有蓋路線。此資料集並未完整標注坡度與遮蔽，策略接通不等於現場已核實。

### Agent 2：障礙結果到事件與改道

必須提供有效 facility_id 或明確 edge_ids（二者擇一）。用模型識別到的招牌／GPS 查詢地圖資料庫後再填 ID；接收端不會靠名稱猜測，也不會把任意 node_id 的所有相鄰邊直接封閉。

payload 字段：event_id（同一事件關閉／解除保持一致）、has_obstacle、barrier_type、location_sign、is_indoor、target、confidence、valid_from、valid_until；gps 可選，格式 {lat, lon, accuracy_m}。barrier_type 為 broken_lift / stairs_only / puddle / construction / none。無障礙或解除必須 has_obstacle=false 且 barrier_type=none。broken_lift 必須對應 lift 設施。

confidence 至少 0.8；這是聯調門檻，不代表現場真實性已確認。UTC/帶時區 ISO 8601 時間必填，valid_until 必須晚於 valid_from；未生效或已過期事件不影響路由。

套用後轉為 source=demo 的 DynamicEvent（genai-場景-event_id），設施事件阻擋對應設施、edge_ids 事件阻擋指定邊。從目前路段起點重算剩餘路線；兩部電梯均停用會顯示 no_route。只新增事件 overlay，不改寫官方圖。來源為 GenAI 的事件須用同 event_id 的新結果解除。

### Agent 3：視覺定位結果到導航起點

室內 payload：is_indoor=true、status="matched"、map_db_node_id、level_id、anchor_names、direction_hint、confidence；gps 可選。節點必須存在於当前場景且屬於指定樓層，anchor_names 至少一個，confidence 至少 0.8。

接收後將目前步行 leg 的起點設為該節點，進度歸零並重算到原目的地；已走完的前一段旅程不變。方向文本供介面／同事參考，不做朝向追蹤。後端匹配服務需自己驗證地標與節點關係，單純把店名輸出給 LLM 並不能完成定位。當前地圖資料不保證每間店都有名稱或可匹配 POI。

室外 payload：

```json
{"is_indoor":false,"status":"outdoor_use_gps_directly","anchor_names":[],"direction_hint":"","confidence":0}
```

室外返回 ignored，不改動起點：現有項目尚未接真實 GPS provider，本期只預留分流狀態，沒有宣稱已完成 GPS 導航。

### Agent 4：微指引到文字／音頻

payload 必填 segment_id 和 text（1–60 個 UTF-16 字元；常見中文字計 1）。audio_url 可選，使用 HTTPS；本機開發另允許 http://localhost 或 http://127.0.0.1。不得傳 file://、服務器本機路徑或 base64。

segment_id 從 getContext().segment.id 取，必須同時帶回請求時的 context_id。原始路段包括 type、geometry、distanceM、facilityId、fromLevel/toLevel 等；同事可轉成 raw_step，配合 Agent 1 偏好及自己的 visual_landmarks/event_type 生成文本。畫面不驗證語意真假，生成端必須以實際路線與已確認地標為依據。

路線或步進變化時，舊文字和音頻自動隱藏並卸載。no_route、公共交通示意階段、完成階段不接受步行指引。音頻需是瀏覽器可訪問的實際資源，提供正確 Content-Type；短效簽名 URL 可用。播放器不會添加同事後端的自訂 Authorization 標頭。text_only 不展示播放器。

## 4. 統一 JSON 外殼與錯誤處理

```json
{
  "version": "1.0",
  "request_id": "每次結果的唯一ID，建議UUID",
  "context_id": "getContext() 原樣返回的ID",
  "scene_id": "getContext() 原樣返回的場景ID",
  "agent": "preferences",
  "payload": {}
}
```

agent 只接受 preferences / obstacle / localization / guidance。採嚴格 schema，多餘或拼錯的字段也會拒絕，不能傳 Markdown 程式碼圍欄。應由同事 adapter 把 Qwen 原始輸出轉成此格式，無需要求大模型產生 request_id 或 context_id。

| code / status | 原因與處理 |
| --- | --- |
| applied | 已校驗並排程狀態更新，不表示模型推理或實地驗證成功 |
| ignored | 室外定位分流，本版不移動起點 |
| INVALID_JSON | 面板解析失敗 |
| INVALID_PAYLOAD | 字段、類型、版本、枚舉或音頻 URL 不合法 |
| INVALID_REFERENCE | 錯誤場景／設施／邊／節點／樓層，或矛盾的事件內容 |
| LOW_CONFIDENCE | 障礙或室內定位置信度不足，不套用 |
| STALE_CONTEXT | 路線、偏好、場景或進度已變；重新取得上下文並重新推理，不能只改舊結果 ID |
| STALE_SEGMENT | 指引不是當前可行路段 |
| DUPLICATE_REQUEST | 已成功套用的 request_id 不可再次使用 |
| BUSY | 上一筆仍等待畫面更新；等待下一幀再取新 context |
| INVALID_PHASE | 公共交通示意或完成階段，不接受步行結果 |
| NOT_READY | 場景未就緒 |

request_id 在本頁存活期間記錄，不跨刷新持久化。沒有自動重試、遠端推送或共享會話。任何 rejected 都不更改導航。導航示例仍採離散路段起點，而非連續 GPS 軌跡。

## 5. 同事模型服務接線示例

以下是同事需新增的呼叫端示例，/agents/preferences 為建議路徑，**不是本項目現有端點**。服務可以回傳純 payload，由前端加外殼；服務超時／錯誤時不要提交，保留原導航。

```javascript
async function askPreferenceAgent(text, modelServiceBase) {
  const c = window.accessrouteGenAI.getContext();
  const response = await fetch(modelServiceBase + '/agents/preferences', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ text, context: c })
  });
  if (!response.ok) throw new Error('模型服務失敗：' + response.status);
  const payload = await response.json();
  return window.accessrouteGenAI.submit({
    version: '1.0', request_id: crypto.randomUUID(),
    context_id: c.context_id, scene_id: c.scene_id,
    agent: 'preferences', payload
  });
}
```

其他三個 Agent 使用相同外殼；同事自行定義媒體上传端點（如 multipart/form-data）、圖片／錄音大小限制、儲存與授權。模型服務與瀏覽器不共享 file:// 路徑。建議接入順序：先讓服務返回固定 payload 跑通，再接 Qwen；Agent 1 → 重新取得 context → Agent 2/3 更新路由 → 再取得 context → Agent 4。不同 Agent 不要將同一個過期 context 的結果一起套用。

本版不提供公開檔案上傳、語音錄製或相機權限 UI，也不會將照片或定位自動傳给外部服務。

## 6. 本機 HTTP API 與 curl

| 方法與路徑 | 用途 |
| --- | --- |
| GET /api/health | 確认服務及寫入狀態 |
| GET /api/scenes | 場景清單 |
| GET /api/scenes/:id | 完整場景，用於同事建立地標／節點匹配 |
| POST /api/genai/validate | 新增：對四個 Agent 結果做 schema 與場景引用校驗，返回 {status:"validated",applied:false,result} |
| POST /api/route | 用當前起终點、偏好與事件計算路線／分段 |
| GET /api/events | 既有持久事件清單 |
| POST /api/events | 既有本機 demo 事件寫入；只接受 source=demo，非公開生產介面 |

**HTTP validate 不控制瀏覽器，也不保存結果。** 它沒有瀏覽器會話，不能檢查 context 是否過期、request 是否重複或 segment 是否當前；這些在 submit 時檢查。Python 同事可先用它驗證 JSON，再由前端拿到結果並呼叫 submit。若只在後端路由，自行把偏好／事件轉成 RoutingContext，呼叫 /api/route。

```bash
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8787/api/scenes/hysan-place
curl -X POST http://127.0.0.1:8787/api/genai/validate \
  -H 'Content-Type: application/json' \
  --data-binary @examples/genai/preferences.json
```

HTTP：合法結果 200；schema/引用錯誤 400；場景不存在 404；超過 128KB body 413。驗證成功不代表已应用前端。錯誤返回 error，契約錯誤另有 code。

```python
# Python 標準庫；不需安裝 Qwen 就能測連通性
import json
from urllib.request import Request, urlopen
with open('examples/genai/preferences.json', encoding='utf-8') as f:
    result = json.load(f)
req = Request('http://127.0.0.1:8787/api/genai/validate',
              data=json.dumps(result).encode(),
              headers={'Content-Type': 'application/json'}, method='POST')
with urlopen(req, timeout=10) as response:
    print(json.load(response))
```

### 純後端路由示例（不更新頁面）

以下從場景讀真實起终點，將 Agent 1 的三個偏好字段傳入路由。若需納入 Agent 2，將結果按 shared/genai/contracts.ts 的 obstacleEvent 映射成 DynamicEvent 放入 context.events。Agent 3 可替換 from 為已驗證的 map_db_node_id。

```python
import json
from urllib.request import Request, urlopen
base = 'http://127.0.0.1:8787'
with urlopen(base + '/api/scenes/hysan-place', timeout=10) as r:
    scene = json.load(r)
from datetime import datetime, timezone
body = {
    'sceneId': scene['manifest']['sceneId'],
    'from': scene['manifest']['defaultStart'],
    'to': scene['manifest']['defaultEnd'],
    'context': {
        'profile': 'wheelchair', 'rain': False,
        'strictAccessibility': False,
        'avoidStairs': True, 'avoidSteepSlopes': True,
        'preferCoveredShelter': True,
        'now': datetime.now(timezone.utc).isoformat(), 'events': []
    }
}
req = Request(base + '/api/route', data=json.dumps(body).encode(),
              headers={'Content-Type': 'application/json'}, method='POST')
with urlopen(req, timeout=10) as r:
    result = json.load(r)
print(result['route']['status'], result['segments'])
```

已有 /api/events 持久化请求示例见 backend/README.md；此端点不会推送到当前打开的页面。GenAI 浏览器 submit 与 HTTP route 是两条清楚分开的用法，不能假设服务器改变会自动出现在浏览器。

## 7. 文件與協作邊界

| 文件 | 維護內容 |
| --- | --- |
| shared/genai/contracts.ts | 唯一契約來源、Zod 校驗、事件轉換、動態示例 |
| frontend/src/genai.d.ts | Window bridge 的 TypeScript 類型 |
| frontend/src/App.tsx | 接入狀態、上下文、路由／起點／指引更新 |
| frontend/src/components/GenAIConsole.tsx | JSON 聯調面板 |
| shared/domain/schema.ts、shared/routing/policies.ts | 路由偏好字段與策略 |
| backend/app.ts | /api/genai/validate 和已有 API |
| examples/genai/*.json | 四種完整结果和 context 示例（真實節點，但 context_id 為替換標記） |
| scripts/genai-examples.ts | node --import tsx scripts/genai-examples.ts 重新生成文件示例 |
| tests/genai/integration.test.ts | 契約、引用、路由效果、HTTP 驗證測試 |

頁面示例自動使用最新有效時間和上下文；文件示例時間会过期，复制到页面前请使用当前 context、独立 request_id 和最新有效期。不要手改 frontend/public/data/scenes；data/scenes 是場景資料唯一來源。手冊由 scripts/sync-data.ts 自動複製到 public，維護 docs/genai-integration.md 即可。

## 8. 驗收與由項目擁有者發布

```bash
npm run check
BASE_PATH=/AccessRoute_small_demo/ npm run build
```

頁面驗收：四個示例可套用；錯誤節點／低置信度被拒絕；同一結果再次提交被拒絕；先生成指引再改路，舊指引清除；两部电梯停用後 no_route；解除 GenAI 事件後恢复；嚴格模式仍阻擋 unknown。

本次由項目擁有者自行 git add、commit、push。push 後现有 Validate 工作流會測試，但 **不會自動更新 Pages**。由擁有者到 GitHub → Actions → Deploy static demo to GitHub Pages → Run workflow，選擇要發布的分支。工作流發布 frontend/dist，包含本次面板、手冊與示例。此任務不代為 push 或觸發部署。

## 附錄：完整 JSON 文件示例

下面 context_id 是占位標記；可用於 HTTP 結構校驗，不能直接套用到活躍瀏覽器。請優先用頁面的最新示例。

### preferences

```json
{
  "version": "1.0",
  "context_id": "replace-with-live-context-id",
  "scene_id": "hysan-place",
  "request_id": "62b3ee8b-9637-4806-972a-f7cfa5ec2351",
  "agent": "preferences",
  "payload": {
    "mobility_type": "manual_wheelchair",
    "avoid_stairs": true,
    "avoid_steep_slopes": true,
    "prefer_covered_shelter": true,
    "tts_selection": "cantonese_female"
  }
}
```

### obstacle

```json
{
  "version": "1.0",
  "context_id": "replace-with-live-context-id",
  "scene_id": "hysan-place",
  "request_id": "4505bfb0-29fb-4984-aba8-4698c426ec84",
  "agent": "obstacle",
  "payload": {
    "event_id": "lift-example",
    "has_obstacle": true,
    "barrier_type": "broken_lift",
    "location_sign": "Lift A（聯調示例）",
    "is_indoor": true,
    "target": {
      "facility_id": "hysan-place-lift-a"
    },
    "confidence": 0.95,
    "valid_from": "2026-09-29T17:04:19.126Z",
    "valid_until": "2026-09-29T18:04:19.126Z"
  }
}
```

### localization

```json
{
  "version": "1.0",
  "context_id": "replace-with-live-context-id",
  "scene_id": "hysan-place",
  "request_id": "0aabda57-6ce3-49cb-addd-bb369d5318f0",
  "agent": "localization",
  "payload": {
    "is_indoor": true,
    "status": "matched",
    "map_db_node_id": "ba047eef-9--6",
    "level_id": "ba047eef-2b62-4561-932a-25c1a1e16fb3",
    "anchor_names": [
      "聯調錨點（非模型識別）"
    ],
    "direction_hint": "目前路段起點",
    "confidence": 0.95
  }
}
```

### guidance

```json
{
  "version": "1.0",
  "context_id": "replace-with-live-context-id",
  "scene_id": "hysan-place",
  "request_id": "f0e1b2e7-0123-4f08-9d6d-78866a9e56ba",
  "agent": "guidance",
  "payload": {
    "segment_id": "segment-0",
    "text": "請跟住畫面標示嘅路線慢慢行，到下一個位置再按「已到達」。"
  }
}
```
