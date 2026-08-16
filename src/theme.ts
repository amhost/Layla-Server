// Shared design tokens. All colours / fonts used by the renderer screens are
// defined here so the same value is never re-declared per screen.

export const PALETTE = {
  primary: "#47a6ff",
  primaryDim: "rgba(71,166,255,0.12)",
  primaryBorder: "rgba(71,166,255,0.30)",
  primaryTint: "rgba(71,166,255,0.08)",
  accentGlow: "rgba(71, 166, 255, 0.25)",

  danger: "#ff6347",
  dangerDim: "rgba(255,99,71,0.12)",
  dangerGlow: "rgba(255, 99, 71, 0.25)",

  success: "#34d399",
  successGlow: "rgba(52, 211, 153, 0.20)",
  warning: "#fbbf24",

  background: "#1a1a1a",
  panelBackground: "#1c1c1c",
  cardBg: "#252525",
  settingsCardBg: "#222222",
  settingsCardBgHover: "#272727",
  surface: "#282828",
  surfaceHover: "#2e2e2e",
  inputBg: "#2a2a2a",

  border: "#333333",
  borderStrong: "#343434",
  borderLight: "#3e3e3e",

  brightText: "#ffffff",
  text: "#e8e8e8",
  softText: "#e0e0e0",
  mutedText: "#aaaaaa",
  secondaryText: "#999999",
  dimText: "#888888",
};

export const UI_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export const MONO_FONT_STACK =
  "'Cascadia Mono', 'Fira Code', 'Consolas', monospace";

/** Thin dark scrollbar rules for a scrollable element. */
export function scrollbarCss(
  selector: string,
  { thumb = PALETTE.border, thumbHover }: { thumb?: string; thumbHover?: string } = {},
): string {
  return `
${selector}::-webkit-scrollbar {
  width: 6px;
}
${selector}::-webkit-scrollbar-track {
  background: transparent;
}
${selector}::-webkit-scrollbar-thumb {
  background: ${thumb};
  border-radius: 3px;
}${
    thumbHover
      ? `
${selector}::-webkit-scrollbar-thumb:hover {
  background: ${thumbHover};
}`
      : ""
  }
`;
}
