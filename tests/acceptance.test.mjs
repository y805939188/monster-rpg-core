import test from 'node:test';
import assert from 'node:assert/strict';
import { runAcceptance } from '../examples/acceptance.mjs';

for (const second of [false, true]) for (const adapter of ['script', 'frames']) {
  test(`v2 complete public loop: ${second ? 'short-none-full' : 'long-finite-fixed'} / ${adapter}`, () => {
    const result = runAcceptance(second, adapter);
    assert.deepEqual(result.species, ['cloudbloom', 'sproutlet', 'emberlynx']);
    assert.deepEqual(result.hp, second ? [5, 8, 2] : [2, 2, 5]);
    assert.deepEqual(result.levels, [3, 3, 1]); assert.deepEqual(result.party, ['one', 'two']);
    assert.equal(result.remaining, second ? null : 2); assert.equal(result.tonic, 2);
    assert.equal(result.stages.length, 6);
  });
}
