// Keep focus and caret behavior intact; draw the extra focus cue for keyboard use.
document.addEventListener(
  'pointerdown',
  () => {
    document.body.dataset.focusOrigin = 'pointer';
  },
  true,
);
document.addEventListener(
  'keydown',
  (event) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) delete document.body.dataset.focusOrigin;
  },
  true,
);
