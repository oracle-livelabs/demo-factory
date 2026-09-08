/**
 * Orders API
 */
const express = require('express');
const router = express.Router();
const db = require('../config/database');

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function roundTo(value, precision = 2) {
  const numberValue = toNumber(value);
  if (numberValue === null) return null;
  const multiplier = 10 ** precision;
  return Math.round(numberValue * multiplier) / multiplier;
}

function buildCurrentCenterFallback(order) {
  if (!order?.FULFILLMENT_CENTER_ID) return null;

  const distanceKm = order.SPATIAL_DISTANCE_MILES
    ? roundTo(Number(order.SPATIAL_DISTANCE_MILES) * 1.60934, 2)
    : null;

  return {
    CENTER_ID: order.FULFILLMENT_CENTER_ID,
    CENTER_NAME: order.CENTER_NAME,
    CITY: order.CENTER_CITY,
    STATE_PROVINCE: order.CENTER_STATE_PROVINCE,
    CENTER_TYPE: order.CENTER_TYPE,
    LATITUDE: order.CENTER_LAT,
    LONGITUDE: order.CENTER_LON,
    DISTANCE_KM: distanceKm,
    ESTIMATED_HOURS: distanceKm ? roundTo(distanceKm / 80, 1) : null,
    IS_CURRENT_CENTER: 1
  };
}

function buildRoutingRecommendation(order, rows = [], error = null) {
  const sortedRows = [...rows].sort((a, b) => {
    const rankA = toNumber(a.RECOMMENDATION_RANK) ?? Number.MAX_SAFE_INTEGER;
    const rankB = toNumber(b.RECOMMENDATION_RANK) ?? Number.MAX_SAFE_INTEGER;
    return rankA - rankB;
  });

  const candidates = sortedRows.filter((row) => {
    const rank = toNumber(row.RECOMMENDATION_RANK);
    return rank !== null && rank <= 5;
  });
  const recommendedCenter = candidates.find((row) => toNumber(row.RECOMMENDATION_RANK) === 1) || candidates[0] || null;
  const currentCenter = sortedRows.find((row) => toNumber(row.IS_CURRENT_CENTER) === 1) || buildCurrentCenterFallback(order);
  const currentCenterId = toNumber(currentCenter?.CENTER_ID);
  const recommendedCenterId = toNumber(recommendedCenter?.CENTER_ID);
  const currentDistanceKm = toNumber(currentCenter?.DISTANCE_KM);
  const recommendedDistanceKm = toNumber(recommendedCenter?.DISTANCE_KM);

  return {
    source: 'OPTIMAL_FULFILLMENT',
    strategy: 'balanced',
    currentCenter,
    recommendedCenter,
    candidates,
    isCurrentBest: currentCenterId !== null && recommendedCenterId !== null && currentCenterId === recommendedCenterId,
    distanceDifferenceKm: currentDistanceKm !== null && recommendedDistanceKm !== null
      ? roundTo(currentDistanceKm - recommendedDistanceKm, 2)
      : null,
    error
  };
}

// GET /api/orders
router.get('/', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = '1=1';
    const binds = { limit: parseInt(limit), offset };

    if (status) { where += " AND o.order_status = :status"; binds.status = status; }

    const result = await db.executeAsUser(`
      SELECT o.order_id, o.order_status, o.order_total, o.shipping_cost,
             o.demand_score, o.created_at,
             c.first_name || ' ' || c.last_name AS customer_name,
             c.city AS customer_city, c.state_province AS customer_state,
             fc.center_name AS fulfillment_center,
             (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.order_id) AS item_count,
             CASE WHEN o.social_source_id IS NOT NULL THEN 1 ELSE 0 END AS social_driven
      FROM orders o
      JOIN customers c ON o.customer_id = c.customer_id
      LEFT JOIN fulfillment_centers fc ON o.fulfillment_center_id = fc.center_id
      WHERE ${where}
      ORDER BY o.created_at DESC
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
    `, binds, req.demoUser);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders/:id
router.get('/:id', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);

    const order = await db.executeAsUser(`
      SELECT o.*, c.first_name, c.last_name, c.email, c.city, c.state_province,
             c.latitude AS cust_lat, c.longitude AS cust_lon,
             fc.center_name, fc.city AS center_city, fc.state_province AS center_state_province,
             fc.center_type, fc.latitude AS center_lat, fc.longitude AS center_lon,
             CASE WHEN c.location IS NOT NULL AND fc.location IS NOT NULL
                  THEN ROUND(SDO_GEOM.SDO_DISTANCE(c.location, fc.location, 0.005, 'unit=MILE'), 2)
                  ELSE NULL END AS spatial_distance_miles
      FROM orders o
      JOIN customers c ON o.customer_id = c.customer_id
      LEFT JOIN fulfillment_centers fc ON o.fulfillment_center_id = fc.center_id
      WHERE o.order_id = :id
    `, { id: orderId }, req.demoUser);

    const items = await db.executeAsUser(`
      SELECT oi.*, p.product_name, p.category, b.brand_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.product_id
      JOIN brands b ON p.brand_id = b.brand_id
      WHERE oi.order_id = :id
    `, { id: orderId }, req.demoUser);

    const shipment = await db.executeAsUser(`
      SELECT s.*, ROUND(s.distance_km * 0.621371, 2) AS distance_miles
      FROM shipments s
      WHERE order_id = :id
      ORDER BY created_at DESC
      FETCH FIRST 1 ROWS ONLY
    `, { id: orderId }, req.demoUser);

    if (order.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Compute driving route using SDO_GCDR.ELOC_ROUTE
    // Returns distance, time, AND full driving geometry in one call
    let route = null;
    let routeGeometry = null;
    let routingRecommendation = null;
    const ord = order.rows[0];

    try {
      const recommendationResult = await db.executeCursorAsUser(`
        BEGIN
          :recommendations := optimal_fulfillment(:orderId, :strategy);
        END;
      `, {
        recommendations: { dir: db.oracledb.BIND_OUT, type: db.oracledb.CURSOR },
        orderId,
        strategy: 'balanced'
      }, 'recommendations', req.demoUser, { maxRows: 10 });

      routingRecommendation = buildRoutingRecommendation(ord, recommendationResult.rows || []);
    } catch (recommendationErr) {
      console.log('optimal_fulfillment not available:', recommendationErr.message);
      routingRecommendation = buildRoutingRecommendation(ord, [], recommendationErr.message);
    }

    if (ord.CENTER_LAT && ord.CENTER_LON && ord.CUST_LAT && ord.CUST_LON) {
      try {
        const routeResult = await db.executeAsUser(`
          SELECT SDO_GCDR.ELOC_ROUTE(
            'fastest', 'mile', 'minute',
            :startLon, :startLat,
            :endLon,   :endLat,
            'auto'
          ) AS route_json FROM dual
        `, {
          startLon: ord.CENTER_LON, startLat: ord.CENTER_LAT,
          endLon: ord.CUST_LON, endLat: ord.CUST_LAT
        }, req.demoUser);

        const raw = routeResult.rows[0]?.ROUTE_JSON;
        if (raw) {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          const r = parsed?.routeResponse?.route;
          if (r) {
            route = { distance: r.distance, time: r.time, distanceUnit: r.distanceUnit, timeUnit: r.timeUnit };
            // Extract driving path geometry — swap GeoJSON [lon,lat] to Leaflet [lat,lon]
            const coords = r.geometry?.coordinates;
            if (coords && coords.length > 0) {
              routeGeometry = coords.map(([lon, lat]) => [lat, lon]);
            }
          }
        }
      } catch (routeErr) {
        console.log('SDO_GCDR.ELOC_ROUTE not available:', routeErr.message);
      }
    }

    res.json({
      order: ord,
      items: items.rows,
      shipment: shipment.rows[0] || null,
      route,
      routeGeometry,
      routingRecommendation
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders/:id/duality — same order from JSON Duality View
router.get('/:id/duality', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);

    const sql = `SELECT DATA FROM orders_dv WHERE JSON_VALUE(DATA, '$._id' RETURNING NUMBER) = :id`;
    const result = await db.execute(sql, { id: orderId });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found in duality view' });
    }

    // DATA comes back as an array — unwrap if needed
    let doc = result.rows[0].DATA;
    if (Array.isArray(doc)) doc = doc[0];
    if (typeof doc === 'string') doc = JSON.parse(doc);

    res.json({
      source: 'ORDERS_DV',
      viewDefinition: 'CREATE JSON RELATIONAL DUALITY VIEW orders_dv AS SELECT JSON {...} FROM orders o WITH UPDATE',
      sql: `SELECT DATA FROM orders_dv WHERE JSON_VALUE(DATA, '$._id' RETURNING NUMBER) = ${orderId}`,
      document: doc
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
