import { useState, useRef, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip as MapTooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../utils/api';
import { useData } from '../hooks/useData';
import { timeAgo } from '../utils/format';
import { SceneStoryPanel } from '../components/FinanceStory';
import { FeatureBadge, SqlBlock, DiagramBox } from '../components/OracleInfoPanel';
import { RegisterOraclePanel } from '../context/OraclePanelContext';
import { useUser } from '../context/UserContext';
import { JetButton, JetInputText, JetProgressCircle, JetSelectSingle } from '../components/JetControls';

function JetGlyph({ iconClass, className = '', style }) {
  return <span className={`oj-fwk-icon ${iconClass} ${className}`.trim()} aria-hidden="true" style={style} />;
}

const STATUS_ICONS = {
  completed: { iconClass: 'oj-fwk-icon-checkmark', className: 'tone-pine' },
  failed: { iconClass: 'oj-fwk-icon-message-error', className: 'tone-red' },
  proposed: { iconClass: 'oj-fwk-icon-message-warning', className: 'tone-sienna' },
  executing: { iconClass: 'oj-fwk-icon-sortrelevancehigh', className: 'tone-ocean animate-pulse' },
};

const AGENT_COLORS = {
  trend_detection_agent: '#AA643B',
  inventory_agent: '#437C94',
  fulfillment_agent: '#4C825C',
  master_orchestrator: '#796087',
  chat_agent: '#4F7D7B',
};

const TEAM_INFO = {
  FINANCE_OPERATIONS_TEAM: { label: 'Finance Operations Supervisor', color: '#796087', iconClass: 'oj-fwk-icon-users', desc: 'Native supervisor routing across read-only finance specialists' },
  SOCIAL_TREND_TEAM: { label: 'Fraud & Compliance Signal Agent', color: '#AA643B', iconClass: 'oj-fwk-icon-sortrelevancehigh', desc: 'Fraud, Anti-Money Laundering (AML), regulatory, and market signal analysis' },
  FULFILLMENT_TEAM:  { label: 'Client Service Routing Agent', color: '#437C94', iconClass: 'oj-fwk-icon-tree-document', desc: 'Service capacity, compliance, and routing' },
  CLIENT_SERVICE_ROUTING_AGENT:  { label: 'Client Service Routing Agent', color: '#437C94', iconClass: 'oj-fwk-icon-tree-document', desc: 'Service capacity, compliance, and routing' },
  COMMERCE_TEAM:     { label: 'Transaction Exposure Agent', color: '#4C825C', iconClass: 'oj-fwk-icon-grid', desc: 'Transactions, exposure, and onboarding activity' },
};

const EXAMPLE_QUESTIONS = [
  { text: 'Which Seer financial products have the highest fraud and Anti-Money Laundering (AML) signal severity?', iconClass: 'oj-fwk-icon-sortrelevancehigh', team: 'SOCIAL_TREND_TEAM', tag: 'signals' },
  { text: 'Show transaction exposure by financial product category', iconClass: 'oj-fwk-icon-grid', team: 'COMMERCE_TEAM', tag: 'exposure' },
  { text: 'Find operations centers with rising investigation SLA pressure.', iconClass: 'oj-fwk-icon-tree-document', team: 'FULFILLMENT_TEAM', tag: 'service' },
  { text: 'Show exposure from signal-linked transactions.', iconClass: 'oj-fwk-icon-info', team: 'COMMERCE_TEAM', tag: 'exposure' },
  { text: 'Find critical fraud and compliance bulletins in the last 24 hours', iconClass: 'oj-fwk-icon-sortrelevancehigh', team: 'SOCIAL_TREND_TEAM', tag: 'signals' },
  { text: 'Which fraud cases have the highest connected account value?', iconClass: 'oj-fwk-icon-node-expand', team: 'SOCIAL_TREND_TEAM', tag: 'fraud' },
  { text: 'Find the nearest compliant operations center for an AML review case in Miami', iconClass: 'oj-fwk-icon-arrowtail-e', team: 'FULFILLMENT_TEAM', tag: 'service' },
];

function getProfileDisplayLabel(name, index = 0) {
  if (!name) return `Runtime Profile ${index + 1}`;
  return `Runtime Profile ${index + 1}`;
}

// ── Fulfillment Route Map (rendered inside chat messages) ─────────────────────
function FulfillmentRouteMap({ routeData }) {
  const { customer, centers, product } = routeData;
  if (!customer || !centers || centers.length === 0) return null;

  // Calculate map bounds
  const allPoints = [
    [customer.lat, customer.lon],
    ...centers.map(c => [c.lat, c.lon]),
  ];
  const lats = allPoints.map(p => p[0]);
  const lons = allPoints.map(p => p[1]);
  const bounds = [[Math.min(...lats) - 1, Math.min(...lons) - 1], [Math.max(...lats) + 1, Math.max(...lons) + 1]];

  const best = centers[0];

  return (
    <div className="rounded-xl overflow-hidden border border-[var(--color-border)]" style={{ background: 'var(--color-surface)' }}>
      {/* Header */}
      <div className="px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(67,124,148,0.08)', borderBottom: '1px solid rgba(67,124,148,0.2)' }}>
        <JetGlyph iconClass="oj-fwk-icon-arrowtail-e" className="tone-ocean" />
        <span className="text-xs font-bold tone-ocean">Service Route - {product}</span>
        <span className="ml-auto text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(76,130,92,0.15)', color: '#4C825C' }}>
          Best: {best.name} ({best.distance} mi)
        </span>
      </div>

      {/* Map */}
      <div style={{ height: 240 }}>
        <MapContainer bounds={bounds} style={{ height: '100%', width: '100%', borderRadius: 0 }}
          zoomControl={false} attributionControl={false} scrollWheelZoom={false}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />

          {/* Route lines from client to each center */}
          {centers.map((c, i) => (
            <Polyline key={i}
              positions={[[customer.lat, customer.lon], [c.lat, c.lon]]}
              pathOptions={{
                color: i === 0 ? '#4C825C' : 'rgba(255,255,255,0.15)',
                weight: i === 0 ? 3 : 1,
                dashArray: i === 0 ? null : '6 4',
              }}
            />
          ))}

          {/* Fulfillment center markers */}
          {centers.map((c, i) => (
            <CircleMarker key={i}
              center={[c.lat, c.lon]}
              radius={i === 0 ? 8 : 5}
              pathOptions={{
                fillColor: i === 0 ? '#4C825C' : '#437C94',
                fillOpacity: i === 0 ? 0.9 : 0.5,
                color: i === 0 ? '#4C825C' : '#437C94',
                weight: i === 0 ? 2 : 1,
              }}>
              <MapTooltip permanent={i === 0} direction="top" offset={[0, -8]}
                className="route-map-tooltip">
                <div style={{ fontSize: 10, lineHeight: 1.4 }}>
                  <strong>{c.name}</strong><br />
                  {c.city}, {c.state}<br />
                  <span style={{ color: '#4C825C' }}>{c.capacity} units</span> · {c.distance} mi
                </div>
              </MapTooltip>
            </CircleMarker>
          ))}

          {/* Client marker */}
          <CircleMarker center={[customer.lat, customer.lon]} radius={7}
            pathOptions={{ fillColor: '#AA643B', fillOpacity: 0.9, color: '#AA643B', weight: 2 }}>
            <MapTooltip permanent direction="bottom" offset={[0, 8]}
              className="route-map-tooltip">
              <div style={{ fontSize: 10 }}>
                <strong>Client</strong><br />{customer.city}, {customer.state}
              </div>
            </MapTooltip>
          </CircleMarker>
        </MapContainer>
      </div>

      {/* Legend / center list */}
      <div className="px-3 py-2 space-y-1" style={{ borderTop: '1px solid var(--color-border)' }}>
        {centers.map((c, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: i === 0 ? '#4C825C' : '#437C94', opacity: i === 0 ? 1 : 0.5 }} />
            <span className={`font-medium ${i === 0 ? 'tone-pine' : 'text-[var(--color-text-dim)]'}`}>
              {c.name}
            </span>
            <span className="text-[var(--color-text-dim)]">{c.city}, {c.state}</span>
            <span className="ml-auto font-mono text-[10px]" style={{ color: c.capacity > 50 ? '#4C825C' : '#AA643B' }}>
              {c.capacity} units
            </span>
            <span className="font-mono text-[10px] text-[var(--color-text-dim)]">{c.distance} mi</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Chat Agent Component ─────────────────────────────────────────────────────
function ChatAgent({ onActionLogged, disabled = false, statusMessage = '' }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [activeTeam, setActiveTeam] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const buildConversationHistory = useCallback((conversation) => (
    conversation
      .filter((message) => message.role === 'user' || message.role === 'agent')
      .slice(-6)
      .map((message) => ({
        role: message.role === 'agent' ? 'assistant' : 'user',
        text: message.text || '',
      }))
      .filter((message) => message.text)
  ), []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text, requestedTeam = null) => {
    const question = (text || input).trim();
    if (!question || sending || disabled) return;
    const team = activeTeam || requestedTeam;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: question, time: new Date() }]);
    setSending(true);

    try {
      const result = await api.agents.chat(
        question,
        buildConversationHistory(messages),
        conversationId,
        team
      );
      if (result.conversationId) setConversationId(result.conversationId);
      if (result.team) setActiveTeam(result.team);
      setMessages(prev => [...prev, {
        role: 'agent',
        text: result.response,
        team: result.team,
        intent: result.intent,
        agentUsed: result.agentUsed,
        agentToolsUsed: result.agentToolsUsed,
        executionSteps: result.executionSteps,
        data: result.data,
        elapsed: result.elapsed,
        model: result.model,
        region: result.region,
        provider: result.provider,
        action: result.action,
        state: result.state,
        evidence: result.evidence,
        time: new Date(),
      }]);
      if (onActionLogged) onActionLogged();
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'error',
        text: err.message,
        time: new Date(),
      }]);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [input, sending, disabled, onActionLogged, buildConversationHistory, messages, conversationId, activeTeam]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setInput('');
    setConversationId(null);
    setActiveTeam(null);
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  return (
    <div className="glass-card overflow-hidden" style={{ border: '1px solid rgba(79,125,123,0.25)' }}>
      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between" style={{ background: 'rgba(79,125,123,0.06)', borderBottom: '1px solid rgba(79,125,123,0.15)' }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(79,125,123,0.2)' }}>
            <JetGlyph iconClass="oj-fwk-icon-message-info" className="tone-teal" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Coordinate AI Operations Agents</h3>
            <p className="text-[10px] text-[var(--color-text-dim)]">
              Ask fraud-led operations questions - auto-routed to <span className="font-semibold text-[var(--color-text)]">Fraud & Compliance</span>, <span className="font-semibold text-[var(--color-text)]">Client Service Routing</span>, or <span className="font-semibold text-[var(--color-text)]">Transaction Exposure</span> agents
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <JetButton
            label="Clear"
            iconClass="oj-fwk-icon oj-fwk-icon-cross"
            chroming="outlined"
            className="agent-console-clear-button"
            onAction={clearChat}
          />
        )}
      </div>

      {/* Messages area */}
      <div className="px-5 py-4 space-y-4 max-h-[500px] overflow-y-auto min-h-[200px]"
        style={{ background: 'var(--color-surface)' }}>

        {/* Empty state - example questions */}
        {messages.length === 0 && (
          <div className="space-y-3 py-4">
            <div className="text-center mb-4">
              <JetGlyph iconClass="oj-fwk-icon-users" className="agent-console-empty-glyph tone-teal" />
              <p className="text-sm text-[var(--color-text-dim)]">Ask me to investigate fraud signals, exposure, service pressure, or agent actions</p>
              <p className="text-[10px] text-[var(--color-text-dim)] mt-1">
                Native ADB agent orchestration over one validated, VPD-filtered evidence query with durable advisory logging
              </p>
              {disabled && (
                <p className="text-[10px] tone-red mt-2">{statusMessage || 'Native Select AI Agent is unavailable.'}</p>
              )}
            </div>
            <div className="agent-console-example-grid">
              {EXAMPLE_QUESTIONS.map((eq, i) => (
                <div key={i} className="agent-console-example-tile">
                  <div className="agent-console-example-meta">
                    <JetGlyph iconClass={eq.iconClass} className="tone-teal" />
                    <span className="text-[9px] text-[var(--color-text-dim)] uppercase">{eq.tag}</span>
                  </div>
                  <p className="agent-console-example-question">
                    {eq.text}
                  </p>
                  <JetButton
                    label="Ask"
                    iconClass="oj-fwk-icon oj-fwk-icon-arrowtail-e"
                    chroming="outlined"
                    disabled={disabled}
                    className="agent-console-example-button oj-button-sm"
                    onAction={() => sendMessage(eq.text, eq.team)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Message bubbles */}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${msg.role === 'user' ? '' : 'w-full'}`}>
              {/* User message */}
              {msg.role === 'user' && (
                <div className="flex items-start gap-2 justify-end">
                  <div className="px-4 py-2.5 rounded-2xl rounded-br-md text-sm"
                    style={{ background: 'rgba(79,125,123,0.15)', border: '1px solid rgba(79,125,123,0.25)' }}>
                    {msg.text}
                  </div>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: 'rgba(79,125,123,0.2)' }}>
                    <JetGlyph iconClass="oj-fwk-icon-users" className="tone-teal" />
                  </div>
                </div>
              )}

              {/* Agent response */}
              {msg.role === 'agent' && (
                <div className="space-y-2">
                  {/* Team badge + timing */}
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: `${(TEAM_INFO[msg.team] || {}).color || '#C74634'}22` }}>
                      <JetGlyph
                        iconClass={(TEAM_INFO[msg.team] || {}).iconClass || 'oj-fwk-icon-grid'}
                        style={{ color: (TEAM_INFO[msg.team] || {}).color || '#C74634' }}
                      />
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: `${(TEAM_INFO[msg.team] || {}).color || '#C74634'}22`, color: (TEAM_INFO[msg.team] || {}).color || '#C74634' }}>
                      {(TEAM_INFO[msg.team] || {}).label || msg.team}
                    </span>
                    {msg.agentUsed && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded surface-plum-soft tone-plum">NATIVE TEAM</span>
                    )}
                    <span className="text-[9px] text-[var(--color-text-dim)] font-mono">
                      {msg.action} · {msg.model} · {msg.region}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-dim)] ml-auto">{msg.elapsed}ms</span>
                  </div>

                  {/* Response text */}
                  <div className="px-4 py-3 rounded-2xl rounded-tl-md text-sm leading-relaxed whitespace-pre-wrap"
                    style={{ background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
                    {msg.text}
                  </div>

                  {/* Route map if present */}
                  {msg.data && msg.data.type === 'route' && (
                    <FulfillmentRouteMap routeData={msg.data} />
                  )}

                  {/* Data table if present */}
                  {msg.data && Array.isArray(msg.data) && msg.data.length > 0 && (
                    <div className="rounded-lg overflow-hidden border border-[var(--color-border)]">
                      <div className="overflow-x-auto max-h-[250px] overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-[var(--color-surface)]">
                              {Object.keys(msg.data[0]).map(col => (
                                <th key={col} className="px-3 py-1.5 text-left text-[9px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider whitespace-nowrap border-b border-[var(--color-border)]">
                                  {col.replace(/_/g, ' ')}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {msg.data.slice(0, 10).map((row, ri) => (
                              <tr key={ri} className="border-b border-[var(--color-border)]/30 hover:bg-[var(--color-surface)]/30">
                                {Object.values(row).map((val, ci) => (
                                  <td key={ci} className="px-3 py-1.5 whitespace-nowrap font-mono">
                                    {val == null ? '-' : typeof val === 'number'
                                      ? (Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2))
                                      : String(val)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Governed execution stages */}
                  {msg.executionSteps && msg.executionSteps.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {msg.executionSteps.map((stage, stageIndex) => (
                        <span key={stageIndex} className="text-[9px] px-2 py-0.5 rounded-full font-mono flex items-center gap-1"
                          style={{
                            background: stage.status === 'success' ? 'rgba(76,130,92,0.1)' : 'rgba(199,70,52,0.1)',
                            color: stage.status === 'success' ? '#4C825C' : '#C74634',
                            border: `1px solid ${stage.status === 'success' ? 'rgba(76,130,92,0.2)' : 'rgba(199,70,52,0.2)'}`,
                          }}>
                          <JetGlyph iconClass="oj-fwk-icon-tree-document" /> {stage.step}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {msg.role === 'error' && (
                <div className="px-4 py-2.5 rounded-lg text-sm tone-red"
                  style={{ background: 'rgba(199,70,52,0.1)', border: '1px solid rgba(199,70,52,0.25)' }}>
                  {msg.text}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {sending && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'rgba(121,96,135,0.2)' }}>
              <JetGlyph iconClass="oj-fwk-icon-grid" className="tone-plum" />
            </div>
            <div className="px-4 py-2.5 rounded-2xl rounded-tl-md flex items-center gap-2 text-sm text-[var(--color-text-dim)]"
              style={{ background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
              <JetProgressCircle size="sm" className="agent-console-loading-progress" ariaLabel="Agent thinking" />
              Agent thinking…
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="px-5 py-3" style={{ background: 'var(--color-surface-muted)', borderTop: '1px solid var(--color-border)' }}>
        <div className="jet-control-row">
          <div className="flex-1 min-w-[260px]" onKeyDown={handleKeyDown}>
            <JetInputText
              value={input}
              disabled={sending || disabled}
              elementRef={inputRef}
              ariaLabel="Ask an operations agent question"
              placeholder="Ask a fraud, risk, service, or exposure question..."
              onValueChange={setInput}
            />
          </div>
          <JetButton
            label={sending ? 'Sending…' : 'Send'}
            iconClass={sending ? 'oj-fwk-icon oj-fwk-icon-load' : 'oj-fwk-icon oj-fwk-icon-arrow-end'}
            chroming="callToAction"
            disabled={sending || disabled || !input.trim()}
            onAction={() => sendMessage()}
          />
        </div>
      </div>
    </div>
  );
}

// Color palette for profiles (rotates for unknown profiles)
const PROFILE_COLORS = ['#AA643B', '#796087', '#4F7D7B', '#C74634', '#437C94', '#4C825C'];
const PROFILE_COLOR_MAP = {
  FINANCE_SELECTAI_V1: '#796087',
};

const DEFAULT_PROFILE_INFO = {
  FINANCE_SELECTAI_V1: {
    label: 'cohere.command-a-03-2025',
    short: 'Command A',
    color: PROFILE_COLOR_MAP.FINANCE_SELECTAI_V1,
    type: 'ADB 26ai Select AI',
    provider: 'OCI Generative AI',
    region: 'us-chicago-1',
  },
};

export default function AgentConsole() {
  const { currentUser } = useUser();
  const [activeProfile, setActiveProfile] = useState('FINANCE_SELECTAI_V1');
  const [profileSwitching, setProfileSwitching] = useState(false);
  const [nativeAiStatus, setNativeAiStatus] = useState('checking');
  const [nativeAiError, setNativeAiError] = useState('');
  const [profileInfo, setProfileInfo] = useState(DEFAULT_PROFILE_INFO);
  const activeProfileInfo = profileInfo[activeProfile] || DEFAULT_PROFILE_INFO[activeProfile] || {
    label: 'Runtime Profile',
    short: 'Runtime Profile',
    color: '#796087',
    type: 'ADB 26ai Select AI',
    provider: 'OCI Generative AI',
  };
  const profileOptions = Object.entries(profileInfo).map(([name, info], index) => ({
    value: name,
    label: getProfileDisplayLabel(name, index),
  }));

  const { data: actions, refetch: refetchActions } = useData(() => api.agents.actions({ limit: 3 }));
  // Fetch profiles from DB on mount
  useEffect(() => {
    api.agents.profiles().then(data => {
      if (data?.activeProfile) {
        // Clean up the profile name (remove schema prefix if present)
        const clean = data.activeProfile.replace(/^".*"\."?|"$/g, '');
        setActiveProfile(clean);
      }
      // Build profileInfo from DB results
      const info = {};
      (data?.profiles || [])
        .filter(p => p.status === 'ENABLED')
        .forEach((p, i) => {
          const label = p.model || getProfileDisplayLabel(p.name, i);
          info[p.name] = {
            label,
            short: label,
            color: PROFILE_COLOR_MAP[p.name] || PROFILE_COLORS[i % PROFILE_COLORS.length],
            type: p.type || p.description || 'ADB 26ai Select AI',
            provider: p.provider || 'OCI Generative AI',
            region: p.region,
          };
        });
      if (!Object.keys(info).length) {
        throw new Error('No enabled native Select AI profile was returned.');
      }
      setProfileInfo(info);
      setNativeAiStatus('ready');
      setNativeAiError('');
    }).catch((error) => {
      setNativeAiStatus('unavailable');
      setNativeAiError(error.message || 'Native agent readiness is unavailable.');
    });
  }, []);

  const switchProfile = useCallback(async (profileName) => {
    if (profileName === activeProfile || profileSwitching) return;
    setProfileSwitching(true);
    try {
      await api.agents.setProfile(profileName);
      setActiveProfile(profileName);
    } catch (err) {
      console.error('Failed to switch profile:', err);
    } finally {
      setProfileSwitching(false);
    }
  }, [activeProfile, profileSwitching]);

  return (
    <div className="space-y-6 fade-in">

      {/* Register Oracle Internals into the right panel */}
      <RegisterOraclePanel title="Agent Console">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">What's Happening</p>
            <p className="text-[var(--color-text)] leading-relaxed">
              APP_USER invokes <span className="font-mono text-[var(--color-text)]">DBMS_CLOUD_AI_AGENT.RUN_TEAM</span>.
              Before that call, the application asks native Select AI for SQL, validates it against the
              12-view allowlist, and executes exactly one read-only query in the selected demo user's VPD
              session. It supplies only bounded evidence to the native team. The
              <code className="text-xs font-semibold">FINANCE_OPERATIONS_TEAM</code> supervisor and its
              three ADB-defined specialists have no attached tools, so they cannot loop on database calls.
              The separately registered <code className="text-xs font-semibold">FINANCE_READONLY_SQL_TOOL</code>
              is reserved for direct bootstrap validation. The application records each returned
              recommendation as proposed.
              The user selector is an unauthenticated demo control, not an authentication boundary; changing
              it starts a new native conversation.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FeatureBadge label="Select AI Agent" color="purple" />
            <FeatureBadge label="OCI Generative AI" color="pink" />
            <FeatureBadge label={activeProfileInfo.label} color="pink" />
            <FeatureBadge label="Native Supervisor Team" color="orange" />
            <FeatureBadge label="VPD-Grounded Evidence" color="blue" />
            <FeatureBadge label="Tool-Free Agent Tasks" color="green" />
            <FeatureBadge label="agent_actions (Audit Log)" color="blue" />
            <FeatureBadge label="Advisory Only" color="green" />
          </div>
          <SqlBlock code={`-- Native Select AI Agent execution from APP_USER
SELECT FINANCE_NATIVE_AI_PKG.RUN_AGENT(
  p_team_name       => 'FINANCE_OPERATIONS_TEAM',
  p_prompt          => :question,
  p_conversation_id => :conversation_id
) AS advisory_response
FROM dual;

-- FINANCE_OPERATIONS_TEAM is a DBMS_CLOUD_AI_AGENT supervisor.
-- The application first supplies one validated, VPD-filtered query result.
-- Agent tasks have no attached tools and reason only over that evidence.
-- The application logs the returned recommendation as PROPOSED;
-- it does not execute a business transaction.`} />
          {/* Team / Agent / Evidence grid */}
          <div>
            <p className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Agent Teams &amp; Evidence</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { team: 'SOCIAL_TREND_TEAM', agent: 'FIN_RISK_SIGNAL_AGENT', evidence: 'Bounded VPD evidence', color: '#A36472' },
                { team: 'FULFILLMENT_TEAM', agent: 'FIN_SERVICE_PRESSURE_AGENT', evidence: 'Bounded VPD evidence', color: '#AA643B' },
                { team: 'COMMERCE_TEAM', agent: 'FIN_EXPOSURE_AGENT', evidence: 'Bounded VPD evidence', color: '#4C825C' },
              ].map(t => (
                <div key={t.team} className="rounded-xl border border-[var(--color-border)] overflow-hidden">
                  <div className="px-2 py-1.5 text-center" style={{ background: `${t.color}12`, borderBottom: `2px solid ${t.color}44` }}>
                    <p className="text-[9px] font-semibold font-mono text-[var(--color-text)]">{t.team}</p>
                  </div>
                  <div className="p-2 space-y-1.5">
                    <span className="text-[9px] font-mono font-semibold text-[var(--color-text)]">{t.agent}</span>
                    <div className="space-y-0.5">
                      <div className="text-[8px] px-1.5 py-0.5 rounded bg-[var(--color-surface)] text-[var(--color-text-dim)]">
                        {t.evidence}
                      </div>
                      <div className="text-[8px] px-1.5 py-0.5 rounded bg-[var(--color-surface)] text-[var(--color-text-dim)]">
                        No attached tools
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 text-[9px] text-[var(--color-text-dim)] mt-2">
              <span><strong className="text-[var(--color-text)]">1</strong> Select AI Profile</span>
              <span>·</span>
              <span><strong className="text-[var(--color-text)]">1</strong> Direct Validation Tool</span>
              <span>·</span>
              <span><strong className="text-[var(--color-text)]">4</strong> Native Agents</span>
              <span>·</span>
              <span><strong className="text-[var(--color-text)]">3</strong> Tasks</span>
              <span>·</span>
              <span><strong className="text-[var(--color-text)]">4</strong> Teams</span>
            </div>
          </div>

          {/* Architecture flow */}
          <div>
            <p className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Agent Architecture</p>
            <div className="space-y-1" style={{ fontSize: 9 }}>
              <DiagramBox label="Finance Operations Question" sub="selected demo-user VPD context" color="#AA643B" />
              <div className="text-center text-[var(--color-text-dim)]">↓ native SHOWSQL · validate · one VPD SELECT</div>
              <DiagramBox label="Bounded Governed Evidence" sub="curated 12-view scope · SELECT only" color="#4C825C" />
              <div className="text-center text-[var(--color-text-dim)]">↓</div>
              <DiagramBox label="Selected Native Team" sub="direct specialist or FINANCE_OPERATIONS_TEAM supervisor" color="#796087" />
              <div className="text-center text-[var(--color-text-dim)]">↓ direct reasoning or one delegated advisory task</div>
              <DiagramBox label="Tool-Free Native Specialist" sub="signals · service pressure · exposure" color="#437C94" />
              <div className="text-center text-[var(--color-text-dim)]">↓</div>
              <DiagramBox label="Advisory response + agent_actions" sub="Proposed recommendation · audit evidence" color="#4F7D7B" />
            </div>
            <div className="rounded-lg p-2 text-[9px] mt-2" style={{ background: 'rgba(121,96,135,0.08)', border: '1px dashed rgba(121,96,135,0.3)', color: 'var(--color-text)' }}>
              <span className="font-semibold">Provider boundary:</span><br/>
              ADB sends prompts and bounded evidence to OCI Generative AI in {activeProfileInfo.region || 'the selected region'}.
              The browser and Express process never receive an OCI credential or signing key.
            </div>
          </div>
        </div>
      </RegisterOraclePanel>

      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <JetGlyph iconClass="oj-fwk-icon-users" className="agent-console-page-glyph tone-plum" /> AI Operations Agent Console
          </h2>
          <p className="text-sm text-[var(--color-text-dim)] mt-1">
            Native ADB agent teams produce read-only fraud, risk, service, and exposure recommendations while Oracle governs data access, team execution, and audit evidence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* AI Profile Selector */}
          <div className="agent-console-profile-select">
            <JetSelectSingle
              value={activeProfile}
              options={profileOptions}
              ariaLabel="Agent runtime profile"
              className="agent-console-profile-select__control"
              disabled={profileSwitching || nativeAiStatus !== 'ready'}
              onValueChange={switchProfile}
            />
            <p className="agent-console-profile-select__meta">
              {profileSwitching
                ? 'Switching native Select AI profile'
                : nativeAiStatus === 'ready'
                  ? `${activeProfileInfo.type} - ${activeProfileInfo.provider} - ${activeProfileInfo.region || 'selected region'}`
                  : nativeAiStatus === 'checking'
                    ? 'Verifying native agent readiness…'
                    : `Native agents unavailable: ${nativeAiError}`}
            </p>
          </div>

        </div>
      </div>

      <SceneStoryPanel scene="agents" />

      {/* ── Chat Agent ── */}
      <ChatAgent
        key={currentUser?.USERNAME || 'no-demo-user'}
        disabled={nativeAiStatus !== 'ready'}
        statusMessage={nativeAiError}
        onActionLogged={() => { refetchActions(); }}
      />

      {/* Recent Actions Feed (last 3) */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <JetGlyph iconClass="oj-fwk-icon-calendar-clock" /> Recent Agent Actions
        </h3>
        <div className="space-y-2">
          {(actions || []).slice(0, 3).map(a => {
            let payload = null;
            try { payload = typeof a.DECISION_PAYLOAD === 'string' ? JSON.parse(a.DECISION_PAYLOAD) : a.DECISION_PAYLOAD; } catch {}
            const statusIcon = STATUS_ICONS[a.EXECUTION_STATUS] || { iconClass: 'oj-fwk-icon-clock', className: 'tone-neutral' };

            return (
              <div key={a.ACTION_ID} className="flex items-start gap-3 p-3 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors">
                <JetGlyph iconClass={statusIcon.iconClass} className={statusIcon.className} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{a.ACTION_TYPE.replace(/_/g, ' ')}</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                      style={{
                        background: `${AGENT_COLORS[a.AGENT_NAME] || '#6F757E'}22`,
                        color: 'var(--color-text)',
                        border: `1px solid ${AGENT_COLORS[a.AGENT_NAME] || '#6F757E'}33`,
                      }}>
                      {a.AGENT_NAME.replace(/_/g, ' ')}
                    </span>
                    {a.ENTITY_TYPE && (
                      <span className="text-[10px] text-[var(--color-text-dim)]">{a.ENTITY_TYPE} #{a.ENTITY_ID}</span>
                    )}
                  </div>
                  {payload && (
                    <p className="text-xs text-[var(--color-text-dim)] mt-0.5 truncate max-w-lg">
                      {payload.reason || payload.product_name || payload.strategy || JSON.stringify(payload).slice(0, 120)}
                    </p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="text-[11px] text-[var(--color-text-dim)]">{timeAgo(a.CREATED_AT)}</span>
                  <p className="text-[10px] text-[var(--color-text-dim)]">
                    {a.CONFIDENCE == null ? 'Advisory' : `${(a.CONFIDENCE * 100).toFixed(0)}% conf`}
                  </p>
                </div>
              </div>
            );
          })}
          {(!actions || actions.length === 0) && (
            <p className="text-sm text-[var(--color-text-dim)] text-center py-4">No native advisory actions yet. Ask a question to get started.</p>
          )}
        </div>
      </div>

    </div>
  );
}
