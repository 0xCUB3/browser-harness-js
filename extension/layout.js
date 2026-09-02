(() => {
  const assign = (full) => {
    document.documentElement.dataset.layout = full ? 'full' : 'panel';
    return full;
  };
  const params = new URLSearchParams(location.search);
  if (params.get('layout') === 'full' || params.get('view') === 'home' || params.get('nav') === 'home') {
    globalThis.__harnessLayout = Promise.resolve(assign(true));
    return;
  }
  globalThis.__harnessLayout = Promise.resolve(chrome.tabs.getCurrent())
    .then(tab => assign(Boolean(tab)))
    .catch(() => assign(false));
})();
