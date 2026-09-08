import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { api } from '../utils/api';
import { useData } from '../hooks/useData';
import { useUser } from '../context/UserContext';
import { formatCurrency, formatNumber } from '../utils/format';
import { SceneStoryPanel } from '../components/FinanceStory';
import { FeatureBadge, SqlBlock, DiagramBox } from '../components/OracleInfoPanel';
import { RegisterOraclePanel } from '../context/OraclePanelContext';
import { JetActionCard, JetButton, JetGlyph, JetInputText } from '../components/JetControls';

// ── Connection type colors ──────────────────────────────────────────────────
const CONNECTION_COLORS = {
  shared_device:     '#C74634',
  shared_ip:         '#AA643B',
  uses_payee:        '#4F7D7B',
  transfers_to:      '#4C825C',
  cashout_at:        '#796087',
  login_from:        '#437C94',
  same_phone:        '#A36472',
  same_email:        '#6B7494',
  card_testing_at:   '#AA643B',
  merchant_velocity: '#697778',
  branch_origin:     '#6F757E',
  opened_with:       '#7A736E',
};

// ── Channel colors (Redwood) ────────────────────────────────────────────────
const PLATFORM_COLORS = {
  mobile:         '#4F7D7B',
  web:            '#437C94',
  branch:         '#AA643B',
  atm:            '#6F757E',
  contact_center: '#796087',
  payments:       '#4C825C',
  merchant:       '#A36472',
  network:        '#697778',
  unknown:        '#7A736E',
};

function platformColor(p) {
  return PLATFORM_COLORS[(p || '').toLowerCase()] || '#C74634';
}

const GRAPH_CANVAS_BACKGROUND = 'var(--color-surface)';
const GRAPH_NODE_STROKE = 'rgba(49,45,42,0.24)';
const GRAPH_NODE_HOVER_STROKE = '#312D2A';
const GRAPH_CENTER_STROKE = '#FFFFFF';
const GRAPH_LABEL_COLOR = '#161513';
const GRAPH_LABEL_HALO = '#FFFFFF';
const GRAPH_LINK_MIN_OPACITY = 0.2;
const GRAPH_LINK_MAX_OPACITY = 0.52;

// ── ForceGraph ───────────────────────────────────────────────────────────────
function ForceGraph({ data, depth, height = 520, onNodeClick }) {
  const svgRef       = useRef(null);
  const containerRef = useRef(null);
  const tooltipRef   = useRef(null);
  const onClickRef   = useRef(onNodeClick);
  const [measuredWidth, setMeasuredWidth] = useState(800);

  // Keep stable reference to callback so D3 handlers don't go stale
  useEffect(() => { onClickRef.current = onNodeClick; }, [onNodeClick]);

  // Measure actual container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        if (w > 0) setMeasuredWidth(w);
      }
    });
    ro.observe(el);
    // Set initial width immediately
    const initW = el.getBoundingClientRect().width;
    if (initW > 0) setMeasuredWidth(Math.round(initW));
    return () => ro.disconnect();
  }, []);

  const width = measuredWidth;

  useEffect(() => {
    if (!data || !data.nodes?.length || !width) return;

    // ── Clean up previous render ──────────────────────────────────────────
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const tip = d3.select(tooltipRef.current);
    tip.style('opacity', 0);

    // ── Build node/link data ──────────────────────────────────────────────
    // Count links per node to scale vertex size by connectivity
    const linkCounts = new Map();
    data.edges.forEach(e => {
      linkCounts.set(e.source, (linkCounts.get(e.source) || 0) + 1);
      linkCounts.set(e.target, (linkCounts.get(e.target) || 0) + 1);
    });
    const maxLinks = Math.max(1, ...linkCounts.values());

    const nodeMap = new Map();
    const nodes = data.nodes.map(d => {
      const lc = linkCounts.get(d.INFLUENCER_ID) || 0;
      const n = {
        ...d,
        id:         d.INFLUENCER_ID,
        linkCount:  lc,
        // Scale radius by number of connections: more links → larger vertex
        radius: d.type === 'center'
          ? Math.max(22, 18 + (lc / maxLinks) * 14)
          : Math.max(6, 6 + (lc / maxLinks) * 16),
        hopOpacity: d.type === 'center' ? 1.0
          : d.hopLevel === 1 ? 0.96
          : d.hopLevel === 2 ? 0.86
          : 0.72,
      };
      nodeMap.set(n.id, n);
      return n;
    });

    const links = data.edges.map(d => ({
      ...d,
      source:   d.source,
      target:   d.target,
      color:    CONNECTION_COLORS[d.type] || '#312D2A',
      strength: d.strength || 0.5,
    }));

    // ── SVG scaffolding ───────────────────────────────────────────────────
    const g = svg.append('g');

    const zoomBehavior = d3.zoom().scaleExtent([0.2, 5]).on('zoom', (event) => {
      g.attr('transform', event.transform);
    });
    svg.call(zoomBehavior);

    // ── Simulation ────────────────────────────────────────────────────────
    const chargeStr = depth === 1 ? -280 : depth === 2 ? -200 : depth === 3 ? -140 : depth === 4 ? -100 : -70;
    const linkDist  = depth === 1 ?  110 : depth === 2 ?   90 : depth === 3 ?  70 : depth === 4 ?   55 :  45;

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(linkDist).strength(d => d.strength * 0.4))
      .force('charge', d3.forceManyBody().strength(chargeStr))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => d.radius + 5));

    // ── Arrowhead marker definitions (one per connection color) ────────────
    const defs = svg.append('defs');
    const usedColors = [...new Set(links.map(d => d.color))];
    usedColors.forEach(color => {
      defs.append('marker')
        .attr('id', `arrow-${color.replace('#', '')}`)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 8)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
          .attr('d', 'M0,-3.5L8,0L0,3.5')
          .attr('fill', color)
          .attr('opacity', 0.72);
    });

    // ── Edge visible lines ────────────────────────────────────────────────
    const link = g.selectAll('.link')
      .data(links).enter().append('line')
      .attr('class', 'link')
      .attr('stroke', d => d.color)
      .attr('stroke-opacity', d => Math.max(GRAPH_LINK_MIN_OPACITY, Math.min(GRAPH_LINK_MAX_OPACITY, d.strength * 0.5)))
      .attr('stroke-width', d => Math.max(1, d.strength * 1.9))
      .attr('marker-end', d => `url(#arrow-${d.color.replace('#', '')})`);

    // ── Edge invisible hit-area lines (for hover) ─────────────────────────
    const linkHit = g.selectAll('.link-hit')
      .data(links).enter().append('line')
      .attr('class', 'link-hit')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 14)
      .style('cursor', 'default')
      .on('mouseover', function(event, d) {
        const typeLabel = (d.type || 'unknown').replace(/_/g, ' ');
        const color     = CONNECTION_COLORS[d.type] || '#6F757E';
        tip.html(`
          <div style="font-size:11px;line-height:1.65;color:#161513">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color}"></span>
              <strong style="text-transform:capitalize;color:#161513">${typeLabel}</strong>
            </div>
            <div>Strength: <strong>${Math.round((d.strength || 0) * 100)}%</strong></div>
            <div>Events: <strong>${formatNumber(d.interactions || 0)}</strong></div>
            <div>Exposure: <strong>${formatCurrency(d.amount || 0)}</strong></div>
            <div style="color:#6F757E;font-size:10px;margin-top:2px">Hop ${d.hopLevel}</div>
          </div>
        `)
        .style('opacity', 1)
        .style('left', (event.pageX + 14) + 'px')
        .style('top',  (event.pageY - 10) + 'px');
      })
      .on('mousemove', function(event) {
        tip.style('left', (event.pageX + 14) + 'px').style('top', (event.pageY - 10) + 'px');
      })
      .on('mouseout', () => tip.style('opacity', 0));

    // ── Node groups ───────────────────────────────────────────────────────
    const node = g.selectAll('.node')
      .data(nodes).enter().append('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .call(d3.drag()
        .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag',  (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end',   (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    // Center node orbit ring
    node.filter(d => d.type === 'center').append('circle')
      .attr('r', d => d.radius + 8)
      .attr('fill', 'none')
      .attr('stroke', '#C74634')
      .attr('stroke-width', 1.25)
      .attr('stroke-dasharray', '5 4')
      .attr('opacity', 0.38);

    // Main circle
    node.append('circle')
      .attr('r', d => d.radius)
      .attr('fill', d => d.type === 'center' ? '#C74634' : platformColor(d.PLATFORM))
      .attr('stroke', d => d.type === 'center' ? GRAPH_CENTER_STROKE : GRAPH_NODE_STROKE)
      .attr('stroke-width', d => d.type === 'center' ? 2.5 : 1.4)
      .attr('opacity', d => d.hopOpacity);

    // Verified badge (✓)
    const isVerified = d => d.IS_VERIFIED === 'Y' || d.IS_VERIFIED === 1 || d.IS_VERIFIED === true;
    node.filter(d => isVerified(d)).append('text')
      .text('✓')
      .attr('dy', d => -d.radius + 4)
      .attr('dx', d => d.radius - 4)
      .attr('text-anchor', 'middle')
      .attr('fill', '#4C825C')
      .attr('font-size', '9px');

    // Handle label
    node.append('text')
      .text(d => (d.HANDLE || '').replace('@', ''))
      .attr('dy', d => d.radius + 13)
      .attr('text-anchor', 'middle')
      .attr('fill', GRAPH_LABEL_COLOR)
      .attr('stroke', GRAPH_LABEL_HALO)
      .attr('stroke-width', d => d.type === 'center' ? 3.5 : 3)
      .attr('stroke-linejoin', 'round')
      .attr('paint-order', 'stroke fill')
      .attr('font-size', d => d.type === 'center' ? '12px' : '9.5px')
      .attr('font-weight', d => d.type === 'center' ? 700 : 600)
      .attr('font-family', '"Oracle Sans", "Oracle Sans VF", sans-serif')
      .attr('pointer-events', 'none');

    // ── Node hover tooltip ────────────────────────────────────────────────
    node
      .on('mouseover', function(event, d) {
        const pc    = platformColor(d.PLATFORM);
        const score = typeof d.INFLUENCE_SCORE === 'number'
          ? d.INFLUENCE_SCORE.toFixed(1)
          : (d.INFLUENCE_SCORE || '-');
        const eng   = typeof d.ENGAGEMENT_RATE === 'number'
          ? (d.ENGAGEMENT_RATE * 100).toFixed(1) + '%'
          : (d.ENGAGEMENT_RATE || '-');
        tip.html(`
          <div style="font-size:11px;min-width:180px;line-height:1.7;color:#161513">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;border-bottom:1px solid rgba(49,45,42,0.12);padding-bottom:6px">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${pc}"></span>
              <strong style="color:#161513">${d.HANDLE || '?'}</strong>
              ${isVerified(d) ? '<span style="color:#4C825C;font-size:10px;font-weight:600">confirmed</span>' : ''}
            </div>
            <div style="display:grid;grid-template-columns:auto auto;gap:2px 12px">
              <span style="color:#6F757E">Channel</span><span style="text-transform:capitalize">${(d.PLATFORM || '-').replace(/_/g, ' ')}</span>
              <span style="color:#6F757E">Type</span><span>${(d.NICHE || '-').replace(/_/g, ' ')}</span>
              <span style="color:#6F757E">City</span><span>${d.CITY || '-'}</span>
              <span style="color:#6F757E">Exposure</span><span>${formatCurrency(d.FOLLOWER_COUNT || 0)}</span>
              <span style="color:#6F757E">Links</span><span style="color:#161513;font-weight:600">${d.linkCount || 0}</span>
              <span style="color:#6F757E">Risk</span><span>${score}</span>
              <span style="color:#6F757E">Risk ratio</span><span>${eng}</span>
              <span style="color:#6F757E">Hop</span><span>${d.type === 'center' ? '0 (center)' : d.hopLevel}</span>
            </div>
            <div style="color:#C74634;font-size:10px;font-weight:600;margin-top:6px;text-align:center">Click to investigate network</div>
          </div>
        `)
        .style('opacity', 1)
        .style('left', (event.pageX + 14) + 'px')
        .style('top',  (event.pageY - 10) + 'px');

        d3.select(this).select('circle:last-of-type')
          .attr('stroke', d.type === 'center' ? GRAPH_CENTER_STROKE : GRAPH_NODE_HOVER_STROKE)
          .attr('stroke-width', d.type === 'center' ? 2.5 : 2);
      })
      .on('mousemove', function(event) {
        tip.style('left', (event.pageX + 14) + 'px').style('top', (event.pageY - 10) + 'px');
      })
      .on('mouseout', function(event, d) {
        tip.style('opacity', 0);
        d3.select(this).select('circle:last-of-type')
          .attr('stroke', d.type === 'center' ? GRAPH_CENTER_STROKE : GRAPH_NODE_STROKE)
          .attr('stroke-width', d.type === 'center' ? 2.5 : 1.4);
      })
      .on('click', function(event, d) {
        event.stopPropagation();
        tip.style('opacity', 0);
        onClickRef.current?.(d);
      });

    // ── Tick ──────────────────────────────────────────────────────────────
    simulation.on('tick', () => {
      // Shorten edge at target end so arrow sits at the node boundary
      link
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => {
          const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          return d.target.x - (dx / dist) * (d.target.radius + 2);
        })
        .attr('y2', d => {
          const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          return d.target.y - (dy / dist) * (d.target.radius + 2);
        });
      linkHit.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
              .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // ── Auto-center & fit graph after simulation settles ────────────────
    simulation.on('end', () => {
      // Compute bounding box of all nodes
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach(d => {
        const r = d.radius + 15; // include label space
        if (d.x - r < minX) minX = d.x - r;
        if (d.y - r < minY) minY = d.y - r;
        if (d.x + r > maxX) maxX = d.x + r;
        if (d.y + r + 15 > maxY) maxY = d.y + r + 15;
      });
      const bw = maxX - minX;
      const bh = maxY - minY;
      if (bw <= 0 || bh <= 0) return;

      const padding = 40;
      const scale = Math.min(
        (width - padding * 2) / bw,
        (height - padding * 2) / bh,
        1.5 // don't zoom in too much
      );
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const tx = width / 2 - cx * scale;
      const ty = height / 2 - cy * scale;

      svg.transition().duration(600).call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      );
    });

    return () => { simulation.stop(); tip.style('opacity', 0); };
  }, [data, depth, width, height]);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <svg ref={svgRef} width={width} height={height}
        style={{ background: GRAPH_CANVAS_BACKGROUND, borderRadius: 4, border: '1px solid var(--color-border)', display: 'block' }} />
      {/* D3-managed tooltip (not React state - avoids re-render conflicts) */}
      <div ref={tooltipRef} style={{
        position: 'fixed', pointerEvents: 'none', opacity: 0,
        background: 'var(--color-surface)', border: '1px solid rgba(49,45,42,0.14)',
        borderRadius: 8, padding: '8px 12px', zIndex: 9999, color: '#161513',
        boxShadow: '0 8px 24px rgba(49,45,42,0.18)', maxWidth: 260,
        transition: 'opacity 0.1s ease',
      }} />
    </div>
  );
}

// ── NodeDetailPanel ──────────────────────────────────────────────────────────
function NodeDetailPanel({ node, network, onExplore, onClose }) {
  if (!node) return null;

  const score = typeof node.INFLUENCE_SCORE === 'number' ? node.INFLUENCE_SCORE.toFixed(1) : (node.INFLUENCE_SCORE || '-');
  const eng   = typeof node.ENGAGEMENT_RATE === 'number'
    ? (node.ENGAGEMENT_RATE * 100).toFixed(1) + '%'
    : (node.ENGAGEMENT_RATE || '-');
  const riskLevel = (node.RISK_LEVEL || 'medium').replace(/_/g, ' ');

  // Count connections by type for this node
  const connTypes = {};
  (network?.edges || []).forEach(e => {
    const isRelated = e.source === node.INFLUENCER_ID || e.target === node.INFLUENCER_ID
      || e.source?.id === node.INFLUENCER_ID || e.target?.id === node.INFLUENCER_ID;
    if (isRelated) {
      connTypes[e.type] = (connTypes[e.type] || 0) + 1;
    }
  });

  return (
    <div className="glass-card p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-md flex items-center justify-center font-bold text-sm"
            style={{ background: platformColor(node.PLATFORM) + '33', border: `2px solid ${platformColor(node.PLATFORM)}`, color: platformColor(node.PLATFORM) }}>
            {(node.HANDLE || '?').slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-sm flex items-center gap-1">
              {node.HANDLE}
              {(node.IS_VERIFIED === 'Y' || node.IS_VERIFIED === 1) && (
                <JetGlyph iconClass="oj-fwk-icon-checkmark" className="tone-pine text-xs" />
              )}
            </p>
            <p className="text-xs text-[var(--color-text-dim)]">{node.DISPLAY_NAME}</p>
          </div>
        </div>
        <JetButton
          label="Close"
          title="Close entity detail"
          iconClass="oj-fwk-icon oj-fwk-icon-cross"
          display="icons"
          chroming="borderless"
          className="oj-button-sm graph-detail-close"
          onAction={onClose}
        />
      </div>

      {/* Channel + entity type */}
      <div className="flex flex-wrap gap-1.5">
        <span className={`platform-badge platform-${(node.PLATFORM || '').toLowerCase()}`}>{(node.PLATFORM || 'unknown').replace(/_/g, ' ')}</span>
        {node.NICHE && <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--color-surface-muted)] border border-[var(--color-border)] capitalize">{node.NICHE.replace(/_/g, ' ')}</span>}
        <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--color-surface-muted)] border border-[var(--color-border)] capitalize">{riskLevel} risk</span>
        {node.CITY && (
          <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--color-surface-muted)] border border-[var(--color-border)] flex items-center gap-1">
            <JetGlyph iconClass="oj-fwk-icon-info" />
            {node.CITY}
          </span>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Exposure', value: formatCurrency(node.FOLLOWER_COUNT || 0), iconClass: 'oj-fwk-icon-tree-document' },
          { label: 'Risk Score', value: score, iconClass: 'oj-fwk-icon-sortrelevancehigh' },
          { label: 'Evidence strength', value: eng, iconClass: 'oj-fwk-icon-view' },
          { label: 'Hop Level', value: node.type === 'center' ? 'Center' : `Hop ${node.hopLevel}`, iconClass: 'oj-fwk-icon-node-expand' },
        ].map(({ label, value, iconClass }) => (
          <div key={label} className="rounded-lg p-2.5 text-center" style={{ background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
            <JetGlyph iconClass={iconClass} className="mx-auto mb-1 text-[var(--color-accent)]" />
            <p className="text-sm font-bold">{value}</p>
            <p className="text-[10px] text-[var(--color-text-dim)]">{label}</p>
          </div>
        ))}
      </div>

      {/* Connection types */}
      {Object.keys(connTypes).length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Connection Types</p>
          <div className="space-y-1">
            {Object.entries(connTypes).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: CONNECTION_COLORS[type] || '#6F757E' }} />
                  <span className="capitalize">{type.replace(/_/g, ' ')}</span>
                </span>
                <span className="text-[var(--color-text-dim)]">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Case relationships (from network.brands compatibility payload) */}
      {node.type === 'center' && network?.brands?.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Case Relationships</p>
          <div className="space-y-1">
            {network.brands.slice(0, 5).map(b => (
              <div key={b.LINK_ID} className="flex items-center justify-between text-xs py-1 border-b border-[var(--color-border)]">
                <span className="font-medium truncate">{b.BRAND_NAME}</span>
                <span className="text-[var(--color-text-dim)] text-[10px] ml-2">{b.RELATIONSHIP_TYPE}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Explore button */}
      <JetButton
        label="Investigate Financial Crime Network"
        iconClass="oj-fwk-icon oj-fwk-icon-node-expand"
        chroming="callToAction"
        className="graph-detail-explore"
        onAction={() => onExplore(node.INFLUENCER_ID)}
      />
    </div>
  );
}

// ── Query Explorer colors ────────────────────────────────────────────────────
const QUERY_COLORS = {
  fraud_ring_reach:       { color: '#C74634', iconClass: 'oj-fwk-icon-folderhierarchy' },
  shared_device_cluster:  { color: '#AA643B', iconClass: 'oj-fwk-icon-users' },
  mule_flow:              { color: '#4F7D7B', iconClass: 'oj-fwk-icon-arrowtail-e' },
  cross_channel_takeover: { color: '#437C94', iconClass: 'oj-fwk-icon-sortrelevancehigh' },
  risk_hubs:              { color: '#4C825C', iconClass: 'oj-fwk-icon-grid' },
};

// ── GraphQueryExplorer ───────────────────────────────────────────────────────
function GraphQueryExplorer() {
  const [queries, setQueries]         = useState([]);
  const [activeQuery, setActiveQuery] = useState(null);
  const [params, setParams]           = useState({});
  const [result, setResult]           = useState(null);
  const [running, setRunning]         = useState(false);
  const [error, setError]             = useState(null);
  const [showSql, setShowSql]         = useState(false);

  // Load available queries on mount
  useEffect(() => {
    api.graph.exampleQueries().then(qs => {
      setQueries(qs);
    }).catch(() => {});
  }, []);

  // Set default params when selecting a query
  const selectQuery = useCallback((q) => {
    setActiveQuery(q);
    setResult(null);
    setError(null);
    setShowSql(false);
    const defaults = {};
    (q.params || []).forEach(p => { defaults[p.key] = p.default || ''; });
    setParams(defaults);
  }, []);

  const runQuery = useCallback(async () => {
    if (!activeQuery) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.graph.runExample(activeQuery.id, params);
      setResult(res);
      setShowSql(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }, [activeQuery, params]);

  const resetExplorer = useCallback(() => {
    setActiveQuery(null);
    setResult(null);
    setError(null);
    setShowSql(false);
    setParams({});
  }, []);

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2">
            <JetGlyph iconClass="oj-fwk-icon-tree-document" className="graph-query-heading-glyph text-[var(--color-accent)]" />
            Investigation Query Explorer
          </h3>
          <p className="text-xs text-[var(--color-text-dim)] mt-0.5">
            Run real SQL/PGQ queries against the <span className="tone-sienna font-mono">FRAUD_NETWORK</span> property graph
          </p>
        </div>
        {activeQuery && (
          <JetButton
            label="Back to queries"
            iconClass="oj-fwk-icon oj-fwk-icon-back"
            chroming="outlined"
            className="oj-button-sm graph-query-back-button"
            onAction={resetExplorer}
          />
        )}
      </div>

      {/* Query selector cards */}
      {!activeQuery && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {queries.map(q => {
            const qStyle = QUERY_COLORS[q.id] || { color: '#C74634', iconClass: 'oj-fwk-icon-folderhierarchy' };
            return (
              <JetActionCard key={q.id}
                ariaLabel={`Open ${q.name}`}
                onAction={() => selectQuery(q)}
                className="graph-query-card text-left p-3.5 rounded-xl border border-[var(--color-border)]/50 transition-all group"
                style={{ background: `${qStyle.color}08`, borderColor: `${qStyle.color}30` }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${qStyle.color}22` }}>
                    <JetGlyph iconClass={qStyle.iconClass} className="graph-query-card__glyph" style={{ color: qStyle.color }} />
                  </div>
                  <span className="text-xs font-bold leading-tight group-hover:text-[var(--color-accent)] transition-colors">
                    {q.name}
                  </span>
                </div>
                <p className="text-[10px] text-[var(--color-text-dim)] leading-relaxed">{q.description}</p>
              </JetActionCard>
            );
          })}
        </div>
      )}

      {/* Active query: params + run */}
      {activeQuery && (
        <div className="space-y-4">
          {/* Query header */}
          <div className="flex items-start gap-3 p-3 rounded-xl"
            style={{ background: `${(QUERY_COLORS[activeQuery.id] || {}).color || '#C74634'}10`, border: `1px solid ${(QUERY_COLORS[activeQuery.id] || {}).color || '#C74634'}30` }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: `${(QUERY_COLORS[activeQuery.id] || {}).color || '#C74634'}22` }}>
              <JetGlyph
                iconClass={(QUERY_COLORS[activeQuery.id] || {}).iconClass || 'oj-fwk-icon-folderhierarchy'}
                className="graph-query-active-glyph"
                style={{ color: (QUERY_COLORS[activeQuery.id] || {}).color || '#C74634' }}
              />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-bold">{activeQuery.name}</h4>
              <p className="text-xs text-[var(--color-text-dim)] mt-0.5">{activeQuery.description}</p>
            </div>
          </div>

          {/* Parameters */}
          <div className="flex flex-wrap items-end gap-3">
            {(activeQuery.params || []).map(p => (
              <div key={p.key} className="flex-1 min-w-[180px]">
                <label className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider block mb-1">
                  {p.label}
                </label>
                <JetInputText
                  value={params[p.key] || ''}
                  ariaLabel={p.label}
                  placeholder={String(p.default)}
                  className="graph-query-param-input"
                  onValueChange={value => setParams(prev => ({ ...prev, [p.key]: value }))}
                />
              </div>
            ))}
            <JetButton
              label={running ? 'Running...' : 'Run Query'}
              iconClass={running ? 'oj-fwk-icon oj-fwk-icon-load' : 'oj-fwk-icon oj-fwk-icon-next'}
              chroming="callToAction"
              disabled={running}
              onAction={runQuery}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg text-sm tone-red" style={{ background: 'rgba(199,70,52,0.1)', border: '1px solid rgba(199,70,52,0.3)' }}>
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-3">
              {/* Stats bar */}
              <div className="flex items-center gap-4 text-xs text-[var(--color-text-dim)]">
                <span className="flex items-center gap-1">
                  <JetGlyph iconClass="oj-fwk-icon-grid" className="graph-query-stat-glyph text-[var(--color-accent)]" />
                  <strong className="text-[var(--color-text)]">{result.rowCount}</strong> rows returned
                </span>
                <span className="flex items-center gap-1">
                  <JetGlyph iconClass="oj-fwk-icon-clock" className="graph-query-stat-glyph tone-pine" />
                  <strong className="text-[var(--color-text)]">{result.elapsed}</strong>ms
                </span>
                <JetButton
                  label={`${showSql ? 'Hide' : 'Show'} SQL`}
                  iconClass={`oj-fwk-icon ${showSql ? 'oj-fwk-icon-view-hide' : 'oj-fwk-icon-view'}`}
                  chroming="outlined"
                  className="oj-button-sm graph-query-show-sql"
                  onAction={() => setShowSql(!showSql)}
                />
              </div>

              {/* SQL display */}
              {showSql && result.sql && (
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--color-accent)] uppercase tracking-wider" style={{ background: 'var(--color-surface)' }}>
                    Executed SQL/PGQ
                  </div>
                  <pre className="p-3 text-[11px] font-mono text-[var(--color-text)] overflow-x-auto leading-relaxed whitespace-pre">{result.sql}</pre>
                </div>
              )}

              {/* Results table */}
              {result.rows?.length > 0 && (
                <div className="rounded-lg overflow-hidden border border-[var(--color-border)]">
                  <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--color-surface)]">
                          {Object.keys(result.rows[0]).map(col => (
                            <th key={col} className="px-3 py-2 text-left text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider whitespace-nowrap border-b border-[var(--color-border)]">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((row, i) => (
                          <tr key={i} className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-surface)]/50 transition-colors">
                            {Object.entries(row).map(([col, val], j) => (
                              <td key={j} className="px-3 py-2 whitespace-nowrap font-mono">
                                {typeof val === 'number'
                                  ? (Number.isInteger(val) ? val.toLocaleString() : val.toFixed(3))
                                  : (val ?? '-')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result.rows?.length === 0 && (
                <div className="text-center py-6 text-sm text-[var(--color-text-dim)]">
                  No results found. Try different parameters.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function InfluencerGraph() {
  const { currentUser } = useUser();
  const [selectedId,  setSelectedId]  = useState(null);
  const [depth,       setDepth]       = useState(5);
  const [search,      setSearch]      = useState('');
  const [clickedNode, setClickedNode] = useState(null);

  // Track which user the current fraud entity list belongs to
  const [listUser, setListUser] = useState(null);

  // Fraud entity list - refetch when user or search changes
  const { data: rawInfluencers, loading } = useData(
    () => api.graph.influencers({ limit: 50, ...(search ? { search } : {}) }),
    [search, currentUser?.USERNAME]
  );

  // When the entity list loads, stamp which user it belongs to
  useEffect(() => {
    if (rawInfluencers?.length) {
      setListUser(currentUser?.USERNAME);
    }
  }, [rawInfluencers]);

  // When user changes, reset selection immediately
  useEffect(() => {
    setSelectedId(null);
    setClickedNode(null);
  }, [currentUser?.USERNAME]);

  // Auto-select first entity only when the list is fresh for the current user
  useEffect(() => {
    if (rawInfluencers?.length && !selectedId && listUser === currentUser?.USERNAME) {
      setSelectedId(rawInfluencers[0].INFLUENCER_ID);
    }
  }, [rawInfluencers, selectedId, listUser, currentUser?.USERNAME]);

  // Network for selected fraud entity
  const { data: network, loading: loadingNet, refetch: refetchNet, setData: setNetwork } = useData(
    () => selectedId ? api.graph.network(selectedId, depth) : Promise.resolve(null),
    [selectedId, depth, currentUser?.USERNAME],
    { autoFetch: false }
  );

  // Refetch network only when we have a valid selection
  useEffect(() => {
    if (selectedId) {
      refetchNet();
    } else {
      setNetwork(null);
    }
  }, [selectedId, depth]);

  // Close detail panel when a new entity is selected from the list
  const handleSelectId = useCallback((id) => {
    setSelectedId(id);
    setClickedNode(null);
  }, []);

  // Node click from graph
  const handleNodeClick = useCallback((d) => {
    setClickedNode(d);
  }, []);

  const handleExplore = useCallback((id) => {
    setSelectedId(id);
    setClickedNode(null);
  }, []);

  // Stats
  const stats = network?.stats || {};

  return (
    <div className="space-y-6 fade-in">

      {/* Oracle panel */}
      <RegisterOraclePanel title="Financial Crime Network">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">What's Happening</p>
            <p className="text-[var(--color-text)] leading-relaxed">
              Oracle's <span className="tone-sienna font-mono">Property Graph</span> engine (SQL/PGQ - ISO standard) treats accounts,
              devices, IP addresses, payees, merchants, and cases as a first-class graph. Edges encode investigation evidence like
              <code className="text-xs tone-plum mx-1">shared_device · shared_ip · uses_payee · cashout_at</code>
              with numeric strength, event count, and exposure values.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FeatureBadge label="SQL/PGQ (ISO Property Graph)" color="yellow" />
            <FeatureBadge label="GRAPH_TABLE()" color="yellow" />
            <FeatureBadge label="N-Hop Traversal" color="orange" />
            <FeatureBadge label="Vertex / Edge Tables" color="purple" />
            <FeatureBadge label="Financial Crime Risk Scoring" color="pink" />
            <FeatureBadge label="Case Evidence" color="blue" />
            <FeatureBadge label="No External Graph DB" color="green" />
          </div>
          <SqlBlock code={`-- ISO SQL/PGQ: fraud entities within 3 hops
SELECT reached.entity_key, reached.entity_type,
       reached.risk_score, reached.total_amount
FROM GRAPH_TABLE(
  fraud_network
  MATCH
    (seed IS entity)
    -[e IS related_to]->{1,3}
    (reached IS entity)
  WHERE seed.entity_key = :entity_key
  COLUMNS (
    reached.entity_key,
    reached.entity_type,
    reached.risk_score,
    reached.total_amount
  )
)
ORDER BY risk_score DESC
FETCH FIRST 25 ROWS ONLY;`} />
          <SqlBlock code={`-- Create the property graph over relational tables
CREATE PROPERTY GRAPH fraud_network
  VERTEX TABLES (
    fraud_entities KEY (entity_id) LABEL entity
      PROPERTIES (entity_id, entity_key, display_name,
        entity_type, risk_score, risk_level, channel,
        total_amount, event_count, is_confirmed_fraud),
    fraud_cases KEY (case_id) LABEL fraud_case
      PROPERTIES (case_id, case_ref, case_type,
        status, risk_score, loss_amount)
  )
  EDGE TABLES (
    fraud_relationships KEY (relationship_id)
      SOURCE KEY (from_entity)
        REFERENCES fraud_entities (entity_id)
      DESTINATION KEY (to_entity)
        REFERENCES fraud_entities (entity_id)
      LABEL related_to
      PROPERTIES (relationship_type, strength,
        event_count, total_amount),
    fraud_case_entities KEY (case_entity_id)
      SOURCE KEY (case_id)
        REFERENCES fraud_cases (case_id)
      DESTINATION KEY (entity_id)
        REFERENCES fraud_entities (entity_id)
      LABEL contains_entity
      PROPERTIES (role, evidence_score)
  );`} />
          <div className="grid grid-cols-2 gap-1.5 mt-2">
            <DiagramBox label="fraud_entities" sub="Accounts, devices, payees" color="#C74634" />
            <DiagramBox label="fraud_relationships" sub="Evidence edge table" color="#AA643B" />
            <DiagramBox label="fraud_cases" sub="Investigation vertices" color="#A36472" />
            <DiagramBox label="fraud_case_entities" sub="Case membership edges" color="#4C825C" />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Edge Types</p>
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(CONNECTION_COLORS).map(([type, color]) => (
                <div key={type} className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: color, flexShrink: 0 }} />
                  <span className="capitalize text-[var(--color-text-dim)]">{type.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Database Session Context</p>
            <p className="text-[var(--color-text)] leading-relaxed">
              The app sets the Oracle security context before each graph query, so the graph workflow runs through the same database session model used by the rest of the demo.
              {currentUser?.ROLE === 'fulfillment_mgr' ? (
                <span className="tone-sienna"> Current role: <strong>{currentUser.ROLE}</strong>, region <strong>{currentUser.REGION}</strong>.</span>
              ) : currentUser?.ROLE === 'admin' || currentUser?.ROLE === 'analyst' ? (
                <span className="tone-pine"> Current role: <strong>{currentUser.ROLE}</strong>.</span>
              ) : (
                <span className="tone-ocean"> Current role context is active.</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FeatureBadge label="Session Context" color="green" />
            <FeatureBadge label="executeAsUser()" color="green" />
            <FeatureBadge label="Fraud Graph API" color="blue" />
          </div>
          <SqlBlock code={`-- API connection context before graph queries
BEGIN
  sc_security_ctx.set_user_context(:username);
END;
/

SELECT entity_key, entity_type, risk_score
FROM GRAPH_TABLE (
  fraud_network
  MATCH (seed IS entity)-[e IS related_to]->(dst IS entity)
  WHERE seed.entity_key = :entity_key
  COLUMNS (
    dst.entity_key,
    dst.entity_type,
    dst.risk_score
  )
);`} />
        </div>
      </RegisterOraclePanel>

      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <JetGlyph iconClass="oj-fwk-icon-node-expand" className="text-[var(--color-accent)]" /> Financial Crime Network
        </h2>
        <p className="text-sm text-[var(--color-text-dim)] mt-1">
          Investigate connected accounts, devices, IPs, payees, merchants, and cases behind the fraud-led risk signal.
        </p>
      </div>

      <SceneStoryPanel scene="graph" />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">

        {/* ── Left column: list + controls ─────────────────────────────── */}
        <div className="space-y-3">

          {/* Search */}
          <div className="relative graph-search-field">
            <JetGlyph iconClass="oj-fwk-icon-magnifier" className="graph-search-field__glyph text-[var(--color-text-dim)]" />
            <JetInputText
              value={search}
              onValueChange={setSearch}
              ariaLabel="Search fraud entities"
              placeholder="Search account, device, payee, case..."
              className="graph-search-input"
            />
            {search && (
              <JetButton
                label="Clear search"
                title="Clear search"
                iconClass="oj-fwk-icon oj-fwk-icon-cross"
                display="icons"
                chroming="borderless"
                className="oj-button-sm graph-search-clear"
                onAction={() => setSearch('')}
              />
            )}
          </div>

          {/* Depth toggle */}
          <div className="glass-card p-3">
            <p className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Investigation Depth</p>
            <div className="flex gap-1" role="tablist" aria-label="Investigation depth">
              {[1, 2, 3, 4, 5].map(d => (
                <JetButton
                  key={d}
                  label={`${d}`}
                  title={`${d} relationship layer${d > 1 ? 's' : ''}`}
                  ariaLabel={`Show ${d} relationship layer${d > 1 ? 's' : ''}`}
                  chroming={depth === d ? 'callToAction' : 'outlined'}
                  className="oj-button-sm graph-depth-button"
                  role="tab"
                  ariaSelected={depth === d}
                  onAction={() => setDepth(d)}
                />
              ))}
            </div>
          </div>

          {/* Fraud entity list */}
          <div className="glass-card p-3 max-h-[480px] overflow-y-auto">
            <h3 className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2 flex items-center gap-1">
              <JetGlyph iconClass="oj-fwk-icon-users" /> Connected Risk Entities {rawInfluencers?.length ? `(${rawInfluencers.length})` : ''}
            </h3>
            {loading ? (
              <p className="text-xs text-[var(--color-text-dim)] py-4 text-center">Loading…</p>
            ) : (rawInfluencers || []).map(inf => (
              <JetActionCard
                key={inf.INFLUENCER_ID}
                ariaLabel={`Investigate ${inf.HANDLE}`}
                onAction={() => handleSelectId(inf.INFLUENCER_ID)}
                className={`graph-entity-card w-full text-left p-2 text-xs mb-1 ${selectedId === inf.INFLUENCER_ID ? 'graph-entity-card--active' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium truncate">{inf.HANDLE}</span>
                  <span className={`platform-badge platform-${(inf.PLATFORM || '').toLowerCase()} !text-[9px] !py-0`}>{(inf.PLATFORM || 'unknown').replace(/_/g, ' ')}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[var(--color-text-dim)]">
                  <span>{formatCurrency(inf.FOLLOWER_COUNT)} exposure</span>
                  <span className="text-[var(--color-text)] font-semibold flex items-center gap-1">
                    <JetGlyph iconClass="oj-fwk-icon-sortrelevancehigh" />
                    {inf.INFLUENCE_SCORE}
                  </span>
                  {inf.CONNECTION_COUNT > 0 && <span>{inf.CONNECTION_COUNT} evidence links</span>}
                </div>
              </JetActionCard>
            ))}
          </div>

          {/* Node detail panel */}
          {clickedNode && (
            <NodeDetailPanel
              node={clickedNode}
              network={network}
              onExplore={handleExplore}
              onClose={() => setClickedNode(null)}
            />
          )}
        </div>

        {/* ── Right column: graph + stats ──────────────────────────────── */}
        <div className="lg:col-span-3 space-y-3">

          {/* Selected fraud entity metrics + stats bar */}
          {network && (
            <div className="glass-card p-3">
              {network.center && (
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-md flex items-center justify-center font-bold text-sm flex-shrink-0"
                    style={{ background: '#C74634', border: '2px solid #C74634', color: '#FFFFFF' }}>
                    {(network.center.HANDLE || '?').replace('@','').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm flex items-center gap-1.5">
                      {network.center.HANDLE}
                      {(network.center.IS_VERIFIED === 'Y' || network.center.IS_VERIFIED === 1) && (
                        <JetGlyph iconClass="oj-fwk-icon-checkmark" className="tone-pine text-xs" />
                      )}
                      <span className={`platform-badge platform-${(network.center.PLATFORM || '').toLowerCase()} !text-[9px] !py-0 ml-1`}>{(network.center.PLATFORM || 'unknown').replace(/_/g, ' ')}</span>
                      {network.center.NICHE && <span className="text-[10px] text-[var(--color-text-dim)] font-normal ml-1 capitalize">{network.center.NICHE.replace(/_/g, ' ')}</span>}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-dim)]">Primary Investigation Target</p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-7 gap-2">
                {[
                  { label: 'Exposure',    value: formatCurrency(network.center?.FOLLOWER_COUNT || 0) },
                  { label: 'Risk',        value: network.center?.INFLUENCE_SCORE || 0 },
                  { label: 'Evidence strength',  value: network.center?.ENGAGEMENT_RATE ? `${(network.center.ENGAGEMENT_RATE * 100).toFixed(1)}%` : '-' },
                  { label: 'Connections', value: network.center?.TOTAL_CONNECTIONS || 0 },
                  { label: 'Nodes',       value: stats.nodeCount  || network.nodes?.length  || 0 },
                  { label: 'Edges',       value: stats.edgeCount  || network.edges?.length  || 0 },
                  { label: 'Depth',       value: `${stats.depth || depth} hop${(stats.depth || depth) > 1 ? 's' : ''}` },
                ].map(s => (
                  <div key={s.label} className="rounded-lg p-2 text-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <p className="text-sm font-bold">{s.value}</p>
                    <p className="text-[9px] text-[var(--color-text-dim)]">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Graph or placeholder */}
          {loadingNet ? (
            <div className="glass-card p-14 text-center text-[var(--color-text-dim)]">
              <JetGlyph iconClass="oj-fwk-icon-node-expand" className="graph-empty-glyph mx-auto mb-3 opacity-40" />
              Loading network…
            </div>
          ) : network ? (
            <ForceGraph
              data={network}
              depth={depth}
              height={520}
              onNodeClick={handleNodeClick}
            />
          ) : (
            <div className="glass-card p-14 text-center text-[var(--color-text-dim)]">
              <JetGlyph iconClass="oj-fwk-icon-node-expand" className="graph-empty-glyph mx-auto mb-3 opacity-40" />
              Select a fraud entity to investigate its network
            </div>
          )}

          {/* Edge type legend */}
          {network && (
            <div className="glass-card p-3 flex flex-wrap gap-x-4 gap-y-1.5">
              <p className="w-full text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-1">Edge Types</p>
              {Object.entries(CONNECTION_COLORS).map(([type, color]) => (
                <div key={type} className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-dim)]">
                  <span className="w-2.5 h-1.5 rounded-sm inline-block" style={{ background: color }} />
                  <span className="capitalize">{type.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          )}

          {/* Case relationships */}
          {network?.brands?.length > 0 && !clickedNode && (
            <div className="glass-card p-4">
              <h4 className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
                Case Relationships - {network.center?.HANDLE}
              </h4>
              <div className="flex flex-wrap gap-2">
                {network.brands.map(b => (
                  <div key={b.LINK_ID} className="px-2.5 py-1.5 rounded-lg text-xs bg-[var(--color-surface)] border border-[var(--color-border)]">
                    <span className="font-medium">{b.BRAND_NAME}</span>
                    <span className="text-[var(--color-text-dim)] ml-1.5">({b.RELATIONSHIP_TYPE})</span>
                    {b.REVENUE_ATTRIBUTED > 0 && (
                      <span className="tone-pine ml-1.5 text-[10px]">
                        {formatCurrency(b.REVENUE_ATTRIBUTED)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Investigation Query Explorer ── */}
      <GraphQueryExplorer />
    </div>
  );
}
