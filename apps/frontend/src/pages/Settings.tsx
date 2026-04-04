import SystemWorkflowDiagrams from "../components/SystemWorkflowDiagrams.tsx";

export default function Settings() {
  return (
    <div className="settings-page">
      <section className="card settings-intro">
        <h2 className="card-title">Settings</h2>
        <p className="muted">
          Preferences and options will appear here later. Nothing is configurable yet.
        </p>
      </section>

      <section className="card settings-infra">
        <h2 className="card-title">System overview</h2>
        <p className="settings-infra-lead">
          The diagrams below use familiar flowchart shapes (similar to common ISO-style flowcharts): the first
          picture shows <strong>what information moves where</strong> between you, the apps, saved data, and
          public HKJC sources. The second shows <strong>how the same project is turned into running software</strong>{" "}
          with Docker. Arrows are labeled in plain language.
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
