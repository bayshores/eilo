/** A deliberately small, data-only contract for assistant-composed task surfaces. */
export const ADAPTIVE_SCHEMA_VERSION = 1;
export const COMPONENT_KINDS = Object.freeze([
  'intention',
  'resume',
  'outline',
  'stages',
  'resources',
  'comparison',
  'note',
  'timeline',
  'usage',
  'connections',
]);

const LIMITS = Object.freeze({
  components: 12,
  title: 140,
  text: 2400,
  items: 16,
  itemLabel: 240,
  itemDetail: 480,
  itemValue: 120,
  id: 160,
});
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) => (typeof value === 'string' ? value.trim().slice(0, limit) : '');
const identifier = (value) => {
  const normalized = text(value, LIMITS.id);
  return /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(normalized) ? normalized : '';
};
const dangerous = new Set(['action', 'actions', 'html', 'style', 'url', 'href', 'script']);
const noDangerousFields = (value) => Object.keys(value).every((key) => !dangerous.has(key));

function normalizeItem(value, index) {
  if (typeof value === 'string') {
    const label = text(value, LIMITS.itemLabel);
    return label ? { id: `item-${index + 1}`, label } : null;
  }
  if (!isObject(value)) return null;
  if (!noDangerousFields(value)) return null;
  const label = text(value.label, LIMITS.itemLabel);
  if (!label) return null;
  return {
    id: identifier(value.id) || `item-${index + 1}`,
    label,
    ...(text(value.detail, LIMITS.itemDetail)
      ? { detail: text(value.detail, LIMITS.itemDetail) }
      : {}),
    ...(text(value.status, LIMITS.itemValue)
      ? { status: text(value.status, LIMITS.itemValue) }
      : {}),
    ...(text(value.value, LIMITS.itemValue) ? { value: text(value.value, LIMITS.itemValue) } : {}),
    ...(Number.isFinite(value.duration) && value.duration > 0 && value.duration <= 1440
      ? { duration: Math.floor(value.duration) }
      : {}),
  };
}

function normalizeBinding(value) {
  if (typeof value === 'string') return identifier(value) ? { id: identifier(value) } : undefined;
  if (!isObject(value) || !noDangerousFields(value)) return undefined;
  const id = identifier(value.id || value.resource_id);
  if (!id) return undefined;
  // Bindings are references only; rendering never executes or dereferences arbitrary URLs/actions.
  return { id, ...(identifier(value.field) ? { field: identifier(value.field) } : {}) };
}

export function normalizeComposition(value) {
  if (!isObject(value) || value.schema_version !== ADAPTIVE_SCHEMA_VERSION) return null;
  const id = identifier(value.id);
  const contextId = identifier(value.context_id);
  const title = text(value.title, LIMITS.title);
  if (!id || !contextId || !title || !Number.isInteger(value.revision) || value.revision < 0)
    return null;
  if (!Array.isArray(value.components) || value.components.length > LIMITS.components) return null;
  const usedIds = new Set();
  const components = [];
  for (const source of value.components) {
    if (!isObject(source)) return null;
    if (!noDangerousFields(source)) return null;
    const componentId = identifier(source.id);
    const kind = text(source.kind, 40);
    const componentTitle = text(source.title, LIMITS.title);
    if (
      !componentId ||
      usedIds.has(componentId) ||
      !COMPONENT_KINDS.includes(kind) ||
      !componentTitle
    )
      return null;
    usedIds.add(componentId);
    const emphasis = ['primary', 'normal', 'quiet'].includes(source.emphasis)
      ? source.emphasis
      : 'normal';
    const normalizedItems = Array.isArray(source.items)
      ? source.items.slice(0, LIMITS.items).map(normalizeItem)
      : undefined;
    if (normalizedItems?.some((item) => !item)) return null;
    const items = normalizedItems;
    const binding = normalizeBinding(source.binding);
    if (Object.hasOwn(source, 'binding') && !binding) return null;
    components.push({
      id: componentId,
      kind,
      title: componentTitle,
      emphasis,
      ...(text(source.text, LIMITS.text) ? { text: text(source.text, LIMITS.text) } : {}),
      ...(items?.length ? { items } : {}),
      ...(binding ? { binding } : {}),
    });
  }
  return {
    schema_version: ADAPTIVE_SCHEMA_VERSION,
    id,
    context_id: contextId,
    revision: value.revision,
    title,
    components,
  };
}

export function validateComposition(value) {
  const composition = normalizeComposition(value);
  return composition ? { ok: true, composition } : { ok: false, composition: null };
}

export { LIMITS as ADAPTIVE_LIMITS };
