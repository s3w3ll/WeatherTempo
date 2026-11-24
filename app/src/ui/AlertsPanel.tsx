import Feather from "@expo/vector-icons/Feather";
import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { refreshAndReplan } from "../alerts/refresh";
import { ensurePermission, permissionStatus, type Permission } from "../alerts/notify";
import { parseLog, type DiagEvent } from "../core/alerts/diagnostics";
import { clock } from "../core/insights";
import {
  RAIN_CHANCE_RANGE, RAIN_LEAD_OPTIONS, TEMP_RANGE, UV_RANGE,
  parseAlertSettings, sanitize, serializeAlertSettings, type AlertSettings,
} from "../core/alerts/settings";
import { KEYS, load, save } from "../data/storage";
import { useSettings } from "../settings";
import { Txt } from "./kit";

type BoolKey = { [K in keyof AlertSettings]: AlertSettings[K] extends boolean ? K : never }[keyof AlertSettings];
type NumKey = { [K in keyof AlertSettings]: AlertSettings[K] extends number ? K : never }[keyof AlertSettings];

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function AlertsPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { tokens, location } = useSettings();
  const [s, setS] = useState<AlertSettings>(() => parseAlertSettings(null));
  const [perm, setPerm] = useState<Permission>("undetermined");
  const [log, setLog] = useState<DiagEvent[]>([]);

  const reloadLog = useCallback(async () => setLog(parseLog(await load(KEYS.diagnostics))), []);
  useEffect(() => {
    if (!visible) return;
    load(KEYS.alerts).then((j) => setS(parseAlertSettings(j)));
    permissionStatus().then(setPerm);
    reloadLog();
  }, [visible, reloadLog]);

  const update = (patch: Partial<AlertSettings>) => {
    const next = sanitize({ ...s, ...patch });
    setS(next);
    save(KEYS.alerts, serializeAlertSettings(next)).then(async () => {
      if (Object.keys(patch).some((k) => k.endsWith("Enabled")) && (await ensurePermission())) setPerm("granted");
      await refreshAndReplan("app", location.id);   // re-plan with the new choices
      reloadLog();
    });
  };

  const toggle = (label: string, key: BoolKey, hint?: string) => (
    <View style={styles.row}>
      <View style={styles.grow}>
        <Txt tone="strong" style={styles.label}>{label}</Txt>
        {hint ? <Txt tone="muted" style={styles.hint}>{hint}</Txt> : null}
      </View>
      <Switch value={s[key]} onValueChange={(v) => update({ [key]: v })} accessibilityLabel={label} />
    </View>
  );

  const stepper = (label: string, key: NumKey, step: number, [lo, hi]: readonly [number, number], fmt = (v: number) => String(v)) => (
    <View style={styles.row}>
      <Txt style={[styles.label, styles.grow]}>{label}</Txt>
      <Pressable hitSlop={8} onPress={() => update({ [key]: Math.max(lo, s[key] - step) })} accessibilityLabel={`Decrease ${label}`}>
        <Feather name="minus-circle" size={22} color={tokens.textMuted} />
      </Pressable>
      <Txt tone="strong" style={styles.value}>{fmt(s[key])}</Txt>
      <Pressable hitSlop={8} onPress={() => update({ [key]: Math.min(hi, s[key] + step) })} accessibilityLabel={`Increase ${label}`}>
        <Feather name="plus-circle" size={22} color={tokens.textMuted} />
      </Pressable>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close alerts" />
      <View style={[styles.sheet, { backgroundColor: tokens.bg, borderColor: tokens.cardBorder }]}>
        <View style={styles.head}>
          <Txt tone="strong" style={styles.title} accessibilityRole="header">Alerts</Txt>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Feather name="x" size={22} color={tokens.textMuted} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          {perm === "denied" && (
            <Txt style={{ color: tokens.red }}>Notifications are turned off for WeatherTempo. Enable them in iOS Settings to receive alerts.</Txt>
          )}
          <Txt tone="muted" style={styles.section}>MetService</Txt>
          {toggle("Watches and warnings", "warningsEnabled", "Told as soon as one covers your location")}
          {s.warningsEnabled && toggle("Also when lifted early", "warningLiftedEnabled")}

          <Txt tone="muted" style={styles.section}>Temperature</Txt>
          {toggle("Warming above", "tempHighEnabled")}
          {s.tempHighEnabled && stepper("Limit", "tempHigh", 1, TEMP_RANGE, (v) => `${v}°`)}
          {toggle("Cold below", "tempLowEnabled")}
          {s.tempLowEnabled && stepper("Limit", "tempLow", 1, TEMP_RANGE, (v) => `${v}°`)}

          <Txt tone="muted" style={styles.section}>Sun</Txt>
          {toggle("UV reaches threshold", "uvEnabled")}
          {toggle("Morning UV summary", "dailyUVEnabled", "Only on days UV reaches the threshold")}
          {(s.uvEnabled || s.dailyUVEnabled) && stepper("UV threshold", "uvThreshold", 1, UV_RANGE)}
          {s.dailyUVEnabled && stepper("Send at", "dailyUVMinutes", 30, [0, 1439], hhmm)}

          <Txt tone="muted" style={styles.section}>Rain</Txt>
          {toggle("Rain coming", "rainEnabled")}
          {s.rainEnabled && stepper("Chance at least", "rainChance", 10, RAIN_CHANCE_RANGE, (v) => `${v}%`)}
          {s.rainEnabled && (
            <View style={styles.row}>
              <Txt style={[styles.label, styles.grow]}>Lead time</Txt>
              {RAIN_LEAD_OPTIONS.map((m) => (
                <Pressable key={m} onPress={() => update({ rainLeadMinutes: m })} accessibilityRole="radio"
                  accessibilityState={{ selected: s.rainLeadMinutes === m }}
                  style={[styles.chip, { borderColor: tokens.cardBorder }, s.rainLeadMinutes === m && { backgroundColor: tokens.selectBgHi }]}>
                  <Txt tone={s.rainLeadMinutes === m ? "strong" : "muted"} style={styles.chipText}>{m < 60 ? `${m}m` : `${m / 60}h`}</Txt>
                </Pressable>
              ))}
            </View>
          )}

          <Txt tone="muted" style={styles.section}>Diagnostics</Txt>
          {log.length === 0 ? <Txt tone="muted" style={styles.hint}>Nothing recorded yet.</Txt> : log.slice(0, 20).map((e, i) => (
            <View key={i} style={styles.logRow}>
              <Feather name={e.ok ? "check-circle" : "alert-circle"} size={14} color={e.ok ? tokens.green : tokens.red} />
              <View style={styles.grow}>
                <Txt style={styles.logText}>{e.source} · {e.kind}{e.count > 1 ? ` ×${e.count}` : ""} · {clock(e.date, "Pacific/Auckland")}</Txt>
                <Txt tone="muted" style={styles.hint}>{e.detail}</Txt>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    maxHeight: "90%", width: "100%", maxWidth: 520, alignSelf: "center",
    borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 18, fontWeight: "600" },
  body: { gap: 10, paddingBottom: 24 },
  section: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  grow: { flex: 1 },
  label: { fontSize: 15 },
  hint: { fontSize: 12 },
  value: { minWidth: 44, textAlign: "center", fontSize: 15 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 9 },
  chipText: { fontSize: 12 },
  logRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  logText: { fontSize: 12 },
});
