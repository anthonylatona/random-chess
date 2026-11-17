import { canonicalURL, dateLabel, KEY } from './shared.js';
const $ = selector => document.querySelector(selector);
let busy = false, retryAt = 0;
function status(text) { $('#status').hidden = !text; $('#status').textContent = text; }
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || 'The extension could not respond. Please reopen it.');
  return result;
}
function tick() {
  const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
  $('#random').disabled = busy || seconds > 0;
  $('#random').textContent = busy ? 'Finding a puzzle…' : seconds ? `Try another in ${seconds}s` : 'Random Daily Puzzle →';
}
async function random(allowRepeat = false) {
  if (busy) return;
  busy = true; tick(); $('#repeat').disabled = true; status('Finding a puzzle…');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'random', allowRepeat });
    retryAt = result?.retryAt || 0;
    $('#repeat').hidden = !result?.repeat;
    status(result?.ok ? 'Puzzle opened on Chess.com.' : result?.error || 'The extension could not respond.');
    await render();
  } catch (error) { status(error.message); }
  finally { busy = false; $('#repeat').disabled = false; tick(); }
}
function puzzleDetails(item) {
  const container = document.createElement('div');
  const link = document.createElement('a');
  link.className = 'puzzle-title'; link.textContent = item.title;
  link.href = canonicalURL(item.url);
  link.addEventListener('click', event => { event.preventDefault(); act({ type: 'open', id: item.id }); });
  const date = document.createElement('div'); date.className = 'date'; date.textContent = dateLabel(item.date);
  const label = document.createElement('label'); label.className = 'completion';
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = item.completed;
  checkbox.addEventListener('change', () => act({ type: 'complete', id: item.id, completed: checkbox.checked }));
  label.append(checkbox, document.createTextNode('Marked completed'));
  container.append(link, date, label);
  return container;
}
async function render() {
  const { history } = await send({ type: 'state' });
  $('#clear').disabled = !history.length;
  if ($('#recent')) {
    $('#recent').replaceChildren();
    if (history.length) $('#recent').append(puzzleDetails(history[0]));
    else { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Your first discovery is one click away.'; $('#recent').append(p); }
    $('#visits').textContent = history.length;
    $('#completed').textContent = history.filter(item => item.completed).length;
  } else {
    $('#count').textContent = `${history.length} unique visits · ${history.filter(item => item.completed).length} marked completed`;
    const fragment = document.createDocumentFragment();
    if (!history.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No puzzles yet. Open a random puzzle to begin.'; fragment.append(p); }
    for (const item of history) {
      const row = document.createElement('article'); row.className = 'entry';
      const remove = document.createElement('button'); remove.className = 'text'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove ${item.title} from history`);
      remove.addEventListener('click', () => act({ type: 'remove', id: item.id }));
      row.append(puzzleDetails(item), remove); fragment.append(row);
    }
    $('#entries').replaceChildren(fragment);
  }
}
async function act(message) {
  try { await send(message); await render(); }
  catch (error) { status(error.message); await render().catch(() => {}); }
}
$('#random').addEventListener('click', () => random());
$('#repeat').addEventListener('click', () => random(true));
$('#clear').addEventListener('click', () => $('#confirm').showModal());
$('#cancel').addEventListener('click', () => $('#confirm').close());
$('#confirm-clear').addEventListener('click', () => { $('#confirm').close(); act({ type: 'clear' }); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[KEY]) render().catch(error => status(error.message)); });
setInterval(tick, 1000);
render().catch(error => status(error.message));
