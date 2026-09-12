import { SAMPLE, SOURCE_WIDGET_SAMPLE } from '../preview/fixtures.js';
import { renderTrackingWidget, renderUsageWidget } from './context-widgets.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function weekMarkup() {
  return `<div class="week-grid" aria-label="Three recorded practice days in this sample week">${SAMPLE.week.map((done, index) => `<span class="week-day" aria-label="${DAYS[index]}: ${done ? 'practice recorded' : 'no practice recorded'}"><span class="day-mark ${done ? 'complete' : ''}" aria-hidden="true"></span><span aria-hidden="true">${DAYS[index][0]}</span></span>`).join('')}</div>`;
}

/** Update clock text in a rendered sample widget without owning any timers. */
export function updateSampleClock(root = document) {
  const now = new Date();
  root.querySelectorAll('.clock-time').forEach((node) => {
    node.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  });
  root.querySelectorAll('.clock-day').forEach((node) => {
    node.textContent = now.toLocaleDateString([], {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  });
}

/**
 * Render fixture-only widget content. Interactive callbacks are supplied by
 * the host so this module never decides how dialogs, drafts, or persistence work.
 */
export function renderSampleWidget(
  widget,
  container,
  { content, preview = false, onOpenGoals, onNotesChange } = {},
) {
  container.innerHTML = '';
  if (widget.type === 'tracking') {
    renderTrackingWidget(container, SOURCE_WIDGET_SAMPLE);
  } else if (widget.type === 'usage') {
    renderUsageWidget(container, SOURCE_WIDGET_SAMPLE);
  } else if (widget.type === 'today') {
    container.innerHTML = `<h2>Today</h2><p class="widget-subtitle">${SAMPLE.day}</p><div class="agenda-items"></div>`;
    const list = container.querySelector('.agenda-items');
    SAMPLE.agenda.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'agenda-row';
      const time = document.createElement('span');
      time.className = 'agenda-time';
      time.textContent = item.time.replace('Before 6 PM', 'Before\n6 PM');
      const title = document.createElement('span');
      title.className = 'agenda-label';
      title.textContent = item.title;
      row.append(time, title);
      list.append(row);
    });
  } else if (widget.type === 'goals') {
    container.innerHTML =
      '<div class="goal-heading"><h2>Internship search</h2><button class="text-button open-goal">Open goal <svg aria-hidden="true"><use href="#external"/></svg></button></div><p class="widget-subtitle">Preparing your application</p><div class="goal-steps"><div class="goal-step current"><span class="goal-dot" aria-hidden="true"></span><div><strong>Review résumé</strong><p>Up next</p></div></div><svg class="goal-connector" viewBox="0 0 50 25" aria-hidden="true"><path d="M2 18Q24 -1 47 17m-8-1 8 1-3-7"/></svg><div class="goal-step"><span class="goal-dot" aria-hidden="true"></span><div><strong>Application draft</strong><p>After résumé review</p></div></div></div>';
    container.querySelector('.open-goal').addEventListener('click', onOpenGoals);
  } else if (widget.type === 'progress') {
    container.innerHTML = `<h2>This week</h2><div class="practice-count"><strong>${SAMPLE.week.filter(Boolean).length}</strong><span>practice days</span></div>${weekMarkup()}`;
  } else if (widget.type === 'conversation') {
    container.innerHTML =
      '<h2 class="conversation-title">eïlo</h2><p class="sample-message"></p><div class="composer-preview"><input placeholder="Message eïlo" aria-label="Conversation appearance only; agent is not connected in this prototype" disabled><p class="chat-preview-note">Conversation preview</p></div>';
    container.querySelector('.sample-message').textContent = SAMPLE.message;
  } else if (widget.type === 'clock') {
    container.innerHTML = '<h2>Local time</h2><p class="clock-time"></p><p class="clock-day"></p>';
    updateSampleClock(container);
  } else if (widget.type === 'notes') {
    container.innerHTML =
      '<h2>Notes</h2><textarea class="note-input" placeholder="A thought for later…" aria-label="Personal note" maxlength="10000"></textarea>';
    const input = container.querySelector('textarea');
    input.value = content.notes;
    if (!preview) input.addEventListener('input', () => onNotesChange?.(input));
  }
  container.querySelectorAll('svg').forEach((svg) => svg.setAttribute('aria-hidden', 'true'));
}
