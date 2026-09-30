import { pathToFileURL } from 'node:url';
import { EncounterSession, enableInventory, addItems } from 'monster-rpg-core';
import {
  actionExampleFixture,
  scriptedActionAdapter,
  checkpointActionAdapter,
} from './battle-actions.mjs';

export function completeFixture(none = false) {
  const f = actionExampleFixture(none);
  let state = enableInventory(f.state, {
    stackCapacity: 5,
    stackLimit: 5,
    items: [
      { id: 'reed-orb', name: 'Reed Orb', effect: { kind: 'capture' } },
      { id: 'moss-tonic', name: 'Moss Tonic', effect: { kind: 'heal', amount: 4 } },
      { id: 'dawn-drop', name: 'Dawn Drop', effect: { kind: 'revive', amount: 3 } },
      { id: 'clear-dew', name: 'Clear Dew', effect: { kind: 'clearCondition' } },
      { id: 'echo-dew', name: 'Echo Dew', effect: { kind: 'restoreResources' } },
    ],
  });
  for (const id of ['reed-orb', 'moss-tonic', 'dawn-drop', 'clear-dew', 'echo-dew']) {
    state = addItems(state, id, 3);
  }
  return { ...f, state };
}
export const capture = (success) => ({
  kind: 'capture',
  actorId: 'one',
  targetId: 'enemy',
  itemId: 'reed-orb',
  success,
});
export const flee = (success) => ({ kind: 'flee', actorId: 'one', success });
export const medicine = (actorId = 'one', targetId = 'one', itemId = 'moss-tonic') => ({
  kind: 'medicine',
  actorId,
  targetId,
  itemId,
});
export const move = {
  kind: 'move',
  actorId: 'one',
  targetId: 'enemy',
  moveId: 'mosschime',
};
export function baseCheckpoint(f) {
  return {
    party: f.state.owned.map((entry) => ({
      ...structuredClone(entry),
      knownMoves: structuredClone(
        f.state.training.individuals.find((m) => m.instanceId === entry.monster.id)
          .knownMoves,
      ),
    })),
    opponents: f.config.candidates.map(({ monster, health, knownMoves }) =>
      structuredClone({ monster, health, knownMoves }),
    ),
    activeId: 'one',
  };
}
// Hand-authored frames and scripted deltas are separate sources, with the same public core.
export function runCompleteExample() {
  const results = [];
  for (const mode of ['script', 'frames']) {
    const f = completeFixture();
    const first = baseCheckpoint(f);
    first.party[0].knownMoves[0].remaining = 2;
    first.opponents[0].health.currentHP = 7;
    const failed = structuredClone(first);
    failed.party[0].health.currentHP = 8;
    const captured = structuredClone(failed);
    captured.opponents[0].health.currentHP = 5;
    captured.opponents[0].health.condition = 'weary';
    const adapter =
      mode === 'script'
        ? scriptedActionAdapter([
            { damage: 3 },
            { actorHP: 8 },
            { targetHP: 5, targetCondition: 'weary', outcome: 'captured' },
          ])
        : checkpointActionAdapter([
            { checkpoint: first, outcome: 'continue' },
            { checkpoint: failed, outcome: 'continue' },
            { checkpoint: captured, outcome: 'captured' },
          ]);
    const wild = new EncounterSession(f.state, adapter);
    wild.begin(f.config, 0);
    wild.act(move);
    wild.act(capture(false));
    wild.act(capture(true));
    const trainerState = {
      ...f.state,
      owned: f.state.owned.map((e) => ({ ...e, health: { ...e.health, currentHP: 6 } })),
    };
    const switched = baseCheckpoint({ ...f, state: trainerState });
    switched.activeId = 'two';
    const applied = structuredClone(switched.party[1]);
    applied.health.currentHP = 10;
    const treated = structuredClone(switched);
    treated.party[1].health.currentHP = 8; // medicine then enemy retaliation
    const trainerAdapter =
      mode === 'script'
        ? scriptedActionAdapter([{}, { actorHP: 8 }])
        : checkpointActionAdapter([
            { checkpoint: switched, outcome: 'continue' },
            {
              checkpoint: treated,
              outcome: 'continue',
              medicine: { before: switched.party[1], after: applied },
            },
          ]);
    const trainer = new EncounterSession(trainerState, trainerAdapter);
    trainer.begin({ kind: 'trainer', opponents: f.config.candidates });
    for (const action of [capture(true), flee(true)]) {
      let rejected = false;
      try {
        trainer.act(action);
      } catch {
        rejected = true;
      }
      if (!rejected) {
        throw Error('Trainer rule was not enforced');
      }
    }
    trainer.act({ kind: 'switch', actorId: 'one', targetId: 'two' });
    trainer.act(medicine('two', 'two'));
    trainer.release();
    const fleeFailed = baseCheckpoint(f);
    fleeFailed.party[0].health.currentHP = 8;
    const fleeSuccess = structuredClone(fleeFailed);
    fleeSuccess.party[0].health.currentHP = 6;
    const fleeing = new EncounterSession(
      f.state,
      mode === 'script'
        ? scriptedActionAdapter([{ actorHP: 8 }, { actorHP: 6, outcome: 'escaped' }])
        : checkpointActionAdapter([
            { checkpoint: fleeFailed, outcome: 'continue' },
            { checkpoint: fleeSuccess, outcome: 'escaped' },
          ]),
    );
    fleeing.begin(f.config, 0);
    fleeing.act(flee(false));
    fleeing.act(flee(true));
    results.push({
      adapter: mode,
      escapedHP: fleeing.state.owned[0].health.currentHP,
      capturedHP: wild.state.owned[2].health.currentHP,
      storage: !wild.state.party.includes('enemy'),
      orbs: wild.state.inventory.stacks.find((e) => e.itemId === 'reed-orb').count,
      trainerHP: trainer.state.owned[1].health.currentHP,
      tonic: trainer.state.inventory.stacks.find((e) => e.itemId === 'moss-tonic').count,
    });
  }
  return results;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(runCompleteExample()));
}
