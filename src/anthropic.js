// Thin Anthropic Messages API client (no SDK dependency — just fetch).
import { config } from './config.js';

const API = 'https://api.anthropic.com/v1/messages';

export async function messages({ model, system, msgs, max_tokens = 2048, temperature }) {
  if (!config.anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, system, max_tokens, temperature, messages: msgs }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`anthropic ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return { text, usage: data.usage, stopReason: data.stop_reason };
}

// Streaming variant. Calls onDelta(textChunk) as text arrives and resolves with
// the full text + stop_reason once the stream ends. Streaming is REQUIRED for the
// game-builder: a complete game is ~11k tokens / ~60-135s, which would trip
// Cloudflare's ~100s origin timeout if buffered — streaming sends the first byte
// in ~1s so the edge connection stays alive.
export async function streamMessages({ model, system, msgs, max_tokens = 2048, temperature }, onDelta) {
  if (!config.anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, system, max_tokens, temperature, stream: true, messages: msgs }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`anthropic ${res.status}: ${body.slice(0, 500)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', stopReason = null, usage = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const ln of lines) {
      const line = ln.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let e;
      try { e = JSON.parse(payload); } catch { continue; }
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        text += e.delta.text;
        if (onDelta) onDelta(e.delta.text);
      } else if (e.type === 'message_delta') {
        if (e.delta?.stop_reason) stopReason = e.delta.stop_reason;
        if (e.usage) usage = e.usage;
      } else if (e.type === 'error') {
        throw new Error(`anthropic stream: ${JSON.stringify(e.error).slice(0, 200)}`);
      }
    }
  }
  return { text, stopReason, usage };
}

export const imageBlock = (mediaType, base64) => ({
  type: 'image',
  source: { type: 'base64', media_type: mediaType, data: base64 },
});
