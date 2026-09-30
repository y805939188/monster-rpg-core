import { createMonsters, loadSpeciesCatalog } from 'monster-rpg-core';
import type { MonsterInstance, SpeciesCatalog } from 'monster-rpg-core';
const catalog: SpeciesCatalog = loadSpeciesCatalog([{ id: 'mossglow', name: 'Mossglow' }]);
const monsters: readonly MonsterInstance[] = createMonsters(catalog, [{ id: 'one', speciesId: 'mossglow' }]);
const nickname: string | undefined = monsters[0]?.nickname;
void nickname;

import { createOwnership, admitMonster, healMonster } from 'monster-rpg-core';
import type { OwnershipState, Health } from 'monster-rpg-core';
const initial: OwnershipState = createOwnership(catalog, { totalCapacity: 3, partyCapacity: 1 });
const owned = admitMonster(initial, monsters[0], { currentHP: 2, maxHP: 10, condition: null });
const health: Health | undefined = healMonster(owned, 'one', 1).owned[0]?.health;
void health;

import { enableLearning, requestLearning, useMove } from 'monster-rpg-core';
import type { LearningChoice, MoveRules } from 'monster-rpg-core';
const rules: MoveRules = { slotCapacity: 1, moves: [{ id: 'mistbell', name: 'Mistbell', resource: { kind: 'none' } }] };
const trained = requestLearning(enableLearning(owned, rules), 'one', 'mistbell');
const choice: LearningChoice | undefined = useMove(trained, 'one', 'mistbell', 1).training?.pending[0];
void choice;

import { enableInventory, enableCollection, addItems, recordSeen, useMedicine } from 'monster-rpg-core';
import type { CollectionState, ItemStack } from 'monster-rpg-core';
const supplies = addItems(enableInventory(owned, { stackCapacity: 1, stackLimit: 3, items: [{ id: 'moss-balm', name: 'Moss Balm', effect: { kind: 'heal', amount: 1 } }] }), 'moss-balm', 1);
const recorded = recordSeen(enableCollection(supplies), 'mossglow');
const collection: CollectionState | undefined = useMedicine(recorded, 'moss-balm', 'one').collection;
const stack: ItemStack | undefined = recorded.inventory?.stacks[0];
void collection; void stack;

import { EncounterSession } from 'monster-rpg-core';
import type { LocalBattleAdapter, BattleRequest } from 'monster-rpg-core';
const adapter: LocalBattleAdapter = { setup: () => ({ release: () => undefined }) };
const session = new EncounterSession(owned, adapter);
const request: BattleRequest | undefined = session.activeRequest;
session.commit(session.revision, owned); session.release();
void request;

import type { BattleCommand, BattleConfirmation, BattleReceipt } from 'monster-rpg-core';
const actionAdapter: LocalBattleAdapter = { setup: () => ({ release: () => undefined, execute(command: BattleCommand): BattleConfirmation {
  return { generation: command.generation, commandId: command.commandId, revision: command.revision, outcome: 'continue', checkpoint: command.checkpoint };
} }) };
const actions = new EncounterSession(owned, actionAdapter);
const receipt: BattleReceipt = actions.confirm({});
void receipt;

import type { BattleAction, ItemEffect } from 'monster-rpg-core';
const captureItem: ItemEffect = { kind: 'capture' };
const captureAction: BattleAction = { kind: 'capture', actorId: 'one', targetId: 'enemy', itemId: 'reed-orb', success: false };
const fleeAction: BattleAction = { kind: 'flee', actorId: 'one', success: true };
const medicineAction: BattleAction = { kind: 'medicine', actorId: 'one', targetId: 'two', itemId: 'moss-tonic' };
void captureItem; void captureAction; void fleeAction; void medicineAction;

import { enableGrowth, initializeGrowth, awardExperience, resolveEvolution, evolveWithItem } from 'monster-rpg-core';
import type { GrowthRules, IndividualGrowth, EvolutionChoice } from 'monster-rpg-core';
const growthRules: GrowthRules = { thresholds: [0, 5], species: [{ speciesId: 'mossglow', maxHP: [10, 12], learnset: [], evolution: null }] };
const growing = initializeGrowth(enableGrowth(owned, growthRules), 'one');
const level: IndividualGrowth | undefined = awardExperience(growing, 'one', 5).growth?.individuals[0];
const evolution: EvolutionChoice | undefined = growing.growth?.pending[0];
void level; void evolution; void resolveEvolution; void evolveWithItem;

import { enableBattleRewards } from 'monster-rpg-core';
import type { BattleRewardRules, DefeatRecovery } from 'monster-rpg-core';
const rewardRules: BattleRewardRules = { wild: { experience: 5, items: [] }, trainers: [],
  defeat: { penalty: [], recovery: { hp: { kind: 'fixed', amount: 1 }, clearCondition: true, restoreResources: false } } };
const rewarded = enableBattleRewards(growing, rewardRules);
const rewardSession = new EncounterSession(rewarded, adapter);
const recovery: DefeatRecovery | null = rewardSession.recoveryRequest;
void recovery; void rewardSession.recoverDefeat;

import type { SaveData } from 'monster-rpg-core';
const savedText: string = rewardSession.serialize();
const restoredState: OwnershipState = rewardSession.restore(savedText);
const resetState: OwnershipState = rewardSession.newGame(owned);
const saveVersion: SaveData['version'] = 1;
void restoredState; void resetState; void saveVersion;
