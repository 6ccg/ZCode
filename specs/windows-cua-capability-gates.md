# Windows source broker build capability

The installed CUA package may retain `zcodeCuaPlaceholder: true` while declaring
`zcodeCuaRuntimeCapabilities.windowsBroker: true`. This declares source broker
bridge code only (the implementation is supplied externally), not native helper availability, compatibility, provenance or validation.
The existing real-producer predicate and macOS behavior remain unchanged.

A single Windows helper gate owns build/dev eligibility: the target must be win32
and either the installed legacy real producer is present, or the installed package
explicitly declares the Windows broker and a nonblank
`ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR` or `ZCODE_CUA_DEV_ROOT` is supplied, together
with a nonblank `ZCODE_CUA_RUNTIME_PACKAGE_DIR` for the external JS runtime.
Eligibility does not validate artifacts. The existing Windows preparation pipeline
must still validate manifests, hashes, containment, PE architecture and Electron ABI.
Packaging uses the same gate to include resources and run afterPack verification.
Linux/macOS targets never include Windows helper resources. Missing helpers leave
source builds unavailable and skip helper staging; explicit malformed helpers fail
validation rather than falling back to the placeholder checkout.

Development preserves explicit helper inputs. A source Windows broker does not
inject macOS helper variables or default DEV_ROOT to its source checkout. Native
plugin dependency staging uses the Windows gate, retaining the legacy producer
path on supported hosts. No binaries are committed or downloaded by these gates.

Regression evidence covers legacy/placeholder/missing installs, strict boolean
capability, explicit/blank helper inputs, non-Windows targets, shared prepare and
packaging gates, and development staging skips. Mock/gate tests do not establish
Windows native operation or legal permission to redistribute supplied artifacts.

The external JS runtime stages into bundled-tools/win32-{arch}/zcode-cua and
packages into resources/tools/zcode-cua. Staging validates @zcode/zcode-cua identity,
a nonblank version, canonical public JS export targets (no empty, dot or parent
path segments) and physical containment without importing code.
Only JS/CJS/MJS/JSON is copied (including vendor), preserving LICENSE/NOTICE
when supplied. Native binaries, symlinks, node_modules, and declared external npm
dependencies are rejected. Declarations and other documentation are not runtime assets. Preparation and
packaged verification validate this tree; this is structural evidence only and does
not establish licensing or native compatibility. External trees are never committed.

Static dependency graph validation parses supplied JS without running it. Literal
ES imports/re-exports and import() must resolve to staged files within the package
or recognized Node builtins. Missing files, graph escapes, bare npm ESM imports,
and computed import() fail. ESM relative imports require exact staged filenames.
Unconditional literal require() and named createRequire alias calls are also
checked, permitting CommonJS .js/.cjs/.json/index.js/index.json resolution.

This establishes the static ESM closure, not proof of complete runtime dependencies.
The manifest must have no declared npm dependencies. Conditional or caught require calls are optional host dependencies and are
not asserted present. Computed createRequire alias calls, factory-returned loader
calls and runtime-generated code are not resolved. Plain computed require() is
unsupported and rejected. No external code or code-generation strings execute.
The supplied reference uses a caught Express lookup and dynamically resolves Sharp
from ZCODE_CUA_PLUGIN_ROOT; successful staging does not prove these host dependencies
are available. Their Windows runtime/plugin validation remains a separate gate.
