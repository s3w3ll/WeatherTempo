/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "WeatherTempoWidget",
  displayName: "WeatherTempo",
  deploymentTarget: "17.0",
  // No App Group on purpose: a free Apple ID (Sideloadly) can't provision one, and a
  // missing group would stop the whole app installing. The widget fetches for itself.
  frameworks: ["SwiftUI", "WidgetKit"],
});
