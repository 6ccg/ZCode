# Windows broker wire contracts

The public broker adapter keeps the supplied Windows runtime as the sole owner of
transport, authentication, helper execution and presentation processing. Every
delegated function receives the original arguments unchanged. On other platforms,
or without a configured runtime, parsing and response construction are pure local
operations; `callBrokerMethod`, `dispatchRequest` and `handleRequestLine` still
reject rather than opening a connection or invoking a backend.

The local wire contract matches the supplied runtime's public JavaScript entry.
Requests require a non-negative safe-integer numeric `id`, a nonempty string
`method`, and optional object `params` (not null or an array). Successful parsing
returns `{ ok: true, request }` with absent params normalized to `{}`. Validation
returns `{ ok: false, id, code: "invalid_request", message }`, preserving a valid
request ID and otherwise using `0`. It does not throw for malformed JSON.

Response constructors take the numeric request ID first. Success includes
`{ id, ok: true, result }`, normalizes a nullish result to null, and includes an
optional presentation without interpreting it. Failure includes
`{ id, ok: false, error: { code, message } }` and a shallow copy of nonempty error
details. Exceptions with a nonempty string code preserve that code, message and
details; other failures use code `internal`. Serialization appends one newline.

The supplied public `callBrokerMethod` wrapper consumes only socket path, method,
params and timeout. The underlying client's cancellation, authentication override
and presentation-observer options are not exposed by this wrapper version. The
adapter must not claim to implement them or replace the complete runtime with a
new raw RPC client. This contract changes neither Windows helper peer policy nor
the unavailable fallback's capability admission.

Regression evidence covers valid and invalid JSON, ID boundaries, params,
envelopes, exception classification, newline framing, unchanged argument forwarding
to a fixture runtime, and fail-closed fallback calls without backend execution.
Fixtures do not count as native Windows execution or vendor redistribution.
