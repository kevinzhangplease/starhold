// Daily Op determinism — inlined copies of daily.ts's pure logic (Node's strict ESM resolver
// needs explicit .ts extensions on relative imports that Vite doesn't require; daily.ts itself
// imports from './rng' and './data' without extensions, which breaks under direct Node
// execution — same workaround already used in validate.ts, reimplementing the short
// orchestration logic against the REAL, directly-importable rng.ts primitives).
// Run: node --experimental-strip-types tests/daily-op.ts
import { ENEMIES, ENEMY_INTRO } from '../src/data.ts';
import { LEVELS } from '../src/levels.ts';
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

// ---------- Hard+ wave decoration determinism (Phase 5.5) ----------
// Mirrors game.ts's decorateWave() exactly. The Daily Op is always Hard (difficulty 3, see
// computeDailyOp above) and must reproduce byte-identical decorated waves across runs — this
// is the actual bar the plan asks for ("same daily seed twice -> identical waves").
interface WaveGroup { e: string; n: number; iv: number; d: number; p?: number }
function decorateWave(waves: WaveGroup[][], waveShapes: Record<number, string> | undefined, levelId: number, diffTier: number, i: number): WaveGroup[] | null {
  const wave = waves[i] || null;
  if (!wave || diffTier < 3 || i === 0) return wave;
  if (wave.some(grp => ENEMIES[grp.e]?.boss)) return wave;
  if (waveShapes?.[i] !== undefined) return wave;
  const rng = mulberry32(hashString(`${levelId}-inj-${i}-${diffTier}`));
  const inWave = new Set(wave.map(grp => grp.e));
  const pool = Object.keys(ENEMIES).filter(id => !ENEMIES[id].boss && !inWave.has(id) && (ENEMY_INTRO[id] ?? 999) <= levelId);
  if (!pool.length) return wave;
  const e = pool[Math.floor(rng() * pool.length)];
  const waveBounty = wave.reduce((a, grp) => a + ENEMIES[grp.e].reward * grp.n, 0);
  const n = Math.max(2, Math.min(8, Math.ceil(waveBounty * 0.12 / ENEMIES[e].reward)));
  const times = wave.flatMap(grp => Array.from({ length: grp.n }, (_, k) => grp.d + k * grp.iv));
  const d = (Math.min(...times) + Math.max(...times)) / 2;
  const paths = [...new Set(wave.map(grp => grp.p || 0))];
  const p = paths[Math.floor(rng() * paths.length)];
  return [...wave, { e, n, iv: 0.9, d, p }];
}
{
  let checked = 0;
  for (const lv of LEVELS) {
    for (let i = 0; i < lv.waves.length; i++) {
      const a = decorateWave(lv.waves, lv.waveShapes, lv.id, 3, i);
      const b = decorateWave(lv.waves, lv.waveShapes, lv.id, 3, i);
      check(JSON.stringify(a) === JSON.stringify(b), `L${lv.id} wave ${i}: decorateWave is deterministic (Hard, same seed twice)`);
      checked++;
    }
  }
  check(checked > 100, `sanity: exercised every wave of every level (${checked})`);
}
{
  // wave 1, boss waves, and shaped waves are NEVER decorated — even on Brutal
  const lv = LEVELS.find(l => l.id === 5)!; // has a boss wave (mothership) at the end
  const bossIdx = lv.waves.length - 1;
  check(JSON.stringify(decorateWave(lv.waves, lv.waveShapes, lv.id, 4, 0)) === JSON.stringify(lv.waves[0]), 'wave 1 is never decorated, even on Brutal');
  check(JSON.stringify(decorateWave(lv.waves, lv.waveShapes, lv.id, 4, bossIdx)) === JSON.stringify(lv.waves[bossIdx]), 'a boss wave is never decorated');
  const lv13 = LEVELS.find(l => l.id === 13)!;
  const shapedIdx = Object.keys(lv13.waveShapes || {}).map(Number)[0];
  check(JSON.stringify(decorateWave(lv13.waves, lv13.waveShapes, lv13.id, 4, shapedIdx)) === JSON.stringify(lv13.waves[shapedIdx]), 'a shaped wave is never also decorated');
}
{
  // below Hard, decoration is a pure no-op regardless of wave index
  const lv = LEVELS.find(l => l.id === 3)!;
  for (let i = 1; i < lv.waves.length - 1; i++) {
    check(JSON.stringify(decorateWave(lv.waves, lv.waveShapes, lv.id, 2, i)) === JSON.stringify(lv.waves[i]), `L3 wave ${i}: no decoration below Hard (diffTier 2)`);
  }
}
{
  // when decoration DOES apply, the injected group is well-formed
  const lv = LEVELS.find(l => l.id === 8)!;
  let sawInjection = false;
  for (let i = 1; i < lv.waves.length - 1; i++) {
    const decorated = decorateWave(lv.waves, lv.waveShapes, lv.id, 3, i);
    if (!decorated || decorated.length === lv.waves[i].length) continue;
    sawInjection = true;
    const injected = decorated[decorated.length - 1];
    check(!ENEMIES[injected.e].boss, `L8 wave ${i}: injected enemy '${injected.e}' is never a boss`);
    check(ENEMY_INTRO[injected.e] <= lv.id, `L8 wave ${i}: injected enemy '${injected.e}' has already been introduced by level ${lv.id}`);
    check(!lv.waves[i].some(grp => grp.e === injected.e), `L8 wave ${i}: injected enemy '${injected.e}' wasn't already in the wave`);
    check(injected.n >= 2 && injected.n <= 8, `L8 wave ${i}: injected count clamped to [2,8], got ${injected.n}`);
  }
  check(sawInjection, 'at least one L8 wave actually got a Hard+ injection (sanity the test isn\'t vacuous)');
}

console.log(fails ? `${fails} FAILURES` : `daily-op: all checks passed (${dates.length} dates x2 determinism + streak-across-dates logic + decorateWave determinism)`);
process.exit(fails ? 1 : 0);
