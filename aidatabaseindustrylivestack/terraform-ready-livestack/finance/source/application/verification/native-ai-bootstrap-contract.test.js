'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const sqlPath = path.resolve(
  __dirname,
  '..',
  'deployment',
  'finance-native-ai-bootstrap.sql'
);
const bootstrapPath = path.resolve(
  __dirname,
  '..',
  'deployment',
  'bootstrap-finance-adb.sh'
);
const loaderPath = path.resolve(
  __dirname,
  '..',
  'deployment',
  'finance-platform-handoff-loader.sql'
);
const sql = fs.readFileSync(sqlPath, 'utf8');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');

function position(text) {
  const offset = sql.indexOf(text);
  assert.notEqual(offset, -1, `Missing contract text: ${text}`);
  return offset;
}

function shellFunction(name, nextMarker) {
  const start = bootstrap.indexOf(`${name}() {`);
  const end = bootstrap.indexOf(`\n}\n\n${nextMarker}`, start);
  assert.notEqual(start, -1, `Missing shell function: ${name}`);
  assert.notEqual(end, -1, `Missing end of shell function: ${name}`);
  return bootstrap.slice(start, end + 3);
}

test('reload teardown excludes generated index internals before the fail-closed scan', () => {
  for (const generatedPrefix of [
    "DR$%",
    "DM$%",
    "MDRT_%",
    "VECTOR$%",
    "BIN$%",
    "DBTOOLS$%",
    "OML$%",
  ]) {
    assert.match(
      loader,
      new RegExp(`object_name NOT LIKE '${generatedPrefix.replace('$', '\\$')}'`)
    );
  }
  assert.match(bootstrap, /Skipped \.\*ORA-\[0-9\]\{5\}/);
});

test('ADMIN grants DBMS_CLOUD exactly once before APP_USER credential creation', () => {
  const directGrants = [
    ...bootstrap.matchAll(
      /^\s*GRANT EXECUTE ON DBMS_CLOUD TO APP_USER;\s*$/gim
    ),
  ];
  assert.equal(directGrants.length, 1);

  const grant = directGrants[0].index;
  const dropCredential = bootstrap.indexOf('DBMS_CLOUD.DROP_CREDENTIAL(');
  const createCredential = bootstrap.indexOf('DBCC CREATE FIN_GENAI_KEY_V1');
  const ready = bootstrap.indexOf('FINANCE_OCI_CREDENTIAL_READY');

  assert.notEqual(dropCredential, -1);
  assert.notEqual(createCredential, -1);
  assert.notEqual(ready, -1);
  assert(grant < dropCredential);
  assert(dropCredential < createCredential);
  assert(createCredential < ready);
});

test('native AI retries bounded fresh-key and ADB connectivity failures', () => {
  assert.match(
    bootstrap,
    /run_sql_phase\s+\\\s+"native-ai"\s+\\\s+"\$\{native_ai_driver\}"\s+\\\s+"FINANCE_NATIVE_AI_ACCEPTANCE_OK"\s+\\\s+"adb_connectivity_or_genai_api_key_propagation"/
  );
  assert.match(bootstrap, /is_transient_adb_connectivity_failure\(\)/);
  assert.match(bootstrap, /retry_database_connectivity=1/);
  assert.match(bootstrap, /retry_genai_authorization=1/);
  assert.match(bootstrap, /ORA-17868: Unknown host specified\\\./);
  assert.match(bootstrap, /max_attempts=61/);
  assert.match(bootstrap, /retry_delay_seconds=10/);
  assert.match(bootstrap, /max_attempts=31/);
  assert.match(bootstrap, /retry_delay_seconds=30/);
  assert.match(bootstrap, /transient_count == 1 && unexpected == 0/);
  assert.match(bootstrap, /\.oci\.my\$cloud_domain\/20231130\/actions\/chat/);
  assert.match(bootstrap, /\.oci\.oraclecloud\.com\/20231130\/actions\/chat/);
  assert.match(bootstrap, /line !~ \/\^ORA-06512:\//);
  assert.match(bootstrap, /\^\(PLS-\[0-9\]\{5\}\|SP2-\[0-9\]\{4\}\):/);
  assert.match(
    bootstrap,
    /is_transient_genai_authorization_failure "\$\{output\}"/
  );
  assert.match(
    bootstrap,
    /retrying native acceptance in \$\{retry_delay_seconds\}s/
  );
  assert.match(
    bootstrap,
    /Unsupported SQLcl retry mode for phase \$\{phase\}/
  );
  assert.match(
    bootstrap,
    /Autonomous Database DNS is not ready; retrying SQLcl phase \$\{phase\}/
  );
});

test('native AI retry fault matrix is exact, bounded, and fail-closed', () => {
  const classifier = shellFunction(
    'is_transient_genai_authorization_failure',
    'run_sql_phase() {'
  );
  const runner = shellFunction('run_sql_phase', 'bootstrap_driver=');
  const harness = String.raw`
set -u
OCI_GENAI_REGION=us-chicago-1
LOG_ROOT="$1"
WALLET_ARCHIVE="$1/wallet.zip"
CALLS_FILE="$1/calls"
SLEEPS_FILE="$1/sleeps"
SCENARIO="$2"
printf '0\n' >"$CALLS_FILE"
printf '0\n' >"$SLEEPS_FILE"
: >"$WALLET_ARCHIVE"

log() { :; }
fail() { exit 99; }

sql() {
  local call_count
  local internal_error='ORA-20401: Authorization failed for URI - https://inference.generativeai.us-chicago-1.oci.my$cloud_domain/20231130/actions/chat'
  call_count="$(cat "$CALLS_FILE")"
  call_count=$((call_count + 1))
  printf '%s\n' "$call_count" >"$CALLS_FILE"

  case "$SCENARIO" in
    transient_then_success)
      if [[ "$call_count" -gt 1 ]]; then
        printf '%s\n' 'FINANCE_NATIVE_AI_ACCEPTANCE_OK'
        return 0
      fi
      printf '%s\n' "$internal_error" 'ORA-06512: at line 140'
      return 177
      ;;
    split_then_success)
      if [[ "$call_count" -gt 1 ]]; then
        printf '%s\n' 'FINANCE_NATIVE_AI_ACCEPTANCE_OK'
        return 0
      fi
      printf '%s\n' \
        'ORA-20401: Authorization failed for URI -' \
        'https://inference.generativeai.us-chicago-1.oci.my$cloud_domain/20231130/actions/chat' \
        'ORA-06512: at line 140'
      return 177
      ;;
    always_transient)
      printf '%s\n' "$internal_error" 'ORA-06512: at line 140'
      return 177
      ;;
    ordinary)
      printf '%s\n' 'ORA-00942: table or view does not exist'
      return 1
      ;;
    mixed)
      printf '%s\n' \
        "$internal_error" \
        'ORA-06512: at line 140' \
        'ORA-00942: table or view does not exist'
      return 177
      ;;
    evil_host)
      printf '%s\n' \
        'ORA-20401: Authorization failed for URI - https://inference.generativeai.us-chicago-1.oci.evil.example/20231130/actions/chat'
      return 177
      ;;
    wrong_region)
      printf '%s\n' \
        'ORA-20401: Authorization failed for URI - https://inference.generativeai.eu-frankfurt-1.oci.oraclecloud.com/20231130/actions/chat'
      return 177
      ;;
    duplicate)
      printf '%s\n' "$internal_error" "$internal_error"
      return 177
      ;;
    pls_error)
      printf '%s\n' "$internal_error" 'PLS-00201: identifier must be declared'
      return 177
      ;;
    sqlcl_error)
      printf '%s\n' "$internal_error" 'SQLcl: Error opening connection'
      return 177
      ;;
    missing_marker)
      printf '%s\n' 'SQL completed without the required marker'
      return 0
      ;;
    *)
      return 2
      ;;
  esac
}

sleep() {
  local sleep_count
  sleep_count="$(cat "$SLEEPS_FILE")"
  printf '%s\n' "$((sleep_count + 1))" >"$SLEEPS_FILE"
}

${classifier}

${runner}

driver="$1/driver.sql"
: >"$driver"
run_sql_phase \
  "native-ai" \
  "$driver" \
  "FINANCE_NATIVE_AI_ACCEPTANCE_OK" \
  "genai_api_key_propagation"
`;

  const cases = [
    ['transient_then_success', 0, 2, 1],
    ['split_then_success', 0, 2, 1],
    ['always_transient', 99, 31, 30],
    ['ordinary', 99, 1, 0],
    ['mixed', 99, 1, 0],
    ['evil_host', 99, 1, 0],
    ['wrong_region', 99, 1, 0],
    ['duplicate', 99, 1, 0],
    ['pls_error', 99, 1, 0],
    ['sqlcl_error', 99, 1, 0],
    ['missing_marker', 99, 1, 0],
  ];

  for (const [scenario, expectedStatus, expectedCalls, expectedSleeps] of cases) {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `finance-native-ai-${scenario}-`)
    );
    try {
      const result = spawnSync(
        'bash',
        ['-c', harness, 'bash', tempDir, scenario],
        { encoding: 'utf8' }
      );
      assert.equal(
        result.status,
        expectedStatus,
        `${scenario}: ${result.stdout}\n${result.stderr}`
      );
      assert.equal(
        Number(fs.readFileSync(path.join(tempDir, 'calls'), 'utf8').trim()),
        expectedCalls,
        `${scenario}: SQL call count`
      );
      assert.equal(
        Number(fs.readFileSync(path.join(tempDir, 'sleeps'), 'utf8').trim()),
        expectedSleeps,
        `${scenario}: sleep count`
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test('loader and final validation establish explicit VPD context before protected reads', () => {
  const loaderContext = loader.indexOf(
    "sc_security_ctx.set_user_context('admin_jess');"
  );
  const generatedArtifacts = loader.indexOf(
    'BEGIN INCLUDED FILE: loader-sql/32_deterministic_generated_artifacts.sql'
  );
  const signalEmbeddingInsert = loader.indexOf(
    'INSERT INTO signal_embeddings',
    generatedArtifacts
  );
  const schemaCompile = loader.indexOf(
    'DBMS_UTILITY.COMPILE_SCHEMA(schema => USER, compile_all => FALSE);'
  );
  const refreshedLoaderContext = loader.indexOf(
    "sc_security_ctx.set_user_context('admin_jess');",
    schemaCompile
  );
  const finalEvidence = loader.indexOf(
    "SELECT 'finance workshop deterministic load complete' AS status"
  );
  const loaderAcceptance = loader.indexOf(
    "DBMS_OUTPUT.PUT_LINE('FINANCE_HANDOFF_DATA_ACCEPTANCE_OK');",
    finalEvidence
  );
  const loaderClear = loader.indexOf(
    'sc_security_ctx.clear_user_context;',
    finalEvidence
  );
  const loaderMarker = loader.indexOf(
    'PROMPT FINANCE_HANDOFF_LOADER_COMPLETE',
    finalEvidence
  );

  assert(loaderContext > 0);
  assert(loaderContext < generatedArtifacts);
  assert(generatedArtifacts < signalEmbeddingInsert);
  assert(signalEmbeddingInsert < schemaCompile);
  assert(schemaCompile < refreshedLoaderContext);
  assert(refreshedLoaderContext < finalEvidence);
  assert(finalEvidence < loaderAcceptance);
  assert(loaderAcceptance < loaderClear);
  assert(loaderClear < loaderMarker);
  assert.equal(
    (loader.match(/sc_security_ctx\.set_user_context\('admin_jess'\);/gi) || [])
      .length,
    2
  );

  const validationStart = bootstrap.indexOf(
    'validation_driver="${work_dir}/validation.sql"'
  );
  const validationContext = bootstrap.indexOf(
    "sc_security_ctx.set_user_context('admin_jess');",
    validationStart
  );
  const firstProtectedRead = bootstrap.indexOf(
    "require_exact_rows('ORDERS', 3000);",
    validationStart
  );
  const validationClear = bootstrap.indexOf(
    'sc_security_ctx.clear_user_context;',
    validationStart
  );
  const validationMarker = bootstrap.indexOf(
    "DBMS_OUTPUT.PUT_LINE('FINANCE_ADB_ACCEPTANCE_OK');",
    validationStart
  );

  assert(validationStart > 0);
  assert(validationStart < validationContext);
  assert(validationContext < firstProtectedRead);
  assert(firstProtectedRead < validationClear);
  assert(validationClear < validationMarker);
  assert.match(
    bootstrap.slice(validationStart),
    /EXCEPTION\s+WHEN OTHERS THEN\s+sc_security_ctx\.clear_user_context;\s+RAISE;/i
  );

  for (const [table, expected] of [
    ['APP_USERS', 7],
    ['PRODUCTS', 79],
    ['ORDERS', 3000],
    ['ORDER_ITEMS', 8913],
    ['SOCIAL_POSTS', 5000],
    ['FRAUD_ENTITIES', 25],
    ['PRODUCT_EMBEDDINGS', 79],
    ['SIGNAL_EMBEDDINGS', 5000],
    ['SEMANTIC_MATCHES', 1599],
  ]) {
    const pattern = new RegExp(
      `require_exact_rows\\('${table}',\\s*${expected}\\);`,
      'i'
    );
    assert.match(loader, pattern);
    assert.match(bootstrap.slice(validationStart), pattern);
  }
});

test('profile uses OCI Cohere with fixed database credential and explicit compartment/region/model', () => {
  assert.match(sql, /'provider'\s+VALUE\s+'oci'/i);
  assert.match(sql, /'credential_name'\s+VALUE\s+'FIN_GENAI_KEY_V1'/i);
  assert.match(sql, /'region'\s+VALUE\s+l_region/i);
  assert.match(sql, /'model'\s+VALUE\s+l_model/i);
  assert.match(sql, /'oci_compartment_id'\s+VALUE\s+l_compartment/i);
  assert.match(sql, /'oci_apiformat'\s+VALUE\s+'COHERE'/i);
  assert.match(sql, /'enforce_object_list'\s+VALUE\s+'true'\s+FORMAT JSON/i);
  assert.doesNotMatch(sql, /oci_endpoint_id/i);
});

test('profile scope contains only the twelve curated Finance views', () => {
  const expectedViews = [
    'FINANCE_INSTITUTIONS_V',
    'FINANCE_PRODUCTS_V',
    'RISK_SIGNALS_V',
    'SIGNAL_SOURCES_V',
    'CLIENT_TRANSACTIONS_V',
    'SERVICE_CENTERS_V',
    'SERVICE_CAPACITY_V',
    'SERVICE_ROUTES_V',
    'FINANCE_SIGNAL_PRODUCT_EXPOSURE_V',
    'FINANCE_TRANSACTION_EXPOSURE_V',
    'FINANCE_SERVICE_PRESSURE_V',
    'FINANCE_FRAUD_CASE_EXPOSURE_V',
  ];
  for (const view of expectedViews) {
    assert.match(sql, new RegExp(`'name'\\s+VALUE\\s+'${view}'`, 'i'));
  }
  assert.doesNotMatch(sql, /'name'\s+VALUE\s+'(?:APP_USERS|USER_CREDENTIALS|AGENT_ACTIONS)'/i);
});

test('agent tasks are tool-free while the direct validation SQL tool remains advisory/read-only', () => {
  const createWorkerStart = position('PROCEDURE create_worker');
  const createWorkerEnd = sql.indexOf('END create_worker;', createWorkerStart);
  assert.notEqual(createWorkerEnd, -1);
  const createWorkerBody = sql.slice(createWorkerStart, createWorkerEnd);

  assert.match(sql, /'tool_type'\s+VALUE\s+'SQL'/i);
  assert.doesNotMatch(createWorkerBody, /'tools'\s+VALUE/i);
  assert.match(sql, /'enable_human_tool'\s+VALUE\s+'false'\s+FORMAT JSON/i);
  assert.match(sql, /No database tool is attached to this task/i);
  assert.match(sql, /Use only the governed, VPD-filtered evidence embedded in the request/i);
  assert.match(sql, /evidence is insufficient, state what a human should retrieve/i);
  assert.match(sql, /deliberately not attached to advisory agent tasks/i);
  assert.match(sql, /Delegate to exactly one specialist/i);
  assert.match(sql, /Never modify data/i);
  assert.match(sql, /advisory findings/i);
  assert.doesNotMatch(sql, /'tool_type'\s+VALUE\s+'(?:NOTIFICATION|WEBSEARCH|RAG)'/i);
});

test('wrapper package exposes the stable native AI application contract', () => {
  assert.match(sql, /CREATE OR REPLACE PACKAGE finance_native_ai_pkg AUTHID DEFINER/i);
  assert.match(sql, /FUNCTION readiness_json RETURN CLOB/i);
  assert.match(sql, /FUNCTION is_safe_sql\(/i);
  assert.match(
    sql,
    /FUNCTION create_conversation\(\s*p_title IN VARCHAR2 DEFAULT NULL\s*\) RETURN VARCHAR2/i
  );
  assert.match(sql, /FUNCTION generate_text\(/i);
  assert.match(sql, /FUNCTION run_agent\(/i);
  assert.match(sql, /FUNCTION get_team_state\(/i);
  assert.match(sql, /DBMS_CLOUD_AI_AGENT\.GET_TEAM_STATE\(/i);
  assert.match(sql, /FUNCTION managed_team\(/i);
  assert.match(sql, /l_team IS NULL[\s\S]*LENGTH\(l_team\) > 128/i);
  assert.match(sql, /'RESUMING'/i);
  assert.match(sql, /l_action NOT IN \('CHAT', 'SHOWSQL'\)/i);
  assert.match(sql, /c_operations_team CONSTANT VARCHAR2\(128\) := 'FINANCE_OPERATIONS_TEAM'/i);
  assert.match(sql, /'supervisor_agent'\s+VALUE\s+'FIN_OPERATIONS_SUPERVISOR'/i);
  assert.match(sql, /'supervisor'\s+VALUE\s+'true'\s+FORMAT JSON/i);
  const readinessStart = position('FUNCTION readiness_json RETURN CLOB IS');
  const readinessEnd = sql.indexOf('END readiness_json;', readinessStart);
  const readinessBody = sql.slice(readinessStart, readinessEnd);
  assert.doesNotMatch(readinessBody, /'compartmentOcid'\s+VALUE/i);
  assert.doesNotMatch(readinessBody, /'credentialName'\s+VALUE/i);
  assert.doesNotMatch(readinessBody, /'error'\s+VALUE[\s\S]*l_state\.last_error/i);
  const conversationBodyStart = position(
    'FUNCTION create_conversation(\n    p_title IN VARCHAR2 DEFAULT NULL\n  ) RETURN VARCHAR2 IS'
  );
  const conversationBodyEnd = sql.indexOf(
    'END create_conversation;',
    conversationBodyStart
  );
  const conversationBody = sql.slice(conversationBodyStart, conversationBodyEnd);
  assert.match(conversationBody, /assert_ready;/i);
  assert.match(conversationBody, /DBMS_CLOUD_AI\.CREATE_CONVERSATION/i);
  assert.match(conversationBody, /'retention_days'\s+VALUE\s+1/i);
  assert.match(conversationBody, /'conversation_length'\s+VALUE\s+5/i);
});

test('application wrapper exposes CHAT and one exact SHOWSQL safety gate only', () => {
  const packageBody = position('CREATE OR REPLACE PACKAGE BODY finance_native_ai_pkg');
  const showSql = sql.indexOf("action       => 'showsql'", packageBody);
  const guard = sql.indexOf('IF is_safe_sql(l_result) <> 1', showSql);
  assert(showSql > packageBody);
  assert(guard > showSql);
  assert.match(sql, /l_action NOT IN \('CHAT', 'SHOWSQL'\)/i);
  assert.doesNotMatch(
    sql.slice(packageBody, position('END finance_native_ai_pkg;')),
    /action\s*=>\s*LOWER\(l_action\)/i
  );
  assert.match(sql, /FOR\[\[:space:\]\]\+UPDATE/i);
  assert.match(sql, /FINANCE_NATIVE_AI_STATE/i);
  assert.match(sql, /INSTR\(l_sql, '@'\) > 0/i);
  assert.match(sql, /DBA_\|ALL_\|USER_\|CDB_/i);
  assert.match(
    sql,
    /WITH\[\[:space:\]\]\+\(FUNCTION\|PROCEDURE\)/i
  );
  assert.match(
    sql,
    /LOG_AGENT_DECISION\|BATCH_SEMANTIC_MATCH\|SC_SECURITY_CTX\|FIND_\|SEARCH_\|OPTIMAL_\|DETECT_\|CHECK_\|GET_\|VPD_/i
  );
  assert.match(sql, /NEXTVAL\|CURRVAL/i);
  assert.match(sql, /FINANCE_NATIVE_AI_SQL_GATE_OK/i);
  assert.match(sql, /SELECT \* FROM USER_CREDENTIALS CROSS JOIN FINANCE_INSTITUTIONS_V/i);
  assert.match(sql, /SELECT \* FROM ORDERS CROSS JOIN FINANCE_INSTITUTIONS_V/i);
  assert.match(sql, /WITH FUNCTION SIDE_EFFECT RETURN NUMBER/i);
  assert.match(sql, /SELECT LOG_AGENT_DECISION\(/i);
});

test('SQL safety-gate regular expressions stay within Oracle pattern limits', () => {
  const patterns = [
    ...sql.matchAll(/REGEXP_LIKE\(\s*l_sql,\s*'([^']*)'/g),
  ].map((match) => match[1]);

  assert(patterns.length > 0);
  for (const pattern of patterns) {
    assert(
      Buffer.byteLength(pattern, 'utf8') <= 512,
      `REGEXP_LIKE pattern exceeds Oracle's 512-byte limit: ${pattern}`
    );
  }
});

test('bootstrap is fail-closed and gates READY on all four live native probes', () => {
  const installing = position("target.status           = 'INSTALLING'");
  const chat = position('FINANCE_NATIVE_AI_CHAT_OK');
  const showsql = position('FINANCE_NATIVE_AI_SHOWSQL_OK');
  const runsql = position('FINANCE_NATIVE_AI_RUNSQL_OK');
  const toolFree = position('FINANCE_NATIVE_AI_AGENT_TASKS_TOOL_FREE_OK');
  const agentTool = position('FINANCE_NATIVE_AI_AGENT_TOOL_OK');
  const agent = position('FINANCE_NATIVE_AI_AGENT_OK');
  const runTool = position('DBMS_CLOUD_AI_AGENT.RUN_TOOL');
  const describeTeam = position('DBMS_CLOUD_AI_AGENT.DESCRIBE_TEAM');
  const finalReady = sql.lastIndexOf('  mark_ready;');
  const acceptance = position('PROMPT FINANCE_NATIVE_AI_ACCEPTANCE_OK');
  const liveAcceptanceStart = position('-- Live native acceptance.');
  const liveAcceptanceBody = sql.slice(liveAcceptanceStart, acceptance);

  assert(installing < chat);
  assert(installing < toolFree);
  assert(toolFree < chat);
  assert(chat < showsql);
  assert(showsql < runsql);
  assert(runsql < runTool);
  assert(runTool < agentTool);
  assert(agentTool < describeTeam);
  assert(describeTeam < agent);
  assert(agent < finalReady);
  assert(finalReady < acceptance);
  assert.doesNotMatch(liveAcceptanceBody, /DBMS_CLOUD_AI_AGENT\.RUN_TEAM/i);
  assert.match(sql, /SET status = 'FAILED'/i);
  const installingProbe = sql.lastIndexOf(
    "action       => 'chat'",
    chat
  );
  assert(installingProbe < finalReady);
  assert.match(
    sql,
    /\^ocid1\[.\]\(compartment\|tenancy\)\[.\]\[A-Za-z0-9_-\]\+\[.\]\[A-Za-z0-9._-\]\+\$/
  );
  assert.match(sql, /FINANCE_NATIVE_AI_PKG\.RUN_AGENT/i);
  assert.match(sql, /DBMS_CLOUD_AI_AGENT\.RUN_TEAM/i);
  assert.match(sql, /FROM user_ai_agent_task_attributes/i);
  assert.match(sql, /UPPER\(attribute_name\) = 'TOOLS'/i);
  assert.match(sql, /SELECT COUNT\(\*\) AS TOTAL_ROWS FROM FINANCE_PRODUCTS_V/i);
});

test('fresh bootstrap resolves state DDL before static DML and uses the 26ai agent catalog', () => {
  const stateDdl = position('CREATE TABLE finance_native_ai_state');
  const stateDdlUnitEnd = sql.indexOf('END;\n/\n\nDECLARE', stateDdl);
  const stateMerge = position('MERGE INTO finance_native_ai_state target');

  assert(stateDdlUnitEnd > stateDdl);
  assert(stateDdlUnitEnd < stateMerge);
  assert.match(sql, /FROM user_ai_agent_tasks/i);
  assert.doesNotMatch(sql, /FROM user_ai_agent_task(?:\s|$)/i);
  assert.match(
    sql,
    /FROM user_ai_agent_teams\s+WHERE agent_team_name IN/i
  );
});

test('SQLcl inputs are hex-decoded and no private-key input exists', () => {
  assert.match(sql, /must be non-empty UTF-8 hexadecimal/i);
  assert.match(sql, /UTL_I18N\.RAW_TO_CHAR\(HEXTORAW\(p_hex\), 'AL32UTF8'\)/i);
  assert.doesNotMatch(sql, /private[_ -]?key/i);
  assert.doesNotMatch(sql, /tenancy_ocid/i);
  assert.doesNotMatch(sql, /user_ocid/i);
  assert.doesNotMatch(sql, /fingerprint/i);
});

test('bootstrap source has no duplicated structural fragments', () => {
  assert.equal((sql.match(/^WITH capacity AS \($/gm) || []).length, 1);
  assert.equal((sql.match(/^\s{2}create_worker\($/gm) || []).length, 3);
  assert.equal(
    (
      sql.match(
        /RAISE_APPLICATION_ERROR\(-20828, 'Unknown or invalid managed Finance advisory team\.'\);/g
      ) || []
    ).length,
    1
  );
  assert.equal((sql.match(/'objectScope' VALUE JSON_ARRAY\(/g) || []).length, 1);
  assert.equal((sql.match(/sig\.cases_opened_count/g) || []).length, 1);
});
