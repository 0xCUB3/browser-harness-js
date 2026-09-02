(() => {
  const params = new URLSearchParams(location.search);
  const path = location.pathname || '';
  const isNtpHome = params.get('view') === 'home' || params.get('nav') === 'home'
    || /(?:^|\/)(?:ntp-redirect|newtab)\.html$/.test(path);
  if (!isNtpHome) return;

  const KEY = 'bh-early-query';
  let text = '';
  try { text = sessionStorage.getItem(KEY) || ''; } catch { /* ignore */ }

  const state = {
    text,
    dispose() {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('paste', onPaste, true);
      window.clearInterval(grabTimer);
      try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    },
  };

  function persist() {
    try { sessionStorage.setItem(KEY, state.text); } catch { /* ignore */ }
  }

  function queryInput() {
    return document.getElementById('query') || document.getElementById('early-query');
  }

  function applyToQuery() {
    const input = queryInput();
    if (!input || input.value === state.text) return input;
    input.value = state.text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input;
  }

  function grabFocus() {
    const input = queryInput();
    if (!input || (typeof document.hasFocus === 'function' && !document.hasFocus())) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement && active !== input) return;
    if (active !== input) input.focus({ preventScroll: true });
  }

  function onKeyDown(event) {
    if (event.isComposing || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const input = queryInput();
    if (input && document.activeElement === input) {
      if (event.key.length === 1 || event.key === 'Backspace') {
        queueMicrotask(() => {
          state.text = input.value;
          persist();
        });
      }
      return;
    }
    if (event.key === 'Backspace') {
      state.text = state.text.slice(0, -1);
      persist();
      applyToQuery();
      event.preventDefault();
      return;
    }
    if (event.key.length !== 1) return;
    state.text += event.key;
    persist();
    applyToQuery();
    event.preventDefault();
  }

  function onPaste(event) {
    const input = queryInput();
    if (input && document.activeElement === input) return;
    const pasted = event.clipboardData?.getData('text') || '';
    if (!pasted) return;
    state.text += pasted;
    persist();
    applyToQuery();
    event.preventDefault();
  }

  function revealHome() {
    const home = document.getElementById('view-home');
    if (home) home.hidden = false;
    applyToQuery();
    grabFocus();
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('paste', onPaste, true);
  globalThis.__earlyInput = state;
  const grabTimer = window.setInterval(grabFocus, 16);
  window.setTimeout(() => window.clearInterval(grabTimer), 800);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', revealHome, { once: true });
  else revealHome();
})();
