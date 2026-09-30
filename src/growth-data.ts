import { integer, record } from './validation';
import { moveDefinition } from './move-data';
import { itemDefinition } from './inventory-data';
import type { OwnershipState } from './ownership';

export interface LearnsetEntry {
  readonly level: number;
  readonly moveId: string;
}
export type EvolutionRule =
  | Readonly<{ kind: 'level'; level: number; toSpeciesId: string }>
  | Readonly<{ kind: 'item'; itemId: string; toSpeciesId: string }>;
export interface SpeciesGrowth {
  readonly speciesId: string;
  readonly maxHP: readonly number[];
  readonly learnset: readonly LearnsetEntry[];
  readonly evolution: EvolutionRule | null;
}
export interface GrowthRules {
  readonly thresholds: readonly number[];
  readonly species: readonly SpeciesGrowth[];
}
export interface IndividualGrowth {
  readonly instanceId: string;
  readonly experience: number;
  readonly level: number;
}
export interface EvolutionChoice {
  readonly choiceId: number;
  readonly instanceId: string;
  readonly fromSpeciesId: string;
  readonly toSpeciesId: string;
  readonly level: number;
}
export interface GrowthState {
  readonly rules: GrowthRules;
  readonly individuals: readonly IndividualGrowth[];
  readonly pending: readonly EvolutionChoice[];
  readonly nextChoiceId: number;
  readonly resolvedThrough: number;
}
export function speciesGrowth(rules: GrowthRules, id: string): SpeciesGrowth {
  const row = rules.species.find((entry) => entry.speciesId === id);
  if (!row) {
    throw new RangeError('Missing species growth');
  }
  return row;
}
export function growthLevel(rules: GrowthRules, experience: number): number {
  return rules.thresholds.filter((value) => value <= experience).length;
}
export function growthHP(rules: GrowthRules, speciesId: string, level: number): number {
  const hp = speciesGrowth(rules, speciesId).maxHP[level - 1];
  if (hp === undefined) {
    throw new RangeError('Invalid growth level');
  }
  return hp;
}
export function readGrowthRules(input: unknown, state: OwnershipState): GrowthRules {
  const item = record(input, ['thresholds', 'species']);
  if (
    !Array.isArray(item.thresholds) ||
    !item.thresholds.length ||
    !Array.isArray(item.species)
  ) {
    throw new TypeError('Expected growth arrays');
  }
  const thresholds: number[] = [];
  for (const value of item.thresholds) {
    const xp = integer(value, 0);
    const prior = thresholds[thresholds.length - 1];
    if (prior === undefined ? xp !== 0 : xp <= prior) {
      throw new RangeError('Experience thresholds must start at zero and increase');
    }
    thresholds.push(xp);
  }
  const species: SpeciesGrowth[] = [];
  for (const value of item.species) {
    const row = record(value, ['speciesId', 'maxHP', 'learnset', 'evolution']);
    if (
      typeof row.speciesId !== 'string' ||
      !state.catalog.some((entry) => entry.id === row.speciesId) ||
      species.some((entry) => entry.speciesId === row.speciesId)
    ) {
      throw new RangeError('Invalid growth species');
    }
    if (
      !Array.isArray(row.maxHP) ||
      row.maxHP.length !== thresholds.length ||
      !Array.isArray(row.learnset)
    ) {
      throw new TypeError('Expected complete HP table/learnset');
    }
    const maxHP = Object.freeze(Array.from(row.maxHP, (value) => integer(value, 1)));
    const learnset: LearnsetEntry[] = [];
    for (const value of row.learnset) {
      const entry = record(value, ['level', 'moveId']);
      const level = integer(entry.level, 1);
      if (
        level > thresholds.length ||
        level < (learnset[learnset.length - 1]?.level ?? 1)
      ) {
        throw new RangeError('Learnset level/order invalid');
      }
      if (!state.training) {
        throw new RangeError('Learnset requires learning rules');
      }
      const move = moveDefinition(state.training.rules, entry.moveId);
      if (learnset.some((entry) => entry.moveId === move.id)) {
        throw new RangeError('Duplicate learnset move');
      }
      learnset.push(Object.freeze({ level, moveId: move.id }));
    }
    let evolution: EvolutionRule | null = null;
    if (row.evolution !== null) {
      const rule = record(row.evolution, ['kind', 'level', 'itemId', 'toSpeciesId']);
      if (
        typeof rule.toSpeciesId !== 'string' ||
        rule.toSpeciesId === row.speciesId ||
        !state.catalog.some((entry) => entry.id === rule.toSpeciesId)
      ) {
        throw new RangeError('Invalid evolution species');
      }
      if (rule.kind === 'level' && !Object.hasOwn(rule, 'itemId')) {
        const level = integer(rule.level, 1);
        if (level > thresholds.length) {
          throw new RangeError('Evolution level exceeds cap');
        }
        evolution = Object.freeze({
          kind: 'level',
          level,
          toSpeciesId: rule.toSpeciesId,
        });
      } else if (rule.kind === 'item' && !Object.hasOwn(rule, 'level')) {
        if (!state.inventory) {
          throw new RangeError('Item evolution requires inventory');
        }
        const item = itemDefinition(state.inventory.rules, rule.itemId);
        if (item.effect.kind !== 'evolution') {
          throw new RangeError('Expected evolution item');
        }
        evolution = Object.freeze({
          kind: 'item',
          itemId: item.id,
          toSpeciesId: rule.toSpeciesId,
        });
      } else {
        throw new TypeError('Invalid evolution rule');
      }
    }
    species.push(
      Object.freeze({
        speciesId: row.speciesId,
        maxHP,
        learnset: Object.freeze(learnset),
        evolution,
      }),
    );
  }
  if (species.length !== state.catalog.length) {
    throw new RangeError('Incomplete species growth rules');
  }
  for (const start of species) {
    const visited = new Set<string>();
    let id: string | undefined = start.speciesId;
    while (id !== undefined) {
      if (visited.has(id)) {
        throw new RangeError('Evolution cycle');
      }
      visited.add(id);
      id = species.find((entry) => entry.speciesId === id)?.evolution?.toSpeciesId;
    }
  }
  return Object.freeze({
    thresholds: Object.freeze(thresholds),
    species: Object.freeze(species),
  });
}
export function readGrowth(input: unknown, state: OwnershipState): GrowthState {
  const item = record(input, [
    'rules',
    'individuals',
    'pending',
    'nextChoiceId',
    'resolvedThrough',
  ]);
  const rules = readGrowthRules(item.rules, state);
  if (!Array.isArray(item.individuals) || !Array.isArray(item.pending)) {
    throw new TypeError('Expected growth records');
  }
  const cap = rules.thresholds[rules.thresholds.length - 1];
  if (cap === undefined) {
    throw new RangeError('Missing level cap');
  }
  const individuals: IndividualGrowth[] = [];
  for (const value of item.individuals) {
    const member = record(value, ['instanceId', 'experience', 'level']);
    const owner = state.owned.find((entry) => entry.monster.id === member.instanceId);
    if (!owner || individuals.some((entry) => entry.instanceId === member.instanceId)) {
      throw new RangeError('Invalid progression owner');
    }
    const experience = integer(member.experience, 0);
    const level = integer(member.level, 1);
    if (
      experience > cap ||
      level !== growthLevel(rules, experience) ||
      owner.health.maxHP !== growthHP(rules, owner.monster.speciesId, level)
    ) {
      throw new RangeError('Experience/level/HP mismatch');
    }
    individuals.push(Object.freeze({ instanceId: owner.monster.id, experience, level }));
  }
  const nextChoiceId = integer(item.nextChoiceId, 1);
  const resolvedThrough = integer(item.resolvedThrough, 0);
  if (
    resolvedThrough >= nextChoiceId ||
    nextChoiceId - resolvedThrough - 1 !== item.pending.length
  ) {
    throw new RangeError('Evolution counters mismatch');
  }
  const pending: EvolutionChoice[] = [];
  for (const value of item.pending) {
    const choice = record(value, [
      'choiceId',
      'instanceId',
      'fromSpeciesId',
      'toSpeciesId',
      'level',
    ]);
    const choiceId = integer(choice.choiceId, 1);
    const level = integer(choice.level, 1);
    const owner = state.owned.find((entry) => entry.monster.id === choice.instanceId);
    const member = individuals.find((entry) => entry.instanceId === choice.instanceId);
    if (
      !owner ||
      !member ||
      pending.some((entry) => entry.instanceId === choice.instanceId) ||
      choiceId !== resolvedThrough + pending.length + 1 ||
      owner.monster.speciesId !== choice.fromSpeciesId
    ) {
      throw new RangeError('Invalid evolution choice order/target');
    }
    const rule = speciesGrowth(rules, owner.monster.speciesId).evolution;
    if (
      !rule ||
      rule.kind !== 'level' ||
      rule.level !== level ||
      member.level < level ||
      rule.toSpeciesId !== choice.toSpeciesId
    ) {
      throw new RangeError('Ineligible evolution choice');
    }
    pending.push(
      Object.freeze({
        choiceId,
        instanceId: owner.monster.id,
        fromSpeciesId: owner.monster.speciesId,
        toSpeciesId: rule.toSpeciesId,
        level,
      }),
    );
  }
  return Object.freeze({
    rules,
    individuals: Object.freeze(individuals),
    pending: Object.freeze(pending),
    nextChoiceId,
    resolvedThrough,
  });
}
