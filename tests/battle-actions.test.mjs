import test from 'node:test';
import assert from 'node:assert/strict';
import { EncounterSession, useMove } from 'monster-rpg-core';
import {
  scriptedActionAdapter,
  checkpointActionAdapter,
  actionExampleFixture,
  runActionExample,
} from '../examples/battle-actions.mjs';

const move = (actorId = 'one') => ({
  kind: 'move',
  actorId,
  moveId: 'mosschime',
  targetId: 'enemy',
});
const change = (actorId = 'one', targetId = 'two') => ({
  kind: 'switch',
  actorId,
  targetId,
});
function open(adapter, none = false) {
  const fixture = actionExampleFixture(none);
  const session = new EncounterSession(fixture.state, adapter);
  session.begin(fixture.config, 0);
  return { session, ...fixture };
}
const remaining = (session, id = 'one') =>
  session.state.training.individuals.find((entry) => entry.instanceId === id)
    .knownMoves[0].remaining;
const unchanged = (session, action, error = Error) => {
  const before = session.state;
  const revision = session.revision;
  assert.throws(action, error);
  assert.equal(session.state, before);
  assert.equal(session.revision, revision);
};
function confirmed(command) {
  const checkpoint = structuredClone(command.checkpoint);
  if (command.action.kind === 'switch') {
    checkpoint.activeId = command.action.targetId;
  } else {
    const actor = checkpoint.party.find(
      (entry) => entry.monster.id === command.action.actorId,
    );
    const resource = actor.knownMoves.find(
      (entry) => entry.moveId === command.action.moveId,
    );
    if (resource.remaining !== null) {
      resource.remaining--;
    }
  }
  return {
    generation: command.generation,
    commandId: command.commandId,
    revision: command.revision,
    outcome: 'continue',
    checkpoint,
  };
}
const echo = () => ({
  setup() {
    return { execute: confirmed, release() {} };
  },
});

test('finite and no-resource moves commit one checkpoint without double debit', () => {
  for (const none of [false, true]) {
    const { session } = open(echo(), none);
    const before = session.state;
    const receipt = session.act(move());
    assert.equal(receipt.status, 'applied');
    assert.equal(receipt.revision, session.revision);
    assert.equal(remaining(session), none ? null : 2);
    assert.equal(before.training.individuals[0].knownMoves[0].remaining, none ? null : 3);
    assert.equal(session.checkpoint.party[0].knownMoves[0].remaining, remaining(session));
    assert.equal(session.activeRequest.party[0].knownMoves[0].remaining, none ? null : 3); // initial F5 request remains initial
    assert.equal(remaining(session, 'two'), none ? null : 3);
  }
});

test('switch preserves full HP/resources and changes only active member', () => {
  const { session } = open(scriptedActionAdapter([{ damage: 1 }, {}, { damage: 1 }]));
  session.act(move());
  const before = structuredClone(session.checkpoint);
  session.act(change());
  assert.equal(session.checkpoint.activeId, 'two');
  assert.deepEqual(session.checkpoint.party, before.party);
  assert.deepEqual(session.checkpoint.opponents, before.opponents);
  unchanged(session, () => session.act(move('one')));
  session.act(move('two'));
  assert.equal(remaining(session, 'one'), 2);
  assert.equal(remaining(session, 'two'), 2);
});

test('preflight unknown/illegal/exhausted inputs never invoke engine or allocate command', () => {
  const log = [];
  const { session } = open(scriptedActionAdapter([{}, {}, {}], log));
  for (const action of [
    null,
    {},
    { ...move(), extra: 1 },
    move('missing'),
    { ...move(), moveId: 'missing' },
    { ...move(), targetId: 'two' },
    change('one', 'one'),
    change('one', 'missing'),
    { ...change(), moveId: 'mosschime' },
    { kind: 'capture', actorId: 'one', targetId: 'enemy' },
  ]) {
    unchanged(session, () => session.act(action));
    assert.equal(session.fault, undefined);
  }
  assert.equal(log.length, 0);
  session.act(move());
  assert.equal(log[0].commandId, 1);
  session.act(move());
  session.act(move());
  assert.equal(remaining(session), 0);
  unchanged(session, () => session.act(move()));
  assert.equal(log.length, 3);
  const f = actionExampleFixture();
  const noCapability = new EncounterSession(f.state, {
    setup() {
      return { release() {} };
    },
  });
  noCapability.begin(f.config, 0);
  unchanged(noCapability, () => noCapability.act(move()));
  noCapability.release();
});

test('latest receipt replay only, including exact key-reordered data; bounded old/future/conflict rejection', () => {
  const log = [];
  const { session } = open(scriptedActionAdapter([{}, {}], log));
  session.act(move());
  const first = session.lastConfirmation;
  const acceptedState = session.state;
  const reorder = {
    checkpoint: structuredClone(first.checkpoint),
    outcome: first.outcome,
    revision: first.revision,
    commandId: first.commandId,
    generation: first.generation,
  };
  assert.equal(session.confirm(reorder).status, 'already_applied');
  assert.equal(session.state, acceptedState);
  assert.equal(log.length, 1);
  for (const bad of [
    { ...first, outcome: 'defeat' },
    { ...first, commandId: 2 },
    { ...first, generation: 9 },
    { ...first, extra: true },
  ]) {
    unchanged(session, () => session.confirm(bad));
  }
  session.act(move());
  assert.equal(remaining(session), 1);
  unchanged(session, () => session.confirm(first));
  assert.equal(session.confirm(session.lastConfirmation).status, 'already_applied');
  assert.equal(log.length, 2);
  assert.equal(session.lastConfirmation.commandId, 2);
});

test('invalid/forged confirmations fault without committing partial fields', () => {
  const corruptions = [
    (result) => {
      result.generation++;
    },
    (result) => {
      result.commandId++;
    },
    (result) => {
      result.revision++;
    },
    (result) => {
      result.checkpoint.party[0].monster.id = 'forged';
    },
    (result) => {
      result.checkpoint.party[0].monster.speciesId = 'mistpod';
    },
    (result) => {
      result.checkpoint.party[0].monster.nickname = 'Changed';
    },
    (result) => {
      result.checkpoint.party[0].health.currentHP = NaN;
    },
    (result) => {
      result.checkpoint.party[0].health.currentHP = 11;
    },
    (result) => {
      result.checkpoint.party[0].health.maxHP = 11;
    },
    (result) => {
      result.checkpoint.party[0].health.condition = 'unknown';
    },
    (result) => {
      result.checkpoint.party[0].knownMoves[0].remaining = 3;
    },
    (result) => {
      result.checkpoint.party[0].knownMoves[0].remaining = 1;
    },
    (result) => {
      result.checkpoint.party[0].knownMoves[0].remaining = Infinity;
    },
    (result) => {
      result.checkpoint.party[0].knownMoves[0].moveId = 'unknown';
    },
    (result) => {
      result.checkpoint.party.pop();
    },
    (result) => {
      result.checkpoint.opponents = [];
    },
    (result) => {
      result.checkpoint.activeId = 'two';
    },
    (result) => {
      result.outcome = 'victory';
    },
    (result) => {
      result.outcome = 'captured';
    },
    (result) => {
      result.extra = true;
    },
  ];
  for (const corrupt of corruptions) {
    let calls = 0;
    const { session } = open({
      setup() {
        return {
          execute(command) {
            calls++;
            const result = confirmed(command);
            corrupt(result);
            return result;
          },
          release() {},
        };
      },
    });
    unchanged(session, () => session.act(move()), /faulted/);
    assert.equal(session.fault.reason, 'invalid_confirmation');
    assert.equal(session.lastConfirmation, undefined);
    unchanged(session, () => session.act(move()));
    unchanged(session, () => session.begin(actionExampleFixture().config, 0));
    unchanged(session, () => session.commit(session.revision, session.state));
    unchanged(session, () => session.release());
    assert.equal(calls, 1);
    session.abandonFaultedEncounter();
    assert.equal(session.fault, undefined);
  }
});

test('previous accepted cost/checkpoint survive engine advancement fault and explicit abandon', () => {
  let calls = 0;
  let released = 0;
  const { session } = open({
    setup() {
      return {
        execute(command) {
          calls++;
          const result = confirmed(command);
          if (calls === 2) {
            result.checkpoint.party[0].health.currentHP = -1;
          }
          return result;
        },
        release() {
          released++;
        },
      };
    },
  });
  session.act(move());
  const accepted = session.state;
  const receipt = session.lastConfirmation;
  unchanged(session, () => session.act(move()), /faulted/);
  assert.equal(session.fault.commandId, 2);
  assert.equal(remaining(session), 2);
  assert.equal(session.confirm(receipt).status, 'already_applied');
  const recovered = session.abandonFaultedEncounter();
  assert.equal(recovered, accepted);
  assert.equal(remaining(session), 2);
  assert.equal(calls, 2);
  assert.equal(released, 1);
  assert.equal(session.activeRequest, undefined);
  const f = actionExampleFixture();
  session.begin(f.config, 0);
  session.act(move());
  assert.equal(session.lastConfirmation.commandId, 3);
  assert.equal(session.lastConfirmation.generation, 2);
  unchanged(session, () => session.confirm(receipt));
});

test('terminal victory/defeat release before final commit and never award/grow', () => {
  for (const outcome of ['victory', 'defeat']) {
    const scripted = scriptedActionAdapter([
      outcome === 'victory' ? { damage: 10, outcome } : { partyHP: 0, outcome },
    ]);
    const { session } = open(scripted);
    const before = session.state;
    const receipt = session.act(move());
    assert.equal(receipt.outcome, outcome);
    assert.equal(session.activeRequest, undefined);
    assert.equal(session.state.owned.length, before.owned.length);
    assert.equal(remaining(session), 2);
    assert.deepEqual(session.state.collection, before.collection);
    assert.deepEqual(
      session.state.owned.map((entry) => entry.monster),
      before.owned.map((entry) => entry.monster),
    );
    if (outcome === 'defeat') {
      assert.ok(session.state.owned.every((entry) => entry.health.currentHP === 0));
    }
    assert.equal(session.confirm(session.lastConfirmation).status, 'already_applied');
  }
});

test('terminal and abandon release failures block overlap and withhold terminal checkpoint', () => {
  let calls = 0;
  let failRelease = true;
  let releases = 0;
  const { session } = open({
    setup() {
      return {
        execute(command) {
          calls++;
          const result = confirmed(command);
          if (calls === 2) {
            result.outcome = 'victory';
            result.checkpoint.opponents[0].health.currentHP = 0;
          }
          return result;
        },
        release() {
          releases++;
          if (failRelease) {
            throw Error('release refused');
          }
        },
      };
    },
  });
  session.act(move());
  const last = session.lastConfirmation;
  const checkpoint = session.state;
  unchanged(session, () => session.act(move()), /release_failed/);
  assert.equal(session.fault.reason, 'release_failed');
  assert.equal(session.lastConfirmation, last);
  assert.equal(remaining(session), 2);
  unchanged(session, () => session.abandonFaultedEncounter(), /release refused/);
  unchanged(session, () => session.begin(actionExampleFixture().config, 0));
  failRelease = false;
  assert.equal(session.abandonFaultedEncounter(), checkpoint);
  assert.equal(session.activeRequest, undefined);
  assert.equal(releases, 3);
  assert.equal(calls, 2);
});

test('reentrant act/commit/confirm/release never dispatch twice or bypass commit boundary', () => {
  let session;
  let calls = 0;
  const f = actionExampleFixture();
  session = new EncounterSession(f.state, {
    setup() {
      return {
        execute(command) {
          calls++;
          assert.throws(() => session.act(move()), RangeError);
          assert.throws(
            () => session.commit(session.revision, session.state),
            RangeError,
          );
          assert.throws(() => session.confirm(confirmed(command)), RangeError);
          assert.throws(() => session.release(), RangeError);
          assert.throws(() => session.abandonFaultedEncounter(), RangeError);
          const result = confirmed(command);
          result.outcome = 'victory';
          result.checkpoint.opponents[0].health.currentHP = 0;
          return result;
        },
        release() {
          assert.throws(() => session.act(move()), RangeError);
          assert.throws(
            () => session.commit(session.revision, session.state),
            RangeError,
          );
          assert.throws(() => session.begin(f.config, 0), RangeError);
        },
      };
    },
  });
  session.begin(f.config, 0);
  session.act(move());
  assert.equal(calls, 1);
  assert.equal(session.fault, undefined);
});

test('adapter throw/unsupported async results fault once; late data never auto-commits', async () => {
  for (const response of [
    () => {
      throw Error('engine advanced then failed');
    },
    () => Promise.reject(Error('async engine')),
    () => null,
  ]) {
    const { session } = open({
      setup() {
        return { execute: response, release() {} };
      },
    });
    unchanged(session, () => session.act(move()), /faulted/);
    session.abandonFaultedEncounter();
  }
  let deliver;
  const late = new Promise((resolve) => {
    deliver = resolve;
  });
  let captured;
  const { session } = open({
    setup() {
      return {
        execute(command) {
          captured = command;
          return late;
        },
        release() {},
      };
    },
  });
  unchanged(session, () => session.act(move()), /faulted/);
  const state = session.abandonFaultedEncounter();
  deliver(confirmed(captured));
  await late;
  assert.equal(session.state, state);
  assert.equal(session.lastConfirmation, undefined);
});

test('fainted active may switch to a living party member', () => {
  let first = true;
  const other = open({
    setup() {
      return {
        execute(command) {
          const result = confirmed(command);
          if (first) {
            first = false;
            result.checkpoint.party[0].health.currentHP = 0;
          }
          return result;
        },
        release() {},
      };
    },
  }).session;
  other.act(move());
  unchanged(other, () => other.act(move()));
  other.act(change());
  assert.equal(other.checkpoint.activeId, 'two');
  assert.equal(other.checkpoint.party[0].health.currentHP, 0);
});

test('commands/confirmed snapshots are isolated and both adapter result sources run the public example', () => {
  let returned;
  const { session } = open({
    setup() {
      return {
        execute(command) {
          assert.throws(() => {
            command.action.actorId = 'two';
          }, TypeError);
          assert.throws(() => {
            command.checkpoint.party[0].knownMoves[0].remaining = 99;
          }, TypeError);
          returned = confirmed(command);
          return returned;
        },
        release() {},
      };
    },
  });
  session.act(move());
  returned.checkpoint.party[0].health.currentHP = 0;
  assert.equal(session.state.owned[0].health.currentHP, 10);
  assert.throws(() => {
    session.lastConfirmation.checkpoint.party[0].health.currentHP = 0;
  }, TypeError);
  assert.deepEqual(runActionExample(), [
    { outcome: 'victory', remaining: [2, 2] },
    { outcome: 'victory', remaining: [2, 2] },
  ]);
  assert.equal(typeof checkpointActionAdapter, 'function');
});

test('plain switch retains existing wounds/resources; engine retaliation and terminal checkpoints are accepted', () => {
  for (const outcome of ['continue', 'victory', 'defeat']) {
    let releases = 0;
    const { session } = open({
      setup() {
        return {
          execute(command) {
            const result = confirmed(command);
            if (command.action.kind === 'move') {
              result.checkpoint.party[1].health.currentHP = 8;
              result.checkpoint.party[1].knownMoves[0].remaining = 2;
            } else if (command.action.actorId === 'two') {
              result.checkpoint.party[0].health.currentHP = 7;
              result.checkpoint.party[0].health.condition = 'weary';
              result.checkpoint.party[0].knownMoves[0].remaining = 1;
              result.outcome = outcome;
              if (outcome === 'victory') {
                result.checkpoint.opponents[0].health.currentHP = 0;
              }
              if (outcome === 'defeat') {
                for (const member of result.checkpoint.party) {
                  member.health.currentHP = 0;
                }
              }
            }
            return result;
          },
          release() {
            releases++;
          },
        };
      },
    });
    session.act(move());
    const wounded = structuredClone(session.checkpoint.party);
    session.act(change());
    assert.deepEqual(session.checkpoint.party, wounded);
    assert.equal(session.state.owned[1].health.currentHP, 8);
    assert.equal(remaining(session, 'two'), 2);
    const receipt = session.act(change('two', 'one'));
    assert.equal(receipt.outcome, outcome);
    assert.equal(session.state.owned[0].health.currentHP, outcome === 'defeat' ? 0 : 7);
    assert.equal(session.state.owned[0].health.condition, 'weary');
    assert.equal(remaining(session), 1);
    assert.equal(session.lastConfirmation.checkpoint.activeId, 'one');
    assert.equal(releases, outcome === 'continue' ? 0 : 1);
    assert.equal(session.activeRequest === undefined, outcome !== 'continue');
  }
});

test('ordinary cleanup failure blocks commands until successful idempotent release retry', () => {
  for (const failure of ['throw', 'scalar']) {
    let fail = true;
    let calls = 0;
    let releases = 0;
    const { session, config } = open({
      setup() {
        return {
          execute(command) {
            calls++;
            return confirmed(command);
          },
          release() {
            releases++;
            if (fail) {
              if (failure === 'throw') {
                throw Error('partial disposal');
              }
              return 1;
            }
          },
        };
      },
    });
    session.act(move());
    const last = session.lastConfirmation;
    unchanged(session, () => session.release());
    unchanged(session, () => session.act(move()));
    unchanged(session, () => session.begin(config, 0));
    unchanged(session, () => session.commit(session.revision, session.state));
    assert.equal(session.confirm(last).status, 'already_applied');
    unchanged(session, () => session.release());
    assert.equal(calls, 1);
    assert.equal(remaining(session), 2);
    assert.ok(session.activeRequest);
    fail = false;
    session.release();
    assert.equal(releases, 3);
    assert.equal(session.activeRequest, undefined);
    session.begin(config, 0);
    session.act(move());
    assert.equal(calls, 2);
  }
});
