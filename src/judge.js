// Progress judge: compares the previous vs current coding snapshot and decides
// whether GENUINE programming progress happened. This is what stops "open
// code.org and idle for 30 min" from earning AI time.
import { messages, imageBlock } from './anthropic.js';
import { config } from './config.js';

const SYSTEM = `You are a strict but fair judge of whether a child made REAL programming progress between two snapshots of their coding project (Scratch or code.org). You are shown the BEFORE and AFTER state (screenshots, and sometimes the extracted code/blocks).

Score genuine building: new blocks/code, new game logic, fixing bugs, adding sprites/sounds/levels, meaningful edits.
Do NOT reward: an idle/unchanged screen, just clicking around, trivial cosmetic nudges, deleting then re-adding, or content that looks pasted wholesale with no building.

Reply with ONLY a JSON object, no prose:
{"progressScore": <0..1>, "reason": "<short kid-readable sentence>", "suspectedIdle": <true|false>}`;

function parseJudgment(text) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const o = JSON.parse(m ? m[0] : text);
    return {
      progressScore: Math.max(0, Math.min(1, Number(o.progressScore) || 0)),
      reason: String(o.reason || '').slice(0, 300),
      suspectedIdle: !!o.suspectedIdle,
    };
  } catch {
    return { progressScore: 0, reason: 'could not judge snapshot', suspectedIdle: true };
  }
}

// prev/cur: { mediaType, base64 } | null ; prevCode/curCode: string | null
export async function judgeProgress({ platform, prev, cur, prevCode, curCode }) {
  const content = [];
  content.push({ type: 'text', text: `Platform: ${platform || 'unknown'}.` });
  if (prev) { content.push({ type: 'text', text: 'BEFORE snapshot:' }); content.push(imageBlock(prev.mediaType, prev.base64)); }
  if (cur) { content.push({ type: 'text', text: 'AFTER snapshot:' }); content.push(imageBlock(cur.mediaType, cur.base64)); }
  if (prevCode) content.push({ type: 'text', text: `BEFORE code/blocks:\n${prevCode.slice(0, 4000)}` });
  if (curCode) content.push({ type: 'text', text: `AFTER code/blocks:\n${curCode.slice(0, 4000)}` });
  if (!prev && !cur && !prevCode && !curCode) {
    return { progressScore: 0, reason: 'no snapshot data', suspectedIdle: true };
  }
  content.push({ type: 'text', text: 'Judge the progress now. JSON only.' });

  const { text } = await messages({
    model: config.judgeModel,
    system: SYSTEM,
    msgs: [{ role: 'user', content }],
    max_tokens: 300,
    temperature: 0,
  });
  return parseJudgment(text);
}
