#!/usr/bin/env node
/*
 * Standalone regression runner for a deployed Finance LiveStack. It does not
 * modify Finance business data. The standard suite avoids endpoints that
 * seed/import data, create agent audit actions, or rebuild OML models; its
 * native chat check does create short-lived Select AI conversation records.
 * Agent Console chat can be checked separately with --include-agent-chat; that
 * option also adds two ordinary audit records to the demo database.
 *
 * Usage:
 *   node finance-livestack-regression.mjs --base-url http://host:8505
 *   node finance-livestack-regression.mjs --base-url http://host:8505 --skip-chat
 *   node finance-livestack-regression.mjs --base-url http://host:8505 --include-agent-chat
 *   node finance-livestack-regression.mjs --base-url http://host:8505 --include-agent-chat --agent-timeout-ms 900000
 */

import assert from 'node:assert/strict';
import process from 'node:process';

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

const rawBaseUrl = argument('--base-url');
if (!rawBaseUrl) {
  console.error('Usage: node finance-livestack-regression.mjs --base-url http://host:8505 [--skip-chat] [--include-agent-chat] [--agent-timeout-ms 900000]');
  process.exit(2);
}

const baseUrl = rawBaseUrl.replace(/\/+$/, '');
const timeoutMs = Number(argument('--timeout-ms', '120000'));
const agentTimeoutMs = Number(argument('--agent-timeout-ms', '900000'));
const runChat = !process.argv.includes('--skip-chat');
const runAgentChat = process.argv.includes('--include-agent-chat');
const results = [];

function value(object, ...keys) {
  return keys.map((key) => object?.[key]).find((candidate) => candidate !== undefined && candidate !== null);
}

function nonEmptyArray(payload, label) {
  assert.ok(Array.isArray(payload), `${label} must be an array`);
  assert.ok(payload.length > 0, `${label} must not be empty`);
  return payload;
}

async function http(label, path, { method = 'GET', body, timeout = timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`${label} returned non-JSON content: ${text.slice(0, 240)}`);
    }
    assert.equal(response.status, 200, `${label} returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function test(label, callback) {
  const started = Date.now();
  try {
    await callback();
    results.push({ label, status: 'PASS', elapsedMs: Date.now() - started });
    console.log(`PASS  ${label}`);
  } catch (error) {
    results.push({ label, status: 'FAIL', elapsedMs: Date.now() - started, error: error.message });
    console.error(`FAIL  ${label}: ${error.message}`);
  }
}

async function main() {
  const state = {};

  await test('connection: API health queries ADB', async () => {
    const payload = await http('API health', '/api/health');
    assert.equal(payload.status, 'healthy');
    assert.equal(value(payload.database, 'STATUS', 'status'), 'connected');
  });

  await test('seeded Finance data', async () => {
    const payload = await http('demo status', '/api/demo/status');
    for (const key of ['products', 'orders', 'social_posts', 'product_embeddings', 'signal_embeddings']) {
      assert.ok(Number(payload[key]) > 0, `demo status ${key} is empty`);
    }
  });

  const simpleGetTests = [
    ['dashboard summary', '/api/dashboard/summary', (body) => assert.ok(Number(value(body, 'ORDERS_TOTAL', 'orders_total')) > 0)],
    ['dashboard trending products', '/api/dashboard/trending-products?limit=3', (body) => nonEmptyArray(body, 'trending products')],
    ['dashboard social velocity', '/api/dashboard/social-velocity?hours=48', (body) => nonEmptyArray(body, 'social velocity')],
    ['dashboard revenue by category', '/api/dashboard/revenue-by-category', (body) => nonEmptyArray(body, 'revenue by category')],
    ['dashboard demand map', '/api/dashboard/demand-map', (body) => nonEmptyArray(body, 'demand map')],
    ['dashboard in-memory metrics', '/api/dashboard/inmemory', (body) => assert.equal(typeof body, 'object')],
    ['risk signal feed', '/api/social/posts?limit=2', (body) => {
      nonEmptyArray(body.posts, 'risk signal posts');
      assert.ok(Number(body.total) > 0, 'risk signal total is empty');
    }],
    ['risk signal sources', '/api/social/influencers', (body) => nonEmptyArray(body, 'risk signal sources')],
    ['elevated risk signals', '/api/social/viral?hours=48', (body) => assert.ok(Array.isArray(body), 'viral risk signals must be an array')],
    ['risk signal timeline', '/api/social/momentum-timeline', (body) => nonEmptyArray(body, 'risk signal timeline')],
    ['risk signal platforms', '/api/social/platform-breakdown', (body) => nonEmptyArray(body, 'risk signal platforms')],
    ['operations centers', '/api/fulfillment/centers', (body) => nonEmptyArray(body, 'operations centers')],
    ['operations shipments', '/api/fulfillment/shipments?limit=2', (body) => assert.ok(Array.isArray(body), 'shipments must be an array')],
    ['operations inventory alerts', '/api/fulfillment/inventory-alerts', (body) => assert.ok(Array.isArray(body), 'inventory alerts must be an array')],
    ['client locations', '/api/fulfillment/customers?limit=1', (body) => nonEmptyArray(body, 'client locations')],
    ['service coverage zones', '/api/fulfillment/zones', (body) => assert.ok(Array.isArray(body.zones), 'zones payload is invalid')],
    ['service demand regions', '/api/fulfillment/demand-regions', (body) => assert.ok(Array.isArray(body), 'demand regions must be an array')],
    ['fraud graph entities', '/api/graph/influencers?limit=1', (body) => nonEmptyArray(body, 'fraud graph entities')],
    ['fraud graph examples', '/api/graph/example-queries', (body) => nonEmptyArray(body, 'fraud graph examples')],
    ['OML summary', '/api/ml/summary', (body) => assert.equal(typeof body, 'object')],
    ['OML demand forecast', '/api/ml/demand-forecast?limit=3', (body) => {
      assert.ok(Array.isArray(body.products), 'demand forecast products must be an array');
      assert.equal(typeof body.meta, 'object', 'demand forecast metadata is missing');
    }],
    ['OML customer segments', '/api/ml/customer-segments?limit=3', (body) => {
      nonEmptyArray(body.customers, 'customer segments');
      assert.equal(typeof body.meta, 'object', 'customer segment metadata is missing');
    }],
    ['OML revenue forecast', '/api/ml/revenue-forecast?days=30&forecast=2', (body) => assert.equal(typeof body, 'object')],
    ['OML inventory intelligence', '/api/ml/inventory-intelligence', (body) => assert.equal(typeof body, 'object')],
    ['Ask Finance profiles', '/api/selectai/profiles', (body) => nonEmptyArray(body.profiles, 'Select AI profiles')],
    ['Ask Finance schema metadata', '/api/selectai/schema-objects', (body) => nonEmptyArray(body.objects, 'Select AI schema objects')],
    ['Ask Finance metadata health', '/api/selectai/health', (body) => assert.equal(body.status, 'healthy')],
    ['agent profiles', '/api/agents/profiles', (body) => assert.equal(typeof body, 'object')],
    ['agent teams', '/api/agents/teams', (body) => nonEmptyArray(body, 'agent teams')],
    ['agent summary', '/api/agents/summary', (body) => assert.equal(typeof body, 'object')],
    ['agent audit view', '/api/agents/actions?limit=3', (body) => assert.ok(Array.isArray(body), 'agent audit view must be an array')],
    ['agent events', '/api/agents/events?limit=3', (body) => assert.ok(Array.isArray(body), 'agent events must be an array')],
    ['agent tool history', '/api/agents/tool-history?limit=3', (body) => assert.ok(Array.isArray(body), 'agent tool history must be an array')],
    ['agent team history', '/api/agents/team-history?limit=3', (body) => assert.ok(Array.isArray(body), 'agent team history must be an array')],
    ['demo users', '/api/users', (body) => nonEmptyArray(body, 'demo users')],
    ['import dataset metadata', '/api/import/dataset', (body) => assert.equal(typeof body, 'object')],
  ];

  for (const [label, path, assertion] of simpleGetTests) {
    await test(label, async () => assertion(await http(label, path)));
  }

  await test('vector search: products', async () => {
    const payload = await http('product vector search', '/api/social/semantic-search', {
      method: 'POST', body: { query: 'financial fraud exposure', topK: 3 },
    });
    assert.equal(payload.model, 'ALL_MINILM_L12_V2');
    nonEmptyArray(payload.results, 'product vector search results');
  });

  await test('vector search: risk signals', async () => {
    const payload = await http('risk signal vector search', '/api/social/post-search', {
      method: 'POST', body: { query: 'financial fraud exposure', topK: 3 },
    });
    assert.equal(payload.model, 'ALL_MINILM_L12_V2');
    nonEmptyArray(payload.posts, 'risk signal vector search results');
  });

  await test('products list and dynamic detail routes', async () => {
    const products = nonEmptyArray(await http('products', '/api/products?limit=1'), 'products');
    state.productId = value(products[0], 'PRODUCT_ID', 'product_id');
    assert.ok(Number.isFinite(Number(state.productId)), 'products did not return PRODUCT_ID');
    const detail = await http('product detail', `/api/products/${state.productId}`);
    assert.ok(detail.product, 'product detail has no product');
    assert.ok(Array.isArray(detail.inventory), 'product detail has no inventory array');
    assert.ok(Array.isArray(detail.socialMentions), 'product detail has no social mentions array');
    const duality = await http('product duality', `/api/products/${state.productId}/duality`);
    assert.ok(duality.document, 'product duality has no JSON document');
    const categories = await http('product categories', '/api/products/categories/list');
    nonEmptyArray(categories, 'product categories');
  });

  await test('transactions list and dynamic detail routes', async () => {
    const orders = nonEmptyArray(await http('orders', '/api/orders?limit=1'), 'orders');
    state.orderId = value(orders[0], 'ORDER_ID', 'order_id');
    assert.ok(Number.isFinite(Number(state.orderId)), 'orders did not return ORDER_ID');
    const detail = await http('order detail', `/api/orders/${state.orderId}`);
    assert.ok(detail.order, 'order detail has no order');
    assert.ok(Array.isArray(detail.items), 'order detail has no items array');
    assert.ok(detail.routingRecommendation, 'order detail has no routing recommendation');
    const duality = await http('order duality', `/api/orders/${state.orderId}/duality`);
    assert.ok(duality.document, 'order duality has no JSON document');
  });

  await test('spatial nearest-service route', async () => {
    const customers = nonEmptyArray(await http('customers', '/api/fulfillment/customers?limit=1'), 'customers');
    const customerId = value(customers[0], 'CUSTOMER_ID', 'customer_id');
    assert.ok(Number.isFinite(Number(customerId)), 'customers did not return CUSTOMER_ID');
    if (!state.productId) {
      const products = nonEmptyArray(await http('products', '/api/products?limit=1'), 'products');
      state.productId = value(products[0], 'PRODUCT_ID', 'product_id');
    }
    const nearest = await http('nearest service center', `/api/fulfillment/nearest?customerId=${encodeURIComponent(customerId)}&productId=${encodeURIComponent(state.productId)}&maxResults=1`);
    assert.ok(Array.isArray(nearest), 'nearest service center must return an array');
  });

  await test('fraud network and read-only example route', async () => {
    const entities = nonEmptyArray(await http('fraud entities', '/api/graph/influencers?limit=1'), 'fraud entities');
    const entityId = value(entities[0], 'INFLUENCER_ID', 'ENTITY_ID', 'influencer_id', 'entity_id');
    assert.ok(Number.isFinite(Number(entityId)), 'fraud entities did not return an ID');
    const network = await http('fraud network', `/api/graph/network/${entityId}?depth=1`);
    assert.ok(network.center, 'fraud network has no center');
    assert.ok(Array.isArray(network.nodes), 'fraud network has no nodes');
    assert.ok(Array.isArray(network.edges), 'fraud network has no edges');
    const examples = nonEmptyArray(await http('graph examples', '/api/graph/example-queries'), 'graph examples');
    const run = await http('graph read-only example', '/api/graph/run-example', {
      method: 'POST', body: { queryId: examples[0].id, params: {} },
    });
    assert.ok(Array.isArray(run.rows), 'graph example has no rows');
    assert.ok(Number.isFinite(Number(run.rowCount)), 'graph example has no row count');
  });

  await test('governed natural-language SQL', async () => {
    const payload = await http('governed natural-language SQL', '/api/selectai/runsql', {
      method: 'POST', body: { question: 'How many financial products are there?' }, timeout: 190000,
    });
    assert.ok(Array.isArray(payload.columns) && payload.columns.length > 0, 'governed SQL returned no columns');
    assert.ok(Array.isArray(payload.rows), 'governed SQL returned no rows array');
    assert.equal(typeof payload.sql, 'string', 'governed SQL did not return generated SQL');
  });

  if (runChat) {
    await test('two-turn native Ask Finance conversation reuse', async () => {
      const products = nonEmptyArray(await http('chat product context', '/api/products?limit=1'), 'products');
      const productName = value(products[0], 'PRODUCT_NAME', 'product_name');
      assert.equal(typeof productName, 'string', 'chat context product has no name');
      const firstQuestion = `Show the details for financial product named "${productName}".`;
      const first = await http('chat context turn one', '/api/selectai/chat-mode', {
        method: 'POST',
        body: { question: firstQuestion, showSql: false, history: [] },
        timeout: 190000,
      });
      assert.equal(typeof first.answer, 'string', 'chat first turn has no answer');
      assert.equal(typeof first.conversationId, 'string', 'chat first turn has no native conversation ID');
      assert.equal(first.sql, null, 'chat first turn exposed governed SQL while showSql was disabled');
      assert.equal(first.evidence?.generatedSql, true, 'chat first turn did not generate governed SQL');
      assert.equal(first.evidence?.executed, true, 'chat first turn did not execute governed SQL');
      const second = await http('chat context turn two', '/api/selectai/chat-mode', {
        method: 'POST',
        body: {
          question: 'What about it by transaction volume?',
          conversationId: first.conversationId,
          showSql: false,
          history: [
            { role: 'user', text: firstQuestion },
            { role: 'assistant', text: first.answer },
          ],
        },
        timeout: 190000,
      });
      assert.equal(typeof second.answer, 'string', 'chat follow-up has no answer');
      assert.equal(second.conversationId, first.conversationId, 'chat did not reuse the native Oracle conversation ID');
      assert.equal(second.conversation?.conversationId, first.conversationId, 'chat conversation evidence is inconsistent');
      assert.equal(second.conversation?.contextApplied, true, 'chat did not apply supplied history');
      assert.equal(second.conversation?.contextProvider, 'adb-select-ai', 'chat did not identify native Select AI context');
      assert.equal(second.provider, 'OCI Generative AI', 'chat did not identify the native provider');
      assert.equal(second.evidence?.package, 'DBMS_CLOUD_AI', 'chat did not identify DBMS_CLOUD_AI evidence');
      assert.equal(second.readOnly, true, 'chat did not retain the read-only boundary');
      assert.equal(second.sql, null, 'chat follow-up exposed governed SQL while showSql was disabled');
      assert.equal(second.evidence?.generatedSql, true, 'chat follow-up did not generate governed SQL');
      assert.equal(second.evidence?.executed, true, 'chat follow-up did not execute governed SQL');
    });
  } else {
    results.push({ label: 'two-turn native Ask Finance conversation reuse', status: 'SKIP', elapsedMs: 0 });
    console.log('SKIP  two-turn native Ask Finance conversation reuse');
  }

  if (runAgentChat) {
    await test('two-turn native Agent Console conversation reuse', async () => {
      const teamHistoryBefore = await http('agent team history baseline', '/api/agents/team-history?limit=100');
      const teamExecIdsBefore = new Set(teamHistoryBefore.map((row) => String(value(row, 'TEAM_EXEC_ID', 'team_exec_id'))));
      const products = nonEmptyArray(await http('agent chat product context', '/api/products?limit=1'), 'products');
      const productName = value(products[0], 'PRODUCT_NAME', 'product_name');
      assert.equal(typeof productName, 'string', 'agent chat context product has no name');
      const firstQuestion = `Assess risk signals for financial product named "${productName}".`;
      const first = await http('agent chat context turn one', '/api/agents/chat', {
        method: 'POST',
        body: { question: firstQuestion, team: 'SOCIAL_TREND_TEAM', history: [] },
        timeout: agentTimeoutMs,
      });
      assert.equal(typeof first.response, 'string', 'agent chat first turn has no response');
      assert.equal(typeof first.conversationId, 'string', 'agent chat first turn has no native conversation ID');
      assert.equal(first.team, 'SOCIAL_TREND_TEAM', 'agent chat first turn did not preserve specialist routing');
      assert.equal(first.action, 'RUN_TEAM', 'agent chat first turn did not identify the native team action');
      assert.equal(first.state, 'SUCCEEDED', 'agent chat first turn did not verify native terminal state');
      assert.equal(first.grounding?.action, 'SHOWSQL + VPD SELECT', 'agent chat first turn did not report governed grounding');
      assert.equal(first.grounding?.vpdFiltered, true, 'agent chat first-turn grounding was not VPD-filtered');
      assert.deepEqual(first.agentToolsUsed, [], 'agent chat first turn reported an attached agent tool');
      assert.ok(Array.isArray(first.executionSteps) && first.executionSteps.length === 3, 'agent chat first turn did not report its three governed execution stages');
      const second = await http('agent chat context turn two', '/api/agents/chat', {
        method: 'POST',
        body: {
          question: 'What about it now?',
          team: 'SOCIAL_TREND_TEAM',
          conversationId: first.conversationId,
          history: [
            { role: 'user', text: firstQuestion },
            { role: 'assistant', text: first.response },
          ],
        },
        timeout: agentTimeoutMs,
      });
      assert.equal(typeof second.response, 'string', 'agent chat follow-up has no response');
      assert.equal(second.conversationId, first.conversationId, 'agent chat did not reuse the native Oracle conversation ID');
      assert.equal(second.provider, 'OCI Generative AI', 'agent chat did not identify the native provider');
      assert.equal(second.package, 'DBMS_CLOUD_AI_AGENT', 'agent chat did not identify the native agent package');
      assert.equal(second.action, 'RUN_TEAM', 'agent chat did not identify the native team action');
      assert.equal(second.team, 'SOCIAL_TREND_TEAM', 'agent chat did not preserve specialist routing');
      assert.equal(second.state, 'SUCCEEDED', 'agent chat did not verify native terminal state');
      assert.equal(second.contextApplied, true, 'agent chat did not reuse native conversation context');
      assert.equal(second.contextProvider, 'adb-select-ai-agent', 'agent chat did not identify native agent context');
      assert.equal(second.advisory, true, 'agent chat did not retain its advisory boundary');
      assert.equal(second.readOnly, true, 'agent chat did not retain its read-only boundary');
      assert.equal(second.grounding?.action, 'SHOWSQL + VPD SELECT', 'agent chat did not report governed grounding');
      assert.equal(second.grounding?.vpdFiltered, true, 'agent chat grounding was not VPD-filtered');
      assert.deepEqual(second.agentToolsUsed, [], 'agent chat follow-up reported an attached agent tool');
      assert.ok(Array.isArray(second.executionSteps) && second.executionSteps.length === 3, 'agent chat follow-up did not report its three governed execution stages');
      const teamHistoryAfter = await http('agent team history after chat', '/api/agents/team-history?limit=100');
      const newTeamExecIds = new Set(
        teamHistoryAfter
          .filter((row) => value(row, 'TEAM_NAME', 'team_name') === 'SOCIAL_TREND_TEAM')
          .map((row) => String(value(row, 'TEAM_EXEC_ID', 'team_exec_id')))
          .filter((id) => id && id !== 'undefined' && !teamExecIdsBefore.has(id))
      );
      assert.ok(newTeamExecIds.size > 0, 'agent chat did not create native specialist team history');
      const toolHistoryAfter = await http('agent tool history after chat', '/api/agents/tool-history?limit=100');
      const unexpectedToolCalls = toolHistoryAfter.filter((row) => (
        newTeamExecIds.has(String(value(row, 'TEAM_EXEC_ID', 'team_exec_id')))
      ));
      assert.equal(unexpectedToolCalls.length, 0, 'tool-free native agent tasks invoked a database tool');
    });
  } else {
    results.push({ label: 'two-turn native Agent Console conversation reuse', status: 'SKIP', elapsedMs: 0 });
    console.log('SKIP  two-turn native Agent Console conversation reuse (use --include-agent-chat to run; it writes two audit records)');
  }

  const passed = results.filter((result) => result.status === 'PASS').length;
  const failed = results.filter((result) => result.status === 'FAIL');
  const skipped = results.filter((result) => result.status === 'SKIP').length;
  console.log(`\nFinance regression summary: ${passed} passed, ${failed.length} failed, ${skipped} skipped.`);
  if (failed.length) {
    console.log(JSON.stringify({ baseUrl, failed }, null, 2));
    process.exitCode = 1;
  } else {
    console.log('FINANCE_API_REGRESSION_OK');
  }
}

main().catch((error) => {
  console.error(`Fatal regression-runner error: ${error.stack || error.message}`);
  process.exitCode = 2;
});
