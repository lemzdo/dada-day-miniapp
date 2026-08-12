'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { markDeploymentFiles } = require('./mark-deployment-files');

function prepareRestoration({ sourceDirectory, targetDirectory }) {
  const source = path.resolve(sourceDirectory);
  const target = path.resolve(targetDirectory);
  if (source === target || target.startsWith(`${source}${path.sep}`)) throw new Error('restore target must be independent');
  if (!fs.existsSync(path.join(source, 'index.js'))) throw new Error('restore source index.js is missing');
  if (fs.existsSync(target)) throw new Error('restore target already exists');
  fs.cpSync(source, target, {
    recursive: true,
    filter: (entry) => !entry.split(path.sep).includes('node_modules'),
  });
  const deployment = markDeploymentFiles(target);
  const result = { source, target, deployment, preparedAt: new Date().toISOString() };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  prepareRestoration({ sourceDirectory: process.argv[2], targetDirectory: process.argv[3] });
}

module.exports = { prepareRestoration };
