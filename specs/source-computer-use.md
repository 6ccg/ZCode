# Independent source Computer Use (experimental macOS AX)

## Scope and provenance

The 3.17.2 source distribution retains its Apache-2.0 SDK and per-call authenticated
node_repl bridge. It does not import ZcodePro's extracted runtime, native helper,
signing changes, or installer. The independent backend uses macOS System Events
through the system osascript executable. No official account is required. Model
API credentials remain in the existing provider configuration, never in the helper.

This is an explicit opt-in AX subset, not feature parity: list apps, observe a
foreground application's bounded accessibility tree, set an exposed value and
perform an exposed accessibility action. Screenshots, coordinate input, keyboard,
clipboard, drag, background control and other platforms fail explicitly closed.
The existing official-helper placeholder and packaging flag remain intact.

## Activation and consent

An enabled Computer Use plugin plus ZCODE_CUA_SOURCE_BACKEND=macos-ax selects the
source runtime. Otherwise the distribution's previous unavailable behavior stays.
Every observation/action requires a local native consent dialog. The backend
never grants TCC, changes security settings, downloads helpers or modifies signing.
Cancel/denial never dispatches input. Password/protected elements and automation/
permission UI are excluded. The consent dialog states the target and operation.
Users grant Automation/Accessibility in macOS themselves if required.

## Ownership and ordering

Authenticated call ledger -> runtime admission -> local consent -> foreground and
fresh snapshot validation -> native action -> receipt. Runtime owns the single
controller lease and session observations within one node_repl host process.
Backend owns OS observations/dispatch. Cross-process controller arbitration is not
implemented; do not enable this experimental adapter in multiple simultaneous hosts.
Session identity includes workspace and session ID; remote sessions and subagents
are rejected. No socket endpoint or unauthenticated HTTP server is introduced.

Mutations are serialized, require a previously observed app, and consume that
observation even after an uncertain dispatch. No automatic action retries. Stop,
close and dispose revoke the lease and invalidate queued work before it executes.
After cancellation, delayed observations cannot re-establish a revoked session.
The backend validates a complete bounded AX snapshot before and after consent.
This detects changed trees, but is not a native stable element-identity guarantee;
identical replacement elements remain a limitation of the experimental adapter.

## Verification

Deterministic tests must cover opt-in, platform rejection, consent cancellation,
remote/subagent rejection, session isolation, lease contention, stale observations,
unsupported tools, action receipts, stop/dispose and queued cancellation. Native
macOS ARM verification is a separate required stage: permissions denied/granted,
TextEdit AX observe/set value, cancelled confirmation, changed/closed target,
foreground switch, repeated calls and stop. Linux mock tests do not prove these
native behaviors and must not be reported as a complete port or real-device pass.
