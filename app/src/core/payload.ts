// The Cloudflare Worker's response (GET <worker>/?location=<id>). Fields are
// optional because the Worker passes through whatever Open-Meteo and the PWS
// station supplied; the UI must cope with any of them missing.
import type { Hour, WarningLevel } from "./types";

export interface HourlyHour extends Hour {
  temperatureFeelsLike?: number | null;
  relativeHumidity?: number | null;
  windSpeed?: number | null;
  windDirection?: number | null;
  windDirectionCardinal?: string | null;
  precipType?: string | null;
  wxPhraseMedium?: string | null;
}

export interface DailyDay {
  calendarDayTemperatureMax?: number | null;
  calendarDayTemperatureMin?: number | null;
  temperatureMax?: number | null;
  temperatureMin?: number | null;
  sunriseTimeUtc?: number | null;
  sunsetTimeUtc?: number | null;
}

export interface Current {
  temp?: number | null;
  feelsLike?: number | null;
  humidity?: number | null;
  pressure?: number | null;
  windSpeed?: number | null;
  windGust?: number | null;
  windDirection?: number | null;
  windCardinal?: string | null;
  uvIndex?: number | null;
  dewPoint?: number | null;
  solarRad?: number | null;
  observedUtc?: number | null;
  condition?: string | null;
  cloudPhrase?: string | null;
  iconCode?: number | null;
  sunriseUtc?: number | null;
  sunsetUtc?: number | null;
  tempMax24h?: number | null;
  tempMin24h?: number | null;
}

export interface Meta {
  updated?: string;
  builtAt?: string;
  location?: string;
  lat?: number;
  lon?: number;
  sourceStatus?: { openMeteo?: string; pws?: string; currentSource?: string };
}

export interface WeatherPayload {
  meta?: Meta;
  current: Current;
  today?: { moonPhase?: string; moonPhaseCode?: string; moonPhaseDay?: number };
  hourly: HourlyHour[];
  daily: DailyDay[];
}

/** A MetService CAP warning as the Worker's /warnings route returns it. */
export interface WarningItem {
  id: string;
  level: WarningLevel;
  headline: string;
  /** MetService hazard type, e.g. "Heavy Rain". */
  event?: string;
  onset?: number | null;
  expires?: number | null;
  areaDescription?: string;
  details?: string;
  instruction?: string;
  web?: string;
}
