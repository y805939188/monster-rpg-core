import { pathToFileURL } from 'node:url';
import {
  EncounterSession,
  enableGrowth,
  initializeGrowth,
  awardExperience,
  enableBattleRewards,
} from 'monster-rpg-core';
import { completeFixture, capture } from './complete-battle.mjs';
import { scriptedActionAdapter } from './battle-actions.mjs';

export function runSaveExample() {
  const f = completeFixture();
  const controller = new EncounterSession(
    f.state,
    scriptedActionAdapter([{ targetHP: 5, outcome: 'captured' }]),
  );
  controller.begin(f.config, 0);
  controller.act(capture(true));
  let next = enableGrowth(controller.state, {
    thresholds: [0, 5],
    species: [
      { speciesId: 'mossglow', maxHP: [10, 12], learnset: [], evolution: null },
      { speciesId: 'mistpod', maxHP: [10, 11], learnset: [], evolution: null },
    ],
  });
  next = awardExperience(initializeGrowth(next, 'enemy'), 'enemy', 5);
  next = enableBattleRewards(next, {
    wild: { experience: 0, items: [] },
    trainers: [],
    defeat: {
      penalty: [],
      recovery: { hp: { kind: 'full' }, clearCondition: false, restoreResources: false },
    },
  });
  controller.commit(controller.revision, next);
  const json = controller.serialize();
  const restored = new EncounterSession(f.state, scriptedActionAdapter([]));
  restored.restore(json);
  return {
    stable: json === restored.serialize(),
    owned: restored.state.owned.map((e) => e.monster.id),
    capturedHP: restored.state.owned[2].health.currentHP,
    capturedMaxHP: restored.state.owned[2].health.maxHP,
    level: restored.state.growth.individuals[0].level,
    orbs: restored.state.inventory.stacks.find((e) => e.itemId === 'reed-orb').count,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(runSaveExample()));
}
