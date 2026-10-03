/**
 * Lite build: replaces the CronLex model with a no-op so the bundle drops ~100 KB.
 * Exact vocabulary (and plurals) still works; only typo correction is disabled.
 */
export interface Prediction {
  label: string;
  prob: number;
  top: { label: string; prob: number }[];
}
export function predictToken(_word: string): Prediction {
  return { label: '__other__', prob: 1, top: [] };
}
export function fnv1a(_s: string): number {
  return 0;
}
export function features(_w: string): number[] {
  return [];
}
export const MODEL_INFO = { name: 'CronAI lite', version: 'lite', params: 0, valAccuracy: 0, sizeKb: 0, minLen: 99 };
