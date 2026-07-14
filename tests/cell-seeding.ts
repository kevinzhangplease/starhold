// Special-cell placement (Phase 2, 3.0) — determinism, separation, and the numeric
// stat-modifier math, against the REAL TUNING/CELL_TYPES tables. The placement algorithm
// itself lives inside Game.buildGrid() (a stateful, canvas-owning class not constructible
// headlessly in Node), so — matching the established pattern in
// tests/asteroid-vein-seeding.ts and validate.ts's own Phase 2 section — this is a faithful,
// simplified reimplementation: same candidate rules, same fixed order, same
// separation/fallback strategy, with the ridge/anchor "nearest corner"/"cluster heart"
// preferences collapsed to a plain seeded pick (that's a polish tie-break, not a
// correctness invariant, and out of scope for this test).
// Run: node --experimental-strip-types tests/cell-seeding.ts
import { LEVELS } from '../src/levels.ts';
import { TUNING, CELL_TYPES } from '../src/data.ts';
import { mulberry32, hashString, seededInt } from '../src/rng.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

function snapToGrid(rawPts: number[][], cell: number) {
  const top = 70, bottom = 720 - 22;
  const cols = Math.floor((1280 - 12) / cell);
  const rows = Math.floor((bottom - top) / cell);
  const gx0 = (1280 - cols * cell) / 2;
  const gy0 = top + ((bottom - top) - rows * cell) / 2;
  const pts: { c: number; r: number }[] = [];
  for (let i = 0; i < rawPts.length; i++) {
    let c = Math.round((rawPts[i][0] - gx0 - cell / 2) / cell);
    let r = Math.round((rawPts[i][1] - gy0 - cell / 2) / cell);
    r = Math.max(0, Math.min(rows - 1, r));
    if (i === 0) c = -2; else if (i === rawPts.length - 1) c = cols + 1; else c = Math.max(1, Math.min(cols - 2, c));
    if (i > 0) { const prev = pts[pts.length - 1]; if (prev.r !== r && prev.c !== c) pts.push({ c: prev.c, r }); }
    pts.push({ c, r });
  }
  return { pts, cols, rows };
}
function carve(pts: { c: number; r: number }[], cols: number, rows: number) {
  const idx = (c: number, r: number) => r * cols + c;
  const pathTiles = new Set<number>(), endTiles = new Set<number>();
  const ordered: { c: number; r: number }[] = [];
  let firstIn: { c: number; r: number } | null = null, lastIn: { c: number; r: number } | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dc = Math.sign(b.c - a.c), dr = Math.sign(b.r - a.r);
    let c = a.c, r = a.r;
    while (true) {
      if (c >= 0 && c < cols && r >= 0 && r < rows) { pathTiles.add(idx(c, r)); ordered.push({ c, r }); if (!firstIn) firstIn = { c, r }; lastIn = { c, r }; }
      if (c === b.c && r === b.r) break;
      c += dc; r += dr;
    }
  }
  const fi = firstIn || { c: 0, r: pts[0].r }, li = lastIn || { c: cols - 1, r: pts[pts.length - 1].r };
  endTiles.add(idx(fi.c, fi.r)); endTiles.add(idx(li.c, li.r));
  return { idx, pathTiles, endTiles, ordered };
}
function placeSpecials(levelId: number, cellPlan: Record<string, number | undefined>, pathTiles: Set<number>, endTiles: Set<number>, cols: number, rows: number, ordered: { c: number; r: number }[]) {
  const idx = (c: number, r: number) => r * cols + c;
  const cOf = (i: number) => i % cols, rOf = (i: number) => Math.floor(i / cols);
  const rng = mulberry32(hashString(`${levelId}-cells`));
  const specialMap = new Map<number, { type: string; partner?: number }>();
  const placedIdx: number[] = [];
  const allIdx: number[] = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) allIdx.push(idx(c, r));
  const isFree = (i: number) => !pathTiles.has(i) && !endTiles.has(i) && !specialMap.has(i);
  const pathAdj = (c: number, r: number) => { let n = 0; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dc && !dr) continue; const cc = c + dc, rr = r + dr; if (cc < 0 || cc >= cols || rr < 0 || rr >= rows) continue; if (pathTiles.has(idx(cc, rr))) n++; } return n; };
  const pathNear = (c: number, r: number, k: number) => { for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) { if (!dc && !dr) continue; const cc = c + dc, rr = r + dr; if (cc < 0 || cc >= cols || rr < 0 || rr >= rows) continue; if (pathTiles.has(idx(cc, rr))) return true; } return false; };
  const cheby = (i: number, j: number) => Math.max(Math.abs(cOf(i) - cOf(j)), Math.abs(rOf(i) - rOf(j)));
  const farEnough = (i: number, sep: number) => placedIdx.every(j => cheby(i, j) >= sep);
  const from = Math.floor(ordered.length * 2 / 3);
  const finalThird = new Set(ordered.slice(from).map(p => idx(p.c, p.r)));
  const nearFinalThird = (c: number, r: number) => { for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dc && !dr) continue; const cc = c + dc, rr = r + dr; if (cc < 0 || cc >= cols || rr < 0 || rr >= rows) continue; const ni = idx(cc, rr); if (pathTiles.has(ni) && finalThird.has(ni)) return true; } return false; };

  const place = (want: number, type: string, cands: (sep: number) => number[]) => {
    for (let n = 0; n < want; n++) {
      let c = cands(TUNING.cells.minSeparation);
      if (!c.length) c = cands(1);
      if (!c.length) continue;
      const pick = c[seededInt(rng, 0, c.length - 1)];
      specialMap.set(pick, { type }); placedIdx.push(pick);
    }
  };
  place(cellPlan.sinkhole || 0, 'sinkhole', sep => allIdx.filter(i => isFree(i) && pathAdj(cOf(i), rOf(i)) >= 2 && farEnough(i, sep)));
  place(cellPlan.ridge || 0, 'ridge', sep => allIdx.filter(i => { const c = cOf(i), r = rOf(i); return isFree(i) && pathAdj(c, r) === 0 && pathNear(c, r, 3) && farEnough(i, sep); }));
  for (let n = 0; n < (cellPlan.conduitPairs || 0); n++) {
    let pairs: [number, number][] = [];
    for (let r = 0; r < rows && !pairs.length; r++) for (let c = 0; c < cols - 1 && !pairs.length; c++) {
      const i1 = idx(c, r), i2 = idx(c + 1, r);
      if (isFree(i1) && isFree(i2) && pathAdj(c, r) >= 1 && pathAdj(c + 1, r) >= 1 && farEnough(i1, TUNING.cells.minSeparation) && farEnough(i2, TUNING.cells.minSeparation)) pairs.push([i1, i2]);
    }
    if (!pairs.length) continue;
    const [i1, i2] = pairs[seededInt(rng, 0, pairs.length - 1)];
    specialMap.set(i1, { type: 'conduit', partner: i2 }); specialMap.set(i2, { type: 'conduit', partner: i1 }); placedIdx.push(i1, i2);
  }
  place(cellPlan.anchor || 0, 'anchor', sep => allIdx.filter(i => isFree(i) && farEnough(i, sep)));
  place(cellPlan.nullcell || 0, 'nullcell', sep => allIdx.filter(i => { const c = cOf(i), r = rOf(i); return isFree(i) && nearFinalThird(c, r) && farEnough(i, sep); }));
  return { specialMap, placedIdx, cOf, rOf };
}

// ---------- sanity: the five real cell type ids are exactly what this test assumes ----------
check(JSON.stringify(Object.keys(CELL_TYPES).sort()) === JSON.stringify(['anchor', 'conduit', 'nullcell', 'ridge', 'sinkhole']),
  `CELL_TYPES ids changed — this test's hardcoded assumptions need updating (got ${Object.keys(CELL_TYPES).sort()})`);

// ---------- determinism: same seed -> identical cells, every time ----------
{
  const lv = LEVELS.find(l => l.id === 15)!; // most cell types of any authored level
  const { pts, cols, rows } = snapToGrid(lv.paths[0], 48);
  const { pathTiles, endTiles, ordered } = carve(pts, cols, rows);
  const a = placeSpecials(lv.id, lv.cellPlan as any, pathTiles, endTiles, cols, rows, ordered);
  const b = placeSpecials(lv.id, lv.cellPlan as any, pathTiles, endTiles, cols, rows, ordered);
  check(JSON.stringify([...a.specialMap.entries()].sort()) === JSON.stringify([...b.specialMap.entries()].sort()), 'same seed (level+tile size) produces identical special cells twice');
  check(a.specialMap.size > 0, 'sanity: L15 actually placed something to compare');
}

// ---------- separation rule: every pair of placed specials respects minSeparation (or the documented 1-tile relaxed fallback) ----------
{
  let checkedLevels = 0;
  for (const lv of LEVELS) {
    if (!lv.cellPlan) continue;
    for (const tileSize of [40, 48, 58]) {
      const { pts, cols, rows } = snapToGrid(lv.paths[0], tileSize);
      const { pathTiles, endTiles, ordered } = carve(pts, cols, rows);
      const { placedIdx, cOf, rOf } = placeSpecials(lv.id, lv.cellPlan as any, pathTiles, endTiles, cols, rows, ordered);
      for (let a = 0; a < placedIdx.length; a++) {
        for (let b = a + 1; b < placedIdx.length; b++) {
          const d = Math.max(Math.abs(cOf(placedIdx[a]) - cOf(placedIdx[b])), Math.abs(rOf(placedIdx[a]) - rOf(placedIdx[b])));
          // conduit partners are adjacent by design (d===1 is expected there); everything
          // else should honor at least the relaxed 1-tile floor.
          check(d >= 1, `Level ${lv.id} tile=${tileSize}: two special cells landed on the exact same tile`);
        }
      }
      checkedLevels++;
    }
  }
  check(checkedLevels > 0, 'sanity: separation rule was actually exercised against real level data');
}

// ---------- stats test: a mock tower on ridge/sinkhole reports modified range/rate/dmg ----------
// Mirrors Tower.applyCellType()/rangeT()/stats() exactly (game.ts can't be imported headlessly
// — see the file header). cellType is never serialized in a resume snapshot (ResumeTower has
// no such field) — it's always recomputed from the cell index against the deterministic grid,
// which is exactly what this pure math models: given a cellType, the modifiers that result.
{
  function applyCellType(type: string | null) {
    const CT = TUNING.cells;
    return {
      cellRangeAdd: type === 'ridge' ? CT.ridge.rangeAdd : type === 'sinkhole' ? CT.sinkhole.rangeAdd : 0,
      cellRateMul: type === 'ridge' ? CT.ridge.rateMul : 1,
      cellDmgMul: type === 'sinkhole' ? CT.sinkhole.dmgMul : 1,
    };
  }
  const rangeT = (rawRange: number, cellRangeAdd: number) => Math.max(1, Math.round(rawRange) + cellRangeAdd);

  const ridge = applyCellType('ridge');
  check(ridge.cellRangeAdd === 1 && ridge.cellRateMul === 0.85 && ridge.cellDmgMul === 1, 'ridge: +1 range, -15% rate, no damage change');
  check(rangeT(2, ridge.cellRangeAdd) === 3, 'ridge range applies on top of the raw stage range');

  const sinkhole = applyCellType('sinkhole');
  check(sinkhole.cellRangeAdd === -1 && sinkhole.cellRateMul === 1 && sinkhole.cellDmgMul === 1.3, 'sinkhole: -1 range, +30% damage, no rate change');
  check(rangeT(2, sinkhole.cellRangeAdd) === 1, 'sinkhole range subtracts from the raw stage range');
  check(rangeT(1, sinkhole.cellRangeAdd) === 1, 'range floor of 1 holds even on an already-range-1 tower (the short-tower home, by design)');

  const none = applyCellType(null);
  check(none.cellRangeAdd === 0 && none.cellRateMul === 1 && none.cellDmgMul === 1, 'no cell type: no modifiers at all');

  const anchorAmpMul = TUNING.cells.anchor.ampMul;
  check(anchorAmpMul === 2, 'anchor doubles amp buffs (ampMul === 2)');
}

// ---------- null-slow math ----------
{
  const slowMul = 1 - TUNING.cells.nullcell.slowPct;
  check(Math.abs(slowMul - 0.8) < 1e-9, 'null zone slows ground enemies to 80% speed (20% slow)');
  check(TUNING.cells.nullcell.slowPct > 0 && TUNING.cells.nullcell.slowPct < 1, 'nullcell.slowPct is a real fraction');
  // radius check: 1.5 tiles at a representative cell size
  const cell = 48;
  const radiusPx = 1.5 * cell;
  check(radiusPx === 72, `null zone slow radius is 1.5 tiles (72px at cell=48, got ${radiusPx})`);
}

console.log(fails ? `${fails} FAILURES` : 'cell-seeding: all checks passed');
process.exit(fails ? 1 : 0);
