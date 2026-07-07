# 部署後操作指南（Linode + Keycloak）

> 適用網址範例：`https://lord-in-hk.ccwu.cc/`  
> 完整部署步驟見 `docs/DEPLOY_LINODE.md`；登入疑難排解見 `docs/KEYCLOAK_LOGIN_ISSUE_SUMMARY.md`。

---

## 1. 你已部署成功時，應看到什麼？

| 檢查 | 預期 |
|------|------|
| 開啟 `https://lord-in-hk.ccwu.cc/analysis` | 已登入則進分析頁；未登入則導向 `/login` |
| `https://lord-in-hk.ccwu.cc/health` | `{"ok":true,"service":"backend"}` |
| `docker compose ps` | `caddy`、`backend`、`keycloak`、`postgres` 等為 **healthy / Up** |
| Linode 防火牆 | 只開 **22、80、443**（**不要**開 4000、8080、5432、6379） |

**對外只應經 Caddy**：瀏覽器 → `https://lord-in-hk.ccwu.cc` → Caddy → `/api`（backend）、`/auth`（Keycloak）、其餘（frontend）。

---

## 2. 伺服器 `.env` 必備（生產環境）

在 Linode 專案目錄編輯 `.env`（**勿提交 git**）：

```bash
SITE_ADDRESS=lord-in-hk.ccwu.cc
SESSION_COOKIE_SECURE=true

KEYCLOAK_PUBLIC_BASE_URL=https://lord-in-hk.ccwu.cc/auth
KEYCLOAK_INTERNAL_BASE_URL=http://keycloak:8080/auth
KEYCLOAK_CLIENT_SECRET=<見下方步驟 3 從 Keycloak 複製>

POSTGRES_USER=hkjc
POSTGRES_PASSWORD=<強密碼>
POSTGRES_DB=hkjc_dashboard
DATABASE_URL=postgresql://hkjc:<同上密碼>@postgres:5432/hkjc_dashboard

SESSION_SECRET=<openssl rand -base64 48>
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=<強密碼>
```

**不要**在 Linode 上設定 `AUTH_BROWSER_ORIGIN`（僅本機 Vite `:5173` 需要）。

套用變更：

```bash
cd ~/horse_dashboard   # 你的實際 clone 目錄
docker compose up -d --build
```

---

## 3. 首次部署後：Keycloak 設定（必做）

Realm 首次啟動會 import `hkjc`，但 **client secret 與使用者需你手動確認**。

### 3.1 進入 Keycloak 管理後台

1. 瀏覽器開啟：`https://lord-in-hk.ccwu.cc/auth/admin`
2. 使用 `.env` 的 `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` 登入
3. 左上角選 realm **`hkjc`**（不是 master）

### 3.2 同步 Client Secret

1. **Clients** → **`hkjc-dashboard`**
2. **Credentials** 分頁 → 複製 **Client secret**
3. 寫入伺服器 `.env` 的 `KEYCLOAK_CLIENT_SECRET=...`
4. 重啟 backend：

```bash
docker compose up -d --force-recreate backend
```

### 3.3 確認 Redirect URI（登入）

**Clients** → **hkjc-dashboard** → **Settings**，**Valid redirect URIs** 須包含：

```text
https://lord-in-hk.ccwu.cc/api/auth/callback
```

### 3.4 確認 Post-logout URI（登出）

同一 client → **Valid post logout redirect URIs**（多個 URI 用 **`##`** 分隔，不是空格）：

```text
https://lord-in-hk.ccwu.cc/login
```

若已存在 realm import 設定可略過；登出若出現 **Invalid redirect uri** 再補這項。

### 3.5 建立儀表板使用者

1. **Users** → **Create user**（例如 `dashboard_admin`）
2. **Credentials** → 設密碼 → 關閉 **Temporary**
3. **Role mapping** → **Assign role** → realm roles → 勾選 **`admin`** 或 **`user`**

後端只接受這兩種 role；沒有 role 會顯示 `Missing dashboard role`。

---

## 4. 驗證登入／登出流程

```text
1. 開 https://lord-in-hk.ccwu.cc/login
2. 點「前往 Keycloak」→ 輸入 Keycloak 使用者密碼
3. 應回到 https://lord-in-hk.ccwu.cc/analysis
4. 側欄顯示使用者名稱與 role
5. 點 Log out → 應回到 https://lord-in-hk.ccwu.cc/login（無 Keycloak 錯誤頁）
```

伺服器上可再查：

```bash
docker compose logs backend --tail 30
docker compose logs keycloak --tail 30
```

---

## 5. 套用本次安全修復（關閉 4000 / 8080 對外）

若你先前部署的 `docker-compose.yml` 仍映射 `4000:4000` 或 `8080:8080`：

```bash
cd ~/horse_dashboard
git pull origin main
docker compose up -d --build
```

之後 **只有 Caddy 的 80/443** 對外；backend 與 Keycloak 僅在 Docker 內網由 Caddy 轉發。

本機開發若需要 `:4000` / `:8080`，使用：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

---

## 6. 之後更新程式

**PC：**

```powershell
git add … && git commit -m "…" && git push origin main
```

**Linode：**

```bash
cd ~/horse_dashboard
git pull origin main
docker compose up -d --build
```

瀏覽器 **Ctrl+Shift+R** 強制重新整理。

---

## 7. 常見問題速查

| 現象 | 處理 |
|------|------|
| Analysis 無資料 | 伺服器 Postgres 是新庫 → 依 `DEPLOY_LINODE.md` §7 遷移本機資料 |
| 登入失敗 `Incorrect redirect_uri` | 確認 client redirect URI 與 `.env` 的 `KEYCLOAK_PUBLIC_BASE_URL` |
| 登出 `Invalid redirect uri` | 補 post-logout URI：`https://lord-in-hk.ccwu.cc/login`（`##` 分隔） |
| `Invalid username or password` | 在 Keycloak **Users** 重設密碼（非 Postgres 密碼） |
| `Missing dashboard role` | 使用者須有 realm role `admin` 或 `user` |
| Secret 錯誤 / `invalid_client` | 重新複製 client secret 到 `.env` 並重啟 backend |

---

## 8. 相關文件

| 文件 | 用途 |
|------|------|
| `docs/DEPLOY_LINODE.md` | 從零部署 Linode |
| `docs/KEYCLOAK_LOGIN_ISSUE_SUMMARY.md` | Keycloak 技術根因與修復紀錄 |
| `docs/CYBER_SECURITY.md` | SSH、防火牆、Cloudflare |
