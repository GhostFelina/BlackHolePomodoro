export { EffectRenderer, type RendererOptions, type RendererStats } from './gl/Renderer.js';
export { BloomPipeline } from './gl/postfx.js';
export { ACCENT_RGB, accentToCss, accentToRgb } from './gl/accents.js';
export {
  Choreographer,
  COLLAPSE_SECONDS,
  SWALLOW_SECONDS,
  type ChoreographyInput,
  type VisualStage,
} from './Choreographer.js';
export {
  BUILT_IN,
  DEFAULT_EFFECT_ID,
  getEffect,
  hasEffect,
  listEffects,
  registerEffect,
} from './effects/registry.js';
export { FRAGMENT_PREAMBLE, type EffectFrameContext, type FocusEffect } from './effects/types.js';
export { gargantua } from './effects/gargantua.js';
export { eclipse } from './effects/eclipse.js';
export { voidfield } from './effects/voidfield.js';
