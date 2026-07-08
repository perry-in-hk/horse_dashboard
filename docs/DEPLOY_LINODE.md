# HKJC Dashboard — Linode deployment tutorial

This guide summarizes a working path to run the Docker Compose stack on **Linode (Akamai)** and optionally **copy database data from a local PC** to the server.

**Goal:** Open the app at `http://<Linode-public-IP>/` (port **80** via Caddy), with the API under the same origin at `/api/...`. Optionally use **`https://<your-hostname>/`** (e.g. DuckDNS) with TLS on **443** — see [§9](#9-https-with-a-hostname-optional).

---

## 0. End-to-end summary (what worked)

This section is the **short story** of a full deploy + data migration. Read the numbered phases below for detail.

| Step | What you do |
|------|----------------|
| 1 | Create Linode, firewall (**22** + **80**, and **443** if you plan HTTPS), install Docker on the server. |
| 2 | `git clone` the repo — note the **actual folder name** (e.g. `horse_dashboard`), not necessarily `HKJC_Dashboard`. |
| 3 | Copy `.env.example` → `.env`; set **`POSTGRES_USER`**, **`POSTGRES_PASSWORD`**, **`POSTGRES_DB`**, and **`DATABASE_URL`** with the **same** user/password; DB host **`postgres`**, not `localhost`. Add **`SESSION_SECRET`**, **`AUTH_INITIAL_USERNAME`**, **`AUTH_INITIAL_PASSWORD`**, and optionally **`SESSION_MAX_AGE_HOURS`** (see [§5 C5](#c5-dashboard-login-via-local-accounts-app-users-not-postgres)). |
| 4 | `docker compose up -d --build`; open `http://<PUBLIC_IP>/`. The **Analysis** page reads **Postgres on the server** — it will be **empty** until you restore data. |
| 5 | On your PC, create a dump **without PowerShell destroying UTF-8** (see [§7](#7-phase-e--copy-local-database-to-server-optional) — **recommended:** `pg_dump` to a file **inside** the container, then `docker cp` out). |
| 6 | `scp` the `.sql` (or `.dump`) file to the server project directory. |
| 7 | On the server, read **`POSTGRES_USER`** with `docker exec … env \| grep POSTGRES` — use **that** username in every `psql` / `pg_restore` command (it may be `hkjc`, `hkjc_1`, or another value you chose). |
| 8 | Stop services that hold DB connections, **drop + recreate** the target database, **restore**, then `docker compose up -d`. |
| 9 | Verify with SQL (`SELECT horse_name …`) and in the browser — **Traditional Chinese** must look correct; if not, the dump file was still corrupted on Windows (redo step 5). |
| **Later: update app on server** | On PC: `git push`. On server: `git pull`, then **`docker compose up -d --build`**. If pull fails on untracked `*.sql` files, move/remove them first ([§6 D1](#d1-server-updates-git-pull-and-rebuild)). Use **GitHub PAT or SSH** — not your GitHub password ([§6 D1](#d1-server-updates-git-pull-and-rebuild)). |
| **Optional: HTTPS + hostname** | Point DNS (e.g. [DuckDNS](https://www.duckdns.org/)) A record → Linode IP; firewall **443**; set **`SITE_ADDRESS`** + **`SESSION_COOKIE_SECURE=true`** in `.env`; `docker compose up -d --build`. See [§9](#9-https-with-a-hostname-optional). |

**Challenges we hit in practice (and fixes):**

| Challenge | Fix |
|-----------|-----|
| Empty **Analysis** / analytics on the server | Server Postgres is a **new** volume — **migrate** with `pg_dump` / `psql` or re-scrape on the server. |
| `role "hkjc" does not exist` | Server was initialized with a **different** `POSTGRES_USER` — use `docker exec … env \| grep POSTGRES` and that user in all commands. |
| `invalid command \%…` or UTF-8 errors on restore | Dump was **UTF-16** (common if PowerShell `>` was used) — re-dump using [§E1](#e1-dump-on-windows-recommended-utf-8-safe) or convert with `iconv` only as a last resort; **re-dump cleanly** for correct Chinese. |
| Traditional Chinese shows **mojibake** after restore | **UTF-8 was corrupted when saving the dump on Windows** — use **`docker exec … -f /tmp/…` + `docker cp`** or `-Fc` format; then **full restore** again. |
| **`Blocked request. This host ("…") is not allowed`** (Vite) | Vite **8+** blocks unknown `Host` headers; Caddy forwards your domain → set **`server.allowedHosts: true`** in `apps/frontend/vite.config.ts`, rebuild **frontend** ([§9.4](#94-common-https--vite-issues)). |
| **`Set SITE_ADDRESS in .env`** when running Compose | **`SITE_ADDRESS`** is missing on the server `.env` (required for Caddy TLS) — add e.g. `SITE_ADDRESS=yourname.duckdns.org` ([§9](#9-https-with-a-hostname-optional)). |

---

## 1. Architecture (short)

- **Caddy** listens on **:80** (and **:443** when using HTTPS), proxies `/api*` and `/health` to **backend:4000**, and everything else to **frontend:5173**. With a **`SITE_ADDRESS`** in `.env`, Caddy obtains **Let’s Encrypt** certificates and serves **HTTPS** automatically.
- **Backend** and **frontend** are **not** mapped to host ports **4000/5173** in production `docker-compose.yml`; only **Caddy** is public on **80** / **443**. For local dev with host ports, use **`docker-compose.dev.yml`**.
- **Postgres** and **Redis** store data in **Docker volumes on the server** — a separate database from your **local** dev instance unless you **migrate** data (see [§7](#7-phase-e--copy-local-database-to-server-optional)).

---

## 2. Prerequisites

- Linode account, **Ubuntu 24.04** (or 22.04), **≥2 GB RAM**, region e.g. **Singapore** (good latency from Hong Kong).
- **SSH** access (password or key). Server maintenance uses **`sudo`** after SSH — see [§A5](#a5-ssh-login-and-sudo-on-the-server).
- **Git** repository URL so the server can `git clone`.
- On your PC: **Docker Desktop** if you dump the database from local Compose.

---

## 3. Phase A — Server setup

### A1. Create Linode

- Pick a plan (e.g. **2 GB** shared CPU).
- Note the **public IPv4**.

### A2. SSH keys (optional but recommended)

- PC: public key in `%USERPROFILE%\.ssh\*.pub` (or create with `ssh-keygen`).
- Linode: **Account → SSH Keys** → add the public key.

### A3. Cloud Firewall

1. **Create Firewall** → default **inbound: Drop**, **outbound: Accept**.
2. The first screen may only show **default policies** — **create** the firewall, then open it again to add **inbound rules**.
3. **Inbound rules** → **Add**:
   - **TCP 22** — SSH (ideally restricted to **your IP**/32).
   - **TCP 80** — HTTP (Caddy).
   - **TCP 443** — **required** if you use **HTTPS** with a domain ([§9](#9-https-with-a-hostname-optional)); optional for IP-only HTTP.
4. **Attach** the firewall to the Linode.

Do **not** open **5432** (Postgres), **6379** (Redis), or **4000** (backend) to the world. Those services stay on the Docker network; only **Caddy** (**80** / **443**) is public.

### A4. Install Docker (on the server)

Follow **[Docker’s official Ubuntu install](https://docs.docker.com/engine/install/ubuntu/)** (Engine + **Compose plugin**). Verify:

```bash
docker --version
docker compose version
docker run --rm hello-world
```

If you only use **root** over SSH, you do **not** need `usermod -aG docker` unless you add a non-root user later.

### A5. SSH login and sudo on the server

**From your PC (PowerShell or terminal):** you only run **SSH** to open a shell — there is **no `sudo` on your PC** for that step.

```text
ssh deploy@<PUBLIC_IP>          # or: ssh -i %USERPROFILE%\.ssh\your_key deploy@<PUBLIC_IP>
```

**This deployment (PowerShell, key `id_ed25519_linode` — update the IP in Linode if it changes):**

```powershell
ssh -i $env:USERPROFILE\.ssh\id_ed25519_linode deploy@139.162.51.138
```

Use the **SSH key** (and key **passphrase**, if you set one) and/or the server’s policy **for SSH itself**. That is separate from **`sudo`** on the server.

**After you are logged in** as a normal user (e.g. **`deploy`** with **`sudo`** group):

| Situation | Command pattern |
|-----------|------------------|
| **Full root shell** (install packages, edit system files, `docker` if your user is not in `docker` group) | `sudo -i` or `sudo su -`, then run commands; type `exit` to leave root. |
| **One command as root** | `sudo apt update`, `sudo systemctl restart ssh`, `sudo nano /etc/...` |
| **App / Compose in project dir** | `cd ~/YOUR_REPO_FOLDER` then `docker compose ...` — use **`sudo docker compose`** only if your user cannot run Docker without it (see [A4](#a4-install-docker-on-the-server)). |
| **Updates** (maintenance) | `sudo apt update && sudo apt upgrade` — then **`sudo reboot`** if the kernel changed or the login banner says a restart is required. |

**Passwords (do not mix them up):**

- **SSH key passphrase** (optional): unlocks the **private key on your PC** when `ssh` runs. Not the same as Linux.
- **`sudo` password**: when `sudo` asks for **`[sudo] password for deploy:`**, that is the **Linux account password** for the user you SSH’d in as (unless you configured passwordless sudo).

**If direct `ssh root@...` is disabled** (`PermitRootLogin no` is common): log in as **`deploy`**, then use **`sudo -i`** for root tasks — you do not need root SSH for maintenance.

**Optional reading:** host hardening and SSH keys are summarized in **`docs/CYBER_SECURITY.md`**.

### A5b. `deploy` user vs `root` — where is `docker-compose.yml`?

If you **cloned and ran Docker as `root`**, the project lives under **`/root/<repo-folder>`** (e.g. **`/root/horse_dashboard`**). User **`deploy`** cannot **`cd` into `/root`** (permission denied), and **`find ~ -name docker-compose.yml`** finds nothing because **`~` is `/home/deploy`**, not `/root`.

| Task | Command |
|------|---------|
| Find compose under root’s home | `sudo find /root -name 'docker-compose.y*ml' 2>/dev/null` |
| Edit server `.env` | `sudo nano /root/horse_dashboard/.env` (use your real folder name) |
| Run Compose from `/root` tree | `sudo bash -c 'cd /root/horse_dashboard && docker compose up -d --build'` — or **`sudo -i`**, then **`cd`** and **`docker compose`** |
| Optional: run stack as `deploy` | `sudo mv /root/horse_dashboard /home/deploy/` then **`sudo chown -R deploy:deploy /home/deploy/horse_dashboard`** (adjust names); add **`deploy`** to **`docker`** group if needed |

**Shell stderr redirect:** use **`2>/dev/null`** to hide “Permission denied” noise from `find`. **`2>/dev/`** is wrong (**`/dev/`** is a directory) → bash reports **`Is a directory`**.

---

## 4. Phase B — Get code on the server

```bash
cd /root
git clone https://github.com/YOUR_ORG/YOUR_REPO.git
cd YOUR_REPO_FOLDER
```

**Tip:** `git clone` creates a folder named like the **GitHub repository** (e.g. `horse_dashboard`), not necessarily the same name as your local project folder.

---

## 5. Phase C — Environment file (`.env`)

### C1. Create `.env`

```bash
cd ~/YOUR_REPO_FOLDER
cp .env.example .env
nano .env
```

You can also paste from your PC via `scp` or editor — see [§8](#8-challenges-cheat-sheet) for Windows encoding pitfalls when handling SQL dumps.

### C2. Required values (must be consistent)

| Variable | Rule |
|----------|------|
| `POSTGRES_USER` | e.g. `hkjc` — **one** username for the whole stack |
| `POSTGRES_PASSWORD` | Strong secret |
| `DATABASE_URL` | Same **user** and **password** as above; host must be **`postgres`** (Docker service name), **not** `localhost`: `postgresql://USER:PASSWORD@postgres:5432/hkjc_dashboard` |
| `REDIS_URL` | Usually `redis://redis:6379` |
| `SESSION_SECRET` | Long random string; signs session cookies |
| `AUTH_INITIAL_USERNAME` / `AUTH_INITIAL_PASSWORD` | Bootstrap first admin only when `dashboard_users` is empty |
| `SESSION_MAX_AGE_HOURS` | Session cookie lifetime (hours), default `24` |
| `SITE_ADDRESS` | Public hostname for Caddy (e.g. `yourname.duckdns.org`). Required for TLS in Compose; must match DNS **A** record to this server. |
| `SESSION_COOKIE_SECURE` | Set **`true`** when users only use **HTTPS** so session cookies are `Secure` (recommended with TLS). |

**Critical:** The username in `DATABASE_URL` must **match** `POSTGRES_USER`. A mismatch causes `password authentication failed` or `role "hkjc" does not exist`.

### C3. Postgres volume and passwords

Postgres initializes credentials **only on first** creation of its data directory. If you change `POSTGRES_PASSWORD` in `.env` later, the volume may still use the **old** password. Fix by either:

- Using the **original** password in `DATABASE_URL`, or  
- `docker compose down -v` (⚠️ **deletes database data**) and bringing the stack up again with one consistent password.

### C4. Frontend + Caddy (`VITE_*`)

With Compose, the **frontend** service may set `VITE_API_URL` to `""` so the browser uses **same-origin** `/api/...` through Caddy. You do not need `http://localhost:4000` on the server for that pattern.

### C5. Dashboard login via local accounts (app users, not Postgres)

The **HKJC Dashboard** login (browser → `POST /api/auth/login`) is **separate** from **`POSTGRES_PASSWORD`**. Postgres credentials are only for the database connection; human users authenticate with app-local usernames/passwords stored in `dashboard_users`.

| Topic | What to know |
|--------|----------------|
| **First admin bootstrap** | If `dashboard_users` is empty, backend creates the first `admin` from `AUTH_INITIAL_USERNAME` / `AUTH_INITIAL_PASSWORD` on startup. |
| **Admin/user provisioning** | Admin can create `admin`/`user` accounts in the `Settings` page (`/api/users`). |
| **Password policy** | Password min length is 8; hash uses bcrypt (cost 12). |
| **Rate limit** | Login endpoint is rate-limited (15 minutes / IP / max 10 attempts). |
| **Session** | `SESSION_SECRET` is required; `SESSION_COOKIE_SECURE=true` on HTTPS; optional `SESSION_MAX_AGE_HOURS`. |
| **Audit log** | Login success/failure, logout, and admin create-user are written to `dashboard_audit_log`. |
| **Transport** | Treat **HTTP (port 80) to a public IP** as **not** private for passwords: prefer **HTTPS** for anything beyond quick testing. |

**Do not confuse:** **`DATABASE_URL`** / **`POSTGRES_*`** authenticate the **backend → Postgres** link. Dashboard users are managed in `dashboard_users`.

### C6. After first deploy (login + verification)

Once `docker compose up` succeeds and **`https://<SITE_ADDRESS>/`** loads, verify bootstrap admin login and create required user accounts in `Settings`. Step-by-step: **[`docs/POST_DEPLOY.md`](POST_DEPLOY.md)**.

---

## 6. Phase D — Deploy

```bash
cd ~/YOUR_REPO_FOLDER
docker compose up -d --build
docker compose ps
```

**Checks:**

```bash
curl -sS http://127.0.0.1/health
```

**Browser:** `http://<PUBLIC_IP>/` (not `:5173` or `:4000`).

### D1. Server updates: git pull and rebuild

1. **On your PC:** commit, then **`git push`** to `main` (or your deploy branch). If push fails with **“Password authentication is not supported”**, GitHub no longer accepts account passwords over HTTPS — use a **[Personal Access Token](https://github.com/settings/tokens)** (with `repo` scope) as the password, or switch the remote to **SSH** (`git@github.com:USER/REPO.git`) and use an SSH key.

2. **On the server:**

```bash
cd ~/YOUR_REPO_FOLDER   # e.g. horse_dashboard — same folder as docker-compose.yml
git pull origin main
docker compose up -d --build
```

**`--build`** is important so backend/frontend **images** include the latest code. A bare `git pull` alone does not change running containers.

3. **Browser still shows an old UI?** Hard-refresh (**Ctrl+Shift+R**) or a private window. Confirm the server is on the new commit: `git log -1 --oneline`. Confirm you opened **`http://<PUBLIC_IP>/`** (port **80**), not `:5173` (Vite is only inside Docker; Caddy exposes **80**).

#### `git pull` error: untracked files would be overwritten by merge

If the repo **tracks** files such as `backup.sql`, `hkjc_clean.sql`, or `hkjc_restore.sql`, but the server has **local untracked** files with the **same names** (e.g. you uploaded dumps by hand), Git aborts the merge:

> `error: The following untracked working tree files would be overwritten by merge`

**Fix — move them out of the repo directory** (keeps your copies):

```bash
cd ~/YOUR_REPO_FOLDER
mkdir -p ~/sql_dumps_backup
mv backup.sql hkjc_clean.sql hkjc_restore.sql ~/sql_dumps_backup/ 2>/dev/null || true
git pull origin main
```

Or **delete** those filenames in the project folder if you do not need them on disk:

```bash
cd ~/YOUR_REPO_FOLDER
rm -f backup.sql hkjc_clean.sql hkjc_restore.sql
git pull origin main
```

Then run **`docker compose up -d --build`** again.

**Prevention:** Prefer **not** committing large SQL dumps to git (add patterns to `.gitignore` on the branch you push from) so production servers do not need those files in the tree at all.

#### Local versus server Postgres user

Your **PC** and **Linode** Postgres volumes may have been created with **different** `POSTGRES_USER` values (e.g. local `hkjc`, server `hkjc_1`). **Do not copy your PC `.env` to the server wholesale** — keep **`POSTGRES_USER`** and **`DATABASE_URL`** on the server aligned with whatever role actually exists there (`docker exec <postgres-container> env | grep POSTGRES` and `\du` in `psql`). See [§5 C2–C3](#c2-required-values-must-be-consistent) and [§8](#8-challenges-cheat-sheet).

---

## 7. Phase E — Copy local database to server (optional)

**Facts:**

- Local Postgres and server Postgres are **different instances** (different Docker volumes).
- The **Analysis** page and most APIs read **Postgres** — “no data in the cloud” means the **server database was never filled**, not a frontend bug.
- **`pg_dump` only creates a file** — you must **`psql` / `pg_restore`** on the server to import.
- **Never use raw PowerShell `>`** to capture `pg_dump` output: it often saves **UTF-16 LE** with a BOM. That causes:
  - Linux `psql`: errors like `invalid command \%…` or UTF-8 failures.
  - Even after `iconv`, **Traditional Chinese can stay garbled** (UTF-8 was mis-decoded when the file was written). **Fix:** create the dump again using one of the safe methods below.

### E1. Dump on Windows (recommended: UTF-8 safe)

**Best: write the file inside the Linux container, then copy out** — encoding matches your DB, no PowerShell mangling.

Use the **Postgres service name** from Compose (`postgres`) and your **local** DB user from `.env` (often `hkjc`):

```powershell
cd C:\path\to\HKJC_Dashboard
docker compose exec postgres pg_dump -U hkjc --no-owner --no-acl -f /tmp/hkjc_export.sql hkjc_dashboard
docker cp hkjc-postgres:/tmp/hkjc_export.sql .\hkjc_export.sql
```

If your container name differs, run `docker ps` and use that name in `docker cp` (e.g. `horse_dashboard-postgres-1`).

**Optional check before upload** (Git Bash / WSL / Linux):

```bash
file hkjc_export.sql
# Should show: UTF-8 Unicode text …  (not UTF-16)
```

Open a small part of the file and confirm a `COPY` line shows **correct Chinese** for horse names — not mojibake.

**Alternatives (if you cannot use `docker cp`):**

- **Command Prompt (`cmd.exe`)** — `>` is usually ANSI/OEM; still riskier than `docker cp`.

```bat
docker compose exec -T postgres pg_dump -U hkjc -d hkjc_dashboard --no-owner --no-acl > backup_full.sql
```

- **PowerShell** — explicit UTF-8 **without BOM**:

```powershell
docker compose exec -T postgres pg_dump -U hkjc -d hkjc_dashboard --no-owner --no-acl | Set-Content -Path backup_full.sql -Encoding utf8NoBOM
```

**Binary format** (avoids text encoding issues entirely):

```powershell
docker compose exec postgres pg_dump -U hkjc -Fc --no-owner --no-acl -f /tmp/hkjc.dump hkjc_dashboard
docker cp hkjc-postgres:/tmp/hkjc.dump .\hkjc.dump
```

Restore on server with `pg_restore` (see [E4](#e4-restore-on-the-server)).

### E2. Full dump vs data-only

| Situation | What to use |
|-----------|-------------|
| Server DB is **empty** or you will **drop and recreate** the database | **Full** dump (`pg_dump` without `--data-only`), optionally with `--clean --if-exists` when dumping for idempotent replays. |
| Server **already has** the same schema from migrations | **`--data-only`** from local, or you get “relation already exists”. |

### E3. Copy to Linode

Replace `USER`, `PUBLIC_IP`, and path with yours (`scp` placeholders are not literal):

```powershell
scp "C:\path\to\hkjc_export.sql" USER@PUBLIC_IP:/root/YOUR_REPO_FOLDER/
```

### E4. Restore on the server

**Discover the real DB role on this server** (do not assume `hkjc`):

```bash
cd ~/YOUR_REPO_FOLDER
docker exec hkjc-postgres env | grep POSTGRES
```

Note `POSTGRES_USER` and `POSTGRES_DB`. Use **`POSTGRES_USER`** in every `-U` below.

**Stop** services that keep connections open:

```bash
docker compose stop backend scraper recommender
```

**Replace the database** (full SQL restore; destructive for that DB):

```bash
docker exec hkjc-postgres psql -U YOUR_POSTGRES_USER -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS hkjc_dashboard WITH (FORCE);"
docker exec hkjc-postgres psql -U YOUR_POSTGRES_USER -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE hkjc_dashboard OWNER YOUR_POSTGRES_USER;"
```

Adjust `hkjc-postgres` if `docker ps` shows a different container name.

**Import** (plain SQL):

```bash
docker exec -i hkjc-postgres psql -U YOUR_POSTGRES_USER -d hkjc_dashboard -v ON_ERROR_STOP=1 < /root/YOUR_REPO_FOLDER/hkjc_export.sql
```

**Import** (custom `-Fc` file):

```bash
docker cp /root/YOUR_REPO_FOLDER/hkjc.dump hkjc-postgres:/tmp/hkjc.dump
docker exec hkjc-postgres pg_restore -U YOUR_POSTGRES_USER --no-owner --no-acl -d hkjc_dashboard /tmp/hkjc.dump
```

**Start** the stack again:

```bash
docker compose up -d
```

**Sanity checks:**

```bash
docker exec hkjc-postgres psql -U YOUR_POSTGRES_USER -d hkjc_dashboard -c "SELECT COUNT(*) FROM hkjc_race_results;"
docker exec hkjc-postgres psql -U YOUR_POSTGRES_USER -d hkjc_dashboard -c "SELECT horse_name FROM hkjc_race_results WHERE horse_name IS NOT NULL LIMIT 3;"
```

If **`horse_name`** looks correct in `psql` but wrong in the browser, clear cache / hard-reload; if it is wrong in `psql`, the dump file was still bad — redo [E1](#e1-dump-on-windows-recommended-utf-8-safe).

### E5. If you already uploaded a UTF-16 `.sql` (recovery)

On the server, `file your.sql` may show **UTF-16**. You can try:

```bash
iconv -f UTF-16LE -t UTF-8 your.sql | sed 's/\r$//' > your_utf8.sql
```

**Warning:** If Chinese was already corrupted when the file was created on Windows, **iconv cannot repair it** — re-dump with [E1](#e1-dump-on-windows-recommended-utf-8-safe).

### E6. Dump on the Linux server only (bash)

Safe redirect on Linux:

```bash
docker compose exec -T postgres pg_dump -U YOUR_USER -d hkjc_dashboard --no-owner --no-acl > backup.sql
```

---

## 8. Challenges (cheat sheet)

| Symptom | Cause | Fix |
|---------|--------|-----|
| `POSTGRES_PASSWORD is missing` | Empty or unset in `.env` | Set `POSTGRES_PASSWORD` and a full `DATABASE_URL` |
| `password authentication failed for user "hkjc"` | Wrong password or **user mismatch** between `DATABASE_URL` and `POSTGRES_USER` | Align user + password; align with volume’s initial password or use `down -v` |
| `role "hkjc" does not exist` | Server was initialized with a **different** `POSTGRES_USER` (e.g. `hkjc_1`) | `docker exec … env \| grep POSTGRES` — use that user in `psql` and in `DATABASE_URL` |
| `invalid command \%…` / `invalid byte sequence for encoding "UTF8"` | Dump saved as **UTF-16** (typical: PowerShell **`>`** redirect) | Re-dump with [`docker exec` + `/tmp` + `docker cp`](#e1-dump-on-windows-recommended-utf-8-safe) or `-Fc` |
| `file` shows **UTF-16** / **CRLF** on the server | Same as above | Re-dump; optional emergency: `iconv` + `sed` ([§E5](#e5-if-you-already-uploaded-a-utf-16-sql-recovery)) — **Chinese may still be wrong** if the file was mangled at dump time |
| Horse names / Chinese show **mojibake** in UI after restore | UTF-8 was **mis-decoded when the dump was written on Windows** | Re-dump with [§E1](#e1-dump-on-windows-recommended-utf-8-safe); verify Chinese in the `.sql` **before** `scp` |
| `relation already exists` on restore | Full dump applied when schema **already** exists | Use **`--data-only`** from local, or **drop + create** the database ([§E4](#e4-restore-on-the-server)) |
| UI works but **no cloud data** | Server DB is empty / separate volume | Restore data ([§7](#7-phase-e--copy-local-database-to-server-optional)) or re-run scrapers on the server |
| `cd` wrong folder after clone | Clone directory = **repo name** | `find ~ -name docker-compose.yml 2>/dev/null`; `cd` into that folder |
| **`find ~` returns nothing**; empty **`deploy`** home | Repo was cloned as **`root`** under **`/root`** (e.g. `horse_dashboard`) | `sudo find /root -name 'docker-compose.y*ml' 2>/dev/null` — see [A5b](#a5b-deploy-user-vs-root--where-is-docker-composeyml) |
| **`cd: /root/...: Permission denied`** | Only **`root`** may **`cd /root`** | `sudo -i` or `sudo bash -c 'cd /root/… && …'` ([A5b](#a5b-deploy-user-vs-root--where-is-docker-composeyml)) |
| **`no configuration file provided: not found`** (`docker compose`) | Compose ran in a directory **without** `docker-compose.yml` (often after a failed **`cd`**) | **`cd`** to the project folder first; from **`deploy`**, use **`sudo bash -c 'cd /root/… && docker compose …'`** ([A5b](#a5b-deploy-user-vs-root--where-is-docker-composeyml)) |
| **`git pull`**: `untracked working tree files would be overwritten` | Local untracked files (e.g. `backup.sql`) **same path** as files coming from the remote branch | Move or `rm` those files, then `git pull` again ([§6 D1](#d1-server-updates-git-pull-and-rebuild)) |
| **`git pull` / `git push`**: `Password authentication is not supported` | GitHub **HTTPS** no longer accepts account passwords | Use a **Personal Access Token** as the password, or use **SSH** remote + SSH key ([§6 D1](#d1-server-updates-git-pull-and-rebuild)) |
| Site still **old UI** after deploy | No `docker compose up --build`, wrong folder, or browser cache | `git log -1`; `docker compose up -d --build`; hard refresh; use **port 80** not `:5173` ([§6 D1](#d1-server-updates-git-pull-and-rebuild)) |
| **`Blocked request. This host ("…") is not allowed`** | **Vite 8+** `server.allowedHosts` — reverse proxy sends real hostname | Set **`allowedHosts: true`** in `apps/frontend/vite.config.ts` under `server`, rebuild: `docker compose up -d --build frontend` ([§9.4](#94-common-https--vite-issues)) |
| **`Set SITE_ADDRESS in .env`** (Compose error) | **`SITE_ADDRESS`** unset on server | Add to server `.env`: `SITE_ADDRESS=yourname.duckdns.org` (must match DNS) ([§9.2](#92-server-env-and-redeploy)) |
| **HTTPS fails / ACME errors** | DNS not pointing here yet, or **80** blocked | Wait for DNS; ensure firewall allows **80** and **443**; `curl -I http://yourname.duckdns.org/.well-known/acme-challenge/` (after Caddy runs) ([§9](#9-https-with-a-hostname-optional)) |
| **“Server Not Found”**, **NXDOMAIN**, or **Cloudflare 525** / ACME **`no valid A records`** | Registrar hold, NS vs A record mismatch, wrong **Name** in Cloudflare for a subdomain zone, or Proxied before cert issuance | See [§9.6](#96-common-deployment-issues-dns-registrar-cloudflare) |
| Session lost after switching to HTTPS | Cookie not **Secure** | Set **`SESSION_COOKIE_SECURE=true`** in `.env` when using HTTPS only ([§9.2](#92-server-env-and-redeploy)) |

---

## 9. HTTPS with a hostname (optional)

Use this when you want **`https://yourname.duckdns.org/`** (or any domain) instead of **`http://<IP>/`**. The stack uses **Caddy** with **automatic Let’s Encrypt** TLS when **`SITE_ADDRESS`** is set.

### 9.1 DNS and firewall

1. **Hostname** — A free option is **[DuckDNS](https://www.duckdns.org/)**: create a subdomain (e.g. `perry-in-hk.duckdns.org`) and set **current ip** to your **Linode public IPv4**. Paid registrars work the same way: **A record** → server IP.
2. **Firewall** — Allow inbound **TCP 443** on the Linode Cloud Firewall (keep **22** and **80** as you already use **80** for HTTP and ACME HTTP-01 challenges).

### 9.2 Server `.env` and redeploy

On the server, **`SITE_ADDRESS` must exist** in `.env` (Compose passes it into Caddy). Example:

```bash
SITE_ADDRESS=yourname.duckdns.org
SESSION_COOKIE_SECURE=true
```

Then:

```bash
cd ~/YOUR_REPO_FOLDER
git pull origin main
docker compose up -d --build
```

Open **`https://yourname.duckdns.org/`** (first certificate fetch may take a short time). **Do not commit** `.env`; copy these lines manually on the server if needed.

The repo maps **`443:443`**, uses **`{$SITE_ADDRESS}`** in `infra/docker/Caddyfile`, and persists certificates in Docker volumes **`caddy_data`** / **`caddy_config`**.

### 9.3 `VITE_WS_URL`

The app now uses WebSocket for the AI Council room (`/ws/council`).

- From an **HTTPS** page, use **`wss://`** with the same host as the site.
- Ensure Caddy forwards `handle /ws/council* { reverse_proxy backend:4000 }`.
- `VITE_WS_URL` can be left empty for same-origin (`/ws` via Vite proxy in local dev), or set explicitly to your public WS base.

### 9.4 Common HTTPS + Vite issues

**`Blocked request. This host ("yourname.duckdns.org") is not allowed. To allow this host, add … to server.allowedHosts in vite.config`**

- **Cause:** Vite **8+** rejects requests whose `Host` header is not in the default allowlist. **Caddy** forwards the browser’s host (your domain).
- **Fix:** In `apps/frontend/vite.config.ts`, under `server`, set **`allowedHosts: true`** (or list your domain explicitly). Rebuild the **frontend** image:  
  `docker compose up -d --build frontend` (or full `--build`).

**Security note:** `allowedHosts` does not replace **login**, **firewall**, or **TLS** — it only relaxes Vite’s host check so the dev server works behind a reverse proxy. For stricter public hardening, consider serving a **`vite build`** static `dist/` via Caddy instead of **`vite dev`** in Docker (larger change).

### 9.5 Cloudflare in front (optional — hide origin IP)

Use a **domain you control** (registrar / DNS host such as **dnshe.com**). **DuckDNS** is separate; **`SITE_ADDRESS`** must match the **hostname users open** (e.g. `lord-in-hk.ccwu.cc`), not an old DuckDNS name unless you still use that URL.

| Topic | What to do |
|--------|------------|
| **Nameservers vs A record** | At the **registrar**, set **nameservers** to **only** Cloudflare’s pair (e.g. `conrad.ns.cloudflare.com`, `danica.ns.cloudflare.com`). That is **not** the same as an **A** record — the **A** record’s **content** is your **Linode public IP**, entered under **Cloudflare → DNS** (usually **Proxied** / orange cloud). |
| **Delegation** | Until the zone shows **Active** in Cloudflare and `nslookup -type=NS yourdomain` lists Cloudflare, DNS is still propagating. |
| **Server `.env`** | **`SITE_ADDRESS=your.domain`** and **`SESSION_COOKIE_SECURE=true`**; redeploy Compose ([§9.2](#92-server-env-and-redeploy)). |
| **SSL/TLS** in Cloudflare | Prefer **Full (strict)** when Caddy has a valid Let’s Encrypt cert for **`SITE_ADDRESS`**. |
| **Firewall (later)** | Optionally restrict **80/443** to [Cloudflare IP ranges](https://www.cloudflare.com/ips/) only; keep **SSH (22)** locked to **your** IP — not Cloudflare. |

### 9.6 Common deployment issues (DNS, registrar, Cloudflare)

This section summarizes problems that look like “the server is down” but are often **DNS or TLS issuance**, not Docker or Caddy bugs.

#### A. Browser: “Server Not Found” / `nslookup` → Non-existent domain

| Cause | What to check |
|--------|----------------|
| **Registrar hold** (incomplete WHOIS/contact, suspension, non-renewal) | At the **registrar**, confirm the domain is **active**, contact data complete, and no **clientHold** / verification pending. |
| **Wrong hostname** | The name in the address bar must match **`SITE_ADDRESS`** on the server and your **DNS records**. |
| **No delegation to authoritative DNS** | `nslookup -type=NS your-domain` must eventually show the nameservers you intend (registrar, Cloudflare, etc.). |

**Not the cause:** Setting **`SITE_ADDRESS`** on your **local PC** only affects that machine’s Compose; it does **not** change public DNS or the Linode server.

#### B. A record exists in Cloudflare but the site still does not resolve

| Cause | What to check |
|--------|----------------|
| **Authoritative NS mismatch** | If the **TLD** still points **`ccwu.cc`** (example) to **registrar NS** (`ns1.dnshe.com`), but you only created the **A** record in **Cloudflare**, resolvers ask the registrar — not Cloudflare — and get **no A record**. **Fix:** either **change `ccwu.cc` nameservers** at the registrar to **Cloudflare’s pair** for that zone, **or** add the same **A** record at the **registrar** DNS. |
| **Subdomain delegated to Cloudflare** | If **`lord-in-hk.ccwu.cc`** is its **own** zone in Cloudflare, the **apex** of that zone is **`lord-in-hk.ccwu.cc`**. The DNS **Name** should be **`@`**, not **`lord-in-hk`** (which would create **`lord-in-hk.lord-in-hk.ccwu.cc`**). |

#### C. Cloudflare **525** (“SSL handshake failed”) after DNS works

| Cause | What to check |
|--------|----------------|
| **Origin has no valid cert yet** | Caddy must finish **Let’s Encrypt** for **`SITE_ADDRESS`**. Check: `docker compose logs caddy` on the server. |
| **Cloudflare SSL mode too weak or wrong** | Use **Full** or **Full (strict)** once the origin has a real cert ([§9.5](#95-cloudflare-in-front-optional--hide-origin-ip)). |

#### D. Caddy / Let’s Encrypt: `no valid A records found` (ACME DNS error)

Let’s Encrypt must resolve your hostname to an address **before** it runs the HTTP challenge. If the name was broken or **in retry backoff**, issuance fails until DNS is stable.

| Cause | What to do |
|--------|------------|
| **Orange cloud (Proxied) during first issuance** | Temporarily set the **A** record to **DNS only** (grey cloud) so public resolvers see your **Linode IP** and HTTP-01 can reach **Caddy on :80**. After **`docker compose logs caddy`** shows a successful certificate, switch back to **Proxied** and set **SSL/TLS → Full (strict)**. |
| **Repeated failures** | After fixing DNS, **`docker compose restart caddy`**. If errors persist, inspect logs; in rare cases clearing only Caddy’s cert storage volumes (see project `docker-compose.yml` volume names) and recreating **caddy** may be needed — **do not** remove Postgres volumes. |

#### E. Operational checklist (quick)

1. **`nslookup your.hostname 1.1.1.1`** — must return an **Address** (or Cloudflare anycast if proxied).  
2. **Server `.env`:** **`SITE_ADDRESS`** = exact public hostname; **`SESSION_COOKIE_SECURE=true`** for HTTPS-only.  
3. **`docker compose up -d --build`** from the correct project directory ([A5b](#a5b-deploy-user-vs-root--where-is-docker-composeyml)).  
4. **Cloudflare:** turn **Under Attack Mode** off unless you are under attack (it adds an interstitial for all visitors).

---

## 10. Security reminders

- Do **not** commit `.env` or share **secrets** (passwords, `SESSION_SECRET`, `OPENAI_API_KEY`, etc.) in public chats.
- Restrict firewall **22** to your IP when possible.
- Avoid exposing Postgres **5432** / Redis **6379** / backend **4000** to the public internet in production-oriented setups.
- **Dashboard auth:** Use strong app-local passwords, keep `SESSION_SECRET` private, and monitor `dashboard_audit_log`.
- **HTTPS:** TLS and **`allowedHosts`** do not replace authentication. With HTTPS-only access, set **`SESSION_COOKIE_SECURE=true`** (see [§9](#9-https-with-a-hostname-optional)).

---

## 11. One-page command list (happy path)

```text
# Server: install Docker (official docs) → verify hello-world

# Server:
git clone <repo-url>
cd <repo-folder>    # e.g. horse_dashboard — use real clone name
cp .env.example .env && nano .env   # POSTGRES_* + DATABASE_URL @postgres; SESSION_SECRET; AUTH_INITIAL_* variables

docker compose up -d --build
curl -sS http://127.0.0.1/health
# Browser: http://<PUBLIC_IP>/

# Optional HTTPS (see §9): DNS A → Linode IP; firewall 443; .env: SITE_ADDRESS=yourname.duckdns.org, SESSION_COOKIE_SECURE=true
#   git pull && docker compose up -d --build
#   Browser: https://yourname.duckdns.org/

# Update later (after git push from PC): git pull origin main && docker compose up -d --build
# If pull fails on untracked backup*.sql: move them out or rm, then pull again — see §6 D1

# Optional: copy local Postgres → server (recommended: UTF-8-safe)
# PC (PowerShell) — dump inside container, copy out (local DB user from .env, often hkjc):
#   docker compose exec postgres pg_dump -U hkjc --no-owner --no-acl -f /tmp/hkjc_export.sql hkjc_dashboard
#   docker cp <postgres-container-name>:/tmp/hkjc_export.sql .\hkjc_export.sql
#   scp .\hkjc_export.sql root@<IP>:/root/<repo-folder>/
# Server — use POSTGRES_USER from: docker exec <pg-container> env | grep POSTGRES
#   docker compose stop backend scraper recommender
#   docker exec … psql -U <POSTGRES_USER> -d postgres -c "DROP DATABASE IF EXISTS hkjc_dashboard WITH (FORCE);"
#   docker exec … psql -U <POSTGRES_USER> -d postgres -c "CREATE DATABASE hkjc_dashboard OWNER <POSTGRES_USER>;"
#   docker exec -i … psql -U <POSTGRES_USER> -d hkjc_dashboard -v ON_ERROR_STOP=1 < hkjc_export.sql
#   docker compose up -d
# Verify: psql SELECT horse_name … — Chinese must be correct before trusting the UI
```

---

## 12. References

- [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Linode Cloud Firewall](https://www.linode.com/docs/guides/cloud-firewall/)
