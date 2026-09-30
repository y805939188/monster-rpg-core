import { pathToFileURL } from 'node:url';
import {
  EncounterSession,
  enableGrowth,
  initializeGrowth,
  reviveMonster,
  requestLearning,
  enableBattleRewards,
  resolveLearning,
  resolveEvolution,
} from 'monster-rpg-core';
import { growthFixture } from './growth.mjs';
import { scriptedActionAdapter } from './battle-actions.mjs';

export function rewardFixture(second = false) {
  const f = growthFixture(second);
  let state = {
    ...f.state,
    inventory: { ...f.state.inventory, stacks: [{ itemId: 'sunstone', count: 1 }] },
  };
  state = initializeGrowth(initializeGrowth(enableGrowth(state, f.rules), 'one'), 'two');
  state = requestLearning(reviveMonster(state, 'two', 3), 'two', 'bud');
  const rules = {
    wild: { experience: second ? 6 : 15, items: [] },
    trainers: [
      {
        id: 'reed-guide',
        reward: {
          experience: second ? 6 : 15,
          items: [{ itemId: 'sunstone', count: 1 }],
        },
      },
    ],
    defeat: {
      penalty: [{ itemId: 'sunstone', count: 1 }],
      recovery: {
        hp: second ? { kind: 'full' } : { kind: 'fixed', amount: 2 },
        clearCondition: second,
        restoreResources: second,
      },
    },
  };
  const opponent = {
    monster: { id: 'enemy', speciesId: 'sparkcub', nickname: 'Wild' },
    health: { currentHP: 10, maxHP: 10, condition: null },
    knownMoves: [],
    visible: true,
  };
  return {
    state: enableBattleRewards(state, rules),
    rules,
    wild: { kind: 'wild', candidates: [opponent] },
    trainer: { kind: 'trainer', trainerId: 'reed-guide', opponents: [opponent] },
  };
}
export const rewardMove = (id = 'one') => ({
  kind: 'move',
  actorId: id,
  moveId: 'bud',
  targetId: 'enemy',
});
export function resolveRewardChoices(session) {
  while (session.state.training?.pending.length) {
    const c = session.state.training.pending[0];
    session.commit(
      session.revision,
      resolveLearning(session.state, c.choiceId, c.instanceId, { kind: 'decline' }),
    );
  }
  while (session.state.growth?.pending.length) {
    const c = session.state.growth.pending[0];
    session.commit(
      session.revision,
      resolveEvolution(session.state, c.choiceId, c.instanceId, c.toSpeciesId, 'decline'),
    );
  }
}
export function runRewardExample() {
  return [false, true].map((second) => {
    const f = rewardFixture(second);
    const session = new EncounterSession(
      f.state,
      scriptedActionAdapter([{ damage: 2 }, {}, { damage: 8, outcome: 'victory' }]),
    );
    session.begin(f.trainer);
    session.act(rewardMove());
    session.act({ kind: 'switch', actorId: 'one', targetId: 'two' });
    session.act(rewardMove('two'));
    const levels = session.state.growth.individuals.map((e) => e.level);
    const choices = session.state.training.pending.map((c) => c.moveId);
    const receipt = session.lastConfirmation;
    session.confirm(receipt);
    resolveRewardChoices(session);
    const defeat = new EncounterSession(
      session.state,
      scriptedActionAdapter([{ partyHP: 0, outcome: 'defeat' }]),
    );
    defeat.begin(f.wild, 0);
    defeat.act(rewardMove());
    const fainted = defeat.state.owned.map((e) => e.health.currentHP);
    defeat.recoverDefeat(defeat.recoveryRequest.requestId);
    return {
      rules: second ? 'short-full' : 'long-fixed',
      levels,
      choices,
      completed: defeat.state.battleRewards.completedTrainers,
      fainted,
      recovered: defeat.state.owned.map((e) => e.health.currentHP),
      stones: defeat.state.inventory.stacks[0]?.count ?? 0,
    };
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(runRewardExample()));
}
