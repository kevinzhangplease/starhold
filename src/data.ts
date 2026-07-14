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
  combo: 2, challenges: 2, interest: 3, cells: 3, drops: 4, mod_asteroids: 4,
  elites: 5, boss_theater: 5, mutators: 6, mod_veins: 6, nova: 7,
  mod_meteors: 8, mutators_hard: 9, boss_phase2: 10, mod_combo: 10, mod_ionstorms: 12,
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
    id: 'pulse', name: 'Pulse', color: '#a8e6cf', color2: '#5fae92', kind: 'bullet', hotkey: '1', size: 17,
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
        T({ name: 'Star Lance', desc: 'Pierces 3 enemies. 25% chance to deal 2.5x critical damage.', cost: 330, dmg: 150, rate: 0.75, range: 4, pierce: 3, crit: 0.25 }),
      ],
      [
        T({ name: 'Frost Rounds', desc: 'Shots slow the target by 25% for a short time.', cost: 220, dmg: 22, rate: 3.2, range: 2, slow: 0.25, slowDur: 1.2 }),
        T({ name: 'Winterspray', desc: 'Increases fire rate and slow strength to 35%.', cost: 310, dmg: 30, rate: 4.2, range: 2, slow: 0.35, slowDur: 1.5 }),
      ],
    ],
  },
  {
    id: 'mortar', name: 'Mortar', color: '#ffd3b6', color2: '#d19a72', kind: 'mortar', hotkey: '2', size: 19,
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
    id: 'cryo', name: 'Cryo', color: '#a0d8ef', color2: '#6fa5c4', kind: 'cryo', hotkey: '3', size: 17,
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
    id: 'missile', name: 'Missile', color: '#ffb3c6', color2: '#c97c92', kind: 'missile', hotkey: '4', size: 18,
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
        T({ name: 'Nova Torpedo', desc: 'Further increases damage and splash radius.', cost: 390, dmg: 330, rate: 0.4, range: 3, splash: 82, airMul: 1.6 }),
      ],
      [
        T({ name: 'Interceptor', desc: 'Increases damage vs flying enemies to 3.2x and increases fire rate.', cost: 260, dmg: 30, rate: 1.5, range: 3, splash: 20, airMul: 3.2 }),
        T({ name: 'Skyreaper', desc: 'Increases damage vs flying enemies to 4x and increases fire rate further.', cost: 360, dmg: 40, rate: 1.7, range: 4, splash: 22, airMul: 4 }),
      ],
    ],
  },
  {
    id: 'tesla', name: 'Tesla', color: '#fff3b0', color2: '#cbbd72', kind: 'tesla', hotkey: '5', size: 17,
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
    id: 'amp', name: 'Amp', color: '#c5b3f6', color2: '#9583c9', kind: 'amp', hotkey: '6', size: 16,
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
    id: 'prism', name: 'Prism', color: '#ff8fa3', color2: '#c46579', kind: 'prism', hotkey: '7', size: 17,
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
    id: 'ray', name: 'Ray', color: '#cdeb8b', color2: '#93b25c', kind: 'ray', hotkey: '8', size: 17,
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
        T({ name: 'Farlance', desc: 'Further increases range and damage.', cost: 370, dmg: 95, rate: 0.8, range: 4, rayWidth: 7 }),
      ],
    ],
  },
  {
    id: 'flame', name: 'Flame', color: '#ffb37d', color2: '#c97f4a', kind: 'flame', hotkey: '9', size: 17,
    blurb: 'Short-range cone that sets aliens on fire.',
    stages: [
      T({ name: 'Flame Mk I', desc: 'Fires a short cone of fire that ignites enemies, dealing damage over time.', cost: 120, dmg: 4, rate: 1.4, range: 1, burnDps: 14, burnDur: 2.5 }),
      T({ name: 'Flame Mk II', desc: 'Increases burn damage.', cost: 100, dmg: 6, rate: 1.5, range: 1, burnDps: 24, burnDur: 2.5 }),
      T({ name: 'Flame Mk III', desc: 'Increases range and burn damage.', cost: 155, dmg: 9, rate: 1.6, range: 2, burnDps: 38, burnDur: 3 }),
    ],
    branches: [
      [
        T({ name: 'Inferno', desc: 'Greatly increases burn damage.', cost: 250, dmg: 14, rate: 1.7, range: 2, burnDps: 72, burnDur: 3 }),
        T({ name: 'Hellmouth', desc: 'Further increases burn damage.', cost: 350, dmg: 20, rate: 1.8, range: 2, burnDps: 125, burnDur: 3.5 }),
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
    id: 'sentinel', name: 'Sentinel', color: '#e3b8f9', color2: '#a97fc9', kind: 'bullet', hotkey: '0', size: 16,
    blurb: 'Covers half the map. Light hits, huge reach.',
    stages: [
      T({ name: 'Sentinel Mk I', desc: 'Fires at very long range with modest damage.', cost: 110, dmg: 15, rate: 1.0, range: 4 }),
      T({ name: 'Sentinel Mk II', desc: 'Increases damage.', cost: 95, dmg: 25, rate: 1.05, range: 4 }),
      T({ name: 'Sentinel Mk III', desc: 'Increases damage and range.', cost: 150, dmg: 38, rate: 1.1, range: 5 }),
    ],
    branches: [
      [
        T({ name: 'Farsight', desc: 'Increases range and damage. 30% chance to deal 2.5x critical damage.', cost: 260, dmg: 72, rate: 0.85, range: 6, crit: 0.3 }),
        T({ name: 'Star Sentinel', desc: 'Further increases damage and critical chance to 40%.', cost: 360, dmg: 120, rate: 0.85, range: 6, crit: 0.4 }),
      ],
      [
        T({ name: 'Rapid Sentinel', desc: 'Trades damage per shot for a much higher fire rate.', cost: 250, dmg: 34, rate: 2.6, range: 5 }),
        T({ name: 'Storm Sentinel', desc: 'Further increases fire rate and damage.', cost: 340, dmg: 44, rate: 3.6, range: 5 }),
      ],
      [
        T({ name: 'Warden', desc: 'Shots slow the target by 30% for a short time.', cost: 250, dmg: 28, rate: 1.0, range: 5, slow: 0.3, slowDur: 1.4 }),
        T({ name: 'High Warden', desc: 'Increases range and slow to 40%.', cost: 340, dmg: 42, rate: 1.05, range: 6, slow: 0.4, slowDur: 1.6 }),
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
  drone:    { id: 'drone', shape: 'circle', name: 'Drone', desc: 'The standard invader. No tricks — just keeps coming.', hp: 42, speed: 52, reward: 8, size: 13, color: '#b7c4ff', color2: '#7f8cd6', leak: 1, eyes: 1, counters: ['pulse', 'tesla'] },
  dart:     { id: 'dart', shape: 'slim', name: 'Dart', desc: 'Fast and fragile. Slips past slow-firing towers.', hp: 26, speed: 98, reward: 9, size: 10, color: '#9ff2e0', color2: '#5fbfa9', leak: 1, eyes: 2, counters: ['pulse', 'cryo'] },
  brute:    { id: 'brute', shape: 'square', name: 'Brute', desc: 'Slow, heavily armored, and costs 2 integrity if it leaks. Focus fire.', hp: 300, speed: 30, reward: 24, size: 20, color: '#ffb9a3', color2: '#c97f68', leak: 2, eyes: 1, counters: ['prism', 'mortar'] },
  swarmling:{ id: 'swarmling', shape: 'circle', name: 'Swarmling', desc: 'Tiny and weak, but arrives in floods. Splash and chain damage shine here.', hp: 12, speed: 74, reward: 3, size: 7.5, color: '#ffe08f', color2: '#c9a94f', leak: 1, eyes: 1, counters: ['mortar', 'tesla', 'ray'] },
  aegis:    { id: 'aegis', shape: 'hex', name: 'Aegis', desc: 'Carries a shield that regenerates if left alone for a few seconds. Keep hitting it.', hp: 130, speed: 44, reward: 20, size: 15, color: '#9fd0ff', color2: '#6e97c9', leak: 1, shield: 0.9, eyes: 1, counters: ['prism', 'pulse'] },
  wisp:     { id: 'wisp', shape: 'circle', name: 'Wisp', desc: 'Flies straight to your base, ignoring the road entirely. Needs anti-air coverage.', hp: 55, speed: 62, reward: 12, size: 12, color: '#e3c8ff', color2: '#a98cd6', leak: 1, flying: true, eyes: 1, counters: ['missile', 'sentinel'] },
  raptor:   { id: 'raptor', shape: 'slim', name: 'Raptor', desc: 'A fast flier. If your anti-air lapses, these punish you first.', hp: 40, speed: 118, reward: 14, size: 11, color: '#ffc2e5', color2: '#c983ab', leak: 1, flying: true, eyes: 2, counters: ['missile', 'sentinel'] },
  mender:   { id: 'mender', shape: 'circle', name: 'Mender', desc: 'Heals everything around it in pulses. Kill it first — set towers to target Strong.', hp: 150, speed: 38, reward: 26, size: 15, color: '#c0f5b3', color2: '#84bd77', leak: 1, healAura: 14, eyes: 1, counters: ['sentinel', 'prism'] },
  splitter: { id: 'splitter', shape: 'lumpy', name: 'Splitter', desc: 'Bursts into four swarmlings on death. Pop them where your splash can mop up.', hp: 110, speed: 48, reward: 16, size: 16, color: '#ffd9f2', color2: '#c996b6', leak: 1, splits: { id: 'swarmling', count: 4 }, eyes: 3, counters: ['mortar', 'tesla'] },
  phase:    { id: 'phase', shape: 'diamond', name: 'Phaser', desc: 'Periodically blinks out of reality — untargetable while shimmering. Slow fields still stick.', hp: 95, speed: 58, reward: 22, size: 13, color: '#b0fff4', color2: '#6fc4b8', leak: 1, phase: true, eyes: 1, counters: ['cryo', 'flame'] },
  // ------- bosses -------
  mothership: {
    id: 'mothership', shape: 'circle', name: 'THE MOTHERSHIP', desc: 'Zone 1 boss. A flying fortress that continually deploys Wisps as it drifts toward your base.', hp: 2600, speed: 17, reward: 250, size: 34,
    color: '#d7b6ff', color2: '#9a79cf', leak: 10, flying: true, boss: true,
    spawnMinion: { id: 'wisp', every: 6, count: 2 }, eyes: 3, counters: ['missile', 'sentinel'],
  },
  colossus: {
    id: 'colossus', shape: 'square', name: 'THE COLOSSUS', desc: 'Zone 2 boss. Half its bulk is regenerating shield, and its EMP pulse disables nearby towers.', hp: 8000, speed: 14, reward: 400, size: 38,
    color: '#ffb59b', color2: '#c47a5f', leak: 15, boss: true, shield: 0.5, emp: 9, eyes: 1, counters: ['prism', 'mortar'],
  },
  leviathan: {
    id: 'leviathan', shape: 'hex', name: 'THE LEVIATHAN', desc: 'The final boss. Shielded, EMP-armed, and spawns Splitters. Bring everything you have.', hp: 16000, speed: 13, reward: 700, size: 42,
    color: '#9fe8ff', color2: '#5da8c4', leak: 20, boss: true, shield: 0.35,
    spawnMinion: { id: 'splitter', every: 8, count: 1 }, emp: 12, eyes: 5, counters: ['prism', 'missile'],
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

// helper for UI: air-targeting classification
export function airClass(spec: TowerSpec): 'no-air' | 'air' | 'air-bonus' | 'support' {
  const s = spec.stages[0];
  if (spec.kind === 'amp') return 'support';
  if (s.groundOnly) return 'no-air';
  if ((s.airMul || 1) > 1) return 'air-bonus';
  return 'air';
}
