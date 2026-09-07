/**
 * Products API
 */
const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/products — list with filters
router.get('/', async (req, res) => {
  try {
    const { category, brand, trending, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = 'WHERE p.is_active = 1';
    const binds = { limit: parseInt(limit), offset };

    if (category) { where += " AND p.category = :category"; binds.category = category; }
    if (brand) { where += " AND b.brand_slug = :brand"; binds.brand = brand; }

    const result = await db.execute(`
      SELECT p.product_id, p.sku, p.product_name, p.category, p.subcategory,
             p.unit_price, p.tags, b.brand_name, b.social_tier,
             (SELECT SUM(i.quantity_on_hand) FROM inventory i WHERE i.product_id = p.product_id) AS total_capacity,
             (SELECT COUNT(*) FROM post_product_mentions ppm
              JOIN social_posts sp ON ppm.post_id = sp.post_id
              WHERE ppm.product_id = p.product_id
                AND sp.posted_at >= (SELECT MAX(posted_at) FROM social_posts) - INTERVAL '7' DAY) AS social_mentions_7d
      FROM products p
      JOIN brands b ON p.brand_id = b.brand_id
      ${where}
      ORDER BY social_mentions_7d DESC, p.product_name
      OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
    `, binds);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/:id — product detail with inventory and social
router.get('/:id', async (req, res) => {
  try {
    const productId = parseInt(req.params.id);

    const product = await db.execute(`
      SELECT p.*, b.brand_name, b.social_tier
      FROM products p JOIN brands b ON p.brand_id = b.brand_id
      WHERE p.product_id = :id
    `, { id: productId });

    const inventory = await db.execute(`
      SELECT i.*, fc.center_name, fc.city, fc.state_province, fc.center_type
      FROM inventory i
      JOIN fulfillment_centers fc ON i.center_id = fc.center_id
      WHERE i.product_id = :id
      ORDER BY i.quantity_on_hand DESC
    `, { id: productId });

    const socialMentions = await db.execute(`
      SELECT sp.post_id, sp.post_text, sp.posted_at, sp.likes_count,
             sp.virality_score, sp.momentum_flag,
             i.handle,
             i.display_name AS source_name,
             ppm.confidence_score, ppm.mention_type
      FROM post_product_mentions ppm
      JOIN social_posts sp ON ppm.post_id = sp.post_id
      LEFT JOIN influencers i ON sp.influencer_id = i.influencer_id
      WHERE ppm.product_id = :id
      ORDER BY sp.virality_score DESC NULLS LAST
      FETCH FIRST 20 ROWS ONLY
    `, { id: productId });

    if (product.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({
      product: product.rows[0],
      inventory: inventory.rows,
      socialMentions: socialMentions.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/:id/duality — product as JSON document from PRODUCTS_CAPACITY_DV
router.get('/:id/duality', async (req, res) => {
  try {
    const productId = parseInt(req.params.id);

    // JSON_SERIALIZE avoids an Oracle JSON duality-view driver issue seen when
    // node-oracledb fetches DATA directly (ORA-40666 on some 26ai builds).
    const sql = `SELECT JSON_SERIALIZE(DATA RETURNING CLOB) AS doc
                   FROM products_capacity_dv
                  WHERE JSON_VALUE(DATA, '$._id' RETURNING NUMBER) = :id`;

    const result = await db.execute(sql, { id: productId });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    let doc = result.rows[0].DOC;
    if (Array.isArray(doc)) doc = doc[0];
    if (typeof doc === 'string') doc = JSON.parse(doc);

    res.json({
      source: 'PRODUCTS_CAPACITY_DV',
      viewDefinition: 'CREATE JSON RELATIONAL DUALITY VIEW products_capacity_dv AS SELECT JSON {...} FROM products p WITH UPDATE',
      sql: `SELECT DATA FROM products_capacity_dv WHERE JSON_VALUE(DATA, '$._id' RETURNING NUMBER) = ${productId}`,
      document: doc
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/categories/list
router.get('/categories/list', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT category, COUNT(*) AS product_count
      FROM products WHERE is_active = 1
      GROUP BY category ORDER BY product_count DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
