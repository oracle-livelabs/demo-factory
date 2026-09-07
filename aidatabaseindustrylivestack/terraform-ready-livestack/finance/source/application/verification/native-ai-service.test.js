'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const inertDatabase = {
  execute: async () => {
    throw new Error('Unexpected default database call');
  },
  executeAsUser: async () => {
    throw new Error('Unexpected default VPD database call');
  },
};

const originalLoad = Module._load;
Module._load = function loadWithDatabaseStub(request, parent, isMain) {
  if (request === '../config/database' && parent?.filename?.endsWith(path.join('lib', 'nativeAiService.js'))) {
    return inertDatabase;
  }
  return originalLoad.call(this, request, parent, isMain);
};
const nativeAi = require('../backend/lib/nativeAiService');
Module._load = originalLoad;

const EXACT_CURATED_VIEWS = [
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
];
const CONVERSATION_ID = '30C9DB6E-EA4D-AFBA-E063-9C6D46644B92';

function sqlBlocked(sql, options) {
  assert.throws(
    () => nativeAi.validateReadOnlySql(sql, options),
    (error) => error.category === 'SQL_VALIDATION_BLOCKED'
  );
}

test('generated-SQL policy exposes exactly the 12 curated profile views', () => {
  assert.deepEqual([...nativeAi.DEFAULT_ALLOWED_OBJECTS].sort(), [...EXACT_CURATED_VIEWS].sort());
  assert.equal(nativeAi.DEFAULT_ALLOWED_OBJECTS.includes('DUAL'), false);
  assert.equal(nativeAi.DEFAULT_ALLOWED_OBJECTS.includes('ORDERS'), false);
  assert.equal(nativeAi.DEFAULT_ALLOWED_OBJECTS.includes('AGENT_ACTIONS'), false);
});

test('generated-SQL policy accepts a single curated SELECT and ordinary CTE', () => {
  assert.equal(
    nativeAi.validateReadOnlySql(
      'SELECT institution_name FROM finance_institutions_v FETCH FIRST 5 ROWS ONLY'
    ),
    'SELECT institution_name FROM finance_institutions_v FETCH FIRST 5 ROWS ONLY'
  );
  assert.equal(
    nativeAi.validateReadOnlySql(
      'SELECT COUNT(*) AS rows_seen, SUM(signal_linked_value) AS exposure FROM finance_transaction_exposure_v'
    ).includes('COUNT(*)'),
    true
  );
  assert.equal(
    nativeAi.validateReadOnlySql(
      `WITH exposed AS (
         SELECT institution_name, signal_linked_value
           FROM app_user.finance_transaction_exposure_v
       )
       SELECT institution_name, SUM(signal_linked_value) AS exposure
         FROM exposed
        GROUP BY institution_name`
    ).startsWith('WITH exposed'),
    true
  );
});

test('generated-SQL policy rejects base tables, DUAL, other schemas, and links', () => {
  sqlBlocked('SELECT * FROM orders');
  sqlBlocked('SELECT 1 FROM dual');
  sqlBlocked('SELECT * FROM admin.finance_institutions_v');
  sqlBlocked('SELECT * FROM finance_institutions_v@remote_db');
  sqlBlocked('SELECT * FROM finance_institutions_v, app_users');
  sqlBlocked(
    'SELECT * FROM (SELECT * FROM finance_institutions_v) approved_rows, customers'
  );
});

test('generated-SQL policy rejects APPLY table-source bypasses', () => {
  for (const sql of [
    'SELECT * FROM FINANCE_INSTITUTIONS_V f CROSS APPLY APP_USERS u',
    'SELECT * FROM FINANCE_INSTITUTIONS_V f OUTER APPLY APP_USERS u',
  ]) {
    assert.throws(
      () => nativeAi.validateReadOnlySql(sql),
      (error) => error.category === 'SQL_VALIDATION_BLOCKED'
        && /APPLY/i.test(error.message)
    );
  }
});

test('generated-SQL policy rejects CTE-name shadowing of a base object', () => {
  assert.throws(
    () => nativeAi.validateReadOnlySql(
      'WITH APP_USERS AS (SELECT * FROM APP_USERS) SELECT * FROM APP_USERS'
    ),
    (error) => error.category === 'SQL_VALIDATION_BLOCKED'
      && /APP_USERS/i.test(error.message)
  );
});

test('generated-SQL policy ignores fake CTE syntax inside string literals', () => {
  assert.throws(
    () => nativeAi.validateReadOnlySql(
      "SELECT 'WITH APP_USERS AS (' || ')' AS txt "
      + 'FROM FINANCE_INSTITUTIONS_V f JOIN APP_USERS u ON 1=1'
    ),
    (error) => error.category === 'SQL_VALIDATION_BLOCKED'
      && /APP_USERS/i.test(error.message)
  );
});

test('generated-SQL policy rejects Oracle alternative quoting', () => {
  assert.throws(
    () => nativeAi.validateReadOnlySql(
      "SELECT q'[x' WITH APP_USERS AS ( )]' AS txt "
      + 'FROM FINANCE_INSTITUTIONS_V f JOIN APP_USERS u ON 1=1'
    ),
    (error) => error.category === 'SQL_VALIDATION_BLOCKED'
      && /alternative-quoted/i.test(error.message)
  );
});

test('generated-SQL policy rejects multiple statements and write operations', () => {
  sqlBlocked('SELECT * FROM finance_institutions_v; DELETE FROM orders');
  sqlBlocked('WITH changed AS (DELETE FROM orders RETURNING order_id) SELECT * FROM changed');
  sqlBlocked('SELECT * FROM finance_institutions_v FOR UPDATE');
});

test('generated-SQL policy rejects WITH functions and package-qualified calls', () => {
  sqlBlocked(
    `WITH FUNCTION leak RETURN NUMBER IS
       BEGIN
         RETURN 1;
       END;
     SELECT leak() FROM finance_institutions_v`
  );
  sqlBlocked('SELECT app_user.side_effect() FROM finance_institutions_v');
  sqlBlocked('SELECT finance_mutation_pkg.apply_change() FROM finance_institutions_v');
});

test('generated-SQL policy rejects side-effecting and loader-created APP_USER routines', () => {
  sqlBlocked(
    `SELECT log_agent_decision(
       'agent', 'type', 'entity', 1, '{"changed":true}', 1
     )
     FROM finance_institutions_v`
  );
  sqlBlocked('SELECT detect_trending_products(24, 75) FROM risk_signals_v');
  sqlBlocked('SELECT find_best_fulfillment(1, 1, 1) FROM service_routes_v');
  sqlBlocked('SELECT "LOG_AGENT_DECISION"(1) FROM finance_institutions_v');
  sqlBlocked('SELECT agent_action_seq.nextval FROM finance_institutions_v');
  sqlBlocked('SELECT unknown_side_effect() FROM finance_institutions_v');
  assert.equal(nativeAi.BLOCKED_APP_ROUTINES.includes('LOG_AGENT_DECISION'), true);
});
test('conversation IDs must have the Oracle-generated identifier shape', () => {
  assert.equal(nativeAi.normalizeConversationId(CONVERSATION_ID), CONVERSATION_ID);
  assert.throws(
    () => nativeAi.normalizeConversationId('client-supplied-random-id'),
    (error) => error.category === 'INVALID_CONVERSATION'
  );
});

test('SHOWSQL calls the APP_USER wrapper and validates its result', async () => {
  const calls = [];
  const database = {
    execute: async (sql, binds, options) => {
      calls.push({ sql, binds, options });
      if (/CREATE_CONVERSATION/.test(sql)) {
        return { rows: [{ RESPONSE: CONVERSATION_ID }] };
      }
      return { rows: [{ RESPONSE: 'SELECT * FROM finance_products_v;' }] };
    },
    executeAsUser: async () => assert.fail('SHOWSQL must not execute generated SQL'),
  };
  const service = nativeAi.createNativeAiService({ database, env: {} });
  const result = await service.generateQuestionSql('show products');

  assert.equal(result.sql, 'SELECT * FROM finance_products_v');
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /FINANCE_NATIVE_AI_PKG\.CREATE_CONVERSATION/);
  assert.match(calls[1].sql, /FINANCE_NATIVE_AI_PKG\.GENERATE_TEXT/);
  assert.equal(calls[1].binds.action, 'SHOWSQL');
  assert.equal(calls[1].binds.profile, 'FINANCE_SELECTAI_V1');
  assert.equal(calls[1].binds.conversation_id, CONVERSATION_ID);
  assert.equal(result.conversationId, CONVERSATION_ID);
});

test('RUNSQL executes only the validated SQL on the selected VPD connection', async () => {
  const generatedSql = 'SELECT institution_name FROM finance_institutions_v';
  const calls = [];
  const database = {
    execute: async (sql, binds) => {
      if (/CREATE_CONVERSATION/.test(sql)) {
        calls.push({ kind: 'conversation' });
        return { rows: [{ RESPONSE: CONVERSATION_ID }] };
      }
      calls.push({ kind: 'generate', binds });
      return { rows: [{ RESPONSE: generatedSql }] };
    },
    executeAsUser: async (sql, binds, demoUser, options) => {
      calls.push({ kind: 'execute', sql, binds, demoUser, options });
      return {
        metaData: [{ name: 'INSTITUTION_NAME' }],
        rows: [{ INSTITUTION_NAME: 'Seer Bank' }],
      };
    },
  };
  const service = nativeAi.createNativeAiService({ database, env: { SELECT_AI_MAX_ROWS: '25' } });
  const result = await service.runQuestionQuery('show institutions', { demoUser: 'regional_maya' });

  assert.equal(result.sql, generatedSql);
  assert.deepEqual(result.rows, [{ INSTITUTION_NAME: 'Seer Bank' }]);
  assert.equal(calls[2].demoUser, 'regional_maya');
  assert.equal(calls[2].options.maxRows, 25);
});

test('narrative path uses SHOWSQL, VPD-scoped execution, then native CHAT over bounded rows', async () => {
  const actions = [];
  const database = {
    execute: async (sql, binds) => {
      if (/CREATE_CONVERSATION/.test(sql)) {
        actions.push('CREATE_CONVERSATION');
        return { rows: [{ RESPONSE: CONVERSATION_ID }] };
      }
      actions.push(binds.action);
      if (binds.action === 'SHOWSQL') {
        return { rows: [{ RESPONSE: 'SELECT * FROM finance_service_pressure_v' }] };
      }
      assert.equal(binds.action, 'CHAT');
      assert.match(binds.prompt, /VPD-filtered database result/);
      assert.match(binds.prompt, /CENTRE_A/);
      return { rows: [{ RESPONSE: 'Centre A has the highest current SLA pressure.' }] };
    },
    executeAsUser: async (_sql, _binds, demoUser) => {
      actions.push(`VPD:${demoUser}`);
      return {
        metaData: [{ name: 'SERVICE_CENTER_NAME' }],
        rows: [{ SERVICE_CENTER_NAME: 'CENTRE_A' }],
      };
    },
  };
  const service = nativeAi.createNativeAiService({ database, env: {} });
  const result = await service.answerQuestion('Where is SLA pressure highest?', {
    demoUser: 'regional_maya',
    mode: 'narrate',
  });

  assert.deepEqual(actions, ['CREATE_CONVERSATION', 'SHOWSQL', 'VPD:regional_maya', 'CHAT']);
  assert.equal(result.action, 'CHAT');
  assert.equal(result.rowCount, 1);
  assert.match(result.answer, /Centre A/);
});

test('narrative prompt stays below the wrapper limit without truncating executed SQL', async () => {
  const question = 'q'.repeat(8_000);
  const generatedSql = `SELECT ${' '.repeat(20_000)}* FROM finance_transaction_exposure_v`;
  let executedSql = null;
  let chatPrompt = null;
  const database = {
    execute: async (sql, binds) => {
      if (/CREATE_CONVERSATION/.test(sql)) {
        return { rows: [{ RESPONSE: CONVERSATION_ID }] };
      }
      if (binds.action === 'SHOWSQL') {
        return { rows: [{ RESPONSE: generatedSql }] };
      }
      chatPrompt = binds.prompt;
      return { rows: [{ RESPONSE: 'Bounded native narrative.' }] };
    },
    executeAsUser: async (sql) => {
      executedSql = sql;
      return {
        metaData: [{ name: 'EVIDENCE' }],
        rows: [{ EVIDENCE: 'x'.repeat(20_000) }],
      };
    },
  };
  const service = nativeAi.createNativeAiService({ database, env: {} });
  await service.answerQuestion(question, { demoUser: 'regional_maya' });

  assert.equal(executedSql, generatedSql);
  assert.ok(chatPrompt.length <= nativeAi.MAX_NATIVE_PROMPT_CHARS);
  assert.match(chatPrompt, /\[context truncated\]/);
});

test('generic agent chat grounds once, runs the native supervisor, and verifies terminal state', async () => {
  const calls = [];
  const database = {
    execute: async (sql, binds, options) => {
      if (/CREATE_CONVERSATION/.test(sql)) {
        calls.push({ kind: 'conversation', sql, binds, options });
        return { rows: [{ RESPONSE: CONVERSATION_ID }] };
      }
      if (/GENERATE_TEXT/.test(sql)) {
        calls.push({ kind: 'showsql', sql, binds, options });
        assert.equal(binds.action, 'SHOWSQL');
        return { rows: [{ RESPONSE: 'SELECT * FROM finance_transaction_exposure_v' }] };
      }
      assert.match(sql, /FINANCE_NATIVE_AI_PKG\.GET_TEAM_STATE/);
      calls.push({ kind: 'state', sql, binds, options });
      return { rows: [{ RESPONSE: 'SUCCEEDED' }] };
    },
    executeAsUser: async (sql, binds, demoUser, options) => {
      if (/FINANCE_NATIVE_AI_PKG\.RUN_AGENT/.test(sql)) {
        calls.push({ kind: 'agent', sql, binds, demoUser, options });
        return { rows: [{ RESPONSE: 'Advisory response from the native supervisor.' }] };
      }
      calls.push({ kind: 'grounding-query', sql, binds, demoUser, options });
      return {
        metaData: [{ name: 'PRODUCT_NAME' }, { name: 'EXPOSURE' }],
        rows: [{ PRODUCT_NAME: 'Escrow Account Service', EXPOSURE: 42 }],
      };
    },
  };
  const service = nativeAi.createNativeAiService({ database, env: {} });
  const result = await service.runAgentTeam('Review current exposure.', {
    demoUser: 'regional_maya',
  });

  assert.deepEqual(
    calls.map((call) => call.kind),
    ['conversation', 'showsql', 'grounding-query', 'agent', 'state']
  );
  assert.equal(calls[2].demoUser, 'regional_maya');
  assert.match(calls[3].sql, /FINANCE_NATIVE_AI_PKG\.RUN_AGENT/);
  assert.equal(calls[3].binds.team_name, 'FINANCE_OPERATIONS_TEAM');
  assert.equal(calls[3].binds.conversation_id, CONVERSATION_ID);
  assert.equal(calls[3].demoUser, 'regional_maya');
  assert.equal(calls[3].options.callTimeout, 300_000);
  assert.match(calls[3].binds.prompt, /No database tool is attached/);
  assert.match(calls[3].binds.prompt, /Escrow Account Service/);
  assert.equal(calls[4].binds.team_name, 'FINANCE_OPERATIONS_TEAM');
  assert.equal(calls[4].binds.conversation_id, CONVERSATION_ID);
  assert.equal(calls[4].options.callTimeout, 30_000);
  assert.equal(result.package, 'DBMS_CLOUD_AI_AGENT');
  assert.equal(result.state, 'SUCCEEDED');
  assert.equal(result.grounding.action, 'SHOWSQL + VPD SELECT');
  assert.equal(result.grounding.rowCount, 1);
  assert.equal(result.grounding.vpdFiltered, true);
  assert.deepEqual(result.agentToolsUsed, []);
  assert.deepEqual(
    result.executionSteps.map((stage) => stage.step),
    [
      'FINANCE_NATIVE_AI_PKG.GENERATE_TEXT(SHOWSQL)',
      'APP_USER VPD SELECT',
      'DBMS_CLOUD_AI_AGENT.RUN_TEAM',
    ]
  );
  assert.equal(result.readOnly, true);
  assert.equal(result.advisory, true);
});

test('first-turn agent prompt bounds question, history, SQL, and governed evidence', async () => {
  let agentPrompt = null;
  let generatedQueryExecutions = 0;
  const database = {
    execute: async (sql) => {
      if (/CREATE_CONVERSATION/.test(sql)) {
        return { rows: [{ RESPONSE: CONVERSATION_ID }] };
      }
      if (/GENERATE_TEXT/.test(sql)) {
        return {
          rows: [{
            RESPONSE: `SELECT ${' '.repeat(5_000)}* FROM finance_transaction_exposure_v`,
          }],
        };
      }
      assert.match(sql, /FINANCE_NATIVE_AI_PKG\.GET_TEAM_STATE/);
      return { rows: [{ RESPONSE: 'SUCCEEDED' }] };
    },
    executeAsUser: async (sql, binds) => {
      if (/FINANCE_NATIVE_AI_PKG\.RUN_AGENT/.test(sql)) {
        agentPrompt = binds.prompt;
        return { rows: [{ RESPONSE: 'Bounded native advisory.' }] };
      }
      generatedQueryExecutions += 1;
      return {
        metaData: [{ name: 'EVIDENCE' }],
        rows: Array.from({ length: 30 }, () => ({ EVIDENCE: 'x'.repeat(1_000) })),
      };
    },
  };
  const service = nativeAi.createNativeAiService({ database, env: {} });
  await service.runAgentTeam('q'.repeat(8_000), {
    demoUser: 'regional_maya',
    history: Array.from({ length: 6 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      text: `${index}:${'h'.repeat(2_000)}`,
    })),
  });

  assert.equal(generatedQueryExecutions, 1);
  assert.ok(agentPrompt.length <= nativeAi.MAX_NATIVE_PROMPT_CHARS);
  assert.match(agentPrompt, /Request: q+/);
  assert.match(agentPrompt, /Bounded VPD-filtered evidence/);
  assert.match(agentPrompt, /\[context truncated\]/);
});

test('agent follow-up reuses one Oracle conversation for grounding, RUN_TEAM, and state', async () => {
  let createCalls = 0;
  const calls = [];
  const database = {
    execute: async (sql, binds) => {
      if (/CREATE_CONVERSATION/.test(sql)) {
        createCalls += 1;
      }
      if (/GENERATE_TEXT/.test(sql)) {
        calls.push({ kind: 'showsql', binds });
        return { rows: [{ RESPONSE: 'SELECT * FROM risk_signals_v' }] };
      }
      if (/GET_TEAM_STATE/.test(sql)) {
        calls.push({ kind: 'state', binds });
        return { rows: [{ RESPONSE: 'SUCCEEDED' }] };
      }
      return { rows: [{ RESPONSE: CONVERSATION_ID }] };
    },
    executeAsUser: async (sql, binds) => {
      if (/RUN_AGENT/.test(sql)) {
        calls.push({ kind: 'agent', binds });
        return { rows: [{ RESPONSE: 'Follow-up advisory.' }] };
      }
      calls.push({ kind: 'query' });
      return { metaData: [{ name: 'SEVERITY' }], rows: [{ SEVERITY: 'Critical' }] };
    },
  };
  const service = nativeAi.createNativeAiService({ database, env: {} });
  const result = await service.runAgentTeam('What about it now?', {
    requestedTeam: 'SOCIAL_TREND_TEAM',
    conversationId: CONVERSATION_ID.toLowerCase(),
    demoUser: 'regional_maya',
    history: [
      { role: 'user', text: 'Assess risk signals for Escrow Account Service.' },
      { role: 'assistant', text: 'Assistant-only narrative must not enter SQL grounding.' },
    ],
  });

  assert.equal(createCalls, 0);
  assert.equal(result.conversationId, CONVERSATION_ID);
  assert.equal(result.contextProvider, 'adb-select-ai-agent');
  for (const call of calls.filter((entry) => entry.binds)) {
    assert.equal(call.binds.conversation_id, CONVERSATION_ID);
  }
  const showSqlPrompt = calls.find((entry) => entry.kind === 'showsql').binds.prompt;
  assert.match(showSqlPrompt, /Current request: What about it now\?/);
  assert.match(showSqlPrompt, /Assess risk signals for Escrow Account Service/);
  assert.doesNotMatch(showSqlPrompt, /Assistant-only narrative/);
});

test('agent timeout is classified distinctly and preserves last known native state', async () => {
  const timeout = Object.assign(new Error('NJS-123: call timeout of 300000 ms exceeded'), {
    code: 'NJS-123',
  });
  const database = {
    execute: async (sql) => {
      if (/CREATE_CONVERSATION/.test(sql)) {
        return { rows: [{ RESPONSE: CONVERSATION_ID }] };
      }
      if (/GENERATE_TEXT/.test(sql)) {
        return { rows: [{ RESPONSE: 'SELECT * FROM risk_signals_v' }] };
      }
      return { rows: [{ RESPONSE: 'RUNNING' }] };
    },
    executeAsUser: async (sql) => {
      if (/RUN_AGENT/.test(sql)) throw timeout;
      return { metaData: [{ name: 'SEVERITY' }], rows: [{ SEVERITY: 'Critical' }] };
    },
  };
  const service = nativeAi.createNativeAiService({ database, env: {} });

  await assert.rejects(
    service.runAgentTeam('Review current risks.', {
      requestedTeam: 'SOCIAL_TREND_TEAM',
      demoUser: 'regional_maya',
    }),
    (error) => error.category === 'AI_AGENT_TIMEOUT'
      && error.statusCode === 504
      && error.conversationId === CONVERSATION_ID
      && error.team === 'SOCIAL_TREND_TEAM'
      && error.state === 'RUNNING'
  );
});

test('agent response fails closed when native team state is not successful', async () => {
  const database = {
    execute: async (sql) => {
      if (/CREATE_CONVERSATION/.test(sql)) {
        return { rows: [{ RESPONSE: CONVERSATION_ID }] };
      }
      if (/GENERATE_TEXT/.test(sql)) {
        return { rows: [{ RESPONSE: 'SELECT * FROM risk_signals_v' }] };
      }
      return { rows: [{ RESPONSE: 'FAILED' }] };
    },
    executeAsUser: async (sql) => {
      if (/RUN_AGENT/.test(sql)) {
        return { rows: [{ RESPONSE: 'Untrusted nonterminal response.' }] };
      }
      return { metaData: [{ name: 'SEVERITY' }], rows: [{ SEVERITY: 'Critical' }] };
    },
  };
  const service = nativeAi.createNativeAiService({ database, env: {} });

  await assert.rejects(
    service.runAgentTeam('Review current risks.', {
      requestedTeam: 'SOCIAL_TREND_TEAM',
      demoUser: 'regional_maya',
    }),
    (error) => error.category === 'AI_AGENT_INCOMPLETE'
      && error.state === 'FAILED'
  );
});

test('missing native response fails closed without a substitute answer', async () => {
  const database = {
    execute: async (sql) => (/CREATE_CONVERSATION/.test(sql)
      ? { rows: [{ RESPONSE: CONVERSATION_ID }] }
      : { rows: [{ RESPONSE: null }] }),
    executeAsUser: async () => assert.fail('No SQL should execute after an empty native response'),
  };
  const service = nativeAi.createNativeAiService({ database, env: {} });

  await assert.rejects(
    service.generateQuestionSql('show exposure'),
    (error) => error.category === 'NATIVE_AI_INVALID_RESPONSE'
  );
});

test('caller-provided Oracle conversation is reused without creating another one', async () => {
  let createCalls = 0;
  const database = {
    execute: async (sql, binds) => {
      if (/CREATE_CONVERSATION/.test(sql)) createCalls += 1;
      assert.equal(binds.conversation_id, CONVERSATION_ID);
      return { rows: [{ RESPONSE: 'SELECT * FROM risk_signals_v' }] };
    },
    executeAsUser: async () => assert.fail('SHOWSQL must not execute rows'),
  };
  const service = nativeAi.createNativeAiService({ database, env: {} });
  const result = await service.generateQuestionSql('show risks', {
    conversationId: CONVERSATION_ID.toLowerCase(),
  });

  assert.equal(result.conversationId, CONVERSATION_ID);
  assert.equal(createCalls, 0);
});

test('readiness requires an explicit ready state and is cached only after success', async () => {
  let payload = '{"ready":false,"status":"READY"}';
  let calls = 0;
  const database = {
    execute: async () => {
      calls += 1;
      return { rows: [{ READINESS: payload }] };
    },
    executeAsUser: async () => assert.fail('Readiness must not execute user SQL'),
  };
  const service = nativeAi.createNativeAiService({ database, env: {} });
  await assert.rejects(
    service.checkReadiness(),
    (error) => error.category === 'NATIVE_AI_NOT_READY'
  );

  payload = '{"ready":true,"status":"READY"}';
  const ready = await service.checkReadiness();
  assert.equal(ready.ready, true);
  await service.checkReadiness();
  assert.equal(calls, 2);
});
