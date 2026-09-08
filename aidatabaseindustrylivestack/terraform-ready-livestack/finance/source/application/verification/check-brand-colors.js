#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  path.join(ROOT, 'frontend', 'src'),
  path.join(ROOT, 'frontend', 'index.html'),
  path.join(ROOT, 'frontend', 'public', 'jet', 'bootstrap.js'),
];

const APPROVED_HEX_BASES = new Map([
  ['C74634', 'Oracle Red'],
  ['312D2A', 'Oracle Bark'],
  ['F0CC71', 'Brand Yellow'],
  ['5F7D4F', 'Brand Green'],
  ['E9E1CA', 'Beige 40'],
  ['A9BBBC', 'Slate 60'],
  ['697778', 'Database / Slate 100'],
  ['A36472', 'HCM / Rose 100'],
  ['6F757E', 'Dev Tools / Pebble 100'],
  ['4F7D7B', 'Finance / Teal 100'],
  ['796087', 'CX / Plum 110'],
  ['6B7494', 'GBU / Lilac 100'],
  ['AA643B', 'SCM / Sienna 100'],
  ['437C94', 'NetSuite / Ocean 100'],
  ['7A736E', 'Brand Neutral 100'],
  ['4C825C', 'OCI / Pine 100'],
  ['00688C', 'Link Blue 120'],
  ['FFFFFF', 'Text White'],
  ['161513', 'Text Neutral 190'],
]);

const REVIEW_RGB_BASES = new Set([
  '0,0,0',
  '255,255,255',
]);

const BRAND_RGB_BASES = new Set(
  [...APPROVED_HEX_BASES.keys()].map((hex) => {
    const value = hex.length === 6 ? hex : hex.slice(0, 6);
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ].join(',');
  }),
);

const HEX_RE = /#[0-9A-Fa-f]{3,8}\b/g;
const RGBA_RE = /rgba?\(([^)]+)\)/g;
const UTILITY_RE = /\b(?:text|bg|border|from|to|via|fill|stroke)-(?:red|green|blue|yellow|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)-[0-9]{2,3}(?:\/[0-9]{1,3})?\b|\b(?:text|bg|border)-(?:black|white)(?:\/[0-9]{1,3})?\b/g;

function walk(entry) {
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) {
    return fs.readdirSync(entry).flatMap((name) => walk(path.join(entry, name)));
  }
  return [entry];
}

function toRelative(filePath) {
  return path.relative(ROOT, filePath) || filePath;
}

function expandShortHex(raw) {
  if (raw.length === 3 || raw.length === 4) {
    return raw.split('').map((ch) => ch + ch).join('');
  }
  return raw;
}

function normalizeHexBase(token) {
  const raw = token.replace('#', '').toUpperCase();
  const expanded = expandShortHex(raw);
  return expanded.slice(0, 6);
}

function isApprovedHex(token) {
  return APPROVED_HEX_BASES.has(normalizeHexBase(token));
}

function parseRgbBase(rawArgs) {
  const parts = rawArgs
    .split(',')
    .slice(0, 3)
    .map((part) => part.trim())
    .map((part) => {
      if (part.endsWith('%')) {
        const pct = Number(part.slice(0, -1));
        return Number.isFinite(pct) ? Math.round((pct / 100) * 255) : NaN;
      }
      return Number(part);
    });
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.join(',');
}

function collectFindings() {
  const files = TARGETS.flatMap((entry) => walk(entry)).filter((file) => /\.(css|js|jsx|ts|tsx|html)$/.test(file));
  const violations = [];
  const reviews = [];

  for (const file of files) {
    const rel = toRelative(file);
    const source = fs.readFileSync(file, 'utf8');
    const lines = source.split(/\r?\n/);

    lines.forEach((line, index) => {
      const lineNo = index + 1;

      for (const match of line.matchAll(HEX_RE)) {
        const token = match[0];
        if (!isApprovedHex(token)) {
          violations.push({
            kind: 'non-approved-hex',
            file: rel,
            line: lineNo,
            token,
          });
        }
      }

      for (const match of line.matchAll(RGBA_RE)) {
        const token = match[0];
        const rgbBase = parseRgbBase(match[1]);
        if (!rgbBase) continue;
        if (BRAND_RGB_BASES.has(rgbBase)) continue;
        if (REVIEW_RGB_BASES.has(rgbBase)) {
          reviews.push({
            kind: 'neutral-overlay-review',
            file: rel,
            line: lineNo,
            token,
          });
          continue;
        }
        violations.push({
          kind: 'non-approved-rgba-base',
          file: rel,
          line: lineNo,
          token,
        });
      }

      for (const match of line.matchAll(UTILITY_RE)) {
        const token = match[0];
        if (token.startsWith('text-white')) {
          continue;
        }
        if (token.includes('-black') || token.includes('-white')) {
          reviews.push({
            kind: 'tailwind-neutral-utility-review',
            file: rel,
            line: lineNo,
            token,
          });
          continue;
        }
        violations.push({
          kind: 'tailwind-color-utility',
          file: rel,
          line: lineNo,
          token,
        });
      }
    });
  }

  return { violations, reviews };
}

function topCounts(items, limit = 12) {
  const counts = new Map();
  for (const item of items) {
    const key = item.token;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function fileCounts(items, limit = 12) {
  const counts = new Map();
  for (const item of items) {
    counts.set(item.file, (counts.get(item.file) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function formatSection(title, rows) {
  if (!rows.length) return `${title}\n- none\n`;
  return `${title}\n${rows.map(([key, count]) => `- ${key}: ${count}`).join('\n')}\n`;
}

function formatFindings(title, items, limit = 40) {
  if (!items.length) return `${title}\n- none\n`;
  return `${title}\n${items.slice(0, limit).map((item) => `- ${item.file}:${item.line} ${item.kind} ${item.token}`).join('\n')}\n`;
}

function buildReport({ violations, reviews }) {
  const lines = [];
  lines.push('# Brand Color Audit');
  lines.push('');
  lines.push('## Allowed Redwood Base Colors');
  lines.push('');
  for (const [hex, label] of APPROVED_HEX_BASES.entries()) {
    lines.push(`- #${hex} — ${label}`);
  }
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Violations: ${violations.length}`);
  lines.push(`- Review items: ${reviews.length}`);
  lines.push('');
  lines.push(formatSection('## Top Violating Tokens', topCounts(violations)));
  lines.push(formatSection('## Files With Most Violations', fileCounts(violations)));
  lines.push(formatFindings('## Sample Violations', violations));
  lines.push(formatSection('## Top Review Tokens', topCounts(reviews)));
  lines.push(formatSection('## Files With Most Review Items', fileCounts(reviews)));
  lines.push(formatFindings('## Sample Review Items', reviews));
  return lines.join('\n').trimEnd() + '\n';
}

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = collectFindings();
  const report = buildReport(result);

  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, report);
  }

  process.stdout.write(report);

  if (result.violations.length || result.reviews.length) {
    process.exitCode = 1;
    return;
  }

  process.stdout.write('\nBrand color audit passed.\n');
}

main();
