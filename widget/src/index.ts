/**
 * CronAI widget entry. Registers <cron-ai>, auto-mounts [data-cronai] elements and
 * exposes window.CronAI (IIFE build) / named exports (ESM build).
 */
import { define, mount, autoMount, CronAIElement, DEFAULT_EXAMPLES, USER_EXAMPLES } from './cron-ai';
import { SECTIONS, DEFAULT_STRINGS, resolveSections } from '../../src/ui/config';
import { parseSchedule, describeCron, nextRuns, nextRunsMany, validateCron, MODEL_INFO, createTrigger, scheduleNextRuns, readSchedule, localTimeZone } from '../../src/engine';
import { PALETTE_NAMES } from '../../src/themes/palettes';

declare const __CRONAI_VERSION__: string;
declare const __CRONAI_BUILD__: string;

export const version = typeof __CRONAI_VERSION__ !== 'undefined' ? __CRONAI_VERSION__ : 'dev';
export const build = typeof __CRONAI_BUILD__ !== 'undefined' ? __CRONAI_BUILD__ : 'full';
export const themes = ['auto', ...PALETTE_NAMES];
export const sizes = ['mini', 'compact', 'full'];
export const modes = ['developer', 'user'];
export const sections = SECTIONS;
export const strings = DEFAULT_STRINGS;
export { define, mount, autoMount, CronAIElement, DEFAULT_EXAMPLES, USER_EXAMPLES, resolveSections };
export { createTrigger, scheduleNextRuns, readSchedule, localTimeZone };
export { parseSchedule as parse, describeCron as describe, nextRuns, nextRunsMany, validateCron as validate, MODEL_INFO as model };

if (typeof window !== 'undefined') {
  define();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => autoMount());
  else autoMount();
}
