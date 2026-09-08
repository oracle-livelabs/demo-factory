const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { oracledb } = require('../config/database');
const db = require('../config/database');

const router = express.Router();
const DEFAULT_REGION = 'us-east-1';
const DEFAULT_WALLET_DIR = '/wallet';
const CATALOG_NAME = 'GLUE_CAT';
const CREDENTIAL_NAME = 'AWS_CRED';

function cleanText(value) {
  return String(value || '').trim();
}

function targetConfig() {
  return {
    connectString: cleanText(process.env.ADB_CONNECTION_STRING)
      || cleanText(process.env.DBCONNECTION)
      || cleanText(process.env.ADB_SERVICE_NAME)
      || cleanText(process.env.SERVICE_NAME),
    password: process.env.ADB_ADMIN_PASSWORD || process.env.DBPASSWORD || '',
    walletDir: cleanText(process.env.ADB_WALLET_DIR) || DEFAULT_WALLET_DIR,
    walletPassword: process.env.ADB_WALLET_PASSWORD || process.env.ORACLE_WALLET_PASSWORD || '',
  };
}

function validateRequest({ accessKeyId, secretAccessKey, region }) {
  const normalized = {
    accessKeyId: cleanText(accessKeyId),
    secretAccessKey: cleanText(secretAccessKey),
    region: cleanText(region) || DEFAULT_REGION,
  };

  if (!/^[A-Za-z0-9]{8,256}$/.test(normalized.accessKeyId)) {
    throw new Error('Enter a valid AWS access key ID.');
  }
  if (normalized.secretAccessKey.length < 8 || normalized.secretAccessKey.length > 256) {
    throw new Error('Enter a valid AWS secret access key.');
  }
  if (!/^[a-z0-9-]{3,64}$/.test(normalized.region)) {
    throw new Error('Enter a valid AWS region, for example us-east-1.');
  }

  return normalized;
}

async function hasWalletDirectory(walletDir) {
  try {
    const checks = await Promise.all(['tnsnames.ora', 'sqlnet.ora'].map(async (fileName) => {
      const stat = await fs.stat(path.join(walletDir, fileName));
      return stat.isFile() && stat.size > 0;
    }));
    return checks.every(Boolean);
  } catch {
    return false;
  }
}

async function requireAdminDemoUser(req) {
  const username = cleanText(req.demoUser);
  if (!username) return false;

  const result = await db.execute(
    `SELECT role
       FROM app_users
      WHERE username = :username
        AND is_active = 1`,
    { username },
  );
  const role = result.rows?.[0]?.ROLE ?? result.rows?.[0]?.role;
  return String(role || '').toLowerCase() === 'admin';
}

async function withTargetAdminConnection(action) {
  const config = targetConfig();
  if (!config.connectString || !config.password) {
    const err = new Error('Autonomous Database ADMIN connection is not configured.');
    err.statusCode = 503;
    throw err;
  }
  if (!(await hasWalletDirectory(config.walletDir))) {
    const err = new Error('The Autonomous Database wallet is not available to the application.');
    err.statusCode = 503;
    throw err;
  }

  let connection;
  try {
    connection = await oracledb.getConnection({
      user: 'ADMIN',
      password: config.password,
      connectString: config.connectString,
      configDir: config.walletDir,
      ...(config.walletPassword ? {
        walletLocation: config.walletDir,
        walletPassword: config.walletPassword,
      } : {}),
    });
    return await action(connection);
  } finally {
    if (connection) {
      try { await connection.close(); } catch (_) { /* ignore close failures */ }
    }
  }
}

async function configureGlueCatalog({ accessKeyId, secretAccessKey, region }) {
  await withTargetAdminConnection(async (connection) => {
    await connection.execute(
      `BEGIN
         DBMS_NETWORK_ACL_ADMIN.APPEND_HOST_ACE(
           host       => :s3Host,
           lower_port => 443,
           upper_port => 443,
           ace        => XS$ACE_TYPE(
             privilege_list => XS$NAME_LIST('http'),
             principal_name => 'ADMIN',
             principal_type => XS_ACL.PTYPE_DB
           )
         );
       END;`,
      { s3Host: `s3.${region}.amazonaws.com` },
    );

    await connection.execute(
      `BEGIN
         DBMS_NETWORK_ACL_ADMIN.APPEND_HOST_ACE(
           host       => '*.amazonaws.com',
           lower_port => 443,
           upper_port => 443,
           ace        => XS$ACE_TYPE(
             privilege_list => XS$NAME_LIST('http', 'http_proxy'),
             principal_name => 'ADMIN',
             principal_type => XS_ACL.PTYPE_DB
           )
         );
       END;`,
    );

    await connection.execute(
      `BEGIN
         BEGIN
           DBMS_CATALOG.UNMOUNT(:catalogName);
         EXCEPTION
           WHEN OTHERS THEN NULL;
         END;

         BEGIN
           DBMS_CLOUD.DROP_CREDENTIAL(:credentialName);
         EXCEPTION
           WHEN OTHERS THEN NULL;
         END;

         DBMS_CLOUD.CREATE_CREDENTIAL(
           credential_name => :credentialName,
           username        => :accessKeyId,
           password        => :secretAccessKey
         );

         DBMS_CATALOG.MOUNT_DATA_CATALOG(
           catalog_name            => :catalogName,
           data_catalog_type       => 'AWS_GLUE',
           data_catalog_region     => :region,
           data_catalog_credential => :credentialName,
           data_storage_credential => :credentialName,
           enabled                 => TRUE
         );
       END;`,
      {
        catalogName: CATALOG_NAME,
        credentialName: CREDENTIAL_NAME,
        accessKeyId,
        secretAccessKey,
        region,
      },
      { autoCommit: true },
    );
  });
}

router.post('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  try {
    if (!(await requireAdminDemoUser(req))) {
      return res.status(403).json({ error: 'An active administrator is required to configure AWS Glue.' });
    }

    const request = validateRequest(req.body || {});
    await configureGlueCatalog(request);
    return res.json({
      configured: true,
      catalogName: CATALOG_NAME,
      region: request.region,
    });
  } catch (err) {
    const statusCode = err.statusCode || (err.message.startsWith('Enter a valid') ? 400 : 502);
    console.error('AWS Glue catalog configuration failed:', err.code || err.name || 'unknown_error');
    return res.status(statusCode).json({
      error: statusCode === 400 ? err.message : 'AWS Glue catalog configuration failed. Check the ADB connection and AWS credentials, then try again.',
    });
  }
});

module.exports = router;
module.exports._private = {
  cleanText,
  targetConfig,
  validateRequest,
};
