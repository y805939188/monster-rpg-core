# Save format v1

Only EncounterSession.serialize/restore/newGame are public boundaries. Core returns/accepts JSON text; host owns file reliability and any storage. An idle controller may contain unresolved choices or defeat recovery. Every non-idle phase rejects all three methods, including setup/executing/releasing callbacks and faulted/cleanup_failed sessions. Release/abandon first; no active engine is silently omitted to permit saving.

| Field | Meaning |
| --- | --- |
| format | Exact string monster-rpg-core-save |
| version | Exact envelope version 1 |
| contentVersion | Exact embedded content-schema version 1 |
| rulesVersion | Exact embedded rules-schema version 1 |
| state | Full normalized OwnershipState, including every enabled optional subsystem |
| counters.nextCommandId | Positive safe integer; preserved with max(current,saved) on restore |

Envelope and nested records reject unknown fields. Complete runtime state validation covers IDs/refs/party/capacity, finite safe numbers and bounds, resources, XP/level/HP, learning/evolution eligibility and FIFO counters, inventory/history, trainer flags and pending defeat recovery. Invalid JSON and unsupported versions reject. No migrations or partial recovery.

Catalog and all enabled JSON rules are embedded. References bind to those saved definitions; restore replaces the complete validated configuration/state rather than mixing it with currently loaded rules. Version1 describes supported schemas, not a content signature, tamper-proof hash, specific game edition or third-party engine compatibility. Hosts decide whether a save's self-contained game configuration is trusted. No functions, adapters or handles are in JSON.

Runtime-only revision/generation, last battle receipt/fault and engine checkpoint are omitted. Restore/newGame advance this controller's existing revision/generation, clear old last confirmation, and never reduce its next command sequence. Old confirm references and prepared commits with captured old revision reject. There is no exposed async engine callback API: tests cover synchronous reentrancy and stale confirm/commit, not invented asynchronous guarantees. Creating a different controller or rolling back snapshots is not global exactly-once protection.

Durable learning/evolution choice IDs and defeat request IDs/counters are saved. Restoring an older snapshot intentionally restores its then-pending choices. Resolve using fresh current state/revision; raw durable choice IDs alone are not a runtime token. Deliberately using a fresh revision with old data is trusted-host state replacement, not a stale-callback guard bypass claim.

Canonical serialize/restore/serialize is byte-stable when the destination command counter is not ahead. Rolling back within a controller can preserve a higher counter, so only that envelope counter differs intentionally. A valid saved MAX_SAFE_INTEGER next command counter remains exhausted: save/restore is allowed, action dispatch rejects; it is not silently reset. Unsafe/zero counters reject. Runtime revision/generation exhaustion also blocks replacement before changing any state.

On failed restore/newGame, existing state object/revision/runtime guards/last receipt remain unchanged. On success there is no live handle, all new durable data is detached/frozen, and the adapter supplied to the controller remains its out-of-band runtime dependency.
