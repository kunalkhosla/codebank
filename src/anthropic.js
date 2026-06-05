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
  return { text, usage: data.usage };
}

export const imageBlock = (mediaType, base64) => ({
  type: 'image',
  source: { type: 'base64', media_type: mediaType, data: base64 },
});
