// Builder Buddy — the kid-safe game-building chat. Only reached AFTER the gate
// (gate.js) confirms the kid has an open reward window.
import { messages } from './anthropic.js';
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

export async function chat(kidId, userText) {
  const kid = store.getKid(kidId);
  if (!kid) throw new Error('unknown kid');
  const cfg = kidConfig(kidId);
  const model = cfg.chat_model || config.chatModel;

  // Load recent history (oldest first), append the new turn.
  const history = store.recentTx(kidId, 16).reverse();
  const msgs = history.map((t) => ({ role: t.role, content: t.content }));
  msgs.push({ role: 'user', content: userText });

  store.insertTx(id(), kidId, now(), 'user', userText);

  const { text } = await messages({
    model,
    system: personaFor(kid, cfg),
    msgs,
    max_tokens: 4096,
  });

  store.insertTx(id(), kidId, now(), 'assistant', text);
  return text;
}
