import React from "react";
import type { MeteogramProps } from "./MeteogramInner";
import { SkiaGate } from "./SkiaGate";

/** The Skia chart, gated per platform (see SkiaGate). */
export function Meteogram(props: MeteogramProps) {
  return (
    <SkiaGate<MeteogramProps>
      web={() => import("./MeteogramInner")}
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      native={() => require("./MeteogramInner").default}
      props={props}
      height={380}
    />
  );
}
