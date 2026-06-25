/*
 * Best-effort translation for the dashboard tooltip (local proxy → avoids CORS in the browser).
 * Requires internet; in-memory cache per server session.
 */
const cache = new Map();

function normLang(tag) {
  return String(tag || 'en').split('-')[0].toLowerCase();
}

async function translateText(text, to) {
  const raw = String(text || '').trim();
  const lang = normLang(to);
  if (!raw) return { text: '', translated: false };
  if (!lang || lang === 'en') return { text: raw, translated: false };

  const key = lang + '|' + raw;
  if (cache.has(key)) return { text: cache.get(key), translated: true, cached: true };

  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'auto');
  url.searchParams.set('tl', lang);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', raw);

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('translation service unavailable');
  const data = await res.json();
  const out = (data[0] || []).map((p) => p[0]).join('').trim() || raw;
  cache.set(key, out);
  return { text: out, translated: true, cached: false };
}

module.exports = { normLang, translateText };