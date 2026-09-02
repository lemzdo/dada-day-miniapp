'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const catalog = require('./cloud-function-manifests.json');

function inside(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function relative(root, file) { return path.relative(root, file).split(path.sep).join('/'); }

function filesIn(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`SYMLINK_FORBIDDEN: ${file}`);
      if (entry.name === 'node_modules') continue;
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push(file);
    }
  };
  walk(root);
  return files.sort();
}

function literalValue(node) {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) {
    const items = node.elements.map(literalValue);
    return items.every((item) => typeof item === 'string') ? items : undefined;
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'join') {
    const items = literalValue(node.expression.expression);
    const separator = literalValue(node.arguments[0]);
    if (Array.isArray(items) && typeof separator === 'string') return items.join(separator);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalValue(node.left), right = literalValue(node.right);
    if (typeof left === 'string' && typeof right === 'string') return left + right;
  }
  return undefined;
}

function parseDependencies(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (source.parseDiagnostics.length) throw new Error(`INVALID_JAVASCRIPT: ${file}`);
  const dependencies = [], resolverCalls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      if (['require', 'require.resolve', 'module.require', 'import'].includes(callee)) {
        const argument = node.arguments[0];
        dependencies.push({
          expression: argument?.getText(source) || '',
          request: literalValue(argument),
          dynamic: !argument || !ts.isStringLiteralLike(argument),
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        });
      } else if (callee === 'loadDeployPackage') {
        const parts = literalValue(node.arguments[1]);
        resolverCalls.push({ package: literalValue(node.arguments[0]), fallback: Array.isArray(parts) ? parts.join('/') : undefined });
      }
    } else if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      dependencies.push({ request: literalValue(node.moduleSpecifier), dynamic: false,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { dependencies, resolverCalls };
}

function resolveLocal(request, importer) {
  const base = path.resolve(path.dirname(importer), request);
  const seen = new Set();
  const resolve = (target) => {
    if (seen.has(target)) return null;
    seen.add(target);
    for (const file of [target, `${target}.js`, `${target}.json`, `${target}.node`]) {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    }
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      const packageFile = path.join(target, 'package.json');
      if (fs.existsSync(packageFile)) {
        const main = JSON.parse(fs.readFileSync(packageFile, 'utf8')).main;
        if (main) { const found = resolve(path.resolve(target, main)); if (found) return found; }
      }
      for (const name of ['index.js', 'index.json']) {
        const file = path.join(target, name);
        if (fs.existsSync(file)) return file;
      }
    }
    return null;
  };
  return resolve(base);
}

function packageName(request) { return request.startsWith('@') ? request.split('/').slice(0, 2).join('/') : request.split('/')[0]; }

function declarationsFor(name) {
  const spec = catalog.functions[name];
  const direct = catalog.dynamicProfiles[spec.dynamicProfile] || [];
  return [...direct, ...(spec.nestedFunction ? declarationsFor(spec.nestedFunction).map((item) => ({ ...item, importer: `${spec.nestedFunction}/${item.importer}` })) : [])];
}

// Enumerates every unresolved edge instead of throwing at the first missing file.
// Source mode treats explicit vendor/nested mappings as generated destinations.
function auditDependencies(name, root, { source = false, allFiles = false } = {}) {
  const spec = catalog.functions[name];
  if (!spec) throw new Error(`MANIFEST_MISSING: ${name}`);
  const declarations = declarationsFor(name);
  const visited = new Set(), missingFiles = [], dynamicDependencies = [], externalDependencies = [], resolverCalls = [];
  const queue = allFiles ? filesIn(root).filter((file) => /\.(?:js|cjs|mjs)$/.test(file)) : [path.join(root, 'index.js')];
  const seenDeclarations = new Set();
  const addMissing = (record, reason) => missingFiles.push({ ...record, reason });
  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!fs.existsSync(file)) { addMissing({ importer: relative(root, file) }, 'MISSING_FILE'); continue; }
    if (!inside(fs.realpathSync(root), fs.realpathSync(file))) { addMissing({ importer: relative(root, file) }, 'OUTSIDE_ARTIFACT_ROOT'); continue; }
    if (!/\.(?:js|cjs|mjs)$/.test(file)) continue;
    const importer = relative(root, file);
    let parsed;
    try { parsed = parseDependencies(file); } catch (error) { addMissing({ importer }, error.message); continue; }
    for (const call of parsed.resolverCalls) {
      const prefix = spec.nestedFunction && importer.startsWith(`${spec.nestedFunction}/`) ? `${spec.nestedFunction}/` : '';
      const declared = catalog.packageResolverCalls.some((item) => `${prefix}${item.importer}` === importer && item.package === call.package && item.fallback === call.fallback);
      resolverCalls.push({ importer, ...call, declared });
      if (!declared) addMissing({ importer, ...call }, 'UNDECLARED_PACKAGE_RESOLVER_CALL');
    }
    for (const dependency of parsed.dependencies) {
      const record = { importer, line: dependency.line, expression: dependency.expression };
      let requests = [dependency.request];
      if (dependency.dynamic) {
        const declaration = declarations.find((item) => item.importer === importer && item.expression === dependency.expression);
        const declared = !!declaration && (dependency.request === undefined || declaration.targets.includes(dependency.request));
        dynamicDependencies.push({ ...record, targets: declaration?.targets || [], declared });
        if (!declared) { addMissing(record, 'UNDECLARED_DYNAMIC_DEPENDENCY'); continue; }
        seenDeclarations.add(declaration);
        requests = declaration.targets;
      }
      for (const request of requests) {
        if (typeof request !== 'string') { addMissing(record, 'UNRESOLVED_DEPENDENCY'); continue; }
        if (Module.isBuiltin(request)) continue;
        if (request.startsWith('.') || path.isAbsolute(request)) {
          const resolved = resolveLocal(request, file);
          const generatedVendor = source && (spec.vendors || []).some((vendor) => path.resolve(path.dirname(file), request) === path.join(root, 'vendor', vendor));
          const generatedNested = source && spec.nestedFunction && path.resolve(path.dirname(file), request) === path.join(root, spec.nestedFunction);
          if (generatedVendor || generatedNested) continue;
          if (!resolved) addMissing({ ...record, request, resolved: relative(root, path.resolve(path.dirname(file), request)) }, 'MISSING_LOCAL_DEPENDENCY');
          else if (!inside(root, resolved)) addMissing({ ...record, request }, 'OUTSIDE_ARTIFACT_ROOT');
          else queue.push(resolved);
        } else {
          let scope = path.dirname(file), metadata;
          while (inside(root, scope)) {
            const packageFile = path.join(scope, 'package.json');
            if (fs.existsSync(packageFile)) { metadata = JSON.parse(fs.readFileSync(packageFile, 'utf8')); break; }
            scope = path.dirname(scope);
          }
          const dependencyName = packageName(request);
          const version = metadata?.dependencies?.[dependencyName];
          externalDependencies.push({ importer, request, version: version || null });
          if (!version) addMissing({ ...record, request }, 'UNDECLARED_EXTERNAL_DEPENDENCY');
          else if (!source && version.startsWith('workspace:')) addMissing({ ...record, request }, 'WORKSPACE_DEPENDENCY_IN_ARTIFACT');
          else if (!source && version.startsWith('file:')) {
            const target = path.resolve(scope, version.slice(5));
            if (!inside(root, target) || !fs.existsSync(path.join(target, 'package.json'))) addMissing({ ...record, request }, 'MISSING_VENDOR_PACKAGE');
          }
        }
      }
    }
  }
  for (const declaration of declarations) {
    if (source && spec.nestedFunction && declaration.importer.startsWith(`${spec.nestedFunction}/`)) continue;
    if (!seenDeclarations.has(declaration)) addMissing({ importer: declaration.importer, expression: declaration.expression }, 'STALE_DYNAMIC_DECLARATION');
  }
  return { files: [...visited].filter((file) => fs.existsSync(file)).map((file) => relative(root, file)).sort(), missingFiles, dynamicDependencies, externalDependencies, resolverCalls };
}

module.exports = { auditDependencies, declarationsFor, filesIn, inside, parseDependencies, relative, resolveLocal };
