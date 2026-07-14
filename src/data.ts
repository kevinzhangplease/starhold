// ================= Starhold data =================
// Towers, enemies, meta upgrades, abilities.
// NOTE: tower `range` is measured in whole TILES (Chebyshev — any direction
// including diagonals). Everything else distance-based remains in pixels.

// ---------- Progression unlock gating ----------
// System id -> level at which it unlocks. Gating keys off the ACCOUNT's highest
// reached level (save.unlocked), never the level being played — so a veteran
// replaying L1 gets the full sandbox while a first-timer's L1 stays clean.
// Must stay in sync with SEEN_UNLOCK_LEVELS in save.ts (validate.ts asserts this).
export const UNLOCKS: Record<string, number> = {
  combo: 2, challenges: 2, interest: 3, cells: 3, drops: 4, mod_asteroids: 4, overcharge: 4,
  elites: 5, boss_theater: 5, mutators: 6, mod_veins: 6, draft: 6, nova: 7,
  mod_meteors: 8, veterancy: 8, mutators_hard: 9, boss_phase2: 10, mod_combo: 10, doctrines: 10, mod_ionstorms: 12,
};

let _unlockedLevel = 1;
// UI calls this whenever the save is loaded or progression advances.
export function setUnlockedLevel(n: number) { _unlockedLevel = n; }
export function isUnlocked(id: string): boolean {
  const at = UNLOCKS[id];
  return at === undefined ? true : _unlockedLevel >= at;
}

// Compact number formatting: 950 -> "950", 12400 -> "12.4k", 3400000 -> "3.4M".
// Used anywhere late-game numbers could overflow their pills (HP tooltips, boss bars, damage numbers).
export function fmt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 10000) return `${(n / 1000).toFixed(abs >= 1e5 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

// ---------- Wave mutators ----------
export interface MutatorSpec { id: string; name: string; icon: string; color: string; blurb: string; hard?: boolean; }
export const MUTATORS: Record<string, MutatorSpec> = {
  frenzied: { id: 'frenzied', name: 'Frenzied', icon: '⚡', color: '#ffd97a', blurb: 'Enemies move 40% faster.' },
  armored:  { id: 'armored', name: 'Armored', icon: '🛡', color: '#9fd0ff', blurb: 'Enemies carry a 30% shield.' },
  bounty:   { id: 'bounty', name: 'Bounty', icon: '💰', color: '#fff3b0', blurb: 'Rewards +60% this wave.' },
  horde:    { id: 'horde', name: 'Horde', icon: '🐝', color: '#ffe08f', blurb: '+50% enemies at −25% HP.' },
  regen:    { id: 'regen', name: 'Regenerating', icon: '✚', color: '#c0f5b3', blurb: 'Enemies heal 2% per second.', hard: true },
  phasing:  { id: 'phasing', name: 'Phasing', icon: '◇', color: '#b0fff4', blurb: '1 in 5 enemies can blink out of reality.', hard: true },
};

// ---------- Wave shapes (Starhold 3.0 Phase 5) ----------
// A shape re-times/reorders a wave's already-authored spawn queue — it never changes
// enemy rosters or stats. See game.ts applyWaveShape() for the transforms themselves.
export type WaveShape = 'rush' | 'trickle' | 'convoy' | 'feint';
export const WAVE_SHAPES: Record<WaveShape, { name: string; icon: string; blurb: string }> = {
  rush:    { name: 'Rush',    icon: '⏩', blurb: 'The whole wave arrives within seconds. Burst damage or bust.' },
  trickle: { name: 'Trickle', icon: '⋯', blurb: 'One at a time, endlessly spaced. Single-target damage matters.' },
  convoy:  { name: 'Convoy',  icon: '🚚', blurb: 'A tank leads; support hides behind it. Check your targeting priorities.' },
  feint:   { name: 'Feint',   icon: '◇', blurb: 'A small opener — then a second group, later, from somewhere else.' },
};

// ---------- Level modifiers ----------
export interface ModifierSpec { id: string; name: string; icon: string; blurb: string; gate: string; }
export const MODIFIER_INFO: Record<string, ModifierSpec> = {
  asteroids:  { id: 'asteroids', name: 'Asteroid Field', icon: '🪨', gate: 'mod_asteroids', blurb: 'Rocky debris blocks some build cells.' },
  'rich-veins': { id: 'rich-veins', name: 'Rich Veins', icon: '💎', gate: 'mod_veins', blurb: 'Glittering cells: towers built there earn +2◆ per kill.' },
  meteors:    { id: 'meteors', name: 'Meteor Shower', icon: '☄️', gate: 'mod_meteors', blurb: 'Periodic strikes disable a tower for 6s. Watch the warning rings.' },
  'ion-storms': { id: 'ion-storms', name: 'Ion Storms', icon: '🌩', gate: 'mod_ionstorms', blurb: 'Storm bands sweep through, slowing fire rate 30% inside.' },
};

// ---------- Special terrain cells (Starhold 3.0 Phase 2) ----------
// Each type favors a different tower archetype and carries a real tradeoff — never
// "put your best tower here." Placement is algorithmic (levels.ts only states counts);
// see game.ts buildGrid() for the seeded placement algorithms themselves.
export interface CellTypeSpec { id: 'ridge' | 'sinkhole' | 'conduit' | 'anchor' | 'nullcell'; name: string; icon: string; blurb: string; bestFor: string[] }
export const CELL_TYPES: Record<string, CellTypeSpec> = {
  ridge:    { id: 'ridge',    name: 'Ridge',    icon: '⛰', blurb: '+1 range, −15% fire rate for the tower built here.', bestFor: ['sentinel', 'ray', 'missile'] },
  sinkhole: { id: 'sinkhole', name: 'Sinkhole', icon: '▽', blurb: '−1 range, +30% damage for the tower built here.', bestFor: ['flame', 'cryo', 'tesla'] },
  conduit:  { id: 'conduit',  name: 'Conduit',  icon: '↭', blurb: 'Linked cells: towers built on them focus the same target.', bestFor: ['pulse', 'prism', 'sentinel'] },
  anchor:   { id: 'anchor',   name: 'Anchor',   icon: '◎', blurb: 'An Amp built here projects double-strength buffs.', bestFor: ['amp'] },
  nullcell: { id: 'nullcell', name: 'Null Zone', icon: '∅', blurb: 'Unbuildable. Ground enemies passing beside it are slowed 20%.', bestFor: [] },
};

// ---------- Level challenges ----------
export interface ChallengeSpec { id: string; icon: string; name: string; desc: (param?: number) => string; }
export const CHALLENGE_POOL: Record<string, ChallengeSpec> = {
  perfect_hull:  { id: 'perfect_hull', icon: '💯', name: 'Perfect Hull', desc: () => 'Win without losing any hull integrity.' },
  minimalist:    { id: 'minimalist', icon: '🧩', name: 'Minimalist', desc: p => `Win having built ${p} towers or fewer.` },
  specialist:    { id: 'specialist', icon: '🎯', name: 'Specialist', desc: p => `Win using ${p} tower type${p === 1 ? '' : 's'} or fewer.` },
  no_abilities:  { id: 'no_abilities', icon: '🚫', name: 'No Abilities', desc: () => 'Win without using Orbital Strike or Stasis Field.' },
  speedrunner:   { id: 'speedrunner', icon: '⏱', name: 'Speedrunner', desc: () => 'Win having called every wave early — never let the timer run out.' },
  never_sell:    { id: 'never_sell', icon: '🔒', name: 'Committed', desc: () => 'Win without selling a single tower.' },
  hard_plus:     { id: 'hard_plus', icon: '🔥', name: 'Battle-Tested', desc: () => 'Win this level on Hard difficulty or higher.' },
};

// ---------- Central tuning (all new-system balance values live here) ----------
export const TUNING = {
  combo: {
    window: 1.6,                          // seconds between kills to keep the chain
    milestones: [5, 10, 20, 35, 50],
    bonuses:    [5, 12, 25, 45, 70],      // credits per milestone
    hudShowAt: 3,
  },
  interest: {
    rate: 0.06,                           // 6% of banked credits per wave clear
    cap: 60,                              // hard cap per payout
    capAscension4: 30,                    // Ascension IV halves the cap
  },
  elites: {
    baseChance: 0.03, perLevel: 0.004, perDifficulty: 0.02, perEndlessWave: 0.003,
    hpMul: 4.5, sizeMul: 1.35, bountyMul: 3, extraLeak: 1,
    affixShieldFrac: 0.3, affixSpeedMul: 1.3, affixHealPerSec: 8,
  },
  drops: {
    intervalMin: 20, intervalMax: 30, chance: 0.35, lifetime: 10,
    weights: { credits: 45, recharge: 20, overclock: 20, hull: 15 },
    creditsMin: 40, creditsMax: 90, overclockRate: 0.4, overclockDur: 8, hullPatch: 2,
  },
  mutators: {
    baseChance: 0.12, perLevel: 0.015, perDifficulty: 0.05, endlessLate: 0.4,
    fromWave: 4, noBackToBackBeforeLevel: 10,
    frenziedSpeed: 1.4, armoredShieldFrac: 0.3, bountyMul: 1.6,
    hordeCountMul: 1.5, hordeHpMul: 0.75, regenPerSec: 0.02, phasingFrac: 0.2,
  },
  meteors: { intervalMin: 25, intervalMax: 35, warning: 3, disable: 6, fragmentChance: 0.25, fragmentCredits: 20 },
  ionStorms: { interval: 40, duration: 8, warning: 4, ratePenalty: 0.3, bandRows: 2 },
  richVeins: { cells: [3, 4], creditPerKill: 2 },
  asteroids: { cellsMin: 6, cellsMax: 10 },
  nova: {
    killsToCharge: 90, eliteCharge: 4, bossCharge: 20,
    fracNormal: 0.30, fracBoss: 0.08, stunDur: 0.6, buildup: 1.2, rechargeGrowth: 1.0,
  },
  ascension: {
    // Tiers are CUMULATIVE — Ascension III has I+II+III's effects all active at once.
    hpMul: 1.2,              // tier >= 1 (Hardened)
    mutationBonus: 0.15,     // tier >= 2 (Aggressive)
    mutatorFromWave: 2,      // tier >= 2 — mutators can appear starting this early
    eliteMul: 2,             // tier >= 3 (Decorated)
    dualAffixChance: 0.4,    // tier >= 3 — chance an elite rolls a second, different affix
    startCreditMul: 0.75,    // tier >= 4 (Scarcity)
    interestCapTier4: 30,    // tier >= 4 — interest cap halved
    intermissionMul: 0.6,    // tier >= 5 (Onslaught) — i.e. 40% shorter
  },
  smoothing: {
    earlyLevels: 0.9,                     // L1–L2 pressure multiplier
    compensationFrom: 5, compensationFull: 10, compensationMax: 1.15,
  },
  // ---- Starhold 3.0 Phase 2: cell diversity ----
  cells: {
    ridge: { rangeAdd: 1, rateMul: 0.85 },
    sinkhole: { rangeAdd: -1, dmgMul: 1.3 },
    anchor: { ampMul: 2 },
    nullcell: { slowPct: 0.2 },           // applies within Chebyshev 1.5 tiles, ground only
    minSeparation: 2,                     // min Chebyshev distance between special cells
  },
  // ---- Starhold 3.0 Phase 1: economy & scaling foundations ----
  economy: {
    sellRefund: 0.72,          // fraction refunded outside the undo window
    sellUndoWindow: 4,         // seconds of game-time after placement with full refund
    refundInWaveMul: 0.72,     // upgrade-refund fraction while a wave is active (full between waves)
    earlyCallPerSec: 0.04,     // early-call bonus: +4% of pending wave bounty per second remaining
    earlyCallCap: 0.40,        // ...capped at +40% of the wave's bounty
    bountyCoef: 0.27,          // was 0.22 inline in game.ts — moved here and raised (see PROGRESS-3.md)
  },
  // ---- Starhold 3.0 Phase 3: map, path & portal identity ----
  portals: {
    chargeLead: 2,             // seconds before a spawn that its portal starts telegraphing
  },
  // ---- Starhold 3.0 Phase 4: tower depth ----
  flame: {
    stackMax: 3,               // igniteStack caps at 3 applications
    stackStep: 0.5,            // each stack adds +50% burnDps: 1.0x / 1.5x / 2.0x
  },
  reactions: {
    shatterFrac: 0.30,         // frozen-on-kill explosion: fraction of the victim's max hp
    shatterRadius: 60,         // px
    shatterCap: 250,           // flat cap before campaign scaling (see currentHpScale())
    conductionMul: 1.5,        // tesla chain damage vs a burning target
    coldFocusGrace: 1.0,       // seconds a Prism's ramp survives a chilled kill with no target
  },
  overcharge: {
    charges: 3,                // per wave
    rateMul: 2,                // fire-rate (or damage, for rate-0 towers) multiplier while active
    dur: 3,                    // seconds
  },
  veterancy: {
    kills: 45,                 // kill threshold that offers a perk choice
    perks: { sharp: 0.12, rapid: 0.12, scav: 1 },   // sharp/rapid are multiplier bonuses; scav is a flat credit base (scaled by econScale at payout)
  },
  threat: {
    efficiency: 0.65,          // baseline fraction of raw deliverable DPS that actually lands
    comfortable: 1.5,          // deliverable/effHP ratio at or above this -> "Comfortable"
    tight: 1.0,                // ratio at or above this (below comfortable) -> "Tight"
    coveragePathCells: 5,      // pathCellsInRange needed for a tower to read as full ground coverage
    coverageLanePts: 4,        // flier-lane sample points in range needed for full air coverage
  },
  // ---- Starhold 3.0 Phase 8: replayability — draft & doctrines ----
  draft: {
    // interpreted as "levels <= threshold -> size": [4,5] means levels 1-4 draft 5 towers.
    sizeByLevel: [[4, 5], [8, 6], [12, 7], [15, 8]] as [number, number][],
    endless: 8,
  },
  doctrines: {
    artillery: { splashRadiusMul: 1.25, splashDmgMul: 1.15 },
    precision: { critAdd: 0.10 },
    logistics: { startCreditMul: 1.10, dropIntervalMul: 0.8 },
  },
} as const;

export interface StageStats {
  name: string;
  desc: string;
  cost: number;          // cost to buy (stage 0) or upgrade into this stage
  dmg: number;
  rate: number;          // shots per second (0 = passive)
  range: number;         // TILES
  // optional specials
  splash?: number;       // splash radius (px)
  slow?: number;         // slow fraction 0..1
  slowDur?: number;
  chains?: number;       // tesla chain count
  stun?: number;         // stun chance 0..1
  burnDps?: number;
  burnDur?: number;
  pierce?: number;       // enemies pierced
  shots?: number;        // projectiles per volley
  freeze?: number;       // freeze-solid chance
  aura?: boolean;        // constant slow field (no projectile)
  buffDmg?: number;      // amplifier buffs
  buffRate?: number;
  buffRange?: number;    // fraction added to range (in tiles, rounded)
  crit?: number;         // crit chance (2.5x dmg)
  rampMax?: number;      // prism max multiplier
  rampTime?: number;     // seconds to reach max
  beams?: number;        // prism split beams
  airMul?: number;       // damage multiplier vs flying
  groundOnly?: boolean;
  cluster?: number;      // bomblets on impact
  rayWidth?: number;     // half-width of the piercing laser line (px)
  // ---- tier-2 verb rewrites (Phase 4) ----
  pierceRamp?: number;   // Star Lance: each pierced enemy takes (1+pierceRamp)^k more
  directStun?: number;   // Nova Torpedo: stun seconds on the missile's direct target only
  farTiles?: number;     // Farlance: Chebyshev tile distance at/beyond which farMul applies
  farMul?: number;       // Farlance: damage multiplier at farTiles+
  freshMul?: number;     // Storm Sentinel: damage multiplier vs targets still at full hp/shield
  burnSpread?: number;   // Hellmouth: on kill, burning jumps to the nearest enemy within this many px
}

export interface TowerSpec {
  id: string;
  name: string;
  color: string;
  color2: string;
  kind: 'bullet' | 'mortar' | 'cryo' | 'missile' | 'tesla' | 'amp' | 'prism' | 'ray' | 'flame';
  hotkey: string;
  blurb: string;
  size: number; // footprint radius (art, tuned for 48px tiles)
  stages: StageStats[];
  branches: StageStats[][]; // 3 specialization paths, 2 stages each
}

const T = (s: Partial<StageStats> & { name: string; desc: string; cost: number }): StageStats =>
  ({ dmg: 0, rate: 0, range: 1, ...s });

export const TOWERS: TowerSpec[] = [
  {
    id: 'pulse', name: 'Pulse', color: '#8fbfae', color2: '#5d8f7f', kind: 'bullet', hotkey: '1', size: 17,
    blurb: 'Fast, cheap, reliable single-target fire.',
    stages: [
      T({ name: 'Pulse Mk I', desc: 'Fires rapid single-target shots.', cost: 90, dmg: 9, rate: 2.2, range: 2 }),
      T({ name: 'Pulse Mk II', desc: 'Increases damage per shot.', cost: 80, dmg: 15, rate: 2.5, range: 2 }),
      T({ name: 'Pulse Mk III', desc: 'Further increases damage and fire rate.', cost: 130, dmg: 24, rate: 2.8, range: 2 }),
    ],
    branches: [
      [
        T({ name: 'Twin Pulse', desc: 'Adds a second barrel, more than doubling fire rate.', cost: 210, dmg: 24, rate: 5.2, range: 2 }),
        T({ name: 'Gatling Array', desc: 'Adds a third barrel and increases range.', cost: 300, dmg: 28, rate: 7.5, range: 3 }),
      ],
      [
        T({ name: 'Lance', desc: 'Fires a piercing shot that passes through 2 enemies. Longer range, higher damage, lower fire rate.', cost: 230, dmg: 85, rate: 0.8, range: 3, pierce: 2 }),
        T({ name: 'Star Lance', desc: 'Pierces 3. Each enemy the lance passes through takes 40% more than the last.', cost: 330, dmg: 150, rate: 0.75, range: 4, pierce: 3, pierceRamp: 0.4 }),
      ],
      [
        T({ name: 'Frost Rounds', desc: 'Shots slow the target by 25% for a short time.', cost: 220, dmg: 22, rate: 3.2, range: 2, slow: 0.25, slowDur: 1.2 }),
        T({ name: 'Winterspray', desc: 'Increases fire rate and slow strength to 35%.', cost: 310, dmg: 30, rate: 4.2, range: 2, slow: 0.35, slowDur: 1.5 }),
      ],
    ],
  },
  {
    id: 'mortar', name: 'Mortar', color: '#c4a894', color2: '#93755f', kind: 'mortar', hotkey: '2', size: 19,
    blurb: 'Lobbed shells with splash. Ground only.',
    stages: [
      T({ name: 'Mortar Mk I', desc: 'Fires shells that deal splash damage. Cannot target flying enemies.', cost: 140, dmg: 24, rate: 0.55, range: 3, splash: 46, groundOnly: true }),
      T({ name: 'Mortar Mk II', desc: 'Increases damage and splash radius.', cost: 110, dmg: 40, rate: 0.6, range: 3, splash: 54, groundOnly: true }),
      T({ name: 'Mortar Mk III', desc: 'Further increases damage and splash radius.', cost: 170, dmg: 62, rate: 0.65, range: 3, splash: 60, groundOnly: true }),
    ],
    branches: [
      [
        T({ name: 'Cluster Mortar', desc: 'Each shell splits into 4 bomblets on impact, each dealing splash damage.', cost: 260, dmg: 55, rate: 0.65, range: 3, splash: 50, cluster: 4, groundOnly: true }),
        T({ name: 'Carpet Mortar', desc: 'Increases bomblets to 6 and increases damage.', cost: 360, dmg: 70, rate: 0.7, range: 3, splash: 55, cluster: 6, groundOnly: true }),
      ],
      [
        T({ name: 'Magma Mortar', desc: 'Impacts leave a burning patch of ground that damages enemies over time.', cost: 270, dmg: 68, rate: 0.6, range: 3, splash: 62, burnDps: 26, burnDur: 3, groundOnly: true }),
        T({ name: 'Sunfire Mortar', desc: 'Increases burn damage and splash radius.', cost: 380, dmg: 95, rate: 0.62, range: 3, splash: 74, burnDps: 48, burnDur: 3.5, groundOnly: true }),
      ],
      [
        T({ name: 'Quake Mortar', desc: 'Impacts have a 20% chance to stun ground enemies briefly.', cost: 260, dmg: 58, rate: 0.6, range: 3, splash: 60, stun: 0.2, groundOnly: true }),
        T({ name: 'Tectonic Mortar', desc: 'Increases stun chance to 32% and increases damage.', cost: 370, dmg: 84, rate: 0.62, range: 3, splash: 70, stun: 0.32, groundOnly: true }),
      ],
    ],
  },
  {
    id: 'cryo', name: 'Cryo', color: '#86b4cc', color2: '#5b84a1', kind: 'cryo', hotkey: '3', size: 17,
    blurb: 'Chills enemies to a crawl.',
    stages: [
      T({ name: 'Cryo Mk I', desc: 'Fires bolts that slow the target by 35% for a short time.', cost: 110, dmg: 5, rate: 1.4, range: 2, slow: 0.35, slowDur: 1.8 }),
      T({ name: 'Cryo Mk II', desc: 'Increases slow to 45% and increases damage.', cost: 95, dmg: 8, rate: 1.5, range: 2, slow: 0.45, slowDur: 2.1 }),
      T({ name: 'Cryo Mk III', desc: 'Increases slow to 55% and increases damage.', cost: 150, dmg: 12, rate: 1.6, range: 2, slow: 0.55, slowDur: 2.4 }),
    ],
    branches: [
      [
        T({ name: 'Flash Freeze', desc: '18% chance to freeze the target solid for 1.2 seconds.', cost: 240, dmg: 16, rate: 1.7, range: 2, slow: 0.55, slowDur: 2.4, freeze: 0.18 }),
        T({ name: 'Absolute Zero', desc: 'Increases freeze chance to 30%. Frozen enemies take 25% more damage.', cost: 330, dmg: 22, rate: 1.8, range: 3, slow: 0.6, slowDur: 2.6, freeze: 0.3 }),
      ],
      [
        T({ name: 'Frost Field', desc: 'Continuously slows all enemies in range by 45%. Does not fire projectiles.', cost: 250, dmg: 6, rate: 0, range: 2, slow: 0.45, aura: true }),
        T({ name: 'Glacier Field', desc: 'Increases range and slow to 60%. Also deals damage over time.', cost: 340, dmg: 14, rate: 0, range: 3, slow: 0.6, aura: true }),
      ],
      [
        T({ name: 'Cryo Lance', desc: 'Fires a piercing bolt that slows every enemy it passes through, hitting up to 2.', cost: 250, dmg: 20, rate: 1.1, range: 2, slow: 0.5, slowDur: 2.2, pierce: 2 }),
        T({ name: 'Glacier Lance', desc: 'Pierces 3 enemies and increases damage.', cost: 340, dmg: 60, rate: 1.15, range: 3, slow: 0.55, slowDur: 2.4, pierce: 3 }),
      ],
    ],
  },
  {
    id: 'missile', name: 'Missile', color: '#c495a6', color2: '#92697c', kind: 'missile', hotkey: '4', size: 18,
    blurb: 'Homing missiles. Deadly to fliers.',
    stages: [
      T({ name: 'Missile Mk I', desc: 'Fires a homing missile that deals splash damage. Deals 2x damage to flying enemies.', cost: 130, dmg: 26, rate: 0.8, range: 3, splash: 26, airMul: 2 }),
      T({ name: 'Missile Mk II', desc: 'Increases damage and splash radius.', cost: 105, dmg: 42, rate: 0.85, range: 3, splash: 30, airMul: 2 }),
      T({ name: 'Missile Mk III', desc: 'Further increases damage and splash radius.', cost: 160, dmg: 64, rate: 0.9, range: 3, splash: 34, airMul: 2 }),
    ],
    branches: [
      [
        T({ name: 'Swarm Pod', desc: 'Fires a volley of 5 smaller missiles per shot instead of 1.', cost: 260, dmg: 22, rate: 0.75, range: 3, splash: 22, shots: 5, airMul: 2 }),
        T({ name: 'Hornet Nest', desc: 'Increases the volley to 8 missiles and increases damage vs flying enemies to 2.2x.', cost: 350, dmg: 26, rate: 0.8, range: 3, splash: 24, shots: 8, airMul: 2.2 }),
      ],
      [
        T({ name: 'Torpedo', desc: 'Fires a single high-damage missile with a large splash radius, at a slower fire rate.', cost: 280, dmg: 190, rate: 0.38, range: 3, splash: 66, airMul: 1.6 }),
        T({ name: 'Nova Torpedo', desc: 'A massive warhead. The enemy it strikes directly is stunned for half a second.', cost: 390, dmg: 330, rate: 0.4, range: 3, splash: 82, airMul: 1.6, directStun: 0.5 }),
      ],
      [
        T({ name: 'Interceptor', desc: 'Increases damage vs flying enemies to 3.2x and increases fire rate.', cost: 260, dmg: 30, rate: 1.5, range: 3, splash: 20, airMul: 3.2 }),
        T({ name: 'Skyreaper', desc: 'Increases damage vs flying enemies to 4x and increases fire rate further.', cost: 360, dmg: 40, rate: 1.7, range: 4, splash: 22, airMul: 4 }),
      ],
    ],
  },
  {
    id: 'tesla', name: 'Tesla', color: '#cfc491', color2: '#9c9260', kind: 'tesla', hotkey: '5', size: 17,
    blurb: 'Chain lightning between packed foes.',
    stages: [
      T({ name: 'Tesla Mk I', desc: 'Fires a bolt that chains to 2 additional nearby enemies.', cost: 150, dmg: 16, rate: 1.1, range: 2, chains: 2 }),
      T({ name: 'Tesla Mk II', desc: 'Increases chains to 3 targets and increases damage.', cost: 120, dmg: 25, rate: 1.15, range: 2, chains: 3 }),
      T({ name: 'Tesla Mk III', desc: 'Increases chains to 4 targets and increases damage.', cost: 180, dmg: 38, rate: 1.2, range: 2, chains: 4 }),
    ],
    branches: [
      [
        T({ name: 'Arc Web', desc: 'Increases chains to 7 targets, hitting large groups of enemies.', cost: 270, dmg: 42, rate: 1.3, range: 3, chains: 7 }),
        T({ name: 'Storm Nexus', desc: 'Increases chains to 10 targets and increases damage.', cost: 370, dmg: 52, rate: 1.35, range: 3, chains: 10 }),
      ],
      [
        T({ name: 'Overload Coil', desc: 'Increases damage. 25% chance to stun each hit enemy for 0.8 seconds.', cost: 280, dmg: 85, rate: 0.9, range: 2, chains: 2, stun: 0.25 }),
        T({ name: 'Thunder Spire', desc: 'Increases stun chance to 40% and increases damage.', cost: 380, dmg: 135, rate: 0.95, range: 3, chains: 3, stun: 0.4 }),
      ],
      [
        T({ name: 'Ion Field', desc: 'Continuously slows all enemies in range by 30% and deals damage over time. Does not fire projectiles.', cost: 270, dmg: 18, rate: 0, range: 1, slow: 0.3, aura: true }),
        T({ name: 'Storm Field', desc: 'Increases range, slow to 40%, and damage.', cost: 370, dmg: 30, rate: 0, range: 2, slow: 0.4, aura: true }),
      ],
    ],
  },
  {
    id: 'amp', name: 'Amp', color: '#a394cc', color2: '#77699c', kind: 'amp', hotkey: '6', size: 16,
    blurb: 'Buffs every tower in its radius.',
    stages: [
      T({ name: 'Amp Mk I', desc: 'Increases the damage of all towers in range by 15%.', cost: 120, dmg: 0, rate: 0, range: 1, buffDmg: 0.15 }),
      T({ name: 'Amp Mk II', desc: 'Increases the damage bonus to 25%.', cost: 100, dmg: 0, rate: 0, range: 1, buffDmg: 0.25 }),
      T({ name: 'Amp Mk III', desc: 'Increases the damage bonus to 35% and increases range.', cost: 160, dmg: 0, rate: 0, range: 2, buffDmg: 0.35 }),
    ],
    branches: [
      [
        T({ name: 'Overclock', desc: 'Also increases the fire rate of towers in range by 25%.', cost: 250, dmg: 0, rate: 0, range: 2, buffDmg: 0.35, buffRate: 0.25 }),
        T({ name: 'Hyperclock', desc: 'Increases the damage bonus to 45% and the fire rate bonus to 40%.', cost: 340, dmg: 0, rate: 0, range: 2, buffDmg: 0.45, buffRate: 0.4 }),
      ],
      [
        T({ name: 'Targeting Array', desc: 'Also gives towers in range +1 range tile and a 10% chance to deal 2.5x critical damage.', cost: 260, dmg: 0, rate: 0, range: 2, buffDmg: 0.35, buffRange: 0.34, crit: 0.1 }),
        T({ name: 'Oracle Array', desc: 'Increases the damage bonus to 45% and the critical chance to 18%.', cost: 350, dmg: 0, rate: 0, range: 2, buffDmg: 0.45, buffRange: 0.34, crit: 0.18 }),
      ],
      [
        T({ name: 'Beacon', desc: 'Increases this tower\'s own range so it can buff towers further away. Buffed towers also gain +1 range tile.', cost: 240, dmg: 0, rate: 0, range: 3, buffDmg: 0.15, buffRange: 0.34 }),
        T({ name: 'Grand Beacon', desc: 'Increases this tower\'s own range further. Buffed towers gain +2 range tiles instead of +1.', cost: 330, dmg: 0, rate: 0, range: 4, buffDmg: 0.25, buffRange: 0.6 }),
      ],
    ],
  },
  {
    id: 'prism', name: 'Prism', color: '#c47a8d', color2: '#94566a', kind: 'prism', hotkey: '7', size: 17,
    blurb: 'A beam that ramps up the longer it holds.',
    stages: [
      T({ name: 'Prism Mk I', desc: 'Fires a continuous beam that ramps up to 3x damage over 3 seconds while held on one target.', cost: 160, dmg: 14, rate: 0, range: 2, rampMax: 3, rampTime: 3 }),
      T({ name: 'Prism Mk II', desc: 'Increases base beam damage.', cost: 130, dmg: 22, rate: 0, range: 2, rampMax: 3, rampTime: 2.8 }),
      T({ name: 'Prism Mk III', desc: 'Further increases base beam damage and ramp cap to 3.2x.', cost: 190, dmg: 32, rate: 0, range: 3, rampMax: 3.2, rampTime: 2.6 }),
    ],
    branches: [
      [
        T({ name: 'Focus Prism', desc: 'Increases the damage ramp cap to 5x and reaches it in 2 seconds.', cost: 290, dmg: 40, rate: 0, range: 3, rampMax: 5, rampTime: 2 }),
        T({ name: 'Singularity Lens', desc: 'Increases the damage ramp cap to 8x.', cost: 400, dmg: 50, rate: 0, range: 3, rampMax: 8, rampTime: 2.2 }),
      ],
      [
        T({ name: 'Split Prism', desc: 'Splits the beam to hit up to 3 targets at once instead of 1.', cost: 280, dmg: 34, rate: 0, range: 3, rampMax: 2.5, rampTime: 2.5, beams: 3 }),
        T({ name: 'Radiant Prism', desc: 'Increases the split beam count to 5 targets.', cost: 390, dmg: 42, rate: 0, range: 3, rampMax: 2.5, rampTime: 2.4, beams: 5 }),
      ],
      [
        T({ name: 'Overdrive Lens', desc: 'Reduces the time to reach maximum ramp damage to under 1 second.', cost: 270, dmg: 44, rate: 0, range: 2, rampMax: 2.2, rampTime: 0.9 }),
        T({ name: 'Hyperdrive Lens', desc: 'Further reduces ramp time and increases base damage.', cost: 380, dmg: 60, rate: 0, range: 3, rampMax: 2.4, rampTime: 0.7 }),
      ],
    ],
  },
  {
    id: 'ray', name: 'Ray', color: '#a8bf78', color2: '#79904c', kind: 'ray', hotkey: '8', size: 17,
    blurb: 'Fires a piercing beam — hits every alien along the line.',
    stages: [
      T({ name: 'Ray Mk I', desc: 'Fires an instant beam that damages every enemy along its line.', cost: 150, dmg: 18, rate: 0.8, range: 3, rayWidth: 9 }),
      T({ name: 'Ray Mk II', desc: 'Increases damage.', cost: 120, dmg: 30, rate: 0.85, range: 3, rayWidth: 10 }),
      T({ name: 'Ray Mk III', desc: 'Further increases damage.', cost: 180, dmg: 46, rate: 0.9, range: 3, rayWidth: 11 }),
    ],
    branches: [
      [
        T({ name: 'Strobe Ray', desc: 'Increases fire rate significantly.', cost: 270, dmg: 42, rate: 1.9, range: 3, rayWidth: 11 }),
        T({ name: 'Strobe Array', desc: 'Further increases fire rate and damage.', cost: 370, dmg: 52, rate: 2.8, range: 3, rayWidth: 12 }),
      ],
      [
        T({ name: 'Annihilator', desc: 'Widens the beam and greatly increases damage, at a slower fire rate.', cost: 290, dmg: 170, rate: 0.35, range: 3, rayWidth: 18 }),
        T({ name: 'Sunlance', desc: 'Further increases damage and range.', cost: 400, dmg: 320, rate: 0.35, range: 4, rayWidth: 22 }),
      ],
      [
        T({ name: 'Lancet', desc: 'Increases range significantly, at reduced beam width.', cost: 260, dmg: 62, rate: 0.75, range: 4, rayWidth: 7 }),
        T({ name: 'Farlance', desc: 'Extreme range. Enemies 3+ tiles away take +50% — a true artillery beam.', cost: 370, dmg: 95, rate: 0.8, range: 4, rayWidth: 7, farTiles: 3, farMul: 1.5 }),
      ],
    ],
  },
  {
    id: 'flame', name: 'Flame', color: '#c4906a', color2: '#925f3d', kind: 'flame', hotkey: '9', size: 17,
    blurb: 'Flame damage stacks up to three times on the same target — nothing melts a chokepoint like a committed Flame.',
    stages: [
      T({ name: 'Flame Mk I', desc: 'Fires a short cone of fire that ignites enemies, dealing damage over time.', cost: 110, dmg: 4, rate: 1.4, range: 1, burnDps: 14, burnDur: 2.5 }),
      T({ name: 'Flame Mk II', desc: 'Increases burn damage.', cost: 100, dmg: 6, rate: 1.5, range: 1, burnDps: 24, burnDur: 2.5 }),
      T({ name: 'Flame Mk III', desc: 'Increases range and burn damage.', cost: 155, dmg: 9, rate: 1.6, range: 2, burnDps: 38, burnDur: 3 }),
    ],
    branches: [
      [
        T({ name: 'Inferno', desc: 'Greatly increases burn damage.', cost: 250, dmg: 14, rate: 1.7, range: 2, burnDps: 72, burnDur: 3 }),
        T({ name: 'Hellmouth', desc: "When a burning enemy dies, its fire leaps to the nearest enemy within 70px.", cost: 350, dmg: 20, rate: 1.8, range: 2, burnDps: 125, burnDur: 3.5, burnSpread: 70 }),
      ],
      [
        T({ name: 'Flarethrower', desc: 'Increases range and cone width.', cost: 260, dmg: 12, rate: 1.6, range: 2, burnDps: 50, burnDur: 3 }),
        T({ name: 'Solar Flare', desc: 'Further increases range and burn damage.', cost: 360, dmg: 16, rate: 1.7, range: 3, burnDps: 82, burnDur: 3.5 }),
      ],
      [
        T({ name: 'Blue Flame', desc: 'Increases direct damage per hit instead of burn damage.', cost: 250, dmg: 26, rate: 1.8, range: 1, burnDps: 22, burnDur: 2 }),
        T({ name: 'White Flame', desc: 'Further increases direct damage and fire rate.', cost: 350, dmg: 42, rate: 2, range: 1, burnDps: 30, burnDur: 2 }),
      ],
    ],
  },
  {
    // Range repricing (Phase 4): range solves coverage AND uptime simultaneously (the
    // Defender's Quest lesson) — it's the strongest lever in the game, so it carries the
    // price tag. Sentinel ends up the most expensive BASE tower (validate.ts asserts this).
    id: 'sentinel', name: 'Sentinel', color: '#b596cc', color2: '#85689c', kind: 'bullet', hotkey: '0', size: 16,
    blurb: 'Covers half the map — reach is never cheap.',
    stages: [
      T({ name: 'Sentinel Mk I', desc: 'Fires at very long range with modest damage.', cost: 170, dmg: 15, rate: 1.0, range: 4 }),
      T({ name: 'Sentinel Mk II', desc: 'Increases damage.', cost: 105, dmg: 25, rate: 1.05, range: 4 }),
      T({ name: 'Sentinel Mk III', desc: 'Increases damage and range.', cost: 165, dmg: 38, rate: 1.1, range: 5 }),
    ],
    branches: [
      [
        T({ name: 'Farsight', desc: 'Increases range and damage. 30% chance to deal 2.5x critical damage.', cost: 280, dmg: 72, rate: 0.85, range: 6, crit: 0.3 }),
        T({ name: 'Star Sentinel', desc: 'Further increases damage and critical chance to 40%.', cost: 380, dmg: 120, rate: 0.85, range: 6, crit: 0.4 }),
      ],
      [
        T({ name: 'Rapid Sentinel', desc: 'Trades damage per shot for a much higher fire rate.', cost: 265, dmg: 34, rate: 2.6, range: 5 }),
        T({ name: 'Storm Sentinel', desc: 'Rapid fire that hits undamaged targets 50% harder — the perfect opener.', cost: 360, dmg: 44, rate: 3.6, range: 5, freshMul: 1.5 }),
      ],
      [
        T({ name: 'Warden', desc: 'Shots slow the target by 30% for a short time.', cost: 265, dmg: 28, rate: 1.0, range: 5, slow: 0.3, slowDur: 1.4 }),
        T({ name: 'High Warden', desc: 'Increases range and slow to 40%.', cost: 360, dmg: 42, rate: 1.05, range: 6, slow: 0.4, slowDur: 1.6 }),
      ],
    ],
  },
];

// ================= Enemies =================
export interface EnemySpec {
  id: string;
  name: string;
  desc: string;
  hp: number;
  speed: number;      // px/s baseline
  reward: number;
  size: number;
  color: string;
  color2: string;
  leak: number;
  flying?: boolean;
  shield?: number;
  healAura?: number;
  splits?: { id: string; count: number };
  phase?: boolean;
  boss?: boolean;
  spawnMinion?: { id: string; every: number; count: number };
  emp?: number;
  eyes?: number;
  shape?: 'circle' | 'slim' | 'square' | 'hex' | 'diamond' | 'lumpy';
  counters?: string[];   // tower ids that answer this enemy best ("Weak to" hints)
}

export const ENEMIES: Record<string, EnemySpec> = {
  drone:    { id: 'drone', shape: 'circle', name: 'Drone', desc: 'The standard invader. No tricks — just keeps coming.', hp: 42, speed: 52, reward: 8, size: 13, color: '#ffb36e', color2: '#cc7f3f', leak: 1, eyes: 1, counters: ['pulse', 'tesla'] },
  dart:     { id: 'dart', shape: 'slim', name: 'Dart', desc: 'Fast and fragile. Slips past slow-firing towers.', hp: 26, speed: 98, reward: 9, size: 9.5, color: '#ffd166', color2: '#c99b33', leak: 1, eyes: 2, counters: ['pulse', 'cryo'] },
  brute:    { id: 'brute', shape: 'square', name: 'Brute', desc: 'Slow, heavily armored, and costs 2 integrity if it leaks. Focus fire.', hp: 300, speed: 30, reward: 24, size: 26, color: '#ff8f6e', color2: '#c95c3d', leak: 2, eyes: 1, counters: ['prism', 'mortar'] },
  swarmling:{ id: 'swarmling', shape: 'circle', name: 'Swarmling', desc: 'Tiny and weak, but arrives in floods. Splash and chain damage shine here.', hp: 12, speed: 74, reward: 3, size: 6.5, color: '#ffe066', color2: '#c9a933', leak: 1, eyes: 1, counters: ['mortar', 'tesla', 'ray'] },
  aegis:    { id: 'aegis', shape: 'hex', name: 'Aegis', desc: 'Carries a shield that regenerates if left alone for a few seconds. Keep hitting it.', hp: 130, speed: 44, reward: 20, size: 16, color: '#ff9e9e', color2: '#c96a6a', leak: 1, shield: 0.9, eyes: 1, counters: ['prism', 'pulse'] },
  wisp:     { id: 'wisp', shape: 'circle', name: 'Wisp', desc: 'Flies straight to your base, ignoring the road entirely. Needs anti-air coverage.', hp: 55, speed: 62, reward: 12, size: 12, color: '#ffb3d9', color2: '#c980a8', leak: 1, flying: true, eyes: 1, counters: ['missile', 'sentinel'] },
  raptor:   { id: 'raptor', shape: 'slim', name: 'Raptor', desc: 'A fast flier. If your anti-air lapses, these punish you first.', hp: 40, speed: 118, reward: 14, size: 10.5, color: '#ff8fb8', color2: '#c95f88', leak: 1, flying: true, eyes: 2, counters: ['missile', 'sentinel'] },
  mender:   { id: 'mender', shape: 'circle', name: 'Mender', desc: 'Heals everything around it in pulses. Kill it first — set towers to target Strong.', hp: 150, speed: 38, reward: 26, size: 16, color: '#d4e86e', color2: '#a3b53f', leak: 1, healAura: 14, eyes: 1, counters: ['sentinel', 'prism'] },
  splitter: { id: 'splitter', shape: 'lumpy', name: 'Splitter', desc: 'Bursts into four swarmlings on death. Pop them where your splash can mop up.', hp: 110, speed: 48, reward: 16, size: 17, color: '#ffc09e', color2: '#c98f6e', leak: 1, splits: { id: 'swarmling', count: 4 }, eyes: 3, counters: ['mortar', 'tesla'] },
  phase:    { id: 'phase', shape: 'diamond', name: 'Phaser', desc: 'Periodically blinks out of reality — untargetable while shimmering. Slow fields still stick.', hp: 95, speed: 58, reward: 22, size: 13, color: '#ffd9a8', color2: '#cca872', leak: 1, phase: true, eyes: 1, counters: ['cryo', 'flame'] },
  // ------- bosses -------
  mothership: {
    id: 'mothership', shape: 'circle', name: 'THE MOTHERSHIP', desc: 'Zone 1 boss. A flying fortress that continually deploys Wisps as it drifts toward your base.', hp: 2600, speed: 17, reward: 250, size: 40,
    color: '#ff9ecf', color2: '#c96f9e', leak: 10, flying: true, boss: true,
    spawnMinion: { id: 'wisp', every: 6, count: 2 }, eyes: 3, counters: ['missile', 'sentinel'],
  },
  colossus: {
    id: 'colossus', shape: 'square', name: 'THE COLOSSUS', desc: 'Zone 2 boss. Half its bulk is regenerating shield, and its EMP pulse disables nearby towers.', hp: 8000, speed: 14, reward: 400, size: 46,
    color: '#ff7f5c', color2: '#c9502f', leak: 15, boss: true, shield: 0.5, emp: 9, eyes: 1, counters: ['prism', 'mortar'],
  },
  leviathan: {
    id: 'leviathan', shape: 'hex', name: 'THE LEVIATHAN', desc: 'The final boss. Shielded, EMP-armed, and spawns Splitters. Bring everything you have.', hp: 16000, speed: 13, reward: 700, size: 52,
    color: '#ffb85c', color2: '#cc8a2e', leak: 20, boss: true, shield: 0.35,
    spawnMinion: { id: 'splitter', every: 8, count: 1 }, emp: 12, eyes: 5, counters: ['prism', 'missile'],
  },
};

// Level id each non-boss enemy first appears at (mirrors each level's `newEnemy` field —
// validate.ts asserts the two stay consistent). Hard+ wave injection (Phase 5.5) draws only
// from enemies the player has already met, so an injected extra never introduces a brand-new
// threat without its own dedicated debut moment.
export const ENEMY_INTRO: Record<string, number> = {
  drone: 1, dart: 1, swarmling: 2, brute: 3, wisp: 4, aegis: 6, raptor: 7, mender: 8, splitter: 9, phase: 11,
};

// ---------- Palette token table (Starhold 3.0 Phase 3B) ----------
// Every canvas draw of tower/enemy color routes through Game.pal()/palTower()/palEnemy()
// instead of reading spec.color/color2 directly, so the whole board (not just HUD chrome)
// re-themes when Chroma or the accessible palette is active. `default` is GENERATED from
// the TOWERS/ENEMIES spec fields above — edit a tower/enemy's `color`/`color2` there and
// PALETTE.default picks it up automatically; `chroma`/`accessible` are separate hand-authored
// tables since they're deliberate departures from those defaults, not derivations of them.
export interface PaletteVariant {
  towers: Record<string, [string, string]>;
  enemies: Record<string, [string, string]>;
  rim: string;      // enemy warm rim-light (drawEnemyBody)
  muzzle: string;    // tower muzzle-flash brightest element
}
export const PALETTE: Record<'default' | 'chroma' | 'accessible', PaletteVariant> = {
  default: {
    towers: Object.fromEntries(TOWERS.map(t => [t.id, [t.color, t.color2] as [string, string]])),
    enemies: Object.fromEntries(Object.values(ENEMIES).map(e => [e.id, [e.color, e.color2] as [string, string]])),
    rim: '#fff4e0',
    muzzle: '#eaffff',
  },
  // Cooler teals / magentas — the board half of the Chroma prestige reward (previously
  // UI-chrome-only; see PROGRESS-3.md for why the old scope-cut is now obsolete).
  chroma: {
    towers: {
      pulse: ['#6ecbc0', '#3f8f86'], mortar: ['#7ec9d6', '#4f8f9c'], cryo: ['#6fb8e8', '#3f7fb5'],
      missile: ['#9c8fe0', '#6a5cae'], tesla: ['#7ee8c8', '#4fae8f'], amp: ['#b088ff', '#7a52c9'],
      prism: ['#ff6bb0', '#c93f83'], ray: ['#7ee8e8', '#4fb0b0'], flame: ['#ff8f6b', '#c95c3f'],
      sentinel: ['#c993ff', '#9660c9'],
    },
    enemies: {
      drone: ['#ff9ecf', '#c96f9e'], dart: ['#ffb3e0', '#c980ab'], brute: ['#ff7a9e', '#c9506f'],
      swarmling: ['#ffcf6e', '#c99a3f'], aegis: ['#ff9ecc', '#c96e9c'], wisp: ['#e0a3ff', '#ab6fc9'],
      raptor: ['#ff6bb0', '#c93f83'], mender: ['#b3e86e', '#83b53f'], splitter: ['#ffb0e0', '#c980ab'],
      phase: ['#d9b0ff', '#a480c9'], mothership: ['#e896ff', '#b060c9'], colossus: ['#ff5c8f', '#c9305f'],
      leviathan: ['#ff8fd9', '#c95fab'],
    },
    rim: '#ffe0f4',
    muzzle: '#e0fff8',
  },
  // Colorblind-accessible: pushes VALUE separation harder than the default split (towers
  // darker-cool, enemies lighter-warm) and avoids red/green discrimination — mender shifts
  // toward yellow and ray toward blue-grey per the plan's explicit call-outs. Enemy `shape`
  // remains the second redundancy channel (validate.ts asserts unique shape/size-band pairs).
  accessible: {
    towers: {
      pulse: ['#6d9885', '#435f52'], mortar: ['#96795c', '#5c4736'], cryo: ['#5c88a1', '#3a5a6e'],
      missile: ['#96677a', '#5c3f4c'], tesla: ['#a89759', '#6b5e38'], amp: ['#7259a1', '#4a3a6b'],
      prism: ['#96506b', '#613447'], ray: ['#9fb4c4', '#6b7f8c'], flame: ['#966048', '#5c3a2b'],
      sentinel: ['#8360a1', '#543f6b'],
    },
    enemies: {
      drone: ['#ffc999', '#ffb36e'], dart: ['#ffe0a3', '#ffd166'], brute: ['#ffb299', '#ff8f6e'],
      swarmling: ['#ffe999', '#ffe066'], aegis: ['#ffc2c2', '#ff9e9e'], wisp: ['#ffd1ea', '#ffb3d9'],
      raptor: ['#ffbcdb', '#ff8fb8'], mender: ['#e8d96e', '#c9bb4f'], splitter: ['#ffd7bf', '#ffc09e'],
      phase: ['#ffe9c9', '#ffd9a8'], mothership: ['#ffc2e2', '#ff9ecf'], colossus: ['#ffab93', '#ff7f5c'],
      leviathan: ['#ffd191', '#ffb85c'],
    },
    rim: '#fffbe8',
    muzzle: '#f5ffff',
  },
};

// ================= Meta upgrades (spent with stars) =================
export interface MetaNode { id: string; name: string; desc: string; cost: number; requires?: string; }
export const META: MetaNode[] = [
  { id: 'reactor1', name: 'Reactor I', desc: '+20% starting credits every level.', cost: 1 },
  { id: 'reactor2', name: 'Reactor II', desc: '+35% starting credits (total).', cost: 2, requires: 'reactor1' },
  { id: 'hull1', name: 'Hull Plating I', desc: '+5 base integrity.', cost: 1 },
  { id: 'hull2', name: 'Hull Plating II', desc: '+10 base integrity (total).', cost: 2, requires: 'hull1' },
  { id: 'fab', name: 'Fabricators', desc: 'All towers cost 10% less.', cost: 3 },
  { id: 'munitions', name: 'Munitions Lab', desc: 'All towers deal +10% damage.', cost: 3 },
  { id: 'orbital', name: 'Orbital Strike', desc: 'Unlock ability: aimed strike, heavy area damage that scales with the invasion. 30s cooldown.', cost: 2 },
  { id: 'stasis', name: 'Stasis Field', desc: 'Unlock ability: aimed field that slows everything 70% for 4s. 25s cooldown.', cost: 2 },
];

// ---------- Doctrines (Starhold 3.0 Phase 8) ----------
// A mutually-exclusive layer on top of the 8 META nodes: exactly one doctrine can be
// active at a time (or none), and switching the active one — once owned — is free and can
// happen on the pre-level Briefing screen. Buying is permanent, same currency as META (stars).
export interface DoctrineSpec { id: string; name: string; icon: string; cost: number; desc: string; }
export const DOCTRINES: DoctrineSpec[] = [
  { id: 'artillery', name: 'Artillery Doctrine', icon: '💥', cost: 3, desc: 'Splash radius +25%, splash damage +15%.' },
  { id: 'precision', name: 'Precision Doctrine', icon: '🎯', cost: 3, desc: 'All towers gain +10% critical chance (2.5× damage). Prism and Amp are excluded.' },
  { id: 'logistics', name: 'Logistics Doctrine', icon: '📦', cost: 3, desc: 'Start with +10% credits; supply drops arrive 20% more often.' },
];

// Draft size for a given level id, per TUNING.draft.sizeByLevel's ascending threshold table.
export function draftSizeForLevel(levelId: number): number {
  for (const [maxLevel, size] of TUNING.draft.sizeByLevel) if (levelId <= maxLevel) return size;
  return TUNING.draft.sizeByLevel[TUNING.draft.sizeByLevel.length - 1][1];
}

export const ABILITIES = {
  orbital: { id: 'orbital', name: 'Orbital', ico: '☄', cd: 30, radius: 95, dmg: 320 },
  stasis: { id: 'stasis', name: 'Stasis', ico: '❄', cd: 25, radius: 110, slow: 0.7, dur: 4 },
};

export const ZONES = [
  { name: 'Nebula Shallows', bg: '#171a33', nebula: ['#2b2f5e', '#3d2b58'], accent: '#a8e6cf',
    tagline: 'Where the invasion began — soft light, hard choices.' },
  { name: 'Ember Drift', bg: '#241726', nebula: ['#4a2440', '#54303a'], accent: '#ffd3b6',
    tagline: 'The nebula burns here. So do the aliens who follow you into it.' },
  { name: 'The Void Reach', bg: '#101d22', nebula: ['#1c3a41', '#252b52'], accent: '#a0d8ef',
    tagline: 'Past this point, nothing has ever come back to tell what waits.' },
];

// ---------- Background landmarks (Starhold 3.0 Phase 3) ----------
// Hand-authored, edge/corner-only silhouettes painted onto the cached background canvas —
// cosmetic, never gameplay-relevant. Coordinates are in the 1280x720 logical playfield.
// `s` is a 0.6-1.6 scale multiplier. Endless (id 99) has no fixed set — it seed-picks 2
// entries from this same table at buildBg() time instead (see game.ts).
export type LandmarkKind = 'planet' | 'moon' | 'derelict' | 'station' | 'comet';
export interface LandmarkSpec { kind: LandmarkKind; x: number; y: number; s: number }
export const LANDMARKS: Record<number, LandmarkSpec[]> = {
  1: [{ kind: 'planet', x: 1180, y: 90, s: 1.3 }, { kind: 'moon', x: 120, y: 640, s: 0.7 }],
  2: [{ kind: 'station', x: 1150, y: 620, s: 0.9 }, { kind: 'moon', x: 90, y: 100, s: 0.6 }],
  3: [{ kind: 'comet', x: 200, y: 80, s: 1.0 }, { kind: 'moon', x: 1200, y: 660, s: 0.8 }],
  4: [{ kind: 'planet', x: 80, y: 620, s: 1.2 }, { kind: 'comet', x: 1150, y: 100, s: 0.8 }],
  5: [{ kind: 'derelict', x: 1160, y: 120, s: 1.1 }, { kind: 'moon', x: 140, y: 620, s: 0.6 }],
  6: [{ kind: 'planet', x: 1190, y: 640, s: 1.4 }, { kind: 'comet', x: 150, y: 90, s: 0.7 }],
  7: [{ kind: 'station', x: 640, y: 60, s: 0.8 }, { kind: 'moon', x: 80, y: 660, s: 0.7 }],
  8: [{ kind: 'derelict', x: 90, y: 90, s: 0.9 }, { kind: 'moon', x: 1210, y: 650, s: 0.9 }],
  9: [{ kind: 'comet', x: 1180, y: 80, s: 1.1 }, { kind: 'derelict', x: 110, y: 640, s: 0.8 }],
  10: [{ kind: 'planet', x: 70, y: 90, s: 1.5 }, { kind: 'station', x: 1190, y: 650, s: 0.7 }],
  11: [{ kind: 'moon', x: 1200, y: 90, s: 1.0 }, { kind: 'comet', x: 100, y: 640, s: 0.9 }],
  12: [{ kind: 'station', x: 640, y: 680, s: 0.9 }, { kind: 'moon', x: 90, y: 80, s: 0.6 }],
  13: [{ kind: 'planet', x: 1200, y: 640, s: 1.3 }, { kind: 'derelict', x: 100, y: 100, s: 0.7 }],
  14: [{ kind: 'derelict', x: 640, y: 70, s: 1.0 }, { kind: 'comet', x: 1180, y: 640, s: 0.8 }],
  15: [{ kind: 'planet', x: 640, y: -60, s: 1.6 }, { kind: 'station', x: 120, y: 640, s: 0.8 }],
};

// helper for UI: air-targeting classification
export function airClass(spec: TowerSpec): 'no-air' | 'air' | 'air-bonus' | 'support' {
  const s = spec.stages[0];
  if (spec.kind === 'amp') return 'support';
  if (s.groundOnly) return 'no-air';
  if ((s.airMul || 1) > 1) return 'air-bonus';
  return 'air';
}

// Build-menu role chips (Phase 6.6): a compact "what does this tower do" tag pair, derived
// from the stage-0 spec so it reads the same for every tower regardless of upgrade path.
// `air` only fires for the notable cases (no air / air-bonus) — plain air coverage is the
// default and doesn't need a chip. `role` picks ONE tag even when a spec matches several
// fields (e.g. missile has both splash and airMul) — SPLASH/SLOW/BURN/CHAIN/SUPPORT/PIERCE,
// in that priority order.
export function roleChips(spec: TowerSpec): { air: 'no-air' | 'air-bonus' | null; role: 'splash' | 'slow' | 'burn' | 'chain' | 'support' | 'pierce' | null } {
  const s = spec.stages[0];
  const air = s.groundOnly ? 'no-air' : (s.airMul || 1) > 1 ? 'air-bonus' : null;
  let role: ReturnType<typeof roleChips>['role'] = null;
  if (spec.kind === 'amp') role = 'support';
  else if (s.splash || s.cluster) role = 'splash';
  else if (s.slow || s.aura) role = 'slow';
  else if (s.burnDps) role = 'burn';
  else if (s.chains) role = 'chain';
  else if (s.pierce) role = 'pierce';
  return { air, role };
}
