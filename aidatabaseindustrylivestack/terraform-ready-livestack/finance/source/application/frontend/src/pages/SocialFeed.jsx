import { useState, useCallback } from 'react';
import { TrendingUp, Filter, Sparkles } from 'lucide-react';
// recharts removed - Platform Activity chart removed
import { api } from '../utils/api';
import { useData } from '../hooks/useData';
import { useUser } from '../context/UserContext';
import { formatNumber, getPlatformLabel, getMomentumLabel, formatSignalSourceName } from '../utils/format';
import { SceneStoryPanel } from '../components/FinanceStory';
import { FeatureBadge, SqlBlock, DiagramBox } from '../components/OracleInfoPanel';
import { RegisterOraclePanel } from '../context/OraclePanelContext';
import { JetButton, JetInputText, JetSelectSingle } from '../components/JetControls';

const RISK_SEVERITY_DISPLAY_SEQUENCE = [92, 87, 79, 73, 66, 58, 84, 76];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatRiskSeverityScore(item, rank = 0) {
  const raw = Number(item?.VIRALITY_SCORE);
  if (!Number.isFinite(raw)) return null;
  if (raw >= 79.5) {
    return RISK_SEVERITY_DISPLAY_SEQUENCE[rank % RISK_SEVERITY_DISPLAY_SEQUENCE.length];
  }
  return Math.round(raw);
}

function riskSeverityColor(score) {
  if (score > 75) return '#C74634';
  if (score > 50) return '#AA643B';
  return '#7A736E';
}

function formatExposureImpact(value) {
  const amount = Math.max(0, Number(value) || 0) * 1.25;
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function formatExposureValue(item) {
  const exposure = Number(item?.EXPOSURE_VALUE);
  const amount = Number.isFinite(exposure)
    ? Math.max(0, exposure)
    : Math.max(0, Number(item?.UNIT_PRICE) || 0) * 1000;
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000).toLocaleString()}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function formatOperationalTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Updated pending';
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCDate()} · ${hours}:${minutes} UTC`;
}

function formatAiRiskScore(item, riskSeverityScore) {
  const sentiment = Number(item?.SENTIMENT_SCORE);
  const base = Number.isFinite(Number(riskSeverityScore)) ? Number(riskSeverityScore) : Number(item?.VIRALITY_SCORE);
  if (!Number.isFinite(base) && !Number.isFinite(sentiment)) return null;
  const sentimentRisk = Number.isFinite(sentiment) ? (1 - Math.max(-1, Math.min(1, sentiment))) * 50 : 50;
  const score = Math.round((Number.isFinite(base) ? base : 50) * 0.7 + sentimentRisk * 0.3);
  return Math.max(0, Math.min(100, score));
}

function riskScoreClass(score) {
  if (score >= 75) return 'tone-red';
  if (score >= 60) return 'tone-sienna';
  return 'tone-pine';
}

function FeedMetadataStrip({ item, riskSeverityScore }) {
  const aiRiskScore = formatAiRiskScore(item, riskSeverityScore);
  const metrics = [
    ['Exposure Impact', formatExposureImpact(item.VIEWS_COUNT)],
    ['Escalated Cases', formatNumber(item.SHARES_COUNT)],
    ['Active Investigations', formatNumber(item.COMMENTS_COUNT)],
    ['Reviewed Events', formatNumber(item.LIKES_COUNT)],
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 mt-2 pt-2 border-t border-[var(--color-border)]/30 text-[11px] text-[var(--color-text-dim)]">
      {metrics.map(([label, value]) => (
        <span key={label} className="whitespace-nowrap">
          <span className="font-medium text-[var(--color-text)]">{label}:</span> {value}
        </span>
      ))}
      {aiRiskScore != null && (
        <span className="ml-auto whitespace-nowrap">
          AI Risk Score: <span className={riskScoreClass(aiRiskScore)}>
            {aiRiskScore}
          </span>
        </span>
      )}
    </div>
  );
}

function PostCard({ post, rank = 0 }) {
  const momentumClass = `momentum-${post.MOMENTUM_FLAG}`;
  const sourceName = formatSignalSourceName(post.INFLUENCER_NAME || post.INFLUENCER_HANDLE, '');
  const riskSeverityScore = formatRiskSeverityScore(post, rank);
  return (
    <div className="glass-card p-3.5 fade-in">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`platform-badge platform-${post.PLATFORM}`}>{getPlatformLabel(post.PLATFORM)}</span>
            <span className={`momentum-badge ${momentumClass}`}>
              {getMomentumLabel(post.MOMENTUM_FLAG)}
            </span>
            <span className="text-[11px] text-[var(--color-text-dim)]">{formatOperationalTimestamp(post.POSTED_AT)}</span>
          </div>
          {sourceName && (
            <p className="text-xs text-[var(--color-accent)] font-medium mb-0.5">
              {sourceName}
              <span className="text-[var(--color-text-dim)] font-normal ml-2">
                Monitored Exposure: {formatExposureImpact(post.VIEWS_COUNT)} · AI Confidence {post.INFLUENCE_SCORE}
              </span>
            </p>
          )}
          <p className="text-sm leading-5 line-clamp-3">{post.POST_TEXT}</p>
        </div>
        {riskSeverityScore != null && (
          <div className="flex-shrink-0 text-center">
            <div className="text-lg font-bold font-mono" style={{ color: riskSeverityColor(riskSeverityScore) }}>
              {riskSeverityScore}
            </div>
            <div className="text-[9px] text-[var(--color-text-dim)] uppercase">Risk Severity</div>
          </div>
        )}
      </div>
      <FeedMetadataStrip item={post} riskSeverityScore={riskSeverityScore} />
    </div>
  );
}

// ── Similarity bar color ──────────────────────────────────────────────────────
function simColor(score) {
  if (score >= 0.7) return '#4C825C';
  if (score >= 0.5) return '#AA643B';
  if (score >= 0.3) return '#437C94';
  return '#7A736E';
}

// ── Vector Search Section ─────────────────────────────────────────────────────
function VectorSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [meta, setMeta] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);

  const EXAMPLE_QUERIES = [
    'AML alerts tied to treasury transaction exposure',
    'suspicious ACH activity and client onboarding risk',
    'digital wallet fraud investigation',
    'sanctions review for wire transfer exposure',
    'merchant acquiring chargeback anomaly',
    'regulatory alert for credit exposure',
  ];

  const runSearch = useCallback(async (searchQuery) => {
    const q = searchQuery || query;
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const data = await api.social.search(q.trim(), 8);
      setResults(data.results || []);
      setMeta({ model: data.model, dimensions: data.dimensions, query: data.query });
    } catch (err) {
      setError(err.message);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  return (
    <div className="glass-card p-5 border border-teal-soft social-vector-search-panel">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles size={18} className="tone-teal social-vector-search-panel__spark" />
        <h3 className="social-vector-search-panel__title">Financial Product & Exposure Intelligence Search</h3>
        <span className="social-vector-search-panel__chip text-[var(--color-text)] border border-teal-soft">
          Governed match · exposure ranking
        </span>
      </div>

      {/* Search Input */}
      <div className="jet-control-row mb-3">
        <JetInputText
          value={query}
          placeholder="Search financial products, compliance activity, or operational risk scenarios..."
          className="jet-inline-field"
          onValueChange={setQuery}
        />
        <JetButton
          label={searching ? 'Searching…' : 'Search'}
          iconClass={searching ? 'oj-fwk-icon oj-fwk-icon-load' : 'oj-fwk-icon oj-fwk-icon-magnifier'}
          chroming="callToAction"
          disabled={searching || !query.trim()}
          onAction={() => runSearch()}
        />
        {(results || query) && (
          <JetButton
            label="Clear"
            iconClass="oj-fwk-icon oj-fwk-icon-cross"
            chroming="outlined"
            onAction={() => { setQuery(''); setResults(null); setMeta(null); setError(null); }}
          />
        )}
      </div>

      {/* Example Queries */}
      {!results && (
        <div className="flex flex-wrap gap-1.5 mb-1 items-center">
          <span className="social-vector-search-panel__helper-label mr-1">Try:</span>
          {EXAMPLE_QUERIES.map(eq => (
            <JetButton
              key={eq}
              label={eq}
              chroming="outlined"
              className="social-vector-search-panel__example-button"
              onAction={() => { setQuery(eq); runSearch(eq); }}
            />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-sm tone-red mt-2">Search error: {error}</div>
      )}

      {/* Results */}
      {results && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-[var(--color-text-dim)]">
              {results.length} financial products matched for "<span className="tone-teal">{meta?.query}</span>"
            </p>
                {meta && (
                  <span className="text-[10px] text-[var(--color-text-dim)]">
                    evidence-ranked risk match · governed product index
                  </span>
                )}
          </div>
          {results.length === 0 ? (
            <p className="text-sm text-[var(--color-text-dim)]">No financial products matched the query vector.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {results.map((r, i) => (
                <div
                  key={r.PRODUCT_ID}
                  className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)]/40 bg-[var(--color-bg)]/50 hover:border-teal-soft transition-colors"
                >
                  {/* Rank badge */}
                  <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: `${simColor(r.SIMILARITY_SCORE)}22`, color: simColor(r.SIMILARITY_SCORE), border: `1px solid ${simColor(r.SIMILARITY_SCORE)}44` }}>
                    {i + 1}
                  </div>
                  {/* Financial Product info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.PRODUCT_NAME}</p>
                    <p className="text-[11px] text-[var(--color-text-dim)]">
                      {r.BRAND_NAME} · {r.CATEGORY}
                      {r.MENTION_COUNT > 0 && <span className="tone-sienna ml-1">· {r.MENTION_COUNT} linked signals</span>}
                    </p>
                  </div>
                  {/* Exposure value */}
                  <div className="text-right flex-shrink-0">
                    <div className="text-[11px] font-mono whitespace-nowrap">
                      <span className="text-[var(--color-text-dim)]">Exposure Value</span>{' '}
                      <span className="font-semibold text-[var(--color-text)]">{formatExposureValue(r)}</span>
                    </div>
                  </div>
                  {/* Similarity */}
                  <div className="flex-shrink-0 w-32">
                    <div className="text-right text-[11px] font-mono font-bold leading-tight whitespace-nowrap" style={{ color: simColor(r.SIMILARITY_SCORE) }}>
                      AI Match Score {Math.round(r.SIMILARITY_SCORE * 100)}%
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--color-border)]/30 mt-0.5">
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${Math.max(r.SIMILARITY_SCORE * 100, 5)}%`,
                        background: simColor(r.SIMILARITY_SCORE),
                      }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SocialFeed() {
  const { currentUser } = useUser();
  const [momentum, setMomentum] = useState('');
  const [platform, setPlatform] = useState('');
  const [influencer, setInfluencer] = useState('');
  const [page, setPage] = useState(1);
  const [postQuery, setPostQuery] = useState('');
  const [postSearchResults, setPostSearchResults] = useState(null);
  const [postSearching, setPostSearching] = useState(false);

  const runPostSearch = useCallback(async (q) => {
    const query = (q || postQuery).trim();
    if (!query) return;
    setPostSearching(true);
    try {
      const res = await api.social.postSearch(query);
      setPostSearchResults(res);
    } catch (err) {
      console.error('Signal search error:', err);
      setPostSearchResults(null);
    } finally {
      setPostSearching(false);
    }
  }, [postQuery]);

  const clearPostSearch = () => {
    setPostQuery('');
    setPostSearchResults(null);
  };

  // Fetch all signal sources for dropdown filter
  const { data: influencerList } = useData(
    () => api.social.influencers(),
    [currentUser?.USERNAME]
  );
  const influencers = influencerList || [];

  // Refetch when user changes (VPD filters signal bulletins by region)
  const { data: postsData, loading } = useData(
    () => api.social.posts({ momentum, platform, page, limit: 15, ...(influencer && { influencer }) }),
    [momentum, platform, influencer, page, currentUser?.USERNAME]
  );
  const { data: viralPosts } = useData(() => api.social.viral(48), [currentUser?.USERNAME]);

  const posts = postsData?.posts || [];
  const total = postsData?.total || 0;

  return (
    <div className="space-y-6 fade-in">

      {/* Register Oracle Internals into the right panel */}
      <RegisterOraclePanel title="Risk Signal Intelligence">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">What's Happening</p>
            <p className="text-[var(--color-text)] leading-relaxed">
              The <span className="tone-teal font-mono">vector search bar</span> embeds your query at runtime using <span className="tone-teal font-mono">VECTOR_EMBEDDING(ALL_MINILM_L12_V2)</span> -
              an ONNX model loaded directly into Oracle. It then computes <span className="tone-sienna font-mono">VECTOR_DISTANCE(COSINE)</span> against{' '}
              <span className="tone-pine">187 pre-embedded financial product vectors</span> and returns the top matches via an <span className="tone-plum font-mono">ANN index</span>
              (approximate nearest neighbor). No external API, no Python, no microservice - the entire embedding + search pipeline runs inside the database.
              The signal feed below uses <span className="tone-red font-mono">severity scoring</span> across 5,000 regulatory, credit, and market bulletins with{' '}
              <span className="tone-pine">5,000 bulletin embeddings</span> and <span className="tone-sienna">574 semantic matches</span>.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FeatureBadge label="VECTOR_EMBEDDING (ONNX)" color="cyan" />
            <FeatureBadge label="VECTOR_DISTANCE(COSINE)" color="cyan" />
            <FeatureBadge label="ANN Index (HNSW)" color="purple" />
            <FeatureBadge label="ALL_MINILM_L12_V2" color="green" />
            <FeatureBadge label="384-dim Vectors" color="blue" />
            <FeatureBadge label="FETCH APPROXIMATE" color="yellow" />
            <FeatureBadge label="Severity Scoring" color="red" />
            <FeatureBadge label="product_embeddings" color="orange" />
            <FeatureBadge label="signal_embeddings" color="orange" />
          </div>
          <SqlBlock code={`-- Real-time vector semantic search for financial products
-- Embeds user query at runtime, then finds nearest
-- financial product vectors via ANN index (cosine distance)
SELECT p.product_id, p.product_name, p.category,
       p.unit_price * 1000 AS exposure_value,
       b.brand_name,
       ROUND(1 - VECTOR_DISTANCE(
         pe.embedding,
         VECTOR_EMBEDDING(ALL_MINILM_L12_V2
                          USING :query AS DATA),
         COSINE), 4)             AS similarity_score
FROM   product_embeddings pe
JOIN   products p ON pe.product_id = p.product_id
JOIN   brands   b ON p.brand_id   = b.brand_id
ORDER  BY VECTOR_DISTANCE(
  pe.embedding,
  VECTOR_EMBEDDING(ALL_MINILM_L12_V2
                   USING :query AS DATA),
  COSINE)
FETCH APPROXIMATE FIRST 10 ROWS ONLY;`} />
          <div>
            <p className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Vector Search Pipeline</p>
            <div className="space-y-1.5">
              <DiagramBox label="User Query" sub="'high-yield savings liquidity pressure'" color="#4F7D7B" />
              <div className="text-center text-[var(--color-text-dim)]">↓</div>
              <DiagramBox label="VECTOR_EMBEDDING" sub="ALL_MINILM_L12_V2 ONNX model · 384 dimensions" color="#4F7D7B" />
              <div className="text-center text-[var(--color-text-dim)]">↓</div>
              <DiagramBox label="VECTOR_DISTANCE(COSINE)" sub="Query vector vs 187 financial product embeddings" color="#AA643B" />
              <div className="text-center text-[var(--color-text-dim)]">↓</div>
              <DiagramBox label="ANN Index Scan" sub="FETCH APPROXIMATE FIRST K ROWS · 95% accuracy" color="#796087" />
              <div className="text-center text-[var(--color-text-dim)]">↓</div>
              <DiagramBox label="Ranked Financial Products and Exposure" sub="Similarity score · institution · exposure value · signal links" color="#4C825C" />
            </div>
            <p className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2 mt-4">Embedding Tables</p>
            <div className="space-y-1.5">
              <DiagramBox label="product_embeddings" sub="187 financial products · 384-dim VECTOR · COSINE ANN index" color="#AA643B" />
              <DiagramBox label="signal_embeddings" sub="5,000 signal bulletins · 384-dim VECTOR · COSINE ANN index" color="#AA643B" />
              <DiagramBox label="semantic_matches" sub="574 pre-computed bulletin-financial product matches · vector method" color="#796087" />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Virtual Private Database (VPD)</p>
            <p className="text-[var(--color-text)] leading-relaxed">
              <span className="tone-pine font-mono">DBMS_RLS</span> policies filter bulletins and source data
              based on the active user's role and region - applied transparently at the database kernel level.
              {currentUser?.ROLE === 'fulfillment_mgr' ? (
                <span className="tone-sienna"> Showing only bulletins from <strong>{currentUser.REGION}</strong> sources.</span>
              ) : (
                <span className="tone-pine"> Full access - all regions visible.</span>
              )}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <FeatureBadge label="DBMS_RLS" color="green" />
              <FeatureBadge label="Row-Level Security" color="green" />
              <FeatureBadge label="Region Filtering" color="blue" />
            </div>
          </div>
        </div>
      </RegisterOraclePanel>

      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="text-[var(--color-accent)]" /> Seer Risk Signal Intelligence Monitor
        </h2>
        <p className="text-sm text-[var(--color-text-dim)] mt-1">
          Fraud, Anti-Money Laundering (AML), regulatory, and market activity triaged into product exposure, investigation priority, and operational response.
        </p>
      </div>

      <SceneStoryPanel scene="social" />

      {/* ── Vector Search ── */}
      <VectorSearch />

      <div>
        <h3 className="text-lg font-semibold text-[var(--color-text)]">
          Regulatory & Risk Activity Feed
        </h3>
      </div>

      {/* Filters */}
      <div className="jet-control-row">
        <Filter size={14} className="text-[var(--color-text-dim)]" />
        <JetSelectSingle
          value={momentum}
          className="jet-inline-field"
          placeholder="All Severity"
          onValueChange={(next) => { setMomentum(next); setPage(1); }}
          options={[
            { value: '', label: 'All Severity' },
            { value: 'mega_viral', label: 'Critical' },
            { value: 'viral', label: 'Escalating' },
            { value: 'rising', label: 'Elevated' },
            { value: 'normal', label: 'Normal' },
          ]}
        />
        <JetSelectSingle
          value={platform}
          className="jet-inline-field"
          placeholder="Signal Source"
          onValueChange={(next) => { setPlatform(next); setPage(1); }}
          options={[
            { value: '', label: 'Signal Source' },
            { value: 'instagram', label: 'SEC bulletin' },
            { value: 'tiktok', label: 'Internal fraud alert' },
            { value: 'twitter', label: 'OCC/FINRA notice' },
            { value: 'youtube', label: 'Market data feed' },
            { value: 'threads', label: 'Branch operations advisory' },
          ]}
        />
        <JetSelectSingle
          value={influencer}
          className="jet-inline-field"
          placeholder="Risk Category"
          onValueChange={(next) => { setInfluencer(next); setPage(1); }}
          options={[
            { value: '', label: 'Risk Category' },
            ...influencers.map((i) => ({
              value: i.HANDLE,
              label: formatSignalSourceName(i.DISPLAY_NAME || i.HANDLE),
            })),
          ]}
        />
        <div className="flex items-center gap-1 ml-2">
          <JetInputText
            value={postQuery}
            placeholder="Search fraud, AML, regulatory, or market risk signals..."
            className="jet-inline-field"
            onValueChange={setPostQuery}
          />
          <JetButton
            label={postSearching ? '...' : 'Go'}
            iconClass={postSearching ? 'oj-fwk-icon oj-fwk-icon-load' : 'oj-fwk-icon oj-fwk-icon-magnifier'}
            chroming="callToAction"
            disabled={postSearching || !postQuery.trim()}
            onAction={() => runPostSearch()}
          />
          {postSearchResults && (
            <JetButton
              label="Clear"
              iconClass="oj-fwk-icon oj-fwk-icon-cross"
              chroming="outlined"
              onAction={clearPostSearch}
            />
          )}
        </div>
        <span className="text-xs text-[var(--color-text-dim)] ml-auto">
          {postSearchResults
            ? <><span className="tone-teal">{postSearchResults.count}</span> matches · {postSearchResults.elapsed}ms</>
            : <>{formatNumber(total)} bulletins</>}
        </span>
      </div>

      {/* Signal feed - vector search results or normal feed */}
      {postSearchResults ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-dim)]">
            <Sparkles size={12} className="tone-teal" />
            <span>Risk intelligence results for "<span className="tone-teal">{postSearchResults.query}</span>"</span>
            <span className="text-[10px]">ranked by evidence match</span>
          </div>
          {postSearchResults.posts?.length === 0 ? (
            <p className="text-sm text-[var(--color-text-dim)]">No matching bulletins found.</p>
          ) : (
            postSearchResults.posts.map((p, idx) => {
              const riskSeverityScore = formatRiskSeverityScore(p, idx);
              const sourceName = formatSignalSourceName(p.INFLUENCER_NAME || p.INFLUENCER_HANDLE, '');
              return (
                <div key={p.POST_ID} className="glass-card p-3.5 fade-in">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded"
                          style={{ background: `${simColor(p.SIMILARITY_SCORE)}22`, color: simColor(p.SIMILARITY_SCORE), border: `1px solid ${simColor(p.SIMILARITY_SCORE)}44` }}>
                          #{idx + 1} · {(p.SIMILARITY_SCORE * 100).toFixed(1)}%
                        </span>
                        <span className={`platform-badge platform-${p.PLATFORM}`}>{getPlatformLabel(p.PLATFORM)}</span>
                        <span className={`momentum-badge momentum-${p.MOMENTUM_FLAG}`}>
                          {getMomentumLabel(p.MOMENTUM_FLAG)}
                        </span>
                        <span className="text-[11px] text-[var(--color-text-dim)]">{formatOperationalTimestamp(p.POSTED_AT)}</span>
                      </div>
                      {sourceName && (
                        <p className="text-xs text-[var(--color-accent)] font-medium mb-0.5">
                          {sourceName}
                          <span className="text-[var(--color-text-dim)] font-normal ml-2">
                            Monitored Exposure: {formatExposureImpact(p.VIEWS_COUNT)} · AI Confidence {p.INFLUENCE_SCORE}
                          </span>
                        </p>
                      )}
                      <p className="text-sm leading-5 line-clamp-3">{p.POST_TEXT}</p>
                    </div>
                    <div className="flex-shrink-0 text-center">
                      <div className="w-12 h-12 rounded-lg flex flex-col items-center justify-center"
                        style={{ background: `${simColor(p.SIMILARITY_SCORE)}15`, border: `1px solid ${simColor(p.SIMILARITY_SCORE)}30` }}>
                        <div className="text-sm font-bold font-mono" style={{ color: simColor(p.SIMILARITY_SCORE) }}>
                          {(p.SIMILARITY_SCORE * 100).toFixed(0)}%
                        </div>
                        <div className="text-[8px] text-[var(--color-text-dim)]">AI match</div>
                      </div>
                    </div>
                  </div>
                  <FeedMetadataStrip item={p} riskSeverityScore={riskSeverityScore} />
                </div>
              );
            })
          )}
        </div>
      ) : (
        <>
          {/* Normal signal feed */}
          <div className="space-y-3">
            {loading ? (
              <p className="text-sm text-[var(--color-text-dim)]">Loading bulletins...</p>
            ) : posts.length === 0 ? (
              <p className="text-sm text-[var(--color-text-dim)]">No bulletins found</p>
            ) : (
              posts.map((p, idx) => <PostCard key={p.POST_ID} post={p} rank={idx} />)
            )}
          </div>

          {/* Pagination */}
          {total > 15 && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-ghost">← Prev</button>
              <span className="text-sm text-[var(--color-text-dim)]">Page {page} of {Math.ceil(total / 15)}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 15)} className="btn-ghost">Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
