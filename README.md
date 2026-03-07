# WeatherTempo

Personal weather dashboard for Christchurch, New Zealand — styled after [WeatherGraph](https://weathergraph.app/).

## Features

- **Conditions card** — current temperature, today's high/low with the hour they occur, humidity, wind, pressure, UV index, sunrise/sunset, moon phase, and next tide times for New Brighton Beach
- **WeatherGraph-style chart** — smooth temperature area, feels-like curve, precipitation bars, wind arrows, pressure line, and cloud overlays across a 5-day hourly forecast
- **Harmonic tide prediction** — computed locally from LINZ Lyttelton constituent data; no extra API key required
- **Auto-refresh** — GitHub Actions fetches fresh data from Weather Underground every 30 minutes

## Setup

### 1. Add your Wunderground API key

Go to **Settings → Secrets and variables → Actions** and add:

| Name | Value |
|------|-------|
| `WEATHER_API` | Your Weather Underground / weather.com API key |

### 2. Enable GitHub Pages

Go to **Settings → Pages** and set:
- Source: **Deploy from a branch**
- Branch: `main`, folder: `/ (root)`

### 3. Trigger the first data fetch

Run the workflow manually: **Actions → Update Weather Data → Run workflow**.

The chart will show synthetic sample data until the first real fetch completes.

## Development

Serve the root directory with any static server:

```bash
python -m http.server 8080
# or
npx serve .
```

## Architecture

```
GitHub Actions (every 30 min)
  └── scripts/fetch_weather.py  (uses WEATHER_API secret)
        └── data/weather.json   (committed to repo)

GitHub Pages
  └── index.html
        ├── src/tides.js   — harmonic tide predictor (Lyttelton)
        ├── src/chart.js   — canvas WeatherGraph-style chart
        └── src/app.js     — data loading + UI population
```

## Customising

- **Location** — change `LAT`, `LON`, and `"Christchurch, New Zealand"` in `scripts/fetch_weather.py` and `src/app.js`
- **Tide station** — update the harmonic constants in `src/tides.js` with LINZ values for your nearest port
- **Wind style** — the `drawWindIndicators` method in `src/chart.js` is yours to customise
