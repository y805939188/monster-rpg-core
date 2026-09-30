import { clearCondition, healMonster, reviveMonster, validState } from './ownership';
import type { OwnershipState } from './ownership';
import { restoreMoveResources } from './moves';
import { fullResource, moveDefinition } from './move-data';
import { itemDefinition, readInventoryRules } from './inventory-data';
import { integer } from './validation';

export function enableInventory(state: OwnershipState, input: unknown): OwnershipState {
  const current = validState(state);
  if (current.inventory) {
    throw new RangeError('Inventory already enabled');
  }
  return validState({
    ...current,
    inventory: { rules: readInventoryRules(input), stacks: [] },
  });
}
export function addItems(
  state: OwnershipState,
  itemId: unknown,
  quantity: unknown,
): OwnershipState {
  const current = validState(state);
  if (!current.inventory) {
    throw new RangeError('Inventory not enabled');
  }
  const inventory = current.inventory;
  const item = itemDefinition(inventory.rules, itemId);
  const amount = integer(quantity, 1);
  const existing = inventory.stacks.find((entry) => entry.itemId === item.id);
  const count = existing?.count ?? 0;
  if (amount > inventory.rules.stackLimit - count) {
    throw new RangeError('Stack limit exceeded');
  }
  if (!existing && inventory.stacks.length === inventory.rules.stackCapacity) {
    throw new RangeError('Inventory full');
  }
  const stacks = existing
    ? inventory.stacks.map((entry) =>
        entry.itemId === item.id ? { itemId: item.id, count: count + amount } : entry,
      )
    : [...inventory.stacks, { itemId: item.id, count: amount }];
  return validState({ ...current, inventory: { ...inventory, stacks } });
}
export function useMedicine(
  state: OwnershipState,
  itemId: unknown,
  instanceId: unknown,
): OwnershipState {
  const current = validState(state);
  if (!current.inventory) {
    throw new RangeError('Inventory not enabled');
  }
  const inventory = current.inventory;
  const item = itemDefinition(inventory.rules, itemId);
  if (typeof instanceId !== 'string') {
    throw new TypeError('Expected instance ID');
  }
  const target = current.owned.find((entry) => entry.monster.id === instanceId);
  if (!target) {
    throw new RangeError('Unknown medicine target');
  }
  const stack = inventory.stacks.find((entry) => entry.itemId === item.id);
  if (!stack) {
    throw new RangeError('Insufficient quantity');
  }
  let next: OwnershipState;
  const effect = item.effect;
  if (effect.kind === 'capture' || effect.kind === 'evolution') {
    throw new RangeError('Item is not medicine');
  }
  if (effect.kind === 'heal') {
    if (
      target.health.currentHP === 0 ||
      target.health.currentHP === target.health.maxHP
    ) {
      throw new RangeError('Medicine has no effect');
    }
    next = healMonster(current, instanceId, effect.amount);
  } else if (effect.kind === 'revive') {
    if (target.health.currentHP !== 0) {
      throw new RangeError('Medicine has no effect');
    }
    next = reviveMonster(current, instanceId, effect.amount);
  } else if (effect.kind === 'clearCondition') {
    if (target.health.condition === null) {
      throw new RangeError('Medicine has no effect');
    }
    next = clearCondition(current, instanceId);
  } else {
    const training = current.training;
    const member = training?.individuals.find((entry) => entry.instanceId === instanceId);
    if (
      !training ||
      !member ||
      !member.knownMoves.some(
        (entry) =>
          entry.remaining !== fullResource(moveDefinition(training.rules, entry.moveId)),
      )
    ) {
      throw new RangeError('Medicine has no effect');
    }
    next = restoreMoveResources(current, instanceId);
  }
  const stacks =
    stack.count === 1
      ? inventory.stacks.filter((entry) => entry.itemId !== item.id)
      : inventory.stacks.map((entry) =>
          entry.itemId === item.id ? { itemId: item.id, count: entry.count - 1 } : entry,
        );
  return validState({ ...next, inventory: { ...inventory, stacks } });
}
