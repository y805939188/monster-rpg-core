import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSpeciesCatalog, createMonsters } from 'monster-rpg-core';

const originalSpecies = () => [
  { id: 'mossglow', name: 'Mossglow' },
  { id: 'cinderfin', name: 'Cinderfin' },
];
const catalog = loadSpeciesCatalog(originalSpecies());
const request = (id = 'one') => ({ id, speciesId: 'mossglow' });

test('two original species and distinct individuals via public built API', () => {
  const monsters = createMonsters(catalog, [
    request(),
    { ...request('two'), nickname: 'Fern' },
    { id: 'three', speciesId: 'cinderfin' },
  ]);
  assert.deepEqual(monsters, [
    { id: 'one', speciesId: 'mossglow', nickname: 'Mossglow' },
    { id: 'two', speciesId: 'mossglow', nickname: 'Fern' },
    { id: 'three', speciesId: 'cinderfin', nickname: 'Cinderfin' },
  ]);
  assert.notEqual(monsters[0], monsters[1]);
  assert.deepEqual(createMonsters(catalog, []), []);
});

test('catalog rejects malformed external content and duplicate species', () => {
  for (const input of [
    null,
    {},
    [],
    [null],
    [1],
    [new Date()],
    [{ id: 'mossglow' }],
    [{ id: 'mossglow', name: 'Moss', hp: 2 }],
    [request()],
    new Array(1),
    [
      { id: 'mossglow', name: 'Moss' },
      { id: 'mossglow', name: 'Other' },
    ],
  ]) {
    assert.throws(() => loadSpeciesCatalog(input), {
      name: input?.length === 2 ? 'RangeError' : 'TypeError',
    });
  }
});

test('IDs and labels enforce exact lower/upper boundaries', () => {
  for (const bad of [
    '',
    ' a',
    'a ',
    'A',
    'a_',
    'a\n',
    'a\r',
    'a'.repeat(65),
    1,
    NaN,
    Infinity,
    null,
  ]) {
    assert.throws(() => loadSpeciesCatalog([{ id: bad, name: 'Moss' }]), TypeError);
    assert.throws(() => createMonsters(catalog, [{ ...request(), id: bad }]), TypeError);
    assert.throws(
      () => createMonsters(catalog, [{ ...request(), speciesId: bad }]),
      TypeError,
    );
  }
  for (const bad of ['', ' x', 'x ', 'x'.repeat(81), 1, null, undefined]) {
    assert.throws(() => loadSpeciesCatalog([{ id: 'a', name: bad }]), TypeError);
    assert.throws(
      () => createMonsters(catalog, [{ ...request(), nickname: bad }]),
      TypeError,
    );
  }
  const edge = loadSpeciesCatalog([
    { id: 'a'.repeat(64), name: 'x'.repeat(80) },
    { id: 'a', name: 'x' },
  ]);
  assert.equal(
    createMonsters(edge, [
      { id: 'b'.repeat(64), speciesId: 'a'.repeat(64), nickname: 'y'.repeat(80) },
    ])[0].nickname.length,
    80,
  );
  assert.equal(
    createMonsters(edge, [{ id: 'b', speciesId: 'a', nickname: 'y' }])[0].nickname,
    'y',
  );
});

test('creation rejects malformed inputs, unknown species and duplicate batch IDs', () => {
  for (const input of [
    null,
    {},
    [null],
    [1],
    new Array(1),
    [{ id: 'one' }],
    [{ ...request(), extra: {} }],
  ]) {
    assert.throws(() => createMonsters(catalog, input), TypeError);
  }
  assert.throws(
    () => createMonsters(catalog, [{ id: 'one', speciesId: 'missing' }]),
    /Unknown species/,
  );
  assert.throws(
    () => createMonsters(catalog, [request(), { id: 'one', speciesId: 'cinderfin' }]),
    /Duplicate instance/,
  );
  assert.throws(() => createMonsters([{ id: 'bad' }], []), TypeError);
  const special = loadSpeciesCatalog([{ id: 'constructor', name: 'Original' }]);
  assert.equal(
    createMonsters(special, [{ id: 'constructor', speciesId: 'constructor' }])[0]
      .nickname,
    'Original',
  );
});

test('failed batch has no input mutation or ID reservation; uniqueness is batch-local', () => {
  const input = [request(), { id: 'two', speciesId: 'missing' }];
  const before = structuredClone(input);
  assert.throws(() => createMonsters(catalog, input), RangeError);
  assert.deepEqual(input, before);
  const first = createMonsters(catalog, [request()]);
  const second = createMonsters(catalog, [request()]);
  assert.deepEqual(first, second);
  assert.notEqual(first[0], second[0]);
});

test('caller aliases cannot change catalog or created snapshots', () => {
  const source = originalSpecies();
  const loaded = loadSpeciesCatalog(source);
  source[0].name = 'Changed';
  source.push({ id: 'other', name: 'Other' });
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].name, 'Mossglow');
  const input = [{ ...request(), nickname: 'Fern' }, request('two')];
  const created = createMonsters(loaded, input);
  input[0].nickname = 'Changed';
  assert.equal(created[0].nickname, 'Fern');
  assert.throws(() => {
    loaded[0].name = 'Changed';
  }, TypeError);
  assert.throws(() => {
    loaded.push(source[0]);
  }, TypeError);
  assert.throws(() => {
    created[0].nickname = 'Changed';
  }, TypeError);
  assert.throws(() => {
    created[0].id = 'two';
  }, TypeError);
  assert.throws(() => {
    created.push(created[0]);
  }, TypeError);
  const independentlyEdited = { ...created[0], nickname: 'Leaf' };
  assert.equal(independentlyEdited.nickname, 'Leaf');
  assert.equal(created[1].nickname, 'Mossglow');
  assert.equal(created[0].nickname, 'Fern');
});
