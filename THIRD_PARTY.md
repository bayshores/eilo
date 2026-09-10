# Third-party components and assets

The backend uses [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent). Its pinned revision and archive checksum are in `hermes-source.json`. Hermes is an external local runtime, not vendored here. Its MIT notice is preserved in `third_party/hermes-agent-LICENSE`; other installed dependencies retain their notices in the local runtime.

`docs/docs/design/studies/coastline-wallpaper.png` was generated for this project with OpenAI's image generation tool in September 2026. It depicts a fictional coastline used for static mockup presentation and is not a user's desktop screenshot. It is retained as reference art and is not loaded or served by the application. No third-party photography or operating-system icon assets are bundled. UI controls use the locally licensed fonts below and source SVG/CSS.

## Typography

The widget Home uses IBM Plex Sans, distributed under the SIL Open Font License 1.1. The unmodified Latin variable WOFF2 is served locally, and its copyright and license are in `web/assets/fonts/ibm-plex-sans-OFL.txt`. [IBM source](https://github.com/IBM/plex). The comparison study also bundles Source Sans 3 and Atkinson Hyperlegible Next with their respective OFL files and original download URLs in `prototypes/typography-study/`.

## Local speech recognition

Optional speech setup downloads/builds [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp/tree/v1.9.3), pinned to v1.9.3 commit `371b5a7561823ab2bb32142d2751e35e7534727b`. It is MIT licensed; its notice is preserved in `third_party/whisper-cpp-LICENSE`. Source/build files remain under ignored `.runtime/stt/` and are not bundled in this repository.

The downloaded `small.en` weights derive from [OpenAI Whisper](https://github.com/openai/whisper), whose code and model weights are released under the [MIT license](https://github.com/openai/whisper/blob/main/LICENSE). The converted model and official checksum are documented in the [whisper.cpp model listing](https://github.com/ggml-org/whisper.cpp/blob/v1.9.3/models/README.md). Setup verifies SHA1 `db8a495a91d927739e50b3fc1cc4c6b8f6c2d022`. No weights, user audio or transcripts are distributed here.

## Desktop host

The desktop development build pins [Electron](https://github.com/electron/electron) 44.3.0 and [Electron Packager](https://github.com/electron/packager) 20.3.0 via its npm lockfile. Their distribution/dependency notices remain in the installed tools and generated Electron runtime. The eïlo wordmark icon is original project artwork rendered with the already licensed IBM Plex Sans; no Apple wallpaper or system icon is included. Source and build instructions are in `desktop/electron/`.

## Calendar credential storage

The isolated Python runtime uses [keyring 25.7.0](https://pypi.org/project/keyring/), MIT licensed, for the macOS Keychain backend. Exact integration dependencies are pinned in `requirements.integrations.lock`; the library source and its license remain in the runtime installation. No credential data is included in this repository.

## MCP connection testing

Explicit connection tests use the installed [official MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk) 2.0.0 (MIT) through the pinned Hermes adapter. Added dependencies are recorded in `requirements.integrations.lock`; their license notices remain in the isolated runtime. No telemetry exporter or third-party MCP server is configured by installation.

Mobbin's Sana AI chat, integration-detail and folder-creation flows were viewed as interaction references for the management UI; their screen images and source assets are not bundled. Reference URLs and design inferences are recorded in `docs/design/connections-and-chats.md`.
