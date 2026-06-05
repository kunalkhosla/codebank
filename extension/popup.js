const $ = (id) => document.getElementById(id);
const set = (t, cls) => { const s = $('status'); s.textContent = t; s.className = 'status ' + (cls || ''); };

chrome.storage.local.get(['backend', 'kidId', 'last'], (c) => {
  $('backend').value = c.backend || 'https://codebank.mirellolabs.com';
  $('kidId').value = c.kidId || '';
  if (c.last) set(`Last: ${c.last.accruedSec ? '+' + Math.round(c.last.accruedSec / 60) + 'm' : '0m'} — ${c.last.reason || ''}`, c.last.accruedSec ? 'ok' : 'no');
});

$('save').onclick = async () => {
  const backend = $('backend').value.trim();
  const kidId = $('kidId').value.trim();
  if (!backend || !kidId) return set('Enter backend URL and Kid ID', 'no');
  await chrome.storage.local.set({ backend, kidId });
  set('Starting session…');
  chrome.runtime.sendMessage({ type: 'codebank-start' }, (r) => {
    if (r && r.ok) set(`Session started ✓ (snapshot every ${r.interval || 4} min). Open code.org or Scratch and build!`, 'ok');
    else set('Could not start: ' + (r?.reason || 'error'), 'no');
  });
};

$('snap').onclick = () => {
  set('Capturing…');
  chrome.runtime.sendMessage({ type: 'codebank-snap-now' }, (r) => {
    if (r && r.ok) set(`Snapshot sent. Score ${r.score?.toFixed?.(2) ?? '–'} · ${r.accruedSec ? '+' + Math.round(r.accruedSec / 60) + 'm earned' : 'no time (keep building)'} — ${r.reason || ''}`, r.accruedSec ? 'ok' : 'no');
    else set(r?.reason || 'Failed — is a code.org/Scratch tab active?', 'no');
  });
};
