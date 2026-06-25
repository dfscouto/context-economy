/** YYYY-MM-DD key in the local calendar (default: America/Sao_Paulo). */
const DEFAULT_TZ = process.env.CONTEXT_ECONOMY_TZ || 'America/Sao_Paulo';

function localDateKey(value, tz = DEFAULT_TZ) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

module.exports = { localDateKey, DEFAULT_TZ };