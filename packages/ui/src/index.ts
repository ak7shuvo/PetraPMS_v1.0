// Shared design tokens (PetraPOS/PetraPMS family). The web app mirrors these as CSS variables in globals.css.
export const tokens = {
  petraRed: "#C8102E",
  petraBlack: "#111111",
  petraCream: "#F6F1E7",
  petraInk: "#1A1A1A",
  petraMuted: "#6B6B6B",
  petraBorder: "#E4DCCB",
} as const;

export const roomStatusColors = {
  vacantClean: "#2F9E5B",
  vacantDirty: "#D97706",
  occupied: "#C8102E",
  reserved: "#2563EB",
  outOfOrder: "#7C3AED",
  inspected: "#0F766E",
} as const;

/** Minimum touch target in CSS px. */
export const TOUCH_TARGET = 44;
