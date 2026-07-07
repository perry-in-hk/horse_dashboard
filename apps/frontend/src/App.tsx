import { useMemo, useState } from "react";
import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import Analysis from "./pages/Analysis.tsx";
import Compare from "./pages/Compare.tsx";
import Database from "./pages/Database.tsx";
import Scraper from "./pages/Scraper.tsx";
import AiRecommendation from "./pages/AiRecommendation.tsx";
import Realtime from "./pages/Realtime.tsx";
import Settings from "./pages/Settings.tsx";
import Login from "./pages/Login.tsx";
import { useAuth } from "./auth/AuthContext.tsx";
import AppSidebar from "./components/AppSidebar.tsx";

const PAGE_TITLE: Record<string, string> = {
  "/analysis": "Analysis",
  "/compare": "Compare",
  "/database": "Database",
  "/scraper": "Scraper",
  "/realtime": "Realtime",
  "/ai": "智能分析",
  "/settings": "Settings",
};

function AppLayout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pageTitle = useMemo(() => PAGE_TITLE[location.pathname] ?? "Dashboard", [location.pathname]);
  const sidebarVisible =
    typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches
      ? mobileOpen
      : !sidebarCollapsed;

  function toggleSidebar() {
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    if (isMobile) {
      setMobileOpen((open) => !open);
      return;
    }
    setSidebarCollapsed((collapsed) => !collapsed);
  }

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
      <div className={`app-sidebar-overlay${mobileOpen ? " open" : ""}`} onClick={() => setMobileOpen(false)} />
      <div
        className={`app-sidebar-host${mobileOpen ? " mobile-open" : ""}${sidebarCollapsed ? " collapsed" : ""}`}
      >
        <AppSidebar
          username={user.username}
          isAdmin={user.role === "admin"}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
          onCloseMobile={() => setMobileOpen(false)}
          onLogout={() => void logout()}
        />
      </div>
      <div className={`app-main${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        <header className="app-topline">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={sidebarVisible ? "收起側欄" : "展開側欄"}
            aria-expanded={sidebarVisible}
          >
            {sidebarVisible ? "✕" : "☰"}
          </button>
          <h1 className="app-topline-title">{pageTitle}</h1>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
      </div>
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
