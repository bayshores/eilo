/**
 * Owns live-workspace URL state and the shared navigation chrome. Page content
 * remains the caller's concern, which keeps routing testable without a DOM.
 */
export function createWorkspaceRouter({
  windowRef = window,
  documentRef = document,
  pages = ['home', 'goals', 'activity', 'connections', 'chats', 'projects'],
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

  function updateNavigation(page) {
    const document = documentRef;
    const heading = document.querySelector('.home-header h1');
    const pageName = {
      home: 'Home',
      goals: 'Goals',
      activity: 'Activity',
      connections: 'Connections',
      chats: 'Chats',
      projects: 'Projects',
    }[page];
    if (heading) {
      heading.textContent = pageName;
      heading.tabIndex = -1;
    }
    document.title = `eïlo — ${pageName}`;
    document.querySelector('.app-window')?.setAttribute('aria-label', `eïlo ${pageName}`);
    document.querySelector('.home-header p')?.toggleAttribute('hidden', page !== 'home');
    for (const item of document.querySelectorAll('.nav-item')) {
      const active = item.dataset.detail === (page === 'projects' ? 'chats' : page);
      item.classList.toggle('active', active);
      item.toggleAttribute('aria-current', active);
      if (active) item.setAttribute('aria-current', 'page');
    }
    for (const selector of ['.edit-toggle', '.add-toggle', '.save-state', '.overflow-toggle']) {
      const item = document.querySelector(selector);
      if (!item) continue;
      item.hidden = page !== 'home' || (page === 'home' && selector !== '.edit-toggle');
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
      const pageHeading = ['connections', 'chats', 'projects'].includes(nextPage)
        ? documentRef.querySelector(
            nextPage === 'connections' ? '.connections-manager h1' : '.chat-library h1',
          )
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

  return { showPage, restorePage, start, dispose };
}
