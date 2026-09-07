#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE_URL = process.env.A11Y_BASE_URL || 'http://127.0.0.1:8505';
const PAGES = [
  { id: 'welcome', url: `${BASE_URL}/` },
  { id: 'datamodel', url: `${BASE_URL}/?page=datamodel` },
  { id: 'dashboard', url: `${BASE_URL}/?page=dashboard` },
  { id: 'social', url: `${BASE_URL}/?page=social` },
  { id: 'graph', url: `${BASE_URL}/?page=graph` },
  { id: 'fulfillment', url: `${BASE_URL}/?page=fulfillment` },
  { id: 'orders', url: `${BASE_URL}/?page=orders` },
  { id: 'oml', url: `${BASE_URL}/?page=oml` },
  { id: 'askdata', url: `${BASE_URL}/?page=askdata` },
  { id: 'agents', url: `${BASE_URL}/?page=agents` },
];

const SEMANTIC_AUDITS = [
  'aria-allowed-attr',
  'aria-allowed-role',
  'aria-hidden-focus',
  'aria-prohibited-attr',
  'aria-required-attr',
  'aria-required-children',
  'aria-required-parent',
  'aria-roles',
  'aria-valid-attr',
  'aria-valid-attr-value',
  'bypass',
  'definition-list',
  'dlitem',
  'empty-heading',
  'heading-order',
  'landmark-one-main',
  'list',
  'listitem',
  'skip-link',
  'tabindex',
  'table-duplicate-name',
  'table-fake-caption',
];

const FOCUS_RULES = [
  '.app-shell button:focus-visible',
  '.app-shell a:focus-visible',
  '.app-shell input:focus-visible',
  '.app-shell select:focus-visible',
  '.app-shell textarea:focus-visible',
  '.app-shell [role="button"]:focus-visible',
  '.app-shell oj-button:focus-within',
  '.app-shell oj-input-text:focus-within',
  '.app-shell oj-select-single:focus-within',
];

function parseArgs(argv) {
  const args = { output: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') {
      args.output = argv[i + 1] ? path.resolve(ROOT, argv[i + 1]) : null;
      i += 1;
    }
  }
  return args;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    env: {
      ...process.env,
      CHROME_PATH,
    },
    ...options,
  });
}

function runLighthouse(url) {
  const output = run('npx', [
    '--yes',
    'lighthouse',
    url,
    '--preset=desktop',
    `--only-audits=${SEMANTIC_AUDITS.join(',')}`,
    '--max-wait-for-load=10000',
    '--output=json',
    '--output-path=stdout',
    '--quiet',
    '--chrome-flags=--headless=new --disable-gpu --window-size=1440,1400',
  ]);
  return JSON.parse(output);
}

function runFocusRuleAudit() {
  const cssPath = path.join(ROOT, 'frontend', 'src', 'styles', 'index.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  return FOCUS_RULES.filter((rule) => !css.includes(rule)).map((rule) => ({
    selector: rule,
    explanation: 'Missing shared focus treatment rule in frontend/src/styles/index.css',
  }));
}

function collectSemanticFailures(pageId, result) {
  const failures = [];
  for (const [auditId, audit] of Object.entries(result.audits)) {
    if (!SEMANTIC_AUDITS.includes(auditId)) continue;
    if (audit.score === 1 || audit.scoreDisplayMode === 'notApplicable') continue;
    if (audit.scoreDisplayMode === 'manual') {
      failures.push({
        auditId,
        selector: '(manual review)',
        label: audit.title,
        explanation: audit.description,
      });
      continue;
    }
    const items = audit.details && Array.isArray(audit.details.items) ? audit.details.items : [];
    for (const item of items) {
      failures.push({
        auditId,
        selector: item.node?.selector || '(unknown selector)',
        label: item.node?.nodeLabel || audit.title,
        explanation: item.node?.explanation || audit.description,
      });
    }
  }
  return failures.map((failure) => ({ page: pageId, ...failure }));
}

function buildReport(results) {
  const lines = [];
  const semanticCount = results.reduce((sum, page) => sum + page.semanticFailures.length, 0);
  const focusCount = results.reduce((sum, page) => sum + page.focusFailures.length, 0);

  lines.push('# Focus Treatment and Semantics Audit');
  lines.push('');
  lines.push(`- Base URL: ${BASE_URL}`);
  lines.push(`- Chrome: ${CHROME_PATH}`);
  lines.push(`- Pages audited: ${results.length}`);
  lines.push(`- Semantic failures: ${semanticCount}`);
  lines.push(`- Focus-treatment failures: ${focusCount}`);
  lines.push('');

  for (const page of results) {
    lines.push(`## ${page.id}`);
    lines.push('');
    lines.push(`- URL: ${page.url}`);
    lines.push(`- Semantic failures: ${page.semanticFailures.length}`);
    lines.push(`- Focus-treatment failures: ${page.focusFailures.length}`);
    lines.push('');

    if (!page.semanticFailures.length) {
      lines.push('- Semantics: pass');
    } else {
      lines.push('- Semantics: fail');
      for (const failure of page.semanticFailures) {
        lines.push(`  - [${failure.auditId}] \`${failure.selector}\` — ${failure.label}`);
        lines.push(`    ${failure.explanation}`);
      }
    }

    if (!page.focusFailures.length) {
      lines.push('- Focus treatment: pass');
    } else {
      lines.push('- Focus treatment: fail');
      for (const failure of page.focusFailures) {
        lines.push(`  - \`${failure.selector}\``);
        lines.push(`    ${failure.explanation}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const results = [];

  const focusFailures = runFocusRuleAudit();

  for (const page of PAGES) {
    const semanticResult = runLighthouse(page.url);
    const semanticFailures = collectSemanticFailures(page.id, semanticResult);
    results.push({
      id: page.id,
      url: page.url,
      semanticFailures,
      focusFailures: page.id === PAGES[0].id ? focusFailures : [],
    });
  }

  const report = buildReport(results);
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, report);
  }

  process.stdout.write(report);

  const semanticCount = results.reduce((sum, page) => sum + page.semanticFailures.length, 0);
  const focusCount = results.reduce((sum, page) => sum + page.focusFailures.length, 0);
  if (semanticCount || focusCount) {
    process.exitCode = 1;
    return;
  }
  process.stdout.write('\nFocus treatment and semantics audit passed.\n');
}

main();
