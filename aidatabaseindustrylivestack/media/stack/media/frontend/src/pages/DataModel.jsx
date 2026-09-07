import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Database,
  Boxes,
  TrendingUp,
  Network,
  MapPin,
  BrainCircuit,
  FileJson,
  Package,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { JetButton } from '../components/JetControls';
import { FeatureBadge, SqlBlock } from '../components/OracleInfoPanel';
import { SceneStoryPanel } from '../components/MediaStory';
import { RegisterOraclePanel } from '../context/OraclePanelContext';
import { api } from '../utils/api';
import { useUser } from '../context/UserContext';
import useGenerationRequestGuard from '../hooks/useGenerationRequestGuard';

const CAPABILITY_GROUPS = [
  {
    title: 'Media and Entertainment Data Foundation',
    accent: '#437C94',
    icon: Database,
    summary: 'Viewers, subscribers, fans, creators, content assets, campaign requests, and live events share one governed foundation.',
    detail: 'This is the trusted starting point for relational rows, JSON document projections, graph links, spatial layers, vectors, and audit records.',
  },
  {
    title: 'Launch Operations Intelligence',
    accent: '#C74634',
    icon: Boxes,
    summary: 'Streaming sessions, content releases, premiere events, support cases, and retention campaigns stay aligned to operational data.',
    detail: 'Studio teams can monitor engagement, personalize campaigns, and coordinate live-event operations from governed Oracle data.',
  },
  {
    title: 'Audience Momentum & Safety Signals',
    accent: '#4F7D7B',
    icon: TrendingUp,
    summary: 'Community posts, moderation notes, platform-abuse indicators, toxicity risk, churn risk, and engagement signals become searchable audience intelligence.',
    detail: 'Vector search and semantic matching help surface risk, momentum, monetization opportunities, and next-best fan actions.',
  },
  {
    title: 'Creator & Community Graph',
    accent: '#796087',
    icon: Network,
    summary: 'Creators, studios, publishers, fan communities, content relationships, and campaign influence can be explored as connected relationships.',
    detail: 'The graph layer supports creator analytics, collaboration paths, audience overlap, partner analysis, and signal propagation.',
  },
  {
    title: 'Rights, Capacity & Live Event Coverage Spatial Layer',
    accent: '#5F7D4F',
    icon: MapPin,
    summary: 'Distribution hubs, rights regions, watch-party demand, premiere event coverage, and capacity overlays live as Oracle Spatial data.',
    detail: 'The map experience can reason over proximity, rights coverage, regional demand, and live-event readiness.',
  },
  {
    title: 'JSON Relational Duality',
    accent: '#AA643B',
    icon: FileJson,
    summary: 'Campaign requests, rights cases, release plans, and content packages can be exposed as nested JSON documents without duplicating source rows.',
    detail: 'Duality views support application-style inspection while keeping the same transactional foundation for operations and analytics.',
  },
  {
    title: 'ML, Vector, and AI Agents',
    accent: '#4C825C',
    icon: BrainCircuit,
    summary: 'Churn scoring, content recommendations, monetization forecasts, safety signals, vector search, and agent workflows run against the same governed Oracle foundation.',
    detail: 'Analytics and AI actions stay anchored to auditable data, PL/SQL tools, and live application context.',
  },
];

const LOADED_GROUPS_PER_PAGE = 3;

function StatusGrid({ status, projected = false }) {
  const cards = [
    { key: 'products', label: 'Content Assets', value: status?.products ?? 0, accent: '#437C94' },
    { key: 'social-posts', label: 'Audience Signals', value: status?.social_posts ?? 0, accent: '#A36472' },
    { key: 'orders', label: 'Campaign Requests', value: status?.orders ?? 0, accent: '#4C825C' },
    { key: 'product-embeddings', label: 'Content Vectors', value: status?.product_embeddings ?? 0, accent: '#4F7D7B', vector: true },
    { key: 'post-embeddings', label: 'Signal Vectors', value: status?.post_embeddings ?? 0, accent: '#4F7D7B', vector: true },
    { key: 'semantic-matches', label: 'Semantic Matches', value: status?.semantic_matches ?? 0, accent: '#796087', vector: true },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg p-3 text-center border border-[var(--color-border)]"
          style={{ boxShadow: `inset 0 2px 0 ${card.accent}`, background: 'var(--color-surface)' }}
        >
          <p
            className="text-lg font-bold font-mono"
            data-testid={`dataset-count-${card.key}`}
          >
            {Number(card.value || 0).toLocaleString()}
          </p>
          <p className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wide mt-1">{card.label}</p>
          {projected ? (
            <p className="text-[9px] text-[var(--color-text-dim)] mt-1">
              {card.vector ? 'Expected after vector rebuild' : 'Expected restore count'}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function numericCount(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function bestCount(...values) {
  return values.reduce((best, value) => {
    const count = numericCount(value);
    return count === null ? best : Math.max(best, count);
  }, 0);
}

function firstCount(source, fallback, keys) {
  return bestCount(...keys.map((key) => source?.[key]), ...keys.map((key) => fallback?.[key]));
}

function restoreCountsToStatus(counts, fallbackStatus) {
  if (!counts && !fallbackStatus) return null;
  return {
    products: firstCount(counts, fallbackStatus, ['products']),
    social_posts: firstCount(counts, fallbackStatus, ['social_posts']),
    orders: firstCount(counts, fallbackStatus, ['orders']),
    product_embeddings: firstCount(counts, fallbackStatus, ['product_embeddings']),
    post_embeddings: bestCount(counts?.post_embeddings, fallbackStatus?.post_embeddings, counts?.signal_embeddings, fallbackStatus?.signal_embeddings),
    semantic_matches: firstCount(counts, fallbackStatus, ['semantic_matches']),
    fulfillment_zones: firstCount(counts, fallbackStatus, ['fulfillment_zones']),
    demand_regions: firstCount(counts, fallbackStatus, ['demand_regions']),
  };
}

function hasCountData(counts) {
  return Boolean(counts) && Object.values(counts).some((value) => numericCount(value) > 0);
}

const BEST_STATUS_STORAGE_KEY = 'mediaLiveFootprintBestStatus';

function mergeBestStatus(nextStatus, previousStatus) {
  if (!nextStatus && !previousStatus) return null;
  if (!nextStatus) return previousStatus;
  const bestMajorCounts = restoreCountsToStatus(nextStatus, previousStatus);
  const liveVectorCounts = {
    product_embeddings: numericCount(nextStatus.product_embeddings) ?? 0,
    post_embeddings: numericCount(nextStatus.post_embeddings ?? nextStatus.signal_embeddings) ?? 0,
    semantic_matches: numericCount(nextStatus.semantic_matches) ?? 0,
  };
  return {
    ...(previousStatus || {}),
    ...nextStatus,
    ...(bestMajorCounts || {}),
    ...liveVectorCounts,
  };
}

function readStoredBestStatus() {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BEST_STATUS_STORAGE_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredBestStatus(bestStatus) {
  if (typeof window === 'undefined' || !bestStatus) return;
  try {
    window.localStorage.setItem(BEST_STATUS_STORAGE_KEY, JSON.stringify(bestStatus));
  } catch {
    // localStorage can be unavailable in private or restricted browser contexts.
  }
}

function restoreMessageForJob(job) {
  const baseMessage = job?.message || 'Restoring bundled demo dataset...';
  const progress = Number(job?.progress ?? 0);
  if (/demo dates|restore window/i.test(baseMessage)) {
    return `${baseMessage} Seeded timestamps are being re-anchored before vector, forecast, campaign, and event artifacts are rebuilt.`;
  }
  if (/validating refreshed demo date windows|date validation/i.test(baseMessage)) {
    return `${baseMessage} Restore checks are confirming recent live-event, release-window, campaign, churn, safety, and analytics windows.`;
  }
  if (/OML|model refresh/i.test(baseMessage)) {
    return `${baseMessage} Date-sensitive in-database ML artifacts are checked after the refreshed data is committed.`;
  }
  if (progress >= 92 || /vector artifacts|embedding|semantic/i.test(baseMessage)) {
    return `${baseMessage} Vector counts are rebuilt with Oracle VECTOR_EMBEDDING and appear after this final step finishes.`;
  }
  return baseMessage;
}

export default function DataModel() {
  const { currentUser } = useUser();
  const userKey = currentUser?.USERNAME;
  const canMutate = currentUser?.ROLE === 'admin';
  const [status, setStatus] = useState(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoDone, setDemoDone] = useState(false);
  const [demoProgress, setDemoProgress] = useState(0);
  const [demoMessage, setDemoMessage] = useState('');
  const [restoreCounts, setRestoreCounts] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [loadedGroupPage, setLoadedGroupPage] = useState(0);
  const { beginRequest, isCurrent, boundaryKey } = useGenerationRequestGuard(() => {
    setStatus(null);
    setStatusError(null);
    setRestoreCounts(null);
    setDemoDone(false);
  });
  const loadedGroupPageCount = Math.ceil(CAPABILITY_GROUPS.length / LOADED_GROUPS_PER_PAGE);
  const loadedGroupStart = loadedGroupPage * LOADED_GROUPS_PER_PAGE;
  const visibleLoadedGroups = CAPABILITY_GROUPS.slice(loadedGroupStart, loadedGroupStart + LOADED_GROUPS_PER_PAGE);
  const loadedGroupEnd = Math.min(loadedGroupStart + visibleLoadedGroups.length, CAPABILITY_GROUPS.length);
  const canShowPreviousLoadedGroups = loadedGroupPage > 0;
  const canShowNextLoadedGroups = loadedGroupPage < loadedGroupPageCount - 1;

  const showPreviousLoadedGroups = () => {
    setLoadedGroupPage((page) => Math.max(0, page - 1));
  };

  const showNextLoadedGroups = () => {
    setLoadedGroupPage((page) => Math.min(loadedGroupPageCount - 1, page + 1));
  };

  const refreshStatus = useCallback(async () => {
    const requestToken = beginRequest('status');
    try {
      const data = await api.demo.status();
      if (!isCurrent(requestToken)) return null;
      setStatus(data);
      setStatusError(null);
      return data;
    } catch (statusFailure) {
      if (!isCurrent(requestToken)) return null;
      setStatus(null);
      setStatusError(statusFailure);
      return null;
    }
  }, [beginRequest, boundaryKey, isCurrent, userKey]);

  useEffect(() => {
    let cancelled = false;
    refreshStatus().then((data) => {
      if (cancelled && data) return;
    });
    return () => {
      cancelled = true;
    };
  }, [refreshStatus]);

  useEffect(() => {
    const refreshTimer = window.setInterval(() => {
      refreshStatus();
    }, 10000);
    const handleFocus = () => refreshStatus();
    const handleFootprintRefresh = () => refreshStatus();
    window.addEventListener('focus', handleFocus);
    window.addEventListener('media-live-footprint-refresh', handleFootprintRefresh);
    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('media-live-footprint-refresh', handleFootprintRefresh);
    };
  }, [refreshStatus]);

  const displayStatus = useMemo(() => {
    if (demoRunning && hasCountData(restoreCounts)) {
      return restoreCountsToStatus(restoreCounts, status);
    }
    return restoreCountsToStatus(null, status);
  }, [demoRunning, restoreCounts, status]);
  const showingProjectedCounts = demoRunning && hasCountData(restoreCounts);

  const totalArtifacts = useMemo(() => {
    if (!displayStatus) return null;
    return (
      (displayStatus.products || 0) +
      (displayStatus.social_posts || 0) +
      (displayStatus.orders || 0) +
      (displayStatus.product_embeddings || 0) +
      (displayStatus.post_embeddings || 0) +
      (displayStatus.semantic_matches || 0)
    );
  }, [displayStatus]);

  const hasData = useMemo(() => {
    if (!status) return false;
    return Object.values(status).some((value) => typeof value === 'number' && value > 0);
  }, [status]);

  const startDemoRefresh = useCallback(async () => {
    if (demoRunning || !canMutate) return;
    const requestToken = beginRequest('restore');

    setDemoRunning(true);
    setDemoDone(false);
    setDemoProgress(0);
    setRestoreCounts(null);
    setDemoMessage(hasData ? 'Restoring and verifying bundled demo data...' : 'Loading bundled demo data...');

    try {
      const startPayload = await api.import.restoreDemo();
      if (!isCurrent(requestToken)) return;
      if (!startPayload.jobId) {
        throw new Error(startPayload.error || startPayload.message || 'Demo restore could not be started.');
      }

      setDemoProgress(Number(startPayload.progress || 5));
      if (startPayload.counts) setRestoreCounts(startPayload.counts);
      setDemoMessage(startPayload.message || 'Demo restore started.');

      let finalJob = null;
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 500 : 1500));
        const job = await api.import.status(startPayload.jobId);
        if (!isCurrent(requestToken)) return;
        if (!job) {
          throw new Error(job?.error || 'Demo restore status could not be read.');
        }

        const progress = Math.max(0, Math.min(100, Number(job.progress ?? 0)));
        setDemoProgress(progress);
        if (job.counts) setRestoreCounts(job.counts);
        if (attempt % 3 === 0 || progress >= 90) {
          await refreshStatus();
        }
        setDemoMessage(restoreMessageForJob(job));

        const jobStatus = String(job.status || '').toLowerCase();
        if (jobStatus === 'completed' || jobStatus === 'complete' || jobStatus === 'success' || jobStatus === 'failed' || jobStatus === 'error') {
          finalJob = job;
          break;
        }
      }

      if (!finalJob) {
        throw new Error('Demo restore timed out before completion.');
      }
      if (!['completed', 'complete', 'success'].includes(String(finalJob.status || '').toLowerCase())) {
        throw new Error(finalJob.message || finalJob.errors?.[0] || 'Demo restore failed.');
      }

      const nextStatus = await refreshStatus();
      if (!isCurrent(requestToken)) return;
      if (!nextStatus || !Object.values(nextStatus).some((value) => typeof value === 'number' && value > 0)) {
        throw new Error('Demo restore completed, but live counts still read as zero.');
      }

      setRestoreCounts(null);
      setDemoDone(true);
      setDemoProgress(100);
      setDemoMessage('Demo dataset restored, dates re-anchored, and live counts refreshed.');
      window.dispatchEvent(new CustomEvent('media:dataset-revision', {
        detail: {
          jobId: startPayload.jobId,
          changedAt: new Date().toISOString(),
          preserveSceneState: true,
        },
      }));
    } catch (err) {
      if (!isCurrent(requestToken)) return;
      setDemoDone(false);
      setRestoreCounts(null);
      setDemoMessage(err?.message || 'Demo restore failed.');
      await refreshStatus();
    } finally {
      if (isCurrent(requestToken)) setDemoRunning(false);
    }
  }, [beginRequest, canMutate, demoRunning, hasData, isCurrent, refreshStatus]);

  return (
    <div className="space-y-6 fade-in max-w-6xl mx-auto">
      <RegisterOraclePanel title="Data Foundation">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Demo Readiness</p>
            <p className="text-[var(--color-text)] leading-relaxed">
              Start here to load or restore the Seer Media demo dataset before exploring the media and entertainment use cases. The action prepares the governed Oracle AI Database 26ai foundation used by Launch Operations, Audience Momentum & Safety Signals, Creator Influence Network, Rights, Capacity & Live Event Coverage, analytics, Ask Data, and AI agents.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Why It Matters</p>
            <p className="text-[var(--color-text)] leading-relaxed">
              The same foundation supports subscriber and viewer segmentation, content recommendations, moderation and platform-abuse signals, live event operations, JSON campaign documents, forecasting, and agent actions without splitting the story across separate data stores.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FeatureBadge label="Relational Core" color="blue" />
            <FeatureBadge label="JSON Duality Views" color="orange" />
            <FeatureBadge label="Property Graph" color="purple" />
            <FeatureBadge label="Oracle Spatial" color="green" />
            <FeatureBadge label="Vector Search" color="cyan" />
            <FeatureBadge label="In-DB ML" color="red" />
            <FeatureBadge label="Agent Audit Trail" color="pink" />
          </div>
          <SqlBlock
            code={`-- Demo data prepared by this page
-- relational tables        -> viewers, subscribers, creators, content assets, campaign requests, live events
-- json / duality views     -> campaign order, rights case, release plan, and content package documents
-- property graph           -> creators, studios, publishers, fans, and communities
-- spatial geometry         -> distribution hubs, rights regions, watch-party zones, and premiere event demand regions
-- vector embeddings        -> content embeddings, audience signal embeddings, semantic matches
-- in-database analytics    -> churn risk, engagement scoring, recommendations, monetization forecasts
-- agent audit trail        -> agent_actions, event_stream`}
          />
        </div>
      </RegisterOraclePanel>

      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Database size={24} className="text-[var(--color-accent)]" />
          Data Foundation
        </h2>
        <p className="text-sm text-[var(--color-text-dim)] mt-1">
          Prepare the governed Seer Media dataset before you move into the media and entertainment scenarios.
        </p>
      </div>

      {statusError && (
        <div
          className="glass-card p-4"
          role="alert"
          data-testid="vpd-evidence-unavailable"
          style={{ borderLeft: '3px solid var(--color-danger)' }}
        >
          <p className="text-sm font-semibold tone-red">
            Application Context and VPD evidence is unavailable
          </p>
          <p className="text-xs text-[var(--color-text-dim)] mt-1">
            {statusError.message}
          </p>
        </div>
      )}

      <SceneStoryPanel scene="datamodel" />

      <div className="glass-card p-5" style={{ borderLeft: '3px solid var(--color-accent)' }}>
        <p className="text-base text-[var(--color-text)] leading-7">
          Start here to load the Seer Media demo dataset. This action prepares viewers, subscribers, fans, creators, content assets, campaign requests, live events, audience momentum and trust signals, coverage geography, vector embeddings, ML outputs, and agent audit history. Once the load completes, the live footprint confirms that the database is ready for the demo workflows.
        </p>
      </div>

      <div className="glass-card p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Package size={18} className="text-[var(--color-accent)]" />
              Prepare the Dataset
            </h3>
            <p className="text-xs text-[var(--color-text-dim)] mt-1 max-w-2xl">
              Load or restore the bundled media and entertainment dataset, then verify the live record counts that power every use case in the demo.
            </p>
          </div>
          <JetButton
            label={demoRunning ? 'Loading Demo Data...' : hasData ? 'Restore Demo Data' : 'Load Demo Data'}
            iconClass={demoRunning
              ? 'oj-fwk-icon oj-fwk-icon-load'
              : hasData
                ? 'oj-fwk-icon oj-fwk-icon-refresh'
                : 'oj-fwk-icon oj-fwk-icon-folderhierarchy'}
            chroming="callToAction"
            className="welcome-jet-button welcome-start-demo-button"
            onAction={startDemoRefresh}
            disabled={demoRunning || !canMutate}
          />
        </div>
        <p className="text-xs text-[var(--color-text-dim)] mb-4">
          {totalArtifacts == null ? 'Current runtime counts from the live demo stack.' : `${totalArtifacts.toLocaleString()} tracked records across the major demo layers.`}
        </p>
        {demoDone ? (
          <div
            className="flex items-center gap-2 text-sm font-semibold tone-pine mb-4"
            role="status"
            aria-live="polite"
          >
            <CheckCircle2 size={16} aria-hidden="true" />
            Demo Data Restored Successfully
          </div>
        ) : null}
        {(demoMessage || demoRunning || demoDone) && (
          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--color-text-dim)]">{demoMessage || 'Waiting for demo restore...'}</span>
              <span className="text-xs font-mono font-semibold">{demoProgress}%</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--color-border)]/30 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${demoProgress}%`,
                  background: demoDone
                    ? '#4C825C'
                    : 'linear-gradient(135deg, #C74634, #AA643B)',
                }}
              />
            </div>
            {showingProjectedCounts ? (
              <div className="text-[11px] text-[var(--color-text-dim)]">
                Showing the best available live and restore counts while Oracle rebuilds vector artifacts. Content vectors, signal vectors, and semantic matches refresh during the VECTOR_EMBEDDING step and remain visible as soon as the API reports them.
              </div>
            ) : null}
          </div>
        )}
        <StatusGrid status={displayStatus} projected={showingProjectedCounts} />
      </div>

      <div className="glass-card p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Boxes size={18} className="text-[var(--color-accent)]" />
            What Gets Loaded
          </h3>
          <div className="flex items-center gap-2" aria-label="Loaded data carousel controls">
            <button
              type="button"
              aria-label="Show previous loaded data groups"
              onClick={showPreviousLoadedGroups}
              disabled={!canShowPreviousLoadedGroups}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
              }}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Show next loaded data groups"
              onClick={showNextLoadedGroups}
              disabled={!canShowNextLoadedGroups}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
              }}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="text-sm text-[var(--color-text-dim)] leading-6 mt-3">
          The restore prepares the viewer, subscriber, creator, content, campaign, live event, safety, spatial, graph, vector, analytics, and agent data domains that the rest of the demo uses.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--color-text-dim)]">
            Showing {loadedGroupStart + 1}-{loadedGroupEnd} of {CAPABILITY_GROUPS.length}
          </p>
          <div className="flex items-center gap-1.5" aria-label="Loaded data groups">
            {Array.from({ length: loadedGroupPageCount }).map((_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`Show loaded data group ${index + 1}`}
                aria-current={loadedGroupPage === index ? 'true' : undefined}
                onClick={() => setLoadedGroupPage(index)}
                className="h-2.5 rounded-full transition-all"
                style={{
                  width: loadedGroupPage === index ? '22px' : '10px',
                  background: loadedGroupPage === index ? '#AA643B' : 'var(--color-border)',
                }}
              />
            ))}
          </div>
        </div>
        <div
          className="grid gap-4 mt-4 lg:grid-cols-3"
          aria-live="polite"
          aria-label={`Loaded data groups ${loadedGroupStart + 1} through ${loadedGroupEnd}`}
        >
          {visibleLoadedGroups.map((group) => {
            const Icon = group.icon;
            return (
              <div
                key={group.title}
                className="border p-4"
                style={{
                  borderColor: 'var(--color-border)',
                  borderRadius: '6px',
                  background: 'var(--color-surface)',
                  boxShadow: `inset 0 3px 0 ${group.accent}`,
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 flex items-center justify-center rounded" style={{ background: `${group.accent}18` }}>
                    <Icon size={16} style={{ color: group.accent }} />
                  </div>
                  <div className="text-sm font-semibold">{group.title}</div>
                </div>
                <p className="text-sm text-[var(--color-text)] leading-6">{group.summary}</p>
                <p className="text-xs text-[var(--color-text-dim)] leading-5 mt-2">{group.detail}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
