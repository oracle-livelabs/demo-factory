/**
 * Users API — Demo user listing for VPD role switching
 * Returns app_users for the user switcher dropdown
 */
const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/users — list all active demo users
router.get('/', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT username, full_name, role, region, email
      FROM app_users
      WHERE is_active = 1
      ORDER BY
        CASE role
          WHEN 'admin' THEN 1
          WHEN 'analyst' THEN 2
          WHEN 'fulfillment_mgr' THEN 3
          WHEN 'merchandiser' THEN 4
          WHEN 'viewer' THEN 5
        END,
        full_name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Users list error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
