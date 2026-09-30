export { loadSpeciesCatalog, createMonsters } from './species';
export type { SpeciesDefinition, SpeciesCatalog, MonsterInstance } from './species';
export {
  createOwnership,
  admitMonster,
  depositMonster,
  withdrawMonster,
  reorderParty,
  healMonster,
  reviveMonster,
  clearCondition,
} from './ownership';
export type { Health, OwnedMonster, OwnershipState } from './ownership';
export {
  enableLearning,
  requestLearning,
  resolveLearning,
  useMove,
  restoreMoveResources,
} from './moves';
export type {
  MoveResource,
  MoveDefinition,
  MoveRules,
  KnownMove,
  IndividualMoves,
  LearningChoice,
  TrainingState,
} from './move-data';
export { enableInventory, addItems, useMedicine } from './inventory';
export { enableCollection, recordSeen } from './collection';
export type {
  MedicineEffect,
  ItemEffect,
  ItemDefinition,
  InventoryRules,
  ItemStack,
  InventoryState,
} from './inventory-data';
export type { CollectionState } from './collection-data';
export { EncounterSession } from './encounter';
export type {
  BattleCombatant,
  BattleRequest,
  LocalBattleHandle,
  LocalBattleAdapter,
} from './encounter';
export type {
  MedicineApplication,
  BattleAction,
  BattleCheckpoint,
  BattleCommand,
  BattleConfirmation,
  BattleReceipt,
  BattleFault,
} from './battle-actions';

export {
  enableGrowth,
  initializeGrowth,
  awardExperience,
  resolveEvolution,
  evolveWithItem,
} from './growth';
export type {
  GrowthRules,
  SpeciesGrowth,
  LearnsetEntry,
  EvolutionRule,
  GrowthState,
  IndividualGrowth,
  EvolutionChoice,
} from './growth-data';

export { enableBattleRewards } from './rewards';
export type {
  RewardItem,
  VictoryReward,
  RecoveryHP,
  RecoveryRule,
  BattleRewardRules,
  DefeatRecovery,
  BattleRewardState,
} from './reward-data';

export type { SaveData } from './save';
