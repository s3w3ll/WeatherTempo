// Chart palettes: the same values as ChartPalette.light / .dark in the SwiftUI
// app and LIGHT / DARK in the website's chart.js.
export interface Palette {
  bg: string; bgDay: string; bgNight: string; bgTwilight: string;
  tempFillTop: string; tempFillBot: string; tempLine: string; feelsLine: string;
  pressLine: string; nowLine: string; nowLabel: string; grid: string; dayDiv: string; zoneSep: string;
  text: string; textMuted: string; halo: string; cloud: string; dayAxisBg: string;
  windFillTop: string; windFillBot: string; windLine: string; windShadow: string; windArrow: string; gustLine: string;
  precipTop: string; precipBot: string; precipLine: string; precipShadow: string;
  hoverLine: string; freezingLine: string; dewLine: string; uvLine: string; uvFill: string;
  /** [r, g, b, peak alpha] */
  sunGlow: readonly [number, number, number, number];
  pressSteady: string; pressText: string;
}

export const LIGHT_PALETTE: Palette = {
  bg: "#f5f8fc",
  // Daytime base is a pale neutral warm: the sunshine glow adds the gold only where the sky is clear.
  bgDay: "rgba(255,228,190,0.22)", bgNight: "rgba(20,40,80,0.14)", bgTwilight: "rgba(190,120,160,0.18)",
  tempFillTop: "rgba(255,140,20,0.28)", tempFillBot: "rgba(255,160,30,0.04)",
  tempLine: "#ea7c1c", feelsLine: "rgba(10,165,200,0.85)",
  pressLine: "rgba(20,40,80,0.30)", nowLine: "rgba(20,40,80,0.55)", nowLabel: "rgba(20,40,80,0.75)",
  grid: "rgba(20,40,80,0.07)", dayDiv: "rgba(20,40,80,0.10)", zoneSep: "rgba(255,255,255,0.28)",
  text: "#1a2640", textMuted: "#56708e", halo: "rgba(245,248,252,0.8)",
  cloud: "rgba(255,255,255,0.95)", dayAxisBg: "rgba(0,0,0,0.18)",
  windFillTop: "rgba(220,60,50,0.22)", windFillBot: "rgba(220,60,50,0.03)",
  windLine: "rgba(255,90,70,0.60)", windShadow: "rgba(255,80,60,0.35)", windArrow: "rgba(255,90,70,0.85)",
  gustLine: "rgba(200,50,40,0.55)",
  precipTop: "rgba(60,150,255,0.22)", precipBot: "rgba(60,150,255,0.02)",
  precipLine: "rgba(60,150,255,0.85)", precipShadow: "rgba(60,150,255,0.4)",
  hoverLine: "rgba(20,40,80,0.55)", freezingLine: "rgba(40,110,220,0.55)",
  dewLine: "rgba(30,120,200,0.70)", uvLine: "rgba(150,70,200,0.85)", uvFill: "rgba(150,70,200,0.10)",
  sunGlow: [255, 190, 60, 0.5],
  pressSteady: "rgba(10,20,38,0.06)", pressText: "#0a1426",
};

export const DARK_PALETTE: Palette = {
  bg: "#101723",
  bgDay: "rgba(255,210,150,0.06)", bgNight: "rgba(0,0,0,0.30)", bgTwilight: "rgba(150,90,160,0.18)",
  tempFillTop: "rgba(255,140,20,0.30)", tempFillBot: "rgba(255,160,30,0.03)",
  tempLine: "#f58c2d", feelsLine: "rgba(60,200,235,0.9)",
  pressLine: "rgba(255,255,255,0.35)", nowLine: "rgba(255,255,255,0.55)", nowLabel: "rgba(255,255,255,0.85)",
  grid: "rgba(255,255,255,0.06)", dayDiv: "rgba(255,255,255,0.10)", zoneSep: "rgba(255,255,255,0.10)",
  text: "#e2e8f2", textMuted: "#96aac4", halo: "rgba(16,23,35,0.85)",
  cloud: "rgba(200,215,235,0.35)", dayAxisBg: "rgba(255,255,255,0.06)",
  windFillTop: "rgba(240,80,70,0.25)", windFillBot: "rgba(240,80,70,0.03)",
  windLine: "rgba(255,110,95,0.75)", windShadow: "rgba(255,80,60,0.35)", windArrow: "rgba(255,120,100,0.9)",
  gustLine: "rgba(255,130,120,0.6)",
  precipTop: "rgba(80,165,255,0.28)", precipBot: "rgba(80,165,255,0.03)",
  precipLine: "rgba(100,180,255,0.9)", precipShadow: "rgba(60,150,255,0.4)",
  hoverLine: "rgba(255,255,255,0.6)", freezingLine: "rgba(110,170,255,0.7)",
  dewLine: "rgba(90,170,240,0.8)", uvLine: "rgba(190,120,240,0.9)", uvFill: "rgba(190,120,240,0.14)",
  sunGlow: [255, 190, 60, 0.22],
  pressSteady: "rgba(245,248,252,0.06)", pressText: "#f5f8fc",
};

/** MetService colours (their yellow vanishes on a light card, so amber stands in). */
export const WARN_RGB = { yellow: [226, 168, 0], orange: [240, 120, 20], red: [220, 40, 50] } as const;
export const PRESS_RGB = { rising: [37, 99, 216], falling: [214, 100, 30] } as const;

export const rgba = ([r, g, b]: readonly [number, number, number] | readonly number[], a: number) =>
  `rgba(${r},${g},${b},${a})`;

/** Rain-bar colour: intensity 0–1 maps sky blue → deep blue. */
export function precipColor(intensity: number): string {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return `rgb(${Math.round(lerp(80, 40, intensity))},${Math.round(lerp(170, 100, intensity))},${Math.round(lerp(255, 220, intensity))})`;
}
