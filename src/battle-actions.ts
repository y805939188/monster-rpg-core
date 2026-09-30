import type { MedicineEffect } from './inventory-data.js';
import { itemDefinition } from './inventory-data.js';
import { useMedicine } from './inventory.js';
import type { BattleCombatant, BattleRequest } from './encounter.js';
import type { OwnershipState } from './ownership.js';
import { admitMonster, validState } from './ownership.js';
import { readTraining } from './move-data.js';
import { integer, record } from './validation.js';

export type BattleAction = Readonly<{ kind: 'move'; actorId: string; moveId: string; targetId: string }>
  | Readonly<{ kind: 'switch'; actorId: string; targetId: string }>
  | Readonly<{ kind: 'medicine'; actorId: string; targetId: string; itemId: string }>
  | Readonly<{ kind: 'capture'; actorId: string; targetId: string; itemId: string; success: boolean }>
  | Readonly<{ kind: 'flee'; actorId: string; success: boolean }>;
export interface BattleCheckpoint {
  readonly party: readonly BattleCombatant[];
  readonly opponents: readonly BattleCombatant[];
  readonly activeId: string;
}
export interface MedicineApplication {
  readonly before: BattleCombatant;
  readonly after: BattleCombatant;
}
export interface BattleCommand {
  readonly participants?: readonly string[];
  readonly generation: number;
  readonly commandId: number;
  readonly revision: number;
  readonly action: BattleAction;
  readonly checkpoint: BattleCheckpoint;
  readonly medicine?: MedicineEffect;
}
export interface BattleConfirmation {
  readonly participants?: readonly string[];
  readonly medicine?: MedicineApplication;
  readonly generation: number;
  readonly commandId: number;
  readonly revision: number;
  readonly outcome: 'continue' | 'victory' | 'defeat' | 'captured' | 'escaped';
  readonly checkpoint: BattleCheckpoint;
}
export interface BattleReceipt {
  readonly status: 'applied' | 'already_applied';
  readonly generation: number;
  readonly commandId: number;
  readonly revision: number;
  readonly outcome: BattleConfirmation['outcome'];
}
export interface BattleFault {
  readonly generation: number;
  readonly commandId: number;
  readonly revision: number;
  readonly reason: 'adapter_error' | 'invalid_confirmation' | 'release_failed';
}

/** Compare against finite, core-validated data; rejects extra keys without trusting input prototypes. */
export function sameData(input: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return Object.is(input, expected);
  if (typeof input !== 'object' || input === null || Array.isArray(input) !== Array.isArray(expected)) return false;
  if (!Array.isArray(input) && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) return false;
  const keys = Reflect.ownKeys(expected);
  if (Reflect.ownKeys(input).length !== keys.length) return false;
  return keys.every(key => Object.hasOwn(input, key) && sameData(Reflect.get(input, key), Reflect.get(expected, key)));
}
export function initialCheckpoint(request: BattleRequest): BattleCheckpoint {
  const actor = request.party.find(entry => entry.health.currentHP > 0);
  if (!actor) throw new RangeError('No active actor');
  return Object.freeze({ party: request.party, opponents: request.opponents, activeId: actor.monster.id });
}
export function readAction(input: unknown, checkpoint: BattleCheckpoint, state: OwnershipState, request: BattleRequest): BattleAction {
  const candidate = record(input, ['kind', 'actorId', 'moveId', 'targetId', 'itemId', 'success']);
  if (candidate.kind === 'medicine' || candidate.kind === 'capture' || candidate.kind === 'flee') {
    const item = record(input, candidate.kind === 'flee' ? ['kind', 'actorId', 'success']
      : candidate.kind === 'capture' ? ['kind', 'actorId', 'targetId', 'itemId', 'success'] : ['kind', 'actorId', 'targetId', 'itemId']);
    const actor = checkpoint.party.find(entry => entry.monster.id === item.actorId);
    if (!actor || actor.monster.id !== checkpoint.activeId || actor.health.currentHP === 0) throw new RangeError('Ineligible actor');
    if (candidate.kind === 'flee' || candidate.kind === 'capture') {
      if (request.kind !== 'wild') throw new RangeError('Trainer capture/flee forbidden');
      if (typeof item.success !== 'boolean') throw new TypeError('Expected controlled rule decision');
      if (candidate.kind === 'flee') return Object.freeze({ kind: 'flee', actorId: actor.monster.id, success: item.success });
    }
    if (typeof item.targetId !== 'string' || typeof item.itemId !== 'string') throw new TypeError('Expected target/item IDs');
    if (!state.inventory) throw new RangeError('Inventory not enabled');
    const definition = itemDefinition(state.inventory.rules, item.itemId);
    if (!state.inventory.stacks.some(entry => entry.itemId === definition.id)) throw new RangeError('Insufficient quantity');
    if (candidate.kind === 'medicine') {
      if (!checkpoint.party.some(entry => entry.monster.id === item.targetId)) throw new RangeError('Medicine target not in party');
      return Object.freeze({ kind: 'medicine', actorId: actor.monster.id, targetId: item.targetId, itemId: item.itemId });
    }
    const target = checkpoint.opponents.find(entry => entry.monster.id === item.targetId);
    if (!target || target.health.currentHP === 0 || definition.effect.kind !== 'capture') throw new RangeError('Invalid capture target/item');
    if (state.owned.length === state.totalCapacity) throw new RangeError('Total capacity full');
    if (typeof item.success !== 'boolean') throw new TypeError('Expected controlled rule decision');
    return Object.freeze({ kind: 'capture', actorId: actor.monster.id, targetId: item.targetId, itemId: item.itemId, success: item.success });
  }
  const item = record(input, ['kind', 'actorId', 'moveId', 'targetId']);
  if (typeof item.actorId !== 'string' || typeof item.targetId !== 'string') throw new TypeError('Expected actor and target IDs');
  const actor = checkpoint.party.find(entry => entry.monster.id === item.actorId);
  if (!actor || item.actorId !== checkpoint.activeId) throw new RangeError('Actor is not active');
  if (item.kind === 'switch' && !Object.hasOwn(item, 'moveId')) {
    const target = checkpoint.party.find(entry => entry.monster.id === item.targetId);
    if (!target || target.monster.id === actor.monster.id || target.health.currentHP === 0) throw new RangeError('Ineligible switch target');
    return Object.freeze({ kind: 'switch', actorId: item.actorId, targetId: item.targetId });
  }
  if (item.kind !== 'move' || typeof item.moveId !== 'string') throw new TypeError('Expected move or switch action');
  const target = checkpoint.opponents.find(entry => entry.monster.id === item.targetId);
  const move = actor.knownMoves.find(entry => entry.moveId === item.moveId);
  if (actor.health.currentHP === 0 || !target || target.health.currentHP === 0 || !move || move.remaining === 0) {
    throw new RangeError('Ineligible move/actor/target or exhausted resource');
  }
  return Object.freeze({ kind: 'move', actorId: item.actorId, targetId: item.targetId, moveId: item.moveId });
}
export function medicineRule(action: BattleAction, state: OwnershipState): MedicineEffect | undefined {
  if (action.kind !== 'medicine') return undefined;
  useMedicine(state, action.itemId, action.targetId); // explicit preflight no-effect policy
  if (!state.inventory) throw new RangeError('Inventory missing');
  const effect = itemDefinition(state.inventory.rules, action.itemId).effect;
  if (effect.kind === 'capture' || effect.kind === 'evolution') throw new RangeError('Not medicine');
  return effect;
}
function withTarget(state: OwnershipState, target: BattleCombatant): OwnershipState {
  let next: OwnershipState = { ...state, owned: state.owned.map(entry => entry.monster.id === target.monster.id
    ? { monster: entry.monster, health: target.health } : entry) };
  if (state.training) next = { ...next, training: { ...state.training, individuals: state.training.individuals.map(entry =>
    entry.instanceId === target.monster.id ? { ...entry, knownMoves: target.knownMoves } : entry) } };
  return next;
}
function debit(state: OwnershipState, itemId: string): OwnershipState {
  const inventory = state.inventory;
  if (!inventory || !inventory.stacks.some(entry => entry.itemId === itemId)) throw new RangeError('Insufficient quantity');
  return { ...state, inventory: { ...inventory, stacks: inventory.stacks.flatMap(entry => entry.itemId !== itemId ? [entry]
    : entry.count === 1 ? [] : [{ itemId, count: entry.count - 1 }]) } };
}
function side(input: unknown, prior: readonly BattleCombatant[], state: OwnershipState): readonly BattleCombatant[] {
  if (!Array.isArray(input) || input.length !== prior.length) throw new TypeError('Expected complete combatant list');
  const entries = input.map(value => record(value, ['monster', 'health', 'knownMoves']));
  const checked = validState({ catalog: state.catalog, totalCapacity: entries.length, partyCapacity: 0,
    owned: entries.map(entry => ({ monster: entry.monster, health: entry.health })), party: [] });
  const training = state.training ? readTraining({ rules: state.training.rules,
    individuals: checked.owned.map((entry, index) => ({ instanceId: entry.monster.id, knownMoves: entries[index]?.knownMoves })),
    pending: [], nextChoiceId: 1, resolvedThrough: 0,
  }, checked.owned.map(entry => entry.monster.id)) : undefined;
  return Object.freeze(checked.owned.map((entry, index) => {
    const before = prior[index];
    if (!before || !sameData(entry.monster, before.monster) || entry.health.maxHP !== before.health.maxHP) throw new RangeError('Combatant identity/maximum changed');
    const knownMoves = training?.individuals[index]?.knownMoves ?? Object.freeze([]);
    if (!training && !sameData(entries[index]?.knownMoves, [])) throw new RangeError('Unexpected moves');
    if (!sameData(knownMoves.map(move => move.moveId), before.knownMoves.map(move => move.moveId))) throw new RangeError('Known move identities changed');
    return Object.freeze({ ...entry, knownMoves });
  }));
}
export function settleConfirmation(input: unknown, command: BattleCommand, state: OwnershipState): { confirmation: BattleConfirmation; next: OwnershipState } {
  const item = record(input, ['generation', 'commandId', 'revision', 'outcome', 'checkpoint', 'medicine', 'participants']);
  if (integer(item.generation, 1) !== command.generation || integer(item.commandId, 1) !== command.commandId
    || integer(item.revision, 0) !== command.revision) throw new RangeError('Confirmation correlation mismatch');
  if (item.outcome !== 'continue' && item.outcome !== 'victory' && item.outcome !== 'defeat' && item.outcome !== 'captured' && item.outcome !== 'escaped') throw new TypeError('Unsupported outcome');
  let participants: readonly string[] | undefined;
  if (Object.hasOwn(item, 'participants')) {
    if (!Array.isArray(item.participants) || !item.participants.length) throw new TypeError('Expected participants');
    const ids: string[] = [];
    for (const id of item.participants) {
      if (typeof id !== 'string' || ids.includes(id)) throw new RangeError('Invalid participants');
      ids.push(id);
    }
    participants = Object.freeze(ids);
  }
  const action = command.action;
  let medicine: MedicineApplication | undefined;
  if (action.kind === 'medicine') {
    const ack = record(item.medicine, ['before', 'after']);
    const prior = command.checkpoint.party.find(entry => entry.monster.id === action.targetId);
    if (!prior || !command.medicine) throw new RangeError('Missing medicine target/rule');
    const before = side([ack.before], [prior], state)[0];
    if (!before) throw new RangeError('Missing medicine before snapshot');
    const applied = useMedicine(withTarget(state, before), action.itemId, action.targetId);
    const target = applied.owned.find(entry => entry.monster.id === action.targetId);
    if (!target) throw new RangeError('Missing medicine result');
    const after = Object.freeze({ ...target, knownMoves: applied.training?.individuals.find(entry => entry.instanceId === action.targetId)?.knownMoves ?? Object.freeze([]) });
    if (!sameData(ack.after, after)) throw new RangeError('Medicine application acknowledgment mismatch');
    medicine = Object.freeze({ before, after });
  } else if (Object.hasOwn(item, 'medicine')) throw new TypeError('Unexpected medicine acknowledgment');
  if (action.kind === 'capture' && action.success) {
    if (item.outcome !== 'captured') throw new RangeError('Capture decision mismatch');
  } else if (action.kind === 'flee' && action.success) {
    if (item.outcome !== 'escaped') throw new RangeError('Flee decision mismatch');
  } else if (item.outcome === 'captured' || item.outcome === 'escaped') throw new RangeError('Unexpected terminal outcome');
  const data = record(item.checkpoint, ['party', 'opponents', 'activeId']);
  const party = side(data.party, command.checkpoint.party, state);
  const opponents = side(data.opponents, command.checkpoint.opponents, state);
  const expectedActive = command.action.kind === 'switch' ? command.action.targetId : command.action.actorId;
  if (data.activeId !== expectedActive) throw new RangeError('Active identity mismatch');
  const checkpoint = Object.freeze({ party, opponents, activeId: expectedActive });
  if (command.action.kind === 'move') {
    const action = command.action;
    const before = command.checkpoint.party.find(entry => entry.monster.id === action.actorId)?.knownMoves.find(entry => entry.moveId === action.moveId);
    const after = party.find(entry => entry.monster.id === action.actorId)?.knownMoves.find(entry => entry.moveId === action.moveId);
    if (!before || !after || after.remaining !== (before.remaining === null ? null : before.remaining - 1)) throw new RangeError('Move resource debit mismatch');
  }
  const partyAlive = party.some(entry => entry.health.currentHP > 0);
  const opponentsAlive = opponents.some(entry => entry.health.currentHP > 0);
  if ((item.outcome === 'continue' && (!partyAlive || !opponentsAlive))
    || (item.outcome === 'victory' && (opponentsAlive || !partyAlive)) || (item.outcome === 'defeat' && partyAlive)) {
    throw new RangeError('Outcome/checkpoint mismatch');
  }
  let next: OwnershipState = { ...state, owned: state.owned.map(entry => {
    const reported = party.find(member => member.monster.id === entry.monster.id);
    return reported ? { monster: entry.monster, health: reported.health } : entry;
  }) };
  if (state.training) next = { ...next, training: { ...state.training, individuals: state.training.individuals.map(entry => {
    const reported = party.find(member => member.monster.id === entry.instanceId);
    return reported ? { instanceId: entry.instanceId, knownMoves: reported.knownMoves } : entry;
  }) } };
  if (action.kind === 'medicine' || action.kind === 'capture') next = debit(next, action.itemId);
  if (action.kind === 'capture' && action.success) {
    const captured = opponents.find(entry => entry.monster.id === action.targetId);
    if (!captured) throw new RangeError('Missing captured target');
    next = admitMonster(next, captured.monster, captured.health);
    if (next.training) next = { ...next, training: { ...next.training, individuals: next.training.individuals.map(entry =>
      entry.instanceId === captured.monster.id ? { ...entry, knownMoves: captured.knownMoves } : entry) } };
  }
  const confirmation: BattleConfirmation = Object.freeze({ generation: command.generation, commandId: command.commandId,
    revision: command.revision, outcome: item.outcome, checkpoint,
    ...(medicine ? { medicine } : {}), ...(participants ? { participants } : {}) });
  return { confirmation, next: validState(next) };
}
