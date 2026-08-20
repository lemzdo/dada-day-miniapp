const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

test('V2 runtime is the single mutually-exclusive render gate', () => {
  assert.match(source, /const v2RuntimeActive = todayV2Enabled \|\| v2MemoryOnly/);
  assert.match(source, /!v2RuntimeActive/);
  assert.match(source, /v2RuntimeActive && v2Snapshot/);
});

test('acceptance requires diagnostics, ttui-v2 prefix and exact capture', () => {
  assert.match(source, /request\?\.performanceDiagnostics === true/);
  assert.match(source, /runId\.startsWith\('ttui-v2-'\)/);
  assert.match(source, /request\?\.captureId === `\$\{runId\}-capture`/);
});

test('memory-only acceptance disables user mutations and storage writes', () => {
  assert.match(source, /v2MemoryOnly\) return/);
  assert.match(source, /!memoryOnly\) setUserStorageSync/);
});

test('strict acceptance bridge explicitly dispatches V2 refresh with Flag OFF', () => {
  assert.match(source, /const acceptanceRequest = \{ \.\.\.request, performanceDiagnostics: true \};/);
  assert.match(source, /if \(isStrictV2Acceptance\(acceptanceRequest\)\) \{\s*return handleV2Refresh\(acceptanceRequest\);/);
  assert.match(source, /return handleRefresh\(acceptanceRequest\);/);
});

test('diagnostics bridge exposes an immutable client bundle revision', () => {
  assert.match(source, /bundleRevision: 'today-v2-client-4b51368'/);
});
