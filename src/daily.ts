// ================= Daily Op =================
// A single seeded, deterministic run per calendar day: same date -> same composition,
// for anyone, forever. Only the *choice* of which beaten level is picked depends on the
// player's own progress (passed in); the random draws themselves are 100% date-derived.
import { mulberry32, hashString, seededInt, seededPick } from './rng';
import { MODIFIER_INFO } from './data';

export interface DailyOp {
  dateStr: string;
  levelId: number;
  modifiers: string[];
  mutatorBonus: number;   // added flat to the wave-mutator chance
  difficulty: number;     // fixed difficulty tier for the run (Hard)
}

export const DAILY_DIFFICULTY = 3; // Hard

// Pure and deterministic: same (dateStr, eligibleLevelIds) always yields the same DailyOp.
// eligibleLevelIds should be sorted by the caller for cross-platform determinism (Set/object
// key iteration order isn't guaranteed identical everywhere).
export function computeDailyOp(dateStr: string, eligibleLevelIds: number[]): DailyOp | null {
  if (eligibleLevelIds.length === 0) return null;
  const sorted = [...eligibleLevelIds].sort((a, b) => a - b);
  const rand = mulberry32(hashString(dateStr));
  const levelId = seededPick(rand, sorted);
  const modPool = Object.keys(MODIFIER_INFO);
  const n = seededInt(rand, 1, 2);
  const pool = [...modPool];
  const modifiers: string[] = [];
  while (modifiers.length < n && pool.length) {
    const idx = seededInt(rand, 0, pool.length - 1);
    modifiers.push(pool.splice(idx, 1)[0]);
  }
  return { dateStr, levelId, modifiers, mutatorBonus: 0.25, difficulty: DAILY_DIFFICULTY };
}

// Today's date as YYYY-MM-DD in the player's local timezone (so "today" matches their clock).
export function todayStr(d = new Date()): string {
  const y = d.getFullYear(), m = `${d.getMonth() + 1}`.padStart(2, '0'), day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Whole days between two YYYY-MM-DD strings (b - a), for streak continuity checks.
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const da = Date.UTC(ay, am - 1, ad), db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86400000);
}
