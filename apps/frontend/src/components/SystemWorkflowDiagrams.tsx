import { useEffect, useId, useRef, useState } from "react";
import mermaid from "mermaid";

/** End-to-end data movement; edit to update the diagram. */
export const SYSTEM_DATAFLOW_DIAGRAM = `flowchart TB
  subgraph people [You]
    user([Person using the dashboard])
  end
  subgraph outside [Outside this project]
    hkjc{{HKJC public racing websites and APIs}}
  end
  subgraph dockerApps [Programs running in Docker]
    fe[Web app screen]
    be[Backend service and live odds sync]
    scraper[Scraper service]
    rec[Recommender service]
  end
  subgraph stores [Stored data]
    pg[(PostgreSQL: odds snapshots merged history AI analyses)]
    redis[(Redis reserved for future use)]
  end
  user -->|opens pages and charts| fe
  fe -->|API calls realtime views and scraper job requests| be
  be -->|reads and writes tables and realtime data| pg
  be -.->|future development| redis
  be -->|pulls odds and race details| hkjc
  scraper -->|downloads public pages| hkjc
  scraper -->|writes history into the database| pg
  rec -->|reads saved data| pg
`;

/** Env, UI, and API: what you configure and where it applies. */
export const SETTINGS_CONFIG_FLOW_DIAGRAM = `flowchart TB
  subgraph cfgSrc [Configuration sources]
    envHost[".env file and Compose env"]
    viteEnv["Vite env at build time"]
  end
  subgraph feLayer [Web app browser]
    pages["Dashboard pages"]
  end
  subgraph beLayer [Backend container]
    apiNode["REST API"]
    oddsWorkerNode["Odds sync worker"]
  end
  subgraph persisted [Persisted data]
    pgStore[(PostgreSQL)]
  end
  envHost -->|DATABASE_URL REDIS_URL SESSION_SECRET SCRAPER_ROOT| apiNode
  envHost -->|AUTH_INITIAL for first admin only| apiNode
  envHost -->|ODDS_SYNC ODDS_SYNC_ODDS_TYPES OPENAI OPENAI_FORCE_JSON AI_MOMENTUM| apiNode
  envHost -->|ODDS_SYNC_INTERVAL_MS seeds worker| oddsWorkerNode
  viteEnv -->|VITE_API_URL VITE_WS_URL| pages
  pages -->|HTTP session cookie after login| apiNode
  pages -->|PUT worker interval| apiNode
  apiNode -->|in-memory worker interval until restart| oddsWorkerNode
  apiNode -->|on-demand scraper jobs| pgStore
  apiNode -->|insert AI analysis rows| pgStore
  oddsWorkerNode -->|odds snapshots| pgStore
`;

/** How images are built and containers start; edit to update the diagram. */
export const DOCKER_BUILD_RUN_DIAGRAM = `flowchart TB
  subgraph inputs [What you provide]
    folder[Project folder with source code]
    envfile[.env file with database URL and secrets]
  end
  subgraph buildPhase [Build step]
    cmdBuild["docker compose build"]
    dockerfiles[Dockerfiles under infra/docker]
    images[Container images]
  end
  subgraph runPhase [Run step]
    cmdUp["docker compose up"]
    waitDb[Postgres is ready and healthy]
    waitBe[Backend is healthy on port 4000]
    waitFe[Frontend is up on host port 5173]
    waitJobs[Scraper and recommender start after database and API]
  end
  subgraph result [What you get]
    browserNote[Browser opens the web app same-origin /api via Caddy or Vite proxy in dev]
  end
  folder --> cmdBuild
  envfile --> cmdBuild
  cmdBuild --> dockerfiles
  dockerfiles --> images
  images --> cmdUp
  cmdUp --> waitDb
  waitDb --> waitBe
  waitBe --> waitFe
  waitBe --> waitJobs
  waitFe --> browserNote
  waitJobs --> browserNote
`;

/** Smart analysis: context + momentum → LLM JSON → validate → save → UI; optional reload from SQL. */
export const AI_RECOMMENDATION_FLOW_DIAGRAM = `flowchart TB
  subgraph userAi [You]
    userAiNode([Person using the dashboard])
  end
  subgraph webAi [Web app]
    aiTab[智能分析: tabs and saved-analysis picker]
  end
  subgraph beAi [Backend]
    aiPost["POST /api/ai/analyze"]
    buildCtx[Build prompt: racecard form pools Odds momentum window from snapshots]
    validate[Zod JSON schema and fixed Markdown render]
    aiGet["GET /api/ai/saved"]
  end
  subgraph storesAi [Stored data]
    pgAi[(PostgreSQL: snapshots history hkjc_ai_analyses)]
  end
  subgraph hkjcAi [HKJC]
    gqlAi{{HKJC GraphQL: racecard and pools}}
  end
  subgraph llmOut [External AI]
    openaiApi{{OpenAI-compatible API: JSON object mode when enabled}}
  end
  userAiNode -->|open tab pick meeting race| aiTab
  aiTab -->|HTTP session cookie| aiPost
  aiPost --> buildCtx
  buildCtx -->|read snapshots form rows momentum query| pgAi
  buildCtx -->|live runners when needed| gqlAi
  buildCtx -->|system and user messages| openaiApi
  openaiApi -->|JSON matching schema| validate
  validate -->|insert successful run| pgAi
  validate -->|text structured meta saved_id| aiPost
  aiPost -->|response| aiTab
  aiTab -->|list or load prior run| aiGet
  aiGet -->|read rows| pgAi
  aiGet -->|same shape as analyze| aiTab
`;

export default function SystemWorkflowDiagrams() {
  const settingsFlowRef = useRef<HTMLDivElement>(null);
  const dataFlowRef = useRef<HTMLDivElement>(null);
  const buildRef = useRef<HTMLDivElement>(null);
  const aiRecRef = useRef<HTMLDivElement>(null);
  const safeId = useId().replace(/:/g, "");
  const [settingsFlowError, setSettingsFlowError] = useState<string | null>(null);
  const [dataFlowError, setDataFlowError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [aiRecError, setAiRecError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      flowchart: { htmlLabels: true, curve: "basis" },
    });

    (async () => {
      setSettingsFlowError(null);
      setDataFlowError(null);
      setBuildError(null);
      setAiRecError(null);
      if (settingsFlowRef.current) settingsFlowRef.current.innerHTML = "";
      if (dataFlowRef.current) dataFlowRef.current.innerHTML = "";
      if (buildRef.current) buildRef.current.innerHTML = "";
      if (aiRecRef.current) aiRecRef.current.innerHTML = "";

      try {
        const { svg } = await mermaid.render(`sys-settings-${safeId}`, SETTINGS_CONFIG_FLOW_DIAGRAM);
        if (!cancelled && settingsFlowRef.current) settingsFlowRef.current.innerHTML = svg;
      } catch (e: unknown) {
        if (!cancelled) {
          setSettingsFlowError(e instanceof Error ? e.message : String(e));
        }
      }

      try {
        const { svg } = await mermaid.render(`sys-dataflow-${safeId}`, SYSTEM_DATAFLOW_DIAGRAM);
        if (!cancelled && dataFlowRef.current) dataFlowRef.current.innerHTML = svg;
      } catch (e: unknown) {
        if (!cancelled) {
          setDataFlowError(e instanceof Error ? e.message : String(e));
        }
      }

      try {
        const { svg } = await mermaid.render(`sys-docker-${safeId}`, DOCKER_BUILD_RUN_DIAGRAM);
        if (!cancelled && buildRef.current) buildRef.current.innerHTML = svg;
      } catch (e: unknown) {
        if (!cancelled) {
          setBuildError(e instanceof Error ? e.message : String(e));
        }
      }

      try {
        const { svg } = await mermaid.render(`sys-ai-rec-${safeId}`, AI_RECOMMENDATION_FLOW_DIAGRAM);
        if (!cancelled && aiRecRef.current) aiRecRef.current.innerHTML = svg;
      } catch (e: unknown) {
        if (!cancelled) {
          setAiRecError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [safeId]);

  return (
    <div className="settings-diagram-stack">
      <div className="settings-diagram-block">
        <h3 className="settings-diagram-title">Settings and configuration flow</h3>
        {settingsFlowError ? (
          <p className="error-text" role="alert">
            Could not render settings flow diagram: {settingsFlowError}
          </p>
        ) : null}
        <div className="settings-mindmap-wrap">
          <div
            ref={settingsFlowRef}
            className="settings-mindmap-svg"
            role="img"
            aria-label="Where environment variables and UI actions configure the backend and database"
          />
        </div>
        <p className="settings-diagram-caption muted">
          The <strong>Scraper</strong> page and <strong>Realtime</strong> bulk horse-history action call the same API
          that spawns scraper scripts inside the backend container (<code className="settings-inline-code">SCRAPER_ROOT</code>
          ). A separate <code className="settings-inline-code">scraper</code> Compose service can still run batch jobs;
          both write into PostgreSQL. <strong>智能分析</strong> uses server-side{" "}
          <code className="settings-inline-code">OPENAI_*</code>, optional{" "}
          <code className="settings-inline-code">OPENAI_FORCE_JSON</code>, and{" "}
          <code className="settings-inline-code">AI_MOMENTUM_*</code> for the short-window odds-drop block; successful runs
          are stored in <code className="settings-inline-code">hkjc_ai_analyses</code>.
        </p>
      </div>

      <div className="settings-diagram-block">
        <h3 className="settings-diagram-title">How data moves through the system</h3>
        {dataFlowError ? (
          <p className="error-text" role="alert">
            Could not render data-flow diagram: {dataFlowError}
          </p>
        ) : null}
        <div className="settings-mindmap-wrap">
          <div
            ref={dataFlowRef}
            className="settings-mindmap-svg"
            role="img"
            aria-label="Data flow through HKJC Dashboard"
          />
        </div>
        <p className="settings-diagram-caption muted">
          Realtime reads odds snapshots from PostgreSQL. The <strong>Scraper</strong> UI and <strong>Realtime</strong>{" "}
          can start horse-details or historical jobs on the backend. Typical host ports: web <strong>5173</strong>, API{" "}
          <strong>4000</strong> (see <code className="settings-inline-code">docker-compose.yml</code>).
        </p>
      </div>

      <div className="settings-diagram-block">
        <h3 className="settings-diagram-title">AI recommendation (智能分析) structure</h3>
        {aiRecError ? (
          <p className="error-text" role="alert">
            Could not render AI recommendation diagram: {aiRecError}
          </p>
        ) : null}
        <div className="settings-mindmap-wrap">
          <div
            ref={aiRecRef}
            className="settings-mindmap-svg"
            role="img"
            aria-label="AI recommendation request flow from browser to backend, database, HKJC, and LLM"
          />
        </div>
        <p className="settings-diagram-caption muted">
          The backend holds <code className="settings-inline-code">OPENAI_API_KEY</code> only (never exposed to the
          browser). Default path uses <strong>JSON</strong> from the model, <strong>Zod</strong> validation, a fixed
          Markdown template, and <strong>tabbed sections</strong> in the UI. QPL/QIN appear when snapshots include those
          pools (<code className="settings-inline-code">ODDS_SYNC_ODDS_TYPES</code>). Each successful run is written to{" "}
          <code className="settings-inline-code">hkjc_ai_analyses</code>; the page can reload past runs via{" "}
          <code className="settings-inline-code">GET /api/ai/saved</code>.
        </p>
      </div>

      <div className="settings-diagram-block">
        <h3 className="settings-diagram-title">How the software is built and run</h3>
        {buildError ? (
          <p className="error-text" role="alert">
            Could not render build diagram: {buildError}
          </p>
        ) : null}
        <div className="settings-mindmap-wrap">
          <div
            ref={buildRef}
            className="settings-mindmap-svg"
            role="img"
            aria-label="Docker build and run workflow"
          />
        </div>
      </div>
    </div>
  );
}
