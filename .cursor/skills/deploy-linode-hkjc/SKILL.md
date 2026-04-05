---
name: deploy-linode-hkjc
description: >-
  Deploys HKJC Dashboard with Docker Compose on Linode (Akamai), configures firewall and .env,
  migrates PostgreSQL from a local PC with UTF-8-safe dumps, and troubleshoots common failures.
  Use when the user asks about Linode or Akamai deployment, server setup, copying the database to
  the cloud, pg_dump/scp/psql/pg_restore, empty Analysis or analytics on the server, PowerShell or
  UTF-16 dump issues, Traditional Chinese mojibake after restore, role or password errors for
  Postgres, finding the clone directory after git clone, Caddy port 80, or HKJC production deploy.
---

# HKJC Dashboard — Linode deploy (agent skill)

## Canonical document

For **full steps, commands, and tables**, read and follow:

**`docs/DEPLOY_LINODE.md`**

If the user’s question is covered there, prefer quoting or paraphrasing that file so answers stay consistent with the repo. Do not invent alternate deploy paths unless the doc is silent.

---

## How to help (chatbot style)

1. **Clarify goal:** First deploy only, or deploy + **copy local Postgres data**?
2. **State facts:** Server DB is a **separate Docker volume** — the **Analysis** page reads **server Postgres**; it is **empty** until data is migrated or scraped on the server.
3. **Use a checklist** from `docs/DEPLOY_LINODE.md` §0 or §10 when walking the user through the happy path.
4. **Diagnose by symptom** using the cheat sheet in `docs/DEPLOY_LINODE.md` §8 before guessing.

---

## Non-negotiables (do not skip)

| Topic | Rule |
|-------|------|
| **`.env`** | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and **`DATABASE_URL`** must use the **same** user and password. In Compose, DB host is **`postgres`**, not `localhost`. |
| **Server Postgres user** | Never assume the role is `hkjc`. On the server run `docker exec <postgres-container> env \| grep POSTGRES` and use **`POSTGRES_USER`** in every `psql` / `pg_restore`. |
| **Dump on Windows** | Do **not** recommend raw PowerShell **`>`** to capture `pg_dump` — it often produces **UTF-16**, breaking `psql` and **corrupting Traditional Chinese**. |
| **Safe dump** | Prefer **`pg_dump -f /tmp/...` inside the container** + **`docker cp`** to the host, or **`-Fc`** + `pg_restore`. See `docs/DEPLOY_LINODE.md` §E1. |
| **Restore** | For a full SQL restore: **stop** backend/scraper/recommender, **DROP DATABASE … WITH (FORCE)**, **CREATE DATABASE**, then **`psql < file`**, then **`docker compose up -d`**. |
| **Verify Chinese** | After restore, **`SELECT horse_name …`** in `psql`. If names are wrong in SQL, **re-dump** with a UTF-8-safe method — not a frontend bug. |
| **Security** | Do not expose **5432** or **6379** publicly; do not commit `.env` or paste secrets in chat. |

---

## Quick symptom → action

| User says | Point to |
|-----------|----------|
| No data on server / empty Analysis | §7 — migrate DB or re-scrape; explain separate volume. |
| `role "hkjc" does not exist` | §8 — use actual `POSTGRES_USER` from `env \| grep POSTGRES`. |
| `invalid command \%…`, UTF-8 errors, `file` shows UTF-16 | §E1 / §E5 — re-dump with `docker cp` or `-Fc`; `iconv` is last resort for Chinese. |
| Chinese garbled in UI after restore | §E1 — dump was corrupted on Windows; re-dump UTF-8-safe, full restore again. |
| Wrong folder on server | §4 — clone folder name = **repo name** (e.g. `horse_dashboard`); `find ~ -name docker-compose.yml`. |
| Auth / password errors | §5 C2–C3 — align `DATABASE_URL` with volume-initialized credentials. |

---

## Architecture reminder (one paragraph)

**Caddy :80** → `/api` and `/health` to **backend**, static UI to **frontend**. Browsing **`http://<PUBLIC_IP>/`** (not `:5173` / `:4000` on the host). Details: `docs/DEPLOY_LINODE.md` §1.

---

## When the full doc might change

If deployment steps in the repository change, **update `docs/DEPLOY_LINODE.md` first**, then adjust this skill only if triggers or non-negotiables need to stay in sync.
