// Deterministic test of the earn-to-unlock core (no network). Runs in CI as the
// guard that the gate math never silently breaks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'codebank-test-'));
process.env.DEFAULT_THRESHOLD_MIN = '30';
process.env.DEFAULT_REWARD_MIN = '30';
process.env.DEFAULT_DAILY_CAP_MIN = '60';
process.env.DEFAULT_SNAPSHOT_INTERVAL_MIN = '4';

const { store } = await import('../src/db.js');
const { status, openWindow, addEarned } = await import('../src/gate.js');

const kid = 'test-kid';
store.upsertKid({ id: kid, name: 'Tester', birth_year: null, avatar: '🦊', created_at: Date.now() });

test('starts locked with full threshold needed', () => {
  const s = status(kid);
  assert.equal(s.unlocked, false);
  assert.equal(s.canOpen, false);
  assert.equal(s.needSec, 30 * 60);
});

test('earning below threshold does not unlock', () => {
  addEarned(kid, 20 * 60);
  const s = status(kid);
  assert.equal(s.canOpen, false);
  assert.equal(s.needSec, 10 * 60);
});

test('hitting threshold makes it openable, then opening unlocks a window', () => {
  addEarned(kid, 10 * 60); // now 30 min banked
  assert.equal(status(kid).canOpen, true);
  const r = openWindow(kid);
  assert.equal(r.opened, true);
  assert.equal(r.grantSec, 30 * 60);
  const s = status(kid);
  assert.equal(s.unlocked, true);
  assert.ok(s.windowSecLeft > 29 * 60);
  assert.equal(s.earnedSec, 0); // threshold was spent to open the window
});

test('cannot open a second window while one is already open', () => {
  addEarned(kid, 30 * 60);
  const r = openWindow(kid);
  assert.equal(r.opened, false);
  assert.equal(r.reason, 'already_open');
});

test('daily cap is enforced across windows', () => {
  const kid2 = 'cap-kid';
  store.upsertKid({ id: kid2, name: 'Cap', birth_year: null, avatar: '🦊', created_at: Date.now() });
  const day = new Date();
  const ds = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
  // Re-fetch the ledger each time before forcing the window closed, so we
  // never write a stale earned/spent back over the DB.
  const forceClose = () => { const l = store.getLedger(kid2, ds); l.window_open_until = 0; store.upsertLedger(l); };

  // cap is 60 min, reward window 30 → exactly two windows possible per day.
  addEarned(kid2, 30 * 60); assert.equal(openWindow(kid2).opened, true);  // window 1, spent 30
  forceClose();
  addEarned(kid2, 30 * 60); assert.equal(openWindow(kid2).opened, true);  // window 2, spent 60 = cap
  forceClose();
  addEarned(kid2, 30 * 60);
  const r = openWindow(kid2);                                              // window 3 blocked by cap
  assert.equal(r.opened, false);
  assert.equal(r.reason, 'daily_cap_reached');
});
