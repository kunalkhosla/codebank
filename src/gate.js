// The earn-to-unlock core. The ONLY place that decides locked/unlocked.
// This runs server-side; the browser extension is a sensor that can only
// *add* earned time via verified snapshots — it can never open the gate.
import { store } from './db.js';
import { config } from './config.js';

export const todayStr = (d = new Date()) => {
  // Local-time YYYY-MM-DD (TZ set on the box, e.g. America/New_York).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export function kidConfig(kidId) {
  const c = store.getConfig(kidId);
  if (c) return c;
  return { kid_id: kidId, ...config.defaults, chat_model: null, persona: null };
}

function ledgerToday(kidId) {
  const day = todayStr();
  let l = store.getLedger(kidId, day);
  if (!l) {
    l = { kid_id: kidId, day, earned_sec: 0, spent_sec: 0, window_open_until: 0 };
    store.upsertLedger(l);
  }
  return l;
}

// Add verified coding seconds to today's bank.
export function addEarned(kidId, sec) {
  const c = kidConfig(kidId);
  const l = ledgerToday(kidId);
  // Cap the bank so a kid can't farm an unlimited reserve in one sitting.
  const cap = c.earn_threshold_min * 60 * 2;
  l.earned_sec = Math.min(cap, l.earned_sec + Math.max(0, Math.round(sec)));
  store.upsertLedger(l);
  return l;
}

// Compute current status without mutating.
export function status(kidId, now = Date.now()) {
  const c = kidConfig(kidId);
  const l = ledgerToday(kidId);
  const thresholdSec = c.earn_threshold_min * 60;
  const dailyCapSec = c.daily_cap_min * 60;
  const unlocked = now < l.window_open_until;
  const windowSecLeft = unlocked ? Math.round((l.window_open_until - now) / 1000) : 0;
  const dailyRemainingSec = Math.max(0, dailyCapSec - l.spent_sec);
  const canOpen = !unlocked && l.earned_sec >= thresholdSec && dailyRemainingSec > 0;
  const needSec = Math.max(0, thresholdSec - l.earned_sec);
  return {
    kidId,
    unlocked,
    canOpen,
    earnedSec: l.earned_sec,
    thresholdSec,
    needSec,                 // coding seconds still needed to open the next window
    windowSecLeft,
    spentSec: l.spent_sec,
    dailyCapSec,
    dailyRemainingSec,
    config: {
      earn_threshold_min: c.earn_threshold_min,
      reward_window_min: c.reward_window_min,
      daily_cap_min: c.daily_cap_min,
      snapshot_interval_min: c.snapshot_interval_min,
      min_progress_score: c.min_progress_score,
    },
  };
}

// Try to open a reward window. Spends `threshold` of earned time and grants a
// reward window bounded by the remaining daily cap. Returns updated status.
export function openWindow(kidId, now = Date.now()) {
  const c = kidConfig(kidId);
  const l = ledgerToday(kidId);
  const thresholdSec = c.earn_threshold_min * 60;
  const dailyCapSec = c.daily_cap_min * 60;
  const dailyRemainingSec = Math.max(0, dailyCapSec - l.spent_sec);

  if (now < l.window_open_until) return { opened: false, reason: 'already_open', status: status(kidId, now) };
  if (l.earned_sec < thresholdSec) return { opened: false, reason: 'not_enough_earned', status: status(kidId, now) };
  if (dailyRemainingSec <= 0) return { opened: false, reason: 'daily_cap_reached', status: status(kidId, now) };

  const grantSec = Math.min(c.reward_window_min * 60, dailyRemainingSec);
  l.earned_sec -= thresholdSec;
  l.spent_sec += grantSec;
  l.window_open_until = now + grantSec * 1000;
  store.upsertLedger(l);
  return { opened: true, grantSec, status: status(kidId, now) };
}

// Manual parent override: grant earned seconds (e.g. "+15 free min").
export function grantEarned(kidId, sec) {
  return addEarned(kidId, sec);
}

// Manual parent override: open (or extend) a reward window right now without
// requiring earned time. Bypasses the earn threshold and the daily cap. Counts
// the granted minutes against today's spent for visibility.
export function forceUnlock(kidId, minutes, now = Date.now()) {
  const c = kidConfig(kidId);
  const l = ledgerToday(kidId);
  const mins = minutes && minutes > 0 ? minutes : c.reward_window_min;
  l.window_open_until = Math.max(l.window_open_until, now) + mins * 60 * 1000;
  l.spent_sec += mins * 60;
  store.upsertLedger(l);
  return status(kidId, now);
}
