# WeatherTempo iOS (SwiftUI)

Plan: [`docs/superpowers/plans/2026-11-03-swiftui-native-app.md`](../docs/superpowers/plans/2026-11-03-swiftui-native-app.md)

Native client for the existing Cloudflare Worker. Code is written on Windows;
**GitHub Actions (`.github/workflows/ios-ci.yml`) is the compiler.**

## Layout

- `project.yml`: XcodeGen spec. The `.xcodeproj` is generated, never committed.
- `WeatherTempo/`: app target
- `Packages/WeatherTempoKit/`: models, networking, cache (later: tides, chart). Shared by app + widget.

## Getting a build onto your phone (no Mac needed)

1. Push to GitHub; the **iOS CI** workflow runs tests and builds.
2. Download the `WeatherTempo-unsigned-ipa` artifact from the run.
3. On Windows, open **Sideloadly** (or AltServer), plug in the iPhone, sign in with your
   free Apple ID, drag in the `.ipa`. The app is valid for **7 days**; repeat to refresh.
   (iPhone needs Developer Mode on: Settings → Privacy & Security.)

## Building locally on a Mac (optional)

```bash
brew install xcodegen
cd ios && xcodegen generate && open WeatherTempo.xcodeproj
cd Packages/WeatherTempoKit && swift test
```

Your Xcode must support your phone's iOS version; if it doesn't, use the CI route.
