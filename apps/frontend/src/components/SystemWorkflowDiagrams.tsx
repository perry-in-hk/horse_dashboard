import { useEffect, useId, useRef, useState } from "react";
import mermaid from "mermaid";
import { useTheme } from "../theme/ThemeContext.tsx";

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
    be[Backend services]
    odds[Background timer: fetch live odds]
    sc[Scraper sidecar]
  end
  subgraph stores [Where information is kept]
    pg[(Primary data store)]
    redis[(Optional cache layer)]
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
  envHost -->|service configuration| apiNode
  envHost -->|sync behavior| oddsWorkerNode
  viteEnv -->|which server URL the browser calls| pages
  pages -->|signed-in requests and in-page tuning| apiNode
  apiNode -->|tells the timer how often to run| oddsWorkerNode
  apiNode -->|on-demand jobs and analysis records| pgStore
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
  const { isDark } = useTheme();
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
      theme: isDark ? "dark" : "base",
      securityLevel: "loose",
      flowchart: { htmlLabels: true, curve: "basis" },
      themeVariables: isDark
        ? {
            darkMode: true,
            background: "#171717",
            mainBkg: "#354168",
            primaryColor: "#262626",
            primaryTextColor: "#fafafa",
            primaryBorderColor: "#575757",
            secondaryColor: "#202020",
            tertiaryColor: "#121212",
            lineColor: "#a3a3a3",
            clusterBkg: "rgba(53, 65, 104, 0.22)",
            titleColor: "#f1d664",
            edgeLabelBackground: "#171717",
            nodeTextColor: "#fafafa",
            actorBkg: "#262626",
            actorBorder: "#575757",
            actorTextColor: "#fafafa",
            signalColor: "#93c5fd",
            labelTextColor: "#c5c5c5",
            loopTextColor: "#c5c5c5",
          }
        : {
            darkMode: false,
            background: "#ffffff",
            mainBkg: "#dbe3f9",
            primaryColor: "#f5f5f5",
            primaryTextColor: "#171717",
            primaryBorderColor: "#d4d4d4",
            secondaryColor: "#f0f0f0",
            tertiaryColor: "#fafafa",
            lineColor: "#525252",
            clusterBkg: "rgba(219, 227, 249, 0.38)",
            titleColor: "#354168",
            edgeLabelBackground: "#ffffff",
            nodeTextColor: "#171717",
            actorBkg: "#f5f5f5",
            actorBorder: "#d4d4d4",
            actorTextColor: "#171717",
            signalColor: "#2563eb",
            labelTextColor: "#404040",
            loopTextColor: "#404040",
          },
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
  }, [isDark, safeId]);

  return (
    <div className="settings-diagram-stack">
      <details className="settings-diagram-block" open>
        <summary className="settings-diagram-summary">
          <h3 className="settings-diagram-title">設定與配置流向</h3>
        </summary>
        {settingsFlowError ? (
          <p className="error-text" role="alert">
            無法渲染設定流程圖：{settingsFlowError}
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
          平台設定會影響後端服務、定時同步與資料存放；畫面上的即時調整則會由 API 寫回系統。
        </p>
      </details>

      <details className="settings-diagram-block">
        <summary className="settings-diagram-summary">
          <h3 className="settings-diagram-title">資料流向總覽</h3>
        </summary>
        {dataFlowError ? (
          <p className="error-text" role="alert">
            無法渲染資料流向圖：{dataFlowError}
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
          即時頁面主要讀取快照資料；歷史補數與馬匹資料由 Scraper 任務寫入同一份資料庫。
        </p>
      </details>

      <details className="settings-diagram-block">
        <summary className="settings-diagram-summary">
          <h3 className="settings-diagram-title">智能分析流程</h3>
        </summary>
        {aiRecError ? (
          <p className="error-text" role="alert">
            無法渲染智能分析流程圖：{aiRecError}
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
          系統會整合歷史與快照資料送入模型，並在回傳後驗證格式，再寫入可回看的分析紀錄。
        </p>
      </details>

      <details className="settings-diagram-block">
        <summary className="settings-diagram-summary">
          <h3 className="settings-diagram-title">部署與啟動順序</h3>
        </summary>
        {buildError ? (
          <p className="error-text" role="alert">
            無法渲染部署流程圖：{buildError}
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
          部署會依序完成資料庫、後端與前端啟動，正式環境通常使用單一網域對外提供服務。
        </p>
      </details>
    </div>
  );
}
