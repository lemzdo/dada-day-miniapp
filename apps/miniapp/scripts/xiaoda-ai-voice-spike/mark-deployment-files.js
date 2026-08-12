'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function markDeploymentFiles(rootDirectory, marker = `generateOutfit-deploy-${Date.now()}-${crypto.randomUUID().replaceAll('-', '')}`) {
  const root = path.resolve(rootDirectory);
  if (!fs.existsSync(path.join(root, 'index.js'))) throw new Error('staged generateOutfit index.js is missing');
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(absolute);
    }
  };
  walk(root);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, `// ${marker}\n${source}`, 'utf8');
  }
  return { root, marker, markedJavaScriptFiles: files.length };
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(markDeploymentFiles(process.argv[2]), null, 2)}\n`);
}

module.exports = { markDeploymentFiles };
