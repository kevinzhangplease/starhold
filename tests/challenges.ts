// Challenge predicates — replicates game.ts's evaluateChallenges() exactly (a method on the
// stateful Game class, not extractable in isolation) against synthetic end-of-run states, and
// cross-checks every challenge id used in levels.ts actually exists in CHALLENGE_POOL with a
// sane param.
// Run: node --experimental-strip-types tests/challenges.ts
import { CHALLENGE_POOL } from '../src/data.ts';
import { LEVELS } from '../src/levels.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

interface RunState {
  livesLostTotal: number;
  towersBuilt: Record<string, number>;
  abilityUsed: boolean;
  lateCallHappened: boolean;
  soldAny: boolean;
  diffTier: number;
}
function evaluate(id: string, param: number | undefined, s: RunState): boolean {
  switch (id) {
    case 'perfect_hull': return s.livesLostTotal === 0;
    case 'minimalist': { const total = Object.values(s.towersBuilt).reduce((a, b) => a + b, 0); return total <= (param ?? 6); }
    case 'specialist': { const types = Object.keys(s.towersBuilt).length; return types > 0 && types <= (param ?? 2); }
    case 'no_abilities': return !s.abilityUsed;
    case 'speedrunner': return !s.lateCallHappened;
    case 'never_sell': return !s.soldAny;
    case 'hard_plus': return s.diffTier >= 3;
    default: return false;
  }
}
const baseState: RunState = { livesLostTotal: 0, towersBuilt: {}, abilityUsed: false, lateCallHappened: false, soldAny: false, diffTier: 2 };

// perfect_hull
check(evaluate('perfect_hull', undefined, { ...baseState, livesLostTotal: 0 }) === true, 'perfect_hull: no damage taken -> true');
check(evaluate('perfect_hull', undefined, { ...baseState, livesLostTotal: 1 }) === false, 'perfect_hull: any damage -> false');

// minimalist
check(evaluate('minimalist', 6, { ...baseState, towersBuilt: { pulse: 4, mortar: 2 } }) === true, 'minimalist: 6 built, cap 6 -> true (at the boundary)');
check(evaluate('minimalist', 6, { ...baseState, towersBuilt: { pulse: 4, mortar: 3 } }) === false, 'minimalist: 7 built, cap 6 -> false');
check(evaluate('minimalist', 6, baseState) === true, 'minimalist: zero towers built still satisfies (edge case, not a bug)');
check(evaluate('minimalist', undefined, { ...baseState, towersBuilt: { pulse: 6 } }) === true, 'minimalist: default param is 6');

// specialist
check(evaluate('specialist', 2, { ...baseState, towersBuilt: { pulse: 10, mortar: 5 } }) === true, 'specialist: 2 types, cap 2 -> true');
check(evaluate('specialist', 2, { ...baseState, towersBuilt: { pulse: 10, mortar: 5, cryo: 1 } }) === false, 'specialist: 3 types, cap 2 -> false');
check(evaluate('specialist', 2, baseState) === false, 'specialist: zero types built -> false (must build SOMETHING to earn this)');

// no_abilities / speedrunner / never_sell (simple negated flags)
check(evaluate('no_abilities', undefined, { ...baseState, abilityUsed: false }) === true, 'no_abilities: never used -> true');
check(evaluate('no_abilities', undefined, { ...baseState, abilityUsed: true }) === false, 'no_abilities: used once -> false');
check(evaluate('speedrunner', undefined, { ...baseState, lateCallHappened: false }) === true, 'speedrunner: every wave called early -> true');
check(evaluate('speedrunner', undefined, { ...baseState, lateCallHappened: true }) === false, 'speedrunner: one late call -> false');
check(evaluate('never_sell', undefined, { ...baseState, soldAny: false }) === true, 'never_sell: nothing sold -> true');
check(evaluate('never_sell', undefined, { ...baseState, soldAny: true }) === false, 'never_sell: sold something -> false');

// hard_plus
check(evaluate('hard_plus', undefined, { ...baseState, diffTier: 3 }) === true, 'hard_plus: Hard (tier 3) -> true');
check(evaluate('hard_plus', undefined, { ...baseState, diffTier: 4 }) === true, 'hard_plus: Brutal (tier 4) -> true');
check(evaluate('hard_plus', undefined, { ...baseState, diffTier: 2 }) === false, 'hard_plus: Normal (tier 2) -> false');

// unknown id -> false, never throws
check(evaluate('not_a_real_challenge', undefined, baseState) === false, 'unknown challenge id degrades to false, not a crash');

// ---------- cross-check against the real level data ----------
let totalInstances = 0;
for (const lv of LEVELS) {
  for (const c of lv.challenges || []) {
    totalInstances++;
    check(!!CHALLENGE_POOL[c.id], `Level ${lv.id}: challenge id '${c.id}' exists in CHALLENGE_POOL`);
    if (c.param !== undefined) check(Number.isInteger(c.param) && c.param > 0, `Level ${lv.id}: challenge '${c.id}' param ${c.param} is a positive integer`);
  }
}
check(totalInstances === 28, `exactly 28 challenge instances across the campaign (got ${totalInstances})`);
check(Object.keys(CHALLENGE_POOL).length === 7, `exactly 7 distinct challenge types exist (got ${Object.keys(CHALLENGE_POOL).length})`);
// every pool entry's desc() function actually runs without throwing, with and without a param
for (const def of Object.values(CHALLENGE_POOL)) {
  try { def.desc(); def.desc(3); } catch (e) { fails++; console.error(`FAIL: challenge '${def.id}'.desc() throws:`, e); }
}

console.log(fails ? `${fails} FAILURES` : 'challenges: all checks passed');
process.exit(fails ? 1 : 0);
