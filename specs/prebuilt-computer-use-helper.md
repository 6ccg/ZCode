# Prebuilt Computer Use helper adaptation (partial, unverified natively)

## Scope and ownership

The Windows resource preparer accepts an explicitly supplied, already packaged
`@zcode/zcode-cua-helper-runtime` directory as well as the existing canonical
source producer. This supports the layout distributed by ZcodePro without
copying its runtime or proprietary native binaries into this repository.
It does not make the open-source broker placeholders into a working producer.
The producer-detection gate and the experimental macOS AX backend are unchanged.

The resource preparer owns validation and atomic staging. The supplied helper
continues to own its existing connection and authorization behavior. Its JavaScript
and addon bytes are never patched. No environment variable that changes peer or
launcher trust is added, and no app settings or permissions are changed.

Explicit source directory -> strict manifest/PE/hash/dependency validation ->
immutable entry/addon snapshots -> temporary staging -> revalidation -> atomic
replacement. Invalid input must leave any previous output untouched.

Only entry/addon bytes are immutable snapshots. Dependency inputs must remain
stable during staging: linked files are rejected, copies do not dereference
links, and each dependency's physical path is checked before and after copying.
These checks detect observed directory swaps; they are not an atomic snapshot of
the entire dependency tree against a fully adversarial concurrent filesystem.

## Input and compatibility contract

- Select the directory using the existing `ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR`
  or `ZCODE_CUA_DEV_ROOT` input. Do not search for or download third-party files.
- Require the existing v1 manifest, `@zcode/zcode-cua` manifest identity, a
  matching module package version/main, target platform/architecture, canonical
  relative artifact paths, SHA-256 hashes, PE machine and a self-contained
  Express/Sharp dependency closure. Keep realpath and symlink checks intact.
- Preserve the manifest's Electron version. Never relabel an Electron 41 bundle
  as tested on Electron 44. A version difference stops staging with an explicit
  native-validation requirement, not a claim that Node-API is incompatible.
- Dependency metadata and hashes establish consistency, not publisher identity,
  licensing, code safety or a native compatibility result.
- Public redistribution of any supplied helper requires separately established
  rights. This change adds no vendor code, helper download, CI upload or binary.

## Verification and remaining work

Linux tests cover both source/prebuilt layouts, byte preservation, damaged hashes,
wrong versions/architectures, path escapes, missing dependencies, unchanged output
on failure and final packaged verification. These are static packaging tests only.

The reference Windows bundle currently declares 0.6.4, x64 and Electron 41.0.3;
this checkout uses Electron 44.7.0. Real Windows tests must establish addon loading,
startup/health, screenshot/input and stop/restart under the target Electron before
any compatibility change. Windows ARM64 needs a separate matching native addon.

macOS work is limited to official download/provenance inspection until a supported
macOS environment is available. Do not adopt patches that change compiled trust
flags, remove launcher verification, strip quarantine or re-sign to evade checks.
Normal integration requires an authorized, validly signed helper/launcher flow.
Neither Linux inspection nor the upstream reference's past device test proves
that this fork works on macOS. The user's requested native validation is pending.

## Official macOS artifact inspection (2026-11-08 UTC)

The matching official [3.17.2 arm64 archive](https://cdn-zcode.z.ai/zcode/electron/releases/3.17.2/macos-arm64/ZCode-3.17.2-mac-arm64.zip)
was downloaded separately and its SHA-512 matched the [official release manifest](https://zcode.z.ai/api/v1/releases/electron/manifest?platform=darwin-aarch64&channel=1).
Its SHA-256 is `7f95b42d2066d4633c95d117c67f124a1499d9832060a58ccd53d0a43f4a06ab`.
The original helper executable SHA-256 is
`36ba7e600dce3cc715bdf278459fedb89eb9622dfbd8278abe9811f0717cad2b`.

Static metadata: bundle `dev.zcode.cua-helper`, build `pipeline-326130-a2d1ba73`,
arm64 executable/addon and embedded broker IPC version 3. The referenced ZcodePro
client uses IPC v2; backward compatibility is not runtime-verified. The original
compiled unsigned-launcher gate remains false. A code-signature resource exists,
but Linux inspection does not establish a valid Apple signature or notarization.
No helper-level redistribution license was located in the archive. The downloaded
artifacts remain outside this repository and were never executed or patched.
