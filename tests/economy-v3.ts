// Phase 1 (3.0) economy & scaling foundations — pure math against the REAL TUNING/data
// tables, replicating the exact formulas from game.ts (sell/refundNode/callWave/win/NOVA
// blast/orbital), which live on the stateful Game class and aren't extractable as pure
// functions. Mirrors the pattern established by tests/combo-interest.ts and
// tests/mutators-elites-drops.ts.
// Run: node --experimental-strip-types tests/economy-v3.ts
import { TUNING, ABILITIES, ENEMIES } from '../src/data.ts';
import { LEVELS } from '../src/levels.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

const E = TUNING.economy;
const L1 = LEVELS.find(l => l.id === 1)!;
const L15 = LEVELS.find(l => l.id === 15)!;

// ---------- waveRewardMul / econScale (game.ts Game.waveRewardMul) ----------
function waveRewardMul(levelHpMul: number, diffReward: number, endless = false, waveIdx = 0): number {
  const wi = Math.max(0, waveIdx);
  return (1 + (levelHpMul - 1) * E.bountyCoef + (endless ? wi * 0.05 : 0)) * diffReward;
}

// ---------- drone bounty anchors (1.2) ----------
{
  const drone = ENEMIES.drone;
  check(drone.reward === 8, 'drone base reward is 8 (sanity anchor for the numbers below)');
  const l1Bounty = Math.round(drone.reward * waveRewardMul(L1.hpMul, 1));
  const l15Bounty = Math.round(drone.reward * waveRewardMul(L15.hpMul, 1));
  check(l1Bounty === 8, `L1 Normal drone bounty unchanged at 8 (got ${l1Bounty})`);
  check(l15Bounty === 22, `L15 Normal drone bounty scales to round(8 x 2.78) = 22 (got ${l15Bounty})`);
}

// ---------- sell: undo window vs 72% refund (game.ts Game.sell) ----------
function simulateSell(now: number, builtAt: number, spent: number): { refund: number; undo: boolean; soldAny: boolean } {
  const undo = now - builtAt <= E.sellUndoWindow;
  const refund = undo ? spent : Math.round(spent * E.sellRefund);
  return { refund, undo, soldAny: !undo };
}
{
  const inside = simulateSell(2, 0, 100);
  check(inside.undo && inside.refund === 100, `inside the undo window: full refund (got ${inside.refund})`);
  check(inside.soldAny === false, 'undo does not count as a sale (soldAny stays false — Committed challenge unaffected)');
  const boundary = simulateSell(E.sellUndoWindow, 0, 100);
  check(boundary.undo, 'exactly at the undo window boundary still counts as undo (<=, not <)');
  const outside = simulateSell(E.sellUndoWindow + 0.01, 0, 100);
  check(!outside.undo && outside.refund === 72, `outside the undo window: 72% refund (got ${outside.refund})`);
  check(outside.soldAny === true, 'a real sale (past the undo window) sets soldAny');
}

// ---------- refundNode: full between waves, 72% during (game.ts Game.refundNode) ----------
function simulateRefundNode(fullRefund: number, waveActive: boolean): { payout: number; spentDelta: number } {
  const payout = waveActive ? Math.round(fullRefund * E.refundInWaveMul) : fullRefund;
  return { payout, spentDelta: fullRefund };   // t.spent always drops by the FULL node value
}
{
  const between = simulateRefundNode(150, false);
  check(between.payout === 150, `refund between waves is full (got ${between.payout})`);
  const during = simulateRefundNode(150, true);
  check(during.payout === 108, `refund mid-wave is cut to 72% (round(150*0.72)=108, got ${during.payout})`);
  check(between.spentDelta === during.spentDelta, 't.spent always drops by the full node value regardless of payout cut');
}

// ---------- early-call bonus (game.ts Game.callWave) ----------
function earlyCallBonus(pendingBounty: number, interT: number, early: boolean, auto: boolean): number {
  if (!(early && !auto && interT > 0.5)) return 0;
  const frac = Math.min(E.earlyCallCap, interT * E.earlyCallPerSec);
  return Math.round(pendingBounty * frac);
}
{
  check(earlyCallBonus(1000, 5, true, true) === 0, 'auto-called waves earn zero early-call bonus');
  check(earlyCallBonus(1000, 5, false, false) === 0, 'a late (non-early) call earns zero bonus');
  check(earlyCallBonus(1000, 0.3, true, false) === 0, 'calling with <=0.5s left earns zero bonus');
  const midBonus = earlyCallBonus(1000, 5, true, false);
  check(midBonus === Math.round(1000 * Math.min(E.earlyCallCap, 5 * E.earlyCallPerSec)), `mid-intermission bonus matches the frac formula (got ${midBonus})`);
  // cap engages once interT*perSec exceeds earlyCallCap
  const cappedFrac = 999 * E.earlyCallPerSec;
  check(cappedFrac > E.earlyCallCap, 'sanity: our test interT is large enough to exceed the cap unclamped');
  const cappedBonus = earlyCallBonus(1000, 999, true, false);
  check(cappedBonus === Math.round(1000 * E.earlyCallCap), `bonus is clamped at earlyCallCap (got ${cappedBonus})`);
}

// ---------- interest cap scaling (game.ts Game constructor) ----------
function interestCap(levelId: number, levelHpMul: number, ascTier: number, diffReward = 1): number {
  const scaled = Math.round((TUNING.interest.cap + levelId * 3) * waveRewardMul(levelHpMul, diffReward));
  return ascTier >= 4 ? Math.round(scaled * (TUNING.ascension.interestCapTier4 / TUNING.interest.cap)) : scaled;
}
{
  const l1Cap = interestCap(1, L1.hpMul, 0);
  const l15Cap = interestCap(15, L15.hpMul, 0);
  check(l1Cap > TUNING.interest.cap, `L1 interest cap already exceeds the raw base (level.id offset) (got ${l1Cap})`);
  check(l15Cap > l1Cap * 2, `L15 interest cap is meaningfully larger than L1's — holds relative value against late-campaign costs (L1=${l1Cap}, L15=${l15Cap})`);
  const l15CapAsc4 = interestCap(15, L15.hpMul, 4);
  check(l15CapAsc4 < l15Cap, `Ascension IV halves the (already scaled) L15 cap, not a flat override (asc0=${l15Cap}, asc4=${l15CapAsc4})`);
  check(Math.abs(l15CapAsc4 / l15Cap - 0.5) < 0.01, `the Ascension IV reduction is genuinely a ~half, at any campaign point (ratio=${(l15CapAsc4 / l15Cap).toFixed(3)})`);
}

// ---------- star cut: absolute hull loss, not a fraction (game.ts Game.win) ----------
function starsForLoss(lost: number): number { return lost <= 2 ? 3 : lost <= 8 ? 2 : 1; }
{
  const cases: [number, number][] = [[0, 3], [2, 3], [3, 2], [8, 2], [9, 1]];
  for (const [lost, want] of cases) {
    check(starsForLoss(lost) === want, `losing ${lost} hull should earn ${want} star(s) (got ${starsForLoss(lost)})`);
  }
}

// ---------- NOVA: % current HP, normal vs boss (game.ts NOVA blast application) ----------
function novaDamage(hp: number, isBoss: boolean): number {
  return Math.max(1, Math.round(hp * (isBoss ? TUNING.nova.fracBoss : TUNING.nova.fracNormal)));
}
{
  check(novaDamage(1000, false) === Math.round(1000 * TUNING.nova.fracNormal), 'NOVA normal-enemy damage is fracNormal of current HP');
  check(novaDamage(1000, true) === Math.round(1000 * TUNING.nova.fracBoss), 'NOVA boss damage is fracBoss of current HP');
  check(novaDamage(1000, false) > novaDamage(1000, true), 'NOVA hits normal enemies harder (proportionally) than bosses');
  check(novaDamage(1, false) >= 1, 'NOVA damage is never rounded down to zero on a sliver of HP');
}

// ---------- Orbital Strike scales with the campaign (game.ts Game.currentHpScale) ----------
function currentHpScale(levelHpMul: number, diffHp: number, waveIdx = 0): number {
  return levelHpMul * (1 + waveIdx * 0.03) * diffHp;
}
{
  const base = ABILITIES.orbital.dmg;
  const l1Dmg = Math.round(base * currentHpScale(L1.hpMul, 1));
  const l15Dmg = Math.round(base * currentHpScale(L15.hpMul, 1));
  check(l1Dmg === base, `L1 Normal orbital damage is unchanged at base (${base}) (got ${l1Dmg})`);
  check(l15Dmg > l1Dmg * 5, `L15 orbital damage scales up substantially with the campaign (L1=${l1Dmg}, L15=${l15Dmg})`);
}

console.log(fails ? `${fails} FAILURES` : 'economy-v3: all checks passed');
process.exit(fails ? 1 : 0);
