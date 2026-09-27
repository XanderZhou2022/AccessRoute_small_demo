# Frontend

React / TypeScript / Vite。從根目錄 `npm run dev`，打開 `http://127.0.0.1:5173/`。

- `src/App.tsx`：Journey orchestration、用戶偏好、模擬步進、故障操作。
- `src/renderers/FloorMap.tsx`：官方 GeoJSON SVG 樓層圖、路線、開口、設施及層切換。
- `src/renderers/MacroMap.tsx`：動態載入 MapLibre；僅使用本地建築 GeoJSON，包含 SVG fallback。
- `src/styles.css`：桌面 / 手機 / 鍵盤焦點 / reduced-motion 樣式。
- `public/data/scenes/`：構建生成的資料副本，源文件在根目錄 `data/scenes/`。

不向官方 API 發出即時請求，也不需要 map token。選擇「本機後端 API」後，開發環境由 Vite `/api` proxy 接到 8787；正式本機 server 同源提供兩者。

`BASE_PATH=/repo/ npm run build` 可構建子路徑 Pages 產物；預設相對 base，首頁刷新和資源載入不依賴 SPA 伺服器重寫。
