# WeatherTempo Favicon

The "Soft Curve" variant — a peak/trough temperature reading on a warm
sunrise-toned circle.

## Files

| File                       | Purpose                              |
| -------------------------- | ------------------------------------ |
| `favicon.svg`              | Modern browsers (scales perfectly)   |
| `favicon-16x16.png`        | Legacy browser tab fallback          |
| `favicon-32x32.png`        | Legacy bookmark fallback             |
| `apple-touch-icon.png`     | iOS home-screen icon (180×180)       |
| `icon-512x512.png`         | PWA / Android maskable icon          |

## Installation

Drop the files into your site's root (or `/public/` for Next/Vite/etc.)
and add this to your `<head>`:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
```

## Optional: web app manifest

For PWA / Android home screen support, add a `site.webmanifest`:

```json
{
  "name": "WeatherTempo",
  "short_name": "WeatherTempo",
  "icons": [
    { "src": "/icon-512x512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "theme_color": "#ffd0c2",
  "background_color": "#ffe9d2",
  "display": "standalone"
}
```

Then link it: `<link rel="manifest" href="/site.webmanifest">`

## Source

The SVG is the source of truth — regenerate any raster size from it. The
PNGs in this bundle were rasterized at 16, 32, 180, and 512 px.
