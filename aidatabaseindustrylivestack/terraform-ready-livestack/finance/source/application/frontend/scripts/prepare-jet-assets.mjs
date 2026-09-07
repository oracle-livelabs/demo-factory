import { existsSync, readFileSync } from 'node:fs';
import { copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '..');
const jetDir = path.join(frontendDir, 'public', 'jet');
const libsDir = path.join(jetDir, 'libs');

function packageRoot(packageName) {
  try {
    return path.dirname(require.resolve(`${packageName}/package.json`));
  } catch {
    for (const searchPath of require.resolve.paths(packageName) || []) {
      const candidate = path.join(searchPath, packageName);
      const packageJsonPath = path.join(candidate, 'package.json');
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        if (packageJson.name === packageName) {
          return candidate;
        }
      }
    }
    let current = path.dirname(require.resolve(packageName));
    while (current !== path.dirname(current)) {
      const packageJsonPath = path.join(current, 'package.json');
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        if (packageJson.name === packageName) {
          return current;
        }
      }
      current = path.dirname(current);
    }
    throw new Error(`Unable to locate package root for ${packageName}`);
  }
}

function packageVersion(packageName) {
  return require(`${packageName}/package.json`).version;
}

async function copyDir(source, destination) {
  await cp(source, destination, { recursive: true, force: true, dereference: true });
}

async function copyFileTo(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

function bootstrapSource(oracleJetVersion) {
  return `(function () {
  const requireImpl = window.requirejs || window.require;
  if (!requireImpl) return;
  window.__jetReady = false;
  document.documentElement.dataset.jetReady = 'false';

  requireImpl.config({
    baseUrl: '/jet',
    paths: {
      knockout: 'libs/knockout/knockout-3.5.1.debug',
      jquery: 'libs/jquery/jquery-3.7.1',
      'jqueryui-amd': 'libs/jquery/jqueryui-amd-1.14.1',
      hammerjs: 'libs/hammer/hammer-2.0.8',
      ojdnd: 'libs/dnd-polyfill/dnd-polyfill-1.0.2',
      ojs: 'libs/oj/${oracleJetVersion}/debug',
      ojL10n: 'libs/oj/${oracleJetVersion}/ojL10n',
      ojtranslations: 'libs/oj/${oracleJetVersion}/resources',
      '@oracle/oraclejet-preact': 'libs/oraclejet-preact/amd',
      'oj-c': 'libs/packs/oj-c',
      persist: 'libs/persist/debug',
      text: 'libs/require/text',
      signals: 'libs/js-signals/signals',
      touchr: 'libs/touchr/touchr',
      preact: 'libs/preact/dist/preact.umd',
      'preact/hooks': 'libs/preact/hooks/dist/hooks.umd',
      'preact/compat': 'libs/preact/compat/dist/compat.umd',
      'preact/jsx-runtime': 'libs/preact/jsx-runtime/dist/jsxRuntime.umd',
      'preact/debug': 'libs/preact/debug/dist/debug.umd',
      'preact/devtools': 'libs/preact/devtools/dist/devtools.umd',
      css: 'libs/require-css/css',
      ojcss: 'libs/oj/${oracleJetVersion}/debug/ojcss',
      'ojs/ojcss': 'libs/oj/${oracleJetVersion}/debug/ojcss',
      chai: 'libs/chai/chai',
      'css-builder': 'libs/require-css/css-builder',
      normalize: 'libs/require-css/normalize',
      'ojs/normalize': 'libs/require-css/normalize',
    },
  });

  requireImpl([
    'ojs/ojbootstrap',
    'ojs/ojbutton',
    'ojs/ojinputtext',
    'ojs/ojselectsingle',
    'ojs/ojarraydataprovider',
    'ojs/ojswitch',
    'ojs/ojprogress-circle',
    'ojs/ojactioncard',
    'ojs/ojoption',
  ], function (Bootstrap) {
    const start = () => {
      window.__jetReady = true;
      document.documentElement.dataset.jetReady = 'true';
      window.dispatchEvent(new Event('resize'));
    };
    if (Bootstrap?.whenDocumentReady) {
      Bootstrap.whenDocumentReady().then(start);
    } else {
      start();
    }
  }, function (err) {
    document.documentElement.dataset.jetError = (err && (err.requireModules || [err.message]).join(',')) || 'unknown';
  });
}());
`;
}

const oracleJetRoot = packageRoot('@oracle/oraclejet');
const oracleJetVersion = packageVersion('@oracle/oraclejet');
const corePackRoot = packageRoot('@oracle/oraclejet-core-pack');
const oracleJetPreactRoot = packageRoot('@oracle/oraclejet-preact');
const preactRoot = packageRoot('preact');

await rm(jetDir, { recursive: true, force: true });
await mkdir(libsDir, { recursive: true });

await writeFile(path.join(jetDir, 'bootstrap.js'), bootstrapSource(oracleJetVersion), 'utf8');
await copyDir(path.join(oracleJetRoot, 'dist', 'css', 'redwood'), path.join(jetDir, 'redwood'));

await copyDir(path.join(oracleJetRoot, 'dist', 'js', 'libs', 'chai'), path.join(libsDir, 'chai'));
await copyDir(path.join(oracleJetRoot, 'dist', 'js', 'libs', 'dnd-polyfill'), path.join(libsDir, 'dnd-polyfill'));
await copyDir(path.join(oracleJetRoot, 'dist', 'js', 'libs', 'jquery'), path.join(libsDir, 'jquery'));
await copyDir(path.join(oracleJetRoot, 'dist', 'js', 'libs', 'oj'), path.join(libsDir, 'oj', oracleJetVersion));
await copyDir(path.join(oracleJetRoot, 'dist', 'js', 'libs', 'persist'), path.join(libsDir, 'persist'));
await copyDir(path.join(oracleJetRoot, 'dist', 'js', 'libs', 'require-css'), path.join(libsDir, 'require-css'));
await copyDir(path.join(oracleJetRoot, 'dist', 'js', 'libs', 'touchr'), path.join(libsDir, 'touchr'));
await copyDir(path.join(oracleJetPreactRoot, 'amd'), path.join(libsDir, 'oraclejet-preact', 'amd'));
await copyDir(path.join(corePackRoot, 'oj-c'), path.join(libsDir, 'packs', 'oj-c'));

await copyFileTo(path.join(packageRoot('jquery'), 'dist', 'jquery.js'), path.join(libsDir, 'jquery', 'jquery-3.7.1.js'));
await copyFileTo(path.join(packageRoot('hammerjs'), 'hammer.js'), path.join(libsDir, 'hammer', 'hammer-2.0.8.js'));
await copyFileTo(path.join(packageRoot('knockout'), 'build', 'output', 'knockout-latest.debug.js'), path.join(libsDir, 'knockout', 'knockout-3.5.1.debug.js'));
await copyFileTo(path.join(packageRoot('requirejs'), 'require.js'), path.join(libsDir, 'require', 'require.js'));
await copyFileTo(path.join(packageRoot('signals'), 'dist', 'signals.js'), path.join(libsDir, 'js-signals', 'signals.js'));

await copyFileTo(path.join(preactRoot, 'dist', 'preact.umd.js'), path.join(libsDir, 'preact', 'dist', 'preact.umd.js'));
await copyFileTo(path.join(preactRoot, 'dist', 'preact.umd.js.map'), path.join(libsDir, 'preact', 'dist', 'preact.umd.js.map'));
await copyFileTo(path.join(preactRoot, 'hooks', 'dist', 'hooks.umd.js'), path.join(libsDir, 'preact', 'hooks', 'dist', 'hooks.umd.js'));
await copyFileTo(path.join(preactRoot, 'hooks', 'dist', 'hooks.umd.js.map'), path.join(libsDir, 'preact', 'hooks', 'dist', 'hooks.umd.js.map'));
await copyFileTo(path.join(preactRoot, 'compat', 'dist', 'compat.umd.js'), path.join(libsDir, 'preact', 'compat', 'dist', 'compat.umd.js'));
await copyFileTo(path.join(preactRoot, 'compat', 'dist', 'compat.umd.js.map'), path.join(libsDir, 'preact', 'compat', 'dist', 'compat.umd.js.map'));
await copyFileTo(path.join(preactRoot, 'jsx-runtime', 'dist', 'jsxRuntime.umd.js'), path.join(libsDir, 'preact', 'jsx-runtime', 'dist', 'jsxRuntime.umd.js'));
await copyFileTo(path.join(preactRoot, 'jsx-runtime', 'dist', 'jsxRuntime.umd.js.map'), path.join(libsDir, 'preact', 'jsx-runtime', 'dist', 'jsxRuntime.umd.js.map'));
await copyFileTo(path.join(preactRoot, 'debug', 'dist', 'debug.umd.js'), path.join(libsDir, 'preact', 'debug', 'dist', 'debug.umd.js'));
await copyFileTo(path.join(preactRoot, 'debug', 'dist', 'debug.umd.js.map'), path.join(libsDir, 'preact', 'debug', 'dist', 'debug.umd.js.map'));
await copyFileTo(path.join(preactRoot, 'devtools', 'dist', 'devtools.umd.js'), path.join(libsDir, 'preact', 'devtools', 'dist', 'devtools.umd.js'));
await copyFileTo(path.join(preactRoot, 'devtools', 'dist', 'devtools.umd.js.map'), path.join(libsDir, 'preact', 'devtools', 'dist', 'devtools.umd.js.map'));

console.log(`Prepared Oracle JET assets in ${path.relative(frontendDir, jetDir)} using @oracle/oraclejet ${oracleJetVersion}.`);
