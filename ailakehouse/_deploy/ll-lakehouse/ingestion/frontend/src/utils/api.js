const API_BASE = '/api';

// ── Demo User Context (VPD) ──────────────────────────────────────────────
let _currentDemoUser = null;
export function setApiUser(username) { _currentDemoUser = username; }
export function getApiUser() { return _currentDemoUser; }

export async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (_currentDemoUser) {
    headers['X-Demo-User'] = _currentDemoUser;
  }
  const res = await fetch(url, {
    headers,
    ...options,
  });
  if (!res.ok) {
    await parseApiError(res);
  }
  return res.json();
}

function buildApiError(payload, status) {
  const error = new Error(payload.error || payload.message || `API error: ${status}`);
  error.details = payload.details || null;
  error.errors = payload.errors || payload.details?.errors || [];
  error.warnings = payload.warnings || payload.details?.warnings || [];
  error.counts = payload.counts || payload.details?.counts || null;
  return error;
}

async function parseApiError(res) {
  const err = await res.json().catch(() => ({ error: res.statusText }));
  throw buildApiError(err, res.status);
}

export async function apiUploadFile(endpoint, file) {
  const formData = new FormData();
  formData.append('file', file);

  const headers = {};
  if (_currentDemoUser) {
    headers['X-Demo-User'] = _currentDemoUser;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    await parseApiError(res);
  }
  return res.json();
}

export async function apiDownload(endpoint) {
  const headers = {};
  if (_currentDemoUser) {
    headers['X-Demo-User'] = _currentDemoUser;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, { headers });
  if (!res.ok) {
    await parseApiError(res);
  }

  const contentDisposition = res.headers.get('content-disposition') || '';
  const fileNameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  const filename = fileNameMatch?.[1] || 'import-template-v1.zip';

  return {
    filename,
    blob: await res.blob(),
  };
}

export async function apiLakehouseValidate({ connectionString, password, walletFile }) {
  const formData = new FormData();
  formData.append('connectionString', connectionString || '');
  formData.append('username', 'ADMIN');
  formData.append('password', password || '');
  if (walletFile) {
    formData.append('wallet', walletFile);
  }

  const headers = {};
  if (_currentDemoUser) {
    headers['X-Demo-User'] = _currentDemoUser;
  }

  const res = await fetch(`${API_BASE}/lakehouse/validate`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    await parseApiError(res);
  }
  return res.json();
}

export async function apiLakehouseSeed({ connectionString, password, walletFile }) {
  const formData = new FormData();
  formData.append('connectionString', connectionString || '');
  formData.append('password', password || '');
  if (walletFile) {
    formData.append('wallet', walletFile);
  }

  const headers = {};
  if (_currentDemoUser) {
    headers['X-Demo-User'] = _currentDemoUser;
  }

  const res = await fetch(`${API_BASE}/lakehouse/seed`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    await parseApiError(res);
  }
  return res.json();
}

export async function apiLakehouseAuto() {
  return apiFetch('/lakehouse/auto');
}

export const api = {
  icebergCatalog: {
    config: () => apiFetch('/iceberg-catalog/config'),
  },
  dashboard: {
    summary: () => apiFetch('/dashboard/summary'),
    trending: (limit = 10, search = '', brand = '') => {
      const qs = new URLSearchParams({ limit, ...(search && { search }), ...(brand && { brand }) }).toString();
      return apiFetch(`/dashboard/trending-products?${qs}`);
    },
    watchedImageSearch: async (file, limit = 25) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('limit', String(limit));

      const headers = {};
      if (_currentDemoUser) {
        headers['X-Demo-User'] = _currentDemoUser;
      }

      const res = await fetch(`${API_BASE}/dashboard/watched-image-search`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!res.ok) {
        await parseApiError(res);
      }
      return res.json();
    },
    velocity: (hours = 48) => apiFetch(`/dashboard/social-velocity?hours=${hours}`),
    revenueByCategory: () => apiFetch('/dashboard/revenue-by-category'),
    demandMap: () => apiFetch('/dashboard/demand-map'),
    inmemory: () => apiFetch('/dashboard/inmemory'),
  },
  social: {
    posts: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/social/posts?${qs}`);
    },
    viral: (hours = 48) => apiFetch(`/social/viral?hours=${hours}`),
    influencers: () => apiFetch('/social/influencers'),
    momentum: () => apiFetch('/social/momentum-timeline'),
    platforms: () => apiFetch('/social/platform-breakdown'),
    search: (query, topK = 10) =>
      apiFetch('/social/semantic-search', {
        method: 'POST',
        body: JSON.stringify({ query, topK }),
      }),
    postSearch: (query, topK = 20) =>
      apiFetch('/social/post-search', {
        method: 'POST',
        body: JSON.stringify({ query, topK }),
      }),
  },
  products: {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/products?${qs}`);
    },
    detail: (id) => apiFetch(`/products/${id}`),
    duality: (id) => apiFetch(`/products/${id}/duality`),
    categories: () => apiFetch('/products/categories/list'),
  },
  webshop: {
    status: () => apiFetch('/webshop/status'),
    agentStatus: () => apiFetch('/webshop/ask/agent/status'),
    agentAsk: (message, sessionId, teamName) =>
      apiFetch('/webshop/ask/agent', {
        method: 'POST',
        body: JSON.stringify({ message, sessionId, teamName }),
      }),
    clearAgentConversations: () => apiFetch('/webshop/ask/agent/conversations', { method: 'DELETE' }),
    index: () => apiFetch('/webshop/index', { method: 'POST' }),
    search: (query, limit = 16) =>
      apiFetch('/webshop/search', {
        method: 'POST',
        body: JSON.stringify({ query, limit }),
      }),
    imageSearch: async (file, limit = 16) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('limit', String(limit));

      const headers = {};
      if (_currentDemoUser) {
        headers['X-Demo-User'] = _currentDemoUser;
      }

      const res = await fetch(`${API_BASE}/webshop/image-search`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!res.ok) {
        await parseApiError(res);
      }
      return res.json();
    },
  },
  fulfillment: {
    centers: () => apiFetch('/fulfillment/centers'),
    nearest: (params) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/fulfillment/nearest?${qs}`);
    },
    shipments: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/fulfillment/shipments?${qs}`);
    },
    alerts: () => apiFetch('/fulfillment/inventory-alerts'),
    customers: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/fulfillment/customers?${qs}`);
    },
    zones: () => apiFetch('/fulfillment/zones'),
    demandRegions: () => apiFetch('/fulfillment/demand-regions'),
  },
  graph: {
    influencers: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/graph/influencers?${qs}`);
    },
    network: (id, depth = 1) => apiFetch(`/graph/network/${id}?depth=${depth}`),
    propagation: (brandSlug) => apiFetch(`/graph/propagation/${brandSlug}`),
    exampleQueries: () => apiFetch('/graph/example-queries'),
    runExample: (queryId, params = {}) =>
      apiFetch('/graph/run-example', {
        method: 'POST',
        body: JSON.stringify({ queryId, params }),
      }),
  },
  agents: {
    runCycle: () => apiFetch('/agents/run-cycle', { method: 'POST' }),
    actions: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/agents/actions?${qs}`);
    },
    summary: () => apiFetch('/agents/summary'),
    detectTrends: (windowHours = 24, viralThreshold = 75) =>
      apiFetch('/agents/detect-trends', {
        method: 'POST',
        body: JSON.stringify({ windowHours, viralThreshold }),
      }),
    chat: (question) =>
      apiFetch('/agents/chat', {
        method: 'POST',
        body: JSON.stringify({ question }),
      }),
    events: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/agents/events?${qs}`);
    },
    nativeStatus: (force = false) =>
      apiFetch(`/agents/native/status${force ? '?force=true' : ''}`),
    profiles: () => apiFetch('/agents/profiles'),
    setProfile: (profile) =>
      apiFetch('/agents/set-profile', {
        method: 'POST',
        body: JSON.stringify({ profile }),
      }),
  },
  orders: {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/orders?${qs}`);
    },
    detail: (id) => apiFetch(`/orders/${id}`),
    duality: (id) => apiFetch(`/orders/${id}/duality`),
  },
  ml: {
    summary: () => apiFetch('/ml/summary'),
    demandForecast: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/ml/demand-forecast?${qs}`);
    },
    customerSegments: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/ml/customer-segments?${qs}`);
    },
    revenueForecast: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/ml/revenue-forecast?${qs}`);
    },
    vectorClusters: (k = 5) => apiFetch(`/ml/vector-clusters?k=${k}`),
    inventoryIntelligence: () => apiFetch('/ml/inventory-intelligence'),
  },
  selectai: {
    profiles: () => apiFetch('/selectai/profiles'),
    chat: (question, showSql = true, profile) =>
      apiFetch('/selectai/chat', {
        method: 'POST',
        body: JSON.stringify({ question, showSql, profile }),
      }),
    showsql: (question, profile) =>
      apiFetch('/selectai/showsql', {
        method: 'POST',
        body: JSON.stringify({ question, profile }),
      }),
    runsql: (question, profile) =>
      apiFetch('/selectai/runsql', {
        method: 'POST',
        body: JSON.stringify({ question, profile }),
      }),
    chatMode: (question, showSql = true, profile) =>
      apiFetch('/selectai/chat-mode', {
        method: 'POST',
        body: JSON.stringify({ question, showSql, profile }),
      }),
  },
  users: {
    list: () => apiFetch('/users'),
  },
  import: {
    template: () => apiDownload('/import/template'),
    validate: (file) => apiUploadFile('/import/validate', file),
    upload: (file) => apiUploadFile('/import/upload', file),
    status: (jobId) => apiFetch(`/import/status/${jobId}`),
    dataset: () => apiFetch('/import/dataset'),
    restoreDemoPreview: () =>
      apiFetch('/import/restore-demo/validate', {
        method: 'POST',
      }),
    restoreDemo: () =>
      apiFetch('/import/restore-demo', {
        method: 'POST',
      }),
  },
  lakehouse: {
    auto: apiLakehouseAuto,
    validate: apiLakehouseValidate,
    seed: apiLakehouseSeed,
  },
  dataSources: {
    list: () => apiFetch('/data-sources'),
  },
  awsGlue: {
    configure: ({ accessKeyId, secretAccessKey, region }) =>
      apiFetch('/aws-glue', {
        method: 'POST',
        body: JSON.stringify({ accessKeyId, secretAccessKey, region }),
      }),
  },
  streamingAnalytics: {
    status: () => apiFetch('/streaming-analytics/status'),
  },
  streamingIngest: {
    status: () => apiFetch('/streaming-ingest/status'),
    pipelineConfig: () => apiFetch('/streaming-ingest/pipeline-config'),
    ensureTopic: () => apiFetch('/streaming-ingest/topic', { method: 'POST' }),
    start: (rateMs = 1500) =>
      apiFetch('/streaming-ingest/start', {
        method: 'POST',
        body: JSON.stringify({ rateMs }),
      }),
    stop: () => apiFetch('/streaming-ingest/stop', { method: 'POST' }),
    produceOnce: () => apiFetch('/streaming-ingest/produce-once', { method: 'POST' }),
    clearLiveSignals: () => apiFetch('/streaming-ingest/live-signals', { method: 'DELETE' }),
  },
  customerCdc: {
    status: () => apiFetch('/customer-cdc/status'),
    customers: (limit = 12) => apiFetch(`/customer-cdc/customers?limit=${limit}`),
    simulate: (action = 'insert') =>
      apiFetch('/customer-cdc/simulate', {
        method: 'POST',
        body: JSON.stringify({ action }),
      }),
    clearDemoCustomers: () => apiFetch('/customer-cdc/demo-customers', { method: 'DELETE' }),
  },
  health: () => apiFetch('/health'),
};
