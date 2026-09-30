import { validState } from './ownership.js';
import type { OwnershipState } from './ownership.js';
import { integer, record } from './validation.js';

export interface SaveData {
  readonly format: 'monster-rpg-core-save';
  readonly version: 1;
  readonly contentVersion: 1;
  readonly rulesVersion: 1;
  readonly state: OwnershipState;
  readonly counters: Readonly<{ nextCommandId: number }>;
}
/** Internal encoding only; the controller checks that no live session exists. */
export function serializeSave(state: OwnershipState, nextCommandId: number): string {
  const data: SaveData = { format: 'monster-rpg-core-save', version: 1, contentVersion: 1, rulesVersion: 1,
    state: validState(state), counters: { nextCommandId: integer(nextCommandId, 1) } };
  return JSON.stringify(data);
}
export function parseSave(input: unknown): SaveData {
  if (typeof input !== 'string') throw new TypeError('Expected saved JSON text');
  const parsed: unknown = JSON.parse(input);
  const data = record(parsed, ['format', 'version', 'contentVersion', 'rulesVersion', 'state', 'counters']);
  if (data.format !== 'monster-rpg-core-save' || data.version !== 1 || data.contentVersion !== 1 || data.rulesVersion !== 1) {
    throw new RangeError('Unsupported save/content/rules version');
  }
  const counters = record(data.counters, ['nextCommandId']);
  const nextCommandId = integer(counters.nextCommandId, 1);
  const state = validState(data.state);
  return Object.freeze({ format: 'monster-rpg-core-save', version: 1, contentVersion: 1, rulesVersion: 1,
    state, counters: Object.freeze({ nextCommandId }) });
}
