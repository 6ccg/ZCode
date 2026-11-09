# Windows source bridge Sharp staging

The source CUA package keeps its placeholder identity and does not declare Sharp.
Its explicitly configured Windows runtime can nevertheless resolve Sharp from
`ZCODE_CUA_PLUGIN_ROOT` through `createRequire`. Dependency declarations alone
therefore cannot decide whether the packaged plugin needs Sharp.

`isSharpRequiredByComputerUse` owns the Sharp staging and afterPack gate. It reads
the nearest installed CUA manifest through `readComputerUseProducer` and accepts
the build's `targetPlatform` and environment:

- Existing Sharp declarations in dependencies, optionalDependencies or
  peerDependencies retain their existing behavior.
- A placeholder with the Windows broker capability requires Sharp only when the
  shared `isWindowsComputerUseHelperEnabled` gate accepts the win32 target and
  explicit external JavaScript runtime and helper inputs.
- Missing CUA packages, ordinary placeholders, missing/blank inputs and source
  bridges targeting macOS/Linux do not require Sharp. A missing target does not
  infer Windows from the build host. Legacy producers without Sharp declarations
  remain unchanged.

Agent bundle preparation and packaged verification pass the same target to this
gate. An enabled build stages the selected Sharp packages into each existing
official plugin root, including zcode-cua-plugin, where the external runtime
resolves them. Missing native packages fail staging, not silently disable CUA.
For the source Windows bridge, all Sharp packages come from the explicitly
supplied helper's flat node_modules tree, using the same runtime-package-dir
before dev-root precedence as helper preparation. Resolve that root to a physical
absolute directory and require contained, unlinked package directories and
matching package identities. Do not silently combine helper and desktop packages
or fall back to an ancestor's node_modules. Resolve the entire required set before
changing output. Legacy producer staging continues to use desktop dependencies.
Development staging forwards its explicit environment to this resolver.

This source selection is not helper acceptance: the separate helper preparation
and packaged verification must still pass manifest/hash/architecture/Electron and
dependency-tree checks. The existing build sequence may stage plugin assets before
that validation and must abort rather than release if helper validation fails.
Nested runtime files must survive copying, including Sharp lib/ and the Windows
native package lib/ directory. Windows libvips DLLs accompany the native addon
inside @img/sharp-win32-{arch}; there is no separate Windows libvips package.

Verification continues to inspect the plugin-local Sharp manifest, JavaScript
lib directory, native addon and libvips files. It does not execute external
JavaScript or native binaries, establish Windows compatibility, or grant rights
to redistribute supplied artifacts. Synthetic fixture files cover gate selection,
target-specific staging and missing-addon/DLL failures on Linux without claiming
native Windows acceptance.
