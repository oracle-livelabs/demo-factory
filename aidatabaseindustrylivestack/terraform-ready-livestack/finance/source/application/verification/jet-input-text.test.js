'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const controlsPath = path.join(
  __dirname,
  '..',
  'frontend',
  'src',
  'components',
  'JetControls.jsx'
);
const askDataPath = path.join(
  __dirname,
  '..',
  'frontend',
  'src',
  'pages',
  'AskData.jsx'
);

function jetInputTextSource() {
  const source = fs.readFileSync(controlsPath, 'utf8');
  const start = source.indexOf('export function JetInputText(');
  const end = source.indexOf('export function JetSelectSingle(', start);
  assert.notEqual(start, -1, 'JetInputText component must exist.');
  assert.notEqual(end, -1, 'JetInputText component must end before JetSelectSingle.');
  return source.slice(start, end);
}

test('JetInputText synchronizes Oracle JET disabled state after React readiness changes', () => {
  const source = jetInputTextSource();

  assert.match(
    source,
    /useEffect\(\(\) => \{\s*const el = ref\.current;\s*if \(!el\) return;\s*setJetProperty\(el, 'disabled', Boolean\(disabled\)\);\s*\}, \[disabled\]\);/
  );
  assert.doesNotMatch(source, /<oj-input-text[\s\S]*?disabled=\{disabled\}/);
});

test('Ask Finance keeps its native-AI readiness gate on the composer', () => {
  const source = fs.readFileSync(askDataPath, 'utf8');
  assert.match(
    source,
    /disabled=\{sending \|\| nativeAiStatus !== 'ready'\}/
  );
});
