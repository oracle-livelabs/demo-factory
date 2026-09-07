/**
 * Media and Entertainment Content Intelligence Demo — Express Server
 * Serves API routes and the React frontend in production
 */

require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const db = require('./config/database');
const { shouldDeferGlobalJsonParser } = require('./lib/requestPathPolicy');
const {
  RESTRICTED_DEMO_USER,
  runWithRequestIdentity,
} = require('./lib/requestIdentityContext');
const { recoverOrphanedDatasetJobs } = require('./lib/importJobs');
const { reconcileDatasetOperationLock } = require('./lib/datasetOperationLock');
const {
  recoverStabilizingDataset,
  recoverAllStabilizingDatasets,
  reproveActiveGenerationOnStartup,
  cleanupQuarantinedCandidateAssets,
  reconcileGenerationAssetVpdPolicies,
} = require('./lib/importWorkflowService');
const { deliverPendingDatasetEvents } = require('./lib/datasetEventOutbox');
const { runDurableLifecycleRecovery } = require('./lib/durableLifecycleRecovery');
const { requireActiveGeneration } = require('./middleware/requireActiveGeneration');
const { mediaFeatureFailure } = require('./middleware/mediaFeatureFailure');
const {
  computeRuntimeIdentity,
  setRuntimeIdentityHeaders,
} = require('./lib/runtimeIdentity');

const app = express();
const PORT = process.env.PORT || 3001;
const frontendUrl = String(process.env.FRONTEND_URL || '').trim();
const frontendUsesHttps = /^https:\/\//i.test(frontendUrl);
const serveBuiltFrontend = ['production', 'test'].includes(
  String(process.env.NODE_ENV || '').toLowerCase()
);
const runtimeIdentity = computeRuntimeIdentity();
const processStartedAt = new Date(
  Date.now() - (process.uptime() * 1000)
).toISOString();
const processInstanceFingerprint = crypto.createHash('sha256')
  .update(JSON.stringify({
    pid: process.pid,
    processStartedAt,
    nonce: crypto.randomBytes(32).toString('hex'),
  }))
  .digest('hex');

app.set('etag', false);
app.disable('x-powered-by');

function setNoStoreHeaders(res) {
  setRuntimeIdentityHeaders(res, runtimeIdentity);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

// ── Middleware ──────────────────────────────────────────────
app.use(helmet({
  strictTransportSecurity: frontendUsesHttps,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      ...(frontendUsesHttps ? {} : { upgradeInsecureRequests: null }),
    },
  },
}));
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.FRONTEND_URL
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
app.use(morgan('dev'));
app.use((req, res, next) => {
  setRuntimeIdentityHeaders(res, runtimeIdentity);
  next();
});
const globalJsonParser = express.json({ limit: '10mb' });
app.use((req, res, next) => {
  if (shouldDeferGlobalJsonParser(req.method, req.path)) return next();
  return globalJsonParser(req, res, next);
});

// ── Demo User Context (VPD) ───────────────────────────────
// Oracle is authoritative for role, region, activity and access scope.
// Missing identity is a restricted viewer; explicit bad identities fail closed.
app.use('/api', async (req, res, next) => {
  const explicit = Object.prototype.hasOwnProperty.call(req.headers, 'x-demo-user');
  const requested = explicit
    ? String(req.headers['x-demo-user'] || '').trim()
    : RESTRICTED_DEMO_USER;
  if (!requested || !/^[A-Za-z0-9_.-]{1,128}$/.test(requested)) {
    return res.status(403).json({
      error: 'The demo user identity is not recognized',
      code: 'DEMO_IDENTITY_FORBIDDEN',
    });
  }
  try {
    const identity = await db.resolveDemoIdentity(requested);
    req.demoUser = identity.username;
    req.demoIdentity = identity;
    return runWithRequestIdentity(identity, next);
  } catch (error) {
    if (error?.code === 'DEMO_IDENTITY_FORBIDDEN'
        || /ORA-20080|ORA-20081|unknown or inactive|invalid media application user/i.test(String(error?.message || ''))) {
      return res.status(403).json({
        error: 'The demo user identity is not recognized',
        code: 'DEMO_IDENTITY_FORBIDDEN',
      });
    }
    console.error('Media identity validation error:', error);
    return res.status(503).json({
      error: 'Media identity validation is unavailable',
      code: 'DEMO_IDENTITY_UNAVAILABLE',
    });
  }
});

// Avoid stale API responses and conditional 304 paths for live dashboard/count data.
app.use('/api', (req, res, next) => {
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  setNoStoreHeaders(res);
  next();
});

// Scene APIs never expose a generation until post-commit feature stabilization
// has produced exact, generation-bound evidence and finalized readiness.
app.use([
  '/api/dashboard',
  '/api/social',
  '/api/products',
  '/api/fulfillment',
  '/api/graph',
  '/api/orders',
  '/api/ml',
  '/api/demo',
], requireActiveGeneration);
app.use(mediaFeatureFailure);

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

// ── Health Check ───────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const result = await db.executeSystem(`
      SELECT 'connected' status,
             SYSDATE db_time,
             SYS_CONTEXT('MEDIA_APP_CTX', 'USERNAME') context_username,
             SYS_CONTEXT('MEDIA_APP_CTX', 'ROLE') context_role,
             SYS_CONTEXT('MEDIA_APP_CTX', 'ACCESS_SCOPE') context_scope,
             SYS_CONTEXT('MEDIA_APP_CTX', 'AUTHENTICATED') context_authenticated,
             (SELECT COUNT(*) FROM fulfillment_centers) protected_row_count
      FROM dual
    `);
    const state = result.rows?.[0] || {};
    if (String(state.CONTEXT_USERNAME || '').toLowerCase() !== 'admin_jess'
        || String(state.CONTEXT_ROLE || '').toLowerCase() !== 'admin'
        || String(state.CONTEXT_SCOPE || '').toUpperCase() !== 'GLOBAL'
        || state.CONTEXT_AUTHENTICATED !== 'Y'
        || Number(state.PROTECTED_ROW_COUNT || 0) <= 0) {
      throw new Error('Oracle application context readiness check failed');
    }
    res.json({
      status: 'healthy',
      database: state,
      runtimeIdentity,
      processInstanceFingerprint,
      processStartedAt,
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
if (serveBuiltFrontend) {
  app.use(express.static(path.join(__dirname, '../frontend/dist'), {
    etag: false,
    lastModified: false,
    setHeaders: setNoStoreHeaders,
  }));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      setNoStoreHeaders(res);
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

// ── Start Server ───────────────────────────────────────────
async function start() {
  try {
    await db.initialize();
    console.log('Database connection pool ready');
    await reconcileGenerationAssetVpdPolicies();
    const recovery = await recoverOrphanedDatasetJobs();
    await reconcileDatasetOperationLock({ recoveredJobIds: recovery.jobIds });
    for (const jobId of recovery.stabilizingJobIds || []) {
      await recoverStabilizingDataset(jobId);
    }
    await reconcileDatasetOperationLock({ recoveredJobIds: recovery.jobIds });
    await reproveActiveGenerationOnStartup();
    await cleanupQuarantinedCandidateAssets();
    await deliverPendingDatasetEvents();
    const durableRecoveryTimer = setInterval(async () => {
      try {
        await runDurableLifecycleRecovery({
          recoverAllStabilizingDatasets,
          reconcileDatasetOperationLock,
          recoverOrphanedDatasetJobs,
          recoverStabilizingDataset,
          cleanupQuarantinedCandidateAssets,
          deliverPendingDatasetEvents,
        });
      } catch (error) {
        console.warn('Durable Media lifecycle recovery deferred:', error.message || error);
      }
    }, 15000);
    durableRecoveryTimer.unref();
    if (recovery.recovered > 0) {
      console.warn(`Recovered ${recovery.recovered} interrupted dataset job(s) after application restart.`);
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n  Media and Entertainment Content Intelligence Demo API`);
      console.log(`  ─────────────────────────`);
      console.log(`  Local:   http://localhost:${PORT}`);
      console.log(`  Health:  http://localhost:${PORT}/api/health`);
      console.log(`  Env:     ${process.env.NODE_ENV || 'development'}\n`);
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

if (require.main === module) {
  start();
}

module.exports = app;
module.exports.start = start;
