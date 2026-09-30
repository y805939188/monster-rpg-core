import { validState } from './ownership.js';
import type { OwnershipState } from './ownership.js';

export function enableCollection(state: OwnershipState): OwnershipState {
  const current = validState(state);
  if (current.collection) throw new RangeError('Collection already enabled');
  const ids = [...new Set(current.owned.map(entry => entry.monster.speciesId))];
  return validState({ ...current, collection: { seen: ids, acquired: ids } });
}
export function recordSeen(state: OwnershipState, speciesId: unknown): OwnershipState {
  const current = validState(state);
  if (!current.collection) throw new RangeError('Collection not enabled');
  if (typeof speciesId !== 'string') throw new TypeError('Expected species ID');
  if (!current.catalog.some(entry => entry.id === speciesId)) throw new RangeError('Unknown species ID');
  const collection = current.collection;
  const seen = collection.seen.includes(speciesId) ? collection.seen : [...collection.seen, speciesId];
  return validState({ ...current, collection: { ...collection, seen } });
}
