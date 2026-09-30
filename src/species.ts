export interface SpeciesDefinition {
  readonly id: string;
  readonly name: string;
}

export type SpeciesCatalog = readonly SpeciesDefinition[];

export interface MonsterInstance {
  readonly id: string;
  readonly speciesId: string;
  readonly nickname: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function fields(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!record(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) {
    throw new TypeError('Expected a record with only the documented fields');
  }
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 80 || value.trim() !== value) {
    throw new TypeError('Expected trimmed text of 1–80 UTF-16 code units');
  }
  return value;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || value.trim() !== value || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) {
    throw new TypeError('Expected an ID matching [a-z][a-z0-9-]{0,63}');
  }
  return value;
}

/** Validate external content and detach immutable definitions from caller data. */
export function loadSpeciesCatalog(input: unknown): SpeciesCatalog {
  if (!Array.isArray(input) || input.length === 0) throw new TypeError('Expected a nonempty species array');
  const ids = new Set<string>();
  const result: SpeciesDefinition[] = [];
  for (const entry of input) {
    const item = fields(entry, ['id', 'name']);
    const speciesId = id(item.id);
    const name = text(item.name);
    if (ids.has(speciesId)) throw new RangeError('Duplicate species ID');
    ids.add(speciesId);
    result.push(Object.freeze({ id: speciesId, name }));
  }
  return Object.freeze(result);
}

/** IDs are unique within this batch only; this function does not own a collection. */
export function createMonsters(catalog: SpeciesCatalog, input: unknown): readonly MonsterInstance[] {
  const species = new Map(loadSpeciesCatalog(catalog).map(item => [item.id, item]));
  if (!Array.isArray(input)) throw new TypeError('Expected a creation array');
  const ids = new Set<string>();
  const result: MonsterInstance[] = [];
  for (const entry of input) {
    const item = fields(entry, ['id', 'speciesId', 'nickname']);
    const instanceId = id(item.id);
    const speciesId = id(item.speciesId);
    const definition = species.get(speciesId);
    if (!definition) throw new RangeError('Unknown species ID');
    const nickname = Object.hasOwn(item, 'nickname') ? text(item.nickname) : definition.name;
    if (ids.has(instanceId)) throw new RangeError('Duplicate instance ID in creation batch');
    ids.add(instanceId);
    result.push(Object.freeze({ id: instanceId, speciesId, nickname }));
  }
  return Object.freeze(result);
}
