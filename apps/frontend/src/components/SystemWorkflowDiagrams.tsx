import { useEffect, useId, useRef, useState } from "react";
import mermaid from "mermaid";

/** End-to-end data movement; edit to update the diagram. */
export const SYSTEM_DATAFLOW_DIAGRAM = `flowchart TB
  subgraph you [You]
    user([You in a web browser])
  end
  subgraph public [Outside this product]
    hkjc{{HKJC public racing sites and services}}
  end
  subgraph platform [What runs for HKJC Dashboard]
    fe[Dashboard web app]
    be[Backend: sign-in, charts, Realtime, Scraper controls, saved AI runs]
    odds[Background timer: fetch live odds]
    sc[Scraper sidecar: scheduled heartbeat to public HKJC pages]
  end
  subgraph stores [Where information is kept]
    pg[(PostgreSQL: race history, odds snapshots, merged form, saved analyses, sessions)]
    redis[(Redis: defined for possible future caching)]
  end
  user -->|open pages, run tools, refresh charts| fe
  fe -->|signed-in requests over HTTPS| be
  be -->|read charts, write jobs and analyses| pg
  odds -->|pull odds and related fields on a schedule| hkjc
  odds -->|append snapshots| pg
  be -->|when you start imports scripts download pages| hkjc
  be -->|merge and store new rows| pg
  sc -->|every few minutes| hkjc
  be -.->|not used by core features yet| redis
`;

/** Where settings and controls land: server config, build-time app settings, in-app actions. */
export const SETTINGS_CONFIG_FLOW_DIAGRAM = `flowchart TB
  subgraph cfgSrc [Where behaviour is set]
    envHost[Server and deployment configuration]
    viteEnv[Settings baked in when the web app is built]
  end
  subgraph feLayer [Your browser]
    pages[Dashboard pages including Realtime worker and sync controls]
  end
  subgraph beLayer [Backend]
    apiNode[Application server: APIs and sign-in]
    oddsWorkerNode[Timed odds sync running inside the backend]
  end
  subgraph persisted [Persisted data]
    pgStore[(PostgreSQL)]
  end
  envHost -->|database, sessions, integrations, scraper paths| apiNode
  envHost -->|timer and pool types for live odds| oddsWorkerNode
  viteEnv -->|which server URL the browser calls| pages
  pages -->|signed-in requests and in-page tuning| apiNode
  apiNode -->|tells the timer how often to run| oddsWorkerNode
  apiNode -->|on-demand jobs and AI saves| pgStore
  oddsWorkerNode -->|writes odds snapshots| pgStore
`;

/** How images are built and containers start; edit to update the diagram. */
export const DOCKER_BUILD_RUN_DIAGRAM = `flowchart TB
  subgraph inputs [What you provide]
    folder[Project source code]
    envfile[Environment file for database and secrets]
  end
  subgraph buildPhase [Build]
    cmdBuild[Build container images]
    dockerfiles[Docker build recipes]
    images[Ready-to-run images]
  end
  subgraph runPhase [Start order]
    cmdUp[Start the stack]
    waitDb[Database ready]
    waitBe[Backend ready]
    waitFe[Web app ready]
    waitProxy[Optional: reverse proxy for HTTPS in production]
    waitJobs[Helper services: scraper and recommender containers]
  end
  subgraph result [Outcome]
    browserNote[You open the dashboard; the browser talks to the API on the same site address]
  end
  folder --> cmdBuild
  envfile --> cmdBuild
  cmdBuild --> dockerfiles
  dockerfiles --> images
  images --> cmdUp
  cmdUp --> waitDb
  waitDb --> waitBe
  waitBe --> waitFe
  waitBe --> waitProxy
  waitBe --> waitJobs
  waitFe --> browserNote
  waitProxy --> browserNote
  waitJobs --> browserNote
`;

/** 智能分析: assemble context → external AI → check → save → reload saved runs. */
export const AI_RECOMMENDATION_FLOW_DIAGRAM = `flowchart TB
  subgraph userAi [You]
    userAiNode([You])
  end
  subgraph webAi [智能分析 in the web app]
    aiTab[Choose meeting and race; run analysis or open a saved run]
  end
  subgraph beAi [Backend]
    buildCtx[Assemble context: saved form, odds history and momentum, optional live race card]
    validate[Check the model reply matches the expected structure]
    saveRun[Store a successful run for later]
    loadSaved[List or load past runs]
  end
  subgraph storesAi [Database]
    pgAi[(Stored snapshots, history, and saved analysis runs)]
  end
  subgraph hkjcAi [HKJC]
    gqlAi{{HKJC services when live detail is needed}}
  end
  subgraph llmOut [External AI provider]
    openaiApi{{AI model you configure on the server}}
  end
  userAiNode -->|open the tab| aiTab
  aiTab -->|signed-in request to run| buildCtx
  buildCtx -->|read race and odds history| pgAi
  buildCtx -->|fetch live card or pools when needed| gqlAi
  buildCtx -->|send prompt| openaiApi
  openaiApi -->|model answer| validate
  validate -->|if valid| saveRun
  saveRun -->|keep copy| pgAi
  validate -->|show sections in the tab| aiTab
  aiTab -->|browse history| loadSaved
  loadSaved -->|read prior runs| pgAi
  loadSaved -->|display| aiTab
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
            aria-label="How server configuration, build-time settings, and in-app controls reach the backend and database"
          />
        </div>
        <p className="settings-diagram-caption muted">
          Operator settings cover the database, sign-in, scraper paths, and AI credentials. The web build decides which API
          address the browser calls. Day-to-day tuning (for example the Realtime odds timer) happens on{" "}
          <strong>Realtime</strong> and flows through the backend into the timed worker and the database.
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
            aria-label="End-to-end path from you in the browser through the app, HKJC sources, and stored data"
          />
        </div>
        <p className="settings-diagram-caption muted">
          <strong>Realtime</strong> charts read odds snapshots that the background timer keeps appending after it pulls
          from HKJC. Heavy imports (historical dates or horse-detail pages) are started from the <strong>Scraper</strong>{" "}
          page and run as scripts on the backend, which writes into the same database. A small scraper container also
          performs a periodic heartbeat to HKJC; Compose may start a recommender container, but it is idle and does not
          drive the UI today.
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
            aria-label="智能分析 flow from your choices to context assembly, external AI, checks, saved runs, and history"
          />
        </div>
        <p className="settings-diagram-caption muted">
          The server builds a structured prompt from saved form, odds history (including a short momentum window when data
          exists), and live HKJC details when needed. The AI reply is checked before it is shown and stored so you can
          reopen past runs from the same tab. Extra pool types in the analysis appear when those pools exist in stored
          snapshots.
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
            aria-label="From source and configuration to built images, containers starting in order, and opening the site"
          />
        </div>
        <p className="settings-diagram-caption muted">
          Local development often uses the dev server and a direct API port; production commonly puts the web app and API
          behind one hostname so the browser stays on a single address.
        </p>
      </div>
    </div>
  );
}
