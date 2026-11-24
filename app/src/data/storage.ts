// Small persisted settings. AsyncStorage is localStorage on web and native
// storage on iOS; every call is wrapped so private windows / blocked storage
// can never break rendering. Keys match the website's, so existing choices carry over.
import AsyncStorage from "@react-native-async-storage/async-storage";

export const KEYS = {
  theme: "weatherTempo.theme",
  location: "weatherTempo.location",
  chartDays: "weatherTempo.chartDays",
  alerts: "weatherTempo.alerts",
  warningMemory: "weatherTempo.warningMemory",
  diagnostics: "weatherTempo.diagnostics",
} as const;

export async function load(key: string): Promise<string | null> {
  try { return await AsyncStorage.getItem(key); } catch { return null; }
}

export async function save(key: string, value: string): Promise<void> {
  try { await AsyncStorage.setItem(key, value); } catch { /* storage unavailable: keep going */ }
}
