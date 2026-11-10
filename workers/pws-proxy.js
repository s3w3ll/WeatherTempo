/**
 * pws-proxy.js — Cloudflare Worker
 *
 * Full-payload weather endpoint for WeatherTempo.
 * Accepts ?location=<id> and returns a JSON payload with the same shape as
 * the static data/weather.json produced by the old GitHub Actions pipeline.
 *
 * Christchurch: blends live PWS current obs (env.WEATHER_API secret) with
 *               Open-Meteo hourly/daily forecast.
 * All other NZ locations: Open-Meteo only (current approximated from hourly[0]).
 *
 * Deploy:
 *   cd workers
 *   npx wrangler secret put WEATHER_API   ← interactive, never on disk
 *   npx wrangler deploy
 */

// ── Location config (mirrors src/locations.js — Worker is a separate runtime) ──
const LOCATIONS = {
  "kaitaia":         { name: "Kaitaia",         lat: -35.1136, lon: 173.2655, pwsStation: null },
  "whangarei":       { name: "Whangārei",        lat: -35.7275, lon: 174.3236, pwsStation: null },
  "auckland":        { name: "Auckland",          lat: -36.8485, lon: 174.7633, pwsStation: null },
  "tauranga":        { name: "Tauranga",          lat: -37.6878, lon: 176.1651, pwsStation: null },
  "hamilton":        { name: "Hamilton",          lat: -37.7870, lon: 175.2793, pwsStation: null },
  "gisborne":        { name: "Gisborne",          lat: -38.6623, lon: 178.0176, pwsStation: null },
  "rotorua":         { name: "Rotorua",           lat: -38.1368, lon: 176.2497, pwsStation: null },
  "taupo":           { name: "Taupō",             lat: -38.6857, lon: 176.0702, pwsStation: null },
  "new-plymouth":    { name: "New Plymouth",      lat: -39.0556, lon: 174.0752, pwsStation: null },
  "napier":          { name: "Napier",            lat: -39.4928, lon: 176.9120, pwsStation: null },
  "palmerston-north":{ name: "Palmerston North",  lat: -40.3523, lon: 175.6082, pwsStation: null },
  "masterton":       { name: "Masterton",         lat: -40.9522, lon: 175.6583, pwsStation: null },
  "nelson":          { name: "Nelson",            lat: -41.2706, lon: 173.2840, pwsStation: null },
  "wellington":      { name: "Wellington",        lat: -41.2865, lon: 174.7762, pwsStation: null },
  "blenheim":        { name: "Blenheim",          lat: -41.5134, lon: 173.9612, pwsStation: null },
  "westport":        { name: "Westport",          lat: -41.7500, lon: 171.5997, pwsStation: null },
  "tekapo":          { name: "Tekapo",            lat: -44.0053, lon: 170.4775, pwsStation: null },
  "franz-josef":     { name: "Franz Josef",       lat: -43.3884, lon: 170.1815, pwsStation: null },
  "christchurch":    { name: "Christchurch",      lat: -43.5321, lon: 172.6362, pwsStation: "ICHRIS810" },
  "geraldine":       { name: "Geraldine",         lat: -44.0900, lon: 171.2356, pwsStation: null },
  "timaru":          { name: "Timaru",            lat: -44.3960, lon: 171.2553, pwsStation: null },
  "queenstown":      { name: "Queenstown",        lat: -45.0312, lon: 168.6626, pwsStation: null },
  "dunedin":         { name: "Dunedin",           lat: -45.8788, lon: 170.5028, pwsStation: null },
  "invercargill":    { name: "Invercargill",      lat: -46.4132, lon: 168.3538, pwsStation: null },
};

// ── WMO weather code → TWC icon code (day / night variants) ──────────────────
// Day codes: Clear=32, Mainly Clear=34, Partly Cloudy=30, Overcast=26
// Night codes: Clear=31, Mainly Clear=33, Partly Cloudy=27, Overcast=26
function wmoToIcon(code, isDay) {
  const d = !!isDay;
  if (code === 0)  return d ? 32 : 31;
  if (code === 1)  return d ? 34 : 33;
  if (code === 2)  return d ? 30 : 27;
  if (code === 3)  return 26;
  if (code === 45 || code === 48) return 20;   // fog
  if (code === 51) return 9;
  if (code === 53) return 9;
  if (code === 55) return 9;
  if (code === 61) return 11;
  if (code === 63) return 12;
  if (code === 65) return 12;
  if (code === 71 || code === 73 || code === 75 || code === 77) return 16; // snow
  if (code === 80) return d ? 45 : 45;  // showers
  if (code === 81 || code === 82) return d ? 45 : 45;
  if (code === 85 || code === 86) return 16;
  if (code === 95 || code === 96 || code === 99) return 4;  // thunderstorm
  return 26;
}

// ── WMO code → human phrase (kept in sync with fetch_weather.py) ─────────────
const WMO_PHRASE = {
  0: "Clear",           1: "Mainly Clear",    2: "Partly Cloudy",  3: "Overcast",
  45: "Fog",            48: "Icy Fog",
  51: "Light Drizzle",  53: "Drizzle",        55: "Heavy Drizzle",
  61: "Light Rain",     63: "Rain",           65: "Heavy Rain",
  71: "Light Snow",     73: "Snow",           75: "Heavy Snow",    77: "Snow Grains",
  80: "Showers",        81: "Showers",        82: "Heavy Showers",
  85: "Snow Showers",   86: "Heavy Snow Showers",
  95: "Thunderstorm",   96: "Thunderstorm",   99: "Thunderstorm",
};

// ── Moon phase via synodic period ─────────────────────────────────────────────
// Reference new moon: 2000-01-06 18:14 UTC (J2000.0 era)
const SYNODIC_MS  = 29.530588853 * 86_400_000;
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14, 0);

const PHASE_NAMES = [
  "New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
  "Full Moon", "Waning Gibbous", "Last Quarter",  "Waning Crescent",
];
const PHASE_CODES = ["NM","WXC","FQ","WXG","FM","WNG","LQ","WNC"];

function moonPhaseInfo(dateMs) {
  const age  = ((dateMs - NEW_MOON_MS) % SYNODIC_MS + SYNODIC_MS) % SYNODIC_MS;
  const day  = Math.floor(age / 86_400_000);           // 0–29
  const idx  = Math.round(age / SYNODIC_MS * 8) % 8;  // 0–7
  return { moonPhase: PHASE_NAMES[idx], moonPhaseCode: PHASE_CODES[idx], moonPhaseDay: day };
}

// ── Wind direction ────────────────────────────────────────────────────────────
function degToCardinal(deg) {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE",
                "S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round((deg || 0) / 22.5) % 16];
}

// ── Precipitation type from WMO code ─────────────────────────────────────────
function precipType(code) {
  if (code >= 71 && code <= 77) return "snow";
  if (code === 85 || code === 86) return "snow";
  return "rain";
}

// ── Build Open-Meteo URL ──────────────────────────────────────────────────────
function buildOMUrl(lat, lon) {
  return (
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,` +
      `wind_speed_10m,wind_direction_10m,wind_gusts_10m,` +
      `surface_pressure,uv_index,weather_code,cloud_cover,dew_point_2m` +
    `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,` +
      `wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,` +
      `precipitation_probability,precipitation,surface_pressure,` +
      `uv_index,weather_code,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
    `&wind_speed_unit=kmh&timeformat=unixtime` +
    `&timezone=Pacific%2FAuckland&forecast_days=5`
  );
}

// ── PWS observation freshness ─────────────────────────────────────────────────
/**
 * Decide whether a PWS observation is recent enough to prefer over the
 * Open-Meteo model output for "current conditions".
 *
 * A station can stay online and keep serving its LAST reading long after it has
 * stopped updating — a stuck 6-hour-old temperature looks live to the UI but is
 * worse than the forecast model. Returning false here routes current conditions
 * to Open-Meteo and surfaces pws:"stale" in meta.sourceStatus.
 *
 * @param {object} obs  observations[0] — has obs.obsTimeUtc (epoch SECONDS)
 *                      and obs.obsTimeLocal (ISO-ish local string)
 * @param {number} now  Date.now() in milliseconds
 * @returns {boolean}   true → trust the PWS reading, false → fall back
 */
function isPwsObservationFresh(obs, now) {
  // TODO(you): implement the staleness policy for ICHRIS810.
  // Current behaviour trusts any observation the station returns.
  return true;
}

// ── MetService warnings (CAP feed) ────────────────────────────────────────────
// MetService publishes current watches and warnings as CAP 1.2 alerts, listed
// in an RSS index (CC BY 4.0, so the page credits MetService). Browsers can't
// read it directly (no CORS headers), hence this route. Same rules as the iOS
// app's WarningClient / CAPParser: keep live public alerts whose polygon
// contains the place, most severe first.
const CAP_RSS = "https://alerts.metservice.com/cap/rss";

// How long Cloudflare's edge may reuse the RSS index. A published CAP alert
// never changes (an update gets a new identifier), so those cache for a day.
const CAP_RSS_TTL   = 120;
const CAP_ALERT_TTL = 86400;

function xmlText(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Text of the first <tag> (first <info> block when an alert has several languages). */
function capField(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? xmlText(m[1]) : null;
}

function capAll(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map(m => xmlText(m[1]));
}

/** Alert document URLs from the RSS index, in feed order. */
function capLinks(rss) {
  return (rss.match(/<item\b[\s\S]*?<\/item>/g) || [])
    .map(item => capField(item, "link"))
    .filter(Boolean);
}

/** "lat,lon lat,lon …" → [[lat, lon], …] */
function capPolygon(text) {
  return text.split(/\s+/).map(pair => pair.split(",").map(Number))
    .filter(p => p.length === 2 && p.every(Number.isFinite));
}

/** Ray casting. NZ is clear of the antimeridian except the Chathams, which have their own areas. */
function polygonContains(poly, lat, lon) {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [aLat, aLon] = poly[i], [bLat, bLon] = poly[j];
    if ((aLat > lat) !== (bLat > lat) &&
        lon < (bLon - aLon) * (lat - aLat) / (bLat - aLat) + aLon) inside = !inside;
  }
  return inside;
}

const toUnix = iso => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? Math.round(t / 1000) : null; };

/**
 * One CAP alert, or null for anything that isn't a live public alert (tests,
 * exercises, cancellations) or is missing what the page needs.
 */
function parseCap(xml) {
  xml = xml.replace(/<(\w+:)?Signature\b[\s\S]*?<\/(\w+:)?Signature>/g, "");
  const id = capField(xml, "identifier");
  const status = capField(xml, "status");
  if (!id || (status && status !== "Actual") || capField(xml, "msgType") === "Cancel") return null;

  const params = {};
  for (const p of xml.match(/<parameter\b[\s\S]*?<\/parameter>/g) || []) {
    const name = capField(p, "valueName");
    if (name && !(name in params)) params[name] = capField(p, "value");
  }
  const colour   = (params.ColourCode || "").toLowerCase();
  const severity = (capField(xml, "severity") || "").toLowerCase();
  const level = ["red", "orange", "yellow"].includes(colour) ? colour
    : severity === "extreme" ? "red" : severity === "severe" ? "orange" : "yellow";

  const web = capField(xml, "web");
  return {
    id,
    headline: capField(xml, "headline") || capField(xml, "event") || "Weather warning",
    event:    capField(xml, "event") || "",
    level,
    onset:    toUnix(capField(xml, "onset") || capField(xml, "effective")),
    expires:  toUnix(capField(xml, "expires")),
    areaDescription: capAll(xml, "areaDesc").join(", ").replace(/,(?=\S)/g, ", "),
    details:     capField(xml, "description") || "",
    instruction: capField(xml, "instruction"),
    web: web && /^https:\/\//.test(web) ? web : null,
    polygons: capAll(xml, "polygon").map(capPolygon).filter(p => p.length >= 3),
  };
}

const LEVEL_RANK = { yellow: 0, orange: 1, red: 2 };

/**
 * GET /warnings?location=<id> → { warnings, complete, source, updated }.
 * `complete` is false when some alert in the feed couldn't be read, so a
 * warning missing from the list may only have failed to download.
 */
async function handleWarnings(loc, cors) {
  const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", ...cors, ...extra },
  });

  let links;
  try {
    const res = await fetch(CAP_RSS, { cf: { cacheTtl: CAP_RSS_TTL, cacheEverything: true } });
    if (!res.ok) return json({ error: `MetService feed HTTP ${res.status}` }, 502);
    links = capLinks(await res.text());
  } catch (err) {
    return json({ error: `MetService feed unreachable: ${err.message}` }, 502);
  }

  const docs = await Promise.allSettled(links.map(url =>
    fetch(url, { cf: { cacheTtl: CAP_ALERT_TTL, cacheEverything: true } })
      .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))));

  const nowSec = Date.now() / 1000;
  let complete = true;
  const warnings = [];
  for (const d of docs) {
    if (d.status !== "fulfilled") { complete = false; continue; }
    const w = parseCap(d.value);
    if (!w) continue;
    if (w.expires && w.expires <= nowSec) continue;
    if (!w.polygons.some(p => polygonContains(p, loc.lat, loc.lon))) continue;
    const { polygons, ...rest } = w;   // the page only needs the text and times
    warnings.push(rest);
  }
  warnings.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || (a.onset || 0) - (b.onset || 0));

  return json(
    { warnings, complete, source: "MetService", updated: new Date().toISOString() },
    200, { "Cache-Control": "public, max-age=60" });
}

// ── Worker entry ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    };

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });

    if (request.method !== "GET")
      return new Response("Method not allowed", { status: 405, headers: cors });

    const reqUrl     = new URL(request.url);
    const locationId = reqUrl.searchParams.get("location") || "christchurch";
    const loc        = LOCATIONS[locationId];

    if (!loc) {
      return new Response(
        JSON.stringify({ error: `Unknown location: ${locationId}` }),
        { status: 404, headers: { "Content-Type": "application/json", ...cors } }
      );
    }

    if (reqUrl.pathname === "/warnings") return handleWarnings(loc, cors);

    // ── Fetch Open-Meteo (always) + PWS (CHC only) ────────────────────────
    const fetchPromises = [fetch(buildOMUrl(loc.lat, loc.lon))];
    let pwsFetchIndex = -1;

    if (loc.pwsStation) {
      const pwsUrl = new URL("https://api.weather.com/v2/pws/observations/current");
      pwsUrl.searchParams.set("apiKey",    env.WEATHER_API);
      pwsUrl.searchParams.set("stationId", loc.pwsStation);
      pwsUrl.searchParams.set("format",    "json");
      pwsUrl.searchParams.set("units",     "m");
      fetchPromises.push(fetch(pwsUrl.toString(), { headers: { Accept: "application/json" } }));
      pwsFetchIndex = 1;
    }

    const results = await Promise.allSettled(fetchPromises);
    const omResult  = results[0];
    const pwsResult = pwsFetchIndex >= 0 ? results[pwsFetchIndex] : null;

    // Open-Meteo is mandatory
    if (omResult.status === "rejected" || !omResult.value.ok) {
      const msg = omResult.reason?.message ?? `Open-Meteo upstream ${omResult.value?.status}`;
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 502, headers: { "Content-Type": "application/json", ...cors } }
      );
    }
    const om = await omResult.value.json();

    const now = Date.now();

    // PWS optional even for CHC — gracefully degrade if station down.
    //
    // weather.com answers 204 No Content (empty body) when the station has no
    // current observation. 204 satisfies Response.ok, so .json() must never be
    // called blind here: JSON.parse("") throws and takes the whole Worker down,
    // defeating the fallback this block exists to provide. Read as text, decide
    // to parse.
    let pws       = null;
    let pwsStatus = loc.pwsStation ? "unreachable" : "n/a";

    if (pwsResult?.status === "fulfilled") {
      const res = pwsResult.value;
      if (!res.ok) {
        pwsStatus = `http-${res.status}`;
      } else {
        const body = (await res.text()).trim();
        if (!body) {
          pwsStatus = "no-observation";              // 204 / empty payload
        } else {
          try {
            const parsed = JSON.parse(body);
            const obs0   = parsed?.observations?.[0];
            if (!obs0) {
              pwsStatus = "no-observation";
            } else if (!isPwsObservationFresh(obs0, now)) {
              pwsStatus = "stale";
            } else {
              pws       = parsed;
              pwsStatus = "ok";
            }
          } catch (_) {
            pwsStatus = "bad-json";
          }
        }
      }
    }

    // ── Build current conditions ──────────────────────────────────────────
    const omCur   = om.current || {};
    const omDaily = om.daily   || {};
    const omHrly  = om.hourly  || {};

    // PWS obs (CHC only)
    const obs = (pws?.observations || [{}])[0];
    const m   = obs.metric || {};

    // Temperature from PWS if available, else Open-Meteo current
    const temp      = pws ? (m.temp       ?? omCur.temperature_2m)          : omCur.temperature_2m;
    const wc        = pws ? (m.windChill  ?? null)                           : null;
    const hi        = pws ? (m.heatIndex  ?? null)                           : null;
    const feelsLike = pws
      ? ((wc !== null && temp !== null && wc < temp) ? wc : (hi ?? omCur.apparent_temperature))
      : omCur.apparent_temperature;
    const humidity    = pws ? (obs.humidity    ?? omCur.relative_humidity_2m) : omCur.relative_humidity_2m;
    const pressure    = pws ? (m.pressure      ?? omCur.surface_pressure)     : omCur.surface_pressure;
    const windSpeed   = pws ? (m.windSpeed     ?? omCur.wind_speed_10m)       : omCur.wind_speed_10m;
    const windGust    = pws ? (m.windGust      ?? omCur.wind_gusts_10m)       : omCur.wind_gusts_10m;
    const windDir     = pws ? (obs.winddir     ?? omCur.wind_direction_10m)   : omCur.wind_direction_10m;
    const uvIndex     = pws ? (obs.uv          ?? omCur.uv_index)             : omCur.uv_index;
    const dewPoint    = pws ? (m.dewpt         ?? omCur.dew_point_2m)         : omCur.dew_point_2m;
    const solarRad    = pws ? (obs.solarRadiation ?? null)                    : null;
    const wmoCode     = omCur.weather_code ?? 0;
    const condition   = WMO_PHRASE[wmoCode] ?? "Unknown";

    // Sunrise/sunset from daily[0]
    const sunriseUtc  = (omDaily.sunrise  || [])[0] ?? null;
    const sunsetUtc   = (omDaily.sunset   || [])[0] ?? null;

    // tempMax24h / tempMin24h from daily[0]
    const tempMax24h  = (omDaily.temperature_2m_max || [])[0] ?? null;
    const tempMin24h  = (omDaily.temperature_2m_min || [])[0] ?? null;

    // Determine current day/night for iconCode
    const isDay = sunriseUtc && sunsetUtc
      ? (now / 1000 >= sunriseUtc && now / 1000 < sunsetUtc)
      : true;

    const current = {
      temp:          temp      !== undefined ? +temp.toFixed(1)      : null,
      feelsLike:     feelsLike !== undefined ? +feelsLike.toFixed(1) : null,
      humidity:      humidity  !== undefined ? Math.round(humidity)  : null,
      pressure:      pressure  !== undefined ? +pressure.toFixed(2)  : null,
      windSpeed:     windSpeed !== undefined ? +windSpeed.toFixed(1) : null,
      windGust:      windGust  !== undefined ? +windGust.toFixed(1)  : null,
      windDirection: windDir   !== undefined ? Math.round(windDir)   : null,
      windCardinal:  degToCardinal(windDir),
      uvIndex:       uvIndex   !== undefined ? +uvIndex.toFixed(1)   : null,
      dewPoint:      dewPoint  !== undefined ? +dewPoint.toFixed(1)  : null,
      solarRad:      solarRad,
      condition,
      cloudPhrase:   condition,
      iconCode:      wmoToIcon(wmoCode, isDay),
      sunriseUtc,
      sunsetUtc,
      tempMax24h:    tempMax24h !== undefined ? +tempMax24h.toFixed(1) : null,
      tempMin24h:    tempMin24h !== undefined ? +tempMin24h.toFixed(1) : null,
    };

    // ── Build hourly array (up to 120 entries = 5 days) ───────────────────
    const hrTimes  = omHrly.time                      || [];
    const hrTemps  = omHrly.temperature_2m            || [];
    const hrFeels  = omHrly.apparent_temperature      || [];
    const hrHumid  = omHrly.relative_humidity_2m      || [];
    const hrWspd   = omHrly.wind_speed_10m            || [];
    const hrWdir   = omHrly.wind_direction_10m        || [];
    const hrGust   = omHrly.wind_gusts_10m            || [];
    const hrCloud  = omHrly.cloud_cover               || [];
    const hrPrecP  = omHrly.precipitation_probability || [];
    const hrQpf    = omHrly.precipitation             || [];
    const hrPres   = omHrly.surface_pressure          || [];
    const hrUv     = omHrly.uv_index                  || [];
    const hrWmo    = omHrly.weather_code              || [];
    const hrIsDay  = omHrly.is_day                    || [];

    const hourly = hrTimes.slice(0, 120).map((t, i) => {
      const code = hrWmo[i] ?? 0;
      const wd   = hrWdir[i] ?? 0;
      const id   = hrIsDay[i] ?? 1;
      return {
        validTimeUtc:          t,
        temperature:           hrTemps[i] !== undefined  ? +hrTemps[i].toFixed(1)  : null,
        temperatureFeelsLike:  hrFeels[i] !== undefined  ? +hrFeels[i].toFixed(1)  : null,
        relativeHumidity:      hrHumid[i] !== undefined  ? Math.round(hrHumid[i])  : null,
        windSpeed:             hrWspd[i]  !== undefined  ? +hrWspd[i].toFixed(1)   : null,
        windDirection:         wd !== undefined           ? Math.round(wd)          : null,
        windDirectionCardinal: degToCardinal(wd),
        windGust:              hrGust[i]  !== undefined  ? +hrGust[i].toFixed(1)   : null,
        cloudCover:            hrCloud[i] !== undefined  ? Math.round(hrCloud[i])  : null,
        qpf:                   hrQpf[i]   !== undefined  ? +hrQpf[i].toFixed(2)    : null,
        precipChance:          hrPrecP[i] !== undefined  ? Math.round(hrPrecP[i])  : null,
        precipType:            precipType(code),
        pressureMeanSeaLevel:  hrPres[i]  !== undefined  ? +hrPres[i].toFixed(1)   : null,
        uvIndex:               hrUv[i]    !== undefined  ? +hrUv[i].toFixed(2)     : null,
        iconCode:              wmoToIcon(code, id),
        dayOrNight:            id ? "D" : "N",
        wxPhraseMedium:        WMO_PHRASE[code] ?? "Unknown",
      };
    });

    // ── Build daily array ─────────────────────────────────────────────────
    const dlTmax    = omDaily.temperature_2m_max || [];
    const dlTmin    = omDaily.temperature_2m_min || [];
    const dlSunrise = omDaily.sunrise            || [];
    const dlSunset  = omDaily.sunset             || [];

    const daily = dlTmax.map((_, i) => ({
      calendarDayTemperatureMax: dlTmax[i] !== undefined ? +dlTmax[i].toFixed(1) : null,
      calendarDayTemperatureMin: dlTmin[i] !== undefined ? +dlTmin[i].toFixed(1) : null,
      temperatureMax:            dlTmax[i] !== undefined ? +dlTmax[i].toFixed(1) : null,
      temperatureMin:            dlTmin[i] !== undefined ? +dlTmin[i].toFixed(1) : null,
      sunriseTimeUtc:            dlSunrise[i] ?? null,
      sunsetTimeUtc:             dlSunset[i]  ?? null,
    }));

    // ── Moon phase ────────────────────────────────────────────────────────
    const today = moonPhaseInfo(now);

    // ── Assemble final payload ────────────────────────────────────────────
    const payload = {
      meta: {
        updated: new Date().toISOString(),
        location: `${loc.name}, New Zealand`,
        lat:      loc.lat,
        lon:      loc.lon,
        sourceStatus: {
          openMeteo:     "ok",
          pws:           pwsStatus,
          currentSource: pws ? "pws" : "open-meteo",
        },
      },
      current,
      today,
      hourly,
      daily,
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type":  "application/json",
        "Cache-Control": "no-store",
        ...cors,
      },
    });
  },
};
