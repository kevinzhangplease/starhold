// Phase 6.4 — threat readout: DPS model spot values, coverage counting, verdict thresholds,
// and the air/ground domain split. Pure-formula replication (matching precedent) against the
// REAL TUNING object, mirroring game.ts's towerDPS/groundCov/airCov/computeThreat exactly,
// since game.ts itself pulls in canvas/DOM code that can't run under plain Node.
// Run: node --experimental-strip-types tests/threat-readout.ts
import { TUNING } from '../src/data.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

// ---------- towerDPS (mirrors game.ts's Game.towerDPS exactly) ----------
interface S { dmg: number; rate: number; crit?: number; pierce?: number; pierceRamp?: number; cluster?: number;
  shots?: number; chains?: number; rampMax?: number; beams?: number; burnDps?: number; burnDur?: number;
  groundOnly?: boolean; airMul?: number; aura?: boolean; }
function towerDPS(kind: string, s: S): { ground: number; air: number } {
  let base = 0;
  if (s.aura) {
    base = s.dmg;
  } else {
    switch (kind) {
      case 'bullet':
      case 'cryo': {
        base = s.dmg * s.rate * (1 + (s.crit || 0) * 1.5);
        if (s.pierceRamp) base *= 1.8;
        else if (s.pierce) base *= 1.6;
        break;
      }
      case 'mortar': {
        base = s.dmg * s.rate * 1.4;
        if (s.cluster) base *= 1 + 0.3 * s.cluster;
        break;
      }
      case 'missile': base = s.dmg * s.rate * (1 + (s.shots ? s.shots - 1 : 0)) * 1.2; break;
      case 'tesla': base = s.dmg * s.rate * (1 + 0.6 * (s.chains || 0)); break;
      case 'prism': {
        base = s.dmg * (s.rampMax || 1) * 0.6;
        if (s.beams && s.beams > 1) base *= 1 + (s.beams - 1) * 0.8;
        break;
      }
      case 'ray': base = s.dmg * s.rate * 1.8; break;
      case 'flame': base = s.dmg * s.rate; break;
      case 'amp': base = 0; break;
    }
  }
  if (s.burnDps) base += s.burnDps * Math.min(1, (s.burnDur || 0) * s.rate);
  const ground = base;
  const air = s.groundOnly ? 0 : base * (s.airMul || 1);
  return { ground, air };
}

// ---------- spot values ----------
{
  const dps = towerDPS('bullet', { dmg: 10, rate: 2 });
  check(dps.ground === 20, `plain bullet: 10dmg x 2rate = 20, got ${dps.ground}`);
  check(dps.air === 20, 'no airMul -> air equals ground for a non-groundOnly bullet');
}
{
  const dps = towerDPS('bullet', { dmg: 10, rate: 2, crit: 0.2 });
  check(Math.abs(dps.ground - 26) < 1e-9, `crit adds (crit*1.5) as a multiplier: 20*(1+0.3)=26, got ${dps.ground}`);
}
{
  const withPierce = towerDPS('bullet', { dmg: 10, rate: 2, pierce: 2 });
  check(Math.abs(withPierce.ground - 32) < 1e-9, `pierce -> x1.6: 20*1.6=32, got ${withPierce.ground}`);
  const withRamp = towerDPS('bullet', { dmg: 10, rate: 2, pierceRamp: 0.4, pierce: 3 });
  check(Math.abs(withRamp.ground - 36) < 1e-9, `pierceRamp takes priority over pierce -> x1.8: 20*1.8=36, got ${withRamp.ground}`);
}
{
  const dps = towerDPS('mortar', { dmg: 20, rate: 1 });
  check(Math.abs(dps.ground - 28) < 1e-9, `mortar splash factor: 20*1*1.4=28, got ${dps.ground}`);
  const withCluster = towerDPS('mortar', { dmg: 20, rate: 1, cluster: 2 });
  check(Math.abs(withCluster.ground - 44.8) < 1e-9, `cluster adds 0.3xcluster: 28*(1+0.6)=44.8, got ${withCluster.ground}`);
}
{
  const dps = towerDPS('missile', { dmg: 15, rate: 1, shots: 3 });
  check(Math.abs(dps.ground - 54) < 1e-9, `missile shots: 15*1*(1+2)*1.2=54, got ${dps.ground}`);
}
{
  const dps = towerDPS('tesla', { dmg: 8, rate: 2, chains: 3 });
  check(Math.abs(dps.ground - 44.8) < 1e-9, `tesla chains: 8*2*(1+1.8)=44.8, got ${dps.ground}`);
}
{
  const dps = towerDPS('prism', { dmg: 12, rate: 0, rampMax: 3 });
  check(Math.abs(dps.ground - 21.6) < 1e-9, `prism ramp: 12*3*0.6=21.6, got ${dps.ground}`);
  const withBeams = towerDPS('prism', { dmg: 12, rate: 0, rampMax: 3, beams: 3 });
  check(Math.abs(withBeams.ground - 56.16) < 1e-9, `prism beams: 21.6*(1+2*0.8)=56.16, got ${withBeams.ground}`);
}
{
  const dps = towerDPS('ray', { dmg: 6, rate: 4 });
  check(Math.abs(dps.ground - 43.2) < 1e-9, `ray: 6*4*1.8=43.2, got ${dps.ground}`);
}
{
  const dps = towerDPS('aura', { dmg: 14, rate: 0, aura: true } as any);
  check(dps.ground === 14, `aura DPS is just dmg (already per-second), got ${dps.ground}`);
}
{
  const dps = towerDPS('amp', { dmg: 999, rate: 999 });
  check(dps.ground === 0 && dps.air === 0, 'amp contributes 0 directly — its value flows through buffed OTHER towers');
}
{
  const dps = towerDPS('bullet', { dmg: 10, rate: 2, burnDps: 5, burnDur: 3 });
  check(Math.abs(dps.ground - (20 + 5)) < 1e-9, `burn adds burnDps*min(1,burnDur*rate)=5*min(1,6)=5: got ${dps.ground}`);
  const shortBurn = towerDPS('bullet', { dmg: 10, rate: 0.1, burnDps: 5, burnDur: 3 });
  const expected = 10 * 0.1 + 5 * Math.min(1, 3 * 0.1);
  check(Math.abs(shortBurn.ground - expected) < 1e-9, `burn caps at min(1,...) for a slow-firing tower, got ${shortBurn.ground} expected ${expected}`);
}

// ---------- air/ground domain split ----------
{
  const groundOnly = towerDPS('bullet', { dmg: 10, rate: 2, groundOnly: true });
  check(groundOnly.air === 0, 'groundOnly tower contributes exactly 0 air DPS');
  check(groundOnly.ground === 20, 'groundOnly still contributes full ground DPS');
}
{
  const withAirMul = towerDPS('missile', { dmg: 10, rate: 1, airMul: 2 });
  check(withAirMul.air === withAirMul.ground * 2, 'airMul multiplies the air domain only, ground stays base');
}

// ---------- coverage (mirrors Game.groundCov / a simplified airCov) ----------
function groundCov(pathCellsInRange: number): number {
  return Math.min(1, pathCellsInRange / TUNING.threat.coveragePathCells);
}
check(groundCov(0) === 0, 'zero path cells in range -> zero ground coverage');
check(groundCov(TUNING.threat.coveragePathCells) === 1, 'exactly the threshold -> full coverage');
check(groundCov(TUNING.threat.coveragePathCells * 2) === 1, 'coverage never exceeds 1 (more than enough cells)');
check(Math.abs(groundCov(TUNING.threat.coveragePathCells / 2) - 0.5) < 1e-9, 'coverage scales linearly below the threshold');

function laneCov(inRange: number): number {
  return Math.min(1, inRange / TUNING.threat.coverageLanePts);
}
check(laneCov(0) === 0, 'no lane sample points in range -> zero air coverage');
check(laneCov(TUNING.threat.coverageLanePts) === 1, 'exactly the lane-point threshold -> full air coverage');
check(laneCov(TUNING.threat.coverageLanePts * 5) === 1, 'air coverage never exceeds 1');

// ---------- verdict thresholds (mirrors computeThreat's classification) ----------
function verdict(r: number): 'comfortable' | 'tight' | 'leak' {
  const T = TUNING.threat;
  return r >= T.comfortable ? 'comfortable' : r >= T.tight ? 'tight' : 'leak';
}
check(verdict(TUNING.threat.comfortable) === 'comfortable', 'exactly at the comfortable threshold -> Comfortable');
check(verdict(TUNING.threat.comfortable + 1) === 'comfortable', 'well above comfortable -> Comfortable');
check(verdict(TUNING.threat.tight) === 'tight', 'exactly at the tight threshold -> Tight');
check(verdict((TUNING.threat.comfortable + TUNING.threat.tight) / 2) === 'tight', 'between tight and comfortable -> Tight');
check(verdict(TUNING.threat.tight - 0.01) === 'leak', 'just below tight -> Likely leak');
check(verdict(0) === 'leak', 'zero deliverable vs any demand -> Likely leak');

// ---------- verdict = worst of the two domains ----------
function worstVerdict(rGround: number | null, rAir: number | null): ReturnType<typeof verdict> {
  const ratios = [rGround, rAir].filter((r): r is number => r !== null);
  const worst = ratios.length ? Math.min(...ratios) : 1;
  return verdict(worst);
}
check(worstVerdict(3.0, 0.5) === 'leak', 'great ground coverage does not rescue a leaking air domain');
check(worstVerdict(3.0, null) === 'comfortable', 'a domain with zero demand (null) is skipped, not counted as a failure');
check(worstVerdict(null, null) === 'tight', 'no demand in either domain (should not happen with a real wave) falls back to the neutral worst=1 ratio, not to leak');

// ---------- shape-adjusted efficiency (mirrors computeThreat's shape branch) ----------
function shapedEfficiency(shape: string | null): number {
  const base = TUNING.threat.efficiency;
  if (shape === 'rush') return base * 0.8;
  if (shape === 'trickle') return base * 1.15;
  return base;
}
check(shapedEfficiency(null) === TUNING.threat.efficiency, 'unshaped wave uses the baseline efficiency');
check(shapedEfficiency('rush') < TUNING.threat.efficiency, 'rush wastes DPS (simultaneity) -> lower efficiency');
check(shapedEfficiency('trickle') > TUNING.threat.efficiency, 'trickle wastes nothing (sequential) -> higher efficiency');
check(shapedEfficiency('convoy') === TUNING.threat.efficiency, 'convoy is neutral (targeting order, not throughput)');
check(shapedEfficiency('feint') === TUNING.threat.efficiency, 'feint is neutral (timing, not throughput)');

console.log(fails ? `${fails} FAILURES` : 'threat-readout: all checks passed');
process.exit(fails ? 1 : 0);
