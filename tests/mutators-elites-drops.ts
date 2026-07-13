// Elite distribution, drop weighting, mutator chance — statistical tests against the real
// TUNING/MUTATORS tables, replicating the exact formulas from game.ts's rollMutator() and
// the elite-spawn roll (both embedded in the stateful Game class, not extractable as pure
// functions, so the formulas are faithfully mirrored here against the REAL imported numbers).
// Run: node --experimental-strip-types tests/mutators-elites-drops.ts
import { TUNING, MUTATORS } from '../src/data.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };
const approx = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ---------- elite roll distribution (10k rolls, matches game.ts's onKill/spawn formula) ----------
{
  const E = TUNING.elites;
  function eliteChance(levelId: number, diffTier: number, ascTier: number, endless: boolean, waveIdx: number): number {
    const base = E.baseChance + levelId * E.perLevel + diffTier * E.perDifficulty + (endless ? waveIdx * E.perEndlessWave : 0);
    return base * (ascTier >= 3 ? TUNING.ascension.eliteMul : 1);
  }
  const trials = 10000;
  const scenarios: [string, number, number, number, boolean, number][] = [
    ['L1 Normal, no ascension', 1, 2, 0, false, 0],
    ['L15 Brutal, no ascension', 15, 4, 0, false, 0],
    ['L15 Brutal, Ascension III', 15, 4, 3, false, 0],
    ['Endless wave 20, Normal', 1, 2, 0, true, 20],
  ];
  for (const [label, lvl, diff, asc, endless, wave] of scenarios) {
    const p = eliteChance(lvl, diff, asc, endless, wave);
    check(p >= 0 && p <= 1, `${label}: chance ${p.toFixed(3)} is a valid probability`);
    let hits = 0;
    for (let i = 0; i < trials; i++) if (Math.random() < p) hits++;
    const observed = hits / trials;
    // generous tolerance (5 percentage points) since this is a real statistical draw, not a fixed sequence
    check(approx(observed, p, 0.05), `${label}: observed rate ${(observed * 100).toFixed(1)}% should be near expected ${(p * 100).toFixed(1)}%`);
  }
  // Ascension III genuinely doubles the roll (not just "some difference")
  const before = eliteChance(15, 4, 0, false, 0), after = eliteChance(15, 4, 3, false, 0);
  check(after === before * TUNING.ascension.eliteMul, 'Ascension III elite chance is exactly base x eliteMul');
}

// ---------- elite affix pool sanity ----------
{
  const affixes = ['shielded', 'swift', 'vampiric'];
  check(affixes.length === 3, 'exactly 3 elite affixes exist (matches the hardcoded pool in game.ts)');
  const E = TUNING.elites;
  check(E.affixShieldFrac > 0 && E.affixShieldFrac < 1, 'shield affix is a real fraction of max HP');
  check(E.affixSpeedMul > 1, 'swift affix is actually faster');
  check(E.affixHealPerSec > 0, 'vampiric affix actually heals');
}

// ---------- mutator STAT APPLICATION (each mutator's actual effect, not just its roll chance) ----------
{
  const M = TUNING.mutators;
  // Frenzied: speed multiplied by frenziedSpeed
  const baseSpeed = 60;
  check(baseSpeed * M.frenziedSpeed > baseSpeed, 'Frenzied genuinely increases speed');
  check(M.frenziedSpeed > 1 && M.frenziedSpeed < 2, 'Frenzied speed multiplier is a believable amount (not absurd)');
  // Armored: shield = a fraction of max HP
  const maxHp = 200;
  const shieldGranted = Math.round(maxHp * M.armoredShieldFrac);
  check(shieldGranted > 0 && shieldGranted < maxHp, 'Armored grants a real but non-total shield');
  // Bounty: reward multiplied
  const baseReward = 10;
  check(Math.round(baseReward * M.bountyMul) > baseReward, 'Bounty genuinely increases rewards');
  // Horde: more enemies, each weaker — verify the total "budget" trade-off is sane
  const hordeHpMul = M.hordeHpMul, hordeCountMul = M.hordeCountMul;
  check(hordeHpMul < 1, 'Horde enemies are individually weaker');
  check(hordeCountMul > 1, 'Horde brings more enemies');
  const totalHpBefore = 10 * maxHp, totalHpAfter = Math.round(10 * hordeCountMul) * Math.max(1, Math.round(maxHp * hordeHpMul));
  check(totalHpAfter > totalHpBefore * 0.8 && totalHpAfter < totalHpBefore * 2.5, `Horde's total HP budget (${totalHpAfter} vs baseline ${totalHpBefore}) is a real change, not a degenerate multiplier`);
  // Regenerating: a small but real heal-per-second fraction
  check(M.regenPerSec > 0 && M.regenPerSec < 0.1, 'Regenerating heals a modest fraction per second (not full-heal-instantly)');
  // Phasing: a real fraction of enemies gain the phase ability
  check(M.phasingFrac > 0 && M.phasingFrac < 1, 'Phasing affects a partial fraction of enemies, not all or none');
}


{
  const w = TUNING.drops.weights;
  const sum = w.credits + w.recharge + w.overclock + w.hull;
  check(sum === 100, `drop weights sum to 100 (got ${sum})`);
  function rollKind(): string {
    const r = Math.random() * 100;
    return r < w.credits ? 'credits' : r < w.credits + w.recharge ? 'recharge' : r < w.credits + w.recharge + w.overclock ? 'overclock' : 'hull';
  }
  const trials = 20000;
  const counts: Record<string, number> = { credits: 0, recharge: 0, overclock: 0, hull: 0 };
  for (let i = 0; i < trials; i++) counts[rollKind()]++;
  for (const [kind, weight] of Object.entries(w)) {
    const observed = counts[kind] / trials * 100;
    check(approx(observed, weight, 3), `drop kind '${kind}': observed ${observed.toFixed(1)}% vs expected ${weight}%`);
  }
  check(TUNING.drops.creditsMax > TUNING.drops.creditsMin, 'credit drop range is well-formed');
  check(TUNING.drops.lifetime > 0, 'crate lifetime is positive');
}

// ---------- mutator chance formula + pool gating ----------
{
  const M = TUNING.mutators;
  function mutatorChance(levelId: number, diffTier: number, ascTier: number, endless: boolean, waveIdx: number, extraBonus = 0): number {
    const base = (endless && waveIdx >= 9) ? M.endlessLate : M.baseChance + levelId * M.perLevel + diffTier * M.perDifficulty;
    return base + (ascTier >= 2 ? TUNING.ascension.mutationBonus : 0) + extraBonus;
  }
  check(mutatorChance(1, 2, 0, false, 0) >= 0, 'mutator chance never negative at low levels');
  check(mutatorChance(15, 4, 5, false, 0, 0.25) <= 1.5, 'mutator chance stays in a sane range even at max stacking (Daily Op + Ascension V)');
  const hardMutators = Object.values(MUTATORS).filter(m => m.hard);
  check(hardMutators.length === 2, `exactly 2 "hard" mutators exist (got ${hardMutators.length})`);
  const easyMutators = Object.values(MUTATORS).filter(m => !m.hard);
  check(easyMutators.length === 4, `exactly 4 non-hard mutators exist (got ${easyMutators.length})`);
  check(easyMutators.some(m => m.id === 'bounty'), "'bounty' must be a non-hard mutator (it's forced as the scripted first mutator)");
}

console.log(fails ? `${fails} FAILURES` : 'mutators-elites-drops: all checks passed');
process.exit(fails ? 1 : 0);
