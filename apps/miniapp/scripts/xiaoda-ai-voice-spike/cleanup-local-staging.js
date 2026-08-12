'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function assertInside(parent, target) {
  const relative = path.relative(parent, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`unsafe cleanup target: ${target}`);
  }
}

function cleanup(paths) {
  const removed = [];
  for (const requested of paths) {
    const target = path.resolve(requested);
    assertInside(REPO_ROOT, target);
    const relative = path.relative(REPO_ROOT, target).split(path.sep).join('/');
    if (!relative.includes('/.generateOutfit-') && !relative.endsWith('/.benchmark-token') && !relative.includes('/.benchmark-helper-stage') && !relative.includes('/.restore-stage')) {
      throw new Error(`target is not a known xiaoda spike staging path: ${relative}`);
    }
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(relative);
    }
  }
  return removed;
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify({ removed: cleanup(process.argv.slice(2)) }, null, 2)}\n`);
}

module.exports = { cleanup };
