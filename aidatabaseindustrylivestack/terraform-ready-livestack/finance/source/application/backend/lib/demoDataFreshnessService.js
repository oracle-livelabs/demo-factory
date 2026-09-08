const db = require('../config/database');

async function execSql(connection, sql, binds = {}, options = {}) {
  return connection.execute(sql, binds, {
    autoCommit: false,
    outFormat: db.oracledb.OUT_FORMAT_OBJECT,
    ...options,
  });
}

async function refreshDemoDateWindow(connection, { requireDemoDatasetState = true } = {}) {
  const result = await execSql(connection, `
DECLARE
  v_current_anchor TIMESTAMP;
  v_target_anchor  TIMESTAMP := SYSTIMESTAMP - INTERVAL '15' MINUTE;
  v_delta_seconds  NUMBER;
  v_delta_days     NUMBER;

  FUNCTION demo_dataset_active RETURN BOOLEAN IS
    v_source VARCHAR2(20);
  BEGIN
    SELECT active_source
    INTO v_source
    FROM app_dataset_state
    WHERE state_id = 1;

    RETURN LOWER(v_source) = 'demo';
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RETURN TRUE;
    WHEN OTHERS THEN
      IF SQLCODE = -942 THEN
        RETURN TRUE;
      END IF;
      RAISE;
  END;

  PROCEDURE shift_ts(p_table_name IN VARCHAR2, p_column_name IN VARCHAR2) IS
  BEGIN
    EXECUTE IMMEDIATE
      'UPDATE ' || p_table_name ||
      ' SET ' || p_column_name || ' = ' || p_column_name ||
      ' + NUMTODSINTERVAL(:delta_seconds, ''SECOND'')' ||
      ' WHERE ' || p_column_name || ' IS NOT NULL'
      USING v_delta_seconds;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLCODE NOT IN (-942, -904) THEN
        RAISE;
      END IF;
  END;

  PROCEDURE shift_date(p_table_name IN VARCHAR2, p_column_name IN VARCHAR2) IS
  BEGIN
    EXECUTE IMMEDIATE
      'UPDATE ' || p_table_name ||
      ' SET ' || p_column_name || ' = ' || p_column_name || ' + :delta_days' ||
      ' WHERE ' || p_column_name || ' IS NOT NULL'
      USING v_delta_days;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLCODE NOT IN (-942, -904) THEN
        RAISE;
      END IF;
  END;
BEGIN
  IF :require_state = 1 AND NOT demo_dataset_active THEN
    :shifted_seconds := 0;
    :shifted_days := 0;
    :current_anchor := NULL;
    :target_anchor := CAST(v_target_anchor AS DATE);
    RETURN;
  END IF;

  SELECT MAX(activity_at)
  INTO v_current_anchor
  FROM (
    SELECT MAX(CAST(created_at AS TIMESTAMP)) AS activity_at FROM orders
    UNION ALL
    SELECT MAX(posted_at) AS activity_at FROM social_posts
  );

  IF v_current_anchor IS NULL THEN
    :shifted_seconds := 0;
    :shifted_days := 0;
    :current_anchor := NULL;
    :target_anchor := CAST(v_target_anchor AS DATE);
    RETURN;
  END IF;

  v_delta_seconds := ROUND((CAST(v_target_anchor AS DATE) - CAST(v_current_anchor AS DATE)) * 86400);
  v_delta_days := v_delta_seconds / 86400;

  IF ABS(v_delta_seconds) < 60 THEN
    :shifted_seconds := 0;
    :shifted_days := 0;
    :current_anchor := CAST(v_current_anchor AS DATE);
    :target_anchor := CAST(v_target_anchor AS DATE);
    RETURN;
  END IF;

  shift_ts('brands', 'created_at');
  shift_ts('brands', 'updated_at');
  shift_ts('products', 'created_at');
  shift_ts('products', 'updated_at');
  shift_date('products', 'launch_date');
  shift_ts('fulfillment_centers', 'created_at');
  shift_ts('customers', 'created_at');
  shift_ts('influencers', 'created_at');
  shift_ts('social_posts', 'posted_at');
  shift_ts('social_posts', 'processed_at');
  shift_ts('social_posts', 'created_at');
  shift_ts('post_product_mentions', 'created_at');
  shift_ts('orders', 'created_at');
  shift_ts('orders', 'updated_at');
  shift_date('orders', 'estimated_delivery');
  shift_date('orders', 'actual_delivery');
  shift_date('inventory', 'last_restock_date');
  shift_ts('inventory', 'updated_at');
  shift_ts('shipments', 'routed_at');
  shift_ts('shipments', 'completed_at');
  shift_ts('shipments', 'created_at');
  shift_date('demand_forecasts', 'forecast_date');
  shift_ts('demand_forecasts', 'created_at');
  shift_ts('demand_regions', 'updated_at');
  shift_ts('influencer_connections', 'first_seen');
  shift_ts('influencer_connections', 'last_interaction');
  shift_ts('brand_influencer_links', 'first_mention');
  shift_ts('brand_influencer_links', 'last_mention');

  :shifted_seconds := v_delta_seconds;
  :shifted_days := ROUND(v_delta_days, 4);
  :current_anchor := CAST(v_current_anchor AS DATE);
  :target_anchor := CAST(v_target_anchor AS DATE);
END;
`, {
    require_state: requireDemoDatasetState ? 1 : 0,
    shifted_seconds: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER },
    shifted_days: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER },
    current_anchor: { dir: db.oracledb.BIND_OUT, type: db.oracledb.DATE },
    target_anchor: { dir: db.oracledb.BIND_OUT, type: db.oracledb.DATE },
  });

  const seconds = Number(result.outBinds.shifted_seconds || 0);
  return {
    shifted_seconds: seconds,
    shifted_days: Number(result.outBinds.shifted_days || 0),
    shifted: Math.abs(seconds) >= 60,
    previous_anchor: result.outBinds.current_anchor || null,
    target_anchor: result.outBinds.target_anchor || null,
  };
}

module.exports = {
  refreshDemoDateWindow,
};
