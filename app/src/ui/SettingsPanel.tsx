import Feather from "@expo/vector-icons/Feather";
import React, { useState } from "react";
import { Platform } from "react-native";
import { AlertsPanel } from "./AlertsPanel";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { LOCATIONS } from "../core/locations";
import { useSettings, type ThemeChoice } from "../settings";
import { Txt } from "./kit";

const CHOICES: { id: ThemeChoice; label: string }[] = [
  { id: "auto", label: "Auto" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" },
];

export function SettingsPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { tokens, themeChoice, setThemeChoice, location, setLocationId } = useSettings();
  const [alertsOpen, setAlertsOpen] = useState(false);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close settings" />
      <View style={[styles.sheet, { backgroundColor: tokens.bg, borderColor: tokens.cardBorder }]}>
        <View style={styles.head}>
          <Txt tone="strong" style={styles.title} accessibilityRole="header">Settings</Txt>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
            <Feather name="x" size={22} color={tokens.textMuted} />
          </Pressable>
        </View>

        <Txt tone="muted" style={styles.section}>Appearance</Txt>
        <View style={[styles.seg, { backgroundColor: tokens.selectBg, borderColor: tokens.cardBorder }]}
          accessibilityRole="radiogroup">
          {CHOICES.map((c) => {
            const on = themeChoice === c.id;
            return (
              <Pressable key={c.id} onPress={() => setThemeChoice(c.id)} accessibilityRole="radio"
                accessibilityState={{ selected: on }} style={[styles.segBtn, on && { backgroundColor: tokens.selectBgHi }]}>
                <Txt tone={on ? "strong" : "muted"} style={[styles.segText, on && styles.bold]}>{c.label}</Txt>
              </Pressable>
            );
          })}
        </View>

        {Platform.OS !== "web" && (
          <>
            <Txt tone="muted" style={styles.section}>Notifications</Txt>
            <Pressable onPress={() => setAlertsOpen(true)} accessibilityRole="button"
              style={[styles.loc, { borderColor: tokens.cardBorder }]}>
              <Txt style={styles.locText}>Alerts and diagnostics</Txt>
              <Feather name="chevron-right" size={18} color={tokens.textMuted} />
            </Pressable>
            <AlertsPanel visible={alertsOpen} onClose={() => setAlertsOpen(false)} />
          </>
        )}

        <Txt tone="muted" style={styles.section}>Location</Txt>
        <ScrollView style={styles.list}>
          {LOCATIONS.map((l) => {
            const on = l.id === location.id;
            return (
              <Pressable key={l.id} onPress={() => { setLocationId(l.id); onClose(); }} accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={[styles.loc, { borderColor: tokens.cardBorder }, on && { backgroundColor: tokens.selectBgHi }]}>
                <Txt tone={on ? "strong" : "text"} style={[styles.locText, on && styles.bold]}>{l.name}</Txt>
                {on && <Feather name="check" size={18} color={tokens.green} />}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    maxHeight: "80%", width: "100%", maxWidth: 520, alignSelf: "center",
    borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 18, fontWeight: "600" },
  section: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6 },
  seg: { flexDirection: "row", borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  segBtn: { flex: 1, paddingVertical: 10, alignItems: "center" },
  segText: { fontSize: 14 },
  bold: { fontWeight: "600" },
  list: { flexGrow: 0 },
  loc: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  locText: { fontSize: 15 },
});
