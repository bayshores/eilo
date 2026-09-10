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
    const bounds = appWindow.getBoundingClientRect();
    const narrow = innerWidth <= 700;
    const width = Math.min(570, innerWidth - 24);
    dialog.style.width = `${width}px`;
    dialog.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, bounds.right - width - 18))}px`;
    const top = narrow ? 18 : Math.max(18, Math.min(bounds.top + 130, innerHeight - 400));
    dialog.style.top = `${top}px`;
    dialog.style.maxHeight = `${Math.max(280, Math.min(bounds.bottom - top - 20, innerHeight - top - 18))}px`;
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
    confirm.textContent = full ? '24-widget limit reached' : 'Add widget';
  }

  function open() {
    if (dialog.open) return;
    returnFocus = onOpening() || document.activeElement;
    search.value = '';
    selectedType ||= 'progress';
    render();
    position();
    dialog.showModal();
    search.focus();
  }

  dialog.querySelector('.gallery-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (returnFocus?.isConnected && !returnFocus.closest('[hidden]')) returnFocus.focus();
  });
  search.addEventListener('input', render);
  confirm.addEventListener('click', () => {
    if (!selectedType || getWidgetCount() >= 24) return;
    const focusTarget = onAdd(selectedType, selectedSize);
    if (!focusTarget) return;
    returnFocus = focusTarget;
    dialog.close();
  });

  return { open, position, render };
}
