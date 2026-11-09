# Windows external CUA runtime bridge

## Scope

Windows can use the existing ZcodePro JavaScript runtime through an explicit
`ZCODE_CUA_RUNTIME_PACKAGE_DIR` or the packaged `resources/tools/zcode-cua` tree.
The helper is a separate input, validated by the Windows runtime resolver.
Neither vendor JavaScript nor native binaries are committed to this repository.
The local package retains `zcodeCuaPlaceholder` for unsupported official surfaces
and declares the narrower `zcodeCuaRuntimeCapabilities.windowsBroker` capability.

The bridge delegates the complete existing runtime, broker, lifecycle and frame
contracts. It does not approximate element indices, transform raster coordinates,
invent authentication or change the helper's existing Windows peer policy. Tool
results, errors, cancellation signals, session cleanup and frame metadata pass
through unchanged. Native compatibility is still a separate verification stage.

## Loading and ownership

An explicit runtime root takes priority; invalid configuration never falls back
to another directory. Only canonical contained JavaScript paths declared by the
external package's public export map may load. Require package name
`@zcode/zcode-cua`, module type, a nonempty version and a non-placeholder bundle.
The bundle declares no npm dependencies. Packaging checks static JavaScript
imports; optional/computed host dependencies remain a separate contract. Sharp
comes from the explicit helper's dependency tree and is staged at the CUA plugin
root. See [capability gates](windows-cua-capability-gates.md) and
[Sharp staging](windows-cua-sharp-staging.md).
Local input is trusted executable code supplied for this task; structural checks
do not establish publisher authenticity or redistribution rights.

The public factory/class interfaces are synchronous. The bridge uses Node's
synchronous module loader with small, cached manifest/path checks, not a network
loader or a helper download. Other platforms never load the external runtime.
The independent experimental macOS AX opt-in continues to work unchanged.

Desktop local Host -> existing WindowsCuaHelperHost -> validated helper process
-> named-pipe broker -> node_repl runtime -> original session/observation/frame
logic. Host remains the helper process owner. No second native launcher is added.
The absolute external runtime root is propagated to the local Agent/node_repl;
remote workspaces and subagents retain their existing admission restrictions.

The compatibility cold start happens only at admitted local MCP preparation.
Startup errors remove CUA MCP candidates and preserve unrelated servers; explicit
restart calls still report the original error. Candidate recognition is a local,
pure fail-closed filter and must not require loading a healthy external runtime.

Missing runtime configuration retains the unavailable surface. Explicitly enabled
calls with a malformed runtime fail with a diagnostic; no fallback rewrites paths,
changes signing/trust flags or installs software. Packaging requires both external
JavaScript and helper inputs for this bridge, not merely a capability flag.

## Verification

Linux fixtures must exercise the actual package entrypoints with a dependency-free
fake external ESM runtime: factory/execute/close/dispose, broker requests/health,
MCP resolver/lifecycle constructors, frame preservation and permissions predicates.
Check unconfigured/non-Windows defaults, invalid paths/manifests/exports, public
function shape and no fallback. Exercise the current Windows helper host using a
fake child and transport where possible. No fixture test counts as native Windows
execution or proves Electron 41-to-44 compatibility.

## Linux verification record (2026-11-09 UTC)

The inspected reference is ZcodePro commit
`c81950cb6dbdb4e1529879174632b3909cca26f8`. A static local rehearsal staged and
verified its 14 JavaScript files, existing x64 helper with its declared Electron
41.0.3 manifest, and five Sharp packages at the plugin root. Entry/addon bytes and
the helper's connection policy were unchanged. The target Electron 44.7.0 check
correctly stopped with a native-validation requirement. Temporary staged files
were removed; no reference JavaScript or native binary was executed or committed.

Tests exercise synthetic runtime/transport/artifact fixtures, including a
CommonJS-bundled source adapter loading a fake external ESM runtime. The CUA
suite, focused packaging tests, CLI environment forwarding, architecture checks,
CUA declarations and node-repl-host typecheck/build passed. Full-tree
`pnpm typecheck` was killed by the execution environment with exit 137, so it is
not a passing gate. Root lint reported zero errors and 84 existing warnings.
The environment used Node 24.22.1 and pnpm 10.33.2; the repository pins Node 24.14.0.

Real Windows startup/health/input/screenshots/stop, target Electron compatibility,
release signing and macOS signature/TCC/GUI acceptance remain pending. No result
in this record establishes native usability or redistribution permission.
