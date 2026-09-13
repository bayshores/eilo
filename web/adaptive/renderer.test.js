import test from 'node:test';
import assert from 'node:assert/strict';
import { componentPatchPolicy, keyedMovePlan, renderContextWidget } from './renderer.js';

test('keyed patch policy preserves a card only when its component identity and composition kind agree', () => {
  assert.equal(componentPatchPolicy(null, { id: 'a', kind: 'note' }), 'create');
  assert.equal(componentPatchPolicy({ id: 'a', kind: 'note' }, { id: 'a', kind: 'note' }), 'patch');
  assert.equal(
    componentPatchPolicy({ id: 'a', kind: 'note' }, { id: 'a', kind: 'outline' }),
    'replace',
  );
  assert.equal(
    componentPatchPolicy({ id: 'a', kind: 'note' }, { id: 'b', kind: 'note' }),
    'replace',
  );
});

test('keyed moves leave an already ordered surface alone and defer the focused card', () => {
  assert.deepEqual(keyedMovePlan(['a', 'b', 'c'], ['a', 'b', 'c']), []);
  assert.deepEqual(keyedMovePlan(['a', 'b', 'c'], ['b', 'a', 'c']), [{ id: 'b', before: 'a' }]);
  assert.deepEqual(keyedMovePlan(['a', 'c'], ['a', 'b', 'c']), [{ id: 'b', before: 'c' }]);
  assert.deepEqual(keyedMovePlan(['a', 'b', 'c'], ['b', 'a', 'c'], 'b'), []);
});

class Element {
  constructor(tag, className = '', textContent = '') {
    this.tag = tag;
    this.className = className;
    this.textContent = textContent;
    this.children = [];
    this.dataset = {};
    this.classList = {
      add: (...names) => (this.className = [this.className, ...names].join(' ').trim()),
    };
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  querySelector(selector) {
    const matches = (element) =>
      selector.startsWith('.')
        ? element.className.split(/\s+/).includes(selector.slice(1))
        : element.tag === selector;
    for (const child of this.children) {
      if (matches(child)) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }
}

test('adaptive note components render source text as read-only state', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const content = new Element('div', 'widget-content');
    renderContextWidget(
      content,
      {
        id: 'visible-state',
        kind: 'note',
        title: 'Visible state',
        emphasis: 'normal',
        text: 'Editor open',
      },
      { drafts: new Map(), onAction() {} },
    );

    const body = content.querySelector('.adaptive-card__body');
    assert.equal(body.children[0].tag, 'p');
    assert.equal(body.children[0].textContent, 'Editor open');
    assert.equal(content.querySelector('textarea'), null);
  } finally {
    globalThis.document = previousDocument;
  }
});
