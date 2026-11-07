# Releasing Superfluid

Releases are public GitHub Releases in `NikBelyaev/superfluid`. Only macOS is
currently supported: each release includes DMG and ZIP files for Apple Silicon and
Intel, signed with one persistent self-signed certificate. Users need no GitHub
account or token to update. These builds are not notarized by Apple; Gatekeeper
can require explicit approval for the first launch.

## Set up signing

Add these GitHub Actions repository secrets before the first release:

| Secret             | Value                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| `CSC_LINK`         | Base64-encoded `.p12` containing the release certificate and private key |
| `CSC_KEY_PASSWORD` | Password for that `.p12`                                                 |

The public certificate is pinned in `build/signing-cert.pem`. Keep the encrypted
`.p12` and its password backed up outside the repository. Never regenerate or
replace this certificate casually: installed apps require its signature when
accepting an update. Losing the private key prevents further updates of those
installs; a replacement certificate requires a planned transition or manual
reinstallation. This certificate expires in November 2036.

[`scripts/sign-mac.cjs`](../../scripts/sign-mac.cjs) signs the app and nested code
with the exact pinned identity and verifies the result. A mismatched `.p12`
fails the build. The custom signer avoids the default Apple trust-anchor lookup;
it does not disable signature verification of update payloads. The hardened
runtime remains enabled. Notarization and Apple's timestamp service are disabled;
no Apple Developer membership or API key is needed.

CI imports the `.p12` into a temporary keychain. Local signing can use the same
`CSC_LINK` and `CSC_KEY_PASSWORD`, or an unlocked `CSC_KEYCHAIN` that is in the
keychain search list. Do not add this certificate to system trust or disable
Gatekeeper globally. Local `pnpm dist` builds retain ad-hoc signing and have no
update feed; install a release manually once to start receiving updates.
Scheduled releases skip work until both signing secrets are present.

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
Squirrel.Mac's signature checks or Gatekeeper behavior on another Mac.
