const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildUploadConfirmState,
  getSaveButtonText,
  getProgressTitle,
  getProgressDesc,
} = require('./uploadConfirmStateCore');

function draft(overrides = {}) {
  return {
    id: overrides.id || 'draft-1',
    status: 'pending',
    selected: true,
    displayImageUrl: 'cloud://image',
    assetStatus: 'ready',
    ...overrides,
  };
}

function image(overrides = {}) {
  return {
    id: overrides.id || 'image-1',
    status: 'detected',
    detectedCount: 1,
    ...overrides,
  };
}

test('keeps unselected recognized draft out of empty state', () => {
  const state = buildUploadConfirmState({
    batch: { status: 'ready', totalImages: 1, processedImages: 1 },
    images: [image()],
    drafts: [draft({ selected: false })],
  });

  assert.equal(state.pageState, 'noneSelected');
  assert.equal(state.recognizedDrafts.length, 1);
  assert.equal(state.selectedDrafts.length, 0);
  assert.equal(state.savableDrafts.length, 0);
  assert.equal(getProgressTitle(state), '这次识别到 1 件衣服');
  assert.equal(getProgressDesc(state), '暂未选择要保存的衣服，可重新勾选后保存。');
  assert.equal(getSaveButtonText(state), '请选择要保存的衣服');
});

test('uses recognized count for title and savable count for save button', () => {
  const state = buildUploadConfirmState({
    batch: { status: 'ready', totalImages: 1, processedImages: 1 },
    images: [image({ detectedCount: 2 })],
    drafts: [
      draft({ id: 'draft-1', selected: true }),
      draft({ id: 'draft-2', selected: false }),
    ],
  });

  assert.equal(state.pageState, 'ready');
  assert.equal(state.recognizedCount, 2);
  assert.equal(state.savableDrafts.length, 1);
  assert.equal(getProgressTitle(state), '这次识别到 2 件衣服');
  assert.equal(getProgressDesc(state), '已选择 1 件，保存前还可以继续编辑。');
  assert.equal(getSaveButtonText(state), '保存 1 件');
});

test('does not count discarded, saved or processing drafts as recognized', () => {
  const state = buildUploadConfirmState({
    batch: { status: 'ready', totalImages: 1, processedImages: 1 },
    images: [image({ detectedCount: 4 })],
    drafts: [
      draft({ id: 'pending-unselected', selected: false }),
      draft({ id: 'discarded', status: 'discarded' }),
      draft({ id: 'confirmed', status: 'confirmed' }),
      draft({ id: 'processing', segmentStatus: 'processing' }),
    ],
  });

  assert.equal(state.pageState, 'noneSelected');
  assert.deepEqual(state.recognizedDrafts.map((item) => item.id), ['pending-unselected']);
  assert.deepEqual(state.discardedDrafts.map((item) => item.id), ['discarded']);
  assert.deepEqual(state.savedDrafts.map((item) => item.id), ['confirmed']);
  assert.deepEqual(state.processingDrafts.map((item) => item.id), ['processing']);
});

test('preserves terminal and processing states explicitly', () => {
  assert.equal(buildUploadConfirmState({
    batch: { status: 'saved', totalImages: 1, processedImages: 1 },
    images: [image()],
    drafts: [draft({ status: 'confirmed' })],
  }).pageState, 'saved');

  assert.equal(buildUploadConfirmState({
    batch: { status: 'discarded', totalImages: 1, processedImages: 1 },
    images: [image()],
    drafts: [draft({ status: 'discarded' })],
  }).pageState, 'discarded');

  assert.equal(buildUploadConfirmState({
    batch: { status: 'processing', totalImages: 2, processedImages: 1 },
    images: [image(), image({ id: 'image-2', status: 'processing', detectedCount: 0 })],
    drafts: [],
  }).pageState, 'processing');
});

test('returns failed when complete batch has only failed images', () => {
  const state = buildUploadConfirmState({
    batch: { status: 'failed', totalImages: 1, processedImages: 1 },
    images: [image({ status: 'failed', detectedCount: 0 })],
    drafts: [],
  });

  assert.equal(state.pageState, 'failed');
  assert.equal(state.recognizedCount, 0);
});
