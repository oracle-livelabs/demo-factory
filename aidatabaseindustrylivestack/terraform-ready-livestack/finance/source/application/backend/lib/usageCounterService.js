const os = require('os');
const crypto = require('crypto');

const DEFAULT_PREFIX = 'finance-demo-usage/events';
const DEFAULT_TIMEOUT_MS = 3000;

function isEnabled() {
  const value = String(process.env.DEMO_USAGE_COUNTER_ENABLED || '').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(value);
}

function trimSlashes(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '');
}

function normalizeParUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  return url.endsWith('/') ? url : `${url}/`;
}

function encodeObjectName(objectName) {
  return String(objectName)
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function timeoutMs() {
  const configured = Number.parseInt(process.env.DEMO_USAGE_COUNTER_TIMEOUT_MS || '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function buildObjectName(timestamp) {
  const prefix = trimSlashes(process.env.DEMO_USAGE_COUNTER_PREFIX || DEFAULT_PREFIX);
  const day = timestamp.slice(0, 10);
  const safeTime = timestamp.replace(/[:.]/g, '-');
  const id = crypto.randomUUID();
  const fileName = `${safeTime}-${id}.json`;
  return [prefix, day, fileName].filter(Boolean).join('/');
}

function buildEventPayload({ jobId, operation, datasetSource, activeDataset, summary }) {
  const timestamp = new Date().toISOString();
  return {
    demo: process.env.DEMO_USAGE_COUNTER_DEMO_ID || 'finance',
    event: 'dataset_refresh',
    timestamp,
    jobId: jobId || null,
    operation: operation || null,
    datasetSource: datasetSource || null,
    activeDataset: activeDataset || null,
    summary: summary || null,
    runtime: {
      hostname: os.hostname(),
      nodeEnv: process.env.NODE_ENV || null,
      appPort: process.env.PORT || null,
    },
  };
}

async function putJsonObject(parUrl, objectName, payload) {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available in this Node runtime.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const response = await fetch(`${parUrl}${encodeObjectName(objectName)}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: `${JSON.stringify(payload, null, 2)}\n`,
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Object Storage PUT failed with HTTP ${response.status}${body ? `: ${body.slice(0, 180)}` : ''}`);
    }

    return {
      ok: true,
      objectName,
      status: response.status,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function recordDatasetRefresh(eventContext) {
  if (!isEnabled()) {
    return { ok: true, skipped: true, reason: 'disabled' };
  }

  const parUrl = normalizeParUrl(process.env.DEMO_USAGE_COUNTER_PAR_URL);
  if (!parUrl) {
    return { ok: true, skipped: true, reason: 'missing_par_url' };
  }

  const payload = buildEventPayload(eventContext);
  const objectName = buildObjectName(payload.timestamp);

  try {
    const result = await putJsonObject(parUrl, objectName, payload);
    console.log(`Usage telemetry event written to Object Storage: ${result.objectName}`);
    return result;
  } catch (err) {
    console.warn(`Usage telemetry event was skipped: ${err.message}`);
    return {
      ok: false,
      skipped: true,
      reason: err.message,
      objectName,
    };
  }
}

module.exports = {
  recordDatasetRefresh,
  _private: {
    buildEventPayload,
    buildObjectName,
    encodeObjectName,
    normalizeParUrl,
  },
};
