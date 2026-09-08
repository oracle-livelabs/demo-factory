const API_BASE = '/api';

// ── Demo User Context (VPD) ──────────────────────────────────────────────
let _currentDemoUser = null;
export function setApiUser(username) { _currentDemoUser = username; }
export function getApiUser() { return _currentDemoUser; }

export async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const method = String(options.method || 'GET').toUpperCase();
  const requestUrl = method === 'GET'
    ? `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`
    : url;
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    ...options.headers,
  };
  if (_currentDemoUser) {
    headers['X-Demo-User'] = _currentDemoUser;
  }
  let res = await fetch(requestUrl, {
    ...options,
    cache: options.cache || 'no-store',
    headers,
  });
  if (res.status === 304) {
    res = await fetch(`${url}${url.includes('?') ? '&' : '?'}_retry=${Date.now()}`, {
      ...options,
      cache: 'reload',
      headers,
    });
  }
  if (!res.ok) {
    await parseApiError(res);
  }
  return res.json();
}

function buildApiError(payload, status) {
  const error = new Error(payload.error || payload.message || `API error: ${status}`);
  error.category = payload.category || null;
  error.correlationId = payload.correlationId || null;
  error.profile = payload.profile || null;
  error.model = payload.model || null;
  error.sql = payload.sql || null;
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

  const headers = {
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
  if (_currentDemoUser) {
    headers['X-Demo-User'] = _currentDemoUser;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: formData,
  });

  if (!res.ok) {
    await parseApiError(res);
  }
  return res.json();
}

export async function apiDownload(endpoint) {
  const headers = {
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
  if (_currentDemoUser) {
    headers['X-Demo-User'] = _currentDemoUser;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    cache: 'no-store',
    headers,
  });
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

export const api = {
  dashboard: {
    summary: () => apiFetch('/dashboard/summary'),
    trending: (limit = 10, search = '', brand = '') => {
      const qs = new URLSearchParams({ limit, ...(search && { search }), ...(brand && { brand }) }).toString();
      return apiFetch(`/dashboard/trending-products?${qs}`);
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
    chat: (question, history = [], conversationId = null, team = null) =>
      apiFetch('/agents/chat', {
        method: 'POST',
        body: JSON.stringify({ question, history, conversationId, team }),
      }),
    events: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/agents/events?${qs}`);
    },
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
    health: (profile) => {
      const qs = profile ? `?profile=${encodeURIComponent(profile)}` : '';
      return apiFetch(`/selectai/health${qs}`);
    },
    schemaObjects: () => apiFetch('/selectai/schema-objects'),
    chat: (question, showSql = true, profile, conversationId = null) =>
      apiFetch('/selectai/chat', {
        method: 'POST',
        body: JSON.stringify({ question, showSql, profile, conversationId }),
      }),
    showsql: (question, profile, conversationId = null) =>
      apiFetch('/selectai/showsql', {
        method: 'POST',
        body: JSON.stringify({ question, profile, conversationId }),
      }),
    runsql: (question, profile, conversationId = null) =>
      apiFetch('/selectai/runsql', {
        method: 'POST',
        body: JSON.stringify({ question, profile, conversationId }),
      }),
    chatMode: (question, showSql = true, profile, history = [], conversationId = null) =>
      apiFetch('/selectai/chat-mode', {
        method: 'POST',
        body: JSON.stringify({ question, showSql, profile, history, conversationId }),
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
  health: () => apiFetch('/health'),
};
