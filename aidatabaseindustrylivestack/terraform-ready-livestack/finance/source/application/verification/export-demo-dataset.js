const fs = require('fs');
const path = require('path');
const db = require('../backend/config/database');
const { TABLES } = require('../backend/lib/importCatalog');

const DEFAULT_OUTPUT_ROOT = path.join(__dirname, 'demo-dataset');

function csvCell(value) {
  if (value == null) return '';
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function sqlExpressionForColumn(column) {
  switch (column.type) {
    case 'date':
      return `TO_CHAR(${column.name}, 'YYYY-MM-DD') AS "${column.name}"`;
    case 'timestamp':
      return `TO_CHAR(${column.name}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "${column.name}"`;
    case 'geometry_wkt':
      return `SDO_UTIL.TO_WKTGEOMETRY(${column.name}) AS "${column.name}"`;
    default:
      return `${column.name} AS "${column.name}"`;
  }
}

function ensureOutputDirs(rootDir) {
  fs.mkdirSync(path.join(rootDir, 'required'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'optional'), { recursive: true });
}

function filePathForTable(rootDir, table) {
  const folder = table.required ? 'required' : 'optional';
  return path.join(rootDir, folder, `${table.name}.csv`);
}

async function exportTable(connection, rootDir, table) {
  const selectList = table.columns.map((column) => `  ${sqlExpressionForColumn(column)}`).join(',\n');
  const sql = `SELECT\n${selectList}\nFROM ${table.name}\nORDER BY ${table.pk}`;
  const result = await connection.execute(sql);

  const lines = [
    table.columns.map((column) => csvCell(column.name)).join(','),
    ...result.rows.map((row) =>
      table.columns.map((column) => csvCell(row[column.name])).join(',')
    ),
  ];

  const outputPath = filePathForTable(rootDir, table);
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
  return result.rows.length;
}

async function main() {
  const outputRoot = path.resolve(process.argv[2] || DEFAULT_OUTPUT_ROOT);
  ensureOutputDirs(outputRoot);

  let connection;
  try {
    await db.initialize();
    connection = await db.getConnection();

    const counts = {};
    for (const table of TABLES) {
      counts[table.name] = await exportTable(connection, outputRoot, table);
      console.log(`${table.name}: ${counts[table.name]} row(s)`);
    }

    console.log(`Demo dataset exported to ${outputRoot}`);
  } finally {
    if (connection) {
      try { await connection.close(); } catch (_) {}
    }
    await db.closePool().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
