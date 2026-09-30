import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadSpeciesCatalog, createMonsters, createOwnership, admitMonster, depositMonster, withdrawMonster,
  healMonster, enableLearning, requestLearning, resolveLearning, useMove, restoreMoveResources,
} from 'monster-rpg-core';

const species = loadSpeciesCatalog([{ id: 'mossglow', name: 'Mossglow' }]);
const monster = id => createMonsters(species, [{ id, speciesId: 'mossglow' }])[0];
const health = { currentHP: 2, maxHP: 10, condition: null };
const rules = (slotCapacity = 1, none = false) => ({ slotCapacity, moves: [
  { id: 'mosschime', name: 'Mosschime', resource: none ? { kind: 'none' } : { kind: 'finite', maximum: 2 } },
  { id: 'emberloop', name: 'Emberloop', resource: none ? { kind: 'none' } : { kind: 'finite', maximum: 3 } },
  { id: 'mistbell', name: 'Mistbell', resource: { kind: 'none' } },
  { id: 'leafarc', name: 'Leafarc', resource: { kind: 'finite', maximum: 1 } },
] });
const legacy = () => admitMonster(createOwnership(species, { totalCapacity: 3, partyCapacity: 1 }), monster('one'), health);
const initial = (capacity = 1, none = false) => enableLearning(legacy(), rules(capacity, none));
const known = (state, id = 'one') => state.training.individuals.find(entry => entry.instanceId === id).knownMoves;
const rejectUnchanged = (state, action, error = RangeError) => {
  const before = structuredClone(state);
  assert.throws(action, error);
  assert.deepEqual(state, before);
};

test('empty slot learns full resource; known/pending duplicates and unknown references reject', () => {
  const start = initial();
  const learned = requestLearning(start, 'one', 'mosschime');
  assert.deepEqual(known(learned), [{ moveId: 'mosschime', remaining: 2 }]);
  assert.deepEqual(known(start), []);
  assert.deepEqual(learned.training.pending, []);
  rejectUnchanged(learned, () => requestLearning(learned, 'one', 'mosschime'));
  rejectUnchanged(learned, () => requestLearning(learned, 'missing', 'mosschime'));
  rejectUnchanged(learned, () => requestLearning(learned, 'one', 'missing'));
  rejectUnchanged(learned, () => enableLearning(learned, rules()));
  const queued = requestLearning(learned, 'one', 'emberloop');
  assert.deepEqual(queued.training.pending, [{ choiceId: 1, instanceId: 'one', moveId: 'emberloop' }]);
  rejectUnchanged(queued, () => requestLearning(queued, 'one', 'emberloop'));
  rejectUnchanged(legacy(), () => requestLearning(legacy(), 'one', 'mosschime'));
});

test('full slots yield ordered choices; replace/decline/replay preserve exact target and order', () => {
  let state = requestLearning(initial(), 'one', 'mosschime');
  state = requestLearning(state, 'one', 'emberloop');
  state = requestLearning(state, 'one', 'mistbell');
  assert.deepEqual(state.training.pending, [
    { choiceId: 1, instanceId: 'one', moveId: 'emberloop' },
    { choiceId: 2, instanceId: 'one', moveId: 'mistbell' },
  ]);
  rejectUnchanged(state, () => resolveLearning(state, 2, 'one', { kind: 'decline' }));
  rejectUnchanged(state, () => resolveLearning(state, 3, 'one', { kind: 'decline' }));
  rejectUnchanged(state, () => resolveLearning(state, 1, 'missing', { kind: 'decline' }));
  rejectUnchanged(state, () => resolveLearning(state, 1, 'one', { kind: 'replace', moveId: 'mistbell' }));
  const replaced = resolveLearning(state, 1, 'one', { kind: 'replace', moveId: 'mosschime' });
  assert.deepEqual(known(replaced), [{ moveId: 'emberloop', remaining: 3 }]);
  assert.deepEqual(replaced.training.pending, [{ choiceId: 2, instanceId: 'one', moveId: 'mistbell' }]);
  rejectUnchanged(replaced, () => resolveLearning(replaced, 1, 'one', { kind: 'replace', moveId: 'emberloop' }));
  const declined = resolveLearning(replaced, 2, 'one', { kind: 'decline' });
  assert.deepEqual(known(declined), known(replaced));
  assert.deepEqual(declined.training.pending, []);
  rejectUnchanged(declined, () => resolveLearning(declined, 2, 'one', { kind: 'decline' }));
  assert.equal(requestLearning(declined, 'one', 'mistbell').training.pending[0].choiceId, 3);
});

test('global queue validates known but wrong target; replacement preserves other slot resources', () => {
  let state = admitMonster(initial(2), monster('two'), health);
  for (const id of ['one', 'two']) {
    state = requestLearning(requestLearning(state, id, 'mosschime'), id, 'emberloop');
    state = requestLearning(state, id, 'mistbell');
  }
  rejectUnchanged(state, () => resolveLearning(state, 1, 'two', { kind: 'decline' }));
  state = useMove(state, 'one', 'mosschime', 1);
  const replaced = resolveLearning(state, 1, 'one', { kind: 'replace', moveId: 'emberloop' });
  assert.deepEqual(known(replaced), [{ moveId: 'mosschime', remaining: 1 }, { moveId: 'mistbell', remaining: null }]);
  assert.deepEqual(known(replaced, 'two'), [{ moveId: 'mosschime', remaining: 2 }, { moveId: 'emberloop', remaining: 3 }]);
  assert.equal(replaced.training.pending[0].instanceId, 'two');
});

test('finite exhaustion/invalid requests fail atomically; restore is explicit and repeat-safe', () => {
  const learned = requestLearning(initial(), 'one', 'mosschime');
  const zero = useMove(learned, 'one', 'mosschime', 2);
  assert.equal(known(zero)[0].remaining, 0);
  rejectUnchanged(zero, () => useMove(zero, 'one', 'mosschime', 1));
  rejectUnchanged(learned, () => useMove(learned, 'one', 'mosschime', 3));
  rejectUnchanged(learned, () => useMove(learned, 'one', 'emberloop', 1));
  for (const amount of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    rejectUnchanged(learned, () => useMove(learned, 'one', 'mosschime', amount));
  }
  rejectUnchanged(learned, () => useMove(learned, 'one', 'mosschime', '1'), TypeError);
  assert.equal(known(healMonster(zero, 'one', 10))[0].remaining, 0);
  const restored = restoreMoveResources(zero, 'one');
  assert.equal(known(restored)[0].remaining, 2);
  assert.deepEqual(restoreMoveResources(restored, 'one'), restored);
  assert.deepEqual(restored.owned, zero.owned);
});

test('second no-resource configuration works without finite counters', () => {
  const state = requestLearning(requestLearning(initial(2, true), 'one', 'mosschime'), 'one', 'emberloop');
  assert.deepEqual(known(state), [{ moveId: 'mosschime', remaining: null }, { moveId: 'emberloop', remaining: null }]);
  assert.deepEqual(useMove(state, 'one', 'mosschime', Number.MAX_SAFE_INTEGER), state);
  assert.deepEqual(restoreMoveResources(state, 'one'), state);
  rejectUnchanged(state, () => useMove(state, 'one', 'mosschime', 0));
});

test('content validates resource tags, duplicates, exact fields and numerical limits', () => {
  const base = legacy();
  for (const invalid of [null, {}, { ...rules(), extra: 1 }, { ...rules(), moves: [] },
    { ...rules(), moves: [{ id: 'Bad', name: 'Bad', resource: { kind: 'none' } }] },
    { ...rules(), moves: [{ id: 'good', name: 'Good', resource: { kind: 'none', maximum: 1 } }] },
    { ...rules(), moves: [{ id: 'good', name: 'Good', resource: { kind: 'script', code: 'x' } }] }]) {
    rejectUnchanged(base, () => enableLearning(base, invalid), TypeError);
  }
  for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    rejectUnchanged(base, () => enableLearning(base, { ...rules(), slotCapacity: value }));
    const config = rules(); config.moves[0].resource.maximum = value;
    rejectUnchanged(base, () => enableLearning(base, config));
  }
  const duplicate = rules(); duplicate.moves.push(duplicate.moves[0]);
  rejectUnchanged(base, () => enableLearning(base, duplicate));
  const large = rules(); large.moves[0].resource.maximum = Number.MAX_SAFE_INTEGER;
  const learned = requestLearning(enableLearning(base, large), 'one', 'mosschime');
  assert.equal(known(useMove(learned, 'one', 'mosschime', Number.MAX_SAFE_INTEGER))[0].remaining, 0);
});

test('ordinary external snapshots must satisfy owner/move/resource/counter/queue invariants', () => {
  const full = requestLearning(initial(), 'one', 'mosschime');
  const queued = requestLearning(full, 'one', 'emberloop');
  const corruptions = [
    s => { s.training.individuals = []; },
    s => { s.training.individuals.push(s.training.individuals[0]); },
    s => { s.training.individuals[0].instanceId = 'missing'; },
    s => { s.training.individuals[0].knownMoves[0].moveId = 'missing'; },
    s => { s.training.individuals[0].knownMoves[0].remaining = -1; },
    s => { s.training.individuals[0].knownMoves[0].remaining = 3; },
    s => { s.training.individuals[0].knownMoves.push(s.training.individuals[0].knownMoves[0]); },
    s => { s.training.pending[0].choiceId = 2; },
    s => { s.training.pending[0].instanceId = 'missing'; },
    s => { s.training.pending[0].moveId = 'mosschime'; },
    s => { s.training.nextChoiceId = 3; },
    s => { s.training.resolvedThrough = 2; },
    s => { s.training.individuals[0].knownMoves = []; },
  ];
  for (const corrupt of corruptions) {
    const invalid = structuredClone(queued); corrupt(invalid);
    rejectUnchanged(invalid, () => depositMonster(invalid, 'one'));
  }
  const explicitUndefined = { ...queued, training: undefined };
  assert.throws(() => healMonster(explicitUndefined, 'one', 1), TypeError);
  const noResource = structuredClone(requestLearning(initial(1, true), 'one', 'mosschime'));
  noResource.training.individuals[0].knownMoves[0].remaining = 2;
  assert.throws(() => restoreMoveResources(noResource, 'one'), TypeError);
  const exhausted = structuredClone(full);
  exhausted.training.nextChoiceId = Number.MAX_SAFE_INTEGER;
  exhausted.training.resolvedThrough = Number.MAX_SAFE_INTEGER - 1;
  rejectUnchanged(exhausted, () => requestLearning(exhausted, 'one', 'emberloop'));
});

test('malformed choices cannot consume queue or replace another move', () => {
  const queued = requestLearning(requestLearning(initial(), 'one', 'mosschime'), 'one', 'emberloop');
  for (const decision of [null, {}, { kind: 'replace' }, { kind: 'replace', moveId: 1 },
    { kind: 'decline', moveId: 'mosschime' }, { kind: 'decline', extra: true }]) {
    rejectUnchanged(queued, () => resolveLearning(queued, 1, 'one', decision), TypeError);
  }
  for (const id of [0, -1, NaN, Infinity, 0.5]) rejectUnchanged(queued, () => resolveLearning(queued, id, 'one', { kind: 'decline' }));
  rejectUnchanged(queued, () => resolveLearning(queued, '1', 'one', { kind: 'decline' }), TypeError);
});

test('training survives F2 transitions/admission; aliases cannot mutate authoritative data', () => {
  const config = rules();
  const initialized = enableLearning(legacy(), config);
  config.moves[0].resource.maximum = 99; config.moves.push(config.moves[0]);
  assert.equal(initialized.training.rules.moves[0].resource.maximum, 2);
  let state = requestLearning(initialized, 'one', 'mosschime');
  state = requestLearning(state, 'one', 'emberloop');
  const trainingBefore = structuredClone(state.training);
  assert.deepEqual(withdrawMonster(depositMonster(healMonster(state, 'one', 1), 'one'), 'one').training, trainingBefore);
  const added = admitMonster(state, monster('two'), health);
  assert.deepEqual(known(added, 'two'), []);
  assert.deepEqual(added.training.pending, state.training.pending);
  for (const mutate of [
    () => { added.training.pending[0].choiceId = 9; },
    () => { added.training.individuals[0].knownMoves[0].remaining = 99; },
    () => { added.training.rules.moves[0].resource.maximum = 99; },
    () => { added.training.individuals.push(added.training.individuals[0]); },
  ]) assert.throws(mutate, TypeError);
  const raw = structuredClone(added);
  const next = useMove(raw, 'one', 'mosschime', 1);
  raw.training.individuals[0].knownMoves[0].remaining = 0;
  assert.equal(known(next)[0].remaining, 1);
  assert.equal(known(added)[0].remaining, 2);
});
