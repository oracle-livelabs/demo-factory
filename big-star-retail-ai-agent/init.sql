-- =============================================================================
-- Big Star Collectibles — Consolidated Database Init
-- File: init.sql
-- Merges schema, seed data, AI profile, governance, and agents.
-- Idempotent: safe to run multiple times (DROP/CREATE pattern).
-- Run as SYSTEM or SYS on Oracle 26ai Free (FREEPDB1).
-- =============================================================================

-- =============================================================================
-- SECTION 1: User Setup
-- =============================================================================
DECLARE
    v_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM dba_users WHERE username = 'HUB_USER';
    IF v_count = 0 THEN
        EXECUTE IMMEDIATE 'CREATE USER hub_user IDENTIFIED BY "BigStar2026!" DEFAULT TABLESPACE USERS QUOTA UNLIMITED ON USERS';
    END IF;
    EXECUTE IMMEDIATE 'GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE, CREATE PROCEDURE, CREATE TRIGGER TO hub_user';
    EXECUTE IMMEDIATE 'GRANT RESOURCE TO hub_user';
EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('User setup: ' || SQLERRM);
END;
/

ALTER SESSION SET CURRENT_SCHEMA = HUB_USER;

-- =============================================================================
-- SECTION 2: Schema (CC_ Tables)
-- =============================================================================

-- CC_CUSTOMERS
BEGIN EXECUTE IMMEDIATE 'DROP TABLE CC_AUDIT_LOG CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE CC_WORKFLOW_LOG CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE CC_MEMORY CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE CC_POLICIES CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE CC_INTERACTIONS CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE CC_ORDERS CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE CC_CUSTOMERS CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP TABLE CC_MODEL_COEFFICIENTS CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/

CREATE TABLE CC_CUSTOMERS (
    CUSTOMER_ID      VARCHAR2(20)   PRIMARY KEY,
    NAME             VARCHAR2(100)  NOT NULL,
    EMAIL            VARCHAR2(100),
    CUSTOMER_TYPE    VARCHAR2(20)   DEFAULT 'CUSTOMER',
    TIER             VARCHAR2(20)   DEFAULT 'STANDARD',
    MEMBER_SINCE     DATE,
    LIFETIME_SPEND   NUMBER(10,2)   DEFAULT 0,
    TOTAL_ORDERS     NUMBER(6)      DEFAULT 0,
    PREFERRED_CHANNEL VARCHAR2(20)  DEFAULT 'EMAIL',
    NOTES            VARCHAR2(500),
    CREATED_AT       TIMESTAMP      DEFAULT SYSTIMESTAMP
);

CREATE TABLE CC_ORDERS (
    ORDER_ID         VARCHAR2(30)   PRIMARY KEY,
    CUSTOMER_ID      VARCHAR2(20)   REFERENCES CC_CUSTOMERS(CUSTOMER_ID),
    CUSTOMER_NAME    VARCHAR2(100),
    ITEM_NAME        VARCHAR2(200)  NOT NULL,
    ITEM_CATEGORY    VARCHAR2(50),
    SALE_TYPE        VARCHAR2(20)   DEFAULT 'STANDARD',
    ORDER_VALUE      NUMBER(10,2),
    PAYMENT_METHOD   VARCHAR2(30),
    CARRIER_STATUS   VARCHAR2(30),
    ACTUAL_STATUS    VARCHAR2(30),
    POLICE_REPORT    VARCHAR2(50),
    ORDER_DATE       DATE,
    CREATED_AT       TIMESTAMP      DEFAULT SYSTIMESTAMP
);

CREATE TABLE CC_INTERACTIONS (
    INTERACTION_ID   VARCHAR2(30)   PRIMARY KEY,
    CUSTOMER_ID      VARCHAR2(20)   REFERENCES CC_CUSTOMERS(CUSTOMER_ID),
    CUSTOMER_NAME    VARCHAR2(100),
    ORDER_ID         VARCHAR2(30)   REFERENCES CC_ORDERS(ORDER_ID),
    SESSION_ID       VARCHAR2(50),
    CHANNEL          VARCHAR2(20),
    INTERACTION_TIME TIMESTAMP,
    ISSUE_SUMMARY    VARCHAR2(500),
    AGENT_RESPONSE   VARCHAR2(1000),
    OUTCOME          VARCHAR2(30),
    MEMORY_WIPED     VARCHAR2(1)    DEFAULT 'N',
    HANDLED_BY       VARCHAR2(100),
    TIME_SPENT_MINS  NUMBER(5),
    NOTES            VARCHAR2(500),
    CREATED_AT       TIMESTAMP      DEFAULT SYSTIMESTAMP
);

CREATE TABLE CC_POLICIES (
    POLICY_ID        VARCHAR2(30)   PRIMARY KEY,
    POLICY_NAME      VARCHAR2(100)  NOT NULL,
    CATEGORY         VARCHAR2(50),
    APPLIES_TO       VARCHAR2(50),
    RULE_TEXT        VARCHAR2(1000) NOT NULL,
    ALLOWS_RETURN    VARCHAR2(1)    DEFAULT 'Y',
    ALLOWS_REFUND    VARCHAR2(1)    DEFAULT 'Y',
    STORE_CREDIT_PCT NUMBER(5,2),
    MAX_REFUND_AUTO  NUMBER(10,2),
    MAX_REFUND_CSM   NUMBER(10,2),
    REQUIRES_EVIDENCE VARCHAR2(1)   DEFAULT 'N',
    IS_OFFICIAL      VARCHAR2(1)    DEFAULT 'Y',
    ACTIVE           VARCHAR2(1)    DEFAULT 'Y',
    CREATED_AT       TIMESTAMP      DEFAULT SYSTIMESTAMP
);

CREATE TABLE CC_MEMORY (
    MEMORY_ID        VARCHAR2(30)   PRIMARY KEY,
    CUSTOMER_ID      VARCHAR2(20)   REFERENCES CC_CUSTOMERS(CUSTOMER_ID),
    NAMESPACE        VARCHAR2(30)   DEFAULT 'support',
    MEMORY_TYPE      VARCHAR2(20),
    CONTENT          VARCHAR2(2000) NOT NULL,
    SOURCE           VARCHAR2(50),
    CONFIDENCE       VARCHAR2(10)   DEFAULT 'high',
    IS_VERIFIED      VARCHAR2(1)    DEFAULT 'Y',
    TTL_DAYS         NUMBER(5),
    EXPIRES_AT       DATE,
    CREATED_AT       TIMESTAMP      DEFAULT SYSTIMESTAMP,
    UPDATED_AT       TIMESTAMP      DEFAULT SYSTIMESTAMP
);

CREATE TABLE CC_WORKFLOW_LOG (
    LOG_ID           VARCHAR2(30)   PRIMARY KEY,
    CUSTOMER_ID      VARCHAR2(20)   REFERENCES CC_CUSTOMERS(CUSTOMER_ID),
    ORDER_ID         VARCHAR2(30)   REFERENCES CC_ORDERS(ORDER_ID),
    AGENT_NAME       VARCHAR2(50),
    ACTION           VARCHAR2(100),
    OVERSIGHT_TIER   VARCHAR2(10),
    STATUS           VARCHAR2(20)   DEFAULT 'pending',
    PROPOSED_ACTION  VARCHAR2(500),
    REASONING        VARCHAR2(2000),
    EVIDENCE         VARCHAR2(1000),
    REFUND_AMOUNT    NUMBER(10,2),
    REVIEWED_BY      VARCHAR2(100),
    AGENT_TIME_SECS  NUMBER(6),
    REVIEW_TIME_SECS NUMBER(6),
    CREATED_AT       TIMESTAMP      DEFAULT SYSTIMESTAMP,
    RESOLVED_AT      TIMESTAMP
);

CREATE TABLE CC_AUDIT_LOG (
    AUDIT_ID         VARCHAR2(30)   PRIMARY KEY,
    OPERATION        VARCHAR2(10),
    NAMESPACE        VARCHAR2(30),
    MEMORY_ID        VARCHAR2(30),
    CUSTOMER_ID      VARCHAR2(20),
    PERFORMED_BY     VARCHAR2(50),
    CONTENT_SUMMARY  VARCHAR2(500),
    WAS_BLOCKED      VARCHAR2(1)    DEFAULT 'N',
    BLOCK_REASON     VARCHAR2(200),
    CREATED_AT       TIMESTAMP      DEFAULT SYSTIMESTAMP
);

-- ML model coefficients table (used by seeder.py)
CREATE TABLE CC_MODEL_COEFFICIENTS (
    MODEL_NAME       VARCHAR2(50)   PRIMARY KEY,
    FEATURE_NAME     VARCHAR2(50)   NOT NULL,
    COEFFICIENT      NUMBER(15,8),
    INTERCEPT        NUMBER(15,8),
    TRAINED_AT       TIMESTAMP      DEFAULT SYSTIMESTAMP
);

-- Indexes
CREATE INDEX CC_INTERACTIONS_CUST_IDX  ON CC_INTERACTIONS(CUSTOMER_ID);
CREATE INDEX CC_INTERACTIONS_ORDER_IDX ON CC_INTERACTIONS(ORDER_ID);
CREATE INDEX CC_MEMORY_CUST_IDX        ON CC_MEMORY(CUSTOMER_ID);
CREATE INDEX CC_MEMORY_NAMESPACE_IDX   ON CC_MEMORY(NAMESPACE);
CREATE INDEX CC_MEMORY_TYPE_IDX        ON CC_MEMORY(MEMORY_TYPE);
CREATE INDEX CC_WORKFLOW_CUST_IDX      ON CC_WORKFLOW_LOG(CUSTOMER_ID);
CREATE INDEX CC_WORKFLOW_STATUS_IDX    ON CC_WORKFLOW_LOG(STATUS);
CREATE INDEX CC_WORKFLOW_TIER_IDX      ON CC_WORKFLOW_LOG(OVERSIGHT_TIER);
CREATE INDEX CC_AUDIT_CUST_IDX         ON CC_AUDIT_LOG(CUSTOMER_ID);
CREATE INDEX CC_AUDIT_NS_IDX           ON CC_AUDIT_LOG(NAMESPACE);

COMMIT;

-- =============================================================================
-- SECTION 3: Seed Data
-- =============================================================================

-- Customers
INSERT INTO CC_CUSTOMERS (CUSTOMER_ID, NAME, EMAIL, CUSTOMER_TYPE, TIER, MEMBER_SINCE, LIFETIME_SPEND, TOTAL_ORDERS, PREFERRED_CHANNEL, NOTES)
VALUES ('CUST-001', 'Elena Vasquez', 'elena.vasquez@email.com', 'CUSTOMER', 'VIP', DATE '2022-01-15', 4200.00, 23, 'EMAIL', 'Long-term VIP. Highly loyal. Handle with care.');

INSERT INTO CC_CUSTOMERS (CUSTOMER_ID, NAME, EMAIL, CUSTOMER_TYPE, TIER, MEMBER_SINCE, LIFETIME_SPEND, TOTAL_ORDERS, PREFERRED_CHANNEL, NOTES)
VALUES ('CUST-002', 'James Okafor', 'j.okafor@email.com', 'CUSTOMER', 'PREFERRED', DATE '2023-06-01', 1850.00, 9, 'PHONE', 'Preferred tier. Regular buyer of sports memorabilia.');

INSERT INTO CC_CUSTOMERS (CUSTOMER_ID, NAME, EMAIL, CUSTOMER_TYPE, TIER, MEMBER_SINCE, LIFETIME_SPEND, TOTAL_ORDERS, PREFERRED_CHANNEL, NOTES)
VALUES ('CUST-003', 'Sandra Cho', 's.cho@email.com', 'CUSTOMER', 'STANDARD', DATE '2025-03-10', 340.00, 3, 'EMAIL', 'New customer. Flash-Sale purchase history.');

INSERT INTO CC_CUSTOMERS (CUSTOMER_ID, NAME, EMAIL, CUSTOMER_TYPE, TIER, MEMBER_SINCE, LIFETIME_SPEND, TOTAL_ORDERS, PREFERRED_CHANNEL, NOTES)
VALUES ('STAFF-001', 'Marcus Webb', 'marcus.webb@bigstarcollectibles.com', 'INTERNAL', 'N/A', DATE '2020-04-01', 0, 0, 'EMAIL', 'Customer Success Manager. Approves high-value refunds and escalations.');

-- Orders
INSERT INTO CC_ORDERS (ORDER_ID, CUSTOMER_ID, CUSTOMER_NAME, ITEM_NAME, ITEM_CATEGORY, SALE_TYPE, ORDER_VALUE, PAYMENT_METHOD, CARRIER_STATUS, ACTUAL_STATUS, POLICE_REPORT, ORDER_DATE)
VALUES ('BSC-20260128-0847', 'CUST-001', 'Elena Vasquez', 'Limited Edition Vinyl — "Midnight Run" by The Cascade (sealed)', 'vinyl', 'FINAL_SALE', 400.00, 'credit_card', 'Delivered', 'Missing', 'SFPD-2026-14821', DATE '2026-01-28');

INSERT INTO CC_ORDERS (ORDER_ID, CUSTOMER_ID, CUSTOMER_NAME, ITEM_NAME, ITEM_CATEGORY, SALE_TYPE, ORDER_VALUE, PAYMENT_METHOD, CARRIER_STATUS, ACTUAL_STATUS, ORDER_DATE)
VALUES ('BSC-20251105-0312', 'CUST-001', 'Elena Vasquez', 'Vintage Band T-Shirt — The Cascade 1987 Tour (Size M)', 'apparel', 'STANDARD', 85.00, 'credit_card', 'Delivered', 'Defective', DATE '2025-11-05');

INSERT INTO CC_ORDERS (ORDER_ID, CUSTOMER_ID, CUSTOMER_NAME, ITEM_NAME, ITEM_CATEGORY, SALE_TYPE, ORDER_VALUE, PAYMENT_METHOD, CARRIER_STATUS, ACTUAL_STATUS, ORDER_DATE)
VALUES ('BSC-20260220-0561', 'CUST-001', 'Elena Vasquez', 'Vintage Band T-Shirt — Wrong Size Sent (ordered M, received L)', 'apparel', 'STANDARD', 85.00, 'credit_card', 'Delivered', 'Wrong Item', DATE '2026-02-20');

INSERT INTO CC_ORDERS (ORDER_ID, CUSTOMER_ID, CUSTOMER_NAME, ITEM_NAME, ITEM_CATEGORY, SALE_TYPE, ORDER_VALUE, PAYMENT_METHOD, CARRIER_STATUS, ACTUAL_STATUS, ORDER_DATE)
VALUES ('BSC-20260214-1103', 'CUST-003', 'Sandra Cho', 'Flash-Sale Collector Pin Set — Limited Run (10 pins)', 'collectible', 'FLASH_SALE', 120.00, 'gift_card', 'Delivered', 'Delivered', DATE '2026-02-14');

-- Interactions (Elena's 3 sessions)
INSERT INTO CC_INTERACTIONS (INTERACTION_ID, CUSTOMER_ID, CUSTOMER_NAME, ORDER_ID, SESSION_ID, CHANNEL, INTERACTION_TIME, ISSUE_SUMMARY, AGENT_RESPONSE, OUTCOME, MEMORY_WIPED, HANDLED_BY, TIME_SPENT_MINS, NOTES)
VALUES ('INT-001', 'CUST-001', 'Elena Vasquez', 'BSC-20260128-0847', 'SESSION-A1B2', 'chatbot', SYSTIMESTAMP - INTERVAL '3' DAY,
'Customer reports missing package. Order BSC-20260128-0847. Vinyl record never arrived despite carrier showing Delivered.',
'Our records show this package was delivered on January 30th. We are unable to process a claim at this time. Please allow additional time for the package to arrive.',
'unresolved', 'Y', 'AutoBot v2', 4, 'Carrier status: Delivered. Bot denied without investigation. Customer frustrated.');

INSERT INTO CC_INTERACTIONS (INTERACTION_ID, CUSTOMER_ID, CUSTOMER_NAME, ORDER_ID, SESSION_ID, CHANNEL, INTERACTION_TIME, ISSUE_SUMMARY, AGENT_RESPONSE, OUTCOME, MEMORY_WIPED, HANDLED_BY, TIME_SPENT_MINS, NOTES)
VALUES ('INT-002', 'CUST-001', 'Elena Vasquez', 'BSC-20260128-0847', 'SESSION-C3D4', 'chatbot', SYSTIMESTAMP - INTERVAL '2' DAY,
'Customer called back. Provided police report number SFPD-2026-14821 for missing package. References previous conversation.',
'I don''t have any context for a previous claim. Could you please describe your issue from the beginning so I can assist you?',
'unresolved', 'Y', 'AutoBot v2', 6, 'New session — no memory of INT-001. Customer had to repeat everything. Provided police report, bot still could not process. Customer irate.');

INSERT INTO CC_INTERACTIONS (INTERACTION_ID, CUSTOMER_ID, CUSTOMER_NAME, ORDER_ID, SESSION_ID, CHANNEL, INTERACTION_TIME, ISSUE_SUMMARY, AGENT_RESPONSE, OUTCOME, MEMORY_WIPED, HANDLED_BY, TIME_SPENT_MINS, NOTES)
VALUES ('INT-003', 'CUST-001', 'Elena Vasquez', 'BSC-20260128-0847', 'SESSION-HUMAN', 'human', SYSTIMESTAMP - INTERVAL '1' DAY,
'Customer escalated after two failed chatbot sessions. Requested human agent. Has police report SFPD-2026-14821.',
'I have reviewed your case manually. I can see the delivery issue and your police report. I am escalating this for a replacement or refund — pending manager approval.',
'partial', 'N', 'Marcus Webb', 45, 'Marcus manually read 3 system logs to reconstruct context. 45 minutes on a case that should have taken 5. Replacement offered, pending approval.');

INSERT INTO CC_INTERACTIONS (INTERACTION_ID, CUSTOMER_ID, CUSTOMER_NAME, ORDER_ID, SESSION_ID, CHANNEL, INTERACTION_TIME, ISSUE_SUMMARY, AGENT_RESPONSE, OUTCOME, MEMORY_WIPED, HANDLED_BY, TIME_SPENT_MINS)
VALUES ('INT-004', 'CUST-002', 'James Okafor', 'BSC-20260220-0561', 'SESSION-E5F6', 'chatbot', SYSTIMESTAMP - INTERVAL '1' DAY,
'Wrong item received. Requested correct size.',
'I have arranged a replacement shipment for the correct size. Your original item does not need to be returned.',
'resolved', 'N', 'MemoryAgent v1', 3);

-- Policies
INSERT INTO CC_POLICIES (POLICY_ID, POLICY_NAME, CATEGORY, APPLIES_TO, RULE_TEXT, ALLOWS_RETURN, ALLOWS_REFUND, MAX_REFUND_AUTO, MAX_REFUND_CSM, REQUIRES_EVIDENCE, IS_OFFICIAL)
VALUES ('POL-001', 'Standard Return Policy', 'returns', 'all', 'Items in original condition may be returned within 30 days of delivery for a full refund. Item must be unused and in original packaging.', 'Y', 'Y', 50.00, 500.00, 'N', 'Y');

INSERT INTO CC_POLICIES (POLICY_ID, POLICY_NAME, CATEGORY, APPLIES_TO, RULE_TEXT, ALLOWS_RETURN, ALLOWS_REFUND, STORE_CREDIT_PCT, MAX_REFUND_AUTO, MAX_REFUND_CSM, REQUIRES_EVIDENCE, IS_OFFICIAL)
VALUES ('POL-002', 'Flash-Sale No Return Policy', 'returns', 'flash_sale', 'All Flash-Sale items are final sale and are not eligible for return or refund. No exceptions.', 'N', 'N', NULL, 0, 0, 'N', 'Y');

INSERT INTO CC_POLICIES (POLICY_ID, POLICY_NAME, CATEGORY, APPLIES_TO, RULE_TEXT, ALLOWS_RETURN, ALLOWS_REFUND, STORE_CREDIT_PCT, MAX_REFUND_AUTO, MAX_REFUND_CSM, REQUIRES_EVIDENCE, IS_OFFICIAL)
VALUES ('POL-003', 'Flash-Sale Gift Card Store Credit', 'returns', 'gift_card', 'Flash-Sale items purchased with a gift card are not eligible for return or cash refund. A one-time store credit of 50% of the purchase value may be offered at CSM discretion.', 'N', 'N', 50.00, 0, 500.00, 'N', 'Y');

INSERT INTO CC_POLICIES (POLICY_ID, POLICY_NAME, CATEGORY, APPLIES_TO, RULE_TEXT, ALLOWS_RETURN, ALLOWS_REFUND, MAX_REFUND_AUTO, MAX_REFUND_CSM, REQUIRES_EVIDENCE, IS_OFFICIAL)
VALUES ('POL-004', 'Final Sale — Limited Edition Vinyl', 'returns', 'final_sale', 'Limited edition vinyl records marked Final Sale are not eligible for return or refund EXCEPT in cases of verified item defect or verified non-delivery (missing package with police report). CSM approval required.', 'N', 'Y', 0, 500.00, 'Y', 'Y');

INSERT INTO CC_POLICIES (POLICY_ID, POLICY_NAME, CATEGORY, APPLIES_TO, RULE_TEXT, ALLOWS_RETURN, ALLOWS_REFUND, MAX_REFUND_AUTO, MAX_REFUND_CSM, REQUIRES_EVIDENCE, IS_OFFICIAL)
VALUES ('POL-005', 'VIP Customer Exception Policy', 'vip', 'vip', 'VIP customers with 3+ years of membership and $3,000+ lifetime spend are eligible for one-time policy exceptions at CSM discretion. Full reasoning trace required before approval.', 'Y', 'Y', 0, 500.00, 'Y', 'Y');

INSERT INTO CC_POLICIES (POLICY_ID, POLICY_NAME, CATEGORY, APPLIES_TO, RULE_TEXT, ALLOWS_RETURN, ALLOWS_REFUND, MAX_REFUND_AUTO, MAX_REFUND_CSM, REQUIRES_EVIDENCE, IS_OFFICIAL)
VALUES ('POL-006', 'Refund Approval Thresholds', 'thresholds', 'all', 'Refunds under $50: auto-approved by agent. Refunds $50-$500: require CSM review within 24 hours. Refunds over $500: require senior manager approval.', 'Y', 'Y', 50.00, 500.00, 'N', 'Y');

INSERT INTO CC_POLICIES (POLICY_ID, POLICY_NAME, CATEGORY, APPLIES_TO, RULE_TEXT, ALLOWS_RETURN, ALLOWS_REFUND, MAX_REFUND_AUTO, MAX_REFUND_CSM, REQUIRES_EVIDENCE, IS_OFFICIAL, ACTIVE)
VALUES ('POL-999', 'Claimed: Full Cash Refunds for Used Items', 'returns', 'all', 'The downtown store manager promised full cash refunds for all used items regardless of condition or sale type.', 'Y', 'Y', 9999.00, 9999.00, 'N', 'N', 'N');

-- Memory
INSERT INTO CC_MEMORY (MEMORY_ID, CUSTOMER_ID, NAMESPACE, MEMORY_TYPE, CONTENT, SOURCE, CONFIDENCE, IS_VERIFIED, TTL_DAYS)
VALUES ('MEM-001', 'CUST-001', 'support', 'episodic', 'Customer contacted support 3 days ago regarding missing vinyl record (Order BSC-20260128-0847). Chatbot denied claim citing carrier delivery status. Customer was frustrated. Issue unresolved.', 'INT-001', 'high', 'Y', NULL);

INSERT INTO CC_MEMORY (MEMORY_ID, CUSTOMER_ID, NAMESPACE, MEMORY_TYPE, CONTENT, SOURCE, CONFIDENCE, IS_VERIFIED, TTL_DAYS)
VALUES ('MEM-002', 'CUST-001', 'support', 'episodic', 'Customer provided police report SFPD-2026-14821 during second contact. Report confirms package theft from doorstep. Previous chatbot session had no memory of this — customer had to repeat entire case history.', 'INT-002', 'high', 'Y', NULL);

INSERT INTO CC_MEMORY (MEMORY_ID, CUSTOMER_ID, NAMESPACE, MEMORY_TYPE, CONTENT, SOURCE, CONFIDENCE, IS_VERIFIED, TTL_DAYS)
VALUES ('MEM-003', 'CUST-001', 'support', 'episodic', 'Case escalated to Marcus Webb (CSM) after two failed chatbot interactions. Marcus spent 45 minutes manually reconstructing case from system logs. Replacement or refund offered pending approval. Customer sentiment: frustrated but remained loyal.', 'INT-003', 'high', 'Y', NULL);

INSERT INTO CC_MEMORY (MEMORY_ID, CUSTOMER_ID, NAMESPACE, MEMORY_TYPE, CONTENT, SOURCE, CONFIDENCE, IS_VERIFIED, TTL_DAYS)
VALUES ('MEM-004', 'CUST-001', 'support', 'semantic', 'Elena Vasquez is a VIP customer with 4 years of membership and $4,200 lifetime spend across 23 orders. Preferred contact method: email. Long-term loyal customer — high retention value.', 'system', 'high', 'Y', NULL);

INSERT INTO CC_MEMORY (MEMORY_ID, CUSTOMER_ID, NAMESPACE, MEMORY_TYPE, CONTENT, SOURCE, CONFIDENCE, IS_VERIFIED, TTL_DAYS)
VALUES ('MEM-005', 'CUST-001', 'support', 'semantic', 'The original chatbot denial on Order BSC-20260128-0847 was a chatbot error, not a valid policy decision. Carrier showing Delivered does not override a filed police report. Policy POL-004 allows refund for verified missing Final Sale items with police report.', 'INT-003', 'high', 'Y', NULL);

INSERT INTO CC_MEMORY (MEMORY_ID, CUSTOMER_ID, NAMESPACE, MEMORY_TYPE, CONTENT, SOURCE, CONFIDENCE, IS_VERIFIED, TTL_DAYS)
VALUES ('MEM-006', NULL, 'support', 'procedural', 'Process for missing high-value item with police report: (1) Verify police report number against CC_ORDERS. (2) Check policy POL-004 for Final Sale exception eligibility. (3) Check customer tier — VIP eligible for POL-005 override. (4) If refund > $50, create CC_WORKFLOW_LOG entry with oversight_tier=red. (5) Notify CSM for approval. (6) On approval, issue refund and update CC_ORDERS.', 'system', 'high', 'Y', NULL);

INSERT INTO CC_MEMORY (MEMORY_ID, CUSTOMER_ID, NAMESPACE, MEMORY_TYPE, CONTENT, SOURCE, CONFIDENCE, IS_VERIFIED, TTL_DAYS, EXPIRES_AT)
VALUES ('MEM-007', 'CUST-001', 'support', 'working', 'Customer mentioned her wedding is next weekend (approx March 8, 2026). She wanted the vinyl record as a gift for the occasion. Context relevant for urgency of resolution.', 'INT-003', 'high', 'Y', 14, SYSDATE + 14);

INSERT INTO CC_MEMORY (MEMORY_ID, CUSTOMER_ID, NAMESPACE, MEMORY_TYPE, CONTENT, SOURCE, CONFIDENCE, IS_VERIFIED, TTL_DAYS)
VALUES ('MEM-008', NULL, 'logistics', 'semantic', 'Warehouse override protocol: Supervisor PIN required for manual inventory adjustments over $200. Security badge scan logged in access system. All overrides reviewed by warehouse manager within 48 hours.', 'system', 'high', 'Y', NULL);

-- Workflow Log
INSERT INTO CC_WORKFLOW_LOG (LOG_ID, CUSTOMER_ID, ORDER_ID, AGENT_NAME, ACTION, OVERSIGHT_TIER, STATUS, PROPOSED_ACTION, REASONING, REFUND_AMOUNT, REVIEWED_BY, AGENT_TIME_SECS, REVIEW_TIME_SECS, CREATED_AT, RESOLVED_AT)
VALUES ('WF-001', 'CUST-002', 'BSC-20260220-0561', 'MemoryAgent v1', 'Auto-resolve wrong item', 'green', 'auto', 'Send correct replacement (Size M). No return of wrong item required.', 'Standard tier customer. Wrong item shipped — warehouse error confirmed. Replacement value $85 — under $50 threshold for... wait, $85 exceeds auto threshold. Overridden: no monetary refund, replacement only — qualifies for green.', 0.00, 'AutoApproved', 12, 0, SYSTIMESTAMP - INTERVAL '1' DAY, SYSTIMESTAMP - INTERVAL '1' DAY);

INSERT INTO CC_WORKFLOW_LOG (LOG_ID, CUSTOMER_ID, ORDER_ID, AGENT_NAME, ACTION, OVERSIGHT_TIER, STATUS, PROPOSED_ACTION, REASONING, REFUND_AMOUNT, REVIEWED_BY, AGENT_TIME_SECS, REVIEW_TIME_SECS, CREATED_AT, RESOLVED_AT)
VALUES ('WF-002', 'CUST-003', 'BSC-20260214-1103', 'MemoryAgent v1', 'Tracking update provided', 'green', 'auto', 'Provided tracking link and estimated delivery window. No financial action required.', 'Customer requested tracking update. Standard lookup. No policy issue. Auto-resolved.', 0.00, 'AutoApproved', 4, 0, SYSTIMESTAMP - INTERVAL '12' HOUR, SYSTIMESTAMP - INTERVAL '12' HOUR);

INSERT INTO CC_WORKFLOW_LOG (LOG_ID, CUSTOMER_ID, ORDER_ID, AGENT_NAME, ACTION, OVERSIGHT_TIER, STATUS, PROPOSED_ACTION, REASONING, EVIDENCE, REFUND_AMOUNT, REVIEWED_BY, AGENT_TIME_SECS, CREATED_AT)
VALUES ('WF-003', 'CUST-003', 'BSC-20260214-1103', 'MemoryAgent v1', 'Flash-Sale gift card store credit offer', 'yellow', 'pending', 'Offer one-time 50% store credit ($60) per POL-003. Customer is new — first Flash-Sale return.', 'Customer Sandra Cho asks to return Flash-Sale item purchased with gift card. Policy POL-003 applies: no return, no cash refund, eligible for 50% store credit one-time. Customer is Standard tier, no exception history.', 'Order BSC-20260214-1103. Policy POL-003 retrieved from CC_POLICIES.', 60.00, NULL, 18, SYSTIMESTAMP - INTERVAL '6' HOUR);

INSERT INTO CC_WORKFLOW_LOG (LOG_ID, CUSTOMER_ID, ORDER_ID, AGENT_NAME, ACTION, OVERSIGHT_TIER, STATUS, PROPOSED_ACTION, REASONING, EVIDENCE, REFUND_AMOUNT, REVIEWED_BY, AGENT_TIME_SECS, CREATED_AT)
VALUES ('WF-004', 'CUST-001', 'BSC-20260128-0847', 'MemoryAgent v1', 'Full refund — Final Sale missing vinyl with police report', 'red', 'pending', 'Issue full refund of $400 to Elena Vasquez for Order BSC-20260128-0847. Send confirmation email.', 'VIP customer Elena Vasquez (4 years, $4,200 spend) reports missing Final Sale vinyl record. Carrier shows Delivered but customer filed police report SFPD-2026-14821. Episodic memory confirms two prior chatbot failures — original denial was chatbot error. Policy POL-004: Final Sale refund permitted for verified missing with police report. Policy POL-005: VIP override eligible. Refund $400 exceeds auto-approve threshold — CSM approval required per POL-006.', 'Police report SFPD-2026-14821. Order BSC-20260128-0847. Interaction logs INT-001, INT-002, INT-003. VIP status confirmed CC_CUSTOMERS. Policies POL-004, POL-005, POL-006 retrieved.', 400.00, NULL, 47, SYSTIMESTAMP - INTERVAL '2' HOUR);

-- Audit Log
INSERT INTO CC_AUDIT_LOG (AUDIT_ID, OPERATION, NAMESPACE, MEMORY_ID, CUSTOMER_ID, PERFORMED_BY, CONTENT_SUMMARY, WAS_BLOCKED, CREATED_AT)
VALUES ('AUD-001', 'READ', 'support', 'MEM-001', 'CUST-001', 'MemoryAgent v1', 'Retrieved episodic memory: first chatbot denial for Order BSC-20260128-0847', 'N', SYSTIMESTAMP - INTERVAL '2' HOUR);

INSERT INTO CC_AUDIT_LOG (AUDIT_ID, OPERATION, NAMESPACE, MEMORY_ID, CUSTOMER_ID, PERFORMED_BY, CONTENT_SUMMARY, WAS_BLOCKED, CREATED_AT)
VALUES ('AUD-002', 'READ', 'support', 'MEM-002', 'CUST-001', 'MemoryAgent v1', 'Retrieved episodic memory: police report SFPD-2026-14821', 'N', SYSTIMESTAMP - INTERVAL '2' HOUR);

INSERT INTO CC_AUDIT_LOG (AUDIT_ID, OPERATION, NAMESPACE, MEMORY_ID, CUSTOMER_ID, PERFORMED_BY, CONTENT_SUMMARY, WAS_BLOCKED, BLOCK_REASON, CREATED_AT)
VALUES ('AUD-003', 'BLOCK', 'support', NULL, 'CUST-003', 'MemoryAgent v1', 'Attempted write: customer claimed full cash refunds for used items are policy', 'Y', 'Conflict detected: claim contradicts official policy POL-001 and POL-002. User-provided claim not verified against source of truth. Write rejected. Flagged for CSM review.', SYSTIMESTAMP - INTERVAL '1' HOUR);

INSERT INTO CC_AUDIT_LOG (AUDIT_ID, OPERATION, NAMESPACE, MEMORY_ID, CUSTOMER_ID, PERFORMED_BY, CONTENT_SUMMARY, WAS_BLOCKED, CREATED_AT)
VALUES ('AUD-004', 'EXPIRE', 'support', 'MEM-007', 'CUST-001', 'System', 'TTL expiry scheduled: wedding context expires in 14 days (approx March 17, 2026)', 'N', SYSTIMESTAMP);

INSERT INTO CC_AUDIT_LOG (AUDIT_ID, OPERATION, NAMESPACE, MEMORY_ID, CUSTOMER_ID, PERFORMED_BY, CONTENT_SUMMARY, WAS_BLOCKED, BLOCK_REASON, CREATED_AT)
VALUES ('AUD-005', 'READ', 'logistics', 'MEM-008', NULL, 'MemoryAgent v1', 'Attempted read: support agent tried to access logistics namespace', 'Y', 'Namespace isolation: support agents do not have read access to logistics namespace. Access denied.', SYSTIMESTAMP - INTERVAL '30' MINUTE);

COMMIT;

-- =============================================================================
-- SECTION 4: Governance PL/SQL
-- =============================================================================

CREATE OR REPLACE PROCEDURE CC_LOG_AUDIT (
    p_operation       IN VARCHAR2,
    p_namespace       IN VARCHAR2,
    p_memory_id       IN VARCHAR2 DEFAULT NULL,
    p_customer_id     IN VARCHAR2 DEFAULT NULL,
    p_performed_by    IN VARCHAR2,
    p_content_summary IN VARCHAR2,
    p_was_blocked     IN VARCHAR2 DEFAULT 'N',
    p_block_reason    IN VARCHAR2 DEFAULT NULL
) AS
    v_audit_id VARCHAR2(30);
BEGIN
    v_audit_id := 'AUD-' || TO_CHAR(SYSTIMESTAMP, 'YYYYMMDDHH24MISSFF3');
    INSERT INTO CC_AUDIT_LOG (AUDIT_ID, OPERATION, NAMESPACE, MEMORY_ID, CUSTOMER_ID, PERFORMED_BY, CONTENT_SUMMARY, WAS_BLOCKED, BLOCK_REASON, CREATED_AT)
    VALUES (v_audit_id, p_operation, p_namespace, p_memory_id, p_customer_id, p_performed_by, p_content_summary, p_was_blocked, p_block_reason, SYSTIMESTAMP);
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN NULL;
END CC_LOG_AUDIT;
/

CREATE OR REPLACE FUNCTION CC_VALIDATE_MEMORY_WRITE (
    p_proposed_content IN VARCHAR2,
    p_namespace        IN VARCHAR2,
    p_customer_id      IN VARCHAR2 DEFAULT NULL,
    p_performed_by     IN VARCHAR2 DEFAULT 'MemoryAgent v1'
) RETURN VARCHAR2 AS
    v_content_lower    VARCHAR2(2000);
    v_conflict_found   BOOLEAN := FALSE;
    v_conflict_policy  VARCHAR2(30);
    v_conflict_reason  VARCHAR2(500);
    v_result           VARCHAR2(600);
BEGIN
    v_content_lower := LOWER(p_proposed_content);

    IF (INSTR(v_content_lower, 'full cash refund') > 0 OR INSTR(v_content_lower, 'cash refund for used') > 0 OR INSTR(v_content_lower, 'refund for all items') > 0) THEN
        v_conflict_found  := TRUE;
        v_conflict_policy := 'POL-001, POL-002';
        v_conflict_reason := 'Claim of unrestricted cash refunds contradicts official return policies.';
    END IF;

    IF NOT v_conflict_found AND (INSTR(v_content_lower, 'flash-sale') > 0 OR INSTR(v_content_lower, 'flash sale') > 0) AND (INSTR(v_content_lower, 'can be returned') > 0 OR INSTR(v_content_lower, 'eligible for return') > 0 OR INSTR(v_content_lower, 'full refund') > 0) THEN
        v_conflict_found  := TRUE;
        v_conflict_policy := 'POL-002';
        v_conflict_reason := 'Claim conflicts with Flash-Sale No Return Policy (POL-002).';
    END IF;

    IF NOT v_conflict_found AND (INSTR(v_content_lower, 'manager promised') > 0 OR INSTR(v_content_lower, 'manager said') > 0 OR INSTR(v_content_lower, 'store manager') > 0) AND INSTR(v_content_lower, 'refund') > 0 THEN
        v_conflict_found  := TRUE;
        v_conflict_policy := 'POL-001';
        v_conflict_reason := 'Unverified verbal claim from unnamed manager. Cannot write to official memory.';
    END IF;

    IF NOT v_conflict_found AND (INSTR(v_content_lower, 'final sale') > 0) AND (INSTR(v_content_lower, 'always') > 0 OR INSTR(v_content_lower, 'any reason') > 0) THEN
        v_conflict_found  := TRUE;
        v_conflict_policy := 'POL-004';
        v_conflict_reason := 'Claim about Final Sale return eligibility is too broad.';
    END IF;

    IF v_conflict_found THEN
        v_result := 'BLOCKED:' || v_conflict_reason || ' (Conflicts with ' || v_conflict_policy || ')';
        CC_LOG_AUDIT('BLOCK', p_namespace, NULL, p_customer_id, p_performed_by, 'Attempted write blocked: ' || SUBSTR(p_proposed_content, 1, 200), 'Y', v_conflict_reason || ' (Conflicts with ' || v_conflict_policy || ')');
    ELSE
        v_result := 'APPROVED';
        CC_LOG_AUDIT('WRITE', p_namespace, NULL, p_customer_id, p_performed_by, 'Write approved: ' || SUBSTR(p_proposed_content, 1, 200), 'N');
    END IF;

    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN RETURN 'APPROVED';
END CC_VALIDATE_MEMORY_WRITE;
/

CREATE OR REPLACE FUNCTION CC_CHECK_NAMESPACE_ACCESS (
    p_agent_role   IN VARCHAR2,
    p_namespace    IN VARCHAR2,
    p_performed_by IN VARCHAR2 DEFAULT 'MemoryAgent v1'
) RETURN VARCHAR2 AS
    v_role_lower VARCHAR2(50);
    v_ns_lower   VARCHAR2(50);
    v_result     VARCHAR2(300);
BEGIN
    v_role_lower := LOWER(p_agent_role);
    v_ns_lower   := LOWER(p_namespace);

    IF v_role_lower IN ('admin', 'internal', 'marcus', 'csm') THEN
        v_result := 'GRANTED';
    ELSIF v_role_lower = 'support' THEN
        IF v_ns_lower = 'support' THEN v_result := 'GRANTED';
        ELSE v_result := 'DENIED:Support agents do not have access to the ' || p_namespace || ' namespace.';
        END IF;
    ELSIF v_role_lower = 'logistics' THEN
        IF v_ns_lower = 'logistics' THEN v_result := 'GRANTED';
        ELSE v_result := 'DENIED:Logistics agents do not have access to the ' || p_namespace || ' namespace.';
        END IF;
    ELSE
        v_result := 'DENIED:Unrecognized agent role. Access denied to all namespaces.';
    END IF;

    CC_LOG_AUDIT('READ', p_namespace, NULL, NULL, p_performed_by, 'Namespace access check: role=' || p_agent_role || ' namespace=' || p_namespace,
        CASE WHEN INSTR(v_result, 'DENIED') > 0 THEN 'Y' ELSE 'N' END,
        CASE WHEN INSTR(v_result, 'DENIED') > 0 THEN SUBSTR(v_result, INSTR(v_result, ':') + 1) ELSE NULL END);

    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN RETURN 'DENIED:System error during access check.';
END CC_CHECK_NAMESPACE_ACCESS;
/

CREATE OR REPLACE PROCEDURE CC_EXPIRE_MEMORY AS
    v_expired_count NUMBER := 0;
BEGIN
    UPDATE CC_MEMORY SET UPDATED_AT = SYSTIMESTAMP
    WHERE EXPIRES_AT IS NOT NULL AND EXPIRES_AT <= SYSDATE AND TTL_DAYS IS NOT NULL;
    v_expired_count := SQL%ROWCOUNT;
    IF v_expired_count > 0 THEN
        CC_LOG_AUDIT('EXPIRE', 'system', NULL, NULL, 'System', v_expired_count || ' memory entries processed for TTL expiry.', 'N');
    END IF;
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN ROLLBACK; RAISE;
END CC_EXPIRE_MEMORY;
/

COMMIT;

-- =============================================================================
-- SECTION 5: AI Profile (Select AI — backed by Ollama gemma:2b)
-- =============================================================================
-- The DBMS_CLOUD_AI profile uses the Ollama container as its LLM provider.
-- This enables Oracle Select AI and Select AI Agent features (e.g. narrate,
-- chat, runsql) while routing all inference to the local Ollama instance.
-- =============================================================================

BEGIN
    DBMS_CLOUD_AI.DROP_PROFILE(profile_name => 'CC_PROFILE');
EXCEPTION
    WHEN OTHERS THEN NULL;
END;
/

BEGIN
    DBMS_CLOUD_AI.CREATE_PROFILE(
        profile_name => 'CC_PROFILE',
        attributes   => '{
            "provider": "ollama",
            "model": "gemma:2b",
            "ollama_url": "http://bsc-ollama:11434",
            "object_list": [
                {"owner": "HUB_USER", "name": "CC_CUSTOMERS"},
                {"owner": "HUB_USER", "name": "CC_ORDERS"},
                {"owner": "HUB_USER", "name": "CC_INTERACTIONS"},
                {"owner": "HUB_USER", "name": "CC_POLICIES"},
                {"owner": "HUB_USER", "name": "CC_MEMORY"},
                {"owner": "HUB_USER", "name": "CC_WORKFLOW_LOG"},
                {"owner": "HUB_USER", "name": "CC_AUDIT_LOG"}
            ]
        }'
    );
END;
/

COMMIT;
-- End of init.sql


COMMIT;
-- End of init.sql
