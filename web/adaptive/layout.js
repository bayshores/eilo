/** Geometry is owned by the application, never supplied by generated content. */
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const within = (box, columns, rows) =>
  box.x >= 0 &&
  box.y >= 0 &&
  box.w > 0 &&
  box.h > 0 &&
  box.x + box.w <= columns &&
  box.y + box.h <= rows;

export function composeLayout(
  components,
  { columns = 12, rows = 4, reserved = [], seeds = [], previous = [], pins = [] } = {},
) {
  const placed = [],
    occupied = reserved.map((box) => ({ ...box })),
    overflow = [];
  const pinSet = new Set(pins);
  const fits = (box) =>
    within(box, columns, rows) && !occupied.some((other) => overlaps(box, other));
  // Explicit anchors are placed before optional content. A smaller window may
  // require vertical overflow for an anchor, never silently replace it.
  for (const component of components.filter((item) => pinSet.has(item.id))) {
    const old = previous.find((item) => item.id === component.id);
    if (!old) continue;
    const box = {
      ...old,
      w: Math.min(columns, old.w),
      x: Math.min(old.x, Math.max(0, columns - old.w)),
    };
    if (occupied.some((other) => overlaps(box, other)))
      box.y = Math.max(rows, ...occupied.map((other) => other.y + other.h));
    placed.push(box);
    occupied.push(box);
  }
  for (const [index, component] of components.entries()) {
    if (placed.some((item) => item.id === component.id)) continue;
    const old = previous.find((item) => item.id === component.id);
    const seed = seeds[index];
    let box = [old, seed].find((value) => value && fits(value));
    if (!box) {
      const width = columns === 1 ? 1 : Math.min(columns, component.emphasis === 'primary' ? 8 : 4);
      const height = Math.min(rows, 2);
      for (let y = 0; y <= rows - height && !box; y++) {
        for (let x = 0; x <= columns - width; x++) {
          const candidate = { x, y, w: width, h: height };
          if (fits(candidate)) {
            box = candidate;
            break;
          }
        }
      }
    }
    if (!box && pinSet.has(component.id))
      box = {
        x: 0,
        y: Math.max(rows, ...occupied.map((other) => other.y + other.h)),
        w: columns,
        h: 2,
      };
    if (!box) {
      overflow.push(component.id);
      continue;
    }
    box = { id: component.id, x: box.x, y: box.y, w: box.w, h: box.h };
    placed.push(box);
    occupied.push(box);
  }
  return { placed, overflow, rows: Math.max(rows, ...placed.map((box) => box.y + box.h)) };
}
