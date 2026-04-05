import { NavLink, Routes, Route, Navigate } from "react-router-dom";
import Analysis from "./pages/Analysis.tsx";
import Compare from "./pages/Compare.tsx";
import Database from "./pages/Database.tsx";
import Scraper from "./pages/Scraper.tsx";
import AiRecommendation from "./pages/AiRecommendation.tsx";
import Realtime from "./pages/Realtime.tsx";
import Settings from "./pages/Settings.tsx";

const tabs = [
  { to: "/analysis", label: "Analysis" },
  { to: "/compare", label: "Compare" },
  { to: "/database", label: "Database" },
  { to: "/scraper", label: "Scraper" },
  { to: "/realtime", label: "Realtime" },
  { to: "/ai", label: "智能分析" },
  { to: "/settings", label: "Settings" },
] as const;

export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <h1 className="topbar-title">HKJC Dashboard</h1>
        <nav className="tab-nav">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab-link${isActive ? " active" : ""}`}>
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="page-content">
        <Routes>
          <Route path="/analysis" element={<Analysis />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/database" element={<Database />} />
          <Route path="/scraper" element={<Scraper />} />
          <Route path="/realtime" element={<Realtime />} />
          <Route path="/ai" element={<AiRecommendation />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/analysis" replace />} />
        </Routes>
      </main>
    </div>
  );
}
