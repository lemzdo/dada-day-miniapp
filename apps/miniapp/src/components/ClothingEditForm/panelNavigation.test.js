const assert = require('node:assert/strict');
const test = require('node:test');

const {
  cancelPanelRoute,
  closePanelSession,
  confirmPanelRoute,
  createPanelSessionState,
  openPanelRoute,
  updateMainScroll,
} = require('./panelNavigation');

function formValue(overrides = {}) {
  return {
    category: 'top',
    subcategory: 'shirt',
    colors: ['black'],
    material: 'cotton',
    styleTags: ['casual'],
    seasonTags: ['spring'],
    sceneTags: ['commute'],
    thickness: 'medium',
    customName: 'work shirt',
    ...overrides,
  };
}

test('initial panel session starts on main route with clean scroll state', () => {
  const state = createPanelSessionState();

  assert.deepEqual(state.route, { name: 'main' });
  assert.equal(state.mainScrollTop, 0);
  assert.equal(state.restoreScrollTop, 0);
  assert.equal(state.restoreToken, 0);
  assert.equal(state.active, true);
});

test('opening colors route snapshots main scroll and temporary selected colors', () => {
  const state = createPanelSessionState();
  const next = openPanelRoute(state, { name: 'colors' }, 240.4, formValue({ colors: ['black', 'white'] }));

  assert.deepEqual(next.route, { name: 'colors' });
  assert.equal(next.mainScrollTop, 240);
  assert.deepEqual(next.tempValue, ['black', 'white']);
  assert.deepEqual(state.route, { name: 'main' });
});

test('confirming colors returns to main, restores scroll, and only updates colors', () => {
  const opened = openPanelRoute(createPanelSessionState(), { name: 'colors' }, 320, formValue());
  const original = formValue({ brand: 'unchanged' });
  const result = confirmPanelRoute(opened, original, ['red', 'blue']);

  assert.deepEqual(result.state.route, { name: 'main' });
  assert.equal(result.state.restoreScrollTop, 320);
  assert.equal(result.state.restoreToken, 1);
  assert.deepEqual(result.formValue.colors, ['red', 'blue']);
  assert.equal(result.formValue.brand, 'unchanged');
  assert.equal(result.formValue.material, 'cotton');
  assert.deepEqual(original.colors, ['black']);
});

test('canceling a child route restores main scroll without changing form data', () => {
  const opened = openPanelRoute(createPanelSessionState(), { name: 'colors' }, 188, formValue());
  const result = cancelPanelRoute(opened);

  assert.deepEqual(result.route, { name: 'main' });
  assert.equal(result.restoreScrollTop, 188);
  assert.equal(result.restoreToken, 1);
  assert.equal(result.tempValue, undefined);
});

test('material and style confirmations update only their target fields', () => {
  const original = formValue({ customName: 'dirty but unsaved' });
  const material = confirmPanelRoute(
    openPanelRoute(createPanelSessionState(), { name: 'material' }, 150, original),
    original,
    'linen',
  );
  const styles = confirmPanelRoute(
    openPanelRoute(material.state, { name: 'styleTags' }, 260, material.formValue),
    material.formValue,
    ['minimal', 'sport'],
  );

  assert.equal(material.formValue.material, 'linen');
  assert.deepEqual(material.formValue.colors, ['black']);
  assert.deepEqual(styles.formValue.styleTags, ['minimal', 'sport']);
  assert.equal(styles.formValue.customName, 'dirty but unsaved');
  assert.equal(styles.state.restoreScrollTop, 260);
});

test('scroll updates are clamped and form value changes do not reset scroll', () => {
  const scrolled = updateMainScroll(createPanelSessionState(), 512.9);
  const invalidNegative = updateMainScroll(scrolled, -20);
  const invalidNan = updateMainScroll(scrolled, Number.NaN);

  assert.equal(scrolled.mainScrollTop, 512);
  assert.equal(invalidNegative.mainScrollTop, 0);
  assert.equal(invalidNan.mainScrollTop, 512);
  assert.equal(confirmPanelRoute(openPanelRoute(scrolled, { name: 'seasonTags' }, scrolled.mainScrollTop, formValue()), formValue(), ['summer']).state.restoreScrollTop, 512);
});

test('closing the whole panel is the only action that clears the session', () => {
  const opened = openPanelRoute(createPanelSessionState(), { name: 'colors' }, 120, formValue());
  const canceled = cancelPanelRoute(opened);
  const closed = closePanelSession(canceled);

  assert.equal(canceled.active, true);
  assert.equal(closed.active, false);
  assert.deepEqual(closed.route, { name: 'main' });
  assert.equal(closed.mainScrollTop, 0);
});
