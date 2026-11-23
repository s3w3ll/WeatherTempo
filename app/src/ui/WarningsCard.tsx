import Feather from "@expo/vector-icons/Feather";
import React, { useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { LEVEL_RANK, warningTiming } from "../core/insights";
import type { WarningItem } from "../core/payload";
import type { WarningLevel } from "../core/types";
import { useSettings } from "../settings";
import { Card, Txt } from "./kit";

const SPOKEN: Record<WarningLevel, string> = { yellow: "Yellow alert", orange: "Orange warning", red: "Red warning" };

/** MetService warnings, hidden when none are in force. Rows the viewer opened stay open across refreshes. */
export function WarningsCard({ warnings, tz, nowSec }: { warnings: WarningItem[]; tz: string; nowSec: number }) {
  const { tokens } = useSettings();
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!warnings.length) return null;

  const color = (l: WarningLevel) => ({ yellow: tokens.warnYellow, orange: tokens.warnOrange, red: tokens.warnRed })[l];
  const top = warnings.reduce<WarningLevel>((m, w) => (LEVEL_RANK[w.level] > LEVEL_RANK[m] ? w.level : m), "yellow");
  const toggle = (id: string) =>
    setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <Card style={{ borderColor: color(top), borderWidth: 1.5 }} accessibilityLabel="MetService warnings">
      {warnings.map((w) => {
        const isOpen = open.has(w.id);
        const timing = warningTiming(w, nowSec, tz);
        return (
          <View key={w.id} style={styles.row}>
            <Pressable
              onPress={() => toggle(w.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={`${SPOKEN[w.level] ?? "Warning"}: ${w.headline}. ${timing}. ${w.areaDescription ?? ""}`}
              style={styles.summary}
            >
              <Feather name="alert-triangle" size={20} color={color(w.level)} />
              <View style={styles.flex}>
                <Txt tone="strong" style={styles.headline}>{w.headline}</Txt>
                <Txt tone="muted" style={styles.small}>{timing}</Txt>
                {w.areaDescription ? <Txt tone="fade" style={styles.small}>{w.areaDescription}</Txt> : null}
              </View>
              <Feather name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={tokens.textMuted} />
            </Pressable>
            {isOpen && (
              <View style={styles.body}>
                {w.details ? <Txt style={styles.para}>{w.details}</Txt> : null}
                {w.instruction ? <Txt tone="strong" style={[styles.para, styles.bold]}>{w.instruction}</Txt> : null}
                {w.web ? (
                  <Txt style={[styles.para, { color: tokens.blue }]} accessibilityRole="link"
                    onPress={() => Linking.openURL(w.web!)}>More on metservice.com</Txt>
                ) : null}
              </View>
            )}
          </View>
        );
      })}
      <Txt tone="fade" style={styles.credit}>Source: MetService</Txt>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 6 },
  summary: { flexDirection: "row", gap: 10, alignItems: "center" },
  flex: { flex: 1 },
  headline: { fontSize: 15, fontWeight: "600" },
  small: { fontSize: 13, marginTop: 1 },
  body: { paddingLeft: 30, paddingTop: 6, gap: 6 },
  para: { fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: "600" },
  credit: { fontSize: 11, marginTop: 6, textAlign: "right" },
});
