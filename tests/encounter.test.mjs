import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EncounterSession, loadSpeciesCatalog, createMonsters, createOwnership, admitMonster,
  healMonster, enableLearning, requestLearning, useMove, recordSeen,
} from 'monster-rpg-core';
import { memoryAdapter, indexedAdapter, runExample } from '../examples/encounters.mjs';

const catalog = loadSpeciesCatalog([
  { id: 'mossglow', name: 'Mossglow' }, { id: 'cinderfin', name: 'Cinderfin' }, { id: 'mistpod', name: 'Mistpod' },
]);
const monster = (id, speciesId = 'mossglow') => createMonsters(catalog, [{ id, speciesId }])[0];
const hp = (currentHP = 5) => ({ currentHP, maxHP: 10, condition: null });
const state = () => admitMonster(createOwnership(catalog, { totalCapacity: 3, partyCapacity: 1 }), monster('partner'), hp());
const opponent = (id = 'wild', speciesId = 'cinderfin', visible = true) => ({ monster: monster(id, speciesId), health: hp(), knownMoves: [], visible });
const wild = () => ({ kind: 'wild', candidates: [opponent(), opponent('other', 'mistpod')] });
const adapter = () => ({ setup() { return { release() {} }; } });
const rejectUnchanged = (session, action, error = RangeError) => {
  const before = session.state; const revision = session.revision;
  assert.throws(action, error);
  assert.equal(session.state, before);
  assert.equal(session.revision, revision);
};

test('same controlled wild input selects same immutable request; only chosen visible species seen', () => {
  const one = new EncounterSession(state(), adapter());
  const two = new EncounterSession(state(), adapter());
  const first = one.begin(wild(), 0);
  assert.deepEqual(first, two.begin(wild(), 0));
  assert.equal(first.kind, 'wild');
  assert.equal(first.opponents[0].monster.id, 'wild');
  assert.deepEqual(one.state.collection, { seen: ['mossglow', 'cinderfin'], acquired: ['mossglow'] });
  one.release();
  assert.equal(one.begin(wild(), 0.999999).opponents[0].monster.id, 'other');
  assert.deepEqual(one.state.collection.acquired, ['mossglow']);
  assert.deepEqual(one.state.collection.seen, ['mossglow', 'cinderfin', 'mistpod']);
  one.release(); two.release();
});

test('trainer kind and explicit visibility preserve hidden species and do not acquire opponents', () => {
  const session = new EncounterSession(state(), adapter());
  const request = session.begin({ kind: 'trainer', opponents: [opponent(), opponent('hidden', 'mistpod', false)] });
  assert.equal(request.kind, 'trainer'); assert.equal(request.opponents.length, 2);
  assert.deepEqual(session.state.collection, { seen: ['mossglow', 'cinderfin'], acquired: ['mossglow'] });
  session.release();
});

test('invalid configurations, refs, draws and parties fail before adapter setup or seen commit', () => {
  let calls = 0;
  const session = new EncounterSession(state(), { setup() { calls++; return { release() {} }; } });
  for (const bad of [null, {}, { kind: 'wild', candidates: [] }, { ...wild(), extra: true },
    { ...wild(), opponents: [] }, { kind: 'wild', candidates: [{ ...opponent(), visible: 1 }] }]) {
    rejectUnchanged(session, () => session.begin(bad, 0), TypeError);
  }
  for (const draw of [-1, 1, NaN, Infinity]) rejectUnchanged(session, () => session.begin(wild(), draw));
  rejectUnchanged(session, () => session.begin(wild()), TypeError);
  rejectUnchanged(session, () => session.begin(wild(), '0'), TypeError);
  rejectUnchanged(session, () => session.begin({ kind: 'trainer', opponents: [opponent()] }, 0), TypeError);
  const invalids = [
    [opponent(), opponent()], [opponent('partner')],
    [{ ...opponent(), monster: { id: 'wild', speciesId: 'unknown', nickname: 'Unknown' } }],
    [{ ...opponent(), health: hp(0) }], [{ ...opponent(), health: hp(11) }],
    [{ ...opponent(), knownMoves: [{ moveId: 'unknown', remaining: 1 }] }],
  ];
  for (const candidates of invalids) rejectUnchanged(session, () => session.begin({ kind: 'wild', candidates }, 0));
  assert.equal(calls, 0); assert.equal(session.state.collection, undefined);
  const empty = createOwnership(catalog, { totalCapacity: 1, partyCapacity: 0 });
  assert.throws(() => new EncounterSession(empty, adapter()).begin(wild(), 0), RangeError);
  const fainted = admitMonster(createOwnership(catalog, { totalCapacity: 1, partyCapacity: 1 }), monster('partner'), hp(0));
  assert.throws(() => new EncounterSession(fainted, adapter()).begin(wild(), 0), RangeError);
  const stored = admitMonster(state(), monster('stored'), hp());
  assert.throws(() => new EncounterSession(stored, adapter()).begin({ kind: 'wild', candidates: [opponent('stored')] }, 0), RangeError);
});

test('request preserves party health/move resources; caller and adapter aliases cannot mutate durable state', () => {
  let original = enableLearning(state(), { slotCapacity: 1, moves: [{ id: 'mosschime', name: 'Mosschime', resource: { kind: 'finite', maximum: 3 } }] });
  original = useMove(requestLearning(original, 'partner', 'mosschime'), 'partner', 'mosschime', 1);
  const raw = structuredClone(original); const config = wild();
  config.candidates[0].knownMoves = [{ moveId: 'mosschime', remaining: 1 }];
  let temporary;
  const session = new EncounterSession(raw, { setup(request) {
    assert.throws(() => { request.party[0].health.currentHP = 0; }, TypeError);
    assert.throws(() => { request.party[0].knownMoves[0].remaining = 0; }, TypeError);
    assert.throws(() => { request.opponents.push(request.party[0]); }, TypeError);
    temporary = structuredClone(request); temporary.party[0].health.currentHP = 0;
    return { release() { temporary = null; } };
  } });
  raw.owned[0].health.currentHP = 1;
  const request = session.begin(config, 0);
  config.candidates[0].health.currentHP = 0;
  assert.equal(request.party[0].health.currentHP, 5);
  assert.equal(request.party[0].knownMoves[0].remaining, 2);
  assert.equal(request.opponents[0].knownMoves[0].remaining, 1);
  assert.equal(request.opponents[0].health.currentHP, 5);
  assert.deepEqual(session.state.owned, original.owned);
  session.release(); assert.equal(temporary, null);
  const invalid = wild(); invalid.candidates[1].knownMoves = [{ moveId: 'unknown', remaining: 1 }];
  rejectUnchanged(session, () => session.begin(invalid, 0)); // unselected content still validated
});

test('overlap and reentrant lifecycle calls reject without duplicating setup', () => {
  let calls = 0; let session;
  session = new EncounterSession(state(), { setup() {
    calls++;
    assert.throws(() => session.begin(wild(), 0), /busy/);
    assert.throws(() => session.release(), /busy/);
    assert.throws(() => session.commit(session.revision, state()), /busy/);
    return { release() { assert.throws(() => session.begin(wild(), 0), /busy/); } };
  } });
  session.begin(wild(), 0);
  rejectUnchanged(session, () => session.begin(wild(), 0));
  rejectUnchanged(session, () => session.commit(session.revision, state()));
  assert.equal(calls, 1); session.release(); session.release();
  assert.equal(session.activeRequest, undefined);
});

test('setup failure has no persistent changes; release failure retains active session until retry', () => {
  let failSetup = true; let failRelease = true;
  const session = new EncounterSession(state(), { setup() {
    if (failSetup) throw Error('controlled setup failure');
    return { release() { if (failRelease) throw Error('controlled release failure'); } };
  } });
  rejectUnchanged(session, () => session.begin(wild(), 0), /setup failure/);
  assert.equal(session.activeRequest, undefined); assert.equal(session.state.collection, undefined);
  failSetup = false; const request = session.begin(wild(), 0);
  rejectUnchanged(session, () => session.release(), /release failure/);
  assert.equal(session.activeRequest, request);
  rejectUnchanged(session, () => session.begin(wild(), 0));
  failRelease = false; session.release();
  assert.equal(session.activeRequest, undefined);
  assert.deepEqual(session.state.collection.seen, ['mossglow', 'cinderfin']);
});

test('stale durable snapshots cannot overwrite a newer accepted revision', () => {
  const session = new EncounterSession(state(), adapter());
  const old = session.state; const oldRevision = session.revision;
  session.commit(oldRevision, healMonster(old, 'partner', 1));
  rejectUnchanged(session, () => session.commit(oldRevision, old));
  assert.equal(session.state.owned[0].health.currentHP, 6);
  const beforeBeginRevision = session.revision;
  session.begin(wild(), 0); session.release();
  rejectUnchanged(session, () => session.commit(beforeBeginRevision, old));
  const current = session.state;
  session.commit(session.revision, recordSeen(current, 'mistpod'));
  assert.deepEqual(session.state.collection.seen, ['mossglow', 'cinderfin', 'mistpod']);
  rejectUnchanged(session, () => session.commit(session.revision, { ...session.state, party: ['missing'] }));
});

test('unsupported Promise results never become a later active session or accepted state', async () => {
  let resolveLate; let first = true;
  const late = new Promise(resolve => { resolveLate = resolve; });
  const session = new EncounterSession(state(), { setup() {
    if (first) { first = false; return late; }
    return { release() {} };
  } });
  rejectUnchanged(session, () => session.begin(wild(), 0), TypeError);
  const accepted = session.begin(wild(), 0.9);
  const revision = session.revision;
  resolveLate({ release() {} }); await late;
  assert.equal(session.activeRequest, accepted); assert.equal(session.revision, revision);
  session.release();
  let wrong = true;
  const badRelease = new EncounterSession(state(), { setup() { return { release() { if (wrong) return Promise.resolve(); } }; } });
  badRelease.begin(wild(), 0);
  rejectUnchanged(badRelease, () => badRelease.release(), TypeError);
  wrong = false; badRelease.release();
  const rejected = new EncounterSession(state(), { setup() { return Promise.reject(Error('unsupported async setup')); } });
  rejectUnchanged(rejected, () => rejected.begin(wild(), 0), TypeError);
  const rejectionRelease = new EncounterSession(state(), { setup() { return { release() { return Promise.reject(Error('unsupported async release')); } }; } });
  rejectionRelease.begin(wild(), 0);
  rejectUnchanged(rejectionRelease, () => rejectionRelease.release(), TypeError);
  await Promise.resolve();
  assert.equal(rejected.activeRequest, undefined);
  assert.notEqual(rejectionRelease.activeRequest, undefined);
  for (const bad of [null, {}, { release: 1 }]) {
    const invalid = new EncounterSession(state(), { setup() { return bad; } });
    rejectUnchanged(invalid, () => invalid.begin(wild(), 0), TypeError);
  }
});

test('two interchangeable controlled adapters and standalone public example are runnable', () => {
  for (const make of [memoryAdapter, indexedAdapter]) {
    const log = []; const session = new EncounterSession(state(), make(log));
    session.begin(wild(), 0); session.release();
    assert.equal(log.length, 1); assert.equal(session.activeRequest, undefined);
  }
  assert.deepEqual(runExample(), [{ adapter: 'memory', kind: 'wild' }, { adapter: 'indexed', kind: 'wild' }]);
});
