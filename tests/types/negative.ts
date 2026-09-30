import { loadSpeciesCatalog } from 'monster-rpg-core';
const invalid: number = loadSpeciesCatalog([{ id: 'mossglow', name: 'Mossglow' }])[0]?.name;
void invalid;
