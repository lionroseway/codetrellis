// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MobileClient",
    products: [
        .library(name: "BillingCore", targets: ["BillingCore"]),
    ],
    targets: [
        .target(name: "BillingCore"),
        .executableTarget(name: "MobileApp", dependencies: ["BillingCore"]),
    ]
)
