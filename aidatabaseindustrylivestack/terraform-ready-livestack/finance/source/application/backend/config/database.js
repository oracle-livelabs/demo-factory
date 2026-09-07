/**
 * Oracle AI Database 26ai Connection Pool Manager
 * Handles wallet-based pooling for Autonomous AI Database / Oracle AI Database 26ai
 */

const oracledb = require('oracledb');

// Use Thick mode when wallet-based Oracle AI Database 26ai connections are configured
// Thin mode (default in 6.x) works for some configs
let poolPromise = null;
let poolResetPromise = null;

function buildPoolConfig() {
  const required = ['ORACLE_USER', 'APP_SCHEMA_PASSWORD', 'ORACLE_CONNECTION_STRING'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required database configuration: ${missing.join(', ')}`);
  }

  const poolConfig = {
    user: process.env.ORACLE_USER,
    password: process.env.APP_SCHEMA_PASSWORD,
    connectString: process.env.ORACLE_CONNECTION_STRING,
    poolMin: parseInt(process.env.ORACLE_POOL_MIN) || 2,
    poolMax: parseInt(process.env.ORACLE_POOL_MAX) || 10,
    poolIncrement: parseInt(process.env.ORACLE_POOL_INCREMENT) || 1,
    poolTimeout: 60,
    queueMax: -1,
    queueTimeout: 60000,
    enableStatistics: true
  };

  if (process.env.ORACLE_WALLET_LOCATION) {
    poolConfig.walletLocation = process.env.ORACLE_WALLET_LOCATION;
    poolConfig.walletPassword = process.env.ORACLE_WALLET_PASSWORD;
    // Thin mode needs configDir to locate tnsnames.ora inside the wallet
    poolConfig.configDir = process.env.ORACLE_WALLET_LOCATION;
  }

  return poolConfig;
}

function isReconnectError(err) {
  const code = String(err?.code || '');
  const message = String(err?.message || '');

  return [
    'NJS-503',
    'DPI-1010',
    'DPI-1080',
    'ORA-03113',
    'ORA-03114',
    'ORA-12170',
    'ORA-12514',
    'ORA-12541',
    'ORA-12545',
  ].includes(code) || /EHOSTUNFINRA|ECONNREFUSED|ENOTFOUND|connection to host .* could not be established/i.test(message);
}

async function createPool() {
  const poolConfig = buildPoolConfig();
  poolPromise = oracledb.createPool(poolConfig);
  try {
    const pool = await poolPromise;
    console.log(`Oracle connection pool created (min: ${pool.poolMin}, max: ${pool.poolMax})`);
    return pool;
  } catch (err) {
    poolPromise = null;
    throw err;
  }
}

async function resetPool(reason = 'connection reset') {
  if (poolResetPromise) {
    return poolResetPromise;
  }

  poolResetPromise = (async () => {
    const existingPoolPromise = poolPromise;
    poolPromise = null;

    if (existingPoolPromise) {
      try {
        const existingPool = await existingPoolPromise;
        await existingPool.close(10);
        console.warn(`Oracle connection pool reset (${reason})`);
      } catch (err) {
        console.warn('Error closing stale Oracle pool:', err.message || err);
      }
    }

    return createPool();
  })();

  try {
    return await poolResetPromise;
  } finally {
    poolResetPromise = null;
  }
}

async function initialize() {
  try {
    // If using wallet, initialize thick mode
    if (process.env.ORACLE_WALLET_LOCATION && process.env.ORACLE_CLIENT_MODE !== 'thin') {
      try {
        oracledb.initOracleClient({
          libDir: process.env.ORACLE_CLIENT_DIR || undefined,
          configDir: process.env.ORACLE_WALLET_LOCATION
        });
        console.log('Oracle Thick mode initialized with wallet');
      } catch (err) {
        // Thick mode may already be initialized
        if (!err.message.includes('already initialized')) {
          console.warn('Thick mode init warning:', err.message);
        }
      }
    }

    if (poolPromise) {
      return poolPromise;
    }

    const pool = await createPool();

    // Set default output format
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    oracledb.autoCommit = true;
    oracledb.fetchAsString = [oracledb.CLOB];

    return pool;
  } catch (err) {
    console.error('Failed to create Oracle connection pool:', err);
    throw err;
  }
}

async function getConnection() {
  if (!poolPromise) {
    await initialize();
  }

  try {
    const pool = await poolPromise;
    const connection = await pool.getConnection();
    await connection.ping();
    return connection;
  } catch (err) {
    if (isReconnectError(err)) {
      await resetPool(err.code || err.message || 'connection failure');
      const pool = await poolPromise;
      const connection = await pool.getConnection();
      await connection.ping();
      return connection;
    }
    throw err;
  }
}

async function closePool() {
  if (poolPromise) {
    try {
      const pool = await poolPromise;
      await pool.close(10);
      console.log('Oracle connection pool closed');
    } catch (err) {
      console.error('Error closing pool:', err);
    } finally {
      poolPromise = null;
    }
  }
}

const SET_DEMO_CONTEXT_SQL = 'BEGIN sc_security_ctx.set_user_context(:username); END;';
const CLEAR_DEMO_CONTEXT_SQL = 'BEGIN sc_security_ctx.clear_user_context; END;';

function normalizeDemoUsername(username, { serviceDefault = false } = {}) {
  const value = String(
    username || (serviceDefault ? process.env.ORACLE_SERVICE_DEMO_USER || 'admin_jess' : '')
  ).trim();
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(value)) {
    throw new Error('A valid demo user context is required for this database operation.');
  }
  return value;
}

async function establishDemoContext(connection, username, options = {}) {
  const effectiveUsername = normalizeDemoUsername(username, options);
  await connection.execute(SET_DEMO_CONTEXT_SQL, { username: effectiveUsername });
}

async function scrubAndClose(connection) {
  if (!connection) return;
  connection.callTimeout = 0;
  let dropConnection = false;
  try {
    await connection.execute(CLEAR_DEMO_CONTEXT_SQL);
  } catch (error) {
    dropConnection = true;
    console.error('Failed to scrub pooled Oracle demo context; dropping the connection:', error.message);
  }
  try {
    if (dropConnection) {
      await connection.close({ drop: true });
    } else {
      await connection.close();
    }
  } catch (error) {
    console.error('Error closing Oracle connection:', error.message);
  }
}

async function getServiceConnection() {
  let connection;
  try {
    connection = await getConnection();
    await establishDemoContext(connection, null, { serviceDefault: true });
    return connection;
  } catch (error) {
    await scrubAndClose(connection);
    throw error;
  }
}

async function releaseConnection(connection) {
  await scrubAndClose(connection);
}

/**
 * Execute a query with automatic connection management
 */
async function execute(sql, binds = {}, options = {}) {
  let connection;
  const { callTimeout, ...executeOptions } = options;
  try {
    connection = await getConnection();
    if (Number.isFinite(callTimeout) && callTimeout > 0) {
      connection.callTimeout = callTimeout;
    }
    // Plain application queries run under one explicit service-demo identity.
    // This prevents them from inheriting a previous request's package state.
    await establishDemoContext(connection, null, { serviceDefault: true });
    const result = await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      ...executeOptions
    });
    return result;
  } finally {
    await scrubAndClose(connection);
  }
}

/**
 * Execute a query with VPD user context set on the same connection.
 * Calls sc_security_ctx.set_user_context(username) before running the query
 * so Oracle VPD policies filter rows based on the user's role/region.
 */
async function executeAsUser(sql, binds = {}, username = null, options = {}) {
  let connection;
  const { callTimeout, ...executeOptions } = options;
  const effectiveUsername = normalizeDemoUsername(username);
  try {
    connection = await getConnection();
    if (Number.isFinite(callTimeout) && callTimeout > 0) {
      connection.callTimeout = callTimeout;
    }
    await establishDemoContext(connection, effectiveUsername);
    const result = await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      ...executeOptions
    });
    return result;
  } finally {
    await scrubAndClose(connection);
  }
}

/**
 * Execute a PL/SQL block with VPD user context and consume a returned
 * SYS_REFCURSOR before closing the pooled connection.
 */
async function executeCursorAsUser(sql, binds = {}, cursorBindName = 'cursor', username = null, options = {}) {
  let connection;
  let resultSet;
  const { maxRows = 1000, ...executeOptions } = options;
  const effectiveUsername = normalizeDemoUsername(username);

  try {
    connection = await getConnection();
    await establishDemoContext(connection, effectiveUsername);

    const result = await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      ...executeOptions
    });

    resultSet = result.outBinds?.[cursorBindName];
    if (!resultSet || typeof resultSet.getRows !== 'function') {
      throw new Error(`PL/SQL block did not return cursor bind "${cursorBindName}"`);
    }

    const rows = await resultSet.getRows(maxRows);
    return { ...result, rows };
  } finally {
    if (resultSet) {
      try { await resultSet.close(); } catch (e) { /* ignore */ }
    }
    await scrubAndClose(connection);
  }
}

/**
 * Execute a PL/SQL procedure
 */
async function callProcedure(sql, binds = {}) {
  let connection;
  try {
    connection = await getConnection();
    await establishDemoContext(connection, null, { serviceDefault: true });
    const result = await connection.execute(sql, binds);
    return result;
  } finally {
    await scrubAndClose(connection);
  }
}

module.exports = {
  initialize,
  getServiceConnection,
  releaseConnection,
  closePool,
  execute,
  executeAsUser,
  executeCursorAsUser,
  callProcedure,
  oracledb
};
