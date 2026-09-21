/**
 * Owns live-workspace URL state and the shared navigation chrome. Page content
 * remains the caller's concern, which keeps routing testable without a DOM.
 */
export function createWorkspaceRouter({
  windowRef = window,
  documentRef = document,
  pages = ['home', 'goals', 'activity', 'connections', 'settings', 'chats', 'projects'],
  routedPages = pages.filter((page) => page !== 'home'),
  renderPage,
  onPageChange = () => {},
} = {}) {
  const allowed = new Set(pages);
  const routable = new Set(routedPages);
  let started = false;

  const normalized = (page) => (allowed.has(page) ? page : 'home');
  const routePage = () =>
    normalized(
      routable.has(windowRef.location.hash.slice(1)) ? windowRef.location.hash.slice(1) : 'home',
    );
  const route = (page) =>
    `${windowRef.location.pathname}${windowRef.location.search}${page === 'home' ? '' : `#${page}`}`;

  function updateNavigation(page, { talking = false } = {}) {
    const document = documentRef;
    const heading = document.querySelector('.home-header h1');
    const pageName = {
      home: 'Home',
      goals: 'Goals',
      activity: 'Activity',
      connections: 'Permissions',
      settings: 'Settings',
      chats: 'Chats',
      projects: 'Projects',
      talk: 'Talk',
    }[talking ? 'talk' : page === 'connections' ? 'settings' : page];
    if (heading) {
      heading.textContent = pageName;
      heading.tabIndex = -1;
    }
    document.title = `felis — ${pageName}`;
    document.querySelector('.app-window')?.setAttribute('aria-label', `felis ${pageName}`);
    const headline = document.querySelector('.home-header p');
    const showStatus = !talking && page === 'home' && Boolean(headline?.textContent);
    headline?.toggleAttribute('hidden', !showStatus);
    document.querySelector('.home-context')?.toggleAttribute('hidden', !showStatus);
    for (const item of document.querySelectorAll('.nav-item')) {
      const active =
        item.dataset.detail === (talking ? 'talk' : page === 'connections' ? 'settings' : page);
      item.classList.toggle('active', active);
      item.toggleAttribute('aria-current', active);
      if (active) item.setAttribute('aria-current', 'page');
    }
    for (const selector of ['.edit-toggle', '.add-toggle', '.save-state', '.overflow-toggle']) {
      const item = document.querySelector(selector);
      if (!item) continue;
      item.hidden = talking || page !== 'home' || selector === '.overflow-toggle';
    }
    return heading;
  }

  function showPage(page, { push = true, focus = true, ...options } = {}) {
    const nextPage = normalized(page);
    onPageChange(nextPage, options);
    const heading = updateNavigation(nextPage);
    renderPage?.(nextPage, options);
    if (push) {
      const nextRoute = route(nextPage);
      const currentRoute = `${windowRef.location.pathname}${windowRef.location.search}${windowRef.location.hash}`;
      if (currentRoute !== nextRoute) windowRef.history.pushState(null, '', nextRoute);
    }
    if (focus) {
      const pageHeading =
        nextPage === 'connections'
          ? documentRef.querySelector('.connections-manager h2')
          : ['chats', 'projects'].includes(nextPage)
            ? documentRef.querySelector('.chat-library h1')
            : heading;
      if (pageHeading) {
        pageHeading.tabIndex = -1;
        pageHeading.focus({ preventScroll: true });
      }
    }
    return nextPage;
  }

  function restorePage() {
    return showPage(routePage(), { push: false, focus: false });
  }
  const onHistoryChange = () => restorePage();

  function start() {
    if (started) return;
    started = true;
    restorePage();
    windowRef.addEventListener('popstate', onHistoryChange);
    windowRef.addEventListener('hashchange', onHistoryChange);
  }

  function dispose() {
    if (!started) return;
    started = false;
    windowRef.removeEventListener('popstate', onHistoryChange);
    windowRef.removeEventListener('hashchange', onHistoryChange);
  }

  return { showPage, restorePage, updateNavigation, start, dispose };
}
