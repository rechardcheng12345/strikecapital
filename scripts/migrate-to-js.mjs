import fs from 'fs';
import path from 'path';
import ts from '../app/node_modules/typescript/lib/typescript.js';

const rootDir = process.cwd();

const movePairs = [
  ['app/apps/frontend', 'client'],
  ['app/apps/api', 'server'],
  ['app/docs', 'docs'],
  ['app/scripts', 'scripts'],
  ['app/data_backup', 'data_backup'],
  ['app/.env.sample', '.env.sample'],
  ['app/docker-compose.yml', 'docker-compose.yml'],
  ['app/.gitignore', '.gitignore'],
];

function exists(targetPath) {
  return fs.existsSync(path.join(rootDir, targetPath));
}

function ensureDir(targetPath) {
  fs.mkdirSync(path.dirname(path.join(rootDir, targetPath)), { recursive: true });
}

function moveIfPresent(from, to) {
  const fromPath = path.join(rootDir, from);
  const toPath = path.join(rootDir, to);

  if (!fs.existsSync(fromPath) || fs.existsSync(toPath)) {
    return;
  }

  ensureDir(to);
  fs.renameSync(fromPath, toPath);
}

function walk(dirPath, matcher, output = []) {
  if (!fs.existsSync(dirPath)) {
    return output;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath, matcher, output);
      continue;
    }

    if (matcher(fullPath)) {
      output.push(fullPath);
    }
  }

  return output;
}

function transpileFile(fullPath) {
  const source = fs.readFileSync(fullPath, 'utf8');
  const extension = path.extname(fullPath);
  const targetPath = fullPath.replace(/\.tsx?$/, extension === '.tsx' ? '.jsx' : '.js');
  const jsxMode = extension === '.tsx' ? ts.JsxEmit.Preserve : ts.JsxEmit.None;

  let outputText = '';

  try {
    ({ outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
        jsx: jsxMode,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
      fileName: path.basename(fullPath),
    }));
  } catch (error) {
    console.error(`Failed to transpile: ${path.relative(rootDir, fullPath)}`);
    throw error;
  }

  fs.writeFileSync(targetPath, outputText);
  fs.unlinkSync(fullPath);
}

function removeIfPresent(targetPath) {
  const fullPath = path.join(rootDir, targetPath);

  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

for (const [from, to] of movePairs) {
  moveIfPresent(from, to);
}

const transpileTargets = [];

for (const baseDir of ['client/src', 'server/src', 'server/migrations', 'server/seeds']) {
  transpileTargets.push(
    ...walk(
      path.join(rootDir, baseDir),
      (fullPath) => /\.tsx?$/.test(fullPath) && !/\.d\.ts$/.test(fullPath),
    ),
  );
}

for (const singleFile of ['client/vite.config.ts', 'server/knexfile.ts']) {
  if (exists(singleFile)) {
    transpileTargets.push(path.join(rootDir, singleFile));
  }
}

for (const fullPath of transpileTargets.sort()) {
  transpileFile(fullPath);
}

for (const tsOnlyPath of [
  'client/tsconfig.json',
  'client/tsconfig.node.json',
  'client/src/vite-env.d.ts',
  'server/tsconfig.json',
  'server/knexfile.d.ts',
  'server/knexfile.d.ts.map',
  'server/knexfile.js.map',
]) {
  removeIfPresent(tsOnlyPath);
}

const rootNodeModules = path.join(rootDir, 'node_modules');
const appNodeModules = path.join(rootDir, 'app/node_modules');

if (!fs.existsSync(rootNodeModules) && fs.existsSync(appNodeModules)) {
  fs.symlinkSync('app/node_modules', rootNodeModules, 'dir');
}
