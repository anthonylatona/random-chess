import { API, KEY, emptyState, parsePuzzle, cacheDelay, canonicalURL, recordVisit, sortedHistory } from './shared.js';

// One writer owns storage. The queue also serializes edits from multiple extension pages.
export function createService({ storage, tabs, fetcher = fetch, now = Date.now }) {
  let queue = Promise.resolve();
  let randomBusy = false;
  async function read() {
    const result = (await storage.get(KEY))[KEY];
    return result && Array.isArray(result.history) && result.api ? result : emptyState();
  }
  const write = state => storage.set({ [KEY]: state });
  async function open(state, puzzle, tabId) {
    const url = canonicalURL(puzzle.url);
    const previous = state.history;
    state.history = recordVisit(previous, puzzle, now());
    await write(state); // Do not navigate if history cannot be saved.
    try {
      if (Number.isInteger(tabId)) await tabs.update(tabId, { url });
      else await tabs.create({ url });
    } catch {
      state.history = previous;
      await write(state);
      throw new Error('The browser could not open the puzzle. Please try again.');
    }
    return { ok: true, puzzle };
  }
  async function handle(message, sender) {
    const state = await read();
    const trustedPage = sender.url?.startsWith(chrome.runtime.getURL(''));
    if (message.type !== 'random' && !trustedPage) throw new Error('This action is only available in the extension.');
    switch (message.type) {
      case 'state': return { ok: true, history: sortedHistory(state.history) };
      case 'random': {
        // Content scripts may update only their own Daily Puzzle tab.
        const tabId = sender.tab && /^https:\/\/www\.chess\.com\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(?:daily(?:\/|$)|puzzles\/daily(?:\/|$))/.test(sender.url || '') ? sender.tab.id : undefined;
        if (!trustedPage && tabId === undefined) throw new Error('Open a Daily Puzzle page first.');
        let puzzle = state.api.puzzle;
        if (now() >= state.api.nextAt && !(message.allowRepeat && puzzle)) {
          state.api.nextAt = now() + 16000;
          await write(state); // Cooldown survives service worker restarts, even on failure.
          let response;
          try {
            response = await fetcher(API, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(12000) });
          } catch {
            throw new Error('Could not reach the puzzle API. Check your connection and try again shortly.');
          }
          state.api.nextAt = now() + cacheDelay(response.headers, now());
          state.api.puzzle = null;
          await write(state);
          if (!response.ok) throw new Error(response.status === 429 ? 'The API is busy. Please wait before trying again.' : `Puzzle API unavailable (HTTP ${response.status}). Try again later.`);
          try { puzzle = parsePuzzle(await response.json(), now()); }
          catch (error) { throw new Error(error instanceof SyntaxError ? 'The API returned unreadable data. Try again later.' : error.message); }
          state.api.puzzle = puzzle;
          await write(state);
        }
        if (!puzzle) return { ok: false, retryAt: state.api.nextAt, error: 'The API needs a moment. Please try again after the countdown.' };
        if (state.history.some(item => item.id === puzzle.id) && !message.allowRepeat) {
          return { ok: false, repeat: true, retryAt: state.api.nextAt, error: 'The API returned a puzzle you have visited. Open it again, or try another after the countdown.' };
        }
        return open(state, puzzle, tabId);
      }
      case 'open': {
        const puzzle = state.history.find(item => item.id === message.id);
        if (!puzzle) throw new Error('That puzzle is no longer in history.');
        return open(state, puzzle);
      }
      case 'complete': {
        const item = state.history.find(item => item.id === message.id);
        if (item) item.completed = message.completed === true;
        break;
      }
      case 'remove': state.history = state.history.filter(item => item.id !== message.id); break;
      case 'clear': state.history = []; break;
      default: throw new Error('Unknown extension action.');
    }
    await write(state);
    return { ok: true };
  }
  return function dispatch(message, sender = {}) {
    if (!message || typeof message.type !== 'string') return Promise.resolve({ ok: false, error: 'Invalid request.' });
    const random = message.type === 'random';
    if (random && randomBusy) return Promise.resolve({ ok: false, error: 'A puzzle request is already in progress.' });
    if (random) randomBusy = true;
    const result = queue.then(() => handle(message, sender)).catch(async error => {
      let retryAt = 0;
      if (random) {
        try { retryAt = (await read()).api.nextAt; } catch { /* Preserve the original storage error. */ }
      }
      return { ok: false, retryAt, error: error.message || 'Something went wrong. Please try again.' };
    });
    queue = result.then(() => {});
    return result.finally(() => { if (random) randomBusy = false; });
  };
}
