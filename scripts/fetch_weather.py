#!/usr/bin/env python3
"""
Fetches weather data from The Weather Company / Weather Underground APIs.

Endpoints used:
  /v2/pws/observations/current  – live reading from a Personal Weather Station
                                  (works with standard PWS API keys)
  /v3/wx/forecast/hourly/5day   – 120-hour forecast (chart data)
  /v3/wx/forecast/daily/5day    – daily forecast (high/low, moon, sunrise/sunset)

Note: /v3/wx/conditions/current with geocode requires a higher-tier TWC key
and is intentionally NOT used here.
"""

import os
import sys
import json
import requests
from datetime import datetime, timezone

API_KEY    = os.environ.get("WEATHER_API", "")
STATION_ID = "ICHRIS810"          # Wunderground PWS station ID for current obs
LAT, LON   = -43.5321, 172.6362  # Geocode used for forecast endpoints only
UNITS      = "m"                  # metric
LANG       = "en-US"
BASE       = "https://api.weather.com"

def api_get(path, extra=None):
    params = {"apiKey": API_KEY, "format": "json"}
    if extra:
        params.update(extra)
    r = requests.get(f"{BASE}{path}", params=params, timeout=15)
    r.raise_for_status()
    return r.json()

# ── Fetch ──────────────────────────────────────────────────────────────────────
def fetch_current():
    """Live observation from the PWS station — works with standard PWS API keys."""
    return api_get("/v2/pws/observations/current", {
        "stationId": STATION_ID,
        "units":     UNITS,
    })

def fetch_hourly():
    return api_get("/v3/wx/forecast/hourly/5day", {
        "geocode": f"{LAT},{LON}", "units": UNITS, "language": LANG,
    })

def fetch_daily():
    return api_get("/v3/wx/forecast/daily/5day", {
        "geocode": f"{LAT},{LON}", "units": UNITS, "language": LANG,
    })

# ── Transform ─────────────────────────────────────────────────────────────────
def safe(arr, i, default=None):
    """Safely index into a list that may be None or short."""
    if arr and i < len(arr):
        return arr[i]
    return default

def deg_to_cardinal(deg):
    dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]
    return dirs[round((deg or 0) / 22.5) % 16]

def zip_hourly(raw):
    n    = len(raw.get("validTimeUtc") or [])
    keys = [
        "validTimeUtc", "temperature", "temperatureFeelsLike",
        "relativeHumidity", "windSpeed", "windDirection",
        "windDirectionCardinal", "windGust", "cloudCover",
        "qpf", "precipChance", "precipType",
        "pressureMeanSeaLevel", "uvIndex", "iconCode",
        "dayOrNight", "wxPhraseMedium",
    ]
    return [{k: safe(raw.get(k), i) for k in keys} for i in range(n)]

def zip_daily(raw):
    n    = len(raw.get("validTimeUtc") or [])
    keys = [
        "validTimeUtc", "dayOfWeek", "narrative",
        "calendarDayTemperatureMax", "calendarDayTemperatureMin",
        "temperatureMax", "temperatureMin",
        "sunriseTimeUtc", "sunsetTimeUtc",
        "moonPhase", "moonPhaseCode", "moonPhaseDay",
        "moonriseTimeUtc", "moonsetTimeUtc",
        "qpf", "qpfSnow",
    ]
    days = [{k: safe(raw.get(k), i) for k in keys} for i in range(n)]

    # Flatten first daypart (daytime) precip chance per day
    dp = (raw.get("daypart") or [{}])[0]
    for i, day in enumerate(days):
        day["precipChanceDay"] = safe(dp.get("precipChance"), i * 2)
        day["conditionDay"]    = safe(dp.get("wxPhraseMedium"), i * 2)
    return days

def build_current(pws_raw, daily_days, first_hourly=None):
    """
    Map a PWS /v2/pws/observations/current response to the current conditions
    object expected by app.js.

    PWS metric fields are nested under observations[0].metric; UV and wind
    direction are at the observation root level. Sunrise/sunset and condition
    text are borrowed from the daily/hourly forecast since PWS doesn't supply them.
    """
    obs = (pws_raw.get("observations") or [{}])[0]
    m   = obs.get("metric") or {}

    temp       = m.get("temp")
    wind_chill = m.get("windChill")   # populated when cold
    heat_index = m.get("heatIndex")   # populated when hot (often equals temp)

    # Feels like: wind chill when it's dragging temp down, heat index otherwise
    if wind_chill is not None and temp is not None and wind_chill < temp:
        feels_like = wind_chill
    else:
        feels_like = heat_index if heat_index is not None else temp

    deg = obs.get("winddir") or 0

    # Condition text and icon aren't provided by PWS — use the first hourly slot
    condition = (first_hourly or {}).get("wxPhraseMedium") or ""

    # Sunrise/sunset come from the daily forecast, not the PWS station
    d0 = daily_days[0] if daily_days else {}

    return {
        "temp":        temp,
        "feelsLike":   feels_like,
        "humidity":    obs.get("humidity"),
        "pressure":    m.get("pressure"),
        "windSpeed":   m.get("windSpeed"),
        "windGust":    m.get("windGust"),
        "windDirection": deg,
        "windCardinal":  deg_to_cardinal(deg),
        "uvIndex":     obs.get("uv"),
        "solarRad":    obs.get("solarRadiation"),
        "dewPoint":    m.get("dewpt"),
        "condition":   condition,
        "cloudPhrase": condition,
        "iconCode":    (first_hourly or {}).get("iconCode"),
        # Sunrise/sunset from today's daily entry
        "sunriseUtc":  d0.get("sunriseTimeUtc"),
        "sunsetUtc":   d0.get("sunsetTimeUtc"),
        # Whole-day extremes as a fallback for high/low card display
        "tempMax24h":  d0.get("calendarDayTemperatureMax"),
        "tempMin24h":  d0.get("calendarDayTemperatureMin"),
    }

# ── Main ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if not API_KEY:
        print("ERROR: WEATHER_API environment variable not set.", file=sys.stderr)
        sys.exit(1)

    print("Fetching weather data for Christchurch, NZ …")

    try:
        pws = fetch_current()
        sid = (pws.get("observations") or [{}])[0].get("stationID", STATION_ID)
        print(f"  ✓ Current conditions (PWS: {sid})")
    except Exception as e:
        print(f"  ✗ Current conditions failed: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        hourly = fetch_hourly()
        n_hours = len(hourly.get("validTimeUtc") or [])
        print(f"  ✓ Hourly forecast ({n_hours} hours)")
    except Exception as e:
        print(f"  ✗ Hourly forecast failed: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        daily = fetch_daily()
        n_days = len(daily.get("validTimeUtc") or [])
        print(f"  ✓ Daily forecast ({n_days} days)")
    except Exception as e:
        print(f"  ✗ Daily forecast failed: {e}", file=sys.stderr)
        sys.exit(1)

    hourly_list = zip_hourly(hourly)
    daily_list  = zip_daily(daily)

    payload = {
        "meta": {
            "updated": datetime.now(timezone.utc).isoformat(),
            "location": "Christchurch, New Zealand",
            "lat": LAT,
            "lon": LON,
        },
        "current": build_current(pws, daily_list, first_hourly=hourly_list[0] if hourly_list else None),
        "today": {
            "moonPhase":     safe(daily.get("moonPhase"), 0),
            "moonPhaseCode": safe(daily.get("moonPhaseCode"), 0),
            "moonPhaseDay":  safe(daily.get("moonPhaseDay"), 0),
        },
        "hourly": hourly_list,
        "daily":  daily_list,
    }

    os.makedirs("data", exist_ok=True)
    with open("data/weather.json", "w") as f:
        json.dump(payload, f, separators=(",", ":"))

    kb = os.path.getsize("data/weather.json") / 1024
    print(f"  ✓ Saved data/weather.json ({kb:.1f} KB)")
