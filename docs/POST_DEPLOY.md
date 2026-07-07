# 部署後操作指南（Linode + 本地帳密登入）

> 適用網址範例：`https://lord-in-hk.ccwu.cc/`
> 完整部署步驟見 `docs/DEPLOY_LINODE.md`。

---

## 1. 部署成功應看到什麼？

| 檢查 | 預期 |
|------|------|
| 開啟 `https://lord-in-hk.ccwu.cc/analysis` | 已登入則進分析頁；未登入則導向 `/login` |
| `https://lord-in-hk.ccwu.cc/health` | `{"ok":true,"service":"backend"}` |
| `docker compose ps` | `caddy`、`backend`、`postgres`、`redis` 為 **healthy / Up** |
| Linode 防火牆 | 只開 **22、80、443**（**不要**開 4000、5432、6379） |

**對外只應經 Caddy**：瀏覽器 → `https://lord-in-hk.ccwu.cc` → Caddy → `/api`（backend）、其餘（frontend）。

---

## 2. 伺服器 `.env` 必備（生產環境）

在 Linode 專案目錄編輯 `.env`（**勿提交 git**）：

```bash
SITE_ADDRESS=lord-in-hk.ccwu.cc
SESSION_COOKIE_SECURE=true
SESSION_MAX_AGE_HOURS=24

POSTGRES_USER=hkjc
POSTGRES_PASSWORD=<強密碼>
POSTGRES_DB=hkjc_dashboard
DATABASE_URL=postgresql://hkjc:<同上密碼>@postgres:5432/hkjc_dashboard

SESSION_SECRET=<openssl rand -base64 48>
AUTH_INITIAL_USERNAME=admin
AUTH_INITIAL_PASSWORD=<只在空資料庫首次啟動使用>
```

套用變更：

```bash
cd ~/horse_dashboard   # 你的實際 clone 目錄
docker compose up -d --build
```

---

## 3. 首次部署後：初始化管理員帳號

當 `dashboard_users` 為空時，backend 會用 `.env` 內：

- `AUTH_INITIAL_USERNAME`
- `AUTH_INITIAL_PASSWORD`

自動建立第一個 `admin` 帳號。

建立後請立即登入，並在 `Settings` 頁面建立團隊成員帳號（`user` / `admin`）。

---

## 4. 驗證登入／登出流程

```text
1. 開 https://lord-in-hk.ccwu.cc/login
2. 輸入帳號密碼登入
3. 應進入 https://lord-in-hk.ccwu.cc/analysis
4. 側欄顯示使用者名稱與 role
5. 點 Log out 應成功回到登入狀態
```

伺服器上可再查：

```bash
docker compose logs backend --tail 50
```

---

## 5. 安全檢查（機密資料）

| 項目 | 期望 |
|------|------|
| Session cookie | `Secure`（HTTPS）、`HttpOnly`、`SameSite=Lax` |
| 登入限速 | 15 分鐘內每 IP 最多 10 次 |
| 稽核紀錄 | `dashboard_audit_log` 有 `login_success` / `login_failure` / `logout` / `admin_create_user` |

快速查核：

```bash
docker exec hkjc-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
"SELECT created_at,event_type,success,username,ip FROM dashboard_audit_log ORDER BY created_at DESC LIMIT 20;"
```

---

## 6. 之後更新程式

**PC：**

```powershell
git add ...; git commit -m "..."; git push origin main
```

**Linode：**

```bash
cd ~/horse_dashboard
git pull origin main
docker compose up -d --build
```

瀏覽器 `Ctrl+Shift+R` 強制重新整理。

---

## 7. 常見問題速查

| 現象 | 處理 |
|------|------|
| Analysis 無資料 | 伺服器 Postgres 是新庫 → 依 `DEPLOY_LINODE.md` 進行資料遷移 |
| 登入永遠 401 | 確認帳號存在且 `password_hash` 非空；必要時以 admin 重建帳號 |
| 連續錯誤密碼後被擋 | 登入限速生效（429），等待視窗結束後再試 |
| 重啟後無法登入 | 確認 `.env` 未覆蓋 `SESSION_SECRET`、`DATABASE_URL` 正確且 DB volume 未換新 |

---

## 8. 相關文件

| 文件 | 用途 |
|------|------|
| `docs/DEPLOY_LINODE.md` | 從零部署 Linode |
| `docs/KEYCLOAK_LOGIN_ISSUE_SUMMARY.md` | 舊版 Keycloak 歷史紀錄（已封存） |
| `docs/CYBER_SECURITY.md` | SSH、防火牆與硬化建議 |
