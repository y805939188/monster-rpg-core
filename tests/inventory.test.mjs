import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadSpeciesCatalog, createMonsters, createOwnership, admitMonster, depositMonster,
  enableInventory, addItems, useMedicine, enableCollection, recordSeen,
  enableLearning, requestLearning, useMove,
} from 'monster-rpg-core';

const species = loadSpeciesCatalog([{ id: 'mossglow', name: 'Mossglow' }, { id: 'cinderfin', name: 'Cinderfin' }]);
const monster = (id, speciesId = 'mossglow') => createMonsters(species, [{ id, speciesId }])[0];
const hp = (currentHP = 2, condition = 'weary') => ({ currentHP, maxHP: 10, condition });
const empty = (totalCapacity = 3) => createOwnership(species, { totalCapacity, partyCapacity: 1 });
const owned = (health = hp()) => admitMonster(empty(), monster('one'), health);
const rules = (stackCapacity = 4, stackLimit = 10) => ({ stackCapacity, stackLimit, items: [
  { id: 'moss-balm', name: 'Moss Balm', effect: { kind: 'heal', amount: 3 } },
  { id: 'dawn-drop', name: 'Dawn Drop', effect: { kind: 'revive', amount: 4 } },
  { id: 'clear-dew', name: 'Clear Dew', effect: { kind: 'clearCondition' } },
  { id: 'echo-tonic', name: 'Echo Tonic', effect: { kind: 'restoreResources' } },
] });
const ready = (health = hp()) => enableInventory(owned(health), rules());
const count = (state, itemId) => state.inventory.stacks.find(entry => entry.itemId === itemId)?.count ?? 0;
const rejectUnchanged = (state, action, error = RangeError) => {
  const before = structuredClone(state);
  assert.throws(action, error);
  assert.deepEqual(state, before);
};

test('stack capacity/limits and positive quantities reject overflow without loss', () => {
  let state = enableInventory(owned(), rules(1, 2));
  state = addItems(state, 'moss-balm', 1);
  rejectUnchanged(state, () => addItems(state, 'clear-dew', 1));
  state = addItems(state, 'moss-balm', 1);
  assert.equal(count(state, 'moss-balm'), 2);
  rejectUnchanged(state, () => addItems(state, 'moss-balm', 1));
  for (const n of [0, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) rejectUnchanged(state, () => addItems(state, 'moss-balm', n));
  rejectUnchanged(state, () => addItems(state, 'moss-balm', '1'), TypeError);
  rejectUnchanged(state, () => addItems(state, 'unknown', 1));
  const zero = enableInventory(owned(), rules(0));
  rejectUnchanged(zero, () => addItems(zero, 'moss-balm', 1));
  const maximum = addItems(enableInventory(owned(), rules(1, Number.MAX_SAFE_INTEGER)), 'moss-balm', Number.MAX_SAFE_INTEGER);
  rejectUnchanged(maximum, () => addItems(maximum, 'moss-balm', 1));
  assert.equal(count(useMedicine(maximum, 'moss-balm', 'one'), 'moss-balm'), Number.MAX_SAFE_INTEGER - 1);
});

test('healing consumes exactly one atomically; retry semantics are explicit', () => {
  const before = addItems(ready(), 'moss-balm', 4);
  const once = useMedicine(before, 'moss-balm', 'one');
  assert.equal(once.owned[0].health.currentHP, 5);
  assert.equal(count(once, 'moss-balm'), 3);
  assert.equal(before.owned[0].health.currentHP, 2);
  assert.equal(count(before, 'moss-balm'), 4);
  assert.deepEqual(useMedicine(before, 'moss-balm', 'one'), once);
  const twice = useMedicine(once, 'moss-balm', 'one');
  assert.equal(twice.owned[0].health.currentHP, 8);
  assert.equal(count(twice, 'moss-balm'), 2);
  const full = useMedicine(twice, 'moss-balm', 'one');
  assert.equal(full.owned[0].health.currentHP, 10);
  assert.equal(count(full, 'moss-balm'), 1);
  rejectUnchanged(full, () => useMedicine(full, 'moss-balm', 'one'));
  const last = useMedicine(addItems(ready(), 'moss-balm', 1), 'moss-balm', 'one');
  assert.deepEqual(last.inventory.stacks, []);
  rejectUnchanged(last, () => useMedicine(last, 'moss-balm', 'one'));
});

test('revive/clear are distinct; heal cannot revive and ineffective targets never debit', () => {
  let fainted = addItems(addItems(ready(hp(0)), 'moss-balm', 1), 'dawn-drop', 2);
  rejectUnchanged(fainted, () => useMedicine(fainted, 'moss-balm', 'one'));
  const revived = useMedicine(fainted, 'dawn-drop', 'one');
  assert.deepEqual(revived.owned[0].health, hp(4));
  assert.equal(count(revived, 'dawn-drop'), 1);
  rejectUnchanged(revived, () => useMedicine(revived, 'dawn-drop', 'one'));
  fainted = addItems(fainted, 'clear-dew', 2);
  const cleared = useMedicine(fainted, 'clear-dew', 'one');
  assert.deepEqual(cleared.owned[0].health, hp(0, null));
  assert.equal(count(cleared, 'clear-dew'), 1);
  rejectUnchanged(cleared, () => useMedicine(cleared, 'clear-dew', 'one'));
  assert.deepEqual(cleared.owned[0].monster, fainted.owned[0].monster);
});

test('resource medicine restores finite moves only; does not change HP/choices', () => {
  const config = { slotCapacity: 2, moves: [
    { id: 'mosschime', name: 'Mosschime', resource: { kind: 'finite', maximum: 2 } },
    { id: 'mistbell', name: 'Mistbell', resource: { kind: 'none' } },
  ] };
  let state = enableLearning(addItems(ready(), 'echo-tonic', 2), config);
  state = requestLearning(requestLearning(state, 'one', 'mosschime'), 'one', 'mistbell');
  rejectUnchanged(state, () => useMedicine(state, 'echo-tonic', 'one'));
  state = useMove(state, 'one', 'mosschime', 2);
  const restored = useMedicine(state, 'echo-tonic', 'one');
  assert.deepEqual(restored.training.individuals[0].knownMoves, [{ moveId: 'mosschime', remaining: 2 }, { moveId: 'mistbell', remaining: null }]);
  assert.deepEqual(restored.owned, state.owned);
  assert.deepEqual(restored.training.pending, state.training.pending);
  assert.equal(count(restored, 'echo-tonic'), 1);
  const disabled = addItems(ready(), 'echo-tonic', 1);
  rejectUnchanged(disabled, () => useMedicine(disabled, 'echo-tonic', 'one'));
  const none = requestLearning(enableLearning(disabled, { slotCapacity: 1, moves: [config.moves[1]] }), 'one', 'mistbell');
  rejectUnchanged(none, () => useMedicine(none, 'echo-tonic', 'one'));
});

test('unknown targets/items, insufficient quantity and malformed rules fail unchanged', () => {
  const state = addItems(ready(), 'moss-balm', 1);
  for (const [item, target] of [['missing', 'one'], ['moss-balm', 'missing'], ['clear-dew', 'one']]) {
    rejectUnchanged(state, () => useMedicine(state, item, target));
  }
  rejectUnchanged(state, () => useMedicine(state, 'moss-balm', 1), TypeError);
  rejectUnchanged(state, () => enableInventory(state, rules()));
  rejectUnchanged(owned(), () => addItems(owned(), 'moss-balm', 1));
  for (const n of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => enableInventory(owned(), rules(n)), RangeError);
    assert.throws(() => enableInventory(owned(), rules(1, n)), RangeError);
  }
  assert.throws(() => enableInventory(owned(), rules(1, 0)), RangeError);
  for (const bad of [null, {}, { ...rules(), items: [] }, { ...rules(), extra: 1 },
    { ...rules(), items: [{ id: 'bad', name: 'Bad', effect: { kind: 'script', code: 'x' } }] },
    { ...rules(), items: [{ id: 'bad', name: 'Bad', effect: { kind: 'clearCondition', amount: 1 } }] }]) {
    assert.throws(() => enableInventory(owned(), bad), TypeError);
  }
  const duplicate = rules(); duplicate.items.push(duplicate.items[0]);
  assert.throws(() => enableInventory(owned(), duplicate), RangeError);
  for (const amount of [0, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const bad = rules(); bad.items[0].effect.amount = amount;
    assert.throws(() => enableInventory(owned(), bad), RangeError);
  }
});

test('seen differs from acquired; successful admission is one atomic acquisition path', () => {
  const state = enableCollection(empty(1));
  assert.deepEqual(state.collection, { seen: [], acquired: [] });
  const seen = recordSeen(state, 'cinderfin');
  assert.deepEqual(seen.collection, { seen: ['cinderfin'], acquired: [] });
  assert.deepEqual(recordSeen(seen, 'cinderfin'), seen);
  const admitted = admitMonster(seen, monster('one'), hp());
  assert.deepEqual(admitted.collection, { seen: ['cinderfin', 'mossglow'], acquired: ['mossglow'] });
  rejectUnchanged(admitted, () => admitMonster(admitted, monster('two', 'cinderfin'), hp()));
  rejectUnchanged(admitted, () => admitMonster(admitted, monster('one'), hp()));
  assert.deepEqual(depositMonster(admitted, 'one').collection, admitted.collection);
  rejectUnchanged(seen, () => recordSeen(seen, 'missing'));
  rejectUnchanged(seen, () => recordSeen(seen, 1), TypeError);
  rejectUnchanged(seen, () => enableCollection(seen));
  const existing = enableCollection(owned());
  assert.deepEqual(existing.collection, { seen: ['mossglow'], acquired: ['mossglow'] });
  const both = admitMonster(existing, monster('two', 'cinderfin'), hp());
  assert.deepEqual(both.collection, { seen: ['mossglow', 'cinderfin'], acquired: ['mossglow', 'cinderfin'] });
  assert.deepEqual(admitMonster(both, monster('three'), hp()).collection, both.collection);
});

test('external snapshots reject invalid stacks and collection invariants; history may outlive holdings', () => {
  const state = enableCollection(addItems(ready(), 'moss-balm', 2));
  const corruptions = [
    s => { s.inventory.stacks[0].count = 0; }, s => { s.inventory.stacks[0].count = -1; },
    s => { s.inventory.stacks[0].count = 11; }, s => { s.inventory.stacks[0].count = Infinity; },
    s => { s.inventory.stacks[0].itemId = 'unknown'; }, s => { s.inventory.stacks.push(s.inventory.stacks[0]); },
    s => { s.inventory.rules.stackCapacity = 0; },
    s => { s.collection.seen = []; }, s => { s.collection.acquired = []; },
    s => { s.collection.acquired.push('mossglow'); }, s => { s.collection.seen.push('missing'); },
  ];
  for (const corrupt of corruptions) {
    const invalid = structuredClone(state); corrupt(invalid);
    rejectUnchanged(invalid, () => useMedicine(invalid, 'moss-balm', 'one'));
  }
  for (const key of ['inventory', 'collection']) assert.throws(() => recordSeen({ ...state, [key]: undefined }, 'cinderfin'), TypeError);
  const historical = { ...enableCollection(empty()), collection: { seen: ['mossglow'], acquired: ['mossglow'] } };
  const observed = recordSeen(historical, 'cinderfin');
  assert.deepEqual(observed.collection, { seen: ['mossglow', 'cinderfin'], acquired: ['mossglow'] });
  assert.equal(observed.owned.length, 0);
});

test('inventory/collection aliases stay isolated across medicine and admission', () => {
  const input = rules();
  const state = enableCollection(addItems(enableInventory(owned(), input), 'moss-balm', 2));
  input.items[0].effect.amount = 99;
  input.stackLimit = 1;
  assert.equal(state.inventory.rules.items[0].effect.amount, 3);
  const next = useMedicine(state, 'moss-balm', 'one');
  assert.deepEqual(next.collection, state.collection);
  for (const mutate of [
    () => { next.inventory.stacks[0].count = 9; },
    () => { next.inventory.rules.items[0].effect.amount = 99; },
    () => { next.collection.seen.push('cinderfin'); },
    () => { next.collection.acquired[0] = 'cinderfin'; },
  ]) assert.throws(mutate, TypeError);
  const raw = structuredClone(state);
  const admitted = admitMonster(raw, monster('two', 'cinderfin'), hp());
  raw.collection.seen.push('cinderfin'); raw.inventory.stacks[0].count = 9;
  assert.equal(count(admitted, 'moss-balm'), 2);
  assert.deepEqual(admitted.collection.acquired, ['mossglow', 'cinderfin']);
});

test('all optional features preserve one authoritative snapshot during medicine/admission', () => {
  const config = { slotCapacity: 1, moves: [
    { id: 'mosschime', name: 'Mosschime', resource: { kind: 'finite', maximum: 2 } },
    { id: 'mistbell', name: 'Mistbell', resource: { kind: 'none' } },
  ] };
  let state = enableLearning(enableCollection(addItems(ready(), 'echo-tonic', 2)), config);
  state = requestLearning(requestLearning(state, 'one', 'mosschime'), 'one', 'mistbell');
  state = useMove(state, 'one', 'mosschime', 1);
  const before = structuredClone(state);
  const restored = useMedicine(state, 'echo-tonic', 'one');
  assert.deepEqual(restored.training.pending, before.training.pending);
  assert.deepEqual(restored.collection, before.collection);
  assert.deepEqual(restored.owned, before.owned);
  const admitted = admitMonster(restored, monster('two', 'cinderfin'), hp());
  assert.deepEqual(admitted.training.individuals[1], { instanceId: 'two', knownMoves: [] });
  assert.deepEqual(admitted.training.pending, before.training.pending);
  assert.deepEqual(admitted.collection.acquired, ['mossglow', 'cinderfin']);
  assert.equal(count(admitted, 'echo-tonic'), 1);
  assert.deepEqual(admitted.party, ['one']);
  assert.deepEqual(state, before);
});
