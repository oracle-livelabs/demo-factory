import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  ExternalLink,
  FileArchive,
  Loader2,
  Package,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import CopySecretButton from '../components/CopySecretButton';
import ImportanceModal, { ImportanceButton } from '../components/ImportanceModal';
import { JetButton, JetGlyph } from '../components/JetControls';
import { FeatureBadge, SqlBlock } from '../components/OracleInfoPanel';
import { RegisterOraclePanel } from '../context/OraclePanelContext';
import { IMPORTANCE_CONTENT } from '../content/importanceContent';
import { api } from '../utils/api';

const EXAMPLE_CONNECT_STRING = '(description= (retry_count=20)(retry_delay=3)(address=(protocol=tcps)(port=1522)(host=my-adb-host.adb.example-region.oraclecloud.com))(connect_data=(service_name=myadb_high.adb.oraclecloud.com))(security=(ssl_server_dn_match=yes)))';
const STORAGE_KEY = 'peakgear.aiLakehouseConnections.v1';
const ADMIN_USERNAME = 'ADMIN';
const SEEDED_SCHEMA_USERNAME = 'PG';

function withDbActionsRoute(url) {
  const value = String(url || '').trim();
  if (!value) return value;

  try {
    const parsed = new URL(value);
    parsed.searchParams.set('r', '_sdw');
    return parsed.toString();
  } catch {
    return value.includes('?') ? `${value}&r=_sdw` : `${value}?r=_sdw`;
  }
}

function readStoredState() {
  if (typeof window === 'undefined') {
    return { connections: [], activeConnectionId: null };
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    const connections = Array.isArray(parsed.connections)
      ? parsed.connections
        .filter((connection) => connection?.id && connection?.dbActionsUrl)
        .map((connection) => ({
          ...connection,
          dbActionsUrl: withDbActionsRoute(connection.dbActionsUrl),
        }))
      : [];
    const activeConnectionId = connections.some((connection) => connection.id === parsed.activeConnectionId)
      ? parsed.activeConnectionId
      : connections[0]?.id || null;
    return { connections, activeConnectionId };
  } catch {
    return { connections: [], activeConnectionId: null };
  }
}

function writeStoredState(connections, activeConnectionId) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ connections, activeConnectionId }));
  window.dispatchEvent(new CustomEvent('lakehouse-connections-changed'));
}

function createConnectionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `adb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultConnectionName(validation) {
  const databaseName = validation?.database?.DB_NAME || validation?.database?.db_name;
  if (databaseName) return `${databaseName} (${validation.username || ADMIN_USERNAME})`;
  const serviceName = validation?.serviceName?.replace(/_(medium|high|low|tpurgent)(?=\.adb\.|$)/i, '');
  return serviceName || `ADB ${validation.username || ADMIN_USERNAME}`;
}

function DetailRow({ label, value }) {
  return (
    <div className="lakehouse-detail-row">
      <span>{label}</span>
      <strong>{value || 'Not available'}</strong>
    </div>
  );
}

function ConfiguredConnectionCard({ connection, isActive, onSelect, onEdit, onRemove, onOpenDbActions }) {
  const seededSchemaPassword = connection.schemaPassword || 'From DBPASSWORD';

  return (
    <article className={`lakehouse-connection-card ${isActive ? 'is-active' : ''}`}>
      <button type="button" className="lakehouse-connection-select" onClick={onSelect}>
        <span className="lakehouse-connection-radio" aria-hidden="true" />
        <span>
          <strong>{connection.name}</strong>
          <small>{connection.serviceName}</small>
        </span>
      </button>
      <div className="lakehouse-connection-meta">
        <span>{connection.username}</span>
        <span>{new Date(connection.validatedAt).toLocaleString()}</span>
      </div>
      {connection.seededAt && (
        <div className="lakehouse-pg-credentials" aria-label="Seeded PG user credentials">
          <div>
            <span>User</span>
            <strong>{SEEDED_SCHEMA_USERNAME}</strong>
          </div>
          <div>
            <span>Password</span>
            <div className="credential-copy-row">
              <strong>{seededSchemaPassword}</strong>
              <CopySecretButton
                value={connection.schemaPassword}
                label="PG password"
                disabled={!connection.schemaPassword}
                unavailableTitle="Seeded PG password is not available to copy"
              />
            </div>
          </div>
        </div>
      )}
      <div className="lakehouse-connection-actions">
        <button type="button" className="btn-ghost" onClick={onOpenDbActions}>
          <ExternalLink size={14} />
          DB Actions
        </button>
        <button type="button" className="btn-ghost" onClick={onEdit}>Edit</button>
        <button type="button" className="btn-ghost lakehouse-danger-action" onClick={onRemove}>Remove</button>
      </div>
    </article>
  );
}

function SeedLakehouseProgress({ seeding, seedResult, seedError, action }) {
  if (!seeding && !seedResult?.seeded && !seedError) return null;

  const isSuccess = Boolean(seedResult?.seeded);
  const isError = Boolean(seedError);
  const isReset = action === 'reset' || seedResult?.action === 'reset';
  const activeVerb = isReset ? 'Resetting' : 'Seeding';
  const successTitle = isReset ? 'Successfully reset' : 'Successfully seeded';

  return (
    <div
      className={`lakehouse-seed-progress ${isSuccess ? 'is-success' : ''} ${isError ? 'is-error' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={seeding ? 'true' : 'false'}
    >
      <div className="lakehouse-seed-progress__header">
        <strong>
          {seeding ? `${activeVerb} lakehouse` : isSuccess ? successTitle : 'Seed failed'}
        </strong>
        <span>
          {seeding
            ? isReset ? 'Re-running PG setup scripts' : 'Running PG setup scripts'
            : isSuccess
              ? `${seedResult.statementsExecuted} SQL statements executed`
              : 'Review the error and validate the connection again'}
        </span>
      </div>
      <div
        className="lakehouse-seed-progress__track"
        role="progressbar"
        aria-label="Seed Lakehouse progress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={isSuccess ? '100' : undefined}
      >
        <span className="lakehouse-seed-progress__bar" />
      </div>
      {isSuccess && (
        <p>
          {successTitle}. Existing PG user {seedResult.droppedExisting ? 'was dropped first' : 'did not exist'}.
        </p>
      )}
      {isError && (
        <p>
          {seedError.message}
          {seedError.details?.code ? ` Code: ${seedError.details.code}` : ''}
        </p>
      )}
    </div>
  );
}

function LakehouseReadinessPanel({ readiness }) {
  const checks = readiness?.checks || [];
  if (!checks.length) return null;

  const total = checks.length;
  const readyCount = readiness?.readyCount ?? checks.filter((check) => check.ready).length;

  return (
    <section className="glass-card p-5 lakehouse-readiness-panel" aria-labelledby="lakehouse-readiness-title">
      <div className="lakehouse-readiness-header">
        <div>
          <p className="section-kicker">Runtime Check</p>
          <h3 id="lakehouse-readiness-title" className="text-lg font-bold mt-1">
            {readiness?.label || 'LiveStack setup status'}
          </h3>
          <p className="text-sm text-[var(--color-text-dim)] mt-1">
            These checks show whether the services behind the lakehouse demos are ready for hands-on walkthroughs.
          </p>
        </div>
        <div
          className={`lakehouse-readiness-score ${readyCount === total ? 'is-ready' : ''}`}
          role="status"
          aria-label={`${readyCount} of ${total} LiveStack checks are ready`}
        >
          <strong>{readyCount}/{total}</strong>
          <span>ready</span>
        </div>
      </div>

      <div className="lakehouse-readiness-strip" aria-hidden="true">
        {checks.map((check) => (
          <span key={check.id} className={check.ready ? 'is-ready' : ''} />
        ))}
      </div>

      <div className="lakehouse-readiness-grid">
        {checks.map((check) => (
          <article key={check.id} className={`lakehouse-readiness-item ${check.ready ? 'is-ready' : ''}`}>
            <div className="lakehouse-readiness-item__header">
              <span className="lakehouse-readiness-light" aria-hidden="true" />
              <div>
                <strong>{check.label}</strong>
                <span>{check.ready ? 'Ready' : 'Pending'}</span>
              </div>
            </div>
            <p>{check.description || 'Runtime check status for this lakehouse service.'}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function LiveStackStatusCard({ label, status }) {
  const connected = Boolean(status?.connected);
  const value = status?.status || 'Checking';
  const detail = status?.detail || 'Status unavailable';

  return (
    <article className={`livestack-status-card ${connected ? 'is-connected' : 'is-disconnected'}`}>
      <div className="livestack-status-card__header">
        <span className="livestack-status-card__icon" aria-hidden="true">
          {connected ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
        </span>
        <div>
          <p>{label}</p>
          <strong>{value}</strong>
        </div>
      </div>
      <span>{detail}</span>
    </article>
  );
}

function LiveStackStatusSection({ status }) {
  const statusItems = [
    { label: 'Autonomous Database', status: status?.lakehouse },
    { label: 'GoldenGate Stream Analytics', status: status?.streamingAnalytics },
    { label: 'OCI GenAI', status: status?.genAi },
  ];

  return (
    <section className="livestack-status-section" aria-labelledby="livestack-status-title">
      <div>
        <p className="section-kicker">Runtime Status</p>
        <h3 id="livestack-status-title" className="text-lg font-bold mt-1">LiveStack service connections</h3>
        <p className="text-sm text-[var(--color-text-dim)] mt-1">
          Current connectivity for the services used by the PeakGear demo runtime.
        </p>
      </div>
      <div className="livestack-status-grid">
        {statusItems.map((item) => (
          <LiveStackStatusCard key={item.label} label={item.label} status={item.status} />
        ))}
      </div>
    </section>
  );
}

function DemoDataStatusGrid({ status }) {
  const cards = [
    { label: 'Products', value: status?.products ?? 0, accent: '#437C94' },
    { label: 'Demand Signals', value: status?.social_posts ?? 0, accent: '#A36472' },
    { label: 'Orders', value: status?.orders ?? 0, accent: '#4C825C' },
    { label: 'Product Vectors', value: status?.product_embeddings ?? 0, accent: '#4F7D7B' },
    { label: 'Spatial Zones', value: status?.fulfillment_zones ?? 0, accent: '#AA643B' },
    { label: 'Demand Regions', value: status?.demand_regions ?? 0, accent: '#AA643B' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg p-3 text-center border border-[var(--color-border)]"
          style={{ boxShadow: `inset 0 2px 0 ${card.accent}`, background: 'var(--color-surface)' }}
        >
          <p className="text-lg font-bold font-mono">{Number(card.value || 0).toLocaleString()}</p>
          <p className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wide mt-1">{card.label}</p>
        </div>
      ))}
    </div>
  );
}

function LiveStackDemoDataSection({
  status,
  totalArtifacts,
  hasData,
  running,
  done,
  progress,
  message,
  onStart,
}) {
  return (
    <section className="glass-card p-5" aria-labelledby="livestack-demo-data-title">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <p className="section-kicker">Demo Maintenance</p>
          <h3 id="livestack-demo-data-title" className="text-lg font-bold flex items-center gap-2 mt-1">
            <Package size={18} className="text-[var(--color-accent)]" />
            Verify & Refresh Demo Data
          </h3>
          <p className="text-xs text-[var(--color-text-dim)] mt-1">
            {totalArtifacts == null
              ? 'Current runtime counts from the live demo stack.'
              : `${totalArtifacts.toLocaleString()} tracked records across the major demo layers.`}
          </p>
        </div>
        <button
          type="button"
          onClick={onStart}
          disabled={running}
          className="data-model-demo-button"
        >
          {running ? (
            <Loader2 size={16} className="animate-spin" />
          ) : hasData ? (
            <RefreshCw size={16} />
          ) : (
            <Play size={16} />
          )}
          <span>{running ? 'Refreshing Demo...' : hasData ? 'Verify & Refresh Demo' : 'Load Demo Data'}</span>
        </button>
      </div>
      {(message || running || done) && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--color-text-dim)]">{message || 'Waiting for demo refresh...'}</span>
            <span className="text-xs font-mono font-semibold">{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--color-border)]/30 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress}%`,
                background: done
                  ? '#4C825C'
                  : 'linear-gradient(135deg, #C74634, #AA643B)',
              }}
            />
          </div>
          {done ? (
            <div className="flex items-center gap-1.5 text-[11px] tone-pine">
              <CheckCircle2 size={12} />
              Latest demo verification finished and live counts were refreshed.
            </div>
          ) : null}
        </div>
      )}
      <DemoDataStatusGrid status={status} />
    </section>
  );
}

function LiveStackMaintenanceSection({
  cleaning,
  cleanupResult,
  cleanupError,
  onClearReturnAgentConversation,
}) {
  return (
    <section className="livestack-maintenance-section" aria-labelledby="livestack-maintenance-title">
      <div>
        <p className="section-kicker">Demo Maintenance</p>
        <h3 id="livestack-maintenance-title" className="text-lg font-bold mt-1">Ask PeakGear conversation reset</h3>
        <p className="text-sm text-[var(--color-text-dim)] mt-1">
          Reset customer_order_status table
        </p>
      </div>
      <div className="livestack-maintenance-action">
        <button
          type="button"
          className="btn-ghost lakehouse-danger-action"
          onClick={onClearReturnAgentConversation}
          disabled={cleaning}
        >
          {cleaning ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          {cleaning ? 'Clearing...' : 'Clear Return Conversation'}
        </button>
        {cleanupResult && (
          <p className="livestack-maintenance-message is-success">
            Cleared {cleanupResult.counts?.returnExchangeRequests || 0} request row(s) and {cleanupResult.counts?.orderServiceEvents || 0} event row(s).
          </p>
        )}
        {cleanupError && (
          <p className="livestack-maintenance-message is-error">{cleanupError}</p>
        )}
      </div>
    </section>
  );
}

function AwsGlueCatalogSection() {
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setResult(null);
    setError('');

    try {
      const request = api.awsGlue.configure({ accessKeyId, secretAccessKey, region });
      setAccessKeyId('');
      setSecretAccessKey('');
      const response = await request;
      setResult(response);
    } catch (err) {
      setError(err.message || 'AWS Glue catalog configuration failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="glass-card p-5 space-y-4" aria-labelledby="aws-glue-catalog-heading">
      <div>
        <p className="section-kicker">Experimental catalog integration</p>
        <h3 id="aws-glue-catalog-heading" className="text-lg font-bold mt-1">AWS Glue Data Catalog</h3>
        <p className="text-sm text-[var(--color-text-dim)] mt-1">
          Mount an AWS Glue catalog in the configured Autonomous Database as <code>GLUE_CAT</code>.
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="lakehouse-form-grid">
          <label className="lakehouse-field" htmlFor="aws-glue-access-key-id">
            <span>AWS Access Key ID</span>
            <input
              id="aws-glue-access-key-id"
              className="lakehouse-input"
              type="text"
              value={accessKeyId}
              autoComplete="off"
              required
              onChange={(event) => setAccessKeyId(event.target.value)}
            />
          </label>
          <label className="lakehouse-field" htmlFor="aws-glue-secret-access-key">
            <span>AWS Secret Access Key</span>
            <input
              id="aws-glue-secret-access-key"
              className="lakehouse-input"
              type="password"
              value={secretAccessKey}
              autoComplete="new-password"
              required
              onChange={(event) => setSecretAccessKey(event.target.value)}
            />
          </label>
          <label className="lakehouse-field" htmlFor="aws-glue-region">
            <span>AWS Region</span>
            <input
              id="aws-glue-region"
              className="lakehouse-input"
              type="text"
              value={region}
              placeholder="us-east-1"
              required
              onChange={(event) => setRegion(event.target.value)}
            />
          </label>
        </div>

        <p className="text-xs text-[var(--color-text-dim)]">
          Credentials are submitted once to create the ADB credential <code>AWS_CRED</code>. They are not stored in this browser, the custom image, Terraform, or application configuration.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Configuring AWS Glue...' : 'Configure AWS Glue Catalog'}
          </button>
          {submitting && <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />}
        </div>
      </form>

      {result && (
        <div className="lakehouse-message is-success">
          <p>AWS Glue catalog <code>{result.catalogName}</code> is mounted for region <code>{result.region}</code>.</p>
        </div>
      )}
      {error && <div className="lakehouse-message is-error"><p>{error}</p></div>}
    </section>
  );
}

export default function AIDataLakehouse({ liveStackReadiness, liveStackStatus }) {
  const initialState = useMemo(readStoredState, []);
  const [connections, setConnections] = useState(initialState.connections);
  const [activeConnectionId, setActiveConnectionId] = useState(initialState.activeConnectionId);
  const [isFormOpen, setIsFormOpen] = useState(initialState.connections.length === 0);
  const [editingConnectionId, setEditingConnectionId] = useState(null);
  const [connectionName, setConnectionName] = useState('');
  const [connectionString, setConnectionString] = useState('');
  const [password, setPassword] = useState('');
  const [walletFile, setWalletFile] = useState(null);
  const [validation, setValidation] = useState(null);
  const [error, setError] = useState(null);
  const [validating, setValidating] = useState(false);
  const [adminCredential, setAdminCredential] = useState(null);
  const [seedResult, setSeedResult] = useState(null);
  const [seedError, setSeedError] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [seedAction, setSeedAction] = useState('seed');
  const [cleaningReturnConversation, setCleaningReturnConversation] = useState(false);
  const [returnConversationCleanup, setReturnConversationCleanup] = useState(null);
  const [returnConversationCleanupError, setReturnConversationCleanupError] = useState('');
  const [demoStatus, setDemoStatus] = useState(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoDone, setDemoDone] = useState(false);
  const [demoProgress, setDemoProgress] = useState(0);
  const [demoMessage, setDemoMessage] = useState('');
  const [showImportance, setShowImportance] = useState(false);
  const eventSourceRef = useRef(null);

  const refreshDemoStatus = useCallback(() => {
    return fetch('/api/demo/status')
      .then((res) => res.json())
      .then((data) => {
        setDemoStatus(data);
        return data;
      })
      .catch(() => {
        setDemoStatus(null);
        return null;
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadServerWalletConnection() {
      try {
        const result = await api.lakehouse.auto();
        if (cancelled || !result?.available || !result.connection) return;

        const serverConnection = {
          ...result.connection,
          dbActionsUrl: withDbActionsRoute(result.connection.dbActionsUrl),
        };

        setConnections((current) => {
          const existingIndex = current.findIndex((connection) => connection.id === serverConnection.id);
          if (existingIndex === -1) return [serverConnection, ...current];
          return current.map((connection) => (
            connection.id === serverConnection.id
              ? {
                ...connection,
                ...serverConnection,
                seededAt: serverConnection.seededAt || connection.seededAt,
                seededStatementsExecuted: serverConnection.seededStatementsExecuted || connection.seededStatementsExecuted,
              }
              : connection
          ));
        });
        setActiveConnectionId(serverConnection.id);
        setIsFormOpen(false);
        setValidation({
          connected: Boolean(result.connected),
          serviceName: serverConnection.serviceName,
          dbActionsUrl: serverConnection.dbActionsUrl,
          username: serverConnection.username || ADMIN_USERNAME,
          database: serverConnection.database || {},
          wallet: serverConnection.wallet || { uploaded: false },
        });
        setError(null);

        if (result.seedResult) {
          setSeedAction('seed');
          setSeedResult({
            ...result.seedResult,
            action: 'seed',
            connectionId: serverConnection.id,
          });
        }
      } catch (err) {
        if (cancelled) return;
        setError({
          message: err.message,
          details: err.details,
        });
      }
    }

    loadServerWalletConnection();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshDemoStatus();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [refreshDemoStatus]);

  useEffect(() => {
    const nextActiveConnectionId = connections.some((connection) => connection.id === activeConnectionId)
      ? activeConnectionId
      : connections[0]?.id || null;
    if (nextActiveConnectionId !== activeConnectionId) {
      setActiveConnectionId(nextActiveConnectionId);
      return;
    }
    writeStoredState(connections, activeConnectionId);
  }, [activeConnectionId, connections]);

  const activeConnection = useMemo(
    () => connections.find((connection) => connection.id === activeConnectionId) || null,
    [activeConnectionId, connections],
  );

  const fileLabel = useMemo(() => {
    if (!walletFile) return 'No wallet selected';
    const kb = Math.max(1, Math.round(walletFile.size / 1024));
    return `${walletFile.name} (${kb.toLocaleString()} KB)`;
  }, [walletFile]);

  const canValidate = isFormOpen && connectionString.trim() && password && !validating;
  const activeDbActionsUrl = validation?.connected
    ? withDbActionsRoute(validation.dbActionsUrl)
    : activeConnection?.dbActionsUrl;
  const activeDatabase = validation?.connected
    ? validation.database || {}
    : activeConnection?.database || {};
  const activeConnectionSeeded = Boolean(activeConnection?.seededAt);
  const activeSeedResult = !seedResult?.connectionId || seedResult.connectionId === activeConnection?.id
    ? seedResult
    : null;
  const activeSeedError = !seedError?.connectionId || seedError.connectionId === activeConnection?.id
    ? seedError
    : null;
  const seedLakehouseButtonLabel = seeding
    ? seedAction === 'reset' ? 'Resetting...' : 'Seeding...'
    : activeConnectionSeeded ? 'Reset Lakehouse' : 'Seed Lakehouse';
  const canSeedLakehouse = Boolean(
    activeConnection
      && !seeding
      && !validating,
  );
  const demoTotalArtifacts = useMemo(() => {
    if (!demoStatus) return null;
    return (
      (demoStatus.products || 0) +
      (demoStatus.social_posts || 0) +
      (demoStatus.orders || 0) +
      (demoStatus.product_embeddings || 0) +
      (demoStatus.fulfillment_zones || 0) +
      (demoStatus.demand_regions || 0)
    );
  }, [demoStatus]);
  const demoHasData = useMemo(() => {
    if (!demoStatus) return false;
    return Object.values(demoStatus).some((value) => typeof value === 'number' && value > 0);
  }, [demoStatus]);

  const startDemoRefresh = useCallback(() => {
    if (demoRunning) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setDemoRunning(true);
    setDemoDone(false);
    setDemoProgress(0);
    setDemoMessage(demoHasData ? 'Verifying and refreshing live demo data...' : 'Loading live demo data...');

    const source = new EventSource('/api/demo/start');
    eventSourceRef.current = source;

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (typeof data.progress === 'number' && data.progress >= 0) {
          setDemoProgress(data.progress);
        }
        if (data.message) {
          setDemoMessage(data.message);
        }

        if (data.step === 'complete' && data.status === 'done') {
          setDemoRunning(false);
          setDemoDone(true);
          setDemoProgress(100);
          setDemoMessage(data.message || 'Demo verification complete.');
          source.close();
          eventSourceRef.current = null;
          refreshDemoStatus();
        }

        if (data.status === 'error' && data.progress === -1) {
          setDemoRunning(false);
          setDemoDone(false);
          setDemoMessage(data.message || 'Demo refresh failed.');
          source.close();
          eventSourceRef.current = null;
          refreshDemoStatus();
        }
      } catch {
        setDemoRunning(false);
        setDemoMessage('Demo refresh returned invalid progress data.');
        source.close();
        eventSourceRef.current = null;
      }
    };

    source.onerror = () => {
      setDemoRunning(false);
      setDemoMessage('Demo refresh interrupted.');
      source.close();
      eventSourceRef.current = null;
      refreshDemoStatus();
    };
  }, [demoHasData, demoRunning, refreshDemoStatus]);

  function resetForm() {
    setEditingConnectionId(null);
    setConnectionName('');
    setConnectionString('');
    setPassword('');
    setWalletFile(null);
    setValidation(null);
    setError(null);
    setSeedError(null);
  }

  function handleAddConnection() {
    resetForm();
    setIsFormOpen(true);
  }

  function handleEditConnection(connection) {
    setEditingConnectionId(connection.id);
    setConnectionName(connection.name || '');
    setConnectionString(connection.connectionString || '');
    setPassword('');
    setWalletFile(null);
    setValidation(null);
    setError(null);
    setSeedError(null);
    setIsFormOpen(true);
  }

  function handleCancelForm() {
    resetForm();
    setIsFormOpen(connections.length === 0);
  }

  function handleRemoveConnection(connectionId) {
    const nextConnections = connections.filter((connection) => connection.id !== connectionId);
    setConnections(nextConnections);
    if (editingConnectionId === connectionId) {
      resetForm();
    }
    if (adminCredential?.connectionId === connectionId) {
      setAdminCredential(null);
    }
    if (nextConnections.length === 0) {
      setIsFormOpen(true);
    }
  }

  async function handleValidate() {
    if (!canValidate) {
      setError({ message: 'Connection string and ADMIN password are required.' });
      setValidation(null);
      return;
    }

    try {
      setValidating(true);
      setError(null);
      setSeedError(null);
      setSeedResult(null);
      setValidation(null);
      const result = await api.lakehouse.validate({
        connectionString,
        password,
        walletFile,
      });

      const savedConnectionId = editingConnectionId || createConnectionId();
      const previousConnection = connections.find((connection) => connection.id === savedConnectionId);
      const preservesSeededState = previousConnection?.connectionString?.trim() === connectionString.trim();
      const savedConnection = {
        id: savedConnectionId,
        name: connectionName.trim() || defaultConnectionName(result),
        connectionString: connectionString.trim(),
        username: result.username || ADMIN_USERNAME,
        serviceName: result.serviceName,
        dbActionsUrl: withDbActionsRoute(result.dbActionsUrl),
        database: result.database || {},
        wallet: result.wallet || { uploaded: false },
        validatedAt: new Date().toISOString(),
        ...(preservesSeededState && previousConnection?.seededAt
          ? {
            seededAt: previousConnection.seededAt,
            seededStatementsExecuted: previousConnection.seededStatementsExecuted,
          }
          : {}),
      };

      setConnections((current) => {
        const existingIndex = current.findIndex((connection) => connection.id === savedConnectionId);
        if (existingIndex === -1) return [...current, savedConnection];
        return current.map((connection) => (connection.id === savedConnectionId ? savedConnection : connection));
      });
      setActiveConnectionId(savedConnectionId);
      setValidation(result);
      setAdminCredential({
        connectionId: savedConnectionId,
        password,
        walletFile,
      });
      setEditingConnectionId(null);
      setIsFormOpen(false);
      setPassword('');
      setWalletFile(null);
    } catch (err) {
      setError({
        message: err.message,
        details: err.details,
      });
    } finally {
      setValidating(false);
    }
  }

  async function handleSeedLakehouse() {
    if (!activeConnection) return;

    const targetConnection = activeConnection;
    const nextSeedAction = targetConnection.seededAt ? 'reset' : 'seed';
    setSeedAction(nextSeedAction);

    if (!adminCredential?.password || adminCredential.connectionId !== targetConnection.id) {
      handleEditConnection(targetConnection);
      setSeedError({
        connectionId: targetConnection.id,
        message: `Enter the ADMIN password and validate this connection before ${nextSeedAction === 'reset' ? 'resetting' : 'seeding'} the lakehouse.`,
      });
      setSeedResult(null);
      return;
    }

    try {
      setSeeding(true);
      setSeedError(null);
      setSeedResult(null);
      const result = await api.lakehouse.seed({
        connectionString: targetConnection.connectionString,
        password: adminCredential.password,
        walletFile: adminCredential.walletFile,
      });
      const seededAt = new Date().toISOString();
      setSeedResult({
        ...result,
        action: nextSeedAction,
        connectionId: targetConnection.id,
      });
      setConnections((current) => current.map((connection) => (
        connection.id === targetConnection.id
          ? {
            ...connection,
            seededAt,
            seededStatementsExecuted: result.statementsExecuted,
            schemaPassword: result.schemaPassword || connection.schemaPassword,
          }
          : connection
      )));
    } catch (err) {
      setSeedError({
        connectionId: targetConnection.id,
        message: err.message,
        details: err.details,
      });
    } finally {
      setSeeding(false);
    }
  }

  function handleOpenDbActions(url = activeDbActionsUrl) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function handleUseExample() {
    setConnectionName('My ADB');
    setConnectionString(EXAMPLE_CONNECT_STRING);
    setValidation(null);
    setError(null);
    setSeedError(null);
    setSeedResult(null);
  }

  async function handleClearReturnAgentConversation() {
    const confirmed = window.confirm(
      'Clear the Ask PeakGear Returns & Exchanges demo conversation rows for order 7820?',
    );
    if (!confirmed) return;

    try {
      setCleaningReturnConversation(true);
      setReturnConversationCleanup(null);
      setReturnConversationCleanupError('');
      const result = await api.webshop.clearAgentConversations();
      setReturnConversationCleanup(result);
    } catch (err) {
      setReturnConversationCleanupError(err.message);
    } finally {
      setCleaningReturnConversation(false);
    }
  }

  return (
    <div className="space-y-6 fade-in max-w-6xl mx-auto lakehouse-page">
      <RegisterOraclePanel title="AI Data Lakehouse">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Autonomous Database Link</p>
            <p className="text-[var(--color-text)] leading-relaxed">
              This page validates live Autonomous Database connections and stores configured DB Actions launch targets.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FeatureBadge label="ADB" color="blue" />
            <FeatureBadge label="Lakehouse" color="green" />
            <FeatureBadge label="Data Catalog" color="purple" />
            <FeatureBadge label="DB Actions" color="orange" />
          </div>
          <SqlBlock
            code={`-- Inspect the current ADB session used by DB Actions
SELECT USER AS connected_user,
       SYS_CONTEXT('USERENV', 'SERVICE_NAME') AS service_name,
       SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS current_schema,
       SYS_CONTEXT('USERENV', 'DB_NAME') AS database_name
FROM dual;`}
          />
        </div>
      </RegisterOraclePanel>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Database size={24} className="text-[var(--color-accent)]" />
            LiveStack Configuration
          </h2>
          <p className="text-sm text-[var(--color-text-dim)] mt-1">
            Manage the Autonomous Database connection and review the runtime services behind the PeakGear demo.
          </p>
        </div>
        <ImportanceButton onClick={() => setShowImportance(true)} />
      </div>

      <ImportanceModal
        open={showImportance}
        onClose={() => setShowImportance(false)}
        content={IMPORTANCE_CONTENT.lakehouseConfig}
      />

      <LakehouseReadinessPanel readiness={liveStackReadiness} />

      {connections.length > 0 && (
        <section className="glass-card p-5 space-y-4 lakehouse-configured-section">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="section-kicker">Configured</p>
              <h3 className="text-lg font-bold mt-1">AI Lakehouse Connections</h3>
            </div>
            <div className="flex flex-wrap gap-3">
              <JetButton
                label="Open DB Actions"
                iconClass="oj-fwk-icon oj-fwk-icon-arrow-end"
                chroming="callToAction"
                disabled={!activeDbActionsUrl}
                onAction={() => handleOpenDbActions()}
              />
              <JetButton
                label={seedLakehouseButtonLabel}
                iconClass="oj-fwk-icon oj-fwk-icon-database"
                chroming="outlined"
                disabled={!canSeedLakehouse}
                onAction={handleSeedLakehouse}
              />
              <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={handleAddConnection}>
                <Plus size={14} />
                Add Connection
              </button>
            </div>
          </div>

          <SeedLakehouseProgress
            seeding={seeding}
            seedResult={activeSeedResult}
            seedError={activeSeedError}
            action={seedAction}
          />

          {activeConnection && (
            <div className="lakehouse-configured-banner">
              <CheckCircle2 size={18} />
              <div>
                <strong>{activeConnection.name}</strong>
                <span>{activeConnection.dbActionsUrl}</span>
              </div>
              <button type="button" className="btn-ghost" onClick={() => handleEditConnection(activeConnection)}>
                Edit Connection
              </button>
            </div>
          )}

          <div className="lakehouse-connection-list">
            {connections.map((connection) => (
              <ConfiguredConnectionCard
                key={connection.id}
                connection={connection}
                isActive={connection.id === activeConnectionId}
                onSelect={() => setActiveConnectionId(connection.id)}
                onEdit={() => handleEditConnection(connection)}
                onRemove={() => handleRemoveConnection(connection.id)}
                onOpenDbActions={() => handleOpenDbActions(connection.dbActionsUrl)}
              />
            ))}
          </div>
        </section>
      )}

      {isFormOpen && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
          <section className="glass-card p-5 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="section-kicker">{editingConnectionId ? 'Edit Connection' : 'Connection'}</p>
                <h3 className="text-lg font-bold mt-1">Autonomous Database Credentials</h3>
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={handleUseExample}>
                  <JetGlyph iconClass="oj-fwk-icon-copy" />
                  Use Example
                </button>
                {connections.length > 0 && (
                  <button type="button" className="btn-ghost" onClick={handleCancelForm}>Cancel</button>
                )}
              </div>
            </div>

            <div className="lakehouse-form-grid">
              <label className="lakehouse-field lakehouse-field-full" htmlFor="lakehouse-connection-name">
                <span>Connection Name</span>
                <input
                  id="lakehouse-connection-name"
                  className="lakehouse-input"
                  value={connectionName}
                  placeholder="Amsterdam production ADB"
                  onChange={(event) => setConnectionName(event.target.value)}
                />
              </label>

              <label className="lakehouse-field lakehouse-field-full" htmlFor="lakehouse-connect-string">
                <span>ADB Connection String</span>
                <textarea
                  id="lakehouse-connect-string"
                  className="lakehouse-textarea"
                  value={connectionString}
                  rows={7}
                  spellCheck="false"
                  placeholder="(description=...(connect_data=(service_name=...adb.oraclecloud.com))...)"
                  onChange={(event) => {
                    setConnectionString(event.target.value);
                    setValidation(null);
                    setError(null);
                  }}
                />
              </label>

              <div className="lakehouse-field">
                <span>Admin User</span>
                <div className="lakehouse-static-value">{ADMIN_USERNAME}</div>
              </div>

              <label className="lakehouse-field" htmlFor="lakehouse-password">
                <span>Admin Password</span>
                <input
                  id="lakehouse-password"
                  className="lakehouse-input"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setValidation(null);
                    setError(null);
                  }}
                />
              </label>

              <div className="lakehouse-field lakehouse-field-full">
                <span>Wallet ZIP</span>
                <label htmlFor="lakehouse-wallet" className="lakehouse-wallet-picker">
                  <FileArchive size={16} />
                  <span>{fileLabel}</span>
                </label>
                <input
                  id="lakehouse-wallet"
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(event) => {
                    setWalletFile(event.target.files?.[0] || null);
                    setValidation(null);
                    setError(null);
                  }}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-1">
              <JetButton
                label={validating ? 'Validating...' : editingConnectionId ? 'Validate & Update' : 'Validate & Save'}
                iconClass={validating ? 'oj-fwk-icon oj-fwk-icon-load' : 'oj-fwk-icon oj-fwk-icon-check-circle'}
                chroming="callToAction"
                disabled={!canValidate}
                onAction={handleValidate}
              />
              <JetButton
                label="Open DB Actions"
                iconClass="oj-fwk-icon oj-fwk-icon-arrow-end"
                chroming="outlined"
                disabled={!activeDbActionsUrl}
                onAction={() => handleOpenDbActions()}
              />
              <JetButton
                label={seedLakehouseButtonLabel}
                iconClass="oj-fwk-icon oj-fwk-icon-database"
                chroming="outlined"
                disabled={!canSeedLakehouse}
                onAction={handleSeedLakehouse}
              />
            </div>
          </section>

          <aside className="glass-card p-5 lakehouse-status-panel">
            <div className="flex items-start gap-3">
              <div className={`lakehouse-status-icon ${validation?.connected || activeConnection ? 'is-success' : error ? 'is-error' : ''}`}>
                {validating ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : validation?.connected || activeConnection ? (
                  <CheckCircle2 size={20} />
                ) : error ? (
                  <AlertTriangle size={20} />
                ) : (
                  <ShieldCheck size={20} />
                )}
              </div>
              <div>
                <p className="section-kicker">Status</p>
                <h3 className="text-lg font-bold mt-1">
                  {validating
                    ? 'Validating connection'
                    : validation?.connected
                      ? 'Connection validated and saved'
                      : error
                        ? 'Validation failed'
                        : activeConnection
                          ? 'Connection configured'
                          : 'Ready to validate'}
                </h3>
              </div>
            </div>

            {error && (
              <div className="lakehouse-message is-error">
                <p>{error.message}</p>
                {error.details?.code && <p className="font-mono">Code: {error.details.code}</p>}
                {error.details?.dbActionsUrl && (
                  <a className="lakehouse-dbactions-link" href={withDbActionsRoute(error.details.dbActionsUrl)} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} />
                    <span>{withDbActionsRoute(error.details.dbActionsUrl)}</span>
                  </a>
                )}
              </div>
            )}

            {validation?.connected || activeConnection ? (
              <div className="space-y-3">
                <DetailRow label="Service Name" value={validation?.serviceName || activeConnection?.serviceName} />
                <DetailRow label="Connected User" value={validation?.username || activeConnection?.username} />
                <DetailRow label="Database" value={activeDatabase.DB_NAME || activeDatabase.db_name} />
                <DetailRow label="Runtime Service" value={activeDatabase.SERVICE_NAME || activeDatabase.service_name} />
                <DetailRow
                  label="Wallet"
                  value={validation?.wallet?.uploaded
                    ? validation.wallet.filename
                    : activeConnection?.wallet?.uploaded
                      ? activeConnection.wallet.filename
                      : 'Not uploaded'}
                />
                {activeDbActionsUrl && (
                  <a className="lakehouse-dbactions-link" href={activeDbActionsUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} />
                    <span>{activeDbActionsUrl}</span>
                  </a>
                )}
              </div>
            ) : (
              <div className="lakehouse-empty-state">
                <p>
                  DB Actions becomes available after the app confirms the supplied Autonomous Database credentials.
                </p>
              </div>
            )}
          </aside>
        </div>
      )}

      <LiveStackStatusSection status={liveStackStatus} />
      <LiveStackDemoDataSection
        status={demoStatus}
        totalArtifacts={demoTotalArtifacts}
        hasData={demoHasData}
        running={demoRunning}
        done={demoDone}
        progress={demoProgress}
        message={demoMessage}
        onStart={startDemoRefresh}
      />
      <LiveStackMaintenanceSection
        cleaning={cleaningReturnConversation}
        cleanupResult={returnConversationCleanup}
        cleanupError={returnConversationCleanupError}
        onClearReturnAgentConversation={handleClearReturnAgentConversation}
      />
      <AwsGlueCatalogSection />
    </div>
  );
}
