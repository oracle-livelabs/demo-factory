const express = require('express');

const router = express.Router();
const DEFAULT_USERNAME = 'PG';

function cleanText(value) {
  return String(value || '').trim();
}

function port(name, defaultValue) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : defaultValue;
}

function publicHost(req) {
  const configuredHost = cleanText(process.env.SOURCE_PUBLIC_HOST);
  const requestHost = cleanText(req.hostname);
  const host = configuredHost || requestHost || 'localhost';

  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function sourcePassword() {
  return cleanText(process.env.DBPASSWORD)
    || cleanText(process.env.ADB_ADMIN_PASSWORD)
    || cleanText(process.env.ADB_STREAM_SCHEMA_PASSWORD)
    || null;
}

function mongoDbEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(cleanText(process.env.AIHUB).toLowerCase());
}

router.get('/', (req, res) => {
  const host = publicHost(req);
  const password = sourcePassword();
  const postgresDatabase = cleanText(process.env.POSTGRES_SOURCE_DB) || 'sportswear';
  const loyaltyDatabase = cleanText(process.env.LOYALTY_MYSQL_DATABASE) || 'loyalty';
  const mongoDatabase = cleanText(process.env.MONGODB_CATALOG_DATABASE) || 'catalog';
  const sources = [
    {
      id: 'postgres-source',
      name: 'PostgreSQL operational source',
      engine: 'PostgreSQL',
      connectionString: `postgresql://${host}:${port('POSTGRES_SOURCE_PORT', 8504)}/${postgresDatabase}`,
      username: cleanText(process.env.POSTGRES_SOURCE_USER) || DEFAULT_USERNAME,
      password,
    },
    {
      id: 'loyalty-mysql',
      name: 'Loyalty MySQL source',
      engine: 'MySQL',
      connectionString: `mysql://${host}:${port('LOYALTY_MYSQL_PORT', 8503)}/${loyaltyDatabase}`,
      username: cleanText(process.env.LOYALTY_MYSQL_USER) || DEFAULT_USERNAME,
      password,
    },
  ];

  if (mongoDbEnabled()) {
    sources.push(
      {
        id: 'mongodb-catalog',
        name: 'MongoDB product catalog source',
        engine: 'MongoDB',
        connectionString: `mongodb://${host}:${port('MONGODB_CATALOG_PORT', 27017)}/${mongoDatabase}?authSource=admin`,
        username: cleanText(process.env.MONGODB_CATALOG_ROOT_USERNAME) || DEFAULT_USERNAME,
        password,
      },
    );
  }

  return res.json({ available: Boolean(password), sources });
});

module.exports = router;
module.exports._private = { cleanText, port, publicHost, sourcePassword, mongoDbEnabled };
