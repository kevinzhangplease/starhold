// ================= Levels =================
// Coordinates live in a 1280x720 logical playfield.
// Paths are polylines; ground enemies follow them, fliers cut straight to the base.

export interface WaveGroup { e: string; n: number; iv: number; d: number; p?: number }
export type Wave = WaveGroup[];

export interface LevelSpec {
  id: number;
  name: string;
  zone: number;              // 0..2
  paths: number[][][];       // one or more waypoint polylines
  asteroids?: { x: number; y: number; r: number }[];
  startCredits: number;
  baseHp: number;
  hpMul: number;
  waves: Wave[];
  newEnemy?: { id: string; hint: string };
  modifiers?: string[];      // level-identity modifiers (see MODIFIER_INFO in data.ts)
  challenges?: { id: string; param?: number }[]; // exactly 2 per level, L2+ (see CHALLENGE_POOL in data.ts)
}

const g = (e: string, n: number, iv = 0.9, d = 0, p = 0): WaveGroup => ({ e, n, iv, d, p });

export const LEVELS: LevelSpec[] = [
  // ---------------- ZONE 1 · Nebula Shallows ----------------
  {
    id: 1, name: 'First Contact', zone: 0, startCredits: 260, baseHp: 20, hpMul: 1,
    paths: [[[-40, 180], [300, 180], [300, 420], [640, 420], [640, 200], [980, 200], [980, 470], [1320, 470]]],
    waves: [
      [g('drone', 6, 1.2)],
      [g('drone', 9, 1.0)],
      [g('drone', 8, 1.0), g('dart', 4, 0.7, 5)],
      [g('dart', 10, 0.55)],
      [g('drone', 10, 0.8), g('dart', 8, 0.6, 4)],
      [g('drone', 14, 0.6), g('dart', 10, 0.5, 6)],
    ],
  },
  {
    id: 2, name: 'The Bend', zone: 0, challenges: [{ id: 'perfect_hull' }, { id: 'no_abilities' }], startCredits: 270, baseHp: 20, hpMul: 1.15,
    newEnemy: { id: 'swarmling', hint: 'Swarmlings are weak but come in floods. Splash helps.' },
    paths: [[[-40, 560], [420, 560], [420, 170], [860, 170], [860, 540], [1150, 540], [1150, 300], [1320, 300]]],
    waves: [
      [g('drone', 8, 1.0)],
      [g('swarmling', 12, 0.35)],
      [g('drone', 8, 0.9), g('swarmling', 12, 0.3, 5)],
      [g('dart', 10, 0.55), g('swarmling', 10, 0.35, 3)],
      [g('swarmling', 24, 0.28)],
      [g('drone', 12, 0.7), g('dart', 8, 0.5, 4)],
      [g('swarmling', 20, 0.3), g('drone', 12, 0.6, 4), g('dart', 8, 0.5, 9)],
    ],
  },
  {
    id: 3, name: 'Long Meander', zone: 0, challenges: [{ id: 'minimalist', param: 6 }, { id: 'never_sell' }], startCredits: 300, baseHp: 20, hpMul: 1.3,
    newEnemy: { id: 'brute', hint: 'Brutes soak damage and cost 2 integrity if they leak. Focus fire.' },
    paths: [[[-40, 120], [250, 120], [250, 360], [520, 360], [520, 140], [800, 140], [800, 430], [480, 430], [480, 610], [1000, 610], [1000, 330], [1320, 330]]],
    waves: [
      [g('drone', 10, 0.9)],
      [g('brute', 2, 3.0), g('drone', 8, 0.8, 2)],
      [g('swarmling', 18, 0.3)],
      [g('brute', 3, 2.5), g('dart', 10, 0.5, 3)],
      [g('drone', 14, 0.6), g('swarmling', 14, 0.3, 6)],
      [g('brute', 4, 2.0), g('swarmling', 16, 0.3, 4)],
      [g('brute', 5, 1.8), g('dart', 14, 0.4, 3), g('drone', 10, 0.6, 8)],
    ],
  },
  {
    id: 4, name: 'High Wind', zone: 0, challenges: [{ id: 'specialist', param: 2 }, { id: 'never_sell' }], modifiers: ['asteroids'], startCredits: 320, baseHp: 20, hpMul: 1.5,
    newEnemy: { id: 'wisp', hint: 'Wisps fly straight to your base, ignoring the road. Missiles hit hard against air.' },
    paths: [[[-40, 400], [340, 400], [340, 160], [700, 160], [700, 480], [1040, 480], [1040, 240], [1320, 240]]],
    waves: [
      [g('drone', 10, 0.8)],
      [g('wisp', 4, 1.5)],
      [g('drone', 10, 0.7), g('wisp', 5, 1.2, 4)],
      [g('brute', 3, 2.2), g('wisp', 6, 1.0, 2)],
      [g('swarmling', 20, 0.28), g('wisp', 6, 1.0, 5)],
      [g('wisp', 10, 0.7)],
      [g('brute', 4, 2.0), g('dart', 12, 0.45, 2), g('wisp', 8, 0.8, 6)],
      [g('drone', 16, 0.5), g('wisp', 10, 0.7, 3), g('brute', 3, 2.2, 8)],
    ],
  },
  {
    id: 5, name: 'The Mothership', zone: 0, challenges: [{ id: 'perfect_hull' }, { id: 'no_abilities' }], startCredits: 360, baseHp: 20, hpMul: 1.7,
    paths: [[[-40, 240], [380, 240], [380, 520], [760, 520], [760, 210], [1100, 210], [1100, 430], [1320, 430]]],
    waves: [
      [g('drone', 12, 0.7)],
      [g('wisp', 6, 1.0), g('dart', 10, 0.5, 2)],
      [g('brute', 4, 2.0), g('swarmling', 16, 0.3, 3)],
      [g('wisp', 8, 0.8), g('brute', 3, 2.2, 4)],
      [g('swarmling', 26, 0.25), g('dart', 12, 0.45, 5)],
      [g('brute', 6, 1.6), g('wisp', 8, 0.8, 5)],
      [g('drone', 18, 0.45), g('wisp', 10, 0.7, 4), g('brute', 4, 1.8, 9)],
      [g('mothership', 1, 0, 2), g('wisp', 8, 1.4, 6), g('dart', 12, 0.6, 10)],
    ],
  },

  // ---------------- ZONE 2 · Ember Drift ----------------
  {
    id: 6, name: 'Ember Gate', zone: 1, challenges: [{ id: 'speedrunner' }, { id: 'specialist', param: 2 }], modifiers: ['rich-veins'], startCredits: 340, baseHp: 20, hpMul: 1.5,
    newEnemy: { id: 'aegis', hint: 'Aegis shields regenerate if left alone. Keep hitting them.' },
    asteroids: [{ x: 520, y: 300, r: 46 }, { x: 860, y: 480, r: 54 }, { x: 300, y: 560, r: 40 }],
    paths: [[[-40, 160], [640, 160], [640, 400], [320, 400], [320, 620], [1000, 620], [1000, 320], [1320, 320]]],
    waves: [
      [g('drone', 12, 0.7), g('dart', 8, 0.5, 4)],
      [g('aegis', 4, 1.6)],
      [g('aegis', 5, 1.4), g('swarmling', 16, 0.3, 3)],
      [g('brute', 4, 1.8), g('wisp', 6, 0.9, 3)],
      [g('aegis', 6, 1.2), g('dart', 14, 0.4, 2)],
      [g('wisp', 10, 0.7), g('aegis', 4, 1.5, 4)],
      [g('swarmling', 30, 0.22), g('brute', 4, 1.8, 4)],
      [g('aegis', 8, 1.0), g('brute', 5, 1.6, 5), g('wisp', 8, 0.8, 9)],
    ],
  },
  {
    id: 7, name: 'Twin Lanes', zone: 1, challenges: [{ id: 'minimalist', param: 7 }, { id: 'no_abilities' }], startCredits: 380, baseHp: 20, hpMul: 2.3,
    newEnemy: { id: 'raptor', hint: 'Raptors are fast fliers. Do not let your anti-air lapse.' },
    paths: [
      [[-40, 170], [430, 170], [430, 330], [900, 330], [900, 200], [1320, 200]],
      [[-40, 570], [520, 570], [520, 430], [980, 430], [980, 560], [1320, 560]],
    ],
    waves: [
      [g('drone', 8, 0.8, 0, 0), g('drone', 8, 0.8, 0, 1)],
      [g('dart', 8, 0.5, 0, 0), g('swarmling', 14, 0.3, 1, 1)],
      [g('raptor', 5, 1.0)],
      [g('aegis', 4, 1.4, 0, 0), g('brute', 3, 2.0, 1, 1)],
      [g('raptor', 7, 0.8), g('drone', 10, 0.6, 2, 0), g('drone', 10, 0.6, 2, 1)],
      [g('swarmling', 18, 0.26, 0, 0), g('swarmling', 18, 0.26, 0, 1)],
      [g('brute', 4, 1.7, 0, 0), g('aegis', 5, 1.3, 2, 1), g('raptor', 6, 0.9, 5)],
      [g('dart', 16, 0.35, 0, 0), g('dart', 16, 0.35, 0, 1), g('wisp', 8, 0.8, 4)],
      [g('brute', 6, 1.4, 0, 0), g('brute', 6, 1.4, 0, 1), g('raptor', 9, 0.7, 6)],
    ],
  },
  {
    id: 8, name: 'The Coil', zone: 1, challenges: [{ id: 'perfect_hull' }, { id: 'never_sell' }], modifiers: ['meteors'], startCredits: 400, baseHp: 20, hpMul: 2.7,
    newEnemy: { id: 'mender', hint: 'Menders heal everything around them. Kill them first — set towers to target Strong.' },
    paths: [[[-40, 360], [150, 360], [150, 140], [450, 140], [450, 600], [750, 600], [750, 140], [1050, 140], [1050, 600], [1320, 600]]],
    waves: [
      [g('drone', 14, 0.6), g('aegis', 3, 1.6, 4)],
      [g('mender', 2, 3.0), g('drone', 12, 0.6, 1)],
      [g('brute', 4, 1.7), g('mender', 2, 3.0, 2)],
      [g('raptor', 7, 0.8), g('swarmling', 20, 0.26, 3)],
      [g('mender', 3, 2.4), g('brute', 4, 1.6, 1), g('dart', 12, 0.4, 5)],
      [g('aegis', 7, 1.1), g('wisp', 8, 0.8, 4)],
      [g('mender', 3, 2.2), g('aegis', 6, 1.1, 2), g('swarmling', 20, 0.24, 6)],
      [g('brute', 7, 1.3), g('mender', 3, 2.2, 3), g('raptor', 8, 0.7, 7)],
      [g('drone', 24, 0.35), g('mender', 4, 2.0, 4), g('brute', 5, 1.5, 8)],
    ],
  },
  {
    id: 9, name: 'Shatterfield', zone: 1, challenges: [{ id: 'speedrunner' }, { id: 'specialist', param: 3 }], startCredits: 420, baseHp: 20, hpMul: 3.1,
    newEnemy: { id: 'splitter', hint: 'Splitters burst into swarmlings on death. Pop them where your splash can mop up.' },
    asteroids: [{ x: 380, y: 250, r: 42 }, { x: 700, y: 500, r: 58 }, { x: 950, y: 250, r: 44 }, { x: 200, y: 540, r: 38 }, { x: 1120, y: 520, r: 36 }],
    paths: [[[-40, 380], [300, 380], [300, 150], [820, 150], [820, 380], [560, 380], [560, 620], [1180, 620], [1180, 380], [1320, 380]]],
    waves: [
      [g('splitter', 3, 2.0), g('drone', 10, 0.6, 2)],
      [g('splitter', 4, 1.7), g('dart', 10, 0.45, 3)],
      [g('aegis', 6, 1.2), g('raptor', 6, 0.9, 4)],
      [g('splitter', 6, 1.4), g('swarmling', 16, 0.26, 4)],
      [g('brute', 5, 1.5), g('mender', 2, 2.6, 2)],
      [g('splitter', 6, 1.3), g('wisp', 10, 0.7, 3)],
      [g('swarmling', 34, 0.2), g('aegis', 6, 1.1, 5)],
      [g('splitter', 8, 1.1), g('mender', 3, 2.2, 3), g('raptor', 8, 0.7, 6)],
      [g('brute', 8, 1.2), g('splitter', 6, 1.3, 4), g('dart', 16, 0.35, 8)],
      [g('splitter', 10, 1.0), g('mender', 4, 2.0, 2), g('brute', 6, 1.3, 6), g('wisp', 10, 0.7, 10)],
    ],
  },
  {
    id: 10, name: 'The Colossus', zone: 1, challenges: [{ id: 'perfect_hull' }, { id: 'hard_plus' }], modifiers: ['asteroids', 'rich-veins'], startCredits: 460, baseHp: 20, hpMul: 3.6,
    paths: [[[-40, 520], [360, 520], [360, 200], [720, 200], [720, 520], [1040, 520], [1040, 260], [1320, 260]]],
    waves: [
      [g('drone', 16, 0.5), g('aegis', 4, 1.4, 4)],
      [g('raptor', 8, 0.8), g('splitter', 4, 1.6, 2)],
      [g('brute', 6, 1.4), g('mender', 3, 2.2, 3)],
      [g('swarmling', 30, 0.22), g('wisp', 8, 0.8, 4)],
      [g('aegis', 8, 1.0), g('splitter', 5, 1.4, 5)],
      [g('brute', 7, 1.2), g('raptor', 9, 0.7, 4), g('mender', 3, 2.0, 7)],
      [g('splitter', 8, 1.1), g('aegis', 8, 1.0, 4), g('dart', 16, 0.35, 8)],
      [g('drone', 26, 0.3), g('brute', 6, 1.3, 5), g('wisp', 12, 0.6, 8)],
      [g('colossus', 1, 0, 2), g('aegis', 6, 1.8, 8), g('raptor', 8, 1.0, 14)],
    ],
  },

  // ---------------- ZONE 3 · The Void Reach ----------------
  {
    id: 11, name: 'Void Door', zone: 2, challenges: [{ id: 'minimalist', param: 8 }, { id: 'no_abilities' }], startCredits: 440, baseHp: 20, hpMul: 4.2,
    newEnemy: { id: 'phase', hint: 'Phasers blink out of reality — untargetable while shimmering. Slows still stick.' },
    paths: [[[-40, 200], [500, 200], [500, 460], [180, 460], [180, 640], [820, 640], [820, 360], [1120, 360], [1120, 180], [1320, 180]]],
    waves: [
      [g('phase', 4, 1.6), g('drone', 12, 0.5, 2)],
      [g('phase', 6, 1.3), g('dart', 12, 0.4, 3)],
      [g('aegis', 7, 1.1), g('raptor', 8, 0.8, 3)],
      [g('phase', 7, 1.1), g('splitter', 5, 1.4, 4)],
      [g('brute', 7, 1.2), g('mender', 3, 2.0, 3)],
      [g('phase', 8, 1.0), g('wisp', 10, 0.7, 4)],
      [g('swarmling', 36, 0.19), g('splitter', 6, 1.3, 6)],
      [g('phase', 9, 0.9), g('aegis', 8, 1.0, 3), g('raptor', 9, 0.7, 7)],
      [g('brute', 9, 1.1), g('phase', 8, 1.0, 4), g('mender', 4, 1.8, 8)],
      [g('phase', 12, 0.8), g('splitter', 8, 1.1, 4), g('brute', 6, 1.2, 9), g('wisp', 12, 0.6, 12)],
    ],
  },
  {
    id: 12, name: 'Crossfire', zone: 2, challenges: [{ id: 'speedrunner' }, { id: 'never_sell' }], modifiers: ['ion-storms'], startCredits: 480, baseHp: 20, hpMul: 4.9,
    paths: [
      [[-40, 150], [640, 150], [640, 620], [1320, 620]],
      [[-40, 620], [640, 620], [640, 150], [1320, 150]],
    ],
    waves: [
      [g('drone', 10, 0.55, 0, 0), g('drone', 10, 0.55, 0, 1)],
      [g('phase', 6, 1.1, 0, 0), g('aegis', 5, 1.2, 1, 1)],
      [g('splitter', 5, 1.3, 0, 0), g('splitter', 5, 1.3, 0, 1)],
      [g('raptor', 12, 0.6), g('mender', 3, 2.0, 3, 0)],
      [g('brute', 6, 1.2, 0, 0), g('brute', 6, 1.2, 0, 1)],
      [g('swarmling', 26, 0.2, 0, 0), g('swarmling', 26, 0.2, 0, 1)],
      [g('aegis', 8, 0.9, 0, 0), g('phase', 8, 0.9, 1, 1), g('wisp', 10, 0.6, 5)],
      [g('mender', 4, 1.8, 0, 0), g('brute', 7, 1.1, 1, 1), g('raptor', 10, 0.6, 6)],
      [g('splitter', 8, 1.0, 0, 0), g('splitter', 8, 1.0, 0, 1), g('phase', 8, 0.9, 5)],
      [g('brute', 9, 1.0, 0, 0), g('aegis', 9, 0.9, 1, 1), g('mender', 4, 1.8, 6), g('raptor', 12, 0.55, 9)],
    ],
  },
  {
    id: 13, name: 'Long Night', zone: 2, challenges: [{ id: 'specialist', param: 2 }, { id: 'perfect_hull' }], modifiers: ['meteors', 'rich-veins'], startCredits: 520, baseHp: 20, hpMul: 5.7,
    paths: [[[-40, 640], [180, 640], [180, 140], [420, 140], [420, 540], [660, 540], [660, 140], [900, 140], [900, 540], [1140, 540], [1140, 140], [1320, 140]]],
    waves: [
      [g('drone', 20, 0.4), g('dart', 12, 0.35, 4)],
      [g('phase', 8, 0.9), g('swarmling', 24, 0.2, 3)],
      [g('aegis', 9, 0.9), g('raptor', 10, 0.6, 4)],
      [g('brute', 8, 1.1), g('mender', 4, 1.8, 2)],
      [g('splitter', 9, 1.0), g('wisp', 12, 0.55, 4)],
      [g('swarmling', 44, 0.16), g('phase', 8, 0.9, 5)],
      [g('brute', 10, 1.0), g('aegis', 9, 0.85, 4)],
      [g('raptor', 16, 0.45), g('wisp', 12, 0.55, 5)],
      [g('mender', 5, 1.6), g('splitter', 10, 0.9, 2), g('brute', 8, 1.0, 7)],
      [g('phase', 12, 0.75), g('aegis', 10, 0.8, 4), g('dart', 20, 0.3, 8)],
      [g('brute', 12, 0.9), g('mender', 5, 1.6, 4), g('splitter', 10, 0.9, 8), g('raptor', 14, 0.5, 12)],
    ],
  },
  {
    id: 14, name: 'The Gauntlet', zone: 2, challenges: [{ id: 'hard_plus' }, { id: 'speedrunner' }], modifiers: ['meteors', 'ion-storms'], startCredits: 560, baseHp: 20, hpMul: 6.6,
    asteroids: [{ x: 640, y: 180, r: 50 }, { x: 400, y: 560, r: 46 }, { x: 900, y: 560, r: 46 }],
    paths: [[[-40, 370], [400, 370], [640, 370], [900, 370], [1320, 370]]],
    waves: [
      [g('drone', 20, 0.35), g('brute', 4, 1.4, 3)],
      [g('phase', 9, 0.8), g('aegis', 7, 1.0, 2)],
      [g('splitter', 8, 1.0), g('swarmling', 26, 0.18, 4)],
      [g('brute', 9, 1.0), g('mender', 4, 1.7, 2)],
      [g('raptor', 14, 0.5), g('wisp', 12, 0.5, 4)],
      [g('aegis', 11, 0.75), g('phase', 9, 0.8, 4)],
      [g('brute', 11, 0.9), g('splitter', 9, 0.95, 4)],
      [g('swarmling', 56, 0.13), g('mender', 5, 1.5, 4)],
      [g('phase', 12, 0.7), g('raptor', 14, 0.45, 4), g('brute', 8, 1.0, 8)],
      [g('aegis', 12, 0.7), g('mender', 6, 1.4, 3), g('splitter', 10, 0.9, 7)],
      [g('brute', 14, 0.8), g('phase', 12, 0.7, 5), g('wisp', 16, 0.4, 9), g('mender', 5, 1.5, 12)],
    ],
  },
  {
    id: 15, name: 'The Leviathan', zone: 2, challenges: [{ id: 'perfect_hull' }, { id: 'hard_plus' }], modifiers: ['asteroids', 'meteors', 'ion-storms'], startCredits: 620, baseHp: 20, hpMul: 7.6,
    paths: [[[-40, 160], [460, 160], [460, 420], [200, 420], [200, 620], [760, 620], [760, 300], [1040, 300], [1040, 520], [1320, 520]]],
    waves: [
      [g('drone', 22, 0.32), g('dart', 14, 0.3, 4)],
      [g('phase', 10, 0.75), g('aegis', 8, 0.9, 3)],
      [g('splitter', 10, 0.9), g('raptor', 12, 0.5, 4)],
      [g('brute', 10, 0.95), g('mender', 5, 1.6, 2)],
      [g('swarmling', 50, 0.14), g('wisp', 14, 0.45, 5)],
      [g('aegis', 12, 0.7), g('phase', 10, 0.75, 4)],
      [g('brute', 12, 0.85), g('splitter', 10, 0.9, 4), g('mender', 5, 1.5, 8)],
      [g('raptor', 18, 0.4), g('wisp', 14, 0.45, 5)],
      [g('phase', 14, 0.65), g('brute', 10, 0.9, 5), g('aegis', 10, 0.75, 9)],
      [g('mender', 6, 1.4), g('splitter', 12, 0.8, 3), g('swarmling', 40, 0.15, 8)],
      [g('brute', 14, 0.8), g('mender', 6, 1.4, 4), g('raptor', 16, 0.4, 8), g('phase', 12, 0.7, 12)],
      [g('leviathan', 1, 0, 2), g('aegis', 8, 1.6, 10), g('splitter', 8, 1.6, 18), g('raptor', 12, 0.9, 26)],
    ],
  },
];

// Endless mode: its own arena; waves are generated in game.ts.
export const ENDLESS_LEVEL: LevelSpec = {
  id: 99, name: 'Endless Drift', zone: 2, startCredits: 420, baseHp: 20, hpMul: 1,
  paths: [[[-40, 200], [360, 200], [360, 500], [700, 500], [700, 220], [1020, 220], [1020, 520], [1320, 520]]],
  waves: [],
};
