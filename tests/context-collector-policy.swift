import Foundation

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1) }
}

@main
struct ContextCollectorPolicyTests {
    static func main() throws {
        let policy = try ContextCollectorPolicy.decode([
            "text_enabled": true, "visuals_enabled": true,
            "excluded_bundle_ids": ["com.example.PrivateApp"],
            "excluded_domains": ["private.example"]
        ])
        require(policy.permitsText(bundleID: "com.example.Editor"), "ordinary apps may provide text")
        require(!policy.permitsText(bundleID: "com.google.Chrome"), "browsers are extension-controlled")
        require(!policy.permitsText(bundleID: "com.google.Chrome.app.example"), "installed browser apps remain extension-controlled")
        require(!policy.permitsVisuals(bundleID: "com.apple.Safari"), "browser images are prohibited")
        require(!policy.permitsText(bundleID: "com.example.privateapp"), "bundle exclusions are case-insensitive")
        require(policy.excludes(domain: "sub.private.example"), "domain exclusions cover subdomains")
        require((try? ContextCollectorPolicy.decode(["text_enabled": true])) == nil, "incomplete policies fail closed")
        print("context collector policy tests passed")
    }
}
