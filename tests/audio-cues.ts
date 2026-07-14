// Phase 7 — audio-as-information formulas: pop() pitch mapping, hullGroan's descending pitch,
// the pressure formula, and the spawn-signature throttle. Pure-formula replication (matching
// precedent) since audio.ts needs a real AudioContext and game.ts pulls in canvas/DOM code,
// neither of which runs under plain Node.
// Run: node --experimental-strip-types tests/audio-cues.ts

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

// ---------- pop(size): widened pitch mapping (Phase 7.4) ----------
function popFreq(size: number): number {
  return Math.max(200, Math.min(1700, 11000 / Math.max(1, size)));
}
check(Math.abs(popFreq(6.5) - 1692.3) < 1, `swarmling (size 6.5) should read bright, ~1.6-1.7kHz, got ${popFreq(6.5)}`);
check(popFreq(26) < popFreq(13), 'bigger enemy -> lower pop pitch (brute < drone)');
check(popFreq(13) < popFreq(6.5), 'bigger enemy -> lower pop pitch (drone < swarmling)');
check(popFreq(200) === 200, 'huge size clamps to the 200Hz floor, never goes below it');
check(popFreq(1) === 1700, 'tiny size clamps to the 1700Hz ceiling');
// monotonicity across every real enemy size in the roster
const sizes = [6.5, 9.5, 10.5, 12, 13, 16, 17, 26];
for (let i = 1; i < sizes.length; i++) {
  check(popFreq(sizes[i]) <= popFreq(sizes[i - 1]), `pop pitch is monotonically non-increasing with size (${sizes[i - 1]} -> ${sizes[i]})`);
}
check(26 >= 20, 'brute-class (size>=20) gets the extra 70Hz sub-thump layer — sanity on the threshold');

// ---------- hullGroan(livesFrac): descending pitch as hull drops (Phase 7.5) ----------
function hullGroanEndF(livesFrac: number): number {
  const clamped = Math.max(0, Math.min(1, livesFrac));
  return 60 + 120 * clamped;
}
check(hullGroanEndF(1) === 180, 'full hull leak ends its descent at 180Hz');
check(hullGroanEndF(0) === 60, 'empty hull leak ends its descent at 60Hz — the sickest note');
check(hullGroanEndF(3 / 20) < hullGroanEndF(18 / 20), 'a leak at 3/20 hull must sound sicker (lower end pitch) than a leak at 18/20');
check(hullGroanEndF(-1) === 60 && hullGroanEndF(2) === 180, 'out-of-range fractions clamp instead of over/undershooting');
// the descent is always FROM 220Hz TO endF — verify the drop is bigger at low hull
const dropAt3 = 220 - hullGroanEndF(3 / 20);
const dropAt18 = 220 - hullGroanEndF(18 / 20);
check(dropAt3 > dropAt18, 'the pitch drop (220 -> endF) is larger at low hull than at high hull');

// ---------- pressure formula (Phase 7.3) ----------
function pressure(waveActive: boolean, lead: number, mass: number): number {
  if (!waveActive) return 0.15;
  return Math.max(0, Math.min(1, 0.25 + 0.55 * lead + 0.2 * mass));
}
check(pressure(false, 0, 0) === 0.15, 'no active wave -> flat baseline 0.15, not zero (still some ambience)');
check(pressure(true, 0, 0) === 0.25, 'wave active but nothing threatening yet -> the 0.25 floor');
check(pressure(true, 1, 1) === 1, 'max lead + max mass clamps at 1 (0.25+0.55+0.2=1.0 exactly)');
check(Math.abs(pressure(true, 0.5, 0.5) - 0.625) < 1e-9, 'mid lead/mass lands at the linear midpoint: 0.25+0.275+0.1=0.625');
check(pressure(true, 1, 0) > pressure(true, 0, 1), 'lead is weighted more heavily than mass (0.55 vs 0.2) — an approaching leader matters more than raw HP total');

// ---------- spawn signature throttle (Phase 7.2) ----------
// Mirrors AudioEngine.spawnSig's two-part gate: same-type coalescing (3s) and a burst cap
// (max 4 distinct plays per 0.5s window), replicated as pure state-machine logic.
function makeThrottle() {
  const lastHeard: Record<string, number> = {};
  let window: number[] = [];
  return (id: string, t: number): boolean => {
    const last = lastHeard[id] ?? -Infinity;
    if (t - last < 3) return false;
    window = window.filter(x => t - x < 0.5);
    if (window.length >= 4) return false;
    window.push(t);
    lastHeard[id] = t;
    return true;
  };
}
{
  const gate = makeThrottle();
  check(gate('drone', 0) === true, 'first signature for a type always plays');
  check(gate('drone', 0.1) === false, 'the same type again within 3s is coalesced (silenced)');
  check(gate('drone', 3.1) === true, 'the same type plays again once 3s have passed');
}
{
  const gate = makeThrottle();
  check(gate('drone', 0) === true, 'burst slot 1');
  check(gate('dart', 0.05) === true, 'burst slot 2');
  check(gate('swarmling', 0.1) === true, 'burst slot 3');
  check(gate('brute', 0.15) === true, 'burst slot 4 (window now full)');
  check(gate('aegis', 0.2) === false, 'a 5th distinct type within the same 0.5s window is capped');
  check(gate('wisp', 0.6) === true, 'once the 0.5s window has rolled forward, a new type gets through again');
}

console.log(fails ? `${fails} FAILURES` : 'audio-cues: all checks passed');
process.exit(fails ? 1 : 0);
