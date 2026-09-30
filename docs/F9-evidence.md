# F9 validation and final review handoff

Historical F9 handoff evidence; F0–F9 are now accepted in initial release 8ce567e09edf82d8df9a802d8b3b6b8532758d62. The following file-identity and execution claims describe the F9 snapshot, not later P1/P2 changes. No new domain implementation. All 17 production source files and package-lock.json remain byte-identical to accepted F8. The F8 manifest was verified before work. Applied project baseline Skill to B01–B15 coverage, transactions Skill to integrated failure/replay boundaries, review Skill to final source/tests/evidence and narrow scope. Library Skill used for requested deliverables.

Actual environment: Node v24.19.0, npm 11.9.0, TypeScript 7.0.2, Vite 8.3.1, @types/node 24.10.1. Exact versions retained. Commands executed separately, in order, on 2026-09-30:

| Command | Actual result |
|---|---|
| `npm ci --registry=https://registry.npmjs.org --cache=/tmp/monster-rpg-f9-fresh-cache --fetch-retries=0 --fetch-timeout=20000` | Exit 0; added 21 packages in 2s, task-specific writable cache, registry enabled (not an offline install). Lockfile unchanged. |
| `npm run typecheck` | Exit 0. |
| `npm run build` | Exit 0; Vite 8.3.1, 18 transformed modules, dist/index.js 56.99 kB. |
| `npm run build:types` | Exit 0; all declaration files emitted after JS build. |
| `npm test` | Exit 0; 114 passed, zero failed/skipped/cancelled. Includes four new complete-flow configurations and all 110 F8 tests. |
| `npm run test:types` | Exit 0; positive plus ten precise negative fixtures PASS. |
| `node examples/encounters.mjs` | Exit 0; two setup/release adapters. |
| `node examples/battle-actions.mjs` | Exit 0; two move/switch adapters. |
| `node examples/complete-battle.mjs` | Exit 0; two adapter medicine/capture/flee/trainer branches. |
| `node examples/growth.mjs` | Exit 0; two growth/resource variants. |
| `node examples/rewards.mjs` | Exit 0; two reward/recovery variants. |
| `node examples/save-roundtrip.mjs` | Exit 0; stable true, captured HP5/max11, level2, two orbs. |
| `node examples/acceptance.mjs` | Exit 0; four complete flows, nine dispatched actions each; final HP [2,2,5] or [5,8,2], levels [3,3,1], finite resource2 or null, tonic2. |
| `node scripts/test-package.mjs` | Exit 0; isolated npm pack + offline tarball installation, runtime ownership/party/heal/save flow PASS, all 27 runtime exports match root declarations, strict consumer typecheck with ES2022 and types:[] PASS. Package includes 20 files (JS, 17 declarations, README, package.json); temporary consumer/cache/tarball removed. |

Package checker was rerun after final README update: tarball 19,366 bytes. Only source archive/review packet are delivered; generated dist and test tarballs are reproducible outputs. Initial checking exposed unwritable default npm cache and unavailable legacy TypeScript compiler API; checker now uses its own temporary cache and examines this project's explicit named root exports. An initial example invocation used the wrong filename `save.mjs`; corrected `save-roundtrip.mjs` passed. These were verification-script/command corrections, not suppressed core failures.

Source audit: all ordinary imports, type imports and reexports are relative core modules; no external dynamic imports, engine/DOM/fs runtime dependency or diagnostic suppression. Consumer declarations compile without Node/DOM types. package.json has no runtime dependencies. Installed direct metadata and all 63 lockfile dependency entries (including absent platform optional packages) are inventoried in dependencies.md. No project distribution license was supplied; package remains private. No commit/push/npm publication occurred; branch remains unborn and deliverables use file hashes.

Self-review found no scope expansion: F9 adds one acceptance example, four tests, one temporary package-consumption script and documentation only. Integrated assertions check same-reference/revision/dispatch-count atomic failures, exact latest replay, old/conflicting confirmations, total-capacity refusal, ordered pending choices, non-healing growth, explicit recovery and idle roundtrip. Prior fault/release/forged-state tests remain executed. Adapters are controlled examples, not production engines; deterministic fixture assertions are hand-specified. No asynchronous or remote-engine guarantee, disk durability, battle save, migration, cross-rollback deduplication, anti-cheat or commercial-formula equivalence is claimed.

Deliverable selection includes current src/tests/examples/scripts, Skills, package+lock/config, README/AGENTS, task contracts, original preparation manifest, current save/acceptance/dependency/review documentation and this evidence. Excludes .git, node_modules, caches, generated dist, credentials, obsolete full review copies and temporary outputs. Existing recoverable repository files are preserved. Public-file audit found no account records, private correspondence, credentials or machine-specific private paths in selected current documentation/source; generic temporary command paths and policy prohibitions are not private records. Historical task cards describe their stage gates; review-history.md records final accepted gates.

The source ZIP and full review packet share docs/F9-files.sha256 (selected authored files, excluding that manifest itself). Its SHA-256 is the final source snapshot identifier. The packet includes every selected file including package-lock.json, generated declarations for inspection, reviewed F8 predecessor contents and exact diffs for changed/new final files. Historical full packets/manifests omitted from source ZIP are not represented as current independently reverified files.

Remaining gate: independent F9 review of this exact snapshot and packet. No next feature implementation; stop REVIEWING. Actual engine integration and project license selection remain outside this acceptance's implementation scope.
