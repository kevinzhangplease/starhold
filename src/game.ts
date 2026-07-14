// ================= Starhold engine (unified grid, top-down) =================
import { TOWERS, ENEMIES, ABILITIES, ZONES, LANDMARKS, LandmarkSpec, PALETTE, TowerSpec, StageStats, EnemySpec, TUNING, isUnlocked, MUTATORS, MODIFIER_INFO, fmt, WaveShape, WAVE_SHAPES, ENEMY_INTRO } from './data';
import { LevelSpec, WaveGroup } from './levels';
import { mulberry32, hashString, seededInt } from './rng';
import { audio } from './audio';

export const W = 1280, H = 720;

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

// Quadratic Bezier helpers (Phase 5.4 flier lanes). p0/p1 are the curve's endpoints (portal/
// base), c is the single control point that bends the path.
function bezierAt(p0x: number, p0y: number, cx: number, cy: number, p1x: number, p1y: number, t: number) {
  const mt = 1 - t;
  return { x: mt * mt * p0x + 2 * mt * t * cx + t * t * p1x, y: mt * mt * p0y + 2 * mt * t * cy + t * t * p1y };
}
function bezierTangentAngle(p0x: number, p0y: number, cx: number, cy: number, p1x: number, p1y: number, t: number) {
  const mt = 1 - t;
  const dx = 2 * mt * (cx - p0x) + 2 * t * (p1x - cx);
  const dy = 2 * mt * (cy - p0y) + 2 * t * (p1y - cy);
  return Math.atan2(dy, dx);
}
// Approximated arc length via a 16-segment polyline — accurate enough to keep flight speed
// visually consistent regardless of how sharply the lane bends.
function bezierArcLen(p0x: number, p0y: number, cx: number, cy: number, p1x: number, p1y: number, steps = 16): number {
  let len = 0;
  let prev = bezierAt(p0x, p0y, cx, cy, p1x, p1y, 0);
  for (let i = 1; i <= steps; i++) {
    const cur = bezierAt(p0x, p0y, cx, cy, p1x, p1y, i / steps);
    len += dist(prev.x, prev.y, cur.x, cur.y);
    prev = cur;
  }
  return len;
}

// Evenly resample a level's wave list to a different length (game-length setting).
// Always keeps the final (boss) wave last.
function resampleWaves<T>(waves: T[], factor: number): T[] {
  const L = waves.length;
  const N = Math.max(3, Math.round(L * factor));
  if (N === L || L === 0) return waves;
  const out: T[] = [];
  for (let i = 0; i < N; i++) out.push(waves[Math.round(i * (L - 1) / Math.max(1, N - 1))]);
  return out;
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// Horizontal mirror for Daily Op: flips a path's pixel waypoints left-right. Endpoint
// x-values don't actually matter (buildGrid always pins them to the off-grid sentinel
// columns), so a plain per-point flip is sufficient and keeps portal-left/base-right intact.
function mirrorPts(pts: number[][]): number[][] {
  // Flipping x alone isn't enough: the engine always pins the FIRST waypoint to the
  // off-grid-left portal column and the LAST to the off-grid-right base column. A pure
  // per-point x-flip keeps the original traversal order, which reverses the shape's
  // natural left-to-right flow and fights that fixed convention — producing a path that
  // self-crosses. Reversing the point order after flipping restores a proper mirror image
  // that still starts near the left and ends near the right, matching the convention.
  return pts.map(([x, y]) => [W - x, y]).reverse();
}

// ---------- meander (path directness) ----------
interface CPt { c: number; r: number; }
const ptKey = (p: CPt) => `${p.c},${p.r}`;
// Inserts a corner point wherever two consecutive points differ on both axes,
// so the result stays a strictly rectilinear (grid-aligned) polyline.
function rectilinearize(pts: CPt[]): CPt[] {
  const out: CPt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    const next = pts[i];
    if (prev.c !== next.c && prev.r !== next.r) out.push({ c: next.c, r: prev.r });
    out.push(next);
  }
  return out;
}
// Every tile visited walking a strictly-rectilinear polyline, in order (duplicates kept).
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
// Builds one candidate zigzag detour between a and b at the given bump count/depth.
function buildBumps(a: CPt, b: CPt, bumps: number, depth: number, cols: number, rows: number): CPt[] {
  const horiz = a.r === b.r;
  const total = horiz ? b.c - a.c : b.r - a.r;
  const dir = Math.sign(total);
  const mainLen = Math.abs(total);
  const baseline = horiz ? a.r : a.c;
  const raw: CPt[] = [a];
  let sign = 1;
  for (let i = 1; i <= bumps; i++) {
    const travelled = Math.round((mainLen * i) / (bumps + 1));
    const mainCoord = (horiz ? a.c : a.r) + dir * travelled;
    const offRaw = baseline + depth * sign;
    const off = horiz ? clamp(offRaw, 1, rows - 2) : clamp(offRaw, 1, cols - 2);
    raw.push(horiz ? { c: mainCoord, r: off } : { c: off, r: mainCoord });
    sign *= -1;
  }
  raw.push(b);
  return rectilinearize(raw);
}
// Replaces one straight a→b run with a zigzagging detour when `tier` > 0 and the run is
// long enough — more/deeper zigzags at higher tiers. `forbidden` is every tile the path's
// original spine ever needs (past AND future segments) plus every tile any other detour has
// already claimed, so a bump can never cross or backtrack over any part of the path — not
// even a part that hasn't been walked yet. Falls back to progressively gentler detours, and
// finally the plain straight line, rather than ever risk a self-crossing path.
function meanderSegment(a: CPt, b: CPt, tier: number, cols: number, rows: number, forbidden: Set<string>): CPt[] {
  const straight = [a, b];
  if (tier <= 0 || (a.c !== b.c && a.r !== b.r)) return straight;
  const horiz = a.r === b.r;
  const mainLen = Math.abs(horiz ? b.c - a.c : b.r - a.r);
  const minLen = tier >= 2 ? 5 : 7;
  if (mainLen < minLen) return straight;

  const maxBumps = tier >= 2 ? Math.max(2, Math.round(mainLen / 4)) : Math.max(1, Math.round(mainLen / 6));
  const maxDepth = tier >= 2 ? 2 : 1;

  // Try the full detour first, then ease off bumps/depth, then give up and go straight.
  for (let depth = maxDepth; depth >= 1; depth--) {
    for (let bumps = maxBumps; bumps >= 1; bumps--) {
      const candidate = buildBumps(a, b, bumps, depth, cols, rows);
      const tiles = walkTiles(candidate);
      const seen = new Set<string>();
      let collides = false;
      // endpoints (index 0 and last) are the shared a/b boundary tiles — always allowed
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
// Applies meander to every leg of an already-rectilinear waypoint chain. The original
// (un-meandered) path's full tile footprint is reserved up front as off-limits to every
// detour, so no segment's zigzag can ever cross or backtrack over the path itself —
// including parts of the path that haven't been generated yet.
function applyMeander(cellsPts: CPt[], tier: number, cols: number, rows: number): CPt[] {
  if (cellsPts.length < 2 || tier <= 0) return cellsPts;
  const spine = new Set(walkTiles(cellsPts).map(ptKey));
  const claimed = new Set<string>(); // tiles actual (possibly-bumped) segments have committed to
  const markClaimed = (pts: CPt[]) => { for (const p of walkTiles(pts)) claimed.add(ptKey(p)); };
  const out: CPt[] = [cellsPts[0]];
  markClaimed([cellsPts[0]]);
  for (let i = 0; i < cellsPts.length - 1; i++) {
    const a = cellsPts[i], b = cellsPts[i + 1];
    const segSpine = new Set(walkTiles([a, b]).map(ptKey)); // this segment's own straight run — it's replacing this, not colliding with it
    const forbidden = new Set<string>();
    for (const k of spine) if (!segSpine.has(k)) forbidden.add(k);
    for (const k of claimed) forbidden.add(k);
    const seg = meanderSegment(a, b, tier, cols, rows, forbidden);
    markClaimed(seg);
    for (let j = 1; j < seg.length; j++) out.push(seg[j]);
  }
  return out;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
// Blends two '#rrggbb' hex colors — used for the on-hit white flash, so continuous/DoT ticks
// (Phase 3B.5) can pop at reduced strength instead of a hard binary swap to white.
function mixHex(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}

class Path {
  pts: number[][];
  segLens: number[] = [];
  total = 0;
  constructor(pts: number[][]) {
    this.pts = pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const l = dist(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      this.segLens.push(l); this.total += l;
    }
  }
  at(d: number): { x: number; y: number; a: number } {
    d = clamp(d, 0, this.total);
    let i = 0;
    while (i < this.segLens.length - 1 && d > this.segLens[i]) { d -= this.segLens[i]; i++; }
    const [ax, ay] = this.pts[i], [bx, by] = this.pts[i + 1];
    const t = this.segLens[i] ? d / this.segLens[i] : 0;
    return { x: lerp(ax, bx, t), y: lerp(ay, by, t), a: Math.atan2(by - ay, bx - ax) };
  }
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; color: string;
  kind: 'dot' | 'spark' | 'ring' | 'shock' | 'text' | 'smoke' | 'shard' | 'flash' | 'fire';
  text?: string; grav?: number; rot?: number; vr?: number;
}

interface Patch { x: number; y: number; r: number; until: number; kind: 'burn' | 'stasis'; dps?: number; slow?: number }

// ---------- enemy ----------
export class Enemy {
  spec: EnemySpec;
  hp: number; maxHp: number;
  shield = 0; maxShield = 0; shieldRegenAt = 0;
  path: Path; pathIdx: number;
  d = 0;
  x = 0; y = 0; angle = 0;
  fx0 = 0; fy0 = 0; fx1 = 0; fy1 = 0; fT = 0; fDur = 1;
  fcx = 0; fcy = 0;   // flier lane control point (Phase 5.4) — defaults to the straight-line midpoint
  slowPct = 0; slowUntil = 0;
  frozenUntil = 0;
  burnDps = 0; burnUntil = 0;
  flameStacks = 0; flameStackUntil = 0;   // Flame's stacking-burn niche (Phase 4.2)
  flameSpread = false;                    // set when ignited by a Hellmouth-branch tower (Phase 4.4)
  dead = false; leaked = false;
  wobble = Math.random() * 10;
  flashT = 0;
  phaseT = Math.random() * 2;
  phased = false;
  healT = 0; minionT = 0; empT = 0;
  hpMul = 1;
  brittle = false;
  isElite = false;
  eliteAffixes: ('shielded' | 'swift' | 'vampiric')[] = []; // 1 normally, 2 at Ascension III+
  eliteSparkT = 0;
  lastHitBy: Tower | null = null;   // for rich-vein kill attribution (burn/patch DoT excluded)
  mutRegen = false;                 // Regenerating wave mutator
  bossPhase = 1;                    // bosses flip to 2 at 50% HP (gate boss_phase2)
  arcA = 0;                         // leviathan phase-2: center angle of the shield GAP
  phase2BaseSpeed = 0;              // colossus phase-2: speed growth cap reference
  dmgAccum = 0;                     // damage-number batching
  dmgFlushAt = 0;
  // --- physical hit feedback (Phase 3B.5) --- purely visual, never touches actual position
  flashStrength = 1;                // white-flash blend on this hit: 1 full, <1 for continuous/DoT ticks
  hitNudgeX = 0; hitNudgeY = 0; hitNudgeUntil = 0;   // 2px positional nudge along the hit direction
  hitSquashUntil = 0;                // brief extra squash impulse layered on the ambient wobble squash
  hadShieldBreak = false;            // set once by Game.shieldBreak() — chains into deathFx's aegis case

  constructor(spec: EnemySpec, path: Path, pathIdx: number, hpMul: number, rewardMul: number, flyFrom?: { x: number; y: number }, flyTo?: { x: number; y: number }) {
    this.spec = spec;
    this.hpMul = hpMul;
    this.maxHp = Math.round(spec.hp * hpMul);
    this.hp = this.maxHp;
    if (spec.shield) { this.maxShield = Math.round(this.maxHp * spec.shield); this.shield = this.maxShield; }
    this.path = path; this.pathIdx = pathIdx;
    (this as any).reward = Math.max(1, Math.round(spec.reward * rewardMul));
    if (spec.flying && flyFrom && flyTo) {
      this.fx0 = flyFrom.x; this.fy0 = flyFrom.y; this.fx1 = flyTo.x; this.fy1 = flyTo.y;
      // Straight-line default: a control point sitting exactly on the midpoint degenerates the
      // quadratic bezier back into a straight line. Curved wave lanes (Phase 5.4) override this
      // right after construction; boss-spawned minions (spawnAt) and this default both stay
      // straight, which is the intended fallback either way.
      this.fcx = (this.fx0 + this.fx1) / 2; this.fcy = (this.fy0 + this.fy1) / 2;
      this.fDur = Math.max(0.1, dist(this.fx0, this.fy0, this.fx1, this.fy1) / spec.speed);
      this.x = this.fx0; this.y = this.fy0;
    } else {
      const p = path.at(0); this.x = p.x; this.y = p.y;
    }
  }

  // Promote this enemy to an elite: clones the spec so size/speed/leak changes stay
  // per-instance, multiplies HP and bounty, and applies one random affix.
  makeElite(affixes: ('shielded' | 'swift' | 'vampiric')[]) {
    const E = TUNING.elites;
    this.isElite = true;
    this.eliteAffixes = affixes;
    const swift = affixes.includes('swift');
    this.spec = {
      ...this.spec,
      size: this.spec.size * E.sizeMul,
      speed: swift ? this.spec.speed * E.affixSpeedMul : this.spec.speed,
      leak: this.spec.leak + E.extraLeak,
    };
    this.maxHp = Math.round(this.maxHp * E.hpMul);
    this.hp = this.maxHp;
    if (affixes.includes('shielded')) {
      this.maxShield = Math.max(this.maxShield, Math.round(this.maxHp * E.affixShieldFrac));
      this.shield = this.maxShield;
    }
    (this as any).reward = Math.round((this as any).reward * E.bountyMul);
    // recompute flight duration for swift fliers (fDur was set from the old speed)
    if (this.spec.flying && swift) this.fDur = Math.max(0.1, this.fDur / E.affixSpeedMul);
  }

  get targetable() { return !this.dead && !this.phased; }
  get progress() {
    return this.spec.flying ? (this.fT / this.fDur) * 10000 + this.pathIdx : this.d + this.pathIdx * 0.001;
  }
  effSpeed(now: number) {
    if (now < this.frozenUntil) return 0;
    let s = this.spec.speed;
    if (now < this.slowUntil) s *= 1 - this.slowPct;
    return s;
  }
  applySlow(pct: number, dur: number, now: number) {
    if (pct >= this.slowPct || now >= this.slowUntil) { this.slowPct = pct; this.slowUntil = now + dur; }
  }
  // Flame's niche (Phase 4.2): repeated ignitions from a held Flame stack up to 3x
  // instead of just refreshing a max-based burn — "nothing melts a chokepoint like a
  // committed Flame." This is the only ignition path in the game (Magma/Sunfire Mortar's
  // burn is a separate ground-patch mechanic that calls hurt() directly, not this method).
  igniteStack(dps: number, dur: number, now: number) {
    if (now > this.flameStackUntil) this.flameStacks = 0;
    this.flameStacks = Math.min(TUNING.flame.stackMax, this.flameStacks + 1);
    const eff = dps * (1 + TUNING.flame.stackStep * (this.flameStacks - 1));
    this.burnDps = Math.max(this.burnDps, eff);
    this.burnUntil = Math.max(this.burnUntil, now + dur);
    this.flameStackUntil = this.burnUntil;
  }
  update(dt: number, now: number, game: Game) {
    if (this.dead) return;
    this.wobble += dt * (4 + this.spec.speed / 24);
    if (this.flashT > 0) this.flashT -= dt;
    if (this.spec.phase) {
      this.phaseT += dt;
      const cyc = this.phaseT % 3.6;
      const wasPhased = this.phased;
      this.phased = cyc > 2.5;
      if (this.phased && !wasPhased) game.spark(this.x, this.y, '#b0fff4', 6);
    }
    if (this.mutRegen && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * TUNING.mutators.regenPerSec * dt);
    }
    if (now < this.burnUntil && this.burnDps > 0) {
      this.hurt(this.burnDps * dt, game, true);
      // Fire-particle emission scales with flame stacks (Phase 4.2) — a triple-stacked
      // burn visibly rages harder than a single tick.
      const emitRate = this.flameStacks > 0 && now < this.flameStackUntil ? 10 + this.flameStacks * 6 : 10;
      if (Math.random() < dt * emitRate) game.fireFx(this.x + rand(-6, 6), this.y + rand(-6, 6));
    } else if (now > this.flameStackUntil) {
      this.flameStacks = 0;
    }
    if (this.maxShield && this.shield < this.maxShield && now > this.shieldRegenAt) {
      this.shield = Math.min(this.maxShield, this.shield + this.maxShield * 0.28 * dt);
    }
    if (this.isElite) {
      this.eliteSparkT += dt;
      if (this.eliteSparkT > 0.28) {
        this.eliteSparkT = 0;
        game.parts.push({ x: this.x + rand(-this.spec.size, this.spec.size), y: this.y - this.spec.size, vx: rand(-8, 8), vy: rand(-34, -16), life: 0.5, max: 0.5, size: rand(1.6, 2.8), color: '#ffd97a', kind: 'spark' });
      }
      if (this.eliteAffixes.includes('vampiric')) {
        this.healT += dt;
        if (this.healT > 1) {
          this.healT = 0;
          let healed = false;
          for (const e of game.enemies) {
            if (e !== this && !e.dead && dist(e.x, e.y, this.x, this.y) < 90 && e.hp < e.maxHp) {
              e.hp = Math.min(e.maxHp, e.hp + TUNING.elites.affixHealPerSec * this.hpMul);
              game.healFx(e.x, e.y);
              healed = true;
            }
          }
          if (healed) game.ringFx(this.x, this.y, 90, '#ffd97a');
        }
      }
    }
    if (this.spec.healAura) {
      this.healT += dt;
      if (this.healT > 1.4) {
        this.healT = 0;
        let healed = false;
        for (const e of game.enemies) {
          if (e !== this && !e.dead && dist(e.x, e.y, this.x, this.y) < 95 && e.hp < e.maxHp) {
            e.hp = Math.min(e.maxHp, e.hp + this.spec.healAura * this.hpMul);
            game.healFx(e.x, e.y);
            healed = true;
          }
        }
        if (healed) game.ringFx(this.x, this.y, 95, '#c0f5b3');
      }
    }
    if (this.spec.spawnMinion) {
      this.minionT += dt;
      if (this.minionT > this.spec.spawnMinion.every) {
        this.minionT = 0;
        for (let i = 0; i < this.spec.spawnMinion.count; i++) game.spawnAt(this.spec.spawnMinion.id, this);
        game.ringFx(this.x, this.y, 44, game.palEnemy(this.spec.id)[0]);
      }
    }
    if (this.spec.emp) {
      this.empT += dt;
      if (this.empT > this.spec.emp) {
        this.empT = 0;
        game.empPulse(this.x, this.y, 160 * (this.bossPhase === 2 && this.spec.id === 'colossus' ? 2 : 1), 3);
        if (this.bossPhase === 2 && this.spec.id === 'colossus') {
          const cap = this.phase2BaseSpeed * 1.8;
          const ns = Math.min(this.spec.speed * 1.2, cap);
          if (ns > this.spec.speed) {
            this.spec = { ...this.spec, speed: ns };
            game.floater(this.x, this.y - this.spec.size - 14, 'RAGING', '#ff8fa3');
          }
        }
      }
    }
    if (this.bossPhase === 2 && this.spec.id === 'leviathan') this.arcA += dt * (Math.PI / 6); // 30°/s
    const sp = this.effSpeed(now);
    if (this.spec.flying) {
      this.fT += (sp / this.spec.speed) * dt;
      const t = clamp(this.fT / this.fDur, 0, 1);
      const pos = bezierAt(this.fx0, this.fy0, this.fcx, this.fcy, this.fx1, this.fy1, t);
      this.x = pos.x; this.y = pos.y;
      // Tangent-based facing (not a fixed portal->base bearing) — needed once the lane curves,
      // and degrades gracefully to the old fixed-bearing look when fcx/fcy sit on the midpoint.
      this.angle = bezierTangentAngle(this.fx0, this.fy0, this.fcx, this.fcy, this.fx1, this.fy1, t);
      if (t >= 1) this.leak(game);
    } else {
      // Null Zone: ground enemies passing within 1.5 tiles of a null cell center are
      // slowed — multiplicative with tower slows. Checked against last frame's position
      // (continuous input, one-frame lag is imperceptible — same pattern as conduit).
      let nullSlowMul = 1;
      if (game.nullCellPx.length) {
        const rad = 1.5 * game.cell;
        for (const p of game.nullCellPx) {
          if (dist(this.x, this.y, p.x, p.y) < rad) { nullSlowMul = 1 - TUNING.cells.nullcell.slowPct; game.nullSlowTint(this); break; }
        }
      }
      this.d += sp * nullSlowMul * dt;
      const p = this.path.at(this.d);
      this.x = p.x; this.y = p.y; this.angle = p.a;
      if (this.d >= this.path.total) this.leak(game);
    }
  }
  leak(game: Game) {
    if (this.dead) return;
    this.dead = true; this.leaked = true;
    game.onLeak(this);
  }
  hurt(amount: number, game: Game, silent = false, src?: Tower) {
    if (this.dead) return;
    if (src) { this.lastHitBy = src; src.dmgDealt += amount; }
    if (this.brittle) amount *= 1.25;
    // Leviathan phase 2: the shield is a rotating 240° barrier. Damage arriving
    // through the uncovered 120° gap bypasses the shield entirely.
    let bypass = false;
    if (this.bossPhase === 2 && this.spec.id === 'leviathan' && this.shield > 0 && src) {
      const ang = Math.atan2(src.y - this.y, src.x - this.x);
      let diff = ang - this.arcA;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < Math.PI / 3) {
        bypass = true;
        game.spark(this.x + Math.cos(ang) * this.spec.size, this.y + Math.sin(ang) * this.spec.size, '#fff3b0', 3);
      }
    }
    if (this.shield > 0 && !bypass) {
      this.shield -= amount;
      this.shieldRegenAt = game.now + 3;
      if (this.shield < 0) { this.hp += this.shield; this.shield = 0; game.shieldBreak(this); }
    } else {
      this.hp -= amount;
    }
    this.dmgAccum += amount;
    this.flashT = 0.08;
    // Continuous/DoT ticks (silent=true: burns, auras, beams, patches) flash at reduced
    // strength — a full-white pop every single tick of a multi-second burn would be noise,
    // not signal. Direct hits (bullets, splash, chain) keep the full pop.
    this.flashStrength = silent ? 0.4 : 1;
    if (src && !game.reduceMotion) {
      const dx = this.x - src.x, dy = this.y - src.y;
      const len = Math.hypot(dx, dy) || 1;
      this.hitNudgeX = (dx / len) * 2; this.hitNudgeY = (dy / len) * 2;
      this.hitNudgeUntil = game.now + 0.08;
    }
    this.hitSquashUntil = game.now + 0.12;
    if (!silent) audio.hit();
    if (this.hp <= 0) { this.dead = true; game.onKill(this); }
  }
}

// ---------- tower ----------
export class Tower {
  spec: TowerSpec;
  x: number; y: number;
  cell = -1;
  col = 0; row = 0;
  stage = 0;
  branch = -1;
  branchStage = 0;
  cool = 0;
  angle = -Math.PI / 2;
  recoil = 0;
  target: Enemy | null = null;
  mode: 'first' | 'last' | 'strong' | 'weak' | 'close' = 'first';
  spent = 0;
  builtAt = -999;   // game-time of placement — drives the sell-undo window (Phase 1)
  disabledUntil = 0;
  vein = false;   // built on a Rich Vein cell (+credits per kill landed)
  cellType: string | null = null;   // special terrain this tower sits on (Phase 2), or null
  cellRangeAdd = 0; cellRateMul = 1; cellDmgMul = 1;   // cached numeric modifiers from cellType
  dmgDealt = 0;
  kills = 0;
  creditsEarned = 0;
  rampT = 0;
  beamTargets: Enemy[] = [];
  bDmg = 0; bRate = 0; bRange = 0; bCrit = 0;
  auraPulse = Math.random() * 6;
  // --- idle & uncovered feedback (Phase 3B.4) ---
  pathCellsInRange = 0;   // cached; recomputed on build/move/upgrade/grid-rebuild (Game.recomputeCoverage)
  noTargetSince = -1;     // game-time the tower last had no target/beam/aura-hit; -1 while actively engaged
  // --- Phase 4: tower depth ---
  coldFocusUntil = 0;         // Cold Focus reaction (4.3): grace window a Prism's ramp survives a chilled kill
  overchargedUntil = 0;       // Overcharge (4.5): not serialized — resume snapshots are wave-clear only and charges replenish at wave launch
  perk: 'sharp' | 'rapid' | 'scav' | null = null;   // Veterancy (4.6): chosen once at the 45-kill threshold, irrevocable

  constructor(spec: TowerSpec, x: number, y: number) {
    this.spec = spec; this.x = x; this.y = y;
  }
  get raw(): StageStats {
    return this.branch >= 0 ? this.spec.branches[this.branch][this.branchStage] : this.spec.stages[this.stage];
  }
  get buffed() { return this.bDmg > 0 || this.bRate > 0 || this.bRange > 0 || this.bCrit > 0; }
  get displayName() {
    if (this.branch >= 0) return `${this.spec.name} (${4 + this.branchStage} ${this.raw.name})`;
    return `${this.spec.name} (${this.stage + 1})`;
  }
  // Range floor of 1 is load-bearing: a sinkhole under a range-1 tower stays 1 — pure
  // win, and intended — that IS the short-tower home the cell type is built to reward.
  rangeT() { return Math.max(1, Math.round(this.raw.range * (1 + this.bRange)) + this.cellRangeAdd); }
  stats(game: Game) {
    const r = this.raw;
    // Overcharge (Phase 4.5): firing towers (rate > 0) get a fire-rate multiplier;
    // rate-0 towers (Prism/auras) get a damage multiplier instead, since there's no fire
    // rate to boost. Stacks multiplicatively with the supply-drop Overclock — rare and
    // short enough that the double-dip is a delightful spike, not a balance problem.
    const overcharged = game.now < this.overchargedUntil;
    const OC = TUNING.overcharge;
    // Veterancy (Phase 4.6): a chosen perk applies a flat multiplier on top of everything else.
    const V = TUNING.veterancy.perks;
    const perkDmgMul = this.perk === 'sharp' ? 1 + V.sharp : 1;
    const perkRateMul = this.perk === 'rapid' ? 1 + V.rapid : 1;
    const dmgMul = (1 + this.bDmg) * game.metaDmgMul * this.cellDmgMul * perkDmgMul * (overcharged && r.rate === 0 ? OC.rateMul : 1);
    const rateMul = (1 + this.bRate) * (game.now < game.overclockUntil ? 1 + TUNING.drops.overclockRate : 1)
      * (game.stormRow0 >= 0 && game.now > game.stormWarnUntil && this.row >= game.stormRow0 && this.row < game.stormRow0 + TUNING.ionStorms.bandRows ? 1 - TUNING.ionStorms.ratePenalty : 1)
      * this.cellRateMul * perkRateMul * (overcharged && r.rate > 0 ? OC.rateMul : 1);
    return {
      ...r,
      dmg: r.dmg * dmgMul,
      burnDps: r.burnDps ? r.burnDps * dmgMul : r.burnDps,
      rate: r.rate * rateMul,
      range: this.rangeT(),
      crit: (r.crit || 0) + this.bCrit,
    };
  }
  // Set/clear the cached numeric cell modifiers from CELL_TYPES + TUNING.cells whenever
  // cellType changes (buildAt / confirmMove). Cached rather than looked up live so rangeT()
  // (called every frame, no Game ref) and stats() stay cheap.
  applyCellType(type: string | null) {
    this.cellType = type;
    const CT = TUNING.cells;
    this.cellRangeAdd = type === 'ridge' ? CT.ridge.rangeAdd : type === 'sinkhole' ? CT.sinkhole.rangeAdd : 0;
    this.cellRateMul = type === 'ridge' ? CT.ridge.rateMul : 1;
    this.cellDmgMul = type === 'sinkhole' ? CT.sinkhole.dmgMul : 1;
  }
  baseStats(game: Game) {
    const r = this.raw;
    return { ...r, dmg: r.dmg * game.metaDmgMul };
  }
}

// ---------- projectiles ----------
interface Bullet {
  kind: 'bullet'; x: number; y: number; vx: number; vy: number; dmg: number;
  color: string; pierce: number; hit: Set<Enemy>; life: number; w: number;
  target?: Enemy | null;
  slow?: number; slowDur?: number; freeze?: number; crit?: number; trail: number[][];
  pierceRamp?: number;   // Star Lance (Phase 4.4): each pierced enemy takes (1+pierceRamp)^k more
  freshMul?: number;     // Storm Sentinel (Phase 4.4): multiplier vs targets still at full hp/shield
  owner?: Tower;
}
interface Missile {
  kind: 'missile'; x: number; y: number; vx: number; vy: number; speed: number;
  target: Enemy | null; dmg: number; splash: number; airMul: number; color: string;
  life: number; wig: number; trail: number[][];
  directStun?: number;   // Nova Torpedo (Phase 4.4): stun seconds on the direct target only
  owner?: Tower;
}
interface Shell {
  kind: 'shell'; x0: number; y0: number; x1: number; y1: number; t: number; T: number;
  dmg: number; splash: number; color: string; arc: number;
  burnDps?: number; burnDur?: number; cluster?: number; stun?: number; mini?: boolean;
  owner?: Tower;
}
type Proj = Bullet | Missile | Shell;

interface Bolt { pts: number[][]; life: number; color: string }
interface RayFx { x0: number; y0: number; x1: number; y1: number; life: number; max: number; color: string; w: number }
interface Incoming { x: number; y: number; t: number }
interface CellInfo { x: number; y: number; col: number; row: number; valid: boolean; path: boolean; rock: boolean; vein: boolean; special: string | null; conduitPartner?: number }

export type BannerFn = (text: string, color?: string, tier?: 'critical' | 'medium' | 'low', sub?: string) => void;

// ================= GAME =================
export class Game {
  cv: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  level: LevelSpec;
  zone: (typeof ZONES)[0];
  paths: Path[] = [];
  endless: boolean;
  cell: number;
  k: number; // art scale relative to 48px tiles

  state: 'playing' | 'won' | 'lost' = 'playing';
  credits = 0; lives = 0; maxLives = 0;
  waveIdx = -1;
  totalWaves = 0;
  waveActive = false;
  interT = 0;
  interMax = 1;
  now = 0;
  speed = 1;
  defaultMode: 'first' | 'last' | 'strong' | 'weak' | 'close' = 'first'; // SERIALIZE: not needed (derived from settings)
  diffTier = 2;                    // difficulty tier 0..4, set by UI (drives elite/mutator chances)
  ascTier = 0;                      // Ascension tier 0..5, cumulative effects (see TUNING.ascension)
  mirror = false;                   // Daily Op: horizontally mirror the path geometry
  extraMutatorChance = 0;           // Daily Op: flat bonus added to the wave-mutator roll
  hitStopT = 0;                    // SERIALIZE: not needed (sub-100ms transient)
  slowMoT = 0;                     // remaining slow-motion seconds (real time)
  slowMoScale = 0.3;
  flashT = 0;                      // whiteout flash overlay
  bossVignetteUntil = 0;           // red edge pulse during boss entrances
  reduceFlash = false;             // accessibility (set by UI)
  reduceMotion = false;            // accessibility (set by UI)
  chromaOn = false;                // set by UI from settings — board palette variant (Phase 3B)
  accessiblePalette = false;       // set by UI from settings — wins over chromaOn when both are on
  // Active tower/enemy palette variant, resolved from settings: accessiblePalette > chromaOn >
  // default. Every canvas draw of tower/enemy color routes through this (or palTower/palEnemy
  // below) instead of reading spec.color/color2 directly, so re-theming touches the whole
  // board, not just HUD chrome.
  pal() { return this.accessiblePalette ? PALETTE.accessible : this.chromaOn ? PALETTE.chroma : PALETTE.default; }
  palTower(id: string): [string, string] { return this.pal().towers[id] || PALETTE.default.towers[id]; }
  palEnemy(id: string): [string, string] { return this.pal().enemies[id] || PALETTE.default.enemies[id]; }
  // --- NOVA --- // SERIALIZE: novaCharge, novaNeed, novaFireAt
  novaCharge = 0;
  novaNeed: number = TUNING.nova.killsToCharge;
  novaFireAt = 0;                  // >0 while the 1.2s buildup is running
  // --- combo --- // SERIALIZE: comboCount, lastKillAt
  comboCount = 0;
  lastKillAt = -99;
  // --- supply drops --- // SERIALIZE: drops, nextDropAt, overclockUntil
  drops: { x: number; y: number; vx: number; born: number; kind: 'credits' | 'recharge' | 'overclock' | 'hull' | 'fragment'; amount: number }[] = [];
  nextDropAt = 0;
  forceNextDrop = false;
  overclockUntil = -99;
  // --- Overcharge (Phase 4.5) --- not serialized: resume snapshots are wave-clear only and
  // charges replenish at wave launch, so there's nothing mid-wave to round-trip.
  overchargeLeft = 0;
  // --- scripted first encounters (set by UI for fresh saves) ---
  scriptElite = false;
  scriptDrop = false;
  // --- per-run stat deltas, merged into the save by the UI on teardown --- // SERIALIZE: runStats
  runStats = { kills: 0, wavesCleared: 0, towersBuilt: {} as Record<string, number>, elitesSlain: 0, bestCombo: 0, novasFired: 0, leaksByEnemy: {} as Record<string, number> };
  onToast: (key: string, text: string) => void = () => {};
  onWaveClear: () => void = () => {};   // fired once per wave clear — the UI hooks this to save a resume snapshot
  peekTower: Tower | null = null;        // touch long-press range peek (mobile) — independent of `selected`
  dpr = 1;                               // logical-to-physical canvas scale (CSS scale-to-fit x devicePixelRatio), set by UI.fit()
  perfMode = false;                      // reduced particle cap / starfield / effects for lower-end mobile
  onPerfDrop: () => void = () => {};     // fired once if the frame watchdog auto-enables perfMode mid-session
  interestCap: number = TUNING.interest.cap; // real value always set in the constructor (level-scaled, or the flat Ascension IV override)
  mods = new Set<string>();        // active level modifiers (gated); set before buildGrid runs
  // --- meteors --- // SERIALIZE: nextMeteorAt, meteorWarn
  nextMeteorAt = 0;
  meteorWarn: { cell: number; at: number } | null = null;
  // --- ion storms --- // SERIALIZE: nextStormAt, stormRow0, stormWarnUntil, stormUntil
  nextStormAt = 0;
  stormRow0 = -1;
  stormWarnUntil = 0;
  stormUntil = 0;
  hapticsOn = false;               // set by UI from settings (Android vibration)
  damageNumbersOn = true;          // set by UI from settings
  startNova(): boolean {
    if (!isUnlocked('nova') || this.state !== 'playing' || this.paused) return false;
    if (this.novaCharge < this.novaNeed || this.novaFireAt > 0) return false;
    this.novaFireAt = this.now + TUNING.nova.buildup;
    audio.novaHum();
    return true;
  }
  dmgText(x: number, y: number, amount: number) {
    this.parts.push({ x, y, vx: rand(-8, 8), vy: -46, life: 0.55, max: 0.55, size: 11, color: 'rgba(238,240,255,0.85)', kind: 'text', text: fmt(Math.round(amount)) });
  }
  slowMo(dur: number, scale = 0.3) {
    if (this.reduceMotion) return;
    this.slowMoT = Math.max(this.slowMoT, dur);
    this.slowMoScale = scale;
  }
  screenFlash(strength = 1) {
    this.flashT = Math.max(this.flashT, this.reduceFlash ? strength * 0.25 : strength);
  }
  hitStop(t: number) {
    if (this.reduceMotion) return;
    this.hitStopT = Math.max(this.hitStopT, t);
  }
  buzz(pattern: number[]) {
    if (!this.hapticsOn) return;
    try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
  }
  paused = false;

  enemies: Enemy[] = [];
  towers: Tower[] = [];
  projs: Proj[] = [];
  bolts: Bolt[] = [];
  rays: RayFx[] = [];
  parts: Particle[] = [];
  patches: Patch[] = [];
  incomings: Incoming[] = [];
  spawnQueue: { t: number; e: string; p: number }[] = [];
  waveTotalSpawns = 0;      // Phase 7.6.2: total spawns this wave, for the wave-arc remainFrac
  lastStandFired = false;   // Phase 7.6.2: last-stand motif fires once per wave
  lastPressureAt = 0;       // Phase 7.3: throttle cadence for the pressure/mender/last-stand tick
  lastMenderCount = -1;     // Phase 7.2.2: only re-ramps the mender loop's gain when this actually changes
  pendingWave: WaveGroup[] | null = null;   // SERIALIZE: pendingWave, pendingMutator, pending2Wave, pending2Mutator, waveMutator
  pendingMutator: string | null = null;
  pending2Wave: WaveGroup[] | null = null;
  pending2Mutator: string | null = null;
  waveMutator: string | null = null;        // mutator of the currently active wave
  firstMutator = false;                     // set by UI when the player has never seen a mutator
  autoWave = false;
  diffHp = 1;
  diffReward = 1;
  meander = 0; // 0=low(straight) 1=medium 2=high — extra path turns/back-and-forths
  waves: WaveGroup[][] = [];

  // grid
  cells: CellInfo[] = [];
  cols = 0; rows = 0; gx0 = 0; gy0 = 0;
  occupied: (Tower | null)[] = [];
  nullCells: number[] = [];                              // cell indices of Null Zone specials
  nullCellPx: { x: number; y: number }[] = [];            // precomputed centers, for the ground-slow check
  portalPx: { x: number; y: number }[] = [];
  basePx: { x: number; y: number }[] = [];
  // Ordered path-cell sequence per path (portal -> base), in travel order — the road's
  // "flow" direction for Phase 3's marching chevrons (and Null Zone's final-third rule).
  pathOrderedCells: { c: number; r: number }[][] = [];
  // Per-run identity for endless's background (Phase 3). Not serialized: endless never
  // produces a resume snapshot (saveResumeSnapshot() bails out for endless runs — see
  // ui.ts), so there is nothing to round-trip and no RESUME_VERSION bump is needed for it.
  runSeed = (Math.random() * 1e9) | 0;

  selected: Tower | null = null;
  focus: Enemy | null = null;
  conduitTarget: Enemy | null = null;   // shared acquisition target for conduit-cell towers
  armed: 'orbital' | 'stasis' | null = null;
  cds: Record<string, number> = { orbital: 0, stasis: 0 };
  mx = -100; my = -100;

  moveArmed: Tower | null = null;
  pendingMove: { tower: Tower; cellIdx: number } | null = null;
  pendingBuild: { spec: TowerSpec; cellIdx: number } | null = null;
  menuCell = -1;
  menuHover: TowerSpec | null = null;

  shakeMag = 0; shakeT = 0;
  stars: { x: number; y: number; s: number; p: number }[] = [];
  bgCanvas: HTMLCanvasElement;

  metaDmgMul = 1; metaCostMul = 1; hasOrbital = false; hasStasis = false;
  dev = false; devGod = false; devFree = false;
  shakeOn = true;

  killCount = 0;
  livesLostTotal = 0;
  leakLedger: Record<string, number> = {};   // SERIALIZE: enemy id -> hull lost THIS run (Phase 6.3)
  leakFlashUntil = 0;                        // base-sprite flash + red edge pulse window (Phase 6.2)
  threatVerdict: { ground: number | null; air: number | null; verdict: 'comfortable' | 'tight' | 'leak' } | null = null;
  // not serialized — recomputed on the same trigger events every time (build/sell/move/
  // upgrade/perk/wave-prep), so a resumed run just recomputes it on its first such event.
  // --- challenge tracking (evaluated once at win) ---
  lateCallHappened = false;   // a wave was launched by the countdown hitting 0, not a deliberate early click
  soldAny = false;
  abilityUsed = false;

  onHud: () => void = () => {};
  onBanner: BannerFn = () => {};
  onEnd: (won: boolean, stars: number) => void = () => {};
  onSelect: () => void = () => {};
  seenNewEnemy = false;

  private raf = 0;
  private lastT = 0;
  destroyed = false;

  constructor(cv: HTMLCanvasElement, level: LevelSpec, endless: boolean,
              meta: { creditMul: number; hp: number; costMul: number; dmgMul: number; orbital: boolean; stasis: boolean },
              cellSize = 48,
              opts: { hpMul?: number; rewardMul?: number; waveFactor?: number; meander?: number; diffTier?: number; ascTier?: number; mirror?: boolean; forceMods?: string[]; mutatorBonus?: number; perfMode?: boolean } = {}) {
    this.cv = cv;
    this.g = cv.getContext('2d')!;
    this.level = level;
    this.endless = endless;
    this.cell = cellSize;
    this.k = cellSize / 48;
    this.zone = ZONES[level.zone];
    this.credits = Math.round(level.startCredits * meta.creditMul * ((opts.ascTier ?? 0) >= 4 ? TUNING.ascension.startCreditMul : 1));
    this.maxLives = this.lives = level.baseHp + meta.hp;
    this.metaCostMul = meta.costMul;
    this.metaDmgMul = meta.dmgMul;
    this.hasOrbital = meta.orbital;
    this.hasStasis = meta.stasis;
    // Progression smoothing: L1-2 are gentler (new players are still learning the systems
    // this session added), then a slow compensation ramp from L5->L10 offsets how much
    // stronger the player's toolkit (combo/interest/elites/drops/nova) has become by then.
    const SM = TUNING.smoothing;
    let progressionMul = 1;
    if (level.id <= 2) progressionMul = SM.earlyLevels;
    else if (level.id >= SM.compensationFrom) {
      const t = clamp((level.id - SM.compensationFrom) / (SM.compensationFull - SM.compensationFrom), 0, 1);
      progressionMul = 1 + (SM.compensationMax - 1) * t;
    }
    this.ascTier = opts.ascTier ?? 0;
    this.mirror = opts.mirror ?? false;
    this.extraMutatorChance = opts.mutatorBonus ?? 0;
    this.perfMode = opts.perfMode ?? false;
    const AS = TUNING.ascension;
    this.diffHp = (opts.hpMul ?? 1) * progressionMul * (this.ascTier >= 1 ? AS.hpMul : 1);
    // Onslaught (tier 5+): meteors rage on every level, on top of whatever the level already has
    if (this.ascTier >= 5) this.mods.add('meteors');
    // Daily Op: 1-2 forced modifiers, added on top of whatever the level already has
    for (const m of opts.forceMods || []) if (MODIFIER_INFO[m] && isUnlocked(MODIFIER_INFO[m].gate)) this.mods.add(m);
    this.diffReward = opts.rewardMul ?? 1;
    // Interest cap scales gently with level progress so it stays meaningful against
    // late-campaign tower costs, not just early-game ones (endless has no level.id beyond
    // its own fixed id, so it keeps the flat base — scaling it per endless-wave belongs to
    // a different tuning knob, not this one). Phase 1: also rides econScale() so the cap
    // holds its relative value from L1 to L15, same as every other flat credit source.
    this.interestCap = Math.round((this.endless ? TUNING.interest.cap : TUNING.interest.cap + this.level.id * 3) * this.waveRewardMul());
    // Ascension IV halves the cap — apply that reduction AFTER scaling, as a ratio of the
    // two tuned constants (not a flat override), so it stays "half" at every campaign point.
    if (this.ascTier >= 4) this.interestCap = Math.round(this.interestCap * (AS.interestCapTier4 / TUNING.interest.cap));
    this.meander = opts.meander ?? 0;
    this.diffTier = opts.diffTier ?? 2;
    // Active modifiers: the level's list (endless: a seeded per-run pick), each behind its unlock gate.
    const modPool = endless
      ? (() => {
          const rng = mulberry32((Math.random() * 1e9) | 0);
          const all = Object.keys(MODIFIER_INFO);
          const n = seededInt(rng, 0, 2);
          const picked: string[] = [];
          while (picked.length < n && all.length) picked.push(all.splice(seededInt(rng, 0, all.length - 1), 1)[0]);
          return picked;
        })()
      : (level.modifiers || []);
    for (const m of modPool) {
      const info = MODIFIER_INFO[m];
      if (info && (isUnlocked(info.gate) || endless)) this.mods.add(m);
    }
    this.waves = resampleWaves(level.waves, opts.waveFactor ?? 1);
    this.totalWaves = endless ? 9999 : this.waves.length;
    this.interT = 9 * (this.ascTier >= 5 ? TUNING.ascension.intermissionMul : 1);
    this.interMax = this.interT;
    this.buildGrid();
    // Seeded (Phase 3) so the same level always generates the same sky + landmarks. Endless
    // gets a per-run identity via runSeed instead of the level id — stable for this Game
    // instance's lifetime, matching the precedent already set by asteroids/veins/cells (see
    // buildGrid()), none of which round-trip across a resume for endless either.
    const bgRng = mulberry32(this.endless ? hashString(`bg-endless-${this.runSeed}`) : hashString(`bg-${this.level.id}`));
    this.buildBg(bgRng);
    // Star field continues drawing from the same rng, right after the nebula blobs and
    // landmarks buildBg() already consumed it for — so a level's whole sky, stars included,
    // is one stable seeded draw.
    const starCount = this.perfMode ? 66 : 110; // perf mode: -40% starfield density
    for (let i = 0; i < starCount; i++) this.stars.push({ x: bgRng() * W, y: bgRng() * H, s: 0.6 + bgRng() * 1.5, p: bgRng() * 7 });
    this.preparePending();
    this.lastT = performance.now();
    let watchTime = 0, watchFrames = 0;
    const loop = (t: number) => {
      if (this.destroyed) return;
      const rawDt = Math.min(0.05, (t - this.lastT) / 1000);
      this.lastT = t;
      if (this.hitStopT > 0) this.hitStopT -= rawDt;
      let timeScale = 1;
      if (this.slowMoT > 0) { this.slowMoT -= rawDt; timeScale = this.slowMoScale; }
      if (this.flashT > 0) this.flashT -= rawDt * 1.6;
      const dt = this.paused || this.state !== 'playing' || this.hitStopT > 0 ? 0 : rawDt * this.speed * timeScale;
      this.update(dt, rawDt);
      this.render(rawDt);
      this.onHud();
      // Frame-time watchdog: sustained slowness (avg >20ms/frame over ~3s of active play)
      // auto-enables performance mode once, rather than staying silently janky forever.
      if (!this.perfMode && this.state === 'playing' && !this.paused && rawDt > 0) {
        watchTime += rawDt; watchFrames++;
        if (watchTime >= 3) {
          const avgMs = (watchTime / watchFrames) * 1000;
          if (avgMs > 20) { this.perfMode = true; this.onPerfDrop(); }
          watchTime = 0; watchFrames = 0;
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  destroy() { this.destroyed = true; cancelAnimationFrame(this.raf); }

  // ---------- unified grid ----------
  cx(col: number) { return this.gx0 + col * this.cell + this.cell / 2; }
  cy(row: number) { return this.gy0 + row * this.cell + this.cell / 2; }
  colOf(x: number) { return Math.floor((x - this.gx0) / this.cell); }
  rowOf(y: number) { return Math.floor((y - this.gy0) / this.cell); }
  idx(col: number, row: number) { return row * this.cols + col; }

  buildGrid() {
    const top = 70, bottom = H - 22;
    this.cols = Math.floor((W - 12) / this.cell);
    this.rows = Math.floor((bottom - top) / this.cell);
    this.gx0 = (W - this.cols * this.cell) / 2;
    this.gy0 = top + ((bottom - top) - this.rows * this.cell) / 2;

    const pathTiles = new Set<number>();
    const rockTiles = new Set<number>();
    const endTiles = new Set<number>();
    // Ordered path-cell sequence per path (portal -> base), one array per path index.
    // Used by the Null Zone placement algorithm to find each path's "final third".
    const pathCellsOrderedAll: { c: number; r: number }[][] = [];

    // snap each level path to the grid → rectilinear tile path
    this.paths = [];
    this.portalPx = [];
    this.basePx = [];
    for (const rawPts0 of this.level.paths) {
      const rawPts = this.mirror ? mirrorPts(rawPts0) : rawPts0;
      const cellsPts: { c: number; r: number }[] = [];
      for (let i = 0; i < rawPts.length; i++) {
        let c = Math.round((rawPts[i][0] - this.gx0 - this.cell / 2) / this.cell);
        let r = Math.round((rawPts[i][1] - this.gy0 - this.cell / 2) / this.cell);
        r = clamp(r, 0, this.rows - 1);
        if (i === 0) c = -2;
        else if (i === rawPts.length - 1) c = this.cols + 1;
        else c = clamp(c, 1, this.cols - 2);
        // enforce rectilinear against previous point
        if (i > 0) {
          const prev = cellsPts[cellsPts.length - 1];
          const horiz = Math.abs(rawPts[i][0] - rawPts[i - 1][0]) >= Math.abs(rawPts[i][1] - rawPts[i - 1][1]);
          if (horiz) r = prev.r; else c = prev.c;
          if (c === prev.c && r === prev.r) continue; // dedupe
        }
        cellsPts.push({ c, r });
      }
      const meandered = applyMeander(cellsPts, this.meander, this.cols, this.rows);
      // waypoints in px through tile centers
      const pts = meandered.map(p => [this.cx(p.c), this.cy(p.r)]);
      this.paths.push(new Path(pts));
      // carve path tiles
      let firstIn: { c: number; r: number } | null = null;
      let lastIn: { c: number; r: number } | null = null;
      const orderedThisPath: { c: number; r: number }[] = [];
      for (let i = 0; i < meandered.length - 1; i++) {
        const a = meandered[i], b = meandered[i + 1];
        const dc = Math.sign(b.c - a.c), dr = Math.sign(b.r - a.r);
        let c = a.c, r = a.r;
        while (true) {
          if (c >= 0 && c < this.cols && r >= 0 && r < this.rows) {
            pathTiles.add(this.idx(c, r));
            orderedThisPath.push({ c, r });
            if (!firstIn) firstIn = { c, r };
            lastIn = { c, r };
          }
          if (c === b.c && r === b.r) break;
          c += dc; r += dr;
        }
      }
      pathCellsOrderedAll.push(orderedThisPath);
      const fi = firstIn || { c: 0, r: meandered[0].r };
      const li = lastIn || { c: this.cols - 1, r: meandered[meandered.length - 1].r };
      this.portalPx.push({ x: this.cx(fi.c), y: this.cy(fi.r) });
      this.basePx.push({ x: this.cx(li.c), y: this.cy(li.r) });
      endTiles.add(this.idx(fi.c, fi.r));
      endTiles.add(this.idx(li.c, li.r));
    }

    // asteroids → rock tiles (mirrored along with the path on Daily Op)
    const levelAsteroids = this.mirror ? (this.level.asteroids || []).map(a => ({ ...a, x: W - a.x })) : (this.level.asteroids || []);
    for (const a of levelAsteroids) {
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
        const i = this.idx(c, r);
        if (pathTiles.has(i)) continue;
        if (dist(this.cx(c), this.cy(r), a.x, a.y) < a.r + this.cell * 0.2) rockTiles.add(i);
      }
    }

    // Asteroid Field modifier: seeded extra rock cells. By construction these can only
    // land on candidate cells that are NOT path/end/rock, so the path is never blocked.
    const veinTiles = new Set<number>();
    if (this.mods.has('asteroids')) {
      const rng = mulberry32(hashString(`${this.level.id}-ast`) ^ (this.endless ? (Math.random() * 1e9) | 0 : 0));
      const want = seededInt(rng, TUNING.asteroids.cellsMin, TUNING.asteroids.cellsMax);
      let placed = 0;
      for (let attempt = 0; attempt < 400 && placed < want; attempt++) {
        const c = seededInt(rng, 0, this.cols - 1), r = seededInt(rng, 0, this.rows - 1);
        const i = this.idx(c, r);
        if (pathTiles.has(i) || rockTiles.has(i) || endTiles.has(i)) continue;
        rockTiles.add(i);
        placed++;
      }
    }
    // Rich Veins modifier: seeded glitter cells (stay buildable; towers there earn per kill)
    if (this.mods.has('rich-veins')) {
      const rng = mulberry32(hashString(`${this.level.id}-vein`) ^ (this.endless ? (Math.random() * 1e9) | 0 : 0));
      const want = seededInt(rng, TUNING.richVeins.cells[0], TUNING.richVeins.cells[1]);
      let placed = 0;
      for (let attempt = 0; attempt < 400 && placed < want; attempt++) {
        const c = seededInt(rng, 1, this.cols - 2), r = seededInt(rng, 1, this.rows - 2);
        const i = this.idx(c, r);
        if (pathTiles.has(i) || rockTiles.has(i) || endTiles.has(i) || veinTiles.has(i)) continue;
        veinTiles.add(i);
        placed++;
      }
    }

    // ---------- Special terrain cells (Phase 2: Cell Diversity) ----------
    // Seeded placement, run after asteroid/vein seeding so cell candidates already know
    // about every other terrain feature. Order is fixed (sinkhole -> ridge -> conduit pair
    // -> anchor -> null zone) and later types respect minSeparation from all earlier ones.
    // Locked (below UNLOCKS.cells): specialMap stays empty and the board is unchanged.
    const specialMap = new Map<number, { type: string; partner?: number }>();
    if (isUnlocked('cells')) {
      const CT = TUNING.cells;
      const cellsRng = mulberry32(hashString(`${this.level.id}-cells`) ^ (this.endless ? (Math.random() * 1e9) | 0 : 0));
      const placedIdx: number[] = [];
      const allIdx: number[] = [];
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) allIdx.push(this.idx(c, r));
      const cOfIdx = (i: number) => i % this.cols;
      const rOfIdx = (i: number) => Math.floor(i / this.cols);
      const isFreeForSpecial = (i: number) => !pathTiles.has(i) && !rockTiles.has(i) && !endTiles.has(i) && !veinTiles.has(i) && !specialMap.has(i);
      const pathAdjCount = (c: number, r: number): number => {
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (dc === 0 && dr === 0) continue;
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) continue;
          if (pathTiles.has(this.idx(cc, rr))) n++;
        }
        return n;
      };
      const pathNear = (c: number, r: number, k: number): boolean => {
        for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
          if (dc === 0 && dr === 0) continue;
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) continue;
          if (pathTiles.has(this.idx(cc, rr))) return true;
        }
        return false;
      };
      const chebyshevD = (i: number, j: number) => Math.max(Math.abs(cOfIdx(i) - cOfIdx(j)), Math.abs(rOfIdx(i) - rOfIdx(j)));
      const farEnough = (i: number, sep: number) => placedIdx.every(j => chebyshevD(i, j) >= sep);

      // path corners (ridge's "prefer nearest a bend" rule): a path cell whose two
      // path-neighbors are non-collinear.
      const corners: { c: number; r: number }[] = [];
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
        if (!pathTiles.has(this.idx(c, r))) continue;
        const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const nbrs: [number, number][] = [];
        for (const [dc, dr] of dirs) {
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) continue;
          if (pathTiles.has(this.idx(cc, rr))) nbrs.push([dc, dr]);
        }
        if (nbrs.length === 2 && !(nbrs[0][0] === -nbrs[1][0] && nbrs[0][1] === -nbrs[1][1])) corners.push({ c, r });
      }
      const distToNearestCorner = (c: number, r: number): number => {
        if (!corners.length) return 0;
        let best = Infinity;
        for (const cor of corners) best = Math.min(best, Math.max(Math.abs(c - cor.c), Math.abs(r - cor.r)));
        return best;
      };

      // anchor "cluster heart" score: how many of the 8 neighbors are themselves valid
      // AND touch the path (this cell sits at the middle of a natural tower cluster).
      const anchorScore = (c: number, r: number): number => {
        let score = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (dc === 0 && dr === 0) continue;
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) continue;
          const ni = this.idx(cc, rr);
          if (pathTiles.has(ni) || rockTiles.has(ni) || endTiles.has(ni)) continue;
          if (pathAdjCount(cc, rr) >= 1) score++;
        }
        return score;
      };

      // final third of each path (by travel order, portal -> base) — where Null Zones live.
      const finalThirdIdx = new Set<number>();
      for (const ordered of pathCellsOrderedAll) {
        const from = Math.floor(ordered.length * 2 / 3);
        for (let i = from; i < ordered.length; i++) finalThirdIdx.add(this.idx(ordered[i].c, ordered[i].r));
      }
      const nearFinalThird = (c: number, r: number): boolean => {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (dc === 0 && dr === 0) continue;
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || cc >= this.cols || rr < 0 || rr >= this.rows) continue;
          const ni = this.idx(cc, rr);
          if (pathTiles.has(ni) && finalThirdIdx.has(ni)) return true;
        }
        return false;
      };

      // longest straight run of consecutive path cells (row-wise or col-wise) — the
      // "firing line" conduit pairs cluster around.
      type Run = { axis: 'row' | 'col'; fixed: number; lo: number; hi: number };
      let bestRun: Run | null = null, bestLen = 0;
      for (let r = 0; r < this.rows; r++) {
        let start = -1;
        for (let c = 0; c <= this.cols; c++) {
          const has = c < this.cols && pathTiles.has(this.idx(c, r));
          if (has) { if (start < 0) start = c; }
          else if (start >= 0) { const len = c - start; if (len > bestLen) { bestLen = len; bestRun = { axis: 'row', fixed: r, lo: start, hi: c - 1 }; } start = -1; }
        }
      }
      for (let c = 0; c < this.cols; c++) {
        let start = -1;
        for (let r = 0; r <= this.rows; r++) {
          const has = r < this.rows && pathTiles.has(this.idx(c, r));
          if (has) { if (start < 0) start = r; }
          else if (start >= 0) { const len = r - start; if (len > bestLen) { bestLen = len; bestRun = { axis: 'col', fixed: c, lo: start, hi: r - 1 }; } start = -1; }
        }
      }

      // generic single-cell placer: builds candidates at the given separation, picks the
      // best-scoring (min or max), seeded tie-break — used by sinkhole/ridge/anchor/nullcell.
      const placeCells = (want: number, type: string, buildCandidates: (sep: number) => number[], score: (i: number) => number, higherIsBetter: boolean) => {
        for (let n = 0; n < want; n++) {
          let candidates = buildCandidates(CT.minSeparation);
          if (!candidates.length) candidates = buildCandidates(1);
          if (!candidates.length) { console.warn(`buildGrid: could not place ${type} #${n + 1} on level ${this.level.id}`); continue; }
          let best = higherIsBetter ? -Infinity : Infinity;
          for (const i of candidates) { const s = score(i); if (higherIsBetter ? s > best : s < best) best = s; }
          const tied = candidates.filter(i => score(i) === best);
          const pick = tied[seededInt(cellsRng, 0, tied.length - 1)];
          specialMap.set(pick, { type });
          placedIdx.push(pick);
        }
      };

      const conduitPairCandidatesFromRun = (sep: number): [number, number][] => {
        if (!bestRun) return [];
        const pairs: { pair: [number, number]; dist: number }[] = [];
        const mid = (bestRun.lo + bestRun.hi) / 2;
        for (const off of [-1, 1]) {
          if (bestRun.axis === 'row') {
            const rr = bestRun.fixed + off;
            if (rr < 0 || rr >= this.rows) continue;
            for (let c = bestRun.lo; c < bestRun.hi; c++) {
              const i1 = this.idx(c, rr), i2 = this.idx(c + 1, rr);
              if (!isFreeForSpecial(i1) || !isFreeForSpecial(i2)) continue;
              if (pathAdjCount(c, rr) < 1 || pathAdjCount(c + 1, rr) < 1) continue;
              if (!farEnough(i1, sep) || !farEnough(i2, sep)) continue;
              pairs.push({ pair: [i1, i2], dist: Math.abs((c + 0.5) - mid) });
            }
          } else {
            const cc = bestRun.fixed + off;
            if (cc < 0 || cc >= this.cols) continue;
            for (let r = bestRun.lo; r < bestRun.hi; r++) {
              const i1 = this.idx(cc, r), i2 = this.idx(cc, r + 1);
              if (!isFreeForSpecial(i1) || !isFreeForSpecial(i2)) continue;
              if (pathAdjCount(cc, r) < 1 || pathAdjCount(cc, r + 1) < 1) continue;
              if (!farEnough(i1, sep) || !farEnough(i2, sep)) continue;
              pairs.push({ pair: [i1, i2], dist: Math.abs((r + 0.5) - mid) });
            }
          }
        }
        if (!pairs.length) return [];
        pairs.sort((a, b) => a.dist - b.dist);
        const bestDist = pairs[0].dist;
        const tied = pairs.filter(p => p.dist === bestDist).map(p => p.pair);
        return [tied[seededInt(cellsRng, 0, tied.length - 1)]];
      };
      const anyAdjacentPairCandidates = (sep: number): [number, number][] => {
        const found: [number, number][] = [];
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
          const i1 = this.idx(c, r);
          if (!isFreeForSpecial(i1) || pathAdjCount(c, r) < 1) continue;
          if (c + 1 < this.cols) {
            const i2 = this.idx(c + 1, r);
            if (isFreeForSpecial(i2) && pathAdjCount(c + 1, r) >= 1 && farEnough(i1, sep) && farEnough(i2, sep)) found.push([i1, i2]);
          }
          if (r + 1 < this.rows) {
            const i2 = this.idx(c, r + 1);
            if (isFreeForSpecial(i2) && pathAdjCount(c, r + 1) >= 1 && farEnough(i1, sep) && farEnough(i2, sep)) found.push([i1, i2]);
          }
        }
        return found;
      };
      const placeConduitPairs = (want: number) => {
        for (let n = 0; n < want; n++) {
          let pairs = conduitPairCandidatesFromRun(CT.minSeparation);
          if (!pairs.length) pairs = conduitPairCandidatesFromRun(1);
          if (!pairs.length) pairs = anyAdjacentPairCandidates(CT.minSeparation);
          if (!pairs.length) pairs = anyAdjacentPairCandidates(1);
          if (!pairs.length) { console.warn(`buildGrid: could not place conduit pair #${n + 1} on level ${this.level.id}`); continue; }
          const [i1, i2] = pairs[seededInt(cellsRng, 0, pairs.length - 1)];
          specialMap.set(i1, { type: 'conduit', partner: i2 });
          specialMap.set(i2, { type: 'conduit', partner: i1 });
          placedIdx.push(i1, i2);
        }
      };

      // resolve this level's cell inventory: authored per-level, or (endless) a seeded
      // weighted roll of 2-4 specials — per-run variety, like the endless modifier pick.
      let plan: { ridge: number; sinkhole: number; conduitPairs: number; anchor: number; nullcell: number };
      if (this.endless) {
        plan = { ridge: 0, sinkhole: 0, conduitPairs: 0, anchor: 0, nullcell: 0 };
        const pool: [keyof typeof plan, number][] = [['ridge', 30], ['sinkhole', 30], ['conduitPairs', 15], ['anchor', 15], ['nullcell', 10]];
        const totalWeight = pool.reduce((a, [, w]) => a + w, 0);
        const totalSpecials = seededInt(cellsRng, 2, 4);
        for (let i = 0; i < totalSpecials; i++) {
          let roll = cellsRng() * totalWeight;
          for (const [type, w] of pool) { if (roll < w) { plan[type]++; break; } roll -= w; }
        }
      } else {
        const cp = this.level.cellPlan || {};
        plan = { ridge: cp.ridge || 0, sinkhole: cp.sinkhole || 0, conduitPairs: cp.conduitPairs || 0, anchor: cp.anchor || 0, nullcell: cp.nullcell || 0 };
      }

      // fixed placement order: sinkhole -> ridge -> conduit pair -> anchor -> null zone.
      placeCells(plan.sinkhole, 'sinkhole',
        sep => allIdx.filter(i => isFreeForSpecial(i) && pathAdjCount(cOfIdx(i), rOfIdx(i)) >= 2 && farEnough(i, sep)),
        i => pathAdjCount(cOfIdx(i), rOfIdx(i)), true);
      placeCells(plan.ridge, 'ridge',
        sep => allIdx.filter(i => { const c = cOfIdx(i), r = rOfIdx(i); return isFreeForSpecial(i) && pathAdjCount(c, r) === 0 && pathNear(c, r, 3) && farEnough(i, sep); }),
        i => distToNearestCorner(cOfIdx(i), rOfIdx(i)), false);
      placeConduitPairs(plan.conduitPairs);
      placeCells(plan.anchor, 'anchor',
        sep => allIdx.filter(i => isFreeForSpecial(i) && farEnough(i, sep)),
        i => anchorScore(cOfIdx(i), rOfIdx(i)), true);
      placeCells(plan.nullcell, 'nullcell',
        sep => allIdx.filter(i => { const c = cOfIdx(i), r = rOfIdx(i); return isFreeForSpecial(i) && nearFinalThird(c, r) && farEnough(i, sep); }),
        () => 0, true);
    }

    this.pathOrderedCells = pathCellsOrderedAll;
    this.cells = [];
    this.occupied = [];
    this.nullCells = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = this.idx(c, r);
        const isPath = pathTiles.has(i);
        const isRock = rockTiles.has(i);
        const isEnd = endTiles.has(i);
        const sp = specialMap.get(i);
        const isNull = sp?.type === 'nullcell';
        if (isNull) this.nullCells.push(i);
        this.cells.push({
          x: this.cx(c), y: this.cy(r), col: c, row: r,
          path: isPath, rock: isRock, vein: veinTiles.has(i),
          valid: !isPath && !isRock && !isEnd && !isNull,
          special: sp ? sp.type : null,
          conduitPartner: sp?.partner,
        });
        this.occupied.push(null);
      }
    }
    this.nullCellPx = this.nullCells.map(i => ({ x: this.cells[i].x, y: this.cells[i].y }));
  }
  cellAt(x: number, y: number): number {
    const c = this.colOf(x), r = this.rowOf(y);
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return -1;
    return this.idx(c, r);
  }
  cellFree(i: number, ignore: Tower | null = null) {
    return i >= 0 && this.cells[i].valid && (this.occupied[i] === null || this.occupied[i] === ignore);
  }
  // Chebyshev tile range check from a tower (or tile) to a point
  // A cell is in range if it overlaps a circle of radius R tiles centred on (cx, cy).
  circCell(cx: number, cy: number, R: number, col: number, row: number) {
    const x0 = this.gx0 + col * this.cell, y0 = this.gy0 + row * this.cell;
    const nx = clamp(cx, x0, x0 + this.cell), ny = clamp(cy, y0, y0 + this.cell);
    const rr = R * this.cell;
    return (nx - cx) * (nx - cx) + (ny - cy) * (ny - cy) < rr * rr - 0.001;
  }
  inRangeT(t: Tower, e: { x: number; y: number }, R: number) {
    return this.circCell(t.x, t.y, R, this.colOf(e.x), this.rowOf(e.y));
  }

  // Count of path cells within a tower's current range (Phase 3B.4) — recomputed on
  // build/move/upgrade/grid-rebuild, never per-frame. Phase 6's threat-readout coverage
  // math is meant to reuse this exact helper, so it stays a plain, self-contained scan.
  recomputeCoverage(t: Tower) {
    const R = t.rangeT();
    let n = 0;
    for (const c of this.cells) if (c.path && this.circCell(t.x, t.y, R, c.col, c.row)) n++;
    t.pathCellsInRange = n;
  }

  // ---------- Threat readout (Phase 6.4) ----------
  // A deliberately simple, per-kind DPS approximation — not a combat simulator. Its job is to
  // move in the right direction as coverage changes, not predict exact outcomes (the UI
  // tooltip says so explicitly). Always reads live stats(game), so buffs/cells/perks/meta are
  // automatically folded in; Overcharge is excluded on purpose (a mid-wave burst, not baseline).
  towerDPS(t: Tower): { ground: number; air: number } {
    const s = t.stats(this);
    let base = 0;
    if (s.aura) {
      base = s.dmg;
    } else {
      switch (t.spec.kind) {
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
        // Flame isn't in the plan's explicit kind list (a cone tick, not a projectile) —
        // approximated as a plain direct hit; its burn already lands via the addition below.
        case 'flame': base = s.dmg * s.rate; break;
        case 'amp': base = 0; break; // its value flows through OTHER towers' buffed stats(), never counted twice
      }
    }
    if (s.burnDps) base += s.burnDps * Math.min(1, (s.burnDur || 0) * s.rate);
    const ground = base;
    const air = s.groundOnly ? 0 : base * (s.airMul || 1);
    return { ground, air };
  }
  // Ground coverage: reuses the exact Phase 3B.4 helper, never re-implemented.
  groundCov(t: Tower): number {
    return Math.min(1, t.pathCellsInRange / TUNING.threat.coveragePathCells);
  }
  // Air coverage: sampled against the PENDING wave's flier lane (Phase 5.4) when it carries
  // one; otherwise falls back to "in range of any base" as a coarse always-available proxy.
  airCov(t: Tower): number {
    const s = t.stats(this);
    if (s.groundOnly) return 0;
    const R = t.rangeT() * this.cell;
    const hasFlier = !!this.pendingWave?.some(grp => ENEMIES[grp.e].flying);
    if (hasFlier) {
      const lane = this.flierLanePoints(this.waveIdx + 1);
      if (lane.length) {
        const inRange = lane.filter(p => dist(t.x, t.y, p.x, p.y) <= R).length;
        return Math.min(1, inRange / TUNING.threat.coverageLanePts);
      }
    }
    for (const b of this.basePx) if (dist(t.x, t.y, b.x, b.y) <= R) return 1;
    return 0;
  }
  // Wave demand (effHP, ground/air split) + deliverable DPS -> a comfortable/tight/leak
  // verdict, worst of the two domains. Boss waves are excluded (never shaped/decorated, and
  // boss theater already telegraphs them loudly) — returns null for them, and for no pending
  // wave at all, so the UI can hide the chip cleanly.
  computeThreat(): { ground: number | null; air: number | null; verdict: 'comfortable' | 'tight' | 'leak' } | null {
    const wave = this.pendingWave;
    if (!wave || !wave.length || wave.some(grp => ENEMIES[grp.e].boss)) return null;
    const waveIdx = this.waveIdx + 1;
    const mutator = this.pendingMutator;
    const shape = this.level.waveShapes?.[waveIdx];
    const M = TUNING.mutators;
    const hpBase = this.endless ? this.endlessHpMul(waveIdx) : this.level.hpMul;
    const scale = hpBase * (1 + waveIdx * 0.03) * this.diffHp;

    let effHPGround = 0, effHPAir = 0;
    let groundN = 0, groundSpeedSum = 0, airN = 0, airSpeedSum = 0;
    for (const grp of wave) {
      const spec = ENEMIES[grp.e];
      let n = grp.n, hp = spec.hp;
      if (mutator === 'horde') { n = Math.round(n * M.hordeCountMul); hp *= M.hordeHpMul; }
      const shieldFrac = Math.max(spec.shield || 0, mutator === 'armored' ? M.armoredShieldFrac : 0);
      const eff = n * hp * scale * (1 + shieldFrac);
      if (spec.flying) { effHPAir += eff; airN += n; airSpeedSum += n * spec.speed; }
      else { effHPGround += eff; groundN += n; groundSpeedSum += n * spec.speed; }
    }
    if (groundN === 0 && airN === 0) return null;

    const speedMul = mutator === 'frenzied' ? M.frenziedSpeed : 1;
    const avgGroundSpeed = groundN > 0 ? (groundSpeedSum / groundN) * speedMul : 1;
    const avgAirSpeed = airN > 0 ? (airSpeedSum / airN) * speedMul : 1;

    let pathLenPx = 0, pathWeight = 0;
    for (const grp of wave) {
      if (ENEMIES[grp.e].flying) continue;
      const pi = grp.p || 0;
      pathLenPx += (this.paths[pi]?.total || this.paths[0].total) * grp.n;
      pathWeight += grp.n;
    }
    const Tground = groundN > 0 ? (pathWeight > 0 ? pathLenPx / pathWeight : this.paths[0].total) / avgGroundSpeed : 0;

    let Tair = 0;
    if (airN > 0) {
      let laneLenPx = 0, laneWeight = 0;
      for (const grp of wave) {
        if (!ENEMIES[grp.e].flying) continue;
        const pi = grp.p || 0;
        const portal = this.portalPx[pi], base = this.basePx[pi];
        let len = 0;
        if (portal && base) {
          const c = this.flierLaneControl(waveIdx, portal, base);
          len = bezierArcLen(portal.x, portal.y, c.x, c.y, base.x, base.y);
        }
        laneLenPx += len * grp.n;
        laneWeight += grp.n;
      }
      Tair = laneWeight > 0 ? (laneLenPx / laneWeight) / avgAirSpeed : 0;
    }

    // Shaped waves adjust efficiency, not transit — rush compresses arrival (simultaneity
    // wastes DPS that can only hit one target at a time), trickle spaces it out (sequential
    // targets waste nothing); convoy/feint are neutral here (their effect is targeting order/
    // timing, not raw throughput).
    let eff = TUNING.threat.efficiency;
    if (shape === 'rush') eff *= 0.8;
    else if (shape === 'trickle') eff *= 1.15;

    let deliverableGround = 0, deliverableAir = 0;
    for (const t of this.towers) {
      const dps = this.towerDPS(t);
      deliverableGround += dps.ground * this.groundCov(t) * Tground * eff;
      deliverableAir += dps.air * this.airCov(t) * Tair * eff;
    }

    const rGround = effHPGround > 0 ? deliverableGround / effHPGround : null;
    const rAir = effHPAir > 0 ? deliverableAir / effHPAir : null;
    const ratios = [rGround, rAir].filter((r): r is number => r !== null);
    const worst = ratios.length ? Math.min(...ratios) : 1;
    const T = TUNING.threat;
    const verdict: 'comfortable' | 'tight' | 'leak' = worst >= T.comfortable ? 'comfortable' : worst >= T.tight ? 'tight' : 'leak';
    return { ground: rGround, air: rAir, verdict };
  }
  // Call after any tower/wave state change the readout depends on (build/sell/move/upgrade/
  // perk/wave-prep) — deliberately NOT per frame, per the plan.
  recomputeThreat() { this.threatVerdict = this.computeThreat(); }

  // ---------- economy ----------
  costOf(spec: TowerSpec) { return this.devFree ? 0 : Math.round(spec.stages[0].cost * this.metaCostMul); }
  upgradeCost(stat: StageStats) { return this.devFree ? 0 : Math.round(stat.cost * this.metaCostMul); }

  // Refund a bought upgrade node (and every purchase that depends on it).
  // kind 'stage' with idx 1|2, or kind 'branch' with row 0|1 (current branch).
  refundNode(t: Tower, kind: 'stage' | 'branch', idx: number) {
    let refund = 0;
    const costOf = (st: StageStats) => this.upgradeCost(st);
    if (kind === 'stage') {
      if (t.branch >= 0) {
        refund += costOf(t.spec.branches[t.branch][0]);
        if (t.branchStage >= 1) refund += costOf(t.spec.branches[t.branch][1]);
        t.branch = -1; t.branchStage = 0;
      }
      for (let s = t.stage; s >= idx; s--) refund += costOf(t.spec.stages[s]);
      t.stage = idx - 1;
    } else {
      if (t.branch < 0) return;
      if (idx === 0) {
        if (t.branchStage >= 1) refund += costOf(t.spec.branches[t.branch][1]);
        refund += costOf(t.spec.branches[t.branch][0]);
        t.branch = -1; t.branchStage = 0;
      } else {
        if (t.branchStage < 1) return;
        refund += costOf(t.spec.branches[t.branch][1]);
        t.branchStage = 0;
      }
    }
    // In-wave refunds are cut to 72% (closes the refund-everything-at-wave-clear interest
    // exploit — interest pays on the still-active wave's balance, so the round trip is now
    // strictly unprofitable). Between waves, refunds stay full — deliberate: free
    // experimentation with your build is a design value worth keeping. `t.spent` always
    // drops by the FULL node value regardless — it tracks investment, not payout.
    const payout = this.waveActive ? Math.round(refund * TUNING.economy.refundInWaveMul) : refund;
    this.credits += payout;
    t.spent = Math.max(0, t.spent - refund);
    t.rampT = 0; t.cool = Math.min(t.cool, 1);
    this.recomputeCoverage(t);   // a refunded node can shrink range back down (Phase 3B.4)
    this.recomputeThreat();
    audio.ui('sell');
    audio.bell(0.6);
    this.floater(t.x, t.y - 30, `+${payout} refunded`, '#fff3b0');
    this.parts.push({ x: t.x, y: t.y, vx: 0, vy: 0, life: 0.35, max: 0.35, size: 40, color: '#ffb3c6', kind: 'ring' });
    this.onSelect(); this.onHud();
  }

  // ---------- waves ----------
  waveAt(i: number): WaveGroup[] | null {
    if (!this.endless && i >= this.totalWaves) return null;
    return this.endless ? this.genEndlessWave(i) : this.waves[i];
  }

  // Hard+ difficulty composition (Phase 5.5): a deterministic extra enemy group injected into
  // eligible waves — never wave 1, never a boss wave, never a shaped wave (one twist at a
  // time). Injected upstream of BOTH the forecast preview and the real spawn queue (both read
  // pendingWave/pending2Wave exclusively through this function), so the forecast never lies
  // about what's coming — the same "roll once, upstream" pattern rollMutator already uses.
  decorateWave(i: number): WaveGroup[] | null {
    const wave = this.waveAt(i);
    if (!wave || this.diffTier < 3 || i === 0) return wave;
    if (wave.some(grp => ENEMIES[grp.e].boss)) return wave;
    if (this.level.waveShapes?.[i] !== undefined) return wave;
    const rng = mulberry32(hashString(`${this.level.id}-inj-${i}-${this.diffTier}`));
    const inWave = new Set(wave.map(grp => grp.e));
    const pool = Object.keys(ENEMIES).filter(id => !ENEMIES[id].boss && !inWave.has(id) && (ENEMY_INTRO[id] ?? 999) <= this.level.id);
    if (!pool.length) return wave;
    const e = pool[Math.floor(rng() * pool.length)];
    const waveBounty = wave.reduce((a, grp) => a + ENEMIES[grp.e].reward * grp.n, 0);
    const n = clamp(Math.ceil(waveBounty * 0.12 / ENEMIES[e].reward), 2, 8);
    const times = wave.flatMap(grp => Array.from({ length: grp.n }, (_, k) => grp.d + k * grp.iv));
    const d = (Math.min(...times) + Math.max(...times)) / 2;
    const paths = [...new Set(wave.map(grp => grp.p || 0))];
    const p = paths[Math.floor(rng() * paths.length)];
    return [...wave, { e, n, iv: 0.9, d, p }];
  }

  // Roll a mutator for wave index i. Locked at generation time so the forecast
  // is always honest — what's previewed is exactly what arrives.
  rollMutator(i: number, prevMutated: boolean): string | null {
    if (!isUnlocked('mutators')) return null;
    // A shaped wave never also mutates (Phase 5.2) — one twist per wave, cognitively.
    if (this.level.waveShapes?.[i] !== undefined) return null;
    const M = TUNING.mutators;
    const fromWave = this.ascTier >= 2 ? TUNING.ascension.mutatorFromWave : M.fromWave;
    if (i + 1 < fromWave) return null;
    if (prevMutated && this.level.id < M.noBackToBackBeforeLevel) return null;
    const chance = (this.endless && i >= 9 ? M.endlessLate
      : M.baseChance + this.level.id * M.perLevel + this.diffTier * M.perDifficulty)
      + (this.ascTier >= 2 ? TUNING.ascension.mutationBonus : 0)
      + this.extraMutatorChance;
    if (Math.random() >= chance) return null;
    if (this.firstMutator) { this.firstMutator = false; return 'bounty'; }
    const pool = Object.values(MUTATORS).filter(m => !m.hard || isUnlocked('mutators_hard') || this.endless);
    return pool[Math.floor(Math.random() * pool.length)].id;
  }

  // Keep both forecast slots filled: pending (next wave) and pending2 (the one after).
  preparePending() {
    if (!this.pendingWave) {
      if (this.pending2Wave) {
        this.pendingWave = this.pending2Wave; this.pendingMutator = this.pending2Mutator;
        this.pending2Wave = null; this.pending2Mutator = null;
      } else {
        this.pendingWave = this.decorateWave(this.waveIdx + 1);
        this.pendingMutator = this.pendingWave ? this.rollMutator(this.waveIdx + 1, this.waveMutator !== null) : null;
      }
    }
    if (!this.pending2Wave && this.pendingWave) {
      this.pending2Wave = this.decorateWave(this.waveIdx + 2);
      this.pending2Mutator = this.pending2Wave ? this.rollMutator(this.waveIdx + 2, this.pendingMutator !== null) : null;
    }
    this.recomputeThreat(); // wave-prep event (Phase 6.4.5) — the pending wave just (re)filled
  }

  // Bounty of the currently pending wave, at the reward scale it would spawn under right
  // now — ignores mutator adjustments (bounty/horde) as a deliberate simplification, so the
  // early-call preview stays cheap to compute every frame.
  pendingWaveBounty(): number {
    if (!this.pendingWave) return 0;
    const mul = this.waveRewardMul();
    return this.pendingWave.reduce((a, g) => a + ENEMIES[g.e].reward * g.n * mul, 0);
  }

  // Wave shapes (Phase 5.1/5.2): re-time/reorder an already-expanded spawn queue in place.
  // Operates on individual spawn entries (post group-expansion), since every transform needs
  // real per-enemy timing/HP, not the authored group summary. Never touches roster or stats.
  applyWaveShape(shape: WaveShape, queue: { t: number; e: string; p: number }[]) {
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
        // Multi-path levels: the leader/mender/rest ordering runs independently per path,
        // since each path is its own visible lane — a leader on path 0 says nothing about
        // path 1's formation.
        const hp = (s: { e: string }) => ENEMIES[s.e].hp;
        for (const p of new Set(queue.map(s => s.p))) {
          const subset = queue.filter(s => s.p === p);
          const t0 = Math.min(...subset.map(s => s.t));
          const menders = subset.filter(s => s.e === 'mender');
          const rest = subset.filter(s => s.e !== 'mender');
          let leader: typeof subset[number] | null = null;
          for (const s of rest) if (!leader || hp(s) > hp(leader)) leader = s;
          const others = rest.filter(s => s !== leader).sort((a, b) => hp(b) - hp(a));
          const ordered = leader ? [leader, ...menders, ...others] : [...menders, ...others];
          ordered.forEach((s, i) => { s.t = t0 + i * 0.5; });
        }
        break;
      }
      case 'feint': {
        const sorted = [...queue].sort((a, b) => a.t - b.t);
        const numPaths = this.paths.length;
        const hasFliers = sorted.some(s => !!ENEMIES[s.e].flying);
        if (numPaths <= 1 && hasFliers) {
          // Single-path levels have no portal to flip to — a wave's fliers already fly their
          // own curved lane (5.4), so delaying just them in time IS the "different portal" cue.
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
  callWave(early: boolean, auto = false) {
    if (this.state !== 'playing' || this.waveActive || !this.pendingWave) return;
    if (!early) this.lateCallHappened = true;
    // Early-call bonus is a % of the pending wave's bounty, scaled by how much time was
    // left on the clock — a deliberate risk/reward read on the forecast, not a flat tip.
    // Auto-called waves never earn it: if auto-call paid out, auto mode would be strictly
    // optimal and the "call it early yourself" decision would vanish.
    if (early && !auto && this.interT > 0.5) {
      const E = TUNING.economy;
      const frac = Math.min(E.earlyCallCap, this.interT * E.earlyCallPerSec);
      const bonus = Math.round(this.pendingWaveBounty() * frac);
      if (bonus > 0) {
        this.credits += bonus;
        this.floater(W / 2, 120, `Early call +${bonus} ◆ (+${Math.round(frac * 100)}%)`, '#fff3b0');
        audio.bell(0.8);
      }
    }
    this.waveIdx++;
    this.waveActive = true;
    this.interT = 0;
    if (isUnlocked('overcharge')) {
      this.overchargeLeft = TUNING.overcharge.charges;
      // L4 is the "things you TAP" level alongside drops — deliberate pairing (Phase 4.5).
      if (!this.endless && this.level.id === 4 && this.waveIdx === 0) {
        this.onToast('overcharge', 'OVERCHARGE — tap a tower during a wave, then hit ⚡ to double its fire rate for 3 seconds. 3 charges per wave.');
      }
    }
    const wave = this.pendingWave;
    this.waveMutator = this.pendingMutator;
    this.pendingWave = null;
    this.pendingMutator = null;
    const hordeMul = this.waveMutator === 'horde' ? TUNING.mutators.hordeCountMul : 1;
    const queued: { t: number; e: string; p: number }[] = [];
    for (const grp of wave) {
      const n = ENEMIES[grp.e].boss ? grp.n : Math.round(grp.n * hordeMul);
      for (let i = 0; i < n; i++) {
        queued.push({ t: this.now + grp.d + i * grp.iv / hordeMul, e: grp.e, p: grp.p || 0 });
      }
    }
    // Wave shapes (Phase 5.1): re-time/reorder the just-expanded queue in place before it
    // joins the live spawnQueue — this is the ONLY point that matters, since the forecast
    // preview reads the authored WaveGroup array directly (never the expanded queue), and
    // shapes are cosmetic/pacing-only (same roster, same total count).
    const shape = this.level.waveShapes?.[this.waveIdx];
    if (shape) this.applyWaveShape(shape, queued);
    this.spawnQueue.push(...queued);
    this.waveTotalSpawns = queued.length;
    this.lastStandFired = false;
    if (this.scriptDrop && this.waveIdx === 1) {
      this.scriptDrop = false;
      this.nextDropAt = this.now + 4;
      this.forceNextDrop = true;
    }
    const hasBoss = wave.some(grp => ENEMIES[grp.e].boss);
    if (hasBoss) {
      const bossSpec = ENEMIES[wave.find(grp => ENEMIES[grp.e].boss)!.e];
      this.onBanner(`⚠ ${bossSpec.name} ⚠`, '#ff8fa3', 'critical');
      if (isUnlocked('boss_theater')) {
        // 7.6.1: 400ms of near-silence before the klaxon fires — the red vignette already
        // fills the visual gap, and the room dropping out first makes the klaxon land harder.
        audio.duckAll(0.05, 400, 250);
        audio.klaxon(0.4);
        this.bossVignetteUntil = this.now + 3;
      }
      else audio.ui('boss');
      this.shake(8);
    }
    else { this.onBanner(`Wave ${this.waveIdx + 1}`, '#a0d8ef', 'medium'); audio.ui('wave'); }
    if (this.waveMutator) {
      const m = MUTATORS[this.waveMutator];
      this.onBanner(`${m.icon} ${m.name.toUpperCase()} WAVE`, m.color, 'medium', m.blurb);
      this.onToast('mutators', 'Mutated waves twist the rules — the forecast up top warns you before you launch.');
    }
    this.preparePending(); // so the next wave can be previewed during this one
  }

  genEndlessWave(i: number): WaveGroup[] {
    const pool = ['drone', 'dart', 'swarmling', 'brute', 'aegis', 'wisp', 'raptor', 'mender', 'splitter', 'phase'];
    const gs: WaveGroup[] = [];
    if ((i + 1) % 10 === 0) {
      const b = ['mothership', 'colossus', 'leviathan'][Math.min(2, Math.floor(i / 10))];
      gs.push({ e: b, n: 1, iv: 0, d: 2 });
    }
    let budget = 55 + i * 26;
    let delay = 0;
    while (budget > 0) {
      const id = pool[Math.floor(Math.random() * Math.min(pool.length, 3 + Math.floor(i / 1.4)))];
      const spec = ENEMIES[id];
      const cost = Math.max(4, spec.hp / 8);
      const n = clamp(Math.floor(budget / cost / 2) + 1, 2, id === 'swarmling' ? 20 : 9);
      gs.push({ e: id, n, iv: clamp(1.1 - i * 0.02, 0.2, 1.1), d: delay });
      budget -= cost * n;
      delay += rand(1.5, 3.5);
    }
    return gs;
  }
  endlessHpMul(i: number) { return 1 + i * 0.22 + i * i * 0.012; }

  // The reward multiplier every enemy bounty already uses — extracted so secondary
  // credit sources (combo, drops, fragments, veins, wave-clear bonus, interest cap)
  // can scale identically. Includes difficulty reward multiplier.
  waveRewardMul(): number {
    // waveIdx starts at -1 before the first wave launches (e.g. when the interest cap is
    // set at construction) — clamp so that reads as "wave 0", not a negative endless bonus.
    const waveIdx = Math.max(0, this.waveIdx);
    return (1 + (this.level.hpMul - 1) * TUNING.economy.bountyCoef
      + (this.endless ? waveIdx * 0.05 : 0)) * this.diffReward;
  }
  // Convenience for scaling flat credit values. Always Math.round at the call site.
  econScale(): number { return this.waveRewardMul(); }

  // Mirrors the enemy HP spawn formula — used to scale flat ability damage (Orbital Strike)
  // so a fixed hit still means something at L15 Ascension V, not just L1.
  currentHpScale(): number {
    const base = this.endless ? this.endlessHpMul(this.waveIdx) : this.level.hpMul;
    return base * (1 + this.waveIdx * 0.03) * this.diffHp;
  }

  // Flier lanes (Phase 5.4): the curved bezier control point every flier in a given wave
  // shares — seeded purely by level+wave, so it's identical for every enemy instance (no
  // shared state needed), for the pre-launch telegraph, and for a mirrored Daily Op (the
  // seed doesn't depend on portal/base position, only which are already mirrored upstream).
  // Clamped generously beyond the canvas (portals themselves already sit off-screen) — since a
  // quadratic bezier's whole curve lies within the convex hull of its 3 points, clamping this
  // one point is sufficient to guarantee the entire lane stays on/near screen.
  flierLaneControl(waveIdx: number, portal: { x: number; y: number }, base: { x: number; y: number }): { x: number; y: number } {
    const r = mulberry32(hashString(`${this.level.id}-fly-${waveIdx}`));
    const o = (r() < 0.5 ? -1 : 1) * (120 + r() * 120);
    const dx = base.x - portal.x, dy = base.y - portal.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;
    const mx = (portal.x + base.x) / 2, my = (portal.y + base.y) / 2;
    return { x: clamp(mx + px * o, -80, W + 80), y: clamp(my + py * o, -80, H + 80) };
  }
  // Phase 6 forward-hook: 16 sampled points along a wave's flier lane, for air-coverage math.
  // Multi-path levels have one lane per path with fliers; this returns path 0's for simplicity
  // since nothing consumes it yet — revisit if Phase 6 needs every path's lane.
  flierLanePoints(waveIdx: number): { x: number; y: number }[] {
    const portal = this.portalPx[0], base = this.basePx[0];
    if (!portal || !base) return [];
    const c = this.flierLaneControl(waveIdx, portal, base);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 16; i++) pts.push(bezierAt(portal.x, portal.y, c.x, c.y, base.x, base.y, i / 16));
    return pts;
  }

  mkEnemy(id: string, pathIdx: number, hpMul: number, rewardMul: number) {
    const spec = ENEMIES[id];
    const pi = Math.min(pathIdx, this.paths.length - 1);
    return new Enemy(spec, this.paths[pi], pi, hpMul * this.diffHp, rewardMul * this.diffReward, this.portalPx[pi], this.basePx[pi]);
  }

  spawnAt(id: string, near: Enemy) {
    const spec = ENEMIES[id];
    const e = this.mkEnemy(id, near.pathIdx, near.hpMul * 0.7, 1);
    if (spec.flying) {
      e.fx0 = near.x; e.fy0 = near.y;
      // Boss-spawned minions stay a straight line (Phase 5.4.2) — their origin already varies
      // with the boss's own position, so a curved lane would be redundant unpredictability.
      e.fcx = (e.fx0 + e.fx1) / 2; e.fcy = (e.fy0 + e.fy1) / 2;
      e.fDur = Math.max(0.1, dist(near.x, near.y, e.fx1, e.fy1) / spec.speed);
      e.x = near.x; e.y = near.y;
    } else {
      e.d = near.spec.flying ? this.nearestPathD(near) : near.d;
    }
    this.enemies.push(e);
    this.spark(near.x, near.y, this.palEnemy(spec.id)[0], 8);
    if (!spec.boss) audio.spawnSig(spec.id);
  }
  nearestPathD(near: Enemy) {
    let best = 0, bd = Infinity;
    for (let d = 0; d < near.path.total; d += 24) {
      const p = near.path.at(d);
      const dd = dist(p.x, p.y, near.x, near.y);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  // ---------- update ----------
  update(dt: number, rawDt: number) {
    if (dt > 0) this.now += dt;
    const now = this.now;

    for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
      const s = this.spawnQueue[i];
      if (now >= s.t) {
        this.spawnQueue.splice(i, 1);
        const spec = ENEMIES[s.e];
        const hpMul = (this.endless ? this.endlessHpMul(this.waveIdx) : this.level.hpMul) * (1 + this.waveIdx * 0.03);
        // mkEnemy() multiplies rewardMul by this.diffReward internally — waveRewardMul()
        // already includes diffReward, so divide it back out here to apply it exactly once.
        const rewardMul = this.waveRewardMul() / this.diffReward;
        const e = this.mkEnemy(s.e, s.p, hpMul, rewardMul);
        // Flier lanes (Phase 5.4): every flier THIS wave shares the same seeded curve — the
        // elite-swift affix speed adjustment below still divides whatever fDur ends up here,
        // so it must run before that (order preserved from the original straight-line code).
        if (e.spec.flying) {
          const pi = Math.min(s.p, this.paths.length - 1);
          const portal = this.portalPx[pi], base = this.basePx[pi];
          if (portal && base) {
            const c = this.flierLaneControl(this.waveIdx, portal, base);
            e.fcx = c.x; e.fcy = c.y;
            e.fDur = Math.max(0.1, bezierArcLen(e.fx0, e.fy0, e.fcx, e.fcy, e.fx1, e.fy1) / e.spec.speed);
          }
        }
        if (this.waveMutator) this.applyMutator(e);
        // --- elite promotion ---
        if (!e.spec.boss && isUnlocked('elites')) {
          const E = TUNING.elites;
          const chance = (E.baseChance + this.level.id * E.perLevel + this.diffTier * E.perDifficulty
            + (this.endless ? this.waveIdx * E.perEndlessWave : 0)) * (this.ascTier >= 3 ? TUNING.ascension.eliteMul : 1);
          const forced = this.scriptElite && this.waveIdx === 2;
          if (forced || Math.random() < chance) {
            if (forced) this.scriptElite = false;
            const pool = ['shielded', 'swift', 'vampiric'] as const;
            const first = forced ? 'shielded' as const : pool[Math.floor(Math.random() * 3)];
            const affixes: ('shielded' | 'swift' | 'vampiric')[] = [first];
            if (!forced && this.ascTier >= 3 && Math.random() < TUNING.ascension.dualAffixChance) {
              const second = pool.filter(a => a !== first)[Math.floor(Math.random() * 2)];
              affixes.push(second);
            }
            e.makeElite(affixes);
            if (forced) this.onToast('elites', 'A crowned ELITE — tougher, faster to act on, triple bounty. Focus fire it down!');
          }
        }
        this.enemies.push(e);
        this.portalFx(e);
        if (!spec.boss) audio.spawnSig(spec.id);   // spawn signature (Phase 7.2) — bosses own the klaxon path
        if (this.level.newEnemy && s.e === this.level.newEnemy.id && !this.seenNewEnemy) {
          this.seenNewEnemy = true;
          this.onBanner(`New foe: ${spec.name}`, this.palEnemy(spec.id)[0], 'medium', spec.desc);
        }
        if (spec.boss) {
          this.shake(isUnlocked('boss_theater') ? 10 : 6);
          if (isUnlocked('boss_theater')) {
            this.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.6, max: 0.6, size: spec.size * 4, color: this.palEnemy(spec.id)[0], kind: 'ring' });
            for (let k = 0; k < 14; k++) this.smoke(e.x + rand(-spec.size, spec.size), e.y + rand(-spec.size * 0.6, spec.size * 0.6));
            audio.explosion('big');
          }
        }
      }
    }

    if (this.waveActive && this.spawnQueue.length === 0 && this.enemies.length === 0 && this.state === 'playing') {
      this.waveActive = false;
      this.runStats.wavesCleared++;
      this.slowMo(0.4, 0.3);
      this.screenFlash(0.3);
      const bonus = Math.round((30 + this.waveIdx * 4) * this.econScale());
      this.credits += bonus;
      this.floater(W / 2, 120, `Wave clear  +${bonus}`, '#a8e6cf');
      audio.bell(1.0);
      // banked-credit interest (risk/reward: spend now vs save for the payout)
      if (isUnlocked('interest')) {
        const interest = Math.min(Math.floor((this.credits - bonus) * TUNING.interest.rate), this.interestCap);
        if (interest > 0) {
          this.credits += interest;
          this.floater(W / 2, 146, `Interest  +${interest} ◆`, '#fff3b0');
          this.onToast('interest', 'Banked credits earn 6% interest at each wave clear (capped) — saving up pays.');
        }
      }
      if (!this.endless && this.waveIdx + 1 >= this.totalWaves) { this.win(); return; }
      this.onWaveClear();
      this.interMax = (this.endless ? 14 : 13) * (this.ascTier >= 5 ? TUNING.ascension.intermissionMul : 1);
      this.interT = this.interMax;
      this.preparePending();
      if (this.autoWave) this.callWave(true, true);
    }
    // ---------- boss phase 2 (50% HP) ----------
    if (isUnlocked('boss_phase2')) {
      for (const e of this.enemies) {
        if (!e.spec.boss || e.dead || e.bossPhase !== 1 || e.hp > e.maxHp * 0.5) continue;
        e.bossPhase = 2;
        e.phase2BaseSpeed = e.spec.speed;
        this.onBanner(`${e.spec.name} — PHASE 2`, '#ff8fa3', 'medium');
        this.shake(8);
        this.ringFx(e.x, e.y, e.spec.size * 3, '#ff8fa3');
        audio.ui('boss');
        if (e.spec.id === 'mothership') {
          e.spec = { ...e.spec, speed: e.spec.speed * 1.3, spawnMinion: e.spec.spawnMinion ? { ...e.spec.spawnMinion, every: e.spec.spawnMinion.every / 2 } : undefined };
        } else if (e.spec.id === 'leviathan') {
          e.arcA = Math.random() * Math.PI * 2;
          e.shield = e.maxShield; // barrier snaps back to full as it reconfigures
        }
        // colossus: handled per-EMP (radius ×2, rage stacking)
      }
    }

    // ---------- NOVA ----------
    if (this.novaFireAt > 0 && now >= this.novaFireAt) {
      this.novaFireAt = 0;
      this.novaCharge = 0;
      this.novaNeed = Math.round(this.novaNeed * TUNING.nova.rechargeGrowth);
      this.runStats.novasFired++;
      audio.novaBlast();
      this.screenFlash(1);
      this.slowMo(0.5, 0.25);
      this.shake(14);
      this.buzz([60, 40, 80]);
      this.parts.push({ x: W / 2, y: H / 2, vx: 0, vy: 0, life: 0.7, max: 0.7, size: W * 0.75, color: '#fff3b0', kind: 'ring' });
      for (const e of [...this.enemies]) {
        if (e.dead) continue;
        const N = TUNING.nova;
        e.hurt(Math.max(1, Math.round(e.hp * (e.spec.boss ? N.fracBoss : N.fracNormal))), this, true);
        if (!e.spec.boss) e.frozenUntil = Math.max(e.frozenUntil, this.now + N.stunDur);
      }
      this.onHud();
    }

    // ---------- floating damage numbers (batched per enemy, ~4/s each) ----------
    if (this.damageNumbersOn && dt > 0) {
      for (const e of this.enemies) {
        if (e.dmgAccum >= 1 && now >= e.dmgFlushAt) {
          this.dmgText(e.x + rand(-8, 8), e.y - e.spec.size - 6, e.dmgAccum);
          e.dmgAccum = 0;
          e.dmgFlushAt = now + 0.28;
        }
      }
    }

    // ---------- combo timeout ----------
    if (this.comboCount > 0 && now - this.lastKillAt > TUNING.combo.window) {
      this.comboCount = 0;
    }

    // ---------- meteor shower modifier ----------
    if (this.mods.has('meteors') && this.state === 'playing' && dt > 0 && this.waveActive) {
      const M = TUNING.meteors;
      if (this.nextMeteorAt === 0) this.nextMeteorAt = now + rand(M.intervalMin, M.intervalMax);
      if (!this.meteorWarn && now >= this.nextMeteorAt) {
        // prefer a cell holding a tower; fall back to any buildable cell
        const occ = this.towers.map(t => t.cell).filter(c => c >= 0);
        const cell = occ.length && Math.random() < 0.75
          ? occ[Math.floor(Math.random() * occ.length)]
          : (() => { const v = this.cells.map((c, i) => c.valid ? i : -1).filter(i => i >= 0); return v[Math.floor(Math.random() * v.length)]; })();
        this.meteorWarn = { cell, at: now + M.warning };
        this.nextMeteorAt = now + rand(M.intervalMin, M.intervalMax);
        audio.ui('boss');
        this.onToast('mod_meteors', 'METEOR INBOUND — the red ring marks the impact. Towers hit are knocked offline for 6s.');
      }
      if (this.meteorWarn && now >= this.meteorWarn.at) {
        const cellIdx = this.meteorWarn.cell;
        const c = this.cells[cellIdx];
        this.meteorWarn = null;
        this.shake(7);
        audio.explosion('big');
        this.parts.push({ x: c.x, y: c.y, vx: 0, vy: 0, life: 0.45, max: 0.45, size: this.cell * 1.6, color: '#ff9d76', kind: 'ring' });
        for (let i = 0; i < 16; i++) {
          const a = Math.random() * Math.PI * 2, sp = rand(90, 320);
          this.parts.push({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.7), max: 0.7, size: rand(2, 5), color: i % 2 ? '#ff9d76' : '#8d93b8', kind: 'shard', rot: Math.random() * 6, vr: rand(-9, 9) });
        }
        const t = this.occupied[cellIdx];
        if (t) {
          t.disabledUntil = now + TUNING.meteors.disable;
          this.floater(c.x, c.y - 24, 'DISABLED', '#ff9d76');
        }
        if (Math.random() < TUNING.meteors.fragmentChance) {
          this.drops.push({ x: c.x, y: c.y, vx: 0, born: now, kind: 'fragment', amount: Math.round(TUNING.meteors.fragmentCredits * this.econScale()) });
        }
      }
    }

    // ---------- ion storm modifier ----------
    if (this.mods.has('ion-storms') && this.state === 'playing' && dt > 0 && this.waveActive) {
      const S = TUNING.ionStorms;
      if (this.nextStormAt === 0) this.nextStormAt = now + S.interval * 0.6;
      if (this.stormRow0 < 0 && now >= this.nextStormAt) {
        this.stormRow0 = Math.floor(Math.random() * Math.max(1, this.rows - S.bandRows + 1));
        this.stormWarnUntil = now + S.warning;
        this.stormUntil = now + S.warning + S.duration;
        this.nextStormAt = now + S.interval;
        audio.ui('wave');
        this.onToast('mod_ionstorms', 'ION STORM — towers inside the highlighted band fire 30% slower while it rages.');
      }
      if (this.stormRow0 >= 0 && now >= this.stormUntil) this.stormRow0 = -1;
    }

    // ---------- supply drops ----------
    if (this.state === 'playing' && dt > 0 && isUnlocked('drops')) {
      const D = TUNING.drops;
      if (this.nextDropAt === 0) this.nextDropAt = now + rand(D.intervalMin, D.intervalMax);
      if (this.waveActive && now >= this.nextDropAt) {
        const spawn = this.forceNextDrop || Math.random() < D.chance;
        this.forceNextDrop = false;
        this.nextDropAt = now + rand(D.intervalMin, D.intervalMax);
        if (spawn) this.spawnDrop();
      }
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        d.x += d.vx * dt;
        if (now - d.born > D.lifetime || d.x < 70 || d.x > W - 70) {
          this.drops.splice(i, 1);
          this.parts.push({ x: d.x, y: d.y, vx: 0, vy: 0, life: 0.3, max: 0.3, size: 26, color: '#c5b3f6', kind: 'ring' });
        }
      }
      if (now < this.overclockUntil && Math.random() < dt * 2.5 && this.towers.length) {
        const t = this.towers[Math.floor(Math.random() * this.towers.length)];
        this.parts.push({ x: t.x + rand(-10, 10), y: t.y - 14, vx: 0, vy: -30, life: 0.4, max: 0.4, size: 2.2, color: '#ffd97a', kind: 'spark' });
      }
    }

    if (!this.waveActive && this.state === 'playing' && dt > 0) {
      this.interT -= dt;
      if (this.interT <= 0) this.callWave(false);
    }

    for (const e of this.enemies) e.update(dt, now, this);
    this.enemies = this.enemies.filter(e => !e.dead);
    if (this.focus && (this.focus.dead || !this.enemies.includes(this.focus))) this.focus = null;

    // buffs from amps (Chebyshev tiles)
    for (const t of this.towers) { t.bDmg = 0; t.bRate = 0; t.bRange = 0; t.bCrit = 0; }
    for (const a of this.towers) {
      if (a.spec.kind !== 'amp' || now < a.disabledUntil) continue;
      const s = a.raw;
      const anchorMul = a.cellType === 'anchor' ? TUNING.cells.anchor.ampMul : 1;
      for (const t of this.towers) {
        if (t === a || t.spec.kind === 'amp') continue;
        if (this.circCell(a.x, a.y, s.range, t.col, t.row)) {
          t.bDmg = Math.max(t.bDmg, (s.buffDmg || 0) * anchorMul);
          t.bRate = Math.max(t.bRate, (s.buffRate || 0) * anchorMul);
          t.bRange = Math.max(t.bRange, (s.buffRange || 0) * anchorMul);
          t.bCrit = Math.max(t.bCrit, (s.crit || 0) * anchorMul);
        }
      }
    }

    // Conduit cells: linked towers focus whichever conduit tower has committed the most
    // (highest spent) to a live target, so a deliberately-built firing line reads as one
    // coordinated gun rather than N independent ones. One frame of lag (reads last frame's
    // targets) is invisible and matches the amp-buff loop's own read-then-recompute pattern.
    let conduitLeader: Tower | null = null;
    for (const t of this.towers) {
      if (t.cellType !== 'conduit' || !t.target || t.target.dead || !t.target.targetable) continue;
      if (!conduitLeader || t.spent > conduitLeader.spent) conduitLeader = t;
    }
    this.conduitTarget = conduitLeader ? conduitLeader.target : null;

    for (const t of this.towers) {
      this.updateTower(t, dt, now);
      // Idle feedback (Phase 3B.4): amp towers have no "target" concept and EMP-disabled
      // towers already show their own "⚡ EMP" indicator, so both are exempt.
      if (t.spec.kind === 'amp' || now < t.disabledUntil) { t.noTargetSince = -1; continue; }
      if (t.target) t.noTargetSince = -1;
      else if (t.noTargetSince < 0) t.noTargetSince = now;
    }
    this.updateProjs(dt, now);

    for (const p of this.patches) {
      if (p.kind === 'burn' && dt > 0) {
        for (const e of this.enemies) {
          if (!e.spec.flying && !e.dead && dist(e.x, e.y, p.x, p.y) < p.r) e.hurt(p.dps! * dt, this, true);
        }
      }
      if (p.kind === 'stasis' && dt > 0) {
        for (const e of this.enemies) {
          if (!e.dead && dist(e.x, e.y, p.x, p.y) < p.r) e.applySlow(p.slow!, 0.25, now);
        }
      }
    }
    this.patches = this.patches.filter(p => now < p.until);

    for (let i = this.incomings.length - 1; i >= 0; i--) {
      const inc = this.incomings[i];
      inc.t -= dt;
      if (inc.t <= 0) {
        this.incomings.splice(i, 1);
        this.bigExplosion(inc.x, inc.y, ABILITIES.orbital.radius, Math.round(ABILITIES.orbital.dmg * this.currentHpScale()), true);
      }
    }

    for (const key of Object.keys(this.cds)) this.cds[key] = Math.max(0, this.cds[key] - dt);

    for (const p of this.parts) {
      p.life -= rawDt;
      p.x += p.vx * rawDt; p.y += p.vy * rawDt;
      if (p.grav) p.vy += p.grav * rawDt;
      if (p.vr) p.rot = (p.rot || 0) + p.vr * rawDt;
      if (p.kind === 'smoke' || p.kind === 'fire') { p.vx *= 0.96; p.vy *= 0.96; }
    }
    this.parts = this.parts.filter(p => p.life > 0);
    if (this.perfMode && this.parts.length > 250) this.parts = this.parts.slice(-250); // oldest-culled cap
    this.bolts = this.bolts.filter(b => (b.life -= rawDt) > 0);
    this.rays = this.rays.filter(r => (r.life -= rawDt) > 0);

    if (this.shakeT > 0) { this.shakeT -= rawDt; if (this.shakeT <= 0) this.shakeMag = 0; }

    // ---------- Audio: pressure, mender presence, wave-arc, last-stand (7.2.2/7.3/7.6.2) ----------
    // Throttled to a ~0.25s cadence — the DPS sum + enemy scan are cheap, but the engine's own
    // ramps run over ~1s anyway, so there's no value in recomputing every frame.
    if (this.state === 'playing' && now - this.lastPressureAt > 0.25) {
      this.lastPressureAt = now;
      let lead = 0, totalHp = 0, menderCount = 0, liveCount = 0;
      for (const e of this.enemies) {
        if (e.dead) continue;
        liveCount++;
        totalHp += e.hp;
        if (e.spec.id === 'mender') menderCount++;
        const f = e.spec.flying ? (e.fDur > 0 ? e.fT / e.fDur : 0) : (e.path.total > 0 ? e.d / e.path.total : 0);
        if (f > lead) lead = f;
      }
      if (menderCount !== this.lastMenderCount) {
        this.lastMenderCount = menderCount;
        audio.setMenderPresence(menderCount);
      }
      let teamGroundDPS = 0;
      for (const t of this.towers) teamGroundDPS += this.towerDPS(t).ground;
      const mass = Math.min(1, totalHp / Math.max(1, teamGroundDPS * 10));
      const p = this.waveActive ? clamp(0.25 + 0.55 * lead + 0.2 * mass, 0, 1) : 0.15;
      const boss = this.enemies.find(e => e.spec.boss && !e.dead);
      const danger = !!boss || this.lives / this.maxLives < 0.25;
      const remainFrac = this.waveTotalSpawns > 0 ? Math.min(1, (this.spawnQueue.length + liveCount) / this.waveTotalSpawns) : 1;
      audio.setPressure(p, danger, remainFrac);
      // Last-stand motif (7.6.2): exactly one enemy left, queue empty, once per wave.
      if (!this.lastStandFired && this.waveActive && this.spawnQueue.length === 0 && liveCount === 1) {
        this.lastStandFired = true;
        audio.lastStand();
        const last = this.enemies.find(e => !e.dead);
        if (last) this.floater(last.x, last.y - last.spec.size - 22, 'LAST ONE', '#ffd97a');
      }
    }
  }

  focusValidFor(t: Tower, R: number) {
    return this.focus && this.focus.targetable && this.inRangeT(t, this.focus, R) && this.canHit(t, this.focus);
  }

  updateTower(t: Tower, dt: number, now: number) {
    const s = t.stats(this);
    const R = s.range;
    const disabled = now < t.disabledUntil;
    t.recoil = Math.max(0, t.recoil - dt * 6);
    t.auraPulse += dt;
    if (t.spec.kind === 'amp' || disabled) { t.beamTargets = []; return; }

    if (s.aura) {
      // Auras don't target in the normal sense, but t.target still doubles as the idle-dim
      // signal (Phase 3B.4) — set to whatever's in range so an aura with nothing nearby
      // reads as idle just like any other tower, without touching its actual (target-less) damage loop.
      let anyInRange: Enemy | null = null;
      for (const e of this.enemies) {
        if (!e.dead && this.inRangeT(t, e, R)) {
          anyInRange = e;
          e.applySlow(s.slow!, 0.3, now);
          if (s.dmg > 0 && dt > 0) e.hurt(s.dmg * dt, this, true, t);
        }
      }
      t.target = anyInRange;
      return;
    }

    if (t.spec.kind === 'prism') {
      const beams = s.beams || 1;
      const inRange = this.enemies.filter(e => e.targetable && this.inRangeT(t, e, R) && this.canHit(t, e));
      this.sortTargets(inRange, t);
      // Conduit: pull the shared target to the front of the beam queue (same prepend
      // pattern as focus-fire below), so a Prism on a conduit cell still joins the line.
      if (t.cellType === 'conduit' && this.conduitTarget && inRange.includes(this.conduitTarget)) {
        inRange.splice(inRange.indexOf(this.conduitTarget), 1);
        inRange.unshift(this.conduitTarget);
      }
      if (this.focus && inRange.includes(this.focus)) {
        inRange.splice(inRange.indexOf(this.focus), 1);
        inRange.unshift(this.focus);
      }
      const targets = inRange.slice(0, beams);
      if (targets.length && targets[0] === t.target) {
        t.rampT += dt;
      } else {
        // Cold Focus (Phase 4.3): a chilled kill doesn't break the ramp — open a grace
        // window instead of resetting immediately; a fresh target within it continues the
        // ramp. The dead reference is consumed (nulled) right after the check so this can
        // only fire once per death, not re-extend the window every subsequent frame.
        if (t.target && t.target.dead && t.target.slowUntil > this.now) {
          t.coldFocusUntil = this.now + TUNING.reactions.coldFocusGrace;
          this.onToast('react_coldfocus', "COLD FOCUS! A chilled kill doesn't break a Prism's ramp — land a fresh target within a second and it keeps building.");
        }
        if (t.target && t.target.dead) t.target = null;
        if (this.now < t.coldFocusUntil) {
          if (targets.length) { t.rampT += dt; t.target = targets[0]; }
        } else {
          t.rampT = targets.length ? dt : 0; t.target = targets[0] || null;
        }
      }
      t.beamTargets = targets;
      if (targets.length) {
        t.angle = Math.atan2(targets[0].y - t.y, targets[0].x - t.x);
        const mult = 1 + ((s.rampMax || 3) - 1) * clamp(t.rampT / (s.rampTime || 3), 0, 1);
        for (const e of targets) {
          const crit = Math.random() < (s.crit || 0) ? 2.5 : 1;
          e.hurt(s.dmg * mult * crit * dt, this, true, t);
        }
        if (dt > 0 && Math.random() < dt * 2.2) audio.shoot('prism');
        if (dt > 0 && Math.random() < dt * 10) {
          const e = targets[0];
          this.spark(e.x + rand(-5, 5), e.y + rand(-5, 5), this.palTower(t.spec.id)[0], 1);
        }
      }
      return;
    }

    t.cool -= dt * s.rate;
    if (this.focusValidFor(t, R)) {
      t.target = this.focus;
    } else if (t.cellType === 'conduit' && this.conduitTarget && this.conduitTarget.targetable
      && this.inRangeT(t, this.conduitTarget, R) && this.canHit(t, this.conduitTarget)) {
      t.target = this.conduitTarget;
    } else {
      if (t.target && (t.target.dead || !t.target.targetable || !this.inRangeT(t, t.target, R) || !this.canHit(t, t.target))) t.target = null;
      if (!t.target || t.mode !== 'first') {
        const cands = this.enemies.filter(e => e.targetable && this.inRangeT(t, e, R) && this.canHit(t, e));
        if (cands.length) { this.sortTargets(cands, t); t.target = cands[0]; }
        else t.target = null;
      }
    }
    if (t.target) {
      const want = Math.atan2(t.target.y - t.y, t.target.x - t.x);
      let diff = want - t.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      t.angle += clamp(diff, -8 * dt, 8 * dt);
      if (t.cool <= 0 && dt > 0) { t.cool = 1; this.fire(t, s); }
    }
  }

  canHit(t: Tower, e: Enemy) {
    if (e.spec.flying && t.raw.groundOnly) return false;
    return true;
  }
  sortTargets(arr: Enemy[], t: Tower) {
    switch (t.mode) {
      case 'first': arr.sort((a, b) => b.progress - a.progress); break;
      case 'last': arr.sort((a, b) => a.progress - b.progress); break;
      case 'strong': arr.sort((a, b) => (b.hp + b.shield) - (a.hp + a.shield)); break;
      case 'weak': arr.sort((a, b) => (a.hp + a.shield) - (b.hp + b.shield)); break;
      case 'close': arr.sort((a, b) => dist(a.x, a.y, t.x, t.y) - dist(b.x, b.y, t.x, t.y)); break;
    }
  }

  fire(t: Tower, s: any) {
    const e = t.target!;
    const bx = t.x + Math.cos(t.angle) * 14 * this.k, by = t.y + Math.sin(t.angle) * 14 * this.k;
    t.recoil = 1;
    this.flash(bx, by, this.pal().muzzle);
    switch (t.spec.kind) {
      case 'bullet': {
        audio.shoot(s.rate > 2.4 ? 'gatling' : (s.pierce ? 'lance' : 'pulse'));
        const speed = (s.pierce || s.range >= 6) ? 900 : 560;
        const tt = clamp(dist(e.x, e.y, t.x, t.y) / speed, 0, 1);
        const px = e.x + Math.cos(e.angle) * e.effSpeed(this.now) * tt;
        const py = e.y + Math.sin(e.angle) * e.effSpeed(this.now) * tt;
        const a = Math.atan2(py - by, px - bx);
        this.projs.push({
          kind: 'bullet', owner: t, x: bx, y: by, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
          dmg: s.dmg, color: this.palTower(t.spec.id)[0], pierce: s.pierce || 0, hit: new Set(), life: 1.6,
          w: s.pierce ? 5 : 3.4, crit: s.crit, trail: [], target: e,
          pierceRamp: s.pierceRamp, freshMul: s.freshMul,
        });
        break;
      }
      case 'cryo': {
        audio.shoot('cryo');
        const a = Math.atan2(e.y - by, e.x - bx);
        this.projs.push({
          kind: 'bullet', owner: t, x: bx, y: by, vx: Math.cos(a) * 400, vy: Math.sin(a) * 400,
          dmg: s.dmg, color: this.palTower(t.spec.id)[0], pierce: 0, hit: new Set(), life: 1.4,
          w: 4, slow: s.slow, slowDur: s.slowDur, freeze: s.freeze, trail: [], target: e,
        });
        break;
      }
      case 'missile': {
        audio.shoot('missile');
        const shots = s.shots || 1;
        for (let i = 0; i < shots; i++) {
          const spread = (i - (shots - 1) / 2) * 0.5;
          const a = t.angle + spread + rand(-0.1, 0.1);
          this.projs.push({
            kind: 'missile', owner: t, x: bx, y: by, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120,
            speed: 150, target: e, dmg: s.dmg, splash: s.splash || 24, airMul: s.airMul || 1,
            color: this.palTower(t.spec.id)[0], life: 5, wig: Math.random() * 9, trail: [],
            directStun: s.directStun,
          });
        }
        break;
      }
      case 'mortar': {
        audio.shoot('mortar');
        this.shake(1.6);
        const T = clamp(dist(e.x, e.y, t.x, t.y) / 220, 0.55, 1.4);
        const px = e.x + Math.cos(e.angle) * e.effSpeed(this.now) * T;
        const py = e.y + Math.sin(e.angle) * e.effSpeed(this.now) * T;
        this.projs.push({
          kind: 'shell', owner: t, x0: t.x, y0: t.y, x1: px, y1: py, t: 0, T,
          dmg: s.dmg, splash: s.splash, color: this.palTower(t.spec.id)[0], arc: 90 + T * 60,
          burnDps: s.burnDps, burnDur: s.burnDur, cluster: s.cluster, stun: s.stun,
        });
        break;
      }
      case 'tesla': {
        audio.shoot('tesla');
        const chainR = this.cell * 2.5;
        const hitList: Enemy[] = [e];
        let cur = e;
        for (let i = 0; i < (s.chains || 0); i++) {
          let best: Enemy | null = null, bd = chainR;
          for (const o of this.enemies) {
            if (o.dead || !o.targetable || hitList.includes(o)) continue;
            const dd = dist(o.x, o.y, cur.x, cur.y);
            if (dd < bd) { bd = dd; best = o; }
          }
          if (!best) break;
          hitList.push(best); cur = best;
        }
        let px = bx, py = by;
        const falloff = (s.chains || 0) >= 7 ? 0.92 : 0.8;
        hitList.forEach((en, i) => {
          this.bolts.push({ pts: this.mkBolt(px, py, en.x, en.y), life: 0.14, color: this.palTower(t.spec.id)[0] });
          px = en.x; py = en.y;
          const crit = Math.random() < (s.crit || 0) ? 2.5 : 1;
          let dmg = s.dmg * Math.pow(falloff, i) * crit;
          // Conduction (Phase 4.3): burning enemies take extra from Tesla chains.
          if (en.burnUntil > this.now) {
            dmg *= TUNING.reactions.conductionMul;
            this.spark(en.x, en.y, '#ffd97a', 3);
            this.onToast('react_conduction', 'CONDUCTION! Burning enemies take +50% from Tesla chains — Flame sets them alight, Tesla cashes in.');
          }
          en.hurt(dmg, this, false, t);
          if (s.stun && Math.random() < s.stun) { en.frozenUntil = Math.max(en.frozenUntil, this.now + 0.8); this.spark(en.x, en.y, '#fff3b0', 4); }
          this.spark(en.x, en.y, '#fff3b0', 2);
        });
        break;
      }
      case 'ray': {
        audio.shoot('ray');
        const a = Math.atan2(e.y - t.y, e.x - t.x);
        t.angle = a;
        const dx = Math.cos(a), dy = Math.sin(a);
        const len = (s.range + 0.5) * this.cell;
        const x1 = t.x + dx * len, y1 = t.y + dy * len;
        const w = s.rayWidth || 10;
        for (const en of this.enemies) {
          if (en.dead || !en.targetable || !this.canHit(t, en)) continue;
          const proj = (en.x - t.x) * dx + (en.y - t.y) * dy;
          if (proj < 0 || proj > len) continue;
          const perp = Math.abs((en.x - t.x) * dy - (en.y - t.y) * dx);
          if (perp < w + en.spec.size * 0.6) {
            const crit = Math.random() < (s.crit || 0) ? 2.5 : 1;
            // Farlance (4.4): a real placement verb — build it far back and enemies deep in
            // its beam take extra, pairing naturally with ridge cells.
            const farDist = Math.max(Math.abs(this.colOf(en.x) - t.col), Math.abs(this.rowOf(en.y) - t.row));
            const farBonus = s.farTiles && farDist >= s.farTiles ? (s.farMul || 1) : 1;
            en.hurt(s.dmg * crit * farBonus, this, false, t);
            this.spark(en.x, en.y, this.palTower(t.spec.id)[0], 2);
          }
        }
        this.rays.push({ x0: bx, y0: by, x1, y1, life: 0.14, max: 0.14, color: this.palTower(t.spec.id)[0], w });
        break;
      }
      case 'flame': {
        audio.shoot('flame');
        const a = Math.atan2(e.y - t.y, e.x - t.x);
        t.angle = a;
        const cone = 0.55;
        for (const en of this.enemies) {
          if (en.dead || !en.targetable) continue;
          if (!this.inRangeT(t, en, s.range)) continue;
          let diff = Math.atan2(en.y - t.y, en.x - t.x) - a;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          if (Math.abs(diff) < cone) {
            en.hurt(s.dmg, this, true, t);
            en.igniteStack(s.burnDps || 10, s.burnDur || 2.5, this.now);
            if (s.burnSpread) en.flameSpread = true;   // Hellmouth (Phase 4.4): tag for onKill's spread check
            if (Math.random() < 0.5) this.fireFx(en.x + rand(-5, 5), en.y + rand(-5, 5));
          }
        }
        const reach = (s.range + 0.5) * this.cell;
        for (let i = 0; i < 9; i++) {
          const pa = a + rand(-cone * 0.8, cone * 0.8);
          const sp = rand(90, 190);
          this.parts.push({
            x: bx, y: by, vx: Math.cos(pa) * sp, vy: Math.sin(pa) * sp,
            life: rand(0.25, reach / 320), max: 0.6, size: rand(3.5, 7),
            color: (t.branch === 2 ? ['#8fc9ef', '#c7e6ff', '#ffffff'] : ['#ffb37d', '#ff8a5c', '#ffd9a0'])[i % 3], kind: 'fire',
          });
        }
        break;
      }
    }
  }
  mkBolt(x0: number, y0: number, x1: number, y1: number) {
    const pts = [[x0, y0]];
    const n = 6;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      pts.push([lerp(x0, x1, t) + rand(-9, 9), lerp(y0, y1, t) + rand(-9, 9)]);
    }
    pts.push([x1, y1]);
    return pts;
  }

  updateProjs(dt: number, now: number) {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i];
      if (p.kind === 'bullet') {
        p.trail.push([p.x, p.y]); if (p.trail.length > 5) p.trail.shift();
        // guaranteed hit: home on the intended target until it's struck or gone
        if (p.target && !p.target.dead && p.target.targetable && !p.hit.has(p.target)) {
          const sp = Math.hypot(p.vx, p.vy);
          const a = Math.atan2(p.target.y - p.y, p.target.x - p.x);
          p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
        } else if (p.target && (p.target.dead || p.hit.has(p.target))) {
          p.target = null;
        }
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
        let done = p.life <= 0 || p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40;
        for (const e of this.enemies) {
          if (e.dead || !e.targetable || p.hit.has(e)) continue;
          // non-piercing homing bullets only connect with their own target
          if (!p.pierce && p.target && e !== p.target) continue;
          if (dist(p.x, p.y, e.x, e.y) < e.spec.size + 6) {
            const pierceK = p.hit.size;   // Star Lance (4.4): pierce index of THIS hit, 0 for the first enemy struck
            p.hit.add(e);
            const crit = Math.random() < (p.crit || 0) ? 2.5 : 1;
            const pierceMul = p.pierceRamp ? Math.pow(1 + p.pierceRamp, pierceK) : 1;
            // Storm Sentinel (4.4): the "First" targeting read pays off — a target still at
            // full hp (and full shield, if shielded) takes extra, rewarding a clean opener.
            const fresh = p.freshMul && e.hp >= e.maxHp && (e.maxShield === 0 || e.shield >= e.maxShield);
            e.hurt(p.dmg * crit * pierceMul * (fresh ? p.freshMul! : 1), this, false, p.owner);
            if (crit > 1) this.floater(e.x, e.y - 22, 'CRIT', '#fff3b0');
            if (p.slow) { e.applySlow(p.slow, p.slowDur || 2, now); this.spark(e.x, e.y, '#a0d8ef', 3); }
            if (p.freeze && Math.random() < p.freeze) { e.frozenUntil = now + 1.2; e.brittle = true; audio.freezeCrack(); this.spark(e.x, e.y, '#ffffff', 6); }
            this.spark(p.x, p.y, p.color, 3);
            if (p.hit.size > p.pierce) { done = true; }
            break;
          }
        }
        if (done) this.projs.splice(i, 1);
      } else if (p.kind === 'missile') {
        p.trail.push([p.x, p.y]); if (p.trail.length > 9) p.trail.shift();
        if (p.target && (p.target.dead || !p.target.targetable)) {
          let best: Enemy | null = null, bd = 240;
          for (const e of this.enemies) { if (e.dead || !e.targetable) continue; const dd = dist(e.x, e.y, p.x, p.y); if (dd < bd) { bd = dd; best = e; } }
          p.target = best;
        }
        p.speed = Math.min(560, p.speed + 700 * dt);
        if (p.target) {
          const a = Math.atan2(p.target.y - p.y, p.target.x - p.x);
          const cur = Math.atan2(p.vy, p.vx);
          let diff = a - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const na = cur + clamp(diff, -5.5 * dt, 5.5 * dt) + Math.sin(now * 18 + p.wig) * 0.04;
          p.vx = Math.cos(na) * p.speed; p.vy = Math.sin(na) * p.speed;
        }
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
        if (Math.random() < dt * 26) this.smoke(p.x, p.y);
        let boom = p.life <= 0;
        if (p.target && dist(p.x, p.y, p.target.x, p.target.y) < p.target.spec.size + 8) boom = true;
        if (boom) {
          this.projs.splice(i, 1);
          // Nova Torpedo (Phase 4.4): the direct target gets stunned — splash victims don't.
          if (p.directStun && p.target && !p.target.dead) {
            p.target.frozenUntil = Math.max(p.target.frozenUntil, now + p.directStun);
            this.spark(p.target.x, p.target.y, '#fff3b0', 4);
          }
          this.explode(p.x, p.y, p.splash, p.dmg, p.color, p.airMul, false, (p as any).owner);
        }
      } else {
        p.t += dt;
        const tt = clamp(p.t / p.T, 0, 1);
        if (tt >= 1) {
          this.projs.splice(i, 1);
          this.explode(p.x1, p.y1, p.splash, p.dmg, p.color, 0, true, (p as any).owner);
          if (p.stun) {
            for (const en of this.enemies) {
              if (en.dead || !en.targetable || en.spec.flying) continue;
              if (dist(en.x, en.y, p.x1, p.y1) < p.splash + en.spec.size && Math.random() < p.stun) {
                en.frozenUntil = Math.max(en.frozenUntil, now + 0.9);
                this.spark(en.x, en.y, '#fff3b0', 4);
              }
            }
          }
          if (p.burnDps) this.patches.push({ x: p.x1, y: p.y1, r: p.splash * 0.95, until: now + (p.burnDur || 3), kind: 'burn', dps: p.burnDps });
          if (p.cluster) {
            for (let c = 0; c < p.cluster; c++) {
              const a = Math.random() * Math.PI * 2, r = rand(26, 64);
              this.projs.push({
                kind: 'shell', owner: (p as any).owner, x0: p.x1, y0: p.y1, x1: p.x1 + Math.cos(a) * r, y1: p.y1 + Math.sin(a) * r,
                t: 0, T: 0.4, dmg: p.dmg * 0.4, splash: 26, color: p.color, arc: 46, mini: true,
              });
            }
          }
        }
      }
    }
  }

  explode(x: number, y: number, r: number, dmg: number, color: string, airMul: number, groundOnly: boolean, owner?: Tower) {
    audio.explosion(r > 55 ? 'big' : r > 34 ? 'med' : 'small');
    this.shake(r > 55 ? 5 : r > 34 ? 3 : 1.4);
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (groundOnly && e.spec.flying) continue;
      const dd = dist(e.x, e.y, x, y);
      if (dd < r + e.spec.size) {
        const fall = 1 - 0.5 * clamp(dd / r, 0, 1);
        e.hurt(dmg * fall * (e.spec.flying && airMul ? airMul : 1), this, true, owner);
      }
    }
    this.parts.push({ x, y, vx: 0, vy: 0, life: 0.35, max: 0.35, size: r, color, kind: 'shock' });
    this.parts.push({ x, y, vx: 0, vy: 0, life: 0.12, max: 0.12, size: r * 0.7, color: '#ffffff', kind: 'flash' });
    for (let i = 0; i < Math.min(18, r / 2.6); i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(60, 260);
      this.parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.3, 0.7), max: 0.7, size: rand(2, 5), color: Math.random() < 0.5 ? color : '#ffd9a0',
        kind: 'dot',
      });
    }
    for (let i = 0; i < 4; i++) this.smoke(x + rand(-r / 3, r / 3), y + rand(-r / 3, r / 3));
  }

  bigExplosion(x: number, y: number, r: number, dmg: number, hitsAir: boolean) {
    this.explode(x, y, r, dmg, '#ffd3b6', hitsAir ? 1 : 0, false);
    this.parts.push({ x, y, vx: 0, vy: 0, life: 0.5, max: 0.5, size: r * 1.4, color: '#fff3b0', kind: 'shock' });
    this.shake(9);
    audio.explosion('big');
  }

  empPulse(x: number, y: number, r: number, dur: number) {
    this.parts.push({ x, y, vx: 0, vy: 0, life: 0.6, max: 0.6, size: r, color: '#ffb3c6', kind: 'shock' });
    audio.ui('boss');
    this.shake(4);
    for (const t of this.towers) {
      if (dist(t.x, t.y, x, y) < r) {
        t.disabledUntil = this.now + dur;
        this.spark(t.x, t.y, '#ffb3c6', 6);
      }
    }
    this.floater(x, y - 50, 'EMP PULSE', '#ffb3c6');
  }

  // ---------- kills / leaks ----------
  deathFx(e: Enemy) {
    const spec = e.spec;
    const [c1, c2] = this.palEnemy(spec.id);
    const push = (p: Partial<Particle> & { life: number; max: number; size: number; color: string; kind: Particle['kind'] }) =>
      this.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, ...p } as Particle);
    switch (spec.id) {
      case 'dart': case 'raptor': {
        // fast ones streak apart along their direction of travel
        for (let i = 0; i < 10; i++) {
          const a = e.angle + rand(-0.5, 0.5);
          const sp = rand(160, 340);
          push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.45), max: 0.45, size: rand(1.6, 3.2), color: i % 2 ? c1 : '#ffffff', kind: 'spark' });
        }
        push({ life: 0.2, max: 0.2, size: spec.size * 1.8, color: c1, kind: 'ring' });
        break;
      }
      case 'brute': case 'colossus': {
        // heavy, chunky, slow thud + cracks into rotating shard PLATES in its two palette
        // tones (Phase 3B.5) — bigger, slower, longer-lived than ordinary debris, so the
        // body visibly breaks into pieces rather than just sparking.
        this.shake(spec.boss ? 8 : 3.5);
        const plates = this.perfMode ? 3 : 5;
        for (let i = 0; i < plates; i++) {
          const a = (i / plates) * Math.PI * 2 + rand(-0.2, 0.2), sp = rand(40, 95);
          push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.7, 1.2), max: 1.2, size: rand(9, 15), color: i % 2 ? c1 : c2, kind: 'shard', rot: rand(0, 6), vr: rand(-2.2, 2.2) });
        }
        const debris = this.perfMode ? 6 : 12;
        for (let i = 0; i < debris; i++) {
          const a = Math.random() * Math.PI * 2, sp = rand(30, 120);
          push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.5, 0.9), max: 0.9, size: rand(3, 6), color: Math.random() < 0.6 ? c1 : c2, kind: 'shard', rot: Math.random() * 6, vr: rand(-4, 4) });
        }
        push({ life: 0.4, max: 0.4, size: spec.size * 2.4, color: c1, kind: 'shock' });
        for (let i = 0; i < (this.perfMode ? 2 : 4); i++) this.smoke(e.x + rand(-10, 10), e.y + rand(-10, 10));
        break;
      }
      case 'swarmling': {
        // a single quick pop ring — cheap, deliberately (Phase 3B.5): they die in dozens,
        // and the old 5-spark burst added up fast on horde/splitter waves for no extra read.
        push({ life: 0.18, max: 0.18, size: spec.size * 1.6, color: c1, kind: 'ring' });
        break;
      }
      case 'aegis': {
        // armor shatters like glass
        audio.freezeCrack();
        const shards = this.perfMode ? 8 : 16;
        for (let i = 0; i < shards; i++) {
          const a = Math.random() * Math.PI * 2, sp = rand(70, 220);
          push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.35, 0.7), max: 0.7, size: rand(2, 4.5), color: i % 3 ? '#bfe3ff' : c1, kind: 'shard', rot: Math.random() * 6, vr: rand(-12, 12) });
        }
        push({ life: 0.3, max: 0.3, size: spec.size * 2.4, color: '#bfe3ff', kind: 'ring' });
        // If the shield broke earlier this life, chain in a second wave of hex-fragment
        // shards (Phase 3B.5) — longer-lived than the body burst above, so they read as a
        // beat behind it: the shield failing, then the body giving out.
        if (e.hadShieldBreak) {
          const hexN = this.perfMode ? 4 : 8;
          for (let i = 0; i < hexN; i++) {
            const a = Math.random() * Math.PI * 2, sp = rand(50, 150);
            push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.55, 0.85), max: 0.85, size: rand(3, 6), color: '#bfe3ff', kind: 'shard', rot: Math.random() * 6, vr: rand(-8, 8) });
          }
        }
        break;
      }
      case 'wisp': case 'mothership': {
        // dissolves into rising sparkles
        const n = spec.boss ? (this.perfMode ? 16 : 34) : (this.perfMode ? 6 : 12);
        for (let i = 0; i < n; i++) {
          push({ x: e.x + rand(-spec.size, spec.size), y: e.y + rand(-spec.size, spec.size) * 0.6, vx: rand(-18, 18), vy: rand(-90, -30), life: rand(0.5, 1), max: 1, size: rand(1.8, 3.6), color: i % 2 ? c1 : '#ffffff', kind: 'dot' });
        }
        push({ life: 0.35, max: 0.35, size: spec.size * 2, color: c1, kind: 'ring' });
        break;
      }
      case 'mender': {
        // a burst of failed healing
        for (let i = 0; i < 4; i++) {
          push({ x: e.x + rand(-8, 8), y: e.y + rand(-6, 6), vy: -rand(24, 44), life: 0.7, max: 0.7, size: 12, color: '#c0f5b3', kind: 'text', text: '+' });
        }
        push({ life: 0.45, max: 0.45, size: 95, color: '#c0f5b3', kind: 'ring' });
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2, sp = rand(50, 150);
          push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5, max: 0.5, size: 3, color: c1, kind: 'dot' });
        }
        break;
      }
      case 'splitter': {
        // wet gooey pop (the swarmlings do the rest) — split-burst stands, per plan
        for (let i = 0; i < 9; i++) {
          const a = Math.random() * Math.PI * 2, sp = rand(30, 110);
          push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.4, 0.8), max: 0.8, size: rand(4, 8), color: c1, kind: 'smoke' });
        }
        push({ life: 0.3, max: 0.3, size: spec.size * 2.2, color: c1, kind: 'ring' });
        push({ life: 0.45, max: 0.45, size: spec.size * 3, color: c2, kind: 'ring' });
        break;
      }
      case 'phase': {
        // winks out of reality — converging sparks
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2, d = rand(18, 34);
          push({ x: e.x + Math.cos(a) * d, y: e.y + Math.sin(a) * d, vx: -Math.cos(a) * d * 4, vy: -Math.sin(a) * d * 4, life: 0.25, max: 0.25, size: 2.4, color: c1, kind: 'spark' });
        }
        push({ life: 0.3, max: 0.3, size: spec.size * 2, color: c1, kind: 'ring' });
        push({ life: 0.14, max: 0.14, size: spec.size, color: '#ffffff', kind: 'flash' });
        break;
      }
      default: {
        const n = clamp(Math.round(spec.size * (this.perfMode ? 0.5 : 0.9)), 6, this.perfMode ? 12 : 22);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, sp = rand(50, 200) * (spec.boss ? 1.8 : 1);
          push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.35, 0.8), max: 0.8, size: rand(2.5, 5.5), color: Math.random() < 0.6 ? c1 : c2, kind: 'shard', rot: Math.random() * 6, vr: rand(-9, 9) });
        }
        push({ life: 0.28, max: 0.28, size: spec.size * 2.2, color: c1, kind: 'ring' });
      }
    }
  }

  // Apply the active wave mutator to a freshly spawned enemy. Bounty applies to
  // everything (it's a gift); stat twists spare bosses.
  applyMutator(e: Enemy) {
    const M = TUNING.mutators;
    if (this.waveMutator === 'bounty') {
      (e as any).reward = Math.round((e as any).reward * M.bountyMul);
      return;
    }
    if (e.spec.boss) return;
    switch (this.waveMutator) {
      case 'frenzied':
        e.spec = { ...e.spec, speed: e.spec.speed * M.frenziedSpeed };
        if (e.spec.flying) e.fDur = Math.max(0.1, e.fDur / M.frenziedSpeed);
        break;
      case 'armored':
        e.maxShield = Math.max(e.maxShield, Math.round(e.maxHp * M.armoredShieldFrac));
        e.shield = e.maxShield;
        break;
      case 'horde':
        e.maxHp = Math.max(1, Math.round(e.maxHp * M.hordeHpMul));
        e.hp = e.maxHp;
        break;
      case 'regen':
        e.mutRegen = true;
        break;
      case 'phasing':
        if (!e.spec.phase && Math.random() < M.phasingFrac) e.spec = { ...e.spec, phase: true };
        break;
    }
  }

  // ---------- supply drops ----------
  spawnDrop() {
    const D = TUNING.drops;
    for (let attempt = 0; attempt < 20; attempt++) {
      const x = rand(110, W - 110), y = rand(100, H - 100);
      // keep crates off the alien path and away from other crates
      let ok = true;
      for (const path of this.paths) {
        for (let d = 0; d < path.total && ok; d += 24) {
          const p = path.at(d);
          if (dist(p.x, p.y, x, y) < 52) ok = false;
        }
        if (!ok) break;
      }
      if (ok) for (const o of this.drops) if (dist(o.x, o.y, x, y) < 70) { ok = false; break; }
      if (!ok) continue;
      // weighted contents roll
      const w = D.weights;
      const r = Math.random() * 100;
      const kind = r < w.credits ? 'credits' : r < w.credits + w.recharge ? 'recharge'
        : r < w.credits + w.recharge + w.overclock ? 'overclock' : 'hull';
      const amount = kind === 'credits' ? Math.round(rand(D.creditsMin, D.creditsMax) * this.econScale()) : 0;
      this.drops.push({ x, y, vx: rand(-11, 11), born: this.now, kind, amount });
      this.parts.push({ x, y, vx: 0, vy: 0, life: 0.4, max: 0.4, size: 44, color: '#c5b3f6', kind: 'ring' });
      audio.ui('wave');
      this.onToast('drops', 'A supply crate! Tap crates before they vanish — credits, recharges, and boosts inside.');
      return;
    }
  }

  tryCollectDrop(x: number, y: number): boolean {
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (dist(d.x, d.y, x, y) > 40) continue;
      this.drops.splice(i, 1);
      const D = TUNING.drops;
      audio.ui('pickup');
      this.spark(d.x, d.y, '#fff3b0', 12);
      this.parts.push({ x: d.x, y: d.y, vx: 0, vy: 0, life: 0.35, max: 0.35, size: 52, color: '#fff3b0', kind: 'ring' });
      switch (d.kind) {
        case 'fragment':
        case 'credits':
          this.credits += d.amount;
          this.floater(d.x, d.y - 26, `+${d.amount} ◆`, '#fff3b0');
          audio.bell(0.7);
          break;
        case 'recharge':
          this.cds.orbital = 0; this.cds.stasis = 0;
          this.floater(d.x, d.y - 26, 'Abilities recharged!', '#a0d8ef');
          break;
        case 'overclock':
          this.overclockUntil = this.now + D.overclockDur;
          this.floater(d.x, d.y - 26, `OVERCLOCK  +${Math.round(D.overclockRate * 100)}% rate`, '#ffd97a');
          this.shake(3);
          break;
        case 'hull':
          this.lives = Math.min(this.maxLives, this.lives + D.hullPatch);
          this.floater(d.x, d.y - 26, `+${D.hullPatch} hull`, '#a8e6cf');
          break;
      }
      this.buzz([15]);
      this.onHud();
      return true;
    }
    return false;
  }

  onKill(e: Enemy) {
    this.killCount++;
    this.runStats.kills++;
    if (isUnlocked('nova') && this.novaCharge < this.novaNeed) {
      this.novaCharge = Math.min(this.novaNeed, this.novaCharge + (e.spec.boss ? TUNING.nova.bossCharge : e.isElite ? TUNING.nova.eliteCharge : 1));
    }
    if (this.damageNumbersOn && e.dmgAccum >= 1) { this.dmgText(e.x, e.y - e.spec.size - 6, e.dmgAccum); e.dmgAccum = 0; }
    const reward = (e as any).reward as number;
    this.credits += reward;
    audio.pop(e.spec.size);
    this.floater(e.x, e.y - e.spec.size - 12, `+${reward}`, '#fff3b0');
    if (this.focus === e) this.focus = null;
    this.deathFx(e);
    // --- kill combo ---
    if (isUnlocked('combo')) {
      const C = TUNING.combo;
      this.comboCount = this.now - this.lastKillAt <= C.window ? this.comboCount + 1 : 1;
      this.lastKillAt = this.now;
      this.runStats.bestCombo = Math.max(this.runStats.bestCombo, this.comboCount);
      const mi = (C.milestones as readonly number[]).indexOf(this.comboCount);
      if (mi >= 0) {
        const bonus = Math.round(C.bonuses[mi] * this.econScale());
        this.credits += bonus;
        this.floater(e.x, e.y - e.spec.size - 30, `COMBO ×${this.comboCount}!  +${bonus}◆`, '#ffd97a');
        audio.comboBlip(mi + 2);
        this.hitStop(0.05);
        this.onToast('combo', 'Chained kills build a combo — keep them coming for bonus credits. Leaks break the chain!');
        this.buzz([20]);
      } else if (this.comboCount >= 3) {
        audio.comboBlip(Math.min(1, this.comboCount - 3));
        if (this.comboCount === 3) this.onToast('combo', 'Chained kills build a combo — keep them coming for bonus credits. Leaks break the chain!');
      }
    }
    // --- per-tower stats: kill + credit attribution (for the side-panel readout) ---
    if (e.lastHitBy && this.towers.includes(e.lastHitBy)) {
      const kt = e.lastHitBy;
      kt.kills++;
      kt.creditsEarned += reward;
      // Veterancy (Phase 4.6): crossing the kill threshold offers a one-time, irrevocable
      // perk choice. The badge/pulse itself is drawn every frame straight off kills/perk
      // (drawTower); this just fires the one-time floater/haptic/toast at the crossing.
      if (isUnlocked('veterancy') && kt.kills === TUNING.veterancy.kills && !kt.perk) {
        this.floater(kt.x, kt.y - 34, 'VETERAN', '#ffd97a');
        this.buzz([12, 30, 12]);
        this.onToast('veterancy', 'VETERAN — this tower earned a perk. Open its panel to choose one; the choice is permanent, and selling forfeits it.');
        if (this.selected === kt) this.onSelect();   // panel already open — show the chooser immediately
      }
    }
    // --- rich vein bonus: killing blow landed by a tower on a vein cell ---
    if (e.lastHitBy && e.lastHitBy.vein && this.towers.includes(e.lastHitBy)) {
      const v = Math.max(1, Math.round(TUNING.richVeins.creditPerKill * this.econScale()));
      this.credits += v;
      e.lastHitBy.creditsEarned += v;
      this.floater(e.lastHitBy.x, e.lastHitBy.y - 26, `+${v}◆`, '#d6f7ff');
      audio.bell(0.4);
    }
    // --- Scavenger perk payout (Phase 4.6): flat credit per kill, scaled at payout time
    // (like every other flat credit source) so it holds its relative value all campaign. ---
    if (e.lastHitBy && e.lastHitBy.perk === 'scav' && this.towers.includes(e.lastHitBy)) {
      const v = Math.max(1, Math.round(TUNING.veterancy.perks.scav * this.econScale()));
      this.credits += v;
      e.lastHitBy.creditsEarned += v;
      this.floater(e.lastHitBy.x, e.lastHitBy.y - 26, `+${v}◆`, '#ffd97a');
    }
    // --- elite bonus ---
    if (e.isElite) {
      this.runStats.elitesSlain++;
      this.hitStop(0.05);
      this.shake(4);
      this.ringFx(e.x, e.y, e.spec.size * 2.4, '#ffd97a');
      audio.eliteChing();
      const shower = Math.max(3, Math.round(reward / 8));
      for (let i = 0; i < shower; i++) {
        const a = Math.random() * Math.PI * 2, sp = rand(60, 220);
        this.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: rand(0.5, 0.9), max: 0.9, size: rand(2.5, 4), color: '#ffd97a', kind: 'shard', grav: 190, rot: Math.random() * 6, vr: rand(-8, 8) });
      }
      this.buzz([30, 40, 30]);
    }
    if (e.spec.boss) {
      this.shake(12);
      this.slowMo(1.2, 0.25);
      this.screenFlash(0.5);
      this.buzz([80, 60, 120]);
      audio.explosion('big');
      this.onBanner(`${e.spec.name} DOWN`, this.palEnemy(e.spec.id)[0], 'medium');
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2, sp = rand(80, 380);
        this.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.5, 1.3), max: 1.3, size: rand(3, 8), color: ['#a8e6cf', '#ffb3c6', '#fff3b0', '#c5b3f6'][i % 4], kind: 'shard', rot: Math.random() * 6, vr: rand(-10, 10) });
      }
    }
    if (e.spec.splits) {
      for (let i = 0; i < e.spec.splits.count; i++) {
        const child = this.mkEnemy(e.spec.splits.id, e.pathIdx, e.hpMul, 1);
        child.d = Math.max(0, e.d + rand(-16, 16));
        this.enemies.push(child);
      }
    }
    // --- Shatter (Phase 4.3): frozen enemies explode on death. Runs after splits spawn, so
    // a shattering splitter's own blast can catch its freshly-spawned swarmlings — allowed,
    // delightful chain reaction. The kill source doesn't matter; "frozen things shatter" is
    // the whole learnable rule (the Cryo->splash pairing emerges naturally since splash is
    // what kills groups of frozen enemies). ---
    if (e.frozenUntil > this.now && !e.spec.boss) {
      const R = TUNING.reactions;
      const dmg = Math.min(e.maxHp * R.shatterFrac, R.shatterCap * this.currentHpScale());
      this.explode(e.x, e.y, R.shatterRadius, dmg, '#a0d8ef', 1, false);
      audio.freezeCrack();
      this.onToast('react_shatter', 'SHATTER! Frozen enemies explode when killed — Cryo sets them up, splash knocks them down.');
    }
    // --- Hellmouth (Phase 4.4): a burning kill's fire leaps to the nearest enemy within
    // 70px, carrying the dying enemy's own current burn (its remaining duration), so a
    // held Flame lets one kill light the next. ---
    if (e.flameSpread && e.burnUntil > this.now && e.burnDps > 0) {
      let best: Enemy | null = null, bd = 70;
      for (const o of this.enemies) {
        if (o === e || o.dead || !o.targetable || o.spec.boss) continue;
        const dd = dist(o.x, o.y, e.x, e.y);
        if (dd < bd) { bd = dd; best = o; }
      }
      if (best) {
        best.igniteStack(e.burnDps, Math.max(0.5, e.burnUntil - this.now), this.now);
        best.flameSpread = true;
        this.spark(best.x, best.y, '#ff8a5c', 3);
      }
    }
  }

  onLeak(e: Enemy) {
    if (this.focus === e) this.focus = null;
    if (this.comboCount >= 3) this.floater(W / 2, 160, 'COMBO BROKEN', '#ff7d7d');
    this.comboCount = 0;
    if (this.devGod) return;
    const dmg = e.spec.leak;
    this.runStats.leaksByEnemy[e.spec.id] = (this.runStats.leaksByEnemy[e.spec.id] || 0) + dmg;
    // Leak ledger (Phase 6.3): this RUN's tally, separate from the lifetime `runStats` one —
    // the in-run version is the actionable "who's hurting me right now" readout.
    this.leakLedger[e.spec.id] = (this.leakLedger[e.spec.id] || 0) + dmg;
    this.lives = Math.max(0, this.lives - dmg);
    this.livesLostTotal += dmg;
    // Hull groan (Phase 7.5): pitch descends as hull drops — a leak at 3 hull sounds sicker
    // than the same leak at 18, using the fraction remaining AFTER this leak.
    audio.hullGroan(this.maxLives > 0 ? this.lives / this.maxLives : 0);
    // Leak impact (Phase 6.2): louder than a generic hit — bigger shake, a brief hitch, and a
    // base-sprite flash/red-edge pulse (drawPortalsAndBases / drawOverlays read leakFlashUntil).
    this.shake(6);
    this.hitStop(0.03);
    this.leakFlashUntil = this.now + 0.35;
    this.buzz([25, 30, 25]);
    const end = this.basePx[e.pathIdx] || { x: e.x, y: e.y };
    this.parts.push({ x: end.x, y: end.y, vx: 0, vy: 0, life: 0.4, max: 0.4, size: 56, color: '#ff7d7d', kind: 'ring' });
    this.floater(end.x, end.y - 40, `-${dmg} HULL`, '#ff7d7d');
    if (this.lives <= 0 && this.state === 'playing') this.lose();
  }

  win() {
    this.state = 'won';
    if ([5, 10, 15].includes(this.level.id)) {
      this.onBanner(`${ZONES[this.level.zone].name.toUpperCase()} SECURED`, ZONES[this.level.zone].accent, 'medium');
    }
    audio.jingle(true);
    // Absolute hull damage, not a fraction — deliberate: with Hull Plating meta owned, this
    // challenge stays exactly as hard rather than getting easier as maxLives grows.
    const lost = this.livesLostTotal;
    const stars = lost <= 2 ? 3 : lost <= 8 ? 2 : 1;
    for (let i = 0; i < 90; i++) {
      this.parts.push({
        x: rand(0, W), y: -20, vx: rand(-40, 40), vy: rand(60, 190),
        life: rand(1.2, 2.6), max: 2.6, size: rand(3, 7),
        color: ['#a8e6cf', '#ffb3c6', '#fff3b0', '#c5b3f6', '#a0d8ef'][i % 5],
        kind: 'shard', grav: 60, rot: Math.random() * 6, vr: rand(-8, 8),
      });
    }
    setTimeout(() => this.onEnd(true, stars), 1400);
  }
  lose() {
    this.state = 'lost';
    audio.jingle(false);
    this.shake(10);
    setTimeout(() => this.onEnd(false, 0), 1400);
  }

  // Evaluate this level's two challenges against the just-finished (winning) run.
  // Only ever called from win() — challenges cannot be earned on a loss.
  evaluateChallenges(): boolean[] {
    const defs = this.level.challenges || [];
    return defs.map(d => {
      switch (d.id) {
        case 'perfect_hull': return this.livesLostTotal === 0;
        case 'minimalist': {
          const total = Object.values(this.runStats.towersBuilt).reduce((a, b) => a + b, 0);
          return total <= (d.param ?? 6);
        }
        case 'specialist': {
          const types = Object.keys(this.runStats.towersBuilt).length;
          return types > 0 && types <= (d.param ?? 2);
        }
        case 'no_abilities': return !this.abilityUsed;
        case 'speedrunner': return !this.lateCallHappened;
        case 'never_sell': return !this.soldAny;
        case 'hard_plus': return this.diffTier >= 3;
        default: return false;
      }
    });
  }

  // ---------- input helpers ----------
  pointer(x: number, y: number) { this.mx = x; this.my = y; }
  towerAt(x: number, y: number): Tower | null {
    let best: Tower | null = null, bd = 34 * this.k;
    for (const t of this.towers) {
      const dd = dist(t.x, t.y, x, y);
      if (dd < (t.spec.size + 12) * this.k && dd < bd) { bd = dd; best = t; }
    }
    return best;
  }
  enemyAt(x: number, y: number): Enemy | null {
    let best: Enemy | null = null, bd = 34;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dd = dist(e.x, e.y, x, y);
      if (dd < e.spec.size + 10 && dd < bd) { bd = dd; best = e; }
    }
    return best;
  }
  setFocus(e: Enemy | null) {
    this.focus = e;
    if (e) {
      audio.ui('click');
      this.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.3, max: 0.3, size: e.spec.size * 2, color: '#ff8fa3', kind: 'ring' });
    }
  }
  castAt(x: number, y: number) {
    if (!this.armed) return;
    const ab = ABILITIES[this.armed];
    if (this.cds[this.armed] <= 0) {
      this.cds[this.armed] = ab.cd;
      this.abilityUsed = true;
      audio.ui('ability');
      if (this.armed === 'orbital') {
        this.incomings.push({ x, y, t: 0.7 });
      } else {
        this.patches.push({ x, y, r: (ab as any).radius, until: this.now + (ab as any).dur, kind: 'stasis', slow: (ab as any).slow });
        this.parts.push({ x, y, vx: 0, vy: 0, life: 0.5, max: 0.5, size: (ab as any).radius, color: '#a0d8ef', kind: 'shock' });
      }
    }
    this.armed = null;
    this.onHud();
  }

  tryBuildAt(cellIdx: number, spec: TowerSpec): boolean {
    if (this.state !== 'playing' || !this.cellFree(cellIdx)) return false;
    if (this.credits < this.costOf(spec)) { audio.ui('deny'); return false; }
    this.pendingBuild = { spec, cellIdx };
    return true;
  }
  cancelBuild() { this.pendingBuild = null; }
  confirmBuild(): boolean {
    const pb = this.pendingBuild;
    if (!pb) return false;
    this.pendingBuild = null;
    return this.buildAt(pb.cellIdx, pb.spec);
  }
  buildAt(cellIdx: number, spec: TowerSpec): boolean {
    if (this.state !== 'playing' || !this.cellFree(cellIdx)) return false;
    const cost = this.costOf(spec);
    if (this.credits < cost) { audio.ui('deny'); return false; }
    this.credits -= cost;
    const c = this.cells[cellIdx];
    const t = new Tower(spec, c.x, c.y);
    t.spent = cost;
    t.builtAt = this.now;
    t.mode = this.defaultMode;
    t.vein = c.vein;
    t.cell = cellIdx; t.col = c.col; t.row = c.row;
    t.applyCellType(c.special);
    this.recomputeCoverage(t);
    this.towers.push(t);
    this.occupied[cellIdx] = t;
    this.recomputeThreat();
    this.runStats.towersBuilt[spec.id] = (this.runStats.towersBuilt[spec.id] || 0) + 1;
    audio.ui('place');
    this.parts.push({ x: c.x, y: c.y, vx: 0, vy: 0, life: 0.35, max: 0.35, size: 40, color: this.palTower(spec.id)[0], kind: 'ring' });
    for (let i = 0; i < 8; i++) this.smoke(c.x + rand(-14, 14), c.y + rand(-10, 10));
    this.onHud();
    return true;
  }

  // Overcharge (Phase 4.5): a mid-wave verb — tap a tower during a wave, or hit the panel
  // button, to double its fire rate (or damage, for rate-0 towers) for a few seconds.
  // Amp is excluded (the UI hides its button; this is the belt-and-suspenders guard).
  canOvercharge(t: Tower): boolean {
    return isUnlocked('overcharge') && this.waveActive && this.overchargeLeft > 0
      && this.now >= t.overchargedUntil && t.spec.kind !== 'amp';
  }
  activateOvercharge(t: Tower): boolean {
    if (!this.canOvercharge(t)) return false;
    this.overchargeLeft--;
    t.overchargedUntil = this.now + TUNING.overcharge.dur;
    this.buzz([18]);
    audio.overchargeWhir();
    this.floater(t.x, t.y - 30, 'OVERCHARGE!', '#fff3b0');
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      this.parts.push({ x: t.x, y: t.y, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, life: rand(0.3, 0.5), max: 0.5, size: 2.6, color: '#fff3b0', kind: 'spark' });
    }
    this.parts.push({ x: t.x, y: t.y, vx: 0, vy: 0, life: 0.35, max: 0.35, size: 42, color: '#fff3b0', kind: 'ring' });
    this.onHud();
    return true;
  }
  // Veterancy (Phase 4.6): the one-time, irrevocable perk pick offered at the kill threshold.
  choosePerk(t: Tower, perk: 'sharp' | 'rapid' | 'scav') {
    if (!isUnlocked('veterancy') || t.kills < TUNING.veterancy.kills || t.perk) return;
    t.perk = perk;
    this.recomputeThreat();
    this.buzz([12, 24]);
    audio.ui('upgrade'); // AUDIO-TWIN: a dedicated veterancy chime (Phase 7)
    this.floater(t.x, t.y - 34, `${perk.toUpperCase()} PERK`, '#ffd97a');
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      this.parts.push({ x: t.x, y: t.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: rand(0.35, 0.55), max: 0.55, size: 2.6, color: '#ffd97a', kind: 'spark' });
    }
    this.onHud();
  }
  armMove(t: Tower) {
    this.selected = null;
    this.moveArmed = t;
    this.pendingMove = null;
    this.onSelect();
  }
  cancelMove() {
    this.moveArmed = null;
    this.pendingMove = null;
  }
  tryMoveTo(cellIdx: number): boolean {
    const t = this.moveArmed;
    if (!t || !this.cellFree(cellIdx, t)) return false;
    this.pendingMove = { tower: t, cellIdx };
    return true;
  }
  confirmMove() {
    const pm = this.pendingMove;
    if (!pm) return;
    const { tower: t, cellIdx } = pm;
    this.occupied[t.cell] = null;
    t.cell = cellIdx;
    const c = this.cells[cellIdx];
    t.x = c.x; t.y = c.y; t.col = c.col; t.row = c.row;
    t.vein = c.vein;
    t.applyCellType(c.special);   // move ONTO a special cell picks up its modifier; off drops it
    t.target = null; t.rampT = 0;
    this.recomputeCoverage(t);
    this.occupied[cellIdx] = t;
    this.recomputeThreat();
    audio.ui('place');
    this.parts.push({ x: c.x, y: c.y, vx: 0, vy: 0, life: 0.3, max: 0.3, size: 36, color: this.palTower(t.spec.id)[0], kind: 'ring' });
    for (let i = 0; i < 6; i++) this.smoke(c.x + rand(-12, 12), c.y + rand(-8, 8));
    this.moveArmed = null;
    this.pendingMove = null;
    this.selected = t;
    this.onSelect();
  }

  cancel() {
    this.armed = null;
    this.selected = null;
    this.menuCell = -1;
    this.menuHover = null;
    this.moveArmed = null;
    this.pendingMove = null;
    this.pendingBuild = null;
    this.onSelect(); this.onHud();
  }

  buyUpgrade(t: Tower, branchPick = -1) {
    let next: StageStats | null = null;
    if (t.branch >= 0) {
      if (t.branchStage === 0) next = t.spec.branches[t.branch][1];
    } else if (t.stage < 2) {
      next = t.spec.stages[t.stage + 1];
    } else if (branchPick >= 0) {
      next = t.spec.branches[branchPick][0];
    }
    if (!next) return;
    const cost = this.upgradeCost(next);
    if (this.credits < cost) { audio.ui('deny'); return; }
    this.credits -= cost;
    t.spent += cost;
    if (t.branch >= 0) t.branchStage = 1;
    else if (t.stage < 2) t.stage++;
    else { t.branch = branchPick; t.branchStage = 0; audio.ui('branch'); }
    if (t.branch < 0 || t.branchStage !== 0) audio.ui('upgrade');
    this.recomputeCoverage(t);   // range may have changed with the new stage/branch (Phase 3B.4)
    this.recomputeThreat();
    this.parts.push({ x: t.x, y: t.y, vx: 0, vy: 0, life: 0.4, max: 0.4, size: 46, color: this.palTower(t.spec.id)[0], kind: 'ring' });
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      this.parts.push({ x: t.x, y: t.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: 0.5, max: 0.5, size: 3, color: this.palTower(t.spec.id)[0], kind: 'dot' });
    }
    this.onSelect(); this.onHud();
  }

  sell(t: Tower) {
    const undo = this.now - t.builtAt <= TUNING.economy.sellUndoWindow;
    const refund = undo ? t.spent : Math.round(t.spent * TUNING.economy.sellRefund);
    if (!undo) this.soldAny = true;   // undo is an "unplace", not a sale — Committed challenge unaffected
    this.credits += refund;
    if (t.cell >= 0) this.occupied[t.cell] = null;
    this.towers = this.towers.filter(o => o !== t);
    this.selected = null;
    this.recomputeThreat();
    audio.ui('sell');
    audio.bell(0.6);   // a refund is a transaction — shares the economy register (Phase 7.7)
    this.floater(t.x, t.y - 20, undo ? `Undone +${refund}` : `+${refund}`, '#fff3b0');
    for (let i = 0; i < 8; i++) this.smoke(t.x + rand(-12, 12), t.y + rand(-8, 8));
    this.onSelect(); this.onHud();
  }

  // Null Zone: reuses the existing slow-ring visual (drawn whenever now < slowUntil)
  // without touching slowPct — the actual speed reduction is applied separately in
  // Enemy.update, so this purely keeps the tint alive while the enemy is in the field.
  nullSlowTint(e: Enemy) { e.slowUntil = Math.max(e.slowUntil, this.now + 0.15); }

  // ---------- fx helpers ----------
  shake(m: number) { if (!this.shakeOn || this.reduceMotion) return; this.shakeMag = Math.max(this.shakeMag, m); this.shakeT = 0.3; }
  spark(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(40, 150);
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.15, 0.35), max: 0.35, size: rand(1.5, 3), color, kind: 'spark' });
    }
  }
  flash(x: number, y: number, color: string) {
    // The muzzle flash is a tower's single brightest moment (Phase 3B.2: towers read cool
    // and desaturated everywhere else) — sized up from the plain body-color flash it used
    // to be, and callers now pass the palette's dedicated muzzle token.
    this.parts.push({ x, y, vx: 0, vy: 0, life: 0.09, max: 0.09, size: 15, color, kind: 'flash' });
  }
  smoke(x: number, y: number) {
    this.parts.push({ x, y, vx: rand(-16, 16), vy: rand(-16, 16), life: rand(0.4, 0.9), max: 0.9, size: rand(4, 9), color: 'rgba(200,205,235,0.25)', kind: 'smoke' });
  }
  fireFx(x: number, y: number) {
    this.parts.push({ x, y, vx: rand(-14, 14), vy: rand(-26, -6), life: rand(0.25, 0.5), max: 0.5, size: rand(2.5, 5), color: ['#ffb37d', '#ff8a5c'][Math.random() < 0.5 ? 0 : 1], kind: 'fire' });
  }
  healFx(x: number, y: number) {
    this.parts.push({ x, y: y - 10, vx: 0, vy: -34, life: 0.5, max: 0.5, size: 6, color: '#c0f5b3', kind: 'text', text: '+' });
  }
  ringFx(x: number, y: number, r: number, color: string) {
    this.parts.push({ x, y, vx: 0, vy: 0, life: 0.4, max: 0.4, size: r, color, kind: 'ring' });
  }
  shieldBreak(e: Enemy) {
    e.hadShieldBreak = true;   // chained into deathFx's aegis case (Phase 3B.5)
    audio.freezeCrack();
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      this.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, life: 0.4, max: 0.4, size: 3, color: '#9fd0ff', kind: 'shard', rot: 0, vr: 8 });
    }
  }
  floater(x: number, y: number, text: string, color: string) {
    // Lifetime scales with text length — a short number ("+45") stays snappy, a longer
    // phrase ("Abilities recharged!") gets real reading time instead of a flat 0.9s
    // regardless of how much there is to read, capped so nothing lingers too long.
    const life = Math.min(1.6, 0.6 + text.length * 0.025);
    this.parts.push({ x, y, vx: 0, vy: -36, life, max: life, size: 15, color, kind: 'text', text });
  }
  portalFx(e: Enemy) {
    const p = this.portalPx[e.pathIdx] || { x: e.x, y: e.y };
    this.parts.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.3, max: 0.3, size: 26, color: this.palEnemy(e.spec.id)[0], kind: 'ring' });
  }

  // ---------- background ----------
  buildBg(rng: () => number) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = this.zone.bg;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 7; i++) {
      const x = rng() * W, y = rng() * H, r = 140 + rng() * 200;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const col = this.zone.nebula[i % 2];
      grad.addColorStop(0, col + 'aa');
      grad.addColorStop(1, col + '00');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    this.drawLandmarks(g, rng);
    this.bgCanvas = c;
  }

  // Hand-authored, edge/corner-only silhouettes (Phase 3) — cosmetic only, painted onto the
  // cached bg canvas after nebulas, before the grid. Endless has no fixed set: it seed-picks
  // 2 entries from the same table every run, using the rng continued from the nebula draw.
  drawLandmarks(g: CanvasRenderingContext2D, rng: () => number) {
    let list: LandmarkSpec[];
    if (this.endless) {
      const pool = Object.values(LANDMARKS).flat();
      const picks: LandmarkSpec[] = [];
      for (let i = 0; i < 2 && pool.length; i++) picks.push(pool.splice(seededInt(rng, 0, pool.length - 1), 1)[0]);
      list = picks;
    } else {
      list = LANDMARKS[this.level.id] || [];
    }
    for (const lm of list) this.drawLandmark(g, lm, rng);
  }

  drawLandmark(g: CanvasRenderingContext2D, lm: LandmarkSpec, rng: () => number) {
    const tone = this.zone.nebula[0];
    const accent = this.zone.accent;
    g.save();
    g.translate(lm.x, lm.y);
    g.scale(lm.s, lm.s);
    switch (lm.kind) {
      case 'planet': {
        const r = 200;
        g.globalAlpha = 0.5; g.fillStyle = tone;
        g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
        g.globalAlpha = 0.35; g.strokeStyle = accent; g.lineWidth = 3;
        g.beginPath(); g.ellipse(0, 0, r * 1.18, r * 0.22, -0.35, 0, 7); g.stroke();
        break;
      }
      case 'moon': {
        const r = 40;
        g.globalAlpha = 0.45; g.fillStyle = tone;
        g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
        g.globalAlpha = 0.5; g.strokeStyle = accent; g.lineWidth = 1.5;
        g.beginPath(); g.arc(0, 0, r, -2.4, -1.4); g.stroke();
        g.globalAlpha = 0.3; g.fillStyle = '#05060f';
        const craters = 2 + Math.floor(rng() * 2);
        for (let i = 0; i < craters; i++) {
          const a = rng() * Math.PI * 2, d = rng() * r * 0.55;
          g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, r * (0.12 + rng() * 0.08), 0, 7); g.fill();
        }
        break;
      }
      case 'derelict': {
        g.globalAlpha = 0.45; g.fillStyle = tone;
        (g as any).beginPath(); (g as any).roundRect(-52, -16, 104, 32, 12); g.fill();
        g.beginPath(); g.moveTo(-52, -16); g.lineTo(-72, -30); g.lineTo(-52, 4); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(52, -16); g.lineTo(72, -30); g.lineTo(52, 4); g.closePath(); g.fill();
        g.globalAlpha = 0.35; g.strokeStyle = accent; g.lineWidth = 1.5;
        (g as any).beginPath(); (g as any).roundRect(-52, -16, 104, 32, 12); g.stroke();
        g.globalAlpha = 0.5; g.fillStyle = accent;
        for (let i = -1; i <= 1; i++) { g.beginPath(); g.arc(i * 24, -2, 3, 0, 7); g.fill(); }
        break;
      }
      case 'station': {
        g.globalAlpha = 0.4; g.strokeStyle = tone; g.lineWidth = 10;
        g.beginPath(); g.arc(0, 0, 46, 0, 7); g.stroke();
        g.globalAlpha = 0.5; g.fillStyle = tone;
        g.beginPath(); g.arc(0, 0, 16, 0, 7); g.fill();
        g.globalAlpha = 0.35; g.strokeStyle = accent; g.lineWidth = 3;
        g.beginPath(); g.moveTo(-46, 0); g.lineTo(46, 0); g.moveTo(0, -46); g.lineTo(0, 46); g.stroke();
        break;
      }
      case 'comet': {
        const cornerX = lm.x < W / 2 ? 0 : W, cornerY = lm.y < H / 2 ? 0 : H;
        const ang = Math.atan2(cornerY - lm.y, cornerX - lm.x);
        const tx = Math.cos(ang) * 220, ty = Math.sin(ang) * 220;
        const grad = g.createLinearGradient(0, 0, tx, ty);
        grad.addColorStop(0, accent + 'aa');
        grad.addColorStop(1, accent + '00');
        g.globalAlpha = 0.5; g.strokeStyle = grad; g.lineWidth = 14; g.lineCap = 'round';
        g.beginPath(); g.moveTo(0, 0); g.lineTo(tx, ty); g.stroke();
        g.globalAlpha = 0.5; g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(0, 0, 8, 0, 7); g.fill();
        break;
      }
    }
    g.restore();
    g.globalAlpha = 1;
  }

  // =================================================================
  // RENDER
  // =================================================================
  render(rawDt: number) {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (this.shakeMag > 0) {
      const m = this.shakeMag * (this.shakeT / 0.3);
      g.translate(rand(-m, m), rand(-m, m));
    }
    g.drawImage(this.bgCanvas, 0, 0);
    for (const s of this.stars) {
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(performance.now() / 700 + s.p * 4));
      g.globalAlpha = a;
      g.fillStyle = '#dfe4ff';
      g.fillRect(s.x, s.y, s.s, s.s);
    }
    g.globalAlpha = 1;

    this.drawTiles(g);
    this.drawModFx(g);
    this.drawPatches(g);
    this.drawPortalsAndBases(g);
    this.drawPortalCharge(g);
    this.drawFlierLaneTelegraph(g);
    this.drawPreviews(g);

    for (const t of this.towers) {
      const ps = 40 * this.k;
      g.fillStyle = 'rgba(4,5,14,0.32)';
      (g as any).beginPath();
      (g as any).roundRect(t.x - ps / 2 + 4, t.y - ps / 2 + 6, ps, ps, 8 * this.k);
      g.fill();
    }
    for (const e of this.enemies) {
      if (e.spec.flying) this.shadow(g, e.x + 9, e.y + 13, e.spec.size * 0.85, 0.26);
      else this.shadow(g, e.x, e.y, e.spec.size + 2, 0.3);
    }

    // tower bases first, so beams and effects sit on top of them
    for (const t of this.towers) this.drawTower(g, t, false, 'pad');

    this.drawBeams(g);
    for (const t of this.towers) this.drawTower(g, t, false, 'body');
    for (const e of this.enemies) this.drawEnemy(g, e);
    this.drawDrops(g);

    this.drawProjs(g);
    this.drawBolts(g);
    this.drawRays(g);
    this.drawIncomings(g);
    this.drawParticles(g);
    this.drawFocus(g);
    this.drawSelection(g);
    this.drawPlacement(g);
    this.drawOverlays(g);
  }

  // Full-screen mood/feedback overlays: NOVA buildup darken, whiteout flash,
  // boss-entrance red vignette, and the persistent low-hull warning vignette.
  drawOverlays(g: CanvasRenderingContext2D) {
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); // overlays ignore screen shake (but keep DPR sharpness)
    // NOVA buildup: world darkens over 1.2s
    if (this.novaFireAt > 0) {
      const frac = 1 - clamp((this.novaFireAt - this.now) / TUNING.nova.buildup, 0, 1);
      g.globalAlpha = frac * 0.55;
      g.fillStyle = '#05060f';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
    // boss entrance vignette: pulsing red edges. A leak (Phase 6.2) gets the same treatment as
    // a brief, sharper pulse — reusing this exact machinery is the plan's own instruction, since
    // it's already the established "something's wrong" visual language.
    const bossV = this.state === 'playing' && this.now < this.bossVignetteUntil;
    const leakV = this.state === 'playing' && this.now < this.leakFlashUntil;
    const lowHull = this.state === 'playing' && this.lives / this.maxLives < 0.25 && this.lives > 0;
    if (bossV || leakV || lowHull) {
      const pulse = 0.5 + 0.5 * Math.sin(this.now * (bossV ? 9 : leakV ? 14 : 4));
      const strength = (bossV ? 0.4 : leakV ? 0.5 : 0.26) * (0.6 + 0.4 * pulse) * (this.reduceFlash ? 0.55 : 1);
      const grad = g.createRadialGradient(W / 2, H / 2, H * 0.44, W / 2, H / 2, H * 0.78);
      grad.addColorStop(0, 'rgba(255,80,90,0)');
      grad.addColorStop(1, `rgba(255,80,90,${strength})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }
    // whiteout flash (NOVA, wave clear, boss death) — reduced mode caps it at a soft glow
    if (this.flashT > 0) {
      g.globalAlpha = clamp(this.flashT, 0, this.reduceFlash ? 0.22 : 0.85);
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
  }

  shadow(g: CanvasRenderingContext2D, x: number, y: number, r: number, alpha = 0.32) {
    g.fillStyle = `rgba(4,5,14,${alpha})`;
    g.beginPath();
    g.arc(x + 5, y + 7, r, 0, 7);
    g.fill();
  }

  // --- the unified tile field: buildable outlines, path tiles, rock tiles ---
  drawTiles(g: CanvasRenderingContext2D) {
    const cs = this.cell;
    const gap = Math.max(5, cs * 0.13);
    const s = cs - gap;
    const rad = Math.max(6, cs * 0.16);
    const active = this.menuCell >= 0 || this.moveArmed !== null || this.pendingMove !== null || this.pendingBuild !== null;
    const base = active ? 0.32 : 0.16;
    const hoverIdx = this.cellAt(this.mx, this.my);

    for (const c of this.cells) {
      const i = this.idx(c.col, c.row);
      if (c.path) {
        // recessed channel (Phase 3): the road is the most legible surface on the board —
        // darker than terrain, with a soft inset edge. (A per-edge inner shadow oriented to
        // each cell's local path direction was considered but skipped: the marching chevrons
        // below already carry that directional read, so a uniform inset stroke gets the
        // "recessed" feel without duplicating bookkeeping for a marginal visual gain.)
        g.fillStyle = 'rgba(0,0,0,0.42)';
        (g as any).beginPath(); (g as any).roundRect(c.x - s / 2 - 2, c.y - s / 2, s + 4, s + 5, rad); g.fill();
        g.fillStyle = 'rgba(238,240,255,0.05)';
        (g as any).beginPath(); (g as any).roundRect(c.x - s / 2, c.y - s / 2, s, s, rad); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.3)';
        g.lineWidth = 2;
        (g as any).beginPath(); (g as any).roundRect(c.x - s / 2 + 1, c.y - s / 2 + 1, s - 2, s - 2, Math.max(2, rad - 1)); g.stroke();
        continue;
      }
      if (c.rock) {
        g.fillStyle = 'rgba(4,5,14,0.35)';
        (g as any).beginPath(); (g as any).roundRect(c.x - s / 2 + 3, c.y - s / 2 + 5, s, s, rad); g.fill();
        g.fillStyle = '#3a3d5e';
        (g as any).beginPath(); (g as any).roundRect(c.x - s / 2, c.y - s / 2, s, s, rad); g.fill();
        g.fillStyle = '#484b70';
        (g as any).beginPath(); (g as any).roundRect(c.x - s / 2 + 2, c.y - s / 2 + 2, s - 6, s - 8, rad); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath(); g.arc(c.x - s * 0.18, c.y + s * 0.1, s * 0.11, 0, 7); g.fill();
        g.beginPath(); g.arc(c.x + s * 0.2, c.y - s * 0.16, s * 0.08, 0, 7); g.fill();
        continue;
      }
      if (c.vein) {
        // rich vein: soft cyan glow + twinkling diamonds (visible under towers too)
        const tw = 0.5 + 0.5 * Math.sin(this.now * 2.6 + i * 1.7);
        g.globalAlpha = 0.14 + tw * 0.1;
        g.fillStyle = '#8ff0ff';
        (g as any).beginPath(); (g as any).roundRect(c.x - s / 2, c.y - s / 2, s, s, rad); g.fill();
        g.globalAlpha = 0.55 + tw * 0.45;
        g.fillStyle = '#d6f7ff';
        for (let k = 0; k < 3; k++) {
          const dx = Math.sin(i * 3.1 + k * 2.4) * s * 0.28, dy = Math.cos(i * 5.7 + k * 1.9) * s * 0.28;
          const dr = 2 + Math.sin(this.now * 3 + k * 2 + i) * 1;
          g.save(); g.translate(c.x + dx, c.y + dy); g.rotate(Math.PI / 4);
          g.fillRect(-dr / 2, -dr / 2, dr, dr);
          g.restore();
        }
        g.globalAlpha = 1;
      }
      // ---- Special terrain (Phase 2). Value/elevation-based, palette-neutral — never a new
      // hue. Drawn before the buildable-cell outline below so occupied special cells keep
      // their treatment visible around the tower pad. ----
      if (c.special === 'ridge') {
        // lifted face: 2px up-shift, lighter top edge, dark drop shadow along the bottom.
        g.fillStyle = 'rgba(4,5,14,0.28)';
        (g as any).beginPath(); (g as any).roundRect(c.x - s / 2, c.y - s / 2 - 2 + 3, s, s, rad); g.fill();
        g.fillStyle = 'rgba(238,240,255,0.14)';
        (g as any).beginPath(); (g as any).roundRect(c.x - s / 2, c.y - s / 2 - 2, s, s, rad); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.22)';
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(c.x - s / 2 + rad, c.y - s / 2 - 2); g.lineTo(c.x + s / 2 - rad, c.y - s / 2 - 2); g.stroke();
      } else if (c.special === 'sinkhole') {
        // inset face: darker fill, inner shadow on the top edge, faint downward-triangle glyph.
        g.fillStyle = 'rgba(4,5,14,0.22)';
        (g as any).beginPath(); (g as any).roundRect(c.x - s / 2, c.y - s / 2, s, s, rad); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.35)';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(c.x - s / 2 + rad, c.y - s / 2 + 1); g.lineTo(c.x + s / 2 - rad, c.y - s / 2 + 1); g.stroke();
        g.globalAlpha = 0.18;
        g.fillStyle = '#dfe3ff';
        g.beginPath();
        g.moveTo(c.x - s * 0.14, c.y - s * 0.08); g.lineTo(c.x + s * 0.14, c.y - s * 0.08); g.lineTo(c.x, c.y + s * 0.14);
        g.closePath(); g.fill();
        g.globalAlpha = 1;
      } else if (c.special === 'conduit') {
        // emissive border on every conduit cell, plus a marching dashed link line drawn
        // once from the lower-index cell of each pair (avoids drawing it twice).
        const pulse = this.reduceMotion ? 0.45 : 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(this.now * (Math.PI * 2 / 1.2)));
        g.globalAlpha = pulse;
        g.strokeStyle = '#bfe3ff';
        g.lineWidth = 2;
        (g as any).beginPath(); (g as any).roundRect(c.x - s / 2, c.y - s / 2, s, s, rad); g.stroke();
        g.globalAlpha = 1;
        if (c.conduitPartner !== undefined && i < c.conduitPartner) {
          const partner = this.cells[c.conduitPartner];
          const bothOccupied = !!this.occupied[i] && !!this.occupied[c.conduitPartner];
          g.globalAlpha = bothOccupied ? pulse : pulse * 0.5;
          g.strokeStyle = '#bfe3ff';
          g.lineWidth = 1.5;
          if (!this.perfMode && !this.reduceMotion) { g.setLineDash([5, 6]); g.lineDashOffset = -(this.now * 22) % 22; }
          g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(partner.x, partner.y); g.stroke();
          g.setLineDash([]);
          g.globalAlpha = 1;
        }
      } else if (c.special === 'anchor') {
        const spin = this.reduceMotion ? 0 : this.now * 0.6;
        g.strokeStyle = 'rgba(197,179,246,0.5)';
        g.lineWidth = 1.5;
        for (const rr of [s * 0.32, s * 0.22]) { g.beginPath(); g.arc(c.x, c.y, rr, spin, spin + Math.PI * 1.5); g.stroke(); }
      } else if (c.special === 'nullcell') {
        // diagonal hatch always visible; the dashed slow-radius ring only while an enemy
        // is actually inside it — keeps the board quiet when nothing's happening.
        g.save();
        g.beginPath(); (g as any).roundRect(c.x - s / 2, c.y - s / 2, s, s, rad); g.clip();
        g.strokeStyle = 'rgba(160,216,239,0.18)';
        g.lineWidth = 2;
        for (let off = -s; off <= s; off += 7) {
          g.beginPath(); g.moveTo(c.x - s / 2 + off, c.y - s / 2); g.lineTo(c.x - s / 2 + off + s, c.y + s / 2); g.stroke();
        }
        g.restore();
        const slowRad = 1.5 * this.cell;
        const enemyInside = this.enemies.some(e => !e.dead && !e.spec.flying && dist(e.x, e.y, c.x, c.y) < slowRad);
        if (enemyInside) {
          g.globalAlpha = 0.35;
          g.strokeStyle = '#a0d8ef';
          g.lineWidth = 1.5;
          g.setLineDash([4, 5]);
          g.beginPath(); g.arc(c.x, c.y, slowRad, 0, 7); g.stroke();
          g.setLineDash([]);
          g.globalAlpha = 1;
        }
        continue;
      }
      if (!c.valid || this.occupied[i]) continue;
      const hovered = i === hoverIdx && this.state === 'playing';
      g.globalAlpha = hovered ? 0.85 : base;
      g.strokeStyle = '#dfe3ff';
      g.lineWidth = hovered ? 2 : 1.5;
      (g as any).beginPath();
      (g as any).roundRect(c.x - s / 2, c.y - s / 2, s, s, rad);
      g.stroke();
      g.globalAlpha = hovered ? 0.16 : base * 0.4;
      g.fillStyle = '#dfe3ff';
      g.fill();
      if (hovered) {
        g.globalAlpha = 0.14;
        g.fillStyle = '#c5cbf5';
        g.fill();
      }
      g.globalAlpha = hovered ? 0.9 : base * 2.2;
      g.fillStyle = '#dfe3ff';
      g.beginPath(); g.arc(c.x, c.y, 1.6, 0, 7); g.fill();
    }
    g.globalAlpha = 1;

    // Directional flow (Phase 3): small chevrons marching toward the base on every second
    // path cell — supersedes the old plain dashed line, which read as "a road" but not as
    // "which way." `perfMode` thins to every third cell; `reduceMotion` freezes the march.
    const chevStep = this.perfMode ? 3 : 2;
    const chevAlpha = this.reduceMotion ? 0.3 : 0.35;
    for (const ordered of this.pathOrderedCells) {
      for (let ci = 0; ci < ordered.length; ci += chevStep) {
        const cur = ordered[ci];
        const nxt = ordered[Math.min(ci + 1, ordered.length - 1)];
        let dx = nxt.c - cur.c, dy = nxt.r - cur.r;
        if (dx === 0 && dy === 0) continue; // corner tiles can repeat in travel order — skip, direction undefined here
        const len = Math.hypot(dx, dy); dx /= len; dy /= len;
        const cx = this.cx(cur.c), cy = this.cy(cur.r);
        const march = this.reduceMotion ? 0 : (this.now * 28) % this.cell;
        const ox = cx + dx * march, oy = cy + dy * march;
        g.save();
        g.translate(ox, oy);
        g.rotate(Math.atan2(dy, dx));
        g.globalAlpha = chevAlpha;
        g.fillStyle = '#eef0ff';
        g.beginPath(); g.moveTo(-5, -6); g.lineTo(5, 0); g.lineTo(-5, 6); g.closePath(); g.fill();
        g.restore();
      }
    }
    g.globalAlpha = 1;
  }

  // tile-accurate Chebyshev range indicator
  drawRangeTiles(g: CanvasRenderingContext2D, col: number, row: number, R: number, color: string, fillAlpha = 0.1) {
    const cs = this.cell;
    const gap = Math.max(5, cs * 0.13);
    const s = cs - gap;
    const rad = Math.max(5, cs * 0.14);
    const cx = this.cx(col), cy = this.cy(row);
    const inR = (c: number, r: number) => this.circCell(cx, cy, R, c, r);
    g.fillStyle = color;
    const B = Math.ceil(R) + 1;
    for (let dr = -B; dr <= B; dr++) {
      for (let dc = -B; dc <= B; dc++) {
        const c = col + dc, r = row + dr;
        if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) continue;
        if (dc === 0 && dr === 0) continue;
        if (!inR(c, r)) continue;
        g.globalAlpha = fillAlpha;
        (g as any).beginPath();
        (g as any).roundRect(this.cx(c) - s / 2, this.cy(r) - s / 2, s, s, rad);
        g.fill();
      }
    }
    // jagged boundary: draw edges between in-range and out-of-range cells
    g.globalAlpha = 0.85;
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.beginPath();
    for (let dr = -B; dr <= B; dr++) {
      for (let dc = -B; dc <= B; dc++) {
        const c = col + dc, r = row + dr;
        if (!inR(c, r) && !(dc === 0 && dr === 0)) continue;
        const x0 = this.gx0 + c * cs, y0 = this.gy0 + r * cs;
        if (!inR(c, r - 1) && !(dc === 0 && dr === 1)) { g.moveTo(x0 + 2, y0); g.lineTo(x0 + cs - 2, y0); }
        if (!inR(c, r + 1) && !(dc === 0 && dr === -1)) { g.moveTo(x0 + 2, y0 + cs); g.lineTo(x0 + cs - 2, y0 + cs); }
        if (!inR(c - 1, r) && !(dc === 1 && dr === 0)) { g.moveTo(x0, y0 + 2); g.lineTo(x0, y0 + cs - 2); }
        if (!inR(c + 1, r) && !(dc === -1 && dr === 0)) { g.moveTo(x0 + cs, y0 + 2); g.lineTo(x0 + cs, y0 + cs - 2); }
      }
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  drawPatches(g: CanvasRenderingContext2D) {
    for (const p of this.patches) {
      const left = clamp((p.until - this.now) / 1.2, 0, 1);
      if (p.kind === 'burn') {
        g.globalAlpha = 0.5 * left + 0.15;
        const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        grad.addColorStop(0, '#ff9a5a');
        grad.addColorStop(0.6, '#ff6b4a66');
        grad.addColorStop(1, '#ff6b4a00');
        g.fillStyle = grad;
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill();
        if (Math.random() < 0.5) this.fireFx(p.x + rand(-p.r, p.r) * 0.7, p.y + rand(-p.r, p.r) * 0.7);
      } else {
        g.globalAlpha = 0.4 * left + 0.1;
        const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        grad.addColorStop(0, '#a0d8ef88');
        grad.addColorStop(1, '#a0d8ef00');
        g.fillStyle = grad;
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill();
        g.strokeStyle = '#a0d8ef';
        g.globalAlpha = 0.5 * left;
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.stroke();
      }
      g.globalAlpha = 1;
    }
  }

  drawPortalsAndBases(g: CanvasRenderingContext2D) {
    const t = this.now;
    const k = this.k;
    for (let pi = 0; pi < this.paths.length; pi++) {
      const s = this.portalPx[pi];
      // Hot portal / calm base (Phase 3.3.3): a persistent soft glow so the two ends of the
      // road read as "in" and "out" at a glance, independent of the charge telegraph on top.
      const pGlowR = 60 * k;
      const pGlow = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, pGlowR);
      pGlow.addColorStop(0, this.zone.accent + '33');
      pGlow.addColorStop(1, this.zone.accent + '00');
      g.fillStyle = pGlow;
      g.beginPath(); g.arc(s.x, s.y, pGlowR, 0, 7); g.fill();
      const bp = this.basePx[pi];
      const bGlowR = 55 * k;
      const bGlow = g.createRadialGradient(bp.x, bp.y, 0, bp.x, bp.y, bGlowR);
      bGlow.addColorStop(0, '#a0d8ef2e');
      bGlow.addColorStop(1, '#a0d8ef00');
      g.fillStyle = bGlow;
      g.beginPath(); g.arc(bp.x, bp.y, bGlowR, 0, 7); g.fill();

      g.save();
      g.translate(s.x, s.y);
      g.scale(k, k);
      for (let i = 0; i < 2; i++) {
        g.strokeStyle = i ? '#c5b3f6' : '#a0d8ef';
        g.globalAlpha = 0.8;
        g.lineWidth = 3.4;
        g.beginPath();
        g.arc(0, 0, 20 + i * 6, t * (i ? 2 : -2.4), t * (i ? 2 : -2.4) + 4.2);
        g.stroke();
      }
      g.globalAlpha = 0.25 + 0.1 * Math.sin(t * 3);
      g.fillStyle = '#c5b3f6';
      g.beginPath(); g.arc(0, 0, 14, 0, 7); g.fill();
      g.globalAlpha = 1;
      g.restore();

      const e = this.basePx[pi];
      this.shadow(g, e.x, e.y, 24 * k, 0.4);
      g.save();
      g.translate(e.x, e.y);
      g.scale(k, k);
      g.strokeStyle = this.zone.accent;
      g.globalAlpha = 0.5;
      g.lineWidth = 3.4;
      g.beginPath(); g.arc(0, 0, 27, 0, 7); g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = '#2c3057';
      g.beginPath(); g.arc(0, 0, 21, 0, 7); g.fill();
      g.fillStyle = this.zone.accent;
      g.beginPath(); g.arc(0, 0, 15, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath(); g.arc(-4, -5, 5, 0, 7); g.fill();
      g.fillStyle = '#2c3057';
      g.beginPath(); g.arc(0, 0, 6, 0, 7); g.fill();
      g.strokeStyle = '#eef0ff';
      g.globalAlpha = 0.7;
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(t * 1.4) * 14, Math.sin(t * 1.4) * 14); g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = Math.sin(t * 5) > 0 ? '#ffb3c6' : '#5a5f96';
      g.beginPath(); g.arc(Math.cos(t * 1.4) * 14, Math.sin(t * 1.4) * 14, 2.6, 0, 7); g.fill();
      // Leak impact — persistent crack overlay (Phase 6.2): 3 damage states off the SAME hull
      // fraction the pip bar/vignette read, so every hull cue agrees. Static per-frame (no
      // `t`-driven motion) so the cracks read as damage, not another pulsing effect; the
      // per-path random offset just keeps multiple bases from looking identically cracked.
      if (this.maxLives > 0) {
        const hullFrac = this.lives / this.maxLives;
        const dmgState = hullFrac > 0.6 ? 0 : hullFrac > 0.3 ? 1 : this.lives > 0 ? 2 : 0;
        if (dmgState > 0) {
          const seed = pi * 13.7;
          const cracks = dmgState === 1 ? 2 : 4;
          g.strokeStyle = '#1a1c38';
          g.globalAlpha = 0.85;
          g.lineWidth = 1.6;
          for (let i = 0; i < cracks; i++) {
            const a = seed + i * (Math.PI * 2 / cracks) + Math.sin(seed + i) * 0.4;
            const len = 10 + (i % 2) * 5;
            g.beginPath();
            g.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
            g.lineTo(Math.cos(a + 0.3) * len, Math.sin(a + 0.3) * len);
            g.lineTo(Math.cos(a - 0.15) * (len * 0.7), Math.sin(a - 0.15) * (len * 0.7));
            g.stroke();
          }
          g.globalAlpha = 1;
        }
      }
      // Leak flash (Phase 6.2): a brief bright pop right on the base that took the hit.
      if (this.now < this.leakFlashUntil) {
        const flashFrac = clamp((this.leakFlashUntil - this.now) / 0.35, 0, 1);
        g.globalAlpha = flashFrac * (this.reduceFlash ? 0.4 : 0.75);
        g.fillStyle = '#ff7d7d';
        g.beginPath(); g.arc(0, 0, 24, 0, 7); g.fill();
        g.globalAlpha = 1;
      }
      g.restore();
    }
  }

  // Portal charge telegraph (Phase 3.4): reads straight off spawnQueue, so a delayed second
  // group (Phase 5's Feint shape) automatically telegraphs its own portal a beat ahead with
  // zero extra work here. AUDIO-TWIN: spawn signature (Phase 7).
  drawPortalCharge(g: CanvasRenderingContext2D) {
    if (!this.spawnQueue.length) return;
    const lead = TUNING.portals.chargeLead;
    const perPath = new Map<number, { t: number; e: string }>();
    for (const sq of this.spawnQueue) {
      const cur = perPath.get(sq.p);
      if (!cur || sq.t < cur.t) perPath.set(sq.p, { t: sq.t, e: sq.e });
    }
    const flashCap = this.reduceFlash ? 0.6 : 1;
    for (const [pi, info] of perPath) {
      const until = info.t - this.now;
      if (until > lead || until < -0.4) continue; // small grace so it doesn't cut out a frame early
      const frac = 1 - clamp(until / lead, 0, 1); // 0 at lead-in, 1 right at spawn
      const portal = this.portalPx[pi];
      if (!portal) continue;
      const color = this.palEnemy(info.e)[0];
      g.save();
      g.translate(portal.x, portal.y);
      g.globalAlpha = (0.15 + frac * 0.55) * flashCap;
      g.strokeStyle = color;
      g.lineWidth = 2.4;
      g.beginPath(); g.arc(0, 0, 18 + frac * 14, 0, 7); g.stroke();
      g.globalAlpha = frac * 0.6 * flashCap;
      g.fillStyle = color;
      g.beginPath(); g.arc(0, 0, 8 + frac * 8, 0, 7); g.fill();
      g.restore();
    }
    g.globalAlpha = 1;
  }

  // Flier lane telegraph (Phase 5.4.3): during an intermission, if the PENDING wave carries
  // fliers, sketch their shared curved lane ahead of time — this, not the formula, is what
  // turns anti-air from a build-order habit into a per-wave read. Computable purely from
  // levelId+waveIdx, so it's exact even before the wave (and its real spawnQueue) exists.
  drawFlierLaneTelegraph(g: CanvasRenderingContext2D) {
    if (this.waveActive || !this.pendingWave) return;
    const wIdx = this.waveIdx + 1;
    const flierPaths = new Set(this.pendingWave.filter(grp => ENEMIES[grp.e].flying).map(grp => grp.p || 0));
    if (!flierPaths.size) return;
    for (const pi of flierPaths) {
      const portal = this.portalPx[pi], base = this.basePx[pi];
      if (!portal || !base) continue;
      const c = this.flierLaneControl(wIdx, portal, base);
      const flier = this.pendingWave.find(grp => ENEMIES[grp.e].flying && (grp.p || 0) === pi)!;
      g.save();
      g.globalAlpha = this.reduceFlash ? 0.18 : 0.3;
      g.strokeStyle = this.palEnemy(flier.e)[0];
      g.lineWidth = 2;
      g.setLineDash([7, 7]);
      g.beginPath();
      for (let i = 0; i <= 16; i++) {
        const p = bezierAt(portal.x, portal.y, c.x, c.y, base.x, base.y, i / 16);
        if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
      }
      g.stroke();
      g.restore();
    }
    g.globalAlpha = 1;
  }

  ampRing(g: CanvasRenderingContext2D, x: number, y: number, _r: number, strong = false) {
    // static tile-shaped highlight (used when previewing/selecting an Amp)
    const s = this.cell - 8;
    g.strokeStyle = '#c5b3f6';
    g.globalAlpha = strong ? 0.9 : 0.5 + 0.15 * Math.sin(this.now * 3);
    g.lineWidth = 2.4;
    (g as any).beginPath();
    (g as any).roundRect(x - s / 2, y - s / 2, s, s, 9);
    g.stroke();
    g.globalAlpha = 1;
  }

  drawPreviews(g: CanvasRenderingContext2D) {
    if (this.menuCell >= 0) {
      const c = this.cells[this.menuCell];
      g.strokeStyle = '#a8e6cf';
      g.globalAlpha = 0.9;
      g.lineWidth = 2;
      const s = this.cell - 8;
      (g as any).beginPath(); (g as any).roundRect(c.x - s / 2, c.y - s / 2, s, s, 8); g.stroke();
      g.globalAlpha = 1;
      if (this.menuHover) {
        const st = this.menuHover.stages[0];
        this.drawRangeTiles(g, c.col, c.row, st.range, this.palTower(this.menuHover.id)[0], 0.1);
        if (this.menuHover.kind === 'amp') {
          for (const t of this.towers) {
            if (t.spec.kind !== 'amp' && Math.max(Math.abs(t.col - c.col), Math.abs(t.row - c.row)) <= st.range) {
              this.ampRing(g, t.x, t.y, (t.spec.size + 11) * this.k, true);
            }
          }
        }
      }
    }
    if (this.armed && this.mx > -50) {
      const ab: any = ABILITIES[this.armed];
      g.strokeStyle = this.armed === 'orbital' ? '#ffd3b6' : '#a0d8ef';
      g.fillStyle = this.armed === 'orbital' ? 'rgba(255,211,182,0.12)' : 'rgba(160,216,239,0.12)';
      g.lineWidth = 2.5;
      g.setLineDash([8, 8]);
      g.beginPath(); g.arc(this.mx, this.my, ab.radius, 0, 7); g.fill(); g.stroke();
      g.setLineDash([]);
    }
  }

  // ---------- entity drawing ----------
  shapePath(g: CanvasRenderingContext2D, shape: string, rx: number, ry: number) {
    g.beginPath();
    switch (shape) {
      case 'slim': // pointed teardrop, nose forward (+x)
        g.moveTo(rx * 1.35, 0);
        g.quadraticCurveTo(rx * 0.3, -ry * 0.85, -rx * 0.85, -ry * 0.55);
        g.quadraticCurveTo(-rx * 1.05, 0, -rx * 0.85, ry * 0.55);
        g.quadraticCurveTo(rx * 0.3, ry * 0.85, rx * 1.35, 0);
        break;
      case 'square':
        (g as any).roundRect(-rx * 0.95, -ry * 0.95, rx * 1.9, ry * 1.9, rx * 0.28);
        break;
      case 'hex':
        for (let i = 0; i < 6; i++) {
          const a = i * Math.PI / 3;
          const px = Math.cos(a) * rx * 1.05, py = Math.sin(a) * ry * 1.05;
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.closePath();
        break;
      case 'diamond':
        g.moveTo(rx * 1.2, 0); g.lineTo(0, -ry); g.lineTo(-rx * 1.2, 0); g.lineTo(0, ry);
        g.closePath();
        break;
      default: // circle
        g.ellipse(0, 0, rx, ry, 0, 0, 7);
    }
  }
  drawEnemyBody(g: CanvasRenderingContext2D, e: Enemy, r: number, squash: number) {
    const spec = e.spec;
    const [color, color2] = this.palEnemy(spec.id);
    const shape = spec.shape || 'circle';
    const flap = Math.sin(e.wobble * 3);
    const flashed = e.flashT > 0 ? mixHex(color, '#ffffff', e.flashStrength) : color;
    g.save();
    g.rotate(e.angle);
    // wings for fliers — flapping, drawn under the body
    if (spec.flying) {
      g.fillStyle = color2;
      for (const side of [-1, 1]) {
        g.save();
        g.rotate(side * (0.35 + flap * 0.28));
        g.beginPath();
        if (shape === 'slim') { // swept raptor wings
          g.moveTo(r * 0.3, side * r * 0.3);
          g.lineTo(-r * 1.1, side * r * 1.5);
          g.lineTo(-r * 0.6, side * r * 0.4);
        } else { // rounded wisp wings
          g.ellipse(-r * 0.2, side * r * 1.05, r * 0.85, r * 0.5, side * 0.5, 0, 7);
        }
        g.closePath();
        g.fill();
        g.restore();
      }
    }
    if (shape === 'lumpy') {
      // gooey cluster of blobs
      const lobes = [[0, 0, 1], [-0.55, 0.4, 0.62], [0.5, 0.45, 0.55], [-0.1, -0.55, 0.58]];
      for (const pass of [0, 1]) {
        g.fillStyle = pass ? flashed : color2;
        const grow = pass ? 0 : 2;
        for (const [ox, oy, s] of lobes) {
          g.beginPath();
          g.arc(ox * r, oy * r, r * s * squash + grow, 0, 7);
          g.fill();
        }
      }
    } else {
      g.fillStyle = color2;
      this.shapePath(g, shape, (r + 2) * squash, (r + 2) / squash);
      g.fill();
      g.fillStyle = flashed;
      this.shapePath(g, shape, r * squash, r / squash);
      g.fill();
    }
    g.restore();
    // warm rim-light (Phase 3B.2): a thin arc on the upper-left of the body — the
    // brightest per-enemy accent, replacing the sheen's job of selling "warm and lit."
    if (!this.perfMode) {
      g.globalAlpha = 0.5;
      g.strokeStyle = this.pal().rim;
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(0, 0, r * 0.92, Math.PI * 1.05, Math.PI * 1.65); g.stroke();
      g.globalAlpha = 1;
    }
    // sheen
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.beginPath(); g.ellipse(-r * 0.25, -r * 0.28, r * 0.32, r * 0.22, -0.4, 0, 7); g.fill();
    // medic emblem
    if (spec.healAura) {
      g.fillStyle = '#2f6b3f';
      const cw = r * 0.62, ct = r * 0.24;
      (g as any).beginPath(); (g as any).roundRect(-cw / 2, -ct / 2, cw, ct, ct * 0.4); g.fill();
      (g as any).beginPath(); (g as any).roundRect(-ct / 2, -cw / 2, ct, cw, ct * 0.4); g.fill();
    }
  }

  // Meteor warning rings and ion-storm bands.
  drawModFx(g: CanvasRenderingContext2D) {
    if (this.meteorWarn) {
      const c = this.cells[this.meteorWarn.cell];
      const left = this.meteorWarn.at - this.now;
      const frac = 1 - clamp(left / TUNING.meteors.warning, 0, 1);
      const pulse = 0.6 + 0.4 * Math.sin(this.now * (6 + frac * 10));
      g.globalAlpha = 0.5 + frac * 0.4;
      g.strokeStyle = '#ff7d7d';
      g.lineWidth = 2.5 + frac * 2;
      g.beginPath(); g.arc(c.x, c.y, this.cell * (0.9 - frac * 0.3) * pulse, 0, 7); g.stroke();
      // crosshair
      g.globalAlpha = 0.85;
      g.lineWidth = 2;
      const r = 8;
      g.beginPath();
      g.moveTo(c.x - r, c.y); g.lineTo(c.x + r, c.y);
      g.moveTo(c.x, c.y - r); g.lineTo(c.x, c.y + r);
      g.stroke();
      g.globalAlpha = 1;
    }
    if (this.stormRow0 >= 0) {
      const S = TUNING.ionStorms;
      const y0 = this.gy0 + this.stormRow0 * this.cell;
      const h = S.bandRows * this.cell;
      const warning = this.now < this.stormWarnUntil;
      if (warning) {
        const blink = 0.5 + 0.5 * Math.sin(this.now * 7);
        g.globalAlpha = 0.08 + blink * 0.08;
        g.fillStyle = '#ffd97a';
        g.fillRect(0, y0, W, h);
        g.globalAlpha = 0.5;
        g.strokeStyle = '#ffd97a';
        g.setLineDash([10, 8]);
        g.strokeRect(-2, y0, W + 4, h);
        g.setLineDash([]);
      } else {
        g.globalAlpha = 0.13;
        g.fillStyle = '#8fb7ff';
        g.fillRect(0, y0, W, h);
        // drifting static streaks
        g.globalAlpha = 0.35;
        g.strokeStyle = '#c9dcff';
        g.lineWidth = 1.4;
        for (let k = 0; k < 7; k++) {
          const sx = ((this.now * (120 + k * 37) + k * 331) % (W + 80)) - 40;
          const sy = y0 + ((k * 61) % h);
          g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + 18 + (k % 3) * 8, sy + (k % 2 ? 3 : -3)); g.stroke();
        }
      }
      g.globalAlpha = 1;
    }
  }

  drawDrops(g: CanvasRenderingContext2D) {
    const D = TUNING.drops;
    for (const d of this.drops) {
      const age = this.now - d.born;
      // blink during the final 3 seconds before despawn
      if (D.lifetime - age < 3 && Math.floor(this.now * 6) % 2 === 0) continue;
      const bob = Math.sin(this.now * 2.4 + d.x) * 4;
      const y = d.y + bob;
      if (d.kind === 'fragment') {
        // glowing meteor shard
        const pulse2 = 1 + Math.sin(this.now * 4 + d.x) * 0.15;
        g.globalAlpha = 0.3;
        g.strokeStyle = '#ff9d76';
        g.lineWidth = 2;
        g.beginPath(); g.arc(d.x, y, 20 * pulse2, 0, 7); g.stroke();
        g.globalAlpha = 1;
        g.fillStyle = '#8d93b8';
        g.save(); g.translate(d.x, y); g.rotate(this.now * 0.8 + d.x);
        g.beginPath();
        g.moveTo(-9, 4); g.lineTo(-3, -9); g.lineTo(7, -5); g.lineTo(9, 6); g.lineTo(0, 10);
        g.closePath(); g.fill();
        g.fillStyle = '#ffb37d';
        g.beginPath(); g.arc(1, 0, 3.4, 0, 7); g.fill();
        g.restore();
        continue;
      }
      // soft attention ring
      const pulse = 1 + Math.sin(this.now * 3) * 0.12;
      g.globalAlpha = 0.28;
      g.strokeStyle = '#fff3b0';
      g.lineWidth = 2;
      g.beginPath(); g.arc(d.x, y, 24 * pulse, 0, 7); g.stroke();
      g.globalAlpha = 1;
      // parachute
      g.fillStyle = '#c5b3f6';
      g.beginPath();
      g.moveTo(d.x - 14, y - 16);
      g.quadraticCurveTo(d.x, y - 34, d.x + 14, y - 16);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(238,240,255,0.5)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(d.x - 12, y - 16); g.lineTo(d.x - 7, y - 4); g.moveTo(d.x + 12, y - 16); g.lineTo(d.x + 7, y - 4); g.stroke();
      // crate body
      this.shadow(g, d.x, y + 8, 16);
      g.fillStyle = '#fff3b0';
      (g as any).beginPath();
      (g as any).roundRect(d.x - 11, y - 5, 22, 18, 4);
      g.fill();
      g.fillStyle = '#ffb3c6';
      g.fillRect(d.x - 11, y + 1, 22, 4);
      g.strokeStyle = 'rgba(5,6,18,0.35)'; g.lineWidth = 1.4;
      (g as any).beginPath();
      (g as any).roundRect(d.x - 11, y - 5, 22, 18, 4);
      g.stroke();
    }
  }

  drawEnemy(g: CanvasRenderingContext2D, e: Enemy) {
    const spec = e.spec;
    const x = e.x, y = e.y;
    // Physical hit feedback (Phase 3B.5): the ambient wobble squash gets a brief extra
    // impulse right after a hit, and the body nudges 2px along the hit direction — both
    // pure render-space, never touching actual position/collision.
    const hitT = this.now < e.hitSquashUntil ? clamp((e.hitSquashUntil - this.now) / 0.12, 0, 1) : 0;
    const squash = (1 + Math.sin(e.wobble * 2) * 0.06) * (1 - 0.25 * hitT);
    const nudgeT = this.now < e.hitNudgeUntil ? clamp((e.hitNudgeUntil - this.now) / 0.08, 0, 1) : 0;
    g.save();
    g.translate(x + e.hitNudgeX * nudgeT, y + e.hitNudgeY * nudgeT);
    if (e.phased) g.globalAlpha = 0.3;

    const r = spec.size;
    if (e.bossPhase === 2 && spec.id === 'leviathan') {
      // rotating 240° barrier: the drawn arc is the SHIELDED span; the gap faces e.arcA
      const gapHalf = Math.PI / 3;
      const pulse2 = 0.75 + 0.25 * Math.sin(this.now * 5);
      g.strokeStyle = '#9fd0ff';
      g.lineWidth = 5;
      g.globalAlpha = 0.75 * pulse2 * (e.shield > 0 ? 1 : 0.25);
      g.beginPath();
      g.arc(0, 0, r + 13, e.arcA + gapHalf, e.arcA - gapHalf + Math.PI * 2);
      g.stroke();
      g.globalAlpha = 0.28;
      g.lineWidth = 11;
      g.beginPath();
      g.arc(0, 0, r + 13, e.arcA + gapHalf, e.arcA - gapHalf + Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    if (e.isElite) {
      // pulsing gold aura ring + floating crown
      const pulse = 1 + Math.sin(this.now * 5 + e.wobble) * 0.1;
      g.globalAlpha = (e.phased ? 0.2 : 0.75);
      g.strokeStyle = '#ffd97a';
      g.lineWidth = 2.6;
      g.beginPath(); g.arc(0, 0, (r + 7) * pulse, 0, 7); g.stroke();
      g.globalAlpha = (e.phased ? 0.3 : 1);
      g.fillStyle = '#ffd97a';
      const cy = -r - 12 + Math.sin(this.now * 3 + e.wobble) * 2;
      g.beginPath();
      g.moveTo(-6, cy + 4); g.lineTo(-6, cy - 2); g.lineTo(-3, cy + 1); g.lineTo(0, cy - 4);
      g.lineTo(3, cy + 1); g.lineTo(6, cy - 2); g.lineTo(6, cy + 4);
      g.closePath(); g.fill();
      g.globalAlpha = e.phased ? 0.3 : 1;
    }
    this.drawEnemyBody(g, e, r, squash);

    if (spec.healAura) {
      // Mender presence pulse (Phase 7.2.2) — the visual twin to the audio mender loop: a
      // slow ~1Hz pulsing ring so a mender reads at a glance even with alert cues muted.
      const pulse = 0.5 + 0.5 * Math.sin(this.now * Math.PI * 2);
      g.globalAlpha = 0.25 + 0.35 * pulse;
      g.strokeStyle = '#c0f5b3';
      g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, r + 10 + pulse * 4, 0, 7); g.stroke();
      g.globalAlpha = 1;
    }

    if (spec.boss) {
      g.fillStyle = this.palEnemy(spec.id)[1];
      for (let i = 0; i < 7; i++) {
        const a = e.angle + Math.PI + (i - 3) * 0.42;
        g.beginPath();
        g.moveTo(Math.cos(a - 0.14) * r * 0.85, Math.sin(a - 0.14) * r * 0.85);
        g.lineTo(Math.cos(a) * (r * 1.35 + (i === 3 ? 5 : 0)), Math.sin(a) * (r * 1.35 + (i === 3 ? 5 : 0)));
        g.lineTo(Math.cos(a + 0.14) * r * 0.85, Math.sin(a + 0.14) * r * 0.85);
        g.fill();
      }
    }

    const n = spec.eyes || 1;
    const lx = Math.cos(e.angle), ly = Math.sin(e.angle);
    const pxv = -ly, pyv = lx;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * r * 0.5;
      const ex = lx * r * 0.32 + pxv * off, ey = ly * r * 0.32 + pyv * off;
      const er = clamp(r * 0.26, 2.6, 7);
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(ex, ey, er, 0, 7); g.fill();
      g.fillStyle = '#20223c';
      g.beginPath(); g.arc(ex + lx * 2.2, ey + ly * 2.2, er * 0.5, 0, 7); g.fill();
    }

    if (this.now < e.frozenUntil) {
      g.fillStyle = 'rgba(200,236,255,0.5)';
      g.beginPath(); g.arc(0, 0, r * 1.02, 0, 7); g.fill();
      g.strokeStyle = '#e8f7ff'; g.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + 0.5;
        g.beginPath(); g.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
        g.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95); g.stroke();
      }
    } else if (this.now < e.slowUntil) {
      g.strokeStyle = 'rgba(160,216,239,0.8)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, r + 4, this.now * 3, this.now * 3 + 4); g.stroke();
    }

    if (e.shield > 0) {
      g.globalAlpha = (e.phased ? 0.3 : 1) * (0.35 + 0.45 * (e.shield / e.maxShield));
      g.strokeStyle = '#bfe3ff';
      g.fillStyle = 'rgba(159,208,255,0.14)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, r + 7, 0, 7); g.fill(); g.stroke();
      g.globalAlpha = e.phased ? 0.3 : 1;
    }
    g.restore();

    if (e.hp < e.maxHp || spec.boss) {
      const w = spec.boss ? 66 : clamp(r * 2.4, 22, 44);
      const bx = x - w / 2, by = y - r - 14;
      g.fillStyle = 'rgba(6,7,18,0.65)';
      (g as any).beginPath(); (g as any).roundRect(bx - 1, by - 1, w + 2, 6, 3); g.fill();
      g.fillStyle = spec.boss ? '#ff8fa3' : '#a8e6cf';
      const frac = clamp(e.hp / e.maxHp, 0, 1);
      (g as any).beginPath(); (g as any).roundRect(bx, by, w * frac, 4, 2); g.fill();
      if (e.maxShield > 0) {
        g.fillStyle = '#9fd0ff';
        (g as any).beginPath(); (g as any).roundRect(bx, by - 4, w * clamp(e.shield / e.maxShield, 0, 1), 2.6, 1.3); g.fill();
      }
    }
  }

  drawTower(g: CanvasRenderingContext2D, t: Tower, ghost = false, part: 'all' | 'pad' | 'body' = 'all') {
    const [c, c2] = this.palTower(t.spec.id);
    const disabled = this.now < t.disabledUntil;
    // Idle & uncovered feedback (Phase 3B.4). Uncovered is the hard warning (ground-only,
    // zero path coverage — it can never do anything); idle is the soft one (has coverage,
    // just nothing to shoot at right now). Mutually exclusive with disabled/ghost, and with
    // each other — uncovered wins since it's the more actionable problem.
    const uncovered = !ghost && !disabled && !!t.raw.groundOnly && t.pathCellsInRange === 0;
    const idle = !ghost && !disabled && !uncovered && t.noTargetSince >= 0 && this.now - t.noTargetSince > 1.5;
    g.save();
    g.translate(t.x, t.y);
    g.scale(this.k, this.k);
    if (disabled || ghost) g.globalAlpha = ghost ? 0.6 : 0.55;
    else if (uncovered) g.globalAlpha = 0.45;
    else if (idle) g.globalAlpha = 0.75;

    if (part !== 'body') {
      // square pad matching the tile — lavender-tinted when amplified
      const amped = t.buffed && !ghost;
      g.fillStyle = amped ? '#2e2a52' : '#20233f';
      (g as any).beginPath(); (g as any).roundRect(-20, -20, 40, 40, 8); g.fill();
      g.fillStyle = amped ? '#3d3670' : '#2b2e52';
      (g as any).beginPath(); (g as any).roundRect(-17, -17, 34, 34, 7); g.fill();
      if (amped) {
        g.strokeStyle = 'rgba(197,179,246,0.55)';
        g.lineWidth = 1.6;
        (g as any).beginPath(); (g as any).roundRect(-18.5, -18.5, 37, 37, 7.5); g.stroke();
      }
      if (part === 'pad') { g.restore(); return; }
    }

    const tier = t.branch >= 0 ? 3 + t.branchStage : t.stage;
    const rec = t.recoil * 5;
    const dx = Math.cos(t.angle), dy = Math.sin(t.angle);
    const pxv = -dy, pyv = dx;

    // body shadow cast on the pad — follows the tower's rotation
    if (!ghost) {
      g.save();
      g.translate(2.4, 3.2);
      g.fillStyle = 'rgba(4,5,14,0.30)';
      g.beginPath(); g.arc(0, 0, 10.5, 0, 7); g.fill();
      if (t.spec.kind !== 'amp' && t.spec.kind !== 'cryo' && t.spec.kind !== 'tesla') {
        g.strokeStyle = 'rgba(4,5,14,0.30)';
        g.lineWidth = 7; g.lineCap = 'round';
        g.beginPath();
        g.moveTo(dx * 4, dy * 4);
        g.lineTo(dx * (t.spec.kind === 'prism' ? 11 : 14), dy * (t.spec.kind === 'prism' ? 11 : 14));
        g.stroke();
      }
      g.restore();
    }

    switch (t.spec.kind) {
      case 'bullet': {
        const long = t.spec.id === 'sentinel';
        g.fillStyle = c2;
        g.beginPath(); g.arc(0, 0, 12, 0, 7); g.fill();
        const barrels = t.spec.id === 'pulse' && t.branch === 0 ? (t.branchStage ? 3 : 2)
          : (long && t.branch === 1 ? 2 : 1); // Rapid Sentinel: twin barrels
        const len = long ? 27 : (t.branch === 1 && t.spec.id === 'pulse' ? 25 : 17);
        g.strokeStyle = c2;
        g.lineWidth = long ? (t.branch === 1 ? 3 : 4.5) : (t.branch === 1 ? 7 : 5);
        g.lineCap = 'round';
        for (let i = 0; i < barrels; i++) {
          const off = (i - (barrels - 1) / 2) * (long ? 5 : 6);
          g.beginPath();
          g.moveTo(pxv * off + dx * (4 - rec), pyv * off + dy * (4 - rec));
          g.lineTo(pxv * off + dx * (len - rec), pyv * off + dy * (len - rec));
          g.stroke();
        }
        if (long && t.branch === 0) { // Farsight: scope ring mid-barrel
          g.strokeStyle = c; g.lineWidth = 2.2;
          g.beginPath(); g.arc(dx * (16 - rec), dy * (16 - rec), 4.4, 0, 7); g.stroke();
        }
        if (t.branch === 2) { // Frost Rounds / Warden: icy blue muzzle tip
          g.fillStyle = '#a0d8ef';
          g.beginPath(); g.arc(dx * (len - rec), dy * (len - rec), long ? 3.4 : 4, 0, 7); g.fill();
          if (long) { // Warden fin
            g.strokeStyle = '#a0d8ef'; g.lineWidth = 3; g.lineCap = 'round';
            g.beginPath();
            g.moveTo(dx * 8 + pxv * 5, dy * 8 + pyv * 5);
            g.lineTo(dx * 8 + pxv * 11, dy * 8 + pyv * 11);
            g.stroke();
          }
        }
        g.fillStyle = c;
        g.beginPath(); g.arc(0, 0, 9.4, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.45)';
        g.beginPath(); g.arc(-2.6, -3, 3, 0, 7); g.fill();
        break;
      }
      case 'mortar': {
        g.fillStyle = c2;
        g.beginPath(); g.arc(0, 0, 13.5, 0, 7); g.fill();
        g.fillStyle = c;
        g.beginPath(); g.arc(0, 0, 11.5, 0, 7); g.fill();
        if (t.branch === 1) { // Magma: molten core glow
          g.strokeStyle = '#ff8a5c';
          g.globalAlpha *= 0.5 + 0.3 * Math.sin(t.auraPulse * 4);
          g.lineWidth = 2.4;
          g.beginPath(); g.arc(0, 0, 12.6, 0, 7); g.stroke();
          g.globalAlpha = disabled || ghost ? 0.55 : 1;
        }
        if (t.branch === 2) { // Quake: heavy square muzzle + shock ring
          g.strokeStyle = c2; g.lineWidth = 2;
          g.globalAlpha *= 0.55;
          g.beginPath(); g.arc(0, 0, 14.5 + Math.sin(t.auraPulse * 3) * 1.2, 0, 7); g.stroke();
          g.globalAlpha = disabled || ghost ? 0.55 : 1;
          const qx = dx * (3 - rec), qy = dy * (3 - rec);
          g.save(); g.translate(qx, qy); g.rotate(t.angle);
          g.fillStyle = c2;
          (g as any).beginPath(); (g as any).roundRect(-6, -6, 12, 12, 2.5); g.fill();
          g.fillStyle = '#20223c';
          (g as any).beginPath(); (g as any).roundRect(-3.4, -3.4, 6.8, 6.8, 1.6); g.fill();
          g.restore();
          g.fillStyle = 'rgba(255,255,255,0.35)';
          g.beginPath(); g.arc(-4, -4.5, 2.6, 0, 7); g.fill();
          break;
        }
        if (t.branch === 0) { // Cluster: three small muzzles
          g.fillStyle = c2;
          for (let i = 0; i < 3; i++) {
            const a = t.angle + (i - 1) * 0.8;
            const ox = Math.cos(a) * 5 - dx * rec, oy = Math.sin(a) * 5 - dy * rec;
            g.beginPath(); g.arc(ox, oy, 4, 0, 7); g.fill();
            g.fillStyle = '#20223c';
            g.beginPath(); g.arc(ox, oy, 2.2, 0, 7); g.fill();
            g.fillStyle = c2;
          }
          g.fillStyle = 'rgba(255,255,255,0.35)';
          g.beginPath(); g.arc(-4, -4.5, 2.6, 0, 7); g.fill();
          break;
        }
        const mx = dx * (4 - rec), my = dy * (4 - rec);
        g.fillStyle = c2;
        g.beginPath(); g.arc(mx, my, 7.4, 0, 7); g.fill();
        g.fillStyle = '#20223c';
        g.beginPath(); g.arc(mx, my, 4.6, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath(); g.arc(-4, -4.5, 2.6, 0, 7); g.fill();
        break;
      }
      case 'cryo': {
        const spin = t.auraPulse * (t.raw.aura ? 0.9 : 0.4);
        g.save();
        g.rotate(spin);
        g.strokeStyle = c2; g.lineWidth = 4; g.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI / 3;
          g.beginPath();
          g.moveTo(Math.cos(a) * -12, Math.sin(a) * -12);
          g.lineTo(Math.cos(a) * 12, Math.sin(a) * 12);
          g.stroke();
        }
        g.strokeStyle = c; g.lineWidth = 2.4;
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI / 3;
          g.beginPath();
          g.moveTo(Math.cos(a) * -11, Math.sin(a) * -11);
          g.lineTo(Math.cos(a) * 11, Math.sin(a) * 11);
          g.stroke();
        }
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(0, 0, 3.4, 0, 7); g.fill();
        if (t.branch === 2) { // Cryo Lance: long ice spike toward the target
          g.save(); g.rotate(t.angle - spin); // counter the body spin
          g.fillStyle = '#e8f7ff';
          g.beginPath(); g.moveTo(19 - rec, 0); g.lineTo(6, -3.4); g.lineTo(6, 3.4); g.closePath(); g.fill();
          g.restore();
        }
        if (t.branch === 0) { // Flash Freeze: bright crystal tips
          g.fillStyle = '#ffffff';
          for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            g.save(); g.translate(Math.cos(a) * 12, Math.sin(a) * 12); g.rotate(a);
            g.beginPath(); g.moveTo(3.4, 0); g.lineTo(0, -2.2); g.lineTo(-3.4, 0); g.lineTo(0, 2.2); g.closePath(); g.fill();
            g.restore();
          }
        }
        g.restore();
        break;
      }
      case 'missile': {
        g.save();
        g.rotate(t.angle + Math.PI / 2);
        g.fillStyle = c2;
        (g as any).beginPath(); (g as any).roundRect(-12, -12 + rec, 24, 24, 6); g.fill();
        g.fillStyle = c;
        (g as any).beginPath(); (g as any).roundRect(-10, -10 + rec, 20, 20, 5); g.fill();
        g.fillStyle = c2;
        if (t.branch === 2) { // Interceptor: twin slim AA rails
          g.fillStyle = '#a0d8ef';
          for (const side of [-1, 1]) {
            (g as any).beginPath(); (g as any).roundRect(side * 5 - 1.7, -14 + rec, 3.4, 20, 1.7); g.fill();
          }
          g.fillStyle = c2;
          g.beginPath(); g.arc(0, 2 + rec, 3.6, 0, 7); g.fill();
          g.restore();
          break;
        }
        const tubes = t.branch === 0 ? (t.branchStage ? 8 : 5) : t.branch === 1 ? 1 : 3;
        if (tubes === 1) {
          g.beginPath(); g.arc(0, rec, 6, 0, 7); g.fill();
          g.fillStyle = '#20223c'; g.beginPath(); g.arc(0, rec, 3.4, 0, 7); g.fill();
        } else {
          for (let i = 0; i < tubes; i++) {
            const col = i % 3, row = Math.floor(i / 3);
            g.beginPath(); g.arc(-5.4 + col * 5.4, -5.4 + row * 5.4 + rec, 2.2, 0, 7); g.fill();
          }
        }
        g.restore();
        break;
      }
      case 'tesla': {
        g.fillStyle = c2;
        g.beginPath(); g.arc(0, 0, 11, 0, 7); g.fill();
        const electrodes = t.branch === 0 ? 5 : t.branch === 2 ? 4 : 3; // Arc Web: more electrodes
        for (let i = 0; i < electrodes; i++) {
          // Ion Field: electrodes sit still; others orbit
          const a = (t.branch === 2 ? Math.PI / 4 : t.auraPulse * 2) + i * (Math.PI * 2 / electrodes);
          g.fillStyle = c2;
          g.beginPath(); g.arc(Math.cos(a) * 13, Math.sin(a) * 13, 3, 0, 7); g.fill();
        }
        if (t.branch === 2) { // Ion Field: static halo ring
          g.strokeStyle = c; g.lineWidth = 1.8; g.globalAlpha *= 0.7;
          g.beginPath(); g.arc(0, 0, 15.5, 0, 7); g.stroke();
          g.globalAlpha = disabled || ghost ? 0.55 : 1;
        }
        g.fillStyle = c;
        g.beginPath(); g.arc(0, 0, t.branch === 1 ? 10 : 8, 0, 7); g.fill(); // Overload: fat orb
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(-2, -2.4, 2.6, 0, 7); g.fill();
        if (Math.random() < 0.06 && !ghost && !idle) this.spark(t.x + rand(-8, 8) * this.k, t.y + rand(-8, 8) * this.k, c, 1);
        break;
      }
      case 'amp': {
        g.save();
        g.rotate(Math.PI / 4 + Math.sin(t.auraPulse * 1.2) * 0.15);
        g.fillStyle = c2;
        (g as any).beginPath(); (g as any).roundRect(-10, -10, 20, 20, 4); g.fill();
        g.fillStyle = c;
        (g as any).beginPath(); (g as any).roundRect(-7.4, -7.4, 14.8, 14.8, 3); g.fill();
        g.restore();
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(0, 0, 3, 0, 7); g.fill();
        g.strokeStyle = c; g.lineWidth = 2;
        g.setLineDash([5, 6]);
        g.beginPath(); g.arc(0, 0, 15.5, 0, 7); g.stroke();
        if (t.branch === 0) { // Overclock: second inner ring
          g.beginPath(); g.arc(0, 0, 12, 0, 7); g.stroke();
        }
        g.setLineDash([]);
        if (t.branch === 1) { // Targeting Array: crosshair ticks
          g.lineWidth = 2.4;
          for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2;
            g.beginPath();
            g.moveTo(Math.cos(a) * 14, Math.sin(a) * 14);
            g.lineTo(Math.cos(a) * 19, Math.sin(a) * 19);
            g.stroke();
          }
        }
        if (t.branch === 2) { // Beacon: antenna mast with blinking light
          g.strokeStyle = c2; g.lineWidth = 2.6; g.lineCap = 'round';
          g.beginPath(); g.moveTo(0, -8); g.lineTo(0, -18); g.stroke();
          g.fillStyle = Math.sin(this.now * 5) > 0 ? '#ffffff' : c;
          g.beginPath(); g.arc(0, -19.5, 2.6, 0, 7); g.fill();
        }
        break;
      }
      case 'prism': {
        // gem points along its firing direction; branch shapes differ
        g.save();
        g.rotate(t.angle);
        if (t.branch === 2) { // Overdrive Lens: trailing booster gems
          g.fillStyle = c2;
          for (const off of [12, 18]) {
            g.save(); g.translate(-off, 0);
            g.beginPath(); g.moveTo(4, 0); g.lineTo(0, -3.2); g.lineTo(-4, 0); g.lineTo(0, 3.2); g.closePath(); g.fill();
            g.restore();
          }
        }
        if (t.branch === 1) { // Split Prism: two small side gems
          g.fillStyle = c2;
          for (const side of [-1, 1]) {
            g.save(); g.translate(-6, side * 9);
            g.beginPath(); g.moveTo(5, 0); g.lineTo(0, -4); g.lineTo(-5, 0); g.lineTo(0, 4); g.closePath(); g.fill();
            g.restore();
          }
        }
        const ex = t.branch === 0 ? 1.35 : 1; // Focus Prism: elongated lens
        g.fillStyle = c2;
        g.beginPath(); g.moveTo(13 * ex, 0); g.lineTo(0, -11); g.lineTo(-13 * ex * 0.8, 0); g.lineTo(0, 11); g.closePath(); g.fill();
        g.fillStyle = c;
        g.beginPath(); g.moveTo(10 * ex, 0); g.lineTo(0, -8); g.lineTo(-10 * ex * 0.8, 0); g.lineTo(0, 8); g.closePath(); g.fill();
        g.fillStyle = '#ffffff88';
        g.beginPath(); g.moveTo(6 * ex, 0); g.lineTo(0, -3.4); g.lineTo(-6 * ex * 0.8, 0); g.lineTo(0, 3.4); g.closePath(); g.fill();
        g.restore();
        break;
      }
      case 'ray': {
        g.fillStyle = c2;
        g.beginPath(); g.arc(0, 0, 10.5, 0, 7); g.fill();
        g.save();
        g.rotate(t.angle);
        const wide = t.branch === 1 ? 3 : 0; // Annihilator: broader housing
        const slim = t.branch === 2; // Lancet: extra-long thin barrel
        const bl = slim ? 32 : 24, bh = slim ? 6.5 : 10;
        g.fillStyle = c2;
        (g as any).beginPath(); (g as any).roundRect(-6 - rec, -bh / 2 - wide, bl, bh + wide * 2, 3.4); g.fill();
        g.fillStyle = c;
        (g as any).beginPath(); (g as any).roundRect(-4.5 - rec, -bh / 2 + 1.4 - wide, bl - 4, bh - 2.8 + wide * 2, 2.6); g.fill();
        g.fillStyle = '#ffffff';
        if (t.branch === 0) { // Strobe: twin lenses
          g.beginPath(); g.arc(17 - rec, -3, 2.2 + t.recoil * 1.2, 0, 7); g.fill();
          g.beginPath(); g.arc(17 - rec, 3, 2.2 + t.recoil * 1.2, 0, 7); g.fill();
        } else {
          g.beginPath(); g.arc((slim ? 24 : 17) - rec, 0, (slim ? 2.2 : 2.8) + wide * 0.5 + t.recoil * 1.6, 0, 7); g.fill();
        }
        g.restore();
        g.fillStyle = c;
        g.beginPath(); g.arc(0, 0, 6.4, 0, 7); g.fill();
        break;
      }
      case 'flame': {
        g.fillStyle = c2;
        g.beginPath(); g.arc(0, 0, 12, 0, 7); g.fill();
        g.fillStyle = t.branch === 0 ? '#ff8a5c' : t.branch === 2 ? '#8fc9ef' : c; // Inferno red / Blue Flame
        g.beginPath(); g.arc(0, 0, 9.4, 0, 7); g.fill();
        g.save();
        g.rotate(t.angle);
        const nozzle = t.branch === 1 ? 22 : 17; // Flarethrower: longer nozzle
        g.fillStyle = c2;
        g.beginPath();
        g.moveTo(6 - rec, -5.4);
        g.lineTo(nozzle - rec, -8);
        g.lineTo(nozzle - rec, 8);
        g.lineTo(6 - rec, 5.4);
        g.closePath(); g.fill();
        g.restore();
        g.fillStyle = t.branch === 2 ? '#ffffff' : '#ffd9a0';
        g.beginPath(); g.arc(0, 0, 2.6 + Math.sin(t.auraPulse * 9) * 1, 0, 7); g.fill();
        break;
      }
    }

    // upgrade stars — inside the pad so they never overlap neighbours (4 max)
    if (tier > 0) {
      for (let i = 0; i < tier; i++) {
        this.starPip(g, (i - (tier - 1) / 2) * 7.6, 13.5, 2.9);
      }
    }
    if (disabled && !ghost) {
      g.globalAlpha = 1;
      g.fillStyle = '#ffb3c6';
      g.font = '700 13px Nunito';
      g.textAlign = 'center';
      g.fillText('⚡ EMP', 0, -28 + Math.sin(this.now * 8) * 2);
    }
    if (uncovered) {
      // hard-warning glyph — a groundOnly tower with zero road coverage can never fire.
      g.globalAlpha = 0.9;
      g.fillStyle = '#9aa0c8';
      g.font = '700 11px Nunito';
      g.textAlign = 'center';
      g.fillText('zᶻ', 15, -13 + Math.sin(this.now * 2) * 1.5);
    }
    if (!ghost && isUnlocked('veterancy') && t.kills >= TUNING.veterancy.kills) {
      // Veterancy (Phase 4.6): a gold chevron marks an eligible tower — pulsing while the
      // perk choice is still open, steady once chosen (mirrors the uncovered zᶻ glyph's spot).
      g.globalAlpha = t.perk ? 0.95 : (this.reduceFlash ? 0.7 : 0.55 + 0.45 * Math.sin(this.now * 4));
      g.fillStyle = '#ffd97a';
      g.font = '700 11px Nunito';
      g.textAlign = 'center';
      g.fillText('🎖', -15, -13);
      g.globalAlpha = 1;
    }
    if (!ghost && this.now < t.overchargedUntil) {
      // Overcharge (Phase 4.5): a depleting ring around the pad + a brightened, crackling
      // muzzle — reduceFlash caps the brightness pop.
      const frac = clamp((t.overchargedUntil - this.now) / TUNING.overcharge.dur, 0, 1);
      g.globalAlpha = this.reduceFlash ? 0.5 : 0.85;
      g.strokeStyle = '#fff3b0';
      g.lineWidth = 2.4;
      g.beginPath(); g.arc(0, 0, 19, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); g.stroke();
      g.globalAlpha = (this.reduceFlash ? 0.22 : 0.35) + (this.reduceFlash ? 0 : 0.15 * Math.sin(this.now * 20));
      g.fillStyle = '#fff3b0';
      g.beginPath(); g.arc(0, 0, 13, 0, 7); g.fill();
      g.globalAlpha = 1;
      if (Math.random() < 0.15 && !this.reduceMotion) this.spark(t.x + rand(-10, 10) * this.k, t.y + rand(-10, 10) * this.k, '#fff3b0', 1);
    }
    g.restore();

    // aura pulse squares (grid-consistent) — cryo fields only; amps stay still. Idle towers
    // (Phase 3B.4) skip the pulse: for an aura, "idle" means nothing's actually in range.
    if (!ghost && t.raw.aura && !idle) {
      const R = t.rangeT();
      const prog = (t.auraPulse * 0.5) % 1;
      const rad = (R + 0.5) * this.cell * (0.3 + 0.7 * prog);
      g.globalAlpha = (disabled ? 0.4 : 1) * (0.28 * (1 - prog) + 0.05);
      g.strokeStyle = this.palTower(t.spec.id)[0];
      g.lineWidth = 2;
      g.beginPath(); g.arc(t.x, t.y, rad, 0, 7); g.stroke();
      g.globalAlpha = 1;
    }
  }
  starPip(g: CanvasRenderingContext2D, x: number, y: number, size = 4) {
    g.save(); g.translate(x, y);
    g.fillStyle = '#fff3b0';
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * (Math.PI * 2 / 5);
      const a2 = a + Math.PI / 5;
      g.lineTo(Math.cos(a) * size, Math.sin(a) * size);
      g.lineTo(Math.cos(a2) * size * 0.45, Math.sin(a2) * size * 0.45);
    }
    g.closePath(); g.fill();
    g.restore();
  }

  drawBeams(g: CanvasRenderingContext2D) {
    for (const t of this.towers) {
      if (t.spec.kind !== 'prism' || !t.beamTargets.length) continue;
      const s: any = t.stats(this);
      const mult = 1 + ((s.rampMax || 3) - 1) * clamp(t.rampT / (s.rampTime || 3), 0, 1);
      const w = 1.5 + mult * 1.1;
      for (const e of t.beamTargets) {
        g.strokeStyle = this.palTower(t.spec.id)[0];
        g.globalAlpha = 0.35;
        g.lineWidth = w * 2.6;
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(t.x, t.y); g.lineTo(e.x, e.y); g.stroke();
        g.globalAlpha = 0.95;
        g.strokeStyle = '#ffffff';
        g.lineWidth = w;
        g.beginPath(); g.moveTo(t.x, t.y); g.lineTo(e.x, e.y); g.stroke();
        g.globalAlpha = 1;
        g.fillStyle = this.palTower(t.spec.id)[0];
        g.globalAlpha = 0.6;
        g.beginPath(); g.arc(e.x, e.y, w * 1.8 + Math.sin(this.now * 20) * 1.2, 0, 7); g.fill();
        g.globalAlpha = 1;
      }
    }
  }

  drawProjs(g: CanvasRenderingContext2D) {
    for (const p of this.projs) {
      if (p.kind === 'bullet') {
        g.lineCap = 'round';
        for (let i = 1; i < p.trail.length; i++) {
          g.globalAlpha = (i / p.trail.length) * 0.4;
          g.strokeStyle = p.color;
          g.lineWidth = p.w * (i / p.trail.length);
          g.beginPath(); g.moveTo(p.trail[i - 1][0], p.trail[i - 1][1]); g.lineTo(p.trail[i][0], p.trail[i][1]); g.stroke();
        }
        g.globalAlpha = 1;
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(p.x, p.y, p.w, 0, 7); g.fill();
        g.fillStyle = p.color;
        g.beginPath(); g.arc(p.x, p.y, p.w * 0.6, 0, 7); g.fill();
      } else if (p.kind === 'missile') {
        for (let i = 1; i < p.trail.length; i++) {
          g.globalAlpha = (i / p.trail.length) * 0.35;
          g.strokeStyle = '#ffffff';
          g.lineWidth = 2.4 * (i / p.trail.length);
          g.beginPath(); g.moveTo(p.trail[i - 1][0], p.trail[i - 1][1]); g.lineTo(p.trail[i][0], p.trail[i][1]); g.stroke();
        }
        g.globalAlpha = 1;
        const a = Math.atan2(p.vy, p.vx);
        g.save(); g.translate(p.x, p.y); g.rotate(a);
        g.fillStyle = p.color;
        (g as any).beginPath(); (g as any).roundRect(-7, -3, 14, 6, 3); g.fill();
        g.fillStyle = '#ffffff';
        g.beginPath(); g.moveTo(7, -3); g.lineTo(11, 0); g.lineTo(7, 3); g.fill();
        g.fillStyle = '#ffd3b6';
        g.beginPath(); g.arc(-8, 0, 2.4 + Math.random() * 1.4, 0, 7); g.fill();
        g.restore();
      } else {
        const tt = clamp(p.t / p.T, 0, 1);
        const x = lerp(p.x0, p.x1, tt), y = lerp(p.y0, p.y1, tt);
        const h = Math.sin(tt * Math.PI);
        const scale = 1 + h * 0.9;
        this.shadow(g, x, y, (p.mini ? 3 : 5) * (1.3 - h * 0.5), 0.28);
        const rr = (p.mini ? 3.4 : 6) * scale;
        g.fillStyle = p.color;
        g.beginPath(); g.arc(x - h * 4, y - h * 6, rr, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.beginPath(); g.arc(x - h * 4 - rr * 0.28, y - h * 6 - rr * 0.28, rr * 0.34, 0, 7); g.fill();
      }
    }
  }

  drawBolts(g: CanvasRenderingContext2D) {
    for (const b of this.bolts) {
      g.globalAlpha = clamp(b.life / 0.14, 0, 1);
      g.strokeStyle = b.color;
      g.lineWidth = 3.4;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(b.pts[0][0], b.pts[0][1]);
      for (let i = 1; i < b.pts.length; i++) g.lineTo(b.pts[i][0], b.pts[i][1]);
      g.stroke();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.4;
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  drawRays(g: CanvasRenderingContext2D) {
    for (const r of this.rays) {
      const lf = clamp(r.life / r.max, 0, 1);
      g.lineCap = 'round';
      g.globalAlpha = lf * 0.45;
      g.strokeStyle = r.color;
      g.lineWidth = r.w * 2 * lf + 2;
      g.beginPath(); g.moveTo(r.x0, r.y0); g.lineTo(r.x1, r.y1); g.stroke();
      g.globalAlpha = lf;
      g.strokeStyle = '#ffffff';
      g.lineWidth = Math.max(1.4, r.w * 0.5 * lf);
      g.beginPath(); g.moveTo(r.x0, r.y0); g.lineTo(r.x1, r.y1); g.stroke();
      g.globalAlpha = 1;
    }
  }

  drawIncomings(g: CanvasRenderingContext2D) {
    for (const inc of this.incomings) {
      const p = 1 - inc.t / 0.7;
      g.strokeStyle = '#ffd3b6';
      g.lineWidth = 2.4;
      g.setLineDash([6, 6]);
      g.globalAlpha = 0.85;
      const r = ABILITIES.orbital.radius * (1.3 - p * 0.3);
      g.beginPath(); g.arc(inc.x, inc.y, r, 0, 7); g.stroke();
      g.setLineDash([]);
      g.strokeStyle = '#fff3b0';
      g.lineWidth = 3;
      const cr = r * (1 - p) + 10;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + this.now * 2;
        g.beginPath();
        g.moveTo(inc.x + Math.cos(a) * cr, inc.y + Math.sin(a) * cr);
        g.lineTo(inc.x + Math.cos(a) * (cr + 12), inc.y + Math.sin(a) * (cr + 12));
        g.stroke();
      }
      g.globalAlpha = 1;
    }
  }

  drawParticles(g: CanvasRenderingContext2D) {
    for (const p of this.parts) {
      const lf = clamp(p.life / p.max, 0, 1);
      switch (p.kind) {
        case 'dot': case 'spark':
          g.globalAlpha = lf;
          g.fillStyle = p.color;
          g.beginPath(); g.arc(p.x, p.y, p.size * (p.kind === 'spark' ? lf : 1), 0, 7); g.fill();
          break;
        case 'fire':
          g.globalAlpha = lf * 0.9;
          g.fillStyle = p.color;
          g.beginPath(); g.arc(p.x, p.y, p.size * (0.6 + lf * 0.6), 0, 7); g.fill();
          break;
        case 'shard':
          g.globalAlpha = lf;
          g.fillStyle = p.color;
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot || 0);
          g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
          g.restore();
          break;
        case 'smoke':
          g.globalAlpha = lf * 0.5;
          g.fillStyle = p.color;
          g.beginPath(); g.arc(p.x, p.y, p.size * (1.6 - lf * 0.6), 0, 7); g.fill();
          break;
        case 'ring': {
          g.globalAlpha = lf;
          g.strokeStyle = p.color;
          g.lineWidth = 3 * lf + 1;
          const r = p.size * (1.25 - lf * 0.25);
          g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.stroke();
          break;
        }
        case 'shock': {
          const r = p.size * (1 - lf);
          g.globalAlpha = lf * 0.9;
          g.strokeStyle = p.color;
          g.lineWidth = 6 * lf + 1;
          g.beginPath(); g.arc(p.x, p.y, Math.max(2, r), 0, 7); g.stroke();
          break;
        }
        case 'flash':
          g.globalAlpha = lf * 0.9;
          g.fillStyle = p.color;
          g.beginPath(); g.arc(p.x, p.y, p.size * (1.4 - lf * 0.4), 0, 7); g.fill();
          break;
        case 'text':
          g.globalAlpha = Math.min(1, lf * 2);
          g.fillStyle = p.color;
          g.font = `800 ${p.size}px Nunito`;
          g.textAlign = 'center';
          g.strokeStyle = 'rgba(6,7,18,0.8)';
          g.lineWidth = 3.4;
          g.strokeText(p.text!, p.x, p.y);
          g.fillText(p.text!, p.x, p.y);
          break;
      }
    }
    g.globalAlpha = 1;
  }

  drawFocus(g: CanvasRenderingContext2D) {
    const e = this.focus;
    if (!e || e.dead) return;
    const r = e.spec.size + 10;
    g.save();
    g.translate(e.x, e.y);
    g.rotate(this.now * 2.4);
    g.strokeStyle = '#ff8fa3';
    g.lineWidth = 2.6;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      g.beginPath();
      g.arc(0, 0, r, a - 0.4, a + 0.4);
      g.stroke();
    }
    g.restore();
  }

  drawSelection(g: CanvasRenderingContext2D) {
    // touch long-press range peek — a lighter-weight preview, no pulse, doesn't require
    // opening the tower panel. Skipped if this tower is already the real selection below.
    if (this.peekTower && this.peekTower !== this.selected && this.towers.includes(this.peekTower)) {
      const pt = this.peekTower;
      this.drawRangeTiles(g, pt.col, pt.row, pt.rangeT(), this.palTower(pt.spec.id)[0], 0.14);
      g.strokeStyle = this.palTower(pt.spec.id)[0];
      g.lineWidth = 1.6;
      g.globalAlpha = 0.7;
      const ps = this.cell - 6;
      (g as any).beginPath(); (g as any).roundRect(pt.x - ps / 2, pt.y - ps / 2, ps, ps, 9); g.stroke();
      g.globalAlpha = 1;
    }
    const t = this.selected;
    if (!t) return;
    this.drawRangeTiles(g, t.col, t.row, t.rangeT(), this.palTower(t.spec.id)[0], 0.1);
    const pulse = 1 + Math.sin(performance.now() / 200) * 0.06;
    g.strokeStyle = this.palTower(t.spec.id)[0];
    g.lineWidth = 2;
    const s = (this.cell - 6) * pulse;
    (g as any).beginPath(); (g as any).roundRect(t.x - s / 2, t.y - s / 2, s, s, 9); g.stroke();
    if (t.spec.kind === 'amp') {
      for (const o of this.towers) {
        if (o !== t && o.spec.kind !== 'amp' && this.circCell(t.x, t.y, t.rangeT(), o.col, o.row)) {
          this.ampRing(g, o.x, o.y, (o.spec.size + 11) * this.k, true);
        }
      }
    }
  }

  drawPlacement(g: CanvasRenderingContext2D) {
    // building: ghost of a not-yet-placed tower, awaiting confirmation
    if (this.pendingBuild) {
      const pb = this.pendingBuild;
      const c = this.cells[pb.cellIdx];
      const ghost = new Tower(pb.spec, c.x, c.y);
      ghost.col = c.col; ghost.row = c.row;
      this.drawRangeTiles(g, c.col, c.row, ghost.rangeT(), this.palTower(pb.spec.id)[0], 0.14);
      this.shadow(g, c.x, c.y, (pb.spec.size + 6) * this.k);
      this.drawTower(g, ghost, true);
      return;
    }
    // moving: ghost of the tower at its candidate new cell, awaiting confirmation
    if (this.pendingMove) {
      const pm = this.pendingMove;
      const t = pm.tower;
      const c = this.cells[pm.cellIdx];
      this.drawRangeTiles(g, c.col, c.row, t.rangeT(), this.palTower(t.spec.id)[0], 0.14);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.setLineDash([5, 7]);
      g.beginPath(); g.moveTo(t.x, t.y); g.lineTo(c.x, c.y); g.stroke();
      g.setLineDash([]);
      this.shadow(g, c.x, c.y, (t.spec.size + 6) * this.k);
      const saved = { x: t.x, y: t.y };
      t.x = c.x; t.y = c.y;
      this.drawTower(g, t, true);
      t.x = saved.x; t.y = saved.y;
      return;
    }
    // move armed: choosing a destination — live range preview under the cursor
    if (this.moveArmed) {
      const t = this.moveArmed;
      const idx = this.cellAt(this.mx, this.my);
      if (idx < 0) return;
      const ok = this.cellFree(idx, t);
      const c = this.cells[idx];
      this.drawRangeTiles(g, c.col, c.row, t.rangeT(), ok ? '#a8e6cf' : '#ff7d7d', 0.08);
      if (ok) {
        g.globalAlpha = 0.55;
        this.shadow(g, c.x, c.y, (t.spec.size + 6) * this.k);
        const saved = { x: t.x, y: t.y };
        t.x = c.x; t.y = c.y;
        this.drawTower(g, t, true);
        t.x = saved.x; t.y = saved.y;
        g.globalAlpha = 1;
      } else {
        g.strokeStyle = '#ff7d7d'; g.lineWidth = 3.4;
        g.beginPath();
        g.moveTo(c.x - 12, c.y - 12); g.lineTo(c.x + 12, c.y + 12);
        g.moveTo(c.x + 12, c.y - 12); g.lineTo(c.x - 12, c.y + 12);
        g.stroke();
      }
    }
  }
}
