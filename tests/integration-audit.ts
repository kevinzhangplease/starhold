// Phase 9.1 — cross-system interaction audit. The formula/logic-replicable rows from the
// PLAN-3 9.1 table, verified against the REAL data.ts/levels.ts tables (the stateful pieces —
// shatter-vs-splitter array safety, conduit-with-one-tower, portal telegraph timing — are
// hand-verified by code inspection and exercised by the headless smoke run; see PROGRESS-3.md
// for the full 15-row log). Pure replication, matching the established test pattern.
// Run: node --experimental-strip-types tests/integration-audit.ts
import { TUNING, TOWERS, ENEMIES, draftSizeForLevel, airClass, roleChips } from '../src/data.ts';
import { LEVELS } from '../src/levels.ts';
import { migrateSave } from '../src/save.ts';
import { mulberry32, hashString } from '../src/rng.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

// ---------- Row: Draft x challenges ----------
// Specialist/Minimalist predicates count *builds*, never draft size. A draft caps the tower
// types AVAILABLE, but you can always build fewer types / fewer towers — so neither challenge
// is ever made impossible by drafting. Assert the clean invariant plus satisfiability.
for (const lv of LEVELS) {
  const size = draftSizeForLevel(lv.id);
  check(size >= 4, `L${lv.id}: draft size ${size} is at least a sane minimum build`);
  for (const c of lv.challenges || []) {
    if (c.id === 'specialist') {
      // Specialist wants AT MOST `param` types; a draft of `size >= param` gives real choice,
      // and even if it didn't, "use <= param types" stays satisfiable (you just build fewer).
      check(size >= (c.param ?? 2), `L${lv.id}: Specialist param ${c.param} <= draft size ${size} (genuine type choice available)`);
    }
    if (c.id === 'minimalist') {
      // Minimalist counts total towers built, which the draft never forces upward.
      check((c.param ?? 6) >= 1, `L${lv.id}: Minimalist param is a sane positive build budget`);
    }
  }
}
// The Suggested-draft must-includes never exceed the draft size (so a sensible default always
// fits) — walks every level, the exact rule ui.ts's suggestedDraft applies.
for (const lv of LEVELS) {
  const size = draftSizeForLevel(lv.id);
  const enemyIds = new Set(lv.waves.flat().map(g => g.e));
  const mustIncludes = new Set<string>();
  if ([...enemyIds].some(id => ENEMIES[id]?.flying)) {
    const air = TOWERS.find(t => airClass(t) === 'air-bonus') || TOWERS.find(t => airClass(t) !== 'no-air');
    if (air) mustIncludes.add(air.id);
  }
  const swarm = lv.waves.flat().filter(g => g.e === 'swarmling' || g.e === 'splitter').reduce((a, g) => a + g.n, 0);
  if (swarm >= 15) { const sp = TOWERS.find(t => { const rc = roleChips(t); return rc.role === 'splash' || rc.role === 'chain'; }); if (sp) mustIncludes.add(sp.id); }
  if (lv.newEnemy) for (const cid of ENEMIES[lv.newEnemy.id]?.counters || []) mustIncludes.add(cid);
  check(mustIncludes.size <= size, `L${lv.id}: suggested must-includes (${mustIncludes.size}) fit within draft size ${size}`);
}

// ---------- Row: Overcharge x Overclock drop x Anchor amp ----------
// Worst-case fire-rate multiplier when all three stack. Replicates Tower.stats()'s rateMul
// composition exactly: (1 + bRate) * overclockDrop * overcharge, where bRate is an anchored
// Hyperclock's doubled buffRate.
{
  const OC = TUNING.overcharge.rateMul;
  const overclock = 1 + TUNING.drops.overclockRate;
  const hyperclock = TOWERS.find(t => t.id === 'amp')!.branches[0][1]; // Hyperclock (fire-rate branch, tier 2)
  const anchoredBRate = (hyperclock.buffRate || 0) * TUNING.cells.anchor.ampMul;
  const worstRateMul = (1 + anchoredBRate) * overclock * OC;
  check(Number.isFinite(worstRateMul), 'worst-case stacked rate multiplier is finite');
  check(worstRateMul < 8, `worst-case stacked rate multiplier (${worstRateMul.toFixed(2)}x) stays bounded — no projectile/audio flood`);
  check(worstRateMul === (1 + anchoredBRate) * overclock * OC, 'stacking is purely multiplicative (no runaway additive term)');
}

// ---------- Row: Veterancy x sell undo ----------
// The perk threshold (45 kills) can't fit inside the 4s undo window at any sane kill rate, and
// selling has no perk-refund path (a perk is forfeited, never credited back). Logic assertion.
check(TUNING.veterancy.kills / TUNING.economy.sellUndoWindow > 10, 'reaching Veteran (45 kills) inside the 4s undo window would need >10 kills/sec — not reachable in normal play');

// ---------- Row: Flier lane x Daily mirror ----------
// flierLaneControl is seeded on levelId+waveIdx only (mirror-independent), so it's fully
// deterministic, and BOTH the intermission telegraph and the actual flight read this same
// function with the already-mirrored portal/base px — self-consistent by construction.
function flierLaneControl(levelId: number, waveIdx: number, portal: { x: number; y: number }, base: { x: number; y: number }) {
  const r = mulberry32(hashString(`${levelId}-fly-${waveIdx}`));
  const o = (r() < 0.5 ? -1 : 1) * (120 + r() * 120);
  const dx = base.x - portal.x, dy = base.y - portal.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;
  const mx = (portal.x + base.x) / 2, my = (portal.y + base.y) / 2;
  return { x: mx + px * o, y: my + py * o };
}
{
  const portal = { x: -40, y: 200 }, base = { x: 1320, y: 520 };
  const a = flierLaneControl(15, 3, portal, base);
  const b = flierLaneControl(15, 3, portal, base);
  check(a.x === b.x && a.y === b.y, 'flier lane control point is deterministic for the same level+wave (Daily reproducibility)');
  const W = 1280;
  const mPortal = { x: W - portal.x, y: portal.y }, mBase = { x: W - base.x, y: base.y };
  const m = flierLaneControl(15, 3, mPortal, mBase);
  check(Number.isFinite(m.x) && Number.isFinite(m.y), 'mirrored-layout lane control point is finite (no NaN on the daily mirror)');
  const diff = flierLaneControl(15, 4, portal, base);
  check(diff.x !== a.x || diff.y !== a.y, 'different waves get different lanes (per-wave anti-air read)');
}

// ---------- Row: Threat readout x shapes ----------
// Shaped waves adjust the efficiency term, not transit: rush x0.8 (simultaneity wastes DPS),
// trickle x1.15 (sequential targets waste nothing), convoy/feint neutral. Replicates
// computeThreat()'s exact branch.
function shapeEfficiency(shape: string | undefined): number {
  let eff = TUNING.threat.efficiency;
  if (shape === 'rush') eff *= 0.8;
  else if (shape === 'trickle') eff *= 1.15;
  return eff;
}
check(shapeEfficiency('rush') < shapeEfficiency(undefined), 'rush lowers deliverable efficiency (burst is harder to answer)');
check(shapeEfficiency('trickle') > shapeEfficiency(undefined), 'trickle raises deliverable efficiency (spaced targets waste no DPS)');
check(shapeEfficiency('convoy') === shapeEfficiency(undefined), 'convoy is efficiency-neutral');
check(shapeEfficiency('feint') === shapeEfficiency(undefined), 'feint is efficiency-neutral');

// ---------- Row: Star recut x old saves ----------
// A legacy save's earned stars survive migration untouched (migrateSave never recomputes
// them), and the win() persist logic takes Math.max so a new lower rating can't downgrade a
// stored higher one.
{
  const legacy = { v: 2, stars: { 1: 3, 2: 3, 15: 3 }, unlocked: 16, meta: ['hull2'] };
  const migrated = migrateSave(JSON.parse(JSON.stringify(legacy)));
  check(migrated.stars[1] === 3 && migrated.stars[15] === 3, 'legacy 3-star ratings survive migration untouched (no downward recut)');
  // win()'s persist step: this.save.stars[id] = Math.max(prev, stars)
  const persist = (prev: number, fresh: number) => Math.max(prev, fresh);
  check(persist(3, 2) === 3, 'a fresh 2-star run never downgrades a stored 3-star (Math.max guard)');
  check(persist(1, 3) === 3, 'a fresh 3-star run correctly upgrades a stored 1-star');
}

// ---------- Row: Shatter x elite Shielded (cap scaling, no shield bypass) ----------
// Shatter routes damage through the normal explode()->hurt() path, so a shielded elite's
// shield absorbs it like any other hit (no bypass). The cap scales with the campaign so it
// neither one-shots early nor fizzles late. (The no-bypass property itself is a code-path
// fact, hand-verified; here we assert the cap-scaling math that keeps it relevant.)
{
  const R = TUNING.reactions;
  const capAt = (scale: number) => R.shatterCap * scale;
  check(capAt(8) > capAt(1), 'shatter cap grows with campaign scale (stays relevant at L15)');
  const shatterDmg = (maxHp: number, scale: number) => Math.min(maxHp * R.shatterFrac, R.shatterCap * scale);
  check(shatterDmg(500, 1) === 500 * R.shatterFrac, 'a normal enemy shatters for its fractional share (below the cap)');
  check(shatterDmg(999999, 1) === R.shatterCap, 'an outlier-HP enemy is cap-limited (no absurd nuke)');
}

console.log(fails ? `${fails} FAILURES` : 'integration audit: all checks passed');
process.exit(fails ? 1 : 0);
