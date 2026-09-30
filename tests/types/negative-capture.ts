import type { BattleAction } from 'monster-rpg-core';
const decision: Extract<BattleAction, { kind: 'capture' }>['success'] = 1;
void decision;
