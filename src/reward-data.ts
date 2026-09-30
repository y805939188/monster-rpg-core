import { integer, record } from './validation';
import { loadSpeciesCatalog } from './species';
import { itemDefinition } from './inventory-data';
import type { OwnershipState } from './ownership';

export interface RewardItem {
  readonly itemId: string;
  readonly count: number;
}
export interface VictoryReward {
  readonly experience: number;
  readonly items: readonly RewardItem[];
}
export type RecoveryHP =
  Readonly<{ kind: 'full' }> | Readonly<{ kind: 'fixed'; amount: number }>;
export interface RecoveryRule {
  readonly hp: RecoveryHP;
  readonly clearCondition: boolean;
  readonly restoreResources: boolean;
}
export interface BattleRewardRules {
  readonly wild: VictoryReward;
  readonly trainers: readonly Readonly<{ id: string; reward: VictoryReward }>[];
  readonly defeat: Readonly<{ penalty: readonly RewardItem[]; recovery: RecoveryRule }>;
}
export interface DefeatRecovery {
  readonly requestId: number;
  readonly party: readonly string[];
}
export interface BattleRewardState {
  readonly rules: BattleRewardRules;
  readonly completedTrainers: readonly string[];
  readonly recovery: DefeatRecovery | null;
  readonly nextRecoveryId: number;
}
function items(input: unknown, state: OwnershipState): readonly RewardItem[] {
  if (!Array.isArray(input)) {
    throw new TypeError('Expected item amounts');
  }
  const result: RewardItem[] = [];
  for (const value of input) {
    const row = record(value, ['itemId', 'count']);
    if (!state.inventory) {
      throw new RangeError('Reward/penalty items require inventory');
    }
    const definition = itemDefinition(state.inventory.rules, row.itemId);
    const count = integer(row.count, 1);
    if (
      count > state.inventory.rules.stackLimit ||
      result.some((entry) => entry.itemId === definition.id)
    ) {
      throw new RangeError('Invalid reward/penalty amount');
    }
    result.push(Object.freeze({ itemId: definition.id, count }));
  }
  return Object.freeze(result);
}
function reward(input: unknown, state: OwnershipState): VictoryReward {
  const row = record(input, ['experience', 'items']);
  const experience = integer(row.experience, 0);
  if (experience > 0 && !state.growth) {
    throw new RangeError('Experience reward requires growth');
  }
  return Object.freeze({ experience, items: items(row.items, state) });
}
export function readBattleRewardRules(
  input: unknown,
  state: OwnershipState,
): BattleRewardRules {
  const row = record(input, ['wild', 'trainers', 'defeat']);
  const wild = reward(row.wild, state);
  if (!Array.isArray(row.trainers)) {
    throw new TypeError('Expected trainer rules');
  }
  const trainers: { readonly id: string; readonly reward: VictoryReward }[] = [];
  for (const value of row.trainers) {
    const trainer = record(value, ['id', 'reward']);
    const identity = loadSpeciesCatalog([{ id: trainer.id, name: 'Trainer' }])[0];
    if (!identity || trainers.some((entry) => entry.id === identity.id)) {
      throw new RangeError('Invalid trainer ID');
    }
    trainers.push(
      Object.freeze({ id: identity.id, reward: reward(trainer.reward, state) }),
    );
  }
  const defeat = record(row.defeat, ['penalty', 'recovery']);
  const recovery = record(defeat.recovery, ['hp', 'clearCondition', 'restoreResources']);
  if (
    typeof recovery.clearCondition !== 'boolean' ||
    typeof recovery.restoreResources !== 'boolean'
  ) {
    throw new TypeError('Expected recovery flags');
  }
  const hpRule = record(recovery.hp, ['kind', 'amount']);
  let hp: RecoveryHP;
  if (hpRule.kind === 'full' && !Object.hasOwn(hpRule, 'amount')) {
    hp = Object.freeze({ kind: 'full' });
  } else if (hpRule.kind === 'fixed') {
    hp = Object.freeze({ kind: 'fixed', amount: integer(hpRule.amount, 1) });
  } else {
    throw new TypeError('Invalid recovery HP rule');
  }
  return Object.freeze({
    wild,
    trainers: Object.freeze(trainers),
    defeat: Object.freeze({
      penalty: items(defeat.penalty, state),
      recovery: Object.freeze({
        hp,
        clearCondition: recovery.clearCondition,
        restoreResources: recovery.restoreResources,
      }),
    }),
  });
}
export function readBattleRewards(
  input: unknown,
  state: OwnershipState,
): BattleRewardState {
  const row = record(input, ['rules', 'completedTrainers', 'recovery', 'nextRecoveryId']);
  const rules = readBattleRewardRules(row.rules, state);
  const nextRecoveryId = integer(row.nextRecoveryId, 1);
  if (!Array.isArray(row.completedTrainers)) {
    throw new TypeError('Expected trainer completion list');
  }
  const completedTrainers: string[] = [];
  for (const id of row.completedTrainers) {
    if (
      typeof id !== 'string' ||
      !rules.trainers.some((entry) => entry.id === id) ||
      completedTrainers.includes(id)
    ) {
      throw new RangeError('Invalid trainer completion');
    }
    completedTrainers.push(id);
  }
  let recovery: DefeatRecovery | null = null;
  if (row.recovery !== null) {
    const pending = record(row.recovery, ['requestId', 'party']);
    const requestId = integer(pending.requestId, 1);
    if (
      requestId !== nextRecoveryId - 1 ||
      !Array.isArray(pending.party) ||
      !pending.party.length ||
      pending.party.length !== state.party.length
    ) {
      throw new RangeError('Invalid recovery request');
    }
    const party: string[] = [];
    for (const [index, id] of pending.party.entries()) {
      const member = state.owned.find((entry) => entry.monster.id === id);
      if (!member || state.party[index] !== id || member.health.currentHP !== 0) {
        throw new RangeError('Recovery party must match defeated party');
      }
      party.push(member.monster.id);
    }
    recovery = Object.freeze({ requestId, party: Object.freeze(party) });
  }
  return Object.freeze({
    rules,
    completedTrainers: Object.freeze(completedTrainers),
    recovery,
    nextRecoveryId,
  });
}
