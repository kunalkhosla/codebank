// CodeBank Sensor — periodically captures the active code.org/Scratch tab and
// reports it to the backend. It can ONLY add earned time via verified progress;
// it never unlocks anything (the gate is server-side).

const TARGET = /studio\.code\.org|scratch\.mit\.edu/;
const IDLE_SKIP_MS = 6 * 60 * 1000; // skip a snapshot if no input for >6 min

async function cfg() {
  return chrome.storage.local.get(['backend', 'kidId', 'sessionId', 'interval']);
}

async function schedule() {
  const { interval } = await cfg();
  chrome.alarms.create('snap', { periodInMinutes: Math.max(1, Number(interval) || 4) });
}

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'snap') tick(); });

async function activeTargetTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !TARGET.test(tab.url || '')) return null;
  return tab;
}

async function tick(manual = false) {
  const c = await cfg();
  if (!c.backend || !c.kidId) return { ok: false, reason: 'not configured' };
  const tab = await activeTargetTab();
  if (!tab) return { ok: false, reason: 'no code.org/Scratch tab active' };

  let info = { code: '', idleMs: 0, platform: /scratch/.test(tab.url) ? 'scratch' : 'codeorg' };
  try { info = Object.assign(info, await chrome.tabs.sendMessage(tab.id, { type: 'codebank-extract' })); } catch {}
  if (!manual && info.idleMs > IDLE_SKIP_MS) return { ok: false, reason: 'idle — skipped' };

  let imageBase64;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    imageBase64 = dataUrl.split(',')[1];
  } catch {}

  const body = {
    kidId: c.kidId, sessionId: c.sessionId, platform: info.platform,
    imageBase64, mediaType: 'image/png', code: info.code,
  };
  try {
    const r = await fetch(c.backend.replace(/\/$/, '') + '/api/snapshot', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json();
    if (j.sessionId && j.sessionId !== c.sessionId) chrome.storage.local.set({ sessionId: j.sessionId });
    chrome.storage.local.set({ last: { at: Date.now(), score: j.score, reason: j.reason, accruedSec: j.accruedSec } });
    return { ok: true, ...j };
  } catch (e) {
    return { ok: false, reason: 'network error' };
  }
}

// popup commands
chrome.runtime.onMessage.addListener((m, s, send) => {
  if (m.type === 'codebank-start') {
    (async () => {
      const c = await cfg();
      try {
        const r = await fetch(c.backend.replace(/\/$/, '') + '/api/session/start', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kidId: c.kidId, platform: 'sensor' }),
        });
        const j = await r.json();
        await chrome.storage.local.set({ sessionId: j.sessionId, interval: j.snapshotIntervalMin || 4 });
        await schedule();
        send({ ok: true, sessionId: j.sessionId, interval: j.snapshotIntervalMin });
      } catch (e) { send({ ok: false, reason: 'could not reach backend' }); }
    })();
    return true;
  }
  if (m.type === 'codebank-snap-now') { tick(true).then(send); return true; }
});
