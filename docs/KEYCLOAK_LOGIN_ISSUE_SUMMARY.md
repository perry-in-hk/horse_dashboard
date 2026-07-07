# Keycloak 登入問題總結

## 問題現象

- 前端顯示：`登入失敗：server responded with an error in the response body`
- 後端 `GET /api/auth/me` 持續回傳 `401`
- Keycloak 頁面曾出現：
  - `Invalid parameter: redirect_uri`
  - `Invalid username or password`
- 一度出現無法連線：`Firefox can’t connect to localhost:8080`

---

## 主要根因（按影響排序）

1. **Keycloak client secret 不一致（最關鍵）**
   - 後端容器實際使用 `KEYCLOAK_CLIENT_SECRET=dev-secret`
   - Keycloak client `hkjc-dashboard` 使用的是另一組 secret
   - 導致 callback 交換 token 時回 `unauthorized_client` / `invalid_client_credentials`

2. **redirect URI 在 dev proxy 場景被組成 `http://localhost:4000/...`**
   - Keycloak client 未允許該 URI，回 `invalid_redirect_uri`
   - 原因是從 `:4000` host 推導 callback，未正確回落到前端 origin

3. **Keycloak 容器未對主機映射 `8080`**
   - `localhost:8080` 無法連線，使用者無法進入 admin 或登入頁

4. **Keycloak healthcheck 指令不相容**
   - healthcheck 用 `wget`，但 image 內無 `wget`
   - 造成容器實際已啟動但健康狀態不正確

---

## 已完成修復

### 基礎設施 / Docker

- 在 `docker-compose.yml` 新增 Keycloak 服務與依賴
- 新增 `8080:8080` port mapping（可直接開 `http://localhost:8080`）
- 調整 Keycloak healthcheck 為可執行命令（不依賴 `wget`）
- 建立 Postgres `keycloak` database（解決 `database "keycloak" does not exist`）

### 後端 OIDC

- 新增 `apps/backend/src/keycloak.js`，導入 `openid-client`
- 實作 login / callback / logout OIDC 流程
- 增加 dev 場景容錯（origin/host 推導 callback URI）
- callback 登入後做 session regenerate，降低 session fixation 風險

### Keycloak 與帳號

- 建立新的 Keycloak admin：`admin2`
- 建立 realm `hkjc` 測試使用者：`dashboard_admin`
- 指派 `admin` realm role
- 將 Keycloak client `hkjc-dashboard` secret 與 backend `.env` 同步

### 設定檔

- 補齊 `.env`：
  - `KEYCLOAK_CLIENT_SECRET`
  - `KEYCLOAK_ADMIN_PASSWORD`
  - `KEYCLOAK_PUBLIC_BASE_URL`
  - `KEYCLOAK_INTERNAL_BASE_URL`
  - `AUTH_BROWSER_ORIGIN`

---

## 實際驗證結果

- `docker compose ps`：核心服務可啟動（backend/keycloak/postgres/redis healthy）
- `GET /api/auth/login`：可回 `302` 導向 Keycloak 授權端點
- 先前 `500` 的主要錯誤（issuer mismatch、invalid client credentials）已逐步定位與修補

---

## 仍需最終確認（使用者操作）

1. 以 `dashboard_admin` 走完整登入流程（Dashboard -> Keycloak -> callback）
2. 確認 `GET /api/auth/me` 回 `200`
3. 確認角色映射（`admin`）可通過後端授權邏輯

---

## 防再發建議

- 固定一份本地開發設定，避免環境變數被舊 shell 覆蓋（如 `dev-secret`）
- 將 OIDC 相關 env 檢查做成啟動前檢核（startup validation）
- 為 `/api/auth/callback` 增加更明確的錯誤分類日誌（redirect/client_secret/role 缺失）
- 將 Keycloak client 設定（redirect URI、web origin、secret 管理）寫入部署 SOP
