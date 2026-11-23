/**
 * Platform gate for the Skia chart. On iOS it renders directly. On web, Skia
 * needs CanvasKit (a WASM download) before any Skia component loads, so the
 * chart module is imported lazily behind <WithSkiaWeb>. Nothing here imports
 * Skia at the top level for that reason.
 */
import React from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import type { MeteogramProps } from "./MeteogramInner";

function Loading() {
  return <View style={{ height: 380, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>;
}

export function Meteogram(props: MeteogramProps) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WithSkiaWeb } = require("@shopify/react-native-skia/lib/module/web");
    return (
      <WithSkiaWeb
        getComponent={() => import("./MeteogramInner")}
        componentProps={props}
        fallback={<Loading />}
        opts={{ locateFile: (file: string) => `/${file}` }}
      />
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Inner = require("./MeteogramInner").default as React.ComponentType<MeteogramProps>;
  return <Inner {...props} />;
}
