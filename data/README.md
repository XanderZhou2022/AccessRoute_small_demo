# Data

`raw/` 保存官方響應原文，`scenes/` 是規範化場景包，`runtime/` 為本機演示事件。不要用 runtime 狀態改写 raw 或 scene graph。

## 重建

已凍結所有演示所需資料，預設不需聯網。Python 3.12、Shapely 2.1.2（見 requirements.txt）。

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
python3 scripts/find_demo_venues.py
.venv/bin/python scripts/build_scene_graph.py
npm run data:sync
```

聯網刷新流程：先備份或移走擬更新的 raw 文件（下載器預設保留現有快照），執行 `python3 scripts/bootstrap_data.py`、`python3 scripts/fetch_data.py`、`python3 scripts/download_scene.py`、`python3 scripts/test_route_api.py`。生成場景後，`python3 scripts/enrich_outdoor.py` 可保存兩端室外 baseline，再重建場景。請求是低頻順序執行，保留原始響應及 URL / hash / headers；不大批並發請求官方服務。

## 語義

- 座標：EPSG:4326，lon / lat / 可選 Z；本地距離計算使用場景中心的近似米制投影。
- 樓層：用官方 UUID 作 ID，G/F、1/F 僅作標籤，避免以字串排序推斷樓層。
- `provenance=derived`：網格節點和水平連線從官方公共走廊幾何生成；不代表無障礙通行已核實。
- `provenance=manual/demo augmentation`：電梯跨層配對、室外交接及站口連接。逐邊記錄 sourceRef，scene 的 source-metadata.json 彙總。
- `wheelchair=unknown`：本期所有邊均未知；沒有把官方缺失值填成 yes。
- Lift A / B 是演示標籤；元資料記錄兩層官方 amenity IDs，不是官方設備編號。

兩個場景包原始 JSON / GeoJSON 使用緊湊格式以減少體積；schema、來源及 manifest 可直接讀取。每次構建由根目錄資料複製到前端，沒有兩份互相獨立的資料源。
