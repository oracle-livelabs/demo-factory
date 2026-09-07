import { useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Legend
} from 'recharts';
import { api } from '../utils/api';
import { useData } from '../hooks/useData';
import { formatNumber, formatCurrency, getMomentumLabel } from '../utils/format';
import { SceneStoryPanel } from '../components/FinanceStory';
import { FeatureBadge, SqlBlock, DiagramBox } from '../components/OracleInfoPanel';
import { JetButton, JetProgressCircle, JetSelectSingle } from '../components/JetControls';
import { RegisterOraclePanel } from '../context/OraclePanelContext';

// ── Color palette ──────────────────────────────────────
const SEGMENT_COLORS = {
  Champion:       '#AA643B',
  Loyal:          '#4C825C',
  'New Client': '#4F7D7B',
  'New Customer': '#4F7D7B',
  'At Risk':      '#C74634',
  Lost:           '#7A736E',
  'Big Spender':  '#796087',
  Promising:      '#437C94',
  Potential:      '#6F757E',
};

const MOMENTUM_COLORS = {
  mega_viral: '#C74634',
  viral:      '#AA643B',
  rising:     '#AA643B',
  normal:     '#7A736E',
};

const CHART_COLORS = ['#C74634','#4F7D7B','#AA643B','#4C825C','#A36472','#437C94','#796087','#AA643B'];

// ── Tab definitions ────────────────────────────────────
const CLUSTER_COLORS = ['#C74634','#4F7D7B','#AA643B','#4C825C','#A36472','#437C94','#796087','#AA643B','#437C94','#4C825C','#796087','#A36472','#4F7D7B','#5F7D4F','#AA643B'];

const TABS = [
  { key: 'demand',    label: 'Fraud-Linked Operational Risk Forecast', buttonLabel: 'Operational Risk',       iconClass: 'oj-fwk-icon-sortrelevancehigh', color: '#AA643B' },
  { key: 'rfm',       label: 'Client Value & Attrition Segmentation',  buttonLabel: 'Client Risk & Value',    iconClass: 'oj-fwk-icon-users',             color: '#C74634' },
  { key: 'forecast',  label: 'Revenue & Exposure Forecast',            buttonLabel: 'Exposure Forecast',      iconClass: 'oj-fwk-icon-view',              color: '#4C825C' },
  { key: 'clusters',  label: 'Financial Product Risk Cohorts',         buttonLabel: 'Risk Cohorts',           iconClass: 'oj-fwk-icon-grid',              color: '#4F7D7B' },
  { key: 'inventory', label: 'Operational Capacity Intelligence',      buttonLabel: 'Service Capacity',       iconClass: 'oj-fwk-icon-tree-document',     color: '#796087' },
];

const DEMAND_WINDOW_OPTIONS = [
  { value: '168', label: 'Last 7 days' },
  { value: '336', label: 'Last 14 days' },
  { value: '720', label: 'Last 30 days' },
  { value: '2160', label: 'Last 90 days' },
];

const FORECAST_DAY_OPTIONS = [
  { value: '3', label: '+3 day forecast' },
  { value: '7', label: '+7 day forecast' },
  { value: '14', label: '+14 day forecast' },
];

const STOCK_COLORS = {
  OUT_OF_STOCK: '#C74634',
  CRITICAL: '#AA643B',
  LOW: '#AA643B',
  AT_RISK: '#437C94',
  ADEQUATE: '#4C825C',
};

function JetGlyph({ iconClass, className = '', style }) {
  return <span className={`oj-fwk-icon ${iconClass} ${className}`.trim()} aria-hidden="true" style={style} />;
}

function segmentLabel(segment) {
  return segment === 'New Customer' ? 'New Client' : segment;
}

function formatExposureAmount(value) {
  const amount = Math.max(0, Number(value) || 0);
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000).toLocaleString()}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function capacityStatusLabel(status) {
  switch (status) {
    case 'OUT_OF_STOCK':
      return 'Out of Capacity';
    case 'CRITICAL':
      return 'Critical';
    case 'LOW':
      return 'Constrained';
    case 'AT_RISK':
      return 'At Risk';
    case 'ADEQUATE':
      return 'Adequate';
    default:
      return status ? String(status).replaceAll('_', ' ') : '-';
  }
}

// ── Helper components ──────────────────────────────────
function StatCard({ iconClass, label, value, sub, color = '#C74634', badge }) {
  return (
    <div className="stat-card oml-stat-card" style={{ '--oml-accent': color }}>
      <div className="oml-stat-card__copy">
        <p className="oml-stat-card__value">{value}</p>
        <p className="oml-stat-card__label">{label}</p>
        {sub && <p className="oml-stat-card__meta">{sub}</p>}
      </div>
      <div className="oml-stat-card__visual">
        {badge && (
          <span
            className="oml-stat-card__badge"
            style={{ background: `${color}22`, color: 'var(--color-text)', border: `1px solid ${color}33` }}
          >
            {badge}
          </span>
        )}
        <div className="oml-stat-card__icon" style={{ background: `${color}18`, color }}>
          <JetGlyph iconClass={iconClass} className="oml-stat-card__icon-glyph" />
        </div>
      </div>
    </div>
  );
}

function MomentumBadge({ flag }) {
  return (
    <span className={`momentum-badge momentum-${flag}`}>{getMomentumLabel(flag)}</span>
  );
}

function ConfidenceBar({ pct }) {
  const color = pct >= 80 ? '#4C825C' : pct >= 60 ? '#AA643B' : '#C74634';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full surface-bark-soft">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] font-mono" style={{ color }}>{pct}%</span>
    </div>
  );
}

// Custom tooltip for forecast chart
function ForecastTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const ciLower = payload.find(p => p.dataKey === 'ci_lower')?.value;
  const ciUpper = payload.find(p => p.dataKey === 'ci_upper')?.value;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs shadow-xl">
      <p className="font-semibold mb-1 text-[var(--color-text)]">{label}</p>
      {payload.map((p, i) => p.value != null && p.dataKey !== 'ci_lower' && p.dataKey !== 'ci_upper' && (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {formatCurrency(p.value)}
        </p>
      ))}
      {ciLower != null && ciUpper != null && (
        <p className="text-[#C74634] mt-1 border-t border-[var(--color-border)] pt-1">
          95% CI: {formatCurrency(ciLower)} – {formatCurrency(ciUpper)}
        </p>
      )}
    </div>
  );
}

// ── Oracle Panel content per tab ───────────────────────
function DemandOraclePanel() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
          DEMAND_SURGE_MODEL - Random Forest Classification
        </p>
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          A <span className="tone-sienna font-mono">Random Forest</span> model (50 trees) trained via{' '}
          <code className="text-xs tone-sienna">DBMS_DATA_MINING.CREATE_MODEL</code> on 12 signal intensity
          and sales features. Oracle scores every financial product <em>inline</em> at query time using{' '}
          <code className="text-xs tone-sienna">PREDICTION()</code> and{' '}
          <code className="text-xs tone-sienna">PREDICTION_PROBABILITY()</code> - no external ML pipeline,
          no model export. The trained model lives in the database as a persistent mining model object.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <FeatureBadge label="DBMS_DATA_MINING" color="yellow" />
        <FeatureBadge label="ALGO_RANDOM_FOREST (50 trees)" color="yellow" />
        <FeatureBadge label="PREDICTION()" color="orange" />
        <FeatureBadge label="PREDICTION_PROBABILITY()" color="orange" />
        <FeatureBadge label="12 Training Features" color="green" />
        <FeatureBadge label="In-DB Model Persistence" color="purple" />
      </div>
      <SqlBlock code={`-- Step 1: Train the model (one-time)
BEGIN
  DBMS_DATA_MINING.CREATE_MODEL(
    model_name      => 'DEMAND_SURGE_MODEL',
    mining_function => DBMS_DATA_MINING.CLASSIFICATION,
    data_table_name => 'OML_DEMAND_TRAINING_V',
    case_id_column_name => 'PRODUCT_ID',
    target_column_name  => 'SURGE_FLAG',
    settings_table_name => 'DEMAND_SURGE_SETTINGS'
    -- ALGO_RANDOM_FOREST, 50 trees, PREP_AUTO_ON
  );
END;

-- Step 2: Score financial products in real-time SQL
SELECT p.product_name, p.category,

  -- Random Forest prediction: SURGE or NORMAL
  PREDICTION(DEMAND_SURGE_MODEL USING
    p.category, p.unit_price,
    eng.total_posts, eng.avg_sentiment,
    eng.total_likes, eng.total_shares,
    eng.total_views, eng.avg_virality,
    eng.viral_posts, eng.rising_posts,
    sales.units_sold, sales.revenue
  ) AS predicted_surge,

  -- Probability of SURGE class (0.0 – 1.0)
  ROUND(PREDICTION_PROBABILITY(
    DEMAND_SURGE_MODEL, 'SURGE' USING ...
  ) * 100, 1) AS surge_probability

FROM products p
JOIN product_engagement eng  ...
JOIN product_sales sales     ...
ORDER BY surge_probability DESC;`} />
      <div className="oml-model-flow">
        <div className="text-[9px] text-center text-[var(--color-text)] font-bold mb-1">DBMS_DATA_MINING Pipeline</div>
        <DiagramBox label="OML_DEMAND_TRAINING_V (187 financial products)" sub="12 features: signal intensity + orders + availability" color="#AA643B" />
        <div className="text-center text-[10px] text-[var(--color-text)]">↓ CREATE_MODEL</div>
        <DiagramBox label="DEMAND_SURGE_MODEL (Random Forest)" sub="ALGO_RANDOM_FOREST · 50 trees · PREP_AUTO" color="#C74634" />
        <div className="text-center text-[10px] text-[var(--color-text)]">↓ PREDICTION()</div>
        <DiagramBox label="Real-Time Scoring in SQL" sub="PREDICTION_PROBABILITY('SURGE' USING *)" color="#437C94" />
        <div className="text-center text-[10px] text-[var(--color-text)]">↓ result</div>
        <DiagramBox label="SURGE / NORMAL + probability %" sub="scored inline · no ETL · model persists in DB" color="#4C825C" />
      </div>
    </div>
  );
}

function RFMOraclePanel() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
          CUSTOMER_SEGMENT_MODEL - K-Means Clustering
        </p>
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          A <span className="tone-plum font-mono">K-Means</span> model (4 clusters) trained via{' '}
          <code className="text-xs tone-plum">DBMS_DATA_MINING.CREATE_MODEL</code> on 6 RFM features.
          Each client is assigned to a cluster using{' '}
          <code className="text-xs tone-plum">CLUSTER_ID()</code> with{' '}
          <code className="text-xs tone-plum">CLUSTER_PROBABILITY()</code> confidence.
          RFM quartile labels (Champion, Loyal, At Risk, etc.) are layered on top via NTILE(4) window functions.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <FeatureBadge label="DBMS_DATA_MINING" color="violet" />
        <FeatureBadge label="ALGO_KMEANS (4 clusters)" color="violet" />
        <FeatureBadge label="CLUSTER_ID()" color="cyan" />
        <FeatureBadge label="CLUSTER_PROBABILITY()" color="cyan" />
        <FeatureBadge label="NTILE(4) RFM Labels" color="purple" />
        <FeatureBadge label="Churn Risk Scoring" color="red" />
      </div>
      <SqlBlock code={`-- Step 1: Train K-Means model (one-time)
BEGIN
  DBMS_DATA_MINING.CREATE_MODEL(
    model_name      => 'CUSTOMER_SEGMENT_MODEL',
    mining_function => DBMS_DATA_MINING.CLUSTERING,
    data_table_name => 'OML_CUSTOMER_RFM_V',
    case_id_column_name => 'CUSTOMER_ID',
    settings_table_name => 'CUST_SEGMENT_SETTINGS'
    -- ALGO_KMEANS, 4 clusters, PREP_AUTO_ON
  );
END;

-- Step 2: Score clients with CLUSTER_ID()
SELECT c.first_name || ' ' || c.last_name AS full_name,

  -- K-Means cluster assignment
  CLUSTER_ID(CUSTOMER_SEGMENT_MODEL USING
    cm.lifetime_value, cm.recency_days,
    cm.frequency, cm.monetary,
    cm.avg_order_value, cm.total_items
  ) AS oml_cluster_id,

  -- Cluster membership probability
  ROUND(CLUSTER_PROBABILITY(
    CUSTOMER_SEGMENT_MODEL USING ...
  ), 3) AS cluster_probability,

  -- RFM quartile labels layered on top
  NTILE(4) OVER (ORDER BY recency ASC)  AS R,
  NTILE(4) OVER (ORDER BY frequency DESC) AS F,
  NTILE(4) OVER (ORDER BY monetary DESC)  AS M

FROM customer_metrics cm
ORDER BY total_spent DESC;`} />
      <div className="oml-model-flow">
        <div className="text-[9px] text-center text-[var(--color-text)] font-bold mb-1">DBMS_DATA_MINING K-Means Pipeline</div>
        <DiagramBox label="OML_CUSTOMER_RFM_V (2,000 clients)" sub="6 features: LTV, recency, frequency, monetary, AOV, items" color="#C74634" />
        <div className="text-center text-[10px] text-[var(--color-text-dim)]">↓ CREATE_MODEL</div>
        <DiagramBox label="CUSTOMER_SEGMENT_MODEL (K-Means)" sub="ALGO_KMEANS · 4 clusters · PREP_AUTO" color="#796087" />
        <div className="text-center text-[10px] text-[var(--color-text-dim)]">↓ CLUSTER_ID()</div>
        <DiagramBox label="Cluster Assignment + Probability" sub="each client -> nearest centroid" color="#437C94" />
        <div className="text-center text-[10px] text-[var(--color-text-dim)]">↓ NTILE(4)</div>
        <DiagramBox label="RFM Segment Labels + Churn Risk" sub="Champion · Loyal · At Risk · Lost · …" color="#4C825C" />
      </div>
    </div>
  );
}

function ForecastOraclePanel() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
          REVENUE_PREDICT_MODEL - GLM Regression + OLS Trend
        </p>
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          Two complementary Oracle ML techniques:{' '}
          <code className="text-xs tone-pine">REVENUE_PREDICT_MODEL</code> (Generalized Linear Model)
          trained via <code className="text-xs tone-pine">DBMS_DATA_MINING</code> predicts per-transaction revenue
          from client and financial product features. The time-series trend uses{' '}
          <code className="text-xs tone-pine">REGR_SLOPE / REGR_R2</code> (ISO SQL:2003) for OLS regression
          with forward projection and widening confidence intervals.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <FeatureBadge label="DBMS_DATA_MINING" color="green" />
        <FeatureBadge label="ALGO_GLM (Regression)" color="green" />
        <FeatureBadge label="PREDICTION()" color="yellow" />
        <FeatureBadge label="REGR_SLOPE / REGR_R2" color="cyan" />
        <FeatureBadge label="7-Day Moving Average" color="cyan" />
        <FeatureBadge label="Confidence Intervals" color="purple" />
      </div>
      <SqlBlock code={`-- Step 1: Train GLM model (one-time)
BEGIN
  DBMS_DATA_MINING.CREATE_MODEL(
    model_name      => 'REVENUE_PREDICT_MODEL',
    mining_function => DBMS_DATA_MINING.REGRESSION,
    data_table_name => 'OML_REVENUE_TRAINING_V',
    case_id_column_name => 'ORDER_ID',
    target_column_name  => 'TARGET_REVENUE',
    settings_table_name => 'REVENUE_PREDICT_SETTINGS'
    -- ALGO_GENERALIZED_LINEAR_MODEL, PREP_AUTO_ON
  );
END;

-- Step 2: Score orders + time-series trend
WITH daily_rev AS (
  SELECT TRUNC(CAST(created_at AS DATE)) AS day,
    SUM(order_total) AS revenue,
    ROW_NUMBER() OVER (ORDER BY TRUNC(CAST(created_at AS DATE))) AS rn
  FROM orders
  WHERE created_at >= SYSDATE - 30
  GROUP BY TRUNC(CAST(created_at AS DATE))
),
params AS (
  SELECT REGR_SLOPE(revenue, rn)     AS slope,
         REGR_INTERCEPT(revenue, rn) AS intercept,
         REGR_R2(revenue, rn)        AS r2
  FROM daily_rev
),
-- GLM model: per-transaction predicted revenue
glm_stats AS (
  SELECT AVG(PREDICTION(REVENUE_PREDICT_MODEL USING *))
    AS avg_predicted
  FROM OML_REVENUE_TRAINING_V
)
SELECT day, revenue, slope * rn + intercept AS trend,
  r2, avg_predicted
FROM daily_rev CROSS JOIN params CROSS JOIN glm_stats;`} />
      <div className="oml-model-flow">
        <div className="text-[9px] text-center text-[var(--color-text)] font-bold mb-1">Dual Model Pipeline</div>
        <DiagramBox label="OML_REVENUE_TRAINING_V (3,000 orders)" sub="features: tier, LTV, demand_score, items, avg_price" color="#4C825C" />
        <div className="text-center text-[10px] text-[var(--color-text-dim)]">↓ CREATE_MODEL</div>
        <DiagramBox label="REVENUE_PREDICT_MODEL (GLM)" sub="ALGO_GENERALIZED_LINEAR_MODEL · PREP_AUTO" color="#C74634" />
        <div className="text-center text-[10px] text-[var(--color-text-dim)]">↓ PREDICTION()</div>
        <DiagramBox label="Per-Transaction Revenue Prediction" sub="GLM scores each order inline in SQL" color="#437C94" />
        <div className="text-center text-[10px] text-[var(--color-text-dim)]">+ REGR_SLOPE</div>
        <DiagramBox label="OLS Trend + Forward Projection" sub="REGR_R2 fit quality · CI widens 7%/day" color="#AA643B" />
      </div>
    </div>
  );
}

function ClustersOraclePanel() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
          PRODUCT_CLUSTER_MODEL - K-Means Clustering
        </p>
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          A <span className="tone-teal font-mono">K-Means</span> model (5 clusters) trained via{' '}
          <code className="text-xs tone-teal">DBMS_DATA_MINING.CREATE_MODEL</code> on 8 financial product behavior
          features (price, sales, signal engagement, sentiment). Financial Products are assigned using{' '}
          <code className="text-xs tone-teal">CLUSTER_ID()</code> with{' '}
          <code className="text-xs tone-teal">CLUSTER_PROBABILITY()</code> - real trained K-Means
          with convergence, not manual centroid selection. The model persists in the database and
          scores new financial products automatically.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <FeatureBadge label="DBMS_DATA_MINING" color="cyan" />
        <FeatureBadge label="ALGO_KMEANS (5 clusters)" color="cyan" />
        <FeatureBadge label="CLUSTER_ID()" color="purple" />
        <FeatureBadge label="CLUSTER_PROBABILITY()" color="purple" />
        <FeatureBadge label="8 Behavioral Features" color="green" />
        <FeatureBadge label="ONNX Embeddings Available" color="orange" />
        <FeatureBadge label="In-DB Model Persistence" color="yellow" />
      </div>
      <SqlBlock code={`-- Step 1: Train K-Means model (one-time)
BEGIN
  DBMS_DATA_MINING.CREATE_MODEL(
    model_name      => 'PRODUCT_CLUSTER_MODEL',
    mining_function => DBMS_DATA_MINING.CLUSTERING,
    data_table_name => 'OML_PRODUCT_CLUSTER_V',
    case_id_column_name => 'PRODUCT_ID',
    settings_table_name => 'PROD_CLUSTER_SETTINGS'
    -- ALGO_KMEANS, 5 clusters, PREP_AUTO_ON
  );
END;

-- Step 2: Score financial products with CLUSTER_ID()
SELECT p.product_name, p.category, p.unit_price,

  -- K-Means cluster assignment
  CLUSTER_ID(PRODUCT_CLUSTER_MODEL USING
    pcv.unit_price, pcv.weight_kg,
    pcv.units_sold, pcv.revenue,
    pcv.order_count, pcv.total_engagement,
    pcv.avg_sentiment, pcv.avg_virality
  ) AS cluster_id,

  -- Membership probability (0.0 – 1.0)
  ROUND(CLUSTER_PROBABILITY(
    PRODUCT_CLUSTER_MODEL USING *
  ), 4) AS cluster_prob

FROM OML_PRODUCT_CLUSTER_V pcv
JOIN products p ON pcv.PRODUCT_ID = p.PRODUCT_ID
ORDER BY cluster_id, cluster_prob DESC;

-- Training view features:
-- unit_price, weight_kg, units_sold, revenue,
-- order_count, total_engagement, avg_sentiment,
-- avg_virality`} />
      <div className="oml-model-flow">
        <div className="text-[9px] text-center text-[var(--color-text)] font-bold mb-1">DBMS_DATA_MINING K-Means Pipeline</div>
        <DiagramBox label="OML_PRODUCT_CLUSTER_V (187 financial products)" sub="8 features: price, sales, signal engagement, sentiment" color="#4F7D7B" />
        <div className="text-center text-[10px] text-[var(--color-text-dim)]">↓ CREATE_MODEL</div>
        <DiagramBox label="PRODUCT_CLUSTER_MODEL (K-Means)" sub="ALGO_KMEANS · 5 clusters · PREP_AUTO · convergence" color="#AA643B" />
        <div className="text-center text-[10px] text-[var(--color-text-dim)]">↓ CLUSTER_ID()</div>
        <DiagramBox label="Cluster Assignment + Probability" sub="trained centroids · proper distance calculation" color="#796087" />
        <div className="text-center text-[10px] text-[var(--color-text-dim)]">↓ JOIN</div>
        <DiagramBox label="Financial Product Details + Cluster Stats" sub="size · top category · avg probability" color="#4C825C" />
      </div>
    </div>
  );
}

function InventoryOraclePanel() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
          DEMAND_SURGE_MODEL x Service Capacity - Availability Risk Intelligence
        </p>
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          Joins <span className="tone-plum font-mono">DEMAND_SURGE_MODEL</span> (Random Forest) predictions with
          live service capacity across all Seer service centers. Oracle scores each financial product in real-time using{' '}
          <code className="text-xs tone-plum">PREDICTION_PROBABILITY()</code>, then compares predicted service pressure
          against processing capacity to identify market risk - financial products where compliance-driven or market-driven activity will exceed service capacity.
          The <code className="text-xs tone-plum">demand_forecasts</code> table stores daily OML service-pressure predictions, using the next available forecast date when no same-day forecast is present.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <FeatureBadge label="DEMAND_SURGE_MODEL" color="purple" />
        <FeatureBadge label="PREDICTION_PROBABILITY()" color="purple" />
        <FeatureBadge label="demand_forecasts table" color="violet" />
        <FeatureBadge label="service_capacity_v semantic layer" color="cyan" />
        <FeatureBadge label="Revenue Impact" color="red" />
        <FeatureBadge label="Days of Coverage" color="green" />
      </div>
      <SqlBlock code={`-- OML Capacity Intelligence (actual query)
SELECT p.product_name, fc.center_name,
  i.quantity_on_hand, i.reorder_point,
  df.predicted_demand, df.social_factor AS social_factor,

  -- Real-time OML scoring
  PREDICTION(DEMAND_SURGE_MODEL USING
    p.category, p.unit_price,
    eng.total_posts, eng.avg_sentiment, ...
  ) AS oml_surge_prediction,

  ROUND(PREDICTION_PROBABILITY(
    DEMAND_SURGE_MODEL, 'SURGE' USING ...
  ) * 100, 1) AS oml_surge_probability,

  -- Availability risk metrics
  CASE WHEN qty = 0 THEN 'OUT_OF_STOCK'
       WHEN qty < reorder * 0.5 THEN 'CRITICAL'
       WHEN qty < predicted_demand THEN 'AT_RISK'
  END AS capacity_status,

  -- Days of coverage at predicted consumption rate
  ROUND(qty / (predicted_demand / 7), 1)
    AS days_of_supply,

  -- Revenue at risk from capacity shortfall
  (predicted_demand - qty) * unit_price
    AS revenue_at_risk

	FROM inventory i
	JOIN forecast_rollup df ON df.product_id = p.product_id
	  -- forecast_rollup uses MIN(forecast_date) >= TRUNC(SYSDATE)
	ORDER BY oml_surge_probability DESC;`} />
      <div className="oml-model-flow">
        <div className="text-[9px] text-center text-[var(--color-text)] font-bold mb-1">Capacity Intelligence Pipeline</div>
        <DiagramBox label="DEMAND_SURGE_MODEL (Random Forest)" sub="PREDICTION_PROBABILITY('SURGE') per financial product" color="#796087" />
        <div className="text-center text-[10px] text-[var(--color-text-dim)]">↓ scores stored in</div>
        <DiagramBox label="demand_forecasts (daily OML service-pressure predictions)" sub="predicted_demand · signal_factor · confidence band" color="#A36472" />
        <div className="text-center text-[10px] text-[var(--color-text-dim)]">↓ JOIN</div>
        <DiagramBox label="service capacity tables" sub="processing capacity · thresholds · 30 centers" color="#437C94" />
        <div className="text-center text-[10px] text-[var(--color-text-dim)]">↓ COMPARE</div>
        <DiagramBox label="Availability Risk: capacity_status + days_of_supply + revenue_at_risk" sub="OUT_OF_STOCK · CRITICAL · AT_RISK · ADEQUATE" color="#C74634" />
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────
export default function OMLAnalytics() {
  const [activeTab, setActiveTab]       = useState('demand');
  const [demandHours, setDemandHours]   = useState(720);
  const [forecastDays, setForecastDays] = useState(7);
  const [selectedSegment, setSelectedSegment] = useState(null);
  const [clusterK, setClusterK]         = useState(5);

  const { data: summary, loading: summaryLoading } = useData(() => api.ml.summary());
  const { data: demandData, loading: demandLoading, refetch: refetchDemand } =
    useData(() => api.ml.demandForecast({ hours: demandHours }), [demandHours]);
  const { data: segData, loading: segLoading } = useData(() => api.ml.customerSegments());
  const { data: forecastData, loading: forecastLoading, refetch: refetchForecast } =
    useData(() => api.ml.revenueForecast({ days: 30, forecast: forecastDays }), [forecastDays]);
  const { data: clusterData, loading: clusterLoading, refetch: refetchClusters } =
    useData(() => api.ml.vectorClusters(clusterK), [clusterK]);
  const { data: invData, loading: invLoading, refetch: refetchInv } =
    useData(() => api.ml.inventoryIntelligence());

  const products   = demandData?.products  || [];
  const customers  = segData?.customers    || [];
  const segSummary = segData?.segmentSummary || [];
  const churnDist  = segData?.churnDistribution || [];
  const historical = forecastData?.historical || [];
  const forecast   = forecastData?.forecast   || [];
  const model      = forecastData?.model;

  // Merge historical + forecast for the area chart
  // Bridge: last historical point also appears as first forecast point so the line connects
  const lastHist = historical.length ? historical[historical.length - 1] : null;
  const chartData = [
    ...historical.map(r => ({
      day:     r.DAY?.slice(5),
      actual:  r.ACTUAL_REVENUE,
      trend:   r.TREND_LINE,
      ma7:     r.MA_7D,
      forecast: null,
      ci_lower: null,
      ci_upper: null,
    })),
    // Bridge point: connects actual line to forecast line
    ...(lastHist ? [{
      day:      lastHist.DAY?.slice(5),
      actual:   lastHist.ACTUAL_REVENUE,
      trend:    lastHist.TREND_LINE,
      ma7:      lastHist.MA_7D,
      forecast: lastHist.ACTUAL_REVENUE,
      ci_lower: lastHist.TREND_LINE,
      ci_upper: lastHist.TREND_LINE,
    }] : []),
    ...forecast.map((r, i) => {
      // Add natural variation to the forecast line based on CI range
      const ciRange = (r.CI_UPPER - r.CI_LOWER) / 2;
      const variation = ciRange * 0.35 * Math.sin((i + 1) * 1.8 + Math.cos(i * 0.7) * 2);
      const forecastValue = r.TREND_LINE + variation;
      return {
        day:      r.DAY?.slice(5),
        actual:   null,
        trend:    r.TREND_LINE,
        ma7:      null,
        forecast: Math.max(0, forecastValue),
        ci_lower: r.CI_LOWER,
        ci_upper: r.CI_UPPER,
      };
    }),
  ];

  const filteredCustomers = selectedSegment
    ? customers.filter(c => c.SEGMENT === selectedSegment)
    : customers;

  return (
    <div className="space-y-6 fade-in">

      {/* ── Header ──────────────────────────────── */}
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <JetGlyph iconClass="oj-fwk-icon-view" className="oml-header-glyph tone-plum" /> Predictive Risk, Capacity & Revenue Intelligence
        </h2>
        <p className="text-sm text-[var(--color-text-dim)] mt-1">
          Forecast fraud-linked operational pressure, client risk, revenue exposure, product cohorts, and service capacity from governed Seer Bank data.
        </p>
      </div>

      <SceneStoryPanel scene="oml" />

      {/* ── Oracle Panel - switches content based on active tab ── */}
      <RegisterOraclePanel title="Predictive Risk & Revenue Analytics">
        {activeTab === 'demand'   && <DemandOraclePanel />}
        {activeTab === 'rfm'      && <RFMOraclePanel />}
        {activeTab === 'forecast' && <ForecastOraclePanel />}
        {activeTab === 'clusters' && <ClustersOraclePanel />}
        {activeTab === 'inventory' && <InventoryOraclePanel />}
      </RegisterOraclePanel>

      {/* ── Summary stat cards ─────────────────── */}
      <div className="oml-stat-grid">
        <StatCard
          iconClass="oj-fwk-icon-sortrelevancehigh"
          label="Products with Elevated Fraud Risk"
          value={summaryLoading ? '…' : formatNumber(summary?.PRODUCTS_WITH_SURGE || summary?.products_with_surge || 0)}
          sub="Risk and signal evidence"
          color="#AA643B"
          badge="RF"
        />
        <StatCard
          iconClass="oj-fwk-icon-users"
          label="Clients Segmented"
          value={summaryLoading ? '…' : formatNumber(summary?.TOTAL_CUSTOMERS || summary?.total_customers || 0)}
          sub="Value, activity, attrition"
          color="#C74634"
          badge="KM"
        />
        <StatCard
          iconClass="oj-fwk-icon-view"
          label="Revenue Model R²"
          value={summaryLoading ? '…' : (summary?.REVENUE_R2 || summary?.revenue_r2
            ? `${((summary?.REVENUE_R2 || summary?.revenue_r2) * 100).toFixed(1)}%`
            : '-')}
          sub="30-day exposure trend"
          color="#4C825C"
          badge="GLM"
        />
        <StatCard
          iconClass="oj-fwk-icon-grid"
          label="Active Predictive Controls"
          value={summaryLoading ? '…' : (summary?.MODELS_ACTIVE || summary?.models_active || 4)}
          sub="Risk · Clients · Forecast · Cohorts"
          color="#4F7D7B"
          badge="In-DB"
        />
      </div>

      {/* ── Tab Bar ────────────────────────────── */}
      <div className="oml-tabbar" role="tablist" aria-label="OML analytics views">
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <JetButton
              key={tab.key}
              id={`oml-tab-${tab.key}`}
              label={tab.buttonLabel}
              iconClass={`oj-fwk-icon ${tab.iconClass}`}
              chroming={isActive ? 'callToAction' : 'outlined'}
              role="tab"
              ariaSelected={isActive ? 'true' : 'false'}
              ariaControls={`oml-panel-${tab.key}`}
              className="oml-tab-jet-button"
              onAction={() => setActiveTab(tab.key)}
            />
          );
        })}
      </div>

      {/* ══════════════════════════════════════════
          Tab 1 - Operational Pressure and Risk Predictions
      ══════════════════════════════════════════ */}
      {activeTab === 'demand' && (
        <section
          id="oml-panel-demand"
          role="tabpanel"
          aria-labelledby="oml-tab-demand"
          className="glass-card space-y-5"
        >
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                <JetGlyph iconClass="oj-fwk-icon-sortrelevancehigh" className="tone-sienna" />
                Fraud-Linked Operational Risk Forecast
              </h3>
              <p className="text-xs text-[var(--color-text-dim)] mt-0.5">
                Financial products ranked by fraud, AML, compliance, transaction activity, and service pressure signals.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <JetSelectSingle
                value={String(demandHours)}
                options={DEMAND_WINDOW_OPTIONS}
                ariaLabel="Risk scoring window"
                className="oml-inline-select"
                onValueChange={(value) => setDemandHours(Number(value))}
              />
              <JetButton
                label={demandLoading ? 'Scoring' : 'Refresh'}
                iconClass="oj-fwk-icon oj-fwk-icon-arrowtail-e"
                chroming="outlined"
                disabled={demandLoading}
                onAction={refetchDemand}
              />
            </div>
          </div>

          {demandLoading ? (
            <p className="text-sm text-[var(--color-text-dim)] py-4 text-center">Refreshing fraud-linked operational risk forecast...</p>
          ) : products.length === 0 ? (
            <p className="text-sm text-[var(--color-text-dim)] py-4 text-center">No financial products with sufficient signal intensity in this window.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
              {/* Bar chart - predicted service pressure */}
              <div className="lg:col-span-2">
                <p className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
                  Forecasted Operational Load
                </p>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={products.slice(0, 10)} layout="vertical" margin={{ left: 0, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(49,45,42,0.12)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#697778' }} />
                    <YAxis type="category" dataKey="PRODUCT_NAME" tick={{ fontSize: 9, fill: '#697778' }} width={100}
                      tickFormatter={v => v?.length > 14 ? v.slice(0, 14) + '…' : v} />
                    <Tooltip
                      contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11, color: 'var(--color-text)' }}
                      itemStyle={{ color: 'var(--color-text)' }}
                      labelStyle={{ color: 'var(--color-text)' }}
                      cursor={{ fill: 'rgba(49,45,42,0.08)' }}
                      formatter={(v, n) => [formatNumber(v), n === 'PREDICTED_DEMAND' ? 'Forecasted Case Load' : n]}
                    />
                    <Bar dataKey="PREDICTED_DEMAND" radius={[0, 4, 4, 0]}>
                      {products.slice(0, 10).map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Table */}
              <div className="lg:col-span-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider border-b border-[var(--color-border)]">
                      <th className="text-left py-2 px-2">Financial Product</th>
                      <th className="text-right py-2 px-2">Risk Severity</th>
                      <th className="text-right py-2 px-2">Expected Impact</th>
                      <th className="text-right py-2 px-2">Forecasted Case Load</th>
                      <th className="text-right py-2 px-2">Revenue Impact</th>
                      <th className="py-2 px-2">Confidence</th>
                      <th className="text-center py-2 px-2">Risk State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p, i) => (
                      <tr key={i} className="border-b border-[var(--color-border)]/30 hover:bg-[var(--color-surface-hover)] transition-colors">
                        <td className="py-2 px-2">
                          <div className="font-medium truncate max-w-[120px]">{p.PRODUCT_NAME}</div>
                          <div className="text-[9px] text-[var(--color-text-dim)]">{p.CATEGORY}</div>
                        </td>
                        <td className="py-2 px-2 text-right font-mono" style={{ color: MOMENTUM_COLORS[p.PEAK_MOMENTUM] || '#697778' }}>
                          {p.AVG_VIRALITY}
                        </td>
                        <td className="py-2 px-2 text-right">
                          <span className="tone-pine font-semibold">
                            +{p.UPLIFT_PCT}%
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-bold">{formatNumber(p.PREDICTED_DEMAND)}</td>
                        <td className="py-2 px-2 text-right tone-sienna">{formatCurrency(p.REVENUE_OPPORTUNITY)}</td>
                        <td className="py-2 px-2 min-w-[90px]">
                          <ConfidenceBar pct={p.CONFIDENCE_PCT} />
                        </td>
                        <td className="py-2 px-2 text-center">
                          <MomentumBadge flag={p.PEAK_MOMENTUM} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Model explanation */}
          <div className="rounded-lg p-3 text-[10px] flex flex-wrap gap-x-6 gap-y-1"
            style={{ background: 'rgba(170,100,59,0.06)', border: '1px dashed rgba(170,100,59,0.3)', color: 'var(--color-text)' }}>
            <span><strong>Business use:</strong> prioritize product and case queues before fraud-linked pressure exceeds capacity</span>
            <span><strong>Signals:</strong> bulletins, reviewed events, escalations, exposure, transaction volume, and risk severity</span>
            <span><strong>Governance:</strong> technical model details remain available in the Oracle side panel</span>
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════
          Tab 2 - Client Value & Attrition Segmentation
      ══════════════════════════════════════════ */}
      {activeTab === 'rfm' && (
        <section
          id="oml-panel-rfm"
          role="tabpanel"
          aria-labelledby="oml-tab-rfm"
          className="glass-card space-y-5"
        >
          <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                <JetGlyph iconClass="oj-fwk-icon-users" className="tone-plum" />
                Client Value & Attrition Segmentation
              </h3>
            <p className="text-xs text-[var(--color-text-dim)] mt-0.5">
              Prioritize clients by relationship value, recent activity, frequency, exposure, and attrition risk.
            </p>
          </div>

          {segLoading ? (
            <p className="text-sm text-[var(--color-text-dim)] py-4 text-center">Scoring clients via CLUSTER_ID(CUSTOMER_SEGMENT_MODEL)…</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

              {/* Segment donut */}
              <div>
                <p className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2 text-center">
                  Segment Distribution
                </p>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={segSummary}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      dataKey="count"
                      nameKey="segment"
                      onClick={d => setSelectedSegment(selectedSegment === d.segment ? null : d.segment)}
                    >
                      {segSummary.map((s, i) => (
                        <Cell
                          key={i}
                          fill={SEGMENT_COLORS[s.segment] || CHART_COLORS[i % CHART_COLORS.length]}
                          opacity={selectedSegment && selectedSegment !== s.segment ? 0.35 : 1}
                          cursor="pointer"
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11, color: 'var(--color-text)' }}
                      itemStyle={{ color: 'var(--color-text)' }}
                      labelStyle={{ color: 'var(--color-text)' }}
                      cursor={false}
                      formatter={(v, n, p) => [`${v} clients`, p.payload.segment]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Legend */}
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {segSummary.map((s, i) => (
                    <JetButton
                      key={i}
                      label={`${segmentLabel(s.segment)} (${s.count})`}
                      chroming={selectedSegment === s.segment ? 'callToAction' : 'outlined'}
                      className="oml-segment-filter-button"
                      onAction={() => setSelectedSegment(selectedSegment === s.segment ? null : s.segment)}
                    />
                  ))}
                </div>
              </div>

              {/* Churn risk bar + segment table */}
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Attrition Risk Distribution</p>
                  <ResponsiveContainer width="100%" height={100}>
                    <BarChart data={churnDist} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
                      <XAxis dataKey="risk" tick={{ fontSize: 10, fill: '#697778' }} />
                      <YAxis tick={{ fontSize: 9, fill: '#697778' }} width={30} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {churnDist.map((d, i) => (
                          <Cell key={i} fill={d.risk === 'High' ? '#C74634' : d.risk === 'Medium' ? '#AA643B' : '#4C825C'} />
                        ))}
                      </Bar>
                      <Tooltip
                        contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11, color: 'var(--color-text)' }}
                        itemStyle={{ color: 'var(--color-text)' }}
                        labelStyle={{ color: 'var(--color-text)' }}
                        cursor={{ fill: 'rgba(49,45,42,0.08)' }}
                        formatter={v => [`${v} clients`, 'Count']}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div>
                  <p className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Segment Summary</p>
                  <div className="space-y-1">
                    {segSummary.map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px]">
                        <span style={{ color: SEGMENT_COLORS[s.segment] || CHART_COLORS[i] }}>{segmentLabel(s.segment)}</span>
                        <div className="flex gap-3 text-[var(--color-text-dim)]">
                          <span>{s.count} clients</span>
                          <span className="tone-sienna">{formatCurrency(s.total_revenue)}</span>
                          <span className="tone-plum">Relationship {s.avg_rfm}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Client table - filtered by selected segment */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">
                    {selectedSegment ? `${segmentLabel(selectedSegment)} clients` : 'Top clients by relationship score'}
                  </p>
                  {selectedSegment && (
                    <JetButton
                      label="Clear"
                      iconClass="oj-fwk-icon oj-fwk-icon-cross"
                      chroming="borderless"
                      className="oml-clear-filter-button"
                      onAction={() => setSelectedSegment(null)}
                    />
                  )}
                </div>
                <div className="overflow-y-auto max-h-[240px] space-y-1">
                  {filteredCustomers.slice(0, 40).map((c, i) => (
                    <div key={i} className="flex items-center justify-between rounded px-2 py-1.5 text-[10px] hover:surface-bark-soft transition-colors">
                      <div>
                        <span className="font-medium">{c.FULL_NAME}</span>
                        <span className="text-[var(--color-text-dim)] ml-1">{c.CITY}, {c.STATE}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span style={{ color: SEGMENT_COLORS[c.SEGMENT] || '#697778' }}
                          className="text-[9px] font-semibold">{segmentLabel(c.SEGMENT)}</span>
                        <span className="tone-sienna">{formatCurrency(c.TOTAL_SPENT)}</span>
                        <span className={`text-[9px] ${c.CHURN_RISK === 'High' ? 'tone-red' : c.CHURN_RISK === 'Medium' ? 'tone-sienna' : 'tone-pine'}`}>
                          {c.CHURN_RISK}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg p-3 text-[10px] flex flex-wrap gap-x-6 gap-y-1"
            style={{ background: 'rgba(107,116,148,0.06)', border: '1px dashed rgba(107,116,148,0.3)', color: 'var(--color-text)' }}>
            <span><strong>Business use:</strong> identify high-value clients needing proactive servicing or fraud-review communication</span>
            <span><strong>Segments:</strong> Champion · Loyal · New · At Risk · Lost · Big Spender · Promising · Potential</span>
            <span><strong>Governance:</strong> scoring logic and model proof remain visible in the Oracle side panel</span>
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════
          Tab 3 - Revenue Forecast
      ══════════════════════════════════════════ */}
      {activeTab === 'forecast' && (
        <section
          id="oml-panel-forecast"
          role="tabpanel"
          aria-labelledby="oml-tab-forecast"
          className="glass-card space-y-5"
        >
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                <JetGlyph iconClass="oj-fwk-icon-view" className="tone-pine" />
                Revenue & Exposure Forecast
              </h3>
              <p className="text-xs text-[var(--color-text-dim)] mt-0.5">
                Project fee revenue and exposure trends from recent transaction and case activity.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <JetSelectSingle
                value={String(forecastDays)}
                options={FORECAST_DAY_OPTIONS}
                ariaLabel="Revenue forecast horizon"
                className="oml-inline-select"
                onValueChange={(value) => setForecastDays(Number(value))}
              />
              <JetButton
                label={forecastLoading ? 'Fitting' : 'Refresh'}
                iconClass="oj-fwk-icon oj-fwk-icon-arrowtail-e"
                chroming="outlined"
                disabled={forecastLoading}
                onAction={refetchForecast}
              />
            </div>
          </div>

          {forecastLoading ? (
            <p className="text-sm text-[var(--color-text-dim)] py-4 text-center">Refreshing revenue and exposure forecast...</p>
          ) : (
            <>
              {/* Model quality stats */}
              {model && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Forecast Confidence', value: `${((model.r_squared || 0) * 100).toFixed(1)}%`, color: model.r_squared > 0.7 ? '#4C825C' : model.r_squared > 0.4 ? '#AA643B' : '#C74634' },
                    { label: 'Daily Revenue Change', value: `${model.daily_slope >= 0 ? '+' : ''}${formatCurrency(model.daily_slope)}/day`, color: model.daily_slope >= 0 ? '#4C825C' : '#C74634' },
                    { label: 'Average Daily Revenue', value: formatCurrency(model.mean_daily_revenue), color: '#C74634' },
                    { label: 'History Window', value: `${model.observations} days`, color: '#4F7D7B' },
                  ].map((m, i) => (
                    <div key={i} className="rounded-lg p-3 text-center"
                      style={{ background: `${m.color}11`, border: `1px solid ${m.color}33` }}>
                      <p className="text-[10px] text-[var(--color-text-dim)] mb-1">{m.label}</p>
                      <p className="text-sm font-bold">{m.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Main forecast chart */}
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <defs>
                    <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#4C825C" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#4C825C" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#C74634" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#C74634" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(49,45,42,0.12)" />
                  <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#697778' }}
                    interval={Math.floor(chartData.length / 10)} />
                  <YAxis tick={{ fontSize: 9, fill: '#697778' }} width={60}
                    tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ForecastTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10, color: '#697778' }} />

                  {/* Confidence interval band for forecast (upper bound filled, lower bound erases) */}
                  <Area type="monotone" dataKey="ci_upper" fill="#C7463422" stroke="#C7463444"
                    strokeWidth={1} strokeDasharray="3 3" dot={false} name="CI Upper" legendType="none" />
                  <Area type="monotone" dataKey="ci_lower" fill="var(--color-bg)" stroke="#C7463444"
                    strokeWidth={1} strokeDasharray="3 3" dot={false} name="CI Lower" legendType="none" />

                  <Area type="monotone" dataKey="actual" stroke="#4C825C" fill="url(#actualGrad)"
                    strokeWidth={2} dot={false} name="Actual Revenue" connectNulls={false} />
                  <Area type="monotone" dataKey="forecast" stroke="#C74634" fill="url(#forecastGrad)"
                    strokeWidth={2.5} strokeDasharray="6 3" dot={false} name="Forecast" connectNulls />
                  <Line type="monotone" dataKey="trend" stroke="#AA643B" strokeWidth={1.5}
                    strokeDasharray="2 2" dot={false} name="Risk Trend" connectNulls />
                  <Line type="monotone" dataKey="ma7" stroke="#4F7D7B" strokeWidth={1.5}
                    dot={false} name="7-day Average" />

                  {/* Vertical rule separating actual / forecast */}
                  {historical.length > 0 && (
                    <ReferenceLine
                      x={historical[historical.length - 1]?.DAY?.slice(5)}
                      stroke="rgba(49,45,42,0.18)"
                      strokeDasharray="4 4"
                      label={{ value: 'Forecast →', position: 'top', fill: '#697778', fontSize: 9 }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>

              {/* Model card */}
              {model && (
                <div className="rounded-lg p-3 text-[10px] flex flex-wrap gap-x-6 gap-y-1"
                  style={{ background: 'rgba(76,130,92,0.06)', border: '1px dashed rgba(76,130,92,0.3)', color: 'var(--color-text)' }}>
                  <span><strong>Business use:</strong> project revenue and exposure risk from recent transaction activity</span>
                  <span><strong>Forecast confidence:</strong> {(model.r_squared * 100).toFixed(1)}%</span>
                  <span><strong>Pattern strength:</strong> {(model.correlation * 100).toFixed(1)}%</span>
                  <span><strong>Forecast:</strong> {model.forecast_days} days
                    {' · '}<strong>History window:</strong> {model.lookback_days} days
                  </span>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ══════════════════════════════════════════
          Tab 4 - Vector K-Means Clustering
      ══════════════════════════════════════════ */}
      {activeTab === 'clusters' && (
        <section
          id="oml-panel-clusters"
          role="tabpanel"
          aria-labelledby="oml-tab-clusters"
          className="glass-card space-y-5"
        >
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                <JetGlyph iconClass="oj-fwk-icon-grid" className="tone-teal" />
                Financial Product Risk Cohorts
              </h3>
              <p className="text-xs text-[var(--color-text-dim)] mt-0.5">
                Group financial products into risk cohorts so fraud, AML, and operations teams can triage related exposure together.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[var(--color-text-dim)]">Cohorts =</span>
              {[3, 5, 10].map(kVal => (
                <JetButton
                  key={kVal}
                  label={String(kVal)}
                  chroming={clusterK === kVal ? 'callToAction' : 'outlined'}
                  className="oml-k-button"
                  onAction={() => setClusterK(kVal)}
                />
              ))}
              <JetButton
                label={clusterLoading ? 'Clustering' : 'Refresh'}
                iconClass="oj-fwk-icon oj-fwk-icon-arrowtail-e"
                chroming="outlined"
                disabled={clusterLoading}
                onAction={refetchClusters}
              />
            </div>
          </div>

          {clusterLoading ? (
            <div className="py-8 text-center">
              <JetProgressCircle className="oml-loading-progress" ariaLabel="Running vector clustering" />
              <p className="text-sm text-[var(--color-text-dim)]">Grouping financial products into risk cohorts ({clusterK})…</p>
            </div>
          ) : !clusterData?.clusters?.length ? (
            <p className="text-sm text-[var(--color-text-dim)] py-4 text-center">No cluster data available.</p>
          ) : (
            <>
              {/* Cluster summary bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Risk Cohorts', value: clusterData.k, color: '#4F7D7B' },
                  { label: 'Financial Products Clustered', value: clusterData.total_products, color: '#C74634' },
                  { label: 'Indexed Evidence Fields', value: `${clusterData.meta?.dimensions || 384}`, color: '#AA643B' },
                  { label: 'Cohort Method', value: 'Similarity', color: '#4C825C' },
                ].map((m, i) => (
                  <div key={i} className="rounded-lg p-3 text-center"
                    style={{ background: `${m.color}11`, border: `1px solid ${m.color}33` }}>
                    <p className="text-[10px] text-[var(--color-text-dim)] mb-1">{m.label}</p>
                    <p className="text-sm font-bold" style={{ color: m.color }}>{m.value}</p>
                  </div>
                ))}
              </div>

              {/* Cluster size overview */}
              <div>
                <p className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Cluster Distribution</p>
                <div className="flex gap-1 h-8 rounded-lg overflow-hidden">
                  {clusterData.clusters.map((cl, i) => (
                    <div
                      key={cl.cluster_id}
                      className="relative group flex items-center justify-center text-[9px] font-bold transition-all hover:opacity-90"
                      style={{
                        width: `${Math.max((cl.size / clusterData.total_products) * 100, 3)}%`,
                        background: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
                      }}
                    >
                      {cl.size}
                      <div className="absolute -top-8 bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-1 text-[9px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        Cohort {cl.cluster_id}: {cl.size} financial products · {cl.top_category}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cluster cards */}
              <div className="space-y-3">
                {clusterData.clusters.map((cl, i) => {
                  const color = CLUSTER_COLORS[i % CLUSTER_COLORS.length];
                  return (
                    <div key={cl.cluster_id} className="rounded-xl overflow-hidden"
                      style={{ border: `1px solid ${color}33` }}>
                      {/* Cluster header */}
                      <div className="flex items-center justify-between px-4 py-2.5"
                        style={{ background: `${color}11` }}>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
                            style={{ background: `${color}33`, color }}>
                            {cl.cluster_id}
                          </div>
                          <div>
                            <p className="text-sm font-semibold" style={{ color }}>
                              Cohort {cl.cluster_id} - {cl.top_category}
                            </p>
                            <p className="text-[10px] text-[var(--color-text-dim)]">
                              {cl.size} financial products · Avg match: <span className="font-mono" style={{ color }}>{(cl.avg_similarity * 100).toFixed(1)}%</span>
                              {' · '}Reference product: <span className="text-[var(--color-text)]">{cl.centroid_product}</span>
                            </p>
                          </div>
                        </div>
                        {/* Category breakdown pills */}
                        <div className="flex gap-1 flex-wrap justify-end">
                          {Object.entries(cl.category_breakdown)
                            .sort(([,a],[,b]) => b - a)
                            .slice(0, 4)
                            .map(([cat, cnt]) => (
                              <span key={cat} className="text-[9px] px-1.5 py-0.5 rounded-full"
                                style={{ background: `${color}22`, color, border: `1px solid ${color}33` }}>
                                {cat} ({cnt})
                              </span>
                            ))}
                        </div>
                      </div>
                      {/* Financial Products grid */}
                      <div className="px-4 py-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                        {cl.products.slice(0, 12).map(p => (
                          <div key={p.product_id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded text-[11px] hover:surface-bark-soft transition-colors"
                            style={p.is_centroid ? { background: `${color}11`, border: `1px solid ${color}33` } : {}}>
                            <div className="flex-1 min-w-0">
                              <span className="font-medium truncate block">
                                {p.is_centroid && <span style={{ color }} className="mr-1">★</span>}
                                {p.product_name}
                              </span>
                              <span className="text-[9px] text-[var(--color-text-dim)]">
                                {p.brand_name} · {p.category} · Exposure Value {formatExposureAmount((p.unit_price || 0) * 1000)}
                              </span>
                            </div>
                            <div className="flex-shrink-0 w-12 text-right">
                              <span className="text-[10px] font-mono font-bold"
                                style={{ color: p.similarity >= 0.7 ? '#4C825C' : p.similarity >= 0.5 ? '#AA643B' : '#437C94' }}>
                                {(p.similarity * 100).toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        ))}
                        {cl.products.length > 12 && (
                          <div className="text-[10px] text-[var(--color-text-dim)] px-2 py-1">
                            +{cl.products.length - 12} more financial products
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Model explanation */}
              <div className="rounded-lg p-3 text-[10px] flex flex-wrap gap-x-6 gap-y-1"
                style={{ background: 'rgba(79,125,123,0.06)', border: '1px dashed rgba(79,125,123,0.3)', color: 'var(--color-text)' }}>
                <span><strong>Business use:</strong> group related products so investigators can triage linked exposure together</span>
                <span><strong>Evidence:</strong> product text, categories, signal activity, exposure, and similarity</span>
                <span><strong>Governance:</strong> technical vector details remain available in the Oracle side panel</span>
                <span><strong>Cohorts:</strong> {clusterData.k} cohorts · {clusterData.total_products} financial products</span>
              </div>
            </>
          )}
        </section>
      )}

      {/* ══════════════════════════════════════════
          Tab 5 - Capacity Intelligence
      ══════════════════════════════════════════ */}
      {activeTab === 'inventory' && (
        <section
          id="oml-panel-inventory"
          role="tabpanel"
          aria-labelledby="oml-tab-inventory"
          className="glass-card space-y-5"
        >
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                <JetGlyph iconClass="oj-fwk-icon-tree-document" className="tone-plum" />
                Operational Capacity Intelligence
              </h3>
              <p className="text-xs text-[var(--color-text-dim)] mt-0.5">
                Forecast case load against live service capacity to identify fraud-review and compliance SLA risk.
              </p>
            </div>
            <JetButton
              label={invLoading ? 'Scoring' : 'Refresh'}
              iconClass="oj-fwk-icon oj-fwk-icon-arrowtail-e"
              chroming="outlined"
              disabled={invLoading}
              onAction={refetchInv}
            />
          </div>

          {invLoading ? (
            <p className="text-sm text-[var(--color-text-dim)] py-4 text-center">Refreshing operational capacity forecast...</p>
          ) : !invData?.alerts?.length ? (
            <p className="text-sm text-[var(--color-text-dim)] py-4 text-center">No capacity intelligence data available.</p>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="rounded-lg p-3 text-center" style={{ background: '#C7463411', border: '1px solid #C7463433' }}>
                  <p className="text-[10px] text-[var(--color-text-dim)] mb-1">Critical / Out of Capacity</p>
                  <p className="text-xl font-bold text-[#C74634]">{invData.summary.critical_count}</p>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: '#437C9411', border: '1px solid #437C9433' }}>
                  <p className="text-[10px] text-[var(--color-text-dim)] mb-1">At Risk (pressure {'>'} capacity)</p>
                  <p className="text-xl font-bold text-[#437C94]">{invData.summary.at_risk_count}</p>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: '#AA643B11', border: '1px solid #AA643B33' }}>
                  <p className="text-[10px] text-[var(--color-text-dim)] mb-1">Predicted Case Pressure</p>
                  <p className="text-xl font-bold text-[#AA643B]">{invData.summary.surge_products}</p>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: '#79608711', border: '1px solid #79608733' }}>
                  <p className="text-[10px] text-[var(--color-text-dim)] mb-1">Revenue Impact</p>
                  <p className="text-lg font-bold text-[#796087]">{formatCurrency(invData.summary.total_revenue_at_risk)}</p>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: '#4C825C11', border: '1px solid #4C825C33' }}>
                  <p className="text-[10px] text-[var(--color-text-dim)] mb-1">Total Monitored</p>
                  <p className="text-xl font-bold text-[#4C825C]">{invData.summary.total_alerts}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Capacity status distribution */}
                <div>
                  <p className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2 text-center">
                    Capacity Status Distribution
                  </p>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={invData.statusDistribution}
                        cx="50%" cy="50%"
                        innerRadius={45} outerRadius={75}
                        dataKey="count" nameKey="status"
                      >
                        {invData.statusDistribution.map((d, i) => (
                          <Cell key={i} fill={STOCK_COLORS[d.status] || '#7A736E'} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11, color: 'var(--color-text)' }}
                        itemStyle={{ color: 'var(--color-text)' }}
                        labelStyle={{ color: 'var(--color-text)' }}
                        cursor={false}
                        formatter={(v, n, p) => [`${v} products`, capacityStatusLabel(p.payload.status)]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-1.5 justify-center">
                    {invData.statusDistribution.map((d, i) => (
                      <span key={i} className="text-[9px] px-1.5 py-0.5 rounded"
                        style={{ background: `${STOCK_COLORS[d.status] || '#7A736E'}22`, color: STOCK_COLORS[d.status] || '#7A736E' }}>
                        {capacityStatusLabel(d.status)} ({d.count})
                      </span>
                    ))}
                  </div>
                </div>

                {/* Center summary */}
                <div>
                  <p className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
                    Alerts by Operations Center
                  </p>
                  <div className="space-y-1 max-h-[240px] overflow-y-auto">
                    {invData.centerSummary.map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-[10px] rounded px-2 py-1.5 hover:surface-bark-soft">
                        <div>
                          <span className="font-medium">{c.center}</span>
                          <span className="text-[var(--color-text-dim)] ml-1">({c.city})</span>
                        </div>
                        <div className="flex gap-2">
                          {c.critical > 0 && (
                            <span className="text-[#C74634] font-bold">{c.critical} critical</span>
                          )}
                          {c.surges > 0 && (
                            <span className="text-[#AA643B]">{c.surges} escalations</span>
                          )}
                          <span className="text-[var(--color-text-dim)]">{c.alerts} total</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Top escalation probability products */}
                <div>
                  <p className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
                    Highest Escalation Probability
                  </p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={invData.alerts.filter(a => a.OML_SURGE_PREDICTION === 'SURGE').slice(0, 8)}
                      layout="vertical" margin={{ left: 0, right: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(49,45,42,0.12)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 9, fill: '#697778' }} domain={[0, 100]} />
                      <YAxis type="category" dataKey="PRODUCT_NAME" tick={{ fontSize: 8, fill: '#697778' }} width={90}
                        tickFormatter={v => v?.length > 12 ? v.slice(0, 12) + '...' : v} />
                      <Tooltip
                        contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11, color: 'var(--color-text)' }}
                        itemStyle={{ color: 'var(--color-text)' }}
                        labelStyle={{ color: 'var(--color-text)' }}
                        cursor={{ fill: 'rgba(49,45,42,0.08)' }}
                        formatter={v => [`${v}%`, 'Escalation Probability']}
                      />
                      <Bar dataKey="OML_SURGE_PROBABILITY" radius={[0, 4, 4, 0]}>
                        {invData.alerts.filter(a => a.OML_SURGE_PREDICTION === 'SURGE').slice(0, 8).map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Alerts table */}
              <div>
                <p className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
                  Capacity Alerts - Sorted by Escalation Probability
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider border-b border-[var(--color-border)]">
                        <th className="text-left py-2 px-2">Financial Product</th>
                        <th className="text-left py-2 px-2">Operations Center</th>
                        <th className="text-right py-2 px-2">Remaining Capacity</th>
                        <th className="text-right py-2 px-2">Forecasted Case Load</th>
                        <th className="text-right py-2 px-2">Escalation %</th>
                        <th className="text-center py-2 px-2">Status</th>
                        <th className="text-right py-2 px-2">Days Coverage</th>
                        <th className="text-right py-2 px-2">Revenue Impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invData.alerts.slice(0, 30).map((a, i) => (
                        <tr key={i} className="border-b border-[var(--color-border)]/30 hover:bg-[var(--color-surface-hover)] transition-colors">
                          <td className="py-2 px-2">
                            <div className="font-medium truncate max-w-[120px]">{a.PRODUCT_NAME}</div>
                            <div className="text-[9px] text-[var(--color-text-dim)]">{a.CATEGORY} · {a.BRAND_NAME}</div>
                          </td>
                          <td className="py-2 px-2 text-[10px]">
                            <div className="truncate max-w-[100px]">{a.CENTER_NAME}</div>
                          </td>
                          <td className="py-2 px-2 text-right font-mono">{a.QUANTITY_ON_HAND}</td>
                          <td className="py-2 px-2 text-right font-mono tone-sienna">{a.PREDICTED_DEMAND}</td>
                          <td className="py-2 px-2 text-right">
                            <span className="font-bold" style={{
                              color: a.OML_SURGE_PROBABILITY >= 70 ? '#C74634' :
                                     a.OML_SURGE_PROBABILITY >= 40 ? '#AA643B' : '#4C825C'
                            }}>
                              {a.OML_SURGE_PROBABILITY}%
                            </span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{
                                background: `${STOCK_COLORS[a.STOCK_STATUS] || '#7A736E'}22`,
                                color: STOCK_COLORS[a.STOCK_STATUS] || '#7A736E'
                              }}>
                              {capacityStatusLabel(a.STOCK_STATUS)}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right font-mono" style={{
                            color: a.DAYS_OF_SUPPLY != null && a.DAYS_OF_SUPPLY < 3 ? '#C74634' :
                                   a.DAYS_OF_SUPPLY != null && a.DAYS_OF_SUPPLY < 7 ? '#AA643B' : '#4C825C'
                          }}>
                            {a.DAYS_OF_SUPPLY != null ? `${a.DAYS_OF_SUPPLY}d` : '-'}
                          </td>
                          <td className="py-2 px-2 text-right tone-red">
                            {a.REVENUE_AT_RISK > 0 ? formatCurrency(a.REVENUE_AT_RISK) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Model explanation */}
              <div className="rounded-lg p-3 text-[10px] flex flex-wrap gap-x-6 gap-y-1"
                style={{ background: 'rgba(121,96,135,0.06)', border: '1px dashed rgba(121,96,135,0.3)', color: 'var(--color-text)' }}>
                <span><strong>Business use:</strong> anticipate fraud-review and compliance capacity pressure before SLA breach</span>
                <span><strong>Signal:</strong> escalation probability and service-capacity levels</span>
                <span><strong>Data:</strong> forecasted case load, service capacity, and regional operations centers</span>
                <span><strong>Governance:</strong> model details remain available in the Oracle side panel</span>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
