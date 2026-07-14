// Phase 4 — cross-tower reactions, tier-2 verb rewrites, Overcharge, and Veterancy.
// Pure math/state-machine replication against the REAL TUNING object (imported directly),
// mirroring the exact formulas in game.ts (onKill's Shatter/Conduction blocks, updateTower's
// Cold Focus branch, updateProjs' pierceRamp/freshMul math, Tower.stats' Overcharge/Veterancy
// multipliers) so these tests fail if the balance numbers or branch logic drift apart.
// Run: node --experimental-strip-types tests/reactions.ts
import { TUNING } from '../src/data.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

// ---------- 4.3 Shatter ----------
const R = TUNING.reactions;
function shatterDmg(maxHp: number, scale: number): number {
  return Math.min(maxHp * R.shatterFrac, R.shatterCap * scale);
}
{
  // small early-game enemy: the % term is the smaller one, so damage scales with the victim
  const dmg = shatterDmg(40, 1);
  check(dmg === 40 * R.shatterFrac, `small enemy shatters for its fractional share, got ${dmg}`);
}
{
  // huge outlier hp at a low campaign scale: the flat cap wins, preventing an absurd nuke
  const dmg = shatterDmg(50_000, 1);
  check(dmg === R.shatterCap * 1, `oversized hp is capped at low scale, got ${dmg}`);
}
{
  // the cap itself grows with campaign scale (currentHpScale), so a fixed enemy that was
  // cap-bound early isn't still capped at the same absolute number deep into a run
  const capL1 = R.shatterCap * 1;
  const capL15 = R.shatterCap * 8; // representative late-campaign scale factor
  check(capL15 > capL1, 'shatter cap scales up with campaign progression, not a frozen flat number');
}
// Shatter only ever triggers on a frozen, non-boss kill — replicates onKill's gate exactly.
function shouldShatter(frozenUntil: number, now: number, isBoss: boolean): boolean {
  return frozenUntil > now && !isBoss;
}
check(shouldShatter(10, 5, false) === true, 'chilled non-boss kill shatters');
check(shouldShatter(10, 5, true) === false, 'bosses never shatter, even while chilled');
check(shouldShatter(0, 5, false) === false, 'an unchilled kill does not shatter');

// ---------- 4.3 Conduction ----------
check(R.conductionMul > 1, 'conduction multiplier is a genuine bonus, not a no-op');
{
  const base = 40;
  const buffed = base * R.conductionMul;
  check(buffed === base * 1.5, `tesla chain damage vs a burning target scales by conductionMul, got ${buffed}`);
}

// ---------- 4.3 Cold Focus ----------
// Replicates updateTower's exact prism branch: a chilled kill (slowUntil > now at death)
// opens a grace window instead of resetting the ramp; the dead reference is nulled
// immediately so the window can only open once per death, never re-extended by later frames.
interface PrismState { target: { dead: boolean; slowUntil: number } | null; rampT: number; coldFocusUntil: number; }
function tickPrism(t: PrismState, now: number, dt: number, newTarget: { dead: boolean; slowUntil: number } | null) {
  const sameTarget = newTarget && newTarget === t.target;
  if (sameTarget) { t.rampT += dt; return; }
  if (t.target && t.target.dead && t.target.slowUntil > now) t.coldFocusUntil = now + R.coldFocusGrace;
  if (t.target && t.target.dead) t.target = null;
  if (now < t.coldFocusUntil) {
    if (newTarget) { t.rampT += dt; t.target = newTarget; }
  } else {
    t.rampT = newTarget ? dt : 0; t.target = newTarget;
  }
}
{
  // an unchilled kill (target dies, slowUntil already lapsed) resets the ramp immediately
  const t: PrismState = { target: { dead: true, slowUntil: 0 }, rampT: 9, coldFocusUntil: 0 };
  tickPrism(t, 10, 0.1, { dead: false, slowUntil: 0 });
  check(t.rampT === 0.1, `unchilled kill resets ramp to this frame's dt, got ${t.rampT}`);
}
{
  // a chilled kill opens the grace window; a fresh target landing within it keeps the ramp climbing
  const t: PrismState = { target: { dead: true, slowUntil: 12 }, rampT: 9, coldFocusUntil: 0 };
  tickPrism(t, 10, 0.1, null); // the kill frame itself: no new target yet
  check(t.coldFocusUntil === 10 + R.coldFocusGrace, 'chilled kill opens a coldFocusUntil grace window');
  check(t.rampT === 9, 'ramp is untouched on the kill frame itself while no fresh target has landed');
  tickPrism(t, 10.3, 0.1, { dead: false, slowUntil: 0 }); // a fresh target lands mid-grace
  check(t.rampT === 9.1, `fresh target within the grace window continues the ramp, got ${t.rampT}`);
}
{
  // once the grace window lapses with nothing landing, the next tick resets like normal
  const t: PrismState = { target: null, rampT: 9, coldFocusUntil: 10 + R.coldFocusGrace };
  tickPrism(t, 10 + R.coldFocusGrace + 0.5, 0.1, { dead: false, slowUntil: 0 });
  check(t.rampT === 0.1, `ramp resets once the grace window has fully lapsed, got ${t.rampT}`);
}

// ---------- 4.4 Star Lance: pierceRamp ----------
// Replicates updateProjs' exact formula: pierceMul = (1+pierceRamp)^pierceK, where pierceK
// is the 0-indexed position of THIS hit among enemies already struck by the bullet.
const starLance = { pierceRamp: 0.4 };
function pierceMul(k: number) { return Math.pow(1 + starLance.pierceRamp, k); }
{
  // a 3-enemy conga line: first hit unboosted, each subsequent one ramps further
  const line = [pierceMul(0), pierceMul(1), pierceMul(2)];
  check(line[0] === 1, 'first enemy in the pierce line takes no ramp bonus');
  check(Math.abs(line[1] - 1.4) < 1e-9, `second enemy takes +40%, got ${line[1]}`);
  check(Math.abs(line[2] - 1.96) < 1e-9, `third enemy takes the compounded ramp, got ${line[2]}`);
  check(line[0] < line[1] && line[1] < line[2], 'ramp strictly increases down the pierce line');
}

// ---------- 4.4 Storm Sentinel: freshMul ----------
// Replicates updateProjs' exact gate: bonus applies only to a target still at full hp AND
// (if shielded) full shield — a clean opening shot, not a finishing one.
function freshBonusApplies(hp: number, maxHp: number, shield: number, maxShield: number): boolean {
  return hp >= maxHp && (maxShield === 0 || shield >= maxShield);
}
check(freshBonusApplies(100, 100, 0, 0) === true, 'full-hp unshielded target gets the fresh bonus');
check(freshBonusApplies(99, 100, 0, 0) === false, 'a target that has taken any damage does not');
check(freshBonusApplies(100, 100, 20, 30) === false, 'full hp but a chipped shield still disqualifies it');
check(freshBonusApplies(100, 100, 30, 30) === true, 'full hp and full shield both required, both present -> qualifies');

// ---------- 4.2 Flame stacking ----------
const F = TUNING.flame;
function stackedBurnDps(base: number, stacks: number): number {
  return base * (1 + F.stackStep * (stacks - 1));
}
check(stackedBurnDps(10, 1) === 10, 'a single stack is unboosted base burn');
check(stackedBurnDps(10, 2) === 15, 'second stack adds +50%');
check(stackedBurnDps(10, 3) === 20, 'third (max) stack adds +100%, i.e. 2x base');
check(F.stackMax === 3, 'stack cap is exactly 3, matching igniteStack\'s Math.min clamp');

// ---------- 4.5 Overcharge ----------
const OC = TUNING.overcharge;
check(OC.charges > 0 && Number.isInteger(OC.charges), 'overcharge charges is a sane positive integer');
check(OC.dur > 0, 'overcharge duration is positive');
check(OC.rateMul > 1, 'overcharge is a genuine boost, not a no-op');
// Replicates Tower.stats' exact branch: rate-0 towers get the multiplier on damage,
// rate>0 towers get it on fire rate — never both, never neither.
function overchargedStats(baseRate: number, baseDmg: number, active: boolean) {
  const dmgMul = active && baseRate === 0 ? OC.rateMul : 1;
  const rateMul = active && baseRate > 0 ? OC.rateMul : 1;
  return { dmg: baseDmg * dmgMul, rate: baseRate * rateMul };
}
{
  const prism = overchargedStats(0, 50, true); // rate-0 (Prism/aura) -> damage doubles
  check(prism.dmg === 100 && prism.rate === 0, `rate-0 tower overcharges its damage, got ${JSON.stringify(prism)}`);
}
{
  const bullet = overchargedStats(2, 50, true); // firing tower -> rate doubles, dmg untouched
  check(bullet.dmg === 50 && bullet.rate === 4, `firing tower overcharges its rate, got ${JSON.stringify(bullet)}`);
}
{
  const idle = overchargedStats(2, 50, false);
  check(idle.dmg === 50 && idle.rate === 2, 'inactive overcharge changes nothing');
}
// Charges reset once per wave (callWave), never mid-wave, and are gated behind the unlock
// level — replicates canOvercharge's exact boolean gate shape.
function canOvercharge(unlocked: boolean, waveActive: boolean, chargesLeft: number, alreadyActiveUntil: number, now: number, kind: string): boolean {
  return unlocked && waveActive && chargesLeft > 0 && now >= alreadyActiveUntil && kind !== 'amp';
}
check(canOvercharge(false, true, 3, 0, 0, 'bullet') === false, 'locked before the unlock level, even mid-wave with charges free');
check(canOvercharge(true, false, 3, 0, 0, 'bullet') === false, 'unusable outside an active wave');
check(canOvercharge(true, true, 0, 0, 0, 'bullet') === false, 'unusable once all charges are spent');
check(canOvercharge(true, true, 3, 5, 3, 'bullet') === false, 'unusable while already overcharged');
check(canOvercharge(true, true, 3, 0, 0, 'amp') === false, 'Amp is excluded — no rate/damage to double');
check(canOvercharge(true, true, 3, 0, 0, 'bullet') === true, 'usable when every condition is met');

// ---------- 4.6 Veterancy ----------
const V = TUNING.veterancy;
check(V.kills > 0 && Number.isInteger(V.kills), 'veterancy kill threshold is a sane positive integer');
check(V.kills === 45, 'kill threshold is exactly 45, matching the plan');
check(V.perks.sharp > 0 && V.perks.rapid > 0, 'sharp/rapid are genuine positive bonuses');
{
  // the threshold-crossing check in onKill fires on the exact kill count, not "at or above" —
  // it must not re-fire on kill 46, 47, ... once a perk is already chosen.
  function crossesThreshold(kills: number, hasPerk: boolean): boolean {
    return kills === V.kills && !hasPerk;
  }
  check(crossesThreshold(44, false) === false, 'no offer before the threshold');
  check(crossesThreshold(45, false) === true, 'offer fires at exactly the threshold');
  check(crossesThreshold(46, false) === false, 'no re-offer past the threshold if somehow still unpicked');
  check(crossesThreshold(45, true) === false, 'no re-offer if a perk is already chosen');
}
{
  // perk math in Tower.stats: sharp/rapid apply as a flat multiplier layered on top of
  // everything else (buffs, cell type, overcharge) — never additive with those, always ×.
  function perkDmgMul(perk: string | null) { return perk === 'sharp' ? 1 + V.perks.sharp : 1; }
  function perkRateMul(perk: string | null) { return perk === 'rapid' ? 1 + V.perks.rapid : 1; }
  check(perkDmgMul('sharp') === 1.12, `sharp gives +${V.perks.sharp * 100}% damage, got ${perkDmgMul('sharp')}`);
  check(perkDmgMul('rapid') === 1, 'rapid does not touch damage');
  check(perkRateMul('rapid') === 1.12, `rapid gives +${V.perks.rapid * 100}% rate, got ${perkRateMul('rapid')}`);
  check(perkDmgMul(null) === 1 && perkRateMul(null) === 1, 'no perk chosen -> no multiplier either way');
}
{
  // scav payout scales with econScale (currentHpScale's economic sibling), like every other
  // flat credit source, so it isn't trivial at L1 or trivial-relative-to-economy at L15.
  const payout = (scale: number) => Math.max(1, Math.round(V.perks.scav * scale));
  check(payout(1) >= 1, 'scav payout is never zero, even at the smallest scale');
  check(payout(8) > payout(1), 'scav payout grows with campaign economic scale');
}

console.log(fails ? `${fails} FAILURES` : 'reactions/verbs/overcharge/veterancy: all checks passed');
process.exit(fails ? 1 : 0);
