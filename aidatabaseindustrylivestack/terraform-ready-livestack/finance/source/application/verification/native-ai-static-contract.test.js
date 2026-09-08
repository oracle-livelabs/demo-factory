'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const applicationRoot = path.resolve(__dirname, '..');
const sourceRoots = [
  path.join(applicationRoot, 'backend'),
  path.join(applicationRoot, 'frontend', 'src'),
  path.join(applicationRoot, 'Containerfile'),
  path.join(applicationRoot, 'package.json'),
];
const forbiddenRuntimeName = ['olla', 'ma'].join('');
const oldDirectProvider = ['direct', 'tools'].join('-');

function walk(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  });
}

test('application runtime contains no legacy local-model or direct-tool provider path', () => {
  const violations = [];
  for (const file of sourceRoots.flatMap(walk)) {
    const text = fs.readFileSync(file, 'utf8').toLowerCase();
    if (text.includes(forbiddenRuntimeName) || text.includes(oldDirectProvider)) {
      violations.push(path.relative(applicationRoot, file));
    }
  }
  assert.deepEqual(violations, []);
  assert.equal(fs.existsSync(path.join(applicationRoot, 'backend', 'lib', `${forbiddenRuntimeName}Assistant.js`)), false);
});

test('native routes use APP_USER wrappers and main health gates native readiness', () => {
  const service = fs.readFileSync(path.join(applicationRoot, 'backend', 'lib', 'nativeAiService.js'), 'utf8');
  const server = fs.readFileSync(path.join(applicationRoot, 'backend', 'server.js'), 'utf8');
  const selectAiRoute = fs.readFileSync(path.join(applicationRoot, 'backend', 'routes', 'selectai.js'), 'utf8');
  const agentRoute = fs.readFileSync(path.join(applicationRoot, 'backend', 'routes', 'agents.js'), 'utf8');

  assert.match(service, /FINANCE_NATIVE_AI_PKG\.GENERATE_TEXT/);
  assert.match(service, /FINANCE_NATIVE_AI_PKG\.RUN_AGENT/);
  assert.match(service, /FINANCE_NATIVE_AI_PKG\.GET_TEAM_STATE/);
  assert.match(service, /FINANCE_NATIVE_AI_PKG\.READINESS_JSON/);
  assert.match(service, /FINANCE_NATIVE_AI_PKG\.CREATE_CONVERSATION/);
  assert.match(service, /database\.executeAsUser\(\s*generated\.sql/);
  assert.match(service, /database\.executeAsUser\(\s*`SELECT FINANCE_NATIVE_AI_PKG\.RUN_AGENT/);
  assert.match(service, /No database tool is attached to this task/);
  assert.match(service, /SELECT_AI_AGENT_CALL_TIMEOUT_MS/);
  assert.match(service, /SELECT_AI_AGENT_STATE_CALL_TIMEOUT_MS/);
  assert.match(service, /SHOWSQL \+ VPD SELECT/);
  assert.match(service, /agentToolsUsed:\s*\[\]/);
  assert.match(service, /executionSteps:/);
  assert.doesNotMatch(service, /toolsUsed:/);
  assert.doesNotMatch(service, /state:\s*'SUCCEEDED'/);
  assert.match(server, /nativeAi\.checkReadiness\(\)/);
  assert.match(selectAiRoute, /ready:\s*true/);
  assert.doesNotMatch(selectAiRoute, /conversationId[^\n]*randomUUID/);
  assert.match(agentRoute, /advisory:\s*true/);
  assert.match(agentRoute, /FROM user_ai_agent_team_history/);
  assert.match(agentRoute, /FROM user_ai_agent_tool_history/);
  assert.doesNotMatch(agentRoute, /ELSE 'SUCCEEDED'/);
  assert.doesNotMatch(agentRoute, /conversationId[^\n]*randomUUID/);
  for (const removedSymbol of [
    ['fallback', 'Result'].join(''),
    ['fallback', 'Data'].join(''),
    ['ask', 'Agent'].join(''),
  ]) {
    assert.equal(agentRoute.includes(removedSymbol), false);
  }
});

test('Agent Console sends and preserves explicit native specialist team routing', () => {
  const agentConsole = fs.readFileSync(
    path.join(applicationRoot, 'frontend', 'src', 'pages', 'AgentConsole.jsx'),
    'utf8'
  );
  const financeStory = fs.readFileSync(
    path.join(applicationRoot, 'frontend', 'src', 'components', 'FinanceStory.jsx'),
    'utf8'
  );
  const api = fs.readFileSync(
    path.join(applicationRoot, 'frontend', 'src', 'utils', 'api.js'),
    'utf8'
  );
  const compose = fs.readFileSync(path.join(applicationRoot, 'compose.yml'), 'utf8');

  for (const team of ['SOCIAL_TREND_TEAM', 'FULFILLMENT_TEAM', 'COMMERCE_TEAM']) {
    assert.match(agentConsole, new RegExp(`team: '${team}'`));
  }
  assert.match(agentConsole, /const \[activeTeam, setActiveTeam\] = useState\(null\)/);
  assert.match(agentConsole, /activeTeam \|\| requestedTeam/);
  assert.match(agentConsole, /setActiveTeam\(result\.team\)/);
  assert.match(agentConsole, /sendMessage\(eq\.text, eq\.team\)/);
  assert.match(agentConsole, /No attached tools/);
  assert.match(agentConsole, /msg\.executionSteps/);
  assert.doesNotMatch(agentConsole, /msg\.toolsUsed/);
  assert.doesNotMatch(agentConsole, /specialists can call only FINANCE_READONLY_SQL_TOOL/);
  assert.match(financeStory, /tool-free DBMS_CLOUD_AI_AGENT specialist team/);
  assert.doesNotMatch(financeStory, /through one VPD-scoped, read-only SQL tool/);
  assert.match(api, /JSON\.stringify\(\{ question, history, conversationId, team \}\)/);
  assert.match(compose, /SELECT_AI_AGENT_CALL_TIMEOUT_MS:[\s\S]*300000/);
  assert.match(compose, /SELECT_AI_AGENT_STATE_CALL_TIMEOUT_MS:[\s\S]*30000/);
});

test('Select AI metadata declares the exact 12 curated views', () => {
  const route = fs.readFileSync(path.join(applicationRoot, 'backend', 'routes', 'selectai.js'), 'utf8');
  const declaredObjects = [...route.matchAll(/schemaObject\('([a-z0-9_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(declaredObjects.sort(), [
    'client_transactions_v',
    'finance_fraud_case_exposure_v',
    'finance_institutions_v',
    'finance_products_v',
    'finance_service_pressure_v',
    'finance_signal_product_exposure_v',
    'finance_transaction_exposure_v',
    'risk_signals_v',
    'service_capacity_v',
    'service_centers_v',
    'service_routes_v',
    'signal_sources_v',
  ].sort());
});

test('native conversations reset when the unauthenticated demo user changes', () => {
  const askData = fs.readFileSync(
    path.join(applicationRoot, 'frontend', 'src', 'pages', 'AskData.jsx'),
    'utf8'
  );
  const agentConsole = fs.readFileSync(
    path.join(applicationRoot, 'frontend', 'src', 'pages', 'AgentConsole.jsx'),
    'utf8'
  );

  assert.match(askData, /const\s+demoUsername\s*=\s*currentUser\?\.USERNAME/);
  assert.match(
    askData,
    /useEffect\(\(\)\s*=>\s*\{[\s\S]*?setMessages\(\[\]\)[\s\S]*?setConversationId\(null\)[\s\S]*?\},\s*\[demoUsername\]\)/
  );
  assert.match(agentConsole, /key=\{currentUser\?\.USERNAME\s*\|\|\s*'no-demo-user'\}/);
  assert.match(askData, /unauthenticated demo control/);
  assert.match(agentConsole, /unauthenticated demo control/);
});

test('pooled database sessions establish and scrub an explicit VPD context', () => {
  const database = fs.readFileSync(
    path.join(applicationRoot, 'backend', 'config', 'database.js'),
    'utf8'
  );
  const loader = fs.readFileSync(
    path.join(applicationRoot, 'deployment', 'finance-platform-handoff-loader.sql'),
    'utf8'
  );
  const server = fs.readFileSync(
    path.join(applicationRoot, 'backend', 'server.js'),
    'utf8'
  );
  const importWorkflow = fs.readFileSync(
    path.join(applicationRoot, 'backend', 'lib', 'importWorkflowService.js'),
    'utf8'
  );
  const datasetState = fs.readFileSync(
    path.join(applicationRoot, 'backend', 'lib', 'datasetStateStore.js'),
    'utf8'
  );

  assert.match(database, /sc_security_ctx\.clear_user_context/);
  assert.match(database, /await establishDemoContext\(connection, null, \{ serviceDefault: true \}\)/);
  assert.match(database, /const effectiveUsername = normalizeDemoUsername\(username\)/);
  assert((database.match(/await scrubAndClose\(connection\);/g) || []).length >= 4);
  assert.doesNotMatch(database, /username\s*\|\|\s*'admin_jess'/);
  assert.match(server, /req\.demoUser\s*=\s*suppliedDemoUser\s*\|\|\s*'admin_jess'/);
  assert.match(server, /The demo user header is invalid/);
  assert.doesNotMatch(database, /module\.exports\s*=\s*\{[\s\S]*?\bgetConnection,/);
  assert.match(importWorkflow, /db\.getServiceConnection\(\)/);
  assert.match(importWorkflow, /db\.releaseConnection\(connection\)/);
  assert.match(datasetState, /db\.getServiceConnection\(\)/);
  assert.match(datasetState, /db\.releaseConnection\(connection\)/);

  assert.match(loader, /PROCEDURE clear_user_context;/i);
  assert.match(loader, /g_role\s+VARCHAR2\(30\)\s*:=\s*'none'/i);
  assert.match(loader, /Unknown or inactive demo user context/i);
  assert((loader.match(/RETURN '1=0';/g) || []).length >= 5);
});
