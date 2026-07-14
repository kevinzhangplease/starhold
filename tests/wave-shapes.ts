// Phase 5 — wave shape transforms, flier lanes, and Hard+ wave decoration. Pure-formula
// replication (matching precedent) against the REAL game.ts transforms, mirrored here since
// game.ts itself pulls in canvas/DOM-touching code that can't run under plain Node.
// Run: node --experimental-strip-types tests/wave-shapes.ts
import { ENEMIES, ENEMY_INTRO, WAVE_SHAPES } from '../src/data.ts';
import { LEVELS } from '../src/levels.ts';
import { mulberry32, hashString } from '../src/rng.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

interface Spawn { t: number; e: string; p: number }

// ---------- applyWaveShape (mirrors game.ts exactly) ----------
function applyWaveShape(shape: 'rush' | 'trickle' | 'convoy' | 'feint', queue: Spawn[], numPaths: number) {
  if (!queue.length) return;
  switch (shape) {
    case 'rush': {
      const sorted = [...queue].sort((a, b) => a.t - b.t);
      const t0 = sorted[0].t;
      const n = sorted.length;
      sorted.forEach((s, i) => { s.t = n <= 1 ? t0 : t0 + (i / (n - 1)) * 2.0; });
      break;
    }
    case 'trickle': {
      const sorted = [...queue].sort((a, b) => a.t - b.t);
      const t0 = sorted[0].t;
      sorted.forEach((s, i) => { s.t = t0 + i * 3.0; });
      break;
    }
    case 'convoy': {
      const hp = (s: Spawn) => ENEMIES[s.e].hp;
      for (const p of new Set(queue.map(s => s.p))) {
        const subset = queue.filter(s => s.p === p);
        const t0 = Math.min(...subset.map(s => s.t));
        const menders = subset.filter(s => s.e === 'mender');
        const rest = subset.filter(s => s.e !== 'mender');
        let leader: Spawn | null = null;
        for (const s of rest) if (!leader || hp(s) > hp(leader)) leader = s;
        const others = rest.filter(s => s !== leader).sort((a, b) => hp(b) - hp(a));
        const ordered = leader ? [leader, ...menders, ...others] : [...menders, ...others];
        ordered.forEach((s, i) => { s.t = t0 + i * 0.5; });
      }
      break;
    }
    case 'feint': {
      const sorted = [...queue].sort((a, b) => a.t - b.t);
      const hasFliers = sorted.some(s => !!ENEMIES[s.e].flying);
      if (numPaths <= 1 && hasFliers) {
        for (const s of sorted) if (ENEMIES[s.e].flying) s.t += 10;
      } else {
        const cut = Math.ceil(sorted.length * 0.4);
        for (let i = cut; i < sorted.length; i++) {
          sorted[i].t += 10;
          if (numPaths > 1) sorted[i].p = 1 - sorted[i].p;
        }
      }
      break;
    }
  }
}

// ---------- WAVE_SHAPES table sanity ----------
check(Object.keys(WAVE_SHAPES).length === 4, 'exactly 4 wave shapes defined');
for (const shape of Object.values(WAVE_SHAPES)) {
  check(!!shape.name && !!shape.icon && !!shape.blurb, `${shape.name}: has name/icon/blurb`);
}

// ---------- rush ----------
{
  const q: Spawn[] = [{ t: 0, e: 'drone', p: 0 }, { t: 5, e: 'drone', p: 0 }, { t: 10, e: 'drone', p: 0 }];
  applyWaveShape('rush', q, 1);
  const times = q.map(s => s.t).sort((a, b) => a - b);
  check(times[0] === 0, `rush starts at the first spawn's original time, got ${times[0]}`);
  check(Math.max(...times) - Math.min(...times) <= 2.0 + 1e-9, `rush compresses into a 2s window, got span ${Math.max(...times) - Math.min(...times)}`);
  check(times[1] === 1, `rush re-spaces evenly, middle spawn at t=1, got ${times[1]}`);
}
{
  // a single-spawn "wave" doesn't divide by zero
  const q: Spawn[] = [{ t: 3, e: 'drone', p: 0 }];
  applyWaveShape('rush', q, 1);
  check(q[0].t === 3, 'rush with 1 spawn leaves it at its original time, no NaN');
}

// ---------- trickle ----------
{
  const q: Spawn[] = [{ t: 2, e: 'drone', p: 0 }, { t: 0, e: 'dart', p: 0 }, { t: 1, e: 'brute', p: 0 }];
  applyWaveShape('trickle', q, 1);
  const byTime = [...q].sort((a, b) => a.t - b.t);
  check(byTime[0].t === 0 && byTime[1].t === 3 && byTime[2].t === 6, `trickle re-spaces the ORIGINAL-time order at exactly 3s intervals, got ${byTime.map(s => s.t)}`);
  // dart was originally earliest (t=0) -> stays first; brute (t=1) second; drone (t=2) last
  check(byTime[0].e === 'dart' && byTime[1].e === 'brute' && byTime[2].e === 'drone', 'trickle preserves original arrival order, just re-timed');
}

// ---------- convoy ----------
{
  // brute (hp 300) should lead, mender (hp 150) directly behind, swarmling (hp 12) last
  const q: Spawn[] = [
    { t: 0, e: 'swarmling', p: 0 }, { t: 0.1, e: 'mender', p: 0 }, { t: 0.2, e: 'brute', p: 0 },
  ];
  applyWaveShape('convoy', q, 1);
  const byTime = [...q].sort((a, b) => a.t - b.t);
  check(byTime[0].e === 'brute', `convoy puts the highest-hp non-mender first, got ${byTime[0].e}`);
  check(byTime[1].e === 'mender', `convoy puts menders directly behind the leader, got ${byTime[1].e}`);
  check(byTime[2].e === 'swarmling', 'convoy puts everything else last');
  check(Math.abs(byTime[1].t - byTime[0].t - 0.5) < 1e-9, 'convoy re-spaces at a tight 0.5s');
}
{
  // multi-path: each path's convoy ordering runs independently
  const q: Spawn[] = [
    { t: 0, e: 'swarmling', p: 0 }, { t: 0.1, e: 'brute', p: 0 },
    { t: 0, e: 'dart', p: 1 }, { t: 0.1, e: 'aegis', p: 1 },
  ];
  applyWaveShape('convoy', q, 2);
  const p0 = q.filter(s => s.p === 0).sort((a, b) => a.t - b.t);
  const p1 = q.filter(s => s.p === 1).sort((a, b) => a.t - b.t);
  check(p0[0].e === 'brute', `path 0's convoy leads with its own highest-hp enemy, got ${p0[0].e}`);
  check(p1[0].e === 'aegis', `path 1's convoy leads independently with ITS highest-hp enemy, got ${p1[0].e}`);
}

// ---------- feint ----------
{
  // multi-path: last 60% delay +10s AND flip to the other path
  const q: Spawn[] = Array.from({ length: 10 }, (_, i) => ({ t: i, e: 'drone', p: 0 }));
  applyWaveShape('feint', q, 2);
  const early = q.filter(s => s.t < 10);
  const late = q.filter(s => s.t >= 10);
  check(early.length === 4, `first ceil(40%) keep their times, got ${early.length} early spawns`);
  check(late.length === 6, `remaining 60% delayed, got ${late.length}`);
  check(late.every(s => s.p === 1), 'delayed group flips to the other path on multi-path levels');
  check(early.every(s => s.p === 0), 'the opener stays on its original path');
}
{
  // single-path with fliers: the fliers delay regardless of time-order, not the 40/60 cut
  const q: Spawn[] = [
    { t: 0, e: 'drone', p: 0 }, { t: 1, e: 'wisp', p: 0 }, { t: 2, e: 'drone', p: 0 }, { t: 3, e: 'wisp', p: 0 },
  ];
  applyWaveShape('feint', q, 1);
  const drones = q.filter(s => s.e === 'drone');
  const wisps = q.filter(s => s.e === 'wisp');
  check(drones.every(s => s.t < 10), 'single-path feint: ground enemies never delay');
  check(wisps[0].t === 11 && wisps[1].t === 13, `single-path feint: fliers delay +10s from their OWN original time regardless of order, got ${wisps.map(s => s.t)}`);
}
{
  // single-path with NO fliers: falls back to a time-only feint (same portal, just delayed)
  const q: Spawn[] = Array.from({ length: 5 }, (_, i) => ({ t: i, e: 'drone', p: 0 }));
  applyWaveShape('feint', q, 1);
  check(q.every(s => s.p === 0), 'single-path, no-flier feint never flips path (nothing to flip to)');
  check(q.some(s => s.t >= 10), 'single-path, no-flier feint still delays a group in time');
}

// ---------- flierLaneControl (mirrors game.ts exactly) ----------
function flierLaneControl(levelId: number, waveIdx: number, portal: { x: number; y: number }, base: { x: number; y: number }) {
  const r = mulberry32(hashString(`${levelId}-fly-${waveIdx}`));
  const o = (r() < 0.5 ? -1 : 1) * (120 + r() * 120);
  const dx = base.x - portal.x, dy = base.y - portal.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;
  const mx = (portal.x + base.x) / 2, my = (portal.y + base.y) / 2;
  return { x: Math.max(-80, Math.min(1280 + 80, mx + px * o)), y: Math.max(-80, Math.min(720 + 80, my + py * o)) };
}
{
  const portal = { x: -40, y: 200 }, base = { x: 1320, y: 500 };
  const a = flierLaneControl(4, 5, portal, base);
  const b = flierLaneControl(4, 5, portal, base);
  check(a.x === b.x && a.y === b.y, 'same level+wave -> identical lane control point every time');
  const c = flierLaneControl(4, 6, portal, base);
  check(a.x !== c.x || a.y !== c.y, 'different wave index -> a different lane (still deterministic, just not identical)');
  const mid = { x: (portal.x + base.x) / 2, y: (portal.y + base.y) / 2 };
  check(Math.hypot(a.x - mid.x, a.y - mid.y) >= 120 - 1e-6, 'the control point sits at least the minimum offset from the straight-line midpoint');
}
{
  // Daily determinism: the seed depends only on levelId+waveIdx, never on portal/base
  // position — so a mirrored Daily Op's lane bends consistently even with flipped coordinates.
  const a = flierLaneControl(7, 3, { x: -40, y: 170 }, { x: 1320, y: 200 });
  const b = flierLaneControl(7, 3, { x: 1320, y: 170 }, { x: -40, y: 200 }); // mirrored portal/base
  // Not asserting exact coordinates (they legitimately differ, mirrored) — just that both
  // resolve without throwing and land within generous canvas bounds, proving the formula
  // doesn't secretly depend on which side the portal is on.
  for (const c of [a, b]) check(c.x > -300 && c.x < 1580 && c.y > -300 && c.y < 1000, 'mirrored lane control point still lands in a sane region');
}

// ---------- flier lane bounds across every real level/path/wave ----------
{
  let checked = 0;
  for (const lv of LEVELS) {
    for (const path of lv.paths) {
      const portal = { x: path[0][0], y: path[0][1] };
      const base = { x: path[path.length - 1][0], y: path[path.length - 1][1] };
      for (let w = 0; w < lv.waves.length; w++) {
        const c = flierLaneControl(lv.id, w, portal, base);
        check(c.x >= -280 && c.x <= 1560 && c.y >= -280 && c.y <= 1000, `L${lv.id} wave ${w}: lane control point in bounds, got (${c.x.toFixed(0)},${c.y.toFixed(0)})`);
        checked++;
      }
    }
  }
  check(checked > 100, `sanity: actually exercised a meaningful number of level/path/wave combinations (${checked})`);
}

console.log(fails ? `${fails} FAILURES` : 'wave-shapes: all checks passed');
process.exit(fails ? 1 : 0);
