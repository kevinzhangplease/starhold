// Phase 8 — Replayability: Draft & Doctrines. Gating, sizeByLevel mapping, the Suggested/
// Daily draft algorithms, and doctrine effect math, against the REAL data.ts tables.
// suggestedDraft/dailyDraft themselves live in ui.ts, which (like game.ts) pulls in DOM/audio
// code that can't run under plain Node — matching the established pattern (see
// tests/wave-shapes.ts, tests/cell-seeding.ts), this is a faithful reimplementation of the
// exact same algorithms against the same real, directly-importable data.
// Run: node --experimental-strip-types tests/draft-doctrines.ts
import { UNLOCKS, TUNING, DOCTRINES, TOWERS, ENEMIES, airClass, roleChips, draftSizeForLevel } from '../src/data.ts';
import { LEVELS } from '../src/levels.ts';
import { mulberry32, hashString } from '../src/rng.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

// ---------- 8.2 gating ----------
check(UNLOCKS.draft === 6, `draft unlocks at level 6, got ${UNLOCKS.draft}`);
check(UNLOCKS.doctrines === 10, `doctrines unlock at level 10, got ${UNLOCKS.doctrines}`);

// ---------- 8.2.2 sizeByLevel mapping ----------
check(draftSizeForLevel(1) === 5, `L1 drafts 5, got ${draftSizeForLevel(1)}`);
check(draftSizeForLevel(4) === 5, `L4 drafts 5, got ${draftSizeForLevel(4)}`);
check(draftSizeForLevel(5) === 6, `L5 drafts 6, got ${draftSizeForLevel(5)}`);
check(draftSizeForLevel(8) === 6, `L8 drafts 6, got ${draftSizeForLevel(8)}`);
check(draftSizeForLevel(9) === 7, `L9 drafts 7, got ${draftSizeForLevel(9)}`);
check(draftSizeForLevel(12) === 7, `L12 drafts 7, got ${draftSizeForLevel(12)}`);
check(draftSizeForLevel(13) === 8, `L13 drafts 8, got ${draftSizeForLevel(13)}`);
check(draftSizeForLevel(15) === 8, `L15 drafts 8, got ${draftSizeForLevel(15)}`);
{
  // the size never shrinks as the campaign advances
  let prev = 0;
  for (let id = 1; id <= 15; id++) {
    const size = draftSizeForLevel(id);
    check(size >= prev, `draft size must not shrink from L${id - 1} to L${id}`);
    prev = size;
  }
}

// ---------- 8.2.4 Suggested draft (mirrors ui.ts's suggestedDraft exactly) ----------
function levelEnemyIds(waves: { e: string; n: number }[][]): Set<string> {
  const ids = new Set<string>();
  for (const wave of waves) for (const grp of wave) ids.add(grp.e);
  return ids;
}
function suggestedDraft(level: (typeof LEVELS)[0], size: number, towersBuilt: Record<string, number>): string[] {
  const picks: string[] = [];
  const add = (id: string) => { if (!picks.includes(id) && picks.length < size) picks.push(id); };
  const enemyIds = levelEnemyIds(level.waves);
  const anyFlying = [...enemyIds].some(id => ENEMIES[id]?.flying);
  const swarmCount = level.waves.flat().filter(g => g.e === 'swarmling' || g.e === 'splitter').reduce((a, g) => a + g.n, 0);
  if (anyFlying) {
    const air = TOWERS.find(t => airClass(t) === 'air-bonus') || TOWERS.find(t => airClass(t) !== 'no-air');
    if (air) add(air.id);
  }
  if (swarmCount >= 15) {
    const splash = TOWERS.find(t => { const rc = roleChips(t); return rc.role === 'splash' || rc.role === 'chain'; });
    if (splash) add(splash.id);
  }
  if (level.newEnemy) for (const cid of ENEMIES[level.newEnemy.id]?.counters || []) add(cid);
  if (picks.length < size) {
    const byComfort = [...TOWERS].sort((a, b) => (towersBuilt[b.id] || 0) - (towersBuilt[a.id] || 0));
    for (const t of byComfort) { if (picks.length >= size) break; add(t.id); }
  }
  return picks.slice(0, size);
}

{
  // L4 (High Wind): wisps debut (flying) -> must include an air-capable tower
  const l4 = LEVELS.find(l => l.id === 4)!;
  const draft = suggestedDraft(l4, draftSizeForLevel(4), {});
  check(draft.some(id => airClass(TOWERS.find(t => t.id === id)!) !== 'no-air'), 'L4 suggested draft includes an air-capable tower');
}
{
  // L8 (The Coil): mender debuts -> its counters (sentinel, prism) must both be included
  const l8 = LEVELS.find(l => l.id === 8)!;
  const draft = suggestedDraft(l8, draftSizeForLevel(8), {});
  for (const cid of ENEMIES.mender.counters || []) check(draft.includes(cid), `L8 suggested draft must-include '${cid}' (mender counter)`);
}
{
  // no must-includes and no history -> comfort-fill still returns exactly `size` distinct towers
  const l1 = LEVELS.find(l => l.id === 1)!;
  const draft = suggestedDraft(l1, 5, {});
  check(draft.length === 5, `comfort-fill pads to the requested size, got ${draft.length}`);
  check(new Set(draft).size === 5, 'comfort-fill never duplicates a tower');
}
{
  // comfort picks favor the player's most-built towers when nothing else demands a slot
  const l1 = LEVELS.find(l => l.id === 1)!;
  const draft = suggestedDraft(l1, 3, { sentinel: 40, pulse: 2 });
  check(draft[0] === 'sentinel', `most-built tower is the first comfort pick, got ${draft[0]}`);
}

// ---------- 8.2.7 Daily draft: seeded, forced, deterministic ----------
function dailyDraft(dateStr: string, size: number): string[] {
  const rng = mulberry32(hashString(`${dateStr}-draft`));
  const pool = TOWERS.map(t => t.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picks = pool.slice(0, size);
  const hasAir = picks.some(id => airClass(TOWERS.find(t => t.id === id)!) !== 'no-air');
  if (!hasAir) {
    const air = TOWERS.find(t => airClass(t) !== 'no-air' && !picks.includes(t.id));
    if (air) picks[picks.length - 1] = air.id;
  }
  const hasSplash = picks.some(id => { const rc = roleChips(TOWERS.find(t => t.id === id)!); return rc.role === 'splash' || rc.role === 'chain'; });
  if (!hasSplash) {
    const splash = TOWERS.find(t => { const rc = roleChips(t); return (rc.role === 'splash' || rc.role === 'chain') && !picks.includes(t.id); });
    if (splash) picks[picks.length - 2 >= 0 ? picks.length - 2 : 0] = splash.id;
  }
  return picks;
}
{
  const a = dailyDraft('2026-07-14', 6);
  const b = dailyDraft('2026-07-14', 6);
  check(JSON.stringify(a) === JSON.stringify(b), 'same date -> identical forced draft, twice');
  const c = dailyDraft('2026-07-15', 6);
  check(JSON.stringify(a) !== JSON.stringify(c), 'different dates produce different drafts (sanity, not a hard guarantee)');
  check(a.length === 6 && new Set(a).size === 6, 'daily draft has exactly `size` distinct towers');
  check(a.some(id => airClass(TOWERS.find(t => t.id === id)!) !== 'no-air'), 'daily draft always guarantees an air-capable pick');
  check(a.some(id => { const rc = roleChips(TOWERS.find(t => t.id === id)!); return rc.role === 'splash' || rc.role === 'chain'; }), 'daily draft always guarantees a splash/chain pick');
}
{
  // sweep a year of dates at every campaign draft size — the re-roll guarantees must never fail
  for (let day = 1; day <= 365; day += 17) {
    const dateStr = `2026-${String(1 + (day % 12)).padStart(2, '0')}-${String(1 + (day % 28)).padStart(2, '0')}`;
    for (const size of [5, 6, 7, 8]) {
      const d = dailyDraft(dateStr, size);
      check(d.length === size && new Set(d).size === size, `dailyDraft(${dateStr}, ${size}) has ${size} distinct towers`);
      check(d.some(id => airClass(TOWERS.find(t => t.id === id)!) !== 'no-air'), `dailyDraft(${dateStr}, ${size}) guarantees air coverage`);
    }
  }
}

// ---------- 8.3 Doctrines: data integrity ----------
check(DOCTRINES.length === 3, `exactly 3 doctrines, got ${DOCTRINES.length}`);
for (const d of DOCTRINES) check(d.cost > 0, `doctrine '${d.id}' has a positive star cost`);
check(new Set(DOCTRINES.map(d => d.id)).size === DOCTRINES.length, 'doctrine ids are unique');

// Exclusivity: activating a new doctrine always replaces the previous one — the save shape
// (`active: string | null`) makes two-active-at-once structurally impossible, but replicate
// the exact assignment ui.ts performs to document/lock that invariant.
function activateDoctrine(save: { active: string | null }, id: string) { save.active = id; }
{
  const save = { active: 'artillery' as string | null };
  activateDoctrine(save, 'precision');
  check(save.active === 'precision', 'activating a new doctrine replaces the previously active one');
}

// ---------- 8.3.4 doctrine effect math (mirrors Tower.stats() exactly) ----------
const A = TUNING.doctrines.artillery, P = TUNING.doctrines.precision, L = TUNING.doctrines.logistics;
check(A.splashRadiusMul > 1 && A.splashDmgMul > 1, 'artillery is a genuine splash buff, not a no-op');
check(P.critAdd > 0, 'precision crit bonus is a genuine buff');
check(L.startCreditMul > 1 && L.dropIntervalMul < 1, 'logistics gives more credits and faster drops');
{
  // artillery only touches splash-carrying kinds (mortar/missile), never others
  function artilleryDmgMul(kind: string, doctrine: string | null) {
    const artillery = doctrine === 'artillery' && (kind === 'mortar' || kind === 'missile');
    return artillery ? A.splashDmgMul : 1;
  }
  check(artilleryDmgMul('mortar', 'artillery') === A.splashDmgMul, 'artillery boosts mortar damage');
  check(artilleryDmgMul('missile', 'artillery') === A.splashDmgMul, 'artillery boosts missile damage');
  check(artilleryDmgMul('bullet', 'artillery') === 1, 'artillery does not touch non-splash towers');
  check(artilleryDmgMul('mortar', 'precision') === 1, 'artillery math is inert when a different doctrine is active');
  check(artilleryDmgMul('mortar', null) === 1, 'artillery math is inert with no doctrine active');
}
{
  function precisionCritAdd(kind: string, doctrine: string | null) {
    return doctrine === 'precision' && kind !== 'prism' && kind !== 'amp' ? P.critAdd : 0;
  }
  check(precisionCritAdd('bullet', 'precision') === P.critAdd, 'precision adds crit to a normal firing tower');
  check(precisionCritAdd('ray', 'precision') === P.critAdd, 'precision adds crit to Ray (which already rolls crit generically via s.crit)');
  check(precisionCritAdd('prism', 'precision') === 0, 'precision explicitly excludes Prism');
  check(precisionCritAdd('amp', 'precision') === 0, 'precision explicitly excludes Amp');
  check(precisionCritAdd('bullet', 'artillery') === 0, 'precision math is inert when a different doctrine is active');
}
{
  const creditsAt = (doctrine: string | null, base: number) => Math.round(base * (doctrine === 'logistics' ? L.startCreditMul : 1));
  check(creditsAt('logistics', 260) === Math.round(260 * L.startCreditMul), 'logistics scales starting credits by startCreditMul');
  check(creditsAt(null, 260) === 260, 'no doctrine -> no starting-credit change');
  const dropIntervalAt = (doctrine: string | null, base: number) => base * (doctrine === 'logistics' ? L.dropIntervalMul : 1);
  check(dropIntervalAt('logistics', 25) < 25, 'logistics shortens the drop-interval roll');
  check(dropIntervalAt('artillery', 25) === 25, 'drop interval is untouched by a non-logistics doctrine');
}

console.log(fails ? `${fails} FAILURES` : 'draft/doctrines: all checks passed');
process.exit(fails ? 1 : 0);
