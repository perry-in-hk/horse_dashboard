# HKJC AI Council 問題總結與新架構說明

## 文件目的

本文件整理本次 AI Council（LLM Council）改版的：

1. 已發生問題（Problem List）
2. 根因分析（Root Cause）
3. 已完成修復（Fixes Applied）
4. 新系統架構（Backend / Frontend / Infra）
5. 驗證重點與後續建議（Validation & Next Steps）

---

## 一、問題總表（含根因與處置）

### P1. Login 失敗（502 Bad Gateway）

**現象**
- 瀏覽器呼叫 `POST /api/auth/login` 回 `502`
- 發生於 `http://localhost:5173`（Vite dev 入口）

**根因**
- `localhost:5173` 走的是 Vite proxy，會轉發到 `http://localhost:4000`
- 但 backend 在 Docker compose（非 dev override）下未對 host 暴露 `4000`
- 造成 Vite proxy 無法連到 backend，回傳 502

**修復**
- 以 dev override 啟動 backend（暴露 host port）：
  - `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d backend`

**結果**
- `http://localhost:4000/health` 可達
- `http://localhost:5173/api/*` 不再因連不到 backend 而 502

---

### P2. Login 失敗（502）於 `https://localhost`（Caddy）

**現象**
- Caddy log 出現 `dial tcp: lookup backend: i/o timeout`

**根因**
- backend 容器重建後，Caddy 對 `backend` service name 的解析暫時失效

**修復**
- 重啟 Caddy 使 upstream DNS 狀態刷新：
  - `docker compose restart caddy`

**結果**
- `https://localhost/health` 可達
- `/api/auth/*` 回應恢復正常（帳密錯誤時應為 401/Invalid credentials，而非 502）

---

### P3. WebSocket 尚未連線（Council 無法啟動）

**現象**
- UI 顯示 `WebSocket 尚未連線`
- 使用 `http://localhost:5173` 時最明顯

**根因**
- `.env` 的 `VITE_WS_URL` 指向遠端（例如 `ws://139.162...:4000/ws`）
- 本機頁面（localhost）卻連遠端 WS，session cookie 因網域不一致不會帶上
- backend 的 WS upgrade 驗證 session 失敗，前端判定未連線

**修復**
- 更新 `useCouncilSocket` 的 WS base 解析 guardrail：
  - 遠端頁面 + localhost WS 設定 => fallback 同源
  - localhost 頁面 + 遠端 WS 設定 => fallback 同源
- 確保本機 dev 走 `ws://localhost:5173/ws/council...`（由 Vite proxy 轉 backend）

**結果**
- 避免 `.env` 的錯誤 WS 目標污染本機開發連線

---

### P4. Council 顯示「運行中」但聊天室沒有對話

**現象**
- UI 狀態：`當日已啟用 · 會議運行中`
- 但訊息區為空或只見使用者訊息

**根因 A（主要）**
- Bookie（Stage 3）回傳 JSON 不穩定（欄位型別/欄位名/結構偏差）
- Zod schema 驗證失敗後整輪 throw，Stage 訊息與 picks 不中繼

**根因 B（重啟後常見）**
- `getMessages()` 優先依 in-memory active session
- backend 重啟後記憶體狀態清空，若未 fallback 至 DB 最新 session，畫面像「無歷史訊息」

**修復**
- `picksSchema` 新增 normalization，容忍常見格式偏差（array/null/number/欄位別名）
- `orchestrator` 新增 fallback picks 機制：即使 Bookie JSON 壞掉，也不再整輪失敗
- `getMessages()` 新增 DB fallback：無 active session 時載入該場次最新 persisted session 訊息

**結果**
- Round 不再因 Stage 3 JSON 嚴格失敗而全盤中止
- 重啟後仍可回看歷史對話與 picks

---

## 二、新架構（Council 版本）

### 1) Frontend 層

**主要頁面 / Hook**
- `apps/frontend/src/pages/AiRecommendation.tsx`
- `apps/frontend/src/hooks/useCouncilSocket.ts`

**職責**
- Race context（meeting/date/race）選擇
- WebSocket 即時連線、啟動/停止/送訊息
- 顯示 Stage 對話流與右上角 picks（QPL×3 + Others×2）
- 狀態文字：當日啟用、會議運行中、連線狀態

---

### 2) Backend API + WS 層

**入口**
- REST: `apps/backend/src/routes/council.js`
- WS: `apps/backend/src/councilWs.js`
- Server wiring: `apps/backend/src/index.js`

**職責**
- session 驗證（WS upgrade 前驗 session）
- 提供 council 狀態、訊息、啟停與 user message 行為
- 將 council service event 廣播到 WS 客戶端

---

### 3) Council Domain Service 層

**核心服務**
- `apps/backend/src/lib/councilService.js`
- `apps/backend/src/councilScheduler.js`

**職責**
- 管理 active session（in-memory）
- 管理「全站當日啟用」gate（Redis + memory）
- 跑 round、寫入 message/picks、發出事件
- T-5 分鐘自動啟動與定時 round 調度

---

### 4) LLM Orchestration 層（Karpathy Council 模式）

**模組**
- `apps/backend/src/lib/ai/council/agents.js`
- `apps/backend/src/lib/ai/council/callAgent.js`
- `apps/backend/src/lib/ai/council/orchestrator.js`
- `apps/backend/src/lib/ai/council/picksSchema.js`

**流程**
1. Stage 1：多 agent 並行提出觀點
2. Stage 2：匿名互評與排名彙總
3. Stage 3：Bookie 綜合輸出（JSON picks）
4. Schema parse + normalization + persistence + WS broadcast

---

### 5) Data / Infra 層

**資料與時間**
- PostgreSQL：`hkjc_council_sessions` / `hkjc_council_messages` / `hkjc_council_picks`
- Redis：當日啟用鍵值（TTL 至 HKT 午夜）
- 時區工具：`apps/backend/src/lib/timeHkt.js`（統一 UTC+8 / HKT）

**網路路徑**
- Dev：`localhost:5173` -> Vite proxy -> `localhost:4000`（需 dev override）
- Docker/Caddy：`https://localhost` -> Caddy -> `backend:4000`
- WS：`/ws/council` 同路徑代理到 backend

---

## 三、目前穩定版行為（Expected Behavior）

1. 使用者可在 AI 頁面看到 WS 已連線
2. 點「啟動議會」後，session 狀態進入 running
3. Stage 訊息會陸續出現在聊天室
4. 右上角 picks 顯示 QPL 3 筆 + 其他 2 筆
5. 即使 Bookie JSON 偶發異常，系統仍可透過 fallback 持續運行
6. backend 重啟後可回看同場次最新 persisted 訊息

---

## 四、操作建議（本機）

### 開發模式（建議）

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend caddy
docker compose restart caddy
```

### 重要注意

- 若用 `http://localhost:5173`，backend 必須有 `4000:4000` host port 映射
- 若用 `https://localhost`，請觀察 Caddy 是否能解析 upstream `backend`
- `VITE_WS_URL` 不要讓 localhost 頁面強制連遠端 WS（已加 guardrail，但仍建議設定正確）

---

## 五、待優化項目（建議下一步）

1. 在前端增加「目前場次無訊息，最近有資料場次」提示，降低誤判
2. Stage 3 增加 retry/backoff 與更細緻 JSON 修復策略
3. 對 stage_event / parse_warning 做 UI 可視化（方便運維）
4. 補 E2E 測試（login + ws connect + start council + messages + picks）
5. 將 dev/prod 啟動指令寫入統一 runbook，避免入口混用

---

## 六、變更重點檔案（本輪）

- `apps/frontend/src/hooks/useCouncilSocket.ts`
  - WS URL locality guardrail（localhost/remote 雙向保護）
- `apps/backend/src/lib/ai/council/picksSchema.js`
  - Bookie 輸出 normalization + schema 容錯
- `apps/backend/src/lib/ai/council/orchestrator.js`
  - Stage 3 parse/schema 失敗時 fallback picks，不中斷整輪
- `apps/backend/src/lib/councilService.js`
  - `getMessages()` 新增 persisted session fallback

