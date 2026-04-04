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
    pg[(PostgreSQL SQL including realtime odds snapshots)]
    redis[(Redis reserved for future use)]
  end
  user -->|opens pages and charts| fe
  fe -->|questions and answers over HTTP| be
  be -->|reads and writes tables and realtime data| pg
  be -.->|future development| redis
  be -->|pulls odds and race details| hkjc
  scraper -->|downloads public pages| hkjc
  scraper -->|writes history into the database| pg
  rec -->|reads saved data| pg
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
    browserNote[Browser opens the web app and talks to the API on port 4000 using VITE_API_URL]
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

export default function SystemWorkflowDiagrams() {
  const dataFlowRef = useRef<HTMLDivElement>(null);
  const buildRef = useRef<HTMLDivElement>(null);
  const safeId = useId().replace(/:/g, "");
  const [dataFlowError, setDataFlowError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      flowchart: { htmlLabels: true, curve: "basis" },
    });

    (async () => {
      setDataFlowError(null);
      setBuildError(null);
      if (dataFlowRef.current) dataFlowRef.current.innerHTML = "";
      if (buildRef.current) buildRef.current.innerHTML = "";

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
    })();

    return () => {
      cancelled = true;
    };
  }, [safeId]);

  return (
    <div className="settings-diagram-stack">
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
          Realtime views read from PostgreSQL. Typical host ports: web app <strong>5173</strong>, backend API{" "}
          <strong>4000</strong> (see <code className="settings-inline-code">docker-compose.yml</code>).
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
