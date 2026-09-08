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
  'QUANTITY_ON_HAND',
  'DISTANCE_KM',
  'ESTIMATED_HOURS'
];

async function findSample() {
  const result = await db.executeAsUser(`
    SELECT c.customer_id, i.product_id
    FROM customers c
    JOIN inventory i
      ON i.quantity_on_hand > i.quantity_reserved
    JOIN fulfillment_centers fc
      ON fc.center_id = i.center_id
    WHERE c.location IS NOT NULL
      AND fc.location IS NOT NULL
      AND fc.is_active = 1
    FETCH FIRST 1 ROW ONLY
  `);

  assert(result.rows.length > 0, 'No customer/product sample with available fulfillment inventory found');
  return result.rows[0];
}

async function fetchExpectedRows(customerId, productId, maxResults) {
  const result = await db.executeAsUser(`
    WITH candidates AS (
      SELECT fc.center_id,
             fc.center_name,
             fc.city,
             fc.state_province,
             fc.center_type,
             fc.latitude,
             fc.longitude,
             i.quantity_on_hand,
             SDO_GEOM.SDO_DISTANCE(
               c.location,
               fc.location,
               0.005,
               'unit=KM'
             ) AS distance_km_raw
      FROM customers c
      CROSS JOIN fulfillment_centers fc
      JOIN inventory i
        ON fc.center_id = i.center_id
       AND i.product_id = :productId
      WHERE c.customer_id = :customerId
        AND fc.is_active = 1
        AND i.quantity_on_hand > i.quantity_reserved
    )
    SELECT center_id,
           center_name,
           city,
           state_province,
           center_type,
           latitude,
           longitude,
           quantity_on_hand,
           ROUND(distance_km_raw, 2) AS distance_km,
           ROUND(distance_km_raw / 80, 1) AS estimated_hours
    FROM candidates
    ORDER BY distance_km_raw
    FETCH FIRST :maxResults ROWS ONLY
  `, { customerId, productId, maxResults });

  return result.rows;
}

async function fetchFunctionRows(customerId, productId, maxResults) {
  const result = await db.executeCursorAsUser(`
    BEGIN
      :nearestCenters := find_nearest_centers(:customerId, :productId, :maxResults);
    END;
  `, {
    nearestCenters: { dir: db.oracledb.BIND_OUT, type: db.oracledb.CURSOR },
    customerId,
    productId,
    maxResults
  }, 'nearestCenters', null, { maxRows: maxResults });

  return result.rows;
}

function assertShape(rows) {
  assert(rows.length > 0, 'find_nearest_centers returned no rows');
  const first = rows[0];

  for (const column of REQUIRED_COLUMNS) {
    assert(Object.prototype.hasOwnProperty.call(first, column), `${column} is missing from function output`);
  }

  assert(!Object.prototype.hasOwnProperty.call(first, 'DISTANCE_MI'), 'Function output still exposes DISTANCE_MI');
  assert(Number.isFinite(Number(first.LATITUDE)), 'LATITUDE must be numeric');
  assert(Number.isFinite(Number(first.LONGITUDE)), 'LONGITUDE must be numeric');
  assert(Number.isFinite(Number(first.DISTANCE_KM)), 'DISTANCE_KM must be numeric');
  assert(Number.isFinite(Number(first.ESTIMATED_HOURS)), 'ESTIMATED_HOURS must be numeric');
}

function assertMatchesExpected(actualRows, expectedRows) {
  assert.deepStrictEqual(
    actualRows.map((row) => row.CENTER_ID),
    expectedRows.map((row) => row.CENTER_ID),
    'find_nearest_centers center ordering differs from the inline spatial query'
  );

  actualRows.forEach((actual, index) => {
    const expected = expectedRows[index];
    assert.strictEqual(Number(actual.DISTANCE_KM), Number(expected.DISTANCE_KM), `DISTANCE_KM differs for center ${actual.CENTER_ID}`);
    assert.strictEqual(Number(actual.ESTIMATED_HOURS), Number(expected.ESTIMATED_HOURS), `ESTIMATED_HOURS differs for center ${actual.CENTER_ID}`);
  });
}

async function main() {
  const maxResults = 3;
  const sample = await findSample();
  const customerId = sample.CUSTOMER_ID;
  const productId = sample.PRODUCT_ID;

  const expectedRows = await fetchExpectedRows(customerId, productId, maxResults);
  const functionRows = await fetchFunctionRows(customerId, productId, maxResults);

  assertShape(functionRows);
  assertMatchesExpected(functionRows, expectedRows);

  console.log(
    `Spatial nearest function check passed for customer ${customerId}, product ${productId}: ${functionRows.map((row) => row.CENTER_ID).join(', ')}.`
  );
}

main()
  .catch((error) => {
    console.error('Spatial nearest function check failed:');
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.closePool();
  });
