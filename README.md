# monster-rpg-core

Independent TypeScript ESM library for original monster RPG state and controlled battle integration. F0–F9 accepted; initial release commit `8ce567e09edf82d8df9a802d8b3b6b8532758d62`. P1 performance and P2 readability/module-build changes passed independent review. This is not a production battle engine or complete Pokémon mechanics.

Pinned **Node 24.19.0 / npm 11.9.0**, TypeScript **7.0.2**, Vite **8.3.1**, @types/node **24.10.1**, Prettier **3.9.9** (development only). No runtime dependencies. From the extracted source directory:

```sh
npm ci --registry=https://registry.npmjs.org --cache=/tmp/monster-rpg-npm-cache
npm run format:check
npm run typecheck
npm run build
npm run build:types
npm test
npm run test:types
node examples/acceptance.mjs
node scripts/test-package.mjs
```

An empty npm cache needs registry access. Choose a writable cache; `npm ci` preserves locked versions. Vite clears `dist`: build JS before declarations. Runtime/type tests consume built exports. Negative fixtures require exactly one expected diagnostic without suppression. The package check uses a temporary local tarball consumer, offline installation, real state/save operations and declarations without Node/DOM types; it checks all 27 runtime exports and cleans its temporary directory. It does not publish.

```ts
import {
  loadSpeciesCatalog, createMonsters, createOwnership, admitMonster,
  enableCollection, EncounterSession,
} from 'monster-rpg-core';
const catalog = loadSpeciesCatalog([{ id: 'mossling', name: 'Mossling' }]);
const [monster] = createMonsters(catalog, [
  { id: 'one', speciesId: 'mossling', nickname: 'Moss' },
]);
if (!monster) throw new Error('Missing starter');
let state = enableCollection(createOwnership(catalog, {
  totalCapacity: 3, partyCapacity: 2,
}));
state = admitMonster(state, monster, {
  currentHP: 8, maxHP: 8, condition: null,
});
const game = new EncounterSession(state, {
  setup() { return { release() { return undefined; } }; },
});
const json = game.serialize(); // idle only; persist bytes in the host
game.restore(json);           // validates before installation
```

The starter adapter supports setup/release only. `examples/acceptance.mjs` runs two configurations × two controlled adapters through capture, storage, trainer restrictions, switch/medicine, XP/choices/evolution, flee, defeat recovery and save/reencounter. Assertions call the real public core. Smaller runnable examples: `encounters.mjs`, `battle-actions.mjs`, `complete-battle.mjs`, `growth.mjs`, `rewards.mjs`, `save-roundtrip.mjs`.

Three authority boundaries:

- Species/ownership functions validate ordinary JSON-like data and return detached frozen snapshots. Ownership is authoritative; party references owned IDs, storage is its complement. Creation checks batch IDs; admission checks all owned IDs. Optional training, inventory, collection, growth and reward rules belong to this same snapshot. Failed transitions leave inputs unchanged.
- `EncounterSession` owns current state. Publish idle transitions with revision-checked `commit`; active sessions block competing edits. Synchronous trusted local adapters own temporary combat state and provide validated complete checkpoints. Core does not simulate damage/AI/turns; checkpoints may contain enemy/end-turn effects. Local release must be idempotent; failed cleanup blocks further work.
- Host owns disk/DB, maps, presentation and engine lifetime. Controller `serialize`, `restore`, `newGame` are idle-only. [Save format](docs/save-format.md) describes embedded versions, validation and runtime invalidation.

Finite and no-resource moves, configurable capacities and growth tables are supported. Healing does not revive; growth/evolution retain absolute HP clamped to the new maximum, including zero. Learning/evolution choices require explicit ordered resolution. Each medicine/item-evolution invocation on returned state is a new action: same-item A→B→C may be valid successive evolutions, not a replay. Evolution-tag items must be configured at new-game setup: existing inventories cannot add definitions with `enableInventory`/`addItems`. No migration exists.

Battle deduplication retains the latest accepted receipt only in the current runtime lineage. Invalid engine-advanced confirmations fault without partial settlement. Abandonment releases locally and retains previous costs; it does not roll back an external engine. Captured/fled/aborted results receive no victory rewards. Trainer completion is once per durable state; new wild battles may reward again. Defeat recovery is explicit and fixes the pending party. Live/faulted/cleanup battles cannot be saved. Old-save rollback restores its old choices/history honestly; no cross-rollback/process exactly-once guarantee. Async/remote engines, combat saves, UI, authentic commercial formulas, breeding, equipment/economy and migrations are outside scope. Inputs are not a sandbox for hostile getters/proxies.

[Acceptance](docs/acceptance.md) maps B01–B15 to executed tests. See [F9 evidence](docs/F9-evidence.md), [review history](docs/review-history.md), [dependencies/licenses](docs/dependencies.md), and [task card](docs/tasks/F9.md). Preparation Skills retain their original provenance; the gameplay baseline now records its accepted status. Historical preparation hashes describe the original documents, not subsequent status edits. No project distribution license has been selected; package remains private.

Internal TypeScript imports are extensionless under Bundler resolution. Generated
.d.ts module paths use .js so NodeNext consumers work too; Node-run .mjs scripts
retain explicit .mjs imports. Vite builds JS, then build:types emits and corrects
declarations. Use npm run format to format maintained code. See [build details](docs/build.md).

Run `node scripts/benchmark-ownership.mjs` after building. It measures median heal
and switch times for 100/500/1000 species and owned creatures, with a fixed party
of two, three warmups and nine samples; fixture setup is excluded. P1 removes
per-owner catalog copying while retaining input/output validation. Timing is
machine-dependent, not a correctness threshold or proof of linear battle scaling;
the remaining switch cost is unprofiled. [P1 evidence](docs/tasks/P1.md) records
same-environment before/after results; [P2 evidence](docs/tasks/P2.md) records the
formatting and package-consumer checks.
