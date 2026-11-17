export const API = 'https://api.chess.com/pub/puzzle/random';
export const KEY = 'dailyShuffleV1';
export const emptyState = () => ({ history: [], api: { nextAt: 0, puzzle: null } });

export function canonicalURL(value) {
  if (typeof value !== 'string') throw new Error('The API returned an invalid puzzle URL.');
  const url = new URL(value);
  const match = /^\/daily\/(\d{4}-\d{2}-\d{2})\/?$/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'www.chess.com' || url.port || url.username || url.password || !match) {
    throw new Error('The API returned an unsupported Daily Puzzle URL. No page was opened.');
  }
  const date = match[1];
  const time = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date || time > Date.now()) {
    throw new Error('The API returned an invalid puzzle date.');
  }
  return `https://www.chess.com/daily/${date}`;
}

export function parsePuzzle(data, now = Date.now()) {
  if (!data || typeof data !== 'object' || !Number.isInteger(data.publish_time) || data.publish_time <= 0 || data.publish_time * 1000 > now + 86400000) {
    throw new Error('The API returned invalid puzzle data. Please try again later.');
  }
  const url = canonicalURL(data.url);
  return { id: url, url, date: url.slice(-10), publishTime: data.publish_time,
    title: typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 300) : 'Daily Puzzle' };
}

export function cacheDelay(headers, now) {
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(headers.get('cache-control') || '');
  const age = Math.max(0, Number(headers.get('age')) || 0);
  const retry = headers.get('retry-after');
  const retryMs = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - now) || 0) : 0;
  return Math.max(16000, maxAge ? Math.max(0, Number(maxAge[1]) - age) * 1000 : 0, retryMs);
}

export const sortedHistory = history => [...history].sort((a, b) => b.visitedAt - a.visitedAt);
export function recordVisit(history, puzzle, now) {
  const previous = history.find(item => item.id === puzzle.id);
  return sortedHistory([{ ...puzzle, visitedAt: now, completed: previous?.completed === true }, ...history.filter(item => item.id !== puzzle.id)]);
}
export function dateLabel(date) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));
}
