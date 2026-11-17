(() => {
  if (globalThis.__dailyShuffleLoaded) return;
  globalThis.__dailyShuffleLoaded = true;
  const host = document.createElement('div');
  host.id = 'daily-shuffle-extension';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host { display:block; margin:12px 0; font:14px/1.45 system-ui,sans-serif; color-scheme:light dark; }
    .wrap { padding:12px; border:1px solid light-dark(#d6d6db,#56565e); border-radius:8px; background:light-dark(#fafafa,#26262c); color:light-dark(#25252e,#eeeef2); }
    button { font:600 14px system-ui,sans-serif; padding:11px 15px; border-radius:6px; border:0; background:#5550b9; color:white; cursor:pointer; }
    button:disabled { opacity:.65; cursor:wait; } button:focus-visible { outline:3px solid #b7aaff; outline-offset:3px; }
    small { display:block; margin-top:7px; opacity:.75; font-size:11px; } p { margin:8px 0 0; max-width:350px; }
    .repeat { background:transparent; color:inherit; border:1px solid currentColor; margin-top:8px; }
    [hidden] { display:none; }
    :host([data-floating]) { position:fixed; bottom:18px; right:18px; z-index:1000; max-width:min(350px,calc(100vw - 36px)); margin:0; }
  </style><div class="wrap"><button type="button" id="random">Random Daily Puzzle</button><p role="status" aria-live="polite" hidden></p><button type="button" class="repeat" hidden>Open this puzzle again</button><small>Daily Shuffle · Independent of Chess.com</small></div>`;
  const button = shadow.querySelector('#random');
  const status = shadow.querySelector('p');
  const repeat = shadow.querySelector('.repeat');
  let busy = false, retryAt = 0;
  async function random(allowRepeat = false) {
    if (busy) return;
    busy = true; button.disabled = true; repeat.disabled = true;
    status.hidden = false; status.textContent = 'Finding a puzzle…';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'random', allowRepeat });
      if (!result) throw new Error('Reload the page to reconnect to Daily Shuffle.');
      retryAt = result.retryAt || 0;
      repeat.hidden = !result.repeat;
      status.textContent = result.ok ? 'Opening puzzle…' : result.error;
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; repeat.disabled = false; tick(); }
  }
  button.addEventListener('click', () => random());
  repeat.addEventListener('click', () => random(true));
  function isDaily() {
    return /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(?:daily(?:\/\d{4}-\d{2}-\d{2})?|puzzles\/daily)\/?$/.test(location.pathname);
  }
  function mount() {
    if (!isDaily()) { host.remove(); return; }
    if (host.isConnected) return;
    // Layout hooks only: never read board, solution, account, or puzzle data.
    const anchor = document.querySelector('[class*="daily-puzzle"] [class*="calendar"], [class*="daily-puzzle"] [class*="navigation"], [class*="daily-puzzle"] [class*="header"], [class*="daily-puzzle"] [class*="sidebar"]');
    host.toggleAttribute('data-floating', !anchor);
    if (anchor?.parentElement) anchor.after(host);
    else document.body.append(host);
  }
  function tick() {
    const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
    button.disabled = busy || seconds > 0;
    button.textContent = busy ? 'Finding a puzzle…' : seconds ? `Try another in ${seconds}s` : 'Random Daily Puzzle';
  }
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; mount(); }, 80);
  }).observe(document.documentElement, { childList: true, subtree: true });
  // Covers history.pushState/replaceState even when they cause no DOM mutation.
  setInterval(() => { mount(); tick(); }, 1000);
  window.addEventListener('popstate', mount);
  mount();
})();
