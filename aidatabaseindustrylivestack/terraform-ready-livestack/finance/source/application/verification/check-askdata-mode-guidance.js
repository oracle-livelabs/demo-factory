#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ASK_DATA_FILE = path.join(ROOT, 'frontend', 'src', 'pages', 'AskData.jsx');
const STYLES_FILE = path.join(ROOT, 'frontend', 'src', 'styles', 'index.css');

const source = fs.readFileSync(ASK_DATA_FILE, 'utf8');
const styles = fs.readFileSync(STYLES_FILE, 'utf8');
const failures = [];

function fail(message) {
  failures.push(message);
}

function extractModes() {
  const match = source.match(/const MODES = (\[[\s\S]*?\]);\n\nconst EXAMPLE_QUESTIONS/);
  if (!match) {
    fail('Could not locate MODES definition before EXAMPLE_QUESTIONS.');
    return [];
  }
  try {
    return vm.runInNewContext(match[1], {});
  } catch (err) {
    fail(`Could not evaluate MODES definition: ${err.message}`);
    return [];
  }
}

const modes = extractModes();
const requiredModeIds = ['narrate', 'chat', 'showsql', 'runsql'];
const requiredFields = ['helper', 'placeholder', 'actionLabel', 'loadingLabel', 'emptyCopy'];
const minFieldLengths = {
  helper: 40,
  placeholder: 40,
  actionLabel: 3,
  loadingLabel: 20,
  emptyCopy: 30,
};

for (const modeId of requiredModeIds) {
  const mode = modes.find((entry) => entry.id === modeId);
  if (!mode) {
    fail(`Missing mode ${modeId}.`);
    continue;
  }
  for (const field of requiredFields) {
    if (!mode[field] || String(mode[field]).trim().length < minFieldLengths[field]) {
      fail(`Mode ${modeId} is missing a meaningful ${field}.`);
    }
  }
}

const explain = modes.find((entry) => entry.id === 'narrate') || {};
const chat = modes.find((entry) => entry.id === 'chat') || {};
if (explain.helper && chat.helper && explain.helper === chat.helper) {
  fail('Explain and Chat helpers should be visibly different.');
}
if (explain.placeholder && chat.placeholder && explain.placeholder === chat.placeholder) {
  fail('Explain and Chat placeholders should be visibly different.');
}
if (explain.actionLabel === chat.actionLabel) {
  fail('Explain and Chat action labels should be visibly different.');
}

const requiredSourceSnippets = [
  'const activeMode = MODES.find((m) => m.id === mode) || MODES[0];',
  'className="askdata-mode-guidance"',
  '{activeMode.label} - {activeMode.desc}',
  '{activeMode.helper}',
  '{activeMode.emptyCopy}',
  'label={activeMode.actionLabel}',
  'placeholder={activeMode.placeholder}',
  '{activeMode.loadingLabel}',
  'Current mode: {activeMode.label}',
  'role="tab"',
  'aria-selected={active}',
  'className={`askdata-mode-tab ${active ? \'is-active\' : \'\'}`}',
];

for (const snippet of requiredSourceSnippets) {
  if (!source.includes(snippet)) {
    fail(`AskData.jsx is missing expected mode-guidance wiring: ${snippet}`);
  }
}

const requiredStyleSnippets = [
  '.askdata-mode-tab',
  '.askdata-mode-tab.is-active',
  '.askdata-mode-guidance',
  '.askdata-mode-guidance__label',
  '.askdata-mode-guidance__text',
];

for (const snippet of requiredStyleSnippets) {
  if (!styles.includes(snippet)) {
    fail(`index.css is missing expected mode-guidance style: ${snippet}`);
  }
}

if (failures.length) {
  console.error('Ask Finance Data mode guidance check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Ask Finance Data mode guidance check passed.');
