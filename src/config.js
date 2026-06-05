// Central config, all overridable via env. No secrets or kid data committed —
// kid profiles are seeded at runtime from the CODEBANK_KIDS env var.
import path from 'node:path';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 8080),
  dataDir: process.env.DATA_DIR || path.resolve('data'),
  adminPass: process.env.ADMIN_PASS || '',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  chatModel: process.env.CHAT_MODEL || 'claude-sonnet-4-6',
  judgeModel: process.env.JUDGE_MODEL || 'claude-haiku-4-5-20251001',
  gitSha: process.env.GIT_SHA || 'dev',

  // Separate origin that serves games full-page (/play/:id). Games are framed
  // from HERE with allow-same-origin so their localStorage works, while staying
  // a different origin from the app (kid HTML can't read the admin password).
  playOrigin: process.env.PLAY_ORIGIN || '',

  // Per-kid defaults (each kid's row can override these in the DB).
  defaults: {
    earn_threshold_min: num(process.env.DEFAULT_THRESHOLD_MIN, 30),
    reward_window_min: num(process.env.DEFAULT_REWARD_MIN, 30),
    daily_cap_min: num(process.env.DEFAULT_DAILY_CAP_MIN, 120),
    snapshot_interval_min: num(process.env.DEFAULT_SNAPSHOT_INTERVAL_MIN, 4),
    min_progress_score: num(process.env.DEFAULT_MIN_SCORE, 0.5),
  },

  // Optional JSON seed: [{"id":"k1","name":"Coder","birthYear":2017}]
  // Kept in env (hestia .env), never in the repo, so no kid names are public.
  kidsSeed: process.env.CODEBANK_KIDS || '',
};
