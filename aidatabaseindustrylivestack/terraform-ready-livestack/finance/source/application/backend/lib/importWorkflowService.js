const AdmZip = require('adm-zip');
const { parse: parseCsvSync } = require('csv-parse/sync');
const db = require('../config/database');
const {
  IMPORT_VERSION,
  TABLE_BY_NAME,
  INSERT_ORDER,
  DELETE_ORDER,
  REQUIRED_TABLE_NAMES,
  OPTIONAL_TABLE_NAMES,
  TABLES,
  buildManifest,
} = require('./importCatalog');
const {
  createJob,
  updateJob,
  appendJobWarnings,
  getJob,
} = require('./importJobs');
const { getBundledDemoArchive } = require('./demoDatasetBundle');
const { getStoredDatasetState, saveDatasetState } = require('./datasetStateStore');
const {
  beginOperation,
  updateOperation,
  endOperation,
  getActiveOperation,
} = require('./datasetOperationLock');
const { refreshDemoDateWindow } = require('./demoDataFreshnessService');
const { recordDatasetRefresh } = require('./usageCounterService');

let nativeAiService = null;
try {
  // Optional: refresh readiness metadata after a dataset switch.
  nativeAiService = require('./nativeAiService');
} catch (_) {
  nativeAiService = null;
}

const MAX_ARCHIVE_SIZE_BYTES = 25 * 1024 * 1024;
const VECTOR_MODEL_NAME = 'ALL_MINILM_L12_V2';
const VECTOR_MODEL_REFERENCE = `ADMIN.${VECTOR_MODEL_NAME}`;
const INSERT_SQL_CACHE = new Map();
let cachedBundledDemoDataset = null;

class ImportError extends Error {
  constructor(message, statusCode = 400, details = null) {
    super(message);
    this.name = 'ImportError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function isTrueish(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeZipBaseName(name) {
  return String(name || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .toLowerCase();
}

function normalizeSourceId(value) {
  return String(value == null ? '' : value).trim();
}

function roundTo(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function firstOutBind(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function csvCell(value) {
  if (value == null) return '';
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildTemplateReadme() {
  return [
    '# Financial Services Import Template',
    '',
    `Version: ${IMPORT_VERSION}`,
    '',
    'Usage',
    '1. Fill the per-table CSV files in this ZIP.',
    '2. Keep manifest.json in the archive.',
    '3. Validate the completed ZIP before running the destructive import.',
    '',
    'Notes',
    '- CSV ID columns are source reference keys. Oracle identity values are regenerated during import.',
    '- app_users are preserved and should not be included in the ZIP.',
    '- Derived columns such as customers.location, fulfillment_centers.location, order_items.line_total, fulfillment_zones, and vector embedding tables are rebuilt by the importer and therefore are not included as editable CSV inputs.',
    '- Domain labels use the original schema names for compatibility: brands are institutions, products are financial products, influencers are signal sources, and social_posts are regulatory or market bulletins.',
    '- inventory.csv is required.',
    '- shipments.csv, demand_regions.csv, demand_forecasts.csv, influencer_connections.csv, and brand_influencer_links.csv are optional.',
    '- When optional files are omitted, the importer regenerates fallback data.',
    '- demand_regions.boundary expects WKT polygon text, for example: POLYGON((-122.6 37.2, -121.7 37.2, -121.7 38.0, -122.6 38.0, -122.6 37.2))',
    '- Timestamps should use ISO 8601 values. Dates should use YYYY-MM-DD.',
    '',
  ].join('\n');
}

function buildDatasetState(source, version = IMPORT_VERSION) {
  const normalized = String(source || 'custom').toLowerCase() === 'demo' ? 'demo' : 'custom';
  return {
    source: normalized,
    label: normalized === 'demo' ? 'Demo Data' : 'Custom Dataset',
    version,
  };
}

function acquireOperationLock(kind, message) {
  const acquired = beginOperation({
    kind,
    message,
    progress: 0,
    status: 'running',
  });

  if (acquired) {
    return acquired;
  }

  const activeOperation = getActiveOperation();
  throw new ImportError(
    `Another dataset operation is already in progress${activeOperation?.kind ? ` (${activeOperation.kind}).` : '.'}`,
    409,
    { activeOperation }
  );
}

function getArchiveBufferFromRequest({ req, body }) {
  if (req?.file?.buffer) {
    if (req.file.size > MAX_ARCHIVE_SIZE_BYTES) {
      throw new ImportError(`ZIP file exceeds ${Math.round(MAX_ARCHIVE_SIZE_BYTES / (1024 * 1024))} MB limit.`);
    }
    return {
      buffer: req.file.buffer,
      fileName: req.file.originalname || 'dataset.zip',
    };
  }

  if (body?.archiveBase64) {
    const buffer = Buffer.from(String(body.archiveBase64), 'base64');
    return {
      buffer,
      fileName: body.fileName || 'dataset.zip',
    };
  }

  throw new ImportError('Upload a ZIP file using multipart/form-data with field name "file".');
}

function loadArchive(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ImportError('Uploaded file is empty or missing.');
  }

  try {
    return new AdmZip(buffer);
  } catch (err) {
    throw new ImportError('Uploaded file is not a valid ZIP archive.', 400, err.message);
  }
}

function listArchiveFiles(zip) {
  const files = new Map();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const baseName = normalizeZipBaseName(entry.entryName);
    if (!baseName) continue;
    if (files.has(baseName)) {
      throw new ImportError(`ZIP contains duplicate file names for "${baseName}". Keep only one copy of each CSV.`);
    }
    files.set(baseName, entry);
  }
  return files;
}

function parseManifest(files, version) {
  const manifestEntry = files.get('manifest.json');
  if (!manifestEntry) {
    throw new ImportError('ZIP is missing manifest.json.');
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  } catch (err) {
    throw new ImportError('manifest.json is not valid JSON.', 400, err.message);
  }

  const manifestVersion = String(manifest.version || '').trim();
  if (manifestVersion && manifestVersion !== version) {
    throw new ImportError(`manifest.json declares version "${manifestVersion}" but "${version}" was requested.`);
  }

  return manifest;
}

function isRowEmpty(record) {
  return record.every((value) => String(value ?? '').trim() === '');
}

function normalizeIsoDate(rawValue, type, tableName, columnName, lineNumber, errors) {
  const text = String(rawValue || '').trim();
  if (!text) return null;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    errors.push(`${tableName}.csv line ${lineNumber}: "${columnName}" must be a valid ${type}.`);
    return null;
  }

  return parsed;
}

function normalizeGeometryText(rawValue, tableName, lineNumber, columnName, errors) {
  const text = String(rawValue || '').trim();
  if (!text) return null;

  if (/^(polygon|multipolygon)\s*\(/i.test(text)) {
    return text;
  }

  if (/^sdo_geometry\s*\(/i.test(text)) {
    const ordMatch = text.match(/SDO_ORDINATE_ARRAY\s*\(([^)]+)\)/i);
    if (!ordMatch) {
      errors.push(`${tableName}.csv line ${lineNumber}: "${columnName}" SDO_GEOMETRY value does not contain SDO_ORDINATE_ARRAY(...).`);
      return null;
    }

    const ordinates = ordMatch[1]
      .split(',')
      .map((part) => Number(String(part).trim()))
      .filter((value) => Number.isFinite(value));

    if (ordinates.length < 6 || ordinates.length % 2 !== 0) {
      errors.push(`${tableName}.csv line ${lineNumber}: "${columnName}" must contain an even number of ordinates.`);
      return null;
    }

    const pairs = [];
    for (let index = 0; index < ordinates.length; index += 2) {
      pairs.push(`${ordinates[index]} ${ordinates[index + 1]}`);
    }
    return `POLYGON((${pairs.join(', ')}))`;
  }

  errors.push(`${tableName}.csv line ${lineNumber}: "${columnName}" must be WKT polygon text or an SDO_GEOMETRY polygon literal.`);
  return null;
}

function parseSourceIdList(rawValue) {
  const text = String(rawValue || '').trim();
  if (!text) return null;
  return text
    .split(',')
    .map((part) => normalizeSourceId(part))
    .filter(Boolean);
}

function normalizeEnumValue(rawValue, values) {
  const text = String(rawValue || '').trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  const match = values.find((value) => String(value).toLowerCase() === normalized);
  return match || null;
}

function normalizeFlagValue(rawValue) {
  const text = String(rawValue || '').trim().toLowerCase();
  if (!text) return null;
  if (['1', 'true', 'yes', 'y'].includes(text)) return 1;
  if (['0', 'false', 'no', 'n'].includes(text)) return 0;
  return Number.isInteger(Number(text)) ? Number(text) : null;
}

function parseColumnValue(table, column, rawValue, lineNumber, errors) {
  const text = String(rawValue ?? '');
  const trimmed = text.trim();

  if (!trimmed) {
    if (column.required) {
      errors.push(`${table.name}.csv line ${lineNumber}: "${column.name}" is required.`);
    }
    return null;
  }

  switch (column.type) {
    case 'id':
      return trimmed;
    case 'string':
      return trimmed;
    case 'number': {
      const value = Number(trimmed);
      if (!Number.isFinite(value)) {
        errors.push(`${table.name}.csv line ${lineNumber}: "${column.name}" must be numeric.`);
        return null;
      }
      return value;
    }
    case 'integer': {
      const value = Number(trimmed);
      if (!Number.isInteger(value)) {
        errors.push(`${table.name}.csv line ${lineNumber}: "${column.name}" must be an integer.`);
        return null;
      }
      return value;
    }
    case 'flag': {
      const value = normalizeFlagValue(trimmed);
      if (value == null || ![0, 1].includes(value)) {
        errors.push(`${table.name}.csv line ${lineNumber}: "${column.name}" must be 0/1, true/false, or yes/no.`);
        return null;
      }
      return value;
    }
    case 'enum': {
      const value = normalizeEnumValue(trimmed, column.values || []);
      if (!value) {
        errors.push(`${table.name}.csv line ${lineNumber}: "${column.name}" must be one of ${column.values.join(', ')}.`);
        return null;
      }
      return value;
    }
    case 'date':
      return normalizeIsoDate(trimmed, 'date', table.name, column.name, lineNumber, errors);
    case 'timestamp':
      return normalizeIsoDate(trimmed, 'timestamp', table.name, column.name, lineNumber, errors);
    case 'geometry_wkt':
      return normalizeGeometryText(trimmed, table.name, lineNumber, column.name, errors);
    case 'source_id_list':
      return parseSourceIdList(trimmed);
    default:
      return trimmed;
  }
}

function parseCsvTable(table, csvText, errors) {
  let records;
  try {
    records = parseCsvSync(csvText, {
      bom: true,
      relax_quotes: true,
      skip_empty_lines: true,
    });
  } catch (err) {
    errors.push(`${table.name}.csv could not be parsed as CSV: ${err.message}`);
    return { header: [], rows: [], sourceIds: new Set() };
  }

  if (!records.length) {
    errors.push(`${table.name}.csv is empty.`);
    return { header: [], rows: [], sourceIds: new Set() };
  }

  const expectedHeader = table.columns.map((column) => column.name);
  const actualHeader = records[0].map((value) => String(value ?? '').trim());

  if (actualHeader.length !== expectedHeader.length || actualHeader.some((value, index) => value !== expectedHeader[index])) {
    errors.push(
      `${table.name}.csv header mismatch. Expected "${expectedHeader.join(',')}" but received "${actualHeader.join(',')}".`
    );
    return { header: actualHeader, rows: [], sourceIds: new Set() };
  }

  const rows = [];
  const sourceIds = new Set();

  for (let rowIndex = 1; rowIndex < records.length; rowIndex += 1) {
    const record = records[rowIndex];
    const lineNumber = rowIndex + 1;

    if (isRowEmpty(record)) continue;
    if (record.length !== expectedHeader.length) {
      errors.push(`${table.name}.csv line ${lineNumber}: expected ${expectedHeader.length} columns but received ${record.length}.`);
      continue;
    }

    const row = { __lineNumber: lineNumber };
    for (let columnIndex = 0; columnIndex < table.columns.length; columnIndex += 1) {
      const column = table.columns[columnIndex];
      row[column.name] = parseColumnValue(table, column, record[columnIndex], lineNumber, errors);
    }

    row.__sourceId = normalizeSourceId(row[table.pk]);

    if (sourceIds.has(row.__sourceId)) {
      errors.push(`${table.name}.csv line ${lineNumber}: duplicate source ID "${row.__sourceId}".`);
    } else {
      sourceIds.add(row.__sourceId);
    }

    rows.push(row);
  }

  return { header: actualHeader, rows, sourceIds };
}

function validateUniqueKeys(table, tableData, errors) {
  for (const keyColumns of table.uniqueKeys || []) {
    const seen = new Map();

    for (const row of tableData.rows) {
      const values = keyColumns.map((columnName) => row[columnName]);
      if (values.some((value) => value == null || value === '')) continue;

      const key = values.map((value) => Array.isArray(value) ? value.join('|') : String(value)).join('::');
      const previous = seen.get(key);
      if (previous) {
        errors.push(
          `${table.name}.csv lines ${previous} and ${row.__lineNumber}: duplicate unique key on (${keyColumns.join(', ')}).`
        );
      } else {
        seen.set(key, row.__lineNumber);
      }
    }
  }
}

function validateCrossTableReferences(dataset, errors, warnings) {
  const sourceIdsByTable = Object.fromEntries(
    Object.entries(dataset.tables).map(([tableName, tableData]) => [tableName, tableData.sourceIds])
  );

  for (const table of TABLES) {
    const tableData = dataset.tables[table.name];
    if (!tableData?.provided) continue;

    validateUniqueKeys(table, tableData, errors);

    for (const fk of table.foreignKeys || []) {
      const refSourceIds = sourceIdsByTable[fk.refTable] || new Set();
      for (const row of tableData.rows) {
        const value = row[fk.column];
        if (value == null || value === '') {
          if (!fk.allowNull) {
            errors.push(`${table.name}.csv line ${row.__lineNumber}: "${fk.column}" is required.`);
          }
          continue;
        }

        if (!refSourceIds.has(normalizeSourceId(value))) {
          errors.push(
            `${table.name}.csv line ${row.__lineNumber}: "${fk.column}" references missing ${fk.refTable}.${TABLE_BY_NAME[fk.refTable].pk} value "${value}".`
          );
        }
      }
    }

    for (const column of table.columns) {
      if (column.type !== 'source_id_list' || !column.refTable) continue;
      const refSourceIds = sourceIdsByTable[column.refTable] || new Set();
      for (const row of tableData.rows) {
        const values = row[column.name];
        if (!Array.isArray(values)) continue;
        for (const value of values) {
          if (!refSourceIds.has(normalizeSourceId(value))) {
            errors.push(
              `${table.name}.csv line ${row.__lineNumber}: "${column.name}" references missing ${column.refTable}.${TABLE_BY_NAME[column.refTable].pk} value "${value}".`
            );
          }
        }
      }
    }
  }

  const demandRegions = dataset.tables.demand_regions;
  const demandForecasts = dataset.tables.demand_forecasts;
  if (demandForecasts?.provided) {
    if (demandRegions?.provided) {
      const regionNames = new Set(
        demandRegions.rows.map((row) => String(row.region_name || '').trim().toLowerCase()).filter(Boolean)
      );
      for (const row of demandForecasts.rows) {
        const regionName = String(row.region || '').trim();
        if (regionName && !regionNames.has(regionName.toLowerCase())) {
          errors.push(
            `demand_forecasts.csv line ${row.__lineNumber}: region "${regionName}" does not exist in demand_regions.csv.`
          );
        }
      }
    } else {
      warnings.push('demand_forecasts.csv was provided without demand_regions.csv. Region names were not cross-checked.');
    }
  }
}

function parseArchiveDataset(buffer, version) {
  const zip = loadArchive(buffer);
  const files = listArchiveFiles(zip);
  const manifest = parseManifest(files, version);
  const errors = [];
  const warnings = [];
  const tables = {};
  const counts = {};

  for (const requiredTable of REQUIRED_TABLE_NAMES) {
    if (!files.has(`${requiredTable}.csv`)) {
      errors.push(`ZIP is missing required file "${requiredTable}.csv".`);
    }
  }

  for (const optionalTable of OPTIONAL_TABLE_NAMES) {
    if (!files.has(`${optionalTable}.csv`)) {
      warnings.push(`Optional file "${optionalTable}.csv" is missing. The importer will regenerate fallback data.`);
    }
  }

  for (const table of TABLES) {
    const entry = files.get(`${table.name}.csv`);
    if (!entry) {
      tables[table.name] = {
        table,
        provided: false,
        rows: [],
        sourceIds: new Set(),
      };
      counts[table.name] = 0;
      continue;
    }

    const csvText = entry.getData().toString('utf8');
    const parsed = parseCsvTable(table, csvText, errors);
    tables[table.name] = {
      table,
      provided: true,
      rows: parsed.rows,
      sourceIds: parsed.sourceIds,
      header: parsed.header,
      entryName: entry.entryName,
    };
    counts[table.name] = parsed.rows.length;
  }

  const dataset = {
    version: String(manifest.version || version || IMPORT_VERSION),
    manifest,
    tables,
    counts,
  };

  validateCrossTableReferences(dataset, errors, warnings);

  return {
    valid: errors.length === 0,
    message: errors.length
      ? `Validation failed with ${errors.length} issue(s).`
      : `Archive parsed successfully with ${Object.values(tables).filter((tableData) => tableData.provided).length} CSV file(s).`,
    errors,
    warnings,
    counts,
    dataset: errors.length === 0 ? dataset : null,
  };
}

function getBundledDemoDataset(version = IMPORT_VERSION) {
  if (version !== IMPORT_VERSION) {
    throw new ImportError(`Unsupported import template version "${version}".`, 400);
  }

  if (!cachedBundledDemoDataset) {
    const archive = getBundledDemoArchive();
    const parsed = parseArchiveDataset(archive.buffer, version);
    if (!parsed.valid) {
      throw new ImportError('Bundled demo dataset is invalid.', 500, {
        errors: parsed.errors,
        warnings: parsed.warnings,
        counts: parsed.counts,
      });
    }
    cachedBundledDemoDataset = { archive, parsed };
  }

  return cachedBundledDemoDataset;
}

async function execSql(connection, sql, binds = {}, options = {}) {
  return connection.execute(sql, binds, {
    autoCommit: false,
    ...options,
  });
}

function getInsertStatement(table) {
  if (INSERT_SQL_CACHE.has(table.name)) {
    return INSERT_SQL_CACHE.get(table.name);
  }

  const dataColumns = table.columns.filter((column) => !column.sourceId);
  const columnList = dataColumns.map((column) => column.name).join(', ');
  const valueList = dataColumns.map((column) => {
    if (table.name === 'demand_regions' && column.name === 'boundary') {
      return 'SDO_UTIL.FROM_WKTGEOMETRY(:boundary)';
    }
    return `:${column.name}`;
  }).join(', ');

  const sql = [
    `INSERT INTO ${table.name} (${columnList})`,
    `VALUES (${valueList})`,
    `RETURNING ${table.pk} INTO :generatedId`,
  ].join(' ');

  INSERT_SQL_CACHE.set(table.name, sql);
  return sql;
}

function resolveMappedValue(value, refTable, idMaps, tableName, columnName, lineNumber) {
  if (value == null || value === '') return null;
  const refMap = idMaps[refTable];
  const actualId = refMap?.get(normalizeSourceId(value));
  if (actualId == null) {
    throw new ImportError(
      `${tableName}.csv line ${lineNumber}: "${columnName}" could not be mapped to imported ${refTable} row "${value}".`
    );
  }
  return actualId;
}

function resolveInsertValue(table, column, row, idMaps) {
  const value = row[column.name];
  if (value == null) return null;

  const fk = (table.foreignKeys || []).find((item) => item.column === column.name);
  if (fk) {
    return resolveMappedValue(value, fk.refTable, idMaps, table.name, column.name, row.__lineNumber);
  }

  if (column.type === 'source_id_list') {
    const refMap = idMaps[column.refTable];
    return value
      .map((item) => {
        const actualId = refMap?.get(normalizeSourceId(item));
        if (actualId == null) {
          throw new ImportError(
            `${table.name}.csv line ${row.__lineNumber}: "${column.name}" could not map source ID "${item}" to ${column.refTable}.`
          );
        }
        return actualId;
      })
      .join(',');
  }

  return value;
}

async function insertImportedRow(connection, table, row, idMaps) {
  const binds = {};
  for (const column of table.columns) {
    if (column.sourceId) continue;
    binds[column.name] = resolveInsertValue(table, column, row, idMaps);
  }
  binds.generatedId = { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER };

  const result = await execSql(connection, getInsertStatement(table), binds);
  return firstOutBind(result.outBinds.generatedId);
}

function buildSourceRowMap(rows, keyName) {
  return new Map(rows.map((row) => [normalizeSourceId(row[keyName]), row]));
}

function pickOrderTimestamp(row) {
  return row.created_at || row.updated_at || new Date();
}

function hashString(input) {
  let hash = 0;
  const text = String(input || '');
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const inputs = [lat1, lon1, lat2, lon2].map(Number);
  if (inputs.some((value) => !Number.isFinite(value))) return null;
  const [aLat, aLon, bLat, bLon] = inputs;
  const toRad = (degrees) => degrees * Math.PI / 180;
  const earthKm = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const base =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthKm * Math.atan2(Math.sqrt(base), Math.sqrt(1 - base));
}

async function deleteExistingImportData(connection) {
  for (const tableName of DELETE_ORDER) {
    await execSql(connection, `DELETE FROM ${tableName}`);
  }
}

async function insertProvidedTables(connection, dataset, progress) {
  const idMaps = {};
  const insertedCounts = {};
  const activeTables = INSERT_ORDER.filter((tableName) => dataset.tables[tableName]?.provided);

  for (let tableIndex = 0; tableIndex < activeTables.length; tableIndex += 1) {
    const tableName = activeTables[tableIndex];
    const table = TABLE_BY_NAME[tableName];
    const tableData = dataset.tables[tableName];
    const idMap = new Map();
    idMaps[tableName] = idMap;

    if (progress) {
      progress({
        status: 'running',
        progress: 20 + Math.round((tableIndex / Math.max(activeTables.length, 1)) * 35),
        message: `Importing ${tableName}.csv...`,
      });
    }

    for (const row of tableData.rows) {
      const generatedId = await insertImportedRow(connection, table, row, idMaps);
      idMap.set(row.__sourceId, generatedId);
    }

    insertedCounts[tableName] = tableData.rows.length;
  }

  return { idMaps, insertedCounts };
}

async function rebuildSpatialLocations(connection) {
  await execSql(connection, `
    UPDATE fulfillment_centers
    SET location = SDO_GEOMETRY(2001, 4326, SDO_POINT_TYPE(longitude, latitude, NULL), NULL, NULL)
    WHERE latitude IS NOT NULL
      AND longitude IS NOT NULL
  `);

  await execSql(connection, `
    UPDATE customers
    SET location = SDO_GEOMETRY(2001, 4326, SDO_POINT_TYPE(longitude, latitude, NULL), NULL, NULL)
    WHERE latitude IS NOT NULL
      AND longitude IS NOT NULL
  `);
}

async function rebuildFulfillmentZones(connection) {
  await execSql(connection, 'DELETE FROM fulfillment_zones');

  const tiers = [
    { zoneType: 'express', maxHrs: 8, meters: 80000 },
    { zoneType: 'overnight', maxHrs: 16, meters: 160000 },
    { zoneType: 'standard', maxHrs: 24, meters: 250000 },
    { zoneType: 'economy', maxHrs: 72, meters: 500000 },
  ];

  let inserted = 0;
  for (const tier of tiers) {
    const result = await execSql(connection, `
      INSERT INTO fulfillment_zones (center_id, zone_type, max_delivery_hrs, zone_boundary)
      SELECT center_id, :zoneType, :maxHrs,
             SDO_GEOM.SDO_BUFFER(location, :meters, 1, 'unit=METER')
      FROM fulfillment_centers
      WHERE is_active = 1
        AND location IS NOT NULL
    `, tier);
    inserted += result.rowsAffected || 0;
  }

  return inserted;
}

function buildFallbackBrandLinks(dataset) {
  const posts = dataset.tables.social_posts.rows;
  const mentions = dataset.tables.post_product_mentions.rows;
  const productsById = buildSourceRowMap(dataset.tables.products.rows, 'product_id');
  const postsById = buildSourceRowMap(posts, 'post_id');
  const orderItems = dataset.tables.order_items.rows;
  const orders = dataset.tables.orders.rows;

  const mentionsByPost = new Map();
  for (const mention of mentions) {
    const postKey = normalizeSourceId(mention.post_id);
    const existing = mentionsByPost.get(postKey) || [];
    existing.push(mention);
    mentionsByPost.set(postKey, existing);
  }

  const orderItemsByOrderAndBrand = new Map();
  for (const item of orderItems) {
    const product = productsById.get(normalizeSourceId(item.product_id));
    if (!product) continue;
    const key = `${normalizeSourceId(item.order_id)}::${normalizeSourceId(product.brand_id)}`;
    const lineValue = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
    orderItemsByOrderAndBrand.set(key, (orderItemsByOrderAndBrand.get(key) || 0) + lineValue);
  }

  const ordersBySocialSource = new Map();
  for (const order of orders) {
    if (!order.social_source_id) continue;
    const key = normalizeSourceId(order.social_source_id);
    const existing = ordersBySocialSource.get(key) || [];
    existing.push(order);
    ordersBySocialSource.set(key, existing);
  }

  const groups = new Map();
  for (const post of posts) {
    const influencerId = normalizeSourceId(post.influencer_id);
    if (!influencerId) continue;

    const postMentions = mentionsByPost.get(normalizeSourceId(post.post_id)) || [];
    const brandIds = new Set();
    for (const mention of postMentions) {
      const product = productsById.get(normalizeSourceId(mention.product_id));
      if (product?.brand_id) {
        brandIds.add(normalizeSourceId(product.brand_id));
      }
    }

    const engagement = (() => {
      const likes = Number(post.likes_count) || 0;
      const shares = Number(post.shares_count) || 0;
      const comments = Number(post.comments_count) || 0;
      const views = Number(post.views_count) || 0;
      return views > 0 ? roundTo((likes + (shares * 2) + (comments * 2)) / views, 4) : 0;
    })();

    for (const brandId of brandIds) {
      const key = `${brandId}::${influencerId}`;
      const group = groups.get(key) || {
        brandId,
        influencerId,
        postIds: new Set(),
        engagementTotal: 0,
        revenueAttributed: 0,
        firstMention: null,
        lastMention: null,
      };

      group.postIds.add(normalizeSourceId(post.post_id));
      group.engagementTotal += engagement;
      group.firstMention = !group.firstMention || post.posted_at < group.firstMention ? post.posted_at : group.firstMention;
      group.lastMention = !group.lastMention || post.posted_at > group.lastMention ? post.posted_at : group.lastMention;

      const attributedOrders = ordersBySocialSource.get(normalizeSourceId(post.post_id)) || [];
      for (const order of attributedOrders) {
        const revenueKey = `${normalizeSourceId(order.order_id)}::${brandId}`;
        group.revenueAttributed += orderItemsByOrderAndBrand.get(revenueKey) || 0;
      }

      groups.set(key, group);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      brandId: group.brandId,
      influencerId: group.influencerId,
      relationshipType: 'organic',
      postCount: group.postIds.size,
      avgEngagement: group.postIds.size ? roundTo(group.engagementTotal / group.postIds.size, 4) : 0,
      revenueAttributed: roundTo(group.revenueAttributed, 2) || 0,
      firstMention: group.firstMention,
      lastMention: group.lastMention,
    }))
    .filter((row) => row.postCount > 0);
}

function buildFallbackInfluencerConnections(dataset) {
  const influencerRows = dataset.tables.influencers.rows;
  const posts = dataset.tables.social_posts.rows;
  const mentions = dataset.tables.post_product_mentions.rows;
  const productsById = buildSourceRowMap(dataset.tables.products.rows, 'product_id');
  const influencersById = buildSourceRowMap(influencerRows, 'influencer_id');
  const postsById = buildSourceRowMap(posts, 'post_id');

  const brandsByInfluencer = new Map();
  const activityByInfluencer = new Map();

  for (const mention of mentions) {
    const post = postsById.get(normalizeSourceId(mention.post_id));
    const product = productsById.get(normalizeSourceId(mention.product_id));
    if (!post?.influencer_id || !product?.brand_id) continue;

    const influencerId = normalizeSourceId(post.influencer_id);
    const brandId = normalizeSourceId(product.brand_id);

    const brands = brandsByInfluencer.get(influencerId) || new Set();
    brands.add(brandId);
    brandsByInfluencer.set(influencerId, brands);

    const activity = activityByInfluencer.get(influencerId) || { firstSeen: null, lastSeen: null, posts: 0 };
    activity.posts += 1;
    activity.firstSeen = !activity.firstSeen || post.posted_at < activity.firstSeen ? post.posted_at : activity.firstSeen;
    activity.lastSeen = !activity.lastSeen || post.posted_at > activity.lastSeen ? post.posted_at : activity.lastSeen;
    activityByInfluencer.set(influencerId, activity);
  }

  const influencerIds = influencerRows.map((row) => normalizeSourceId(row.influencer_id));
  const edges = [];

  for (let left = 0; left < influencerIds.length; left += 1) {
    for (let right = left + 1; right < influencerIds.length; right += 1) {
      const fromId = influencerIds[left];
      const toId = influencerIds[right];
      const leftBrands = brandsByInfluencer.get(fromId) || new Set();
      const rightBrands = brandsByInfluencer.get(toId) || new Set();
      const sharedBrands = [...leftBrands].filter((brandId) => rightBrands.has(brandId));
      if (!sharedBrands.length) continue;

      const leftActivity = activityByInfluencer.get(fromId) || { posts: 0, firstSeen: null, lastSeen: null };
      const rightActivity = activityByInfluencer.get(toId) || { posts: 0, firstSeen: null, lastSeen: null };

      edges.push({
        fromInfluencer: fromId,
        toInfluencer: toId,
        connectionType: sharedBrands.length > 1 ? 'collaborates' : 'mentioned',
        strength: roundTo(Math.min(0.95, 0.35 + (sharedBrands.length * 0.2)), 3),
        interactionCount: sharedBrands.length + Math.min(leftActivity.posts, rightActivity.posts),
        firstSeen: leftActivity.firstSeen && rightActivity.firstSeen
          ? (leftActivity.firstSeen < rightActivity.firstSeen ? leftActivity.firstSeen : rightActivity.firstSeen)
          : (leftActivity.firstSeen || rightActivity.firstSeen || null),
        lastInteraction: leftActivity.lastSeen && rightActivity.lastSeen
          ? (leftActivity.lastSeen > rightActivity.lastSeen ? leftActivity.lastSeen : rightActivity.lastSeen)
          : (leftActivity.lastSeen || rightActivity.lastSeen || null),
      });
    }
  }

  if (!edges.length && influencerIds.length > 1) {
    const sortedInfluencers = [...influencerRows].sort((a, b) => {
      const scoreDelta = (Number(b.influence_score) || 0) - (Number(a.influence_score) || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return normalizeSourceId(a.influencer_id).localeCompare(normalizeSourceId(b.influencer_id));
    });

    for (let index = 0; index < sortedInfluencers.length - 1; index += 1) {
      const current = sortedInfluencers[index];
      const next = sortedInfluencers[index + 1];
      edges.push({
        fromInfluencer: normalizeSourceId(current.influencer_id),
        toInfluencer: normalizeSourceId(next.influencer_id),
        connectionType: 'follows',
        strength: 0.4,
        interactionCount: 1,
        firstSeen: current.created_at || next.created_at || null,
        lastInteraction: current.created_at || next.created_at || null,
      });
    }
  }

  return edges.slice(0, 500);
}

function buildFallbackDemandRegions(dataset) {
  const customers = dataset.tables.customers.rows;
  const orders = dataset.tables.orders.rows;
  const customersById = buildSourceRowMap(customers, 'customer_id');
  const groups = new Map();

  for (const customer of customers) {
    if (!Number.isFinite(Number(customer.latitude)) || !Number.isFinite(Number(customer.longitude))) continue;

    const city = String(customer.city || '').trim();
    const state = String(customer.state_province || '').trim();
    const country = String(customer.country || 'US').trim();
    const key = city && state ? `${city}|${state}|${country}` : `${state || country}|${country}`;
    const label = city && state ? `${city}, ${state}` : `${state || country} Region`;

    const group = groups.get(key) || {
      regionName: label,
      regionType: 'metro',
      minLat: Number(customer.latitude),
      maxLat: Number(customer.latitude),
      minLon: Number(customer.longitude),
      maxLon: Number(customer.longitude),
      customerCount: 0,
      lifetimeValueTotal: 0,
      orderCount: 0,
      socialOrderCount: 0,
      revenue: 0,
    };

    group.customerCount += 1;
    group.lifetimeValueTotal += Number(customer.lifetime_value) || 0;
    group.minLat = Math.min(group.minLat, Number(customer.latitude));
    group.maxLat = Math.max(group.maxLat, Number(customer.latitude));
    group.minLon = Math.min(group.minLon, Number(customer.longitude));
    group.maxLon = Math.max(group.maxLon, Number(customer.longitude));
    groups.set(key, group);
  }

  for (const order of orders) {
    const customer = customersById.get(normalizeSourceId(order.customer_id));
    if (!customer) continue;
    const city = String(customer.city || '').trim();
    const state = String(customer.state_province || '').trim();
    const country = String(customer.country || 'US').trim();
    const key = city && state ? `${city}|${state}|${country}` : `${state || country}|${country}`;
    const group = groups.get(key);
    if (!group) continue;

    group.orderCount += 1;
    if (order.social_source_id) group.socialOrderCount += 1;
    group.revenue += Number(order.order_total) || 0;
  }

  return [...groups.values()]
    .map((group) => {
      const latPadding = Math.max(0.15, (group.maxLat - group.minLat) * 0.2);
      const lonPadding = Math.max(0.15, (group.maxLon - group.minLon) * 0.2);
      const minLat = Math.max(-89.9, group.minLat - latPadding);
      const maxLat = Math.min(89.9, group.maxLat + latPadding);
      const minLon = Math.max(-179.9, group.minLon - lonPadding);
      const maxLon = Math.min(179.9, group.maxLon + lonPadding);
      const avgLifetimeValue = group.customerCount ? group.lifetimeValueTotal / group.customerCount : 0;

      return {
        regionName: group.regionName,
        regionType: group.regionType,
        boundaryWkt: `POLYGON((${minLon} ${minLat}, ${maxLon} ${minLat}, ${maxLon} ${maxLat}, ${minLon} ${maxLat}, ${minLon} ${minLat}))`,
        population: Math.max(group.customerCount * 10000, group.customerCount),
        avgIncome: roundTo(Math.max(45000, avgLifetimeValue * 8 || 55000), 2),
        socialDensity: roundTo((group.socialOrderCount / Math.max(group.customerCount, 1)) * 100, 2) || 0,
        demandIndex: roundTo(Math.min(99, 45 + (group.orderCount * 4) + (group.socialOrderCount * 6) + (group.revenue / 1000)), 2),
      };
    })
    .sort((left, right) => {
      const indexDelta = (right.demandIndex || 0) - (left.demandIndex || 0);
      if (indexDelta !== 0) return indexDelta;
      return left.regionName.localeCompare(right.regionName);
    })
    .slice(0, 12);
}

function buildFallbackDemandForecasts(dataset, demandRegionRows) {
  if (!demandRegionRows.length) return [];

  const products = dataset.tables.products.rows;
  const orderItems = dataset.tables.order_items.rows;
  const posts = dataset.tables.social_posts.rows;
  const mentions = dataset.tables.post_product_mentions.rows;
  const postsById = buildSourceRowMap(posts, 'post_id');

  const metricsByProduct = new Map();
  for (const product of products) {
    metricsByProduct.set(normalizeSourceId(product.product_id), {
      productId: normalizeSourceId(product.product_id),
      orderedQuantity: 0,
      mentionCount: 0,
      totalVirality: 0,
      socialPostCount: 0,
    });
  }

  for (const item of orderItems) {
    const productId = normalizeSourceId(item.product_id);
    const metrics = metricsByProduct.get(productId);
    if (!metrics) continue;
    metrics.orderedQuantity += Number(item.quantity) || 0;
  }

  for (const mention of mentions) {
    const productId = normalizeSourceId(mention.product_id);
    const metrics = metricsByProduct.get(productId);
    const post = postsById.get(normalizeSourceId(mention.post_id));
    if (!metrics || !post) continue;
    metrics.mentionCount += 1;
    metrics.totalVirality += Number(post.virality_score) || 0;
    metrics.socialPostCount += 1;
  }

  const regions = demandRegionRows.slice(0, Math.min(5, demandRegionRows.length));
  const forecastDate = new Date();
  forecastDate.setHours(0, 0, 0, 0);
  const rows = [];

  for (const metrics of metricsByProduct.values()) {
    const avgVirality = metrics.socialPostCount ? metrics.totalVirality / metrics.socialPostCount : 0;
    const baseDemand = Math.max(5, Math.round((metrics.orderedQuantity * 1.2) + (metrics.mentionCount * 2) + (avgVirality / 8)));
    const socialFactor = roundTo(Math.min(3, 1 + (metrics.mentionCount / 10) + (avgVirality / 100)), 2) || 1;

    for (const region of regions) {
      const regionMultiplier = (Number(region.demandIndex) || 50) / 50;
      const predictedDemand = Math.max(5, Math.round(baseDemand * regionMultiplier));
      rows.push({
        productId: metrics.productId,
        region: region.regionName,
        forecastDate,
        predictedDemand,
        confidenceLow: Math.max(0, Math.round(predictedDemand * 0.8)),
        confidenceHigh: Math.round(predictedDemand * 1.2),
        socialFactor,
        modelVersion: 'import_fallback_v1',
        explanation: JSON.stringify({
          source: 'import_fallback_v1',
          orderedQuantity: metrics.orderedQuantity,
          mentionCount: metrics.mentionCount,
          avgVirality: roundTo(avgVirality, 2),
          regionDemandIndex: region.demandIndex,
        }),
      });
    }
  }

  return rows;
}

async function insertFallbackBrandLinks(connection, rows, idMaps) {
  let inserted = 0;
  for (const row of rows) {
    await execSql(connection, `
      INSERT INTO brand_influencer_links (
        brand_id, influencer_id, relationship_type, post_count,
        avg_engagement, revenue_attributed, first_mention, last_mention
      ) VALUES (
        :brandId, :influencerId, :relationshipType, :postCount,
        :avgEngagement, :revenueAttributed, :firstMention, :lastMention
      )
    `, {
      brandId: resolveMappedValue(row.brandId, 'brands', idMaps, 'brand_influencer_links', 'brand_id', 'fallback'),
      influencerId: resolveMappedValue(row.influencerId, 'influencers', idMaps, 'brand_influencer_links', 'influencer_id', 'fallback'),
      relationshipType: row.relationshipType,
      postCount: row.postCount,
      avgEngagement: row.avgEngagement,
      revenueAttributed: row.revenueAttributed,
      firstMention: row.firstMention,
      lastMention: row.lastMention,
    });
    inserted += 1;
  }
  return inserted;
}

async function insertFallbackInfluencerConnections(connection, rows, idMaps) {
  let inserted = 0;
  for (const row of rows) {
    await execSql(connection, `
      INSERT INTO influencer_connections (
        from_influencer, to_influencer, connection_type, strength,
        interaction_count, first_seen, last_interaction
      ) VALUES (
        :fromInfluencer, :toInfluencer, :connectionType, :strength,
        :interactionCount, :firstSeen, :lastInteraction
      )
    `, {
      fromInfluencer: resolveMappedValue(row.fromInfluencer, 'influencers', idMaps, 'influencer_connections', 'from_influencer', 'fallback'),
      toInfluencer: resolveMappedValue(row.toInfluencer, 'influencers', idMaps, 'influencer_connections', 'to_influencer', 'fallback'),
      connectionType: row.connectionType,
      strength: row.strength,
      interactionCount: row.interactionCount,
      firstSeen: row.firstSeen,
      lastInteraction: row.lastInteraction,
    });
    inserted += 1;
  }
  return inserted;
}

async function insertFallbackDemandRegions(connection, rows) {
  let inserted = 0;
  for (const row of rows) {
    await execSql(connection, `
      INSERT INTO demand_regions (
        region_name, region_type, boundary, population,
        avg_income, social_density, demand_index, updated_at
      ) VALUES (
        :regionName, :regionType, SDO_UTIL.FROM_WKTGEOMETRY(:boundaryWkt), :population,
        :avgIncome, :socialDensity, :demandIndex, SYSTIMESTAMP
      )
    `, row);
    inserted += 1;
  }
  return inserted;
}

async function insertFallbackDemandForecasts(connection, rows, idMaps) {
  let inserted = 0;
  for (const row of rows) {
    await execSql(connection, `
      INSERT INTO demand_forecasts (
        product_id, region, forecast_date, predicted_demand,
        confidence_low, confidence_high, social_factor, model_version,
        explanation, created_at
      ) VALUES (
        :productId, :region, :forecastDate, :predictedDemand,
        :confidenceLow, :confidenceHigh, :socialFactor, :modelVersion,
        :explanation, SYSTIMESTAMP
      )
    `, {
      productId: resolveMappedValue(row.productId, 'products', idMaps, 'demand_forecasts', 'product_id', 'fallback'),
      region: row.region,
      forecastDate: row.forecastDate,
      predictedDemand: row.predictedDemand,
      confidenceLow: row.confidenceLow,
      confidenceHigh: row.confidenceHigh,
      socialFactor: row.socialFactor,
      modelVersion: row.modelVersion,
      explanation: row.explanation,
    });
    inserted += 1;
  }
  return inserted;
}

async function insertFallbackShipments(connection, rows) {
  let inserted = 0;
  for (const row of rows) {
    await execSql(connection, `
      INSERT INTO shipments (
        order_id, center_id, carrier, tracking_number, ship_status,
        distance_km, estimated_hours, ship_cost, routed_at, completed_at, created_at
      ) VALUES (
        :orderId, :centerId, :carrier, :trackingNumber, :shipStatus,
        :distanceKm, :estimatedHours, :shipCost, :routedAt, :completedAt, :createdAt
      )
    `, row);
    inserted += 1;
  }
  return inserted;
}

function buildFallbackShipments(dataset, idMaps) {
  const orders = dataset.tables.orders.rows;
  const customersById = buildSourceRowMap(dataset.tables.customers.rows, 'customer_id');
  const centersById = buildSourceRowMap(dataset.tables.fulfillment_centers.rows, 'center_id');
  const carriers = ['SecureCourier', 'BranchLink', 'WireTrack', 'ClientRoute'];
  const shipStatusMap = {
    confirmed: 'preparing',
    processing: 'packed',
    routed: 'in_transit',
    completed: 'completed',
    returned: 'exception',
  };

  const rows = [];
  for (const order of orders) {
    const orderStatus = String(order.order_status || 'pending').toLowerCase();
    const centerSourceId = normalizeSourceId(order.fulfillment_center_id);
    if (!centerSourceId || ['pending', 'cancelled'].includes(orderStatus)) continue;

    const customer = customersById.get(normalizeSourceId(order.customer_id));
    const center = centersById.get(centerSourceId);
    if (!center) continue;

    const shipLat = Number.isFinite(Number(order.shipping_lat)) ? Number(order.shipping_lat) : Number(customer?.latitude);
    const shipLon = Number.isFinite(Number(order.shipping_lon)) ? Number(order.shipping_lon) : Number(customer?.longitude);
    const distanceKm = haversineKm(center.latitude, center.longitude, shipLat, shipLon);
    const estimatedHours = distanceKm == null ? null : roundTo(Math.max(1, distanceKm / 80), 1);
    const createdAt = pickOrderTimestamp(order);
    const routedAt = createdAt ? new Date(createdAt.getTime() + (6 * 60 * 60 * 1000)) : null;
    const completedAt = orderStatus === 'completed' && routedAt && estimatedHours != null
      ? new Date(routedAt.getTime() + (estimatedHours * 60 * 60 * 1000))
      : null;
    const actualOrderId = idMaps.orders.get(normalizeSourceId(order.order_id));
    const actualCenterId = idMaps.fulfillment_centers.get(centerSourceId);
    if (actualOrderId == null || actualCenterId == null) continue;

    rows.push({
      orderId: actualOrderId,
      centerId: actualCenterId,
      carrier: carriers[hashString(order.order_id) % carriers.length],
      trackingNumber: `AUTO-${String(actualOrderId).padStart(8, '0')}`,
      shipStatus: shipStatusMap[orderStatus] || 'preparing',
      distanceKm: distanceKm == null ? null : roundTo(distanceKm, 2),
      estimatedHours,
      shipCost: distanceKm == null ? 9.99 : roundTo(Math.max(4.99, distanceKm * 0.12), 2),
      routedAt,
      completedAt,
      createdAt: createdAt || new Date(),
    });
  }

  return rows;
}

async function applyOptionalFallbacks(connection, dataset, idMaps, warnings, progress) {
  const fallbackSummary = {};
  let generatedDemandRegions = [];

  if (!dataset.tables.brand_influencer_links.provided) {
    const rows = buildFallbackBrandLinks(dataset);
    fallbackSummary.brand_influencer_links = await insertFallbackBrandLinks(connection, rows, idMaps);
    if (!rows.length) warnings.push('No fallback brand_influencer_links could be derived from the uploaded posts and mentions.');
  }

  if (!dataset.tables.influencer_connections.provided) {
    const rows = buildFallbackInfluencerConnections(dataset);
    fallbackSummary.influencer_connections = await insertFallbackInfluencerConnections(connection, rows, idMaps);
    if (!rows.length) warnings.push('No fallback influencer_connections could be derived from the uploaded dataset.');
  }

  if (!dataset.tables.demand_regions.provided) {
    if (progress) {
      progress({ status: 'running', progress: 65, message: 'Generating fallback demand regions...' });
    }
    generatedDemandRegions = buildFallbackDemandRegions(dataset);
    fallbackSummary.demand_regions = await insertFallbackDemandRegions(connection, generatedDemandRegions);
    if (!generatedDemandRegions.length) warnings.push('No fallback demand_regions could be generated because client geospatial data was missing.');
  }

  if (!dataset.tables.demand_forecasts.provided) {
    if (progress) {
      progress({ status: 'running', progress: 70, message: 'Generating fallback demand forecasts...' });
    }
    const regionRows = dataset.tables.demand_regions.provided
      ? dataset.tables.demand_regions.rows.map((row) => ({
          regionName: row.region_name,
          demandIndex: row.demand_index,
        }))
      : generatedDemandRegions.map((row) => ({
          regionName: row.regionName,
          demandIndex: row.demandIndex,
        }));
    const forecastRows = buildFallbackDemandForecasts(dataset, regionRows);
    fallbackSummary.demand_forecasts = await insertFallbackDemandForecasts(connection, forecastRows, idMaps);
    if (!forecastRows.length) warnings.push('No fallback demand_forecasts could be generated.');
  }

  if (!dataset.tables.shipments.provided) {
    if (progress) {
      progress({ status: 'running', progress: 75, message: 'Generating fallback shipments...' });
    }
    const shipmentRows = buildFallbackShipments(dataset, idMaps);
    fallbackSummary.shipments = await insertFallbackShipments(connection, shipmentRows);
    if (!shipmentRows.length) warnings.push('No fallback shipments were generated because the uploaded orders did not require shipments.');
  }

  return fallbackSummary;
}

async function isVectorModelAvailable(connection) {
  try {
    const result = await execSql(connection, `
      SELECT COUNT(*) AS model_count
      FROM all_mining_models
      WHERE owner = 'ADMIN'
        AND model_name = :modelName
    `, { modelName: VECTOR_MODEL_NAME });
    return Number(result.rows[0]?.MODEL_COUNT || 0) > 0;
  } catch (_) {
    return false;
  }
}

async function regenerateVectorArtifacts(connection) {
  const summary = {};

  const productEmbeddings = await execSql(connection, `
    INSERT INTO product_embeddings (product_id, embedding_text, embedding)
    SELECT p.product_id,
           p.product_name || ' ' || NVL(p.category, '') || ' ' || NVL(p.description, '') || ' ' || b.brand_name,
           VECTOR_EMBEDDING(${VECTOR_MODEL_REFERENCE} USING
             p.product_name || ' ' || NVL(p.category, '') || ' ' || NVL(p.description, '') || ' ' || b.brand_name AS DATA)
    FROM products p
    JOIN brands b ON b.brand_id = p.brand_id
  `);
  summary.product_embeddings = productEmbeddings.rowsAffected || 0;

  const postEmbeddings = await execSql(connection, `
    INSERT INTO signal_embeddings (post_id, embedding_text, embedding)
    SELECT sp.post_id,
           SUBSTR(sp.post_text, 1, 500),
           VECTOR_EMBEDDING(${VECTOR_MODEL_REFERENCE} USING SUBSTR(sp.post_text, 1, 500) AS DATA)
    FROM social_posts sp
  `);
  summary.signal_embeddings = postEmbeddings.rowsAffected || 0;

  const semanticMatches = await execSql(connection, `
    INSERT INTO semantic_matches (post_id, product_id, similarity_score, match_rank, match_method)
    SELECT post_id, product_id, similarity_score, match_rank, 'vector'
    FROM (
      SELECT pe.post_id,
             pre.product_id,
             ROUND(1 - VECTOR_DISTANCE(pe.embedding, pre.embedding, COSINE), 5) AS similarity_score,
             ROW_NUMBER() OVER (
               PARTITION BY pe.post_id
               ORDER BY VECTOR_DISTANCE(pe.embedding, pre.embedding, COSINE)
             ) AS match_rank
      FROM signal_embeddings pe
      JOIN social_posts sp ON sp.post_id = pe.post_id
      CROSS JOIN product_embeddings pre
      WHERE sp.momentum_flag IN ('viral', 'mega_viral')
    )
    WHERE match_rank <= 3
  `);
  summary.semantic_matches = semanticMatches.rowsAffected || 0;

  return summary;
}

function summarizeCounts(insertedCounts, fallbackCounts, zonesCreated) {
  return {
    inserted: insertedCounts,
    generated: {
      ...fallbackCounts,
      fulfillment_zones: zonesCreated,
    },
  };
}

async function executeImportPlan({ dataset, dryRun = false, progress = null, refreshDemoDates = false }) {
  let connection;
  const warnings = [];

  try {
    connection = await db.getServiceConnection();

    if (progress) progress({ status: 'running', progress: 10, message: 'Clearing existing importable data...' });
    await deleteExistingImportData(connection);

    if (progress) progress({ status: 'running', progress: 20, message: 'Loading required and provided optional tables...' });
    const { idMaps, insertedCounts } = await insertProvidedTables(connection, dataset, progress);

    if (progress) progress({ status: 'running', progress: 55, message: 'Rebuilding spatial point geometry...' });
    await rebuildSpatialLocations(connection);

    const fallbackCounts = await applyOptionalFallbacks(connection, dataset, idMaps, warnings, progress);

    if (progress) progress({ status: 'running', progress: 80, message: 'Rebuilding fulfillment zones...' });
    const zonesCreated = await rebuildFulfillmentZones(connection);

    const demoDateRefresh = refreshDemoDates
      ? await refreshDemoDateWindow(connection, { requireDemoDatasetState: false })
      : null;

    const vectorAvailable = await isVectorModelAvailable(connection);
    if (!vectorAvailable) {
      warnings.push(`Oracle embedding model ${VECTOR_MODEL_NAME} is not available. Vector artifacts will be skipped.`);
    }

    const summary = summarizeCounts(insertedCounts, fallbackCounts, zonesCreated);
    if (demoDateRefresh?.shifted) {
      summary.generated = {
        ...summary.generated,
        demo_date_shift_days: demoDateRefresh.shifted_days,
      };
    }

    if (dryRun) {
      await connection.rollback();
      return {
        warnings,
        summary,
      };
    }

    if (progress) progress({ status: 'running', progress: 88, message: 'Committing imported dataset...' });
    await connection.commit();

    if (vectorAvailable) {
      try {
        if (progress) progress({ status: 'running', progress: 92, message: 'Rebuilding vector artifacts...' });
        await execSql(connection, 'SAVEPOINT import_vectors');
        summary.generated = {
          ...summary.generated,
          ...(await regenerateVectorArtifacts(connection)),
        };
        await connection.commit();
      } catch (err) {
        try {
          await execSql(connection, 'ROLLBACK TO import_vectors');
        } catch (_) {
          try { await connection.rollback(); } catch (_) {}
        }
        warnings.push(`Vector artifact rebuild was skipped after import: ${err.message}`);
      }
    }

    if (typeof nativeAiService?.invalidateReadinessCache === 'function') {
      try {
        nativeAiService.invalidateReadinessCache();
      } catch (_) {
        // Ignore readiness-cache invalidation failures; data import already succeeded.
      }
    }

    return {
      warnings,
      summary,
    };
  } catch (err) {
    if (connection) {
      try { await connection.rollback(); } catch (_) {}
    }
    if (err instanceof ImportError) throw err;
    throw new ImportError(err.message || 'Import failed.', 500);
  } finally {
    if (connection) {
      await db.releaseConnection(connection);
    }
  }
}

function formatValidationResult(result) {
  return {
    valid: result.valid,
    isValid: result.valid,
    success: result.valid,
    message: result.message,
    errors: result.errors,
    warnings: result.warnings,
    counts: result.counts,
  };
}

async function inferCurrentDatasetState() {
  const demoDataset = getBundledDemoDataset();
  let connection;

  try {
    connection = await db.getServiceConnection();
    const tableNames = Object.keys(demoDataset.parsed.counts);
    const liveCounts = {};

    for (const tableName of tableNames) {
      const result = await execSql(connection, `SELECT COUNT(*) AS cnt FROM ${tableName}`);
      liveCounts[tableName] = Number(result.rows[0]?.CNT || 0);
    }

    const matchesBundledDemo = tableNames.every(
      (tableName) => Number(demoDataset.parsed.counts[tableName] || 0) === Number(liveCounts[tableName] || 0)
    );

    return buildDatasetState(matchesBundledDemo ? 'demo' : 'custom');
  } finally {
    if (connection) {
      await db.releaseConnection(connection);
    }
  }
}

async function getActiveDataset() {
  let stored = await getStoredDatasetState();
  if (!stored) {
    stored = await saveDatasetState(await inferCurrentDatasetState());
  }

  return {
    activeDataset: stored,
    activeOperation: getActiveOperation(),
  };
}

async function persistDatasetState(source, warnings) {
  try {
    return await saveDatasetState(buildDatasetState(source));
  } catch (err) {
    warnings.push(`Active dataset metadata could not be updated: ${err.message}`);
    return null;
  }
}

async function runDatasetValidation({ parsed, fileOnly = false, lockKind, lockMessage }) {
  if (!parsed.valid) {
    return formatValidationResult(parsed);
  }

  if (fileOnly) {
    return {
      ...formatValidationResult(parsed),
      message: 'Archive structure validation passed.',
    };
  }

  acquireOperationLock(lockKind, lockMessage);
  try {
    const dryRun = await executeImportPlan({
      dataset: parsed.dataset,
      dryRun: true,
      refreshDemoDates: lockKind === 'validate_restore_demo',
    });

    return {
      ...formatValidationResult(parsed),
      valid: true,
      isValid: true,
      success: true,
      message: 'Validation passed. Dry run completed successfully.',
      warnings: [...parsed.warnings, ...dryRun.warnings],
      summary: dryRun.summary,
    };
  } catch (err) {
    if (err instanceof ImportError) {
      return {
        valid: false,
        isValid: false,
        success: false,
        message: err.message,
        errors: [err.message],
        warnings: parsed.warnings,
        counts: parsed.counts,
      };
    }
    throw err;
  } finally {
    endOperation();
  }
}

function createJobProgressHandler(jobId) {
  return (patch) => {
    updateJob(jobId, patch);
    updateOperation({
      jobId,
      progress: patch.progress,
      message: patch.message,
      status: patch.status,
    });
  };
}

function startDatasetJob({ parsed, kind, lockMessage, queuedMessage, startMessage, completeMessage, datasetSource }) {
  const lock = acquireOperationLock(kind, lockMessage);
  const job = createJob({
    operation: kind,
    message: queuedMessage,
    warnings: [...parsed.warnings],
    counts: parsed.counts,
  });

  updateOperation({
    ...lock,
    jobId: job.jobId,
    progress: 0,
    message: queuedMessage,
    status: 'queued',
  });

  setImmediate(async () => {
    try {
      updateJob(job.jobId, {
        status: 'running',
        progress: 5,
        message: startMessage,
      });
      updateOperation({
        jobId: job.jobId,
        progress: 5,
        message: startMessage,
        status: 'running',
      });

      const result = await executeImportPlan({
        dataset: parsed.dataset,
        dryRun: false,
        progress: createJobProgressHandler(job.jobId),
        refreshDemoDates: datasetSource === 'demo',
      });

      const warnings = [...result.warnings];
      const activeDataset = await persistDatasetState(datasetSource, warnings);
      await recordDatasetRefresh({
        jobId: job.jobId,
        operation: kind,
        datasetSource,
        activeDataset,
        summary: result.summary,
      });

      appendJobWarnings(job.jobId, warnings);
      updateJob(job.jobId, {
        status: 'completed',
        progress: 100,
        message: completeMessage,
        summary: result.summary,
        activeDataset,
      });
    } catch (err) {
      updateJob(job.jobId, {
        status: 'failed',
        progress: 100,
        message: err.message || 'Import failed.',
        errors: [err.message || 'Import failed.'],
      });
    } finally {
      endOperation();
    }
  });

  return {
    jobId: job.jobId,
    message: queuedMessage,
  };
}

async function generateTemplateArchive({ version = IMPORT_VERSION }) {
  if (version !== IMPORT_VERSION) {
    throw new ImportError(`Unsupported import template version "${version}".`, 400);
  }

  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(`${JSON.stringify(buildManifest(), null, 2)}\n`, 'utf8'));
  zip.addFile('README.md', Buffer.from(buildTemplateReadme(), 'utf8'));

  for (const table of TABLES) {
    const folder = table.required ? 'required' : 'optional';
    const header = `${table.columns.map((column) => csvCell(column.name)).join(',')}\n`;
    zip.addFile(`${folder}/${table.name}.csv`, Buffer.from(header, 'utf8'));
  }

  return {
    buffer: zip.toBuffer(),
    fileName: `financial-services-import-template-${version}.zip`,
    contentType: 'application/zip',
  };
}

async function validateDataset({ req, body = {}, version = IMPORT_VERSION }) {
  const fileOnly = isTrueish(req?.query?.fileOnly || body?.fileOnly);
  const archive = getArchiveBufferFromRequest({ req, body });
  const parsed = parseArchiveDataset(archive.buffer, version);

  return runDatasetValidation({
    parsed,
    fileOnly,
    lockKind: 'validate_upload',
    lockMessage: 'Validating uploaded dataset...',
  });
}

async function startImport({ req, body = {}, version = IMPORT_VERSION }) {
  const archive = getArchiveBufferFromRequest({ req, body });
  const parsed = parseArchiveDataset(archive.buffer, version);

  if (!parsed.valid) {
    throw new ImportError('Upload validation failed.', 400, {
      errors: parsed.errors,
      warnings: parsed.warnings,
      counts: parsed.counts,
    });
  }

  return startDatasetJob({
    parsed,
    kind: 'upload',
    lockMessage: 'Replacing dataset with uploaded ZIP...',
    queuedMessage: 'Import started.',
    startMessage: 'Starting dataset replacement...',
    completeMessage: 'Import completed successfully.',
    datasetSource: 'custom',
  });
}

async function validateDemoRestore({ version = IMPORT_VERSION }) {
  const demoDataset = getBundledDemoDataset(version);
  return runDatasetValidation({
    parsed: demoDataset.parsed,
    fileOnly: false,
    lockKind: 'validate_restore_demo',
    lockMessage: 'Validating demo dataset restore...',
  });
}

async function startDemoRestore({ version = IMPORT_VERSION }) {
  const demoDataset = getBundledDemoDataset(version);
  return startDatasetJob({
    parsed: demoDataset.parsed,
    kind: 'restore_demo',
    lockMessage: 'Restoring the bundled demo dataset...',
    queuedMessage: 'Demo restore started.',
    startMessage: 'Restoring bundled demo dataset...',
    completeMessage: 'Demo dataset restored successfully.',
    datasetSource: 'demo',
  });
}

async function getImportStatus({ jobId }) {
  return getJob(jobId);
}

module.exports = {
  generateTemplateArchive,
  getActiveDataset,
  validateDataset,
  startImport,
  validateDemoRestore,
  startDemoRestore,
  getImportStatus,

  // Exposed for local verification scripts.
  _private: {
    ImportError,
    buildFallbackBrandLinks,
    buildFallbackDemandForecasts,
    buildFallbackDemandRegions,
    buildFallbackInfluencerConnections,
    buildFallbackShipments,
    getBundledDemoDataset,
    parseArchiveDataset,
  },
};
