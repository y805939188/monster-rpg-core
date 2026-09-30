import { parseSave, serializeSave } from './save';
import { applyDefeatRecovery, settleBattleRewards, validateRewardBegin } from './rewards';
import { loadSpeciesCatalog } from './species';
import {
  initialCheckpoint,
  medicineRule,
  readAction,
  sameData,
  settleConfirmation,
} from './battle-actions';
import type {
  BattleCheckpoint,
  BattleCommand,
  BattleConfirmation,
  BattleFault,
  BattleReceipt,
} from './battle-actions';
import { validState } from './ownership';
import type { Health, OwnershipState } from './ownership';
import type { MonsterInstance } from './species';
import type { KnownMove, MoveRules } from './move-data';
import { readTraining } from './move-data';
import { enableCollection, recordSeen } from './collection';
import { integer, record } from './validation';

export interface BattleCombatant {
  readonly monster: MonsterInstance;
  readonly health: Health;
  readonly knownMoves: readonly KnownMove[];
}
export interface BattleRequest {
  readonly trainerId?: string;
  readonly kind: 'wild' | 'trainer';
  readonly party: readonly BattleCombatant[];
  readonly opponents: readonly BattleCombatant[];
  readonly moveRules: MoveRules | null;
}
export interface LocalBattleHandle {
  release(): undefined;
  execute?(command: BattleCommand): BattleConfirmation;
}
export interface LocalBattleAdapter {
  setup(request: BattleRequest): LocalBattleHandle;
}

function requestFor(
  state: OwnershipState,
  input: unknown,
  draw: unknown,
): { request: BattleRequest; next: OwnershipState } {
  const config = record(input, ['kind', 'candidates', 'opponents', 'trainerId']);
  if (config.kind !== 'wild' && config.kind !== 'trainer') {
    throw new TypeError('Expected encounter kind');
  }
  if (
    config.kind === 'wild'
      ? Object.hasOwn(config, 'opponents')
      : Object.hasOwn(config, 'candidates')
  ) {
    throw new TypeError('Wrong encounter fields');
  }
  let trainerId: string | undefined;
  if (Object.hasOwn(config, 'trainerId')) {
    if (config.kind !== 'trainer') {
      throw new TypeError('Wild encounters cannot identify trainer');
    }
    trainerId = loadSpeciesCatalog([{ id: config.trainerId, name: 'Trainer' }])[0]?.id;
  }
  const values = config.kind === 'wild' ? config.candidates : config.opponents;
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('Expected encounter opponents');
  }
  if (config.kind === 'wild') {
    if (typeof draw !== 'number') {
      throw new TypeError('Wild encounter requires draw');
    }
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
      throw new RangeError('Draw must be in [0,1)');
    }
  } else if (draw !== undefined) {
    throw new TypeError('Trainer encounter does not use draw');
  }
  const inputs = values.map((value) =>
    record(value, ['monster', 'health', 'knownMoves', 'visible']),
  );
  for (const entry of inputs) {
    if (typeof entry.visible !== 'boolean' || !Array.isArray(entry.knownMoves)) {
      throw new TypeError('Expected visibility and known moves');
    }
  }
  const opponentState = validState({
    catalog: state.catalog,
    totalCapacity: inputs.length,
    partyCapacity: 0,
    owned: inputs.map((entry) => ({ monster: entry.monster, health: entry.health })),
    party: [],
  });
  const moveRules = state.training?.rules ?? null;
  const opponentMoves = moveRules
    ? readTraining(
        {
          rules: moveRules,
          individuals: opponentState.owned.map((entry, index) => ({
            instanceId: entry.monster.id,
            knownMoves: inputs[index]?.knownMoves,
          })),
          pending: [],
          nextChoiceId: 1,
          resolvedThrough: 0,
        },
        opponentState.owned.map((entry) => entry.monster.id),
      ).individuals
    : [];
  if (
    !moveRules &&
    inputs.some(
      (entry) => !Array.isArray(entry.knownMoves) || entry.knownMoves.length !== 0,
    )
  ) {
    throw new RangeError('No move rules enabled');
  }
  const party = state.party.map((id) => {
    const entry = state.owned.find((member) => member.monster.id === id);
    if (!entry) {
      throw new RangeError('Invalid party reference');
    }
    return Object.freeze({
      ...entry,
      knownMoves:
        state.training?.individuals.find((member) => member.instanceId === id)
          ?.knownMoves ?? Object.freeze([]),
    });
  });
  if (!party.some((entry) => entry.health.currentHP > 0)) {
    throw new RangeError('No nonfainted party member');
  }
  for (const entry of opponentState.owned) {
    if (state.owned.some((member) => member.monster.id === entry.monster.id)) {
      throw new RangeError('Opponent/owned ID collision');
    }
  }
  const opponents = opponentState.owned.map((entry) =>
    Object.freeze({
      ...entry,
      knownMoves:
        opponentMoves.find((member) => member.instanceId === entry.monster.id)
          ?.knownMoves ?? Object.freeze([]),
    }),
  );
  let selected: readonly BattleCombatant[] = opponents;
  let visible = inputs.map((entry, index) =>
    entry.visible ? opponents[index]?.monster.speciesId : undefined,
  );
  if (config.kind === 'wild') {
    if (typeof draw !== 'number') {
      throw new TypeError('Missing draw');
    }
    const index = Math.floor(draw * opponents.length);
    const opponent = opponents[index];
    if (!opponent) {
      throw new RangeError('Invalid encounter selection');
    }
    selected = [opponent];
    visible = inputs[index]?.visible ? [opponent.monster.speciesId] : [];
  }
  if (!selected.some((entry) => entry.health.currentHP > 0)) {
    throw new RangeError('No nonfainted opponent');
  }
  let next = state.collection ? state : enableCollection(state);
  for (const id of visible) {
    if (id !== undefined) {
      next = recordSeen(next, id);
    }
  }
  const request: BattleRequest = Object.freeze({
    kind: config.kind,
    ...(trainerId ? { trainerId } : {}),
    party: Object.freeze(party),
    opponents: Object.freeze(selected),
    moveRules,
  });
  return { request, next };
}

function observeUnsupportedPromise(value: unknown): void {
  // The caller receives a synchronous TypeError; never adopt late results or write state.
  if (value instanceof Promise) {
    void value.catch(() => undefined);
  }
}

function localHandle(value: unknown): value is LocalBattleHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'release' in value &&
    typeof value.release === 'function' &&
    !('then' in value)
  );
}

/** Synchronous local lifecycle only; durable edits go through revision-checked commit. */
export class EncounterSession {
  #state: OwnershipState;
  #revision = 0;
  #adapter: LocalBattleAdapter;
  #phase:
    | 'idle'
    | 'starting'
    | 'active'
    | 'executing'
    | 'faulted'
    | 'releasing'
    | 'cleanup_failed' = 'idle';
  #generation = 0;
  #nextCommandId = 1;
  #fault: BattleFault | undefined;
  #last: { confirmation: BattleConfirmation; receipt: BattleReceipt } | undefined;
  #active:
    | {
        request: BattleRequest;
        checkpoint: BattleCheckpoint;
        participants: readonly string[];
        release: () => unknown;
        execute: ((command: BattleCommand) => BattleConfirmation) | undefined;
      }
    | undefined;

  constructor(initialState: OwnershipState, adapter: LocalBattleAdapter) {
    this.#state = validState(initialState);
    if (!adapter || typeof adapter.setup !== 'function') {
      throw new TypeError('Expected local adapter');
    }
    this.#adapter = Object.freeze({ setup: adapter.setup.bind(adapter) });
  }
  get state(): OwnershipState {
    return this.#state;
  }
  get revision(): number {
    return this.#revision;
  }
  get activeRequest(): BattleRequest | undefined {
    return this.#active?.request;
  }

  get checkpoint(): BattleCheckpoint | undefined {
    return this.#active?.checkpoint;
  }
  get fault(): BattleFault | undefined {
    return this.#fault;
  }
  get lastConfirmation(): BattleConfirmation | undefined {
    return this.#last?.confirmation;
  }

  serialize(): string {
    if (this.#phase !== 'idle') {
      throw new RangeError('Cannot save with a live or unsettled encounter');
    }
    return serializeSave(this.#state, this.#nextCommandId);
  }
  #checkReplacement(): void {
    if (this.#phase !== 'idle') {
      throw new RangeError('Cannot replace state with a live or unsettled encounter');
    }
    if (
      this.#revision === Number.MAX_SAFE_INTEGER ||
      this.#generation === Number.MAX_SAFE_INTEGER
    ) {
      throw new RangeError('Runtime counters exhausted');
    }
  }
  #install(next: OwnershipState, nextCommandId: number): OwnershipState {
    this.#state = next;
    this.#nextCommandId = Math.max(this.#nextCommandId, nextCommandId);
    this.#revision++;
    this.#generation++;
    this.#last = undefined;
    this.#fault = undefined;
    return next;
  }
  restore(json: unknown): OwnershipState {
    this.#checkReplacement();
    const saved = parseSave(json);
    return this.#install(saved.state, saved.counters.nextCommandId);
  }
  newGame(initialState: unknown): OwnershipState {
    this.#checkReplacement();
    const next = validState(initialState);
    return this.#install(next, this.#nextCommandId);
  }

  get recoveryRequest() {
    return this.#state.battleRewards?.recovery ?? null;
  }
  recoverDefeat(requestId: unknown): OwnershipState {
    if (this.#phase !== 'idle') {
      throw new RangeError('Session is busy');
    }
    if (this.#revision === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Revision exhausted');
    }
    const next = applyDefeatRecovery(this.#state, requestId);
    this.#state = next;
    this.#revision++;
    return next;
  }

  commit(expectedRevision: number, nextState: OwnershipState): void {
    if (this.#phase !== 'idle') {
      throw new RangeError('Session is busy');
    }
    if (this.#state.battleRewards?.recovery) {
      throw new RangeError('Use explicit defeat recovery');
    }
    if (integer(expectedRevision, 0) !== this.#revision) {
      throw new RangeError('Stale state revision');
    }
    if (this.#revision === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Revision exhausted');
    }
    const next = validState(nextState);
    this.#state = next;
    this.#revision++;
  }
  begin(config: unknown, draw?: unknown): BattleRequest {
    if (this.#phase !== 'idle') {
      throw new RangeError('Session is busy');
    }
    if (this.#revision === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Revision exhausted');
    }
    if (this.#generation === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Generation exhausted');
    }
    const candidate = requestFor(this.#state, config, draw);
    validateRewardBegin(this.#state, candidate.request);
    const checkpoint = initialCheckpoint(candidate.request);
    this.#phase = 'starting';
    try {
      const handle: unknown = this.#adapter.setup(candidate.request);
      if (!localHandle(handle)) {
        observeUnsupportedPromise(handle);
        throw new TypeError('Expected synchronous local handle');
      }
      if ('execute' in handle && typeof handle.execute !== 'function') {
        throw new TypeError('Invalid action capability');
      }
      const release = handle.release.bind(handle);
      this.#active = {
        request: candidate.request,
        checkpoint,
        participants: Object.freeze([checkpoint.activeId]),
        release,
        execute: handle.execute?.bind(handle),
      };
      this.#generation++;
      this.#fault = undefined;
      this.#last = undefined;
      this.#state = candidate.next;
      this.#revision++;
      this.#phase = 'active';
      return candidate.request;
    } catch (error) {
      this.#phase = 'idle';
      throw error;
    }
  }
  act(input: unknown): BattleReceipt {
    if (this.#phase !== 'active' || !this.#active) {
      throw new RangeError('Session is not available for actions');
    }
    const active = this.#active;
    if (!active.execute) {
      throw new RangeError('Adapter has no action capability');
    }
    if (
      this.#revision === Number.MAX_SAFE_INTEGER ||
      this.#nextCommandId === Number.MAX_SAFE_INTEGER
    ) {
      throw new RangeError('Command/revision exhausted');
    }
    const action = readAction(input, active.checkpoint, this.#state, active.request);
    const medicine = medicineRule(action, this.#state);
    const participants =
      action.kind === 'switch' && !active.participants.includes(action.targetId)
        ? Object.freeze([...active.participants, action.targetId])
        : active.participants;
    const command: BattleCommand = Object.freeze({
      generation: this.#generation,
      commandId: this.#nextCommandId++,
      revision: this.#revision,
      action,
      checkpoint: active.checkpoint,
      ...(medicine ? { medicine } : {}),
      ...(this.#state.battleRewards ? { participants } : {}),
    });
    this.#phase = 'executing';
    let reason: BattleFault['reason'] = 'adapter_error';
    try {
      const input: unknown = active.execute(command);
      reason = 'invalid_confirmation';
      observeUnsupportedPromise(input);
      const { confirmation, next: checkpointState } = settleConfirmation(
        input,
        command,
        this.#state,
      );
      const next = settleBattleRewards(
        checkpointState,
        active.request,
        confirmation,
        participants,
      );
      if (confirmation.outcome !== 'continue') {
        reason = 'release_failed';
        this.#phase = 'releasing';
        const result = active.release();
        if (result !== undefined) {
          observeUnsupportedPromise(result);
          throw new TypeError('Release must complete synchronously without result');
        }
      }
      this.#state = next;
      this.#revision++;
      const receipt: BattleReceipt = Object.freeze({
        status: 'applied',
        generation: command.generation,
        commandId: command.commandId,
        revision: this.#revision,
        outcome: confirmation.outcome,
      });
      this.#last = { confirmation, receipt };
      active.checkpoint = confirmation.checkpoint;
      active.participants = participants;
      if (confirmation.outcome === 'continue') {
        this.#phase = 'active';
      } else {
        this.#active = undefined;
        this.#phase = 'idle';
      }
      return receipt;
    } catch (error) {
      this.#fault = Object.freeze({
        generation: command.generation,
        commandId: command.commandId,
        revision: command.revision,
        reason,
      });
      this.#phase = 'faulted';
      throw new Error(`Battle command faulted: ${reason}`, { cause: error });
    }
  }
  /** Replay acknowledgement only: never executes an engine or accepts a new command. */
  confirm(input: unknown): BattleReceipt {
    if (
      this.#phase === 'executing' ||
      this.#phase === 'starting' ||
      this.#phase === 'releasing'
    ) {
      throw new RangeError('Session is busy');
    }
    if (!this.#last || !sameData(input, this.#last.confirmation)) {
      throw new RangeError('Unknown, old or conflicting confirmation');
    }
    return Object.freeze({ ...this.#last.receipt, status: 'already_applied' });
  }
  abandonFaultedEncounter(): OwnershipState {
    if (this.#phase !== 'faulted' || !this.#active) {
      throw new RangeError('No faulted encounter');
    }
    this.#phase = 'releasing';
    try {
      const result = this.#active.release();
      if (result !== undefined) {
        observeUnsupportedPromise(result);
        throw new TypeError('Release must complete synchronously without result');
      }
      this.#active = undefined;
      this.#fault = undefined;
      this.#phase = 'idle';
      return this.#state;
    } catch (error) {
      this.#phase = 'faulted';
      throw error;
    }
  }
  release(): void {
    if (this.#phase === 'idle') {
      return;
    }
    if ((this.#phase !== 'active' && this.#phase !== 'cleanup_failed') || !this.#active) {
      throw new RangeError('Session is busy');
    }
    this.#phase = 'releasing';
    try {
      const result: unknown = this.#active.release();
      if (result !== undefined) {
        observeUnsupportedPromise(result);
        throw new TypeError('Release must complete synchronously without result');
      }
      this.#active = undefined;
      this.#phase = 'idle';
    } catch (error) {
      this.#phase = 'cleanup_failed';
      throw error;
    }
  }
}
