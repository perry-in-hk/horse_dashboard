# HKJC Dashboard — 專案與 UI 變更交接文件

> 供後續 AI / 開發者快速接手。最後更新：2026-07-08。

---

## 1. 專案是什麼

**HKJC Dashboard** 是一套 Docker 化的香港賽馬資料平台，整合：

| 能力 | 說明 |
|------|------|
| 歷史分析 | 賽果、派彩、馬匹近績、圖表比較 |
| 即時監控 | HKJC 賠率快照同步、走勢圖、QIN/QPL 矩陣 |
| 智能分析 | 後端組裝 prompt → OpenAI 相容 API → 結構化分析並存 DB |
| 資料維護 | Scraper 觸發歷史/馬匹抓取、Database 瀏覽與快照 purge |
| 管理 | 本地帳密登入、admin 帳號管理、Settings 系統流程圖 |

**技術棧**

- Monorepo（npm workspaces）：`apps/backend`、`apps/frontend`、`services/scraper`、`services/recommender`
- 前端：React + Vite + TypeScript，ECharts、Mermaid、ReactMarkdown
- 後端：Express 5、PostgreSQL、express-session（cookie）、背景 odds sync worker
- 部署：Docker Compose + Caddy（TLS / 反向代理）

**重要邊界**

- UI 重設計**不改**後端 API path 與資料契約。
- 產品文案應專業、繁中為主；避免在 UI 暴露 env 變數教學或實作細節（見 `.cursor/skills/professional-product-ui/SKILL.md`）。

---

## 2. 目錄結構（精簡）

```
HKJC_Dashboard/
├── apps/
│   ├── backend/          # Express API、migration、odds worker
│   └── frontend/         # React SPA
├── services/
│   ├── scraper/          # historical / horse-details CLI
│   └── recommender/      # 規則推薦 worker（Compose 內 idle）
├── infra/docker/         # Dockerfile、Caddyfile
├── docs/                 # 部署與交接文件
├── design_idea/          # 早期 Ollama 風格設計參考（DESIGN.md）
├── docker-compose.yml
├── .env.example
└── package.json          # dev:backend、dev:frontend、docker:* scripts
```

---

## 3. 執行方式

### 3.1 Docker（建議，使用者已確認用 Docker）

```powershell
# 專案根目錄
docker compose up -d postgres redis backend frontend caddy
```

| 入口 | URL | 用途 |
|------|-----|------|
| Vite 本機 dev | `http://localhost:5173` | 前端 hot reload；`/api` proxy → `:4000` |
| Backend 健康檢查 | `http://localhost:4000/health` | **已加** `4000:4000` port mapping |
| Caddy 全站 | `https://localhost` | Compose 內 frontend + backend；HTTP 308 → HTTPS |

**`.env` 必備（根目錄）**

- `POSTGRES_PASSWORD`、`DATABASE_URL`（Docker 內用 `@postgres:5432`）
- `SESSION_SECRET`
- `AUTH_INITIAL_USERNAME`、`AUTH_INITIAL_PASSWORD`（僅空 DB 首次初始化）
- `SESSION_MAX_AGE_HOURS`（建議 24）
- `AUTH_BROWSER_ORIGIN=http://localhost:5173`（**Vite dev 必填**；Docker+Caddy 可省略）
- `SITE_ADDRESS`（本機常為 `localhost`）
- 本機 Vite + HTTP 登入：`SESSION_COOKIE_SECURE=false`

**登入疑難排解**：確認 `dashboard_users` 有帳號、`password_hash` 非空，並檢查 `dashboard_audit_log`。

**常見 Docker 問題**

1. **Login 502**：backend 未跑或 `:4000` 未映射 → `docker compose ps backend`，確認 `0.0.0.0:4000->4000`。
2. **Postgres 重建** 會斷 backend 連線 → `docker compose up -d backend`。
3. **Caddy mount 錯誤（exit 127）**：舊容器綁到錯誤專案路徑 → `docker compose up -d --force-recreate caddy`。
4. **勿混用** 本機 Windows Postgres（`:5432`）與 Docker Postgres 的 `DATABASE_URL` 密碼。

### 3.2 本機前端 dev

```powershell
npm run dev:frontend   # apps/frontend → :5173
```

Backend 必須在 `:4000` 可達（Docker backend 或本機 `npm run dev:backend`）。

**本機 backend dev 注意**

- `apps/backend/package.json` 的 `dev` 腳本：
  ```json
  "dev": "node --env-file=../../.env --env-file=.env.local --watch src/index.js"
  ```
- `apps/backend/.env.local`（gitignore 建議）可覆寫 `DATABASE_URL` 為 `@localhost:5432`（僅本機 Postgres 時）。
- Docker 環境**不要**用 `.env.local` 覆寫；以 Compose 的 `postgres` hostname 為準。

---

## 4. 前端架構（重設計後）

### 4.1 App Shell

| 元件 / 檔案 | 職責 |
|-------------|------|
| `App.tsx` | 路由、sidebar 開合狀態、頂部標題 |
| `AppSidebar.tsx` | 分組導覽、ThemeToggle、登出 |
| `layout.css` | Shell、sidebar、topline |
| `components.css` | 按鈕、card、controls、PageHeader 基礎樣式 |
| `style.css` | 頁面專用樣式（仍較大，逐步 class 化） |
| `theme.css` | CSS variables（dark / light） |
| `theme/ThemeContext.tsx` | 主題 state + localStorage |
| `themeTokens.ts` | TS 色票 + ECharts 主題函式 |

**路由**（皆需登入，除 `/login`）

| Path | Page | 側欄分組 |
|------|------|----------|
| `/analysis` | Analysis | 分析 |
| `/compare` | Compare | 分析 |
| `/realtime` | Realtime | 分析 |
| `/ai` | AiRecommendation | 分析 |
| `/database` | Database | 資料 |
| `/scraper` | Scraper | 工具 |
| `/settings` | Settings | 系統 |

### 4.2 設計方向（已定案）

- **視覺**：灰階為主 + 品牌色（深藍 `#354168`、淺金 `#F1D664`）
- **導覽**：左側分組 sidebar（非舊 topbar tab）
- **主題**：預設 dark；light/dark 切換
- **元件模式**：`PageHeader`、`card`、`controls`、`field-label`、`btn btn-primary|secondary|ghost`
- **狀態**：各頁需有 loading / error / empty，避免 API 靜默失敗

### 4.3 UI 重設計階段摘要

#### Phase 1 — Design System + Shell

- 新增 `theme.css`、`ThemeContext`、`themeTokens.ts`（dark/light）
- 新增 `AppSidebar`、`PageHeader`、`ThemeToggle`、`layout.css`、`components.css`
- 移除橫向 topbar 導覽邏輯（`style.css` 內 topbar 規則已刪）

#### Phase 2 — 核心頁（Analysis / Compare / Realtime）

- 整合 `useTheme()` → ECharts 動態配色
- IA 重排：情境 → 操作 → 結果
- 搜尋結果改 `button`（可鍵盤操作）
- Realtime：context card、pool lock、auto-sync 文案繁中化

#### Phase 3 — 剩餘頁（Login / Scraper / Settings / Database / 智能分析）

- **Login**：繁中表單、`btn btn-primary`、focus-visible
- **Scraper**：狀態列 → 任務卡 → 同區日誌；移除 npm CLI 教學字串
- **Settings**：可摺疊 Mermaid 流程圖；admin 可在頁面中建立帳號與角色
- **Database**：表選擇 → 預覽 → 可摺疊 Schema → 快照維護；`modal-*` / `db-*` class
- **智能分析**：情境卡 → 操作列 → 結果區；精簡 meta
- **共用 CSS**：`page-intro`、`status-line`、`action-row`、`modal-backdrop` 等

#### Phase 3 後增量變更

| 變更 | 檔案 | 說明 |
|------|------|------|
| Favicon / Logo | `public/favicon.svg`、`AppLogo.tsx`、`site.webmanifest` | 深藍底 + 金色 H；側欄與登入頁共用 |
| Sidebar 可完全隱藏 | `App.tsx`、`layout.css` | 桌面：`collapsed` → width 0；頂部 `☰`/`✕` 切換 |
| Theme 只在側欄 | `App.tsx` | 已從 header 移除 `ThemeToggle` |
| Docker backend port | `docker-compose.dev.yml` | 本機 dev 映射 `4000:4000`；Linode 生產僅 Caddy 對外 |
| Backend dev env | `apps/backend/package.json` | `--env-file=../../.env --env-file=.env.local` |
| Database 筆數 / allowlist | `apps/backend/src/routes/db.js` | 修正統計為 0 的問題；加入 `hkjc_odds_snapshots` 等；清單與預覽 allowlist 一致；排除 `session` |
| Racecard 馬號 / 後備馬 | `hkjcOddsClient.js`、`Realtime.tsx`、Council/`/api/ai` | 見下方 §4.4 |

### 4.4 Racecard 馬號與後備馬（2026-07-08）

**問題**：Realtime「Race field (HKJC racecard)」把後備馬（Standby）的空 `no` 正規化成 `0`，列表顯示 `#0`，易與正式出賽馬號混淆。

**約定（與 AI Council 一致）**

| 欄位 | 意義 |
|------|------|
| `no` | 正式出賽**下注馬號**（對應 WIN `combString`，例 `01`→`1`） |
| `is_standby` / `standby_no` | 後備馬；`no` 為 `null`，**不可**當成馬號 `0` |
| `horse_code` | HKJC 馬匹編號（例 `K056`）；AI 用此對應近績後再映回 `#馬號` |

**行為**

- Realtime Race field：出賽馬顯示數字馬號；後備顯示 **`Back Up`**，並**排在名單底部**。
- AI Council / `/api/ai` analyze：context 只載入已出賽馬（`no > 0` 且非 standby），picks 驗證只接受本場合法馬號。
- 核對方式：出賽馬 `no` 應與該場 WIN pool 的 `combString` 一致；後備馬不會出現在 WIN 盤。

**主要檔案**：`apps/backend/src/lib/hkjcOddsClient.js`、`apps/frontend/src/pages/Realtime.tsx`、`apps/backend/src/lib/councilService.js`、`apps/backend/src/routes/ai.js`、`apps/backend/src/lib/ai/prompts.js`、`apps/backend/src/lib/ai/buildRaceContext.js`。

---

## 5. 後端要點

- 入口：`apps/backend/src/index.js`
- 啟動時：`runMigrations()`
- Auth（本地帳密 + session）：`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`；實作見 `authHandlers.js`、`middleware/auth.js`
- 主要路由前綴：`/api/analytics`、`/api/realtime`、`/api/scraper`、`/api/db`、`/api/ai`
- Odds worker：`oddsSyncWorker.js`（interval 可經 Realtime API 調整）
- Scraper UI 觸發：`POST /api/scraper/run`

### 5.1 Database 瀏覽 API（`/api/db`）

需登入。實作於 `apps/backend/src/routes/db.js`。

| 端點 | 說明 |
|------|------|
| `GET /api/db/tables` | 可瀏覽資料表清單 + 約略筆數 |
| `GET /api/db/tables/:name/columns` | 欄位結構 |
| `GET /api/db/tables/:name/preview?limit=&offset=` | 分頁預覽（唯讀） |

**Allowlist（2026-07-07 更新）**

僅下列表可預覽；清單 API 也只回傳這些表（避免點選後 403）：

- `hkjc_race_results`、`hkjc_dividends`、`hkjc_local_race_events`
- `hkjc_horse_details`、`hkjc_horse_race_history`
- `hkjc_merged_race_data`（VIEW）
- `hkjc_ai_analyses`、`hkjc_odds_snapshots`
- `dashboard_users`

**刻意排除**：`session`（express-session / connect-pg-simple 內部表，含 cookie 工作階段，不應在 Database UI 暴露）。

**筆數估算**

1. 優先使用 `pg_stat_user_tables.n_live_tup` 與 `pg_class.reltuples`（正確 join schema）。
2. 若統計仍為 0（常見於 bulk scrape 後尚未 `ANALYZE`），後端對該表 fallback `COUNT(*)`，使 Database 頁「約 N 筆」與預覽總數一致。

新增可瀏覽表時：同步更新 `TABLE_ALLOWLIST` 與本文件。

---

## 6. 前端開發慣例

1. **新 UI** 優先用現有 class（`components.css` + `style.css` 頁面 scope），少加 inline style。
2. **圖表** 用 `useTheme()` + `getThemeTokens()` / `themeTokens.ts` 內 helper。
3. **Mermaid**（Settings）跟 `useTheme().isDark` 切換 `themeVariables`。
4. **API** 用 `apiFetch()`（`src/api/client.ts`），Auth 用 `AuthContext`。
5. **文案** 使用者面向用繁中；技術識別符（表名、API pool code）可保留英文。
6. **不要** 在未請求時修改 plan 檔或大量提交 dist 產物。

---

## 7. 驗收清單（UI 相關）

- [ ] `npm run build`（`apps/frontend`）通過
- [ ] Dark / light 切換正常（sidebar 底部）
- [ ] Sidebar 桌面可隱藏/展開；手機抽屜正常
- [ ] 各頁有 error/loading 回饋
- [ ] Login 在 backend `:4000` 可達時成功
- [ ] Favicon 在分頁顯示（必要時 hard refresh）

---

## 8. 相關文件

| 文件 | 內容 |
|------|------|
| `README.md` | 專案概覽、Scraper、schema |
| `docs/DEPLOY_LINODE.md` | Linode / Caddy / DB 遷移 |
| `docs/POST_DEPLOY.md` | **部署後** 本地帳密登入設定與驗證 |
| `docs/KEYCLOAK_LOGIN_ISSUE_SUMMARY.md` | Keycloak 舊版遷移歷史（封存） |
| `docs/CYBER_SECURITY.md` | VPS 安全 |
| `.cursor/skills/deploy-linode-hkjc/SKILL.md` | 部署技能 |
| `.cursor/skills/professional-product-ui/SKILL.md` | UI 文案規範 |
| `design_idea/DESIGN.md` | 早期灰階 pill 設計參考 |

---

## 9. 給下一個 AI 的建議起點

1. 讀 `apps/frontend/src/App.tsx` + `layout.css` 理解 shell。
2. 讀 `theme.css` + `themeTokens.ts` 理解主題。
3. 改某一頁時，對照 Phase 2/3 同類頁面模式（例如 Compare 的 card + controls + error state）。
4. 跑 `npm run build` 確認 TypeScript。
5. 若涉及登入/API：先確認 `http://localhost:4000/health` 與 Docker compose 狀態。

---

## 10. 尚未完成 / 可選後續

- `style.css` 仍偏大，可繼續拆到 page-scoped 或 CSS modules。
- README 的 Quick Start 仍寫 `:5173` 為 Compose frontend；本機 dev 與 Caddy `:443` 路徑可再統一說明。
- 舊路徑 `Desktop/HKJC_Dashboard` 的 Docker volume 若存在，可能與 `perry_linode/HKJC_Dashboard` 混淆——必要時 `docker compose down` 後重建容器。
- `apps/backend/.env.local` 為本機開發輔助，提交前勿含密碼。
