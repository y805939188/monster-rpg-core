import { validState, reviveMonster, clearCondition } from './ownership';
import type { OwnershipState } from './ownership';
import type { BattleRequest } from './encounter';
import type { BattleConfirmation } from './battle-actions';
import { sameData } from './battle-actions';
import { readBattleRewardRules } from './reward-data';
import type { VictoryReward } from './reward-data';
import { addItems } from './inventory';
import { restoreMoveResources } from './moves';
import { awardParticipantExperience } from './growth';
import { integer } from './validation';

export function enableBattleRewards(
  state: OwnershipState,
  input: unknown,
): OwnershipState {
  const current = validState(state);
  if (current.battleRewards) {
    throw new RangeError('Battle rewards already enabled');
  }
  const rules = readBattleRewardRules(input, current);
  return validState({
    ...current,
    battleRewards: { rules, completedTrainers: [], recovery: null, nextRecoveryId: 1 },
  });
}
function configuredReward(state: OwnershipState, request: BattleRequest): VictoryReward {
  const rewards = state.battleRewards;
  if (!rewards) {
    throw new RangeError('Battle rewards not enabled');
  }
  if (request.kind === 'wild') {
    return rewards.rules.wild;
  }
  const trainer = rewards.rules.trainers.find((entry) => entry.id === request.trainerId);
  if (!trainer) {
    throw new RangeError('Unknown trainer reward');
  }
  if (rewards.completedTrainers.includes(trainer.id)) {
    throw new RangeError('Trainer already completed');
  }
  return trainer.reward;
}
export function validateRewardBegin(state: OwnershipState, request: BattleRequest): void {
  if (!state.battleRewards) {
    return;
  }
  if (state.battleRewards.recovery) {
    throw new RangeError('Resolve defeat recovery before battle');
  }
  if (state.training?.pending.length || state.growth?.pending.length) {
    throw new RangeError('Resolve pending choices before battle');
  }
  const reward = configuredReward(state, request);
  if (
    reward.experience > 0 &&
    state.party.some(
      (id) => !state.growth?.individuals.some((entry) => entry.instanceId === id),
    )
  ) {
    throw new RangeError('Reward party must be enrolled in growth');
  }
}
export function settleBattleRewards(
  state: OwnershipState,
  request: BattleRequest,
  result: BattleConfirmation,
  participants: readonly string[],
): OwnershipState {
  const rewards = state.battleRewards;
  if (!rewards || result.outcome !== 'victory') {
    if (result.participants !== undefined) {
      throw new TypeError('Unexpected participants confirmation');
    }
  }
  if (!rewards) {
    return state;
  }
  if (result.outcome === 'victory') {
    if (!sameData(result.participants, participants)) {
      throw new RangeError('Victory participants mismatch');
    }
    const reward = configuredReward(state, request);
    let next = state;
    for (const item of reward.items) {
      next = addItems(next, item.itemId, item.count);
    }
    if (reward.experience > 0) {
      next = awardParticipantExperience(next, participants, reward.experience);
    }
    if (request.kind === 'trainer') {
      if (!request.trainerId) {
        throw new RangeError('Missing trainer ID');
      }
      next = {
        ...next,
        battleRewards: {
          ...rewards,
          completedTrainers: [...rewards.completedTrainers, request.trainerId],
        },
      };
    }
    return validState(next);
  }
  if (result.outcome !== 'defeat') {
    return state;
  }
  if (rewards.nextRecoveryId === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Recovery request IDs exhausted');
  }
  let next = state;
  if (state.inventory) {
    const inventory = state.inventory;
    next = {
      ...state,
      inventory: {
        ...inventory,
        stacks: inventory.stacks.flatMap((entry) => {
          const loss =
            rewards.rules.defeat.penalty.find((item) => item.itemId === entry.itemId)
              ?.count ?? 0;
          const count = entry.count - Math.min(loss, entry.count);
          return count ? [{ ...entry, count }] : [];
        }),
      },
    };
  }
  return validState({
    ...next,
    battleRewards: {
      ...rewards,
      nextRecoveryId: rewards.nextRecoveryId + 1,
      recovery: { requestId: rewards.nextRecoveryId, party: state.party },
    },
  });
}
export function applyDefeatRecovery(
  state: OwnershipState,
  inputId: unknown,
): OwnershipState {
  const current = validState(state);
  const rewards = current.battleRewards;
  const requestId = integer(inputId, 1);
  if (!rewards?.recovery || rewards.recovery.requestId !== requestId) {
    throw new RangeError('Unknown or consumed recovery request');
  }
  const rule = rewards.rules.defeat.recovery;
  let next = validState({ ...current, battleRewards: { ...rewards, recovery: null } });
  for (const id of rewards.recovery.party) {
    const member = next.owned.find((entry) => entry.monster.id === id);
    if (!member) {
      throw new RangeError('Missing recovery target');
    }
    next = reviveMonster(
      next,
      id,
      rule.hp.kind === 'full' ? member.health.maxHP : rule.hp.amount,
    );
    if (rule.clearCondition) {
      next = clearCondition(next, id);
    }
    if (rule.restoreResources && next.training) {
      next = restoreMoveResources(next, id);
    }
  }
  return validState(next);
}
