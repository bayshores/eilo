import { selectTracking, selectBrowserUsage, formatRecordedTime } from './tracking-data.js';
import { sourceMark } from './source-marks.js';

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const setText = (element, text) => {
  if (element.textContent !== text) element.textContent = text;
};
const action = (label, handler) => {
  const button = node('button', 'text-button context-widget__action', label);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
};
const mayAnimate = () =>
  !document.hidden &&
  !document.body.classList.contains('reduce-motion') &&
  !matchMedia('(prefers-reduced-motion: reduce)').matches;
const reveal = (element) => {
  if (!mayAnimate()) return;
  element.getAnimations?.().forEach((animation) => animation.cancel());
  element.animate?.([{ opacity: 0.45 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
};
const dayFormatters = new Map();
function labelForDay(date, options) {
  const key = JSON.stringify(options);
  if (!dayFormatters.has(key))
    dayFormatters.set(key, new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }));
  return dayFormatters.get(key).format(new Date(`${date}T12:00:00Z`));
}
const trackingViews = new WeakMap();
const usageViews = new WeakMap();
const COLORS = ['#fac399', '#b4b1da', '#a6c5b4', '#94b9c9'];

export function renderTrackingWidget(container, view, onManage = () => {}) {
  const data = selectTracking(view);
  const loading = view.connection === 'loading';
  const key = JSON.stringify([data, loading]);
  let state = trackingViews.get(container);
  if (!state || state.heading.parentNode !== container) {
    container.replaceChildren();
    container.classList.remove('usage-widget');
    container.classList.add('context-widget', 'tracking-widget');
    const heading = node('h2', '', 'Tracking');
    const sources = node('ul', 'tracking-sources');
    sources.setAttribute('aria-label', 'What eïlo can currently see');
    state = { heading, sources, key: '', onManage, rows: new Map() };
    container.append(
      heading,
      sources,
      action('Manage sources', () => state.onManage()),
    );
    trackingViews.set(container, state);
  }
  state.onManage = onManage;
  if (!mayAnimate())
    container.getAnimations?.({ subtree: true }).forEach((animation) => animation.cancel());
  if (state.key === key) return;
  const updating = !!state.key;
  state.key = key;
  const ids = new Set(data.rows.map((source) => source.id));
  for (const [id, record] of state.rows) {
    if (!ids.has(id)) {
      record.row.remove();
      state.rows.delete(id);
    }
  }
  for (const [index, source] of data.rows.entries()) {
    let record = state.rows.get(source.id);
    if (!record) {
      const row = node('li', 'tracking-source');
      const top = node('div', 'tracking-source__top');
      const name = node('span', 'tracking-source__name');
      top.append(sourceMark(source.id), name);
      const status = node('span', 'tracking-source__status');
      const detail = node('span', 'tracking-source__detail');
      row.append(top, status, detail);
      record = { row, name, status, detail };
      state.sources.append(row);
      state.rows.set(source.id, record);
    }
    if (state.sources.children[index] !== record.row)
      state.sources.insertBefore(record.row, state.sources.children[index] || null);
    const status = loading ? 'Connecting…' : source.status;
    if (updating && record.status.textContent !== status) reveal(record.status);
    record.row.dataset.tone = loading ? 'muted' : source.tone;
    setText(record.name, source.name);
    setText(record.status, status);
    setText(record.detail, loading ? '' : source.detail);
    record.detail.hidden = !record.detail.textContent;
    record.row.title = [source.name, status, source.detail].filter(Boolean).join(' · ');
  }
}

function updateMetric(state, animate = false) {
  const day = state.data.days.find((item) => item.date === state.selectedDate);
  setText(state.total, formatRecordedTime(day ? day.seconds : state.data.totalSeconds));
  setText(
    state.period,
    day
      ? `${labelForDay(day.date, { weekday: 'short', month: 'short', day: 'numeric' })} · UTC`
      : 'Recorded · 7 days',
  );
  state.total.setAttribute(
    'aria-label',
    `${Math.floor(day ? day.seconds : state.data.totalSeconds)} seconds of recorded browser time`,
  );
  state.reset.hidden = !day;
  for (const item of state.days) {
    const selected = item.button.dataset.date === state.selectedDate;
    item.button.setAttribute('aria-pressed', String(selected));
    item.button.dataset.selected = String(selected);
  }
  if (animate) reveal(state.total);
}

function updateAllocation(state) {
  const selected = state.segments.find((item) => item.id === state.selectedSite);
  if (!selected) {
    state.siteDetail.hidden = true;
    return;
  }
  state.selectedSite = selected.id;
  setText(state.siteName, selected.label);
  setText(state.siteTime, formatRecordedTime(selected.seconds));
  state.siteName.title = selected.label;
  state.siteDetail.style.setProperty('--usage-color', selected.color);
  for (const button of state.ribbon.children) {
    const active = button.dataset.origin === selected.id;
    button.setAttribute('aria-pressed', String(active));
    button.dataset.selected = String(active);
  }
}

function createUsage(container) {
  container.replaceChildren();
  container.classList.remove('tracking-widget');
  container.classList.add('context-widget', 'usage-widget');
  const heading = node('div', 'usage-heading');
  const state = {
    heading,
    key: '',
    selectedDate: null,
    selectedSite: null,
    data: null,
    days: [],
    segments: [],
  };
  const reset = node('button', 'usage-reset', '7 days');
  reset.type = 'button';
  reset.setAttribute('aria-label', 'Show all seven days');
  reset.addEventListener('click', () => {
    state.selectedDate = null;
    updateMetric(state, true);
  });
  heading.append(node('h2', '', 'Browser usage'), reset);
  const layout = node('div', 'usage-layout');
  const summary = node('div', 'usage-summary');
  const total = node('strong', 'usage-total');
  const period = node('span', 'usage-period');
  const allocation = node('div', 'usage-allocation');
  const ribbon = node('div', 'usage-ribbon');
  ribbon.setAttribute('role', 'group');
  ribbon.setAttribute('aria-label', 'Website share of seven-day recorded time');
  const siteDetail = node('div', 'usage-site-detail');
  siteDetail.hidden = true;
  siteDetail.setAttribute('role', 'tooltip');
  const siteName = node('span', 'usage-site-name');
  const siteTime = node('span', 'usage-site-time');
  siteDetail.append(siteName, siteTime);
  allocation.append(ribbon, siteDetail);
  summary.append(total, period, allocation);
  const chart = node('div', 'usage-week');
  chart.setAttribute('role', 'group');
  chart.setAttribute('aria-label', 'Recorded browser time by UTC day. Choose a day to inspect it.');
  for (let index = 0; index < 7; index++) {
    const button = node('button', 'usage-day');
    button.type = 'button';
    const slot = node('span', 'usage-day__slot');
    const bar = node('span', 'usage-day__bar');
    slot.setAttribute('aria-hidden', 'true');
    slot.append(bar);
    const label = node('span', 'usage-day__label');
    label.setAttribute('aria-hidden', 'true');
    button.append(slot, label);
    button.addEventListener('click', () => {
      state.selectedDate = state.selectedDate === button.dataset.date ? null : button.dataset.date;
      updateMetric(state, true);
    });
    button.addEventListener('keydown', (event) => {
      const next =
        event.key === 'ArrowRight'
          ? (index + 1) % 7
          : event.key === 'ArrowLeft'
            ? (index + 6) % 7
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? 6
                : null;
      if (next !== null) {
        event.preventDefault();
        state.days[next].button.focus();
      }
    });
    state.days.push({ button, bar, label, seconds: null });
    chart.append(button);
  }
  layout.append(summary, chart);
  const empty = node('div', 'usage-empty');
  const emptyCopy = node('div', 'usage-empty__copy');
  const emptyTitle = node('strong');
  const emptyDescription = node('p');
  emptyCopy.append(emptyTitle, emptyDescription);
  const emptyChart = node('div', 'usage-empty__chart');
  emptyChart.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 7; index++) emptyChart.append(node('span'));
  empty.append(emptyCopy, emptyChart);
  const footer = node('div', 'usage-footer');
  const primary = action('View activity', () => state.primary());
  const scope = node('span', 'usage-scope', 'Days in UTC');
  scope.title =
    'Only retained, recorded browser time. Gaps are excluded. This is not total device screen time.';
  footer.append(primary, scope);
  container.append(heading, layout, empty, footer);
  Object.assign(state, {
    reset,
    layout,
    total,
    period,
    ribbon,
    siteDetail,
    siteName,
    siteTime,
    empty,
    emptyTitle,
    emptyDescription,
    primaryButton: primary,
    scope,
  });
  allocation.addEventListener('pointerleave', () => {
    if (document.body.dataset.focusOrigin === 'pointer' || !ribbon.contains(document.activeElement))
      siteDetail.hidden = true;
  });
  ribbon.addEventListener('focusout', (event) => {
    if (!ribbon.contains(event.relatedTarget)) siteDetail.hidden = true;
  });
  ribbon.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') siteDetail.hidden = true;
  });
  usageViews.set(container, state);
  return state;
}

export function renderUsageWidget(container, view, onActivity = () => {}, onConnect = () => {}) {
  const data = selectBrowserUsage(view);
  const browser = selectTracking(view).rows.find((item) => item.id === 'browser');
  const browserOn = [
    'Sharing',
    'Collecting',
    'Waiting',
    'Waiting for a page',
    'On device',
  ].includes(browser?.status);
  const loading = view.connection === 'loading';
  let state = usageViews.get(container);
  if (!state || state.heading.parentNode !== container) state = createUsage(container);
  state.primary =
    data.online && data.available && !data.hasData && !browserOn ? onConnect : onActivity;
  const key = JSON.stringify([data, loading, browser?.status]);
  if (!mayAnimate())
    container.getAnimations?.({ subtree: true }).forEach((animation) => animation.cancel());
  if (state.key === key) return;
  const updating = !!state.key;
  state.key = key;
  state.data = data;
  state.layout.hidden = !data.available || !data.hasData;
  state.empty.hidden = !state.layout.hidden;
  state.scope.hidden = state.layout.hidden;
  if (state.layout.hidden) {
    state.reset.hidden = true;
    setText(
      state.emptyTitle,
      loading
        ? 'Loading usage…'
        : !data.online
          ? 'Workspace offline'
          : !data.available
            ? 'Usage unavailable'
            : 'Your week starts here',
    );
    setText(
      state.emptyDescription,
      loading
        ? ''
        : !data.online
          ? 'Reconnect to see recorded time.'
          : !data.available
            ? 'Reconnect to your workspace.'
            : browserOn
              ? 'Your next recorded session will appear here.'
              : 'Connect Chrome to see where your time goes.',
    );
    setText(
      state.primaryButton,
      data.online && data.available && !browserOn ? 'Connect Chrome' : 'View activity',
    );
    return;
  }
  setText(state.primaryButton, 'View activity');
  if (!data.days.some((day) => day.date === state.selectedDate)) state.selectedDate = null;
  const peak = Math.max(1, ...data.days.map((day) => day.seconds));
  data.days.forEach((day, index) => {
    const item = state.days[index];
    const oldTransform = item.bar.style.transform;
    item.button.dataset.date = day.date;
    const label = `${labelForDay(day.date, { weekday: 'long', month: 'short', day: 'numeric' })}, UTC: ${formatRecordedTime(day.seconds)} recorded`;
    item.button.title = label;
    item.button.setAttribute('aria-label', label);
    setText(item.label, labelForDay(day.date, { weekday: 'short' }).slice(0, 2));
    const transform = `scaleY(${day.seconds / peak})`;
    item.bar.style.transform = transform;
    if (updating && oldTransform !== transform && mayAnimate()) {
      item.bar.getAnimations?.().forEach((animation) => animation.cancel());
      item.bar.animate?.([{ transform: oldTransform }, { transform }], {
        duration: 180,
        easing: 'ease-out',
      });
    }
    item.seconds = day.seconds;
  });
  const leading = data.sites.filter((site) => site.seconds > 0).slice(0, 3);
  state.segments = leading.map((site, index) => ({
    id: site.origin,
    label: site.host,
    seconds: site.seconds,
    color: COLORS[index],
  }));
  const remainder = Math.max(
    0,
    data.totalSeconds - leading.reduce((sum, site) => sum + site.seconds, 0),
  );
  if (remainder > 0.001)
    state.segments.push({
      id: 'other',
      label: 'Other sites',
      seconds: remainder,
      color: COLORS[3],
    });
  const focusedSite =
    document.activeElement?.parentNode === state.ribbon
      ? document.activeElement.dataset.origin
      : null;
  state.ribbon.replaceChildren();
  for (const segment of state.segments) {
    const button = node('button', 'usage-ribbon__segment');
    button.type = 'button';
    button.dataset.origin = segment.id;
    button.style.flexGrow = String(segment.seconds / data.totalSeconds);
    button.style.setProperty('--usage-color', segment.color);
    const label = `${segment.label}: ${formatRecordedTime(segment.seconds)} across seven days`;
    button.setAttribute('aria-label', label);
    const showDetail = () => {
      state.selectedSite = segment.id;
      updateAllocation(state);
      state.siteDetail.hidden = false;
    };
    button.addEventListener('pointerenter', showDetail);
    button.addEventListener('focus', showDetail);
    button.addEventListener('click', showDetail);
    state.ribbon.append(button);
  }
  updateMetric(state);
  updateAllocation(state);
  if (focusedSite)
    [...state.ribbon.children]
      .find((item) => item.dataset.origin === focusedSite)
      ?.focus({ preventScroll: true });
}
