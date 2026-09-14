---
name: Aashiyana
description: Familienplaner in Apples Handwerk und Aashiyanas Handschrift - warme Buehne, eine violette Stimme, WCAG AA als Invariante
colors:
  accent-violet: "#6C3AED"
  accent-violet-hover: "#5B2FD4"
  accent-violet-dark: "#A78BFA"
  accent-light: "#F3EFFE"
  grouped-bg: "#F5F3ED"
  surface: "#FFFFFF"
  surface-dark: "#2B2825"
  surface-3: "#EDEAE3"
  fill-well: "#EDEAE3"
  surface-elevated: "#FBFAF7"
  surface-elevated-hover: "#EDEAE3"
  bg-dark: "#191816"
  label: "#1D1B17"
  text-secondary: "#63615B"
  text-tertiary: "#6B675F"
  text-quaternary: "#8C8880"
  border: "#E4E0D7"
  border-subtle: "#EDEAE3"
  border-strong: "#CFC9BC"
  ink-on-vivid: "#FFFFFF"
  success: "#1E7B35"
  warning: "#A85D00"
  danger: "#D70015"
  info: "#0663C7"
  family-overview: "#6C3AED"
  family-time: "#00668F"
  family-work: "#157F3D"
  family-kitchen: "#C2410C"
  family-money: "#0F766E"
  family-people: "#CE2A63"
  family-health: "#9E1E88"
  family-records: "#42587E"
  family-neutral: "#677079"
  weather-clear: "#B45309"
  weather-night: "#4C4FBF"
  weather-cloud: "#4F6478"
  weather-rain: "#0A5C9E"
  weather-snow: "#00768C"
  weather-storm: "#8B2FC9"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "clamp(3rem, 9vw, 4.5rem)"
    fontWeight: 700
  large-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "2.125rem"
    fontWeight: 700
    lineHeight: 1.21
    letterSpacing: "-0.015em"
  title-1:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.21
    letterSpacing: "-0.015em"
  title-2:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.21
    letterSpacing: "-0.015em"
  title-3:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.47
  subheadline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.47
  footnote:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.21
  micro-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.21
    letterSpacing: "0.05em"
  caption-2:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.21
  mono:
    fontFamily: "ui-monospace, 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace"
    fontSize: "0.875rem"
    fontWeight: 400
rounded:
  2xs: "2px"
  xs: "4px"
  sm: "10px"
  md: "12px"
  lg: "16px"
  xl: "26px"
  full: "9999px"
  glass-card: "26px"
  glass-inner: "18px"
spacing:
  px: "1px"
  0h: "2px"
  1: "4px"
  1h: "6px"
  2: "8px"
  2h: "10px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  10: "40px"
  12: "48px"
  16: "64px"
components:
  button-primary:
    backgroundColor: "color-mix(in srgb, var(--color-accent) 88%, var(--neutral-950))"
    textColor: "{colors.ink-on-vivid}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "color-mix(in srgb, var(--color-accent) 76%, var(--neutral-950))"
  button-icon:
    rounded: "{rounded.full}"
    size: "44px"
 
  segment-active:
    backgroundColor: "var(--seg-active-bg)"
    textColor: "color-mix(in srgb, var(--module-accent, var(--color-accent)) var(--tint-ink), var(--color-text-primary))"
    rounded: "{rounded.full}"
  chip:
    backgroundColor: "color-mix(in srgb, var(--module-accent, var(--color-accent)) var(--tint-state), transparent)"
    textColor: "color-mix(in srgb, var(--module-accent, var(--color-accent)) var(--tint-ink), var(--color-text-primary))"
    rounded: "{rounded.full}"
    padding: "4px 12px (--space-1 / --space-3), Kante 1.5px"
    height: "48px (--target-lg); --sm-Variante 40px, auf (hover: none) 44px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "16px"
  widget-header:
    backgroundColor: "{colors.surface} (bandlos seit 2026-08-17; Absender ist das Vollton-Siegel)"
    padding: "12px 16px 8px (die .widget__header-Basisregel; keine Dashboard-Sonderregel mehr)"
    height: "52px (Titelzeile 32px + 12/8px Polster; keine Kante, keine min-height)"
  day-sheet:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "12px 16px"
  row-carrier:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "0px"
  inset-well:
    backgroundColor: "{colors.fill-well}"
    rounded: "{rounded.md}"
    padding: "12px"
  scroller-thumb:
    backgroundColor: "color-mix(in srgb, var(--module-accent) var(--tint-hint), transparent)"
    rounded: "{rounded.full}"
    size: "10px Spur, Daumen per 3px transparenter Border + background-clip: padding-box"
  media-thumb:
    backgroundColor: "var(--color-surface-2)"
    rounded: "{rounded.sm}"
    size: "40px Rezeptliste / 32px Planer / 20px Kachel"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.label}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "48px"
  fab-glass:
    backgroundColor: "color-mix(in srgb, var(--color-accent) 78%, transparent)"
    textColor: "{colors.ink-on-vivid}"
    rounded: "{rounded.full}"
    size: "44px (mobil, in der Nav-Kapsel) / 48px (Desktop)"
  brand-tile:
    backgroundColor: "{colors.accent-violet}"
    textColor: "{colors.ink-on-vivid}"
    rounded: "{rounded.lg}"
    size: "64px"

