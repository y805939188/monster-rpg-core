import { loadSpeciesCatalog } from './species.js';
import { record, integer } from './validation.js';

export type MoveResource = Readonly<{ kind: 'finite'; maximum: number }> | Readonly<{ kind: 'none' }>;
export interface MoveDefinition { readonly id: string; readonly name: string; readonly resource: MoveResource }
export interface MoveRules { readonly slotCapacity: number; readonly moves: readonly MoveDefinition[] }
export interface KnownMove { readonly moveId: string; readonly remaining: number | null }
export interface IndividualMoves { readonly instanceId: string; readonly knownMoves: readonly KnownMove[] }
export interface LearningChoice { readonly choiceId: number; readonly instanceId: string; readonly moveId: string }
export interface TrainingState {
  readonly rules: MoveRules;
  readonly individuals: readonly IndividualMoves[];
  readonly pending: readonly LearningChoice[];
  readonly nextChoiceId: number;
  readonly resolvedThrough: number;
}

export function readMoveRules(input: unknown): MoveRules {
  const item = record(input, ['slotCapacity', 'moves']);
  const slotCapacity = integer(item.slotCapacity, 1);
  if (!Array.isArray(item.moves) || item.moves.length === 0) throw new TypeError('Expected move definitions');
  const moves: MoveDefinition[] = [];
  for (const value of item.moves) {
    const move = record(value, ['id', 'name', 'resource']);
    const definition = loadSpeciesCatalog([{ id: move.id, name: move.name }])[0];
    if (!definition) throw new TypeError('Missing move definition');
    if (moves.some(entry => entry.id === definition.id)) throw new RangeError('Duplicate move ID');
    const rule = record(move.resource, ['kind', 'maximum']);
    let resource: MoveResource;
    if (rule.kind === 'finite') resource = Object.freeze({ kind: 'finite', maximum: integer(rule.maximum, 1) });
    else if (rule.kind === 'none' && !Object.hasOwn(rule, 'maximum')) resource = Object.freeze({ kind: 'none' });
    else throw new TypeError('Invalid resource rule');
    moves.push(Object.freeze({ ...definition, resource }));
  }
  return Object.freeze({ slotCapacity, moves: Object.freeze(moves) });
}

export function moveDefinition(rules: MoveRules, id: unknown): MoveDefinition {
  if (typeof id !== 'string') throw new TypeError('Expected move ID');
  const result = rules.moves.find(move => move.id === id);
  if (!result) throw new RangeError('Unknown move ID');
  return result;
}
export function fullResource(move: MoveDefinition): number | null {
  return move.resource.kind === 'finite' ? move.resource.maximum : null;
}

export function readTraining(input: unknown, ownerIds: readonly string[]): TrainingState {
  const item = record(input, ['rules', 'individuals', 'pending', 'nextChoiceId', 'resolvedThrough']);
  const rules = readMoveRules(item.rules);
  const nextChoiceId = integer(item.nextChoiceId, 1);
  const resolvedThrough = integer(item.resolvedThrough, 0);
  if (resolvedThrough >= nextChoiceId) throw new RangeError('Invalid choice counters');
  if (!Array.isArray(item.individuals) || !Array.isArray(item.pending)) throw new TypeError('Expected training arrays');
  const individuals: IndividualMoves[] = [];
  for (const value of item.individuals) {
    const member = record(value, ['instanceId', 'knownMoves']);
    if (typeof member.instanceId !== 'string') throw new TypeError('Expected instance ID');
    if (!ownerIds.includes(member.instanceId) || individuals.some(entry => entry.instanceId === member.instanceId)) {
      throw new RangeError('Invalid training owner');
    }
    if (!Array.isArray(member.knownMoves)) throw new TypeError('Expected known moves');
    const knownMoves: KnownMove[] = [];
    for (const value of member.knownMoves) {
      const known = record(value, ['moveId', 'remaining']);
      const move = moveDefinition(rules, known.moveId);
      if (knownMoves.some(entry => entry.moveId === move.id)) throw new RangeError('Duplicate known move');
      let remaining: number | null;
      if (move.resource.kind === 'none') {
        if (known.remaining !== null) throw new TypeError('No-resource move requires null');
        remaining = null;
      } else {
        remaining = integer(known.remaining, 0);
        if (remaining > move.resource.maximum) throw new RangeError('Resource exceeds maximum');
      }
      knownMoves.push(Object.freeze({ moveId: move.id, remaining }));
    }
    if (knownMoves.length > rules.slotCapacity) throw new RangeError('Move slots exceeded');
    individuals.push(Object.freeze({ instanceId: member.instanceId, knownMoves: Object.freeze(knownMoves) }));
  }
  if (individuals.length !== ownerIds.length) throw new RangeError('Missing training owner');
  if (nextChoiceId - resolvedThrough - 1 !== item.pending.length) throw new RangeError('Choice counter/queue mismatch');
  const pending: LearningChoice[] = [];
  for (const value of item.pending) {
    const choice = record(value, ['choiceId', 'instanceId', 'moveId']);
    const choiceId = integer(choice.choiceId, 1);
    if (choiceId !== resolvedThrough + pending.length + 1) throw new RangeError('Choice order mismatch');
    const move = moveDefinition(rules, choice.moveId);
    if (typeof choice.instanceId !== 'string') throw new TypeError('Expected choice target');
    const member = individuals.find(entry => entry.instanceId === choice.instanceId);
    if (!member || member.knownMoves.length !== rules.slotCapacity) throw new RangeError('Invalid choice target/slots');
    if (member.knownMoves.some(entry => entry.moveId === move.id)
      || pending.some(entry => entry.instanceId === member.instanceId && entry.moveId === move.id)) {
      throw new RangeError('Duplicate learning candidate');
    }
    pending.push(Object.freeze({ choiceId, instanceId: member.instanceId, moveId: move.id }));
  }
  return Object.freeze({ rules, individuals: Object.freeze(individuals), pending: Object.freeze(pending), nextChoiceId, resolvedThrough });
}
