import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Braces,
  Code2,
  Database,
  DatabaseZap,
  LayoutDashboard,
  Map,
  Network,
  ServerCog,
  ShoppingCart,
  Upload,
} from 'lucide-react';
import { api } from './utils/api';
import Welcome, { LAKEHOUSE_SECTIONS } from './pages/Welcome';
import Dashboard from './pages/Dashboard';
import Webshop from './pages/Webshop';
import ProductCatalog from './pages/ProductCatalog';
import SocialFeed from './pages/SocialFeed';
import InfluencerGraph from './pages/InfluencerGraph';
import FulfillmentMap from './pages/FulfillmentMap';
import AgentConsole from './pages/AgentConsole';
import Orders from './pages/Orders';
import OMLAnalytics from './pages/OMLAnalytics';
import AskData from './pages/AskData';
import AIDataLakehouse from './pages/AIDataLakehouse';
import BronzeDataLoadGuide from './pages/BronzeDataLoadGuide';
import SilverProcessGuide from './pages/SilverProcessGuide';
import IcebergCatalogServerGuide from './pages/IcebergCatalogServerGuide';
import LoadToIcebergGuide from './pages/LoadToIcebergGuide';
import RealTimeStreaming from './pages/RealTimeStreaming';
import CustomerCDC from './pages/CustomerCDC';
import DataSources from './pages/DataSources';
import AdminEntry from './pages/AdminEntry';
import { OraclePanelProvider } from './context/OraclePanelContext';
import { UserProvider } from './context/UserContext';
import RightOraclePanel from './components/RightOraclePanel';
import UserSwitcher from './components/UserSwitcher';
import { JetButton } from './components/JetControls';

const PAGE_NAV_ITEMS = [
  { id: 'dashboard', label: 'Operations Dashboard', iconClass: 'oj-fwk-icon oj-fwk-icon-grid', Icon: BarChart3 },
  { id: 'webshop', label: 'PeakGear Webshop', iconClass: 'oj-fwk-icon oj-fwk-icon-grid', Icon: ShoppingCart },
  { id: 'catalog', label: 'Product Catalog', iconClass: 'oj-fwk-icon oj-fwk-icon-grid' },
  { id: 'social', label: 'Retail Demand Sensing', iconClass: 'oj-fwk-icon oj-fwk-icon-sortrelevancehigh' },
  { id: 'graph', label: 'Returns Risk Network', iconClass: 'oj-fwk-icon oj-fwk-icon-node-expand' },
  { id: 'fulfillment', label: 'Store Fulfillment Map', iconClass: 'oj-fwk-icon oj-fwk-icon-calendar-clock' },
  { id: 'orders', label: 'Orders & Fulfillment Flow', iconClass: 'oj-fwk-icon oj-fwk-icon-tree-document' },
  { id: 'oml', label: 'Demand, Revenue & Inventory Predictions', iconClass: 'oj-fwk-icon oj-fwk-icon-view' },
  { id: 'askdata', label: 'Ask Your Data', iconClass: 'oj-fwk-icon oj-fwk-icon-magnifier' },
  { id: 'agents', label: 'Retail Operations Agents', iconClass: 'oj-fwk-icon oj-fwk-icon-users' },
];

const OML_PAGE_ID = 'oml';
const SERVE_AI_PAGE_IDS = new Set(['webshop', OML_PAGE_ID, 'askdata', 'agents']);
const SERVE_DATA_NAV_ITEMS = PAGE_NAV_ITEMS.filter(({ id }) => !SERVE_AI_PAGE_IDS.has(id));
const SERVE_AI_NAV_ITEMS = PAGE_NAV_ITEMS.filter(({ id }) => SERVE_AI_PAGE_IDS.has(id));
const OML_NAV_ITEMS = SERVE_AI_NAV_ITEMS.filter(({ id }) => id === OML_PAGE_ID);
const SERVE_AI_SECONDARY_NAV_ITEMS = SERVE_AI_NAV_ITEMS.filter(({ id }) => id !== OML_PAGE_ID);
const LAKEHOUSE_CONNECTION_STORAGE_KEY = 'peakgear.aiLakehouseConnections.v1';
const LAKEHOUSE_ORDS_SCHEMA = 'pg';
const BATCH_FILE_LOADING_LABEL = 'Batch & File Loading (Data Studio)';
const REAL_TIME_STREAMING_LABEL = 'Real-Time Streaming';
const CHANGE_DATA_CAPTURE_LABEL = 'Change Data Capture (GoldenGate Studio)';
const DATA_PROCESSING_LABEL = 'Transform Iceberg Data';
const DATA_CATALOG_LABEL = 'Data Catalog';
const MACHINE_LEARNING_MODELS_LABEL = 'Machine Learning Models';
const ORACLE_MACHINE_LEARNING_LABEL = 'Oracle Machine Learning';
const AI_LAKEHOUSE_TOOL_LINKS = [
  { id: 'sql-developer-web', label: 'SQL Developer Web', actionId: 'adb-sql-developer-web', Icon: Code2 },
  { id: 'db-actions-launchpad', label: 'DB Actions Launchpad', actionId: 'adb-actions-launchpad', Icon: LayoutDashboard },
  { id: 'graph-studio', label: 'Graph Studio', actionId: 'adb-graph-studio', Icon: Network },
  { id: 'spatial-studio', label: 'Spatial Studio', actionId: 'adb-spatial-studio', Icon: Map },
  { id: 'json', label: 'JSON', actionId: 'adb-json', Icon: Braces },
  { id: 'data-studio-overview', label: 'Data Studio Overview', actionId: 'adb-data-studio-overview', Icon: DatabaseZap },
];
const BRONZE_DATA_LOAD_PAGE_ID = 'bronze-load';
const REAL_TIME_STREAMING_PAGE_ID = 'streaming';
const CHANGE_DATA_CAPTURE_PAGE_ID = 'customer-cdc';
const SILVER_PROCESS_PAGE_ID = 'silver-process';
const ICEBERG_CATALOG_SERVER_PAGE_ID = 'iceberg-catalog-server';
const LOAD_TO_ICEBERG_PAGE_ID = 'load-to-iceberg';
const DATA_SOURCES_PAGE_ID = 'data-sources';
const PROCESS_SIDEBAR_EXCLUSIONS = new Set([
  'Data Quality & Enrichment',
  'Analytics-Ready Datasets',
  'Feature-Ready Datasets',
]);
const SERVE_AI_SIDEBAR_EXCLUSIONS = new Set([
  MACHINE_LEARNING_MODELS_LABEL,
  'Retrieval-Augmented Generation',
  'AI for Live Operational Data',
  'Natural Language to SQL',
  'AI Agents',
]);

const ADMIN_NAV_ITEMS = [
  { id: 'lakehouse', label: 'LiveStack Configuration', iconClass: 'oj-fwk-icon oj-fwk-icon-grid' },
];

const WELCOME_NAV_ITEM = { id: 'welcome', label: 'AI Lakehouse Workflow', iconClass: 'oj-fwk-icon oj-fwk-icon-info' };
const BRONZE_DATA_LOAD_NAV_ITEM = {
  id: BRONZE_DATA_LOAD_PAGE_ID,
  label: BATCH_FILE_LOADING_LABEL,
  iconClass: 'oj-fwk-icon oj-fwk-icon-upload',
};
const REAL_TIME_STREAMING_NAV_ITEM = {
  id: REAL_TIME_STREAMING_PAGE_ID,
  label: REAL_TIME_STREAMING_LABEL,
  iconClass: 'oj-fwk-icon oj-fwk-icon-sortrelevancehigh',
};
const CHANGE_DATA_CAPTURE_NAV_ITEM = {
  id: CHANGE_DATA_CAPTURE_PAGE_ID,
  label: CHANGE_DATA_CAPTURE_LABEL,
  iconClass: 'oj-fwk-icon oj-fwk-icon-refresh',
};
const SILVER_PROCESS_NAV_ITEM = {
  id: SILVER_PROCESS_PAGE_ID,
  label: DATA_PROCESSING_LABEL,
  iconClass: 'oj-fwk-icon oj-fwk-icon-copy',
};
const ICEBERG_CATALOG_SERVER_NAV_ITEM = {
  id: ICEBERG_CATALOG_SERVER_PAGE_ID,
  pageId: ICEBERG_CATALOG_SERVER_PAGE_ID,
  label: 'Add Iceberg Catalog Server',
  Icon: ServerCog,
};
const LOAD_TO_ICEBERG_NAV_ITEM = {
  id: LOAD_TO_ICEBERG_PAGE_ID,
  pageId: LOAD_TO_ICEBERG_PAGE_ID,
  label: 'Load Data to Iceberg Catalog Server',
  Icon: Upload,
};
const DATA_SOURCES_NAV_ITEM = {
  id: DATA_SOURCES_PAGE_ID,
  pageId: DATA_SOURCES_PAGE_ID,
  label: 'Data Sources',
  Icon: Database,
};

const BASE_ROUTED_NAV_ITEMS = [
  WELCOME_NAV_ITEM,
  REAL_TIME_STREAMING_NAV_ITEM,
  CHANGE_DATA_CAPTURE_NAV_ITEM,
  BRONZE_DATA_LOAD_NAV_ITEM,
  SILVER_PROCESS_NAV_ITEM,
  ICEBERG_CATALOG_SERVER_NAV_ITEM,
  LOAD_TO_ICEBERG_NAV_ITEM,
  ...PAGE_NAV_ITEMS,
  ...ADMIN_NAV_ITEMS,
  DATA_SOURCES_NAV_ITEM,
];

const routedNavItems = () => BASE_ROUTED_NAV_ITEMS;

const WORKFLOW_SECTION_LOOKUP = Object.fromEntries(LAKEHOUSE_SECTIONS.map((section) => [section.id, section]));

const workflowItems = (sectionId, excludedLabels = new Set()) => (
  WORKFLOW_SECTION_LOOKUP[sectionId]?.capabilities
    .filter(({ title }) => !excludedLabels.has(title))
    .map(({ Icon, title }) => ({
      id: `${sectionId}-${title}`,
      label: title,
      Icon,
      pageId: title === REAL_TIME_STREAMING_LABEL
        ? REAL_TIME_STREAMING_PAGE_ID
        : title === CHANGE_DATA_CAPTURE_LABEL
          ? CHANGE_DATA_CAPTURE_PAGE_ID
        : title === BATCH_FILE_LOADING_LABEL
        ? BRONZE_DATA_LOAD_PAGE_ID
        : title === DATA_PROCESSING_LABEL
          ? SILVER_PROCESS_PAGE_ID
          : undefined,
      actionId: title === MACHINE_LEARNING_MODELS_LABEL
        ? 'adb-oml'
        : title === DATA_CATALOG_LABEL
          ? 'adb-data-studio-overview'
        : undefined,
    })) || []
);

function aiLakehouseToolNavItems() {
  const items = workflowItems('serve-ai')
  .filter(({ label }) => label === MACHINE_LEARNING_MODELS_LABEL)
  .map((item) => ({
    ...item,
    id: 'ai-lakehouse-tools-oracle-machine-learning',
    label: ORACLE_MACHINE_LEARNING_LABEL,
  }));

  items.push(DATA_SOURCES_NAV_ITEM);

  return items.concat(AI_LAKEHOUSE_TOOL_LINKS.map((item) => ({
    ...item,
    id: `ai-lakehouse-tools-${item.id}`,
  })));
}

function sidebarGroups() {
  return [
  {
    id: 'catalog',
    label: 'Catalog',
    iconClass: 'oj-fwk-icon oj-fwk-icon-tree-folder-open',
    items: [...workflowItems('catalog'), ICEBERG_CATALOG_SERVER_NAV_ITEM],
  },
  {
    id: 'ingest',
    label: 'Ingest',
    iconClass: 'oj-fwk-icon oj-fwk-icon-tree-folder-open',
    items: workflowItems('ingest'),
  },
  {
    id: 'transform',
    label: 'Process',
    iconClass: 'oj-fwk-icon oj-fwk-icon-tree-folder-open',
    items: [...workflowItems('transform', PROCESS_SIDEBAR_EXCLUSIONS), LOAD_TO_ICEBERG_NAV_ITEM],
  },
  {
    id: 'serve-data',
    label: 'Serve Data',
    iconClass: 'oj-fwk-icon oj-fwk-icon-tree-folder-open',
    items: SERVE_DATA_NAV_ITEMS.map((item) => ({ ...item, pageId: item.id })),
  },
  {
    id: 'serve-ai',
    label: 'Serve AI',
    iconClass: 'oj-fwk-icon oj-fwk-icon-tree-folder-open',
    items: [
      ...OML_NAV_ITEMS.map((item) => ({ ...item, pageId: item.id })),
      ...workflowItems('serve-ai', SERVE_AI_SIDEBAR_EXCLUSIONS),
      ...SERVE_AI_SECONDARY_NAV_ITEMS.map((item) => ({ ...item, pageId: item.id })),
    ],
  },
  {
    id: 'govern',
    label: 'Govern',
    iconClass: 'oj-fwk-icon oj-fwk-icon-tree-folder-open',
    items: workflowItems('govern'),
  },
  {
    id: 'ai-lakehouse-tools',
    label: 'AI Lakehouse tools',
    iconClass: 'oj-fwk-icon oj-fwk-icon-tree-folder-open',
    items: aiLakehouseToolNavItems(),
  },
  {
    id: 'admin-operations',
    label: 'LiveStack Admin',
    iconClass: 'oj-fwk-icon oj-fwk-icon-tree-folder-open',
    items: ADMIN_NAV_ITEMS.map((item) => ({ ...item, pageId: item.id })),
  },
  ];
}

const INITIAL_EXPANDED_NAV_GROUPS = [];

const BASE_PAGES = {
  dashboard: Dashboard,
  webshop: Webshop,
  catalog: ProductCatalog,
  social: SocialFeed,
  graph: InfluencerGraph,
  fulfillment: FulfillmentMap,
  agents: AgentConsole,
  orders: Orders,
  oml: OMLAnalytics,
  askdata: AskData,
  lakehouse: AIDataLakehouse,
  [REAL_TIME_STREAMING_PAGE_ID]: RealTimeStreaming,
  [CHANGE_DATA_CAPTURE_PAGE_ID]: CustomerCDC,
  [BRONZE_DATA_LOAD_PAGE_ID]: BronzeDataLoadGuide,
  [SILVER_PROCESS_PAGE_ID]: SilverProcessGuide,
  [ICEBERG_CATALOG_SERVER_PAGE_ID]: IcebergCatalogServerGuide,
  [LOAD_TO_ICEBERG_PAGE_ID]: LoadToIcebergGuide,
  [DATA_SOURCES_PAGE_ID]: DataSources,
};

function resolveInitialPage(pages = BASE_PAGES) {
  if (typeof window === 'undefined') return 'welcome';
  const params = new URLSearchParams(window.location.search);
  const page = params.get('page');
  if (page === 'welcome') return 'welcome';
  return page && pages[page] ? page : 'welcome';
}

function OracleBrand() {
  return (
    <button
      type="button"
      className="app-brand-lockup"
      onClick={() => window.location.reload()}
      aria-label="Reload PeakGear Sporting Goods LiveStack"
    >
      <img className="app-brand-logo" src="/oracle-logo.svg" alt="Oracle" />
      <h1 className="app-brand-title">PeakGear Sporting Goods LiveStack</h1>
    </button>
  );
}

function readActiveLakehouseConnection() {
  if (typeof window === 'undefined') return null;

  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAKEHOUSE_CONNECTION_STORAGE_KEY) || '{}');
    const connections = Array.isArray(parsed.connections)
      ? parsed.connections.filter((connection) => connection?.id && connection?.dbActionsUrl)
      : [];
    return connections.find((connection) => connection.id === parsed.activeConnectionId) || connections[0] || null;
  } catch {
    return null;
  }
}

function writeActiveLakehouseConnection(connection) {
  if (typeof window === 'undefined' || !connection?.id || !connection?.dbActionsUrl) return;

  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAKEHOUSE_CONNECTION_STORAGE_KEY) || '{}');
    const connections = Array.isArray(parsed.connections) ? parsed.connections : [];
    const existingIndex = connections.findIndex((storedConnection) => storedConnection.id === connection.id);
    const nextConnections = existingIndex === -1
      ? [connection, ...connections]
      : connections.map((storedConnection) => (
        storedConnection.id === connection.id
          ? {
            ...storedConnection,
            ...connection,
            seededAt: connection.seededAt || storedConnection.seededAt,
            seededStatementsExecuted: connection.seededStatementsExecuted || storedConnection.seededStatementsExecuted,
            schemaPassword: connection.schemaPassword || storedConnection.schemaPassword,
          }
          : storedConnection
      ));

    window.localStorage.setItem(LAKEHOUSE_CONNECTION_STORAGE_KEY, JSON.stringify({
      connections: nextConnections,
      activeConnectionId: connection.id,
    }));
    window.dispatchEvent(new CustomEvent('lakehouse-connections-changed'));
  } catch {
    // Local storage is optional; the in-memory state still updates below.
  }
}

function buildDataLoadingUrl(connection) {
  return buildDbActionsSdwUrl(connection, {
    searchParams: [
      ['nav', 'adpdi'],
      ['adpdi', 'studio'],
    ],
    hash: '#',
  });
}

function getDbActionsSchemaFromPath(pathname) {
  const match = String(pathname || '').match(/^\/ords\/([^/]+)/i);
  return match?.[1] || null;
}

function withAdminDbActionsUrl(connection) {
  if (!connection?.adminDbActionsUrl) return connection;
  return {
    ...connection,
    dbActionsUrl: connection.adminDbActionsUrl,
  };
}

function withSchemaDbActionsUrl(connection) {
  if (!connection?.schemaDbActionsUrl) return connection;
  return {
    ...connection,
    dbActionsUrl: connection.schemaDbActionsUrl,
  };
}

function buildDbActionsSdwUrl(connection, { searchParams = [], hash = '' } = {}) {
  if (!connection?.dbActionsUrl) return null;

  try {
    const parsed = new URL(connection.dbActionsUrl);
    const schemaPath = getDbActionsSchemaFromPath(parsed.pathname) || LAKEHOUSE_ORDS_SCHEMA;
    parsed.pathname = `/ords/${encodeURIComponent(schemaPath)}/_sdw/`;
    parsed.search = '';
    parsed.hash = '';
    searchParams.forEach(([name, value]) => {
      parsed.searchParams.set(name, value);
    });
    if (hash) {
      parsed.hash = hash;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildDataTransformUrl(connection) {
  if (!connection?.dbActionsUrl) return null;

  try {
    const parsed = new URL(connection.dbActionsUrl);
    parsed.pathname = '/odi';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildOmlUrl(connection) {
  if (!connection?.dbActionsUrl) return null;

  try {
    const parsed = new URL(connection.dbActionsUrl);
    parsed.pathname = '/oml/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export default function App() {
  const pages = BASE_PAGES;
  const routedNavLookup = useMemo(
    () => Object.fromEntries(routedNavItems().map((item) => [item.id, item])),
    [],
  );
  const navigationGroups = useMemo(() => sidebarGroups(), []);
  const [activePage, setActivePage] = useState(resolveInitialPage);
  const [expandedNavGroups, setExpandedNavGroups] = useState(() => new Set(INITIAL_EXPANDED_NAV_GROUPS));
  const [isDatasetModalOpen, setIsDatasetModalOpen] = useState(false);
  const [activeDataset, setActiveDataset] = useState(null);
  const [activeLakehouseConnection, setActiveLakehouseConnection] = useState(readActiveLakehouseConnection);
  const [lakehouseAutoResult, setLakehouseAutoResult] = useState(null);
  const [streamingAnalyticsStatus, setStreamingAnalyticsStatus] = useState(null);

  const refreshActiveDataset = useCallback(async () => {
    try {
      const data = await api.import.dataset();
      setActiveDataset(data?.activeDataset || null);
    } catch {
      setActiveDataset(null);
    }
  }, []);

  useEffect(() => {
    refreshActiveDataset();
  }, [refreshActiveDataset]);

  useEffect(() => {
    let cancelled = false;

    api.lakehouse.auto()
      .then((result) => {
        if (cancelled) return;
        setLakehouseAutoResult(result || null);
        if (!result?.available || !result.connection) return;
        writeActiveLakehouseConnection(result.connection);
        setActiveLakehouseConnection(result.connection);
      })
      .catch(() => {
        if (!cancelled) {
          setLakehouseAutoResult({
            ok: false,
            available: false,
            error: 'AI Lakehouse status is unavailable',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const navigateToPage = useCallback((pageId, options = {}) => {
    setActivePage(pageId);
    if (options.expandGroup) {
      setExpandedNavGroups((current) => {
        const next = new Set(current);
        next.add(options.expandGroup);
        return next;
      });
    }
  }, []);

  const activeNavItem = routedNavLookup[activePage];
  const activePageTitle = activeNavItem?.label || 'Application';
  const lakehouseStatus = useMemo(() => {
    if (!activeLakehouseConnection) {
      return {
        connected: false,
        status: 'Not connected',
        detail: 'Connect ADB to activate lakehouse links',
      };
    }

    return {
      connected: true,
      status: activeLakehouseConnection.seededAt ? 'Connected and seeded' : 'Connected',
      detail: activeLakehouseConnection.name || activeLakehouseConnection.serviceName || 'Autonomous Database',
    };
  }, [activeLakehouseConnection]);
  const streamingAnalyticsDisplay = useMemo(() => {
    if (!streamingAnalyticsStatus) {
      return {
        connected: false,
        status: 'Checking',
        detail: 'GoldenGate Stream Analytics',
      };
    }

    return {
      connected: Boolean(streamingAnalyticsStatus.connected),
      status: streamingAnalyticsStatus.connected ? 'Connected' : 'Not connected',
      detail: streamingAnalyticsStatus.detail || streamingAnalyticsStatus.service || 'GoldenGate Stream Analytics',
    };
  }, [streamingAnalyticsStatus]);
  const genAiStatus = useMemo(() => {
    const aiProfile = activeLakehouseConnection?.aiProfile || lakehouseAutoResult?.connection?.aiProfile || null;
    const aiProfileResult = lakehouseAutoResult?.aiProfileResult || null;

    if (aiProfile?.enabled && !aiProfile.needsReconcile) {
      return {
        connected: true,
        status: 'Connected',
        detail: aiProfile.model
          ? `${aiProfile.profileName || 'PG AI profile'} · ${aiProfile.model}`
          : aiProfile.profileName || 'PG AI profile enabled',
      };
    }

    if (aiProfileResult?.skipped && aiProfileResult.reason === 'disabled') {
      return {
        connected: false,
        status: 'Not connected',
        detail: 'AI profile setup disabled on this server',
      };
    }

    if (aiProfile?.needsReconcile) {
      return {
        connected: false,
        status: 'Needs attention',
        detail: 'PG AI profile requires reconciliation',
      };
    }

    if (aiProfileResult?.attempted && !aiProfileResult.enabled) {
      return {
        connected: false,
        status: 'Not connected',
        detail: aiProfileResult.error || aiProfileResult.reason || 'PG AI profile setup did not complete',
      };
    }

    if (lakehouseAutoResult && !activeLakehouseConnection) {
      return {
        connected: false,
        status: 'Not connected',
        detail: 'ADB connection required',
      };
    }

    if (!lakehouseAutoResult) {
      return {
        connected: false,
        status: 'Checking',
        detail: 'PG AI profile',
      };
    }

    return {
      connected: false,
      status: 'Not connected',
      detail: 'No enabled PG AI profile detected',
    };
  }, [activeLakehouseConnection, lakehouseAutoResult]);
  const lakehouseLoadReady = Boolean(
    activeLakehouseConnection?.goldDataLoaded || lakehouseAutoResult?.connection?.goldDataLoaded,
  );
  const liveStackReadiness = useMemo(() => {
    const checks = [
      {
        id: 'adb',
        label: 'Autonomous Database',
        ready: Boolean(lakehouseStatus.connected),
        description: 'The active ADB connection used for DB Actions, Data Studio, and the AI Lakehouse schema.',
      },
      {
        id: 'osa',
        label: 'GoldenGate Stream Analytics',
        ready: Boolean(streamingAnalyticsDisplay.connected),
        description: 'The streaming analytics service that powers the live demand signal pipeline.',
      },
      {
        id: 'genai',
        label: 'OCI GenAI',
        ready: Boolean(genAiStatus.connected),
        description: 'The PG AI profile that points database AI calls to the configured OCI Generative AI model.',
      },
      {
        id: 'load',
        label: 'Demo data load',
        ready: lakehouseLoadReady,
        description: 'The PeakGear demo tables and gold-layer data required by the lakehouse scenarios.',
      },
    ];
    const readyCount = checks.filter((check) => check.ready).length;
    const ready = readyCount === checks.length;

    return {
      ready,
      readyCount,
      checks,
      label: ready ? 'LiveStack Demo ready' : 'LiveStack setup in progress',
    };
  }, [
    genAiStatus.connected,
    lakehouseLoadReady,
    lakehouseStatus.connected,
    streamingAnalyticsDisplay.connected,
  ]);
  const dataLoadingUrl = useMemo(
    () => buildDataLoadingUrl(activeLakehouseConnection),
    [activeLakehouseConnection],
  );
  const dataTransformUrl = useMemo(
    () => buildDataTransformUrl(activeLakehouseConnection),
    [activeLakehouseConnection],
  );
  const adminLakehouseConnection = useMemo(
    () => withAdminDbActionsUrl(activeLakehouseConnection),
    [activeLakehouseConnection],
  );
  const omlUrl = useMemo(
    () => buildOmlUrl(adminLakehouseConnection),
    [adminLakehouseConnection],
  );
  const schemaLakehouseConnection = useMemo(
    () => withSchemaDbActionsUrl(activeLakehouseConnection),
    [activeLakehouseConnection],
  );
  const lakehouseActionUrls = useMemo(() => ({
    'adb-data-load': dataLoadingUrl,
    'adb-data-transform': dataTransformUrl,
    'adb-oml': omlUrl,
    'adb-sql-developer-web': buildDbActionsSdwUrl(schemaLakehouseConnection, {
      searchParams: [['nav', 'worksheet']],
    }),
    'adb-actions-launchpad': buildDbActionsSdwUrl(schemaLakehouseConnection),
    'adb-graph-studio': buildDbActionsSdwUrl(schemaLakehouseConnection, { hash: '#' }),
    'adb-spatial-studio': buildDbActionsSdwUrl(schemaLakehouseConnection, { hash: '#' }),
    'adb-json': buildDbActionsSdwUrl(schemaLakehouseConnection, {
      searchParams: [
        ['nav', 'application'],
        ['application', 'soda'],
      ],
    }),
    'adb-data-studio-overview': dataLoadingUrl,
  }), [dataLoadingUrl, dataTransformUrl, omlUrl, schemaLakehouseConnection]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const refreshLakehouseConnection = () => {
      setActiveLakehouseConnection(readActiveLakehouseConnection());
    };

    window.addEventListener('storage', refreshLakehouseConnection);
    window.addEventListener('lakehouse-connections-changed', refreshLakehouseConnection);
    return () => {
      window.removeEventListener('storage', refreshLakehouseConnection);
      window.removeEventListener('lakehouse-connections-changed', refreshLakehouseConnection);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    api.streamingAnalytics.status()
      .then((status) => {
        if (!cancelled) {
          setStreamingAnalyticsStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStreamingAnalyticsStatus({
            connected: false,
            detail: 'GoldenGate Stream Analytics status is unavailable',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleNavGroup = useCallback((groupId) => {
    setExpandedNavGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (activePage === 'welcome') {
      params.delete('page');
    } else {
      params.set('page', activePage);
    }
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [activePage]);

  return (
    <>
      <UserProvider>
        <OraclePanelProvider>
          <div className="app-shell">
            <aside className="app-sidebar">
              <div className="app-sidebar-header">
                <OracleBrand />
              </div>

              <nav className="app-nav app-nav--grouped" aria-label="Primary">
                <button
                  type="button"
                  onClick={() => navigateToPage(WELCOME_NAV_ITEM.id)}
                  className={`nav-link ${activePage === WELCOME_NAV_ITEM.id ? 'active' : ''}`}
                >
                  <span className={`${WELCOME_NAV_ITEM.iconClass} oj-fwk-icon app-nav-icon`} aria-hidden="true" />
                  <span>{WELCOME_NAV_ITEM.label}</span>
                </button>

                {navigationGroups.map(({ id, label, iconClass, items }) => {
                  const isExpanded = expandedNavGroups.has(id);
                  const hasActiveItem = items.some((item) => item.pageId === activePage);
                  const groupPanelId = `nav-group-${id}`;

                  return (
                    <section key={id} className={`nav-group ${hasActiveItem ? 'has-active' : ''}`}>
                      <button
                        type="button"
                        className={`nav-folder ${isExpanded ? 'is-expanded' : ''} ${hasActiveItem ? 'has-active' : ''}`}
                        aria-expanded={isExpanded}
                        aria-controls={groupPanelId}
                        onClick={() => toggleNavGroup(id)}
                      >
                        <span className={`${iconClass} oj-fwk-icon app-nav-icon`} aria-hidden="true" />
                        <span className="nav-folder-label">{label}</span>
                        <span className="nav-folder-chevron" aria-hidden="true" />
                      </button>

                      {isExpanded && (
                        <div id={groupPanelId} className="nav-group-items">
                          {items.map((item) => (
                            item.pageId ? (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => navigateToPage(item.pageId)}
                                className={`nav-link nav-link--leaf ${activePage === item.pageId ? 'active' : ''}`}
                              >
                                {item.Icon ? (
                                  <item.Icon className="nav-leaf-icon" aria-hidden="true" />
                                ) : (
                                  <span className={`${item.iconClass} oj-fwk-icon app-nav-icon`} aria-hidden="true" />
                                )}
                                <span>{item.label}</span>
                              </button>
                            ) : item.actionId && lakehouseActionUrls[item.actionId] ? (
                              <button
                                key={item.id}
                                type="button"
                                className="nav-leaf nav-leaf--static nav-leaf--action"
                                onClick={() => window.open(lakehouseActionUrls[item.actionId], '_blank', 'noopener,noreferrer')}
                              >
                                {item.Icon ? (
                                  <item.Icon className="nav-leaf-icon" aria-hidden="true" />
                                ) : (
                                  <span className="nav-leaf-dot" aria-hidden="true" />
                                )}
                                <span>{item.label}</span>
                              </button>
                            ) : (
                              <div key={item.id} className="nav-leaf nav-leaf--static">
                                {item.Icon ? (
                                  <item.Icon className="nav-leaf-icon" aria-hidden="true" />
                                ) : (
                                  <span className="nav-leaf-dot" aria-hidden="true" />
                                )}
                                <span>{item.label}</span>
                              </div>
                            )
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </nav>

              <div className="app-sidebar-footer">
                <UserSwitcher />
              </div>
            </aside>

            <div className="app-main">
              <header className="app-topbar">
                <div className="app-topbar-copy">
                  <h2 className="app-topbar-title">{activePageTitle}</h2>
                </div>
                <JetButton
                  label="Use Your Own Data"
                  iconClass="oj-fwk-icon oj-fwk-icon-tree-document"
                  chroming="outlined"
                  className="app-topbar-action app-topbar-action--hidden"
                  onAction={() => setIsDatasetModalOpen(true)}
                />
              </header>

              <main className="app-content">
                <div className="app-page-frame">
                  {activePage === 'welcome' ? (
                    <Welcome
                      onNavigate={navigateToPage}
                      hasLakehouseConnection={Boolean(activeLakehouseConnection && dataLoadingUrl)}
                    />
                  ) : (
                    (() => {
                      const PageComponent = pages[activePage];
                      if (!PageComponent) return null;
                      const pageProps = activePage === 'lakehouse'
                          ? {
                            liveStackReadiness,
                            liveStackStatus: {
                              lakehouse: lakehouseStatus,
                              streamingAnalytics: streamingAnalyticsDisplay,
                              genAi: genAiStatus,
                            },
                          }
                        : activePage === BRONZE_DATA_LOAD_PAGE_ID
                          ? {
                            dataStudioUrl: dataLoadingUrl,
                            hasLakehouseConnection: Boolean(activeLakehouseConnection && dataLoadingUrl),
                            pgPassword: activeLakehouseConnection?.schemaPassword,
                          }
                          : activePage === SILVER_PROCESS_PAGE_ID || activePage === ICEBERG_CATALOG_SERVER_PAGE_ID
                            ? {
                              dataTransformsUrl: dataTransformUrl,
                              hasLakehouseConnection: Boolean(activeLakehouseConnection && dataTransformUrl),
                              pgPassword: activeLakehouseConnection?.schemaPassword,
                            }
                          : {};
                      return <PageComponent {...pageProps} />;
                    })()
                  )}
                </div>
              </main>
            </div>

            <RightOraclePanel />
          </div>
        </OraclePanelProvider>
      </UserProvider>

      {isDatasetModalOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dataset-tool-title"
        >
          <div className="absolute inset-0 surface-bark-overlay" onClick={() => setIsDatasetModalOpen(false)} />
          <AdminEntry
            mode="overlay"
            activeDataset={activeDataset}
            onClose={() => setIsDatasetModalOpen(false)}
            onDatasetChanged={() => {
              void refreshActiveDataset();
              setIsDatasetModalOpen(false);
            }}
          />
        </div>
      )}
    </>
  );
}
