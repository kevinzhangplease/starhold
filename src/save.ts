// ================= Persistence (schema v2) =================
import type { AudioSettings } from './audio';

export interface PlayerStats {
  kills: number;
  wavesCleared: number;
  towersBuilt: Record<string, number>; // tower spec id -> count
  elitesSlain: number;
  novasFired: number;
  bestCombo: number;
  sessions: number;
  leaksByEnemy: Record<string, number>; // enemy id -> hull damage caused
}

export interface SaveData {
  v: number;                        // schema version
  stars: Record<number, number>;    // levelId -> 0..3 (win rating)
  unlocked: number;                 // highest playable level id (gates feature unlocks too)
  meta: string[];                   // owned meta node ids
  // --- schema v2 additions ---
  seen: Record<string, boolean>;    // one-time tutorial toast flags
  challenges: Record<number, boolean[]>; // levelId -> [challenge1 done, challenge2 done]
  ascension: { current: number; unlocked: number; bestPerLevel: Record<number, number> }; // current = selected tier for next play (0=off); unlocked = highest tier available
  endlessBest: Record<number, number>;       // difficultyTier -> best wave reached
  endlessMilestones: Record<number, number[]>; // difficultyTier -> milestone waves claimed (10/20/30)
  daily: { lastDate: string; lastWon: boolean; streak: number; bestStreak: number };
  stats: PlayerStats;
  chromaUnlocked: boolean;
  chromaOn: boolean;
  lastSpeed: number;                // 1 | 2 | 3, restored on level start
  defaultTargeting: string;         // 'first' | 'last' | 'strong' | 'weak' | 'close'
  resume?: string;                  // serialized mid-level snapshot (Phase 6), version-stamped
  settings: AudioSettings & {
    shake: boolean; tileSize: number; difficulty: number; length: number;
    pauseOnBuild: boolean; meander: number; haptics: boolean;
    damageNumbers: boolean; reduceFlash: boolean; reduceMotion: boolean;
    perfMode: 'auto' | 'on' | 'off';
    accessiblePalette: boolean;      // colorblind-accessible tower/enemy board palette (Phase 3B)
  };
}

const KEY = 'starhold-save-v1';

// Every one-time tutorial flag in the game. Veterans (unlocked > 1) get flags for systems
// their progress has already passed, so an update never toast-spams an existing player.
// Map: seen-key -> level at which that system unlocks (from UNLOCKS in data.ts, duplicated
// here to avoid an import cycle; validate.ts asserts the two stay in sync).
export const SEEN_UNLOCK_LEVELS: Record<string, number> = {
  combo: 2, challenges: 2, interest: 3, cells: 3, drops: 4, mod_asteroids: 4, overcharge: 4,
  elites: 5, boss_theater: 5, mutators: 6, mod_veins: 6, nova: 7,
  mod_meteors: 8, veterancy: 8, boss_phase2: 10, mod_ionstorms: 12,
  guide_build: 1, guide_confirm: 1, guide_launch: 1,
  zone_1: 1, zone_2: 6, zone_3: 11,
};

export const defaultStats = (): PlayerStats => ({
  kills: 0, wavesCleared: 0, towersBuilt: {}, elitesSlain: 0,
  novasFired: 0, bestCombo: 0, sessions: 0, leaksByEnemy: {},
});

export const defaultSave = (): SaveData => ({
  v: 2,
  stars: {},
  unlocked: 1,
  meta: [],
  seen: {},
  challenges: {},
  ascension: { current: 0, unlocked: 0, bestPerLevel: {} },
  endlessBest: {},
  endlessMilestones: {},
  daily: { lastDate: '', lastWon: false, streak: 0, bestStreak: 0 },
  stats: defaultStats(),
  chromaUnlocked: false,
  chromaOn: false,
  lastSpeed: 1,
  defaultTargeting: 'first',
  settings: { master: 0.8, music: true, weapons: true, explosions: true, ui: true, alerts: true, shake: true, tileSize: 48, difficulty: 2, length: 2, pauseOnBuild: true, meander: 0, haptics: true, damageNumbers: true, reduceFlash: false, reduceMotion: false, perfMode: 'auto', accessiblePalette: false },
});

// Idempotent: running on an already-migrated save changes nothing.
export function migrateSave(d: any): SaveData {
  const base = defaultSave();
  const out: SaveData = {
    ...base,
    ...d,
    settings: { ...base.settings, ...(d?.settings || {}) },
    ascension: { ...base.ascension, ...(d?.ascension || {}), unlocked: Math.max((d?.ascension?.unlocked ?? 0), (d?.ascension?.current ?? 0)) },
    daily: { ...base.daily, ...(d?.daily || {}) },
    stats: { ...defaultStats(), ...(d?.stats || {}) },
    seen: { ...(d?.seen || {}) },
    challenges: { ...(d?.challenges || {}) },
    endlessMilestones: { ...(d?.endlessMilestones || {}) },
  };
  // Guard every top-level primitive/array field individually: the blanket `...d` spread above
  // only protects fields that are genuinely ABSENT from a save. A field that's PRESENT but
  // explicitly null/wrong-typed (a realistic corruption case — a failed write, a manual edit,
  // a future bug) would otherwise silently clobber the default with garbage.
  if (typeof out.unlocked !== 'number' || !Number.isFinite(out.unlocked) || out.unlocked < 1) out.unlocked = base.unlocked;
  if (!Array.isArray(out.meta)) out.meta = base.meta;
  if (typeof out.stars !== 'object' || out.stars === null) out.stars = base.stars;
  if (typeof out.chromaUnlocked !== 'boolean') out.chromaUnlocked = base.chromaUnlocked;
  if (typeof out.chromaOn !== 'boolean') out.chromaOn = base.chromaOn;
  if (![1, 2, 3].includes(out.lastSpeed)) out.lastSpeed = base.lastSpeed;
  if (typeof out.defaultTargeting !== 'string') out.defaultTargeting = base.defaultTargeting;
  if (out.resume !== undefined && typeof out.resume !== 'string') out.resume = undefined;
  // v1 -> v2: endlessBest was a single number; move it to the Normal (tier 2) slot.
  if (typeof d?.endlessBest === 'number') {
    out.endlessBest = d.endlessBest > 0 ? { 2: d.endlessBest } : {};
  } else {
    out.endlessBest = { ...(d?.endlessBest || {}) };
  }
  // Veterans: pre-mark seen flags for every system their progress already unlocked.
  if (out.unlocked > 1) {
    for (const [key, lvl] of Object.entries(SEEN_UNLOCK_LEVELS)) {
      if (out.unlocked >= lvl && out.seen[key] === undefined) out.seen[key] = true;
    }
  }
  out.v = 2;
  return out;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    return migrateSave(JSON.parse(raw));
  } catch {
    return defaultSave();
  }
}

export function writeSave(s: SaveData) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export function starsSpent(s: SaveData, metaCosts: Record<string, number>): number {
  return s.meta.reduce((a, id) => a + (metaCosts[id] || 0), 0);
}

// Total stars from all sources: level ratings + challenge stars + endless milestone stars.
export function starsEarned(s: SaveData): number {
  const levelStars = Object.values(s.stars).reduce((a, b) => a + b, 0);
  const challengeStars = Object.values(s.challenges).reduce((a, arr) => a + arr.filter(Boolean).length, 0);
  const milestoneStars = Object.values(s.endlessMilestones).reduce((a, arr) => a + arr.length, 0);
  return levelStars + challengeStars + milestoneStars;
}
