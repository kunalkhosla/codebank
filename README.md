# 🏦 CodeBank

**Kids earn AI chat time by making real, AI-verified coding progress.**

CodeBank gates a kid-safe AI ("Builder Buddy") behind genuine programming work in
**code.org / Scratch**. Opening code.org and idling for 30 minutes earns nothing —
a Claude vision model judges each work snapshot and only *real* building (new
blocks, new logic, debugging) fills the time bank. Once the bank hits the
threshold, the AI unlocks for a configurable reward window.

Built for two of my kids; profile-driven so it works for any number of children
with per-kid thresholds, daily caps, and age-appropriate AI.

## Why it can't be gamed

- **The lock is server-side.** The browser extension is a *sensor only* — it
  reports progress, it cannot unlock anything. Disabling it just stops earning.
- **A vision model judges progress**, catching idle screens, paste-bombs, and
  no-op churn.
- **Idle snapshots are skipped** (no recent input → no capture), so "leave it
  open" farming earns nothing.
- **Parent receipts**: every snapshot + the judge's reasoning is visible in the
  dashboard.

There is **no `claude.ai` and no iframe** — Builder Buddy is its own page built on
the Anthropic API, which is exactly what makes the server-side lock possible.

## Two surfaces

| Surface | Where | What |
|---|---|---|
| **Earning** | code.org / Scratch (their own tabs) | the extension watches them, snapshots → judge |
| **Reward + parent** | this app, one origin | `/` Builder Buddy kid chat · `/admin` parent dashboard |

## Architecture

```
code.org / Scratch ──[extension sensor]── screenshots+code ─┐
                                                            ▼
  POST /api/snapshot ── Claude vision JUDGE ── accrue verified minutes
                                                            │
Builder Buddy chat ──► POST /api/chat ── server-side GATE ──┤── unlocked? ─► Claude API
                                                            │
  /admin ── parent dashboard (per-kid knobs + receipts) ────┘
              SQLite time-bank ledger
```

- **Backend**: Node + [Hono](https://hono.dev) + better-sqlite3. No build step.
- **Gate** (`src/gate.js`): the only place that decides locked/unlocked. Earn
  `threshold` coding minutes → spend them to open a `reward_window`, bounded by a
  daily cap.
- **Judge** (`src/judge.js`): Claude Haiku vision compares before/after snapshots.
- **Chat** (`src/chat.js`): Claude Sonnet/Opus, age-tuned kid-safe persona, returns
  runnable single-file HTML games.

## Run locally

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... ADMIN_PASS=secret \
  CODEBANK_KIDS='[{"id":"k1","name":"Coder","birthYear":2017,"avatar":"🦊"}]' \
  npm start
# kid chat:        http://localhost:8080/
# parent dashboard http://localhost:8080/admin
npm test   # gate logic
```

## Configuration (env)

| Var | Required | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — | chat + vision judge |
| `ADMIN_PASS` | yes | — | parent dashboard auth |
| `CODEBANK_KIDS` | no | demo kid | JSON kid profiles (kept in env, never in the repo) |
| `CHAT_MODEL` | no | `claude-sonnet-4-6` | per-kid override in dashboard |
| `JUDGE_MODEL` | no | `claude-haiku-4-5-20251001` | |
| `DEFAULT_THRESHOLD_MIN` | no | 30 | minutes of coding to unlock |
| `DEFAULT_REWARD_MIN` | no | 30 | AI minutes granted per unlock |
| `DEFAULT_DAILY_CAP_MIN` | no | 120 | max AI minutes/day |
| `DEFAULT_SNAPSHOT_INTERVAL_MIN` | no | 4 | sensor cadence / minutes per verified snapshot |
| `DEFAULT_MIN_SCORE` | no | 0.5 | progress score needed to count |
| `DATA_DIR` | no | `./data` | SQLite + snapshot images |

**No kid names or secrets live in this repo** — profiles come from `CODEBANK_KIDS`
at runtime, secrets from the host environment.

## API

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | health + git sha |
| `GET /api/kids` | profile list (id, name, avatar) |
| `GET /api/status?kid=ID` | earned/threshold, window left, daily cap |
| `POST /api/session/start` | begin a coding session (extension) |
| `POST /api/snapshot` | submit a snapshot → judged → accrue |
| `POST /api/chat` | gated kid chat |
| `POST /admin/api/*` | dashboard (config, grant, state) — `x-admin-pass` header |

## Browser extension

See [`extension/`](extension/) — the sensor that watches code.org / Scratch.

## Deploy

Containerized (`Dockerfile`) and deployed via GitHub Actions to a self-hosted
server. CI builds the image to GHCR and recreates the container; the AI key and
kid profiles live only in the server's environment. See `CLAUDE.md`.

## License

MIT
