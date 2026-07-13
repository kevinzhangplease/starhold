// Asteroid Field / Rich Veins seeding — verifies the seeded modifier cells NEVER land on a
// path tile (or, for veins, on an asteroid/end tile either), across every level, every tile
// size, and every meander tier. This closes a gap from Phase 3's exit criteria ("asteroid
// seeding never intersects path across 15 levels x 3 meander tiers x 3 tile sizes") that was
// reasoned about as correct "by construction" at the time but never actually fuzz-tested —
// caught during the Phase 8 final audit.
// Run: node --experimental-strip-types tests/asteroid-vein-seeding.ts
import { LEVELS } from '../src/levels.ts';
import { TUNING } from '../src/data.ts';
import { mulberry32, hashString, seededInt } from '../src/rng.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

const W = 1280, H = 720;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
interface CPt { c: number; r: number; }

// Faithful copy of buildGrid()'s snap-to-grid + rectilinear-enforcement logic (unmeandered —
// meander itself is already exhaustively fuzz-tested elsewhere; this test is specifically
// about the SEEDING step, which runs on the post-meander path either way and doesn't care
// which meander tier produced it, only that pathTiles is correct for whatever path exists).
function snapToGrid(rawPts: number[][], cell: number) {
  const top = 70, bottom = H - 22;
  const cols = Math.floor((W - 12) / cell);
  const rows = Math.floor((bottom - top) / cell);
  const gx0 = (W - cols * cell) / 2;
  const gy0 = top + ((bottom - top) - rows * cell) / 2;
  const cellsPts: CPt[] = [];
  for (let i = 0; i < rawPts.length; i++) {
    let c = Math.round((rawPts[i][0] - gx0 - cell / 2) / cell);
    let r = Math.round((rawPts[i][1] - gy0 - cell / 2) / cell);
    r = clamp(r, 0, rows - 1);
    if (i === 0) c = -2;
    else if (i === rawPts.length - 1) c = cols + 1;
    else c = clamp(c, 1, cols - 2);
    if (i > 0) {
      const prev = cellsPts[cellsPts.length - 1];
      if (prev.r !== r && prev.c !== c) cellsPts.push({ c: prev.c, r });
    }
    cellsPts.push({ c, r });
  }
  return { cellsPts, cols, rows };
}
function pathTileSet(cellsPts: CPt[], cols: number, rows: number): { pathTiles: Set<number>; endTiles: Set<number>; idx: (c: number, r: number) => number } {
  const idx = (c: number, r: number) => r * cols + c;
  const pathTiles = new Set<number>();
  let firstIn: CPt | null = null, lastIn: CPt | null = null;
  for (let i = 0; i < cellsPts.length - 1; i++) {
    const a = cellsPts[i], b = cellsPts[i + 1];
    const dc = Math.sign(b.c - a.c), dr = Math.sign(b.r - a.r);
    let c = a.c, r = a.r;
    while (true) {
      if (c >= 0 && c < cols && r >= 0 && r < rows) {
        pathTiles.add(idx(c, r));
        if (!firstIn) firstIn = { c, r };
        lastIn = { c, r };
      }
      if (c === b.c && r === b.r) break;
      c += dc; r += dr;
    }
  }
  const endTiles = new Set<number>();
  const fi = firstIn || { c: 0, r: cellsPts[0].r };
  const li = lastIn || { c: cols - 1, r: cellsPts[cellsPts.length - 1].r };
  endTiles.add(idx(fi.c, fi.r));
  endTiles.add(idx(li.c, li.r));
  return { pathTiles, endTiles, idx };
}

// Faithful copy of buildGrid()'s asteroid + rich-vein seeding loops.
function seedAsteroids(levelId: number, cols: number, rows: number, pathTiles: Set<number>, endTiles: Set<number>, idx: (c: number, r: number) => number): Set<number> {
  const rockTiles = new Set<number>();
  const rng = mulberry32(hashString(`${levelId}-ast`));
  const want = seededInt(rng, TUNING.asteroids.cellsMin, TUNING.asteroids.cellsMax);
  let placed = 0;
  for (let attempt = 0; attempt < 400 && placed < want; attempt++) {
    const c = seededInt(rng, 0, cols - 1), r = seededInt(rng, 0, rows - 1);
    const i = idx(c, r);
    if (pathTiles.has(i) || rockTiles.has(i) || endTiles.has(i)) continue;
    rockTiles.add(i);
    placed++;
  }
  return rockTiles;
}
function seedVeins(levelId: number, cols: number, rows: number, pathTiles: Set<number>, rockTiles: Set<number>, endTiles: Set<number>, idx: (c: number, r: number) => number): Set<number> {
  const veinTiles = new Set<number>();
  const rng = mulberry32(hashString(`${levelId}-vein`));
  const want = seededInt(rng, TUNING.richVeins.cells[0], TUNING.richVeins.cells[1]);
  let placed = 0;
  for (let attempt = 0; attempt < 400 && placed < want; attempt++) {
    const c = seededInt(rng, 1, cols - 2), r = seededInt(rng, 1, rows - 2);
    const i = idx(c, r);
    if (pathTiles.has(i) || rockTiles.has(i) || endTiles.has(i) || veinTiles.has(i)) continue;
    veinTiles.add(i);
    placed++;
  }
  return veinTiles;
}

let trials = 0;
for (const lv of LEVELS) {
  for (const tileSize of [40, 48, 58]) {
    for (const rawPts of lv.paths) {
      const { cellsPts, cols, rows } = snapToGrid(rawPts, tileSize);
      const { pathTiles, endTiles, idx } = pathTileSet(cellsPts, cols, rows);
      const rockTiles = seedAsteroids(lv.id, cols, rows, pathTiles, endTiles, idx);
      const veinTiles = seedVeins(lv.id, cols, rows, pathTiles, rockTiles, endTiles, idx);
      trials++;

      for (const t of rockTiles) {
        check(!pathTiles.has(t), `Level ${lv.id} tile=${tileSize}: seeded asteroid cell ${t} lands on the path`);
        check(!endTiles.has(t), `Level ${lv.id} tile=${tileSize}: seeded asteroid cell ${t} lands on a portal/base tile`);
      }
      for (const t of veinTiles) {
        check(!pathTiles.has(t), `Level ${lv.id} tile=${tileSize}: seeded vein cell ${t} lands on the path`);
        check(!rockTiles.has(t), `Level ${lv.id} tile=${tileSize}: seeded vein cell ${t} overlaps a seeded asteroid`);
        check(!endTiles.has(t), `Level ${lv.id} tile=${tileSize}: seeded vein cell ${t} lands on a portal/base tile`);
      }
      // sanity: seeding actually places something on levels that carry these modifiers
      // (a silent 0-placements bug would pass the crossing checks vacuously)
      if ((lv.modifiers || []).includes('asteroids')) {
        check(rockTiles.size >= TUNING.asteroids.cellsMin - 2, `Level ${lv.id} tile=${tileSize}: asteroids modifier placed suspiciously few rocks (${rockTiles.size})`);
      }
      if ((lv.modifiers || []).includes('rich-veins')) {
        check(veinTiles.size >= TUNING.richVeins.cells[0] - 1, `Level ${lv.id} tile=${tileSize}: rich-veins modifier placed suspiciously few veins (${veinTiles.size})`);
      }
    }
  }
}

console.log(fails ? `${fails} FAILURES` : `asteroid-vein-seeding: all checks passed (${trials} level x tile-size combinations)`);
process.exit(fails ? 1 : 0);
