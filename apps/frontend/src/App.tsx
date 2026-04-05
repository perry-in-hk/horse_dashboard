import { NavLink, Routes, Route, Navigate, Outlet } from "react-router-dom";
import Analysis from "./pages/Analysis.tsx";
import Compare from "./pages/Compare.tsx";
import Database from "./pages/Database.tsx";
import Scraper from "./pages/Scraper.tsx";
import AiRecommendation from "./pages/AiRecommendation.tsx";
import Realtime from "./pages/Realtime.tsx";
import Settings from "./pages/Settings.tsx";
import Login from "./pages/Login.tsx";
import { useAuth } from "./auth/AuthContext.tsx";

const tabs = [
  { to: "/analysis", label: "Analysis" },
  { to: "/compare", label: "Compare" },
  { to: "/database", label: "Database" },
  { to: "/scraper", label: "Scraper" },
  { to: "/realtime", label: "Realtime" },
  { to: "/ai", label: "智能分析" },
  { to: "/settings", label: "Settings" },
] as const;

function AppLayout() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return (
      <div className="app-shell">
        <main className="page-content">
          <p className="muted">Loading…</p>
        </main>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

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
        <div className="topbar-user">
          <span className="topbar-username" title={user.username}>
            {user.username}
            {user.role === "admin" ? <span className="topbar-role"> admin</span> : null}
          </span>
          <button type="button" className="topbar-logout" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>

      <main className="page-content">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<AppLayout />}>
        <Route path="analysis" element={<Analysis />} />
        <Route path="compare" element={<Compare />} />
        <Route path="database" element={<Database />} />
        <Route path="scraper" element={<Scraper />} />
        <Route path="realtime" element={<Realtime />} />
        <Route path="ai" element={<AiRecommendation />} />
        <Route path="settings" element={<Settings />} />
        <Route index element={<Navigate to="analysis" replace />} />
        <Route path="*" element={<Navigate to="/analysis" replace />} />
      </Route>
    </Routes>
  );
}
