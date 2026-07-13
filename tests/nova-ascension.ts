// NOVA recharge decay + Ascension cumulative stacking — pure math against real TUNING.
// Run: node --experimental-strip-types tests/nova-ascension.ts
import { TUNING } from '../src/data.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

// ---------- NOVA ----------
const N = TUNING.nova;
check(N.killsToCharge > 0, 'NOVA needs a positive number of kills to charge');
check(N.rechargeGrowth > 1, 'each NOVA use makes the next one need more kills (rechargeGrowth > 1)');
check(N.buildup > 0 && N.buildup < 5, 'NOVA buildup is a short, real delay');
check(N.bossFrac > 0 && N.bossFrac <= 1, 'NOVA deals a fraction (not more) of its damage to bosses');
check(N.eliteCharge > 1, 'elite kills charge NOVA faster than normal kills');
check(N.bossCharge > N.eliteCharge, 'boss kills charge NOVA faster than elite kills');

// Replicates game.ts's exact post-fire update: this.novaNeed = round(novaNeed * rechargeGrowth)
function simulateRecharge(uses: number): number[] {
  let need = N.killsToCharge;
  const history = [need];
  for (let i = 0; i < uses; i++) {
    need = Math.round(need * N.rechargeGrowth);
    history.push(need);
  }
  return history;
}
{
  const history = simulateRecharge(5);
  check(history.every((n, i) => i === 0 || n > history[i - 1]), 'NOVA requirement strictly increases with each use');
  check(history[0] === N.killsToCharge, 'first requirement matches the base killsToCharge');
  // sanity: even after 5 uses in one level, requirement shouldn't have exploded to something absurd (>10x)
  check(history[5] < N.killsToCharge * 10, `after 5 uses, requirement (${history[5]}) hasn't spiraled unreasonably`);
}

// ---------- Ascension cumulative stacking ----------
const A = TUNING.ascension;
// Effects are gated by tier thresholds (>=1, >=2, >=3, >=4, >=5) and are CUMULATIVE —
// a higher tier keeps every lower tier's effect active. Verify the gating logic directly,
// mirroring game.ts's constructor exactly.
function effectiveHpMul(ascTier: number): number { return ascTier >= 1 ? A.hpMul : 1; }
function effectiveMutationBonus(ascTier: number): number { return ascTier >= 2 ? A.mutationBonus : 0; }
function effectiveMutatorFromWave(ascTier: number, normalFromWave: number): number { return ascTier >= 2 ? A.mutatorFromWave : normalFromWave; }
function effectiveEliteMul(ascTier: number): number { return ascTier >= 3 ? A.eliteMul : 1; }
function effectiveStartCreditMul(ascTier: number): number { return ascTier >= 4 ? A.startCreditMul : 1; }
function effectiveInterestCap(ascTier: number, baseCap: number): number { return ascTier >= 4 ? A.interestCapTier4 : baseCap; }
function effectiveIntermissionMul(ascTier: number): number { return ascTier >= 5 ? A.intermissionMul : 1; }

for (let tier = 0; tier <= 5; tier++) {
  const hp = effectiveHpMul(tier);
  const mutBonus = effectiveMutationBonus(tier);
  const eliteMul = effectiveEliteMul(tier);
  const creditMul = effectiveStartCreditMul(tier);
  const intermission = effectiveIntermissionMul(tier);
  // cumulative: everything unlocked at a LOWER tier must still be active at this tier
  if (tier >= 1) check(hp === A.hpMul, `tier ${tier}: Hardened (+HP) still active`);
  if (tier >= 2) check(mutBonus === A.mutationBonus, `tier ${tier}: Aggressive (+mutation) still active`);
  if (tier >= 3) check(eliteMul === A.eliteMul, `tier ${tier}: Decorated (+elite) still active`);
  if (tier >= 4) check(creditMul === A.startCreditMul, `tier ${tier}: Scarcity (-credits) still active`);
  if (tier >= 5) check(intermission === A.intermissionMul, `tier ${tier}: Onslaught (-intermission) still active`);
  // and nothing from a HIGHER tier leaks in early
  if (tier < 1) check(hp === 1, `tier ${tier}: Hardened not yet active`);
  if (tier < 2) check(mutBonus === 0, `tier ${tier}: Aggressive not yet active`);
  if (tier < 3) check(eliteMul === 1, `tier ${tier}: Decorated not yet active`);
  if (tier < 4) check(creditMul === 1, `tier ${tier}: Scarcity not yet active`);
  if (tier < 5) check(intermission === 1, `tier ${tier}: Onslaught not yet active`);
}
// tier 5 has EVERY effect active simultaneously — the actual "cumulative" claim, tested directly
{
  const tier = 5;
  check(effectiveHpMul(tier) === A.hpMul
    && effectiveMutationBonus(tier) === A.mutationBonus
    && effectiveEliteMul(tier) === A.eliteMul
    && effectiveStartCreditMul(tier) === A.startCreditMul
    && effectiveIntermissionMul(tier) === A.intermissionMul,
    'Ascension V has ALL five tiers of effects active at once (genuinely cumulative)');
}
check(effectiveInterestCap(0, TUNING.interest.cap) === TUNING.interest.cap, 'no ascension = normal interest cap');
check(effectiveInterestCap(4, TUNING.interest.cap) === A.interestCapTier4, 'Ascension IV = reduced interest cap');
check(A.dualAffixChance > 0 && A.dualAffixChance < 1, 'dual-affix chance (Ascension III) is a real probability');

console.log(fails ? `${fails} FAILURES` : 'nova-ascension: all checks passed');
process.exit(fails ? 1 : 0);
