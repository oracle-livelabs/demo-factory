'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_TURN_CHARS,
  createConversationContext,
  formatConversationForPrompt,
  normalizeConversationHistory,
} = require('../backend/lib/conversationContext');

test('normalizes browser chat turns without returning an unbounded transcript', () => {
  const history = [
    { role: 'user', text: '  Show Meridian Trust Bank revenue.  ' },
    { role: 'assistant', content: 'Revenue is $42,000.' },
    { role: 'system', text: 'must not enter a user-controlled chat prompt' },
    { role: 'assistant', text: 'x'.repeat(MAX_TURN_CHARS + 50) },
  ];
  const turns = normalizeConversationHistory(history);
  assert.equal(turns.length, 3);
  assert.deepEqual(turns[0], { role: 'user', text: 'Show Meridian Trust Bank revenue.' });
  assert.deepEqual(turns[1], { role: 'assistant', text: 'Revenue is $42,000.' });
  assert.equal(turns[2].text.length, MAX_TURN_CHARS);
});

test('marks a follow-up as context-aware when prior turns are supplied', () => {
  const context = createConversationContext(
    [{ role: 'user', text: 'Show Meridian Trust Bank revenue.' }],
    'What about it by client tier?'
  );
  assert.deepEqual(context.metadata, {
    turnsReceived: 1,
    contextApplied: true,
    referenceDetected: true,
  });
  assert.match(formatConversationForPrompt(context.turns), /Meridian Trust Bank/);
});

test('does not claim context when the caller sends no usable turns', () => {
  const context = createConversationContext([{ role: 'assistant', text: '   ' }], 'What about it?');
  assert.equal(context.metadata.turnsReceived, 0);
  assert.equal(context.metadata.contextApplied, false);
  assert.equal(context.metadata.referenceDetected, true);
});
