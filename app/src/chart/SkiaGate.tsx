/**
 * Loads a Skia-using component safely on every platform. On iOS it renders
 * directly. On web, Skia needs CanvasKit (a WASM download) before any Skia
 * module is evaluated, so the component is imported lazily behind
 * <WithSkiaWeb>. Callers pass both loaders so Skia is never imported at the
 * top level of a module that web evaluates early.
 */
import React from "react";
import { ActivityIndicator, Platform, View } from "react-native";

export function SkiaGate<P extends object>({ web, native, props, height = 120 }: {
  /** `() => import("./Thing")`: used on web, after CanvasKit loads. */
  web: () => Promise<{ default: React.ComponentType<P> }>;
  /** `() => require("./Thing").default`: used on iOS. */
  native: () => React.ComponentType<P>;
  props: P;
  /** Placeholder height while CanvasKit loads. */
  height?: number;
}) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WithSkiaWeb } = require("@shopify/react-native-skia/lib/module/web");
    return (
      <WithSkiaWeb
        getComponent={web}
        componentProps={props}
        fallback={<View style={{ height, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>}
        opts={{ locateFile: (file: string) => `/${file}` }}
      />
    );
  }
  const Inner = native();
  return <Inner {...props} />;
}
