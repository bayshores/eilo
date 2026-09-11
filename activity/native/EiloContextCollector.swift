import AppKit
import ApplicationServices
import Foundation
import ScreenCaptureKit
import Vision

private let schemaVersion = 1
private let maxInputBytes = 16_384
private let maxOutputBytes = 6_000_000
private let maxImageBytes = 4_000_000
private let maxTextCharacters = 8_000
private let maxAXNodes = 200
private let heartbeatSeconds: TimeInterval = 5

private func unixNow() -> Int { Int(Date().timeIntervalSince1970) }

private func clipped(_ value: String, _ maximum: Int) -> String { String(value.prefix(maximum)) }

private func emit(_ value: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
    guard data.count <= maxOutputBytes else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

private func status(_ name: String, sessionID: String? = nil, policyEpoch: Int? = nil) {
    var value: [String: Any] = ["schema_version": schemaVersion, "kind": "status", "status": name]
    if let sessionID { value["session_id"] = sessionID }
    if let policyEpoch { value["policy_epoch"] = policyEpoch }
    emit(value)
}

private struct Command {
    let sessionID: String
    let policyEpoch: Int
    let action: String
    let policy: ContextCollectorPolicy?

    static func decode(_ line: String) -> Command? {
        guard line.utf8.count <= maxInputBytes,
              let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["schema_version"] as? Int == schemaVersion,
              let sessionID = object["session_id"] as? String, !sessionID.isEmpty, sessionID.count <= 256,
              let epoch = object["policy_epoch"] as? Int, epoch >= 0, epoch <= Int(Int32.max),
              let action = object["action"] as? String,
              ["start", "pause", "stop", "update_policy", "sample"].contains(action) else { return nil }
        let policy = try? ContextCollectorPolicy.decode(object["policy"])
        if action == "start" || action == "update_policy" { guard policy != nil else { return nil } }
        return Command(sessionID: sessionID, policyEpoch: epoch, action: action, policy: policy)
    }
}

private struct ForegroundContext {
    let bundleID: String
    let appName: String
    let pid: pid_t
    let title: String
    let isBrowser: Bool
}

private final class Collector {
    private var active = false
    private var suspended = false
    private var sessionID = ""
    private var policyEpoch = 0
    private var policy = ContextCollectorPolicy.disabled
    private var lastFingerprint = ""
    private var lastEmission = Date.distantPast
    private var timer: DispatchSourceTimer?

    init() {
        let center = NSWorkspace.shared.notificationCenter
        center.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in self?.sample() }
        center.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main) { [weak self] _ in self?.suspend() }
        center.addObserver(forName: NSWorkspace.sessionDidResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.suspend() }
        center.addObserver(forName: NSWorkspace.sessionDidBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.resumeSession() }
    }

    func handle(_ command: Command) {
        switch command.action {
        case "start":
            active = true; suspended = false; sessionID = command.sessionID; policyEpoch = command.policyEpoch
            policy = command.policy!; lastFingerprint = ""; lastEmission = .distantPast; installTimer()
            status("started", sessionID: sessionID, policyEpoch: policyEpoch)
            if policy.textEnabled && !AXIsProcessTrusted() { status("permission_required", sessionID: sessionID, policyEpoch: policyEpoch) }
        case "update_policy":
            guard active && command.sessionID == sessionID else { status("not_active", sessionID: command.sessionID, policyEpoch: command.policyEpoch); return }
            policy = command.policy!; policyEpoch = command.policyEpoch; lastFingerprint = ""
            status("policy_updated", sessionID: sessionID, policyEpoch: policyEpoch)
            if policy.textEnabled && !AXIsProcessTrusted() { status("permission_required", sessionID: sessionID, policyEpoch: policyEpoch) }
        case "pause":
            guard active && command.sessionID == sessionID else { status("not_active", sessionID: command.sessionID, policyEpoch: command.policyEpoch); return }
            suspend(); status("paused", sessionID: sessionID, policyEpoch: policyEpoch)
        case "stop":
            guard active && command.sessionID == sessionID else { status("not_active", sessionID: command.sessionID, policyEpoch: command.policyEpoch); return }
            active = false; suspended = false; timer?.cancel(); timer = nil; lastFingerprint = ""
            status("stopped", sessionID: command.sessionID, policyEpoch: command.policyEpoch)
        case "sample":
            guard active && !suspended && command.sessionID == sessionID else { status("not_active", sessionID: command.sessionID, policyEpoch: command.policyEpoch); return }
            sample()
        default: break
        }
    }

    private func installTimer() {
        timer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + heartbeatSeconds, repeating: heartbeatSeconds)
        timer.setEventHandler { [weak self] in self?.sample() }
        timer.resume(); self.timer = timer
    }

    private func suspend() {
        if active { suspended = true; lastFingerprint = ""; status("paused", sessionID: sessionID, policyEpoch: policyEpoch) }
    }
    private func resumeSession() {
        if active { suspended = false; lastFingerprint = ""; sample() }
    }

    private func foreground() -> ForegroundContext? {
        guard let app = NSWorkspace.shared.frontmostApplication,
              let bundleID = app.bundleIdentifier else { return nil }
        // Browser page titles are browser content. The native collector does not
        // even query them; browser authority belongs exclusively to the extension.
        let handlers = NSWorkspace.shared.urlsForApplications(toOpen: URL(string: "https://example.invalid")!).compactMap { Bundle(url: $0)?.bundleIdentifier }
        let isBrowser = ContextCollectorPolicy.isBrowserBundleID(bundleID) || handlers.contains(where: { $0.caseInsensitiveCompare(bundleID) == .orderedSame })
        let title = isBrowser || !policy.textEnabled ? "" : (windowTitle(pid: app.processIdentifier) ?? "")
        return ForegroundContext(bundleID: bundleID, appName: clipped(app.localizedName ?? "Unknown app", 180), pid: app.processIdentifier, title: clipped(title, 180), isBrowser: isBrowser)
    }

    private func sample() {
        guard active && !suspended else { return }
        guard CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: UInt32.max)!) < 90 else {
            status("paused", sessionID: sessionID, policyEpoch: policyEpoch); return
        }
        guard let context = foreground() else { return }
        let ownBundle = Bundle.main.bundleIdentifier ?? ""
        guard context.bundleID != ownBundle, !context.bundleID.hasPrefix("local.eilo."), !context.bundleID.hasPrefix("app.eilo.") else { return }
        guard !policy.excludes(bundleID: context.bundleID) else { return }
        guard !isSensitiveTitle(context.title) else { return }
        let canText = !context.isBrowser && policy.permitsText(bundleID: context.bundleID) && AXIsProcessTrusted()
        let fingerprint = "\(context.bundleID)\u{1F}\(context.title)\u{1F}\(canText)\u{1F}\(policy.permitsVisuals(bundleID: context.bundleID))"
        let now = Date()
        guard fingerprint != lastFingerprint || now.timeIntervalSince(lastEmission) >= heartbeatSeconds else { return }
        lastFingerprint = fingerprint; lastEmission = now
        emitEvent(kind: "app", context: context, text: "")
        if canText, let text = collectText(pid: context.pid, title: context.title), !text.isEmpty {
            emitEvent(kind: "text", context: context, text: text)
        } else if policy.textEnabled && !AXIsProcessTrusted() {
            status("permission_required", sessionID: sessionID, policyEpoch: policyEpoch)
        }
        if !context.isBrowser && policy.permitsVisuals(bundleID: context.bundleID) { captureVisual(context) }
    }

    private func emitEvent(kind: String, context: ForegroundContext, text: String, image: [String: Any]? = nil) {
        guard active && !suspended, NSWorkspace.shared.frontmostApplication?.processIdentifier == context.pid,
              !policy.excludes(bundleID: context.bundleID) else { return }
        var event: [String: Any] = [
            "schema_version": schemaVersion, "id": UUID().uuidString, "source_id": "desktop",
            "session_id": sessionID, "policy_epoch": policyEpoch, "captured_at": unixNow(),
            "kind": kind, "bundle_id": context.bundleID, "app_name": context.appName,
            "title": context.title, "text": clipped(text, maxTextCharacters)
        ]
        if let image { event["image"] = image }
        emit(event)
    }

    private func windowTitle(pid: pid_t) -> String? {
        let element = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(element, 0.20)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXFocusedWindowAttribute as CFString, &value) == .success,
              let window = value else { return nil }
        AXUIElementSetMessagingTimeout(window as! AXUIElement, 0.20)
        var title: CFTypeRef?
        guard AXUIElementCopyAttributeValue(window as! AXUIElement, kAXTitleAttribute as CFString, &title) == .success else { return nil }
        return title as? String
    }

    private func collectText(pid: pid_t, title: String) -> String? {
        guard !isSensitiveTitle(title) else { return nil }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.20)
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focused) == .success,
              let focused else { return nil }
        let root = focused as! AXUIElement
        var queue = [root], visited = 0, parts = [String]()
        let deadline = Date().addingTimeInterval(0.2)
        while !queue.isEmpty && Date() < deadline && visited < maxAXNodes && parts.joined(separator: "\n").count < maxTextCharacters {
            let element = queue.removeFirst(); visited += 1; AXUIElementSetMessagingTimeout(element, 0.20)
            var roleValue: CFTypeRef?
            _ = AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleValue)
            let role = roleValue as? String ?? ""
            if role != "AXSecureTextField" && role != kAXTextFieldRole as String {
                for key in [kAXTitleAttribute, kAXValueAttribute] {
                    var value: CFTypeRef?
                    if AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success,
                       let string = value as? String, !string.isEmpty { parts.append(clipped(string, 1_000)) }
                }
            }
            var children: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
               let entries = children as? [AXUIElement] { queue.append(contentsOf: entries.prefix(maxAXNodes - visited)) }
        }
        return clipped(parts.joined(separator: "\n"), maxTextCharacters)
    }

    private func captureVisual(_ context: ForegroundContext) {
        // ScreenCaptureKit is invoked only after the current foreground identity
        // passed the policy gate. Its image remains an event payload; it is never written.
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { [weak self] content, error in
            guard let self, self.active, !self.suspended, error == nil, let content else { return }
            let candidates = content.windows.filter { $0.owningApplication?.processID == context.pid && $0.title == context.title }
            guard candidates.count == 1, let window = candidates.first,
                  let current = self.foreground(), current.pid == context.pid, current.bundleID == context.bundleID else { return }
            let filter = SCContentFilter(desktopIndependentWindow: window)
            let configuration = SCStreamConfiguration(); configuration.width = max(1, Int(window.frame.width)); configuration.height = max(1, Int(window.frame.height)); configuration.showsCursor = false
            SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, error in
                guard let image, error == nil, let rechecked = self.foreground(), rechecked.pid == context.pid,
                      rechecked.bundleID == context.bundleID, rechecked.title == context.title,
                      let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]),
                      data.count <= maxImageBytes else { return }
                self.emitEvent(kind: "visual", context: context, text: self.ocr(image), image: ["mime_type": "image/png", "data_base64": data.base64EncodedString()])
            }
        }
    }

    private func isSensitiveTitle(_ title: String) -> Bool {
        let lowerTitle = title.lowercased()
        return ["sign in", "log in", "login", "authenticate", "password", "verification code"].contains(where: lowerTitle.contains)
    }

    private func ocr(_ image: CGImage) -> String {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .fast
        request.usesLanguageCorrection = false
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        guard (try? handler.perform([request])) != nil else { return "" }
        let text = request.results?.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n") ?? ""
        return clipped(text, maxTextCharacters)
    }
}

private func check() {
    // These queries are preflight-only: no foreground app/window/text is read and no prompt is requested.
    emit(["schema_version": schemaVersion, "kind": "check", "accessibility_capable": true,
          "accessibility_permission": AXIsProcessTrusted(), "visuals_capable": true,
          "screen_recording_permission": CGPreflightScreenCaptureAccess(), "browser_text_controlled_by_extension": true])
}

private func selfTest() {
    guard ContextCollectorPolicy.isBrowserBundleID("com.google.Chrome"),
          !ContextCollectorPolicy.disabled.permitsText(bundleID: "com.example.Editor") else { exit(1) }
    emit(["schema_version": schemaVersion, "kind": "self_test", "status": "passed"])
}

@main
struct EiloContextCollector {
    static func main() {
        let arguments = Array(CommandLine.arguments.dropFirst())
        if arguments == ["--check"] { check(); return }
        if arguments == ["--self-test"] { selfTest(); return }
        guard arguments.isEmpty else { FileHandle.standardError.write(Data("Usage: EiloContextCollector [--check|--self-test]\n".utf8)); exit(64) }

        let collector = Collector()
        DispatchQueue.global(qos: .utility).async {
            while let line = readLine() {
                DispatchQueue.main.async {
                    guard let command = Command.decode(line) else { status("invalid_command"); return }
                    collector.handle(command)
                }
            }
        }
        dispatchMain()
    }
}
