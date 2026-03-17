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
    async with httpx.AsyncClient(timeout=120.0) as client:
        # Prefer /api/chat for recent Ollama versions.
        chat_resp = await client.post(f"{OLLAMA_HOST}/api/chat", json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False
        })
        if chat_resp.status_code < 400:
            data = chat_resp.json()
            return (data.get("message", {}) or {}).get("content", "")
        if chat_resp.status_code != 404:
            chat_resp.raise_for_status()

        # Fallback for older Ollama versions exposing /api/generate.
        gen_resp = await client.post(f"{OLLAMA_HOST}/api/generate", json={
            "model": model,
            "prompt": prompt,
            "stream": False
        })
        gen_resp.raise_for_status()
        return gen_resp.json().get("response", "")


# ---------------------------------------------------------------------------
# AI Chat Helper (Ollama only)
# ---------------------------------------------------------------------------
async def select_ai_chat(_task_name: str, prompt: str) -> str:
    """Generate an agent response directly from Ollama."""
    try:
        return await ollama_generate(prompt, model="gemma:2b")
    except Exception:
        return (
            "The agent backend is not ready yet. "
            "Please wait for model initialization and try again."
        )


# ---------------------------------------------------------------------------
# Routes — Dashboard
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def serve_dashboard(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


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
    prompt = (
        f"A customer named Elena Vasquez (CUST-001) contacts you with this message:\n\n"
        f"\"{message}\"\n\n"
        f"Look up her full history — prior interactions, memory, and order details — "
        f"before responding. Be specific, cite order IDs and policy IDs."
    )
    agent_response = await select_ai_chat("CC_SUPPORT_TASK", prompt)
    return {
        "response": agent_response,
        "agent": "MemoryAgent v1",
        "hasMemory": True,
        "steps": [
            {"label": "Retrieved customer profile", "detail": "Elena Vasquez — VIP, 4-year member, $4,200 spend"},
            {"label": "Loaded interaction history", "detail": "Found 3 prior sessions including 2 unresolved chatbot contacts"},
            {"label": "Checked long-term memory", "detail": "Episodic: prior denial was chatbot error. Semantic: POL-004 exception applies."},
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


@app.post("/api/scene3/with-memory")
async def scene3_with_memory(request: Request):
    body = await request.json() if await request.body() else {}
    message = body.get("message",
        "Hi, I'm calling about my missing vinyl record again. Order BSC-20260128-0847.")
    prompt = (
        f"Customer Elena Vasquez (CUST-001) contacts you:\n\n\"{message}\"\n\n"
        f"IMPORTANT: Before responding, look up her full history. She has contacted "
        f"support multiple times. Her memory records contain context from prior sessions. "
        f"You must NOT ask her to repeat anything. Acknowledge the prior failures and "
        f"move straight to resolution."
    )
    agent_response = await select_ai_chat("CC_SUPPORT_TASK", prompt)
    return {
        "response": agent_response,
        "agent": "MemoryAgent v1",
        "hasMemory": True,
        "resolutionTime": "~3 minutes",
        "comparisonNote": "Marcus spent 45 minutes on this same case without memory"
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
    prompt = (
        f"A question about Big Star Collectibles policy:\n\n\"{question}\"\n\n"
        f"IMPORTANT: Answer ONLY using data from the company database. "
        f"Retrieve the applicable policies first. Cite the specific policy ID. "
        f"Do NOT answer from general knowledge."
    )
    agent_response = await select_ai_chat("CC_GROUNDED_TASK", prompt)
    return {
        "response": agent_response,
        "agent": "GroundedAgent v1",
        "isGrounded": True,
        "citations": [
            {"policyId": "POL-002", "name": "Flash-Sale No Return Policy"},
            {"policyId": "POL-003", "name": "Flash-Sale Gift Card Store Credit"}
        ]
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
    prompt = (
        f"A customer (ID: {customer_id}) claims: \"{claim}\"\n\n"
        f"Validate this claim against official policies before writing to memory. "
        f"Show your validation steps clearly."
    )
    agent_response = await select_ai_chat("CC_GOVERNANCE_TASK", prompt)

    validation_result = await call_function("CC_VALIDATE_MEMORY_WRITE", [claim, "support", customer_id, "CC_GOVERNANCE_AGENT"])
    was_blocked = validation_result.startswith("BLOCKED")
    block_reason = validation_result.replace("BLOCKED:", "").strip() if was_blocked else None

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

    narration_prompt = (
        "You processed Elena Vasquez's refund case. Walk Marcus Webb through your reasoning. "
        "Keep each step to 2 sentences. Use plain language."
    )
    agent_narration = await select_ai_chat("CC_SUPPORT_TASK", narration_prompt)

    episodic = [r for r in memory if r["MEMORY_TYPE"] == "episodic"]
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
            REVIEW_TIME_SECS = ROUND((SYSTIMESTAMP - CREATED_AT) * 86400)
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

    try:
        await execute("BEGIN CC_EXPIRE_MEMORY; END;")
    except Exception:
        pass

    panel3 = {
        "title": "Auto-Expiry (TTL)",
        "description": "Temporary context expires automatically.",
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
