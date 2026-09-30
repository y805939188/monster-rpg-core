import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadSpeciesCatalog,
  createMonsters,
  createOwnership,
  admitMonster,
  depositMonster,
  withdrawMonster,
  reorderParty,
  healMonster,
  reviveMonster,
  clearCondition,
} from 'monster-rpg-core';

const catalog = loadSpeciesCatalog([
  { id: 'mossglow', name: 'Mossglow' },
  { id: 'cinderfin', name: 'Cinderfin' },
]);
const monster = (id) => createMonsters(catalog, [{ id, speciesId: 'mossglow' }])[0];
const hp = (currentHP = 10, maxHP = 10, condition = null) => ({
  currentHP,
  maxHP,
  condition,
});
const empty = (totalCapacity = 3, partyCapacity = 2) =>
  createOwnership(catalog, { totalCapacity, partyCapacity });
const add = (state, id, health = hp()) => admitMonster(state, monster(id), health);
const unchangedFailure = (state, action, error = RangeError) => {
  const before = structuredClone(state);
  assert.throws(action, error);
  assert.deepEqual(state, before);
};

test('ownership-wide uniqueness spans separate F1 batches; full party routes to storage', () => {
  const first = add(empty(), 'one');
  const second = add(first, 'two');
  const full = add(second, 'three');
  assert.deepEqual(full.party, ['one', 'two']);
  assert.deepEqual(
    full.owned.map((entry) => entry.monster.id),
    ['one', 'two', 'three'],
  );
  assert.equal(
    full.owned.filter((entry) => !full.party.includes(entry.monster.id)).length,
    1,
  );
  unchangedFailure(first, () => add(first, 'one'));
  unchangedFailure(full, () => add(full, 'four'));
  assert.equal(first.owned.length, 1);
  assert.deepEqual(first.owned[0].monster, monster('one'));
});

test('party reorder/deposit/withdraw preserve ownership, health and exact subset', () => {
  let state = add(add(add(empty(), 'one', hp(3, 10, 'weary')), 'two'), 'three');
  const ownedBefore = structuredClone(state.owned);
  state = reorderParty(state, ['two', 'one']);
  assert.deepEqual(state.party, ['two', 'one']);
  unchangedFailure(state, () => withdrawMonster(state, 'three'));
  state = depositMonster(state, 'one');
  assert.deepEqual(state.party, ['two']);
  assert.deepEqual(depositMonster(state, 'one'), state);
  state = withdrawMonster(state, 'three');
  assert.deepEqual(state.party, ['two', 'three']);
  assert.deepEqual(withdrawMonster(state, 'three'), state);
  assert.deepEqual(state.owned, ownedBefore);
  for (const order of [
    ['two'],
    ['two', 'two'],
    ['two', 'one'],
    ['two', 'three', 'one'],
  ]) {
    unchangedFailure(state, () => reorderParty(state, order));
  }
  unchangedFailure(state, () => reorderParty(state, null), TypeError);
  for (const action of [depositMonster, withdrawMonster, clearCondition]) {
    unchangedFailure(state, () => action(state, 'missing'));
    unchangedFailure(state, () => action(state, 1), TypeError);
  }
});

test('zero capacities, one-slot boundaries and invalid capacities', () => {
  const zero = empty(0, 0);
  unchangedFailure(zero, () => add(zero, 'one'));
  assert.deepEqual(reorderParty(zero, []), zero);
  const storageOnly = add(empty(1, 0), 'one');
  assert.deepEqual(storageOnly.party, []);
  unchangedFailure(storageOnly, () => withdrawMonster(storageOnly, 'one'));
  unchangedFailure(storageOnly, () => add(storageOnly, 'two'));
  assert.equal(add(empty(1, 1), 'one').party.length, 1);
  assert.equal(empty(Number.MAX_SAFE_INTEGER, 0).totalCapacity, Number.MAX_SAFE_INTEGER);
  for (const bad of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => empty(bad, 0), RangeError);
    assert.throws(() => empty(3, bad), RangeError);
  }
  for (const bad of [undefined, null, '3']) {
    assert.throws(() => empty(bad === undefined ? null : bad, 0), TypeError);
  }
  assert.throws(() => empty(1, 2), RangeError);
  assert.throws(() => createOwnership(catalog, { totalCapacity: 2 }), TypeError);
  assert.throws(
    () => createOwnership(catalog, { totalCapacity: 2, partyCapacity: 1, extra: 0 }),
    TypeError,
  );
});

test('admission validates content/IDs/health and rejects without partial mutation', () => {
  const state = empty();
  unchangedFailure(state, () =>
    admitMonster(state, { id: 'one', speciesId: 'missing', nickname: 'Ghost' }, hp()),
  );
  for (const bad of [
    { id: 'one', speciesId: 'missing' },
    { id: 'Bad', speciesId: 'mossglow' },
    { id: 'one', speciesId: 'mossglow' },
    null,
  ]) {
    unchangedFailure(state, () => admitMonster(state, bad, hp()), Error);
  }
  for (const bad of [
    hp(-1),
    hp(11),
    hp(1, 0),
    hp(NaN),
    hp(Infinity),
    hp(1.5),
    hp(1, Infinity),
    hp(1, Number.MAX_SAFE_INTEGER + 1),
  ]) {
    unchangedFailure(state, () => add(state, 'one', bad));
  }
  for (const bad of [null, {}, hp(1, 10, 'unknown'), hp('1'), { ...hp(), extra: 0 }]) {
    unchangedFailure(state, () => add(state, 'one', bad), TypeError);
  }
  assert.equal(add(state, 'one', hp(0)).owned[0].health.currentHP, 0);
  assert.equal(
    add(state, 'one', hp(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).owned[0]
      .health.currentHP,
    Number.MAX_SAFE_INTEGER,
  );
});

test('malformed state cannot bypass unique ownership, party or health invariants', () => {
  const state = add(empty(), 'one');
  const variants = [
    { ...state, owned: [state.owned[0], state.owned[0]] },
    { ...state, party: ['one', 'one'] },
    { ...state, party: ['missing'] },
    { ...state, partyCapacity: 0 },
    { ...state, totalCapacity: 0 },
    { ...state, owned: [{ monster: monster('one'), health: hp(11) }] },
  ];
  for (const invalid of variants) {
    unchangedFailure(invalid, () => healMonster(invalid, 'one', 1));
  }
  for (const invalid of [
    null,
    { ...state, owned: {} },
    { ...state, party: [1] },
    { ...state, extra: true },
    {
      ...state,
      owned: [{ monster: { id: 'one', speciesId: 'mossglow' }, health: hp() }],
    },
  ]) {
    assert.throws(() => depositMonster(invalid, 'one'), TypeError);
  }
});

test('normal healing clamps, preserves condition, never revives, and repeats safely', () => {
  const injured = add(empty(), 'one', hp(3, 10, 'weary'));
  const healed = healMonster(injured, 'one', 2);
  assert.deepEqual(healed.owned[0].health, hp(5, 10, 'weary'));
  assert.deepEqual(injured.owned[0].health, hp(3, 10, 'weary'));
  assert.deepEqual(healMonster(injured, 'one', 0), injured);
  const full = healMonster(injured, 'one', Number.MAX_SAFE_INTEGER);
  assert.deepEqual(full.owned[0].health, hp(10, 10, 'weary'));
  assert.deepEqual(healMonster(full, 'one', 2), full);
  const fainted = add(empty(), 'one', hp(0, 20, 'weary'));
  assert.deepEqual(healMonster(fainted, 'one', 20), fainted);
  const enormous = add(
    empty(),
    'one',
    hp(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER),
  );
  assert.equal(
    healMonster(enormous, 'one', Number.MAX_SAFE_INTEGER).owned[0].health.currentHP,
    Number.MAX_SAFE_INTEGER,
  );
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    unchangedFailure(injured, () => healMonster(injured, 'one', amount));
  }
  unchangedFailure(injured, () => healMonster(injured, 'one', '1'), TypeError);
  unchangedFailure(injured, () => healMonster(injured, 'missing', 1));
});

test('revival and condition clearing are explicit, independent and idempotent', () => {
  const fainted = add(empty(), 'one', hp(0, 20, 'weary'));
  const revived = reviveMonster(fainted, 'one', 1);
  assert.deepEqual(revived.owned[0].health, hp(1, 20, 'weary'));
  assert.deepEqual(reviveMonster(revived, 'one', 20), revived);
  assert.deepEqual(
    reviveMonster(fainted, 'one', Number.MAX_SAFE_INTEGER).owned[0].health,
    hp(20, 20, 'weary'),
  );
  unchangedFailure(fainted, () => reviveMonster(fainted, 'one', 0));
  unchangedFailure(fainted, () => reviveMonster(fainted, 'missing', 1));
  const cleared = clearCondition(fainted, 'one');
  assert.deepEqual(cleared.owned[0].health, hp(0, 20, null));
  assert.deepEqual(clearCondition(cleared, 'one'), cleared);
  assert.deepEqual(cleared.party, fainted.party);
  assert.deepEqual(cleared.owned[0].monster, fainted.owned[0].monster);
});

test('nested caller aliases and returned references cannot alter authoritative snapshots', () => {
  const rawCatalog = [{ id: 'mossglow', name: 'Mossglow' }];
  const capacities = { totalCapacity: 3, partyCapacity: 1 };
  const initial = createOwnership(rawCatalog, capacities);
  rawCatalog[0].name = 'Changed';
  capacities.totalCapacity = 0;
  const rawMonster = { ...monster('one') };
  const rawHealth = hp(2, 10, 'weary');
  const state = admitMonster(initial, rawMonster, rawHealth);
  rawMonster.nickname = 'Changed';
  rawHealth.currentHP = 9;
  assert.equal(state.catalog[0].name, 'Mossglow');
  assert.equal(state.totalCapacity, 3);
  assert.equal(state.owned[0].monster.nickname, 'Mossglow');
  assert.equal(state.owned[0].health.currentHP, 2);
  for (const mutate of [
    () => {
      state.owned[0].health.currentHP = 9;
    },
    () => {
      state.owned[0].monster.id = 'other';
    },
    () => {
      state.owned.push(state.owned[0]);
    },
    () => {
      state.party.push('other');
    },
    () => {
      state.catalog[0].name = 'Changed';
    },
    () => {
      state.partyCapacity = 8;
    },
  ]) {
    assert.throws(mutate, TypeError);
  }
  const rawState = structuredClone(state);
  const next = healMonster(rawState, 'one', 1);
  rawState.owned[0].health.currentHP = 0;
  assert.equal(next.owned[0].health.currentHP, 3);
  assert.equal(state.owned[0].health.currentHP, 2);
  const shared = hp(2);
  const pair = add(add(empty(), 'one', shared), 'two', shared);
  const changed = healMonster(pair, 'one', 1);
  assert.equal(changed.owned[1].health.currentHP, 2);
  assert.notEqual(changed.owned[0].health, changed.owned[1].health);
});

test('catalog copies per normalization do not grow with owned count', () => {
  const speciesCount = 20;
  const rawCatalog = Array.from({ length: speciesCount }, (_, i) => ({
    id: `species-${i}`,
    name: `Species ${i}`,
  }));
  for (const ownedCount of [1, 10, 100]) {
    const state = {
      catalog: rawCatalog,
      totalCapacity: ownedCount,
      partyCapacity: 1,
      party: ['owned-0'],
      owned: Array.from({ length: ownedCount }, (_, i) => ({
        monster: { id: `owned-${i}`, speciesId: 'species-0', nickname: `Owned ${i}` },
        health: hp(2),
      })),
    };
    const originalFreeze = Object.freeze;
    let speciesCopies = 0;
    let next;
    // Count the existing immutable-definition boundary, not elapsed time.
    Object.freeze = (value) => {
      if (
        value &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'name') &&
        typeof value.id === 'string' &&
        value.id.startsWith('species-')
      ) {
        speciesCopies++;
      }
      return originalFreeze(value);
    };
    try {
      next = healMonster(state, 'owned-0', 1);
    } finally {
      Object.freeze = originalFreeze;
    }
    assert.equal(
      speciesCopies,
      2 * speciesCount,
      'one catalog copy at input and output validation',
    );
    assert.equal(next.owned[0].health.currentHP, 3);
    assert.equal(state.owned[0].health.currentHP, 2);
    assert.notEqual(next.catalog, state.catalog);
    assert.notEqual(next.owned[0].monster, state.owned[0].monster);
    assert.ok(Object.isFrozen(next.catalog[0]));
    state.owned[0].monster.nickname = 'Changed';
    assert.equal(next.owned[0].monster.nickname, 'Owned 0');
  }
});

test('shared species parsing still rejects malformed external catalogs and complete snapshots', () => {
  const state = structuredClone(add(empty(), 'one'));
  const variants = [
    { ...state, catalog: [...state.catalog, { id: 'unused', name: '' }] },
    { ...state, catalog: [...state.catalog, state.catalog[0]] },
    { ...state, catalog: state.catalog.map((entry) => ({ ...entry, extra: true })) },
    ...[
      { id: 'one', speciesId: 'mossglow' },
      { id: 'one', speciesId: 'missing', nickname: 'One' },
      { id: 'one', speciesId: 'mossglow', nickname: ' One ' },
      { id: 'Bad', speciesId: 'mossglow', nickname: 'One' },
      { id: 'one', speciesId: 'mossglow', nickname: 'One', extra: true },
    ].map((monster) => ({ ...state, owned: [{ monster, health: hp() }] })),
  ];
  for (const invalid of variants) {
    unchangedFailure(invalid, () => healMonster(invalid, 'one', 1), Error);
  }
  // Neither a frozen external catalog nor a previously valid mutable input is trusted.
  assert.throws(
    () => createMonsters(Object.freeze([{ id: 'unused', name: '' }]), []),
    TypeError,
  );
  healMonster(state, 'one', 1);
  state.catalog[0].name = '';
  unchangedFailure(state, () => healMonster(state, 'one', 1), TypeError);
});
