import SystemWorkflowDiagrams from "../components/SystemWorkflowDiagrams.tsx";
import UserAdminSection from "../components/UserAdminSection.tsx";

export default function Settings() {
  return (
    <div className="settings-page">
      <UserAdminSection />

      <section className="card settings-intro">
        <h2 className="card-title">Settings</h2>
        <p className="muted">
          Day-to-day tuning uses the <strong>Realtime</strong> page (worker interval, sync) and{" "}
          <strong>Scraper</strong> jobs. Server-side configuration (database, sessions, integrations) is set in the
          deployment environment — see your operator’s deployment notes or <code className="settings-inline-code">.env.example</code>{" "}
          in the repository. Successful <strong>智能分析</strong> runs are stored for later review on the same tab.
        </p>
      </section>

      <section className="card settings-infra">
        <h2 className="card-title">System overview</h2>
        <p className="settings-infra-lead">
          The diagrams below use familiar flowchart shapes (similar to common ISO-style flowcharts). The{" "}
          <strong>first</strong> picture shows <strong>where configuration comes from</strong> (environment variables,
          Vite build-time values, and UI actions such as the Realtime worker interval). The <strong>second</strong> shows{" "}
          <strong>end-to-end data movement</strong> between you, the apps, saved data, and public HKJC sources. The{" "}
          <strong>third</strong> shows the <strong>智能分析 (AI recommendation)</strong> path: assembling context
          (including odds momentum from snapshots), checking the model reply, saving successful runs, and reloading
          history. The{" "}
          <strong>fourth</strong> shows{" "}
          <strong>how the same project is turned into running software</strong> with Docker. Arrows are labeled in plain
          language.
        </p>
        <p className="settings-infra-lead settings-infra-note">
          <strong>Today:</strong> the realtime dashboard and odds history come from the <strong>SQL database</strong>{" "}
          (PostgreSQL). <strong>Redis</strong> is defined in Docker for possible <strong>future</strong> development
          (for example caching); the application does not use it yet.
        </p>

        <div className="settings-legend card">
          <h3 className="settings-legend-title">How to read the shapes</h3>
          <ul className="settings-legend-list">
            <li>
              <strong>Rounded</strong> — a person or a clear start/end point.
            </li>
            <li>
              <strong>Rectangle</strong> — a program or a step (something that does work).
            </li>
            <li>
              <strong>Cylinder</strong> — stored data (database or cache).
            </li>
            <li>
              <strong>Hexagon</strong> — systems outside this project (for example HKJC websites and APIs).
            </li>
          </ul>
        </div>

        <SystemWorkflowDiagrams />
      </section>
    </div>
  );
}
