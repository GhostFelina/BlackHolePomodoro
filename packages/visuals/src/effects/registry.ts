import type { FocusEffect } from './types.js';
import { gargantua, halo, inferno, prism } from './gargantua.js';
import { eclipse } from './eclipse.js';
import { rain } from './rain.js';
import { snow } from './snow.js';
import { flood } from './flood.js';
import { voidfield } from './voidfield.js';

/**
 * The effect catalogue.
 *
 * To ship a new effect: write the file, import it, add it to `BUILT_IN`. It
 * appears in the settings picker, gets persisted by id, and is rendered by the
 * same pipeline. Nothing else in the app needs to change.
 */
const registry = new Map<string, FocusEffect>();

export const BUILT_IN: readonly FocusEffect[] = [
  gargantua, inferno, halo, prism, rain, snow, flood, eclipse, voidfield,
];

for (const effect of BUILT_IN) registry.set(effect.id, effect);

export function registerEffect(effect: FocusEffect): void {
  if (registry.has(effect.id)) {
    throw new Error(`Effect id "${effect.id}" is already registered.`);
  }
  registry.set(effect.id, effect);
}

export function listEffects(): FocusEffect[] {
  return [...registry.values()];
}

/** Always returns something renderable, falling back to the default effect. */
export function getEffect(id: string): FocusEffect {
  return registry.get(id) ?? gargantua;
}

export function hasEffect(id: string): boolean {
  return registry.has(id);
}

export const DEFAULT_EFFECT_ID = gargantua.id;
