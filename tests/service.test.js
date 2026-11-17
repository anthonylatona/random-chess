import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../service.js';
import { parsePuzzle, canonicalURL, cacheDelay, KEY } from '../shared.js';

globalThis.chrome = { runtime: { getURL: path => 'chrome-extension://test/' + path } };
const sender = { url: 'chrome-extension://test/popup.html' };
const fixture = { title: 'Tactical Opportunity', url: 'https://www.chess.com/daily/2009-02-20', publish_time: 1235116800, fen: 'not used', pgn: 'not used' };
function setup(fetcher) {
  let clock = Date.now();
  const data = {};
  const opened = [];
  let calls = 0;
  const deps = {
    storage: { get: async () => structuredClone(data), set: async values => Object.assign(data, structuredClone(values)) },
    tabs: { create: async args => opened.push(args), update: async (id, args) => opened.push({ id, ...args }) },
    now: () => clock,
    fetcher: async (...args) => { calls++; return fetcher ? fetcher(...args) : new Response(JSON.stringify(fixture), { headers: { 'cache-control': 'max-age=15' } }); }
  };
  return { dispatch: createService(deps), deps, data, opened, advance: ms => { clock += ms; }, calls: () => calls };
}
test('parses live API-shaped response, strips tracking, ignores solution fields', () => {
  const puzzle = parsePuzzle({ ...fixture, url: fixture.url + '?x=1#foo' });
  assert.equal(puzzle.url, fixture.url); assert.equal(puzzle.date, '2009-02-20'); assert.equal(puzzle.pgn, undefined);
});
test('rejects unsafe URLs, invalid dates and malformed responses', () => {
  for (const url of ['javascript:alert(1)', 'https://www.chess.com.evil.test/daily/2009-02-20', 'http://www.chess.com/daily/2009-02-20', 'https://www.chess.com/play', 'https://user@www.chess.com/daily/2009-02-20', 'https://www.chess.com/daily/2024-02-30', 'https://www.chess.com:444/daily/2009-02-20']) assert.throws(() => canonicalURL(url));
  for (const data of [null, {}, { ...fixture, publish_time: '123' }]) assert.throws(() => parsePuzzle(data));
});
test('opens API URL, records local history, avoids cached repeats, explicitly reopens', async () => {
  const s = setup();
  assert.equal((await s.dispatch({ type: 'random' }, sender)).ok, true);
  assert.equal(s.opened[0].url, fixture.url);
  assert.equal(s.data[KEY].history[0].completed, false);
  const repeat = await s.dispatch({ type: 'random' }, sender);
  assert.equal(repeat.repeat, true); assert.equal(s.calls(), 1); assert.equal(s.opened.length, 1);
  assert.equal((await s.dispatch({ type: 'random', allowRepeat: true }, sender)).ok, true);
  assert.equal(s.calls(), 1); assert.equal(s.data[KEY].history.length, 1);
});
test('state and API cooldown survive service worker recreation', async () => {
  const s = setup(); await s.dispatch({ type: 'random' }, sender);
  const restarted = createService(s.deps);
  assert.equal((await restarted({ type: 'state' }, sender)).history.length, 1);
  assert.equal((await restarted({ type: 'random' }, sender)).repeat, true);
  assert.equal(s.calls(), 1);
});
test('manual completion, removal and clearing serialize correctly', async () => {
  const s = setup(); await s.dispatch({ type: 'random' }, sender);
  await s.dispatch({ type: 'complete', id: fixture.url, completed: true }, sender);
  assert.equal(s.data[KEY].history[0].completed, true);
  await s.dispatch({ type: 'open', id: fixture.url }, sender);
  assert.equal(s.data[KEY].history[0].completed, true);
  await s.dispatch({ type: 'remove', id: fixture.url }, sender);
  assert.equal(s.data[KEY].history.length, 0);
  await s.dispatch({ type: 'random' }, sender);
  await s.dispatch({ type: 'clear' }, sender);
  assert.equal(s.data[KEY].history.length, 0);
});
test('after cache expiry another unseen puzzle opens; a stale response does not', async () => {
  let data = fixture;
  const s = setup(() => new Response(JSON.stringify(data)));
  await s.dispatch({ type: 'random' }, sender); s.advance(17000);
  assert.equal((await s.dispatch({ type: 'random' }, sender)).repeat, true);
  assert.equal(s.calls(), 2);
  data = { ...fixture, url: 'https://www.chess.com/daily/2009-02-21' };
  s.advance(17000);
  assert.equal((await s.dispatch({ type: 'random' }, sender)).ok, true);
  assert.equal(s.data[KEY].history.length, 2);
});
test('network, HTTP, JSON and malformed URL failures never navigate', async () => {
  for (const fetcher of [() => { throw new Error('offline'); }, () => new Response('', { status: 503 }), () => new Response('bad json'), () => new Response(JSON.stringify({ ...fixture, url: 'https://evil.test' }))]) {
    const s = setup(fetcher);
    assert.equal((await s.dispatch({ type: 'random' }, sender)).ok, false);
    assert.equal(s.opened.length, 0);
    await s.dispatch({ type: 'random' }, sender); assert.equal(s.calls(), 1);
  }
});
test('honors Cache-Control, Age, numeric and HTTP-date Retry-After', () => {
  const now = Date.now();
  assert.equal(cacheDelay(new Headers(), now), 16000);
  assert.equal(cacheDelay(new Headers({ 'cache-control': 'public, max-age=120', age: '30' }), now), 90000);
  assert.equal(cacheDelay(new Headers({ 'retry-after': '120' }), now), 120000);
  assert.ok(cacheDelay(new Headers({ 'retry-after': new Date(now + 180000).toUTCString() }), now) > 178000);
});
test('429 is backed off and simultaneous random requests are blocked', async () => {
  let release;
  const s = setup(() => new Promise(resolve => { release = () => resolve(new Response('', { status: 429, headers: { 'retry-after': '120' } })); }));
  const first = s.dispatch({ type: 'random' }, sender);
  assert.match((await s.dispatch({ type: 'random' }, sender)).error, /already/);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release(); assert.match((await first).error, /busy/);
  const result = await s.dispatch({ type: 'random' }, sender);
  assert.ok(result.retryAt > Date.now() + 110000); assert.equal(s.calls(), 1);
});
test('content request reuses its own tab and cannot edit history', async () => {
  const s = setup(); const page = { url: 'https://www.chess.com/daily/2009-02-20', tab: { id: 42 } };
  assert.equal((await s.dispatch({ type: 'random' }, page)).ok, true);
  assert.equal(s.opened[0].id, 42);
  assert.equal((await s.dispatch({ type: 'clear' }, page)).ok, false);
  assert.equal((await s.dispatch({ type: 'random' }, { url: 'https://www.chess.com/play', tab: { id: 42 } })).ok, false);
});
test('navigation failure rolls back visit; storage failure prevents navigation', async () => {
  const s = setup(); s.deps.tabs.create = async () => { throw new Error('closed'); };
  assert.equal((await s.dispatch({ type: 'random' }, sender)).ok, false);
  assert.equal(s.data[KEY].history.length, 0);
  const t = setup(); t.deps.storage.set = async () => { throw new Error('quota'); };
  assert.equal((await t.dispatch({ type: 'random' }, sender)).ok, false);
  assert.equal(t.opened.length, 0);
});
