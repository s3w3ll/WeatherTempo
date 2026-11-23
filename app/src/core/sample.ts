// Synthetic payload shown only when every real source fails. Temperatures are
// 101° on purpose, so nobody mistakes it for a forecast.
import type { DailyDay, HourlyHour, WeatherPayload } from "./payload";
import type { Location } from "./types";

export function generateSampleData(loc: Pick<Location, "name" | "lat" | "lon" | "timezone">, nowMs: number): WeatherPayload {
  const tz = loc.timezone;
  const baseMs = Math.floor(nowMs / 3_600_000) * 3_600_000;
  const hours: HourlyHour[] = [];

  for (let i = 0; i < 120; i++) {
    const ts = Math.round((baseMs + i * 3_600_000) / 1000);
    const lh = (Number(new Date(ts * 1000).toLocaleString("en-NZ", { timeZone: tz, hour: "numeric", hour12: false })) + 24) % 24;
    const cc = Math.max(0, Math.min(90, Math.round(35 + 30 * Math.sin(i * 0.12 + 1.5))));
    const pp = Math.max(0, Math.min(80, Math.round(20 + 25 * Math.sin(i * 0.1 + 2))));
    const qpf = pp > 45 ? +(0.4 * Math.sin(i * 0.1 + 2)).toFixed(2) : 0;
    hours.push({
      validTimeUtc: ts,
      temperature: 101,
      temperatureFeelsLike: 101,
      relativeHumidity: Math.max(40, Math.min(90, Math.round(65 - 10 * Math.cos((2 * Math.PI * (lh - 14)) / 24)))),
      windSpeed: Math.round(13 + 5 * Math.sin(i * 0.2)),
      windDirection: Math.round(240 + 20 * Math.sin(i * 0.15)),
      windDirectionCardinal: "WSW",
      windGust: Math.round(16 + 5 * Math.abs(Math.sin(i * 0.2))),
      cloudCover: cc,
      qpf,
      precipChance: pp,
      precipType: "rain",
      pressureMeanSeaLevel: +(1013 + 4 * Math.sin(i * 0.03)).toFixed(1),
      uvIndex: lh >= 7 && lh <= 18 ? Math.max(0, Math.round(7 * Math.sin((Math.PI * (lh - 6)) / 12))) : 0,
      iconCode: cc < 30 ? 32 : cc < 60 ? 30 : 26,
      dayOrNight: lh >= 7 && lh < 19 ? "D" : "N",
      wxPhraseMedium: cc < 25 ? "Sunny" : cc < 60 ? "Partly Cloudy" : "Mostly Cloudy",
    });
  }

  const nowTs = Math.round(nowMs / 1000);
  const daily: DailyDay[] = Array.from({ length: 5 }, (_, d) => ({
    calendarDayTemperatureMax: 101,
    calendarDayTemperatureMin: 101,
    temperatureMax: 101,
    temperatureMin: 101,
    sunriseTimeUtc: nowTs + d * 86400 - 3 * 3600,
    sunsetTimeUtc: nowTs + d * 86400 + 6 * 3600,
  }));

  const h0 = hours[0];
  return {
    meta: { updated: new Date(nowMs).toISOString(), location: `${loc.name}, New Zealand (sample)`, lat: loc.lat, lon: loc.lon },
    current: {
      temp: 101, feelsLike: 101,
      humidity: h0.relativeHumidity, pressure: h0.pressureMeanSeaLevel,
      windSpeed: h0.windSpeed, windGust: h0.windGust,
      windDirection: h0.windDirection, windCardinal: "WSW",
      uvIndex: h0.uvIndex, cloudPhrase: h0.wxPhraseMedium, condition: h0.wxPhraseMedium,
      iconCode: h0.iconCode,
      sunriseUtc: nowTs - 3 * 3600, sunsetUtc: nowTs + 6 * 3600,
      tempMax24h: 101, tempMin24h: 101,
    },
    today: { moonPhase: "Waxing Crescent", moonPhaseCode: "WXC", moonPhaseDay: 5 },
    hourly: hours,
    daily,
  };
}
