---
name: professional-product-ui
description: >-
  Keeps user-facing frontend copy and in-app diagrams professional: no security
  lectures, env var catalogs, or implementation trivia that reads like a tutorial
  or helps attackers map the stack. Use when writing or editing UI strings,
  login/settings/help text, Mermaid diagrams shown in the app, admin hints, or
  when the user asks to avoid amateur or vibe-coded product copy.
---

# Professional product UI (not tutorial / recon-by-copy)

## Goal

End-user screens should read like a **shipping product**: short, task-oriented, and calm. They must **not** read like README fragments, homework, or a **stack map** for casual visitors.

## Do not put in user-visible UI

| Avoid | Why |
|-------|-----|
| **Security bragging** (“httpOnly”, “session cookie”, “no API keys in the bundle”) | Sounds defensive; teaches attackers how auth is shaped; users do not need a lecture. |
| **Exhaustive `.env` / variable names** (`SESSION_SECRET`, `AUTH_INITIAL_*`, `VITE_*`, `OPENAI_*`, …) | Same as publishing a checklist of what to steal or probe. Put detail in **repo docs** (e.g. `.env.example`), not login or Settings paragraphs. |
| **Exact API paths, table names, ports** in prose or diagram labels | Network tab already exists; do not duplicate in friendly copy. Generalize diagrams (“Analyze endpoint”, “signed-in requests”). |
| **Server paths** (`scraperRoot`, absolute paths) | Filesystem layout leak; operators use SSH / deployment docs. |
| **Bootstrap secret names** (`AUTH_INITIAL_USERNAME`) | Say “first admin is created on initial deploy when no users exist” without naming env keys. |
| **Stack name-dropping** (Zod, Docker service names) in captions | Fine in **developer docs**; in-app captions stay outcome-oriented unless the audience is clearly technical staff. |

## Do instead

- **Login**: Product name or one short line (“Sign in to continue.”). No architecture.
- **Settings / help**: Point operators to **deployment documentation** or `.env.example` in the repo—**one line**—instead of enumerating variables.
- **Diagrams in the app**: Architecture at a glance—**roles and data flow**, not env shopping lists. Prefer generic edge labels (“backend configuration”, “authenticated request”).
- **Errors**: User-safe messages; avoid raw stack traces or internal keys in production UI.

## Quick checklist (before shipping strings)

- [ ] Would a non-developer understand this without knowing the repo layout?
- [ ] Does any sentence **only** justify “we did security right”? → Remove or move to docs.
- [ ] Are we naming **secrets, paths, or tables**? → Generalize or remove.
- [ ] Could this shorten to **half the words** without losing meaning? → Do it.

## Where detail belongs

- **`.env.example`**, **`docs/`**, runbooks, internal README—not **login**, **empty-state**, or **caption** text aimed at everyday users.
