#!/usr/bin/env python3
"""
Hybrid weather data fetcher:

  CURRENT CONDITIONS  → Weather Underground PWS /v2/pws/observations/current
                        (live readings from your personal weather station)
                        Requires: WEATHER_API env var

  HOURLY + DAILY FORECAST → Open-Meteo api.open-meteo.com/v1/forecast
                             (ECMWF model, 5-day hourly, no API key needed)

  MOON PHASE          → Computed from synodic period (J2000.0 reference)
"""

import os
import sys
import json
import requests
from datetime import datetime, timezone

# ── Config ────────────────────────────────────────────────────────────────────
API_KEY    = os.environ.get("WEATHER_API", "")
STATION_ID = "ICHRIS810"          # Wunderground PWS station ID
LAT, LON   = -43.5321, 172.6362  # Christchurch NZ — used for Open-Meteo geocode

# ── WMO weather code mappings (Open-Meteo uses WMO standard codes) ────────────
WMO_PHRASE = {
    0: "Clear",           1: "Mainly Clear",    2: "Partly Cloudy",  3: "Overcast",
    45: "Fog",            48: "Icy Fog",
    51: "Light Drizzle",  53: "Drizzle",        55: "Heavy Drizzle",
    61: "Light Rain",     63: "Rain",            65: "Heavy Rain",
    71: "Light Snow",     73: "Snow",            75: "Heavy Snow",    77: "Snow Grains",
    80: "Showers",        81: "Showers",         82: "Heavy Showers",
    85: "Snow Showers",   86: "Heavy Snow Showers",
    95: "Thunderstorm",   96: "Thunderstorm",    99: "Thunderstorm",
}

# Approximate icon codes matching what the frontend expects (Wunderground iconCode)
WMO_ICON = {
    0: 32, 1: 34, 2: 30, 3: 26,
    45: 20, 48: 20,
    51: 9,  53: 9,  55: 11,
    61: 11, 63: 12, 65: 12,
    71: 16, 73: 16, 75: 41, 77: 16,
    80: 40, 81: 40, 82: 40,
    85: 16, 86: 41,
    95: 37, 96: 37, 99: 37,
}

def wmo_phrase(code): return WMO_PHRASE.get(code, "Partly Cloudy")
def wmo_icon(code):   return WMO_ICON.get(code, 26)

def deg_to_cardinal(deg):
    dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]
    return dirs[round((deg or 0) / 22.5) % 16]

# ── Moon phase (synodic approximation, accurate to ~1 day) ────────────────────
def moon_phase():
    now  = datetime.now(timezone.utc)
    age  = (now - datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc)).total_seconds() / 86400
    age  = age % 29.53058867   # days since last new moon
    frac = age / 29.53058867
    if frac < 0.034:  return "New Moon",        "NM",  int(age)
    if frac < 0.250:  return "Waxing Crescent",  "WXC", int(age)
    if frac < 0.284:  return "First Quarter",    "FQ",  int(age)
    if frac < 0.500:  return "Waxing Gibbous",   "WXG", int(age)
    if frac < 0.534:  return "Full Moon",        "FM",  int(age)
    if frac < 0.750:  return "Waning Gibbous",   "WNG", int(age)
    if frac < 0.784:  return "Last Quarter",     "LQ",  int(age)
    if frac < 0.966:  return "Waning Crescent",  "WNC", int(age)
    return                    "New Moon",        "WNM", int(age)

# ── Fetch: current conditions from PWS ───────────────────────────────────────
def fetch_pws():
    r = requests.get(
        "https://api.weather.com/v2/pws/observations/current",
        params={"apiKey": API_KEY, "stationId": STATION_ID, "format": "json", "units": "m"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()

# ── Fetch: hourly + daily forecast from Open-Meteo ───────────────────────────
def fetch_forecast():
    r = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude":           LAT,
            "longitude":          LON,
            "timezone":           "Pacific/Auckland",
            "forecast_days":      5,
            "timeformat":         "unixtime",    # all times as Unix UTC timestamps
            "wind_speed_unit":    "kmh",
            "precipitation_unit": "mm",
            "current": ",".join([
                "temperature_2m", "apparent_temperature", "relative_humidity_2m",
                "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
                "surface_pressure", "uv_index", "weather_code", "cloud_cover", "dew_point_2m",
            ]),
            "hourly": ",".join([
                "temperature_2m", "apparent_temperature",
                "precipitation_probability", "precipitation",
                "weathercode", "pressure_msl", "cloudcover",
                "windspeed_10m", "winddirection_10m", "windgusts_10m",
                "relativehumidity_2m", "uv_index", "is_day",
            ]),
            "daily": ",".join([
                "temperature_2m_max", "temperature_2m_min",
                "sunrise", "sunset",
                "precipitation_sum", "precipitation_probability_max",
                "weathercode",
            ]),
        },
        timeout=15,
    )
    r.raise_for_status()
    return r.json()

# ── Transform ─────────────────────────────────────────────────────────────────
def build_current_from_forecast(forecast_raw, first_daily):
    """
    Build current conditions from Open-Meteo data when PWS is unavailable.
    Uses the 'current' block from Open-Meteo forecast API.
    """
    curr = forecast_raw.get("current", {})
    deg  = curr.get("wind_direction_10m") or 0
    code = curr.get("weather_code") or 0

    return {
        "temp":        curr.get("temperature_2m"),
        "feelsLike":   curr.get("apparent_temperature"),
        "humidity":    curr.get("relative_humidity_2m"),
        "pressure":    curr.get("surface_pressure"),
        "windSpeed":   curr.get("wind_speed_10m"),
        "windGust":    curr.get("wind_gusts_10m"),
        "windDirection": deg,
        "windCardinal":  deg_to_cardinal(deg),
        "uvIndex":     curr.get("uv_index"),
        "dewPoint":    curr.get("dew_point_2m"),
        "solarRad":    None,  # Not available in Open-Meteo
        "condition":   wmo_phrase(code),
        "cloudPhrase": wmo_phrase(code),
        "iconCode":    wmo_icon(code),
        "sunriseUtc":  first_daily.get("sunriseTimeUtc") if first_daily else None,
        "sunsetUtc":   first_daily.get("sunsetTimeUtc") if first_daily else None,
        "tempMax24h":  first_daily.get("calendarDayTemperatureMax") if first_daily else None,
        "tempMin24h":  first_daily.get("calendarDayTemperatureMin") if first_daily else None,
    }

def build_current(pws_raw, daily_list, first_hourly=None):
    """
    Map PWS observation + forecast daily[0] into the current conditions object.
    PWS provides live station measurements; sunrise/sunset and condition text
    are borrowed from the forecast since the PWS endpoint doesn't supply them.
    """
    obs  = (pws_raw.get("observations") or [{}])[0]
    m    = obs.get("metric") or {}
    temp = m.get("temp")

    # Feels like: wind chill when colder than air temp, heat index otherwise
    wc = m.get("windChill")
    hi = m.get("heatIndex")
    feels_like = wc if (wc is not None and temp is not None and wc < temp) else (hi if hi is not None else temp)

    deg = obs.get("winddir") or 0
    condition = (first_hourly or {}).get("wxPhraseMedium") or ""

    d0 = daily_list[0] if daily_list else {}
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
        "dewPoint":    m.get("dewpt"),
        "solarRad":    obs.get("solarRadiation"),
        "condition":   condition,
        "cloudPhrase": condition,
        "iconCode":    (first_hourly or {}).get("iconCode"),
        "sunriseUtc":  d0.get("sunriseTimeUtc"),
        "sunsetUtc":   d0.get("sunsetTimeUtc"),
        "tempMax24h":  d0.get("calendarDayTemperatureMax"),
        "tempMin24h":  d0.get("calendarDayTemperatureMin"),
    }

def build_hourly(raw):
    h = raw["hourly"]
    n = len(h["time"])
    result = []
    for i in range(n):
        code = h["weathercode"][i] or 0
        deg  = h["winddirection_10m"][i] or 0
        result.append({
            "validTimeUtc":          h["time"][i],
            "temperature":           h["temperature_2m"][i],
            "temperatureFeelsLike":  h["apparent_temperature"][i],
            "relativeHumidity":      h["relativehumidity_2m"][i],
            "windSpeed":             h["windspeed_10m"][i],
            "windDirection":         deg,
            "windDirectionCardinal": deg_to_cardinal(deg),
            "windGust":              h["windgusts_10m"][i],
            "cloudCover":            h["cloudcover"][i],
            "qpf":                   h["precipitation"][i],
            "precipChance":          h["precipitation_probability"][i],
            "precipType":            "rain",
            "pressureMeanSeaLevel":  h["pressure_msl"][i],
            "uvIndex":               h["uv_index"][i],
            "iconCode":              wmo_icon(code),
            "dayOrNight":            "D" if h["is_day"][i] else "N",
            "wxPhraseMedium":        wmo_phrase(code),
        })
    return result

def build_daily(raw):
    d = raw["daily"]
    n = len(d["time"])
    daily = [{
        "calendarDayTemperatureMax": d["temperature_2m_max"][i],
        "calendarDayTemperatureMin": d["temperature_2m_min"][i],
        "temperatureMax":            d["temperature_2m_max"][i],
        "temperatureMin":            d["temperature_2m_min"][i],
        "sunriseTimeUtc":            d["sunrise"][i],
        "sunsetTimeUtc":             d["sunset"][i],
    } for i in range(n)]

    # Enrich first daily entry with sunrise/sunset for fallback current conditions
    if daily and len(daily) > 0:
        daily[0]["sunriseTimeUtc"] = d["sunrise"][0]
        daily[0]["sunsetTimeUtc"]  = d["sunset"][0]

    return daily

# ── Main ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if not API_KEY:
        print("ERROR: WEATHER_API environment variable not set.", file=sys.stderr)
        sys.exit(1)

    print("Fetching weather data for Christchurch, NZ …")

    # Fetch Open-Meteo first (mandatory — this is our baseline)
    try:
        forecast = fetch_forecast()
        n_h = len(forecast["hourly"]["time"])
        n_d = len(forecast["daily"]["time"])
        print(f"  ✓ Open-Meteo forecast: {n_h} hourly + {n_d} daily")
    except Exception as e:
        print(f"  ✗ Open-Meteo forecast failed: {e}", file=sys.stderr)
        sys.exit(1)

    hourly_list = build_hourly(forecast)
    daily_list  = build_daily(forecast)

    # Try to fetch PWS for hyperlocal current conditions (optional enhancement)
    pws = None
    try:
        pws = fetch_pws()
        sid = (pws.get("observations") or [{}])[0].get("stationID", STATION_ID)
        print(f"  ✓ Current conditions (PWS: {sid})")
    except Exception as e:
        print(f"  ⚠ PWS current conditions unavailable: {e}", file=sys.stderr)
        print(f"  → Falling back to Open-Meteo current data")

    # TODO: Implement fallback strategy
    # Decision point: How should we build current conditions?
    # Option 1: Always use PWS if available, fall back to Open-Meteo current block
    # Option 2: Blend PWS + Open-Meteo (e.g., PWS temp but OM wind if PWS missing)
    # Option 3: Use first hourly slot as "current" approximation
    #
    # Trade-offs:
    # - PWS is more accurate (actual station readings) but can be stale/offline
    # - Open-Meteo "current" is model-based, updated every 15min, always available
    # - Hourly[0] is slightly ahead (top of next hour) but guaranteed present
    #
    # Implement your strategy below:
    if pws:
        current = build_current(pws, daily_list, first_hourly=hourly_list[0] if hourly_list else None)
    else:
        # IMPLEMENT YOUR FALLBACK HERE
        # Use build_current_from_forecast(forecast, daily_list[0]) for Open-Meteo current
        # Or construct from hourly_list[0] for first hourly slot
        current = build_current_from_forecast(forecast, daily_list[0] if daily_list else None)

    mp_name, mp_code, mp_day = moon_phase()

    import subprocess
    commit_sha = os.environ.get("GITHUB_SHA", "")
    if not commit_sha:
        try:
            commit_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        except Exception:
            commit_sha = ""

    # Timestamp of the last file modification committed to git (before this run)
    try:
        built_at = subprocess.check_output(
            ["git", "log", "-1", "--format=%cI", "--", "data/weather.json"],
            text=True
        ).strip()
        if not built_at:
            built_at = datetime.now(timezone.utc).isoformat()
    except Exception:
        built_at = datetime.now(timezone.utc).isoformat()

    payload = {
        "meta": {
            "updated": datetime.now(timezone.utc).isoformat(),
            "builtAt": built_at,
            "location": "Christchurch, New Zealand",
            "lat": LAT,
            "lon": LON,
            "commit": commit_sha[:7] if commit_sha else "",
            "sourceStatus": {
                "openMeteo": "ok",
                "pws": "ok" if pws else "failed",
                "currentSource": "pws" if pws else "open-meteo",
            },
        },
        "current": current,
        "today": {
            "moonPhase":     mp_name,
            "moonPhaseCode": mp_code,
            "moonPhaseDay":  mp_day,
        },
        "hourly": hourly_list,
        "daily":  daily_list,
    }

    # ── Data validation before commit ─────────────────────────────────────────
    # TODO: Implement validation thresholds
    # Decision point: What are reasonable bounds for Christchurch weather?
    #
    # Christchurch climate context:
    # - Record high: 42.4°C (Feb 1973)
    # - Record low: -9.4°C (Jul 1945)
    # - Typical range: -5°C to 35°C
    # - Pressure: 980-1040 hPa (normal sea level)
    # - Wind: 0-150 km/h (150+ is cyclone territory)
    #
    # Trade-offs:
    # - Too strict: reject valid extreme weather events
    # - Too loose: allow garbage data through
    #
    # Implement your validation logic below:
    def validate_payload(p):
        """Validate weather data before committing to prevent garbage data."""
        errors = []

        # Check structure
        if "current" not in p or "hourly" not in p or "daily" not in p:
            errors.append("Missing required top-level keys")
            return errors

        curr = p["current"]

        # IMPLEMENT YOUR VALIDATION HERE
        # Example checks to add:
        # - Temperature range: -20°C to 50°C (allows for extreme events)
        # - All temps not identical (the 101° bug)
        # - Minimum hourly data points
        # - Pressure in reasonable range
        # - Humidity 0-100%

        # Basic sanity checks (you can expand these)
        temp = curr.get("temp")
        if temp is None:
            errors.append("Current temperature is missing")
        elif not (-20 <= temp <= 50):
            errors.append(f"Temperature {temp}°C out of range [-20, 50]")

        # Check for the "all identical temps" bug
        if len(p["hourly"]) >= 3:
            temps = [h.get("temperature") for h in p["hourly"][:10]]
            if temps and len(set(temps)) == 1:
                errors.append(f"All hourly temps are identical: {temps[0]}°C (data corruption)")

        # Minimum data requirements
        if len(p["hourly"]) < 24:
            errors.append(f"Insufficient hourly data: {len(p['hourly'])} < 24")

        if len(p["daily"]) < 1:
            errors.append("Missing daily forecast data")

        return errors

    validation_errors = validate_payload(payload)
    if validation_errors:
        print(f"\n  ✗ DATA VALIDATION FAILED:", file=sys.stderr)
        for err in validation_errors:
            print(f"    - {err}", file=sys.stderr)
        print(f"\n  Refusing to commit invalid data. Fix the source API calls.", file=sys.stderr)
        sys.exit(1)

    print("  ✓ Data validation passed")

    os.makedirs("data", exist_ok=True)
    with open("data/weather.json", "w") as f:
        json.dump(payload, f, separators=(",", ":"))

    kb = os.path.getsize("data/weather.json") / 1024
    print(f"  ✓ Saved data/weather.json ({kb:.1f} KB)")
