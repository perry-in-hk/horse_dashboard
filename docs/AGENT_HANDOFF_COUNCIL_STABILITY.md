# Council 穩定性與真互聊交接摘要

## 交接目的
本文件提供下一位 agent 快速接手 `HKJC_Dashboard` 的 Council 真互聊與穩定性修復現況，避免重複排查。

## 目前目標（User expectation）
- Council 要有「真會議室」體感（多 agent 回合互聊，不是一次性長文報告）。
- 使用者是正式與會者（`You (Council Member)`），發言要被後續回應。
- 右上角共識卡要每輪更新，不可忽隱忽現。
- 就算關閉瀏覽器，Council 也要持續在 backend 跑。
- 前端要穩定：不可再出現 `Maximum update depth exceeded` 與 sessions 404 連續洗版。

## 本輪已完成重點

### 1) 真互聊核心（backend）
- `apps/backend/src/lib/ai/council/orchestrator.js`
  - 新增 `runCouncilChatroomRound(...)`：
    - analyst 依序發言（turn-based）
    - 每輪 `bookie` 產生 round summary、next sequence、current picks
    - 支援 user disposition（accepted/parked/rejected）
- `apps/backend/src/lib/councilService.js`
  - `COUNCIL_MODE=chatroom|stage`（預設 chatroom）
  - 每輪寫入 message + picks（interim/final）
  - 加入比賽時間終止邏輯（目前設定為開跑前 1 分鐘結案）
  - session hydrate/recover（避免 browser 關閉後中斷）
- `apps/backend/src/routes/council.js`
  - 新增 `GET /api/council/sessions`
  - 新增 `GET /api/council/ping`（版本探針）
- `apps/backend/src/index.js`
  - 啟動時打印 council mode/route 指紋 log。

### 2) 前端會議化 UI 與穩定性止血
- `apps/frontend/src/pages/AiRecommendation.tsx`
  - 顯示 round divider、turn、reply seq、bookie disposition
  - 右上角標題改為 `會議即時共識（Live）`
  - `sessions` 404 降級：停用 sessions 輪詢 + 一次性提示 + 手動刷新按鈕
  - 狀態輪詢補強（`/api/council/status`）避免卡在「連線中...」
  - 移除 WS `session_state` 事件內高頻 `loadSessions()` 連鎖呼叫
  - `raceKey` 改為 `useMemo` 降低 effect 震盪
- `apps/frontend/src/style.css`
  - 補充會議訊息與刷新按鈕樣式。

## 已觀察到的關鍵事實
- `GET /api/council/ping`、`GET /api/council/sessions` 在未登入情境回 `401`（非 `404`），代表 route 在目前程式碼是存在的。
- 使用 `docker exec hkjc-backend ... import getSessionHistory` 測試時曾出現「no export named getSessionHistory」，顯示**容器內執行碼可能落後於 workspace 最新碼**（高風險來源）。

## 仍需下一位 agent 優先確認（最重要）
1. **執行版本一致性**
   - backend 實際執行進程是否已重啟至最新碼（尤其 Docker backend）。
   - 先看 backend startup log 是否有：
     - `[startup] council routes enabled at /api/council/* | mode=...`
2. **代理路徑一致性**
   - 使用者入口若為 `http://localhost:5173`，確認 Vite proxy 指向的 `localhost:4000` 就是最新 backend。
3. **前端 re-render 是否完全收斂**
   - 確認 console 不再出現 `Maximum update depth exceeded`。

## 推薦驗證清單（交接後立刻跑）
1. 登入後打開 AI 頁面，5 秒內 `Council 狀態` 需變成明確狀態（非長期連線中）。
2. 啟動 Council，觀察：
   - 聊天室按回合更新
   - `會議即時共識（Live）` 每輪刷新（interim/final tag）
3. 關閉分頁 1-2 分鐘後重開：
   - 會議繼續跑、訊息可補齊、狀態可恢復
4. backend 重啟後再進頁：
   - 無 crash、無 update depth error、狀態可恢復
5. 若 sessions endpoint 不可用：
   - 只出現一次降級提示，不可持續 404 spam

## 目前關鍵檔案（供下一位 agent直接看）
- `apps/frontend/src/pages/AiRecommendation.tsx`
- `apps/frontend/src/style.css`
- `apps/frontend/src/hooks/useCouncilSocket.ts`
- `apps/backend/src/lib/councilService.js`
- `apps/backend/src/lib/ai/council/orchestrator.js`
- `apps/backend/src/routes/council.js`
- `apps/backend/src/index.js`
- `apps/backend/src/councilScheduler.js`

## 風險與備註
- Repo 目前是大型 dirty tree（很多既有改動與新檔），下一位 agent 要避免誤回滾非本議題檔案。
- 若使用 Docker，請優先確認 container 內 code 版本；目前不穩定最可能來自「前端已更新、backend 還在舊版」。
