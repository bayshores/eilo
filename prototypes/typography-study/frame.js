const allowed = new Set(['a', 'b', 'c', 'current']);
document.documentElement.dataset.typography = 'a';
window.addEventListener('message', (event) => {
  if (
    event.origin !== location.origin ||
    event.source !== parent ||
    event.data?.type !== 'eilo:typography' ||
    !allowed.has(event.data.value)
  )
    return;
  document.documentElement.dataset.typography = event.data.value;
});
await Promise.all(
  ['Source Sans 3', 'IBM Plex Sans', 'Atkinson Hyperlegible Next'].map((name) =>
    document.fonts.load(`500 18px "${name}"`),
  ),
);
await document.fonts.ready;
document.documentElement.dataset.fontsReady = 'true';
parent.postMessage({ type: 'eilo:fonts-ready' }, location.origin);
