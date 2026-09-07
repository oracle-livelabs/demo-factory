require('dotenv').config();

const assert = require('assert');
const db = require('../backend/config/database');

function parseDocument(raw) {
  let doc = raw;
  if (Array.isArray(doc)) doc = doc[0];
  if (typeof doc === 'string') doc = JSON.parse(doc);
  return doc;
}

async function main() {
  const result = await db.execute(`
    SELECT JSON_SERIALIZE(DATA RETURNING CLOB) AS doc
    FROM products_capacity_dv
    WHERE JSON_VALUE(DATA, '$._id' RETURNING NUMBER) = (
      SELECT MIN(product_id) FROM products
    )
    FETCH FIRST 1 ROW ONLY
  `);

  assert(result.rows.length > 0, 'products_capacity_dv returned no sample rows');

  const doc = parseDocument(result.rows[0].DOC);
  assert(doc && typeof doc === 'object', 'products_capacity_dv DATA did not parse as an object');
  assert(Number.isFinite(Number(doc._id)), 'document._id is missing');
  assert(doc.sku, 'document.sku is missing');
  assert(doc.productName, 'document.productName is missing');
  assert(doc.institution?.brandName, 'document.institution.brandName is missing');
  assert(Array.isArray(doc.serviceCapacity), 'document.serviceCapacity must be an array');
  assert(doc.serviceCapacity.length > 0, 'document.serviceCapacity must include at least one row');

  const firstCapacity = doc.serviceCapacity[0];
  assert(firstCapacity.inventoryId, 'serviceCapacity[0].inventoryId is missing');
  assert(firstCapacity.operationsCenter?.centerName, 'serviceCapacity[0].operationsCenter.centerName is missing');
  assert(firstCapacity.operationsCenter?.region, 'serviceCapacity[0].operationsCenter.region is missing');
  assert(firstCapacity.operationsCenter?.serviceTier, 'serviceCapacity[0].operationsCenter.serviceTier is missing');
  assert(
    Number.isFinite(Number(firstCapacity.remainingCapacity)),
    'serviceCapacity[0].remainingCapacity is missing'
  );

  console.log(
    `Product duality view check passed for product ${doc._id} with ${doc.serviceCapacity.length} service locations.`
  );
}

main()
  .catch((error) => {
    console.error('Product duality view check failed:');
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.closePool();
  });
