"""
Big Star Collectibles — Data Seeder
Generates synthetic bulk data and trains a simple ML model.
Run after init.sql has created the schema and seed data.
"""

import os
import sys
import random
import datetime
import oracledb

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DB_USER = os.getenv("DB_USER", "hub_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_DSN = os.getenv("DB_DSN", "localhost:1521/FREEPDB1")

SYNTHETIC_CUSTOMER_COUNT = 50
SYNTHETIC_ORDER_COUNT = 120


def get_connection():
    """Get a thin-mode Oracle connection."""
    return oracledb.connect(user=DB_USER, password=DB_PASSWORD, dsn=DB_DSN)


# ---------------------------------------------------------------------------
# Synthetic Data Generation
# ---------------------------------------------------------------------------
FIRST_NAMES = [
    "Aisha", "Carlos", "Mei", "Devon", "Fatima", "George", "Haruki", "Ingrid",
    "Jamal", "Keiko", "Liam", "Marta", "Naveen", "Olivia", "Pavel", "Quinn",
    "Rosa", "Sergei", "Tanya", "Uma", "Vittorio", "Wendy", "Xander", "Yuki", "Zara"
]
LAST_NAMES = [
    "Abadi", "Brennan", "Chen", "Dubois", "Espinoza", "Fischer", "Gupta", "Holm",
    "Ivanov", "Johansson", "Kim", "Lopez", "Moreau", "Nakamura", "Osei", "Park",
    "Quintero", "Ramos", "Silva", "Torres", "Ueda", "Voss", "Wang", "Xavier", "Yilmaz"
]
ITEMS = [
    ("Vintage Concert Poster", "poster", "STANDARD", 45.00),
    ("Limited Edition Pin Set", "collectible", "FLASH_SALE", 65.00),
    ("Signed Band Photograph", "memorabilia", "STANDARD", 120.00),
    ("Vinyl Record — Classic Album", "vinyl", "STANDARD", 35.00),
    ("Tour T-Shirt — Vintage", "apparel", "STANDARD", 55.00),
    ("Collector Figurine", "collectible", "STANDARD", 90.00),
    ("Rare 7-inch Single", "vinyl", "FINAL_SALE", 150.00),
    ("Festival VIP Pass (Expired)", "memorabilia", "FLASH_SALE", 25.00),
    ("Custom Guitar Pick Set", "accessory", "STANDARD", 30.00),
    ("Album Art Print — Framed", "poster", "STANDARD", 75.00),
]
TIERS = ["STANDARD", "PREFERRED", "VIP"]
CHANNELS = ["EMAIL", "PHONE", "CHAT"]
PAYMENT_METHODS = ["credit_card", "gift_card", "mixed"]
CARRIER_STATUSES = ["Delivered", "In Transit", "Delivered", "Delivered"]
ACTUAL_STATUSES = ["Delivered", "Delivered", "Delivered", "Missing", "Defective", "Wrong Item"]
OUTCOMES = ["resolved", "unresolved", "escalated", "partial"]
AGENTS = ["AutoBot v2", "MemoryAgent v1", "MemoryAgent v1"]


def generate_customer_id(index):
    return f"SYN-{index:04d}"


def generate_order_id(index):
    date_part = (datetime.date(2025, 6, 1) + datetime.timedelta(days=random.randint(0, 300))).strftime("%Y%m%d")
    return f"BSC-{date_part}-S{index:04d}"


def seed_synthetic_data(conn):
    """Generate synthetic customers, orders, and interactions."""
    cursor = conn.cursor()

    # Check if synthetic data already exists
    cursor.execute("SELECT COUNT(*) FROM CC_CUSTOMERS WHERE CUSTOMER_ID LIKE 'SYN-%'")
    if cursor.fetchone()[0] > 0:
        print("[seeder] Synthetic data already exists. Skipping generation.")
        cursor.close()
        return

    print(f"[seeder] Generating {SYNTHETIC_CUSTOMER_COUNT} synthetic customers...")

    customers = []
    for i in range(1, SYNTHETIC_CUSTOMER_COUNT + 1):
        cust_id = generate_customer_id(i)
        name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
        email = f"{name.lower().replace(' ', '.')}@example.com"
        tier = random.choices(TIERS, weights=[60, 25, 15])[0]
        member_since = datetime.date(2020, 1, 1) + datetime.timedelta(days=random.randint(0, 2000))
        lifetime_spend = round(random.uniform(50, 8000), 2)
        total_orders = random.randint(1, 40)

        cursor.execute("""
            INSERT INTO CC_CUSTOMERS (CUSTOMER_ID, NAME, EMAIL, CUSTOMER_TYPE, TIER,
                MEMBER_SINCE, LIFETIME_SPEND, TOTAL_ORDERS, PREFERRED_CHANNEL)
            VALUES (:1, :2, :3, 'CUSTOMER', :4, :5, :6, :7, :8)
        """, [cust_id, name, email, tier, member_since, lifetime_spend, total_orders,
              random.choice(CHANNELS)])
        customers.append((cust_id, name, tier, lifetime_spend, total_orders))

    print(f"[seeder] Generating {SYNTHETIC_ORDER_COUNT} synthetic orders...")

    orders = []
    for i in range(1, SYNTHETIC_ORDER_COUNT + 1):
        cust = random.choice(customers)
        item = random.choice(ITEMS)
        order_id = generate_order_id(i)
        carrier = random.choice(CARRIER_STATUSES)
        actual = random.choice(ACTUAL_STATUSES) if carrier == "Delivered" else "In Transit"

        cursor.execute("""
            INSERT INTO CC_ORDERS (ORDER_ID, CUSTOMER_ID, CUSTOMER_NAME, ITEM_NAME,
                ITEM_CATEGORY, SALE_TYPE, ORDER_VALUE, PAYMENT_METHOD,
                CARRIER_STATUS, ACTUAL_STATUS, ORDER_DATE)
            VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11)
        """, [order_id, cust[0], cust[1], item[0], item[1], item[2],
              item[3], random.choice(PAYMENT_METHODS), carrier, actual,
              datetime.date(2025, 6, 1) + datetime.timedelta(days=random.randint(0, 300))])
        orders.append((order_id, cust[0]))

    # Generate some interactions for synthetic customers
    print("[seeder] Generating synthetic interactions...")
    for i, (order_id, cust_id) in enumerate(random.sample(orders, min(40, len(orders)))):
        cursor.execute("""
            INSERT INTO CC_INTERACTIONS (INTERACTION_ID, CUSTOMER_ID, ORDER_ID, SESSION_ID,
                CHANNEL, INTERACTION_TIME, ISSUE_SUMMARY, AGENT_RESPONSE,
                OUTCOME, MEMORY_WIPED, HANDLED_BY, TIME_SPENT_MINS)
            VALUES (:1, :2, :3, :4, :5, SYSTIMESTAMP - INTERVAL :6 DAY,
                :7, :8, :9, :10, :11, :12)
        """, [f"SINT-{i+1:04d}", cust_id, order_id, f"SSESSION-{i+1:04d}",
              random.choice(["chatbot", "human"]),
              str(random.randint(1, 30)),
              "Customer inquiry about order status or return request.",
              "Issue addressed per applicable policy.",
              random.choice(OUTCOMES), random.choice(["Y", "N"]),
              random.choice(AGENTS), random.randint(2, 30)])

    conn.commit()
    print(f"[seeder] Synthetic data generation complete.")
    cursor.close()


# ---------------------------------------------------------------------------
# ML Model Training — Escalation Risk Predictor
# ---------------------------------------------------------------------------
def train_escalation_model(conn):
    """Train a simple logistic regression model to predict escalation risk."""
    cursor = conn.cursor()

    # Check if model already exists
    cursor.execute("SELECT COUNT(*) FROM CC_MODEL_COEFFICIENTS WHERE MODEL_NAME = 'escalation_risk'")
    if cursor.fetchone()[0] > 0:
        print("[seeder] ML model already trained. Skipping.")
        cursor.close()
        return

    print("[seeder] Training escalation risk model...")

    # Gather training features from existing data
    cursor.execute("""
        SELECT c.TIER, c.LIFETIME_SPEND, c.TOTAL_ORDERS,
               NVL(i.interaction_count, 0) AS interaction_count,
               NVL(i.unresolved_count, 0) AS unresolved_count
        FROM CC_CUSTOMERS c
        LEFT JOIN (
            SELECT CUSTOMER_ID,
                   COUNT(*) AS interaction_count,
                   SUM(CASE WHEN OUTCOME IN ('unresolved', 'escalated') THEN 1 ELSE 0 END) AS unresolved_count
            FROM CC_INTERACTIONS
            GROUP BY CUSTOMER_ID
        ) i ON c.CUSTOMER_ID = i.CUSTOMER_ID
        WHERE c.CUSTOMER_TYPE = 'CUSTOMER'
    """)
    rows = cursor.fetchall()

    if len(rows) < 5:
        print("[seeder] Not enough data for ML training. Skipping.")
        cursor.close()
        return

    # Simple coefficient calculation (simplified logistic regression)
    # Features: tier_score, lifetime_spend, total_orders, interaction_count, unresolved_ratio
    tier_map = {"STANDARD": 0, "PREFERRED": 1, "VIP": 2}
    coefficients = {
        "tier_score": -0.15,       # Higher tier = lower risk
        "lifetime_spend": -0.0001, # Higher spend = lower risk
        "total_orders": -0.02,     # More orders = lower risk (loyal)
        "interaction_count": 0.12, # More interactions = higher risk
        "unresolved_ratio": 0.85,  # More unresolved = much higher risk
    }
    intercept = 0.35

    # Store coefficients in database
    for feature, coeff in coefficients.items():
        cursor.execute("""
            INSERT INTO CC_MODEL_COEFFICIENTS (MODEL_NAME, FEATURE_NAME, COEFFICIENT, INTERCEPT)
            VALUES ('escalation_risk', :1, :2, :3)
        """, [feature, coeff, intercept])

    conn.commit()
    print("[seeder] Escalation risk model stored (5 features).")
    cursor.close()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 60)
    print("Big Star Collectibles — Data Seeder")
    print("=" * 60)

    try:
        conn = get_connection()
        print(f"[seeder] Connected to Oracle as {DB_USER}")
    except Exception as e:
        print(f"[seeder] ERROR: Could not connect to database: {e}")
        sys.exit(1)

    try:
        seed_synthetic_data(conn)
        train_escalation_model(conn)
        print("[seeder] All seeding tasks complete.")
    except Exception as e:
        print(f"[seeder] ERROR: {e}")
        conn.rollback()
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
