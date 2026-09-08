const assert = require('assert');
const { TABLES } = require('../backend/lib/importCatalog');

const failures = [];

for (const table of TABLES) {
  const pkColumn = table.columns.find((column) => column.name === table.pk);
  try {
    assert(pkColumn, `${table.name}: missing primary key column "${table.pk}"`);
    assert.strictEqual(pkColumn.sourceId, true, `${table.name}.${table.pk} must remain a source ID column`);
  } catch (error) {
    failures.push(error.message);
  }

  for (const fk of table.foreignKeys || []) {
    const fkColumn = table.columns.find((column) => column.name === fk.column);
    try {
      assert(fkColumn, `${table.name}: missing foreign key column "${fk.column}"`);
      assert.notStrictEqual(
        fkColumn.sourceId,
        true,
        `${table.name}.${fk.column} must be insertable so remapped Oracle IDs are written during import`
      );
    } catch (error) {
      failures.push(error.message);
    }
  }
}

if (failures.length) {
  console.error('Import contract check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Import contract check passed for ${TABLES.length} tables.`);
