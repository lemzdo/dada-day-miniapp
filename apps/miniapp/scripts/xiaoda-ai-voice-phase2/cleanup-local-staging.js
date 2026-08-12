'use strict';

const fs = require('node:fs');
const path = require('node:path');

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function cleanupLocalStaging(artifactDir, requested = ['.phase2-helper-stage', '.phase2-benchmark-token']) {
  const root = fs.realpathSync(path.resolve(artifactDir));
  const allowed = new Set(['.phase2-helper-stage', '.phase2-benchmark-token']);
  const removed = [];
  for (const name of requested) {
    if (!allowed.has(name)) throw new Error(`CLEANUP_TARGET_NOT_ALLOWED:${name}`);
    const target = path.resolve(root, name);
    if (!inside(root, target) || path.basename(target) !== name) throw new Error(`CLEANUP_TARGET_UNSAFE:${name}`);
    if (fs.existsSync(target)) { fs.rmSync(target, { recursive: true, force: true }); removed.push(name); }
  }
  return { artifactDir: root, removed, tokenStatus: 'REMOVED_OR_ABSENT', recoverability: 'Deleted staging is not recoverable from this tool; original production source is unaffected.' };
}

if (require.main === module) process.stdout.write(`${JSON.stringify(cleanupLocalStaging(process.argv[2]), null, 2)}\n`);
module.exports = { cleanupLocalStaging };
