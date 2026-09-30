import { readBattleRewards } from './reward-data.js';
import type { BattleRewardState } from './reward-data.js';
import { readGrowth } from './growth-data.js';
import type { GrowthState } from './growth-data.js';
import { readInventory } from './inventory-data.js';
import type { InventoryState } from './inventory-data.js';
import { readCollection, recordAcquisition } from './collection-data.js';
import type { CollectionState } from './collection-data.js';
import { record, integer } from './validation.js';
import { readTraining } from './move-data.js';
import type { TrainingState } from './move-data.js';
import { createMonsters, loadSpeciesCatalog } from './species.js';
import type { MonsterInstance, SpeciesCatalog } from './species.js';

export interface Health {
  readonly currentHP: number;
  readonly maxHP: number;
  readonly condition: null | 'weary';
}
export interface OwnedMonster {
  readonly monster: MonsterInstance;
  readonly health: Health;
}
export interface OwnershipState {
  readonly catalog: SpeciesCatalog;
  readonly totalCapacity: number;
  readonly partyCapacity: number;
  readonly owned: readonly OwnedMonster[];
  readonly party: readonly string[];
  readonly training?: TrainingState;
  readonly inventory?: InventoryState;
  readonly collection?: CollectionState;
  readonly growth?: GrowthState;
  readonly battleRewards?: BattleRewardState;
}

function health(input: unknown): Health {
  const item = record(input, ['currentHP', 'maxHP', 'condition']);
  const maxHP = integer(item.maxHP, 1);
  const currentHP = integer(item.currentHP, 0);
  if (currentHP > maxHP) throw new RangeError('HP exceeds maximum');
  if (item.condition !== null && item.condition !== 'weary') throw new TypeError('Unknown condition');
  return Object.freeze({ currentHP, maxHP, condition: item.condition });
}
function instance(catalog: SpeciesCatalog, input: unknown): MonsterInstance {
  const item = record(input, ['id', 'speciesId', 'nickname']);
  if (!Object.hasOwn(item, 'nickname')) throw new TypeError('Expected complete instance snapshot');
  const monster = createMonsters(catalog, [item])[0];
  if (!monster) throw new TypeError('Missing monster');
  return monster;
}
function freeze(state: OwnershipState): OwnershipState {
  return Object.freeze({ ...state, owned: Object.freeze(state.owned), party: Object.freeze(state.party) });
}
export function validState(input: unknown): OwnershipState {
  const item = record(input, ['catalog', 'totalCapacity', 'partyCapacity', 'owned', 'party', 'training', 'inventory', 'collection', 'growth', 'battleRewards']);
  const catalog = loadSpeciesCatalog(item.catalog);
  const totalCapacity = integer(item.totalCapacity, 0);
  const partyCapacity = integer(item.partyCapacity, 0);
  if (partyCapacity > totalCapacity) throw new RangeError('Party capacity exceeds total');
  if (!Array.isArray(item.owned) || !Array.isArray(item.party)) throw new TypeError('Expected collection arrays');
  const owned: OwnedMonster[] = [];
  const ids = new Set<string>();
  for (const entry of item.owned) {
    const member = record(entry, ['monster', 'health']);
    const monster = instance(catalog, member.monster);
    if (ids.has(monster.id)) throw new RangeError('Duplicate owned ID');
    ids.add(monster.id);
    owned.push(Object.freeze({ monster, health: health(member.health) }));
  }
  const party: string[] = [];
  for (const member of item.party) {
    if (typeof member !== 'string') throw new TypeError('Expected party ID');
    if (!ids.has(member) || party.includes(member)) throw new RangeError('Invalid party subset');
    party.push(member);
  }
  if (owned.length > totalCapacity || party.length > partyCapacity) throw new RangeError('Capacity exceeded');
  let next: OwnershipState = { catalog, totalCapacity, partyCapacity, owned, party };
  if (Object.hasOwn(item, 'training')) next = { ...next, training: readTraining(item.training, [...ids]) };
  if (Object.hasOwn(item, 'inventory')) next = { ...next, inventory: readInventory(item.inventory) };
  if (Object.hasOwn(item, 'collection')) next = { ...next, collection: readCollection(item.collection, catalog, owned.map(entry => entry.monster.speciesId)) };
  if (Object.hasOwn(item, 'growth')) next = { ...next, growth: readGrowth(item.growth, next) };
  if (Object.hasOwn(item, 'battleRewards')) next = { ...next, battleRewards: readBattleRewards(item.battleRewards, next) };
  return freeze(next);
}
function target(state: OwnershipState, id: unknown): OwnedMonster {
  if (typeof id !== 'string') throw new TypeError('Expected owned ID');
  const member = state.owned.find(entry => entry.monster.id === id);
  if (!member) throw new RangeError('Unknown owned ID');
  return member;
}

export function createOwnership(catalog: SpeciesCatalog, capacities: unknown): OwnershipState {
  const limits = record(capacities, ['totalCapacity', 'partyCapacity']);
  return validState({ catalog, totalCapacity: limits.totalCapacity, partyCapacity: limits.partyCapacity, owned: [], party: [] });
}

export function admitMonster(state: OwnershipState, input: unknown, initialHealth: unknown): OwnershipState {
  const current = validState(state);
  const monster = instance(current.catalog, input);
  const member = Object.freeze({ monster, health: health(initialHealth) });
  if (current.owned.some(entry => entry.monster.id === monster.id)) throw new RangeError('Duplicate owned ID');
  if (current.owned.length === current.totalCapacity) throw new RangeError('Total capacity full');
  const party = current.party.length < current.partyCapacity ? [...current.party, monster.id] : current.party;
  let next: OwnershipState = { ...current, owned: [...current.owned, member], party };
  if (current.training) next = { ...next, training: { ...current.training, individuals: [
    ...current.training.individuals, { instanceId: monster.id, knownMoves: [] },
  ] } };
  if (current.collection) next = { ...next, collection: recordAcquisition(current.collection, monster.speciesId) };
  return validState(next);
}

export function depositMonster(state: OwnershipState, id: unknown): OwnershipState {
  const current = validState(state);
  const member = target(current, id);
  return validState({ ...current, party: current.party.filter(entry => entry !== member.monster.id) });
}

export function withdrawMonster(state: OwnershipState, id: unknown): OwnershipState {
  const current = validState(state);
  const member = target(current, id);
  if (current.party.includes(member.monster.id)) return current;
  if (current.party.length === current.partyCapacity) throw new RangeError('Party capacity full');
  return validState({ ...current, party: [...current.party, member.monster.id] });
}

export function reorderParty(state: OwnershipState, order: unknown): OwnershipState {
  const current = validState(state);
  if (!Array.isArray(order)) throw new TypeError('Expected party order');
  const party: string[] = [];
  for (const id of order) {
    if (typeof id !== 'string') throw new TypeError('Expected party ID');
    if (!current.party.includes(id) || party.includes(id)) throw new RangeError('Expected party permutation');
    party.push(id);
  }
  if (party.length !== current.party.length) throw new RangeError('Expected complete party permutation');
  return validState({ ...current, party });
}

function replaceHealth(state: OwnershipState, member: OwnedMonster, next: Health): OwnershipState {
  const owned = state.owned.map(entry => entry.monster.id === member.monster.id
    ? Object.freeze({ monster: entry.monster, health: Object.freeze(next) }) : entry);
  return validState({ ...state, owned });
}
export function healMonster(state: OwnershipState, id: unknown, amount: unknown): OwnershipState {
  const current = validState(state);
  const member = target(current, id);
  const points = integer(amount, 0);
  const hp = member.health;
  const currentHP = hp.currentHP === 0 ? 0 : hp.currentHP + Math.min(points, hp.maxHP - hp.currentHP);
  return replaceHealth(current, member, { ...hp, currentHP });
}
export function reviveMonster(state: OwnershipState, id: unknown, amount: unknown): OwnershipState {
  const current = validState(state);
  const member = target(current, id);
  const points = integer(amount, 1);
  const hp = member.health;
  const currentHP = hp.currentHP === 0 ? Math.min(points, hp.maxHP) : hp.currentHP;
  return replaceHealth(current, member, { ...hp, currentHP });
}
export function clearCondition(state: OwnershipState, id: unknown): OwnershipState {
  const current = validState(state);
  const member = target(current, id);
  return replaceHealth(current, member, { ...member.health, condition: null });
}
