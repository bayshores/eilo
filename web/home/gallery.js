/**
 * Owns the add-widget dialog's selection, filtering, focus return, and viewport
 * positioning. The host retains all layout transactions and widget rendering.
 */
export function createWidgetGallery({
  dialog,
  appWindow,
  catalog,
  titles,
  defaultSizes,
  renderPreview,
  getWidgetCount,
  onOpening = () => {},
  onAdd,
}) {
  const boardHost = appWindow.querySelector('.board-scroll');
  boardHost.prepend(dialog);
  dialog.classList.add('gallery-inline');
  const search = dialog.querySelector('#widget-search');
  const list = dialog.querySelector('.widget-categories');
  const selection = dialog.querySelector('.gallery-selection');
  const noResults = dialog.querySelector('.no-results');
  const typeTitle = dialog.querySelector('.gallery-type-title');
  const preview = dialog.querySelector('.widget-preview');
  const confirm = dialog.querySelector('.confirm-add');
  let selectedType = 'progress';
  let selectedSize = 'small';
  let returnFocus = null;

  function position() {
    dialog.style.width = Math.min(740, boardHost.clientWidth) + 'px';
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const types = Object.keys(catalog).filter((type) => titles[type].toLowerCase().includes(query));
    if (!types.includes(selectedType)) selectedType = types[0] || null;
    list.replaceChildren();
    for (const type of types) {
      const button = document.createElement('button');
      button.textContent = titles[type];
      button.dataset.widgetType = type;
      button.setAttribute('aria-pressed', String(type === selectedType));
      button.addEventListener('click', () => {
        selectedType = type;
        render();
        list.querySelector(`[data-widget-type="${type}"]`)?.focus();
      });
      list.append(button);
    }
    selection.hidden = !selectedType;
    noResults.hidden = types.length > 0;
    if (!selectedType) return;
    selectedSize = defaultSizes[selectedType];
    typeTitle.textContent = titles[selectedType];
    preview.dataset.type = selectedType;
    preview.innerHTML = '<div class="widget-content"></div>';
    renderPreview({ type: selectedType, size: selectedSize }, preview.firstElementChild);
    const full = getWidgetCount() >= 24;
    confirm.disabled = full;
    confirm.textContent = full ? '24-widget limit reached' : 'Preview placement';
  }

  function open() {
    if (dialog.open) return;
    returnFocus = onOpening() || document.activeElement;
    search.value = '';
    selectedType ||= 'progress';
    render();
    position();
    dialog.show();
    boardHost.scrollTop = 0;
    search.focus();
  }

  dialog.querySelector('.gallery-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (returnFocus?.isConnected && !returnFocus.closest('[hidden]')) returnFocus.focus();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dialog.close();
  });
  search.addEventListener('input', render);
  confirm.addEventListener('click', () => {
    if (!selectedType || getWidgetCount() >= 24) return;
    dialog.close();
    const focusTarget = onAdd(selectedType, selectedSize);
    if (!focusTarget) {
      dialog.show();
      returnFocus = search;
      search.focus();
      return;
    }
    returnFocus = focusTarget;
  });

  return { open, position, render };
}
