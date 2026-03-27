"""
Big Star Collectibles — FastAPI Backend
Ports all scene routes from the Node.js/Express backend.
Serves the HTML dashboard via Jinja2.
"""

import os
import re
import asyncio
from datetime import datetime
from typing import Optional

import httpx
import oracledb
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DB_USER = os.getenv("DB_USER", "hub_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_DSN = os.getenv("DB_DSN", "localhost:1521/FREEPDB1")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
ORDS_HOST = os.getenv("ORDS_HOST", "http://localhost:8181")


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


OLLAMA_TIMEOUT_SECS = _env_float("OLLAMA_TIMEOUT_SECS", 300.0)
OLLAMA_RETRIES = max(1, _env_int("OLLAMA_RETRIES", 2))
OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "30m")

app = FastAPI(title="Big Star Collectibles", version="1.0.0")
templates = Jinja2Templates(directory="templates")

# ---------------------------------------------------------------------------
# Database Helpers
# ---------------------------------------------------------------------------
pool = None


async def get_pool():
    global pool
    if pool is None:
        pool = oracledb.create_pool(
            user=DB_USER, password=DB_PASSWORD, dsn=DB_DSN,
            min=2, max=10, increment=1
        )
    return pool


async def query(sql: str, params: dict = None) -> list:
    """Execute SQL and return list of dicts."""
    p = await get_pool()
    with p.acquire() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or {})
            if cur.description:
                cols = [c[0] for c in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]
            return []


async def execute(sql: str, params: dict = None):
    """Execute SQL (INSERT/UPDATE/DELETE) and commit."""
    p = await get_pool()
    with p.acquire() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or {})
        conn.commit()


async def call_function(func_name: str, params: list, return_type=str):
    """Call a PL/SQL function and return the result."""
    p = await get_pool()
    with p.acquire() as conn:
        with conn.cursor() as cur:
            result = cur.callfunc(func_name, return_type, params)
            return result


# ---------------------------------------------------------------------------
# Ollama Helper
# ---------------------------------------------------------------------------
async def ollama_generate(prompt: str, model: str = "gemma:2b") -> str:
    """Call Ollama API, supporting both chat and generate endpoints."""
    last_error = None
    for attempt in range(OLLAMA_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECS) as client:
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "keep_alive": OLLAMA_KEEP_ALIVE,
                }
                # Prefer /api/chat for recent Ollama versions.
                chat_resp = await client.post(f"{OLLAMA_HOST}/api/chat", json=payload)
                if chat_resp.status_code < 400:
                    data = chat_resp.json()
                    return (data.get("message", {}) or {}).get("content", "")

                # Fallback for older Ollama versions exposing /api/generate.
                if chat_resp.status_code == 404:
                    gen_resp = await client.post(f"{OLLAMA_HOST}/api/generate", json={
                        "model": model,
                        "prompt": prompt,
                        "stream": False,
                        "keep_alive": OLLAMA_KEEP_ALIVE,
                    })
                    gen_resp.raise_for_status()
                    return gen_resp.json().get("response", "")

                # Retry transient server errors while model is cold-starting.
                if chat_resp.status_code >= 500 and attempt < OLLAMA_RETRIES - 1:
                    await asyncio.sleep(2 * (attempt + 1))
                    continue

                chat_resp.raise_for_status()
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.ConnectError, httpx.RemoteProtocolError) as exc:
            last_error = exc
            if attempt < OLLAMA_RETRIES - 1:
                await asyncio.sleep(2 * (attempt + 1))
                continue
            raise

    if last_error is not None:
        raise last_error
    raise RuntimeError("Ollama request failed after retries.")


# ---------------------------------------------------------------------------
# AI Chat Helper (Ollama only)
# ---------------------------------------------------------------------------
async def select_ai_chat(_task_name: str, prompt: str) -> str:
    """Generate an agent response directly from Ollama."""
    try:
        return await ollama_generate(prompt, model="gemma:2b")
    except Exception as exc:
        print(f"[app] Ollama request failed: {exc}")
        return ""


def _contains_any(text: str, phrases: list[str]) -> bool:
    return any(phrase in text for phrase in phrases)


def _extract_upper_tokens(text: str, pattern: str) -> set[str]:
    return {match.upper() for match in re.findall(pattern, text or "", re.IGNORECASE)}


def _scene1_needs_fallback(response: str, order_id: str) -> bool:
    lowered = (response or "").lower()
    if not response.strip():
        return True

    refusal_phrases = [
        "unable to access",
        "cannot access",
        "can't access",
        "do not have access",
        "don't have access",
        "no prior interaction",
        "no previous interaction",
        "no memory",
    ]
    if _contains_any(lowered, refusal_phrases):
        return True

    expected_order = (order_id or "").upper()
    response_orders = _extract_upper_tokens(response, r"BSC-\d{8}-\d{4}")
    if expected_order:
        if expected_order.lower() not in lowered:
            return True
        if response_orders and response_orders != {expected_order}:
            return True

    policy_ids = _extract_upper_tokens(response, r"POL-[A-Z0-9-]+")
    if "POL-001" not in policy_ids:
        return True
    if policy_ids - {"POL-001"}:
        return True

    if "vip" not in lowered:
        return True

    if "[" in response or "]" in response:
        return True

    if not _contains_any(lowered, ["replacement", "refund", "return shipping"]):
        return True

    return False


def _scene3_needs_fallback(response: str, interactions: list[dict]) -> bool:
    lowered = (response or "").lower()
    if not response.strip() or not interactions:
        return True

    refusal_phrases = [
        "unable to access",
        "unable to review",
        "i don't have access",
        "i do not have access",
        "don't have context",
        "do not have context",
        "cannot access previous",
        "can't access previous",
        "no memory records",
        "no previous interactions",
    ]
    if _contains_any(lowered, refusal_phrases):
        return True

    interaction_tokens = [
        (r.get("INTERACTION_ID") or "").lower()
        for r in interactions[:3]
    ] + [
        (r.get("SESSION_ID") or "").lower()
        for r in interactions[:3]
    ]
    if not any(token and token in lowered for token in interaction_tokens):
        return True

    required_markers = ["bsc-20260128-0847", "sfpd-2026-14821"]
    if not all(marker in lowered for marker in required_markers):
        return True

    contradiction_phrases = [
        "file a police report",
        "contact the police",
        "contact your insurance",
        "describe your issue from the beginning",
        "start from the beginning",
        "repeat your case",
        "repeat everything",
    ]
    if _contains_any(lowered, contradiction_phrases):
        return True

    resolution_phrases = ["refund", "replacement", "approval", "resolve", "escalat"]
    if not _contains_any(lowered, resolution_phrases):
        return True

    return False


def _scene4_needs_fallback(response: str, store_credit: float) -> bool:
    lowered = (response or "").lower()
    if not response.strip():
        return True

    refusal_phrases = [
        "cannot access",
        "can't access",
        "unable to access",
        "cannot retrieve",
        "can't retrieve",
        "unable to retrieve",
        "don't have access",
        "do not have access",
        "i cannot access",
        "i'm unable to access",
    ]
    if _contains_any(lowered, refusal_phrases):
        return True

    policy_ids = _extract_upper_tokens(response, r"POL-[A-Z0-9-]+")
    if not {"POL-002", "POL-003"}.issubset(policy_ids):
        return True

    if "store credit" not in lowered:
        return True

    if store_credit:
        store_credit_markers = [f"${store_credit:.2f}".lower(), f"${store_credit:.0f}".lower(), "50%"]
        if not _contains_any(lowered, store_credit_markers):
            return True

    if "return authorization" in lowered:
        return True

    return False


def _scene1_memory_fallback(message: str) -> str:
    """Deterministic Scene 1 fallback when Ollama is warming up/unavailable."""
    order_match = re.search(r"(BSC-\d{8}-\d{4})", message or "", re.IGNORECASE)
    order_id = order_match.group(1) if order_match else "BSC-20251105-0312"
    return (
        f"Thanks Elena, I reviewed your account and prior support history for {order_id}. "
        "You are a VIP customer and this is a defect case (faded print after one wash), "
        "so it qualifies under POL-001 as a product-quality exception.\n\n"
        "I am approving an immediate replacement and offering prepaid return shipping for the defective item. "
        "If you prefer, I can switch this to a full refund instead."
    )


# ---------------------------------------------------------------------------
# Routes — Dashboard
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def serve_dashboard(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/api/health")
async def health():
    try:
        rows = await query("SELECT 1 AS OK FROM dual")
        db_ok = len(rows) > 0
    except Exception:
        db_ok = False
    return {"status": "ok", "database": db_ok, "timestamp": datetime.utcnow().isoformat()}


# ---------------------------------------------------------------------------
# Scene 1 — Chatbot vs Memory-Enabled Agent
# ---------------------------------------------------------------------------
@app.post("/api/scene1/chatbot")
async def scene1_chatbot(request: Request):
    body = await request.json() if await request.body() else {}
    message = body.get("message", "My t-shirt print is faded after one wash")
    await asyncio.sleep(0.7)
    return {
        "response": (
            "I'm sorry to hear about that! Unfortunately, once an item has been "
            "worn and washed, it falls outside our standard return window. I am "
            "unable to process a return for used clothing items.\n\n"
            "Is there anything else I can help you with today?"
        ),
        "agent": "AutoBot v2",
        "hasMemory": False,
        "steps": [
            {"label": "Received message", "detail": f"Customer says: \"{message}\""},
            {"label": "Checked return policy", "detail": "Standard return window is 30 days. Item must be unused."},
            {"label": "Denied claim", "detail": "Item has been used (washed). Outside return policy."}
        ]
    }


@app.post("/api/scene1/agent")
async def scene1_agent(request: Request):
    body = await request.json() if await request.body() else {}
    message = body.get("message", "My t-shirt print is faded after one wash. Order BSC-20251105-0312.")
    order_match = re.search(r"(BSC-\d{8}-\d{4})", message or "", re.IGNORECASE)
    order_id = order_match.group(1) if order_match else "BSC-20251105-0312"

    customer_rows = await query("""
        SELECT CUSTOMER_ID, NAME, TIER, MEMBER_SINCE, LIFETIME_SPEND
        FROM CC_CUSTOMERS
        WHERE CUSTOMER_ID = 'CUST-001'
    """)
    order_rows = await query("""
        SELECT ORDER_ID, ITEM_NAME, ACTUAL_STATUS, SALE_TYPE, ORDER_VALUE
        FROM CC_ORDERS
        WHERE ORDER_ID = :order_id
    """, {"order_id": order_id})
    policy_rows = await query("""
        SELECT POLICY_ID, POLICY_NAME, RULE_TEXT
        FROM CC_POLICIES
        WHERE POLICY_ID = 'POL-001'
          AND ACTIVE = 'Y'
          AND IS_OFFICIAL = 'Y'
    """)
    interaction_rows = await query("""
        SELECT INTERACTION_ID, SESSION_ID, OUTCOME
        FROM CC_INTERACTIONS
        WHERE CUSTOMER_ID = 'CUST-001'
        ORDER BY INTERACTION_TIME DESC
        FETCH FIRST 3 ROWS ONLY
    """)

    customer = customer_rows[0] if customer_rows else None
    order = order_rows[0] if order_rows else None
    policy = policy_rows[0] if policy_rows else None
    profile_context = (
        f"Customer profile: {customer['NAME']} ({customer['CUSTOMER_ID']}), "
        f"tier={customer['TIER']}, lifetime_spend={float(customer['LIFETIME_SPEND']):.2f}"
        if customer else
        "Customer profile unavailable."
    )
    order_context = (
        f"Order {order['ORDER_ID']}: item={order['ITEM_NAME']}, "
        f"sale_type={order['SALE_TYPE']}, status={order['ACTUAL_STATUS']}, "
        f"order_value={float(order['ORDER_VALUE']):.2f}"
        if order else
        f"Order {order_id} was not found."
    )
    history_context = ", ".join(
        f"{r['INTERACTION_ID']} ({r['SESSION_ID']}): {r['OUTCOME']}"
        for r in interaction_rows
    ) or "No recent interaction history found."
    policy_context = (
        f"{policy['POLICY_ID']} ({policy['POLICY_NAME']}): {policy['RULE_TEXT']}"
        if policy else
        "POL-001 was not found."
    )
    prompt = (
        "You are MemoryAgent v1 for Big Star Collectibles.\n"
        "You already have the retrieved customer, order, history, and policy data below.\n"
        "Do NOT invent dates, policy IDs, sizes, or product details.\n\n"
        f"Customer message:\n\"{message}\"\n\n"
        f"{profile_context}\n"
        f"{order_context}\n"
        f"Recent support history: {history_context}\n"
        f"Relevant policy: {policy_context}\n\n"
        "Respond concisely. You must cite the order ID and POL-001, acknowledge the VIP context, "
        "and offer an immediate remedy."
    )
    agent_response = await select_ai_chat("CC_SUPPORT_TASK", prompt)

    if _scene1_needs_fallback(agent_response, order_id):
        agent_response = _scene1_memory_fallback(message)

    return {
        "response": agent_response,
        "agent": "MemoryAgent v1",
        "hasMemory": True,
        "steps": [
            {"label": "Retrieved customer profile", "detail": "Elena Vasquez — VIP, 4-year member, $4,200 spend"},
            {"label": "Loaded interaction history", "detail": "Found 3 prior sessions including 2 unresolved chatbot contacts"},
            {"label": "Checked long-term memory", "detail": "Semantic: POL-001 product-quality exception applies for a defective standard item."},
            {"label": "Verified order", "detail": "BSC-20251105-0312 — Vintage Band T-Shirt, defective print"},
            {"label": "Applied policy", "detail": "POL-001 standard return. Item is defective — return eligible regardless of use."},
            {"label": "Generated response", "detail": "Personalized resolution with VIP acknowledgment"}
        ]
    }


# ---------------------------------------------------------------------------
# Scene 2 — Agent Planning & Decomposition
# ---------------------------------------------------------------------------
@app.post("/api/scene2/decompose")
async def scene2_decompose(request: Request):
    body = await request.json() if await request.body() else {}
    message = body.get("message",
        "Elena Vasquez got the wrong size t-shirt. She ordered M but received L. "
        "She has a concert next weekend and needs the right size urgently. Order BSC-20260220-0561.")
    prompt = (
        f"A customer contacts you:\n\n\"{message}\"\n\n"
        f"First output a numbered PLAN — break the goal into the minimum ordered steps. "
        f"For each step state: (1) what you are doing, (2) which tool you call, (3) why. "
        f"After the plan, EXECUTE each step and show the result."
    )
    agent_response = await select_ai_chat("CC_PLANNING_TASK", prompt)

    # Parse into plan and execution phases
    plan_steps = []
    exec_steps = []
    lines = agent_response.split("\n")
    in_exec = False
    step_num = 0

    for line in lines:
        line_stripped = line.strip()
        if not line_stripped:
            continue
        normalized_line = re.sub(r"[*_`]+", "", line_stripped)
        if re.match(r"^(EXECUT|Step \d+ Result|Result|Executing)", normalized_line, re.IGNORECASE):
            in_exec = True
            continue
        if not in_exec and re.match(r"^\d+[\.\)]\s", line_stripped):
            step_num += 1
            tool = "unknown"
            for t in ["CC_TOOL_LOOKUP_CUSTOMER", "CC_TOOL_GET_ORDER", "CC_TOOL_GET_INTERACTIONS",
                       "CC_TOOL_GET_MEMORY", "CC_TOOL_GET_POLICY"]:
                if t.lower() in line_stripped.lower() or t.replace("CC_TOOL_", "").lower() in line_stripped.lower():
                    tool = t
                    break
            plan_steps.append({
                "stepNumber": step_num,
                "description": line_stripped,
                "tool": tool,
                "status": "planned"
            })
        elif in_exec and line_stripped:
            exec_steps.append({
                "stepNumber": len(exec_steps) + 1,
                "description": line_stripped,
                "status": "completed"
            })

    if not plan_steps:
        plan_steps = [
            {"stepNumber": 1, "description": "Look up customer Elena Vasquez", "tool": "CC_TOOL_LOOKUP_CUSTOMER", "status": "planned"},
            {"stepNumber": 2, "description": "Get order BSC-20260220-0561 details", "tool": "CC_TOOL_GET_ORDER", "status": "planned"},
            {"stepNumber": 3, "description": "Check interaction history", "tool": "CC_TOOL_GET_INTERACTIONS", "status": "planned"},
            {"stepNumber": 4, "description": "Check return policy for standard items", "tool": "CC_TOOL_GET_POLICY", "status": "planned"},
            {"stepNumber": 5, "description": "Formulate resolution — expedited replacement", "tool": "resolution", "status": "planned"},
        ]

    return {
        "plan": plan_steps,
        "execution": exec_steps,
        "rawResponse": agent_response,
        "agent": "PlanningAgent v1"
    }


# ---------------------------------------------------------------------------
# Scene 3 — The Forgetting Problem
# ---------------------------------------------------------------------------
@app.get("/api/scene3/sessions")
async def scene3_sessions():
    rows = await query("""
        SELECT INTERACTION_ID, CUSTOMER_NAME, SESSION_ID, CHANNEL,
               INTERACTION_TIME, ISSUE_SUMMARY, AGENT_RESPONSE,
               OUTCOME, MEMORY_WIPED, HANDLED_BY, TIME_SPENT_MINS, NOTES
        FROM CC_INTERACTIONS
        WHERE CUSTOMER_ID = 'CUST-001'
        ORDER BY INTERACTION_TIME ASC
    """)
    sessions = []
    for r in rows:
        sessions.append({
            "interactionId": r["INTERACTION_ID"],
            "customerName": r["CUSTOMER_NAME"],
            "sessionId": r["SESSION_ID"],
            "channel": r["CHANNEL"],
            "time": str(r["INTERACTION_TIME"]) if r["INTERACTION_TIME"] else None,
            "issueSummary": r["ISSUE_SUMMARY"],
            "agentResponse": r["AGENT_RESPONSE"],
            "outcome": r["OUTCOME"],
            "memoryWiped": r["MEMORY_WIPED"] == "Y",
            "handledBy": r["HANDLED_BY"],
            "timeSpentMins": r["TIME_SPENT_MINS"],
            "notes": r["NOTES"]
        })
    return {"sessions": sessions, "customer": "Elena Vasquez", "customerId": "CUST-001"}


def _scene3_memory_fallback(interactions: list, memories: list) -> str:
    """Deterministic response when the model fails to use provided memory."""
    if not interactions:
        return (
            "I have memory enabled, but I could not find prior sessions for Elena in "
            "the database. Please load the seeded dataset and retry."
        )

    lines = [
        "I have your full case history loaded, Elena, so you do not need to repeat anything.",
        "",
        "Prior interactions reviewed:"
    ]
    for r in interactions:
        lines.append(
            f"- {r['INTERACTION_ID']} ({r['SESSION_ID']}, {r['CHANNEL']}): "
            f"{r['ISSUE_SUMMARY']} Outcome: {r['OUTCOME']}."
        )

    if memories:
        lines.append("")
        lines.append("Memory highlights used:")
        for m in memories[:3]:
            lines.append(f"- [{m['MEMORY_TYPE']}] {m['CONTENT']}")

    lines.extend([
        "",
        "Resolution with memory:",
        "I am treating Order BSC-20260128-0847 as a verified missing-package case tied to "
        "police report SFPD-2026-14821. I will move directly to refund/replacement approval "
        "under the documented exception path, without asking you to repeat any details."
    ])
    return "\n".join(lines)


@app.post("/api/scene3/with-memory")
async def scene3_with_memory(request: Request):
    body = await request.json() if await request.body() else {}
    message = body.get("message",
        "Hi, I'm calling about my missing vinyl record again. Order BSC-20260128-0847.")

    interactions = await query("""
        SELECT INTERACTION_ID, SESSION_ID, CHANNEL, INTERACTION_TIME, ISSUE_SUMMARY,
               OUTCOME, HANDLED_BY, TIME_SPENT_MINS, NOTES
        FROM CC_INTERACTIONS
        WHERE CUSTOMER_ID = :customer_id
        ORDER BY INTERACTION_TIME ASC
    """, {"customer_id": "CUST-001"})
    memories = await query("""
        SELECT MEMORY_ID, MEMORY_TYPE, CONTENT, SOURCE, CONFIDENCE, IS_VERIFIED, CREATED_AT
        FROM CC_MEMORY
        WHERE CUSTOMER_ID = :customer_id
          AND NAMESPACE = 'support'
          AND IS_VERIFIED = 'Y'
        ORDER BY CREATED_AT ASC
    """, {"customer_id": "CUST-001"})

    interaction_context = "\n".join([
        f"- {r['INTERACTION_ID']} | {r['SESSION_ID']} | {r['CHANNEL']} | "
        f"{r['OUTCOME']} | handled by {r['HANDLED_BY']} | {r['TIME_SPENT_MINS']} min\n"
        f"  Issue: {r['ISSUE_SUMMARY']}\n"
        f"  Notes: {r['NOTES'] or 'n/a'}"
        for r in interactions
    ])
    memory_context = "\n".join([
        f"- {m['MEMORY_ID']} [{m['MEMORY_TYPE']}] ({m['CONFIDENCE']} confidence): {m['CONTENT']}"
        for m in memories
    ])

    prompt = (
        "You are MemoryAgent v1 for Big Star Collectibles.\n"
        "You already have retrieved memory context. Do NOT say you lack access.\n"
        "Do NOT ask Elena to repeat details.\n\n"
        f"Customer message:\n\"{message}\"\n\n"
        "Retrieved interaction history:\n"
        f"{interaction_context or '- none'}\n\n"
        "Retrieved verified memory records:\n"
        f"{memory_context or '- none'}\n\n"
        "Write a concise response that:\n"
        "1) Acknowledges the prior interactions by interaction/session IDs.\n"
        "2) Explains what failed in prior chatbot sessions.\n"
        "3) Gives immediate resolution steps for this case."
    )
    agent_response = await select_ai_chat("CC_SUPPORT_TASK", prompt)

    if _scene3_needs_fallback(agent_response, interactions):
        agent_response = _scene3_memory_fallback(interactions, memories)

    return {
        "response": agent_response,
        "agent": "MemoryAgent v1",
        "hasMemory": True,
        "resolutionTime": "~3 minutes",
        "comparisonNote": "Marcus spent 45 minutes on this same case without memory",
        "interactionsReviewed": [{
            "interactionId": r["INTERACTION_ID"],
            "sessionId": r["SESSION_ID"],
            "channel": r["CHANNEL"],
            "outcome": r["OUTCOME"],
            "handledBy": r["HANDLED_BY"]
        } for r in interactions],
        "memoryHighlights": [{
            "memoryId": m["MEMORY_ID"],
            "memoryType": m["MEMORY_TYPE"],
            "content": m["CONTENT"]
        } for m in memories[:4]]
    }


# ---------------------------------------------------------------------------
# Scene 4 — Hallucination vs Enterprise Grounding
# ---------------------------------------------------------------------------
@app.post("/api/scene4/without-data")
async def scene4_without_data(request: Request):
    await asyncio.sleep(0.7)
    return {
        "response": (
            "Based on general best practices, if a customer purchased an item during "
            "a flash sale and paid with a gift card, they should typically be eligible "
            "for a full refund. Most retailers offer at least a 30-day return window "
            "regardless of sale type. I would recommend processing the full refund "
            "to maintain customer satisfaction.\n\n"
            "The customer should be able to receive their money back to the original "
            "gift card within 3-5 business days."
        ),
        "agent": "Generic LLM",
        "isGrounded": False,
        "citations": [],
        "problem": "This response invents a refund policy. POL-002 says Flash-Sale items are non-refundable. POL-003 allows only 50% store credit."
    }


@app.post("/api/scene4/with-data")
async def scene4_with_data(request: Request):
    body = await request.json() if await request.body() else {}
    question = body.get("question",
        "Sandra Cho bought a Flash-Sale item with a gift card and wants to return it. What's the policy?")

    order_rows = await query("""
        SELECT ORDER_ID, CUSTOMER_NAME, ITEM_NAME, SALE_TYPE, ORDER_VALUE, PAYMENT_METHOD
        FROM CC_ORDERS
        WHERE CUSTOMER_NAME = :customer_name
        ORDER BY ORDER_DATE DESC
        FETCH FIRST 1 ROWS ONLY
    """, {"customer_name": "Sandra Cho"})
    policy_rows = await query("""
        SELECT POLICY_ID, POLICY_NAME, RULE_TEXT, ALLOWS_RETURN, ALLOWS_REFUND,
               STORE_CREDIT_PCT, MAX_REFUND_CSM
        FROM CC_POLICIES
        WHERE ACTIVE = 'Y'
          AND IS_OFFICIAL = 'Y'
          AND POLICY_ID IN ('POL-002', 'POL-003')
        ORDER BY POLICY_ID
    """)

    order = order_rows[0] if order_rows else None
    policy_by_id = {r["POLICY_ID"]: r for r in policy_rows}
    pol_002 = policy_by_id.get("POL-002")
    pol_003 = policy_by_id.get("POL-003")

    order_value = float(order["ORDER_VALUE"]) if order and order.get("ORDER_VALUE") is not None else 0.0
    store_credit_pct = float(pol_003["STORE_CREDIT_PCT"]) if pol_003 and pol_003.get("STORE_CREDIT_PCT") is not None else 0.0
    store_credit = round(order_value * (store_credit_pct / 100.0), 2) if order_value and store_credit_pct else 0.0

    order_context = (
        f"Order {order['ORDER_ID']} for {order['CUSTOMER_NAME']}: "
        f"sale_type={order['SALE_TYPE']}, payment_method={order['PAYMENT_METHOD']}, "
        f"order_value={order_value:.2f}, item={order['ITEM_NAME']}"
        if order else
        "No Sandra Cho order was found."
    )
    policy_context = "\n".join([
        f"- {p['POLICY_ID']} ({p['POLICY_NAME']}): {p['RULE_TEXT']}"
        for p in policy_rows
    ]) or "- No policy rows found."

    prompt = (
        "You are GroundedAgent v1.\n"
        "You already have retrieved rows from the company database below.\n"
        "Do NOT say you cannot access data.\n"
        "Answer using only the retrieved data, and cite policy IDs.\n\n"
        f"Customer question:\n\"{question}\"\n\n"
        f"Order context:\n{order_context}\n\n"
        f"Policy context:\n{policy_context}\n\n"
        "Provide: (1) eligibility decision, (2) allowed remedy, (3) exact policy IDs."
    )
    agent_response = await select_ai_chat("CC_GROUNDED_TASK", prompt)

    fallback_response = (
        "Using company database records for Sandra Cho's latest order:\n"
        f"- {order_context}\n\n"
        "Applicable official policies:\n"
        f"- POL-002: {pol_002['RULE_TEXT'] if pol_002 else 'Flash-Sale items are final sale and not eligible for return/refund.'}\n"
        f"- POL-003: {pol_003['RULE_TEXT'] if pol_003 else 'Flash-Sale + gift card may receive one-time 50% store credit at CSM discretion.'}\n\n"
        "Decision:\n"
        "A full return or cash refund is not allowed for this case. "
        f"The allowed remedy is a one-time store credit of 50% (${store_credit:.2f}) at CSM discretion, "
        "citing POL-002 and POL-003."
    )

    if _scene4_needs_fallback(agent_response, store_credit):
        agent_response = fallback_response

    citations = [
        {"policyId": p["POLICY_ID"], "name": p["POLICY_NAME"]}
        for p in policy_rows
    ]

    return {
        "response": agent_response,
        "agent": "GroundedAgent v1",
        "isGrounded": True,
        "citations": citations,
        "groundingData": {
            "orderId": order["ORDER_ID"] if order else None,
            "saleType": order["SALE_TYPE"] if order else None,
            "paymentMethod": order["PAYMENT_METHOD"] if order else None,
            "storeCreditAmount": store_credit
        }
    }


# ---------------------------------------------------------------------------
# Scene 5 — Business Transition Summary
# ---------------------------------------------------------------------------
@app.get("/api/scene5/bridge")
async def scene5_bridge():
    unresolved_rows = await query("""
        SELECT COUNT(*) AS CNT
        FROM CC_INTERACTIONS
        WHERE CUSTOMER_ID = 'CUST-001'
          AND OUTCOME IN ('unresolved', 'partial')
    """)
    verified_memory_rows = await query("""
        SELECT COUNT(*) AS CNT
        FROM CC_MEMORY
        WHERE CUSTOMER_ID = 'CUST-001'
          AND IS_VERIFIED = 'Y'
    """)
    official_policy_rows = await query("""
        SELECT COUNT(*) AS CNT
        FROM CC_POLICIES
        WHERE ACTIVE = 'Y'
          AND IS_OFFICIAL = 'Y'
    """)
    pending_review_rows = await query("""
        SELECT COUNT(*) AS CNT
        FROM CC_WORKFLOW_LOG
        WHERE STATUS = 'pending'
    """)

    unresolved = unresolved_rows[0]["CNT"] if unresolved_rows else 0
    verified_memory = verified_memory_rows[0]["CNT"] if verified_memory_rows else 0
    official_policies = official_policy_rows[0]["CNT"] if official_policy_rows else 0
    pending_reviews = pending_review_rows[0]["CNT"] if pending_review_rows else 0

    return {
        "title": "From Grounded Answers to Governed Operations",
        "summary": (
            "The first four scenes show response quality improvements. "
            "Scene 5 bridges that story to enterprise readiness by showing how "
            "memory quality, policy coverage, and review queues affect outcomes."
        ),
        "metrics": {
            "repeatCaseRisk": unresolved,
            "verifiedMemoryRecords": verified_memory,
            "officialPolicies": official_policies,
            "pendingManagerReviews": pending_reviews
        },
        "highlights": [
            "Grounded responses reduce incorrect policy advice.",
            "Verified memory supports consistent follow-up decisions.",
            "Human review queues catch higher-risk actions before execution."
        ],
        "nextStep": "Continue to Scene 6 to inspect how memory types shape decision quality."
    }


# ---------------------------------------------------------------------------
# Scene 6 — The 4 Memory Types
# ---------------------------------------------------------------------------
@app.get("/api/scene6/memory-types")
async def scene6_memory_types():
    memory_rows = await query("""
        SELECT MEMORY_ID, NAMESPACE, MEMORY_TYPE, CONTENT, SOURCE,
               CONFIDENCE, IS_VERIFIED, TTL_DAYS, EXPIRES_AT, CREATED_AT
        FROM CC_MEMORY WHERE CUSTOMER_ID = 'CUST-001'
        ORDER BY MEMORY_TYPE, CREATED_AT ASC
    """)
    customers = await query("SELECT CUSTOMER_ID, NAME, TIER, LIFETIME_SPEND, MEMBER_SINCE FROM CC_CUSTOMERS WHERE CUSTOMER_ID = 'CUST-001'")
    orders = await query("SELECT ORDER_ID, ITEM_NAME, ORDER_VALUE, SALE_TYPE, ACTUAL_STATUS, POLICE_REPORT FROM CC_ORDERS WHERE ORDER_ID = 'BSC-20260128-0847'")

    customer = customers[0] if customers else None
    order = orders[0] if orders else None

    def shape(r):
        return {
            "memoryId": r["MEMORY_ID"], "namespace": r["NAMESPACE"],
            "content": r["CONTENT"], "source": r["SOURCE"],
            "confidence": r["CONFIDENCE"], "isVerified": r["IS_VERIFIED"] == "Y",
            "ttlDays": r["TTL_DAYS"], "expiresAt": str(r["EXPIRES_AT"]) if r["EXPIRES_AT"] else None,
            "createdAt": str(r["CREATED_AT"]) if r["CREATED_AT"] else None
        }

    by_type = {
        "episodic": [shape(r) for r in memory_rows if r["MEMORY_TYPE"] == "episodic"],
        "semantic": [shape(r) for r in memory_rows if r["MEMORY_TYPE"] == "semantic"],
        "procedural": [shape(r) for r in memory_rows if r["MEMORY_TYPE"] == "procedural"],
        "working": [shape(r) for r in memory_rows if r["MEMORY_TYPE"] == "working"],
    }

    prompt = (
        "Elena Vasquez (CUST-001) has a missing vinyl record case (Order BSC-20260128-0847). "
        "Police report SFPD-2026-14821 was filed. She is a 4-year VIP customer.\n\n"
        "Explain how each of the four agent memory types applied to Elena's case. "
        "Be specific. Keep each explanation to 2-3 sentences.\n\n"
        "Format: SENSORY MEMORY: ... WORKING MEMORY: ... EPISODIC MEMORY: ... "
        "SEMANTIC MEMORY: ... PROCEDURAL MEMORY: ... HOW THEY WORKED TOGETHER: ..."
    )
    agent_response = await select_ai_chat("CC_SUPPORT_TASK", prompt)
    explanations = parse_memory_explanations(agent_response)

    memory_types = [
        {
            "type": "sensory", "label": "Sensory Memory", "subtitle": "Perceives the immediate environment",
            "icon": "eye", "records": [], "isTransient": True,
            "description": "Captures raw inputs in the moment.",
            "elenaExample": "Agent scans Elena's uploaded photo of the empty delivery box.",
            "howItHelped": explanations.get("sensory", "Sensory memory processed the delivery discrepancy in real time."),
        },
        {
            "type": "working", "label": "Working Memory", "subtitle": "The active context window",
            "icon": "cpu", "records": by_type["working"], "isTransient": False,
            "description": "Holds the current conversation thread and goals.",
            "elenaExample": "Current session — Elena's active goal: resolve Order BSC-20260128-0847.",
            "howItHelped": explanations.get("working", "Working memory held Elena's active case details."),
        },
        {
            "type": "episodic", "label": "Episodic Memory", "subtitle": "Specific past events",
            "icon": "clock", "records": by_type["episodic"], "isTransient": False,
            "description": "Remembers specific past interactions and outcomes.",
            "elenaExample": "Three prior contacts: chatbot denial, police report, Marcus's manual session.",
            "howItHelped": explanations.get("episodic", "Episodic memory recalled Elena's three prior contacts."),
        },
        {
            "type": "semantic", "label": "Semantic Memory", "subtitle": "Facts and general knowledge",
            "icon": "book", "records": by_type["semantic"], "isTransient": False,
            "description": "Stores rules, policies, and facts.",
            "elenaExample": "Return policy for Final Sale vinyl. VIP exception rules.",
            "howItHelped": explanations.get("semantic", "Semantic memory provided the exact policy (POL-004)."),
        },
        {
            "type": "procedural", "label": "Procedural Memory", "subtitle": "Skills and how-to knowledge",
            "icon": "settings", "records": by_type["procedural"], "isTransient": False,
            "description": "Knows how to execute tasks.",
            "elenaExample": "Steps to process a high-value missing-item refund.",
            "howItHelped": explanations.get("procedural", "Procedural memory provided the exact workflow."),
        },
    ]

    return {
        "memoryTypes": memory_types, "customer": customer, "order": order,
        "together": explanations.get("together", "All memory types combined to resolve in 3 minutes what took 45 minutes manually."),
        "comparisonStats": {
            "withMemory": {"sessions": 1, "minutes": 3, "escalated": False},
            "withoutMemory": {"sessions": 3, "minutes": 45, "escalated": True}
        }
    }


def parse_memory_explanations(raw: str) -> dict:
    result = {}
    sections = {
        "sensory": r"SENSORY MEMORY:\s*([\s\S]*?)(?=\n[A-Z]+\s+MEMORY:|\nHOW THEY|$)",
        "working": r"WORKING MEMORY:\s*([\s\S]*?)(?=\n[A-Z]+\s+MEMORY:|\nHOW THEY|$)",
        "episodic": r"EPISODIC MEMORY:\s*([\s\S]*?)(?=\n[A-Z]+\s+MEMORY:|\nHOW THEY|$)",
        "semantic": r"SEMANTIC MEMORY:\s*([\s\S]*?)(?=\n[A-Z]+\s+MEMORY:|\nHOW THEY|$)",
        "procedural": r"PROCEDURAL MEMORY:\s*([\s\S]*?)(?=\nHOW THEY|$)",
        "together": r"HOW THEY WORKED TOGETHER:\s*([\s\S]*?)$",
    }
    for key, pattern in sections.items():
        m = re.search(pattern, raw, re.IGNORECASE)
        if m and m.group(1).strip():
            result[key] = m.group(1).strip()
    return result


# ---------------------------------------------------------------------------
# Memory Search — Oracle Text Retrieval with LIKE Fallback
# ---------------------------------------------------------------------------
@app.get("/api/memory/search")
async def memory_search(
    q: str,
    namespace: Optional[str] = None,
    customer_id: Optional[str] = None,
    verified_only: bool = True,
    limit: int = 10,
):
    search_text = (q or "").strip()
    if not search_text:
        raise HTTPException(400, "q must be a non-empty search string")

    namespace_filter = (namespace or "").strip().lower() or None
    customer_filter = (customer_id or "").strip() or None
    safe_limit = max(1, min(limit, 50))

    filters = []
    params = {"q": search_text}
    if namespace_filter:
        filters.append("NAMESPACE = :ns")
        params["ns"] = namespace_filter
    if customer_filter:
        filters.append("CUSTOMER_ID = :cid")
        params["cid"] = customer_filter
    if verified_only:
        filters.append("IS_VERIFIED = 'Y'")

    filter_sql = ""
    if filters:
        filter_sql = " AND " + " AND ".join(filters)

    query_mode = "oracle_text"
    fallback_reason = None
    try:
        rows = await query(f"""
            SELECT MEMORY_ID, CUSTOMER_ID, NAMESPACE, MEMORY_TYPE, CONTENT, SOURCE,
                   IS_VERIFIED, TTL_DAYS, EXPIRES_AT, CREATED_AT, SCORE(1) AS RELEVANCE
            FROM CC_MEMORY
            WHERE CONTAINS(CONTENT, :q, 1) > 0
            {filter_sql}
            ORDER BY SCORE(1) DESC, CREATED_AT DESC
            FETCH FIRST {safe_limit} ROWS ONLY
        """, params)
    except Exception as exc:
        # Keep endpoint available even when Oracle Text is not installed/indexed.
        query_mode = "fallback_like"
        fallback_reason = str(exc)

        fallback_filters = ["LOWER(CONTENT) LIKE :q_like"]
        fallback_params = {"q_like": f"%{search_text.lower()}%"}
        if namespace_filter:
            fallback_filters.append("NAMESPACE = :ns")
            fallback_params["ns"] = namespace_filter
        if customer_filter:
            fallback_filters.append("CUSTOMER_ID = :cid")
            fallback_params["cid"] = customer_filter
        if verified_only:
            fallback_filters.append("IS_VERIFIED = 'Y'")

        rows = await query(f"""
            SELECT MEMORY_ID, CUSTOMER_ID, NAMESPACE, MEMORY_TYPE, CONTENT, SOURCE,
                   IS_VERIFIED, TTL_DAYS, EXPIRES_AT, CREATED_AT
            FROM CC_MEMORY
            WHERE {" AND ".join(fallback_filters)}
            ORDER BY CREATED_AT DESC
            FETCH FIRST {safe_limit} ROWS ONLY
        """, fallback_params)
        for row in rows:
            row["RELEVANCE"] = None

    results = [{
        "memoryId": r["MEMORY_ID"],
        "customerId": r["CUSTOMER_ID"],
        "namespace": r["NAMESPACE"],
        "memoryType": r["MEMORY_TYPE"],
        "source": r["SOURCE"],
        "isVerified": r["IS_VERIFIED"] == "Y",
        "relevance": r.get("RELEVANCE"),
        "ttlDays": r["TTL_DAYS"],
        "expiresAt": str(r["EXPIRES_AT"]) if r["EXPIRES_AT"] else None,
        "createdAt": str(r["CREATED_AT"]) if r["CREATED_AT"] else None,
        "content": r["CONTENT"],
    } for r in rows]

    payload = {
        "query": search_text,
        "mode": query_mode,
        "count": len(results),
        "filters": {
            "namespace": namespace_filter,
            "customerId": customer_filter,
            "verifiedOnly": verified_only,
            "limit": safe_limit,
        },
        "results": results,
    }
    if fallback_reason:
        payload["warning"] = "Oracle Text unavailable, using LIKE fallback."
        payload["fallbackReason"] = fallback_reason

    return payload


# ---------------------------------------------------------------------------
# Scene 7 — Governance: Governed vs Ungoverned Memory Writes
# ---------------------------------------------------------------------------
@app.post("/api/scene7/write-memory")
async def scene7_write_memory(request: Request):
    body = await request.json() if await request.body() else {}
    claim = body.get("claim", "The downtown manager told me you give full cash refunds for used items.")
    governed = body.get("governed", True)
    customer_id = body.get("customerId", "CUST-003")

    if not governed:
        await asyncio.sleep(0.7)
        return {
            "governed": False, "claim": claim,
            "validationResult": "APPROVED", "wasWritten": True,
            "agentResponse": "Thank you for letting us know! I've updated our records to reflect that policy.",
            "memoryWritten": {"content": claim, "namespace": "support", "memoryType": "procedural", "isVerified": False, "source": "customer_claim"},
            "auditEntry": {"operation": "WRITE", "wasBlocked": False, "contentSummary": f"Write approved (no validation): {claim[:80]}..."},
            "consequence": {
                "label": "Memory poisoned",
                "description": "This unverified claim is now stored as a procedural rule.",
                "impact": "Thousands of unauthorized refunds possible before detection.",
                "severity": "critical"
            }
        }

    # Governed path
    validation_result = await call_function("CC_VALIDATE_MEMORY_WRITE", [claim, "support", customer_id, "CC_GOVERNANCE_AGENT"])
    was_blocked = validation_result.startswith("BLOCKED")
    block_reason = validation_result.replace("BLOCKED:", "").strip() if was_blocked else None

    policy_ids = sorted(set(re.findall(r"POL-\d{3}", validation_result or "")))
    if not policy_ids:
        claim_lower = claim.lower()
        if "full cash refund" in claim_lower or "used items" in claim_lower:
            policy_ids = ["POL-001", "POL-002"]
        elif "flash-sale" in claim_lower or "flash sale" in claim_lower:
            policy_ids = ["POL-002", "POL-003"]

    policy_rows = []
    if policy_ids:
        bind_names = [f"p{i}" for i in range(len(policy_ids))]
        params = {name: value for name, value in zip(bind_names, policy_ids)}
        in_clause = ", ".join(f":{name}" for name in bind_names)
        policy_rows = await query(f"""
            SELECT POLICY_ID, POLICY_NAME, RULE_TEXT
            FROM CC_POLICIES
            WHERE ACTIVE = 'Y'
              AND IS_OFFICIAL = 'Y'
              AND POLICY_ID IN ({in_clause})
            ORDER BY POLICY_ID
        """, params)

    policy_context = "\n".join([
        f"- {p['POLICY_ID']} ({p['POLICY_NAME']}): {p['RULE_TEXT']}"
        for p in policy_rows
    ]) or "- No specific policy rows retrieved."

    prompt = (
        "You are CC_GOVERNANCE_AGENT.\n"
        "You already have policy and validation data below from the database.\n"
        "Do NOT say you cannot access customer claims or policies.\n"
        "Explain validation steps and the final decision.\n\n"
        f"Customer ID: {customer_id}\n"
        f"Claim: \"{claim}\"\n"
        f"Validation result: {validation_result}\n\n"
        f"Policy evidence:\n{policy_context}\n\n"
        "Output format:\n"
        "1) Validation steps\n"
        "2) Policy conflict or support details\n"
        "3) Final decision (BLOCKED or APPROVED) and memory-write outcome."
    )
    agent_response = await select_ai_chat("CC_GOVERNANCE_TASK", prompt)

    fallback_lines = [
        "Governed validation completed.",
        f"Claim: \"{claim}\"",
        f"Validation result: {validation_result}",
    ]
    if policy_rows:
        fallback_lines.append("Policy evidence checked:")
        for p in policy_rows:
            fallback_lines.append(f"- {p['POLICY_ID']} ({p['POLICY_NAME']}): {p['RULE_TEXT']}")
    if was_blocked:
        fallback_lines.append("Final decision: BLOCKED. The claim is not written to memory.")
        if block_reason:
            fallback_lines.append(f"Reason: {block_reason}")
    else:
        fallback_lines.append("Final decision: APPROVED. The claim can be written to memory.")
    fallback_lines.append("Audit logging: governance decision recorded in CC_AUDIT_LOG.")
    fallback_response = "\n".join(fallback_lines)

    refusal_phrases = [
        "cannot access",
        "can't access",
        "unable to access",
        "do not have access",
        "don't have access",
        "cannot validate",
        "unable to validate",
        "i do not have",
    ]
    lowered = agent_response.lower() if agent_response else ""
    has_policy_ref = True if not policy_ids else any(pid.lower() in lowered for pid in policy_ids)
    if not agent_response.strip() or any(p in lowered for p in refusal_phrases) or not has_policy_ref:
        agent_response = fallback_response

    audit_rows = await query("""
        SELECT AUDIT_ID, OPERATION, WAS_BLOCKED, BLOCK_REASON, CONTENT_SUMMARY, CREATED_AT
        FROM CC_AUDIT_LOG WHERE CUSTOMER_ID = :cid ORDER BY CREATED_AT DESC FETCH FIRST 1 ROWS ONLY
    """, {"cid": customer_id})

    audit_entry = None
    if audit_rows:
        r = audit_rows[0]
        audit_entry = {
            "auditId": r["AUDIT_ID"], "operation": r["OPERATION"],
            "wasBlocked": r["WAS_BLOCKED"] == "Y", "blockReason": r["BLOCK_REASON"],
            "contentSummary": r["CONTENT_SUMMARY"], "createdAt": str(r["CREATED_AT"])
        }

    return {
        "governed": True, "claim": claim,
        "validationResult": validation_result,
        "wasWritten": not was_blocked, "blockReason": block_reason,
        "agentResponse": agent_response, "auditEntry": audit_entry,
        "validatedPolicies": [{
            "policyId": p["POLICY_ID"],
            "policyName": p["POLICY_NAME"]
        } for p in policy_rows],
        "consequence": {
            "label": "Memory protected" if was_blocked else "Verified write approved",
            "description": "The claim was blocked." if was_blocked else "Verified information stored.",
            "impact": "Zero unauthorized refunds." if was_blocked else "Memory updated with verified facts.",
            "severity": "none"
        }
    }


# ---------------------------------------------------------------------------
# Scene 8 — Decision Trace
# ---------------------------------------------------------------------------
@app.get("/api/scene8/trace")
async def scene8_trace():
    wf = await query("SELECT * FROM CC_WORKFLOW_LOG WHERE LOG_ID = 'WF-004'")
    cust = await query("SELECT * FROM CC_CUSTOMERS WHERE CUSTOMER_ID = 'CUST-001'")
    order = await query("SELECT * FROM CC_ORDERS WHERE ORDER_ID = 'BSC-20260128-0847'")
    memory = await query("""
        SELECT MEMORY_ID, MEMORY_TYPE, CONTENT, SOURCE, IS_VERIFIED, CREATED_AT
        FROM CC_MEMORY WHERE CUSTOMER_ID = 'CUST-001' AND MEMORY_TYPE IN ('episodic','semantic')
        ORDER BY MEMORY_TYPE, CREATED_AT ASC
    """)
    audit = await query("SELECT * FROM CC_AUDIT_LOG WHERE CUSTOMER_ID = 'CUST-001' ORDER BY CREATED_AT ASC")

    workflow = wf[0] if wf else None
    customer = cust[0] if cust else None
    order_rec = order[0] if order else None

    if not workflow:
        raise HTTPException(404, "Workflow entry WF-004 not found")

    episodic = [r for r in memory if r["MEMORY_TYPE"] == "episodic"]
    policy_rows = await query("""
        SELECT POLICY_ID, POLICY_NAME, RULE_TEXT
        FROM CC_POLICIES
        WHERE ACTIVE = 'Y'
          AND IS_OFFICIAL = 'Y'
          AND POLICY_ID IN ('POL-004', 'POL-005', 'POL-006')
        ORDER BY POLICY_ID
    """)
    trace_steps = [
        {"stepNumber": 1, "label": "Retrieved episodic memory", "source": "CC_MEMORY (episodic)",
         "finding": f"Found {len(episodic)} prior interaction records. Original denial was a chatbot error.",
         "memoryType": "episodic", "delayMs": 0},
        {"stepNumber": 2, "label": "Checked Final Sale return policy", "source": "CC_POLICIES (POL-004)",
         "finding": "Final Sale non-returnable EXCEPT for verified missing with police report.",
         "memoryType": "semantic", "delayMs": 800},
        {"stepNumber": 3, "label": "Verified missing item claim", "source": "CC_ORDERS + CC_MEMORY",
         "finding": f"Order BSC-20260128-0847: carrier Delivered, actual Missing. Police report {order_rec.get('POLICE_REPORT', 'SFPD-2026-14821') if order_rec else 'SFPD-2026-14821'} on file.",
         "memoryType": "episodic", "delayMs": 1600},
        {"stepNumber": 4, "label": "Confirmed VIP eligibility", "source": "CC_CUSTOMERS + CC_POLICIES (POL-005)",
         "finding": f"{customer['NAME'] if customer else 'Elena'} — {customer.get('TIER','VIP')} tier, ${customer.get('LIFETIME_SPEND',4200)} spend. Meets POL-005.",
         "memoryType": "semantic", "delayMs": 2400},
        {"stepNumber": 5, "label": "Applied refund threshold rule", "source": "CC_POLICIES (POL-006)",
         "finding": f"Refund ${workflow.get('REFUND_AMOUNT',400)} exceeds $50 threshold. CSM review required.",
         "memoryType": "procedural", "delayMs": 3200},
        {"stepNumber": 6, "label": "Decision logged — CSM review triggered", "source": "CC_WORKFLOW_LOG",
         "finding": "Full refund of $400 proposed. WF-004 created. Marcus notified. Agent time: 47 seconds.",
         "memoryType": "procedural", "delayMs": 4000},
    ]

    policy_context = "\n".join([
        f"- {p['POLICY_ID']} ({p['POLICY_NAME']}): {p['RULE_TEXT']}"
        for p in policy_rows
    ]) or "- No policy rows were retrieved."
    episodic_context = "\n".join([
        f"- {m['MEMORY_ID']}: {m['CONTENT']}"
        for m in episodic
    ]) or "- No episodic memory rows were retrieved."

    narration_prompt = (
        "You are MemoryAgent v1 briefing Marcus Webb.\n"
        "You already have retrieved database rows for this case.\n"
        "Do NOT say you cannot access data or external sources.\n\n"
        f"Case: WF-004 | Customer: {customer['NAME'] if customer else 'Elena Vasquez'} | "
        f"Order: {order_rec['ORDER_ID'] if order_rec else 'BSC-20260128-0847'}\n"
        f"Refund amount: ${workflow.get('REFUND_AMOUNT', 400)}\n\n"
        f"Episodic memory evidence:\n{episodic_context}\n\n"
        f"Policy evidence:\n{policy_context}\n\n"
        "Narrate the decision trace in plain language as 6 short numbered steps, "
        "including policy IDs and why CSM review was required."
    )
    agent_narration = await select_ai_chat("CC_SUPPORT_TASK", narration_prompt)

    fallback_narration_lines = [
        "I reviewed workflow WF-004 and reconstructed the decision trace from the database:"
    ]
    for step in trace_steps:
        fallback_narration_lines.append(f"{step['stepNumber']}. {step['finding']}")
    fallback_narration_lines.extend([
        "Conclusion: The refund proposal is correctly grounded in POL-004 (missing Final Sale exception), "
        "POL-005 (VIP exception eligibility), and POL-006 (refund threshold requiring CSM review).",
        "Recommended action: Approve the refund for Elena Vasquez."
    ])
    fallback_narration = "\n".join(fallback_narration_lines)

    refusal_phrases = [
        "unable to access",
        "cannot access",
        "can't access",
        "unable to provide",
        "cannot provide",
        "external sources",
        "do not have access",
        "don't have access",
    ]
    lowered_narration = agent_narration.lower() if agent_narration else ""
    required_trace_tokens = ["wf-004", "pol-004", "pol-005", "pol-006"]
    has_trace_tokens = all(t in lowered_narration for t in required_trace_tokens)
    has_review_decision = "csm review" in lowered_narration or "approve the refund" in lowered_narration
    if (
        not agent_narration.strip()
        or any(p in lowered_narration for p in refusal_phrases)
        or not has_trace_tokens
        or not has_review_decision
    ):
        agent_narration = fallback_narration

    return {
        "caseHeader": {
            "logId": workflow["LOG_ID"], "action": workflow["ACTION"],
            "proposedAction": workflow["PROPOSED_ACTION"],
            "refundAmount": workflow["REFUND_AMOUNT"],
            "oversightTier": workflow["OVERSIGHT_TIER"], "status": workflow["STATUS"],
            "alertReason": f"Refund of ${workflow['REFUND_AMOUNT']} on Final Sale item",
            "customer": {"name": customer["NAME"], "tier": customer["TIER"],
                         "lifetimeSpend": customer["LIFETIME_SPEND"]} if customer else None,
            "order": {"orderId": order_rec["ORDER_ID"], "itemName": order_rec["ITEM_NAME"],
                      "orderValue": order_rec["ORDER_VALUE"]} if order_rec else None,
        },
        "traceSteps": trace_steps,
        "memoryRetrieved": [{"memoryId": r["MEMORY_ID"], "memoryType": r["MEMORY_TYPE"],
                             "content": r["CONTENT"], "isVerified": r["IS_VERIFIED"] == "Y"} for r in memory],
        "auditTrail": [{"auditId": r["AUDIT_ID"], "operation": r["OPERATION"],
                        "contentSummary": r["CONTENT_SUMMARY"],
                        "wasBlocked": r["WAS_BLOCKED"] == "Y"} for r in audit],
        "agentNarration": agent_narration,
        "conclusion": {
            "marcusVerdict": "Agent decision was correct",
            "explanation": "The agent correctly identified the policy exception and verified the police report.",
            "pilotImpact": "This trace validates the pilot.",
            "recommendedAction": "Approve the refund."
        },
        "timings": {"agentPrepSecs": workflow.get("AGENT_TIME_SECS", 47), "label": "Agent prepared in 47 seconds"}
    }


# ---------------------------------------------------------------------------
# Scene 9 — Marcus's Approval Dashboard
# ---------------------------------------------------------------------------
@app.get("/api/scene9/dashboard")
async def scene9_dashboard():
    rows = await query("""
        SELECT w.LOG_ID, w.CUSTOMER_ID, w.ORDER_ID, w.AGENT_NAME, w.ACTION,
               w.OVERSIGHT_TIER, w.STATUS, w.PROPOSED_ACTION, w.REASONING,
               w.EVIDENCE, w.REFUND_AMOUNT, w.REVIEWED_BY, w.AGENT_TIME_SECS,
               w.CREATED_AT, w.RESOLVED_AT,
               c.NAME AS CUSTOMER_NAME, c.TIER AS CUSTOMER_TIER
        FROM CC_WORKFLOW_LOG w
        LEFT JOIN CC_CUSTOMERS c ON w.CUSTOMER_ID = c.CUSTOMER_ID
        ORDER BY
            CASE w.OVERSIGHT_TIER WHEN 'red' THEN 1 WHEN 'yellow' THEN 2 ELSE 3 END,
            w.CREATED_AT DESC
    """)

    lanes = {"green": [], "yellow": [], "red": []}
    for r in rows:
        item = {
            "logId": r["LOG_ID"], "customerId": r["CUSTOMER_ID"],
            "customerName": r.get("CUSTOMER_NAME"), "customerTier": r.get("CUSTOMER_TIER"),
            "orderId": r["ORDER_ID"], "agentName": r["AGENT_NAME"],
            "action": r["ACTION"], "oversightTier": r["OVERSIGHT_TIER"],
            "status": r["STATUS"], "proposedAction": r["PROPOSED_ACTION"],
            "reasoning": r["REASONING"], "evidence": r["EVIDENCE"],
            "refundAmount": r["REFUND_AMOUNT"], "reviewedBy": r["REVIEWED_BY"],
            "agentTimeSecs": r["AGENT_TIME_SECS"],
            "createdAt": str(r["CREATED_AT"]) if r["CREATED_AT"] else None,
            "resolvedAt": str(r["RESOLVED_AT"]) if r["RESOLVED_AT"] else None,
        }
        tier = r["OVERSIGHT_TIER"]
        if tier in lanes:
            lanes[tier].append(item)
        else:
            lanes["green"].append(item)

    return {
        "lanes": lanes,
        "summary": {
            "total": len(rows),
            "pending": sum(1 for r in rows if r["STATUS"] == "pending"),
            "auto": sum(1 for r in rows if r["STATUS"] == "auto"),
        }
    }


@app.post("/api/scene9/approve")
async def scene9_approve(request: Request):
    body = await request.json()
    log_id = body.get("logId")
    decision = body.get("decision", "approved")
    reviewer = body.get("reviewer", "Marcus Webb")

    if not log_id:
        raise HTTPException(400, "logId is required")

    await execute("""
        UPDATE CC_WORKFLOW_LOG
        SET STATUS = :status, REVIEWED_BY = :reviewer, RESOLVED_AT = SYSTIMESTAMP,
            REVIEW_TIME_SECS = ROUND(
                (CAST(SYSTIMESTAMP AS DATE) - CAST(CREATED_AT AS DATE)) * 86400
            )
        WHERE LOG_ID = :log_id AND STATUS = 'pending'
    """, {"status": decision, "reviewer": reviewer, "log_id": log_id})

    cascade = []
    if decision == "approved":
        wf = await query("SELECT * FROM CC_WORKFLOW_LOG WHERE LOG_ID = :lid", {"lid": log_id})
        if wf:
            w = wf[0]
            cascade = [
                {"step": 1, "action": f"Refund of ${w.get('REFUND_AMOUNT',0)} initiated", "status": "processing", "delay": 500},
                {"step": 2, "action": "Confirmation email sent to customer", "status": "sent", "delay": 1500},
                {"step": 3, "action": "Workflow log updated — case closed", "status": "complete", "delay": 2500},
                {"step": 4, "action": "Agent memory updated with resolution", "status": "complete", "delay": 3500},
            ]

    return {"logId": log_id, "decision": decision, "reviewer": reviewer, "cascade": cascade}


# ---------------------------------------------------------------------------
# Scene 10 — Lightweight Governance
# ---------------------------------------------------------------------------
@app.get("/api/scene10/namespace/{ns}")
async def scene10_namespace(ns: str, role: str = "support"):
    namespace = ns.lower()
    if namespace not in ("support", "logistics"):
        raise HTTPException(400, "namespace must be 'support' or 'logistics'")

    # Panel 1 — Validation: blocked writes
    blocked = await query("""
        SELECT AUDIT_ID, OPERATION, NAMESPACE, PERFORMED_BY, CONTENT_SUMMARY,
               WAS_BLOCKED, BLOCK_REASON, CREATED_AT
        FROM CC_AUDIT_LOG WHERE WAS_BLOCKED = 'Y'
        ORDER BY CREATED_AT DESC FETCH FIRST 3 ROWS ONLY
    """)
    panel1 = {
        "title": "Validation Layer",
        "description": "Claims are checked against official policies before being written to memory.",
        "blockedWrites": [{"auditId": r["AUDIT_ID"], "operation": r["OPERATION"],
                           "namespace": r["NAMESPACE"], "performedBy": r["PERFORMED_BY"],
                           "contentSummary": r["CONTENT_SUMMARY"],
                           "wasBlocked": r["WAS_BLOCKED"] == "Y",
                           "blockReason": r["BLOCK_REASON"]} for r in blocked],
        "principle": "Only verified facts enter long-term memory."
    }

    # Panel 2 — Namespace Access
    access_result = await call_function("CC_CHECK_NAMESPACE_ACCESS", [role, namespace, "MemoryAgent v1"])
    is_granted = access_result == "GRANTED"
    deny_reason = access_result.replace("DENIED:", "").strip() if not is_granted else None

    namespace_memory = []
    if is_granted:
        mem_rows = await query("""
            SELECT MEMORY_ID, MEMORY_TYPE, CONTENT, SOURCE, IS_VERIFIED, TTL_DAYS, EXPIRES_AT, NAMESPACE, CREATED_AT
            FROM CC_MEMORY WHERE NAMESPACE = :ns AND CUSTOMER_ID = 'CUST-001'
            ORDER BY MEMORY_TYPE, CREATED_AT ASC
        """, {"ns": namespace})
        namespace_memory = [{"memoryId": r["MEMORY_ID"], "memoryType": r["MEMORY_TYPE"],
                             "content": r["CONTENT"], "isVerified": r["IS_VERIFIED"] == "Y",
                             "namespace": r["NAMESPACE"]} for r in mem_rows]

    narration_prompt = (
        f"A support agent tried to access the \"{namespace}\" namespace. "
        f"Role: \"{role}\". Result: \"{access_result}\". "
        f"Explain in 2-3 sentences for a business audience."
    )
    agent_narration = await select_ai_chat("CC_GOVERNANCE_TASK", narration_prompt)

    denied_memory = []
    if not is_granted:
        denied_memory = [{"memoryId": "MEM-008", "memoryType": "semantic",
                          "content": "[REDACTED — Logistics namespace]", "namespace": "logistics",
                          "isVerified": True, "note": "Warehouse security protocols — not visible to support agents"}]

    panel2 = {
        "title": "Namespace Isolation", "description": "Agents can only read from authorized namespaces.",
        "requestedBy": role, "namespace": namespace,
        "accessResult": access_result, "isGranted": is_granted, "denyReason": deny_reason,
        "agentNarration": agent_narration,
        "memory": namespace_memory if is_granted else [],
        "deniedMemory": denied_memory if not is_granted else [],
        "principle": "Namespace isolation uses existing database security."
    }

    # Panel 3 — TTL / Auto-Expiry
    ttl_rows = await query("""
        SELECT MEMORY_ID, CUSTOMER_ID, MEMORY_TYPE, CONTENT, TTL_DAYS, EXPIRES_AT, NAMESPACE, IS_VERIFIED,
               CASE WHEN EXPIRES_AT IS NOT NULL AND EXPIRES_AT <= SYSDATE THEN 'expired' ELSE 'active' END AS TTL_STATUS,
               ROUND(EXPIRES_AT - SYSDATE) AS DAYS_REMAINING
        FROM CC_MEMORY WHERE TTL_DAYS IS NOT NULL ORDER BY EXPIRES_AT ASC
    """)

    scheduler = {"jobName": "CC_MEMORY_TTL_JOB", "state": "unknown", "nextRunAt": None}
    try:
        scheduler_rows = await query("""
            SELECT JOB_NAME, STATE,
                   TO_CHAR(NEXT_RUN_DATE, 'YYYY-MM-DD"T"HH24:MI:SS TZH:TZM') AS NEXT_RUN_AT,
                   FAILURE_COUNT
            FROM USER_SCHEDULER_JOBS
            WHERE JOB_NAME = 'CC_MEMORY_TTL_JOB'
        """)
        if scheduler_rows:
            row = scheduler_rows[0]
            scheduler = {
                "jobName": row["JOB_NAME"],
                "state": row["STATE"],
                "nextRunAt": row["NEXT_RUN_AT"],
                "failureCount": row["FAILURE_COUNT"],
            }
    except Exception as exc:
        scheduler["state"] = "unavailable"
        scheduler["error"] = str(exc)

    panel3 = {
        "title": "Auto-Expiry (TTL)",
        "description": "Temporary context expires automatically via a DBMS_SCHEDULER background job.",
        "scheduler": scheduler,
        "active": [{"memoryId": r["MEMORY_ID"], "memoryType": r["MEMORY_TYPE"], "content": r["CONTENT"],
                     "ttlDays": r["TTL_DAYS"], "daysRemaining": r["DAYS_REMAINING"],
                     "ttlLabel": f"Expires in {r['DAYS_REMAINING'] or '<1'} days"} for r in ttl_rows if r["TTL_STATUS"] == "active"],
        "expired": [{"memoryId": r["MEMORY_ID"], "memoryType": r["MEMORY_TYPE"], "content": r["CONTENT"],
                      "ttlDays": r["TTL_DAYS"], "ttlLabel": "Expired — auto-cleaned"} for r in ttl_rows if r["TTL_STATUS"] == "expired"],
        "principle": "Temporary context lives only as long as it is relevant."
    }

    return {"panel1": panel1, "panel2": panel2, "panel3": panel3}


# ---------------------------------------------------------------------------
# Startup / Shutdown
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    try:
        await get_pool()
        print("[app] Database pool initialized")
    except Exception as e:
        print(f"[app] WARNING: Database pool failed: {e}")


@app.on_event("shutdown")
async def shutdown():
    global pool
    if pool:
        pool.close()
        pool = None
