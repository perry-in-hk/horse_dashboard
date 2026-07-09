# 智能分析（AI）— 複習過往賽馬日

> 適用頁面：**智能分析（AI）**（`AiRecommendation.tsx`）  
> 最後更新：2026-07-09

---

## 1. 問題現象

- 昨日（或更早）的賽馬日從 **「賽馬日／場地」** 下拉選單消失。
- 下拉選單只剩**即將開跑**的場次，例如 `2026-07-12 · ST`。
- 想複習昨日 AI 議會對話，但找不到 `2026-07-08` 等日期。

---

## 2. 下拉選單的兩個資料來源

「賽馬日／場地」會合併兩個 API 的結果：

| 來源 | API | 內容 | 賽事日結束後 |
|------|-----|------|--------------|
| **即時場次** | `GET /api/realtime/meetings` | 馬會 API 的當日／即將開跑賽事 | **會自動移除**（正常） |
| **歷史 AI 場次** | `GET /api/council/meeting-history` | 資料庫內曾「啟動議會」的賽馬日 | **會保留**，標示 **「· 歷史」** |

合併邏輯見 `apps/frontend/src/pages/AiRecommendation.tsx` 的 `mergeMeetings()`。  
後端歷史查詢見 `apps/backend/src/routes/council.js` → `GET /meeting-history`（讀取 `hkjc_council_sessions`）。

因此：**昨日場次從「即時」列表消失是預期行為**；若當日曾跑過 AI 議會，應仍可在歷史列表找到。

---

## 3. 如何選取過往賽事複習

在 **智能分析（AI）** 頁面上方工具列 **「場次」** 區：

1. **賽馬日／場地** — 選帶 **「· 歷史」** 的項目（例：`2026-07-08 · HV · 歷史`）。
2. **場次** — 選要複習的第幾場。
3. **歷史會議**（右側「設定」區）— 選該場的會議紀錄（`#session_id · N 則 · 已結束`）。
4. 下方 **議會聊天室** 會載入該次會議的對話與共識。

其他操作：

- **刷新**（歷史會議旁）— 重新載入該場的 session 列表。
- **下載 Markdown** — 匯出完整會議紀錄（訊息、FINAL 共識、正式賽果）。
- **取得正式賽果** — 向馬會抓取名次與派彩並寫入資料庫。

---

## 4. 重要限制

### 4.1 只有「啟動過議會」的場次才會進歷史

歷史列表**只包含**曾按 **「啟動議會」** 的賽馬日／場次。  
若某日從未啟動 AI 議會，該日**不會**出現在「賽馬日／場地」下拉選單，即使 Analysis 頁面已有賽果。

### 4.2 注意場地代碼（HV / ST）

日期與場地必須對應正確，例如：

| 日期 | 場地 | 下拉選單顯示 |
|------|------|--------------|
| 2026-07-08 | **HV**（跑馬地） | `2026-07-08 · HV · 歷史` |
| 2026-07-12 | **ST**（沙田） | `2026-07-12 · ST`（即時） |

不要假設某日一定是沙田（ST）；請以選單上的 **HV / ST** 為準。

### 4.3 僅部分場次有議會紀錄

以本機資料庫為例（2026-07-08 HV）：

- 有 AI 議會紀錄：**第 2–9 場**
- **第 1 場** 無議會紀錄 → 不會出現在該日的「場次」列表

---

## 5. 疑難排解：完全看不到歷史日期

### 5.1 前端 Docker 映像過舊（常見）

**症狀：** 下拉選單只有即時場次（如 `2026-07-12 · ST`），完全沒有「· 歷史」選項。

**原因：** `meeting-history` 合併功能於 **2026-07-09** 加入前端（commit `aa5d210`）。若 frontend 容器在該日之前 build，後端雖有 API，舊前端**不會**呼叫 `/api/council/meeting-history`。

**修復（本機 Docker）：**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build frontend
```

然後瀏覽器 **強制重新整理**（`Ctrl + Shift + R`）。

**驗證新映像是否含歷史功能：**

```bash
docker exec hkjc-frontend grep -r meeting-history /app/apps/frontend/src
```

應能看到 `AiRecommendation.tsx` 內的 `api/council/meeting-history`。

### 5.2 遠端伺服器（Linode）未重建

若使用 `https://<SITE_ADDRESS>/`，需在伺服器上 `git pull` 後重建 frontend：

```bash
docker compose up -d --build frontend
```

詳見 [`docs/DEPLOY_LINODE.md`](DEPLOY_LINODE.md)。

### 5.3 確認資料庫是否有議會紀錄

在伺服器或本機：

```bash
docker exec hkjc-postgres psql -U hkjc -d hkjc_dashboard -c \
  "SELECT meeting_date, venue_code, COUNT(*) AS sessions,
          MIN(race_no) AS min_race, MAX(race_no) AS max_race
   FROM hkjc_council_sessions
   GROUP BY meeting_date, venue_code
   ORDER BY meeting_date DESC;"
```

若某日沒有列印結果，代表該日從未啟動議會，下拉選單不會出現該日。

### 5.4 API 是否正常（需已登入）

後端日誌應出現 `GET /api/council/meeting-history 200`（非僅 `401`）：

```bash
docker logs hkjc-backend 2>&1 | grep meeting-history
```

未登入時 API 回 `401` 屬正常；已登入的瀏覽器 session 應回 `200` 或 `304`。

---

## 6. 預期畫面（修復後）

「賽馬日／場地」應至少包含：

```
2026-07-12 · ST          ← 即時（下一個賽馬日）
2026-07-08 · HV · 歷史   ← 昨日（曾跑過 AI 議會）
```

選 `2026-07-08 · HV · 歷史` 後，「場次」可選第 2–9 場，再在「歷史會議」選要複習的 session。

---

## 7. 相關文件

| 文件 | 說明 |
|------|------|
| [`AI_COUNCIL_SESSION_SUMMARY.md`](AI_COUNCIL_SESSION_SUMMARY.md) | AI 議會架構、API、環境變數 |
| [`AI_COUNCIL_ISSUES_AND_ARCHITECTURE.md`](AI_COUNCIL_ISSUES_AND_ARCHITECTURE.md) | 已知問題與本機 dev 注意事項 |
| [`DEPLOY_LINODE.md`](DEPLOY_LINODE.md) | 遠端部署與 `docker compose` 重建 |

---

## 8. 相關程式碼

```
apps/frontend/src/pages/AiRecommendation.tsx   # mergeMeetings、下拉選單、歷史會議
apps/backend/src/routes/council.js           # GET /meeting-history
apps/backend/src/lib/councilService.js         # session 讀寫
```

DB 表：`hkjc_council_sessions`、`hkjc_council_messages`、`hkjc_council_picks`。
