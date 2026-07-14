// Run with: node --experimental-strip-types validate.ts
import { LEVELS } from './src/levels.ts';
import { ENEMIES, TOWERS, META, UNLOCKS, TUNING, fmt, MUTATORS, MODIFIER_INFO, CELL_TYPES, ZONES, CHALLENGE_POOL, LANDMARKS, PALETTE, ENEMY_INTRO, WAVE_SHAPES, DOCTRINES, draftSizeForLevel } from './src/data.ts';
import { RESUME_VERSION } from './src/resume.ts';
import { mulberry32, hashString, seededInt, seededPick } from './src/rng.ts';
// computeDailyOp itself lives in daily.ts, but daily.ts internally imports from './rng' and
// './data' WITHOUT extensions (required for the app's own tsc/Vite build — adding extensions
// there breaks `npm run build`). Node's strict ESM resolver can't follow those extensionless
// specifiers when executing a .ts file directly, so daily.ts can't be imported transitively
// here. Instead, this reimplements its (short, stable) orchestration using the SAME real,
// directly-imported primitives (mulberry32/hashString/seededInt/seededPick/MODIFIER_INFO) —
// both leaf modules with no internal imports, so they resolve fine — giving full fidelity to
// the actual production RNG behavior while only duplicating ~10 lines of glue logic.
function computeDailyOp(dateStr: string, eligibleLevelIds: number[]) {
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
  return { dateStr, levelId, modifiers, mutatorBonus: 0.25, difficulty: 3 };
}
import { SEEN_UNLOCK_LEVELS, migrateSave, defaultSave } from './src/save.ts';

let errors = 0;
const err = (m: string) => { console.error('✗ ' + m); errors++; };

// 1. every wave references a real enemy; every path is in-bounds and long enough
for (const lv of LEVELS) {
  for (const [wi, wave] of lv.waves.entries()) {
    for (const grp of wave) {
      if (!ENEMIES[grp.e]) err(`Level ${lv.id} wave ${wi + 1}: unknown enemy '${grp.e}'`);
      if (grp.p !== undefined && grp.p >= lv.paths.length) err(`Level ${lv.id} wave ${wi + 1}: path index ${grp.p} out of range`);
    }
  }
  for (const [pi, path] of lv.paths.entries()) {
    if (path.length < 2) err(`Level ${lv.id} path ${pi}: too few waypoints`);
    let len = 0;
    for (let i = 0; i < path.length - 1; i++) {
      len += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
      const [x, y] = path[i];
      if (i > 0 && (x < -50 || x > 1330 || y < 60 || y > 680)) err(`Level ${lv.id} path ${pi} waypoint ${i} out of playfield: ${x},${y}`);
    }
    if (len < 700) err(`Level ${lv.id} path ${pi}: suspiciously short (${Math.round(len)}px)`);
    if (path[0][0] > 0) err(`Level ${lv.id} path ${pi}: should start off-screen left`);
    if (path[path.length - 1][0] < 1280) err(`Level ${lv.id} path ${pi}: should end off-screen right`);
  }
  if (!lv.waves.length) console.warn(`  (level ${lv.id} has no waves — endless only)`);
}

// 2. enemy splits/minions reference real enemies
for (const e of Object.values(ENEMIES)) {
  if (e.splits && !ENEMIES[e.splits.id]) err(`Enemy ${e.id}: splits into unknown '${e.splits.id}'`);
  if (e.spawnMinion && !ENEMIES[e.spawnMinion.id]) err(`Enemy ${e.id}: spawns unknown '${e.spawnMinion.id}'`);
}

// 3. towers: 3 stages + 2 branches of 2 each, costs positive
for (const t of TOWERS) {
  if (t.stages.length !== 3) err(`Tower ${t.id}: expected 3 stages`);
  if (t.branches.length !== 3 || t.branches.some(b => b.length !== 2)) err(`Tower ${t.id}: expected 3 branches × 2 stages`);
  for (const s of [...t.stages, ...t.branches.flat()]) {
    if (!(s.cost > 0)) err(`Tower ${t.id} stage ${s.name}: bad cost`);
    if (!(s.range > 0)) err(`Tower ${t.id} stage ${s.name}: bad range`);
  }
}

// 3b. Sentinel must be the most expensive BASE tower — range solves coverage AND uptime
// simultaneously, so it carries the price tag (Phase 4.1).
{
  const baseCosts = TOWERS.map(t => ({ id: t.id, cost: t.stages[0].cost }));
  const maxCost = Math.max(...baseCosts.map(b => b.cost));
  const sentinel = baseCosts.find(b => b.id === 'sentinel')!;
  if (sentinel.cost !== maxCost) err(`Sentinel should be the priciest base tower (${sentinel.cost}), but found ${maxCost}`);
}

// 4. meta requirements resolve
for (const m of META) {
  if (m.requires && !META.find(x => x.id === m.requires)) err(`Meta ${m.id}: unknown requirement`);
}

// 5. rough campaign economy sanity: income per level vs a reasonable defense cost
for (const lv of LEVELS) {
  let income = lv.startCredits;
  for (const [wi, wave] of lv.waves.entries()) {
    income += 30 + wi * 4; // wave-clear bonus
    for (const grp of wave) {
      const spec = ENEMIES[grp.e];
      const rewardMul = 1 + (lv.hpMul - 1) * 0.22;
      income += Math.round(spec.reward * rewardMul) * grp.n;
      if (spec.splits) income += ENEMIES[spec.splits.id].reward * spec.splits.count * grp.n;
    }
  }
  console.log(`Level ${lv.id} (${lv.name}): ~${income} total credits, ${lv.waves.length} waves, hp×${lv.hpMul}`);
}

// ---- Phase 1: unlock gating / tuning / save migration / formatter ----

// (a) UNLOCKS <-> SEEN_UNLOCK_LEVELS sync. Every gated system needs a first-time toast
// flag at the same level, except pure difficulty escalations which have no toast.
const NO_TOAST = new Set(['mutators_hard', 'mod_combo']);
for (const [id, lvl] of Object.entries(UNLOCKS)) {
  if (lvl < 1 || lvl > 15) err(`UNLOCKS['${id}'] level ${lvl} outside 1..15`);
  if (NO_TOAST.has(id)) {
    if (id in SEEN_UNLOCK_LEVELS) err(`'${id}' is no-toast but appears in SEEN_UNLOCK_LEVELS`);
    continue;
  }
  if (!(id in SEEN_UNLOCK_LEVELS)) err(`UNLOCKS['${id}'] missing from SEEN_UNLOCK_LEVELS (save.ts)`);
  else if (SEEN_UNLOCK_LEVELS[id] !== lvl) err(`'${id}' level mismatch: UNLOCKS=${lvl} vs SEEN=${SEEN_UNLOCK_LEVELS[id]}`);
}

// (b) TUNING sanity
if (TUNING.combo.milestones.length !== TUNING.combo.bonuses.length) err('TUNING.combo milestones/bonuses length mismatch');
if (!(TUNING.combo.window > 0)) err('TUNING.combo.window must be > 0');
if (!(TUNING.interest.rate > 0 && TUNING.interest.rate < 1)) err('TUNING.interest.rate out of (0,1)');
if (!(TUNING.interest.cap > 0)) err('TUNING.interest.cap must be > 0');
if (!(TUNING.nova.killsToCharge > 0)) err('TUNING.nova.killsToCharge must be > 0');
if (TUNING.mutators.fromWave < 2) err('TUNING.mutators.fromWave must be >= 2');
{
  const w = TUNING.drops.weights;
  const sum = w.credits + w.recharge + w.overclock + w.hull;
  if (sum !== 100) err(`TUNING.drops.weights must sum to 100 (got ${sum})`);
}

// (c) migrateSave: idempotent, v1 endlessBest relocation, veteran seen pre-marking
const stable = (o: any): string => JSON.stringify(o, (_k, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
{
  // empty object -> defaults; second pass identical
  const a1 = migrateSave({});
  const a2 = migrateSave(JSON.parse(JSON.stringify(a1)));
  if (stable(a1) !== stable(a2)) err('migrateSave not idempotent on {}');

  // realistic v1 veteran save
  const v1 = { stars: { 1: 3, 2: 2, 15: 3 }, unlocked: 16, meta: ['hull1'], endlessBest: 7,
               settings: { master: 0.5, tileSize: 58 } };
  const m1 = migrateSave(v1);
  const m2 = migrateSave(JSON.parse(JSON.stringify(m1)));
  if (stable(m1) !== stable(m2)) err('migrateSave not idempotent on v1 save');
  if (m1.endlessBest[2] !== 7) err(`v1 endlessBest should land at tier 2 (got ${JSON.stringify(m1.endlessBest)})`);
  if (m1.stars[15] !== 3 || m1.unlocked !== 16 || m1.meta[0] !== 'hull1') err('migrateSave lost v1 fields');
  if (m1.settings.master !== 0.5 || m1.settings.tileSize !== 58) err('migrateSave lost v1 settings');
  if (m1.settings.pauseOnBuild !== true || m1.settings.meander !== 0) err('migrateSave missing new setting defaults');
  for (const key of ['combo', 'interest', 'nova', 'mod_ionstorms']) {
    if (!m1.seen[key]) err(`veteran save (unlocked 16) should pre-mark seen['${key}']`);
  }

  // low-progress save must NOT be pre-marked
  const fresh = migrateSave({ unlocked: 1, endlessBest: 0 });
  if (Object.keys(fresh.seen).length !== 0) err('fresh save should have no pre-marked seen flags');
  const mid = migrateSave({ unlocked: 5, endlessBest: 0 });
  if (!mid.seen['drops'] || mid.seen['nova']) err('unlocked=5 save should pre-mark drops but not nova');

  // migrating an already-default save changes nothing
  const d1 = defaultSave();
  if (stable(migrateSave(JSON.parse(JSON.stringify(d1)))) !== stable(migrateSave(migrateSave(JSON.parse(JSON.stringify(d1)))))) {
    err('migrateSave not stable on defaultSave');
  }
}

// ---- Phase 3: modifiers / mutators / counters ----

// level modifier ids must exist, with gates registered in UNLOCKS
for (const lv of LEVELS) {
  for (const m of lv.modifiers || []) {
    const info = MODIFIER_INFO[m];
    if (!info) { err(`Level ${lv.id} references unknown modifier '${m}'`); continue; }
    if (!(info.gate in UNLOCKS)) err(`Modifier '${m}' gate '${info.gate}' missing from UNLOCKS`);
    if (lv.id < UNLOCKS[info.gate]) err(`Level ${lv.id} uses '${m}' before its unlock level ${UNLOCKS[info.gate]}`);
  }
}
// assignment sanity per plan: L4/6/8/10/12/13/14/15 carry modifiers, L1-3/5/7/9/11 do not
for (const lv of LEVELS) {
  const expectMods = [4, 6, 8, 10, 12, 13, 14, 15].includes(lv.id);
  const has = (lv.modifiers || []).length > 0;
  if (expectMods !== has) err(`Level ${lv.id}: modifier presence mismatch (expected ${expectMods})`);
}

// every enemy has at least one valid counter; counters reference real towers
const towerIds = new Set(TOWERS.map(t => t.id));
for (const spec of Object.values(ENEMIES)) {
  if (!spec.counters || spec.counters.length === 0) { err(`Enemy '${spec.id}' has no counters`); continue; }
  for (const c of spec.counters) if (!towerIds.has(c)) err(`Enemy '${spec.id}' counter '${c}' is not a tower id`);
}

// mutator table sanity
{
  const ids = Object.keys(MUTATORS);
  if (ids.length < 6) err(`Expected 6 mutators, got ${ids.length}`);
  const hard = ids.filter(i => MUTATORS[i].hard);
  if (hard.length !== 2) err(`Expected exactly 2 hard mutators (got ${hard.join(',')})`);
  if (!('mutators_hard' in UNLOCKS)) err(`'mutators_hard' gate missing from UNLOCKS`);
  for (const m of Object.values(MUTATORS)) {
    if (!m.icon || !m.name || !m.blurb) err(`Mutator '${m.id}' missing display fields`);
  }
}

// ---- Phase 4: spectacle sanity ----

// boss_theater / boss_phase2 gates registered
for (const g of ['boss_theater', 'boss_phase2']) {
  if (!(g in UNLOCKS)) err(`'${g}' gate missing from UNLOCKS`);
}
if (!('nova' in UNLOCKS)) err(`'nova' gate missing from UNLOCKS`);

// NOVA tuning sanity
if (!(TUNING.nova.killsToCharge > 0)) err('TUNING.nova.killsToCharge must be > 0');
// Phase 1 (3.0): rechargeGrowth dropped from 1.4 to 1.0 (the use-count cap is designated as
// the fallback if NOVA spam is found in balance testing — see PLAN-3.md 1.8.3). 1.0 is the
// valid "no growth" neutral value; the field/code path stay so it remains a tuning lever.
if (!(TUNING.nova.rechargeGrowth >= 1)) err('TUNING.nova.rechargeGrowth must be >= 1 (recharge should never get easier)');
if (!(TUNING.nova.buildup > 0 && TUNING.nova.buildup < 3)) err('TUNING.nova.buildup should be a short buildup (0-3s)');
if (!(TUNING.nova.fracNormal > 0 && TUNING.nova.fracNormal <= 1)) err('TUNING.nova.fracNormal out of (0,1]');
if (!(TUNING.nova.fracBoss > 0 && TUNING.nova.fracBoss <= 1)) err('TUNING.nova.fracBoss out of (0,1]');

// every boss enemy exists and is referenced by exactly the three named zone finales
{
  const bosses = Object.values(ENEMIES).filter(e => e.boss);
  if (bosses.length !== 3) err(`Expected 3 bosses, found ${bosses.length}`);
  for (const id of ['mothership', 'colossus', 'leviathan']) {
    if (!ENEMIES[id]) err(`Expected boss enemy '${id}' to exist`);
    else if (!ENEMIES[id].boss) err(`Enemy '${id}' should have boss:true`);
  }
}

// ---- Phase 5: challenges / zone flavor / guide keys / progression smoothing ----

// every level L2-L15 has exactly 2 challenges, valid ids, no duplicate id within a level
for (const lv of LEVELS) {
  if (lv.id < 2) {
    if (lv.challenges?.length) err(`Level ${lv.id} should have no challenges (gate is L2+)`);
    continue;
  }
  const chs = lv.challenges || [];
  if (chs.length !== 2) err(`Level ${lv.id} has ${chs.length} challenges, expected exactly 2`);
  const seen = new Set<string>();
  for (const c of chs) {
    if (!CHALLENGE_POOL[c.id]) err(`Level ${lv.id} references unknown challenge '${c.id}'`);
    if (seen.has(c.id)) err(`Level ${lv.id} has duplicate challenge '${c.id}'`);
    seen.add(c.id);
    if (c.param !== undefined && (!Number.isInteger(c.param) || c.param < 1)) err(`Level ${lv.id} challenge '${c.id}' has invalid param ${c.param}`);
  }
}
// 28 total challenge instances expected (14 levels x 2)
{
  const total = LEVELS.filter(l => l.id >= 2).reduce((a, l) => a + (l.challenges?.length || 0), 0);
  if (total !== 28) err(`Expected 28 total challenge instances across L2-L15, got ${total}`);
}

// zone taglines present and non-trivial
if (ZONES.length !== 3) err(`Expected 3 zones, got ${ZONES.length}`);
for (const z of ZONES) {
  if (!z.tagline || z.tagline.length < 10) err(`Zone '${z.name}' missing/too-short tagline`);
}
// zone_N seen-keys should align with each zone's first level (1, 6, 11)
{
  const starts = [1, 6, 11];
  for (let i = 0; i < 3; i++) {
    const key = `zone_${i + 1}`;
    if (SEEN_UNLOCK_LEVELS[key] !== starts[i]) err(`SEEN_UNLOCK_LEVELS['${key}'] should be ${starts[i]}, got ${SEEN_UNLOCK_LEVELS[key]}`);
  }
}
// guide_* keys present at level 1
for (const key of ['guide_build', 'guide_confirm', 'guide_launch']) {
  if (SEEN_UNLOCK_LEVELS[key] !== 1) err(`SEEN_UNLOCK_LEVELS['${key}'] should be 1, got ${SEEN_UNLOCK_LEVELS[key]}`);
}

// progression smoothing sanity
if (!(TUNING.smoothing.earlyLevels > 0 && TUNING.smoothing.earlyLevels < 1)) err('TUNING.smoothing.earlyLevels should be in (0,1)');
if (!(TUNING.smoothing.compensationMax > 1)) err('TUNING.smoothing.compensationMax should be > 1');
if (!(TUNING.smoothing.compensationFrom < TUNING.smoothing.compensationFull)) err('TUNING.smoothing.compensationFrom should be < compensationFull');

// ---- Phase 8: final balance sweep, difficulty x ascension grid ----
// Prints the effective HP multiplier, starting credits, and interest cap across every
// difficulty tier and ascension tier, for three representative levels (early/mid/late
// campaign). This is the deliverable PLAN.md calls for ("final TUNING table in PROGRESS.md")
// — captured into PROGRESS.md verbatim by the phase that runs this.
{
  const DIFF_HP = [0.7, 0.85, 1, 1.25, 1.55];
  const DIFF_NAMES = ['Relaxed', 'Easy', 'Normal', 'Hard', 'Brutal'];
  const SM = TUNING.smoothing;
  const AS = TUNING.ascension;

  function progressionMul(levelId: number): number {
    if (levelId <= 2) return SM.earlyLevels;
    if (levelId >= SM.compensationFrom) {
      const t = Math.min(1, Math.max(0, (levelId - SM.compensationFrom) / (SM.compensationFull - SM.compensationFrom)));
      return 1 + (SM.compensationMax - 1) * t;
    }
    return 1;
  }
  function effectiveHpMul(levelBaseHpMul: number, levelId: number, diffTier: number, ascTier: number): number {
    return levelBaseHpMul * DIFF_HP[diffTier] * progressionMul(levelId) * (ascTier >= 1 ? AS.hpMul : 1);
  }
  function effectiveStartCredits(baseCredits: number, ascTier: number): number {
    return Math.round(baseCredits * (ascTier >= 4 ? AS.startCreditMul : 1));
  }
  function effectiveInterestCap(levelHpMul: number, levelId: number, ascTier: number): number {
    // Mirrors Game.waveRewardMul() at Normal difficulty (diffReward=1, wave 0) for this
    // summary table — the real in-game cap also scales slightly with difficulty tier
    // via diffReward, which this level/ascension-only table doesn't attempt to show.
    const econScale = 1 + (levelHpMul - 1) * TUNING.economy.bountyCoef;
    const scaled = Math.round((TUNING.interest.cap + levelId * 3) * econScale);
    return ascTier >= 4 ? Math.round(scaled * (AS.interestCapTier4 / TUNING.interest.cap)) : scaled;
  }

  const sampleIds = [1, 8, 15];
  console.log('\n---- Balance sweep: difficulty x ascension (levels 1, 8, 15) ----');
  for (const id of sampleIds) {
    const lv = LEVELS.find(l => l.id === id);
    if (!lv) { err(`balance sweep: level ${id} not found`); continue; }
    console.log(`\nLevel ${id} (${lv.name}) — base hpMul ${lv.hpMul}, startCredits ${lv.startCredits}:`);
    for (let diffTier = 0; diffTier < 5; diffTier++) {
      const row: string[] = [];
      for (let ascTier = 0; ascTier <= 5; ascTier++) {
        const hp = effectiveHpMul(lv.hpMul, id, diffTier, ascTier);
        row.push(`A${ascTier}:${hp.toFixed(2)}x`);
      }
      console.log(`  ${DIFF_NAMES[diffTier].padEnd(8)} hpMul  ${row.join('  ')}`);
    }
    // credits/interest only vary by ascension, not difficulty, so print once per level
    const creditRow = [0, 1, 2, 3, 4, 5].map(a => `A${a}:${effectiveStartCredits(lv.startCredits, a)}◆/cap${effectiveInterestCap(lv.hpMul, id, a)}`);
    console.log(`  startCredits/interestCap  ${creditRow.join('  ')}`);
    // sanity bounds: nothing in the grid should be a degenerate cliff
    for (let diffTier = 0; diffTier < 5; diffTier++) {
      for (let ascTier = 0; ascTier <= 5; ascTier++) {
        const hp = effectiveHpMul(lv.hpMul, id, diffTier, ascTier);
        if (hp <= 0) err(`Level ${id} diff=${diffTier} asc=${ascTier}: hpMul is non-positive (${hp})`);
        if (hp > lv.hpMul * 5) err(`Level ${id} diff=${diffTier} asc=${ascTier}: hpMul (${hp.toFixed(2)}) looks like a runaway multiplier`);
      }
    }
    const minCredits = effectiveStartCredits(lv.startCredits, 4);
    if (minCredits < lv.startCredits * 0.5) err(`Level ${id}: Ascension IV starting credits (${minCredits}) cut by more than half — too severe`);
  }
}

// ---- Phase 9.2: economy simulation sweep ----
// Models total earnable credits vs. the firepower-spend a level actually demands, across
// L1/L5/L10/L15 x Normal/Hard/Brutal x Ascension 0/III/V. The goal is a sensitivity check,
// not a precise sim: does the earnable/needed ratio degrade GRACEFULLY as difficulty and
// ascension push enemy HP (raising "needed") and rewards (raising "earnable") by different
// factors? Model assumptions are documented inline; the full matrix is captured verbatim in
// PROGRESS-3.md. This is INFORMATIONAL — a balance ratio is a human-judgment tuning signal,
// not a correctness invariant, so out-of-band cells print a ⚠ for the reader but never fail
// the build. Only a genuinely degenerate value (non-finite / non-positive — a real tuning
// bug, not a balance opinion) is a hard error.
{
  const DIFF_HP9 = [0.7, 0.85, 1, 1.25, 1.55];
  const DIFF_REWARD9 = [0.85, 0.95, 1, 1.15, 1.3];
  const SM = TUNING.smoothing;
  const AS = TUNING.ascension;
  const E = TUNING.economy;

  const progMul = (id: number) => id <= 2 ? SM.earlyLevels
    : id >= SM.compensationFrom ? 1 + (SM.compensationMax - 1) * Math.min(1, Math.max(0, (id - SM.compensationFrom) / (SM.compensationFull - SM.compensationFrom)))
    : 1;
  const effHpMul = (lv: any, diff: number, asc: number) => lv.hpMul * DIFF_HP9[diff] * progMul(lv.id) * (asc >= 1 ? AS.hpMul : 1);
  // waveRewardMul (campaign, wave-0 baseline): (1 + (hpMul-1)*bountyCoef) * diffReward
  const rewardMul = (lv: any, diff: number) => (1 + (lv.hpMul - 1) * E.bountyCoef) * DIFF_REWARD9[diff];

  // "Needed" firepower model. Total enemy HP is a poor proxy for required spend — towers deal
  // damage continuously, so what you must actually field is DPS matched to the HP *arrival
  // rate*, not the HP total. Required spend therefore tracks (average enemy toughness) x (how
  // many towers a level makes you field), NOT total HP (which over-weights late-game by ~10x).
  //   needed = avgEffHp x towerCount x K
  // avgEffHp = total effective HP / total enemy count (grows ~with hpMul + the tougher late
  // roster, and responds to difficulty/ascension); towerCount grows 4->8 with the campaign
  // (more lanes/coverage). K is calibrated ONCE so L15 Normal Asc0 lands at the band midpoint
  // 1.5; every other cell then reads as how the economy holds relative to that anchor.
  function totalEffHp(lv: any, diff: number, asc: number): number {
    const mul = effHpMul(lv, diff, asc);
    let hp = 0;
    lv.waves.forEach((wave: any[], wi: number) => {
      const waveRamp = 1 + wi * 0.03;   // matches the in-game per-wave HP ramp
      for (const grp of wave) {
        const spec = ENEMIES[grp.e];
        hp += grp.n * spec.hp * mul * waveRamp * (1 + (spec.shield || 0));
        if (spec.splits) hp += grp.n * spec.splits.count * ENEMIES[spec.splits.id].hp * mul * waveRamp;
      }
    });
    return hp;
  }
  function totalEnemyCount(lv: any): number {
    let n = 0;
    for (const grp of lv.waves.flat()) { n += grp.n; const spec = ENEMIES[grp.e]; if (spec.splits) n += grp.n * spec.splits.count; }
    return n;
  }
  const towerCount = (id: number) => Math.max(4, Math.min(8, Math.round(3 + id / 2.5)));   // L1->4, L5->5, L10->7, L15->8
  const avgEffHp = (lv: any, diff: number, asc: number) => totalEffHp(lv, diff, asc) / totalEnemyCount(lv);
  function earnable(lv: any, diff: number, asc: number): number {
    const rm = rewardMul(lv, diff);
    const start = Math.round(lv.startCredits * (asc >= 4 ? AS.startCreditMul : 1));
    let bounties = 0;
    lv.waves.forEach((wave: any[]) => {
      for (const grp of wave) {
        const spec = ENEMIES[grp.e];
        bounties += Math.round(spec.reward * rm) * grp.n;
        // split children spawn with rewardMul=1 in-game -> base reward * diffReward only
        if (spec.splits) bounties += Math.round(ENEMIES[spec.splits.id].reward * DIFF_REWARD9[diff]) * spec.splits.count * grp.n;
      }
    });
    const numWaves = lv.waves.length;
    let waveClear = 0;
    for (let wi = 0; wi < numWaves; wi++) waveClear += Math.round((30 + wi * 4) * rm);
    // interest cap (asc-scaled), assumed banked to ~half the cap on average across payouts
    const capBase = Math.round((TUNING.interest.cap + lv.id * 3) * (1 + (lv.hpMul - 1) * E.bountyCoef));
    const cap = asc >= 4 ? Math.round(capBase * (AS.interestCapTier4 / TUNING.interest.cap)) : capBase;
    const interest = cap * numWaves * 0.5;
    // supply drops: only the 'credits' kind (45/100 weight) pays directly; rough ~1 credit-drop
    // per 4 waves at the mid credit roll (65), econ-scaled
    const drops = numWaves * 0.25 * Math.round(65 * rm);
    // early-call at 50% uptake, averaging half the 40% cap -> ~10% of total bounty
    const earlyCall = bounties * E.earlyCallCap * 0.5 * 0.5;
    // rich-vein levels: a modest per-kill bonus on the ~15% of kills a vein tower lands
    const totalEnemies = lv.waves.flat().reduce((a: number, g: any) => a + g.n, 0);
    const veins = (lv.modifiers || []).includes('rich-veins') ? totalEnemies * 0.15 * Math.round(TUNING.richVeins.creditPerKill * rm) : 0;
    return start + bounties + waveClear + interest + drops + earlyCall + veins;
  }

  const L15 = LEVELS.find(l => l.id === 15)!;
  // Anchor K so L15 Normal Asc0 = 1.5:  needed = avgEffHp*towerCount/K,  ratio = earnable/needed
  const K = (avgEffHp(L15, 2, 0) * towerCount(15)) / (earnable(L15, 2, 0) / 1.5);
  const needed = (lv: any, diff: number, asc: number) => avgEffHp(lv, diff, asc) * towerCount(lv.id) / K;
  const ratio = (lv: any, diff: number, asc: number) => earnable(lv, diff, asc) / needed(lv, diff, asc);

  console.log('\n---- Economy sweep: earnable/needed ratio (target band 1.2-1.8) ----');
  const DIFF_IDX = [2, 3, 4], DIFF_LBL = ['Normal', 'Hard', 'Brutal'];
  const ASC_IDX = [0, 3, 5];
  for (const id of [1, 5, 10, 15]) {
    const lv = LEVELS.find(l => l.id === id)!;
    console.log(`\nLevel ${id} (${lv.name}):`);
    for (let di = 0; di < DIFF_IDX.length; di++) {
      const cells: string[] = [];
      for (const asc of ASC_IDX) {
        const r = ratio(lv, DIFF_IDX[di], asc);
        const flag = r < 1.2 || r > 1.8 ? '⚠' : ' ';
        cells.push(`A${asc}:${r.toFixed(2)}${flag}`);
        if (!Number.isFinite(r) || r <= 0) err(`Economy model degenerate: L${id} ${DIFF_LBL[di]} Asc${asc} earnable/needed = ${r} (non-finite or non-positive — a tuning bug, not a balance opinion)`);
      }
      console.log(`  ${DIFF_LBL[di].padEnd(7)} ${cells.join('   ')}`);
    }
  }
  console.log('  (K calibrated so L15 Normal Asc0 = 1.50; other cells read relative to that anchor)');
}

// (d) fmt spot checks
const fmtCases: [number, string][] = [[950, '950'], [9999, '9999'], [12400, '12.4k'], [150000, '150k'], [3400000, '3.4M']];
for (const [n, want] of fmtCases) {
  if (fmt(n) !== want) err(`fmt(${n}) = '${fmt(n)}', expected '${want}'`);
}

// ---- Phase 6: ascension / daily op / resume / chroma ----

// ascension tuning sanity
{
  const A = TUNING.ascension;
  if (!(A.hpMul > 1)) err('TUNING.ascension.hpMul should be > 1');
  if (!(A.mutationBonus > 0 && A.mutationBonus < 1)) err('TUNING.ascension.mutationBonus should be in (0,1)');
  if (!(A.mutatorFromWave >= 1)) err('TUNING.ascension.mutatorFromWave should be >= 1');
  if (!(A.eliteMul > 1)) err('TUNING.ascension.eliteMul should be > 1');
  if (!(A.dualAffixChance > 0 && A.dualAffixChance < 1)) err('TUNING.ascension.dualAffixChance should be in (0,1)');
  if (!(A.startCreditMul > 0 && A.startCreditMul < 1)) err('TUNING.ascension.startCreditMul should be in (0,1)');
  if (!(A.interestCapTier4 > 0 && A.interestCapTier4 < TUNING.interest.cap)) err('TUNING.ascension.interestCapTier4 should be a real reduction from the base cap');
  if (!(A.intermissionMul > 0 && A.intermissionMul < 1)) err('TUNING.ascension.intermissionMul should be in (0,1)');
}

// ---- Phase 1 (3.0): economy & NOVA tuning sanity ----
{
  const E = (TUNING as any).economy;
  if (!E) err('TUNING.economy is missing');
  else {
    for (const key of ['sellRefund', 'sellUndoWindow', 'refundInWaveMul', 'earlyCallPerSec', 'earlyCallCap', 'bountyCoef']) {
      if (!(key in E)) err(`TUNING.economy.${key} is missing`);
    }
    if (!(E.sellRefund > 0 && E.sellRefund < 1)) err('TUNING.economy.sellRefund should be in (0,1)');
    if (!(E.earlyCallCap <= 0.5)) err('TUNING.economy.earlyCallCap should be <= 0.5');
  }
  const N = TUNING.nova;
  if (!(N.fracNormal > N.fracBoss)) err('TUNING.nova.fracNormal should be greater than fracBoss');
}

// daily op: every level in the campaign is a valid pick if it's the only one eligible;
// modifier draws always come from the real MODIFIER_INFO set
for (const lv of LEVELS) {
  const op = computeDailyOp('2026-01-01', [lv.id]);
  if (!op || op.levelId !== lv.id) err(`Daily Op should be able to pick level ${lv.id} when it's the only eligible one`);
  if (op) for (const m of op.modifiers) if (!MODIFIER_INFO[m]) err(`Daily Op produced unknown modifier '${m}'`);
}
// determinism: same date + same pool -> identical composition, across repeated calls
{
  const pool = LEVELS.map(l => l.id);
  const a = computeDailyOp('2026-03-15', pool);
  const b = computeDailyOp('2026-03-15', pool);
  if (JSON.stringify(a) !== JSON.stringify(b)) err('Daily Op is not deterministic for the same date+pool');
}
if (computeDailyOp('2026-01-01', []) !== null) err('Daily Op should return null for an empty eligible pool');

// resume version stamp sanity
if (!(RESUME_VERSION >= 1 && Number.isInteger(RESUME_VERSION))) err('RESUME_VERSION must be a positive integer');

// save migration: ascension.unlocked derives correctly from an old-format save that only had `current`
{
  const oldFormat = { ascension: { current: 3, bestPerLevel: { 15: 3 } } };
  const migrated = migrateSave(oldFormat);
  if (migrated.ascension.unlocked < 3) err(`migrateSave should backfill ascension.unlocked from current (got ${migrated.ascension.unlocked})`);
  if (migrated.ascension.current !== 3) err('migrateSave should preserve ascension.current');
  const twice = migrateSave(JSON.parse(JSON.stringify(migrated)));
  if (JSON.stringify(twice.ascension) !== JSON.stringify(migrated.ascension)) err('migrateSave not idempotent on ascension after backfill');
}

// ---- Phase 2 (3.0): special-cell placement — headless across every level x tile size ----
// (Meander is intentionally NOT re-applied here — same reasoning as
// tests/asteroid-vein-seeding.ts: the placement algorithm only cares about the resulting
// pathTiles/rockTiles/endTiles sets, not which meander tier produced them, and meander
// itself is already exhaustively fuzz-tested elsewhere. This reimplementation also
// simplifies the ridge "nearest corner" and anchor "cluster heart" tie-break SCORING to a
// plain seeded pick among qualifying candidates — those preferences are polish, not
// correctness, so they're out of scope for an invariant check like this one.)
{
  // CELL_TYPES <-> TUNING.cells sync: every TUNING.cells key (besides the cross-cutting
  // minSeparation) needs a real cell type, and every type besides conduit (which has no
  // per-type scalar — its numbers are the pairing/adjacency logic itself) needs a TUNING entry.
  for (const key of Object.keys(TUNING.cells)) {
    if (key === 'minSeparation') continue;
    if (!(key in CELL_TYPES)) err(`TUNING.cells.${key} has no matching CELL_TYPES entry`);
  }
  for (const id of Object.keys(CELL_TYPES)) {
    if (id === 'conduit') continue;
    if (!((id in TUNING.cells))) err(`CELL_TYPES.${id} has no matching TUNING.cells entry`);
  }

  function snapToGrid(rawPts: number[][], cell: number) {
    const top = 70, bottom = 720 - 22;
    const cols = Math.floor((1280 - 12) / cell);
    const rows = Math.floor((bottom - top) / cell);
    const gx0 = (1280 - cols * cell) / 2;
    const gy0 = top + ((bottom - top) - rows * cell) / 2;
    const pts: { c: number; r: number }[] = [];
    for (let i = 0; i < rawPts.length; i++) {
      let c = Math.round((rawPts[i][0] - gx0 - cell / 2) / cell);
      let r = Math.round((rawPts[i][1] - gy0 - cell / 2) / cell);
      r = Math.max(0, Math.min(rows - 1, r));
      if (i === 0) c = -2; else if (i === rawPts.length - 1) c = cols + 1; else c = Math.max(1, Math.min(cols - 2, c));
      if (i > 0) { const prev = pts[pts.length - 1]; if (prev.r !== r && prev.c !== c) pts.push({ c: prev.c, r }); }
      pts.push({ c, r });
    }
    return { pts, cols, rows };
  }
  function carve(pts: { c: number; r: number }[], cols: number, rows: number) {
    const idx = (c: number, r: number) => r * cols + c;
    const pathTiles = new Set<number>(), endTiles = new Set<number>();
    const ordered: { c: number; r: number }[] = [];
    let firstIn: { c: number; r: number } | null = null, lastIn: { c: number; r: number } | null = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dc = Math.sign(b.c - a.c), dr = Math.sign(b.r - a.r);
      let c = a.c, r = a.r;
      while (true) {
        if (c >= 0 && c < cols && r >= 0 && r < rows) { pathTiles.add(idx(c, r)); ordered.push({ c, r }); if (!firstIn) firstIn = { c, r }; lastIn = { c, r }; }
        if (c === b.c && r === b.r) break;
        c += dc; r += dr;
      }
    }
    const fi = firstIn || { c: 0, r: pts[0].r }, li = lastIn || { c: cols - 1, r: pts[pts.length - 1].r };
    endTiles.add(idx(fi.c, fi.r)); endTiles.add(idx(li.c, li.r));
    return { idx, pathTiles, endTiles, ordered };
  }

  // Simplified mirror of Game.buildGrid()'s cell-placement block: same candidate rules,
  // same fixed order, same separation/fallback strategy — seeded pick instead of scored
  // tie-break for ridge/anchor (see note above).
  function placeSpecials(levelId: number, cellPlan: Record<string, number | undefined>, pathTiles: Set<number>, endTiles: Set<number>, cols: number, rows: number, ordered: { c: number; r: number }[]) {
    const idx = (c: number, r: number) => r * cols + c;
    const cOf = (i: number) => i % cols, rOf = (i: number) => Math.floor(i / cols);
    const rng = mulberry32(hashString(`${levelId}-cells`));
    const specialMap = new Map<number, { type: string; partner?: number }>();
    const placedIdx: number[] = [];
    const allIdx: number[] = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) allIdx.push(idx(c, r));
    const isFree = (i: number) => !pathTiles.has(i) && !endTiles.has(i) && !specialMap.has(i);
    const pathAdj = (c: number, r: number) => { let n = 0; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dc && !dr) continue; const cc = c + dc, rr = r + dr; if (cc < 0 || cc >= cols || rr < 0 || rr >= rows) continue; if (pathTiles.has(idx(cc, rr))) n++; } return n; };
    const pathNear = (c: number, r: number, k: number) => { for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) { if (!dc && !dr) continue; const cc = c + dc, rr = r + dr; if (cc < 0 || cc >= cols || rr < 0 || rr >= rows) continue; if (pathTiles.has(idx(cc, rr))) return true; } return false; };
    const cheby = (i: number, j: number) => Math.max(Math.abs(cOf(i) - cOf(j)), Math.abs(rOf(i) - rOf(j)));
    const farEnough = (i: number, sep: number) => placedIdx.every(j => cheby(i, j) >= sep);
    const from = Math.floor(ordered.length * 2 / 3);
    const finalThird = new Set(ordered.slice(from).map(p => idx(p.c, p.r)));
    const nearFinalThird = (c: number, r: number) => { for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dc && !dr) continue; const cc = c + dc, rr = r + dr; if (cc < 0 || cc >= cols || rr < 0 || rr >= rows) continue; const ni = idx(cc, rr); if (pathTiles.has(ni) && finalThird.has(ni)) return true; } return false; };

    const place = (want: number, type: string, cands: (sep: number) => number[]) => {
      for (let n = 0; n < want; n++) {
        let c = cands(TUNING.cells.minSeparation);
        if (!c.length) c = cands(1);
        if (!c.length) { console.warn(`validate: could not place ${type} #${n + 1} on level ${levelId}`); continue; }
        const pick = c[seededInt(rng, 0, c.length - 1)];
        specialMap.set(pick, { type }); placedIdx.push(pick);
      }
    };
    place(cellPlan.sinkhole || 0, 'sinkhole', sep => allIdx.filter(i => isFree(i) && pathAdj(cOf(i), rOf(i)) >= 2 && farEnough(i, sep)));
    place(cellPlan.ridge || 0, 'ridge', sep => allIdx.filter(i => { const c = cOf(i), r = rOf(i); return isFree(i) && pathAdj(c, r) === 0 && pathNear(c, r, 3) && farEnough(i, sep); }));
    for (let n = 0; n < (cellPlan.conduitPairs || 0); n++) {
      let pairs: [number, number][] = [];
      for (let r = 0; r < rows && !pairs.length; r++) for (let c = 0; c < cols - 1 && !pairs.length; c++) {
        const i1 = idx(c, r), i2 = idx(c + 1, r);
        if (isFree(i1) && isFree(i2) && pathAdj(c, r) >= 1 && pathAdj(c + 1, r) >= 1 && farEnough(i1, TUNING.cells.minSeparation) && farEnough(i2, TUNING.cells.minSeparation)) pairs.push([i1, i2]);
      }
      if (!pairs.length) { console.warn(`validate: could not place conduit pair #${n + 1} on level ${levelId}`); continue; }
      const [i1, i2] = pairs[seededInt(rng, 0, pairs.length - 1)];
      specialMap.set(i1, { type: 'conduit', partner: i2 }); specialMap.set(i2, { type: 'conduit', partner: i1 }); placedIdx.push(i1, i2);
    }
    place(cellPlan.anchor || 0, 'anchor', sep => allIdx.filter(i => isFree(i) && farEnough(i, sep)));
    place(cellPlan.nullcell || 0, 'nullcell', sep => allIdx.filter(i => { const c = cOf(i), r = rOf(i); return isFree(i) && nearFinalThird(c, r) && farEnough(i, sep); }));
    return specialMap;
  }

  let trials = 0;
  for (const lv of LEVELS) {
    if (!lv.cellPlan) continue;
    for (const tileSize of [40, 48, 58]) {
      const { pts, cols, rows } = snapToGrid(lv.paths[0], tileSize);
      const { idx, pathTiles, endTiles, ordered } = carve(pts, cols, rows);
      const specialMap = placeSpecials(lv.id, lv.cellPlan as any, pathTiles, endTiles, cols, rows, ordered);
      trials++;

      const wantTotal = (lv.cellPlan.ridge || 0) + (lv.cellPlan.sinkhole || 0) + (lv.cellPlan.conduitPairs || 0) * 2 + (lv.cellPlan.anchor || 0) + (lv.cellPlan.nullcell || 0);
      const gotTotal = specialMap.size;
      if (gotTotal < wantTotal - 1) err(`Level ${lv.id} tile=${tileSize}: special-cell placement shortfall (wanted ${wantTotal}, got ${gotTotal})`);
      for (const [i, sp] of specialMap) {
        if (pathTiles.has(i)) err(`Level ${lv.id} tile=${tileSize}: ${sp.type} placed on the path`);
        if (endTiles.has(i)) err(`Level ${lv.id} tile=${tileSize}: ${sp.type} placed on a portal/base tile`);
        if (sp.type === 'conduit') {
          if (sp.partner === undefined || !specialMap.has(sp.partner)) err(`Level ${lv.id} tile=${tileSize}: conduit cell ${i} has no valid partner`);
          else {
            const dc = Math.abs((i % cols) - (sp.partner % cols)), dr = Math.abs(Math.floor(i / cols) - Math.floor(sp.partner / cols));
            if (dc + dr !== 1) err(`Level ${lv.id} tile=${tileSize}: conduit partners ${i}/${sp.partner} aren't orthogonally adjacent`);
          }
        }
        if (sp.type === 'nullcell') {
          const from3 = Math.floor(ordered.length * 2 / 3);
          const finalThird = new Set(ordered.slice(from3).map(p => idx(p.c, p.r)));
          const c = i % cols, r = Math.floor(i / cols);
          let touches = false;
          for (let dr = -1; dr <= 1 && !touches; dr++) for (let dc = -1; dc <= 1 && !touches; dc++) {
            const cc = c + dc, rr = r + dr; if (cc < 0 || cc >= cols || rr < 0 || rr >= rows) continue;
            const ni = idx(cc, rr); if (pathTiles.has(ni) && finalThird.has(ni)) touches = true;
          }
          if (!touches) err(`Level ${lv.id} tile=${tileSize}: null cell ${i} isn't adjacent to the path's final third`);
        }
      }
    }
  }
  console.log(`  (special-cell placement: ${trials} level x tile-size combinations checked)`);
}

// ---- Phase 3 (3.0): map, path & portal identity ----
{
  // 3.2.4: every LANDMARKS coordinate within [-100,1380]x[-100,820]; every level 1-15 has
  // 1-3 entries.
  for (let id = 1; id <= 15; id++) {
    const list = LANDMARKS[id];
    if (!list || list.length < 1 || list.length > 3) err(`Level ${id}: LANDMARKS should have 1-3 entries (got ${list?.length ?? 0})`);
    for (const lm of list || []) {
      if (lm.x < -100 || lm.x > 1380 || lm.y < -100 || lm.y > 820) err(`Level ${id}: landmark ${lm.kind} out of bounds (${lm.x},${lm.y})`);
    }
  }

  // Faithful copy of buildGrid()'s meander pipeline (from game.ts) — needed here (unlike the
  // seeded-placement checks above) because meander tier genuinely changes which tiles the
  // path occupies, and that's exactly what the two checks below depend on: a static asteroid
  // colliding with the road, or two portals/bases snapping onto the same tile.
  interface CPt { c: number; r: number }
  const ptKey = (p: CPt) => `${p.c},${p.r}`;
  function rectilinearize(pts: CPt[]): CPt[] {
    const out: CPt[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const prev = out[out.length - 1], next = pts[i];
      if (prev.c !== next.c && prev.r !== next.r) out.push({ c: next.c, r: prev.r });
      out.push(next);
    }
    return out;
  }
  function walkTiles(pts: CPt[]): CPt[] {
    const out: CPt[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dc = Math.sign(b.c - a.c), dr = Math.sign(b.r - a.r);
      let c = a.c, r = a.r;
      while (!(c === b.c && r === b.r)) { c += dc; r += dr; out.push({ c, r }); }
    }
    return out;
  }
  function buildBumps(a: CPt, b: CPt, bumps: number, depth: number, cols: number, rows: number): CPt[] {
    const horiz = a.r === b.r;
    const total = horiz ? b.c - a.c : b.r - a.r;
    const dir = Math.sign(total), mainLen = Math.abs(total), baseline = horiz ? a.r : a.c;
    const raw: CPt[] = [a];
    let sign = 1;
    for (let i = 1; i <= bumps; i++) {
      const travelled = Math.round((mainLen * i) / (bumps + 1));
      const mainCoord = (horiz ? a.c : a.r) + dir * travelled;
      const offRaw = baseline + depth * sign;
      const off = horiz ? Math.max(1, Math.min(rows - 2, offRaw)) : Math.max(1, Math.min(cols - 2, offRaw));
      raw.push(horiz ? { c: mainCoord, r: off } : { c: off, r: mainCoord });
      sign *= -1;
    }
    raw.push(b);
    return rectilinearize(raw);
  }
  function meanderSegment(a: CPt, b: CPt, tier: number, cols: number, rows: number, forbidden: Set<string>): CPt[] {
    const straight = [a, b];
    if (tier <= 0 || (a.c !== b.c && a.r !== b.r)) return straight;
    const horiz = a.r === b.r;
    const mainLen = Math.abs(horiz ? b.c - a.c : b.r - a.r);
    const minLen = tier >= 2 ? 5 : 7;
    if (mainLen < minLen) return straight;
    const maxBumps = tier >= 2 ? Math.max(2, Math.round(mainLen / 4)) : Math.max(1, Math.round(mainLen / 6));
    const maxDepth = tier >= 2 ? 2 : 1;
    for (let depth = maxDepth; depth >= 1; depth--) {
      for (let bumps = maxBumps; bumps >= 1; bumps--) {
        const candidate = buildBumps(a, b, bumps, depth, cols, rows);
        const tiles = walkTiles(candidate);
        const seen = new Set<string>();
        let collides = false;
        for (let i = 1; i < tiles.length - 1; i++) {
          const k = ptKey(tiles[i]);
          if (forbidden.has(k) || seen.has(k)) { collides = true; break; }
          seen.add(k);
        }
        if (!collides) return candidate;
      }
    }
    return straight;
  }
  function applyMeanderV(cellsPts: CPt[], tier: number, cols: number, rows: number): CPt[] {
    if (cellsPts.length < 2 || tier <= 0) return cellsPts;
    const spine = new Set(walkTiles(cellsPts).map(ptKey));
    const claimed = new Set<string>();
    const markClaimed = (pts: CPt[]) => { for (const p of walkTiles(pts)) claimed.add(ptKey(p)); };
    const out: CPt[] = [cellsPts[0]];
    markClaimed([cellsPts[0]]);
    for (let i = 0; i < cellsPts.length - 1; i++) {
      const a = cellsPts[i], b = cellsPts[i + 1];
      const segSpine = new Set(walkTiles([a, b]).map(ptKey));
      const forbidden = new Set<string>();
      for (const k of spine) if (!segSpine.has(k)) forbidden.add(k);
      for (const k of claimed) forbidden.add(k);
      const seg = meanderSegment(a, b, tier, cols, rows, forbidden);
      markClaimed(seg);
      for (let j = 1; j < seg.length; j++) out.push(seg[j]);
    }
    return out;
  }
  function snapRaw(rawPts: number[][], cell: number) {
    const top = 70, bottom = 720 - 22;
    const cols = Math.floor((1280 - 12) / cell);
    const rows = Math.floor((bottom - top) / cell);
    const gx0 = (1280 - cols * cell) / 2;
    const gy0 = top + ((bottom - top) - rows * cell) / 2;
    const cellsPts: CPt[] = [];
    for (let i = 0; i < rawPts.length; i++) {
      let c = Math.round((rawPts[i][0] - gx0 - cell / 2) / cell);
      let r = Math.round((rawPts[i][1] - gy0 - cell / 2) / cell);
      r = Math.max(0, Math.min(rows - 1, r));
      if (i === 0) c = -2;
      else if (i === rawPts.length - 1) c = cols + 1;
      else c = Math.max(1, Math.min(cols - 2, c));
      if (i > 0) {
        const prev = cellsPts[cellsPts.length - 1];
        const horiz = Math.abs(rawPts[i][0] - rawPts[i - 1][0]) >= Math.abs(rawPts[i][1] - rawPts[i - 1][1]);
        if (horiz) r = prev.r; else c = prev.c;
        if (c === prev.c && r === prev.r) continue;
      }
      cellsPts.push({ c, r });
    }
    return { cellsPts, cols, rows, gx0, gy0 };
  }
  function carveTiles(cellsPts: CPt[], cols: number, rows: number) {
    const pathTiles = new Set<string>();
    let firstIn: CPt | null = null, lastIn: CPt | null = null;
    for (let i = 0; i < cellsPts.length - 1; i++) {
      const a = cellsPts[i], b = cellsPts[i + 1];
      const dc = Math.sign(b.c - a.c), dr = Math.sign(b.r - a.r);
      let c = a.c, r = a.r;
      while (true) {
        if (c >= 0 && c < cols && r >= 0 && r < rows) { pathTiles.add(`${c},${r}`); if (!firstIn) firstIn = { c, r }; lastIn = { c, r }; }
        if (c === b.c && r === b.r) break;
        c += dc; r += dr;
      }
    }
    return { pathTiles, firstIn: firstIn || cellsPts[0], lastIn: lastIn || cellsPts[cellsPts.length - 1] };
  }

  // 3.5: the STATIC per-level `asteroids` array must never collide with the actually-carved
  // path, across every meander tier (meander genuinely changes the tile footprint, so unlike
  // the seeded-placement checks above, it is NOT skipped here).
  let asteroidTrials = 0;
  for (const lv of LEVELS) {
    if (!lv.asteroids || !lv.asteroids.length) continue;
    for (const tileSize of [40, 48, 58]) {
      for (const meander of [0, 1, 2]) {
        const centers: { x: number; y: number }[] = [];
        for (const rawPts of lv.paths) {
          const { cellsPts, cols, rows, gx0, gy0 } = snapRaw(rawPts, tileSize);
          const meandered = applyMeanderV(cellsPts, meander, cols, rows);
          const { pathTiles } = carveTiles(meandered, cols, rows);
          for (const key of pathTiles) {
            const [c, r] = key.split(',').map(Number);
            centers.push({ x: gx0 + c * tileSize + tileSize / 2, y: gy0 + r * tileSize + tileSize / 2 });
          }
        }
        asteroidTrials++;
        for (const a of lv.asteroids) {
          if (centers.some(p => Math.hypot(p.x - a.x, p.y - a.y) < a.r + tileSize * 0.2)) {
            err(`Level ${lv.id} tile=${tileSize} meander=${meander}: static asteroid (${a.x},${a.y}) collides with the path`);
          }
        }
      }
    }
  }
  console.log(`  (static asteroid/path collision: ${asteroidTrials} level x tile-size x meander combinations checked)`);

  // Multi-path levels: portals must never snap onto the same tile as each other (nor bases),
  // across every tile size x meander tier — a merge would silently turn two lanes into one.
  let mergeTrials = 0;
  for (const lv of LEVELS) {
    if (lv.paths.length < 2) continue;
    for (const tileSize of [40, 48, 58]) {
      for (const meander of [0, 1, 2]) {
        const portalKeys: string[] = [], baseKeys: string[] = [];
        for (const rawPts of lv.paths) {
          const { cellsPts, cols, rows } = snapRaw(rawPts, tileSize);
          const meandered = applyMeanderV(cellsPts, meander, cols, rows);
          const { firstIn, lastIn } = carveTiles(meandered, cols, rows);
          portalKeys.push(`${firstIn.c},${firstIn.r}`);
          baseKeys.push(`${lastIn.c},${lastIn.r}`);
        }
        mergeTrials++;
        if (new Set(portalKeys).size < portalKeys.length) err(`Level ${lv.id} tile=${tileSize} meander=${meander}: two portals snap to the same cell`);
        if (new Set(baseKeys).size < baseKeys.length) err(`Level ${lv.id} tile=${tileSize} meander=${meander}: two bases snap to the same cell`);
      }
    }
  }
  console.log(`  (multi-path portal/base merge: ${mergeTrials} level x tile-size x meander combinations checked)`);
}

// ---- Phase 3B (3.0): visual identity & readability ----
{
  const hexRe = /^#[0-9a-f]{6}$/i;
  const checkPair = (label: string, pair: [string, string] | undefined) => {
    if (!pair) { err(`${label}: missing from palette`); return; }
    for (const h of pair) if (!hexRe.test(h)) err(`${label}: invalid hex '${h}'`);
  };
  for (const variant of ['default', 'chroma', 'accessible'] as const) {
    const pal = PALETTE[variant];
    if (!hexRe.test(pal.rim)) err(`PALETTE.${variant}.rim: invalid hex '${pal.rim}'`);
    if (!hexRe.test(pal.muzzle)) err(`PALETTE.${variant}.muzzle: invalid hex '${pal.muzzle}'`);
    for (const t of TOWERS) checkPair(`PALETTE.${variant}.towers.${t.id}`, pal.towers[t.id]);
    for (const id of Object.keys(ENEMIES)) checkPair(`PALETTE.${variant}.enemies.${id}`, pal.enemies[id]);
  }

  // Every non-boss enemy needs a unique (shape, size-band, air/ground) triple — the second
  // redundancy channel behind color, so the accessible palette (which pushes value
  // separation instead of hue) still leaves every enemy visually distinguishable by
  // silhouette alone. Flying is included: fliers already render wings + a flight shadow,
  // a real silhouette difference from a ground unit of the same shape/size, not just a
  // stat flag — see drawEnemyBody's `spec.flying` wing-drawing branch.
  const sizeBand = (s: number) => s < 9 ? 'xs' : s < 12 ? 's' : s < 15 ? 'm' : s < 20 ? 'l' : 'xl';
  const seen = new Map<string, string>();
  for (const e of Object.values(ENEMIES)) {
    if (e.boss) continue;
    const key = `${e.shape || 'circle'}/${sizeBand(e.size)}/${e.flying ? 'air' : 'ground'}`;
    if (seen.has(key)) err(`Enemies '${seen.get(key)}' and '${e.id}' share (shape, size-band, air/ground) = ${key} — not distinguishable by silhouette alone`);
    else seen.set(key, e.id);
  }
}

// ---- Phase 5 (3.0): wave shapes, flier lanes & difficulty composition ----
{
  // ENEMY_INTRO must cover every non-boss enemy exactly once, and agree with whatever level
  // actually first introduces it via `newEnemy` (the two are independent tables authored by
  // hand — this is the thing that keeps them from drifting apart).
  const nonBoss = Object.values(ENEMIES).filter(e => !e.boss);
  for (const e of nonBoss) if (!(e.id in ENEMY_INTRO)) err(`ENEMY_INTRO missing entry for non-boss enemy '${e.id}'`);
  for (const id of Object.keys(ENEMY_INTRO)) if (!(id in ENEMIES) || ENEMIES[id].boss) err(`ENEMY_INTRO has a stale/boss entry '${id}'`);
  for (const lv of LEVELS) {
    if (!lv.newEnemy) continue;
    const introAt = ENEMY_INTRO[lv.newEnemy.id];
    if (introAt !== lv.id) err(`Level ${lv.id}'s newEnemy '${lv.newEnemy.id}' debuts here, but ENEMY_INTRO says level ${introAt}`);
  }

  // Wave shape authoring rules (5.3): never wave 1, never a boss wave, feint only L7+.
  // Trickle's <=12-spawn guideline is intentionally NOT a hard assertion here — several
  // levels' actual wave data can't satisfy it without breaking a stronger constraint
  // (convoy claiming the only small wave in the level); those are documented, judged
  // deviations in levels.ts itself, not authoring bugs to keep re-flagging forever.
  for (const lv of LEVELS) {
    if (!lv.waveShapes) continue;
    for (const [idxStr, shape] of Object.entries(lv.waveShapes)) {
      const idx = Number(idxStr);
      if (!(shape in WAVE_SHAPES)) err(`Level ${lv.id} wave ${idx}: unknown shape '${shape}'`);
      if (idx === 0) err(`Level ${lv.id} wave ${idx}: shapes never apply to wave 1`);
      const wave = lv.waves[idx];
      if (!wave) { err(`Level ${lv.id} wave ${idx}: waveShapes references a wave that doesn't exist`); continue; }
      if (wave.some(grp => ENEMIES[grp.e]?.boss)) err(`Level ${lv.id} wave ${idx}: shapes never apply to a boss wave`);
      if (shape === 'feint' && lv.id < 7) err(`Level ${lv.id} wave ${idx}: feint is gated to L7+`);
    }
  }

  // Flier lane bounds (5.4.6): the curve's control point (and therefore, by the convex-hull
  // property of a quadratic bezier, the ENTIRE lane) must stay near the 1280x720 canvas for
  // every level's portal/base pairs, at both possible offset signs and magnitudes.
  const W = 1280, H = 720;
  function flierLaneControl(levelId: number, waveIdx: number, portal: { x: number; y: number }, base: { x: number; y: number }) {
    const r = mulberry32(hashString(`${levelId}-fly-${waveIdx}`));
    const o = (r() < 0.5 ? -1 : 1) * (120 + r() * 120);
    const dx = base.x - portal.x, dy = base.y - portal.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;
    const mx = (portal.x + base.x) / 2, my = (portal.y + base.y) / 2;
    return { x: mx + px * o, y: my + py * o };
  }
  const MARGIN = 200; // generous — portals themselves already sit ~40px off-canvas by design
  for (const lv of LEVELS) {
    for (let pi = 0; pi < lv.paths.length; pi++) {
      const path = lv.paths[pi];
      const portal = { x: path[0][0], y: path[0][1] };
      const base = { x: path[path.length - 1][0], y: path[path.length - 1][1] };
      for (let waveIdx = 0; waveIdx < lv.waves.length; waveIdx++) {
        const c = flierLaneControl(lv.id, waveIdx, portal, base);
        if (c.x < -MARGIN || c.x > W + MARGIN || c.y < -MARGIN || c.y > H + MARGIN) {
          err(`Level ${lv.id} path ${pi} wave ${waveIdx}: flier lane control point (${c.x.toFixed(0)},${c.y.toFixed(0)}) strays far outside the canvas`);
        }
      }
    }
  }
}

// ---- Phase 8: draft & doctrines ----
{
  // DOCTRINES ids must match TUNING.doctrines keys exactly (both directions).
  const specIds = new Set(DOCTRINES.map(d => d.id));
  const tuningIds = new Set(Object.keys(TUNING.doctrines));
  for (const id of specIds) if (!tuningIds.has(id)) err(`DOCTRINES['${id}'] missing a TUNING.doctrines entry`);
  for (const id of tuningIds) if (!specIds.has(id)) err(`TUNING.doctrines['${id}'] has no matching DOCTRINES spec`);
  for (const d of DOCTRINES) if (!(d.cost > 0)) err(`Doctrine '${d.id}' cost must be > 0`);

  // sizeByLevel: ascending thresholds, ascending (or flat) sizes, covers every campaign level,
  // and every size is a sane count (less than the full 10-tower roster, at least a few picks).
  const sbl = TUNING.draft.sizeByLevel;
  for (let i = 1; i < sbl.length; i++) {
    if (sbl[i][0] <= sbl[i - 1][0]) err(`TUNING.draft.sizeByLevel thresholds must strictly increase (index ${i})`);
    if (sbl[i][1] < sbl[i - 1][1]) err(`TUNING.draft.sizeByLevel sizes must not shrink as levels advance (index ${i})`);
  }
  if (sbl[sbl.length - 1][0] < 15) err('TUNING.draft.sizeByLevel must cover up to level 15');
  for (const [, size] of sbl) if (!(size >= 3 && size < TOWERS.length)) err(`TUNING.draft size ${size} outside sane [3, ${TOWERS.length}) range`);
  if (!(TUNING.draft.endless >= 3 && TUNING.draft.endless <= TOWERS.length)) err('TUNING.draft.endless outside sane range');
  for (const lv of LEVELS) {
    const size = draftSizeForLevel(lv.id);
    if (!(size >= 3 && size <= TOWERS.length)) err(`Level ${lv.id}: draftSizeForLevel returned ${size}, outside sane range`);
  }
}

console.log(errors ? `\n${errors} error(s)` : '\nAll checks passed ✓');
process.exit(errors ? 1 : 0);
