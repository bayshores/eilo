# Source code and private local data

The repository describes the product. An installation owns its personal data.
The two must not share a publishable storage location or packaging input.

## Ownership

| Material                                                                       | Owner and location                                                                                  | In Git or the app package?                                                                 |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Product code, default configuration, synthetic fixtures, maintainer docs       | Reviewed source tree                                                                                | Yes                                                                                        |
| Display name, layout, notes, and presentation preferences                      | Local browser preferences; the desktop browser profile is app-owned state                           | No                                                                                         |
| Conversations, goals, activity, memory, OAuth state, and account configuration | App data directory: ignored `.state` in development, user Application Support in the standalone app | No                                                                                         |
| Personal development notes and local overrides                                 | Ignored `.local`                                                                                    | No                                                                                         |
| Scratch files, profiling output, downloaded dependencies, and generated builds | Ignored `.tmp` and `.runtime`                                                                       | No source publication; only explicitly selected managed runtime inputs enter an app bundle |
| Public dependency licenses and required runtime libraries                      | Pinned dependency inputs                                                                            | Yes, subject to package verification                                                       |

Home starts with a neutral profile. A personal name is rendered only from local
preferences and is not part of a source fixture or HTML default. Existing local
preferences keep their established keys.

`app/paths.py` owns runtime locations. Environment overrides remain supported,
but a state/cache/runtime destination inside the checkout must be beneath a
reserved local directory. Empty destinations, source directories, and symlink
aliases back into source are rejected. Standalone app data remains outside its
read-only bundled workspace.

## Shared policy

[`config/source-boundary.json`](../config/source-boundary.json) declares private
path components, files, suffixes, local ref namespaces, reserved storage roots,
and the workspace inputs eligible for packaging. Repository checks, Git guards,
package staging, and package verification consume that policy.

- `.env` files are private except explicitly named `.example` templates.
- Private paths are rejected even when forced into the Git index.
- The validator reads staged blobs, so cleaning a working file cannot conceal a
  credential that is still staged.
- The push guard checks every outgoing commit, including an earlier commit that
  added private data before a later commit removed it.
- Backup/local/private refs cannot be published. An optional ignored
  `.local/publish-blocklist.json` can also mark known private commit IDs as
  non-publishable, regardless of which ref points to them.
- Outgoing author/committer email must use a GitHub privacy address. Commit
  messages receive the same credential-signature check as source blobs.
- Validators report paths and failure categories, never the matched secret.

These checks guard structural mistakes and credential signatures. Source review
still determines whether ordinary prose, examples, or new assets contain personal
information.

## Local Git guards

Run once after cloning:

```sh
./scripts/install-source-guards
```

Use your public GitHub handle and its GitHub-provided privacy email for commit
authorship. Configure this per repository, leaving other projects unaffected.

The installer preserves unrelated hooks and custom hook configurations. If it
reports a conflict, integrate the two eïlo checks into the existing hook setup
instead of overwriting it. Both hooks use Python's standard library.

```sh
python3 scripts/check-source-boundary.py --staged
npm run check
```

The pre-push hook receives the exact refs from Git. It requires the remote base
commit to be available locally; fetch first when it is missing. Local-only
backups should use the protected `backup/`, `local/`, or `private/` namespaces.

## Packaging

The beta workspace is staged from Git-indexed files under the approved source
roots. Local edits to tracked source remain reviewable; untracked and ignored
files within those directories are not copied. Private tracked paths and unsafe
source links fail staging. Electron packaging uses that reviewed workspace,
rather than recopying the original checkout.

The complete staged workspace and managed runtime are checked before packaging
or signing, followed by a final package check. Private metadata remains forbidden
inside runtime and application resource trees. Only contained, safe runtime
links needed by the platform may survive verification.

The development app remains a checkout-dependent local artifact, with an explicit
non-release guard. Its `checkout.json` belongs only to generated local build
output. App distribution is governed separately by the
[release gates](beta-release.md).

## Existing history

Removing personal content from the current source does not remove an older
published Git commit. Keep unpublished private originals in local-only storage
and rebuild the outgoing commits before publishing them. Changing already-shared
history requires a separately scoped migration; ordinary cleanup never implies a
force push or repository-visibility change.
