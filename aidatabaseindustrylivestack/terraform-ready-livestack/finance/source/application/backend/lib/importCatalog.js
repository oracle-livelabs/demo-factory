const IMPORT_VERSION = 'v1';

function column(name, type, options = {}) {
  return {
    name,
    type,
    required: false,
    ...options,
  };
}

function idColumn(name) {
  return column(name, 'id', { required: true, sourceId: true });
}

function refIdColumn(name, options = {}) {
  return column(name, 'id', { required: true, ...options });
}

function stringColumn(name, options = {}) {
  return column(name, 'string', options);
}

function numberColumn(name, options = {}) {
  return column(name, 'number', options);
}

function integerColumn(name, options = {}) {
  return column(name, 'integer', options);
}

function flagColumn(name, options = {}) {
  return column(name, 'flag', options);
}

function dateColumn(name, options = {}) {
  return column(name, 'date', options);
}

function timestampColumn(name, options = {}) {
  return column(name, 'timestamp', options);
}

function enumColumn(name, values, options = {}) {
  return column(name, 'enum', { ...options, values });
}

function geometryColumn(name, options = {}) {
  return column(name, 'geometry_wkt', options);
}

function sourceIdListColumn(name, refTable, options = {}) {
  return column(name, 'source_id_list', { ...options, refTable });
}

const TABLES = [
  {
    name: 'brands',
    required: true,
    pk: 'brand_id',
    columns: [
      idColumn('brand_id'),
      stringColumn('brand_name', { required: true }),
      stringColumn('brand_slug', { required: true }),
      stringColumn('brand_category'),
      stringColumn('headquarters_city'),
      numberColumn('headquarters_lat'),
      numberColumn('headquarters_lon'),
      integerColumn('founded_year'),
      numberColumn('annual_revenue'),
      enumColumn('social_tier', ['emerging', 'standard', 'premium', 'luxury']),
      timestampColumn('created_at'),
      timestampColumn('updated_at'),
    ],
    uniqueKeys: [['brand_id'], ['brand_slug']],
  },
  {
    name: 'products',
    required: true,
    pk: 'product_id',
    columns: [
      idColumn('product_id'),
      refIdColumn('brand_id'),
      stringColumn('sku', { required: true }),
      stringColumn('product_name', { required: true }),
      stringColumn('description'),
      stringColumn('category'),
      stringColumn('subcategory'),
      numberColumn('unit_price', { required: true }),
      numberColumn('unit_cost'),
      numberColumn('weight_kg'),
      flagColumn('is_active'),
      dateColumn('launch_date'),
      stringColumn('tags'),
      timestampColumn('created_at'),
      timestampColumn('updated_at'),
    ],
    foreignKeys: [
      { column: 'brand_id', refTable: 'brands' },
    ],
    uniqueKeys: [['product_id'], ['sku']],
  },
  {
    name: 'fulfillment_centers',
    required: true,
    pk: 'center_id',
    columns: [
      idColumn('center_id'),
      stringColumn('center_name', { required: true }),
      enumColumn('center_type', ['Enterprise Operations', 'Regional Processing', 'Branch Services', 'drop_ship', 'store']),
      stringColumn('address_line1'),
      stringColumn('city'),
      stringColumn('state_province'),
      stringColumn('postal_code'),
      stringColumn('country'),
      numberColumn('latitude', { required: true }),
      numberColumn('longitude', { required: true }),
      integerColumn('capacity_units'),
      numberColumn('current_load_pct'),
      flagColumn('is_active'),
      stringColumn('operating_hours'),
      timestampColumn('created_at'),
    ],
    uniqueKeys: [['center_id']],
  },
  {
    name: 'customers',
    required: true,
    pk: 'customer_id',
    columns: [
      idColumn('customer_id'),
      stringColumn('email', { required: true }),
      stringColumn('first_name'),
      stringColumn('last_name'),
      stringColumn('city'),
      stringColumn('state_province'),
      stringColumn('postal_code'),
      stringColumn('country'),
      numberColumn('latitude'),
      numberColumn('longitude'),
      enumColumn('customer_tier', ['new', 'standard', 'preferred', 'vip']),
      numberColumn('lifetime_value'),
      timestampColumn('created_at'),
    ],
    uniqueKeys: [['customer_id'], ['email']],
  },
  {
    name: 'influencers',
    required: true,
    pk: 'influencer_id',
    columns: [
      idColumn('influencer_id'),
      stringColumn('handle', { required: true }),
      stringColumn('display_name'),
      enumColumn('platform', ['instagram', 'tiktok', 'twitter', 'youtube', 'threads']),
      integerColumn('follower_count'),
      numberColumn('engagement_rate'),
      numberColumn('influence_score'),
      stringColumn('niche'),
      stringColumn('city'),
      stringColumn('region'),
      stringColumn('country'),
      flagColumn('is_verified'),
      timestampColumn('created_at'),
    ],
    uniqueKeys: [['influencer_id'], ['handle']],
  },
  {
    name: 'social_posts',
    required: true,
    pk: 'post_id',
    columns: [
      idColumn('post_id'),
      column('influencer_id', 'id'),
      stringColumn('platform'),
      stringColumn('external_post_id'),
      stringColumn('post_text'),
      timestampColumn('posted_at', { required: true }),
      integerColumn('likes_count'),
      integerColumn('shares_count'),
      integerColumn('comments_count'),
      integerColumn('views_count'),
      numberColumn('sentiment_score'),
      numberColumn('virality_score'),
      sourceIdListColumn('detected_products', 'products'),
      enumColumn('momentum_flag', ['normal', 'rising', 'viral', 'mega_viral']),
      timestampColumn('processed_at'),
      timestampColumn('created_at'),
    ],
    foreignKeys: [
      { column: 'influencer_id', refTable: 'influencers', allowNull: true },
    ],
    uniqueKeys: [['post_id']],
  },
  {
    name: 'post_product_mentions',
    required: true,
    pk: 'mention_id',
    columns: [
      idColumn('mention_id'),
      refIdColumn('post_id'),
      refIdColumn('product_id'),
      numberColumn('confidence_score'),
      enumColumn('mention_type', ['direct', 'semantic', 'hashtag', 'visual', 'inferred']),
      timestampColumn('created_at'),
    ],
    foreignKeys: [
      { column: 'post_id', refTable: 'social_posts' },
      { column: 'product_id', refTable: 'products' },
    ],
    uniqueKeys: [['mention_id'], ['post_id', 'product_id']],
  },
  {
    name: 'orders',
    required: true,
    pk: 'order_id',
    columns: [
      idColumn('order_id'),
      refIdColumn('customer_id'),
      enumColumn('order_status', ['pending', 'confirmed', 'processing', 'routed', 'completed', 'cancelled', 'returned']),
      numberColumn('order_total'),
      numberColumn('shipping_cost'),
      column('fulfillment_center_id', 'id'),
      numberColumn('shipping_lat'),
      numberColumn('shipping_lon'),
      dateColumn('estimated_delivery'),
      dateColumn('actual_delivery'),
      column('social_source_id', 'id'),
      numberColumn('demand_score'),
      timestampColumn('created_at'),
      timestampColumn('updated_at'),
    ],
    foreignKeys: [
      { column: 'customer_id', refTable: 'customers' },
      { column: 'fulfillment_center_id', refTable: 'fulfillment_centers', allowNull: true },
      { column: 'social_source_id', refTable: 'social_posts', allowNull: true, soft: true },
    ],
    uniqueKeys: [['order_id']],
  },
  {
    name: 'order_items',
    required: true,
    pk: 'item_id',
    columns: [
      idColumn('item_id'),
      refIdColumn('order_id'),
      refIdColumn('product_id'),
      integerColumn('quantity', { required: true }),
      numberColumn('unit_price', { required: true }),
      column('fulfilled_from', 'id'),
    ],
    foreignKeys: [
      { column: 'order_id', refTable: 'orders' },
      { column: 'product_id', refTable: 'products' },
      { column: 'fulfilled_from', refTable: 'fulfillment_centers', allowNull: true },
    ],
    uniqueKeys: [['item_id']],
  },
  {
    name: 'inventory',
    required: true,
    pk: 'inventory_id',
    columns: [
      idColumn('inventory_id'),
      refIdColumn('product_id'),
      refIdColumn('center_id'),
      integerColumn('quantity_on_hand'),
      integerColumn('quantity_reserved'),
      integerColumn('quantity_incoming'),
      integerColumn('reorder_point'),
      integerColumn('reorder_qty'),
      dateColumn('last_restock_date'),
      timestampColumn('updated_at'),
    ],
    foreignKeys: [
      { column: 'product_id', refTable: 'products' },
      { column: 'center_id', refTable: 'fulfillment_centers' },
    ],
    uniqueKeys: [['inventory_id'], ['product_id', 'center_id']],
  },
  {
    name: 'shipments',
    required: false,
    pk: 'shipment_id',
    columns: [
      idColumn('shipment_id'),
      refIdColumn('order_id'),
      refIdColumn('center_id'),
      stringColumn('carrier'),
      stringColumn('tracking_number'),
      enumColumn('ship_status', ['preparing', 'picked', 'packed', 'routed', 'in_transit', 'out_for_delivery', 'completed', 'exception']),
      numberColumn('distance_km'),
      numberColumn('estimated_hours'),
      numberColumn('ship_cost'),
      timestampColumn('routed_at'),
      timestampColumn('completed_at'),
      timestampColumn('created_at'),
    ],
    foreignKeys: [
      { column: 'order_id', refTable: 'orders' },
      { column: 'center_id', refTable: 'fulfillment_centers' },
    ],
    uniqueKeys: [['shipment_id'], ['tracking_number']],
  },
  {
    name: 'demand_regions',
    required: false,
    pk: 'region_id',
    columns: [
      idColumn('region_id'),
      stringColumn('region_name', { required: true }),
      enumColumn('region_type', ['metro', 'state', 'region', 'zip_cluster']),
      geometryColumn('boundary', { required: true }),
      integerColumn('population'),
      numberColumn('avg_income'),
      numberColumn('social_density'),
      numberColumn('demand_index'),
      timestampColumn('updated_at'),
    ],
    uniqueKeys: [['region_id'], ['region_name']],
  },
  {
    name: 'demand_forecasts',
    required: false,
    pk: 'forecast_id',
    columns: [
      idColumn('forecast_id'),
      refIdColumn('product_id'),
      stringColumn('region'),
      dateColumn('forecast_date', { required: true }),
      numberColumn('predicted_demand', { required: true }),
      numberColumn('confidence_low'),
      numberColumn('confidence_high'),
      numberColumn('social_factor'),
      stringColumn('model_version'),
      stringColumn('explanation'),
      timestampColumn('created_at'),
    ],
    foreignKeys: [
      { column: 'product_id', refTable: 'products' },
    ],
    uniqueKeys: [['forecast_id']],
  },
  {
    name: 'influencer_connections',
    required: false,
    pk: 'connection_id',
    columns: [
      idColumn('connection_id'),
      refIdColumn('from_influencer'),
      refIdColumn('to_influencer'),
      enumColumn('connection_type', ['follows', 'collaborates', 'mentioned', 'reshared', 'tagged', 'duet', 'inspired_by'], { required: true }),
      numberColumn('strength'),
      integerColumn('interaction_count'),
      timestampColumn('first_seen'),
      timestampColumn('last_interaction'),
    ],
    foreignKeys: [
      { column: 'from_influencer', refTable: 'influencers' },
      { column: 'to_influencer', refTable: 'influencers' },
    ],
    uniqueKeys: [['connection_id'], ['from_influencer', 'to_influencer', 'connection_type']],
  },
  {
    name: 'brand_influencer_links',
    required: false,
    pk: 'link_id',
    columns: [
      idColumn('link_id'),
      refIdColumn('brand_id'),
      refIdColumn('influencer_id'),
      enumColumn('relationship_type', ['organic', 'sponsored', 'ambassador', 'affiliate', 'competitor_mention']),
      integerColumn('post_count'),
      numberColumn('avg_engagement'),
      numberColumn('revenue_attributed'),
      timestampColumn('first_mention'),
      timestampColumn('last_mention'),
    ],
    foreignKeys: [
      { column: 'brand_id', refTable: 'brands' },
      { column: 'influencer_id', refTable: 'influencers' },
    ],
    uniqueKeys: [['link_id'], ['brand_id', 'influencer_id']],
  },
];

const TABLE_BY_NAME = Object.fromEntries(TABLES.map((table) => [table.name, table]));
const INSERT_ORDER = TABLES.map((table) => table.name);
const REQUIRED_TABLE_NAMES = TABLES.filter((table) => table.required).map((table) => table.name);
const OPTIONAL_TABLE_NAMES = TABLES.filter((table) => !table.required).map((table) => table.name);
const IMPORTABLE_TABLE_NAMES = TABLES.map((table) => table.name);

const DELETE_ORDER = [
  'semantic_matches',
  'signal_embeddings',
  'product_embeddings',
  'brand_influencer_links',
  'influencer_connections',
  'shipments',
  'demand_forecasts',
  'fulfillment_zones',
  'demand_regions',
  'post_product_mentions',
  'order_items',
  'agent_actions',
  'inventory',
  'social_posts',
  'orders',
  'event_stream',
  'customers',
  'fulfillment_centers',
  'products',
  'influencers',
  'brands',
];

const TEMPLATE_NOTES = [
  'ID columns in the CSVs are treated as source reference keys. Oracle identity values are regenerated during import.',
  'Do not include app_users.csv. Application users are preserved.',
  'Derived columns such as customers.location, fulfillment_centers.location, order_items.line_total, fulfillment_zones, and vector embedding tables are regenerated by the importer.',
  'inventory.csv is required. shipments.csv is optional and can be omitted.',
  'When optional graph, shipment, or demand files are omitted, the importer regenerates fallback data.',
  'Domain labels keep the original schema names for compatibility: brands are institutions, products are financial products, influencers are signal sources, and social_posts are regulatory or market bulletins.',
  'For demand_regions.csv, use WKT polygon text in the boundary column. Example: POLYGON((-122.6 37.2, -121.7 37.2, -121.7 38.0, -122.6 38.0, -122.6 37.2)).',
  'Timestamps should use ISO 8601 values when possible, for example 2026-04-13T10:00:00Z.',
  'Dates should use YYYY-MM-DD.',
];

function buildManifest() {
  return {
    version: IMPORT_VERSION,
    format: 'financial-services-import',
    exportedAt: new Date().toISOString(),
    notes: TEMPLATE_NOTES,
    requiredTables: REQUIRED_TABLE_NAMES,
    optionalTables: OPTIONAL_TABLE_NAMES,
    tables: TABLES.map((table) => ({
      name: table.name,
      file: `${table.name}.csv`,
      required: table.required,
      primaryKey: table.pk,
      columns: table.columns.map((col) => ({
        name: col.name,
        type: col.type,
        required: Boolean(col.required),
        values: col.values || undefined,
        sourceId: Boolean(col.sourceId),
        refTable: col.refTable || undefined,
      })),
    })),
  };
}

module.exports = {
  IMPORT_VERSION,
  TABLES,
  TABLE_BY_NAME,
  INSERT_ORDER,
  DELETE_ORDER,
  IMPORTABLE_TABLE_NAMES,
  REQUIRED_TABLE_NAMES,
  OPTIONAL_TABLE_NAMES,
  TEMPLATE_NOTES,
  buildManifest,
};
