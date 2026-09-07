require('dotenv').config();

const assert = require('assert');
const db = require('../backend/config/database');

const REQUIRED_COLUMNS = [
  'CENTER_ID',
  'CENTER_NAME',
  'CITY',
  'STATE_PROVINCE',
  'CENTER_TYPE',
  'LATITUDE',
  'LONGITUDE',
  'DISTANCE_KM',
  'ESTIMATED_HOURS',
  'PRODUCTS_AVAILABLE',
  'PRODUCTS_NEEDED',
  'REQUESTED_UNITS',
  'AVAILABLE_UNITS',
  'CAPACITY_MARGIN',
  'COVERAGE_STATUS',
  'OPTIMIZATION_SCORE',
  'IS_CURRENT_CENTER',
  'RECOMMENDATION_RANK',
  'RECOMMENDATION_REASON'
];

async function findSampleOrder() {
  const result = await db.executeAsUser(`
    SELECT o.order_id
    FROM orders o
    JOIN customers c
      ON c.customer_id = o.customer_id
    JOIN fulfillment_centers fc
      ON fc.center_id = o.fulfillment_center_id
    WHERE c.location IS NOT NULL
      AND fc.location IS NOT NULL
      AND fc.is_active = 1
      AND EXISTS (
        SELECT 1
        FROM order_items oi
        WHERE oi.order_id = o.order_id
      )
    FETCH FIRST 1 ROW ONLY
  `);

  assert(result.rows.length > 0, 'No sample order with items, customer location, and active assigned center found');
  return result.rows[0].ORDER_ID;
}

async function fetchRecommendations(orderId) {
  const result = await db.executeCursorAsUser(`
    BEGIN
      :recommendations := optimal_fulfillment(:orderId, :strategy);
    END;
  `, {
    recommendations: { dir: db.oracledb.BIND_OUT, type: db.oracledb.CURSOR },
    orderId,
    strategy: 'balanced'
  }, 'recommendations', null, { maxRows: 10 });

  return result.rows;
}

function assertNumeric(row, column) {
  assert(Number.isFinite(Number(row[column])), `${column} must be numeric`);
}

function assertShape(rows) {
  assert(rows.length > 0, 'optimal_fulfillment returned no rows');

  for (const row of rows) {
    for (const column of REQUIRED_COLUMNS) {
      assert(Object.prototype.hasOwnProperty.call(row, column), `${column} is missing from function output`);
    }

    assert(!Object.prototype.hasOwnProperty.call(row, 'DISTANCE_MI'), 'Function output still exposes DISTANCE_MI');
    assert(['full', 'partial', 'none'].includes(row.COVERAGE_STATUS), `Unexpected COVERAGE_STATUS: ${row.COVERAGE_STATUS}`);

    [
      'CENTER_ID',
      'LATITUDE',
      'LONGITUDE',
      'DISTANCE_KM',
      'ESTIMATED_HOURS',
      'PRODUCTS_AVAILABLE',
      'PRODUCTS_NEEDED',
      'REQUESTED_UNITS',
      'AVAILABLE_UNITS',
      'CAPACITY_MARGIN',
      'OPTIMIZATION_SCORE',
      'IS_CURRENT_CENTER',
      'RECOMMENDATION_RANK'
    ].forEach((column) => assertNumeric(row, column));
  }
}

function assertRanking(rows) {
  const candidates = rows.filter((row) => Number(row.RECOMMENDATION_RANK) <= 5);
  assert(candidates.length > 0, 'No top-five recommendation candidates returned');
  assert.strictEqual(Number(candidates[0].RECOMMENDATION_RANK), 1, 'Top recommendation rank must be 1');
  assert(rows.some((row) => Number(row.IS_CURRENT_CENTER) === 1), 'Current assigned center row is missing');

  for (let index = 1; index < candidates.length; index += 1) {
    assert(
      Number(candidates[index].RECOMMENDATION_RANK) >= Number(candidates[index - 1].RECOMMENDATION_RANK),
      'Recommendation rows are not ordered by rank'
    );
  }
}

async function main() {
  const orderId = await findSampleOrder();
  const rows = await fetchRecommendations(orderId);

  assertShape(rows);
  assertRanking(rows);

  const top = rows.find((row) => Number(row.RECOMMENDATION_RANK) === 1);
  console.log(
    `Optimal fulfillment check passed for order ${orderId}: recommended center ${top.CENTER_ID} (${top.COVERAGE_STATUS}, ${top.DISTANCE_KM} km).`
  );
}

main()
  .catch((error) => {
    console.error('Optimal fulfillment check failed:');
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.closePool();
  });
