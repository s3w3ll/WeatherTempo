/**
 * pws-proxy.js — Cloudflare Worker
 *
 * Proxies the Weather Underground PWS "current observations" endpoint.
 * The API key (env.WEATHER_API) is stored as a Worker secret — it never
 * reaches the browser.
 *
 * Response shape mirrors Python's build_current() so the browser can
 * overlay the live values directly onto the conditions card.
 *
 * Deploy:
 *   cd workers
 *   npx wrangler secret put WEATHER_API   ← interactive, never on disk
 *   npx wrangler deploy
 */

const STATION_ID = "ICHRIS810";
const PWS_URL    = "https://api.weather.com/v2/pws/observations/current";

const LAT        = -43.5321;
const LON        =  172.6362;
const OPEN_METEO = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current_weather=true&wind_speed_unit=kmh`;

// WMO weather interpretation codes → human-readable phrase.
// Kept in sync with WMO_PHRASE in scripts/fetch_weather.py.
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

function degToCardinal(deg) {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE",
                "S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round((deg || 0) / 22.5) % 16];
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    };

    // Pre-flight
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });

    if (request.method !== "GET")
      return new Response("Method not allowed", { status: 405, headers: cors });

    // Build upstream URL — API key injected from secret, never from source
    const url = new URL(PWS_URL);
    url.searchParams.set("apiKey",    env.WEATHER_API);
    url.searchParams.set("stationId", STATION_ID);
    url.searchParams.set("format",    "json");
    url.searchParams.set("units",     "m");   // metric

    // Fire both fetches simultaneously — Open-Meteo failure degrades gracefully,
    // PWS failure still returns a 502 (it's the mandatory data source).
    const [pwsRes, omRes] = await Promise.allSettled([
      fetch(url.toString(), { headers: { Accept: "application/json" } }),
      fetch(OPEN_METEO),
    ]);

    // PWS is mandatory
    if (pwsRes.status === "rejected" || !pwsRes.value.ok) {
      const msg = pwsRes.reason?.message ?? `PWS upstream ${pwsRes.value?.status}`;
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 502, headers: { "Content-Type": "application/json", ...cors } }
      );
    }
    const pwsJson = await pwsRes.value.json();

    // Open-Meteo is optional — null condition keeps the weather.json value intact
    let condition = null;
    if (omRes.status === "fulfilled" && omRes.value.ok) {
      const omJson = await omRes.value.json();
      const code   = omJson.current_weather?.weathercode;
      condition = WMO_PHRASE[code] ?? null;
    }

    // Extract observation — mirrors Python build_current() feelsLike logic:
    //   use windChill when it is colder than air temp, otherwise heatIndex.
    const obs  = (pwsJson.observations || [{}])[0];
    const m    = obs.metric || {};
    const temp = m.temp     ?? null;
    const wc   = m.windChill  ?? null;
    const hi   = m.heatIndex  ?? null;
    const deg  = obs.winddir  || 0;

    const feelsLike = (wc !== null && temp !== null && wc < temp) ? wc : (hi ?? temp);

    return new Response(JSON.stringify({
      temp,
      feelsLike,
      humidity:      obs.humidity    ?? null,
      windSpeed:     m.windSpeed     ?? null,
      windGust:      m.windGust      ?? null,
      windDirection: deg,
      windCardinal:  degToCardinal(deg),
      pressure:      m.pressure      ?? null,
      uvIndex:       obs.uv          ?? null,
      condition,                                // WMO phrase from Open-Meteo, or null
      obsTimeUtc:    obs.obsTimeUtc  ?? null,   // when the station recorded this reading
      fetchedAt:     new Date().toISOString(),  // when the Worker ran (for debugging)
    }), {
      status: 200,
      headers: {
        "Content-Type":  "application/json",
        "Cache-Control": "no-store",   // never serve a stale reading from CF edge
        ...cors,
      },
    });
  },
};
