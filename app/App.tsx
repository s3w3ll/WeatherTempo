import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useWeather } from "./src/data/useWeather";
import { SettingsProvider, useSettings } from "./src/settings";
import { ChartSection } from "./src/ui/ChartSection";
import { ConditionsCard } from "./src/ui/ConditionsCard";
import { Header } from "./src/ui/Header";
import { SettingsPanel } from "./src/ui/SettingsPanel";
import { bannerFor, StatusBanner } from "./src/ui/StatusBanner";
import { TidesCard } from "./src/ui/TidesCard";
import { WarningsCard } from "./src/ui/WarningsCard";

/** Re-renders every `ms` so relative times and "now" markers stay current. */
function useNow(ms = 60_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Dashboard() {
  const { ready, tokens, location } = useSettings();
  const weather = useWeather(location);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const nowMs = useNow();

  useEffect(() => {
    if (Platform.OS === "web") document.title = `WeatherTempo — ${location.name}`;
  }, [location.name]);

  if (!ready) return <View style={[styles.fill, { backgroundColor: tokens.bg }]} />;

  const { data } = weather;
  const banner = bannerFor(weather.loading, weather.source, data?.meta?.sourceStatus?.pws);
  const updated = data?.meta?.updated ? Date.parse(data.meta.updated) / 1000 : null;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: tokens.bg }]}>
      <StatusBar style={tokens.scheme === "dark" ? "light" : "dark"} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={weather.loading && !!data} onRefresh={weather.refresh} />}
      >
        <View style={styles.page}>
          <Header updatedUtc={updated} tz={location.timezone} onSettings={() => setSettingsOpen(true)} />
          {banner && <StatusBanner {...banner} />}
          <WarningsCard warnings={weather.warnings} tz={location.timezone} nowSec={nowMs / 1000} />
          {data ? (
            <>
              <ConditionsCard data={data} tz={location.timezone} nowMs={nowMs} />
              <ChartSection data={data} location={location} warnings={weather.warnings} nowMs={nowMs} />
              <TidesCard location={location} nowMs={nowMs} />
            </>
          ) : (
            <ActivityIndicator style={styles.spinner} color={tokens.textMuted} />
          )}
        </View>
      </ScrollView>
      <SettingsPanel visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <Dashboard />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { padding: 16, alignItems: "center" },
  page: { width: "100%", maxWidth: 1100, gap: 14 },
  spinner: { marginTop: 40 },
});
