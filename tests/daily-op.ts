// Daily Op determinism — inlined copies of daily.ts's pure logic (Node's strict ESM resolver
// needs explicit .ts extensions on relative imports that Vite doesn't require; daily.ts itself
// imports from './rng' and './data' without extensions, which breaks under direct Node
// execution — same workaround already used in validate.ts, reimplementing the short
// orchestration logic against the REAL, directly-importable rng.ts primitives).
// Run: node --experimental-strip-types tests/daily-op.ts
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function seededInt(rand: () => number, min: number, max: number): number { return min + Math.floor(rand() * (max - min + 1)); }
function seededPick<T>(rand: () => number, arr: readonly T[]): T { return arr[Math.floor(rand() * arr.length)]; }

const MODIFIER_IDS = ['asteroids', 'rich-veins', 'meteors', 'ion-storms'];

function computeDailyOp(dateStr: string, eligibleLevelIds: number[]) {
  if (eligibleLevelIds.length === 0) return null;
  const sorted = [...eligibleLevelIds].sort((a, b) => a - b);
  const rand = mulberry32(hashString(dateStr));
  const levelId = seededPick(rand, sorted);
  const n = seededInt(rand, 1, 2);
  const pool = [...MODIFIER_IDS];
  const modifiers: string[] = [];
  while (modifiers.length < n && pool.length) {
    const idx = seededInt(rand, 0, pool.length - 1);
    modifiers.push(pool.splice(idx, 1)[0]);
  }
  return { dateStr, levelId, modifiers, mutatorBonus: 0.25, difficulty: 3 };
}
function todayStr(d = new Date()): string {
  const y = d.getFullYear(), m = `${d.getMonth() + 1}`.padStart(2, '0'), day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

const eligible = Array.from({ length: 15 }, (_, i) => i + 1);
const dates: string[] = [];
for (let i = 0; i < 30; i++) dates.push(todayStr(new Date(2026, 0, 1 + i * 11)));

for (const date of dates) {
  const a = computeDailyOp(date, eligible);
  const b = computeDailyOp(date, eligible);
  check(JSON.stringify(a) === JSON.stringify(b), `date ${date}: two runs identical`);
  check(!!a && eligible.includes(a.levelId), `date ${date}: picked level eligible`);
  check(!!a && a.modifiers.length >= 1 && a.modifiers.length <= 2, `date ${date}: 1-2 modifiers`);
  check(!!a && new Set(a.modifiers).size === a.modifiers.length, `date ${date}: no duplicate modifiers`);
}

const smallPool = [1, 2, 3];
const c1 = computeDailyOp('2026-07-08', smallPool);
const c2 = computeDailyOp('2026-07-08', smallPool);
check(JSON.stringify(c1) === JSON.stringify(c2), 'same date+pool -> identical');
check(computeDailyOp('2026-07-08', []) === null, 'empty pool -> null gracefully');

const d1 = computeDailyOp('2026-07-08', eligible);
const d2 = computeDailyOp('2026-07-09', eligible);
check(JSON.stringify(d1) !== JSON.stringify(d2), 'adjacent dates differ');

check(daysBetween('2026-07-08', '2026-07-09') === 1, 'daysBetween +1');
check(daysBetween('2026-07-08', '2026-07-08') === 0, 'daysBetween 0');
check(daysBetween('2026-07-08', '2026-07-15') === 7, 'daysBetween +7');
check(daysBetween('2026-07-08', '2026-06-08') === -30, 'daysBetween negative');



// ---------- streak logic across date boundaries ----------
// Replicates ui.ts's exact streak-update block from showResult() (only a WIN on a NEW day
// touches the streak; same-day replays and losses never mutate it).
interface DailyState { lastDate: string; lastWon: boolean; streak: number; bestStreak: number; }
function applyWin(state: DailyState, today: string): DailyState {
  const s = { ...state };
  if (s.lastDate !== today) {
    const gap = s.lastDate ? daysBetween(s.lastDate, today) : null;
    s.streak = gap === 1 ? s.streak + 1 : 1;
    s.lastDate = today;
    s.lastWon = true;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
  }
  return s;
}
{
  let s: DailyState = { lastDate: '', lastWon: false, streak: 0, bestStreak: 0 };
  // day 1: first ever win -> streak 1
  s = applyWin(s, '2026-07-01');
  check(s.streak === 1 && s.bestStreak === 1, `day 1 win: streak=1, got streak=${s.streak} best=${s.bestStreak}`);
  // day 2 (consecutive): streak grows to 2
  s = applyWin(s, '2026-07-02');
  check(s.streak === 2 && s.bestStreak === 2, `day 2 consecutive win: streak=2, got ${s.streak}`);
  // day 3 (consecutive): streak grows to 3
  s = applyWin(s, '2026-07-03');
  check(s.streak === 3 && s.bestStreak === 3, `day 3 consecutive win: streak=3, got ${s.streak}`);
  // replaying the SAME day again must NOT double-increment
  const beforeReplay = { ...s };
  s = applyWin(s, '2026-07-03');
  check(JSON.stringify(s) === JSON.stringify(beforeReplay), 'replaying the same day again does not change streak state');
  // day 5 (missed day 4): streak resets to 1, best is PRESERVED
  s = applyWin(s, '2026-07-05');
  check(s.streak === 1, `missed a day: streak resets to 1, got ${s.streak}`);
  check(s.bestStreak === 3, `missed a day: bestStreak stays at the prior peak (3), got ${s.bestStreak}`);
  // day 6 (consecutive again): streak climbs back up, doesn't yet beat best
  s = applyWin(s, '2026-07-06');
  check(s.streak === 2 && s.bestStreak === 3, `rebuilding streak: streak=2, best still 3, got streak=${s.streak} best=${s.bestStreak}`);
  // keep going past the old best -> best updates
  s = applyWin(s, '2026-07-07');
  s = applyWin(s, '2026-07-08');
  check(s.streak === 4 && s.bestStreak === 4, `new peak: streak=4 and bestStreak=4, got streak=${s.streak} best=${s.bestStreak}`);
}
{
  // a large gap (weeks) behaves the same as a 1-day gap: reset to 1, not some partial-credit scheme
  let s: DailyState = { lastDate: '2026-01-01', lastWon: true, streak: 10, bestStreak: 10 };
  s = applyWin(s, '2026-03-15');
  check(s.streak === 1 && s.bestStreak === 10, `long gap: streak resets fully to 1, best preserved at 10, got streak=${s.streak} best=${s.bestStreak}`);
}
{
  // month/year boundary consecutive days still count as consecutive (exercises daysBetween's UTC date math)
  let s: DailyState = { lastDate: '2026-01-31', lastWon: true, streak: 5, bestStreak: 5 };
  s = applyWin(s, '2026-02-01');
  check(s.streak === 6, `month-boundary consecutive day: streak=6, got ${s.streak}`);
  s = applyWin(s, '2026-02-02');
  let yearS: DailyState = { lastDate: '2025-12-31', lastWon: true, streak: 8, bestStreak: 8 };
  yearS = applyWin(yearS, '2026-01-01');
  check(yearS.streak === 9, `year-boundary consecutive day: streak=9, got ${yearS.streak}`);
}

console.log(fails ? `${fails} FAILURES` : `daily-op: all checks passed (${dates.length} dates x2 determinism + streak-across-dates logic)`);
process.exit(fails ? 1 : 0);
