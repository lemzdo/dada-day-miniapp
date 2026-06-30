const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const componentDir = __dirname;
const formTsx = fs.readFileSync(path.join(componentDir, 'index.tsx'), 'utf8');
const formScss = fs.readFileSync(path.join(componentDir, 'index.scss'), 'utf8');
const uploadConfirmTsx = fs.readFileSync(path.join(componentDir, '../../pages/upload-confirm/index.tsx'), 'utf8');
const uploadConfirmScss = fs.readFileSync(path.join(componentDir, '../../pages/upload-confirm/index.scss'), 'utf8');

test('ClothingEditForm exposes a panel layout mode while keeping page as default', () => {
  assert.match(formTsx, /layoutMode\?: 'page' \| 'panel'/);
  assert.match(formTsx, /layoutMode = 'page'/);
  assert.match(formTsx, /className="clothing-edit-form panel"/);
  assert.match(formTsx, /className="clothing-edit-form page"/);
});

test('panel mode does not use viewport min-height or window fixed footer', () => {
  assert.match(formScss, /\.clothing-edit-form\.panel/);
  assert.match(formScss, /min-height:\s*0/);
  assert.match(formScss, /\.clothing-edit-form\.panel[\s\S]*\.save-button-bar[\s\S]*position:\s*relative/);
});

test('upload-confirm freezes background without wrapping panel content in a second ScrollView', () => {
  assert.match(uploadConfirmTsx, /scrollY=\{!editingDraft\}/);
  assert.doesNotMatch(uploadConfirmTsx, /<ScrollView[\s\S]*className="draft-edit-scroll"[\s\S]*scrollY/);
  assert.match(uploadConfirmTsx, /layoutMode="panel"/);
  assert.doesNotMatch(uploadConfirmScss, /\.draft-edit-scroll/);
});

test('panel mode uses internal routes instead of third layer bottom popups', () => {
  assert.match(formTsx, /panelSession/);
  assert.match(formTsx, /panelSession\.route/);
  assert.match(formTsx, /renderPanelRouteContent/);
  assert.match(formTsx, /layoutMode === 'panel'[\s\S]*openPanelRoute/);
  assert.match(formTsx, /shouldRenderPagePopups[\s\S]*bottom-popup-overlay/);
  assert.doesNotMatch(formTsx, /layoutMode === 'panel'[\s\S]{0,240}bottom-popup-overlay/);
});

test('panel shell has one scroll owner and no window-fixed panel footer', () => {
  assert.match(formScss, /\.panel-route-content/);
  assert.match(formScss, /\.panel-route-scroll/);
  assert.match(formScss, /\.clothing-edit-form\.panel[\s\S]*overflow:\s*hidden/);
  assert.match(formScss, /\.clothing-edit-form\.panel[\s\S]*min-height:\s*0/);
  assert.doesNotMatch(formScss, /\.clothing-edit-form\.panel[\s\S]*min-height:\s*100vh/);
});
