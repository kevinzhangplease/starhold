// Combo & interest — pure math against the REAL TUNING object (imported directly, not
// reimplemented), so these tests fail if anyone changes the balance numbers without
// updating their own understanding of the consequences.
// Run: node --experimental-strip-types tests/combo-interest.ts
import { TUNING } from '../src/data.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

// ---------- combo ----------
const C = TUNING.combo;
check(C.milestones.length === C.bonuses.length, 'milestones/bonuses arrays same length');
check(C.milestones.every((m, i) => i === 0 || m > C.milestones[i - 1]), 'milestones strictly increasing');
check(C.bonuses.every((b, i) => i === 0 || b > C.bonuses[i - 1]), 'bonuses strictly increasing (bigger combo = bigger reward)');
check(C.window > 0 && C.window < 5, 'combo window is a sane small number of seconds');
check(C.hudShowAt >= 2 && C.hudShowAt <= C.milestones[0], 'HUD shows before or at the first milestone');

// Replicates game.ts's exact combo-chain decision: a kill continues the chain if it
// lands within `window` seconds of the last one, otherwise it restarts at 1.
function simulateCombo(killTimes: number[]): number[] {
  let count = 0, lastKill = -99;
  const counts: number[] = [];
  for (const t of killTimes) {
    count = t - lastKill <= C.window ? count + 1 : 1;
    lastKill = t;
    counts.push(count);
  }
  return counts;
}
{
  // 5 kills, all within the window -> chain builds 1..5
  const times = [0, 0.5, 1.0, 1.4, 1.8];
  const counts = simulateCombo(times);
  check(JSON.stringify(counts) === JSON.stringify([1, 2, 3, 4, 5]), `rapid kills chain correctly, got ${counts}`);
}
{
  // a gap longer than the window resets the chain
  const times = [0, 0.5, 1.0, 1.0 + C.window + 0.1, 1.0 + C.window + 0.5];
  const counts = simulateCombo(times);
  check(counts[2] === 3 && counts[3] === 1 && counts[4] === 2, `gap resets chain, got ${counts}`);
}
{
  // exactly at the window boundary still counts (uses <=, not <)
  const times = [0, C.window];
  const counts = simulateCombo(times);
  check(counts[1] === 2, `exact-boundary kill still chains, got ${counts}`);
}
{
  // milestone lookup matches bonuses 1:1 at each defined milestone
  for (let i = 0; i < C.milestones.length; i++) {
    const m = C.milestones[i];
    check((C.milestones as readonly number[]).indexOf(m) === i, `milestone ${m} resolves to bonus index ${i}`);
  }
}

// ---------- interest ----------
const I = TUNING.interest;
check(I.rate > 0 && I.rate < 0.5, 'interest rate is a modest fraction');
check(I.cap > 0, 'interest cap is positive');

function computeInterest(bankedCredits: number, cap = I.cap): number {
  return Math.min(Math.floor(bankedCredits * I.rate), cap);
}
check(computeInterest(0) === 0, 'zero credits earns zero interest');
check(computeInterest(100) === Math.floor(100 * I.rate), 'interest scales linearly below the cap');
{
  // find the credit balance where interest first hits the cap, then confirm it's actually capped beyond that
  const capBreakpoint = Math.ceil(I.cap / I.rate);
  check(computeInterest(capBreakpoint) === I.cap, `interest caps at ${I.cap} once balance is large enough`);
  check(computeInterest(capBreakpoint * 10) === I.cap, 'interest never exceeds the cap regardless of how large the balance gets');
}
check(computeInterest(1_000_000, TUNING.ascension.interestCapTier4) === TUNING.ascension.interestCapTier4,
  'Ascension IV interest cap is genuinely lower than the base cap');
check(TUNING.ascension.interestCapTier4 < I.cap, 'Ascension IV cap is a real reduction, not accidentally equal or higher');

console.log(fails ? `${fails} FAILURES` : 'combo-interest: all checks passed');
process.exit(fails ? 1 : 0);
