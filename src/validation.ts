export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))) {
    throw new TypeError('Expected documented record fields');
  }
  // Object.entries supplies unknown values through this explicitly typed copy.
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) result[key] = entry;
  return result;
}
export function integer(value: unknown, minimum: number): number {
  if (typeof value !== 'number') throw new TypeError('Expected a number');
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError('Invalid integer bounds');
  return value;
}
