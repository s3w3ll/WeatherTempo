#!/usr/bin/env python3
"""
Fetches weather data from The Weather Company API (used by Weather Underground)
and saves a structured JSON payload to data/weather.json for the static frontend.

API endpoints used:
  /v3/wx/conditions/current   – current observations (includes sunrise/sunset)
  /v3/wx/forecast/hourly/5day – hourly forecast (temperature, wind, precip, etc.)
  /v3/wx/forecast/daily/5day  – daily forecast (moon phase, high/low)
"""

import os
import sys
import json
import requests
from datetime import datetime, timezone

# ── Config ────────────────────────────────────────────────────────────────────
API_KEY  = os.environ.get("WEATHER_API", "")
LAT, LON = -43.5321, 172.6362
UNITS    = "m"           # metric
LANG     = "en-US"
BASE     = "https://api.weather.com"

def api_get(path, extra=None):
    params = {"apiKey": API_KEY, "format": "json", "units": UNITS, "language": LANG}
    if extra:
        params.update(extra)
    r = requests.get(f"{BASE}{path}", params=params, timeout=15)
    r.raise_for_status()
    return r.json()

# ── Fetch ──────────────────────────────────────────────────────────────────────
def fetch_current():
    return api_get("/v3/wx/conditions/current", {"geocode": f"{LAT},{LON}"})

def fetch_hourly():
    return api_get("/v3/wx/forecast/hourly/5day", {"geocode": f"{LAT},{LON}"})

def fetch_daily():
    return api_get("/v3/wx/forecast/daily/5day", {"geocode": f"{LAT},{LON}"})

# ── Transform ─────────────────────────────────────────────────────────────────
def safe(arr, i, default=None):
    """Safely index into a list that may be None or short."""
    if arr and i < len(arr):
        return arr[i]
    return default

def zip_hourly(raw):
    n   = len(raw.get("validTimeUtc") or [])
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

# ── Main ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if not API_KEY:
        print("ERROR: WEATHER_API environment variable not set.", file=sys.stderr)
        sys.exit(1)

    print("Fetching weather data for Christchurch, NZ …")
    try:
        current = fetch_current()
        print("  ✓ Current conditions")
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

    payload = {
        "meta": {
            "updated": datetime.now(timezone.utc).isoformat(),
            "location": "Christchurch, New Zealand",
            "lat": LAT,
            "lon": LON,
        },
        "current": {
            "temp":                current.get("temperature"),
            "feelsLike":           current.get("temperatureFeelsLike"),
            "humidity":            current.get("relativeHumidity"),
            "pressure":            current.get("pressureMeanSeaLevel"),
            "dewPoint":            current.get("temperatureDewPoint"),
            "windSpeed":           current.get("windSpeed"),
            "windGust":            current.get("windGust"),
            "windDirection":       current.get("windDirection"),
            "windCardinal":        current.get("windDirectionCardinal"),
            "visibility":          current.get("visibility"),
            "uvIndex":             current.get("uvIndex"),
            "cloudPhrase":         current.get("cloudCoverPhrase"),
            "condition":           current.get("wxPhraseLong"),
            "iconCode":            current.get("iconCode"),
            "sunriseUtc":          current.get("sunriseTimeUtc"),
            "sunsetUtc":           current.get("sunsetTimeUtc"),
            "tempMax24h":          current.get("temperatureMax24Hour"),
            "tempMin24h":          current.get("temperatureMin24Hour"),
            "precip1h":            current.get("precip1Hour"),
            "precip24h":           current.get("precip24Hour"),
        },
        "today": {
            "moonPhase":    safe(daily.get("moonPhase"), 0),
            "moonPhaseCode":safe(daily.get("moonPhaseCode"), 0),
            "moonPhaseDay": safe(daily.get("moonPhaseDay"), 0),
        },
        "hourly": zip_hourly(hourly),
        "daily":  zip_daily(daily),
    }

    os.makedirs("data", exist_ok=True)
    with open("data/weather.json", "w") as f:
        json.dump(payload, f, separators=(",", ":"))

    kb = os.path.getsize("data/weather.json") / 1024
    print(f"  ✓ Saved data/weather.json ({kb:.1f} KB)")
