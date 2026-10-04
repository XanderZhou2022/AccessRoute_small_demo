# 完整規劃功能

現在規劃器把通行能力（硬約束）與偏好（選線目標）分開處理。輪椅可使用電梯、符合坡度與寬度條件的坡道、走廊、天橋及室外路段。步行、長者、重行李及嬰兒車可按使用者明確能力允許樓梯或扶梯；輪椅始終排除樓梯和扶梯。可設定避開電梯、最大坡度、最小寬度、每段最多梯級及速度。已提供的開放時間、單向方向和有效故障事件參與求路。嚴格模式要求相關通行資料已核實。

選線目標包括 balanced、shortest、sheltered、indoor、least_effort、fastest。雨天／有蓋偏好且沒有明確目標時採用 sheltered。sheltered 以最少露天距離為第一目標，成本為第二目標；indoor 同理先最少室外距離。最短距離仍保留所有硬約束。最快路線使用設定速度、設施行進與等待時間估算。體力目標提高樓梯和斜坡成本。

二元堆 Dijkstra 複雜度為 O((V+E) log V)，不可通行的邊先排除。每條結果提供室內、有蓋、露天距離、估計時間和換層方式。planRoutes 返回不同目標下不重複的可行候選；候選共享相同的硬約束及事件，不會為了展示替代線放寬條件。

## 資料與接口

普通規劃頁預設開啟「完整規劃演示場景」。12 個場景保留原始圖，另疊加有來源標籤的樓梯、扶梯、5% 緩坡與有蓋替代通道。補充通道為演示設定，沒有冒充已核實的實地設施。關閉該選項使用原始圖。雨天原本已全程有蓋時，保留同線是正確結果。

- `GET /api/scenes/:id?mode=scenario` 返回完整演示圖；預設 mode=base。
- `POST /api/route` 的 context 可帶 graphMode、objective、allowStairs、allowEscalators、avoidLifts、maxSlope、minWidthM、maxStepsPerFlight、walkingSpeedMps。返回 route、segments、alternatives。
- workflow 的 routing 使用相同 context。API 取得資料、agent 解析意圖、共用規劃器使用结果，仍分開實作。
- preferences 可回傳 avoid_lifts、allow_escalators、route_objective、max_slope、min_width_m，由 `applyRoutingPreferences` 統一轉換。
- 設施關閉／施工阻擋對應設施或路段；擁擠增加成本；custom 事件可用 metadata.blocked=true 封路。過期／已解決事件不影響路線。

前端設定改變、確認定位或套用路障後，從目前路段起點重算。所有可通行的连接都被封閉時返回 no_route；不將輪椅導向樓梯。

## 驗證

82 項測試及 TypeScript／production build 通過。新增驗證包括長距離遮雨繞路、室內與有蓋區別、各通行方式、單向扶梯、坡度／寬度／梯級／開放時間、等候時間、API 候選，以及 12 場景 × 5 類使用者避開電梯。

48 個人物故事重新生成為 384 個階段。所有故障階段都能改道；所有到達阶段距離為零。九龍塘也可改走演示緩坡，沒有再要求等待電梯恢復。基本圖全封閉的測試仍確認 no_route。

真實 Qwen 意圖接口驗證：輸入「我是能走樓梯的長者，今天下雨，優先室內，不乘升降機，坡度不能超過5%。」，HTTP 200／ready，返回 elderly、avoid_stairs=false、avoid_lifts=true、route_objective=indoor、max_slope=0.05，共用規劃器返回 ok。

地圖構建腳本已在臨時目錄對 11 個建築設定實際重建並校驗端點及 ID；原始場景資料未覆寫。又一城使用原有官方路網構建流程。
