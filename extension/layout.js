(() => {
  const assign = (full) => {
    document.documentElement.dataset.layout = full ? 'full' : 'panel';
    return full;
  };
  if (new URLSearchParams(location.search).get('layout') === 'full') {
    globalThis.__harnessLayout = Promise.resolve(assign(true));
    return;
  }
  globalThis.__harnessLayout = Promise.resolve(chrome.tabs.getCurrent())
    .then(tab => assign(Boolean(tab)))
    .catch(() => assign(false));
})();
