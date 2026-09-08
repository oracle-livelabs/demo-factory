#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE_URL = process.env.CONTRAST_BASE_URL || 'http://127.0.0.1:8505';

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

function runLighthouse(url) {
  const output = execFileSync(
    'npx',
    [
      '--yes',
      'lighthouse',
      url,
      '--preset=desktop',
      '--only-audits=color-contrast',
      '--max-wait-for-load=10000',
      '--output=json',
      '--output-path=stdout',
      '--quiet',
      '--chrome-flags=--headless=new --disable-gpu --window-size=1440,1400',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        CHROME_PATH,
      },
      maxBuffer: 50 * 1024 * 1024,
    },
  );

  return JSON.parse(output);
}

function normalizeFailures(pageId, result) {
  const audit = result.audits && result.audits['color-contrast'];
  const items = (audit && audit.details && Array.isArray(audit.details.items)) ? audit.details.items : [];
  return items.map((item) => ({
    page: pageId,
    selector: item.node && item.node.selector ? item.node.selector : 'unknown',
    label: item.node && item.node.nodeLabel ? item.node.nodeLabel.replace(/\s+/g, ' ').trim() : 'unlabeled',
    explanation: item.node && item.node.explanation ? item.node.explanation.replace(/\s+/g, ' ').trim() : 'No explanation provided',
  }));
}

function buildReport(results) {
  const lines = [];
  const totalFailures = results.reduce((sum, page) => sum + page.failures.length, 0);

  lines.push('# Contrast Accessibility Audit');
  lines.push('');
  lines.push(`- Base URL: ${BASE_URL}`);
  lines.push(`- Chrome: ${CHROME_PATH}`);
  lines.push(`- Pages audited: ${results.length}`);
  lines.push(`- Total failures: ${totalFailures}`);
  lines.push('');

  for (const page of results) {
    lines.push(`## ${page.id}`);
    lines.push('');
    lines.push(`- URL: ${page.url}`);
    lines.push(`- Score: ${page.score === 1 ? 'pass' : 'fail'}`);
    lines.push(`- Failures: ${page.failures.length}`);
    if (!page.failures.length) {
      lines.push('- No contrast failures reported.');
      lines.push('');
      continue;
    }
    lines.push('');
    for (const failure of page.failures) {
      lines.push(`- \`${failure.selector}\` — ${failure.label}`);
      lines.push(`  ${failure.explanation}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const results = [];

  for (const page of PAGES) {
    const result = runLighthouse(page.url);
    const audit = result.audits['color-contrast'];
    results.push({
      id: page.id,
      url: page.url,
      score: audit.score,
      failures: normalizeFailures(page.id, result),
    });
  }

  const report = buildReport(results);

  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, report);
  }

  process.stdout.write(report);

  const totalFailures = results.reduce((sum, page) => sum + page.failures.length, 0);
  if (totalFailures > 0) {
    process.exitCode = 1;
    return;
  }

  process.stdout.write('\nContrast audit passed.\n');
}

main();
