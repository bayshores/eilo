export function createInlineDialog(dialog) {
  let observer;
  dialog.classList.add('inline-surface');
  const cancel = () => {
    if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
  };
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  });
  dialog.addEventListener('close', () => observer?.disconnect());
  return () => {
    const workspace = document.querySelector('.workspace');
    const talking = workspace?.classList?.contains('conversation-active') || false;
    const host =
      (talking && document.querySelector('.conversation-dock')) ||
      document.querySelector('.workspace-page:not([hidden])') ||
      document.querySelector('.board-scroll') ||
      document.body;
    if (dialog.parentElement !== host) host.append(dialog);
    if (!dialog.open) dialog.show();
    host.scrollTop = 0;
    dialog.scrollTop = 0;
    const heading = dialog.querySelector('h2');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    observer?.disconnect();
    if (workspace) {
      const page = workspace.dataset.page;
      observer = new MutationObserver(() => {
        if (!dialog.open) observer.disconnect();
        else if (
          workspace.dataset.page !== page ||
          Boolean(workspace.classList?.contains('conversation-active')) !== talking
        )
          cancel();
      });
      observer.observe(workspace, { attributes: true, attributeFilter: ['data-page', 'class'] });
    }
  };
}
