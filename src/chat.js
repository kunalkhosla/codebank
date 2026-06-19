// Builder Buddy — the kid-safe game-building chat. Only reached AFTER the gate
// (gate.js) confirms the kid has an open reward window.
import { streamMessages } from './anthropic.js';
import { store } from './db.js';
import { config } from './config.js';
import { kidConfig } from './gate.js';
import { randomUUID } from 'node:crypto';

function ageFrom(birthYear) {
  if (!birthYear) return null;
  return new Date().getFullYear() - birthYear;
}

function personaFor(kid, cfg) {
  if (cfg.persona) return cfg.persona;
  const age = ageFrom(kid.birth_year);
  const ageLine = age
    ? `The child is about ${age} years old. Match your language and game complexity to that age.`
    : `The child is a young learner. Keep language simple.`;
  const simpler = age && age <= 7
    ? 'Use very short sentences and lots of encouragement. Prefer Scratch-style ideas and tiny steps.'
    : 'Explain ideas clearly and simply, one step at a time, and celebrate their progress.';
  return `You are "Builder Buddy", a friendly, upbeat coding helper for a kid named ${kid.name}. ${ageLine}
${simpler}
You help them build games and fun programs. When you write a full game, return it as ONE complete self-contained HTML file inside a single \`\`\`html code block so it can be run instantly. Keep games wholesome and age-appropriate. Never discuss anything unsafe, scary, violent, or adult. Be warm, curious, and proud of what they make. Keep replies fairly short unless they ask for a full game.`;
}

const now = () => Date.now();
const id = () => `${now().toString(36)}${Math.floor(performance.now()).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function chat(kidId, userText, currentGameHtml = null, onDelta = null) {
  const kid = store.getKid(kidId);
  if (!kid) throw new Error('unknown kid');
  const cfg = kidConfig(kidId);
  const model = cfg.chat_model || config.chatModel;

  // Load recent history (oldest first), append the new turn.
  const history = store.recentTx(kidId, 16).reverse();
  const msgs = history.map((t) => ({ role: t.role, content: t.content }));
  // If the kid is iterating on a saved game ("Keep building"), give the model
  // the current code so it edits that game instead of starting over.
  if (currentGameHtml) {
    msgs.push({ role: 'user', content: `Here is the game we are currently building. Modify THIS code as I ask, and always return the full updated game in one \`\`\`html block:\n\n\`\`\`html\n${currentGameHtml.slice(0, 60000)}\n\`\`\`` });
    msgs.push({ role: 'assistant', content: 'Got it — I have our current game. What should we change?' });
  }
  msgs.push({ role: 'user', content: userText });

  store.insertTx(id(), kidId, now(), 'user', userText);

  // Streamed: a complete single-file game runs ~11k tokens / 60-135s. We stream
  // so (a) Cloudflare doesn't 524 (first byte in ~1s) and (b) the kid watches it
  // build. 16000 fits a full game with headroom; if it ever still truncates, the
  // partial is saved and `truncated` drives the "Keep building" hint.
  const { text, stopReason } = await streamMessages({
    model,
    system: personaFor(kid, cfg),
    msgs,
    max_tokens: 16000,
  }, onDelta);

  store.insertTx(id(), kidId, now(), 'assistant', text);
  return { text, truncated: stopReason === 'max_tokens' };
}
