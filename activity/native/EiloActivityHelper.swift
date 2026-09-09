import AppKit
import Foundation

// This helper intentionally uses only NSWorkspace's frontmost-application API.
// It does not enumerate windows, read screens or input, or use Apple Events.
enum HelperError: Error {
    case invalidArguments
}

func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

func usage() {
    FileHandle.standardError.write(Data("Usage: EiloActivityHelper [--version|--check|--sample [--expected-bundle ID]]\n".utf8))
}

let arguments = Array(CommandLine.arguments.dropFirst())

if arguments == ["--version"] {
    emit(["kind": "eilo_activity_helper", "version": "1"])
    exit(0)
}

if arguments == ["--check"] {
    // This deliberately does not access NSWorkspace.frontmostApplication.
    emit(["kind": "ready", "capability": "foreground_app_identity"])
    exit(0)
}

var expectedBundle: String? = nil
if arguments.count == 1 && arguments[0] == "--sample" {
    // Explicit sampling is the only mode that reads foreground identity.
} else if arguments.count == 3 && arguments[0] == "--sample" && arguments[1] == "--expected-bundle" && !arguments[2].isEmpty {
    expectedBundle = arguments[2]
} else {
    usage()
    exit(64)
}

guard let app = NSWorkspace.shared.frontmostApplication,
      let bundleID = app.bundleIdentifier else {
    emit(["kind": "activity_unknown"])
    exit(0)
}

// Do not disclose an observed identity when a controlled test expects another app.
if let expectedBundle, expectedBundle != bundleID {
    emit(["kind": "unexpected_context"])
    exit(0)
}

let name = app.localizedName ?? "Unknown app"
emit(["kind": "foreground_app", "name": String(name.prefix(180)), "bundle_id": bundleID])
