/**
 * Fulfillment API — Spatial routing and branch site management
 */
const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/fulfillment/centers
// VPD: sc_security_ctx filters fulfillment_centers by user's role/region
router.get('/centers', async (req, res) => {
  try {
    const result = await db.executeAsUser(`
      SELECT fc.center_id, fc.center_name, fc.center_type,
             fc.city, fc.state_province, fc.postal_code,
             fc.latitude, fc.longitude, fc.capacity_units,
             ROUND(NVL((SELECT SUM(i2.quantity_on_hand) FROM inventory i2
               WHERE i2.center_id = fc.center_id) / NULLIF(fc.capacity_units, 0) * 100, 0), 1) AS current_load_pct,
	             fc.is_active,
	             (SELECT COUNT(DISTINCT i.product_id) FROM inventory i
	              WHERE i.center_id = fc.center_id AND i.quantity_on_hand > 0) AS products_available,
	             CASE ORA_HASH(fc.center_name, 7)
	               WHEN 0 THEN 'Wealth Advisory'
	               WHEN 1 THEN 'Mortgage Processing'
	               WHEN 2 THEN 'Client Onboarding'
	               WHEN 3 THEN 'AML Review'
	               WHEN 4 THEN 'Treasury Services'
	               WHEN 5 THEN 'Retail Banking'
	               WHEN 6 THEN 'Fraud Review'
	               ELSE 'Commercial Lending'
	             END AS supported_services,
	             (SELECT SUM(i.quantity_on_hand) FROM inventory i
	              WHERE i.center_id = fc.center_id) AS total_units,
             (SELECT COUNT(*) FROM orders o
              WHERE o.fulfillment_center_id = fc.center_id
                AND o.order_status IN ('pending','confirmed','processing')) AS pending_shipments
      FROM fulfillment_centers fc
      WHERE fc.is_active = 1
      ORDER BY fc.center_name
    `, {}, req.demoUser);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fulfillment/nearest — find nearest site for a client+financial product
router.get('/nearest', async (req, res) => {
  try {
    const { customerId, productId, lat, lon, maxResults = 5 } = req.query;
    const maxResultsNumber = parseInt(maxResults, 10) || 5;

    let result;
    if (customerId && productId) {
      result = await db.executeCursorAsUser(`
        BEGIN
          :nearestCenters := find_nearest_centers(:customerId, :productId, :maxResults);
        END;
      `, {
        nearestCenters: { dir: db.oracledb.BIND_OUT, type: db.oracledb.CURSOR },
        customerId: parseInt(customerId, 10),
        productId: parseInt(productId, 10),
        maxResults: maxResultsNumber
      }, 'nearestCenters', req.demoUser, { maxRows: maxResultsNumber });
    } else if (lat && lon) {
      // Use raw coordinates
      result = await db.executeAsUser(`
        SELECT fc.center_id, fc.center_name, fc.city, fc.state_province,
               fc.center_type, fc.latitude, fc.longitude,
               ROUND(SDO_GEOM.SDO_DISTANCE(
                   SDO_GEOMETRY(2001, 4326, SDO_POINT_TYPE(:lon, :lat, NULL), NULL, NULL),
                   fc.location, 0.005, 'unit=KM'
               ), 2) AS distance_km
        FROM fulfillment_centers fc
        WHERE fc.is_active = 1
        ORDER BY SDO_GEOM.SDO_DISTANCE(
            SDO_GEOMETRY(2001, 4326, SDO_POINT_TYPE(:lon2, :lat2, NULL), NULL, NULL),
            fc.location, 0.005, 'unit=KM'
        )
        FETCH FIRST :maxResults ROWS ONLY
      `, { lat: parseFloat(lat), lon: parseFloat(lon),
           lat2: parseFloat(lat), lon2: parseFloat(lon),
           maxResults: maxResultsNumber }, req.demoUser);
    } else {
      return res.status(400).json({ error: 'Provide customerId+productId or lat+lon' });
    }

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fulfillment/shipments
router.get('/shipments', async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    let where = '1=1';
    const binds = { limit: parseInt(limit) };

    if (status) { where += " AND s.ship_status = :status"; binds.status = status; }

    const result = await db.executeAsUser(`
      SELECT s.shipment_id, s.order_id, s.carrier, s.tracking_number,
             s.ship_status, s.distance_km,
             ROUND(s.distance_km * 0.621371, 2) AS distance_miles,
             s.estimated_hours, s.ship_cost,
             s.routed_at, s.completed_at,
             fc.center_name, fc.city AS center_city, fc.latitude AS center_lat, fc.longitude AS center_lon,
             c.city AS customer_city, c.latitude AS customer_lat, c.longitude AS customer_lon
      FROM shipments s
      JOIN fulfillment_centers fc ON s.center_id = fc.center_id
      JOIN orders o ON s.order_id = o.order_id
      JOIN customers c ON o.customer_id = c.customer_id
      WHERE ${where}
      ORDER BY s.created_at DESC
      FETCH FIRST :limit ROWS ONLY
    `, binds, req.demoUser);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fulfillment/inventory-alerts
router.get('/inventory-alerts', async (req, res) => {
  try {
    const result = await db.executeAsUser(`
      SELECT p.product_id, p.product_name, p.category,
             b.brand_name,
             i.center_id, fc.center_name, fc.city,
             i.quantity_on_hand, i.reorder_point,
             i.quantity_on_hand - i.reorder_point AS deficit,
             NVL(df.social_factor, 1.0) AS social_factor,
             NVL(df.predicted_demand, 0) AS predicted_demand,
             CASE
                 WHEN i.quantity_on_hand = 0 THEN 'out_of_capacity'
                 WHEN i.quantity_on_hand < i.reorder_point * 0.5 THEN 'critical'
                 WHEN i.quantity_on_hand < i.reorder_point THEN 'low'
                 ELSE 'adequate'
             END AS capacity_status
      FROM inventory i
      JOIN products p ON i.product_id = p.product_id
      JOIN brands b ON p.brand_id = b.brand_id
      JOIN fulfillment_centers fc ON i.center_id = fc.center_id
      LEFT JOIN demand_forecasts df ON p.product_id = df.product_id
          AND df.forecast_date = TRUNC(SYSDATE)
      WHERE i.quantity_on_hand <= i.reorder_point
        AND fc.is_active = 1
      ORDER BY social_factor DESC, i.quantity_on_hand ASC
      FETCH FIRST 50 ROWS ONLY
    `, {}, req.demoUser);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fulfillment/customers
// Returns client lat/lon + tier for the Client Tier spatial layer
router.get('/customers', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 800, 2000);
    const result = await db.execute(`
      SELECT customer_id,
             customer_tier,
             ROUND(latitude, 4)        AS latitude,
             ROUND(longitude, 4)       AS longitude,
             city,
             state_province,
             ROUND(lifetime_value, 0)  AS lifetime_value
      FROM   customers
      WHERE  latitude  IS NOT NULL
        AND  longitude IS NOT NULL
      FETCH FIRST :limit ROWS ONLY
    `, { limit });
    res.json(result.rows);
  } catch (err) {
    console.error('Client layer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fulfillment/zones
// Returns service zone polygons. If fulfillment_zones is empty, generates
// virtual zones (express/standard/economy) from center coordinates with
// radius values (km) for the frontend to draw as Leaflet Circle overlays.
router.get('/zones', async (req, res) => {
  try {
    // Try DB zones first — include radius mapping so frontend can draw Circles
    const RADIUS_MAP = { express: 80, overnight: 160, standard: 250, economy: 500 };
    const dbResult = await db.executeAsUser(`
      SELECT fz.zone_id, fz.center_id, fz.zone_type, fz.max_delivery_hrs,
             fc.center_name, fc.center_type,
             fc.latitude, fc.longitude
      FROM   fulfillment_zones fz
      JOIN   fulfillment_centers fc ON fz.center_id = fc.center_id
      WHERE  fc.is_active = 1
      ORDER  BY fc.center_name, fz.zone_type
    `, {}, req.demoUser);

    if (dbResult.rows.length > 0) {
      const zones = dbResult.rows.map(z => ({
        ...z,
        RADIUS_KM: RADIUS_MAP[z.ZONE_TYPE] || 250,
      }));
      return res.json({ source: 'database', zones });
    }

    // Fallback: generate virtual zones from centers
    const centers = await db.executeAsUser(`
      SELECT center_id, center_name, center_type, latitude, longitude
      FROM   fulfillment_centers
      WHERE  is_active = 1 AND latitude IS NOT NULL
      ORDER  BY center_name
    `, {}, req.demoUser);

    const ZONE_RADII = [
      { type: 'express',  km: 80,  hrs: 8  },
      { type: 'standard', km: 250, hrs: 24 },
      { type: 'economy',  km: 500, hrs: 72 },
    ];

    const virtualZones = [];
    centers.rows.forEach(c => {
      ZONE_RADII.forEach(z => {
        virtualZones.push({
          ZONE_TYPE:        z.type,
          CENTER_ID:        c.CENTER_ID,
          CENTER_NAME:      c.CENTER_NAME,
          CENTER_TYPE:      c.CENTER_TYPE,
          LATITUDE:         c.LATITUDE,
          LONGITUDE:        c.LONGITUDE,
          RADIUS_KM:        z.km,
          MAX_DELIVERY_HRS: z.hrs,
        });
      });
    });

    res.json({ source: 'virtual', zones: virtualZones });
  } catch (err) {
    console.error('Zones error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fulfillment/demand-regions
// Returns demand_regions polygons with forecast summary, colored by demand_index.
// SDO_UTIL.TO_GEOJSON converts Oracle SDO_GEOMETRY → GeoJSON string.
// Joins to demand_forecasts by region_name for 7-day forecast context.
router.get('/demand-regions', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT r.region_id,
             r.region_name,
             r.region_type,
             r.population,
             ROUND(r.avg_income, 0)     AS avg_income,
             ROUND(r.social_density, 1) AS social_density,
             r.demand_index,
             TO_CHAR(SDO_UTIL.TO_GEOJSON(r.boundary)) AS geojson,
             (SELECT ROUND(AVG(df.predicted_demand), 0)
              FROM demand_forecasts df
              WHERE UPPER(df.region) = UPPER(r.region_name)
                AND df.forecast_date BETWEEN TRUNC(SYSDATE) AND TRUNC(SYSDATE) + 7
             ) AS avg_7day_forecast,
             (SELECT ROUND(MAX(df.social_factor), 2)
              FROM demand_forecasts df
              WHERE UPPER(df.region) = UPPER(r.region_name)
                AND df.forecast_date BETWEEN TRUNC(SYSDATE) AND TRUNC(SYSDATE) + 7
             ) AS peak_social_factor,
             (SELECT COUNT(DISTINCT df.product_id)
              FROM demand_forecasts df
              WHERE UPPER(df.region) = UPPER(r.region_name)
             ) AS forecast_products
      FROM demand_regions r
      ORDER BY r.demand_index DESC
    `);

    // SDO_UTIL.TO_GEOJSON returns GeoJSON with [lon, lat] pairs.
    // Swap to [lat, lon] for Leaflet Polygon compatibility.
    const regions = result.rows.map(r => {
      let coords = null;
      if (r.GEOJSON) {
        try {
          const geo = JSON.parse(r.GEOJSON);
          coords = (geo.coordinates?.[0] || []).map(([lon, lat]) => [lat, lon]);
        } catch (_) { /* malformed geometry — skip */ }
      }
      return { ...r, COORDS: coords };
    });

    res.json(regions);
  } catch (err) {
    console.error('Demand regions error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
