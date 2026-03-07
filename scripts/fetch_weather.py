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
    return [{
        "calendarDayTemperatureMax": d["temperature_2m_max"][i],
        "calendarDayTemperatureMin": d["temperature_2m_min"][i],
        "temperatureMax":            d["temperature_2m_max"][i],
        "temperatureMin":            d["temperature_2m_min"][i],
        "sunriseTimeUtc":            d["sunrise"][i],
        "sunsetTimeUtc":             d["sunset"][i],
    } for i in range(n)]

# ── Main ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if not API_KEY:
        print("ERROR: WEATHER_API environment variable not set.", file=sys.stderr)
        sys.exit(1)

    print("Fetching weather data for Christchurch, NZ …")

    try:
        pws = fetch_pws()
        sid = (pws.get("observations") or [{}])[0].get("stationID", STATION_ID)
        print(f"  ✓ Current conditions (PWS: {sid})")
    except Exception as e:
        print(f"  ✗ PWS current conditions failed: {e}", file=sys.stderr)
        sys.exit(1)

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
    mp_name, mp_code, mp_day = moon_phase()

    payload = {
        "meta": {
            "updated": datetime.now(timezone.utc).isoformat(),
            "location": "Christchurch, New Zealand",
            "lat": LAT,
            "lon": LON,
        },
        "current": build_current(pws, daily_list, first_hourly=hourly_list[0] if hourly_list else None),
        "today": {
            "moonPhase":     mp_name,
            "moonPhaseCode": mp_code,
            "moonPhaseDay":  mp_day,
        },
        "hourly": hourly_list,
        "daily":  daily_list,
    }

    os.makedirs("data", exist_ok=True)
    with open("data/weather.json", "w") as f:
        json.dump(payload, f, separators=(",", ":"))

    kb = os.path.getsize("data/weather.json") / 1024
    print(f"  ✓ Saved data/weather.json ({kb:.1f} KB)")
