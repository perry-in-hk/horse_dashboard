/**
 * Mirrors theme.css for ECharts and TS (hex/rgba only).
 * ECharts cannot read CSS variables directly.
 */
export type ThemeName = "dark" | "light";
export type ThemeTokens = {
  brand: string;
  brandHover: string;
  accent: string;
  bgPage: string;
  bgElevated: string;
  bgMuted: string;
  bgInput: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textFaint: string;
  borderSubtle: string;
  borderMedium: string;
  chartAxis: string;
  chartSplit: string;
  danger: string;
  success: string;
  info: string;
  info2: string;
};

export const THEME_DARK = {
  brand: "#354168",
  brandHover: "#455282",
  accent: "#F1D664",
  bgPage: "#0a0a0a",
  bgElevated: "#171717",
  bgMuted: "#262626",
  bgInput: "#1a1a1a",
  textPrimary: "#fafafa",
  textSecondary: "#c5c5c5",
  textMuted: "#a3a3a3",
  textFaint: "#737373",
  borderSubtle: "#303030",
  borderMedium: "#424242",
  chartAxis: "#575757",
  chartSplit: "#353535",
  danger: "#f87171",
  success: "#4ade80",
  info: "#93c5fd",
  info2: "#bfdbfe",
} as const satisfies ThemeTokens;

export const THEME_LIGHT = {
  brand: "#354168",
  brandHover: "#2d385c",
  accent: "#d6b42a",
  bgPage: "#f5f5f5",
  bgElevated: "#ffffff",
  bgMuted: "#f1f1f1",
  bgInput: "#fcfcfc",
  textPrimary: "#171717",
  textSecondary: "#404040",
  textMuted: "#525252",
  textFaint: "#737373",
  borderSubtle: "#e2e2e2",
  borderMedium: "#d4d4d4",
  chartAxis: "#a3a3a3",
  chartSplit: "#e5e5e5",
  danger: "#dc2626",
  success: "#16a34a",
  info: "#2563eb",
  info2: "#3b82f6",
} as const satisfies ThemeTokens;

/** Legacy alias for old imports. */
export const THEME = THEME_DARK;

export function getThemeTokens(theme: ThemeName): ThemeTokens {
  return theme === "light" ? THEME_LIGHT : THEME_DARK;
}

export function chartBaseTextStyle(theme: ThemeTokens) {
  return { color: theme.textMuted };
}

export function chartAxisLineStyle(theme: ThemeTokens) {
  return { lineStyle: { color: theme.chartAxis } };
}

export function chartSplitLineStyle(theme: ThemeTokens) {
  return { lineStyle: { color: theme.chartSplit } };
}

/** Scrollable line chart shell (Realtime timelines). */
export function echartsRealtimeLineChartBase(theme: ThemeTokens = THEME_DARK) {
  return {
    backgroundColor: "transparent" as const,
    textStyle: chartBaseTextStyle(theme),
    tooltip: { trigger: "axis" as const },
    legend: {
      type: "scroll" as const,
      top: 0,
      textStyle: { color: theme.textMuted, fontSize: 11 },
    },
    grid: { left: 48, right: 16, top: 44, bottom: 24 },
    xAxis: {
      type: "time" as const,
      axisLine: chartAxisLineStyle(theme),
    },
    yAxis: {
      type: "value" as const,
      scale: true,
      splitLine: chartSplitLineStyle(theme),
      axisLine: chartAxisLineStyle(theme),
    },
  };
}
