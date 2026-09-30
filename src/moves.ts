import { validState } from './ownership';
import type { OwnershipState } from './ownership';
import { fullResource, moveDefinition, readMoveRules } from './move-data';
import type { IndividualMoves, KnownMove, TrainingState } from './move-data';
import { integer, record } from './validation';

function context(
  state: OwnershipState,
  id: unknown,
): { state: OwnershipState; training: TrainingState; member: IndividualMoves } {
  const current = validState(state);
  if (!current.training) {
    throw new RangeError('Learning is not enabled');
  }
  if (typeof id !== 'string') {
    throw new TypeError('Expected instance ID');
  }
  const member = current.training.individuals.find((entry) => entry.instanceId === id);
  if (!member) {
    throw new RangeError('Unknown learning target');
  }
  return { state: current, training: current.training, member };
}
function updateMember(
  training: TrainingState,
  member: IndividualMoves,
  knownMoves: readonly KnownMove[],
): TrainingState {
  return {
    ...training,
    individuals: training.individuals.map((entry) =>
      entry.instanceId === member.instanceId
        ? { instanceId: entry.instanceId, knownMoves }
        : entry,
    ),
  };
}
export function enableLearning(state: OwnershipState, input: unknown): OwnershipState {
  const current = validState(state);
  if (current.training) {
    throw new RangeError('Learning is already enabled');
  }
  const rules = readMoveRules(input);
  return validState({
    ...current,
    training: {
      rules,
      individuals: current.owned.map((entry) => ({
        instanceId: entry.monster.id,
        knownMoves: [],
      })),
      pending: [],
      nextChoiceId: 1,
      resolvedThrough: 0,
    },
  });
}
export function requestLearning(
  state: OwnershipState,
  instanceId: unknown,
  moveId: unknown,
): OwnershipState {
  const current = context(state, instanceId);
  const move = moveDefinition(current.training.rules, moveId);
  if (
    current.member.knownMoves.some((entry) => entry.moveId === move.id) ||
    current.training.pending.some(
      (entry) =>
        entry.instanceId === current.member.instanceId && entry.moveId === move.id,
    )
  ) {
    throw new RangeError('Move already known or pending');
  }
  let training: TrainingState;
  if (current.member.knownMoves.length < current.training.rules.slotCapacity) {
    training = updateMember(current.training, current.member, [
      ...current.member.knownMoves,
      { moveId: move.id, remaining: fullResource(move) },
    ]);
  } else {
    const choiceId = current.training.nextChoiceId;
    if (choiceId === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Choice IDs exhausted');
    }
    training = {
      ...current.training,
      nextChoiceId: choiceId + 1,
      pending: [
        ...current.training.pending,
        { choiceId, instanceId: current.member.instanceId, moveId: move.id },
      ],
    };
  }
  return validState({ ...current.state, training });
}
export function resolveLearning(
  state: OwnershipState,
  choiceId: unknown,
  instanceId: unknown,
  decision: unknown,
): OwnershipState {
  const current = context(state, instanceId);
  const requested = integer(choiceId, 1);
  const choice = current.training.pending[0];
  if (
    !choice ||
    choice.choiceId !== requested ||
    choice.instanceId !== current.member.instanceId
  ) {
    throw new RangeError('Consumed, out-of-order or mismatched choice');
  }
  const action = record(decision, ['kind', 'moveId']);
  let training = current.training;
  if (action.kind === 'replace') {
    if (typeof action.moveId !== 'string') {
      throw new TypeError('Expected replacement move ID');
    }
    const index = current.member.knownMoves.findIndex(
      (entry) => entry.moveId === action.moveId,
    );
    if (index < 0) {
      throw new RangeError('Replacement move is not known');
    }
    const move = moveDefinition(training.rules, choice.moveId);
    training = updateMember(
      training,
      current.member,
      current.member.knownMoves.map((entry, slot) =>
        slot === index ? { moveId: move.id, remaining: fullResource(move) } : entry,
      ),
    );
  } else if (action.kind !== 'decline' || Object.hasOwn(action, 'moveId')) {
    throw new TypeError('Expected replace or decline');
  }
  training = {
    ...training,
    pending: training.pending.slice(1),
    resolvedThrough: requested,
  };
  return validState({ ...current.state, training });
}
export function useMove(
  state: OwnershipState,
  instanceId: unknown,
  moveId: unknown,
  amount: unknown,
): OwnershipState {
  const current = context(state, instanceId);
  const points = integer(amount, 1);
  const move = moveDefinition(current.training.rules, moveId);
  const known = current.member.knownMoves.find((entry) => entry.moveId === move.id);
  if (!known) {
    throw new RangeError('Move is not known');
  }
  if (known.remaining !== null && points > known.remaining) {
    throw new RangeError('Insufficient move resource');
  }
  const knownMoves = current.member.knownMoves.map((entry) =>
    entry.moveId === move.id
      ? {
          moveId: move.id,
          remaining: known.remaining === null ? null : known.remaining - points,
        }
      : entry,
  );
  return validState({
    ...current.state,
    training: updateMember(current.training, current.member, knownMoves),
  });
}
export function restoreMoveResources(
  state: OwnershipState,
  instanceId: unknown,
): OwnershipState {
  const current = context(state, instanceId);
  const knownMoves = current.member.knownMoves.map((entry) => ({
    moveId: entry.moveId,
    remaining: fullResource(moveDefinition(current.training.rules, entry.moveId)),
  }));
  return validState({
    ...current.state,
    training: updateMember(current.training, current.member, knownMoves),
  });
}
