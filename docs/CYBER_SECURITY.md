# VPS security notes (Linode / Ubuntu + SSH + Lynis)

This document summarizes findings, issues, methods, and solutions from a practical hardening thread: **Lynis on Ubuntu 24.04**, **SSH key setup**, **optional hardening**, **lockouts**, and **recovery**. It is **not** a full security program—use it as a checklist and teaching aid.

---

## 1. Scope

| Topic | What we used |
|--------|----------------|
| Host | Linode VM, **Ubuntu 24.04 (noble)**, kernel 6.8, Docker |
| Assessment | **Lynis** (`sudo apt install lynis` → `sudo lynis audit system`) |
| Remote access | **OpenSSH**, **Akamai/Linode Cloud Manager** (Weblish/Lish) |

**Windows dev PC:** Lynis does **not** audit Windows as a “full system” the same way; use Lynis on **Linux** (VPS or a full WSL distro), not only Docker Desktop’s minimal WSL.

---

## 2. Lynis audit — summary of findings

| Item | Initial run | After updates + SSH hardening (example) |
|------|----------------|-------------------------------------------|
| **Hardening index** | ~**59** / 100 | ~**63** / 100 |
| **Tests performed** | ~261 | ~261 |
| **Package-related** | **PKGS-7392** — vulnerable / outdated packages | Often improves after **`apt upgrade`**; may see **PKGS-7390** if `apt-get check` fails (run `sudo apt-get update && sudo apt-get check` to fix) |
| **Reboot** | Often **NO** | May show **KRNL-5830** — **reboot** after kernel updates |
| **SSH `PermitRootLogin` in Lynis** | **SUGGESTION** | Can show **`[ OK ]`** when **`PermitRootLogin no`** (or equivalent) is effective |
| **Strengths (typical)** | Host **firewall active**, **AppArmor**, **logging**, **time sync**, **Docker** | Usually unchanged; score bumps come from **patching + SSH + fewer findings** |
| **Gaps (typical)** | **fail2ban**, **auditd**, **sysctl** profile, **GRUB**, disk encryption | Many **suggestions** remain (~49) until optional packages/tuning |
| **Quirk** | **Redis** + no host config (**DBS-1882**) | Same if Redis is **in Docker** — often ignorable for Lynis |

**Interpretation:** Score and warnings are **normal** for an internet-facing app server that has not been fully hardened. **Patching** is the highest-impact item Lynis flagged.

---

## 3. SSH — what we measured

Effective settings (example from `sudo sshd -T | grep …`) included:

- **`PermitRootLogin yes`** — root may log in over SSH (higher risk if **password** auth is allowed).
- **`PasswordAuthentication yes`** — password logins allowed.
- **`PubkeyAuthentication yes`** — key-based login allowed.

Listening: **`0.0.0.0:22`** and **`[::]:22`** — SSH is reachable on the public interface (expected for remote admin; **brute-force** risk is why keys + fail2ban + firewall rules matter).

---

## 4. Why harden SSH (plain language)

- The server is on the **public internet**. SSH is the **remote control door**.
- **Passwords** can be guessed at scale. **SSH keys** are closer to a **physical key**: your PC holds the private part; the server stores only the matching public part.
- **`root`** is the **all-powerful** account. Using a **normal user** (`deploy`) plus **`sudo`** reduces routine use of full power; **disabling root SSH** reduces one high-value target.
- **Order matters:** changing auth **before** keys work can **lock you out**—hence “two sessions + console backup.”

---

## 5. Recommended safe order (method)

1. Create a **sudo user** (e.g. `deploy`) if you only used `root` before.
2. Install **only the public key** (`*.pub`) into **`/home/deploy/.ssh/authorized_keys`** — **one line**, **600** on file, **700** on `.ssh`, owner **`deploy:deploy`**.
3. Open a **second** SSH session and confirm **key login works** before changing sshd.
4. Add a **drop-in** file, e.g. `/etc/ssh/sshd_config.d/99-hardening.conf`, with **only** valid lines (no stray characters):

   ```text
   PubkeyAuthentication yes
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   PermitRootLogin no
   ```

5. Run **`sudo sshd -t`** (must be silent), then **`sudo systemctl reload ssh`**.
6. Test a **third** new session before closing older ones.
7. Keep **Lish/Weblish** (or rescue) available until tests pass.

---

## 6. Issues and solutions (what went wrong in practice)

| Issue | Cause | Solution |
|--------|--------|----------|
| **`ssh: connect … Connection refused`** (port 22) | **`sshd` not listening** or **`ssh.socket` stopped**; or bad config prevented start | **Lish:** `sudo systemctl status ssh.socket` / `ssh`; `sudo ss -tlnp \| grep :22`; `sudo systemctl enable --now ssh.socket` or `sudo systemctl enable --now ssh`; `sudo journalctl -u ssh -u ssh.socket` |
| **`Could not resolve hostname your_server_ip`** | Literal **placeholder** used instead of real IP | Use the **numeric IP** or real hostname from Linode |
| **Wrong key passphrase / `incorrect passphrase supplied`** | Passphrase forgotten or different from key creation | **`ssh-keygen -y -f path\to\key`** to verify; if unrecoverable, create **new** key (`id_ed25519_linode`), add **`.pub`** via **Lish** to `authorized_keys`, connect with **`ssh -i …\id_ed25519_linode deploy@IP`** |
| **`Permission denied (publickey)`** with new key | Server **does not have** matching **`.pub`** line for that private key | Paste **exact** line from **`Get-Content …\.pub`** into **`/home/deploy/.ssh/authorized_keys`**; **`chmod 600`** / **`chown deploy:deploy`** |
| **Session B test from server** (`deploy@localhost` SSH to self) | Uses keys **on the server**, not your **Windows** key | Run **`ssh -o PreferredAuthentications=publickey deploy@IP`** from **Windows PowerShell**, not from the Linode shell, to validate **your PC’s** key |
| **`unsupported option "no1~PubkeyAuthentication"`** | Bad paste / **`~`** / merged lines in `sshd_config.d` | One directive per line; **no** tildes or garbage; `sudo sshd -t` before reload |
| **`Permission denied (publickey,password)`** | Wrong **key passphrase**, or **public key** not in `authorized_keys`, or wrong **user** | Verify passphrase with `ssh-keygen -y -f ~/.ssh/id_ed25519`; fix `authorized_keys` and permissions |
| **Passphrase vs password** | Confusion between **unlocking the key on your PC** vs **Linux account password** | Passphrase → local private key; `deploy` password → only if **password** SSH auth is enabled |
| **Locked out after reload** | Keys not working while **password** auth was disabled | **Lish/Weblish** or **SSH to Lish gateway**; temporarily set **`PasswordAuthentication yes`** / remove drop-in; **reload** ssh |
| **Weblish paste** | Browser console does not always use **Ctrl+V** | Try **Ctrl+Shift+V**, **Shift+Insert**, **right-click → Paste** |
| **“Whole line” for authorized_keys** | Must be a **single** `ssh-ed25519 AAAA... comment` line | Paste **entire** `.pub` line; never paste the **private** key (file **without** `.pub`) |

---

## 7. Recovery without SSH (outline)

1. **Akamai Cloud Manager** → **Linodes** → your instance → **Launch LISH Console** / **Console** (exact label varies).
2. Log in on console as **`root`** or **`deploy`** if passwords work.
3. Fix **`/etc/ssh/sshd_config.d/99-hardening.conf`** (or remove it), **`sudo sshd -t`**, **`sudo systemctl reload ssh`**.
4. Alternative: **SSH to Lish** — `ssh -t USERNAME@lish.REGION.linode.com LINODE_LABEL` (see Akamai docs for your region).
5. Last resort: **Rescue mode**, mount disk, edit config under **`/mnt`**, reboot.

---

## 8. Using `root` after switching to `deploy`

- **Recommended:** SSH as **`deploy`**, then:

  ```bash
  sudo -i
  ```

  or `sudo su -` for a root shell.

- **Direct `ssh root@...`:** Only if **`PermitRootLogin`** allows it in sshd config; otherwise enable it deliberately (understand the trade-off) or rely on **`sudo`**.

---

## 9. Priority improvements (from Lynis + SSH)

| Priority | Action |
|----------|--------|
| **P0** | **Install security updates** (`apt update` / `upgrade`); verify **`unattended-upgrades`** for security patches where appropriate |
| **P0** | **Firewall** — only expose needed ports; DB/Redis not public unless required |
| **P1** | **SSH keys** working; then **`PasswordAuthentication no`**, **`PermitRootLogin no`** (with two-session test procedure) |
| **P1** | **fail2ban** (or equivalent) for SSH |
| **P2** | **auditd**, file integrity, sysctl tuning — only with clear need and testing |

---

## 10. Files and commands reference

| Purpose | Location / command |
|---------|---------------------|
| Lynis log | `/var/log/lynis.log` |
| Lynis report | `/var/log/lynis-report.dat` |
| SSH drop-in | `/etc/ssh/sshd_config.d/*.conf` |
| Deploy keys | `/home/deploy/.ssh/authorized_keys` |
| Check effective SSH | `sudo sshd -T \| grep -E '^(passwordauthentication|permitrootlogin|pubkeyauthentication)\s'` |
| Compose under **`root` only** | **`/root/<repo>/docker-compose.yml`** — **`deploy`** needs **`sudo`** to **`cd`** or edit; see **`docs/DEPLOY_LINODE.md`** [A5b](DEPLOY_LINODE.md#a5b-deploy-user-vs-root--where-is-docker-composeyml) |
| Discard find stderr (wrong redirect) | Use **`2>/dev/null`**, not **`2>/dev/`** |

---

## 11. Dashboard auth baseline controls

The app now uses local username/password + session auth (no external IdP). For classified horse data, keep these controls enabled:

- **Transport:** serve the dashboard only over HTTPS and keep `SESSION_COOKIE_SECURE=true` in production.
- **Session:** keep `SESSION_SECRET` private, rotate it during incident response, and set `SESSION_MAX_AGE_HOURS` to a short value (default 24).
- **Brute-force resistance:** keep login rate limiting enabled on `POST /api/auth/login`.
- **Auditability:** monitor `dashboard_audit_log` for `login_failure` spikes or unusual `admin_create_user` activity.

Quick SQL check:

```sql
SELECT created_at, event_type, success, username, ip
FROM dashboard_audit_log
ORDER BY created_at DESC
LIMIT 20;
```

---

## 12. Chat thread summary (what happened in practice)

High-level story from the project conversation—useful for **future you** or anyone picking this up cold.

1. **Lynis on Windows** — Not meaningful for “whole PC” audit; run Lynis **on the Linux VPS** (or a full Linux environment).
2. **First Lynis (Ubuntu 24.04)** — Hardening index ~**59**, package warning, many suggestions; typical VPS + Docker.
3. **SSH plan** — `deploy` user, **`authorized_keys`**, optional **`99-hardening.conf`**; **two SSH sessions + Lish** before disabling passwords.
4. **Mistakes & recovery** — Placeholder hostname; **garbled `sshd_config.d`** (`~` / merged lines) → **`sshd -t`** before reload; **lockout** → Lish / relax **`PasswordAuthentication`**.
5. **`Connection refused`** — **`ssh.service` inactive** with **`ssh.socket`** (socket activation): ensure **`ssh.socket`** or **`ssh`** is enabled and listening on **port 22**; check **`journalctl`** if **`sshd` fails**.
6. **Passphrase confusion** — **`ssh-keygen -y`** failed → **wrong passphrase** for `id_ed25519`; **new key** **`id_ed25519_linode`**, install **`.pub`** via **Lish**, login with **`ssh -i …\id_ed25519_linode deploy@IP`**.
7. **Concepts** — **Passphrase** unlocks private key **on your PC**; **Linux password** is separate; **`sudo`** may still ask for password after SSH key login; **root work** → **`sudo -i`** after **`deploy`** SSH, unless **`PermitRootLogin`** is deliberately enabled.
8. **Second Lynis** — Index ~**63**; **`PermitRootLogin`** can show **`[ OK ]`** in the SSH section; **vulnerable packages** check may flip to **OK** after upgrades; new warnings possible: **reboot needed** (**KRNL-5830**), **apt consistency** (**PKGS-7390**). **Redis DBS-1882** often remains if Redis is in **Docker**.
9. **Deploy vs `root` project path** — If **`git clone` / Docker** were done as **`root`**, **`docker-compose.yml`** lives under **`/root/<repo-folder>`** (e.g. **`horse_dashboard`**). As **`deploy`**, **`find ~`** does not search **`/root`**; use **`sudo find /root -name 'docker-compose.y*ml' 2>/dev/null`**. Empty **`/home/deploy`** with only dotfiles is consistent with “app only under **`root`**.”
10. **`cd /root/...` → Permission denied** — **`/root`** is **`700`**. Non-root users must use **`sudo -i`**, **`sudo nano /root/.../.env`**, or **`sudo bash -c 'cd /root/... && docker compose …'`** — not plain **`cd`** as **`deploy`**.
11. **`docker compose` → “no configuration file provided”** — Usually the shell never **`cd`**’d into the project dir (e.g. **`cd /root`** failed). Run Compose from the directory that contains **`docker-compose.yml`** (see item 10).
12. **`2>/dev/null` typo** — **`find … 2>/dev/null`** sends stderr to the null device. **`2>/dev/`** points at a **directory** → **`bash: /dev/: Is a directory`**. Use **`/dev/null`**, not **`/dev/`**.
13. **Cloudflare vs DNS content** — **Nameservers** (**`*.ns.cloudflare.com`**) go in the **registrar** nameserver fields. **A** records in **Cloudflare** still use the **Linode IPv4** as **record content** — not the nameserver hostnames. **`SITE_ADDRESS`** must match the public hostname (see **`docs/DEPLOY_LINODE.md`** §9.5).

---

## 13. Optional: SSH client config (Windows)

To avoid typing **`-i`** every time for a dedicated key:

**`C:\Users\<you>\.ssh\config`**

```text
Host linode
    HostName YOUR_SERVER_IP
    User deploy
    IdentityFile ~/.ssh/id_ed25519_linode
```

Then: **`ssh linode`**

**This project (PowerShell, dedicated key — copy from your Linode dashboard if the IP changes):**

```powershell
ssh -i $env:USERPROFILE\.ssh\id_ed25519_linode deploy@139.162.51.138
```

---

## 14. Disclaimer

This is **operational hygiene** for a small VPS, not legal or compliance advice. Re-assess after major OS or Docker changes.
