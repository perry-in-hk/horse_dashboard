import { NavLink } from "react-router-dom";
import AppLogo from "./AppLogo.tsx";
import ThemeToggle from "./ThemeToggle.tsx";

type NavGroup = {
  label: string;
  items: { to: string; label: string }[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "分析",
    items: [
      { to: "/analysis", label: "Analysis" },
      { to: "/compare", label: "Compare" },
      { to: "/realtime", label: "Realtime" },
      { to: "/ai", label: "智能分析" },
    ],
  },
  {
    label: "資料",
    items: [{ to: "/database", label: "Database" }],
  },
  {
    label: "工具",
    items: [{ to: "/scraper", label: "Scraper" }],
  },
  {
    label: "系統",
    items: [{ to: "/settings", label: "Settings" }],
  },
];

export default function AppSidebar(props: {
  username: string;
  isAdmin: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onLogout: () => void;
}) {
  const { username, isAdmin, collapsed, onToggleCollapse, onCloseMobile, onLogout } = props;
  return (
    <aside className={`app-sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sidebar-brand-row">
        <div className="sidebar-brand">
          <AppLogo size={26} showWordmark />
          <span className="sidebar-brand-text">Dashboard</span>
        </div>
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "展開側欄" : "收起側欄"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      <nav className="sidebar-nav">
        {NAV_GROUPS.map((group) => (
          <section key={group.label} className="sidebar-group">
            <p className="sidebar-group-label">{group.label}</p>
            <div className="sidebar-links">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}
                  onClick={onCloseMobile}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </section>
        ))}
      </nav>

      <footer className="sidebar-footer">
        <ThemeToggle />
        <p className="sidebar-user">
          {username}
          {isAdmin ? <span className="sidebar-user-role"> admin</span> : null}
        </p>
        <button type="button" className="btn btn-secondary sidebar-logout-btn" onClick={onLogout}>
          Log out
        </button>
      </footer>
    </aside>
  );
}
