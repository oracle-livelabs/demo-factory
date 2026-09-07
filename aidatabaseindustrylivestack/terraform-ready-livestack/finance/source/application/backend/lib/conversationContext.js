'use strict';

const MAX_TURNS = 6;
const MAX_TURN_CHARS = 1200;

function textFromTurn(turn = {}) {
  return String(turn.text ?? turn.content ?? turn.answer ?? turn.question ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TURN_CHARS);
}

function normalizeConversationHistory(history, { maxTurns = MAX_TURNS } = {}) {
  if (!Array.isArray(history)) return [];

  return history
    .map((turn) => {
      const role = String(turn?.role || '').toLowerCase();
      if (role !== 'user' && role !== 'assistant') return null;
      const text = textFromTurn(turn);
      if (!text) return null;
      return {
        role,
        text,
      };
    })
    .filter(Boolean)
    .slice(-maxTurns);
}

function hasFollowUpReference(question) {
  return /\b(?:it|its|they|them|their|that|those|this|these|same|former|latter)\b/i.test(String(question || ''));
}

function createConversationContext(history, question) {
  const turns = normalizeConversationHistory(history);
  const referenceDetected = hasFollowUpReference(question);
  return {
    turns,
    metadata: {
      turnsReceived: turns.length,
      contextApplied: turns.length > 0,
      referenceDetected,
    },
  };
}

function formatConversationForPrompt(turns = []) {
  if (!turns.length) return '';
  return turns
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.text}`)
    .join('\n');
}

module.exports = {
  MAX_TURN_CHARS,
  MAX_TURNS,
  createConversationContext,
  formatConversationForPrompt,
  hasFollowUpReference,
  normalizeConversationHistory,
};
