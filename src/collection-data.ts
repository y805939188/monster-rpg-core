import type { SpeciesCatalog } from './species.js';
import { record } from './validation.js';

export interface CollectionState { readonly seen: readonly string[]; readonly acquired: readonly string[] }

export function readCollection(input: unknown, catalog: SpeciesCatalog, ownedSpecies: readonly string[]): CollectionState {
  const item = record(input, ['seen', 'acquired']);
  function list(value: unknown): readonly string[] {
    if (!Array.isArray(value)) throw new TypeError('Expected species records');
    const result: string[] = [];
    for (const id of value) {
      if (typeof id !== 'string') throw new TypeError('Expected species ID');
      if (!catalog.some(entry => entry.id === id) || result.includes(id)) throw new RangeError('Invalid species record');
      result.push(id);
    }
    return Object.freeze(result);
  }
  const seen = list(item.seen);
  const acquired = list(item.acquired);
  if (acquired.some(id => !seen.includes(id)) || ownedSpecies.some(id => !acquired.includes(id))) {
    throw new RangeError('Acquisition/ownership records inconsistent');
  }
  return Object.freeze({ seen, acquired });
}
export function recordAcquisition(collection: CollectionState, speciesId: string): CollectionState {
  return {
    seen: collection.seen.includes(speciesId) ? collection.seen : [...collection.seen, speciesId],
    acquired: collection.acquired.includes(speciesId) ? collection.acquired : [...collection.acquired, speciesId],
  };
}
