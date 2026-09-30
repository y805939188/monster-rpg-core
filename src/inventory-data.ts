import { loadSpeciesCatalog } from './species';
import { integer, record } from './validation';

export type MedicineEffect =
  | Readonly<{ kind: 'heal' | 'revive'; amount: number }>
  | Readonly<{ kind: 'clearCondition' | 'restoreResources' }>;
export type ItemEffect =
  MedicineEffect | Readonly<{ kind: 'capture' }> | Readonly<{ kind: 'evolution' }>;
export interface ItemDefinition {
  readonly id: string;
  readonly name: string;
  readonly effect: ItemEffect;
}
export interface InventoryRules {
  readonly stackCapacity: number;
  readonly stackLimit: number;
  readonly items: readonly ItemDefinition[];
}
export interface ItemStack {
  readonly itemId: string;
  readonly count: number;
}
export interface InventoryState {
  readonly rules: InventoryRules;
  readonly stacks: readonly ItemStack[];
}

export function readInventoryRules(input: unknown): InventoryRules {
  const item = record(input, ['stackCapacity', 'stackLimit', 'items']);
  const stackCapacity = integer(item.stackCapacity, 0);
  const stackLimit = integer(item.stackLimit, 1);
  if (!Array.isArray(item.items) || item.items.length === 0) {
    throw new TypeError('Expected item definitions');
  }
  const items: ItemDefinition[] = [];
  for (const value of item.items) {
    const definition = record(value, ['id', 'name', 'effect']);
    const identity = loadSpeciesCatalog([
      { id: definition.id, name: definition.name },
    ])[0];
    if (!identity) {
      throw new TypeError('Missing item definition');
    }
    if (items.some((entry) => entry.id === identity.id)) {
      throw new RangeError('Duplicate item ID');
    }
    const rule = record(definition.effect, ['kind', 'amount']);
    let effect: ItemEffect;
    if (rule.kind === 'heal' || rule.kind === 'revive') {
      effect = Object.freeze({ kind: rule.kind, amount: integer(rule.amount, 1) });
    } else if (
      (rule.kind === 'clearCondition' ||
        rule.kind === 'restoreResources' ||
        rule.kind === 'capture' ||
        rule.kind === 'evolution') &&
      !Object.hasOwn(rule, 'amount')
    ) {
      effect = Object.freeze({ kind: rule.kind });
    } else {
      throw new TypeError('Invalid medicine effect');
    }
    items.push(Object.freeze({ ...identity, effect }));
  }
  return Object.freeze({ stackCapacity, stackLimit, items: Object.freeze(items) });
}
export function itemDefinition(rules: InventoryRules, id: unknown): ItemDefinition {
  if (typeof id !== 'string') {
    throw new TypeError('Expected item ID');
  }
  const item = rules.items.find((entry) => entry.id === id);
  if (!item) {
    throw new RangeError('Unknown item ID');
  }
  return item;
}
export function readInventory(input: unknown): InventoryState {
  const item = record(input, ['rules', 'stacks']);
  const rules = readInventoryRules(item.rules);
  if (!Array.isArray(item.stacks)) {
    throw new TypeError('Expected item stacks');
  }
  const stacks: ItemStack[] = [];
  for (const value of item.stacks) {
    const stack = record(value, ['itemId', 'count']);
    const definition = itemDefinition(rules, stack.itemId);
    const count = integer(stack.count, 1);
    if (
      count > rules.stackLimit ||
      stacks.some((entry) => entry.itemId === definition.id)
    ) {
      throw new RangeError('Invalid stack');
    }
    stacks.push(Object.freeze({ itemId: definition.id, count }));
  }
  if (stacks.length > rules.stackCapacity) {
    throw new RangeError('Inventory capacity exceeded');
  }
  return Object.freeze({ rules, stacks: Object.freeze(stacks) });
}
