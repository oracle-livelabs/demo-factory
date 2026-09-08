'use strict';

const crypto = require('crypto');
const express = require('express');
const nativeAi = require('../lib/nativeAiService');

const router = express.Router();

const FINANCE_SCHEMA_OBJECTS = [
  schemaObject('finance_institutions_v', 'view', 'Institutions', 'Finance Institutions', 'Finance-facing institution, counterparty, and business line view.'),
  schemaObject('finance_products_v', 'view', 'Products & Exposure', 'Finance Products', 'Finance-facing financial product view.'),
  schemaObject('client_transactions_v', 'view', 'Transactions & Cases', 'Client Transactions', 'Finance-facing transaction and case view.'),
  schemaObject('risk_signals_v', 'view', 'Risk Signals', 'Risk Signals', 'Finance-facing compliance, fraud, market, and operations signal view.'),
  schemaObject('signal_sources_v', 'view', 'Risk Signals', 'Signal Sources', 'Finance-facing institutional monitoring source view.'),
  schemaObject('service_centers_v', 'view', 'Service Operations', 'Service Centers', 'Finance-facing operations center view.'),
  schemaObject('service_capacity_v', 'view', 'Service Operations', 'Service Capacity', 'Finance-facing processing capacity view.'),
  schemaObject('service_routes_v', 'view', 'Service Operations', 'Service Routes', 'Finance-facing transaction routing and SLA view.'),
  schemaObject('finance_signal_product_exposure_v', 'view', 'Risk Signals', 'Signal Product Exposure', 'Curated signal-to-product exposure evidence.'),
  schemaObject('finance_transaction_exposure_v', 'view', 'Transactions & Cases', 'Transaction Exposure', 'Curated transaction, product, and client exposure evidence.'),
  schemaObject('finance_service_pressure_v', 'view', 'Service Operations', 'Service Pressure', 'Curated service-center capacity and SLA pressure evidence.'),
  schemaObject('finance_fraud_case_exposure_v', 'view', 'Transactions & Cases', 'Fraud Case Exposure', 'Curated fraud-case and connected-account exposure evidence.'),
];

function schemaObject(objectName, objectType, domain, displayName, description) {
  return {
    object_name: objectName,
    object_type: objectType,
    domain,
    display_name: displayName,
    description,
    example_questions: [],
    is_queryable_by_assistant: true,
  };
}

function groupFinanceSchemaObjectMetadata(objects) {
  const groups = new Map();
  for (const object of objects) {
    if (!groups.has(object.domain)) groups.set(object.domain, []);
    groups.get(object.domain).push(object);
  }
  return [...groups.entries()].map(([domain, groupObjects]) => ({
    domain,
    objects: groupObjects,
    object_count: groupObjects.length,
  }));
}

function questionFrom(req) {
  const question = String(req.body?.question || '').trim();
  if (!question) {
    throw new nativeAi.NativeAiError('A question is required.', {
      category: 'INVALID_REQUEST',
      statusCode: 400,
    });
  }
  if (question.length > 8_000) {
    throw new nativeAi.NativeAiError('The question is too long.', {
      category: 'INVALID_REQUEST',
      statusCode: 400,
    });
  }
  return question;
}

function safeErrorPayload(error, startedAt, context = {}) {
  const category = error.category || 'NATIVE_AI_UNAVAILABLE';
  const knownMessage = error instanceof nativeAi.NativeAiError
    ? error.message
    : 'ADB native AI could not complete the request.';
  return {
    error: knownMessage,
    category,
    correlationId: error.correlationId || crypto.randomUUID(),
    elapsed: Date.now() - startedAt,
    profile: context.profile || nativeAi.DEFAULT_PROFILE,
    model: nativeAi.getProfileEvidence().model,
    region: nativeAi.getProfileEvidence().region,
    provider: 'OCI Generative AI',
    action: context.action || null,
    sql: category === 'SQL_VALIDATION_BLOCKED' ? null : error.sql || null,
    ready: false,
  };
}

function sendError(res, error, startedAt, context = {}) {
  console.error('Native AI request failed', {
    category: error.category || 'NATIVE_AI_UNAVAILABLE',
    correlationId: error.correlationId || null,
    message: error.message,
    cause: error.cause?.message || null,
  });
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 503;
  return res.status(status).json(safeErrorPayload(error, startedAt, context));
}

function evidence(action, overrides = {}) {
  const profile = nativeAi.getProfileEvidence();
  return {
    action,
    package: 'DBMS_CLOUD_AI',
    profile: profile.name,
    provider: profile.provider,
    model: profile.model,
    region: profile.region,
    readOnly: true,
    ...overrides,
  };
}

router.get('/profiles', async (_req, res) => {
  const startedAt = Date.now();
  try {
    const readiness = await nativeAi.checkReadiness();
    const profile = nativeAi.getProfileEvidence();
    return res.json({
      profiles: [{ ...profile, readiness: 'READY' }],
      activeProfile: profile.name,
      readiness,
    });
  } catch (error) {
    return sendError(res, error, startedAt, { action: 'READINESS' });
  }
});

router.get('/schema-objects', (_req, res) => {
  res.json({
    objects: FINANCE_SCHEMA_OBJECTS,
    domains: groupFinanceSchemaObjectMetadata(FINANCE_SCHEMA_OBJECTS),
    meta: {
      object_count: FINANCE_SCHEMA_OBJECTS.length,
      domain_count: new Set(FINANCE_SCHEMA_OBJECTS.map((object) => object.domain)).size,
      raw_object_names_preserved: true,
      queryable_only: true,
      source: 'Select AI curated object allowlist',
    },
  });
});

router.get('/health', async (_req, res) => {
  const startedAt = Date.now();
  try {
    const readiness = await nativeAi.checkReadiness();
    return res.json({
      status: 'healthy',
      ready: true,
      evidence: evidence('READINESS'),
      checks: [
        { name: 'native_ai_bootstrap', status: 'ok' },
        { name: 'select_ai_profile', status: 'ok', profile: nativeAi.DEFAULT_PROFILE },
        { name: 'curated_schema', status: 'ok', count: FINANCE_SCHEMA_OBJECTS.length },
        { name: 'select_ai_agent_teams', status: 'ok', count: nativeAi.getTeamCatalog().length },
      ],
      readiness,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return sendError(res, error, startedAt, { action: 'READINESS' });
  }
});

async function handleNarrativeMode(req, res, mode) {
  const startedAt = Date.now();
  let question = '';
  try {
    question = questionFrom(req);
    const profile = nativeAi.normalizeProfile(req.body?.profile);
    const conversationId = req.body?.conversationId || null;
    const result = await nativeAi.answerQuestion(question, {
      mode,
      demoUser: req.demoUser,
      requestedProfile: profile,
      conversationId,
    });
    return res.json({
      question,
      answer: result.answer,
      keyFindings: [],
      resultSummary: '',
      followUpQuestions: [],
      referencedData: result.referencedData,
      rowCount: result.rowCount,
      sql: req.body?.showSql === false ? null : result.sql,
      warnings: [],
      elapsed: Date.now() - startedAt,
      profile,
      model: result.model,
      region: result.region,
      provider: result.provider,
      action: mode === 'chat' ? 'SHOWSQL + RUNSQL + CHAT' : 'SHOWSQL + RUNSQL + CHAT',
      readOnly: true,
      conversationId: result.conversationId,
      evidence: evidence('SHOWSQL + RUNSQL + CHAT', {
        generatedSql: Boolean(result.sql),
        executed: true,
        rowCount: result.rowCount,
        truncated: result.truncated,
        vpdUserContext: Boolean(req.demoUser),
      }),
      conversation: {
        conversationId: result.conversationId,
        contextApplied: Boolean(conversationId),
        contextProvider: 'adb-select-ai',
        provider: 'ADB Select AI conversation',
      },
    });
  } catch (error) {
    return sendError(res, error, startedAt, {
      action: 'SHOWSQL + RUNSQL + CHAT',
      question,
    });
  }
}

router.post('/chat', (req, res) => handleNarrativeMode(req, res, 'narrate'));
router.post('/chat-mode', (req, res) => handleNarrativeMode(req, res, 'chat'));

router.post('/showsql', async (req, res) => {
  const startedAt = Date.now();
  try {
    const question = questionFrom(req);
    const profile = nativeAi.normalizeProfile(req.body?.profile);
    const result = await nativeAi.generateQuestionSql(question, {
      requestedProfile: profile,
      conversationId: req.body?.conversationId || null,
    });
    return res.json({
      question,
      sql: result.sql,
      explanation: 'ADB Select AI generated this single read-only query for review. It was not executed.',
      elapsed: Date.now() - startedAt,
      profile,
      model: result.model,
      region: result.region,
      provider: result.provider,
      action: 'SHOWSQL',
      readOnly: true,
      evidence: evidence('SHOWSQL', { generatedSql: true, executed: false }),
      conversationId: result.conversationId,
    });
  } catch (error) {
    return sendError(res, error, startedAt, { action: 'SHOWSQL' });
  }
});

router.post('/runsql', async (req, res) => {
  const startedAt = Date.now();
  try {
    const question = questionFrom(req);
    const profile = nativeAi.normalizeProfile(req.body?.profile);
    const result = await nativeAi.runQuestionQuery(question, {
      demoUser: req.demoUser,
      requestedProfile: profile,
      conversationId: req.body?.conversationId || null,
    });
    return res.json({
      question,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated,
      sql: result.sql,
      explanation: `${result.rowCount} row${result.rowCount === 1 ? '' : 's'} returned from the validated read-only Select AI query.`,
      elapsed: Date.now() - startedAt,
      profile,
      model: result.model,
      region: result.region,
      provider: result.provider,
      action: 'RUNSQL',
      readOnly: true,
      evidence: evidence('RUNSQL', {
        generatedSql: true,
        executed: true,
        rowCount: result.rowCount,
        truncated: result.truncated,
      }),
      conversationId: result.conversationId,
    });
  } catch (error) {
    return sendError(res, error, startedAt, { action: 'RUNSQL' });
  }
});

module.exports = router;
