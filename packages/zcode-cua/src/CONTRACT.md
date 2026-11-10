# Bundled Computer Use adapter

Owns contained loading of the fixed private runtime through the package's existing
runtime factory. Public entrypoint: external-windows-runtime.js. No vendor code or
native implementation is committed in this source package.

The external-runtime adapter owns only contained public-module loading and
dispatch. The supplied runtime owns broker/session/frame behavior; the existing
services WindowsCuaHelperHost owns the native process. No vendor code is bundled
in this source package. See specs/bundled-computer-use.md.

Windows and macOS arm64 share contained runtime loading. macOS uses the bundled
Host bridge for LaunchServices, per-Host authentication and serial lifecycle;
macOS permission grants remain owned by the system.

The existing local Host owns the immutable admission transport shared with the
runtime. Acquisition and patches run only in the build tool; helper downloads
are disabled in the generated runtime. See specs/bundled-computer-use.md.
