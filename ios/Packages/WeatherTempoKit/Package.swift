// swift-tools-version:5.10
import PackageDescription

// Tools version 5.10 (Swift 5 language mode) on purpose: this code is written
// without a local compiler, so we avoid Swift 6 strict-concurrency errors.
// macOS is listed so `swift test` can run on a plain macOS CI runner without
// booting an iOS simulator.
let package = Package(
    name: "WeatherTempoKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "WeatherTempoKit", targets: ["WeatherTempoKit"])
    ],
    targets: [
        .target(name: "WeatherTempoKit"),
        .testTarget(
            name: "WeatherTempoKitTests",
            dependencies: ["WeatherTempoKit"],
            resources: [.copy("Fixtures")]
        )
    ]
)
