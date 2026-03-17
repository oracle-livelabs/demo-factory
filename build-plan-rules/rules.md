# Big Star AI Agent Industry Demo — Strict Replication Rules

This is a **strict architecture contract** for reproducing this project pattern in other repositories and industries.

If any required rule below is broken, the replication is considered **non-compliant**.

---

## 0) Industry-Neutral Scope

This contract is industry-neutral by design.

- Business stories, personas, labels, and narrative text may change per industry.
- Core architecture, runtime behavior, and Oracle AI Database 26ai proof points must remain consistent.
- Priority Transactions and Oracle SQL Firewall are enforced here as **UI/X-Ray narrative checks**, not hard backend implementation checks.

---

## 1) Required Project Structure

You must keep this minimum structure:

```text
project-root/
├── main.py
├── init.sql
├── seeder.py
├── templates/
│   └── index.html
├── requirements.txt
├── compose.yaml
├── Containerfile
├── Containerfile.parent
└── rules.md
```

No alternative names for these core files.

---

## 2) Mandatory Service Topology

`compose.yaml` must define at least these required core logical services:

- `db` (Oracle)
- `ords` (Oracle REST Data Services)
- `ollama` (LLM runtime)
- `init-brain` (one-shot model pull job)
- `app` (FastAPI service)

Additional optional services are allowed (for example: VS Code dev container, Jupyter notebook, observability, reverse proxy) as long as core service names, ports, env contracts, and startup dependencies remain intact.

A shared network (equivalent to `hub-net`) is required.

Named persistent volumes are required for:

- Oracle data
- ORDS config
- Ollama model cache

`compose.yaml` must be engine-neutral and run unmodified with both:

- `docker compose`
- `podman compose`

---

## 3) Mandatory Ports and Endpoints (Strict)

These are the canonical ports used by this architecture.

### 3.1 Container-internal ports

- Oracle DB internal: `1521`
- ORDS internal: `8080`
- Ollama internal: `11434`
- FastAPI internal: `8000`

### 3.2 Host-exposed ports

- Oracle host mapping: `1521:1521`
- ORDS host mapping: `8181:8080`
- Ollama host mapping: `11434:11434`
- App host mapping: `5500:8000`

### 3.3 Required in-app defaults (`main.py`)

Defaults must exist exactly as follows (with env override support):

- `DB_DSN` default: `localhost:1521/FREEPDB1`
- `OLLAMA_HOST` default: `http://localhost:11434`
- `ORDS_HOST` default: `http://localhost:8181`

### 3.4 Required in-compose app environment

App service must resolve in-network service endpoints like this:

- DB_DSN: db:1521/FREEPDB1
- OLLAMA_HOST: http://ollama:11434
- ORDS_HOST: http://ords:8080

---

## 4) Healthcheck Contract (Strict)

You must implement these health checks:

- `db`: SQL ping against `localhost:1521/FREEPDB1`.
- `ords`: HTTP check on `http://localhost:8080/ords/`.
- `ollama`: runtime check equivalent to `ollama list`.
- `app`: HTTP check on `http://localhost:8000/api/health`.

`app` must depend on:

- healthy `db`
- healthy `ords`
- successful `init-brain`

---

## 5) App Runtime Contract (`Containerfile` + `main.py` + `compose.yaml`)

Required container runtime behavior:

- `EXPOSE 8000`
- start command must execute `seeder.py` before running Uvicorn on `0.0.0.0:8000` (e.g., `sh -c "python seeder.py && uvicorn main:app --host 0.0.0.0 --port 8000"`)
- entrypoint target must be `main:app`
- `Containerfile` must support both `linux/amd64` and `linux/arm64` builds for Docker/Podman portability

Required `main.py` behavior:

- create FastAPI app object at module scope
- serve HTML template at `/`
- expose `/api/health`
- implement Oracle pool helper + query/execute wrappers
- implement Ollama chat wrapper with `/api/chat` then `/api/generate` fallback

---

## 6) Frontend Contract (`templates/index.html`)

Frontend must remain a single-file scene dashboard with:

- hash-based scene navigation
- support for the 3 core routes (`#merchandiser`, `#manager`, `#shopper`) plus optional additional routes/scenes for deeper demos
- per-scene run/reset controls
- JS calls to `/api/*` routes
- presenter panel with keyboard navigation cues
- persistent `?` Presenter Script trigger that changes help text by active hash scene and uses the label/title "What's happening here?"
- persistent Database X-Ray toggle that reveals scene-specific Oracle internals (API command + SQL/PLSQL activity + Oracle feature callouts, including Priority Transactions and SQL Firewall when those scenes are active)
- presenter and/or X-Ray narrative must explicitly mention **Priority Transactions** and **Oracle SQL Firewall** in at least one scene each
- **MUST adhere to the Oracle Redwood design system styling** (colors, typography, and visual components)
- UI and presenter text must be narrative-driven and non-technical

No SPA framework required; plain HTML/CSS/JS is the default replication model.

---

## 7) Database Contract (`init.sql` + `seeder.py`)

`init.sql` must include:

- full schema creation
- constraints/indexes
- policy or governance logic (functions/procedures where applicable)
- baseline seed/reference values

`seeder.py` must:

- generate realistic synthetic records
- support reruns for local refresh cycles
- align seeded data with demo scenes/use-cases

---

## 8) Dependency Contract (`requirements.txt`)

Required runtime packages:

- `fastapi`
- `uvicorn[standard]`
- `oracledb`
- `jinja2`
- `httpx`
- `faker`
- `scikit-learn`

Use version floors to maintain compatibility.

---

## 9) Strict Validation Checklist (Pass/Fail)

Replication is valid only if **all checks pass**:

1. `compose.yaml` includes all required core services (`db`, `ords`, `ollama`, `init-brain`, `app`); additional services are allowed.
2. Host port mappings are exactly:
   - `1521:1521`
   - `8181:8080`
   - `11434:11434`
   - `5500:8000`
3. App container exposes and serves on internal `8000`.
4. `main.py` defaults include:
   - `localhost:1521/FREEPDB1`
   - `http://localhost:11434`
   - `http://localhost:8181`
5. App compose env points to:
   - db:1521/FREEPDB1
   - http://ollama:11434
   - http://ords:8080
6. `/api/health` returns success when DB is reachable.
7. Ollama helper supports both `/api/chat` and `/api/generate` fallback.
8. `templates/index.html` exists, is served at `/`, and fully implements the Oracle Redwood Theme.
9. `init-brain` waits for Ollama and pulls `gemma:2b`.
10. `app` startup is blocked until db/ords/init-brain conditions pass.
11. App service `command` or entrypoint runs `seeder.py` prior to the main FastAPI server start.
12. `compose.yaml` is usable by both `docker compose config` and `podman compose config` (when those CLIs are present).
13. `templates/index.html` contains a scene-aware Presenter Script (`?`) and a scene-aware Database X-Ray mode toggle.
14. Presenter help label/title is "What's happening here?".
15. UI narrative (Presenter and/or X-Ray) includes explicit mentions of Priority Transactions and Oracle SQL Firewall.

---

## 10) Recommended Replication Procedure

1. Fill the industry story pack (personas, business problems, scene labels, presenter narrative).
2. Copy file skeleton as-is.
3. Copy strict port mappings as-is.
4. Implement schema and seed data before route logic.
5. Implement DB + Ollama helpers in `main.py`.
6. Add scene APIs and UI wiring.
7. Run stack and verify all checklist items.

Do not rename core services, ports, or environment variable keys unless you are intentionally creating a new architecture standard.
