/**
 * PeakGear Sporting Goods Demo — Express Server
 * Serves API routes and the React frontend in production
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const db = require('./config/database');
const { scheduleOsaStreamingDeploymentSetup } = require('./lib/osaStreamingSetup');
const { scheduleCustomerCdcSetup } = require('./lib/customerCdcSetup');

const app = express();
const PORT = process.env.PORT || 3001;

function envFlagEnabled(name, defaultValue = true) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function positiveIntegerEnv(name, defaultValue) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

function nonNegativeIntegerEnv(name, defaultValue) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value >= 0 ? value : defaultValue;
}

// ── Middleware ──────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.FRONTEND_URL
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));

// ── Demo User Context (VPD) ───────────────────────────────
// Reads X-Demo-User header and attaches to req for VPD filtering
app.use((req, res, next) => {
  req.demoUser = req.headers['x-demo-user'] || null;
  next();
});

// ── API Routes ─────────────────────────────────────────────
const dashboardRoutes = require('./routes/dashboard');
const socialRoutes = require('./routes/social');
const productsRoutes = require('./routes/products');
const fulfillmentRoutes = require('./routes/fulfillment');
const graphRoutes = require('./routes/graph');
const agentRoutes = require('./routes/agents');
const ordersRoutes = require('./routes/orders');
const mlRoutes = require('./routes/ml');
const demoRoutes = require('./routes/demo');
const usersRoutes = require('./routes/users');
const selectaiRoutes = require('./routes/selectai');
const importRoutes = require('./routes/import');
const lakehouseRoutes = require('./routes/lakehouse');
const webshopRoutes = require('./routes/webshop');
const streamingAnalyticsRoutes = require('./routes/streamingAnalytics');
const streamingIngestRoutes = require('./routes/streamingIngest');
const customerCdcRoutes = require('./routes/customerCdc');
const icebergCatalogRoutes = require('./routes/icebergCatalog');
const dataSourcesRoutes = require('./routes/dataSources');
const awsGlueRoutes = require('./routes/awsGlue');

app.use('/api/dashboard', dashboardRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/fulfillment', fulfillmentRoutes);
app.use('/api/graph', graphRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/ml', mlRoutes);
app.use('/api/demo', demoRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/selectai', selectaiRoutes);
app.use('/api/import', importRoutes);
app.use('/api/lakehouse', lakehouseRoutes);
app.use('/api/webshop', webshopRoutes);
app.use('/api/streaming-analytics', streamingAnalyticsRoutes);
app.use('/api/streaming-ingest', streamingIngestRoutes);
app.use('/api/customer-cdc', customerCdcRoutes);
app.use('/api/iceberg-catalog', icebergCatalogRoutes);
app.use('/api/data-sources', dataSourcesRoutes);
app.use('/api/aws-glue', awsGlueRoutes);

// ── Health Check ───────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const result = await db.execute("SELECT 'connected' AS status, SYSDATE AS db_time FROM dual");
    res.json({
      status: 'healthy',
      database: result.rows[0],
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      error: err.message
    });
  }
});

// Return a clear JSON response for unknown API routes before the frontend catch-all.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// ── Serve Frontend (Production) ────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.use('/logos', express.static(path.join(__dirname, '../logos')));
  app.use(express.static(path.join(__dirname, '../frontend/dist')));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
    }
  });
}

// ── Error Handler ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Warm the image index so catalog product details can resolve image URLs
// without relying on a prior visit to the webshop page.
function scheduleWebshopImageIndexWarmup() {
  if (!envFlagEnabled('WEBSHOP_IMAGE_INDEX_WARMUP', true)) {
    console.log('[startup] Webshop image index warmup skipped by configuration');
    return;
  }

  const maxAttempts = positiveIntegerEnv('WEBSHOP_IMAGE_INDEX_WARMUP_RETRIES', 12);
  const initialDelayMs = nonNegativeIntegerEnv('WEBSHOP_IMAGE_INDEX_WARMUP_DELAY_MS', 5000);
  const retryDelayMs = positiveIntegerEnv('WEBSHOP_IMAGE_INDEX_WARMUP_RETRY_DELAY_MS', 15000);
  let attempt = 0;

  function scheduleNext(delayMs) {
    const timer = setTimeout(runWarmup, delayMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  async function runWarmup() {
    attempt += 1;
    try {
      console.log(`[startup] Warming webshop image index (${attempt}/${maxAttempts})...`);
      const result = await webshopRoutes.buildImageIndex();
      console.log(
        `[startup] Webshop image index ready: ${result.indexed} indexed, ` +
        `${result.inserted} inserted, ${result.skipped} skipped, ${result.imageFiles} image files`
      );
    } catch (err) {
      if (attempt >= maxAttempts) {
        console.error(`[startup] Webshop image index warmup failed after ${attempt} attempts: ${err.message}`);
        return;
      }

      console.warn(`[startup] Webshop image index warmup attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
      scheduleNext(retryDelayMs);
    }
  }

  scheduleNext(initialDelayMs);
}

// ── Start Server ───────────────────────────────────────────
async function start() {
  try {
    await db.initialize();
    console.log('Database connection pool ready');

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n  PeakGear Sporting Goods Demo API`);
      console.log(`  ─────────────────────────`);
      console.log(`  Local:   http://localhost:${PORT}`);
      console.log(`  Health:  http://localhost:${PORT}/api/health`);
      console.log(`  Env:     ${process.env.NODE_ENV || 'development'}\n`);
      scheduleWebshopImageIndexWarmup();
      scheduleOsaStreamingDeploymentSetup();
      scheduleCustomerCdcSetup();
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await db.closePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\nSIGINT received, shutting down...');
  await db.closePool();
  process.exit(0);
});

start();

module.exports = app;
