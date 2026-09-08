'use strict';

const crypto = require('crypto');
const defaultDatabase = require('../config/database');

const DEFAULT_PROFILE = 'FINANCE_SELECTAI_V1';
const DEFAULT_MODEL = 'cohere.command-a-03-2025';
const DEFAULT_REGION = 'us-chicago-1';
const MAX_NATIVE_PROMPT_CHARS = 15_000;
const MAX_NARRATIVE_QUESTION_CHARS = 6_000;
const MAX_NARRATIVE_SQL_CHARS = 3_500;
const MAX_NARRATIVE_RESULT_CHARS = 4_500;
const MAX_AGENT_QUESTION_CHARS = 4_000;
const MAX_AGENT_HISTORY_CHARS = 2_500;
const MAX_AGENT_SQL_CHARS = 2_500;
const MAX_AGENT_RESULT_CHARS = 4_500;
const MAX_AGENT_RESULT_ROWS = 25;
const NATIVE_AGENT_STATES = Object.freeze([
  'RUNNING',
  'WAITING_FOR_HUMAN',
  'RESUMING',
  'SUCCEEDED',
  'FAILED',
]);
const DEFAULT_TEAMS = Object.freeze([
  'FINANCE_OPERATIONS_TEAM',
  'SOCIAL_TREND_TEAM',
  'FULFILLMENT_TEAM',
  'COMMERCE_TEAM',
]);

const DEFAULT_ALLOWED_OBJECTS = Object.freeze([
  'FINANCE_INSTITUTIONS_V',
  'FINANCE_PRODUCTS_V',
  'CLIENT_TRANSACTIONS_V',
  'RISK_SIGNALS_V',
  'SIGNAL_SOURCES_V',
  'SERVICE_CENTERS_V',
  'SERVICE_CAPACITY_V',
  'SERVICE_ROUTES_V',
  'FINANCE_SIGNAL_PRODUCT_EXPOSURE_V',
  'FINANCE_TRANSACTION_EXPOSURE_V',
  'FINANCE_SERVICE_PRESSURE_V',
  'FINANCE_FRAUD_CASE_EXPOSURE_V',
]);

const BLOCKED_APP_ROUTINES = Object.freeze([
  'FIND_MATCHING_PRODUCTS',
  'BATCH_SEMANTIC_MATCH',
  'SEARCH_PRODUCTS_BY_VECTOR',
  'SEARCH_PRODUCTS_BY_TEXT',
  'FIND_NEAREST_CENTERS',
  'OPTIMAL_FULFILLMENT',
  'VPD_FULFILLMENT_REGION',
  'VPD_ORDERS_REGION',
  'VPD_GRAPH_INFLUENCERS',
  'VPD_GRAPH_SOCIAL_POSTS',
  'VPD_GRAPH_CONNECTIONS',
  'VPD_GRAPH_BRAND_LINKS',
  'VPD_GRAPH_MENTIONS',
  'DETECT_TRENDING_PRODUCTS',
  'CHECK_PRODUCT_INVENTORY',
  'FIND_BEST_FULFILLMENT',
  'GET_INFLUENCER_NETWORK',
  'LOG_AGENT_DECISION',
]);

const SAFE_SQL_FUNCTIONS = Object.freeze([
  'ABS',
  'AVG',
  'CAST',
  'CEIL',
  'COALESCE',
  'COUNT',
  'DECODE',
  'DENSE_RANK',
  'EXTRACT',
  'FIRST_VALUE',
  'FLOOR',
  'GREATEST',
  'INITCAP',
  'JSON_ARRAY',
  'JSON_ARRAYAGG',
  'JSON_EXISTS',
  'JSON_OBJECT',
  'JSON_OBJECTAGG',
  'JSON_QUERY',
  'JSON_VALUE',
  'LAG',
  'LAST_VALUE',
  'LEAD',
  'LEAST',
  'LENGTH',
  'LISTAGG',
  'LOWER',
  'LPAD',
  'LTRIM',
  'MAX',
  'MEDIAN',
  'MIN',
  'MOD',
  'MONTHS_BETWEEN',
  'NULLIF',
  'NVL',
  'NVL2',
  'POWER',
  'RANK',
  'REGEXP_COUNT',
  'REGEXP_INSTR',
  'REGEXP_LIKE',
  'REGEXP_REPLACE',
  'REGEXP_SUBSTR',
  'REPLACE',
  'ROUND',
  'ROW_NUMBER',
  'RPAD',
  'RTRIM',
  'SIGN',
  'SQRT',
  'STDDEV',
  'SUBSTR',
  'SUM',
  'TO_CHAR',
  'TO_DATE',
  'TO_NUMBER',
  'TO_TIMESTAMP',
  'TRANSLATE',
  'TRIM',
  'TRUNC',
  'UPPER',
  'VARIANCE',
]);

const BLOCKED_SQL_PATTERNS = Object.freeze([
  { pattern: /\/\*|--/i, reason: 'SQL comments are not allowed.' },
  { pattern: /\bN?Q'\S/i, reason: 'Oracle alternative-quoted string literals are not allowed.' },
  { pattern: /\b(?:INSERT|UPDATE|DELETE|MERGE|UPSERT|CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|AUDIT|NOAUDIT|FLASHBACK|PURGE)\b/i, reason: 'Write operations and DDL are not allowed.' },
  { pattern: /\b(?:BEGIN|DECLARE|CALL|EXECUTE|EXEC)\b/i, reason: 'PL/SQL and procedure calls are not allowed.' },
  { pattern: /\bWITH\s+(?:FUNCTION|PROCEDURE)\b/i, reason: 'WITH clause functions and procedures are not allowed.' },
  { pattern: /\bAPPLY\b/i, reason: 'CROSS APPLY and OUTER APPLY table sources are not allowed.' },
  { pattern: /\bFOR\s+UPDATE\b/i, reason: 'SELECT FOR UPDATE is not allowed.' },
  { pattern: /\bINTO\s+(?:OUTFILE|DUMPFILE|[A-Z_$#"])/i, reason: 'SELECT INTO is not allowed.' },
  { pattern: /\b(?:DBMS_|UTL_|SYS\.|SYSTEM\.|DBA_|ALL_|USER_|V_\$|GV_\$|X\$)/i, reason: 'System packages and metadata views are not allowed.' },
  { pattern: /@[A-Z0-9_$#.-]+/i, reason: 'Database links are not allowed.' },
  { pattern: /\b[A-Z][A-Z0-9_$#]*\s*\.\s*(?:NEXTVAL|CURRVAL)\b/i, reason: 'Sequence access is not allowed.' },
]);

class NativeAiError extends Error {
  constructor(message, {
    category = 'NATIVE_AI_UNAVAILABLE',
    statusCode = 503,
    cause = null,
    sql = null,
    conversationId = null,
    team = null,
    state = null,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'NativeAiError';
    this.category = category;
    this.statusCode = statusCode;
    this.sql = sql;
    this.conversationId = conversationId;
    this.team = team;
    this.state = state;
    this.correlationId = crypto.randomUUID();
  }
}

function envValue(env, names, fallback) {
  for (const name of names) {
    const value = String(env[name] || '').trim();
    if (value) return value;
  }
  return fallback;
}

function parseCsv(value, fallback) {
  const items = String(value || '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : [...fallback];
}

function boundedTimeout(value, fallback, maximum = 900_000) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(30_000, parsed));
}

function isAgentTimeoutError(error) {
  const details = [
    error?.code,
    error?.message,
    error?.cause?.code,
    error?.cause?.message,
  ].filter(Boolean).join(' ');
  return /\b(?:NJS-123|DPI-1067|DPI-1080)\b|call timeout/i.test(details);
}

function extractScalar(result, preferredKeys = ['RESPONSE', 'RESULT', 'READINESS']) {
  const row = result?.rows?.[0];
  if (!row) return null;
  for (const key of preferredKeys) {
    if (row[key] != null) return row[key];
  }
  const firstKey = Object.keys(row)[0];
  return firstKey ? row[firstKey] : null;
}

function parseJson(value, label) {
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  try {
    return JSON.parse(String(value || ''));
  } catch (error) {
    throw new NativeAiError(`${label} returned an invalid response.`, {
      category: 'NATIVE_AI_INVALID_RESPONSE',
      cause: error,
    });
  }
}

function stripSqlFence(value) {
  let sql = String(value || '').trim();
  const fenced = sql.match(/^```(?:sql|oracle)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) sql = fenced[1].trim();
  sql = sql.replace(/^\s*SELECT\s+AI\s+SHOWSQL\s+/i, '');

  const firstStatement = sql.match(/\b(?:SELECT|WITH)\b[\s\S]*/i);
  if (firstStatement && firstStatement.index > 0) {
    const prefix = sql.slice(0, firstStatement.index).trim();
    if (/^(?:sql|generated sql|query)\s*:?\s*$/i.test(prefix)) {
      sql = firstStatement[0].trim();
    }
  }

  if (sql.endsWith(';')) sql = sql.slice(0, -1).trim();
  return sql;
}

function truncateForPrompt(value, maximum) {
  const text = String(value || '');
  if (text.length <= maximum) return text;
  const marker = '\n[context truncated]';
  return `${text.slice(0, Math.max(0, maximum - marker.length))}${marker}`;
}

function buildBoundedPrompt(parts, maximum = MAX_NATIVE_PROMPT_CHARS) {
  const prompt = parts.filter(Boolean).join('\n');
  return truncateForPrompt(prompt, maximum);
}

function normalizeIdentifier(identifier) {
  return String(identifier || '')
    .replace(/"/g, '')
    .trim()
    .toUpperCase();
}

function maskStringLiterals(sql) {
  return String(sql).replace(
    /'(?:''|[^'])*'/g,
    (literal) => ' '.repeat(literal.length)
  );
}

function findMatchingParenthesis(sql, openIndex) {
  let depth = 0;
  let inString = false;
  for (let index = openIndex; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'") {
      if (inString && sql[index + 1] === "'") {
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }
    if (inString) continue;
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function collectCteDefinitions(sql) {
  const definitions = new Map();
  const pattern = /(?:\bWITH\b|,)\s*("[A-Z][A-Z0-9_$#]*"|[A-Z][A-Z0-9_$#]*)\s+AS\s*\(/gi;
  const structuralSql = maskStringLiterals(sql);
  let match;
  while ((match = pattern.exec(structuralSql)) !== null) {
    const openIndex = pattern.lastIndex - 1;
    const closeIndex = findMatchingParenthesis(structuralSql, openIndex);
    if (closeIndex < 0) continue;
    definitions.set(normalizeIdentifier(match[1]), { openIndex, closeIndex });
  }
  return definitions;
}

function collectReferencedObjects(sql) {
  const references = [];
  const pattern = /\b(?:FROM|JOIN)\s+((?:"[A-Z][A-Z0-9_$#]*"|[A-Z][A-Z0-9_$#]*)(?:\s*\.\s*(?:"[A-Z][A-Z0-9_$#]*"|[A-Z][A-Z0-9_$#]*))?)/gi;
  const structuralSql = maskStringLiterals(sql);
  let match;
  while ((match = pattern.exec(structuralSql)) !== null) {
    const parts = match[1].split('.').map(normalizeIdentifier);
    references.push({
      schema: parts.length === 2 ? parts[0] : null,
      object: parts.at(-1),
      index: match.index,
    });
  }
  return references;
}

function hasCommaSeparatedTableSources(sql) {
  const sourceTerminators = new Set([
    'CONNECT',
    'FETCH',
    'GROUP',
    'HAVING',
    'INTERSECT',
    'MATCH_RECOGNIZE',
    'MINUS',
    'MODEL',
    'OFFSET',
    'ORDER',
    'START',
    'UNION',
    'WHERE',
  ]);
  const activeFromDepths = new Set();
  const sqlWithoutStringLiterals = maskStringLiterals(sql);
  const tokens = sqlWithoutStringLiterals.matchAll(/\b[A-Z][A-Z0-9_$#]*\b|[(),]/gi);
  let depth = 0;

  for (const match of tokens) {
    const token = match[0].toUpperCase();
    if (token === '(') {
      depth += 1;
      continue;
    }
    if (token === ')') {
      activeFromDepths.delete(depth);
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (token === ',') {
      if (activeFromDepths.has(depth)) return true;
      continue;
    }
    if (token === 'FROM') {
      activeFromDepths.add(depth);
      continue;
    }
    if (activeFromDepths.has(depth) && sourceTerminators.has(token)) {
      activeFromDepths.delete(depth);
    }
  }

  return false;
}

function validateReadOnlySql(value, {
  allowedObjects = DEFAULT_ALLOWED_OBJECTS,
  allowedSchema = 'APP_USER',
} = {}) {
  const sql = stripSqlFence(value);
  if (!sql) {
    throw new NativeAiError('Select AI did not generate SQL.', {
      category: 'SQL_GENERATION_FAILED',
      statusCode: 422,
    });
  }
  if (sql.length > 100_000) {
    throw new NativeAiError('Generated SQL exceeds the allowed size.', {
      category: 'SQL_VALIDATION_BLOCKED',
      statusCode: 400,
    });
  }
  if (!/^(?:SELECT|WITH)\b/i.test(sql)) {
    throw new NativeAiError('Only a single SELECT or WITH query is allowed.', {
      category: 'SQL_VALIDATION_BLOCKED',
      statusCode: 400,
    });
  }
  if (sql.includes(';')) {
    throw new NativeAiError('Multiple SQL statements are not allowed.', {
      category: 'SQL_VALIDATION_BLOCKED',
      statusCode: 400,
    });
  }
  for (const blocked of BLOCKED_SQL_PATTERNS) {
    if (blocked.pattern.test(sql)) {
      throw new NativeAiError(blocked.reason, {
        category: 'SQL_VALIDATION_BLOCKED',
        statusCode: 400,
      });
    }
  }
  if (hasCommaSeparatedTableSources(sql)) {
    throw new NativeAiError('Comma-separated table sources are not allowed; use explicit joins.', {
      category: 'SQL_VALIDATION_BLOCKED',
      statusCode: 400,
    });
  }
  const appRoutinePattern = new RegExp(`"?(?:${BLOCKED_APP_ROUTINES.join('|')})"?\\s*\\(`, 'i');
  if (appRoutinePattern.test(sql)) {
    throw new NativeAiError('Application routines are not allowed in generated SQL.', {
      category: 'SQL_VALIDATION_BLOCKED',
      statusCode: 400,
    });
  }
  const safeFunctions = new Set(SAFE_SQL_FUNCTIONS);
  const sqlConstructs = new Set(['AS', 'EXISTS', 'IN', 'OVER', 'VALUES']);
  const sqlWithoutStringLiterals = maskStringLiterals(sql);
  const functionCalls = sqlWithoutStringLiterals.matchAll(/\b"?([A-Z][A-Z0-9_$#]*)"?\s*\(/gi);
  for (const match of functionCalls) {
    const functionName = normalizeIdentifier(match[1]);
    if (!safeFunctions.has(functionName) && !sqlConstructs.has(functionName)) {
      throw new NativeAiError(`Function ${functionName} is not in the read-only SQL allowlist.`, {
        category: 'SQL_VALIDATION_BLOCKED',
        statusCode: 400,
      });
    }
  }
  if (/\b(?:"?[A-Z][A-Z0-9_$#]*"?)\s*\.\s*(?:"?[A-Z][A-Z0-9_$#]*"?)\s*\(/i.test(sql)) {
    throw new NativeAiError('Package-qualified function calls are not allowed.', {
      category: 'SQL_VALIDATION_BLOCKED',
      statusCode: 400,
    });
  }

  const allowed = new Set([...allowedObjects].map(normalizeIdentifier));
  const schema = normalizeIdentifier(allowedSchema);
  const ctes = collectCteDefinitions(sql);
  const references = collectReferencedObjects(sql);
  if (!references.length) {
    throw new NativeAiError('Generated SQL does not reference an approved finance object.', {
      category: 'SQL_VALIDATION_BLOCKED',
      statusCode: 400,
    });
  }

  let approvedBaseReferenceCount = 0;
  for (const reference of references) {
    if (reference.schema && reference.schema !== schema) {
      throw new NativeAiError(`Schema ${reference.schema} is not allowed.`, {
        category: 'SQL_VALIDATION_BLOCKED',
        statusCode: 400,
      });
    }
    const cteDefinition = ctes.get(reference.object);
    const isVisibleCte = Boolean(
      cteDefinition && reference.index > cteDefinition.closeIndex
    );
    if (!allowed.has(reference.object) && !isVisibleCte) {
      throw new NativeAiError(`Object ${reference.object} is not in the governed finance allowlist.`, {
        category: 'SQL_VALIDATION_BLOCKED',
        statusCode: 400,
      });
    }
    if (allowed.has(reference.object)) approvedBaseReferenceCount += 1;
  }
  if (approvedBaseReferenceCount === 0) {
    throw new NativeAiError('Generated SQL does not reference an approved finance object.', {
      category: 'SQL_VALIDATION_BLOCKED',
      statusCode: 400,
    });
  }

  return sql;
}

function readinessIsExplicitlyReady(payload) {
  const state = String(payload?.status || payload?.state || '').toUpperCase();
  return payload?.ready === true && state === 'READY';
}

function compactConversation(history, maxTurns = 6) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-maxTurns)
    .map((turn) => ({
      role: String(turn?.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user',
      text: String(turn?.text || turn?.content || '').trim().slice(0, 2000),
    }))
    .filter((turn) => turn.text);
}

function normalizeConversationId(value) {
  const conversationId = String(value || '').trim().toUpperCase();
  if (!/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(conversationId)) {
    throw new NativeAiError('The Select AI conversation identifier is invalid.', {
      category: 'INVALID_CONVERSATION',
      statusCode: 400,
    });
  }
  return conversationId;
}

function createNativeAiService({
  database = defaultDatabase,
  env = process.env,
  now = () => Date.now(),
} = {}) {
  const profile = envValue(env, ['SELECT_AI_PROFILE'], DEFAULT_PROFILE).toUpperCase();
  const model = envValue(env, ['OCI_GENAI_MODEL', 'OCI_GENAI_MODEL_ID'], DEFAULT_MODEL);
  const region = envValue(env, ['OCI_GENAI_REGION'], DEFAULT_REGION);
  const allowedSchema = envValue(env, ['SELECT_AI_SCHEMA', 'ORACLE_USER'], 'APP_USER').toUpperCase();
  const teams = parseCsv(env.SELECT_AI_AGENT_TEAMS, DEFAULT_TEAMS);
  const primaryTeam = envValue(
    env,
    ['SELECT_AI_PRIMARY_AGENT_TEAM'],
    'FINANCE_OPERATIONS_TEAM'
  ).toUpperCase();
  const allowedObjects = parseCsv(env.SELECT_AI_ALLOWED_OBJECTS, DEFAULT_ALLOWED_OBJECTS);
  const callTimeout = boundedTimeout(env.SELECT_AI_CALL_TIMEOUT_MS, 180_000);
  const agentCallTimeout = boundedTimeout(
    env.SELECT_AI_AGENT_CALL_TIMEOUT_MS,
    300_000
  );
  const agentStateCallTimeout = boundedTimeout(
    env.SELECT_AI_AGENT_STATE_CALL_TIMEOUT_MS,
    30_000
  );
  const readinessTtl = Math.max(5_000, Number.parseInt(env.SELECT_AI_READINESS_TTL_MS || '60000', 10));
  const maxRows = Math.min(500, Math.max(1, Number.parseInt(env.SELECT_AI_MAX_ROWS || '100', 10)));

  let readinessCache = null;
  let readinessPromise = null;

  function normalizeProfile(requestedProfile) {
    const requested = String(requestedProfile || profile).trim().toUpperCase();
    if (requested !== profile) {
      throw new NativeAiError('The requested Select AI profile is not available.', {
        category: 'AI_PROFILE_UNAVAILABLE',
        statusCode: 400,
      });
    }
    return profile;
  }

  function normalizeTeam(requestedTeam) {
    const team = String(requestedTeam || '').trim().toUpperCase();
    if (!teams.includes(team)) {
      throw new NativeAiError('The requested Select AI Agent team is not available.', {
        category: 'AI_AGENT_UNAVAILABLE',
        statusCode: 400,
      });
    }
    return team;
  }
  normalizeTeam(primaryTeam);

  function getProfileEvidence() {
    return {
      name: profile,
      label: 'OCI Generative AI',
      model,
      provider: 'OCI Generative AI',
      region,
      status: 'ENABLED',
      type: 'ADB 26ai Select AI',
      description: 'Native APP_USER Select AI profile with a curated finance object scope.',
      readOnly: true,
    };
  }

  function getTeamCatalog() {
    return teams.map((teamName) => ({
      TEAM_NAME: teamName,
      STATUS: 'ENABLED',
      PROVIDER: 'OCI Generative AI',
      PROFILE_NAME: profile,
      READ_ONLY: true,
      ADVISORY: true,
    }));
  }

  async function createConversation(title = null) {
    const safeTitle = title == null ? null : String(title).trim().slice(0, 200);
    try {
      const result = await database.execute(
        `SELECT FINANCE_NATIVE_AI_PKG.CREATE_CONVERSATION(
                  p_title => :title
                ) AS response
           FROM dual`,
        { title: safeTitle || null },
        { callTimeout }
      );
      return normalizeConversationId(extractScalar(result));
    } catch (error) {
      if (error instanceof NativeAiError) throw error;
      throw new NativeAiError('ADB Select AI could not create a conversation.', {
        category: 'NATIVE_AI_CONVERSATION_UNAVAILABLE',
        cause: error,
      });
    }
  }

  async function resolveConversationId(conversationId) {
    return conversationId
      ? normalizeConversationId(conversationId)
      : createConversation();
  }

  async function getAgentTeamState(team, conversationId) {
    const resolvedTeam = normalizeTeam(team);
    const resolvedConversationId = normalizeConversationId(conversationId);
    try {
      const result = await database.execute(
        `SELECT FINANCE_NATIVE_AI_PKG.GET_TEAM_STATE(
                  p_team_name       => :team_name,
                  p_conversation_id => :conversation_id
                ) AS response
           FROM dual`,
        {
          team_name: resolvedTeam,
          conversation_id: resolvedConversationId,
        },
        { callTimeout: agentStateCallTimeout }
      );
      const state = String(extractScalar(result) || '').trim().toUpperCase();
      if (!NATIVE_AGENT_STATES.includes(state)) {
        throw new NativeAiError('ADB Select AI Agent returned an invalid team state.', {
          category: 'NATIVE_AI_INVALID_RESPONSE',
          conversationId: resolvedConversationId,
          team: resolvedTeam,
          state: state || null,
        });
      }
      return state;
    } catch (error) {
      if (error instanceof NativeAiError) throw error;
      throw new NativeAiError('ADB Select AI Agent state could not be verified.', {
        category: 'AI_AGENT_STATE_UNAVAILABLE',
        cause: error,
        conversationId: resolvedConversationId,
        team: resolvedTeam,
      });
    }
  }

  async function generateText(action, prompt, {
    requestedProfile = profile,
    conversationId = null,
  } = {}) {
    const resolvedProfile = normalizeProfile(requestedProfile);
    const normalizedAction = String(action || '').trim().toUpperCase();
    if (!['CHAT', 'SHOWSQL'].includes(normalizedAction)) {
      throw new NativeAiError('Unsupported Select AI action.', {
        category: 'SELECT_AI_ACTION_BLOCKED',
        statusCode: 400,
      });
    }
    const userPrompt = String(prompt || '').trim();
    if (!userPrompt) {
      throw new NativeAiError('A question is required.', {
        category: 'INVALID_REQUEST',
        statusCode: 400,
      });
    }
    if (userPrompt.length > MAX_NATIVE_PROMPT_CHARS) {
      throw new NativeAiError('The Select AI prompt exceeds the supported size.', {
        category: 'INVALID_REQUEST',
        statusCode: 400,
      });
    }

    try {
      const result = await database.execute(
        `SELECT FINANCE_NATIVE_AI_PKG.GENERATE_TEXT(
                  p_action          => :action,
                  p_prompt          => :prompt,
                  p_profile_name    => :profile,
                  p_conversation_id => :conversation_id
                ) AS response
           FROM dual`,
        {
          action: normalizedAction,
          prompt: userPrompt,
          profile: resolvedProfile,
          conversation_id: conversationId || null,
        },
        { callTimeout }
      );
      const response = extractScalar(result);
      if (response == null || !String(response).trim()) {
        throw new NativeAiError('Select AI returned an empty response.', {
          category: 'NATIVE_AI_INVALID_RESPONSE',
        });
      }
      return String(response);
    } catch (error) {
      if (error instanceof NativeAiError) throw error;
      throw new NativeAiError('ADB Select AI could not complete the request.', {
        category: 'NATIVE_AI_UNAVAILABLE',
        cause: error,
      });
    }
  }

  async function generateQuestionSql(question, {
    requestedProfile = profile,
    conversationId = null,
  } = {}) {
    const resolvedConversationId = await resolveConversationId(conversationId);
    const rawSql = await generateText('SHOWSQL', question, {
      requestedProfile,
      conversationId: resolvedConversationId,
    });
    const sql = validateReadOnlySql(rawSql, { allowedObjects, allowedSchema });
    return {
      sql,
      action: 'SHOWSQL',
      profile,
      model,
      region,
      provider: 'OCI Generative AI',
      readOnly: true,
      conversationId: resolvedConversationId,
    };
  }

  async function runQuestionQuery(question, {
    demoUser = null,
    requestedProfile = profile,
    conversationId = null,
  } = {}) {
    const generated = await generateQuestionSql(question, {
      requestedProfile,
      conversationId,
    });
    try {
      const result = await database.executeAsUser(
        generated.sql,
        {},
        demoUser,
        { maxRows, callTimeout }
      );
      const columns = (result.metaData || []).map((column) => column.name);
      const rows = result.rows || [];
      return {
        ...generated,
        action: 'RUNSQL',
        columns: columns.length ? columns : Object.keys(rows[0] || {}),
        rows,
        rowCount: rows.length,
        truncated: rows.length >= maxRows,
      };
    } catch (error) {
      throw new NativeAiError('Oracle could not execute the validated Select AI query.', {
        category: 'ORACLE_QUERY_FAILED',
        statusCode: 422,
        cause: error,
        sql: generated.sql,
      });
    }
  }

  async function answerQuestion(question, {
    mode = 'narrate',
    demoUser = null,
    requestedProfile = profile,
    conversationId = null,
  } = {}) {
    const queryResult = await runQuestionQuery(question, {
      demoUser,
      requestedProfile,
      conversationId,
    });
    const resultRows = queryResult.rows.slice(0, 25);
    const boundedResultJson = truncateForPrompt(JSON.stringify({
      columns: queryResult.columns,
      rows: resultRows,
      rowCount: queryResult.rowCount,
      truncated: queryResult.truncated || queryResult.rows.length > resultRows.length,
    }), MAX_NARRATIVE_RESULT_CHARS);
    const answerPrompt = buildBoundedPrompt([
      String(mode).toLowerCase() === 'chat'
        ? 'Answer the finance follow-up conversationally.'
        : 'Write a concise finance operations explanation.',
      'Use only the validated, VPD-filtered database result supplied below.',
      'Do not invent values, perform actions, or claim that a recommendation was executed.',
      `Original question: ${truncateForPrompt(question, MAX_NARRATIVE_QUESTION_CHARS)}`,
      `Validated SQL excerpt: ${truncateForPrompt(queryResult.sql, MAX_NARRATIVE_SQL_CHARS)}`,
      `Bounded query result: ${boundedResultJson}`,
    ]);
    const answer = await generateText('CHAT', answerPrompt, {
      requestedProfile,
      conversationId: queryResult.conversationId,
    });
    return {
      answer,
      sql: queryResult.sql,
      action: 'CHAT',
      profile,
      model,
      region,
      provider: 'OCI Generative AI',
      readOnly: true,
      columns: queryResult.columns,
      rowCount: queryResult.rowCount,
      truncated: queryResult.truncated,
      referencedData: {
        columns: queryResult.columns,
        row_count: queryResult.rowCount,
      },
      conversationId: queryResult.conversationId,
    };
  }

  async function runAgentTeam(question, {
    requestedTeam = null,
    conversationId = null,
    history = [],
    demoUser = null,
  } = {}) {
    const userPrompt = String(question || '').trim();
    if (!userPrompt) {
      throw new NativeAiError('A question is required.', {
        category: 'INVALID_REQUEST',
        statusCode: 400,
      });
    }
    if (userPrompt.length > 8_000) {
      throw new NativeAiError('The question is too long.', {
        category: 'INVALID_REQUEST',
        statusCode: 400,
      });
    }
    const resolvedTeam = normalizeTeam(requestedTeam || primaryTeam);
    const resolvedConversationId = await resolveConversationId(conversationId);
    const suppliedHistory = compactConversation(history);
    const recent = conversationId ? [] : suppliedHistory;
    const boundedHistory = truncateForPrompt(JSON.stringify(recent), MAX_AGENT_HISTORY_CHARS);
    const priorUserQuestions = suppliedHistory
      .filter((turn) => turn.role === 'user')
      .slice(-3);
    const groundingQuestion = priorUserQuestions.length
      ? buildBoundedPrompt([
        'Ground the current finance request in current governed database evidence.',
        `Current request: ${truncateForPrompt(userPrompt, MAX_AGENT_QUESTION_CHARS)}`,
        `Prior user questions for resolving names and pronouns: ${truncateForPrompt(
          JSON.stringify(priorUserQuestions),
          MAX_AGENT_HISTORY_CHARS
        )}`,
        'Use prior questions only to resolve references. Generate evidence for the current request.',
      ])
      : userPrompt;
    const queryResult = await runQuestionQuery(groundingQuestion, {
      demoUser,
      requestedProfile: profile,
      conversationId: resolvedConversationId,
    });
    const evidenceRows = queryResult.rows.slice(0, MAX_AGENT_RESULT_ROWS);
    const boundedEvidence = truncateForPrompt(JSON.stringify({
      columns: queryResult.columns,
      rows: evidenceRows,
      rowCount: queryResult.rowCount,
      truncated: queryResult.truncated || queryResult.rows.length > evidenceRows.length,
    }), MAX_AGENT_RESULT_CHARS);
    const prompt = buildBoundedPrompt([
      'Provide an advisory, read-only finance operations response.',
      'Do not perform transactions, change records, contact clients, or claim that an action was executed.',
      'The application already generated, validated, and executed exactly one governed read-only query.',
      'No database tool is attached to this task. Use only the supplied evidence and do not request another query.',
      `Request: ${truncateForPrompt(userPrompt, MAX_AGENT_QUESTION_CHARS)}`,
      recent.length ? `Recent conversation excerpt: ${boundedHistory}` : '',
      `Validated SQL excerpt: ${truncateForPrompt(queryResult.sql, MAX_AGENT_SQL_CHARS)}`,
      `Bounded VPD-filtered evidence: ${boundedEvidence}`,
    ]);

    try {
      const result = await database.executeAsUser(
        `SELECT FINANCE_NATIVE_AI_PKG.RUN_AGENT(
                  p_team_name       => :team_name,
                  p_prompt          => :prompt,
                  p_conversation_id => :conversation_id
                ) AS response
           FROM dual`,
        {
          team_name: resolvedTeam,
          prompt,
          conversation_id: resolvedConversationId,
        },
        demoUser,
        { callTimeout: agentCallTimeout }
      );
      const response = extractScalar(result);
      if (response == null || !String(response).trim()) {
        throw new NativeAiError('Select AI Agent returned an empty response.', {
          category: 'NATIVE_AI_INVALID_RESPONSE',
          conversationId: resolvedConversationId,
          team: resolvedTeam,
        });
      }
      const state = await getAgentTeamState(resolvedTeam, resolvedConversationId);
      if (state === 'WAITING_FOR_HUMAN') {
        throw new NativeAiError('ADB Select AI Agent is waiting for human input.', {
          category: 'AI_AGENT_WAITING_FOR_HUMAN',
          statusCode: 409,
          conversationId: resolvedConversationId,
          team: resolvedTeam,
          state,
        });
      }
      if (state !== 'SUCCEEDED') {
        throw new NativeAiError('ADB Select AI Agent did not reach a successful terminal state.', {
          category: 'AI_AGENT_INCOMPLETE',
          conversationId: resolvedConversationId,
          team: resolvedTeam,
          state,
        });
      }
      return {
        response: String(response),
        team: resolvedTeam,
        conversationId: resolvedConversationId,
        action: 'RUN_TEAM',
        state,
        profile,
        model,
        region,
        provider: 'OCI Generative AI',
        package: 'DBMS_CLOUD_AI_AGENT',
        contextApplied: Boolean(conversationId || recent.length),
        contextProvider: conversationId ? 'adb-select-ai-agent' : (recent.length ? 'request-history' : 'none'),
        advisory: true,
        readOnly: true,
        grounding: {
          action: 'SHOWSQL + VPD SELECT',
          rowCount: queryResult.rowCount,
          columns: queryResult.columns,
          truncated: queryResult.truncated || queryResult.rows.length > evidenceRows.length,
          vpdFiltered: true,
        },
        agentToolsUsed: [],
        executionSteps: [
          {
            step: 'FINANCE_NATIVE_AI_PKG.GENERATE_TEXT(SHOWSQL)',
            status: 'success',
            access: 'read-only',
          },
          {
            step: 'APP_USER VPD SELECT',
            status: 'success',
            access: 'read-only',
          },
          {
            step: 'DBMS_CLOUD_AI_AGENT.RUN_TEAM',
            team: resolvedTeam,
            status: 'success',
            access: 'read-only',
          },
        ],
      };
    } catch (error) {
      if (error instanceof NativeAiError) throw error;
      let lastKnownState = null;
      try {
        lastKnownState = await getAgentTeamState(resolvedTeam, resolvedConversationId);
      } catch {
        // The original native-agent error remains authoritative.
      }
      const timedOut = isAgentTimeoutError(error);
      throw new NativeAiError(
        timedOut
          ? 'ADB Select AI Agent exceeded the bounded execution time.'
          : 'ADB Select AI Agent could not complete the request.',
        {
          category: timedOut ? 'AI_AGENT_TIMEOUT' : 'AI_AGENT_UNAVAILABLE',
          statusCode: timedOut ? 504 : 503,
          cause: error,
          conversationId: resolvedConversationId,
          team: resolvedTeam,
          state: lastKnownState,
        }
      );
    }
  }

  async function loadReadiness() {
    try {
      const result = await database.execute(
        'SELECT FINANCE_NATIVE_AI_PKG.READINESS_JSON AS readiness FROM dual',
        {},
        { callTimeout }
      );
      const payload = parseJson(extractScalar(result), 'Native AI readiness');
      if (!readinessIsExplicitlyReady(payload)) {
        throw new NativeAiError('ADB native AI bootstrap has not reached READY state.', {
          category: 'NATIVE_AI_NOT_READY',
        });
      }
      return {
        ...payload,
        ready: true,
        status: 'healthy',
        profile,
        model,
        region,
        provider: 'OCI Generative AI',
        teams,
        readOnly: true,
        checkedAt: new Date(now()).toISOString(),
      };
    } catch (error) {
      if (error instanceof NativeAiError) throw error;
      throw new NativeAiError('ADB native AI readiness could not be verified.', {
        category: 'NATIVE_AI_NOT_READY',
        cause: error,
      });
    }
  }

  async function checkReadiness({ force = false } = {}) {
    if (!force && readinessCache && now() - readinessCache.cachedAt < readinessTtl) {
      return readinessCache.value;
    }
    if (readinessPromise) return readinessPromise;
    readinessPromise = loadReadiness()
      .then((value) => {
        readinessCache = { value, cachedAt: now() };
        return value;
      })
      .finally(() => {
        readinessPromise = null;
      });
    return readinessPromise;
  }

  function invalidateReadinessCache() {
    readinessCache = null;
  }

  return {
    DEFAULT_PROFILE: profile,
    answerQuestion,
    checkReadiness,
    createConversation,
    generateQuestionSql,
    generateText,
    getAgentTeamState,
    getProfileEvidence,
    getTeamCatalog,
    invalidateReadinessCache,
    normalizeProfile,
    normalizeTeam,
    resolveConversationId,
    runAgentTeam,
    runQuestionQuery,
    validateReadOnlySql: (sql) => validateReadOnlySql(sql, { allowedObjects, allowedSchema }),
  };
}

const defaultService = createNativeAiService();

module.exports = {
  BLOCKED_APP_ROUTINES,
  DEFAULT_ALLOWED_OBJECTS,
  DEFAULT_MODEL,
  DEFAULT_PROFILE,
  DEFAULT_REGION,
  DEFAULT_TEAMS,
  MAX_NATIVE_PROMPT_CHARS,
  NativeAiError,
  SAFE_SQL_FUNCTIONS,
  buildBoundedPrompt,
  createNativeAiService,
  normalizeConversationId,
  truncateForPrompt,
  validateReadOnlySql,
  ...defaultService,
};
