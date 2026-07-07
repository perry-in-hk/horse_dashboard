# Keycloak 登入／登出問題總結

> 最後更新：2026-07-08。完整登入與登出流程已在本地 Docker + Vite dev 驗證通過。

---

## 問題現象

| 階段 | 現象 |
|------|------|
| 登入 callback | 前端：`登入失敗：server responded with an error in the response body` |
| 登入 callback | 後端 `GET /api/auth/me` 持續 `401` |
| Keycloak 登入頁 | `Invalid parameter: redirect_uri` |
| Keycloak 登入頁 | `Invalid username or password`（密碼與 Keycloak 後台不一致） |
| Keycloak 登出頁 | `Invalid redirect uri`（`post_logout_redirect_uri` 未白名單） |
| 基礎設施 | `Firefox can't connect to localhost:8080`（Keycloak 未映射 port） |

---

## 主要根因（按影響排序）

### 1. OIDC callback 的 `currentUrl` 與授權階段 `redirect_uri` 不一致（登入最關鍵）

- 授權請求使用 `AUTH_BROWSER_ORIGIN`（例如 `http://localhost:5173`）組出  
  `redirect_uri=http://localhost:5173/api/auth/callback`
- Token 交換卻用 `req.protocol://req.get("host")`（Vite proxy 後常為 `http://localhost:4000/...`）
- Keycloak 回 `invalid_grant` / `Incorrect redirect_uri`
- `openid-client` 對外顯示：`ResponseBodyError: server responded with an error in the response body`
- 參考：[panva/openid-client#782](https://github.com/panva/openid-client/issues/782)

**修復**：`exchangeAuthorizationCode` 改用 `getBrowserOrigin(req)` 組 `currentUrl`（`apps/backend/src/keycloak.js`）。

### 2. Post-logout redirect URI 未設定或格式錯誤（登出）

- 登出導向 `http://localhost:5173/login`，但 client 的 `post.logout.redirect.uris` 為 `+`（僅沿用 login callback URI）
- `/login` ≠ `/api/auth/callback`，Keycloak 拒絕
- 多個 URI 必須以 `##` 分隔（**不是空格**）

**修復**：在 `infra/docker/keycloak/realm-hkjc.json` 與執行中 client 設定：

```
http://localhost:5173/login##http://localhost/login##http://localhost:4000/login##https://localhost/login##https://*/login
```

### 3. Keycloak client secret 不一致

- 後端 `KEYCLOAK_CLIENT_SECRET` 與 Keycloak client `hkjc-dashboard` secret 不同
- Token 交換回 `unauthorized_client` / `invalid_client_credentials`

### 4. Realm 角色未進入 ID token

- `roles` scope 的 realm roles mapper 預設只寫 access token
- 後端最初只讀 ID token claims → `Missing dashboard role`

**修復**：啟用 mapper 的 `id.token.claim`；後端合併 ID token 與 access token 角色。

### 5. `dashboard_users` upsert 與 partial unique index 不匹配

- `ON CONFLICT (keycloak_sub)` 無法對應 partial index  
  `WHERE keycloak_sub IS NOT NULL`
- Postgres 錯誤：`there is no unique or exclusion constraint matching the ON CONFLICT specification`

**修復**：改為 `ON CONFLICT (keycloak_sub) WHERE keycloak_sub IS NOT NULL`。

### 6. 其他基礎設施問題

- Keycloak 容器未映射 `8080:8080`
- Healthcheck 使用 image 內不存在的 `wget`
- Postgres 缺少 `keycloak` database

---

## 已完成修復（程式碼）

### 基礎設施 / Docker

- `docker-compose.yml`：Keycloak 服務、`8080:8080`、健康檢查、realm import
- `infra/docker/postgres/init-keycloak.sql`：建立 `keycloak` database
- `infra/docker/Caddyfile`：`/auth*` → Keycloak
- `infra/docker/keycloak/realm-hkjc.json`：client、redirect URI、post-logout URI

### 後端 OIDC（`apps/backend/src/keycloak.js`、`routes/authHandlers.js`）

- Login / callback / logout OIDC 流程（`openid-client`）
- Callback `currentUrl` 與 `redirect_uri` 一致
- 角色從 ID token + access token 合併讀取
- Callback 錯誤顯示 Keycloak 具體描述（非模糊英文）
- Session regenerate（降低 session fixation 風險）
- 移除本機密碼登入（`bootstrapAdmin.js`、`routes/users.js`）

### 前端

- `Login.tsx`：導向 `/api/auth/login`（Keycloak OIDC）
- `Settings.tsx`：帳號由 Keycloak 管理，移除本機 User Admin

---

## 環境變數（`.env`）

| 變數 | 說明 |
|------|------|
| `KEYCLOAK_CLIENT_SECRET` | 與 Keycloak client `hkjc-dashboard` secret **必須一致** |
| `KEYCLOAK_PUBLIC_BASE_URL` | 瀏覽器可達的 Keycloak URL，本機 dev 常為 `http://localhost:8080/auth` |
| `KEYCLOAK_INTERNAL_BASE_URL` | 後端容器內 URL，通常 `http://keycloak:8080/auth` |
| `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` | Keycloak 管理員（`/auth/admin`） |
| `AUTH_BROWSER_ORIGIN` | **Vite dev 必填**：`http://localhost:5173`；Docker+Caddy 可省略（用 `X-Forwarded-*`） |
| `SESSION_SECRET` | Session cookie 簽章 |
| `SESSION_COOKIE_SECURE` | 本機 HTTP dev 設 `false`；正式 HTTPS 設 `true` |

---

## Keycloak client 檢查清單（`hkjc-dashboard`）

### Valid redirect URIs

```
http://localhost:5173/api/auth/callback
http://localhost/api/auth/callback
http://localhost:4000/api/auth/callback
https://localhost/api/auth/callback
https://*/api/auth/callback
```

### Valid post logout redirect URIs（`##` 分隔）

```
http://localhost:5173/login##http://localhost/login##http://localhost:4000/login##https://localhost/login##https://*/login
```

### 使用者與角色

1. 在 realm `hkjc` 建立使用者（例如 `dashboard_admin`）
2. 指派 realm role：`admin` 或 `user`（後端只接受這兩種）
3. 密碼在 Keycloak 管理，**不是** Postgres 或 app 本機密碼

重設密碼範例：

```powershell
docker exec hkjc-keycloak /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080/auth --realm master --user admin --password <KEYCLOAK_ADMIN_PASSWORD>

docker exec hkjc-keycloak /opt/keycloak/bin/kcadm.sh set-password -r hkjc --username dashboard_admin --new-password "<新密碼>"
```

更新 post-logout URI（執行中環境，已 import 的 realm 不會自動套用 JSON 變更）：

```powershell
# 建立 patch JSON 後：
docker cp infra/docker/keycloak/client-logout-patch.json hkjc-keycloak:/tmp/patch.json
docker exec hkjc-keycloak /opt/keycloak/bin/kcadm.sh update clients/<CLIENT_UUID> -r hkjc -f /tmp/patch.json
```

`CLIENT_UUID` 可查：`kcadm.sh get clients -r hkjc -q clientId=hkjc-dashboard --fields id`

---

## 實際驗證結果（2026-07-08）

- [x] `docker compose ps`：backend / keycloak / postgres / redis healthy
- [x] `GET /api/auth/login` → `302` 至 Keycloak
- [x] `dashboard_admin` 完整登入 → `/analysis`，`/api/auth/me` → `200`
- [x] 角色映射 `admin` 通過後端授權
- [x] 登出 → 回到 `http://localhost:5173/login`（無 Keycloak 錯誤頁）

---

## 防再發建議

1. **固定 dev `.env`**，避免舊 shell 覆蓋 `KEYCLOAK_CLIENT_SECRET`
2. **Vite dev 必設** `AUTH_BROWSER_ORIGIN=http://localhost:5173`；**Linode 不要設**
3. **Post-logout URI** 用 `##` 分隔；勿假設 `+` 涵蓋 `/login`
4. **生產環境勿映射** host `4000` / `8080`（僅 Caddy `80`/`443` 對外；本機用 `docker-compose.dev.yml`）
5. 部署 SOP 寫入：redirect URI、post-logout URI、secret 同步流程
6. 考慮啟動前檢核 `KEYCLOAK_*` 與 discovery endpoint 可達性

---

## 相關文件

| 文件 | 內容 |
|------|------|
| `docs/DEPLOY_LINODE.md` §5 C5 | 正式部署 Keycloak 設定 |
| `docs/POST_DEPLOY.md` | Linode 部署後操作（`lord-in-hk.ccwu.cc` 範例） |
| `docs/PROJECT_HANDOFF.md` | 專案交接與架構 |
| `.env.example` | 環境變數範本 |
