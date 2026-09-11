# Private Mac build

**App distribution is on hold.** Source-control updates and app distribution are separate operations. Chrome Web Store submission, notarization uploads, deployment, and app distribution require separate explicit authorization.

## Local bundle

`scripts/build-beta-runtime` creates a managed Apple Silicon Python 3.13.5 runtime, pinned Hermes source/dependencies and local launchers. It does not reuse a system Python, import a global account or carry development state into the bundle.

`node desktop/electron/scripts/package-beta.cjs` creates an unsigned app under `.runtime/beta-build/app/`. The app contains `Contents/Resources/workspace` and `Contents/Resources/runtime`. It writes future user-owned state under Application Support and cache directories, outside signed resources. Local development still uses the checkout and its existing state.

The package includes only application assets, source/config templates, the extension, helper and runtime; `.state`, chats, credentials and scratch data are excluded. `scripts/verify-beta-runtime.py --stage .runtime/beta-build` checks required files, public paths and the staged contract. Its structural checks are not a security audit of every third-party dependency.

The local fresh-profile service smoke test passed using the actual bundled runtime from a different working directory. It initialized an empty Hermes conversation database through Hermes, returned `needs_sign_in`, and kept capture, rich text, visuals and AI context off. It did not create a context content key. No real login, native-host registration or OS permission grant was performed by that test.

## Account and Chrome setup

The app's account banner starts a new Codex device flow only after **Connect ChatGPT**. Its code is transient and the browser opens only on **Continue in browser**. The account driver uses pinned Hermes OAuth primitives. Tokens remain in that app's private Hermes profile; progress exposes only the official device URL, code and derived status. A runtime boundary disables recovery/import from another Codex application's credentials.

Both development and standalone Electron startup register the app's Chrome Native Messaging host using the fixed extension ID derived from the bundled public extension key. Native transport availability is separate from capture consent. The **Connect Chrome** action enables the browser source, while text and AI remain separately controlled. The development host uses the checkout's project Python and state directory; the standalone host uses its bundled runtime and Application Support state. The page bridge remains available for compatibility with older installations.

No Chrome Web Store listing has been created. The unpacked extension is a private development artifact. A future store distribution must keep the verified extension identity and review the declared permissions.

## Future distribution gates — on hold

The packager contains an explicit release path using [Electron's signing options](https://electron.github.io/packager/main/interfaces/OsxSignOptions.html) and [Keychain-backed notarization credentials](https://packages.electronjs.org/notarize/main/types/NotaryToolCredentials.html). It requires both an available Developer ID identity and an explicit notary profile, then checks the signature, stapled ticket and Gatekeeper assessment. That path has **not** been executed or validated here. Having code for it is not authorization to use it.

Still required before any future release: clean-machine Electron/Chrome onboarding; real capture/privacy checks with consent; verified signed helper/runtime behavior; version update/rollback; full performance soak; user testing; and an explicit decision to distribute. The visual model path remains unavailable until its fixture succeeds. See [the implementation record](design/adaptive-workspace-build.md).
