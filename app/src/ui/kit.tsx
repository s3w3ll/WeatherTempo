// The few primitives every card uses, themed from the settings tokens.
import React from "react";
import { StyleSheet, Text, View, type TextProps, type ViewProps } from "react-native";
import { useSettings } from "../settings";

export function Card({ style, ...rest }: ViewProps) {
  const { tokens } = useSettings();
  return (
    <View
      {...rest}
      style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.cardBorder }, style]}
    />
  );
}

type Tone = "text" | "strong" | "muted" | "fade";

export function Txt({ tone = "text", style, ...rest }: TextProps & { tone?: Tone }) {
  const { tokens } = useSettings();
  const color = { text: tokens.text, strong: tokens.textStrong, muted: tokens.textMuted, fade: tokens.textFade }[tone];
  return <Text {...rest} style={[{ color }, style]} />;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    shadowColor: "#142850",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
});
