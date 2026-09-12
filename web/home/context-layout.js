/** References adaptive components without persisting their display content in Home layout. */
import { normalizeState, updateLayout, validContextComponentId } from './layout.js';

export const contextWidgetId = (componentId) => `context-${componentId}`;

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
// These are the two adaptive components that render the same source widgets.
// Timeline stays contextual: its content describes the current work and is not
// the commitments-based Today widget.
const MANUAL_WIDGET_FOR_COMPONENT_KIND = Object.freeze({
  usage: 'usage',
  connections: 'tracking',
});

export function syncContextWidgets(
  state,
  { components = [], enabled = true, dismissed = [] } = {},
) {
  const normalized = normalizeState(state);
  let next = same(state, normalized) ? state : normalized;
  const current = new Set();
  const desired = new Map();
  const manualTypes = new Set(normalized.widgets.map((widget) => widget.type));
  for (const component of Array.isArray(components) ? components : []) {
    if (!validContextComponentId(component?.id) || desired.has(component.id)) continue;
    if (manualTypes.has(MANUAL_WIDGET_FOR_COMPONENT_KIND[component.kind])) continue;
    desired.set(component.id, component.emphasis === 'primary');
  }
  for (const widget of normalized.widgets)
    if (widget.type === 'context') {
      current.add(widget.componentId);
      if (!desired.has(widget.componentId))
        next = updateLayout(next, { type: 'remove', id: widget.id });
    }
  if (!enabled) return next;
  const hidden = new Set(
    (Array.isArray(dismissed) ? dismissed : []).filter(validContextComponentId),
  );
  for (const [componentId, primary] of desired) {
    if (current.has(componentId) || hidden.has(componentId) || next.widgets.length >= 24) continue;
    next = updateLayout(next, {
      type: 'add',
      id: contextWidgetId(componentId),
      widgetType: 'context',
      size: primary ? 'medium' : 'small',
      componentId,
    });
  }
  return next;
}
