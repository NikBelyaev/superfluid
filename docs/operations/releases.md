# Releasing Superfluid

Releases are public GitHub Releases in `NikBelyaev/superfluid`. Only macOS is
currently supported: each release includes signed, notarized DMG and ZIP files for
Apple Silicon and Intel. Users need no GitHub account or token to update.

## Set up signing

Add these GitHub Actions repository secrets before the first release:

| Secret             | Value                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| `CSC_LINK`         | Base64-encoded Developer ID Application certificate exported as a `.p12` |
| `CSC_KEY_PASSWORD` | Password for that `.p12`                                                 |
| `APPLE_API_KEY`    | Base64-encoded App Store Connect API private key (`.p8`)                 |
| `APPLE_API_KEY_ID` | API key ID                                                               |
| `APPLE_API_ISSUER` | API issuer ID                                                            |

Keep the signing identity consistent across releases. macOS verifies that an
update belongs to the same developer as the installed app. Local `pnpm dist`
builds retain ad-hoc signing and have no update feed; install a signed release
once to start receiving updates. Release builds fail if signing or notarization
fails. Scheduled releases skip work until all signing secrets are present.

## Nightly, then Stable

After the release workflow is on `main`, run **Actions → Release → Run workflow**
with branch `main` and channel `nightly`. Verify the published app before running
the workflow again with channel `stable`.

Stable promotes the latest published nightly's exact commit, even if `main` has
moved. Its version defaults to the nightly's `X.Y.Z`; use the version input for
an explicit minor or major bump. Pushing a plain `vX.Y.Z` tag builds that tagged
commit instead, for example when shipping a cherry-picked fix. Do not push test
tags: they publish real releases.

Nightlies use `X.Y.Z-nightly.YYYYMMDD.<workflow run number>` with a UTC date. The
base is the next patch after the highest stable tag, or the root package's base
version before the first stable. A scheduled check runs every 30 minutes and
publishes only when the commit changed and the previous nightly was published at
least six hours ago. A manual nightly bypasses both checks. Release runs are
serialized.

The tag identifies the release version; CI stamps `package.json` only in its
build checkout. It does not commit nightly version bumps back to `main`. Stable
tags are marked Latest; nightlies are prereleases. Generated notes compare with
the preceding tag in the same channel.

Publication waits for the existing CI checks and a packaged Electron test on
each architecture. The two macOS updater manifests are merged so either
architecture can update from the same channel. All assets and `SHA256SUMS` are
attached to a draft before it becomes public. A rerun may complete a draft but
refuses to replace a published release; ship a new version for corrections.

## Updates and data compatibility

The desktop checks GitHub after 15 seconds and every four minutes. Download and
installation require a user action. Settings, the command palette, the native
menu, and the update indicator use the same updater. Installing checkpoints all
open sessions and stops their processes as the app exits; processes do not
restart automatically.

`WORKSPACE_DATA_VERSION` in
[`packages/contracts/src/updates.ts`](../../packages/contracts/src/updates.ts)
describes compatibility of all persisted workspace data, including JSON records.
Increment it whenever an older release can no longer read that data, and add the
required migration. CI writes the value into the update manifest. Switching to
an older release is allowed only when its data version matches. A newer SQLite
`user_version` is refused before the app changes the database.

Before shipping the first update, test a signed installed release against its
successor in a disposable `SF_DATA_DIR`, including dirty buffers in multiple
worktrees and running processes. Check Keep working, successful restart,
Stable/Nightly switching, and failed downloads. Unit tests cannot verify
Squirrel.Mac's signature checks or notarization.
