import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { EncounterSession, healMonster } from 'monster-rpg-core';

// Fixed two-member party isolates catalog/ownership scaling from party scans.
const warmup = 3;
const samples = 9;
function fixture(size) {
  const catalog = Array.from({ length: size }, (_, i) => ({
    id: `species-${i}`,
    name: `Species ${i}`,
  }));
  const owned = catalog.map((species, i) => ({
    monster: { id: `owned-${i}`, speciesId: species.id, nickname: species.name },
    health: { currentHP: 5, maxHP: 10, condition: null },
  }));
  return {
    catalog,
    owned,
    totalCapacity: size,
    partyCapacity: 2,
    party: ['owned-0', 'owned-1'],
  };
}
function median(action) {
  for (let i = 0; i < warmup; i++) {
    action();
  }
  const times = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    action();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[Math.floor(samples / 2)];
}
const adapter = {
  setup() {
    return {
      execute(command) {
        return {
          generation: command.generation,
          commandId: command.commandId,
          revision: command.revision,
          outcome: 'continue',
          checkpoint: { ...command.checkpoint, activeId: command.action.targetId },
        };
      },
      release() {},
    };
  },
};
console.log(
  JSON.stringify({
    node: process.version,
    warmup,
    samples,
    statistic: 'median milliseconds',
    partySize: 2,
  }),
);
for (const size of [100, 500, 1000]) {
  const state = fixture(size);
  const session = new EncounterSession(state, adapter);
  session.begin(
    {
      kind: 'wild',
      candidates: [
        {
          monster: { id: 'enemy', speciesId: 'species-0', nickname: 'Enemy' },
          health: { currentHP: 10, maxHP: 10, condition: null },
          knownMoves: [],
          visible: true,
        },
      ],
    },
    0,
  );
  let healed;
  const healMs = median(() => {
    healed = healMonster(state, 'owned-0', 1);
  });
  const switchMs = median(() => {
    const actorId = session.checkpoint.activeId;
    session.act({
      kind: 'switch',
      actorId,
      targetId: actorId === 'owned-0' ? 'owned-1' : 'owned-0',
    });
  });
  assert.equal(healed.owned[0].health.currentHP, 6);
  assert.equal(state.owned[0].health.currentHP, 5);
  assert.deepEqual(session.state.owned, state.owned);
  console.log(
    JSON.stringify({
      catalogSize: state.catalog.length,
      ownedSize: state.owned.length,
      healMs,
      switchMs,
    }),
  );
}
