import Feather from "@expo/vector-icons/Feather";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { hourlyTableRows, HOURLY_COLUMNS } from "../core/dayForecast";
import type { HourlyHour } from "../core/payload";
import { useSettings } from "../settings";
import { Card, Txt } from "./kit";

// Column widths in px (Time … UV).
const WIDTHS = [78, 130, 58, 58, 72, 112, 84, 60, 58, 62, 96, 78];
const TOTAL = WIDTHS.reduce((a, b) => a + b, 0);

/** Collapsible five-day hourly table. Rows are built only while it is open. */
export function HourlyTable({ hourly, tz, nowSec }: { hourly: HourlyHour[]; tz: string; nowSec: number }) {
  const { tokens } = useSettings();
  const [open, setOpen] = useState(false);
  // Rounded to the minute so the table doesn't rebuild on every clock tick.
  const minute = Math.floor(nowSec / 60);
  const rows = useMemo(() => (open ? hourlyTableRows(hourly, tz, minute * 60) : []), [open, hourly, tz, minute]);

  const color = (col: number) =>
    col === 2 ? tokens.warm : col === 3 ? tokens.cyan : col === 5 || col === 6 ? tokens.red : col === 8 || col === 9 ? tokens.blue : tokens.text;

  return (
    <Card style={styles.card}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={styles.toggle}>
        <Feather name="list" size={18} color={tokens.textMuted} />
        <Txt tone="strong" style={styles.title}>Hourly Forecast — 5 days</Txt>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={tokens.textMuted} />
      </Pressable>

      {open && (
        <ScrollView horizontal>
          <View style={{ width: TOTAL }}>
            <View style={[styles.row, styles.head, { borderBottomColor: tokens.cardBorder }]}>
              {HOURLY_COLUMNS.map((c, i) => (
                <Txt key={c} tone="muted" style={[styles.cell, styles.headText, { width: WIDTHS[i] }]}>{c}</Txt>
              ))}
            </View>
            {rows.map((r) =>
              r.kind === "day" ? (
                <View key={r.key} style={[styles.dayRow, { backgroundColor: tokens.stat }]}>
                  <Txt tone="strong" style={styles.dayText}>{r.label}</Txt>
                </View>
              ) : (
                <View key={r.key} style={[styles.row, { backgroundColor: r.isDay ? tokens.rowDay : tokens.rowNight }]}>
                  {r.cells.map((v, i) => (
                    <Txt key={i} style={[styles.cell, { width: WIDTHS[i], color: color(i) }, r.isNow && styles.now]}
                      numberOfLines={1}>{v}</Txt>
                  ))}
                </View>
              ),
            )}
          </View>
        </ScrollView>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, overflow: "hidden" },
  toggle: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16 },
  title: { flex: 1, fontSize: 15, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 8 },
  head: { borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { fontSize: 12, paddingHorizontal: 4 },
  headText: { fontWeight: "600", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.4 },
  now: { fontWeight: "800" },
  dayRow: { paddingVertical: 6, paddingHorizontal: 12 },
  dayText: { fontSize: 12, fontWeight: "700" },
});
