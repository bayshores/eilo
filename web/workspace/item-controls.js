import { taskEditOperations, goalActionOperations, undoGoalOperations } from '../goals/editor.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, run, cls = 'button') => {
  const node = el('button', cls, text);
  node.type = 'button';
  node.addEventListener('click', run);
  return node;
};

export function createItemControls({
  container,
  detail,
  snapshot,
  canManage,
  onManage,
  onRecord,
  onRefresh,
  onSelect,
}) {
  let editor = null,
    closeMenu = () => {};
  const drafts = new Map();
  const notice = el('div', 'workspace-notice');
  notice.hidden = true;
  container.prepend(notice);
  function inform(message, undo = null) {
    notice.replaceChildren();
    notice.hidden = false;
    const copy = el('span', '', message);
    copy.setAttribute('role', 'status');
    notice.append(copy);
    if (undo)
      notice.append(
        managed(
          button(
            'Undo',
            async () => {
              try {
                await undo();
                inform('Change undone.');
                onRefresh();
              } catch (error) {
                inform(error.message);
              }
            },
            'text-button',
          ),
        ),
      );
    const dismiss = button(
      '×',
      () => {
        notice.hidden = true;
      },
      'notice-close',
    );
    dismiss.setAttribute('aria-label', 'Dismiss message');
    notice.append(dismiss);
  }
  function managed(node) {
    node.dataset.manage = 'true';
    node.disabled = !canManage();
    return node;
  }
  function sync() {
    for (const node of container.querySelectorAll('[data-manage]'))
      node.disabled = !canManage() || !!editor?.saving;
  }
  function sameConversation(id) {
    if (snapshot()?.conversation_id !== id)
      throw new Error('The conversation changed. Choose an item from the current workspace.');
  }
  function menu(label, items) {
    const wrap = el('div', 'item-options');
    const trigger = button(
      '•••',
      () => {
        const wasOpen = trigger.getAttribute('aria-expanded') === 'true';
        closeMenu();
        if (wasOpen) return;
        const panel = el('div', 'item-menu');
        panel.setAttribute('role', 'menu');
        panel.setAttribute('aria-label', label);
        panel.setAttribute('popover', 'manual');
        trigger.setAttribute('aria-expanded', 'true');
        wrap.append(panel);
        const finish = (focus = false) => {
          if (panel.matches(':popover-open')) panel.hidePopover();
          panel.remove();
          trigger.setAttribute('aria-expanded', 'false');
          document.removeEventListener('pointerdown', outside, true);
          document.removeEventListener('scroll', onScroll, true);
          window.removeEventListener('resize', onResize);
          closeMenu = () => {};
          if (focus && trigger.isConnected) trigger.focus({ preventScroll: true });
        };
        const outside = (event) => {
          if (!wrap.contains(event.target)) finish();
        };
        const onScroll = (event) => {
          if (!panel.contains(event.target)) finish();
        };
        const onResize = () => finish();
        for (const item of items) {
          const action = managed(
            button(
              item.label,
              () => {
                finish();
                item.run();
              },
              'item-menu-action' + (item.danger ? ' is-danger' : ''),
            ),
          );
          action.setAttribute('role', 'menuitem');
          panel.append(action);
        }
        panel.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(true);
            return;
          }
          if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const options = [...panel.querySelectorAll('button:not(:disabled)')],
              at = options.indexOf(document.activeElement);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : (at + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
            options[next]?.focus();
          }
          if (event.key === 'Tab') finish(true);
        });
        // The top layer keeps menus clear of the widget's scroll and clipping boundaries.
        panel.showPopover({ source: trigger });
        const anchor = trigger.getBoundingClientRect(),
          bounds = panel.getBoundingClientRect(),
          margin = 8;
        const left = Math.max(
          margin,
          Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - margin),
        );
        const below = anchor.bottom + 6,
          top =
            below + bounds.height <= window.innerHeight - margin
              ? below
              : Math.max(margin, anchor.top - bounds.height - 6);
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        closeMenu = finish;
        panel.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
      },
      'item-menu-trigger',
    );
    trigger.setAttribute('aria-label', label);
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    wrap.append(managed(trigger));
    return wrap;
  }
  async function runGoal(task, action) {
    closeMenu();
    const state = snapshot(),
      context = state.conversation_id,
      focus = state.tasks.focus_id;
    try {
      const next = await onManage(
        goalActionOperations(task, action, focus),
        state.tasks.revision,
        context,
      );
      const inverse = undoGoalOperations(task, action, focus),
        revision = next.tasks.revision;
      const message = {
        complete: 'Goal completed.',
        cancel: 'Goal cancelled.',
        reopen: 'Goal reopened.',
        delete: 'Goal moved to Trash.',
        restore: 'Goal restored.',
        focus: focus === task.id ? 'Current focus cleared.' : 'Current focus updated.',
      }[action];
      inform(
        message,
        inverse.length
          ? async () => {
              sameConversation(context);
              await onManage(inverse, revision, context);
            }
          : null,
      );
      onRefresh();
    } catch (error) {
      inform(error.message);
    }
  }
  function beginEdit(task = null) {
    closeMenu();
    const key = task?.id || 'new';
    editor = drafts.get(key) || {
      key,
      task: task ? { ...task } : null,
      revision: snapshot().tasks.revision,
      context: snapshot().conversation_id,
      values: {
        title: task?.title || '',
        due_text: task?.due_text || '',
        target_count: task?.target_count ?? '',
        completed_count: task?.completed_count ?? 0,
        unit: task?.unit || '',
      },
      error: '',
      saving: false,
    };
    drafts.set(key, editor);
    onRefresh();
    detail.querySelector('input')?.focus();
  }
  function renderEditor() {
    if (!editor) return false;
    if (detail.querySelector('.goal-edit-form')?.dataset.editKey === editor.key) {
      sync();
      return true;
    }
    closeMenu();
    detail.replaceChildren();
    const state = editor;
    const form = el('form', 'goal-edit-form');
    form.dataset.editKey = state.key;
    const body = el('div', 'goal-detail-body goal-editor-body');
    body.append(el('h2', 'goal-title', state.task ? 'Edit goal' : 'Add a goal'));
    const field = (name, label, { type = 'text', maxLength, placeholder, min } = {}) => {
      const wrap = el('label', 'goal-field'),
        copy = el('span', '', label),
        input = el('input');
      input.name = name;
      input.type = type;
      input.value = state.values[name];
      if (maxLength) input.maxLength = maxLength;
      if (placeholder) input.placeholder = placeholder;
      if (type === 'number') {
        input.min = min ?? 0;
        input.max = 10000;
        input.step = 1;
      }
      input.addEventListener('input', () => {
        state.values[name] = input.value;
      });
      wrap.append(copy, input);
      return wrap;
    };
    const title = field('title', 'Name', { maxLength: 500 });
    title.querySelector('input').required = true;
    body.append(title);
    body.append(
      field('due_text', 'Timing', { maxLength: 120, placeholder: 'Optional — in your own words' }),
    );
    const group = el('div', 'goal-quantity-fields');
    group.append(
      field('target_count', 'Target', { type: 'number', min: 1, placeholder: 'Optional' }),
      field('unit', 'Unit', { maxLength: 60, placeholder: 'e.g. problems' }),
    );
    body.append(group);
    if (state.task?.status === 'open')
      body.append(field('completed_count', 'Completed', { type: 'number', min: 0 }));
    const error = el('p', 'item-error', state.error);
    error.setAttribute('role', 'alert');
    error.hidden = !state.error;
    body.append(error);
    const reload = button(
      'Load current details',
      () => {
        const latest = snapshot().tasks.tasks.find((task) => task.id === state.task?.id);
        if (latest && latest.status !== 'deleted') {
          drafts.delete(state.key);
          editor = null;
          beginEdit(latest);
        } else {
          editor = null;
          onRefresh();
        }
      },
      'text-button',
    );
    reload.hidden = true;
    body.append(reload);
    const footer = el('div', 'goal-detail-actions');
    const save = managed(
      el('button', 'button goal-primary', state.task ? 'Save changes' : 'Add goal'),
    );
    save.type = 'submit';
    footer.append(
      save,
      button('Cancel', () => {
        drafts.delete(state.key);
        editor = null;
        onRefresh();
      }),
    );
    form.append(body, footer);
    detail.append(form);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.saving || !canManage()) return;
      try {
        sameConversation(state.context);
        const operations = taskEditOperations(state.task, state.values);
        if (!operations.length) {
          drafts.delete(state.key);
          editor = null;
          onRefresh();
          return;
        }
        const previousIds = new Set(snapshot().tasks.tasks.map((task) => task.id));
        state.saving = true;
        sync();
        error.hidden = true;
        const next = await onManage(operations, state.revision, state.context);
        drafts.delete(state.key);
        if (editor === state) {
          editor = null;
          onSelect(
            state.task?.id || next.tasks.tasks.find((task) => !previousIds.has(task.id))?.id,
          );
        }
        inform(state.task ? 'Goal updated.' : 'Goal added.');
        onRefresh();
      } catch (fault) {
        state.error = fault.message;
        error.textContent = fault.message;
        error.hidden = false;
        reload.hidden = fault.status !== 409;
      } finally {
        state.saving = false;
        sync();
      }
    });
    sync();
    return true;
  }
  function goalOptions(task) {
    if (task.status === 'deleted') return el('span');
    const items = [{ label: 'Edit details', run: () => beginEdit(task) }];
    if (task.status === 'open')
      items.push(
        {
          label:
            snapshot().tasks.focus_id === task.id ? 'Clear current focus' : 'Make current focus',
          run: () => runGoal(task, 'focus'),
        },
        { label: 'Cancel goal', run: () => runGoal(task, 'cancel') },
      );
    items.push({ label: 'Move to Trash', danger: true, run: () => runGoal(task, 'delete') });
    return menu('Goal options', items);
  }
  function goalPrimary(task) {
    const action =
      task.status === 'deleted' ? 'restore' : task.status === 'open' ? 'complete' : 'reopen';
    return managed(
      button(
        { restore: 'Restore goal', complete: 'Mark complete', reopen: 'Reopen goal' }[action],
        () => runGoal(task, action),
        'button goal-primary',
      ),
    );
  }
  async function runRecord(record, action) {
    closeMenu();
    const state = snapshot(),
      context = state.conversation_id;
    try {
      const next = await onRecord(
        action,
        record.id,
        state.accountability.observed_activity.revision,
        context,
      );
      inform(
        {
          trash: 'Activity moved to Trash.',
          restore: 'Activity restored.',
          unlink: 'Goal link removed.',
        }[action],
        action === 'trash'
          ? async () => {
              sameConversation(context);
              await onRecord(
                'restore',
                record.id,
                next.accountability.observed_activity.revision,
                context,
              );
            }
          : null,
      );
      onRefresh();
    } catch (error) {
      inform(error.message);
    }
  }
  function recordOptions(record, { trash = false } = {}) {
    if (trash) return managed(button('Restore', () => runRecord(record, 'restore'), 'text-button'));
    const items = [];
    if (record.related_task_ids?.length)
      items.push({ label: 'Remove goal link', run: () => runRecord(record, 'unlink') });
    items.push({ label: 'Move to Trash', danger: true, run: () => runRecord(record, 'trash') });
    return menu(`Activity options for ${new URL(record.origin).hostname}`, items);
  }
  return {
    beginEdit,
    renderEditor,
    goalOptions,
    goalPrimary,
    recordOptions,
    sync,
    managed,
    inform,
    select() {
      editor = null;
      closeMenu();
    },
    closeMenus: () => closeMenu(),
  };
}
