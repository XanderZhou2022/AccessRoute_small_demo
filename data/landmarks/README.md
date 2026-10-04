# 可補充地標目錄

每個場景可建立 `<scene_id>.json`，內容為地標紀錄陣列。沒有檔案的場景使用官方 GeoJSON 與 graph 索引。

每筆紀錄需要 `id`、`scene_id`、`node_id`、室內 `level_id`、`names`、`category`、`descriptions` 和 `source`。node 必須是目前地圖中靠近地標的公共通道位置，level 必須與 node 一致。source 記錄商場目录來源或現場核對日期。室外地標省略 level_id。

此目錄不包含虛構店名。店名與外觀範例僅用於測試 fixture。完整格式見 [GenAI 接入手冊](../../docs/genai-integration.md)。
