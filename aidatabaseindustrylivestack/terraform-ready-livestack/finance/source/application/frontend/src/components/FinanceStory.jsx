const FINANCE_STORY_STEPS = [
  {
    stage: '1',
    useCase: 'Data Foundation',
    summary: 'Load the Seer Bank dataset that links products, clients, transactions, fraud signals, service locations, risk scores, OML outputs, and agent audit history.',
  },
  {
    stage: '2',
    useCase: 'Risk and Operations Command Center',
    summary: 'See AML exposure, payment anomalies, case backlog, SLA pressure, product impact, and agent activity in one governed operating view.',
  },
  {
    stage: '3',
    useCase: 'Risk Signal Intelligence',
    summary: 'Search fraud, AML, market, compliance, and client-behavior signals to understand why a payment-risk pattern is accelerating.',
  },
  {
    stage: '4',
    useCase: 'Financial Crime Network',
    summary: 'Trace shared accounts, devices, payees, merchants, cases, and regions that explain the connected-risk path behind suspicious activity.',
  },
  {
    stage: '5',
    useCase: 'Client Service and SLA Coverage',
    summary: 'Find which branches, service centers, and regions can absorb investigation load while protecting high-value clients and SLA commitments.',
  },
  {
    stage: '6',
    useCase: 'Transaction and Case Operations',
    summary: 'Inspect governed transaction rows and JSON duality documents so fraud, risk, and operations teams work from the same case evidence.',
  },
  {
    stage: '7',
    useCase: 'Predictive Risk, Capacity and Revenue',
    summary: 'Score risk exposure, case capacity, revenue impact, attrition, and client cohorts with in-database OML and Oracle-native analytics.',
  },
  {
    stage: '8',
    useCase: 'Governed Data Copilot',
    summary: 'Ask natural-language questions about AML alerts, payment exposure, client risk, service load, and forecasted impact against governed views.',
  },
  {
    stage: '9',
    useCase: 'AI Operations Agent Console',
    summary: 'Turn findings into read-only, audited recommendations for fraud review, compliance escalation, client service, and SLA protection.',
  },
];

const SCENE_STORIES = {
  datamodel: {
    eyebrow: 'Scene 1 - establish the record',
    title: 'Build the governed Seer Bank risk baseline.',
    body: 'The journey starts by loading one finance data foundation for an AML and payments-risk investigation. The restore connects products, clients, transactions, suspicious signals, service geography, graph evidence, OML artifacts, and agent history before the operator moves into the command center.',
    beats: [
      'Restore the Seer Bank demo data foundation.',
      'Confirm the live footprint across products, clients, transactions, fraud signals, graph links, and model outputs.',
      'Use the same Oracle AI Database 26ai data in every downstream risk, service, and agent workflow.',
    ],
  },
  dashboard: {
    eyebrow: 'Scene 2 - detect the operating issue',
    title: 'Spot financial-crime exposure before it becomes customer and compliance fallout.',
    body: 'The command center turns the risk story into a live operating picture: suspicious payment activity, affected products, case volume, regional service pressure, revenue exposure, and audited agent activity all come from the same Oracle foundation.',
    beats: [
      'Watch exposure, client activity, case backlog, and service load move together.',
      'Look for AML pressure, fraud concentration, SLA risk, and product-level impact.',
      'Use the dashboard as the handoff into signals, graph, service coverage, OML, and agents.',
    ],
  },
  social: {
    eyebrow: 'Scene 3 - explain the signals',
    title: 'Find the AML and payments signals driving the investigation.',
    body: 'Risk Signal Intelligence is the evidence-gathering chapter. Vector search and urgency scoring connect transaction alerts, compliance bulletins, client-behavior changes, fraud notes, product exposure, and service pressure so analysts can see why the pattern matters.',
    beats: [
      'Search for payment anomaly, AML escalation, or high-value client exposure.',
      'Use semantic matches to connect signals to products, cases, and clients.',
      'Escalate the strongest evidence into graph and agent workflows.',
    ],
  },
  graph: {
    eyebrow: 'Scene 4 - trace the risk path',
    title: 'Follow connected accounts, devices, payees, and cases.',
    body: 'The graph scene shows how clients, accounts, devices, IP addresses, merchants, payees, regions, and fraud cases are connected. The findings panel turns those paths into investigator-ready financial-crime actions.',
    beats: [
      'Select accounts, clients, devices, merchants, payees, or cases.',
      'Increase graph depth to expose multi-hop fraud and exposure paths.',
      'Use connected-risk findings to decide where investigation work should start.',
    ],
  },
  fulfillment: {
    eyebrow: 'Scene 5 - protect service capacity',
    title: 'Route investigation load while protecting client SLAs.',
    body: 'The coverage map turns the same risk story into operating capacity. Branches, service centers, regions, case queues, high-value client coverage, and SLA pressure show where reviews can be routed or protected.',
    beats: [
      'Compare service centers, case load, SLA exposure, and regional coverage.',
      'Toggle spatial layers to see branches, client regions, and service-risk routes.',
      'Use proximity and capacity evidence to support case-routing and client-service decisions.',
    ],
  },
  orders: {
    eyebrow: 'Scene 6 - inspect the execution record',
    title: 'Open the transaction and case details behind the risk decision.',
    body: 'Transaction and Case Operations shows the governed execution layer. Operators can inspect transaction rows, case state, service routing, and JSON duality documents for the same finance records without creating a separate application store.',
    beats: [
      'Filter transactions and cases by status, risk, and active VPD context.',
      'Open a case to compare relational rows with JSON duality payloads.',
      'Use the record as the operational handoff into analytics or agent action.',
    ],
  },
  oml: {
    eyebrow: 'Scene 7 - predict the next exposure',
    title: 'Score risk, case pressure, revenue impact, and client cohorts inside Oracle.',
    body: 'OML turns the investigation into predictive financial operations. In-database models score fraud exposure, operational capacity, client attrition, product risk, revenue impact, and customer segments without moving data out of Oracle.',
    beats: [
      'Review active model status and SQL fallback evidence.',
      'Use risk, capacity, and revenue tabs to prioritize exposed products and client groups.',
      'Carry predictions into Ask Data or agent workflows for action.',
    ],
  },
  askdata: {
    eyebrow: 'Scene 8 - ask the investigation questions',
    title: 'Interrogate the finance risk story in plain language.',
    body: 'Governed Data Copilot uses Autonomous Database Select AI with OCI Generative AI to answer questions about AML alerts, payment exposure, high-risk clients, service capacity, revenue impact, and case backlog. Oracle generates SQL over a curated view allowlist, the application validates it, and Autonomous Database executes it in the active VPD session before Select AI narrates the bounded result.',
    beats: [
      'Ask story-specific questions in explain, chat, show SQL, or run SQL mode.',
      'Review the generated SQL, active Select AI profile, model, region, and native conversation evidence.',
      'Use the VPD-filtered answer as context for the AI Operations Agent Console.',
    ],
  },
  agents: {
    eyebrow: 'Scene 9 - coordinate the response',
    title: 'Convert risk findings into audited advisory recommendations.',
    body: 'The agent console closes the loop with native Autonomous Database Select AI agents. The application generates and validates one read-only query, executes it in the selected VPD session, and supplies bounded evidence to a tool-free DBMS_CLOUD_AI_AGENT specialist team. Each returned recommendation is recorded in the audit trail; it cannot contact clients, update cases, or execute operational actions.',
    beats: [
      'Ask agents to check payment exposure, client impact, or SLA risk.',
      'Review the native supervisor, specialist team, OCI model, region, and VPD-grounded evidence.',
      'Treat every result as advisory and review proposed actions before any human-led follow-up.',
    ],
  },
};

export function FinanceStoryRail() {
  return (
    <div className="welcome-story-rail" aria-label="Financial crime and operations story across the finance use cases">
      <div className="welcome-story-rail__intro">
        <span className="welcome-story-rail__kicker">Nine use cases, one financial-crime response story</span>
        <p>
          The demo follows one AML and payments-risk pattern from signal detection through graph investigation,
          service-capacity protection, predictive risk scoring, natural-language analysis, and AI-assisted action.
          Each scene proves how the same governed Oracle AI Database 26ai foundation supports a complete finance operations conversation.
        </p>
      </div>
      <ol className="welcome-story-rail__steps">
        {FINANCE_STORY_STEPS.map((step) => (
          <li key={step.useCase} className="welcome-story-step">
            <span className="welcome-story-step__stage">{step.stage}</span>
            <span className="welcome-story-step__use-cases">{step.useCase}</span>
            <span className="welcome-story-step__summary">{step.summary}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SceneStoryPanel({ scene }) {
  const story = SCENE_STORIES[scene];
  if (!story) return null;

  return (
    <section className="finance-story-panel" aria-label={`${story.title} story context`}>
      <div className="finance-story-panel__copy">
        <span className="finance-story-panel__eyebrow">{story.eyebrow}</span>
        <h3>{story.title}</h3>
        <p>{story.body}</p>
      </div>
      <ol className="finance-story-panel__beats">
        {story.beats.map((beat, index) => (
          <li key={beat}>
            <span>{index + 1}</span>
            <p>{beat}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
