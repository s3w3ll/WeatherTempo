// Skia draws text from font files (CanvasKit on web has no system fonts), so
// the chart bundles Inter. One call per size/weight the chart uses.
import { useFont, type SkFont } from "@shopify/react-native-skia";

const regular = require("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf");
const semi = require("@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf");
const bold = require("@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf");

export interface ChartFonts {
  /** 8 px 600: pressure strip labels */ s8: SkFont;
  /** 8 px 700: UV peak label */ b8: SkFont;
  /** 9 px 700: NOW, 0°, day names */ b9: SkFont;
  /** 10 px 400: hour labels */ r10: SkFont;
  /** 11 px 700: high/low temperature labels */ b11: SkFont;
}

/** The chart's fonts, or null until they have loaded. */
export function useChartFonts(): ChartFonts | null {
  const s8 = useFont(semi, 8);
  const b8 = useFont(bold, 8);
  const b9 = useFont(bold, 9);
  const r10 = useFont(regular, 10);
  const b11 = useFont(bold, 11);
  return s8 && b8 && b9 && r10 && b11 ? { s8, b8, b9, r10, b11 } : null;
}
