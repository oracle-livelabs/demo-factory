-- Finance LiveStack native Select AI / Select AI Agent bootstrap.
--
-- Run as APP_USER after:
--   1. the Finance handoff loader has created the schema; and
--   2. DBMS_CLOUD credential FIN_GENAI_KEY_V1 has been created in APP_USER.
--
-- ADMIN must grant APP_USER direct EXECUTE on DBMS_CLOUD, DBMS_CLOUD_AI,
-- and DBMS_CLOUD_AI_AGENT before this script is invoked.
--
-- SQLcl invocation contract (UTF-8 values encoded as hexadecimal):
--   @finance-native-ai-bootstrap.sql <region_hex> <model_hex> <compartment_ocid_hex>
--
-- Hexadecimal arguments keep SQLcl substitution values quote-free. The caller
-- must hex-encode the exact OCI_GENAI_REGION, OCI_GENAI_MODEL_ID, and
-- OCI_COMPARTMENT_OCID values and must require FINANCE_NATIVE_AI_ACCEPTANCE_OK.

SET ECHO OFF
SET FEEDBACK ON
SET HEADING OFF
SET PAGESIZE 0
SET SERVEROUTPUT ON SIZE UNLIMITED
SET VERIFY OFF
SET DEFINE ON
WHENEVER OSERROR EXIT FAILURE ROLLBACK
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK

DEFINE fin_genai_region_hex = '&1'
DEFINE fin_genai_model_hex = '&2'
DEFINE fin_genai_compartment_hex = '&3'

-- DDL must complete in its own SQL unit before the following PL/SQL unit is
-- compiled. A static MERGE cannot resolve a table that is created dynamically
-- later in the same PL/SQL unit during a fresh deployment.
BEGIN
  EXECUTE IMMEDIATE q'[
    CREATE TABLE finance_native_ai_state (
      state_key        VARCHAR2(30)   NOT NULL,
      status           VARCHAR2(16)   NOT NULL,
      provider         VARCHAR2(30)   NOT NULL,
      profile_name     VARCHAR2(128)  NOT NULL,
      region           VARCHAR2(64)   NOT NULL,
      model_id         VARCHAR2(255)  NOT NULL,
      compartment_ocid VARCHAR2(255)  NOT NULL,
      read_only_flag   CHAR(1)        DEFAULT 'Y' NOT NULL,
      installed_at     TIMESTAMP WITH TIME ZONE,
      validated_at     TIMESTAMP WITH TIME ZONE,
      last_error       VARCHAR2(2000),
      CONSTRAINT finance_native_ai_state_pk PRIMARY KEY (state_key),
      CONSTRAINT finance_native_ai_state_key_ck CHECK (state_key = 'PRIMARY'),
      CONSTRAINT finance_native_ai_state_status_ck
        CHECK (status IN ('INSTALLING', 'READY', 'FAILED')),
      CONSTRAINT finance_native_ai_state_ro_ck CHECK (read_only_flag = 'Y')
    )
  ]';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE <> -955 THEN
      RAISE;
    END IF;
END;
/

DECLARE
  l_region_hex      VARCHAR2(512)  := '&&fin_genai_region_hex';
  l_model_hex       VARCHAR2(1024) := '&&fin_genai_model_hex';
  l_compartment_hex VARCHAR2(2048) := '&&fin_genai_compartment_hex';
  l_region          VARCHAR2(64);
  l_model           VARCHAR2(255);
  l_compartment     VARCHAR2(255);
  l_count           PLS_INTEGER;

  FUNCTION decode_hex(
    p_name       IN VARCHAR2,
    p_hex        IN VARCHAR2,
    p_max_bytes  IN PLS_INTEGER
  ) RETURN VARCHAR2 IS
    l_value VARCHAR2(32767);
  BEGIN
    IF p_hex IS NULL
       OR MOD(LENGTH(p_hex), 2) <> 0
       OR NOT REGEXP_LIKE(p_hex, '^[0-9A-Fa-f]+$')
       OR LENGTH(p_hex) > p_max_bytes * 2
    THEN
      RAISE_APPLICATION_ERROR(-20801, p_name || ' must be non-empty UTF-8 hexadecimal.');
    END IF;

    l_value := UTL_I18N.RAW_TO_CHAR(HEXTORAW(p_hex), 'AL32UTF8');
    IF l_value IS NULL OR LENGTHB(l_value) > p_max_bytes THEN
      RAISE_APPLICATION_ERROR(-20802, p_name || ' decoded to an invalid value.');
    END IF;
    RETURN l_value;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLCODE BETWEEN -20899 AND -20800 THEN
        RAISE;
      END IF;
      RAISE_APPLICATION_ERROR(-20803, p_name || ' could not be decoded.');
  END decode_hex;
BEGIN
  IF USER <> 'APP_USER' THEN
    RAISE_APPLICATION_ERROR(-20804, 'Native AI bootstrap must run as APP_USER.');
  END IF;

  l_region      := decode_hex('OCI GenAI region', l_region_hex, 64);
  l_model       := decode_hex('OCI GenAI model', l_model_hex, 255);
  l_compartment := decode_hex('OCI compartment or tenancy OCID', l_compartment_hex, 255);

  IF NOT REGEXP_LIKE(l_region, '^[a-z]{2}(-[a-z0-9]+)+-[0-9]+$') THEN
    RAISE_APPLICATION_ERROR(-20805, 'OCI GenAI region has an invalid format.');
  END IF;
  IF NOT REGEXP_LIKE(l_model, '^cohere[.][A-Za-z0-9._-]+$') THEN
    RAISE_APPLICATION_ERROR(-20806, 'This build accepts only OCI Cohere model identifiers.');
  END IF;
  IF NOT REGEXP_LIKE(
       l_compartment,
       '^ocid1[.](compartment|tenancy)[.][A-Za-z0-9_-]+[.][A-Za-z0-9._-]+$'
     )
  THEN
    RAISE_APPLICATION_ERROR(-20807, 'OCI compartment or tenancy OCID has an invalid format.');
  END IF;

  SELECT COUNT(*)
    INTO l_count
    FROM user_credentials
   WHERE credential_name = 'FIN_GENAI_KEY_V1';
  IF l_count <> 1 THEN
    RAISE_APPLICATION_ERROR(
      -20808,
      'Required APP_USER credential FIN_GENAI_KEY_V1 is unavailable.'
    );
  END IF;

  SELECT COUNT(*)
    INTO l_count
    FROM user_views
   WHERE view_name IN (
     'FINANCE_INSTITUTIONS_V',
     'FINANCE_PRODUCTS_V',
     'RISK_SIGNALS_V',
     'SIGNAL_SOURCES_V',
     'CLIENT_TRANSACTIONS_V',
     'SERVICE_CENTERS_V',
     'SERVICE_CAPACITY_V',
     'SERVICE_ROUTES_V'
   );
  IF l_count <> 8 THEN
    RAISE_APPLICATION_ERROR(-20809, 'Required Finance semantic views are unavailable.');
  END IF;

  SELECT COUNT(*)
    INTO l_count
    FROM user_tables
   WHERE table_name IN (
     'POST_PRODUCT_MENTIONS',
     'ORDER_ITEMS',
     'FRAUD_CASES',
     'FRAUD_CASE_ENTITIES',
     'FRAUD_ENTITIES'
   );
  IF l_count <> 5 THEN
    RAISE_APPLICATION_ERROR(-20810, 'Required Finance advisory source tables are unavailable.');
  END IF;

  MERGE INTO finance_native_ai_state target
  USING (
    SELECT
      'PRIMARY'             AS state_key,
      l_region              AS region,
      l_model               AS model_id,
      l_compartment         AS compartment_ocid
    FROM dual
  ) source
  ON (target.state_key = source.state_key)
  WHEN MATCHED THEN UPDATE SET
    target.status           = 'INSTALLING',
    target.provider         = 'oci',
    target.profile_name     = 'FINANCE_SELECTAI_V1',
    target.region           = source.region,
    target.model_id         = source.model_id,
    target.compartment_ocid = source.compartment_ocid,
    target.read_only_flag   = 'Y',
    target.installed_at     = SYSTIMESTAMP,
    target.validated_at     = NULL,
    target.last_error       = NULL
  WHEN NOT MATCHED THEN INSERT (
    state_key,
    status,
    provider,
    profile_name,
    region,
    model_id,
    compartment_ocid,
    read_only_flag,
    installed_at
  ) VALUES (
    source.state_key,
    'INSTALLING',
    'oci',
    'FINANCE_SELECTAI_V1',
    source.region,
    source.model_id,
    source.compartment_ocid,
    'Y',
    SYSTIMESTAMP
  );
  COMMIT;
END;
/

SET DEFINE OFF

-- Curated, read-only semantic views for native Select AI. These views exclude
-- application identities, credential metadata, raw customer contact fields,
-- and mutable audit/configuration tables.
CREATE OR REPLACE VIEW finance_signal_product_exposure_v AS
SELECT
  sig.signal_id,
  sig.signal_text,
  sig.criticality_score,
  sig.severity_band,
  sig.exposure_count,
  sig.acknowledgement_count,
  sig.escalation_count,
  sig.cases_opened_count,
  sig.signal_time,
  product.financial_product_id,
  product.financial_product_name,
  product.product_category,
  product.subcategory,
  mention.confidence_score AS product_match_confidence,
  mention.mention_type AS product_match_type
FROM risk_signals_v sig
JOIN post_product_mentions mention
  ON mention.post_id = sig.signal_id
JOIN finance_products_v product
  ON product.financial_product_id = mention.product_id;

CREATE OR REPLACE VIEW finance_transaction_exposure_v AS
SELECT
  txn.transaction_id,
  txn.transaction_status,
  txn.transaction_value,
  txn.service_fee,
  txn.service_center_id,
  txn.risk_signal_id,
  txn.urgency_score,
  txn.created_at,
  item.item_id AS transaction_line_id,
  item.quantity,
  item.unit_price,
  item.line_total AS line_exposure,
  product.financial_product_id,
  product.financial_product_name,
  product.product_category,
  product.subcategory,
  product.institution_id
FROM client_transactions_v txn
JOIN order_items item
  ON item.order_id = txn.transaction_id
JOIN finance_products_v product
  ON product.financial_product_id = item.product_id;

CREATE OR REPLACE VIEW finance_service_pressure_v AS
WITH capacity AS (
  SELECT
    service_center_id,
    SUM(processing_capacity) AS total_processing_capacity,
    SUM(active_processing_load) AS active_processing_load,
    SUM(incoming_capacity) AS incoming_capacity,
    SUM(
      CASE
        WHEN processing_capacity <= minimum_capacity_threshold THEN 1
        ELSE 0
      END
    ) AS constrained_product_count
  FROM service_capacity_v
  GROUP BY service_center_id
),
transactions AS (
  SELECT
    service_center_id,
    COUNT(*) AS transaction_count,
    SUM(
      CASE
        WHEN transaction_status IN ('pending', 'confirmed', 'processing') THEN 1
        ELSE 0
      END
    ) AS open_transaction_count,
    SUM(transaction_value) AS transaction_exposure,
    AVG(urgency_score) AS average_urgency_score
  FROM client_transactions_v
  WHERE service_center_id IS NOT NULL
  GROUP BY service_center_id
)
SELECT
  center.service_center_id,
  center.service_center_name,
  center.service_center_type,
  center.city,
  center.state_province,
  center.processing_capacity AS configured_processing_capacity,
  center.utilization_pct,
  center.is_active,
  NVL(capacity.total_processing_capacity, 0) AS product_processing_capacity,
  NVL(capacity.active_processing_load, 0) AS active_processing_load,
  NVL(capacity.incoming_capacity, 0) AS incoming_capacity,
  NVL(capacity.constrained_product_count, 0) AS constrained_product_count,
  NVL(transactions.transaction_count, 0) AS transaction_count,
  NVL(transactions.open_transaction_count, 0) AS open_transaction_count,
  NVL(transactions.transaction_exposure, 0) AS transaction_exposure,
  NVL(transactions.average_urgency_score, 0) AS average_urgency_score
FROM service_centers_v center
LEFT JOIN capacity
  ON capacity.service_center_id = center.service_center_id
LEFT JOIN transactions
  ON transactions.service_center_id = center.service_center_id;

CREATE OR REPLACE VIEW finance_fraud_case_exposure_v AS
SELECT
  fraud_case.case_id,
  fraud_case.case_ref,
  fraud_case.case_type,
  fraud_case.status AS case_status,
  fraud_case.risk_score AS case_risk_score,
  fraud_case.loss_amount,
  fraud_case.event_count AS case_event_count,
  fraud_case.opened_at,
  fraud_case.updated_at,
  COUNT(case_entity.case_entity_id) AS connected_entity_count,
  SUM(entity.total_amount) AS connected_entity_value,
  SUM(entity.event_count) AS connected_entity_event_count,
  MAX(entity.risk_score) AS highest_connected_entity_risk,
  SUM(CASE WHEN entity.is_confirmed_fraud = 1 THEN 1 ELSE 0 END)
    AS confirmed_fraud_entity_count,
  MAX(case_entity.evidence_score) AS highest_evidence_score
FROM fraud_cases fraud_case
LEFT JOIN fraud_case_entities case_entity
  ON case_entity.case_id = fraud_case.case_id
LEFT JOIN fraud_entities entity
  ON entity.entity_id = case_entity.entity_id
GROUP BY
  fraud_case.case_id,
  fraud_case.case_ref,
  fraud_case.case_type,
  fraud_case.status,
  fraud_case.risk_score,
  fraud_case.loss_amount,
  fraud_case.event_count,
  fraud_case.opened_at,
  fraud_case.updated_at;

COMMENT ON TABLE finance_institutions_v IS
  'Read-only financial institution dimension for Select AI.';
COMMENT ON TABLE finance_products_v IS
  'Read-only financial products and services dimension for Select AI.';
COMMENT ON TABLE risk_signals_v IS
  'Read-only fraud, compliance, market, and operations risk signals for Select AI.';
COMMENT ON TABLE signal_sources_v IS
  'Read-only regulatory, fraud, market, and operations signal sources for Select AI.';
COMMENT ON TABLE client_transactions_v IS
  'Read-only transaction facts with status, exposure, service center, risk signal, and urgency.';
COMMENT ON TABLE service_centers_v IS
  'Read-only operations and service center dimension for Select AI.';
COMMENT ON TABLE service_capacity_v IS
  'Read-only financial product processing capacity by operations center.';
COMMENT ON TABLE service_routes_v IS
  'Read-only transaction service-routing facts for Select AI.';
COMMENT ON TABLE finance_signal_product_exposure_v IS
  'Read-only mapping of risk signals to affected financial products with match confidence.';
COMMENT ON TABLE finance_transaction_exposure_v IS
  'Read-only transaction line exposure by financial product and category.';
COMMENT ON TABLE finance_service_pressure_v IS
  'Read-only operations center utilization, constrained capacity, open work, and exposure.';
COMMENT ON TABLE finance_fraud_case_exposure_v IS
  'Read-only fraud case risk, loss, connected-entity exposure, and evidence summary.';

DECLARE
  l_region          VARCHAR2(64);
  l_model           VARCHAR2(255);
  l_compartment     VARCHAR2(255);
  l_profile_attrs   CLOB;
  l_tool_attrs      CLOB;
  l_agent_attrs     CLOB;
  l_task_attrs      CLOB;
  l_team_attrs      CLOB;
  l_count           PLS_INTEGER;

  PROCEDURE mark_failed(p_error IN VARCHAR2) IS
    PRAGMA AUTONOMOUS_TRANSACTION;
  BEGIN
    UPDATE finance_native_ai_state
       SET status = 'FAILED',
           validated_at = NULL,
           last_error = SUBSTR(p_error, 1, 2000)
     WHERE state_key = 'PRIMARY';
    COMMIT;
  END mark_failed;

  PROCEDURE create_worker(
    p_agent_name  IN VARCHAR2,
    p_task_name   IN VARCHAR2,
    p_team_name   IN VARCHAR2,
    p_role        IN VARCHAR2,
    p_instruction IN VARCHAR2,
    p_description IN VARCHAR2
  ) IS
  BEGIN
    SELECT JSON_OBJECT(
             'profile_name' VALUE 'FINANCE_SELECTAI_V1',
             'role' VALUE p_role,
             'enable_human_tool' VALUE 'false' FORMAT JSON,
             'short_term_memory_length' VALUE 5
             RETURNING CLOB
           )
      INTO l_agent_attrs
      FROM dual;

    DBMS_CLOUD_AI_AGENT.CREATE_AGENT(
      agent_name  => p_agent_name,
      attributes  => l_agent_attrs,
      status      => 'ENABLED',
      description => p_description
    );

    SELECT JSON_OBJECT(
             'instruction' VALUE
               'Use only the governed, VPD-filtered evidence embedded in the request. ' ||
               'No database tool is attached to this task. Do not request, infer, or ' ||
               'claim additional database facts, names, counts, amounts, severities, ' ||
               'confidence scores, dates, capacity, status, or actions. If the supplied ' ||
               'evidence is insufficient, state what a human should retrieve. ' ||
               'Return one concise advisory answer without requesting human input. ' ||
               p_instruction,
             'enable_human_tool' VALUE 'false' FORMAT JSON
             RETURNING CLOB
           )
      INTO l_task_attrs
      FROM dual;

    DBMS_CLOUD_AI_AGENT.CREATE_TASK(
      task_name   => p_task_name,
      attributes  => l_task_attrs,
      status      => 'ENABLED',
      description => p_description
    );

    SELECT JSON_OBJECT(
             'agents' VALUE JSON_ARRAY(
               JSON_OBJECT(
                 'name' VALUE p_agent_name,
                 'task' VALUE p_task_name
               )
             ) FORMAT JSON,
             'process' VALUE 'sequential',
             'long_term_memory_length' VALUE 5
             RETURNING CLOB
           )
      INTO l_team_attrs
      FROM dual;

    DBMS_CLOUD_AI_AGENT.CREATE_TEAM(
      team_name   => p_team_name,
      attributes  => l_team_attrs,
      status      => 'ENABLED',
      description => p_description
    );
  END create_worker;
BEGIN
  SELECT region, model_id, compartment_ocid
    INTO l_region, l_model, l_compartment
    FROM finance_native_ai_state
   WHERE state_key = 'PRIMARY'
     AND status = 'INSTALLING';

  SELECT COUNT(*)
    INTO l_count
    FROM user_credentials
   WHERE credential_name = 'FIN_GENAI_KEY_V1';
  IF l_count <> 1 THEN
    RAISE_APPLICATION_ERROR(-20811, 'OCI signing-key credential is unavailable.');
  END IF;

  -- Drop only assets owned by this bootstrap. FORCE makes retries idempotent.
  DBMS_CLOUD_AI_AGENT.DROP_TEAM('SOCIAL_TREND_TEAM', TRUE);
  DBMS_CLOUD_AI_AGENT.DROP_TEAM('FULFILLMENT_TEAM', TRUE);
  DBMS_CLOUD_AI_AGENT.DROP_TEAM('COMMERCE_TEAM', TRUE);
  DBMS_CLOUD_AI_AGENT.DROP_TEAM('FINANCE_OPERATIONS_TEAM', TRUE);

  DBMS_CLOUD_AI_AGENT.DROP_TASK('FIN_RISK_SIGNAL_TASK', TRUE);
  DBMS_CLOUD_AI_AGENT.DROP_TASK('FIN_SERVICE_PRESSURE_TASK', TRUE);
  DBMS_CLOUD_AI_AGENT.DROP_TASK('FIN_EXPOSURE_TASK', TRUE);

  DBMS_CLOUD_AI_AGENT.DROP_AGENT('FIN_RISK_SIGNAL_AGENT', TRUE);
  DBMS_CLOUD_AI_AGENT.DROP_AGENT('FIN_SERVICE_PRESSURE_AGENT', TRUE);
  DBMS_CLOUD_AI_AGENT.DROP_AGENT('FIN_EXPOSURE_AGENT', TRUE);
  DBMS_CLOUD_AI_AGENT.DROP_AGENT('FIN_OPERATIONS_SUPERVISOR', TRUE);

  DBMS_CLOUD_AI_AGENT.DROP_TOOL('FINANCE_READONLY_SQL_TOOL', TRUE);

  SELECT COUNT(*)
    INTO l_count
    FROM user_cloud_ai_profiles
   WHERE profile_name = 'FINANCE_SELECTAI_V1';
  IF l_count > 0 THEN
    DBMS_CLOUD_AI.DROP_PROFILE('FINANCE_SELECTAI_V1');
  END IF;

  SELECT JSON_OBJECT(
           'provider' VALUE 'oci',
           'credential_name' VALUE 'FIN_GENAI_KEY_V1',
           'region' VALUE l_region,
           'model' VALUE l_model,
           'oci_compartment_id' VALUE l_compartment,
           'oci_apiformat' VALUE 'COHERE',
           'object_list' VALUE JSON_ARRAY(
             JSON_OBJECT('owner' VALUE 'APP_USER', 'name' VALUE 'FINANCE_INSTITUTIONS_V'),
             JSON_OBJECT('owner' VALUE 'APP_USER', 'name' VALUE 'FINANCE_PRODUCTS_V'),
             JSON_OBJECT('owner' VALUE 'APP_USER', 'name' VALUE 'RISK_SIGNALS_V'),
             JSON_OBJECT('owner' VALUE 'APP_USER', 'name' VALUE 'SIGNAL_SOURCES_V'),
             JSON_OBJECT('owner' VALUE 'APP_USER', 'name' VALUE 'CLIENT_TRANSACTIONS_V'),
             JSON_OBJECT('owner' VALUE 'APP_USER', 'name' VALUE 'SERVICE_CENTERS_V'),
             JSON_OBJECT('owner' VALUE 'APP_USER', 'name' VALUE 'SERVICE_CAPACITY_V'),
             JSON_OBJECT('owner' VALUE 'APP_USER', 'name' VALUE 'SERVICE_ROUTES_V'),
             JSON_OBJECT(
               'owner' VALUE 'APP_USER',
               'name' VALUE 'FINANCE_SIGNAL_PRODUCT_EXPOSURE_V'
             ),
             JSON_OBJECT(
               'owner' VALUE 'APP_USER',
               'name' VALUE 'FINANCE_TRANSACTION_EXPOSURE_V'
             ),
             JSON_OBJECT(
               'owner' VALUE 'APP_USER',
               'name' VALUE 'FINANCE_SERVICE_PRESSURE_V'
             ),
             JSON_OBJECT(
               'owner' VALUE 'APP_USER',
               'name' VALUE 'FINANCE_FRAUD_CASE_EXPOSURE_V'
             )
           ) FORMAT JSON,
           'object_list_mode' VALUE 'all',
           'enforce_object_list' VALUE 'true' FORMAT JSON,
           'comments' VALUE 'true' FORMAT JSON,
           'constraints' VALUE 'false' FORMAT JSON,
           'temperature' VALUE 0,
           'max_tokens' VALUE 2048,
           'seed' VALUE 42,
           'conversation' VALUE 'false',
           'role' VALUE
             'You are a finance analytics assistant operating inside Oracle Autonomous AI Database.',
           'additional_instructions' VALUE
             'For SQL actions, generate exactly one read-only SELECT or WITH query. ' ||
             'Use only the curated views in the object list. Never use base tables, ' ||
             'data dictionary objects, stored routines, sequences, DML, DDL, PL/SQL, ' ||
             'or administrative packages. ' ||
             'Treat all agent findings as advisory and do not claim that an action was executed.'
           RETURNING CLOB
         )
    INTO l_profile_attrs
    FROM dual;

  DBMS_CLOUD_AI.CREATE_PROFILE(
    profile_name => 'FINANCE_SELECTAI_V1',
    attributes   => l_profile_attrs,
    status       => 'ENABLED',
    description  => 'OCI Generative AI profile over curated read-only Finance views'
  );

  SELECT JSON_OBJECT(
           'tool_type' VALUE 'SQL',
           'tool_params' VALUE JSON_OBJECT(
             'profile_name' VALUE 'FINANCE_SELECTAI_V1'
           ) FORMAT JSON,
           'instruction' VALUE
             'Use this tool only for direct Finance validation with one read-only query. ' ||
             'Execute at most one query per direct validation call and return immediately ' ||
             'after the first result. ' ||
             'Use RUNSQL for factual evidence and SHOWSQL when the user asks to inspect SQL. ' ||
             'Never call stored routines or sequences, and never request or attempt DML, ' ||
             'DDL, PL/SQL, notifications, or external actions.'
           RETURNING CLOB
         )
    INTO l_tool_attrs
    FROM dual;

  DBMS_CLOUD_AI_AGENT.CREATE_TOOL(
    tool_name   => 'FINANCE_READONLY_SQL_TOOL',
    attributes  => l_tool_attrs,
    status      => 'ENABLED',
    description =>
      'Curated Select AI SQL tool reserved for direct RUN_TOOL validation; ' ||
      'deliberately not attached to advisory agent tasks'
  );

  create_worker(
    p_agent_name  => 'FIN_RISK_SIGNAL_AGENT',
    p_task_name   => 'FIN_RISK_SIGNAL_TASK',
    p_team_name   => 'SOCIAL_TREND_TEAM',
    p_role        =>
      'You are a Finance fraud, AML, compliance, and market-risk signal analyst. ' ||
      'You investigate evidence and provide advisory findings only.',
    p_instruction =>
      'Analyze this Finance risk-signal question: {query}. Use only the supplied ' ||
      'governed evidence for database facts. Cite relevant product, severity, ' ||
      'confidence, and time values. ' ||
      'Return advisory findings and suggested human review steps only. Never modify data ' ||
      'or claim that you performed an operational action.',
    p_description => 'Read-only Finance risk and compliance signal advisory team'
  );

  create_worker(
    p_agent_name  => 'FIN_SERVICE_PRESSURE_AGENT',
    p_task_name   => 'FIN_SERVICE_PRESSURE_TASK',
    p_team_name   => 'FULFILLMENT_TEAM',
    p_role        =>
      'You are a Finance service-capacity and investigation-SLA analyst. ' ||
      'You assess operational pressure and provide advisory findings only.',
    p_instruction =>
      'Analyze this Finance service-capacity question: {query}. Use only the supplied ' ||
      'governed evidence for database facts. Cite center utilization, open work, capacity ' ||
      'constraints, exposure, and urgency where relevant. Recommend human review only. ' ||
      'Never route work, update capacity, modify data, or claim an action was executed.',
    p_description => 'Read-only Finance service pressure advisory team'
  );

  create_worker(
    p_agent_name  => 'FIN_EXPOSURE_AGENT',
    p_task_name   => 'FIN_EXPOSURE_TASK',
    p_team_name   => 'COMMERCE_TEAM',
    p_role        =>
      'You are a Finance transaction, product, and fraud-case exposure analyst. ' ||
      'You quantify evidence and provide advisory findings only.',
    p_instruction =>
      'Analyze this Finance exposure question: {query}. Use only the supplied governed ' ||
      'evidence for database facts. Cite product categories, transaction values, fraud ' ||
      'case risk, loss, or connected-entity exposure where relevant. Return advisory ' ||
      'findings and human decision points only. Never modify data or claim an action was executed.',
    p_description => 'Read-only Finance transaction and fraud exposure advisory team'
  );

  SELECT JSON_OBJECT(
           'profile_name' VALUE 'FINANCE_SELECTAI_V1',
           'role' VALUE
             'You supervise Finance advisory analysis. Route each user request to the ' ||
             'most relevant configured specialist. Use the risk signal specialist for ' ||
             'fraud, AML, compliance, market, or product signals; the service pressure ' ||
             'specialist for operations centers, capacity, routing, or SLA pressure; ' ||
             'and the exposure specialist for transactions, products, institutions, ' ||
             'fraud cases, losses, or connected-entity exposure. ' ||
             'Delegate to exactly one specialist for evidence work and synthesize that ' ||
             'single worker result. Specialists have no tools and must use only the ' ||
             'governed evidence embedded in the request. All output is advisory and read-only.',
           'enable_human_tool' VALUE 'false' FORMAT JSON,
           'short_term_memory_length' VALUE 5,
           'supervisor' VALUE 'true' FORMAT JSON
           RETURNING CLOB
         )
    INTO l_agent_attrs
    FROM dual;

  DBMS_CLOUD_AI_AGENT.CREATE_AGENT(
    agent_name  => 'FIN_OPERATIONS_SUPERVISOR',
    attributes  => l_agent_attrs,
    status      => 'ENABLED',
    description => 'Routes Finance questions to native read-only specialist agents'
  );

  SELECT JSON_OBJECT(
           'process' VALUE 'sequential',
           'supervisor_agent' VALUE 'FIN_OPERATIONS_SUPERVISOR',
           'agents' VALUE JSON_ARRAY(
             JSON_OBJECT(
               'name' VALUE 'FIN_RISK_SIGNAL_AGENT',
               'task' VALUE 'FIN_RISK_SIGNAL_TASK'
             ),
             JSON_OBJECT(
               'name' VALUE 'FIN_SERVICE_PRESSURE_AGENT',
               'task' VALUE 'FIN_SERVICE_PRESSURE_TASK'
             ),
             JSON_OBJECT(
               'name' VALUE 'FIN_EXPOSURE_AGENT',
               'task' VALUE 'FIN_EXPOSURE_TASK'
             )
           ) FORMAT JSON,
           'long_term_memory_length' VALUE 5
           RETURNING CLOB
         )
    INTO l_team_attrs
    FROM dual;

  DBMS_CLOUD_AI_AGENT.CREATE_TEAM(
    team_name   => 'FINANCE_OPERATIONS_TEAM',
    attributes  => l_team_attrs,
    status      => 'ENABLED',
    description => 'Native supervisor-led Finance advisory team; read-only'
  );
EXCEPTION
  WHEN OTHERS THEN
    mark_failed(SQLERRM);
    RAISE;
END;
/

CREATE OR REPLACE PACKAGE finance_native_ai_pkg AUTHID DEFINER AS
  c_profile_name CONSTANT VARCHAR2(128) := 'FINANCE_SELECTAI_V1';
  c_signal_team  CONSTANT VARCHAR2(128) := 'SOCIAL_TREND_TEAM';
  c_service_team CONSTANT VARCHAR2(128) := 'FULFILLMENT_TEAM';
  c_exposure_team CONSTANT VARCHAR2(128) := 'COMMERCE_TEAM';
  c_operations_team CONSTANT VARCHAR2(128) := 'FINANCE_OPERATIONS_TEAM';

  FUNCTION readiness_json RETURN CLOB;

  FUNCTION is_safe_sql(
    p_sql IN CLOB
  ) RETURN NUMBER DETERMINISTIC;

  FUNCTION create_conversation(
    p_title IN VARCHAR2 DEFAULT NULL
  ) RETURN VARCHAR2;

  FUNCTION generate_text(
    p_action          IN VARCHAR2,
    p_prompt          IN CLOB,
    p_profile_name    IN VARCHAR2 DEFAULT 'FINANCE_SELECTAI_V1',
    p_conversation_id IN VARCHAR2 DEFAULT NULL
  ) RETURN CLOB;

  FUNCTION run_agent(
    p_team_name       IN VARCHAR2,
    p_prompt          IN CLOB,
    p_conversation_id IN VARCHAR2 DEFAULT NULL
  ) RETURN CLOB;

  FUNCTION get_team_state(
    p_team_name       IN VARCHAR2,
    p_conversation_id IN VARCHAR2
  ) RETURN VARCHAR2;
END finance_native_ai_pkg;
/

CREATE OR REPLACE PACKAGE BODY finance_native_ai_pkg AS
  c_max_prompt_chars CONSTANT PLS_INTEGER := 16000;

  FUNCTION managed_team(
    p_team_name IN VARCHAR2
  ) RETURN VARCHAR2 IS
    l_team VARCHAR2(32767) := UPPER(TRIM(p_team_name));
  BEGIN
    IF l_team IS NULL
       OR LENGTH(l_team) > 128
       OR l_team NOT IN (
         c_signal_team,
         c_service_team,
         c_exposure_team,
         c_operations_team
       )
    THEN
      RAISE_APPLICATION_ERROR(-20828, 'Unknown or invalid managed Finance advisory team.');
    END IF;
    RETURN l_team;
  END managed_team;

  FUNCTION enabled_count(
    p_kind IN VARCHAR2
  ) RETURN PLS_INTEGER IS
    l_count PLS_INTEGER;
  BEGIN
    CASE p_kind
      WHEN 'PROFILE' THEN
        SELECT COUNT(*)
          INTO l_count
          FROM user_cloud_ai_profiles
         WHERE profile_name = c_profile_name
           AND UPPER(status) = 'ENABLED';
      WHEN 'TOOL' THEN
        SELECT COUNT(*)
          INTO l_count
          FROM user_ai_agent_tools
         WHERE tool_name = 'FINANCE_READONLY_SQL_TOOL'
           AND UPPER(status) = 'ENABLED';
      WHEN 'AGENT' THEN
        SELECT COUNT(*)
          INTO l_count
          FROM user_ai_agents
         WHERE agent_name IN (
           'FIN_RISK_SIGNAL_AGENT',
           'FIN_SERVICE_PRESSURE_AGENT',
           'FIN_EXPOSURE_AGENT',
           'FIN_OPERATIONS_SUPERVISOR'
         )
           AND UPPER(status) = 'ENABLED';
      WHEN 'TASK' THEN
        SELECT COUNT(*)
          INTO l_count
          FROM user_ai_agent_tasks
         WHERE task_name IN (
           'FIN_RISK_SIGNAL_TASK',
           'FIN_SERVICE_PRESSURE_TASK',
           'FIN_EXPOSURE_TASK'
         )
           AND UPPER(status) = 'ENABLED';
      WHEN 'TEAM' THEN
        SELECT COUNT(*)
          INTO l_count
         FROM user_ai_agent_teams
         WHERE agent_team_name IN (
           c_signal_team,
           c_service_team,
           c_exposure_team,
           c_operations_team
         )
           AND UPPER(status) = 'ENABLED';
      ELSE
        RAISE_APPLICATION_ERROR(-20820, 'Unknown native AI readiness object kind.');
    END CASE;
    RETURN l_count;
  END enabled_count;

  PROCEDURE assert_ready IS
    l_state VARCHAR2(16);
  BEGIN
    SELECT status
      INTO l_state
      FROM finance_native_ai_state
     WHERE state_key = 'PRIMARY';

    IF l_state <> 'READY'
       OR enabled_count('PROFILE') <> 1
       OR enabled_count('TOOL') <> 1
       OR enabled_count('AGENT') <> 4
       OR enabled_count('TASK') <> 3
       OR enabled_count('TEAM') <> 4
    THEN
      RAISE_APPLICATION_ERROR(-20821, 'Native Select AI is not ready.');
    END IF;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20821, 'Native Select AI is not ready.');
  END assert_ready;

  PROCEDURE assert_prompt(p_prompt IN CLOB) IS
  BEGIN
    IF p_prompt IS NULL
       OR DBMS_LOB.GETLENGTH(p_prompt) < 1
       OR DBMS_LOB.GETLENGTH(p_prompt) > c_max_prompt_chars
       OR TRIM(DBMS_LOB.SUBSTR(p_prompt, 4000, 1)) IS NULL
    THEN
      RAISE_APPLICATION_ERROR(
        -20822,
        'Prompt must contain between 1 and ' || c_max_prompt_chars || ' characters.'
      );
    END IF;
  END assert_prompt;

  FUNCTION conversation_params(
    p_conversation_id IN VARCHAR2
  ) RETURN CLOB IS
    l_params CLOB;
  BEGIN
    IF p_conversation_id IS NULL THEN
      RETURN NULL;
    END IF;
    IF LENGTH(p_conversation_id) > 128
       OR NOT REGEXP_LIKE(p_conversation_id, '^[A-Za-z0-9._:-]+$')
    THEN
      RAISE_APPLICATION_ERROR(-20823, 'Conversation identifier has an invalid format.');
    END IF;
    SELECT JSON_OBJECT(
             'conversation_id' VALUE p_conversation_id
             RETURNING CLOB
           )
      INTO l_params
      FROM dual;
    RETURN l_params;
  END conversation_params;

  FUNCTION create_conversation(
    p_title IN VARCHAR2 DEFAULT NULL
  ) RETURN VARCHAR2 IS
    l_title      VARCHAR2(200) := TRIM(p_title);
    l_attributes CLOB;
    l_id         VARCHAR2(128);
  BEGIN
    assert_ready;
    IF p_title IS NOT NULL
       AND (
         l_title IS NULL
         OR LENGTH(l_title) > 200
         OR REGEXP_LIKE(l_title, '[[:cntrl:]]')
       )
    THEN
      RAISE_APPLICATION_ERROR(
        -20837,
        'Conversation title must contain 1 to 200 printable characters.'
      );
    END IF;

    SELECT JSON_OBJECT(
             'title' VALUE NVL(l_title, 'Finance LiveStack conversation'),
             'description' VALUE
               'Short-lived Select AI context for the Finance LiveStack application.',
             'retention_days' VALUE 1,
             'conversation_length' VALUE 5
             RETURNING CLOB
           )
      INTO l_attributes
      FROM dual;

    l_id := DBMS_CLOUD_AI.CREATE_CONVERSATION(attributes => l_attributes);
    IF l_id IS NULL
       OR LENGTH(l_id) > 128
       OR NOT REGEXP_LIKE(l_id, '^[A-Za-z0-9._:-]+$')
    THEN
      RAISE_APPLICATION_ERROR(-20838, 'Select AI did not create a valid conversation.');
    END IF;
    RETURN l_id;
  END create_conversation;

  FUNCTION readiness_json RETURN CLOB IS
    l_state             finance_native_ai_state%ROWTYPE;
    l_profile_count     PLS_INTEGER := 0;
    l_tool_count        PLS_INTEGER := 0;
    l_agent_count       PLS_INTEGER := 0;
    l_task_count        PLS_INTEGER := 0;
    l_team_count        PLS_INTEGER := 0;
    l_credential_count  PLS_INTEGER := 0;
    l_ready             PLS_INTEGER := 0;
    l_result            CLOB;
  BEGIN
    BEGIN
      SELECT *
        INTO l_state
        FROM finance_native_ai_state
       WHERE state_key = 'PRIMARY';
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        l_state.status := 'FAILED';
        l_state.provider := 'oci';
        l_state.profile_name := c_profile_name;
        l_state.read_only_flag := 'Y';
        l_state.last_error := 'Native AI state is unavailable.';
    END;

    l_profile_count := enabled_count('PROFILE');
    l_tool_count    := enabled_count('TOOL');
    l_agent_count   := enabled_count('AGENT');
    l_task_count    := enabled_count('TASK');
    l_team_count    := enabled_count('TEAM');

    SELECT COUNT(*)
      INTO l_credential_count
      FROM user_credentials
     WHERE credential_name = 'FIN_GENAI_KEY_V1';

    IF l_state.status = 'READY'
       AND l_profile_count = 1
       AND l_tool_count = 1
       AND l_agent_count = 4
       AND l_task_count = 3
       AND l_team_count = 4
       AND l_credential_count = 1
    THEN
      l_ready := 1;
    END IF;

    SELECT JSON_OBJECT(
             'ready' VALUE CASE WHEN l_ready = 1 THEN 'true' ELSE 'false' END FORMAT JSON,
             'status' VALUE l_state.status,
             'native' VALUE 'true' FORMAT JSON,
             'provider' VALUE l_state.provider,
             'profileName' VALUE l_state.profile_name,
             'region' VALUE l_state.region,
             'model' VALUE l_state.model_id,
             'readOnly' VALUE 'true' FORMAT JSON,
             'credentialPresent' VALUE
               CASE
                 WHEN l_credential_count = 1 THEN 'true'
                 ELSE 'false'
               END FORMAT JSON,
             'objectScope' VALUE JSON_ARRAY(
               'FINANCE_INSTITUTIONS_V',
               'FINANCE_PRODUCTS_V',
               'RISK_SIGNALS_V',
               'SIGNAL_SOURCES_V',
               'CLIENT_TRANSACTIONS_V',
               'SERVICE_CENTERS_V',
               'SERVICE_CAPACITY_V',
               'SERVICE_ROUTES_V',
               'FINANCE_SIGNAL_PRODUCT_EXPOSURE_V',
               'FINANCE_TRANSACTION_EXPOSURE_V',
               'FINANCE_SERVICE_PRESSURE_V',
               'FINANCE_FRAUD_CASE_EXPOSURE_V'
             ) FORMAT JSON,
             'teams' VALUE JSON_ARRAY(
               JSON_OBJECT('name' VALUE c_signal_team, 'mode' VALUE 'advisory'),
               JSON_OBJECT('name' VALUE c_service_team, 'mode' VALUE 'advisory'),
               JSON_OBJECT('name' VALUE c_exposure_team, 'mode' VALUE 'advisory'),
               JSON_OBJECT(
                 'name' VALUE c_operations_team,
                 'mode' VALUE 'supervisor-advisory'
               )
             ) FORMAT JSON,
             'nativeObjectCounts' VALUE JSON_OBJECT(
               'profiles' VALUE l_profile_count,
               'tools' VALUE l_tool_count,
               'agents' VALUE l_agent_count,
               'tasks' VALUE l_task_count,
               'teams' VALUE l_team_count
             ) FORMAT JSON,
             'validatedAt' VALUE TO_CHAR(
               l_state.validated_at,
               'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM'
             ),
             'error' VALUE CASE
               WHEN l_ready = 1 THEN NULL
               WHEN l_state.status = 'FAILED' THEN
                 'Native Select AI bootstrap failed. Inspect the Resource Manager bootstrap log.'
               ELSE
                 'Native Select AI acceptance is incomplete.'
             END
             RETURNING CLOB
           )
      INTO l_result
      FROM dual;
    RETURN l_result;
  END readiness_json;

  FUNCTION is_safe_sql(
    p_sql IN CLOB
  ) RETURN NUMBER DETERMINISTIC IS
    l_sql VARCHAR2(32767);
  BEGIN
    IF p_sql IS NULL OR DBMS_LOB.GETLENGTH(p_sql) > 32767 THEN
      RETURN 0;
    END IF;

    l_sql := UPPER(TRIM(DBMS_LOB.SUBSTR(p_sql, 32767, 1)));
    IF SUBSTR(l_sql, -1) = ';' THEN
      l_sql := RTRIM(SUBSTR(l_sql, 1, LENGTH(l_sql) - 1));
    END IF;

    IF NOT REGEXP_LIKE(l_sql, '^(SELECT|WITH)([[:space:](]|$)')
       OR INSTR(l_sql, ';') > 0
       OR INSTR(l_sql, '--') > 0
       OR INSTR(l_sql, '/*') > 0
       OR INSTR(l_sql, '*/') > 0
       OR INSTR(l_sql, '@') > 0
       OR REGEXP_LIKE(l_sql, '(^|[^A-Z0-9_$#])(INSERT|UPDATE|DELETE|MERGE|UPSERT|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|AUDIT|NOAUDIT|BEGIN|DECLARE|CALL|EXEC|EXECUTE|COMMIT|ROLLBACK|SAVEPOINT|LOCK)([^A-Z0-9_$#]|$)')
       OR REGEXP_LIKE(l_sql, '(^|[^A-Z0-9_$#])WITH[[:space:]]+(FUNCTION|PROCEDURE)([^A-Z0-9_$#]|$)')
       OR REGEXP_LIKE(l_sql, '(^|[^A-Z0-9_$#])FOR[[:space:]]+UPDATE([^A-Z0-9_$#]|$)')
       OR REGEXP_LIKE(l_sql, '(^|[^A-Z0-9_$#])(DBMS_|UTL_|SYS[.]|SYSTEM[.]|DBA_|ALL_|USER_|CDB_|V[$]|GV[$]|X[$]|DUAL)([A-Z0-9_$#]*)([^A-Z0-9_$#]|$)')
       OR REGEXP_LIKE(l_sql, '(^|[^A-Z0-9_$#])(LOG_AGENT_DECISION|BATCH_SEMANTIC_MATCH|SC_SECURITY_CTX|FIND_|SEARCH_|OPTIMAL_|DETECT_|CHECK_|GET_|VPD_)([A-Z0-9_$#]*)([^A-Z0-9_$#]|$)')
       OR REGEXP_LIKE(l_sql, '(^|[^A-Z0-9_$#])(NEXTVAL|CURRVAL)([^A-Z0-9_$#]|$)')
       -- Oracle limits a regular-expression pattern to 512 bytes. Keep the
       -- base-table denylist split into bounded patterns so the gate does not
       -- fail closed on every otherwise-valid SELECT with ORA-12733.
       OR REGEXP_LIKE(l_sql, '(^|[^A-Z0-9_$#])(BRANDS|PRODUCTS|CUSTOMERS|ORDERS|ORDER_ITEMS|INVENTORY|FULFILLMENT_CENTERS|SOCIAL_POSTS|POST_PRODUCT_MENTIONS|INFLUENCERS|DEMAND_FORECASTS|SHIPMENTS|AGENT_ACTIONS)([^A-Z0-9_$#]|$)')
       OR REGEXP_LIKE(l_sql, '(^|[^A-Z0-9_$#])(APP_USERS|APP_DATASET_STATE|PRODUCT_ATTRIBUTES|EVENT_STREAM|INFLUENCER_CONNECTIONS|BRAND_INFLUENCER_LINKS|PRODUCT_EMBEDDINGS|SIGNAL_EMBEDDINGS|SEMANTIC_MATCHES|FULFILLMENT_ZONES|DEMAND_REGIONS|FINANCE_NATIVE_AI_STATE)([^A-Z0-9_$#]|$)')
       OR REGEXP_LIKE(l_sql, '(^|[^A-Z0-9_$#])(FRAUD_CASES|FRAUD_CASE_ENTITIES|FRAUD_ENTITIES|FRAUD_RELATIONSHIPS|OML_DEMAND_SETTINGS|OML_CUSTOMER_SEGMENT_SETTINGS|OML_REVENUE_SETTINGS|OML_PRODUCT_CLUSTER_SETTINGS)([^A-Z0-9_$#]|$)')
       OR NOT REGEXP_LIKE(
         l_sql,
         'FINANCE_INSTITUTIONS_V|FINANCE_PRODUCTS_V|RISK_SIGNALS_V|SIGNAL_SOURCES_V|CLIENT_TRANSACTIONS_V|SERVICE_CENTERS_V|SERVICE_CAPACITY_V|SERVICE_ROUTES_V|FINANCE_SIGNAL_PRODUCT_EXPOSURE_V|FINANCE_TRANSACTION_EXPOSURE_V|FINANCE_SERVICE_PRESSURE_V|FINANCE_FRAUD_CASE_EXPOSURE_V'
       )
    THEN
      RETURN 0;
    END IF;

    RETURN 1;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN 0;
  END is_safe_sql;

  FUNCTION generate_text(
    p_action          IN VARCHAR2,
    p_prompt          IN CLOB,
    p_profile_name    IN VARCHAR2 DEFAULT 'FINANCE_SELECTAI_V1',
    p_conversation_id IN VARCHAR2 DEFAULT NULL
  ) RETURN CLOB IS
    l_action     VARCHAR2(20) := UPPER(TRIM(p_action));
    l_profile    VARCHAR2(128) := UPPER(TRIM(NVL(p_profile_name, c_profile_name)));
    l_params     CLOB;
    l_result     CLOB;
  BEGIN
    assert_ready;
    assert_prompt(p_prompt);

    IF l_profile <> c_profile_name THEN
      RAISE_APPLICATION_ERROR(-20824, 'Only the managed Finance Select AI profile is allowed.');
    END IF;
    IF l_action NOT IN ('CHAT', 'SHOWSQL') THEN
      RAISE_APPLICATION_ERROR(
        -20825,
        'Allowed Select AI wrapper actions are CHAT and SHOWSQL.'
      );
    END IF;

    l_params := conversation_params(p_conversation_id);

    IF l_action = 'CHAT' THEN
      l_result := DBMS_CLOUD_AI.GENERATE(
        prompt       => p_prompt,
        profile_name => c_profile_name,
        action       => 'chat',
        params       => l_params
      );
    ELSE
      l_result := DBMS_CLOUD_AI.GENERATE(
        prompt       => p_prompt,
        profile_name => c_profile_name,
        action       => 'showsql',
        params       => l_params
      );
      IF is_safe_sql(l_result) <> 1 THEN
        RAISE_APPLICATION_ERROR(
          -20826,
          'Select AI generated SQL outside the single-query curated read-only boundary.'
        );
      END IF;
    END IF;

    IF l_result IS NULL OR DBMS_LOB.GETLENGTH(l_result) = 0 THEN
      RAISE_APPLICATION_ERROR(-20827, 'OCI Generative AI returned an empty response.');
    END IF;
    RETURN l_result;
  END generate_text;

  FUNCTION run_agent(
    p_team_name       IN VARCHAR2,
    p_prompt          IN CLOB,
    p_conversation_id IN VARCHAR2 DEFAULT NULL
  ) RETURN CLOB IS
    l_team   VARCHAR2(128);
    l_params CLOB;
    l_result CLOB;
  BEGIN
    assert_ready;
    assert_prompt(p_prompt);
    l_team := managed_team(p_team_name);

    l_params := conversation_params(p_conversation_id);
    l_result := DBMS_CLOUD_AI_AGENT.RUN_TEAM(
      team_name   => l_team,
      user_prompt => p_prompt,
      params      => l_params
    );

    IF l_result IS NULL OR DBMS_LOB.GETLENGTH(l_result) = 0 THEN
      RAISE_APPLICATION_ERROR(-20829, 'Native Select AI Agent returned an empty response.');
    END IF;
    RETURN l_result;
  END run_agent;

  FUNCTION get_team_state(
    p_team_name       IN VARCHAR2,
    p_conversation_id IN VARCHAR2
  ) RETURN VARCHAR2 IS
    l_team   VARCHAR2(128);
    l_params CLOB;
    l_state  VARCHAR2(30);
  BEGIN
    assert_ready;
    l_team := managed_team(p_team_name);

    IF p_conversation_id IS NULL THEN
      RAISE_APPLICATION_ERROR(-20839, 'Agent state requires a conversation identifier.');
    END IF;

    l_params := conversation_params(p_conversation_id);
    l_state := UPPER(TRIM(DBMS_CLOUD_AI_AGENT.GET_TEAM_STATE(
      team_name => l_team,
      params    => l_params
    )));

    IF l_state IS NULL
       OR l_state NOT IN (
         'RUNNING',
         'WAITING_FOR_HUMAN',
         'RESUMING',
         'SUCCEEDED',
         'FAILED'
       )
    THEN
      RAISE_APPLICATION_ERROR(-20840, 'Native Select AI Agent returned an invalid team state.');
    END IF;
    RETURN l_state;
  END get_team_state;
END finance_native_ai_pkg;
/

DECLARE
  l_compile_errors PLS_INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO l_compile_errors
    FROM user_errors
   WHERE name = 'FINANCE_NATIVE_AI_PKG'
     AND type IN ('PACKAGE', 'PACKAGE BODY');
  IF l_compile_errors > 0 THEN
    UPDATE finance_native_ai_state
       SET status = 'FAILED',
           last_error = 'FINANCE_NATIVE_AI_PKG has compilation errors.'
     WHERE state_key = 'PRIMARY';
    COMMIT;
    RAISE_APPLICATION_ERROR(-20830, 'FINANCE_NATIVE_AI_PKG failed to compile.');
  END IF;
END;
/

-- Live native acceptance. READY is deliberately absent while these calls run.
DECLARE
  l_chat        CLOB;
  l_show_sql    CLOB;
  l_run_sql     CLOB;
  l_agent_tool  CLOB;
  l_team_description CLOB;
  l_readiness   CLOB;
  l_task_tool_attribute_count PLS_INTEGER;

  PROCEDURE mark_failed(p_error IN VARCHAR2) IS
    PRAGMA AUTONOMOUS_TRANSACTION;
  BEGIN
    UPDATE finance_native_ai_state
       SET status = 'FAILED',
           validated_at = NULL,
           last_error = SUBSTR(p_error, 1, 2000)
     WHERE state_key = 'PRIMARY';
    COMMIT;
  END mark_failed;

  PROCEDURE mark_ready IS
    PRAGMA AUTONOMOUS_TRANSACTION;
  BEGIN
    UPDATE finance_native_ai_state
       SET status = 'READY',
           validated_at = SYSTIMESTAMP,
           last_error = NULL
     WHERE state_key = 'PRIMARY';
    COMMIT;
  END mark_ready;
BEGIN
  IF finance_native_ai_pkg.is_safe_sql(
       TO_CLOB('SELECT COUNT(*) FROM FINANCE_INSTITUTIONS_V')
     ) <> 1
     OR finance_native_ai_pkg.is_safe_sql(
       TO_CLOB('UPDATE FINANCE_INSTITUTIONS_V SET INSTITUTION_NAME = ''blocked''')
     ) <> 0
     OR finance_native_ai_pkg.is_safe_sql(
       TO_CLOB(
         'SELECT * FROM USER_CREDENTIALS CROSS JOIN FINANCE_INSTITUTIONS_V'
       )
     ) <> 0
     OR finance_native_ai_pkg.is_safe_sql(
       TO_CLOB(
         'SELECT * FROM FINANCE_INSTITUTIONS_V; SELECT * FROM FINANCE_PRODUCTS_V'
       )
     ) <> 0
     OR finance_native_ai_pkg.is_safe_sql(
       TO_CLOB('SELECT * FROM ORDERS CROSS JOIN FINANCE_INSTITUTIONS_V')
     ) <> 0
     OR finance_native_ai_pkg.is_safe_sql(
       TO_CLOB(
         'WITH FUNCTION SIDE_EFFECT RETURN NUMBER IS BEGIN RETURN 1; END; ' ||
         'SELECT SIDE_EFFECT() FROM FINANCE_INSTITUTIONS_V'
       )
     ) <> 0
     OR finance_native_ai_pkg.is_safe_sql(
       TO_CLOB(
         'SELECT LOG_AGENT_DECISION(1, ''probe'', ''probe'', 1, ''probe'') ' ||
         'FROM FINANCE_INSTITUTIONS_V'
       )
     ) <> 0
  THEN
    RAISE_APPLICATION_ERROR(-20842, 'Native Select AI SQL safety gate self-test failed.');
  END IF;
  DBMS_OUTPUT.PUT_LINE('FINANCE_NATIVE_AI_SQL_GATE_OK');

  SELECT COUNT(*)
    INTO l_task_tool_attribute_count
    FROM user_ai_agent_task_attributes
   WHERE task_name IN (
     'FIN_RISK_SIGNAL_TASK',
     'FIN_SERVICE_PRESSURE_TASK',
     'FIN_EXPOSURE_TASK'
   )
     AND UPPER(attribute_name) = 'TOOLS';

  IF l_task_tool_attribute_count <> 0 THEN
    RAISE_APPLICATION_ERROR(
      -20841,
      'Finance advisory tasks unexpectedly expose native agent tools.'
    );
  END IF;
  DBMS_OUTPUT.PUT_LINE('FINANCE_NATIVE_AI_AGENT_TASKS_TOOL_FREE_OK');

  -- Probe the Oracle packages directly while the public wrapper remains
  -- fail-closed in INSTALLING. READY is written only after every probe passes.
  l_chat := DBMS_CLOUD_AI.GENERATE(
    profile_name => 'FINANCE_SELECTAI_V1',
    action       => 'chat',
    prompt       =>
      'Reply with FINANCE_NATIVE_CHAT_OK and one short sentence stating that ' ||
      'you are the Finance advisory assistant.'
  );
  IF INSTR(UPPER(DBMS_LOB.SUBSTR(l_chat, 4000, 1)), 'FINANCE_NATIVE_CHAT_OK') = 0 THEN
    RAISE_APPLICATION_ERROR(-20831, 'Native OCI Generative AI chat probe returned an unexpected response.');
  END IF;
  DBMS_OUTPUT.PUT_LINE('FINANCE_NATIVE_AI_CHAT_OK');

  l_show_sql := DBMS_CLOUD_AI.GENERATE(
    profile_name => 'FINANCE_SELECTAI_V1',
    action       => 'showsql',
    prompt       => 'Count all rows in the FINANCE_INSTITUTIONS_V curated view.'
  );
  IF finance_native_ai_pkg.is_safe_sql(l_show_sql) <> 1 THEN
    RAISE_APPLICATION_ERROR(-20832, 'Native Select AI SHOWSQL probe failed its read-only gate.');
  END IF;
  DBMS_OUTPUT.PUT_LINE('FINANCE_NATIVE_AI_SHOWSQL_OK');

  l_run_sql := DBMS_CLOUD_AI.GENERATE(
    profile_name => 'FINANCE_SELECTAI_V1',
    action       => 'runsql',
    prompt       => 'Count all rows in the FINANCE_INSTITUTIONS_V curated view.'
  );
  IF l_run_sql IS NULL OR DBMS_LOB.GETLENGTH(l_run_sql) = 0 THEN
    RAISE_APPLICATION_ERROR(-20833, 'Native Select AI RUNSQL probe returned no result.');
  END IF;
  DBMS_OUTPUT.PUT_LINE('FINANCE_NATIVE_AI_RUNSQL_OK');

  -- A live RUN_TEAM call can legitimately be long-running and model-directed,
  -- so Terraform validates the actual agent framework deterministically:
  -- execute the registered built-in SQL tool once and inspect the real team
  -- descriptor. User-initiated advisory requests still use RUN_TEAM through
  -- FINANCE_NATIVE_AI_PKG.RUN_AGENT.
  l_agent_tool := DBMS_CLOUD_AI_AGENT.RUN_TOOL(
    tool_name => 'FINANCE_READONLY_SQL_TOOL',
    input     =>
      '{"QUERY":"SELECT COUNT(*) AS TOTAL_ROWS FROM FINANCE_PRODUCTS_V",' ||
      '"ACTION":"RUNSQL"}'
  );
  IF l_agent_tool IS NULL
     OR INSTR(UPPER(DBMS_LOB.SUBSTR(l_agent_tool, 4000, 1)), 'TOTAL_ROWS') = 0
  THEN
    RAISE_APPLICATION_ERROR(-20834, 'Native Select AI Agent SQL tool probe failed.');
  END IF;
  DBMS_OUTPUT.PUT_LINE('FINANCE_NATIVE_AI_AGENT_TOOL_OK');

  l_team_description :=
    DBMS_CLOUD_AI_AGENT.DESCRIBE_TEAM('FINANCE_OPERATIONS_TEAM');
  IF l_team_description IS NULL
     OR INSTR(
          UPPER(DBMS_LOB.SUBSTR(l_team_description, 4000, 1)),
          'FINANCE_OPERATIONS_TEAM'
        ) = 0
  THEN
    RAISE_APPLICATION_ERROR(-20835, 'Native Select AI Agent team descriptor probe failed.');
  END IF;
  DBMS_OUTPUT.PUT_LINE('FINANCE_NATIVE_AI_AGENT_OK');

  mark_ready;

  l_readiness := finance_native_ai_pkg.readiness_json();
  IF JSON_VALUE(l_readiness, '$.ready' RETURNING VARCHAR2(5)) <> 'true' THEN
    RAISE_APPLICATION_ERROR(-20836, 'Native AI readiness contract did not become ready.');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    mark_failed(SQLERRM);
    RAISE;
END;
/

PROMPT FINANCE_NATIVE_AI_ACCEPTANCE_OK

UNDEFINE fin_genai_region_hex
UNDEFINE fin_genai_model_hex
UNDEFINE fin_genai_compartment_hex
