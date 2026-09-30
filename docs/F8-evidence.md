# F8 evidence — 2026-09-30

Status PASS. Independent source/contract review accepted. F9 NOT STARTED. Small save/restore boundary only; no storage I/O, migration, async platform, extra agents or commit/push/publication.

## Accepted dependency

Before F8, verified final F7 manifest SHA-256 b2202bc55b30154efeb458b67df2ebb5b6b9fc84c87514a32a407636a86335a6 and all listed files unchanged. F7 independent re-review PASS verified 107 sections, 16 diffs, 58 current included entries and 50 prior entries; 32 historical/setup entries omitted. Recovery defect fixed at four return sites, 15 other source modules byte-identical. 101 tests/builds/types/three examples remain implementing-agent execution. Recorded final F7 PASS accurately.

Applied approved baseline B15, transactions and review Skills. Task card and format contract before implementation. New save.ts is a small versioned JSON encoder/parser reusing full validState. Its functions are internal, not public package exports; public SaveData is readonly type only. EncounterSession adds serialize/restore/newGame with idle phase checks and atomic replacement, retaining adapter out of band. No other domain source changed. Existing calls and outcome settlement remain compatible.

## Actual separate final executions

| Command | Result |
| --- | --- |
| npm run typecheck | exit 0 |
| npm run build | exit 0; Vite 8.3.1; dist/index.js 56.99 kB, gzip 13.05 kB |
| npm run build:types | exit 0 |
| npm test | exit 0; 110 passed, 0 failed (9 F8 + 101 prior) |
| npm run test:types | exit 0; positive and ten negative fixtures PASS |
| node examples/save-roundtrip.mjs | exit 0; stable true, owned [one,two,enemy], capturedHP5, capturedMaxHP11, level2, orbs2 |
| node examples/rewards.mjs | exit 0; both prior growth/recovery variants unchanged |
| node examples/growth.mjs | exit 0; prior finite/no-resource results unchanged |
| node examples/complete-battle.mjs | exit 0; both prior adapter outputs unchanged |

New negative-save fixture requires exactly TS2540 at (3,8), readonly version, compiler exit1; no blanket suppression. Positive fixtures use actual public controller signatures and readonly format type. Commands are implementer evidence, not independent reviewer execution. Node24.19.0/npm11.9.0/TypeScript7.0.2/Vite8.3.1/@types/node24.10.1 pinned unchanged; no install/config/lock changes or new clean-install claim. Source scan found no any/casts/suppression, node/fs/engine dependencies or dynamic imports; no new dependency.

## Self-review PASS

Complete normalized state includes catalog/owned/party/storage/HP/conditions, optional training resources/choices/counters, inventory/history, growth/evolution choices/counters and battle reward flags/pending recovery/counter. Self-contained embedded rules bind refs; exact envelope/content/rules schema versions reject unknowns. They are not cryptographic authenticity. Adapter/handles/functions/runtime revision/generation/last receipt are not serialized. Only nextCommandId is saved from controller process state, retained as max(current,saved) to avoid reuse locally.

Restore parses and validates before installation; replacement then increments current revision and nonserialized generation, clears old confirmation/fault, and keeps adapter. All non-idle phases reject save/restore/newGame without discarding handles. Pending choices/recovery are legal idle saves. Tests demonstrate full byte-stable roundtrip and public post-capture/growth example; restored learning/evolution choices resolve once per current lineage; pending recovery resumes explicitly; old revision prepared updates and old confirmations reject after restore/newGame. Failed restore preserves state/reference/revision/receipt and next action's expected generation/command sequence.

Malformed cases include corrupt JSON, bad/unknown version/fields, unknown species/moves/history/trainer refs, duplicate owned IDs/party, HP/resource/XP bounds, invalid learning/evolution order/eligibility/counters, bad inventory/recovery and unsafe command counters. MAX_SAFE_INTEGER saved sequence remains exhausted without dispatch/fault; no reset. Active/faulted/cleanup_failed refusal and setup/execute/release reentrancy are explicit public tests. All 101 earlier tests retained.

## Limits and handoff

No live battle serialization, no disk/DB durability or migrations. No asynchronous callback API; only actual synchronous phase and stale confirm/expectedRevision routes tested. Durable old choices can legitimately return on rollback and be resolved with fresh revision; raw pure choice IDs are not runtime tokens. A new independent controller is not a global receipt authority. Save integrity means complete schema/invariant/reference consistency under embedded definitions, not tamper detection. No size/performance/security-sandbox claims for arbitrary hostile input; ordinary JSON-like state remains the supported boundary. Private runtime revision/generation exhaustion guards exist but not exercised through billions of operations.

Rule configurations replace atomically as part of the save; no requirement to match the destination's former catalog. Canonical byte stability excludes deliberate preservation of a higher current command counter on rollback. NewGame never resets that controller's runtime counters. Host controls trusted deliberate state replacement and reliable storage.

Unborn branch, no commit hash. docs/F8-files.sha256 hashes authored files excluding itself/dist/node_modules; older manifests are historical. Packet includes full source/tests/config/lock/declarations, Skills/baseline, save-format/task/evidence and exact reviewed F7 inputs/diffs. Historical handoff was REVIEWING; subsequent independent PASS below authorizes F9.

Final F8 PASS: reviewer verified 99 section hashes, nine exact diffs, 63 current and 55 prior included entries; 35 historical/setup entries omitted. Narrow phase guards/full validation/atomic failure/runtime counter behavior accepted; 14 prior source modules unchanged. 110 tests/builds/types/four examples remain implementer execution. All authored files verified unchanged before F9.
