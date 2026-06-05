# CLAUDE.md — CodeBank

Guidance for Claude Code working in this repo.

> **This repo is PUBLIC.** Never commit kid names, secrets, API keys, server
> hostnames/IPs, or 1Password references. Kid profiles come from the
> `CODEBANK_KIDS` env var at runtime; secrets come from the host environment.
> Cross-cutting infra/deploy specifics (hestia, Cloudflare, secrets) live in the
> private `khosla-hq` repo — read `khosla-hq/services/codebank.md` for those.

## What it is

Kids earn AI chat time by making AI-verified coding progress in code.org/Scratch.
The reward is a kid-safe Claude chat ("Builder Buddy"). The lock is **server-side**;
the browser extension is a sensor with no unlock power. See `README.md`.

## Layout

- `src/config.js` — env-driven config (no secrets/kid data committed)
- `src/db.js` — SQLite schema + prepared statements (the only place kid data lives, at runtime)
- `src/gate.js` — **the earn-to-unlock core.** The only place that decides locked/unlocked. Change carefully; `test/gate.test.js` guards it.
- `src/judge.js` — Claude vision progress judge
- `src/chat.js` — Builder Buddy chat (age-tuned persona)
- `src/anthropic.js` — minimal Messages API client (fetch, no SDK)
- `src/server.js` — Hono routes + kid seeding + static serving
- `public/index.html` — kid chat UI (playful, kid-friendly)
- `public/admin.html` — parent dashboard
- `extension/` — MV3 sensor for code.org/Scratch

## Conventions

- **Verify before reporting done.** Run `npm test`; for backend changes, smoke
  `/healthz`, `/api/status`, and a real `/api/chat` after granting time.
- **Keep it public-safe.** Anything kid- or infra-specific is runtime config, not code.
- No build step — plain ESM Node. Keep dependencies minimal.
- The gate model: earn `threshold` coding minutes → opening a reward window spends
  them and grants `reward_window` minutes, bounded by `daily_cap`. Earned time is
  capped at `2× threshold` so a kid can't hoard a reserve.

## Deploy

Push to `main` → GitHub Actions builds the image to GHCR and recreates the
container on the self-hosted server (Tailscale + forced-command SSH). Runtime
secrets (`ANTHROPIC_API_KEY`, `ADMIN_PASS`, `CODEBANK_KIDS`) live in the server's
`.env`, sourced from 1Password — never in this repo. Details in
`khosla-hq/services/codebank.md`.
