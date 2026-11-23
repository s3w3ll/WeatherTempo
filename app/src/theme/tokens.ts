// Design tokens, lifted from the website's style.css (:root and the dark
// blocks, which are the SwiftUI app's dark theme). One definition for web and
// iOS; the Skia chart reads the same values.
export interface Tokens {
  scheme: "light" | "dark";
  bg: string;
  card: string;
  cardBorder: string;
  stat: string;
  text: string;
  textStrong: string;
  textMuted: string;
  textFade: string;
  warm: string;
  cyan: string;
  red: string;
  green: string;
  blue: string;
  sunset: string;
  chartBg: string;
  chartGrid: string;
  chartAxis: string;
  chartNow: string;
  chartPress: string;
  tideCurve: string;
  tideFillA: string;
  tideFillB: string;
  tideFillC: string;
  tideCanvas: string;
  selectBg: string;
  selectBgHi: string;
  rowDay: string;
  rowNight: string;
  frame: string;
  warnYellow: string;
  warnOrange: string;
  warnRed: string;
}

const warn = { warnYellow: "#e2a800", warnOrange: "#f07814", warnRed: "#dc2832" };

export const LIGHT: Tokens = {
  scheme: "light",
  bg: "#eef2f8",
  card: "rgba(255,255,255,0.78)",
  cardBorder: "rgba(20,40,80,0.08)",
  stat: "rgba(255,255,255,0.55)",
  text: "#1a2640",
  textStrong: "#0a1426",
  textMuted: "#56708e",
  textFade: "#7892ad",
  warm: "#ea7c1c",
  cyan: "#0aa5c8",
  red: "#d63b54",
  green: "#1f9f5b",
  blue: "#2563d8",
  sunset: "#d9663c",
  chartBg: "#f5f8fc",
  chartGrid: "rgba(20,40,80,0.07)",
  chartAxis: "rgba(20,40,80,0.18)",
  chartNow: "rgba(20,40,80,0.55)",
  chartPress: "rgba(20,40,80,0.30)",
  tideCurve: "rgba(10,140,200,0.9)",
  tideFillA: "rgba(80,170,220,0.55)",
  tideFillB: "rgba(140,200,235,0.4)",
  tideFillC: "rgba(220,235,250,0.15)",
  tideCanvas: "rgba(225,235,250,0.7)",
  selectBg: "#ffffff",
  selectBgHi: "#eaf0fa",
  rowDay: "rgba(255,210,140,0.18)",
  rowNight: "rgba(20,40,80,0.045)",
  frame: "rgba(10,20,38,0.55)",
  ...warn,
};

export const DARK: Tokens = {
  scheme: "dark",
  bg: "#0d131e",
  card: "rgba(24,32,46,0.88)",
  cardBorder: "rgba(255,255,255,0.08)",
  stat: "rgba(255,255,255,0.03)",
  text: "#e2e8f2",
  textStrong: "#f5f8fc",
  textMuted: "#96aac4",
  textFade: "#8c9eb4",
  warm: "#f58c2d",
  cyan: "#3cc8eb",
  red: "#ff788c",
  green: "#3cc47a",
  blue: "#6ea0ff",
  sunset: "#ff8c5a",
  chartBg: "#101723",
  chartGrid: "rgba(255,255,255,0.06)",
  chartAxis: "rgba(255,255,255,0.18)",
  chartNow: "rgba(255,255,255,0.55)",
  chartPress: "rgba(255,255,255,0.35)",
  tideCurve: "rgba(90,190,240,0.95)",
  tideFillA: "rgba(60,140,210,0.55)",
  tideFillB: "rgba(40,100,170,0.35)",
  tideFillC: "rgba(20,40,70,0.15)",
  tideCanvas: "rgba(16,23,35,0.90)",
  selectBg: "#1c2638",
  selectBgHi: "#263247",
  rowDay: "rgba(255,210,150,0.05)",
  rowNight: "rgba(0,0,0,0.18)",
  frame: "rgba(245,248,252,0.55)",
  ...warn,
};
