import { validState } from './ownership.js';
import type { OwnershipState } from './ownership.js';
import { enableCollection } from './collection.js';
import { recordAcquisition } from './collection-data.js';
import { requestLearning } from './moves.js';
import { integer } from './validation.js';
import { growthHP, growthLevel, readGrowthRules, speciesGrowth } from './growth-data.js';
import type { GrowthState, IndividualGrowth } from './growth-data.js';

function context(state: OwnershipState, id: unknown): { state: OwnershipState; growth: GrowthState; member: IndividualGrowth } {
  const current = validState(state);
  const member = current.growth?.individuals.find(entry => entry.instanceId === id);
  if (!current.growth || !member) throw new RangeError('Individual is not enrolled in growth');
  return { state: current, growth: current.growth, member };
}
function noChoices(state: OwnershipState): void {
  if (state.training?.pending.length || state.growth?.pending.length) throw new RangeError('Resolve pending learning/evolution first');
}
function reconcile(state: OwnershipState, growth: GrowthState, id: string): OwnershipState {
  const member = growth.individuals.find(entry => entry.instanceId === id);
  if (!member) throw new RangeError('Missing growth member');
  return validState({ ...state, growth, owned: state.owned.map(entry => {
    if (entry.monster.id !== id) return entry;
    const maxHP = growthHP(growth.rules, entry.monster.speciesId, member.level);
    return { ...entry, health: { ...entry.health, maxHP, currentHP: Math.min(entry.health.currentHP, maxHP) } };
  }) });
}
function triggers(state: OwnershipState, id: string, previousLevel: number): OwnershipState {
  const current = context(state, id);
  const owner = current.state.owned.find(entry => entry.monster.id === id);
  if (!owner) throw new RangeError('Missing growth owner');
  const row = speciesGrowth(current.growth.rules, owner.monster.speciesId);
  let next = current.state;
  for (const entry of row.learnset) {
    if (entry.level <= previousLevel || entry.level > current.member.level) continue;
    const known = next.training?.individuals.find(entry => entry.instanceId === id)?.knownMoves;
    if (known?.some(move => move.moveId === entry.moveId) || next.training?.pending.some(choice => choice.instanceId === id && choice.moveId === entry.moveId)) continue;
    next = requestLearning(next, id, entry.moveId);
  }
  const rule = row.evolution;
  if (rule?.kind === 'level' && rule.level > previousLevel && rule.level <= current.member.level) {
    const choiceId = current.growth.nextChoiceId;
    if (choiceId === Number.MAX_SAFE_INTEGER) throw new RangeError('Evolution choice IDs exhausted');
    next = validState({ ...next, growth: { ...current.growth, nextChoiceId: choiceId + 1, pending: [
      ...current.growth.pending, { choiceId, instanceId: id, fromSpeciesId: row.speciesId, toSpeciesId: rule.toSpeciesId, level: rule.level },
    ] } });
  }
  return next;
}
export function enableGrowth(state: OwnershipState, input: unknown): OwnershipState {
  const current = validState(state);
  if (current.growth) throw new RangeError('Growth already enabled');
  const rules = readGrowthRules(input, current);
  return validState({ ...current, growth: { rules, individuals: [], pending: [], nextChoiceId: 1, resolvedThrough: 0 } });
}
export function initializeGrowth(state: OwnershipState, instanceId: unknown, inputExperience: unknown = 0): OwnershipState {
  const current = validState(state); noChoices(current);
  const growth = current.growth;
  if (!growth || typeof instanceId !== 'string' || !current.owned.some(entry => entry.monster.id === instanceId)) throw new RangeError('Unknown growth owner');
  if (growth.individuals.some(entry => entry.instanceId === instanceId)) throw new RangeError('Growth already initialized');
  const experience = integer(inputExperience, 0);
  const cap = growth.rules.thresholds[growth.rules.thresholds.length - 1];
  if (cap === undefined || experience > cap) throw new RangeError('Initial experience exceeds cap');
  const member = { instanceId, experience, level: growthLevel(growth.rules, experience) };
  return triggers(reconcile(current, { ...growth, individuals: [...growth.individuals, member] }, instanceId), instanceId, 0);
}
function awardOne(state: OwnershipState, instanceId: unknown, amount: unknown): OwnershipState {
  const { state: current, growth, member } = context(state, instanceId);
  const points = integer(amount, 0); const cap = growth.rules.thresholds[growth.rules.thresholds.length - 1];
  if (cap === undefined) throw new RangeError('Missing cap');
  const experience = member.experience + Math.min(points, cap - member.experience);
  const updated = { ...member, experience, level: growthLevel(growth.rules, experience) };
  return triggers(reconcile(current, { ...growth, individuals: growth.individuals.map(entry => entry.instanceId === member.instanceId ? updated : entry) }, member.instanceId), member.instanceId, member.level);
}
export function awardExperience(state: OwnershipState, instanceId: unknown, amount: unknown): OwnershipState {
  const current = validState(state); noChoices(current);
  return awardOne(current, instanceId, amount);
}
/** Internal terminal batch: settle every earned participant award before exposing choices. */
export function awardParticipantExperience(state: OwnershipState, ids: readonly string[], amount: number): OwnershipState {
  let next = validState(state); noChoices(next); integer(amount, 0);
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !next.party.includes(id))) throw new RangeError('Invalid award participants');
  for (const id of ids) next = awardOne(next, id, amount);
  return next;
}
function evolve(state: OwnershipState, id: string, toSpeciesId: string): OwnershipState {
  const current = state.collection ? state : enableCollection(state);
  if (!current.growth || !current.collection) throw new RangeError('Missing evolution context');
  const changed: OwnershipState = { ...current,
    owned: current.owned.map(entry => entry.monster.id === id ? { ...entry, monster: { ...entry.monster, speciesId: toSpeciesId } } : entry),
    collection: recordAcquisition(current.collection, toSpeciesId),
  };
  return triggers(reconcile(changed, current.growth, id), id, 0);
}
export function resolveEvolution(state: OwnershipState, choiceId: unknown, instanceId: unknown, toSpeciesId: unknown, decision: unknown): OwnershipState {
  const { state: current, growth, member } = context(state, instanceId);
  if (current.training?.pending.length) throw new RangeError('Resolve learning before evolution');
  const requested = integer(choiceId, 1); const choice = growth.pending[0];
  if (!choice || choice.choiceId !== requested || choice.instanceId !== member.instanceId || choice.toSpeciesId !== toSpeciesId) throw new RangeError('Consumed, out-of-order or mismatched evolution');
  if (decision !== 'accept' && decision !== 'decline') throw new TypeError('Expected accept or decline');
  const next = validState({ ...current, growth: { ...growth, pending: growth.pending.slice(1), resolvedThrough: requested } });
  return decision === 'accept' ? evolve(next, member.instanceId, choice.toSpeciesId) : next;
}
export function evolveWithItem(state: OwnershipState, instanceId: unknown, itemId: unknown): OwnershipState {
  const { state: current, growth, member } = context(state, instanceId); noChoices(current);
  const owner = current.owned.find(entry => entry.monster.id === member.instanceId);
  if (!owner) throw new RangeError('Missing evolution owner');
  const rule = speciesGrowth(growth.rules, owner.monster.speciesId).evolution;
  const inventory = current.inventory;
  const stack = inventory?.stacks.find(entry => entry.itemId === itemId);
  if (!rule || rule.kind !== 'item' || rule.itemId !== itemId || !inventory || !stack) throw new RangeError('Ineligible item evolution or insufficient quantity');
  const next = { ...current, inventory: { ...inventory, stacks: inventory.stacks.flatMap(entry => entry.itemId !== itemId ? [entry]
    : entry.count === 1 ? [] : [{ ...entry, count: entry.count - 1 }]) } };
  return evolve(next, member.instanceId, rule.toSpeciesId);
}
