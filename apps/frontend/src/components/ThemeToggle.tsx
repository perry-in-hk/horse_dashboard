import { useTheme } from "../theme/ThemeContext.tsx";

export default function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();
  return (
    <button type="button" className="theme-toggle-btn" onClick={toggleTheme} aria-label="Toggle theme">
      {isDark ? "Light" : "Dark"}
    </button>
  );
}
