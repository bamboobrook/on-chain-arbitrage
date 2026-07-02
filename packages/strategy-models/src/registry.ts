/**
 * Strategy registry — single source of truth for which models are loaded.
 * Workers and the API look up models by id here.
 */

import type { StrategyModel } from './interface.js';
import { AtomicAmmModel } from './models/atomicAmm.js';
import { MevBackrunModel } from './models/mevBackrun.js';
import { PegLstModel } from './models/pegLst.js';

const _models: StrategyModel[] = [
  new AtomicAmmModel(),
  new MevBackrunModel(),
  new PegLstModel(),
];

export const MODELS: Record<string, StrategyModel> = Object.fromEntries(
  _models.map((m) => [m.id, m]),
);

export function getModel(id: string): StrategyModel | undefined {
  return MODELS[id];
}

export function listModels(): StrategyModel[] {
  return _models;
}
