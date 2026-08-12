'use strict';

const fs = require('node:fs');
const path = require('node:path');

function sanitize(file) {
  const resolved = path.resolve(file);
  const value = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  delete value.tokenHash;
  value.tokenFile = 'REMOVED_AFTER_BENCHMARK';
  value.localStagingRemoved = true;
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return value;
}

if (require.main === module) sanitize(process.argv[2]);

module.exports = { sanitize };
