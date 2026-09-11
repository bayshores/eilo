import Foundation

/// The collector's policy is deliberately data-only so it can be checked without
/// touching macOS privacy APIs or the foreground application.
struct ContextCollectorPolicy: Equatable {
    static let knownBrowserBundleIDs: Set<String> = [
        "com.apple.safari", "com.google.chrome", "com.google.chrome.canary",
        "com.google.chrome.beta", "com.google.chrome.dev", "org.chromium.chromium",
        "com.microsoft.edgemac", "org.mozilla.firefox", "org.mozilla.firefoxdeveloperedition",
        "org.mozilla.firefoxnightly", "org.torproject.torbrowser", "com.brave.browser",
        "com.brave.browser.nightly", "com.operasoftware.opera", "com.operasoftware.operagx",
        "com.vivaldi.vivaldi", "company.thebrowser.browser", "com.kagi.kagimacos",
        "org.webkit.nightly.webkit"
    ]

    let textEnabled: Bool
    let visualsEnabled: Bool
    let excludedBundleIDs: Set<String>
    let excludedDomains: Set<String>

    static let disabled = ContextCollectorPolicy(
        textEnabled: false, visualsEnabled: false, excludedBundleIDs: [], excludedDomains: []
    )

    static func isBrowserBundleID(_ bundleID: String) -> Bool {
        let identifier = bundleID.lowercased()
        // Installed browser web apps inherit the browser prefix but are not
        // necessarily registered as system HTTP handlers themselves.
        return knownBrowserBundleIDs.contains(where: { identifier == $0 || identifier.hasPrefix($0 + ".") })
    }

    func excludes(bundleID: String) -> Bool {
        excludedBundleIDs.contains(bundleID.lowercased())
    }

    /// Domain exclusions are retained for the browser authority. Native capture
    /// never inspects browser text or images to infer a domain.
    func excludes(domain: String) -> Bool {
        let normalized = domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return excludedDomains.contains(where: { normalized == $0 || normalized.hasSuffix("." + $0) })
    }

    func permitsText(bundleID: String) -> Bool {
        textEnabled && !Self.isBrowserBundleID(bundleID) && !excludes(bundleID: bundleID)
    }

    func permitsVisuals(bundleID: String) -> Bool {
        visualsEnabled && !Self.isBrowserBundleID(bundleID) && !excludes(bundleID: bundleID)
    }

    static func decode(_ value: Any?) throws -> ContextCollectorPolicy {
        guard let object = value as? [String: Any],
              let textEnabled = object["text_enabled"] as? Bool,
              let visualsEnabled = object["visuals_enabled"] as? Bool,
              let bundleValues = object["excluded_bundle_ids"] as? [String],
              let domainValues = object["excluded_domains"] as? [String],
              bundleValues.count <= 128, domainValues.count <= 128 else {
            throw ContextCollectorPolicyError.invalidPolicy
        }
        let bundles = Set(bundleValues.compactMap(normalizeBundleID))
        let domains = Set(domainValues.compactMap(normalizeDomain))
        guard bundles.count == bundleValues.count, domains.count == domainValues.count else {
            throw ContextCollectorPolicyError.invalidPolicy
        }
        return ContextCollectorPolicy(textEnabled: textEnabled, visualsEnabled: visualsEnabled,
                                      excludedBundleIDs: bundles, excludedDomains: domains)
    }

    private static func normalizeBundleID(_ value: String) -> String? {
        let result = value.lowercased()
        guard result.count > 2, result.count <= 255,
              result.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" }) else { return nil }
        return result
    }

    private static func normalizeDomain(_ value: String) -> String? {
        let result = value.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard result.count > 0, result.count <= 253, result.contains("."),
              result.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" }) else { return nil }
        return result
    }
}

enum ContextCollectorPolicyError: Error { case invalidPolicy }
