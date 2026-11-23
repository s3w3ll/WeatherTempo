// Shared types for the pure-logic core. No React, no DOM: everything in
// src/core runs unchanged on iOS (Hermes), web and Node (Jest).

export interface Location {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  timezone: string;
  /** null = Open-Meteo only; string = Weather Underground PWS station id. */
  pwsStation: string | null;
  /** null = inland (no tides panel); otherwise a key of TIDE_PORTS. */
  tidePort: string | null;
  tideLabel: string | null;
}

/** [name, speed °/h, amplitude m, Greenwich phase °, V0 at J2000 °] */
export type TideConstituent = readonly [string, number, number, number, number];

export interface TidePort {
  /** Mean level above chart datum, metres. */
  Z0: number;
  constituents: readonly TideConstituent[];
}

export interface TideEvent {
  type: "high" | "low";
  time: Date;
  /** Metres above chart datum, 2 d.p. */
  height: number;
}

export interface TideSample {
  time: Date;
  height: number;
}

/** One hourly forecast object as the Worker returns it. */
export interface Hour {
  validTimeUtc: number;
  temperature?: number | null;
  cloudCover?: number | null;
  pressureMeanSeaLevel?: number | null;
  precipChance?: number | null;
  qpf?: number | null;
  uvIndex?: number | null;
  windGust?: number | null;
  iconCode?: number | null;
  dayOrNight?: "D" | "N" | string | null;
}

export type WarningLevel = "yellow" | "orange" | "red";

export interface WarningTimes {
  /** UTC seconds; either may be null. */
  onset?: number | null;
  expires?: number | null;
}

export interface Warning extends WarningTimes {
  headline: string;
  level: WarningLevel;
}

export type SkyPhase = "day" | "twilight" | "night";
export interface SkyStop {
  t: number;
  phase: SkyPhase;
}
