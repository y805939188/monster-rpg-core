export { loadSpeciesCatalog, createMonsters } from './species.js';
export type { SpeciesDefinition, SpeciesCatalog, MonsterInstance } from './species.js';
export {
  createOwnership, admitMonster, depositMonster, withdrawMonster, reorderParty,
  healMonster, reviveMonster, clearCondition,
} from './ownership.js';
export type { Health, OwnedMonster, OwnershipState } from './ownership.js';
export { enableLearning, requestLearning, resolveLearning, useMove, restoreMoveResources } from './moves.js';
export type { MoveResource, MoveDefinition, MoveRules, KnownMove, IndividualMoves, LearningChoice, TrainingState } from './move-data.js';
export { enableInventory, addItems, useMedicine } from './inventory.js';
export { enableCollection, recordSeen } from './collection.js';
export type { MedicineEffect, ItemEffect, ItemDefinition, InventoryRules, ItemStack, InventoryState } from './inventory-data.js';
export type { CollectionState } from './collection-data.js';
export { EncounterSession } from './encounter.js';
export type { BattleCombatant, BattleRequest, LocalBattleHandle, LocalBattleAdapter } from './encounter.js';
export type { MedicineApplication, BattleAction, BattleCheckpoint, BattleCommand, BattleConfirmation, BattleReceipt, BattleFault } from './battle-actions.js';

export { enableGrowth, initializeGrowth, awardExperience, resolveEvolution, evolveWithItem } from './growth.js';
export type { GrowthRules, SpeciesGrowth, LearnsetEntry, EvolutionRule, GrowthState, IndividualGrowth, EvolutionChoice } from './growth-data.js';

export { enableBattleRewards } from './rewards.js';
export type { RewardItem, VictoryReward, RecoveryHP, RecoveryRule, BattleRewardRules, DefeatRecovery, BattleRewardState } from './reward-data.js';

export type { SaveData } from './save.js';
