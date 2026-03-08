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

    let pwsJson;
    try {
      const r = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!r.ok) {
        return new Response(
          JSON.stringify({ error: `PWS upstream ${r.status}` }),
          { status: 502, headers: { "Content-Type": "application/json", ...cors } }
        );
      }
      pwsJson = await r.json();
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 502, headers: { "Content-Type": "application/json", ...cors } }
      );
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
