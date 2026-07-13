// Verifies: for every real level (+ endless) at every tile size and meander tier, both
// normal AND Daily-Op-mirrored, the snap-to-grid + meander pipeline never produces a
// self-crossing or non-rectilinear path. Run: node --experimental-strip-types tests/mirror-meander-fuzz.ts
import { LEVELS, ENDLESS_LEVEL } from '../src/levels.ts';

const W = 1280, H = 720;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function mirrorPts(pts: number[][]): number[][] { return pts.map(([x, y]) => [W - x, y]).reverse(); }

interface CPt { c: number; r: number; }
const ptKey = (p: CPt) => `${p.c},${p.r}`;
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
function meanderSegment(a: CPt, b: CPt, tier: number, cols: number, rows: number, forbidden: Set<string>): CPt[] {
  const straight = [a, b];
  if (tier <= 0 || (a.c !== b.c && a.r !== b.r)) return straight;
  const horiz = a.r === b.r;
  const mainLen = Math.abs(horiz ? b.c - a.c : b.r - a.r);
  const minLen = tier >= 2 ? 5 : 7;
  if (mainLen < minLen) return straight;
  const maxBumps = tier >= 2 ? Math.max(2, Math.round(mainLen / 4)) : Math.max(1, Math.round(mainLen / 6));
  const maxDepth = tier >= 2 ? 2 : 1;
  for (let depth = maxDepth; depth >= 1; depth--) {
    for (let bumps = maxBumps; bumps >= 1; bumps--) {
      const candidate = buildBumps(a, b, bumps, depth, cols, rows);
      const tiles = walkTiles(candidate);
      const seen = new Set<string>();
      let collides = false;
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
function applyMeander(cellsPts: CPt[], tier: number, cols: number, rows: number): CPt[] {
  if (cellsPts.length < 2 || tier <= 0) return cellsPts;
  const spine = new Set(walkTiles(cellsPts).map(ptKey));
  const claimed = new Set<string>();
  const markClaimed = (pts: CPt[]) => { for (const p of walkTiles(pts)) claimed.add(ptKey(p)); };
  const out: CPt[] = [cellsPts[0]];
  markClaimed([cellsPts[0]]);
  for (let i = 0; i < cellsPts.length - 1; i++) {
    const a = cellsPts[i], b = cellsPts[i + 1];
    const segSpine = new Set(walkTiles([a, b]).map(ptKey));
    const forbidden = new Set<string>();
    for (const k of spine) if (!segSpine.has(k)) forbidden.add(k);
    for (const k of claimed) forbidden.add(k);
    const seg = meanderSegment(a, b, tier, cols, rows, forbidden);
    markClaimed(seg);
    for (let j = 1; j < seg.length; j++) out.push(seg[j]);
  }
  return out;
}
function selfCrosses(pts: CPt[]): boolean {
  const seen = new Set<string>();
  for (const t of walkTiles(pts)) {
    const k = ptKey(t);
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}
function carveTerminates(pts: CPt[]): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.c !== b.c && a.r !== b.r) return false;
  }
  return true;
}

// snap raw pixel waypoints to a rectilinear grid path, mirroring buildGrid()'s own logic exactly
function snapToGrid(rawPts: number[][], cell: number): { cellsPts: CPt[]; cols: number; rows: number } {
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

let trials = 0, fails = 0;
const allLevels = [...LEVELS, ENDLESS_LEVEL];
for (const lv of allLevels) {
  for (const tileSize of [40, 48, 58]) {
    for (const tier of [0, 1, 2]) {
      for (const mirror of [false, true]) {
        for (const rawPts0 of lv.paths) {
          const rawPts = mirror ? mirrorPts(rawPts0) : rawPts0;
          const { cellsPts, cols, rows } = snapToGrid(rawPts, tileSize);
          const meandered = applyMeander(cellsPts, tier, cols, rows);
          trials++;
          if (!carveTerminates(meandered)) { fails++; console.error(`NON-RECTILINEAR: level ${lv.id} tile=${tileSize} tier=${tier} mirror=${mirror}`); }
          if (selfCrosses(meandered)) { fails++; console.error(`SELF-CROSS: level ${lv.id} tile=${tileSize} tier=${tier} mirror=${mirror}`); }
        }
      }
    }
  }
}
console.log(fails ? `${fails}/${trials} FAILED` : `${trials} trials PASSED — all real levels, mirrored + unmirrored, all tile sizes/meander tiers, zero self-crossings`);
process.exit(fails ? 1 : 0);
