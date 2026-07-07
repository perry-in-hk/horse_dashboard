---
name: vps-ssh-security
description: >-
  Lynis on Ubuntu/Linode (hardening index before/after, PKGS-7392/7390, KRNL-5830 reboot,
  Redis DBS-1882 in Docker). SSH: keys, authorized_keys, id_ed25519_linode + ssh -i,
  passphrase vs Linux password, sudo vs SSH. ssh.socket vs ssh.service, Connection refused,
  lockout recovery (Lish/Weblish paste), Session B from Windows not from server, 99-hardening.conf,
  PermitRootLogin no, sudo -i for root. Use when the user asks about VPS security, Lynis results,
  SSH failures, passphrases, or updating docs/CYBER_SECURITY.md.
---

# VPS + SSH security (HKJC context)

## Canonical document

For **full findings, tables, recovery steps, timeline summary, and command reference**, read and follow:

**`docs/CYBER_SECURITY.md`**

Prefer aligning answers with that doc so guidance stays consistent. Do not invent conflicting SSH paths unless the user’s server differs.

## How to help

1. **Lynis:** Cite **hardening index** evolution (e.g. ~59 → ~63) when relevant; **PKGS-7392** vs **PKGS-7390** (`apt-get check`); **KRNL-5830** reboot; **PermitRootLogin** showing **`[ OK ]`** in SSH section after hardening; **Redis DBS-1882** often benign if Redis is in Docker.
2. **SSH failures:** **`Connection refused`** → **`ssh.socket`** / **`ssh.service`**, **`ss -tlnp`**, **`journalctl`** (see doc §6). **`Permission denied (publickey)`** → passphrase wrong or **`.pub`** not in **`authorized_keys`**; **new key** + **`-i`** path (doc §11–12).
3. **Lockouts:** Never disable **password** auth until **two** successful key sessions from **Windows**; **`sudo sshd -t`** before **`reload`**; recovery via **Lish** per doc §7.
4. **Session B:** Public-key test must run from **the same PC** that holds the private key (**PowerShell**), not from **`ssh` on the server** to itself.
5. **Passphrase vs password:** Passphrase unlocks **private key on the client**; **Linux password** is for account/sudo when applicable; clarify when the user mixes them up.
6. **Root:** Prefer **`sudo -i`** after **`deploy`** SSH; **direct `ssh root@`** only if **`PermitRootLogin`** allows it.
7. **Priorities:** Patching and firewall before sysctl/compliance extras; optional **`~/.ssh/config`** `Host` + **`IdentityFile`** on Windows (doc §12).

## Out of scope here

- Application-level auth (`dashboard_users`, `.env` secrets) — use **`docs/DEPLOY_LINODE.md`** and **`deploy-linode-hkjc`** skill unless the question is purely host SSH.
