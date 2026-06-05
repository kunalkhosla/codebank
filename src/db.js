// SQLite schema + helpers. The DB is the only place kid names / progress data
// live — never the repo. File lives under config.dataDir (a mounted volume).
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'snapshots'), { recursive: true });

export const db = new Database(path.join(config.dataDir, 'codebank.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS kids (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  birth_year  INTEGER,
  avatar      TEXT DEFAULT '🦊',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  kid_id                TEXT PRIMARY KEY REFERENCES kids(id) ON DELETE CASCADE,
  earn_threshold_min    INTEGER NOT NULL,
  reward_window_min     INTEGER NOT NULL,
  daily_cap_min         INTEGER NOT NULL,
  snapshot_interval_min INTEGER NOT NULL,
  min_progress_score    REAL NOT NULL,
  chat_model            TEXT,
  persona               TEXT
);

CREATE TABLE IF NOT EXISTS ledger (
  kid_id           TEXT NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
  day              TEXT NOT NULL,
  earned_sec       INTEGER NOT NULL DEFAULT 0,
  spent_sec        INTEGER NOT NULL DEFAULT 0,
  window_open_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kid_id, day)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  kid_id     TEXT NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
  platform   TEXT,
  started_at INTEGER NOT NULL,
  last_snapshot_at INTEGER
);

CREATE TABLE IF NOT EXISTS snapshots (
  id            TEXT PRIMARY KEY,
  session_id    TEXT,
  kid_id        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  platform      TEXT,
  has_image     INTEGER DEFAULT 0,
  extracted_code TEXT,
  score         REAL,
  reason        TEXT,
  suspected_idle INTEGER DEFAULT 0,
  accrued_sec   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transcripts (
  id         TEXT PRIMARY KEY,
  kid_id     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snap_kid ON snapshots(kid_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tx_kid ON transcripts(kid_id, created_at);
`);

// ---- prepared statements ----
const q = {
  insertKid: db.prepare(`INSERT INTO kids (id,name,birth_year,avatar,created_at) VALUES (@id,@name,@birth_year,@avatar,@created_at)
    ON CONFLICT(id) DO UPDATE SET name=@name, birth_year=@birth_year, avatar=@avatar`),
  insertConfig: db.prepare(`INSERT INTO config (kid_id,earn_threshold_min,reward_window_min,daily_cap_min,snapshot_interval_min,min_progress_score,chat_model,persona)
    VALUES (@kid_id,@earn_threshold_min,@reward_window_min,@daily_cap_min,@snapshot_interval_min,@min_progress_score,@chat_model,@persona)
    ON CONFLICT(kid_id) DO UPDATE SET earn_threshold_min=@earn_threshold_min, reward_window_min=@reward_window_min,
      daily_cap_min=@daily_cap_min, snapshot_interval_min=@snapshot_interval_min, min_progress_score=@min_progress_score,
      chat_model=@chat_model, persona=@persona`),
  listKids: db.prepare(`SELECT * FROM kids ORDER BY created_at`),
  getKid: db.prepare(`SELECT * FROM kids WHERE id=?`),
  getConfig: db.prepare(`SELECT * FROM config WHERE kid_id=?`),
  getLedger: db.prepare(`SELECT * FROM ledger WHERE kid_id=? AND day=?`),
  upsertLedger: db.prepare(`INSERT INTO ledger (kid_id,day,earned_sec,spent_sec,window_open_until)
    VALUES (@kid_id,@day,@earned_sec,@spent_sec,@window_open_until)
    ON CONFLICT(kid_id,day) DO UPDATE SET earned_sec=@earned_sec, spent_sec=@spent_sec, window_open_until=@window_open_until`),
  insertSession: db.prepare(`INSERT INTO sessions (id,kid_id,platform,started_at) VALUES (?,?,?,?)`),
  getSession: db.prepare(`SELECT * FROM sessions WHERE id=?`),
  touchSession: db.prepare(`UPDATE sessions SET last_snapshot_at=? WHERE id=?`),
  lastSnapshot: db.prepare(`SELECT * FROM snapshots WHERE session_id=? ORDER BY created_at DESC LIMIT 1`),
  insertSnapshot: db.prepare(`INSERT INTO snapshots (id,session_id,kid_id,created_at,platform,has_image,extracted_code,score,reason,suspected_idle,accrued_sec)
    VALUES (@id,@session_id,@kid_id,@created_at,@platform,@has_image,@extracted_code,@score,@reason,@suspected_idle,@accrued_sec)`),
  recentSnapshots: db.prepare(`SELECT id,kid_id,created_at,platform,has_image,score,reason,suspected_idle,accrued_sec FROM snapshots WHERE kid_id=? ORDER BY created_at DESC LIMIT ?`),
  insertTx: db.prepare(`INSERT INTO transcripts (id,kid_id,created_at,role,content) VALUES (?,?,?,?,?)`),
  recentTx: db.prepare(`SELECT * FROM transcripts WHERE kid_id=? ORDER BY created_at DESC LIMIT ?`),
  snapIdsForKid: db.prepare(`SELECT id FROM snapshots WHERE kid_id=?`),
  delTx: db.prepare(`DELETE FROM transcripts WHERE kid_id=?`),
  delSnap: db.prepare(`DELETE FROM snapshots WHERE kid_id=?`),
  delSess: db.prepare(`DELETE FROM sessions WHERE kid_id=?`),
  delLedger: db.prepare(`DELETE FROM ledger WHERE kid_id=?`),
  delConfig: db.prepare(`DELETE FROM config WHERE kid_id=?`),
  delKid: db.prepare(`DELETE FROM kids WHERE id=?`),
};

// Delete a kid and everything tied to them (no FK cascade — done explicitly,
// in one transaction). Returns the snapshot ids so the caller can remove the
// image files from disk.
const deleteKidTx = db.transaction((id) => {
  const snapIds = q.snapIdsForKid.all(id).map((r) => r.id);
  q.delTx.run(id); q.delSnap.run(id); q.delSess.run(id);
  q.delLedger.run(id); q.delConfig.run(id); q.delKid.run(id);
  return snapIds;
});

export const store = {
  upsertKid: (k) => q.insertKid.run(k),
  upsertConfig: (c) => q.insertConfig.run(c),
  listKids: () => q.listKids.all(),
  getKid: (id) => q.getKid.get(id),
  getConfig: (id) => q.getConfig.get(id),
  getLedger: (id, day) => q.getLedger.get(id, day),
  upsertLedger: (l) => q.upsertLedger.run(l),
  insertSession: (id, kid, platform, t) => q.insertSession.run(id, kid, platform, t),
  getSession: (id) => q.getSession.get(id),
  touchSession: (t, id) => q.touchSession.run(t, id),
  lastSnapshot: (sid) => q.lastSnapshot.get(sid),
  insertSnapshot: (s) => q.insertSnapshot.run(s),
  recentSnapshots: (kid, n = 20) => q.recentSnapshots.all(kid, n),
  insertTx: (id, kid, t, role, content) => q.insertTx.run(id, kid, t, role, content),
  recentTx: (kid, n = 20) => q.recentTx.all(kid, n),
  deleteKid: (id) => deleteKidTx(id),
};
