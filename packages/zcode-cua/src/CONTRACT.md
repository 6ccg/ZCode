# Source Computer Use

Owns local-only experimental AX runtime admission, controller lease and observations.
Public entrypoint: source-runtime.js, called by the package's existing runtime factory.
The AX native adapter owns consent and OS effects, without an official helper,
credentials or sockets.
See specs/source-computer-use.md for lifecycle, constraints and validation requirements.

The Windows external-runtime adapter owns only contained public-module loading and
dispatch. The supplied runtime owns broker/session/frame behavior; the existing
services WindowsCuaHelperHost owns the native process. No vendor code is bundled
in this source package. See specs/windows-external-runtime-bridge.md.
