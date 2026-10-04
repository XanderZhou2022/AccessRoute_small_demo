# 可離線重放的演示例子庫

48 個虛構人物故事、384 個階段覆蓋已確認的 12 個場景；每個場景有手動輪椅、重行李、長者和嬰兒車 4 種需求。故事依次展示人物需求、雨天、有蓋偏好、故障、定位、指引、接駁與到達。九龍塘的故障階段改走緩坡通道。共有 14 張真實歷史參考照片、384 張地圖位置視圖及 48 張演示故障告示；店舖及設施知識共 496 條。

資料組成：

- `index.json`：故事選單、素材索引與數量。
- `cases/*.json`：每階段用戶話語、地圖上下文、各 agent 的輸入／輸出、預設 WorkflowResponse、套用後狀態、路線快照、圖片及知識引用。陳女士版本包含招牌文字模糊、以部分名稱檢索候選後確認的分支。
- `overlays.json`：與原始地圖分開的演示通行條件：樓梯捷徑、有蓋繞行。各邊均標記 `manual/demo augmentation` / `demo_assumption`，原始場景不改寫。
- `media.json`：作者、來源、授權、拍攝日期及精確拍攝節點狀態。
- `media/`：本地實景參考照片、路線坐標視圖及清楚標記的虛構故障告示。
- `audit.json`：各場景覆蓋及路线变化统计。
- `../knowledge/*.json`：官方 POI 名稱、樓層、坐標、来源、同層公共節點候選與圖片引用。

實景圖片是有復用許可的歷史照片。店舖／大樓存在性不等於已驗證攝影位置；`camera_node_id=null`，不把這些圖片當作準確節點標定。店舖到公共節點的映射限同層 20 米內，標為 approximate，定位 workflow 得分最高 0.79，須用戶確認。未映射 POI 保留名稱檢索用途。

API 與例子庫使用相同 `WorkflowClient`、`WorkflowResponse`、`AgentResult` 契約：`apiWorkflowClient` 發送 HTTP，`ExampleWorkflowClient` 回傳指定階段 fixture；`applyDemoResult` 驗證结果後更新導航狀態，`demoRoute` 使用共用路由引擎求路。例子不是模型推理錄影，UI 明確顯示「例子庫返回」。

固定故事時間為 `2026-10-04T09:00:00Z`，故障有效兩小時。重放保持這個時鐘，可隨時重新開始；不寫入後端實際事件。

```sh
npm run demo:build
npm run build
npm run demo:preview
```

打開 `http://127.0.0.1:8788/?demo=1`。這個服務只提供靜態資料，沒有模型或後端 workflow，亦不讀取 `.env`。一般服務也可用 `http://127.0.0.1:8787/?demo=1`。

`npm run demo:media` 僅在準備新素材時使用，會訪問 Wikimedia Commons 並下載有授權圖片；日常重放不下載素材。
