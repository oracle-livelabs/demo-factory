import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../utils/api';
import { SceneStoryPanel } from '../components/FinanceStory';
import { FeatureBadge, SqlBlock, DiagramBox } from '../components/OracleInfoPanel';
import { RegisterOraclePanel } from '../context/OraclePanelContext';
import { useUser } from '../context/UserContext';
import { JetButton, JetInputText, JetProgressCircle, JetSelectSingle } from '../components/JetControls';

const MODES = [
  {
    id: 'narrate',
    label: 'Explain',
    iconClass: 'oj-fwk-icon-message-info',
    color: '#4F7D7B',
    desc: 'Risk insight brief',
    tooltip: 'Produce a polished finance explanation grounded in governed SQL results.',
    helper: 'Explain mode creates a business-friendly finance brief for risk, compliance, fraud operations, and client-service leaders. It emphasizes what the answer means, why the metric matters, and how to interpret exposure while keeping SQL secondary.',
    placeholder: 'Ask for an explanation of fraud signals, AML exposure, client transaction value, service SLA pressure, revenue impact, or financial product risk...',
    actionLabel: 'Explain',
    loadingLabel: 'Generating governed SQL and finance insight...',
    emptyCopy: 'Use Explain when you want a polished finance narrative rather than an open-ended conversation.',
  },
  {
    id: 'chat',
    label: 'Chat',
    iconClass: 'oj-fwk-icon-info',
    color: '#437C94',
    desc: 'Follow-up dialogue',
    tooltip: 'Ask conversational follow-up questions using the current context.',
    helper: 'Chat mode supports iterative investigation. Use it to refine a prior answer, compare institutions or client tiers, narrow a fraud pattern, ask follow-up questions, or continue a risk and operations conversation across multiple turns.',
    placeholder: 'Ask a follow-up about AML signals, client exposure, fraud cases, service centers, institutions, transaction cohorts, or prior results...',
    actionLabel: 'Chat',
    loadingLabel: 'Generating conversational finance response...',
    emptyCopy: 'Use Chat when you want to continue analysis across multiple turns.',
  },
  {
    id: 'showsql',
    label: 'Show SQL',
    iconClass: 'oj-fwk-icon-tree-document',
    color: '#796087',
    desc: 'Review governed SQL',
    tooltip: 'Generate SQL for review without executing it.',
    helper: 'Show SQL mode is for transparency. It drafts one governed, read-only Oracle SQL statement for the finance question and stops before execution so a data steward, auditor, or technical reviewer can inspect the query path.',
    placeholder: 'Ask for the SQL behind transaction exposure, AML signals, client tiers, service capacity, institution risk, or financial product analysis...',
    actionLabel: 'Show SQL',
    loadingLabel: 'Generating governed SQL for review...',
    emptyCopy: 'Use Show SQL when you want to inspect the query before rows are returned.',
  },
  {
    id: 'runsql',
    label: 'Run SQL',
    iconClass: 'oj-fwk-icon-grid',
    color: '#AA643B',
    desc: 'Execute and return rows',
    tooltip: 'Execute governed SQL against authorized finance operations views and return structured results.',
    helper: 'Run SQL mode executes the governed query path and returns structured Oracle rows. Use it when the user wants the data table first, with a concise execution summary and collapsible SQL evidence.',
    placeholder: 'Run a governed query for client transactions, signal-linked exposure, fraud cases, financial products, service centers, or institutions...',
    actionLabel: 'Run SQL',
    loadingLabel: 'Generating and executing governed SQL...',
    emptyCopy: 'Use Run SQL when you want structured rows from authorized finance views.',
  },
];

const EXAMPLE_QUESTIONS = [
  { text: 'Which fraud and Anti-Money Laundering (AML) signals are driving the most Seer Bank transaction exposure?', category: 'Signals' },
  { text: 'Show transaction exposure by financial product category for signal-linked transactions.', category: 'Exposure' },
  { text: 'Show the top fraud cases by connected account value.', category: 'Fraud' },
  { text: 'Which Seer service centers are at risk of missing investigation SLA this week?', category: 'Service Coverage' },
  { text: 'What institutions have the highest signal-linked transaction value?', category: 'Institutions' },
  { text: 'Show client tiers with the highest signal-linked exposure.', category: 'Transactions' },
  { text: 'What is the total value of signal-linked client transactions?', category: 'Transactions' },
  { text: 'Show risk signal sources with the highest exposure impact.', category: 'Signals' },
];

const SHOW_SQL_SAFETY_COPY =
  'Generated SQL is shown for review and is not executed in this mode.';
const RUN_SQL_SAFETY_COPY =
  'SQL is executed only against authorized Seer Bank finance operations data with governed access controls.';
const BLOCKED_QUERY_COPY =
  'This query was not executed because it falls outside the allowed governed finance schema.';

const GOVERNED_QUERY_ERROR_PATTERNS = [
  /Only SELECT or WITH/i,
  /Comments and multiple statements/i,
  /Write operations and PL\/SQL/i,
  /System packages and metadata views/i,
  /unsupported tables/i,
  /not allowed/i,
  /safe read-only SQL query/i,
  /valid Oracle SQL query/i,
  /Oracle equivalents/i,
  /PostgreSQL syntax/i,
  /allowed governed finance schema/i,
];

const VISIBLE_SCHEMA_OBJECT_NAMES = [
  'finance_institutions_v',
  'finance_products_v',
  'risk_signals_v',
  'signal_sources_v',
  'client_transactions_v',
  'service_centers_v',
  'service_capacity_v',
  'service_routes_v',
  'finance_signal_product_exposure_v',
  'finance_transaction_exposure_v',
  'finance_service_pressure_v',
  'finance_fraud_case_exposure_v',
];
const VISIBLE_SCHEMA_OBJECT_SET = new Set(VISIBLE_SCHEMA_OBJECT_NAMES);
const CURATED_SCHEMA_DOMAINS = {
  finance_institutions_v: 'Institutions',
  finance_products_v: 'Products & Exposure',
  client_transactions_v: 'Transactions & Cases',
  risk_signals_v: 'Risk Signals',
  signal_sources_v: 'Risk Signals',
  service_centers_v: 'Service Operations',
  service_capacity_v: 'Service Operations',
  service_routes_v: 'Service Operations',
  finance_signal_product_exposure_v: 'Risk Signals',
  finance_transaction_exposure_v: 'Transactions & Cases',
  finance_service_pressure_v: 'Service Operations',
  finance_fraud_case_exposure_v: 'Transactions & Cases',
};
const SCHEMA_DOMAIN_ORDER = [
  'Institutions',
  'Products & Exposure',
  'Transactions & Cases',
  'Risk Signals',
  'Service Operations',
];

const DEFAULT_NATIVE_PROFILE = {
  name: 'FINANCE_SELECTAI_V1',
  label: 'cohere.command-a-03-2025',
  model: 'cohere.command-a-03-2025',
  provider: 'OCI Generative AI',
  region: 'us-chicago-1',
  status: 'CHECKING',
  desc: 'ADB 26ai Select AI profile',
};

const RESULT_COLUMN_DISPLAY_LABELS = {
  ORDER_ID: 'Transaction ID',
  TRANSACTION_ID: 'Transaction ID',
  ORDER_STATUS: 'Transaction Status',
  TRANSACTION_STATUS: 'Transaction Status',
  ORDER_TOTAL: 'Transaction Value',
  TRANSACTION_VALUE: 'Transaction Value',
  TOTAL_REVENUE: 'Total Exposure',
  REVENUE: 'Exposure Value',
  TOTAL_VALUE: 'Total Exposure',
  SIGNAL_LINKED_VALUE: 'Signal-Linked Exposure',
  CUSTOMER_ID: 'Client ID',
  CLIENT_ID: 'Client ID',
  CUSTOMER_NAME: 'Client Name',
  CLIENT_NAME: 'Client Name',
  CUSTOMER_TIER: 'Client Tier',
  BRAND_NAME: 'Institution Name',
  INSTITUTION_NAME: 'Institution Name',
  PRODUCT_NAME: 'Financial Product',
  FINANCIAL_PRODUCT_NAME: 'Financial Product',
  CATEGORY: 'Risk Category',
  PRODUCT_CATEGORY: 'Financial Product Category',
  QUANTITY: 'Transaction Units',
  QTY: 'Transaction Units',
  UNIT_PRICE: 'Service Cost',
  LINE_TOTAL: 'Service Total',
  SHIPPING_COST: 'Processing Fee',
  SERVICE_FEE: 'Processing Fee',
  FULFILLMENT_CENTER: 'Operations Center',
  FULFILLMENT_CENTER_ID: 'Operations Center ID',
  SERVICE_CENTER_NAME: 'Operations Center',
  SOCIAL_DRIVEN: 'Signal-Linked',
  SOURCE_NAME: 'Signal Source',
  CRITICALITY_SCORE: 'Risk Severity',
  SEVERITY_BAND: 'Risk Severity',
  EXPOSURE_COUNT: 'Exposure Impact',
};

function getProfileDisplayLabel(name, index = 0) {
  if (!name) return `Runtime Profile ${index + 1}`;
  return `Runtime Profile ${index + 1}`;
}

function humanizeObjectName(objectName) {
  return String(objectName || '')
    .replace(/_v$/i, '')
    .replace(/_dv$/i, ' JSON Duality View')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function groupSchemaObjects(objects) {
  const domainRank = new Map(SCHEMA_DOMAIN_ORDER.map((domain, index) => [domain, index]));
  const groups = new Map();

  objects.forEach((object) => {
    const domain = object.domain || CURATED_SCHEMA_DOMAINS[object.object_name] || 'Reference Data';
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain).push({
      ...object,
      domain,
      display_name: object.display_name || humanizeObjectName(object.object_name),
    });
  });

  return [...groups.entries()]
    .sort(([leftDomain], [rightDomain]) => {
      const leftRank = domainRank.get(leftDomain) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = domainRank.get(rightDomain) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || leftDomain.localeCompare(rightDomain);
    })
    .map(([domain, groupObjects]) => ({
      domain,
      objects: groupObjects.sort((left, right) => left.display_name.localeCompare(right.display_name)),
      object_count: groupObjects.length,
    }));
}

const CURATED_SCHEMA_GROUPS = groupSchemaObjects(
  VISIBLE_SCHEMA_OBJECT_NAMES.map((objectName) => ({
    object_name: objectName,
    object_type: objectName.endsWith('_v') ? 'view' : 'table',
    domain: CURATED_SCHEMA_DOMAINS[objectName] || 'Reference Data',
    display_name: humanizeObjectName(objectName),
    description: 'Queryable Seer Bank finance schema object.',
    example_questions: [],
    is_queryable_by_assistant: true,
  }))
);

function formatResultColumnLabel(column) {
  const key = String(column || '').toUpperCase();
  if (RESULT_COLUMN_DISPLAY_LABELS[key]) return RESULT_COLUMN_DISPLAY_LABELS[key];
  return humanizeObjectName(key.toLowerCase());
}

function isGovernedQueryBlock(message = '') {
  return GOVERNED_QUERY_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function normalizeAskDataClientError(error) {
  const category = error.category || (/Failed to fetch|NetworkError/i.test(error.message || '') ? 'API_UNREACHABLE' : 'UNEXPECTED_BACKEND_RESPONSE');
  const categoryMessages = {
    API_UNREACHABLE: 'The Governed Data Copilot API is unreachable. Check that the app backend is running.',
    NATIVE_AI_UNAVAILABLE: 'ADB Select AI could not reach OCI Generative AI. Review the Resource Manager native-AI acceptance status.',
    NATIVE_AI_NOT_READY: 'ADB Select AI is not ready. Resource Manager bootstrap must complete its native-AI acceptance checks.',
    AI_PROFILE_UNAVAILABLE: 'The configured ADB Select AI profile is unavailable.',
    NATIVE_AI_INVALID_RESPONSE: 'ADB Select AI returned an invalid response and no substitute was used.',
    SQL_GENERATION_FAILED: 'Unable to generate safe SQL for that question. Try a more specific metric, time window, or entity.',
    SQL_VALIDATION_BLOCKED: BLOCKED_QUERY_COPY,
    ORACLE_QUERY_FAILED: 'Oracle could not execute the generated query. Try rephrasing with a more specific governed finance data question.',
    REQUEST_TIMEOUT: 'The request took too long. Try a narrower question.',
    UNEXPECTED_BACKEND_RESPONSE: 'Governed Data Copilot could not complete the request.',
  };

  const message = error.message || categoryMessages[category] || categoryMessages.UNEXPECTED_BACKEND_RESPONSE;
  const isBlocked = category === 'SQL_VALIDATION_BLOCKED' || isGovernedQueryBlock(message);
  return {
    category,
    message: isBlocked ? BLOCKED_QUERY_COPY : (categoryMessages[category] || message),
    detail: isBlocked && message !== BLOCKED_QUERY_COPY ? message : null,
    correlationId: error.correlationId || null,
  };
}

function JetGlyph({ iconClass, className = '', style }) {
  return <span className={`oj-fwk-icon ${iconClass} ${className}`.trim()} aria-hidden="true" style={style} />;
}

function SqlSafetyNote({ children, tone = 'plum' }) {
  const color = tone === 'sienna' ? '170,100,59' : '121,96,135';
  const toneClass = tone === 'sienna' ? 'tone-sienna' : 'tone-plum';

  return (
    <div className={`flex items-start gap-1.5 px-3 py-1.5 text-[10px] leading-relaxed ${toneClass}`}
      style={{ background: `rgba(${color},0.06)`, borderBottom: `1px solid rgba(${color},0.14)` }}>
      <JetGlyph iconClass="oj-fwk-icon-message-info" className="mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

function copyToClipboard(text) {
  if (!text || typeof navigator === 'undefined' || !navigator.clipboard) return;
  navigator.clipboard.writeText(text).catch(() => {});
}

function textParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}|\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatNarrativeColumnLabel(column) {
  const mapped = formatResultColumnLabel(column);
  if (mapped !== column) return mapped.toLowerCase();
  return String(column || '')
    .replace(/_display_name$/i, '')
    .replace(/_count$/i, ' count')
    .replace(/_value$/i, ' value')
    .replace(/_score$/i, ' score')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sanitizeNarrativeText(text, referencedData) {
  let value = String(text || '');
  const notableFields = Array.isArray(referencedData?.notable_fields)
    ? referencedData.notable_fields
    : [];
  const columns = [...new Set([
    ...notableFields,
    ...Object.keys(RESULT_COLUMN_DISPLAY_LABELS),
  ])]
    .filter(Boolean)
    .sort((left, right) => String(right).length - String(left).length);

  columns.forEach((column) => {
    const raw = String(column);
    const label = formatNarrativeColumnLabel(raw);
    if (!label) return;
    value = value.replace(new RegExp(`\\b${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), label);
  });

  return value;
}

function cleanFindingText(text, referencedData) {
  return sanitizeNarrativeText(text, referencedData).replace(/^\s*\d+\.\s*/, '').trim();
}

function formatElapsed(elapsed) {
  if (!Number.isFinite(Number(elapsed))) return null;
  const ms = Number(elapsed);
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatRowCount(rowCount, mode) {
  if (mode === 'showsql') return 'SQL not run';
  if (!Number.isFinite(Number(rowCount))) return 'rows unavailable';
  const count = Number(rowCount);
  return `${count.toLocaleString()} row${count === 1 ? '' : 's'}`;
}

function AssistantMetadata({ msg, activeModelLabel }) {
  const modeLabel = MODES.find(m => m.id === msg.mode)?.label || msg.mode || 'Answer';
  const model = msg.model || activeModelLabel || 'model unavailable';
  const elapsed = formatElapsed(msg.elapsed);
  const items = [
    msg.action || modeLabel,
    model,
    msg.region,
    msg.provider,
    formatRowCount(msg.rowCount, msg.mode),
    elapsed,
  ].filter(Boolean);

  return (
    <div className="askdata-response-meta" aria-label="Response metadata">
      {items.map((item, index) => (
        <span key={`${item}-${index}`}>{item}</span>
      ))}
    </div>
  );
}

function GeneratedSqlDetails({ sql }) {
  if (!sql) return null;
  return (
    <details className="askdata-sql-details group">
      <summary className="flex items-center gap-1.5 text-[10px] tone-plum cursor-pointer hover:tone-plum transition-colors select-none">
        <JetGlyph iconClass="oj-fwk-icon-tree-document" />
        <span>View generated SQL</span>
      </summary>
      <div className="mt-1.5 rounded-lg overflow-hidden border border-plum-soft">
        <div className="askdata-sql-details__header">
          <span>Generated SQL</span>
          <button
            type="button"
            className="askdata-sql-copy-button"
            onClick={() => copyToClipboard(sql)}
          >
            Copy SQL
          </button>
        </div>
        <pre className="px-3 py-2.5 text-[11px] font-mono text-[var(--color-text)] overflow-x-auto leading-relaxed"
          style={{ background: 'var(--color-surface-muted)' }}>
          {sql}
        </pre>
      </div>
    </details>
  );
}

function NarrativeAnswer({ msg, tone = 'teal', onFollowUp }) {
  const paragraphs = textParagraphs(sanitizeNarrativeText(msg.text, msg.referencedData));
  const findings = Array.isArray(msg.keyFindings)
    ? msg.keyFindings.map((finding) => cleanFindingText(finding, msg.referencedData)).filter(Boolean)
    : [];
  const followUps = Array.isArray(msg.followUpQuestions)
    ? msg.followUpQuestions.map((question) => sanitizeNarrativeText(question, msg.referencedData)).filter(Boolean)
    : [];
  const warnings = Array.isArray(msg.warnings)
    ? msg.warnings
      .map((warning) => sanitizeNarrativeText(warning, msg.referencedData))
      .filter(Boolean)
    : [];
  const resultSummary = sanitizeNarrativeText(msg.resultSummary, msg.referencedData);

  return (
    <div className={`askdata-answer-card askdata-answer-card--${tone}`}>
      <div className="askdata-answer-card__body">
        {paragraphs.length > 0 ? paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        )) : (
          <p>No explanation was returned for this result.</p>
        )}
      </div>

      {findings.length > 0 && (
        <div className="askdata-key-findings">
          <p>Key findings</p>
          <ul>
            {findings.map((finding, index) => (
              <li key={index}>{finding}</li>
            ))}
          </ul>
        </div>
      )}

      {resultSummary && (
        <p className="askdata-result-summary">{resultSummary}</p>
      )}

      {warnings.length > 0 && (
        <div className="askdata-answer-warnings">
          {warnings.map((warning, index) => (
            <span key={index}>{warning}</span>
          ))}
        </div>
      )}

      {followUps.length > 0 && (
        <div className="askdata-follow-ups" aria-label="Suggested follow-up questions">
          {followUps.map((question, index) => (
            <button
              type="button"
              key={index}
              className="askdata-follow-up-chip"
              onClick={() => onFollowUp(question)}
            >
              {question}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function buildConversationHistory(messages) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-6)
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      mode: message.mode || null,
      text: message.text || message.resultSummary || '',
    }))
    .filter((message) => message.text);
}

export default function AskData() {
  const { currentUser } = useUser();
  const demoUsername = currentUser?.USERNAME || null;
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState('narrate');
  const [profile, setProfile] = useState(DEFAULT_NATIVE_PROFILE.name);
  const [profiles, setProfiles] = useState([DEFAULT_NATIVE_PROFILE]);
  const [nativeAiStatus, setNativeAiStatus] = useState('checking');
  const [nativeAiError, setNativeAiError] = useState('');
  const [conversationId, setConversationId] = useState(null);
  const [schemaGroups, setSchemaGroups] = useState(CURATED_SCHEMA_GROUPS);
  const [schemaMetadataSource, setSchemaMetadataSource] = useState('curated-contract');
  const messagesEndRef = useRef(null);
  const activeDemoUserRef = useRef(demoUsername);
  activeDemoUserRef.current = demoUsername;
  const activeProfile = profiles.find((p) => p.name === profile) || profiles[0] || DEFAULT_NATIVE_PROFILE;
  const activeModelLabel = activeProfile?.model || activeProfile?.label || DEFAULT_NATIVE_PROFILE.model;
  const activeMode = MODES.find((m) => m.id === mode) || MODES[0];
  const profileOptions = profiles.map((p, index) => ({
    value: p.name,
    label: p.label || p.model || getProfileDisplayLabel(p.name, index),
  }));
  const schemaObjectCount = schemaGroups.reduce((sum, group) => sum + group.object_count, 0);

  useEffect(() => {
    setMessages([]);
    setInput('');
    setConversationId(null);
    setSending(false);
  }, [demoUsername]);

  useEffect(() => {
    let cancelled = false;
    api.selectai.profiles().then(data => {
      const list = (data.profiles || [])
        .filter(p => p.status === 'ENABLED')
        .map((p, index) => ({
          name: p.name,
          label: p.model || getProfileDisplayLabel(p.name, index),
          model: p.model || getProfileDisplayLabel(p.name, index),
          provider: p.provider || 'OCI Generative AI',
          region: p.region,
          desc: p.type || p.description || 'ADB 26ai Select AI profile',
        }));
      if (!list.length) {
        throw new Error('No enabled ADB Select AI profile was returned.');
      }
      if (!cancelled) {
        setProfiles(list);
        setNativeAiStatus('ready');
        setNativeAiError('');
        setProfile(data.activeProfile && list.some((item) => item.name === data.activeProfile)
          ? data.activeProfile
          : list[0].name);
      }
    }).catch((error) => {
      if (!cancelled) {
        setNativeAiStatus('unavailable');
        setNativeAiError(error.message || 'ADB Select AI readiness is unavailable.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.selectai.schemaObjects().then((data) => {
      const apiGroups = Array.isArray(data.domains) ? data.domains : [];
      const groupedObjects = apiGroups
        .map((group) => {
          const objects = (group.objects || [])
            .filter((object) => VISIBLE_SCHEMA_OBJECT_SET.has(object.object_name))
            .filter((object) => object.is_queryable_by_assistant !== false);
          return {
            domain: group.domain,
            objects,
            object_count: objects.length,
          };
        })
        .filter((group) => group.objects.length > 0);

      const flatObjects = Array.isArray(data.objects)
        ? data.objects
          .filter((object) => VISIBLE_SCHEMA_OBJECT_SET.has(object.object_name))
          .filter((object) => object.is_queryable_by_assistant !== false)
        : [];

      const nextGroups = groupedObjects.length > 0 ? groupedObjects : groupSchemaObjects(flatObjects);
      if (!cancelled && nextGroups.length > 0) {
        setSchemaGroups(nextGroups);
        setSchemaMetadataSource('api');
      }
    }).catch(() => {
      if (!cancelled) {
        setSchemaGroups(CURATED_SCHEMA_GROUPS);
        setSchemaMetadataSource('curated-contract');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text) => {
    const question = (text || input).trim();
    if (!question || sending) return;
    const requestUsername = demoUsername;
    const requestIsCurrent = () => activeDemoUserRef.current === requestUsername;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: question, mode, profile, model: activeModelLabel, time: new Date() }]);
    setSending(true);

    try {
      let response;
      if (mode === 'narrate') {
        const result = await api.selectai.chat(question, true, profile, conversationId);
        if (!requestIsCurrent()) return;
        if (result.conversationId) setConversationId(result.conversationId);
        response = {
          role: 'assistant',
          mode: 'narrate',
          text: result.answer,
          keyFindings: result.keyFindings || [],
          resultSummary: result.resultSummary || '',
          followUpQuestions: result.followUpQuestions || [],
          referencedData: result.referencedData || null,
          warnings: result.warnings || [],
          rowCount: result.rowCount,
          sql: result.sql,
          elapsed: result.elapsed,
          error: result.error,
          profile: result.profile,
          model: result.model,
          region: result.region,
          provider: result.provider,
          action: result.action,
          evidence: result.evidence,
          time: new Date(),
        };
      } else if (mode === 'chat') {
        const result = await api.selectai.chatMode(
          question,
          true,
          profile,
          buildConversationHistory(messages),
          conversationId
        );
        if (!requestIsCurrent()) return;
        if (result.conversationId) setConversationId(result.conversationId);
        response = {
          role: 'assistant',
          mode: 'chat',
          text: result.answer,
          keyFindings: result.keyFindings || [],
          resultSummary: result.resultSummary || '',
          followUpQuestions: result.followUpQuestions || [],
          referencedData: result.referencedData || null,
          warnings: result.warnings || [],
          rowCount: result.rowCount,
          sql: result.sql,
          elapsed: result.elapsed,
          error: result.error,
          profile: result.profile,
          model: result.model,
          region: result.region,
          provider: result.provider,
          action: result.action,
          evidence: result.evidence,
          time: new Date(),
        };
      } else if (mode === 'showsql') {
        const result = await api.selectai.showsql(question, profile, conversationId);
        if (!requestIsCurrent()) return;
        if (result.conversationId) setConversationId(result.conversationId);
        response = {
          role: 'assistant',
          mode: 'showsql',
          text: result.explanation || null,
          sql: result.sql,
          elapsed: result.elapsed || null,
          profile: result.profile,
          model: result.model,
          region: result.region,
          provider: result.provider,
          action: result.action,
          evidence: result.evidence,
          time: new Date(),
        };
      } else {
        const result = await api.selectai.runsql(question, profile, conversationId);
        if (!requestIsCurrent()) return;
        if (result.conversationId) setConversationId(result.conversationId);
        response = {
          role: 'assistant',
          mode: 'runsql',
          columns: result.columns || [],
          rows: result.rows || [],
          rowCount: result.rowCount || 0,
          sql: result.sql,
          explanation: result.explanation || '',
          elapsed: result.elapsed,
          profile: result.profile,
          model: result.model,
          region: result.region,
          provider: result.provider,
          action: result.action,
          evidence: result.evidence,
          time: new Date(),
        };
      }
      if (!requestIsCurrent()) return;
      setMessages(prev => [...prev, response]);
    } catch (err) {
      if (!requestIsCurrent()) return;
      const normalizedError = normalizeAskDataClientError(err);
      setMessages(prev => [...prev, {
        role: 'error',
        text: normalizedError.message,
        detail: normalizedError.detail,
        category: normalizedError.category,
        correlationId: normalizedError.correlationId,
        question,
        mode,
        profile,
        safetyBlocked: normalizedError.category === 'SQL_VALIDATION_BLOCKED',
        sql: err.sql || null,
        time: new Date(),
      }]);
    } finally {
      if (requestIsCurrent()) setSending(false);
    }
  }, [input, sending, mode, profile, activeModelLabel, messages, conversationId, demoUsername]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setInput('');
    setConversationId(null);
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  return (
    <div className="space-y-6 fade-in">

      <RegisterOraclePanel title="Governed Data Copilot">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">What's Happening</p>
            <p className="text-[var(--color-text)] leading-relaxed">
              APP_USER calls <span className="tone-plum font-mono">DBMS_CLOUD_AI</span> with
              profile <span className="tone-plum font-mono">{profile}</span>. ADB 26ai generates SQL
              through OCI Generative AI ({activeModelLabel}, {activeProfile?.region || 'selected region'}),
              enforces the curated-view and single-SELECT boundary, applies the demo-user VPD context,
              and returns generated SQL, filtered rows, or a database-grounded explanation. The user selector
              is an unauthenticated demo control, not an authentication boundary; changing it clears the
              browser transcript and starts a new native conversation.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FeatureBadge label="ADB Select AI" color="purple" />
            <FeatureBadge label="OCI Generative AI" color="pink" />
            <FeatureBadge label={activeModelLabel} color="pink" />
            <FeatureBadge label="VPD-Scoped SQL" color="orange" />
            <FeatureBadge label="Single SELECT" color="cyan" />
            <FeatureBadge label="12 Curated Views" color="blue" />
          </div>
          <SqlBlock code={`-- Stateless native Select AI call owned by APP_USER
SELECT FINANCE_NATIVE_AI_PKG.GENERATE_TEXT(
  p_action       => 'SHOWSQL',
  p_prompt       => :question,
  p_profile_name => 'FINANCE_SELECTAI_V1'
) AS generated_sql
FROM dual;

-- The app then accepts only one SELECT/WITH statement over the
-- 12 curated finance views and executes it on the same VPD-scoped
-- connection. Example governed result path:
SELECT institution_name, signal_linked_value
FROM finance_transaction_exposure_v
ORDER BY signal_linked_value DESC
FETCH FIRST 5 ROWS ONLY;`} />

          <div>
            <p className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">How It Works</p>
            <div className="space-y-1" style={{ fontSize: 9 }}>
              <DiagramBox label="User asks a finance question" sub="Natural language input" color="#4F7D7B" />
              <div className="text-center text-[var(--color-text-dim)]">↓</div>
              <DiagramBox label="Express calls APP_USER in ADB 26ai" sub="VPD context + FINANCE_SELECTAI_V1" color="#796087" />
              <div className="text-center text-[var(--color-text-dim)]">↓</div>
              <DiagramBox label={`DBMS_CLOUD_AI → ${activeModelLabel}`} sub={`OCI Generative AI · ${activeProfile?.region || 'selected region'}`} color="#AA643B" />
              <div className="text-center text-[var(--color-text-dim)]">↓</div>
              <DiagramBox label="ADB validates and executes SQL" sub="Single SELECT · curated views · row cap · VPD" color="#437C94" />
              <div className="text-center text-[var(--color-text-dim)]">↓</div>
              <DiagramBox label="UI returns answer, SQL, or rows" sub="Mode controls response format" color="#4C825C" />
            </div>
          </div>

          <div className="rounded-lg p-2 text-[9px]" style={{ background: 'rgba(79,125,123,0.08)', border: '1px dashed rgba(79,125,123,0.3)', color: 'var(--color-text)' }}>
            <span className="font-semibold">Provider boundary:</span> prompts and bounded result context
            are sent from ADB to OCI Generative AI in {activeProfile?.region || 'the selected region'}.
            Credential names and signing material are never exposed to this application.
          </div>
        </div>
      </RegisterOraclePanel>

      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <JetGlyph iconClass="oj-fwk-icon-message-info" className="askdata-page-glyph tone-teal" /> Governed Data Copilot
        </h2>
        <p className="text-sm text-[var(--color-text-dim)] mt-1">
          Ask plain-English fraud, compliance, service, and exposure questions over Seer Bank&apos;s governed operational data. The assistant can explain results, continue a conversation, show generated SQL, or execute authorized queries.
        </p>
      </div>

      <SceneStoryPanel scene="askdata" />

      <div className="glass-card overflow-hidden" style={{ border: '1px solid rgba(79,125,123,0.25)' }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ background: 'rgba(79,125,123,0.06)', borderBottom: '1px solid rgba(79,125,123,0.15)' }}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(79,125,123,0.2)' }}>
              <JetGlyph iconClass="oj-fwk-icon-grid" className="tone-teal" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Finance Data Assistant</h3>
              <p className="text-[10px] text-[var(--color-text-dim)]">
                Natural-language questions translated into governed SQL over Seer Bank&apos;s live finance operations schema.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="askdata-profile-select">
              <JetSelectSingle
                value={profile}
                options={profileOptions}
                ariaLabel="Runtime profile"
                className="askdata-profile-select__control"
                onValueChange={setProfile}
                disabled={nativeAiStatus !== 'ready'}
              />
              <p className="askdata-profile-select__meta">
                {nativeAiStatus === 'ready'
                  ? `${activeProfile?.desc || 'ADB Select AI'} - ${activeProfile?.provider || 'OCI Generative AI'} - ${activeProfile?.region || 'selected region'}`
                  : nativeAiStatus === 'checking'
                    ? 'Verifying native AI readiness…'
                    : `Native AI unavailable: ${nativeAiError}`}
              </p>
            </div>
            {messages.length > 0 && (
              <JetButton
                label="Clear"
                iconClass="oj-fwk-icon oj-fwk-icon-cross"
                chroming="outlined"
                className="askdata-clear-button"
                onAction={clearChat}
              />
            )}
          </div>
        </div>

        <div className="px-5 py-2.5 space-y-1.5" style={{ background: 'var(--color-surface-muted)', borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold mr-1">Mode:</span>
            {MODES.map(m => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  title={m.tooltip}
                  role="tab"
                  aria-selected={active}
                  className={`askdata-mode-tab ${active ? 'is-active' : ''}`}
                  style={{ '--mode-color': m.color }}
                  onClick={() => setMode(m.id)}
                >
                  <span className={`oj-fwk-icon ${m.iconClass}`} aria-hidden="true" />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
          <div
            className="askdata-mode-guidance"
            style={{ borderColor: `${activeMode.color}33`, background: `${activeMode.color}12` }}
          >
            <span className="askdata-mode-guidance__label" style={{ color: activeMode.color }}>
              {activeMode.label} - {activeMode.desc}
            </span>
            <span className="askdata-mode-guidance__text">{activeMode.helper}</span>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[600px] overflow-y-auto min-h-[300px]"
          style={{ background: 'var(--color-surface)' }}>

          {messages.length === 0 && (
            <div className="space-y-4 py-6">
              <div className="text-center mb-4">
                <JetGlyph iconClass="oj-fwk-icon-magnifier" className="askdata-empty-glyph tone-teal" />
                <p className="text-sm text-[var(--color-text-dim)]">Ask about fraud signals, compliance exposure, client transactions, service coverage, or financial products.</p>
                <p className="text-[10px] text-[var(--color-text-dim)] mt-1">
                  {activeMode.emptyCopy} The assistant keeps answers grounded in authorized Seer Bank finance data.
                </p>
              </div>

              <div className="askdata-schema-panel">
                <div className="askdata-schema-panel__header">
                  <div>
                    <p className="askdata-schema-panel__eyebrow">Queryable finance schema</p>
                    <p className="askdata-schema-panel__copy">
                      {schemaGroups.length} domains - {schemaObjectCount} queryable objects - raw names preserved for generated SQL.
                    </p>
                  </div>
                  <span className="askdata-schema-panel__source">
                    {schemaMetadataSource === 'api' ? 'Live curated metadata' : 'Curated profile contract'}
                  </span>
                </div>
                <div className="askdata-schema-domain-pills" aria-label="Finance schema domains">
                  {schemaGroups.map((group) => (
                    <span className="askdata-schema-domain-pill" key={group.domain}>
                      <span>{group.domain}</span>
                      <span>{group.object_count}</span>
                    </span>
                  ))}
                </div>
                <details className="askdata-schema-details">
                  <summary>Show SQL object names</summary>
                  <div className="askdata-schema-object-groups">
                    {schemaGroups.map((group) => (
                      <section className="askdata-schema-object-group" key={group.domain}>
                        <p>{group.domain}</p>
                        <div className="askdata-schema-object-list">
                          {group.objects.map((object) => (
                            <span
                              key={object.object_name}
                              className="askdata-schema-object-chip"
                              title={`${object.display_name || object.object_name}: ${object.description || 'Queryable Seer Bank finance schema object.'}`}
                            >
                              {object.object_name}
                            </span>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </details>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {EXAMPLE_QUESTIONS.map((eq, i) => (
                  <div key={i} className="askdata-example-tile">
                    <span className="text-[9px] text-[var(--color-text-dim)] uppercase font-semibold">{eq.category}</span>
                    <p className="askdata-example-question">{eq.text}</p>
                    <JetButton
                      label={activeMode.actionLabel}
                      iconClass="oj-fwk-icon oj-fwk-icon-arrowtail-e"
                      chroming="outlined"
                    className="askdata-example-button"
                    disabled={nativeAiStatus !== 'ready'}
                    onAction={() => sendMessage(eq.text)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] ${msg.role === 'user' ? '' : 'w-full'}`}>

                {msg.role === 'user' && (
                  <div className="flex items-start gap-2 justify-end">
                    <div>
                      <div className="px-4 py-2.5 rounded-2xl rounded-br-md text-sm"
                        style={{ background: 'rgba(79,125,123,0.15)', border: '1px solid rgba(79,125,123,0.25)' }}>
                        {msg.text}
                      </div>
                      {msg.mode && (
                        <div className="text-right mt-1">
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                            style={{ background: `${MODES.find(m => m.id === msg.mode)?.color || '#6F757E'}15`, color: MODES.find(m => m.id === msg.mode)?.color || '#6F757E' }}>
                            MODE {MODES.find(m => m.id === msg.mode)?.label || msg.mode}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: 'rgba(79,125,123,0.2)' }}>
                      <JetGlyph iconClass="oj-fwk-icon-users" className="tone-teal" />
                    </div>
                  </div>
                )}

                {msg.role === 'assistant' && (
                  <div className="space-y-2">
                    <div className="askdata-assistant-header">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: `${MODES.find(m => m.id === msg.mode)?.color || '#796087'}30` }}>
                        <JetGlyph iconClass="oj-fwk-icon-grid" style={{ color: MODES.find(m => m.id === msg.mode)?.color || '#796087' }} />
                      </div>
                      <AssistantMetadata msg={msg} activeModelLabel={activeModelLabel} />
                      {msg.error && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded surface-sienna-soft tone-sienna flex items-center gap-1">
                          <JetGlyph iconClass="oj-fwk-icon-message-warning" /> Could not generate query
                        </span>
                      )}
                    </div>

                    {msg.mode === 'narrate' && (
                      <>
                        <NarrativeAnswer msg={msg} tone="teal" onFollowUp={sendMessage} />
                        <GeneratedSqlDetails sql={msg.sql} />
                      </>
                    )}

                    {msg.mode === 'chat' && (
                      <>
                        <NarrativeAnswer msg={msg} tone="ocean" onFollowUp={sendMessage} />
                        <GeneratedSqlDetails sql={msg.sql} />
                      </>
                    )}

                    {msg.mode === 'showsql' && msg.sql && (
                      <div className="rounded-lg overflow-hidden border border-plum-soft">
                        {msg.text && (
                          <div className="askdata-sql-explanation">
                            {msg.text}
                          </div>
                        )}
                        <div className="px-3 py-1.5 text-[9px] font-semibold tone-plum uppercase tracking-wider flex items-center gap-1.5"
                          style={{ background: 'rgba(121,96,135,0.12)', borderBottom: '1px solid rgba(121,96,135,0.2)' }}>
                          <JetGlyph iconClass="oj-fwk-icon-tree-document" /> Generated SQL
                          <button
                            type="button"
                            className="askdata-sql-copy-button ml-auto"
                            onClick={() => copyToClipboard(msg.sql)}
                          >
                            Copy SQL
                          </button>
                        </div>
                        <SqlSafetyNote>{SHOW_SQL_SAFETY_COPY}</SqlSafetyNote>
                        <pre className="px-4 py-3 text-[12px] font-mono tone-plum overflow-x-auto leading-relaxed"
                          style={{ background: 'var(--color-surface-muted)' }}>
                          {msg.sql}
                        </pre>
                      </div>
                    )}

                    {msg.mode === 'runsql' && (
                      <>
                        <div className="rounded-lg overflow-hidden border border-sienna-soft">
                          <SqlSafetyNote tone="sienna">{RUN_SQL_SAFETY_COPY}</SqlSafetyNote>
                        </div>
                        {msg.explanation && (
                          <div className="askdata-run-explanation">
                            {msg.explanation}
                          </div>
                        )}
                        {msg.rows?.length > 0 ? (
                          <div className="rounded-2xl rounded-tl-md overflow-hidden"
                            style={{ border: '1px solid rgba(170,100,59,0.2)' }}>
                            <div className="px-3 py-1.5 flex items-center gap-2 text-[10px] font-semibold tone-sienna uppercase tracking-wider"
                              style={{ background: 'rgba(170,100,59,0.08)', borderBottom: '1px solid rgba(170,100,59,0.15)' }}>
                              <JetGlyph iconClass="oj-fwk-icon-grid" />
                              {msg.rowCount} row{msg.rowCount !== 1 ? 's' : ''} returned
                            </div>
                            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr style={{ background: 'rgba(170,100,59,0.05)' }}>
                                    {(msg.columns?.length ? msg.columns : Object.keys(msg.rows[0])).map(col => (
                                      <th key={col} className="px-3 py-2 text-left text-[10px] font-semibold tone-sienna uppercase tracking-wider whitespace-nowrap"
                                        style={{ borderBottom: '1px solid rgba(170,100,59,0.15)' }}>
                                        {formatResultColumnLabel(col)}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {msg.rows.map((row, rowIndex) => (
                                    <tr key={rowIndex} className="hover:bg-[var(--color-surface)]/50 transition-colors"
                                      style={{ borderBottom: '1px solid var(--color-border)' }}>
                                      {(msg.columns?.length ? msg.columns : Object.keys(row)).map(col => (
                                        <td key={col} className="px-3 py-2 whitespace-nowrap font-mono text-[var(--color-text)]">
                                          {(() => {
                                            const val = row[col];
                                            return val == null ? '-' : typeof val === 'number'
                                              ? (Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2))
                                              : String(val);
                                          })()}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : (
                          <div className="px-4 py-3 rounded-2xl rounded-tl-md text-sm text-[var(--color-text-dim)]"
                            style={{ background: 'rgba(170,100,59,0.05)', border: '1px solid rgba(170,100,59,0.2)' }}>
                            No results found.
                          </div>
                        )}
                        <GeneratedSqlDetails sql={msg.sql} />
                      </>
                    )}
                  </div>
                )}

                {msg.role === 'error' && (
                  <div className="flex items-start gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: 'rgba(199,70,52,0.2)' }}>
                      <JetGlyph iconClass="oj-fwk-icon-message-warning" className="tone-red" />
                    </div>
                    <div className="px-4 py-2.5 rounded-2xl rounded-tl-md text-sm tone-red"
                      style={{ background: 'rgba(199,70,52,0.08)', border: '1px solid rgba(199,70,52,0.2)' }}>
                      <div>{msg.text}</div>
                      {msg.detail && (
                        <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'rgba(199,70,52,0.78)' }}>
                          Rule detail: {msg.detail}
                        </div>
                      )}
                      {msg.correlationId && (
                        <div className="mt-1 text-[11px] leading-relaxed font-mono" style={{ color: 'rgba(199,70,52,0.78)' }}>
                          Diagnostic ID: {msg.correlationId}
                        </div>
                      )}
                      {msg.question && (
                        <button
                          type="button"
                          className="mt-2 text-[11px] font-semibold underline"
                          onClick={() => sendMessage(msg.question)}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: `${MODES.find(m => m.id === mode)?.color || '#796087'}30` }}>
                <JetGlyph iconClass="oj-fwk-icon-grid" style={{ color: MODES.find(m => m.id === mode)?.color || '#796087' }} />
              </div>
              <div className="px-4 py-2.5 rounded-2xl rounded-tl-md flex items-center gap-2 text-sm text-[var(--color-text-dim)]"
                style={{ background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
                <JetProgressCircle size="sm" className="askdata-loading-progress" ariaLabel="Generating response" />
                {activeMode.loadingLabel}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="px-5 py-3" style={{ background: 'var(--color-surface-muted)', borderTop: '1px solid var(--color-border)' }}>
          <div className="jet-control-row">
            <div className="flex-1 min-w-[260px]" onKeyDown={handleKeyDown}>
              <JetInputText
                value={input}
                disabled={sending || nativeAiStatus !== 'ready'}
                ariaLabel="Ask a finance data question"
                placeholder={activeMode.placeholder}
                onValueChange={setInput}
              />
            </div>
            <JetButton
              label={sending ? 'Working...' : activeMode.actionLabel}
              iconClass={sending ? 'oj-fwk-icon oj-fwk-icon-load' : 'oj-fwk-icon oj-fwk-icon-arrow-end'}
              chroming="callToAction"
              disabled={sending || nativeAiStatus !== 'ready' || !input.trim()}
              onAction={() => sendMessage()}
            />
          </div>
          {messages.length === 0 && !input.trim() && !sending && (
            <p className="mt-1.5 text-[10px] text-[var(--color-text-dim)]">
              Current mode: {activeMode.label}. Try one of the examples above or enter a question about the live Seer Bank finance schema.
            </p>
          )}
        </div>
      </div>

    </div>
  );
}
