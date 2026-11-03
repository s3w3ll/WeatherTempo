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

## Keeping it installed

A free Apple ID signs for **7 days**. Options, cheapest first:

- **Re-sideload weekly** with Sideloadly (above).
- **SideStore / AltStore** refresh the signature automatically in the background while the
  phone is on your Wi-Fi, so the app effectively never expires.
- **Paid Apple Developer account (US$99/yr)** gives 1-year signing, and TestFlight builds
  (90 days each). CI could then sign and upload, but that needs an App Store Connect API key
  stored as a repo secret, so no TestFlight workflow is shipped untested.

Each CI build stamps `CURRENT_PROJECT_VERSION` with the run number.

## Accessibility

VoiceOver text is built by pure functions in `AccessibilityText.swift` (unit-tested), fonts
follow Dynamic Type via `scaledFont`, and `AccessibilityContrastTests` checks every theme text
colour against WCAG AA (4.5:1) on the card/page/widget backgrounds.
