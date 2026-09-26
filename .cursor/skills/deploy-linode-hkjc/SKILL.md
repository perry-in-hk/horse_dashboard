---
name: deploy-linode-hkjc
description: >-
  Deploys HKJC Dashboard with Docker Compose on Linode (Akamai), configures firewall and .env,
  migrates PostgreSQL from a local PC with UTF-8-safe dumps, and troubleshoots common failures.
  Use when the user asks about Linode or Akamai deployment, server setup, copying the database to
  the cloud, pg_dump/scp/psql/pg_restore, empty Analysis or analytics on the server, PowerShell or
  UTF-16 dump issues, Traditional Chinese mojibake after restore, role or password errors for
  Postgres, finding the clone directory after git clone, Caddy ports 80/443, HTTPS, DuckDNS or free
  DNS, SITE_ADDRESS, SESSION_COOKIE_SECURE, Let's Encrypt, Vite blocked host / allowedHosts,
  VITE_WS_URL, HKJC production deploy, git pull on the server, GitHub HTTPS PAT vs password,
  docker compose rebuild after pull,
  or UI still showing old version. Dashboard login: local username/password accounts in
  dashboard_users, AUTH_INITIAL_USERNAME/AUTH_INITIAL_PASSWORD bootstrap, SESSION_SECRET,
  SESSION_MAX_AGE_HOURS, and difference from POSTGRES_PASSWORD.
---

# HKJC Dashboard — Linode deploy (agent skill)

## Canonical document

For **full steps, commands, and tables**, read and follow:

**`docs/DEPLOY_LINODE.md`**

If the user’s question is covered there, prefer quoting or paraphrasing that file so answers stay consistent with the repo. Do not invent alternate deploy paths unless the doc is silent.

---

## How to help (chatbot style)

1. **Clarify goal:** First deploy only, deploy + **copy local Postgres data**, or **HTTPS with a hostname**?
2. **State facts:** Server DB is a **separate Docker volume** — the **Analysis** page reads **server Postgres**; it is **empty** until data is migrated or scraped on the server.
3. **Use a checklist** from `docs/DEPLOY_LINODE.md` §0 or §11 when walking the user through the happy path.
4. **Diagnose by symptom** using the cheat sheet in `docs/DEPLOY_LINODE.md` §8 before guessing.
5. **Dashboard auth (web login):** **`POSTGRES_PASSWORD`** is only for the **backend → Postgres** connection. Human dashboard users are managed in **`dashboard_users`** with bcrypt hashes. Required envs: **`SESSION_SECRET`**, optional **`SESSION_MAX_AGE_HOURS`**, and first-boot bootstrap **`AUTH_INITIAL_USERNAME`** / **`AUTH_INITIAL_PASSWORD`**. Full table: **`docs/DEPLOY_LINODE.md` §5 C5**.
6. **HTTPS:** DNS **A** record → Linode IP; firewall **443**; server `.env` must include **`SITE_ADDRESS`** (hostname) and usually **`SESSION_COOKIE_SECURE=true`**; `docker compose up -d --build`. Details: **§9** in the doc.
7. **Vite “Blocked request / host not allowed”** behind Caddy: **`server.allowedHosts: true`** in `apps/frontend/vite.config.ts`, rebuild frontend. **§9.4** in the doc.
8. **Server code updates:** After `git push`, the server needs `git pull` **and** `docker compose up -d --build` (see `docs/DEPLOY_LINODE.md` §6 **D1**). If `git pull` aborts on **untracked files would be overwritten**, move or remove the conflicting paths, then pull again.
9. **GitHub over HTTPS:** Password login for `git push`/`git pull` is disabled — use a **Personal Access Token** or **SSH** (see §6 D1 in the doc).

---

## Non-negotiables (do not skip)

| Topic | Rule |
|-------|------|
| **`.env`** | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and **`DATABASE_URL`** must use the **same** user and password. In Compose, DB host is **`postgres`**, not `localhost`. |
| **Dashboard vs DB passwords** | **`POSTGRES_*`** / **`DATABASE_URL`** ≠ dashboard login. Web identity comes from app-local `dashboard_users` credentials and roles (`admin`/`user`), while app keeps session cookies. See **`docs/DEPLOY_LINODE.md` §5 C5**. |
| **Server Postgres user** | Never assume the role is `hkjc`. On the server run `docker exec <postgres-container> env \| grep POSTGRES` and use **`POSTGRES_USER`** in every `psql` / `pg_restore`. |
| **Dump on Windows** | Do **not** recommend raw PowerShell **`>`** to capture `pg_dump` — it often produces **UTF-16**, breaking `psql` and **corrupting Traditional Chinese**. |
| **Safe dump** | Prefer **`pg_dump -f /tmp/...` inside the container** + **`docker cp`** to the host, or **`-Fc`** + `pg_restore`. See `docs/DEPLOY_LINODE.md` §E1. |
| **Restore** | For a full SQL restore: **stop** backend/scraper/recommender, **DROP DATABASE … WITH (FORCE)**, **CREATE DATABASE**, then **`psql < file`**, then **`docker compose up -d`**. |
| **Verify Chinese** | After restore, **`SELECT horse_name …`** in `psql`. If names are wrong in SQL, **re-dump** with a UTF-8-safe method — not a frontend bug. |
| **HTTPS (Compose)** | **`SITE_ADDRESS`** must be set on the server to the **public DNS name** (matches **A** record). **`SESSION_COOKIE_SECURE=true`** when serving only HTTPS. |
| **Security** | Do not expose **5432** or **6379** publicly; do not commit `.env` or paste secrets in chat. |
| **Git / large dumps** | Database dump files (`backup.sql`, `hkjc_*.sql`, `*.dump`) are now **gitignored** — they will never be committed. Keep backups in a secure location outside the repo. |

---

## Quick symptom → action

| User says | Point to |
|-----------|----------|
| No data on server / empty Analysis | §7 — migrate DB or re-scrape; explain separate volume. |
| `role "hkjc" does not exist` | §8 — use actual `POSTGRES_USER` from `env \| grep POSTGRES`. |
| `invalid command \%…`, UTF-8 errors, `file` shows UTF-16 | §E1 / §E5 — re-dump with `docker cp` or `-Fc`; `iconv` is last resort for Chinese. |
| Chinese garbled in UI after restore | §E1 — dump was corrupted on Windows; re-dump UTF-8-safe, full restore again. |
| Wrong folder on server | §4 — clone folder name = **repo name** (e.g. `horse_dashboard`); `find ~ -name docker-compose.yml`. |
| Auth / password errors for **Postgres** (`password authentication failed`, wrong role) | §5 C2–C3 — align `DATABASE_URL` with volume-initialized credentials. |
| **Cannot log into the web app** | §5 **C5** — check `dashboard_users` account exists with non-null `password_hash`, verify rate limit state, and confirm backend env `SESSION_SECRET` / `AUTH_INITIAL_*`; use HTTPS + **`SESSION_COOKIE_SECURE=true`** when on TLS. |
| Confusing **Postgres password** with **dashboard password** | §5 **C5** — two different systems; DB auth is `POSTGRES_*`, while dashboard login uses app-local user credentials. |
| `git pull` / `git push`: **Password authentication is not supported** | §6 **D1** — GitHub HTTPS: use **PAT** or **SSH**, not account password. |
| `untracked working tree files would be overwritten by merge` | §6 **D1** — move or remove conflicting local files, then `git pull`. Database dumps are gitignored and won't cause this. |
| Deployed but **still old UI** / old behaviour | §6 **D1** — run `docker compose up -d --build` after pull; hard-refresh browser; confirm `git log -1` on server; use **port 80** or **443**, not `:5173`. |
| Local `.env` uses `hkjc`, server uses `hkjc_1` (or vice versa) | §6 **D1** (local vs server) + §5 C2–C3 — **never** copy PC `.env` to server blindly; match server Postgres role. |
| **`Blocked request` / host not allowed (Vite)** | §9 **9.4** — `server.allowedHosts: true` in `vite.config.ts`; rebuild frontend container. |
| **`Set SITE_ADDRESS in .env`** (Compose) | §9 — add `SITE_ADDRESS=your.hostname` to **server** `.env`; must match DNS. |
| HTTPS / Let’s Encrypt / DuckDNS | §9 — DNS **A**, firewall **443**, `SITE_ADDRESS`, `SESSION_COOKIE_SECURE`, rebuild. |
| Do I need to change **`VITE_WS_URL`**? | §9 **9.3** — not used by app code today; future **WebSockets** from HTTPS → **`wss://`** same host. |

---

## Architecture reminder (one paragraph)

**Caddy** on **:80** (and **:443** with **`SITE_ADDRESS`**) → `/api` and `/health` to **backend**, UI to **frontend**. Browsers use **`http(s)://<PUBLIC_IP-or-hostname>/`** (not `:5173` / `:4000` on the host). Details: `docs/DEPLOY_LINODE.md` §1 and §9.

---

## When the full doc might change

If deployment steps in the repository change, **update `docs/DEPLOY_LINODE.md` first**, then adjust this skill only if triggers or non-negotiables need to stay in sync.
