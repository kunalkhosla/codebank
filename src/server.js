import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { store } from './db.js';
import { status, openWindow, addEarned, grantEarned, forceUnlock, kidConfig } from './gate.js';
import { judgeProgress } from './judge.js';
import { chat } from './chat.js';

const SNAP_DIR = path.join(config.dataDir, 'snapshots');

// Pull the runnable game out of a Builder Buddy reply + give it a friendly title.
// Tolerant of a missing closing fence: if a reply gets truncated mid-game we
// still want to save what we have (the kid can "Keep building" to finish it)
// rather than dumping a wall of source into the chat.
function extractHtml(text) {
  const s = text || '';
  // Normal case: a complete ```html … ``` block.
  let m = s.match(/```html\s*([\s\S]*?)```/i);
  if (m) return m[1].trim();
  // Truncated reply: opening ```html fence but no closing fence — take the rest.
  m = s.match(/```html\s*([\s\S]*)$/i);
  if (m && /<[a-z!]/i.test(m[1])) return m[1].trim();
  // No fence at all, but the WHOLE reply is a raw HTML document. Anchored at the
  // start so ordinary prose that merely mentions "<html>" never matches.
  const trimmed = s.trim();
  if (/^<!DOCTYPE\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return trimmed;
  return null;
}
function deriveTitle(html, fallbackMsg) {
  const generic = /^(document|game|untitled|index|html)$/i;
  let t = (html.match(/<title>([^<]+)<\/title>/i) || [])[1];
  if (!t || generic.test(t.trim())) t = (html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || [])[1];
  if (!t) t = (fallbackMsg || '').replace(/[`*#]/g, '').trim().slice(0, 40);
  t = (t || 'My Game').trim();
  return t.length > 60 ? t.slice(0, 60) : t;
}

// ---- seed kids from env (no kid data in the repo) ----
// First-boot bootstrap ONLY: once any kid exists, the dashboard is the source of
// truth (so deletes/renames stick and CODEBANK_KIDS doesn't re-create them).
function seedKids() {
  const existing = store.listKids();
  if (existing.length) return;
  let seed = [];
  if (config.kidsSeed) {
    try { seed = JSON.parse(config.kidsSeed); } catch { console.error('CODEBANK_KIDS is not valid JSON'); }
  }
  if (!seed.length && !existing.length) {
    seed = [{ id: 'demo', name: 'Coder', avatar: '🦊' }]; // harmless default so the app is usable
  }
  for (const k of seed) {
    const kid = { id: k.id || randomUUID(), name: k.name || 'Coder', birth_year: k.birthYear || k.birth_year || null, avatar: k.avatar || '🦊', created_at: Date.now() };
    store.upsertKid(kid);
    if (!store.getConfig(kid.id)) {
      store.upsertConfig({ kid_id: kid.id, ...config.defaults, chat_model: null, persona: null });
    }
  }
}
seedKids();

const app = new Hono();

const pubKid = (k) => ({ id: k.id, name: k.name, avatar: k.avatar });

// ---------------- health ----------------
app.get('/healthz', (c) => c.json({ ok: true, sha: config.gitSha, kids: store.listKids().length }));

// ---------------- kid-facing API ----------------
app.get('/api/kids', (c) => c.json(store.listKids().map(pubKid)));

app.get('/api/status', (c) => {
  const kid = c.req.query('kid');
  if (!kid || !store.getKid(kid)) return c.json({ error: 'unknown kid' }, 400);
  return c.json(status(kid));
});

app.post('/api/session/start', async (c) => {
  const { kidId, platform } = await c.req.json().catch(() => ({}));
  if (!kidId || !store.getKid(kidId)) return c.json({ error: 'unknown kid' }, 400);
  const id = randomUUID();
  store.insertSession(id, kidId, platform || 'unknown', Date.now());
  return c.json({ sessionId: id, snapshotIntervalMin: kidConfig(kidId).snapshot_interval_min });
});

app.post('/api/snapshot', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { sessionId, kidId, platform, imageBase64, mediaType, code } = body;
  if (!kidId || !store.getKid(kidId)) return c.json({ error: 'unknown kid' }, 400);

  let sid = sessionId;
  if (!sid || !store.getSession(sid)) {
    sid = randomUUID();
    store.insertSession(sid, kidId, platform || 'unknown', Date.now());
  }

  const prevSnap = store.lastSnapshot(sid);
  let prev = null, prevCode = null;
  if (prevSnap) {
    prevCode = prevSnap.extracted_code || null;
    if (prevSnap.has_image) {
      const p = path.join(SNAP_DIR, `${prevSnap.id}.png`);
      if (fs.existsSync(p)) prev = { mediaType: 'image/png', base64: fs.readFileSync(p).toString('base64') };
    }
  }

  const snapId = randomUUID();
  let hasImage = 0;
  if (imageBase64) {
    fs.writeFileSync(path.join(SNAP_DIR, `${snapId}.png`), Buffer.from(imageBase64, 'base64'));
    hasImage = 1;
  }

  const cfg = kidConfig(kidId);
  let score = 0, reason = 'first snapshot — keep building!', suspectedIdle = false, accruedSec = 0;

  if (prevSnap) {
    try {
      const j = await judgeProgress({
        platform,
        prev,
        cur: imageBase64 ? { mediaType: mediaType || 'image/png', base64: imageBase64 } : null,
        prevCode,
        curCode: code || null,
      });
      score = j.progressScore; reason = j.reason; suspectedIdle = j.suspectedIdle;
      if (score >= cfg.min_progress_score) accruedSec = cfg.snapshot_interval_min * 60;
    } catch (e) {
      reason = 'judge error: ' + String(e.message || e).slice(0, 120);
    }
  }

  store.insertSnapshot({
    id: snapId, session_id: sid, kid_id: kidId, created_at: Date.now(), platform: platform || 'unknown',
    has_image: hasImage, extracted_code: code ? String(code).slice(0, 8000) : null,
    score, reason, suspected_idle: suspectedIdle ? 1 : 0, accrued_sec: accruedSec,
  });
  store.touchSession(Date.now(), sid);
  if (accruedSec > 0) addEarned(kidId, accruedSec);

  return c.json({ sessionId: sid, score, reason, suspectedIdle, accruedSec, status: status(kidId) });
});

app.post('/api/chat', async (c) => {
  const { kidId, message, gameId } = await c.req.json().catch(() => ({}));
  if (!kidId || !store.getKid(kidId)) return c.json({ error: 'unknown kid' }, 400);
  if (!message || !String(message).trim()) return c.json({ error: 'empty message' }, 400);

  let st = status(kidId);
  if (!st.unlocked) {
    const r = openWindow(kidId);
    if (!r.opened) {
      return c.json({ locked: true, status: r.status, reason: r.reason });
    }
    st = r.status;
  }

  // If iterating on a saved game, load its current code for context.
  let currentGameHtml = null;
  if (gameId) {
    const g = store.getGame(gameId);
    if (g && g.kid_id === kidId) currentGameHtml = g.html;
  }

  try {
    const { text: reply, truncated } = await chat(kidId, String(message).slice(0, 4000), currentGameHtml);

    // Auto-save any game in the reply to the kid's library.
    let savedGameId = null, savedTitle = null;
    const html = extractHtml(reply);
    if (html) {
      const t = Date.now();
      const title = deriveTitle(html, message);
      const target = gameId && store.getGame(gameId)?.kid_id === kidId
        ? store.getGame(gameId)
        : store.getGameByTitle(kidId, title);
      if (target) { store.updateGame({ id: target.id, title, html, updated_at: t }); savedGameId = target.id; }
      else { savedGameId = randomUUID(); store.insertGame({ id: savedGameId, kid_id: kidId, title, html, created_at: t, updated_at: t }); }
      savedTitle = title;
    }

    return c.json({ locked: false, reply, gameId: savedGameId, gameTitle: savedTitle, truncated, status: status(kidId) });
  } catch (e) {
    return c.json({ error: 'chat failed: ' + String(e.message || e).slice(0, 200) }, 500);
  }
});

// ---- games library (kid-facing) ----
app.get('/api/games', (c) => {
  const kid = c.req.query('kid');
  if (!kid || !store.getKid(kid)) return c.json({ error: 'unknown kid' }, 400);
  return c.json(store.listGames(kid));
});

app.get('/api/game/:id', (c) => {
  const kid = c.req.query('kid');
  const g = store.getGame(c.req.param('id'));
  if (!g || (kid && g.kid_id !== kid)) return c.notFound();
  return c.json({ id: g.id, title: g.title, html: g.html, updated_at: g.updated_at });
});

// Tells the kid UI which origin to frame games from (the isolated play domain).
app.get('/api/meta', (c) => c.json({ playOrigin: config.playOrigin }));

// Serves a game as a full HTML page. The kid UI frames this from the SEPARATE
// play origin (config.playOrigin) with allow-same-origin, so the game's
// localStorage works but it can't touch the app origin's storage/admin password.
app.get('/play/:id', (c) => {
  const g = store.getGame(c.req.param('id'));
  if (!g) return c.text('Game not found', 404);
  return c.html(g.html);
});

// ---------------- parent / admin API ----------------
const adminOk = (c) => config.adminPass && c.req.header('x-admin-pass') === config.adminPass;
const admin = new Hono();
admin.use('*', async (c, next) => {
  if (!config.adminPass) return c.json({ error: 'ADMIN_PASS not configured on server' }, 503);
  if (!adminOk(c)) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

admin.get('/api/state', (c) => {
  const kids = store.listKids().map((k) => ({
    ...pubKid(k), birth_year: k.birth_year,
    config: kidConfig(k.id),
    status: status(k.id),
    snapshots: store.recentSnapshots(k.id, 15),
    transcript: store.recentTx(k.id, 12).reverse(),
    games: store.listGames(k.id),
  }));
  return c.json({ kids, models: { chat: config.chatModel, judge: config.judgeModel } });
});

admin.post('/api/kid', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!b.name) return c.json({ error: 'name required' }, 400);
  const id = b.id || randomUUID();
  store.upsertKid({ id, name: b.name, birth_year: b.birthYear || null, avatar: b.avatar || '🦊', created_at: Date.now() });
  if (!store.getConfig(id)) store.upsertConfig({ kid_id: id, ...config.defaults, chat_model: null, persona: null });
  return c.json({ id });
});

admin.post('/api/config', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!b.kidId || !store.getKid(b.kidId)) return c.json({ error: 'unknown kid' }, 400);
  const cur = kidConfig(b.kidId);
  const merged = {
    kid_id: b.kidId,
    earn_threshold_min: b.earn_threshold_min ?? cur.earn_threshold_min,
    reward_window_min: b.reward_window_min ?? cur.reward_window_min,
    daily_cap_min: b.daily_cap_min ?? cur.daily_cap_min,
    snapshot_interval_min: b.snapshot_interval_min ?? cur.snapshot_interval_min,
    min_progress_score: b.min_progress_score ?? cur.min_progress_score,
    chat_model: b.chat_model ?? cur.chat_model ?? null,
    persona: b.persona ?? cur.persona ?? null,
  };
  store.upsertConfig(merged);
  return c.json({ ok: true, config: merged });
});

admin.post('/api/grant', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!b.kidId || !store.getKid(b.kidId)) return c.json({ error: 'unknown kid' }, 400);
  grantEarned(b.kidId, Number(b.minutes || 0) * 60);
  return c.json({ ok: true, status: status(b.kidId) });
});

admin.post('/api/unlock', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!b.kidId || !store.getKid(b.kidId)) return c.json({ error: 'unknown kid' }, 400);
  const st = forceUnlock(b.kidId, Number(b.minutes) || 0);
  return c.json({ ok: true, status: st });
});

admin.post('/api/game/import', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!b.kidId || !store.getKid(b.kidId)) return c.json({ error: 'unknown kid' }, 400);
  if (!b.html || !b.title) return c.json({ error: 'title and html required' }, 400);
  const t = Date.now();
  const id = randomUUID();
  store.insertGame({ id, kid_id: b.kidId, title: String(b.title).slice(0, 80), html: String(b.html), created_at: t, updated_at: t });
  return c.json({ ok: true, id });
});

admin.post('/api/kid/delete', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!b.kidId || !store.getKid(b.kidId)) return c.json({ error: 'unknown kid' }, 400);
  const snapIds = store.deleteKid(b.kidId);
  for (const id of snapIds) {
    const p = path.join(SNAP_DIR, `${id}.png`);
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
  }
  return c.json({ ok: true, deleted: b.kidId });
});

admin.get('/api/snapshot/:id/image', (c) => {
  const p = path.join(SNAP_DIR, `${c.req.param('id')}.png`);
  if (!fs.existsSync(p)) return c.notFound();
  return new Response(fs.readFileSync(p), { headers: { 'content-type': 'image/png' } });
});

// Serve the dashboard HTML unauthenticated (it's just the login UI); the
// /admin/api/* routes below stay behind the auth middleware. These GETs are
// registered BEFORE the sub-app mount so they aren't shadowed by its auth.
app.get('/admin', serveStatic({ path: './public/admin.html' }));
app.get('/admin/', serveStatic({ path: './public/admin.html' }));

app.route('/admin', admin);

// ---------------- static (kid chat + parent dashboard) ----------------
const root = './public';
app.get('/', serveStatic({ path: './public/index.html' }));
app.use('/*', serveStatic({ root }));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`CodeBank listening on :${info.port} (sha ${config.gitSha}, ${store.listKids().length} kids)`);
});
