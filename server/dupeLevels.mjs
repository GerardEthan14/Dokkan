// % affiché en jeu selon le nombre de doublons appliqués à une carte "standard" :
// 0 doublon (carte simple) = 55%, puis 69%, 79%, 89%, et 100% une fois rainbow (4 doublons).
export const DUPE_LEVELS = [55, 69, 79, 89, 100];
export const MAX_DUPE_LEVEL = DUPE_LEVELS.length - 1;

export function clampDupeLevel(level) {
  return Math.max(0, Math.min(MAX_DUPE_LEVEL, Math.round(Number(level) || 0)));
}

export function percentForLevel(level) {
  return DUPE_LEVELS[clampDupeLevel(level)];
}
