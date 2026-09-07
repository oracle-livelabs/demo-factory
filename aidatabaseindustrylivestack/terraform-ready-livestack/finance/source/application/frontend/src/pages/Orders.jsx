import { useState, useCallback, useEffect } from 'react';
import { ShoppingCart, Filter, ChevronRight, ChevronDown, Loader2, Check, MapPin, Package, Truck, Navigation, Shield, Eye } from 'lucide-react';
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../utils/api';
import { useData } from '../hooks/useData';
import { formatCurrency, formatDate, formatNumber } from '../utils/format';
import { SceneStoryPanel } from '../components/FinanceStory';
import { FeatureBadge, SqlBlock, DiagramBox } from '../components/OracleInfoPanel';
import { JetButton, JetSelectSingle } from '../components/JetControls';
import { RegisterOraclePanel } from '../context/OraclePanelContext';
import { useUser } from '../context/UserContext';

const CARRIER_COLORS = { SecureCourier: '#796087', BranchLink: '#AA643B', WireTrack: '#4F7D7B', 'ClientRoute': '#C74634' };

const SHIP_STATUS_STEPS = [
  { key: 'preparing', label: 'Intake', icon: Package },
  { key: 'picked', label: 'Reviewed', icon: Package },
  { key: 'packed', label: 'Approved', icon: Package },
  { key: 'routed', label: 'Routed', icon: Truck },
  { key: 'in_transit', label: 'In Review', icon: Truck },
  { key: 'out_for_delivery', label: 'Final Review', icon: Navigation },
  { key: 'completed', label: 'Completed', icon: Check },
];

const ORDER_DETAIL_TABS = [
  { id: 'relational', label: 'Operational View' },
  { id: 'json', label: 'API Document View' },
  { id: 'route', label: 'Transaction Routing' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'processing', label: 'Processing' },
  { value: 'routed', label: 'Routed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/* ─── Auto-fit map bounds ──────────────────────────────────────────────── */
function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.length >= 2) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 });
    }
  }, [map, bounds]);
  return null;
}

/* ─── Curved polyline (arc) between two points ─────────────────────────── */
function curvedPositions(from, to, numPoints = 30) {
  const points = [];
  const midLat = (from[0] + to[0]) / 2;
  const midLng = (from[1] + to[1]) / 2;
  // offset perpendicular to the line for the arc
  const dx = to[1] - from[1];
  const dy = to[0] - from[0];
  const dist = Math.sqrt(dx * dx + dy * dy);
  const offset = dist * 0.15;
  const ctrlLat = midLat + (dx / dist) * offset;
  const ctrlLng = midLng - (dy / dist) * offset;

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const lat = (1 - t) * (1 - t) * from[0] + 2 * (1 - t) * t * ctrlLat + t * t * to[0];
    const lng = (1 - t) * (1 - t) * from[1] + 2 * (1 - t) * t * ctrlLng + t * t * to[1];
    points.push([lat, lng]);
  }
  return points;
}

const STATUS_COLORS = {
  pending: 'surface-sienna-soft text-[var(--color-text)]',
  confirmed: 'surface-ocean-soft text-[var(--color-text)]',
  processing: 'surface-plum-soft text-[var(--color-text)]',
  routed: 'surface-teal-soft text-[var(--color-text)]',
  completed: 'surface-pine-soft text-[var(--color-text)]',
  cancelled: 'surface-red-soft text-[var(--color-text)]',
  returned: 'surface-bark-soft text-[var(--color-text)]',
};

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatDistanceKm(value) {
  const numberValue = asNumber(value);
  if (numberValue === null) return '-';
  return `${numberValue.toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
}

function formatScore(value) {
  const numberValue = asNumber(value);
  if (numberValue === null) return '-';
  return numberValue.toFixed(1);
}

function formatCapacityCoverage(center) {
  const available = asNumber(center?.AVAILABLE_UNITS);
  const requested = asNumber(center?.REQUESTED_UNITS);
  if (available === null || requested === null || requested === 0) return '-';
  const percent = Math.min(100, Math.round((available / requested) * 100));
  return `${percent}% (${formatNumber(Math.round(available))}/${formatNumber(Math.round(requested))})`;
}

function formatServiceCoverage(center) {
  const available = asNumber(center?.PRODUCTS_AVAILABLE);
  const needed = asNumber(center?.PRODUCTS_NEEDED);
  if (available === null || needed === null || needed === 0) return '-';
  return `${available}/${needed} ${center?.COVERAGE_STATUS || 'partial'}`;
}

function centerSummary(center) {
  if (!center) return '-';
  const location = [center.CITY, center.STATE_PROVINCE].filter(Boolean).join(', ');
  return location || center.CENTER_TYPE || '-';
}

function RoutingRecommendationPanel({ recommendation }) {
  if (!recommendation) return null;

  const current = recommendation.currentCenter;
  const recommended = recommendation.recommendedCenter;
  const deltaKm = asNumber(recommendation.distanceDifferenceKm);
  const isCurrentBest = Boolean(recommendation.isCurrentBest);
  const hasRecommendation = Boolean(recommended);
  const statusColor = recommendation.error || !hasRecommendation ? '#C74634' : isCurrentBest ? '#4C825C' : '#AA643B';
  const statusLabel = recommendation.error || !hasRecommendation
    ? 'Recommendation unavailable'
    : isCurrentBest ? 'Current routing confirmed' : 'Alternative center recommended';
  const deltaLabel = deltaKm === null
    ? '-'
    : deltaKm > 0
      ? `${formatDistanceKm(deltaKm)} closer`
      : deltaKm < 0
        ? `${formatDistanceKm(Math.abs(deltaKm))} farther`
        : 'Same distance';

  return (
    <div className="rounded-lg p-3 space-y-3" style={{ background: 'rgba(67,124,148,0.06)', border: '1px solid rgba(67,124,148,0.22)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded border font-mono" style={{ background: `${statusColor}12`, borderColor: `${statusColor}40`, color: 'var(--color-text)' }}>
            OPTIMAL_FULFILLMENT
          </span>
          <span className="text-xs font-semibold" style={{ color: statusColor }}>
            {statusLabel}
          </span>
        </div>
        {recommendation.error && (
          <span className="text-[10px] tone-red">Function call failed</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {[
          { label: 'Current assigned center', center: current, accent: '#437C94' },
          { label: 'Recommended center', center: recommended, accent: statusColor },
        ].map(({ label, center, accent }) => (
          <div key={label} className="rounded-lg p-2" style={{ background: 'var(--color-surface)', border: `1px solid ${accent}26` }}>
            <p className="text-[10px] uppercase text-[var(--color-text-dim)]">{label}</p>
            <p className="text-sm font-semibold text-[var(--color-text)] truncate">{center?.CENTER_NAME || '-'}</p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--color-text-dim)]">
              <span>{centerSummary(center)}</span>
              <span>{formatDistanceKm(center?.DISTANCE_KM)}</span>
              {center?.CENTER_TYPE && <span>{center.CENTER_TYPE}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {[
          { label: 'Distance difference', value: deltaLabel, color: '#4C825C' },
          { label: 'Capacity coverage', value: formatCapacityCoverage(recommended), color: '#437C94' },
          { label: 'Service coverage', value: formatServiceCoverage(recommended), color: '#AA643B' },
          { label: 'Reason score', value: formatScore(recommended?.OPTIMIZATION_SCORE), color: '#796087' },
        ].map((metric) => (
          <div key={metric.label} className="rounded-lg p-2" style={{ background: `${metric.color}08`, border: `1px solid ${metric.color}25` }}>
            <p className="text-[10px] text-[var(--color-text-dim)] uppercase">{metric.label}</p>
            <p className="text-sm font-bold" style={{ color: metric.color }}>{metric.value}</p>
          </div>
        ))}
      </div>

      {recommended?.RECOMMENDATION_REASON && (
        <p className="text-xs text-[var(--color-text-dim)] leading-relaxed">
          <span className="font-semibold text-[var(--color-text)]">Reason:</span> {recommended.RECOMMENDATION_REASON}
        </p>
      )}
    </div>
  );
}

/* ─── Order Duality Panel ─────────────────────────────────────────────── */
function OrderDualityPanel({ orderId, onClose }) {
  const [view, setView] = useState('relational'); // 'relational' | 'json' | 'route'
  const { data: detail, loading: loadingDetail } = useData(() => api.orders.detail(orderId), [orderId]);
  const { data: duality, loading: loadingDuality, error: dualityError } = useData(() => api.orders.duality(orderId), [orderId]);

  const [copied, setCopied] = useState(false);
  const copyJson = useCallback(() => {
    if (duality?.document) {
      navigator.clipboard.writeText(JSON.stringify(duality.document, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [duality]);

  const order = detail?.order;
  const items = detail?.items || [];
  const shipment = detail?.shipment;
  const route = detail?.route;
  const routeGeometry = detail?.routeGeometry;
  const routingRecommendation = detail?.routingRecommendation;
  const [showDrivingRoute, setShowDrivingRoute] = useState(true);

  return (
    <tr>
      <td colSpan={9} className="p-0">
        <div className="mx-4 mb-3 orders-detail-panel">

          {/* Tab bar */}
          <div className="orders-detail-tabbar">
            <div className="orders-detail-tabset">
              {ORDER_DETAIL_TABS.map(tab => (
                <JetButton
                  key={tab.id}
                  label={tab.label}
                  chroming={view === tab.id ? 'callToAction' : 'outlined'}
                  className="orders-detail-tab"
                  onAction={() => setView(tab.id)}
                />
              ))}
              <span className="text-[10px] text-[var(--color-text-dim)] ml-3 hidden sm:inline">
                Same governed case data - three views
              </span>
            </div>
            <JetButton
              label="Close"
              title="Close order detail"
              iconClass="oj-fwk-icon-cross"
              chroming="borderless"
              display="icons"
              onAction={onClose}
            />
          </div>

          {/* Relational view */}
          {view === 'relational' && (
            <div className="p-4 space-y-3">
              {loadingDetail ? (
                <div className="flex items-center gap-2 text-sm text-[var(--color-text-dim)] py-4 justify-center">
                  <Loader2 size={14} className="animate-spin" /> Loading transaction details…
                </div>
              ) : !order ? (
                <p className="text-sm text-[var(--color-text-dim)] text-center py-4">Transaction not found</p>
              ) : (
                <>
                  <div className="flex items-center gap-4 text-xs text-[var(--color-text-dim)]">
                    <span className="text-[10px] px-2 py-0.5 rounded border" style={{ background: 'rgba(67,124,148,0.1)', borderColor: 'rgba(67,124,148,0.3)', color: 'var(--color-text)' }}>
                      Operational case record
                    </span>
                    <span>{items.length} line items</span>
                  </div>

                  {/* Order summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { label: 'Client', value: `${order.FIRST_NAME} ${order.LAST_NAME}` },
                      { label: 'Location', value: `${order.CITY}, ${order.STATE_PROVINCE}` },
                      { label: 'Total', value: formatCurrency(order.ORDER_TOTAL) },
                      { label: 'Processing Fee', value: formatCurrency(order.SHIPPING_COST) },
                    ].map(s => (
                      <div key={s.label} className="rounded-lg p-2" style={{ background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
                        <p className="text-[10px] text-[var(--color-text-dim)] uppercase">{s.label}</p>
                        <p className="text-sm font-medium">{s.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Services table */}
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider border-b border-[var(--color-border)]">
                        <th className="text-left py-1.5 px-2">Item #</th>
                        <th className="text-left py-1.5 px-2">Financial Product</th>
                        <th className="text-left py-1.5 px-2">Institution</th>
                        <th className="text-left py-1.5 px-2">Category</th>
                        <th className="text-right py-1.5 px-2">Transaction Units</th>
                        <th className="text-right py-1.5 px-2">Service Cost</th>
                        <th className="text-right py-1.5 px-2">Service Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => (
                        <tr key={item.ITEM_ID} className="border-b border-[var(--color-border)]/20">
                          <td className="py-1.5 px-2 font-mono">{item.ITEM_ID}</td>
                          <td className="py-1.5 px-2 font-medium">{item.PRODUCT_NAME}</td>
                          <td className="py-1.5 px-2 text-[var(--color-text-dim)]">{item.BRAND_NAME}</td>
                          <td className="py-1.5 px-2 text-[var(--color-text-dim)]">{item.CATEGORY}</td>
                          <td className="py-1.5 px-2 text-right">{item.QUANTITY}</td>
                          <td className="py-1.5 px-2 text-right">{formatCurrency(item.UNIT_PRICE)}</td>
                          <td className="py-1.5 px-2 text-right font-medium">{formatCurrency(item.LINE_TOTAL)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {/* JSON Duality View */}
          {view === 'json' && (
            <div className="p-4 space-y-3">
              {loadingDuality ? (
                <div className="flex items-center gap-2 text-sm text-[var(--color-text-dim)] py-4 justify-center">
                  <Loader2 size={14} className="animate-spin" /> Loading API document view...
                </div>
              ) : dualityError ? (
                <p className="text-sm tone-red text-center py-4">{dualityError}</p>
              ) : duality?.document ? (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 rounded border" style={{ background: 'rgba(170,100,59,0.1)', borderColor: 'rgba(170,100,59,0.3)', color: 'var(--color-text)' }}>
                        API-ready case document
                      </span>
                      <span className="text-[10px] text-[var(--color-text-dim)]">
                        Unified transaction record: <span className="text-[var(--color-text)]">{duality.source}</span>
                      </span>
                    </div>
                    <JetButton
                      label={copied ? 'Copied' : 'Copy'}
                      chroming="outlined"
                      onAction={copyJson}
                    />
                  </div>

                  {/* Info callout */}
                  <div className="rounded-lg p-3 text-xs leading-relaxed" style={{ background: 'rgba(170,100,59,0.06)', border: '1px dashed rgba(170,100,59,0.3)' }}>
                    <span className="text-[var(--color-text)] font-semibold">JSON Relational Duality View</span>
                    <span className="text-[var(--color-text-dim)]"> - This is the exact same transaction data from the relational tab, but accessed through
                    Oracle's <span className="text-[var(--color-text)] font-mono">ORDERS_DV</span> duality view. One table stores normalized rows; the duality view exposes them as a
                    single JSON document with nested items. Read and write through either interface - same ACID transaction.</span>
                  </div>

                  {/* JSON document */}
                  <div className="rounded-lg overflow-hidden" style={{ background: 'var(--color-surface-muted)', border: '1px solid rgba(170,100,59,0.25)' }}>
                    <div className="px-3 py-1.5 flex items-center justify-between" style={{ background: 'rgba(170,100,59,0.08)', borderBottom: '1px solid rgba(170,100,59,0.2)' }}>
                      <span className="text-[10px] font-semibold text-[var(--color-text)] uppercase tracking-wider">JSON Document</span>
                      <span className="text-[10px] text-[var(--color-text-dim)] font-mono">
                        {duality.document.items?.length || 0} nested items
                      </span>
                    </div>
                    <pre className="p-3 text-[11px] font-mono text-[var(--color-text)] overflow-x-auto leading-relaxed max-h-[400px] overflow-y-auto whitespace-pre">
{JSON.stringify(duality.document, null, 2)}
                    </pre>
                  </div>

                  {/* SQL used */}
                  <div className="rounded-lg overflow-hidden" style={{ background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
                    <div className="px-3 py-1.5" style={{ background: 'rgba(67,124,148,0.06)', borderBottom: '1px solid var(--color-border)' }}>
                      <span className="text-[10px] font-semibold text-[var(--color-text)] uppercase tracking-wider">SQL Executed</span>
                    </div>
                    <pre className="p-3 text-[11px] font-mono text-[var(--color-text)] overflow-x-auto whitespace-pre">{duality.sql}</pre>
                  </div>
                </>
              ) : (
                <p className="text-sm text-[var(--color-text-dim)] text-center py-4">No duality data available</p>
              )}
            </div>
          )}

          {/* Transaction Routing Map */}
          {view === 'route' && (
            <div className="p-4 space-y-3">
              {loadingDetail ? (
                <div className="flex items-center gap-2 text-sm text-[var(--color-text-dim)] py-4 justify-center">
                  <Loader2 size={14} className="animate-spin" /> Loading case route data...
                </div>
              ) : !order ? (
                <p className="text-sm text-[var(--color-text-dim)] text-center py-4">Transaction not found</p>
              ) : !order.CENTER_LAT || !order.CUST_LAT ? (
                <div className="text-center py-8">
                  <MapPin size={24} className="mx-auto mb-2 text-[var(--color-text-dim)] opacity-40" />
                  <p className="text-sm text-[var(--color-text-dim)]">No location data available for this transaction</p>
                </div>
              ) : (() => {
                const from = [order.CENTER_LAT, order.CENTER_LON];
                const to = [order.CUST_LAT, order.CUST_LON];
                const arc = curvedPositions(from, to);
                const carrierColor = CARRIER_COLORS[shipment?.CARRIER] || '#4C825C';
                const currentStep = shipment?.SHIP_STATUS || order.ORDER_STATUS || 'preparing';
                const stepIndex = SHIP_STATUS_STEPS.findIndex(s => s.key === currentStep);

                // Distance priority: SDO_GCDR.ELOC_ROUTE (driving) > SDO_GEOM.SDO_DISTANCE (great-circle) > transfer data > Haversine fallback
                const routeDistMiles = route?.distance != null ? Math.round(route.distance * 100) / 100 : null;
                const routeTimeHours = route?.time != null ? Math.round(route.time / 60 * 10) / 10 : null;
                let distanceMiles = routeDistMiles || order.SPATIAL_DISTANCE_MILES || shipment?.DISTANCE_MILES;
                if (!distanceMiles && from[0] && to[0]) {
                  const R = 3958.8; // Earth radius in miles
                  const dLat = (to[0] - from[0]) * Math.PI / 180;
                  const dLon = (to[1] - from[1]) * Math.PI / 180;
                  const a = Math.sin(dLat/2)**2 + Math.cos(from[0]*Math.PI/180) * Math.cos(to[0]*Math.PI/180) * Math.sin(dLon/2)**2;
                  distanceMiles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                }
                const estHours = routeTimeHours || (distanceMiles ? Math.round(distanceMiles / 55 * 10) / 10 : null);
                const isRouteData = routeDistMiles != null;

                return (
                  <>
                    {/* Status badge row */}
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-[10px] px-2 py-0.5 rounded border font-mono" style={{ background: 'rgba(76,130,92,0.1)', borderColor: 'rgba(76,130,92,0.3)', color: 'var(--color-text)' }}>
                        {routeGeometry ? 'SDO_GCDR.ELOC_ROUTE_GEOM' : isRouteData ? 'SDO_GCDR.ELOC_ROUTE' : 'SDO_GEOM.SDO_DISTANCE'}
                      </span>
                      {routeGeometry && (
                        <JetButton
                          label={showDrivingRoute ? 'Driving Route' : 'Arc Only'}
                          iconClass="oj-fwk-icon-arrowtail-e"
                          chroming={showDrivingRoute ? 'callToAction' : 'outlined'}
                          onAction={() => setShowDrivingRoute(prev => !prev)}
                        />
                      )}
                      {shipment && (
                        <span className="flex items-center gap-1 text-[var(--color-text-dim)]">
                          <Truck size={11} style={{ color: carrierColor }} />
                          <span style={{ color: carrierColor }} className="font-semibold">{shipment.CARRIER}</span>
                          {shipment.TRACKING_NUMBER && (
                            <span className="font-mono opacity-60">#{shipment.TRACKING_NUMBER}</span>
                          )}
                        </span>
                      )}
                    </div>

                    <RoutingRecommendationPanel recommendation={routingRecommendation} />

                    {/* Map */}
                    <div className="orders-route-map">
                      <MapContainer
                        center={[(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]}
                        zoom={5}
                        style={{ height: '100%', width: '100%', background: 'var(--color-surface-muted)' }}
                        zoomControl={false}
                        attributionControl={false}
                      >
                        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}" />
                        <FitBounds bounds={routeGeometry && showDrivingRoute ? routeGeometry : [from, to]} />

                        {/* Driving route (solid) - actual road path from SDO_GCDR.ELOC_ROUTE_GEOM */}
                        {routeGeometry && showDrivingRoute && (
                          <Polyline positions={routeGeometry} color={carrierColor} weight={4} opacity={0.9} />
                        )}

                        {/* Bezier arc (dashed) - dimmed when driving route is shown */}
                        <Polyline
                          positions={arc}
                          color={routeGeometry && showDrivingRoute ? '#ffffff' : carrierColor}
                          weight={routeGeometry && showDrivingRoute ? 1.5 : 3}
                          opacity={routeGeometry && showDrivingRoute ? 0.25 : 0.85}
                          dashArray="8 6"
                        />

                        {/* Fulfillment center marker */}
                        <CircleMarker center={from} radius={8} fillColor="#437C94" fillOpacity={0.9} color="#fff" weight={2}>
                          <Tooltip permanent direction="top" offset={[0, -10]}
                            className="route-map-tooltip">
                            <div className="route-map-tooltip__content">
                              <span className="route-map-tooltip__label">Center</span>
                              <span>{order.CENTER_NAME || 'Service Center'}</span>
                            </div>
                          </Tooltip>
                        </CircleMarker>

                        {/* Client marker */}
                        <CircleMarker center={to} radius={8} fillColor="#4C825C" fillOpacity={0.9} color="#fff" weight={2}>
                          <Tooltip permanent direction="top" offset={[0, -10]}
                            className="route-map-tooltip">
                            <div className="route-map-tooltip__content">
                              <span className="route-map-tooltip__label">Client</span>
                              <span>{order.FIRST_NAME} {order.LAST_NAME} - {order.CITY}, {order.STATE_PROVINCE}</span>
                            </div>
                          </Tooltip>
                        </CircleMarker>
                      </MapContainer>
                    </div>

                    {/* Shipment info cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { label: 'Distance', value: distanceMiles ? `${Math.round(distanceMiles).toLocaleString()} mi` : '-', color: '#4C825C' },
                        { label: 'Est. Completion', value: estHours ? `${estHours} hrs` : '-', color: '#AA643B' },
                      { label: 'Processing Cost', value: shipment?.SHIP_COST ? formatCurrency(shipment.SHIP_COST) : '-', color: '#437C94' },
                        { label: 'Status', value: (shipment?.SHIP_STATUS || order.ORDER_STATUS || '-').replace(/_/g, ' '), color: carrierColor },
                      ].map(c => (
                        <div key={c.label} className="rounded-lg p-2" style={{ background: `${c.color}08`, border: `1px solid ${c.color}25` }}>
                          <p className="text-[10px] text-[var(--color-text-dim)] uppercase">{c.label}</p>
                          <p className="text-sm font-bold capitalize" style={{ color: c.color }}>{c.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Status timeline */}
                    {shipment && (
                      <div className="rounded-lg p-3" style={{ background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
                        <p className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">Service Route Progress</p>
                        <div className="flex items-center gap-0">
                          {SHIP_STATUS_STEPS.map((step, i) => {
                            const StepIcon = step.icon;
                            const isComplete = i <= stepIndex;
                            const isCurrent = i === stepIndex;
                            return (
                              <div key={step.key} className="flex items-center" style={{ flex: i < SHIP_STATUS_STEPS.length - 1 ? 1 : 'none' }}>
                                <div className="flex flex-col items-center" style={{ minWidth: 28 }}>
                                  <div className="w-6 h-6 rounded flex items-center justify-center transition-all"
                                    style={{
                                      background: isComplete ? `${carrierColor}20` : 'var(--color-surface)',
                                      border: `2px solid ${isComplete ? carrierColor : 'rgba(49,45,42,0.12)'}`,
                                      boxShadow: isCurrent ? `0 0 0 3px ${carrierColor}24` : 'none',
                                    }}>
                                    <StepIcon size={10} style={{ color: isComplete ? carrierColor : 'var(--color-text-dim)' }} />
                                  </div>
                                  <span className="text-[8px] mt-1 text-center leading-tight"
                                    style={{ color: isComplete ? carrierColor : 'var(--color-text-dim)', fontWeight: isCurrent ? 700 : 400, maxWidth: 50 }}>
                                    {step.label}
                                  </span>
                                </div>
                                {i < SHIP_STATUS_STEPS.length - 1 && (
                                  <div className="flex-1 h-0.5 mx-0.5 rounded" style={{
                                    background: i < stepIndex ? carrierColor : 'rgba(49,45,42,0.12)',
                                  }} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Oracle spatial SQL */}
                    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
                      <div className="px-3 py-1.5" style={{ background: 'rgba(76,130,92,0.06)', borderBottom: '1px solid var(--color-border)' }}>
                      <span className="text-[10px] font-semibold text-[var(--color-text)] uppercase tracking-wider">Oracle Spatial - {routeGeometry ? 'SDO_GCDR Geocoder Routing' : 'SDO_GEOMETRY'}</span>
                    </div>
                      <pre className="p-3 text-[11px] font-mono text-[var(--color-text)] overflow-x-auto whitespace-pre leading-relaxed">{routeGeometry ? `-- Driving route geometry (Oracle Spatial Geocoder)
SELECT SDO_UTIL.TO_GEOJSON(
         SDO_GCDR.ELOC_ROUTE_GEOM(
           ${order.CENTER_LON}, ${order.CENTER_LAT},
           ${order.CUST_LON}, ${order.CUST_LAT},
           'vehicle=car'))
FROM   dual;
-- Result: LineString with ${routeGeometry.length} coordinate pairs

-- SDO_GCDR.ELOC_ROUTE for distance/time metrics
-- SDO_GCDR.ELOC_ROUTE_GEOM for actual road geometry
-- SDO_GCDR.ELOC_DRIVE_TIME_POLYGON for isochrone zones` : `-- Distance between service center and client
SELECT ROUND(SDO_GEOM.SDO_DISTANCE(
         fc.location,              -- SDO_GEOMETRY point
         c.location,               -- SDO_GEOMETRY point
         0.05, 'unit=MILE'), 1)    AS distance_miles
FROM   fulfillment_centers fc, customers c
WHERE  fc.center_id = ${order.FULFILLMENT_CENTER_ID || ':center_id'}
AND    c.customer_id = ${order.CUSTOMER_ID || ':cust_id'};
-- Result: ${distanceMiles ? Math.round(distanceMiles).toLocaleString() + ' miles' : 'N/A'}

-- Coordinates stored as SDO_GEOMETRY(2001, 4326, ...)
-- Spatial R-tree index enables sub-ms proximity queries`}</pre>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function Orders() {
  const { currentUser, ROLE_META } = useUser();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState(null);

  // VPD-aware: refetch when user switches
  const userKey = currentUser?.USERNAME;
  const { data: orders, loading } = useData(
    () => api.orders.list({ status, page, limit: 20 }),
    [status, page, userKey]
  );

  const toggleExpand = useCallback((id) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  return (
    <div className="space-y-6 fade-in">

      {/* Register Oracle Internals into the right panel */}
      <RegisterOraclePanel title="Client Transactions & Cases">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
              JSON Relational Duality Views - Oracle 23ai+
            </p>
            <p className="text-sm text-[var(--color-text)] leading-relaxed">
              Seer Bank client transactions and cases are stored in a classic <span className="tone-ocean font-mono">relational schema</span> - ACID transactions, foreign keys, and referential integrity.
              But Oracle's <span className="font-mono text-[var(--color-text)]">JSON Duality Views</span> let the <em>exact same data</em> be read and updated as JSON documents,
              without ETL or duplication. Click any transaction row and toggle between{' '}
              <span className="font-semibold text-[var(--color-text)]">Relational</span> and <span className="font-semibold text-[var(--color-text)]">JSON Duality</span> to see
              the same data rendered two ways - <em>same transaction, zero sync lag</em>.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FeatureBadge label="JSON Relational Duality Views" color="orange" />
            <FeatureBadge label="CREATE JSON RELATIONAL DUALITY VIEW" color="yellow" />
            <FeatureBadge label="WITH UPDATE (read-write)" color="green" />
            <FeatureBadge label="Nested JSON Projection" color="cyan" />
            <FeatureBadge label="Same ACID Transaction" color="blue" />
            <FeatureBadge label="Zero ETL / Zero Sync" color="purple" />
          </div>

          {/* ORDERS_DV definition */}
          <div>
            <p className="text-[10px] font-semibold text-[var(--color-text)] uppercase tracking-wider mb-2">
              TRANSACTIONS_DV - Transactions + Services as JSON
            </p>
            <p className="text-xs text-[var(--color-text-dim)] mb-2 leading-relaxed">
              REST-style JSON access to client transactions with nested service rows. Read-write: inserts through the view update both <span className="font-mono text-[var(--color-text)]">orders</span> and{' '}
              <span className="font-mono text-[var(--color-text)]">order_items</span> tables atomically.
            </p>
            <SqlBlock code={`CREATE JSON RELATIONAL DUALITY VIEW orders_dv AS
SELECT JSON {
  '_id': o.order_id,
  'customerId': o.customer_id,
  'status': o.order_status,
  'total': o.order_total,
  'items': [
    SELECT JSON {
      'itemId': oi.item_id,
      'productId': oi.product_id,
      'quantity': oi.quantity,
      'unitPrice': oi.unit_price }
    FROM order_items oi WITH UPDATE
    WHERE oi.order_id = o.order_id ] }
FROM orders o WITH UPDATE;`} />
          </div>

          {/* PRODUCTS_CAPACITY_DV definition */}
          <div>
            <p className="text-[10px] font-semibold text-[var(--color-text)] uppercase tracking-wider mb-2">
              PRODUCTS_CAPACITY_DV - Products + Service Capacity as JSON
            </p>
            <p className="text-xs text-[var(--color-text-dim)] mb-2 leading-relaxed">
              Financial products with nested service capacity across all Seer service centers. One document, two tables.
            </p>
            <SqlBlock code={`CREATE JSON RELATIONAL DUALITY VIEW products_capacity_dv AS
SELECT JSON {
  '_id': p.product_id,
  'sku': p.sku,
  'productName': p.product_name,
  'category': p.category,
  'exposureValueUsd': ROUND(p.unit_price * 1000, 2),
  'institution': (
    SELECT JSON {
      'brandId': b.brand_id,
      'brandName': b.brand_name }
    FROM brands b WITH UPDATE
    WHERE b.brand_id = p.brand_id),
  'serviceCapacity': [
    SELECT JSON {
      'inventoryId': i.inventory_id,
      'operationsCenterId': i.center_id,
      'operationsCenter': (
        SELECT JSON {
          'centerId': fc.center_id,
          'centerName': fc.center_name,
          'region': fc.city || ', ' || fc.state_province,
          'serviceTier': fc.center_type }
        FROM fulfillment_centers fc WITH UPDATE
        WHERE fc.center_id = i.center_id),
      'caseProcessingCapacity': i.quantity_on_hand,
      'activeWorkload': i.quantity_reserved,
      'remainingCapacity': i.quantity_on_hand - i.quantity_reserved }
    FROM inventory i WITH UPDATE
    WHERE i.product_id = p.product_id ] }
FROM products p WITH UPDATE;`} />
          </div>

          {/* Query example */}
          <div>
            <p className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
              How to Query a Duality View
            </p>
            <SqlBlock code={`-- Relational: traditional row-by-row access
SELECT o.order_id, c.full_name, o.order_total,
       oi.product_id, oi.quantity, oi.unit_price
FROM   orders o
JOIN   customers c    ON c.customer_id = o.customer_id
JOIN   order_items oi ON oi.order_id   = o.order_id
WHERE  o.order_id = :id;

-- Duality: same data as a single JSON document
SELECT DATA FROM orders_dv
WHERE  JSON_VALUE(DATA, '$._id' RETURNING NUMBER) = :id;
-- Returns: {"_id":1, "status":"routed", "items":[...]}`} />
          </div>

          {/* Visual diagram */}
          <div>
            <p className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">One Table, Two Faces</p>
            <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
              <div className="text-center text-[10px] text-[var(--color-text)] mb-2">Same underlying data - two interfaces</div>
              <div className="flex gap-2">
                <div className="flex-1 rounded p-2 text-[9px] text-center" style={{ background: '#437C9415', border: '1px solid #437C9440', color: 'var(--color-text)' }}>
                  <div className="font-bold mb-1">SQL View</div>
                  <div>SELECT *</div>
                  <div>FROM orders</div>
                  <div className="text-[8px] mt-1 text-[var(--color-text)]">row-by-row</div>
                </div>
                <div className="flex flex-col justify-center tone-sienna text-lg">⇔</div>
                <div className="flex-1 rounded p-2 text-[9px] text-center" style={{ background: '#AA643B15', border: '1px solid #AA643B40', color: 'var(--color-text)' }}>
                  <div className="font-bold mb-1">JSON Duality</div>
                  <div>{'{"id":1,'}</div>
                  <div>{'"items":[...]}'}</div>
                  <div className="text-[8px] mt-1 text-[var(--color-text)]">document REST API</div>
                </div>
              </div>
              <div className="text-center text-[9px] text-[var(--color-text)] mt-1">✓ Same ACID transaction · No sync · No ETL</div>
            </div>
          </div>

          {/* Flow diagram */}
          <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--color-surface-muted)', border: '1px solid var(--color-border)' }}>
            <div className="text-[9px] text-center text-[var(--color-text)] font-bold mb-1">Duality View Architecture</div>
            <DiagramBox label="client transactions + services" sub="Normalized relational tables - ACID, FK constraints, indexes" color="#437C94" />
            <div className="text-center text-[10px] text-[var(--color-text)]">↕ CREATE JSON RELATIONAL DUALITY VIEW</div>
            <DiagramBox label="ORDERS_DV" sub="JSON document: {_id, status, items: [...]} - WITH UPDATE" color="#AA643B" />
            <div className="text-center text-[10px] text-[var(--color-text)]">↕</div>
            <DiagramBox label="financial products + service capacity" sub="Product catalog + service-center capacity levels" color="#437C94" />
            <div className="text-center text-[10px] text-[var(--color-text)]">↕ CREATE JSON RELATIONAL DUALITY VIEW</div>
            <DiagramBox label="PRODUCTS_CAPACITY_DV" sub="JSON document: {sku, productName, capacity: [...]} - WITH UPDATE" color="#AA643B" />
          </div>

          {/* How it works callout */}
          <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(170,100,59,0.06)', border: '1px dashed rgba(170,100,59,0.3)' }}>
            <p className="text-[10px] text-[var(--color-text-dim)] leading-relaxed">
              <strong className="text-[var(--color-text)]">How it works:</strong>{' '}
              The same transaction and service rows you see in relational
              queries are exposed as nested JSON documents through <span className="font-mono text-[var(--color-text)]">ORDERS_DV</span>.
              Read or write through either interface - same ACID transaction, same data, zero sync.
              The <span className="font-mono text-[var(--color-text)]">WITH UPDATE</span> clause makes both views read-write.
            </p>
          </div>

          {/* VPD on Orders */}
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider mb-2">
              Virtual Private Database (VPD) on Client Transactions
            </p>
            <p className="text-sm text-[var(--color-text)] leading-relaxed mb-2">
              A second <span className="tone-red font-mono">DBMS_RLS</span> policy on the{' '}
              <code className="text-xs tone-teal mx-1">ORDERS</code> table restricts service operations managers
              to transactions routed through their regional centers. The policy function queries{' '}
              <code className="text-xs tone-teal mx-1">fulfillment_center_id</code> against the user's assigned region.
              Admins and analysts see all 3,000 transactions; a regional manager sees only their subset.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FeatureBadge label="DBMS_RLS (Orders)" color="red" />
            <FeatureBadge label="VPD Row-Level Security" color="red" />
            <FeatureBadge label="sc_security_ctx" color="yellow" />
            <FeatureBadge label="Cascading VPD" color="orange" />
          </div>
          <SqlBlock code={`-- VPD policy function for ORDERS table
CREATE OR REPLACE FUNCTION vpd_orders_region (
    p_schema IN VARCHAR2, p_table IN VARCHAR2
) RETURN VARCHAR2 AS
    v_role   VARCHAR2(30);
    v_region VARCHAR2(100);
BEGIN
    v_role   := sc_security_ctx.get_role();
    v_region := sc_security_ctx.get_region();

    -- Admin/analyst: full access
    IF v_role IN ('admin','analyst') THEN RETURN NULL; END IF;

    -- Service operations manager: transactions for their region's centers
    IF v_role = 'fulfillment_mgr' AND v_region IS NOT NULL THEN
        RETURN 'fulfillment_center_id IN '
            || '(SELECT center_id FROM fulfillment_centers'
            || ' WHERE state_province = ''' || v_region || ''')';
    END IF;

    RETURN NULL;  -- others see all
END;

-- Applied via:
DBMS_RLS.ADD_POLICY('ORDERS','VPD_ORDERS_REGION',
  policy_function => 'VPD_ORDERS_REGION',
  statement_types => 'SELECT');`} />
        </div>
      </RegisterOraclePanel>

      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingCart className="tone-ocean" /> Transaction & Case Operations
        </h2>
        <p className="text-sm text-[var(--color-text-dim)] mt-1">
          Review fraud-linked client transactions through operational, API-ready, and workflow-based perspectives powered by a unified financial operations model.
        </p>
      </div>

      <SceneStoryPanel scene="orders" />

      {/* ── VPD Context Banner ── */}
      {currentUser && (() => {
        const roleMeta = ROLE_META[currentUser.ROLE] || ROLE_META.viewer;
        const isFM = currentUser.ROLE === 'fulfillment_mgr';
        return (
          <div
            className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm"
            style={{ background: `${roleMeta.color}10`, border: `1px solid ${roleMeta.color}25` }}
          >
            <Shield size={14} style={{ color: roleMeta.color }} />
            <div className="flex items-center gap-2 flex-wrap flex-1">
              <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
                {currentUser.FULL_NAME}
              </span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                style={{
                  background: 'var(--color-surface-muted)',
                  color: 'var(--color-text)',
                  border: `1px solid ${roleMeta.color}`,
                }}
              >
                {roleMeta.label}
              </span>
              <span className="text-[var(--color-text-dim)] text-xs">
                {isFM
                  ? `Filtered to ${currentUser.REGION} - ${(orders || []).length} transactions visible`
                  : `${(orders || []).length} transactions visible`
                }
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--color-text-dim)]">
              <Eye size={10} />
              VPD {isFM ? 'region-filtered' : 'full access'}
            </div>
          </div>
        );
      })()}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter size={14} className="text-[var(--color-text-dim)]" />
        <JetSelectSingle
          value={status}
          options={STATUS_OPTIONS}
          placeholder="All Statuses"
          className="orders-status-filter"
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
      </div>

          {/* Transactions Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider border-b border-[var(--color-border)] bg-[var(--color-surface)]/50">
                <th className="text-left py-3 px-4">Txn #</th>
                <th className="text-left py-3 px-4">Client</th>
                <th className="text-left py-3 px-4">Location</th>
                <th className="text-center py-3 px-4">Status</th>
                <th className="text-right py-3 px-4">Services</th>
                <th className="text-right py-3 px-4">Total</th>
                <th className="text-center py-3 px-4">Signal Linked</th>
                <th className="text-left py-3 px-4">Service Center</th>
                <th className="text-left py-3 px-4">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="py-8 text-center text-[var(--color-text-dim)]">Loading transactions...</td></tr>
              ) : (orders || []).length === 0 ? (
                <tr><td colSpan={9} className="py-8 text-center text-[var(--color-text-dim)]">No transactions found</td></tr>
              ) : (
                (orders || []).map(o => {
                  const isExpanded = expandedId === o.ORDER_ID;
                  return [
                    <tr key={o.ORDER_ID}
                      onClick={() => toggleExpand(o.ORDER_ID)}
                      className={`border-b border-[var(--color-border)]/20 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer ${
                        isExpanded ? 'bg-[var(--color-surface-hover)]' : ''
                      }`}
                      style={isExpanded ? { borderBottom: 'none' } : {}}>
                      <td className="py-3 px-4 font-mono font-medium flex items-center gap-1.5">
                        {isExpanded ? <ChevronDown size={12} className="text-[#AA643B]" /> : <ChevronRight size={12} className="text-[var(--color-text-dim)]" />}
                        #{o.ORDER_ID}
                      </td>
                      <td className="py-3 px-4">{o.CUSTOMER_NAME}</td>
                      <td className="py-3 px-4 text-[var(--color-text-dim)]">{o.CUSTOMER_CITY}, {o.CUSTOMER_STATE}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[o.ORDER_STATUS] || ''}`}>
                          {o.ORDER_STATUS}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">{o.ITEM_COUNT}</td>
                      <td className="py-3 px-4 text-right font-medium">{formatCurrency(o.ORDER_TOTAL)}</td>
                      <td className="py-3 px-4 text-center">
                        {o.SOCIAL_DRIVEN ? (
                          <span className="tone-rose text-xs font-semibold">Signal Linked</span>
                        ) : (
                          <span className="text-[var(--color-text-dim)] text-xs">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-[var(--color-text-dim)]">{o.FULFILLMENT_CENTER || '-'}</td>
                      <td className="py-3 px-4 text-xs text-[var(--color-text-dim)]">{formatDate(o.CREATED_AT)}</td>
                    </tr>,
                    isExpanded && (
                      <OrderDualityPanel key={`detail-${o.ORDER_ID}`} orderId={o.ORDER_ID} onClose={() => setExpandedId(null)} />
                    ),
                  ];
                }).flat().filter(Boolean)
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-center gap-2">
        <JetButton
          label="Prev"
          chroming="outlined"
          disabled={page === 1}
          onAction={() => setPage(p => Math.max(1, p - 1))}
        />
        <span className="text-sm text-[var(--color-text-dim)]">Page {page}</span>
        <JetButton
          label="Next"
          chroming="outlined"
          disabled={(orders || []).length < 20}
          onAction={() => setPage(p => p + 1)}
        />
      </div>
    </div>
  );
}
