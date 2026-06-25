// Anthropic-relative weights: cache read ~10%, cache write ~125%
const CR = 0.1;
const CW = 1.25;

const billedOf = u => (u.in || 0) + (u.out || 0) + (u.cw || 0) * CW + (u.cr || 0) * CR;

const k = n => n >= 1e9 ? (n / 1e9).toFixed(1) + 'b'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + 'm'
  : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k'
  : String(Math.round(n));

const pct = (part, total) => total > 0 ? Math.round((part / total) * 100) : 0;

const median = arr => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx];
};

module.exports = { CR, CW, billedOf, k, pct, median, percentile };