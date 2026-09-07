'use strict';

const crypto = require('crypto');
const express = require('express');
const db = require('../config/database');
const nativeAi = require('../lib/nativeAiService');

const router = express.Router();

function boundedInteger(value, fallback, maximum = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function requiredQuestion(req, fallback = '') {
  const question = String(req.body?.question || fallback).trim();
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

function safeAgentError(error) {
  const known = error instanceof nativeAi.NativeAiError;
  return {
    error: known ? error.message : 'ADB Select AI Agent could not complete the request.',
    category: error.category || 'AI_AGENT_UNAVAILABLE',
    correlationId: error.correlationId || crypto.randomUUID(),
    ready: false,
    provider: 'OCI Generative AI',
    profile: nativeAi.DEFAULT_PROFILE,
    readOnly: true,
    advisory: true,
    conversationId: error.conversationId || null,
    team: error.team || null,
    state: error.state || null,
  };
}

function sendAgentError(res, error) {
  console.error('Native agent request failed', {
    category: error.category || 'AI_AGENT_UNAVAILABLE',
    correlationId: error.correlationId || null,
    message: error.message,
    cause: error.cause?.message || null,
  });
  return res
    .status(Number.isInteger(error.statusCode) ? error.statusCode : 503)
    .json(safeAgentError(error));
}

async function logAdvisoryRun(result, question, demoUser) {
  const payload = JSON.stringify({
    reason: result.response.slice(0, 4_000),
    question: question.slice(0, 2_000),
    team: result.team,
    action: result.action,
    profile: result.profile,
    provider: result.provider,
    model: result.model,
    region: result.region,
    conversation_id: result.conversationId,
    advisory: true,
    read_only: true,
  });
  try {
    await db.executeAsUser(
      `INSERT INTO agent_actions
         (agent_name, action_type, entity_type, entity_id, decision_payload,
          confidence, execution_status, executed_at)
       VALUES
         (:agent, 'advisory_recommendation', 'finance_operations', NULL, :payload,
          NULL, 'proposed', SYSTIMESTAMP)`,
      {
        agent: result.team.toLowerCase(),
        payload,
      },
      demoUser
    );
  } catch (error) {
    throw new nativeAi.NativeAiError('The native agent response could not be written to the audit trail.', {
      category: 'AGENT_AUDIT_FAILED',
      cause: error,
    });
  }
}

async function executeAgent(question, {
  team = null,
  conversationId = null,
  history = [],
  demoUser = null,
  log = true,
} = {}) {
  const result = await nativeAi.runAgentTeam(question, {
    requestedTeam: team,
    conversationId,
    history,
    demoUser,
  });
  if (log) await logAdvisoryRun(result, question, demoUser);
  return result;
}

function responsePayload(result, question, startedAt) {
  return {
    question,
    response: result.response,
    team: result.team,
    intent: 'native-advisory',
    agentUsed: true,
    nativeAgent: true,
    agentToolsUsed: result.agentToolsUsed,
    executionSteps: result.executionSteps,
    data: null,
    elapsed: Date.now() - startedAt,
    conversationId: result.conversationId,
    state: result.state,
    profile: result.profile,
    provider: result.provider,
    model: result.model,
    region: result.region,
    action: result.action,
    package: result.package,
    contextApplied: result.contextApplied,
    contextProvider: result.contextProvider,
    grounding: result.grounding,
    advisory: true,
    readOnly: true,
    evidence: {
      package: result.package,
      action: result.action,
      team: result.team,
      profile: result.profile,
      provider: result.provider,
      model: result.model,
      region: result.region,
      state: result.state,
      advisory: true,
      readOnly: true,
    },
  };
}

router.post('/chat', async (req, res) => {
  const startedAt = Date.now();
  try {
    const question = requiredQuestion(req);
    const result = await executeAgent(question, {
      team: req.body?.team || null,
      conversationId: req.body?.conversationId || null,
      history: req.body?.history || [],
      demoUser: req.demoUser,
    });
    return res.json(responsePayload(result, question, startedAt));
  } catch (error) {
    return sendAgentError(res, error);
  }
});

router.post('/ask', async (req, res) => {
  const startedAt = Date.now();
  try {
    const question = requiredQuestion(req);
    const result = await executeAgent(question, {
      team: req.body?.team || null,
      conversationId: req.body?.conversationId || null,
      history: req.body?.history || [],
      demoUser: req.demoUser,
    });
    return res.json(responsePayload(result, question, startedAt));
  } catch (error) {
    return sendAgentError(res, error);
  }
});

const TEAM_ENDPOINTS = Object.freeze({
  trends: {
    team: 'SOCIAL_TREND_TEAM',
    prompt: 'Identify the highest-priority fraud, AML, regulatory, and market signals in the current governed finance data.',
  },
  fulfillment: {
    team: 'FULFILLMENT_TEAM',
    prompt: 'Identify service centers with the highest capacity, routing, compliance, or SLA pressure in the current governed finance data.',
  },
  commerce: {
    team: 'COMMERCE_TEAM',
    prompt: 'Summarize the most important transaction, product, client, revenue, and exposure patterns in the current governed finance data.',
  },
});

for (const [path, config] of Object.entries(TEAM_ENDPOINTS)) {
  router.post(`/${path}`, async (req, res) => {
    const startedAt = Date.now();
    try {
      const question = requiredQuestion(req, config.prompt);
      const result = await executeAgent(question, {
        team: config.team,
        conversationId: req.body?.conversationId || null,
        history: req.body?.history || [],
        demoUser: req.demoUser,
      });
      return res.json(responsePayload(result, question, startedAt));
    } catch (error) {
      return sendAgentError(res, error);
    }
  });
}

router.post('/detect-trends', async (req, res) => {
  const startedAt = Date.now();
  try {
    const hours = boundedInteger(req.body?.windowHours, 24, 720);
    const threshold = boundedInteger(req.body?.viralThreshold, 75, 100);
    const question = `Review governed fraud, AML, regulatory, and market signals from the last ${hours} hours. Prioritize records at or above risk severity ${threshold}. Return advisory findings only.`;
    const result = await executeAgent(question, {
      team: 'SOCIAL_TREND_TEAM',
      demoUser: req.demoUser,
    });
    return res.json({
      message: 'Native Select AI Agent signal review completed.',
      signal_summary: result.response,
      analysis: result.response,
      actions: [],
      distribution: [],
      ...responsePayload(result, question, startedAt),
    });
  } catch (error) {
    return sendAgentError(res, error);
  }
});

router.post('/run-cycle', async (req, res) => {
  const startedAt = Date.now();
  try {
    const runs = [];
    for (const config of Object.values(TEAM_ENDPOINTS)) {
      const result = await executeAgent(config.prompt, {
        team: config.team,
        demoUser: req.demoUser,
      });
      runs.push(responsePayload(result, config.prompt, startedAt));
    }
    return res.json({
      message: 'Native read-only advisory cycle completed.',
      phases: runs,
      actions: runs.map((run) => ({
        team: run.team,
        state: run.state,
        advisory: true,
        readOnly: true,
      })),
      elapsed: Date.now() - startedAt,
      provider: 'OCI Generative AI',
      profile: nativeAi.DEFAULT_PROFILE,
      action: 'RUN_TEAM',
      package: 'DBMS_CLOUD_AI_AGENT',
      advisory: true,
      readOnly: true,
    });
  } catch (error) {
    return sendAgentError(res, error);
  }
});

router.get('/profiles', async (_req, res) => {
  try {
    const readiness = await nativeAi.checkReadiness();
    const profile = nativeAi.getProfileEvidence();
    return res.json({
      profiles: [{ ...profile, readiness: 'READY' }],
      activeProfile: profile.name,
      readiness,
    });
  } catch (error) {
    return sendAgentError(res, error);
  }
});

router.post('/set-profile', async (req, res) => {
  try {
    const profile = nativeAi.normalizeProfile(req.body?.profile);
    await nativeAi.checkReadiness();
    return res.json({
      success: true,
      profile,
      message: `Active ADB Select AI profile is ${profile}.`,
      provider: 'OCI Generative AI',
      readOnly: true,
    });
  } catch (error) {
    return sendAgentError(res, error);
  }
});

router.get('/teams', async (_req, res) => {
  try {
    await nativeAi.checkReadiness();
    return res.json(nativeAi.getTeamCatalog());
  } catch (error) {
    return sendAgentError(res, error);
  }
});

router.get('/events', async (req, res) => {
  try {
    const limit = boundedInteger(req.query.limit, 15, 100);
    const result = await db.execute(
      `SELECT /*+ NO_PARALLEL */ event_id, event_type, event_source,
              JSON_SERIALIZE(event_data) AS event_data,
              processed, created_at
         FROM event_stream
        ORDER BY created_at DESC
        FETCH FIRST :limit ROWS ONLY`,
      { limit }
    );
    return res.json(result.rows || []);
  } catch (error) {
    console.error('Agent event history failed:', error.message);
    return res.status(503).json({ error: 'Agent event history is unavailable.' });
  }
});

router.get('/tool-history', async (req, res) => {
  try {
    const limit = boundedInteger(req.query.limit, 20, 100);
    const result = await db.execute(
      `SELECT tool_name,
              team_exec_id,
              task_order,
              agent_name,
              task_name,
              TO_CHAR(start_date, 'YYYY-MM-DD HH24:MI:SS') AS called_at,
              TO_CHAR(end_date, 'YYYY-MM-DD HH24:MI:SS') AS ended_at,
              CASE
                WHEN end_date IS NULL THEN 'RUNNING'
                ELSE 'ENDED'
              END AS state
         FROM user_ai_agent_tool_history
        ORDER BY start_date DESC
        FETCH FIRST :limit ROWS ONLY`,
      { limit }
    );
    return res.json(result.rows || []);
  } catch (error) {
    console.error('Agent tool history failed:', error.message);
    return res.status(503).json({ error: 'Agent tool history is unavailable.' });
  }
});

router.get('/team-history', async (req, res) => {
  try {
    const limit = boundedInteger(req.query.limit, 20, 100);
    const result = await db.execute(
      `SELECT team_exec_id,
              team_name,
              state,
              TO_CHAR(start_date, 'YYYY-MM-DD HH24:MI:SS') AS started_at,
              TO_CHAR(end_date, 'YYYY-MM-DD HH24:MI:SS') AS ended_at
         FROM user_ai_agent_team_history
        ORDER BY start_date DESC
        FETCH FIRST :limit ROWS ONLY`,
      { limit }
    );
    return res.json(result.rows || []);
  } catch (error) {
    console.error('Agent team history failed:', error.message);
    return res.status(503).json({ error: 'Agent team history is unavailable.' });
  }
});

router.get('/actions', async (req, res) => {
  try {
    const limit = boundedInteger(req.query.limit, 50, 100);
    const filters = [];
    const binds = { limit };
    if (req.query.agent) {
      filters.push('agent_name = :agent');
      binds.agent = String(req.query.agent).slice(0, 128);
    }
    if (req.query.type) {
      filters.push('action_type = :type');
      binds.type = String(req.query.type).slice(0, 128);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const result = await db.execute(
      `SELECT action_id, agent_name, action_type, entity_type, entity_id,
              decision_payload, confidence, execution_status,
              executed_at, created_at
         FROM agent_actions
         ${where}
        ORDER BY created_at DESC
        FETCH FIRST :limit ROWS ONLY`,
      binds
    );
    return res.json(result.rows || []);
  } catch (error) {
    console.error('Agent action history failed:', error.message);
    return res.status(503).json({ error: 'Agent action history is unavailable.' });
  }
});

router.get('/summary', async (_req, res) => {
  try {
    const result = await db.execute(
      `SELECT agent_name,
              COUNT(*) AS total_actions,
              COUNT(CASE WHEN execution_status = 'completed' THEN 1 END) AS completed,
              COUNT(CASE WHEN execution_status = 'failed' THEN 1 END) AS failed,
              COUNT(CASE WHEN execution_status = 'proposed' THEN 1 END) AS proposed,
              MAX(created_at) AS last_action
         FROM agent_actions
        WHERE created_at >= (SELECT MAX(created_at) FROM agent_actions) - INTERVAL '7' DAY
        GROUP BY agent_name
        ORDER BY total_actions DESC`
    );
    return res.json(result.rows || []);
  } catch (error) {
    console.error('Agent summary failed:', error.message);
    return res.status(503).json({ error: 'Agent summary is unavailable.' });
  }
});

module.exports = router;
