// Resume snapshot — serialize/deserialize round-trip fidelity, version-mismatch and
// malformed-data graceful discard, against the REAL resume.ts module.
// Run: node --experimental-strip-types tests/resume.ts
import { serializeResume, deserializeResume, RESUME_VERSION } from '../src/resume.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

// --- round trip fidelity ---
const fakeGame = {
  level: { id: 8 }, endless: false, cell: 48, meander: 1, diffTier: 3, ascTier: 2,
  mods: new Set(['meteors', 'rich-veins']), waveIdx: 4, credits: 733, lives: 17,
  novaCharge: 42, novaNeed: 90, cds: { orbital: 3.2, stasis: 0 },
  towers: [
    { spec: { id: 'pulse' }, cell: 55, stage: 2, branch: 1, branchStage: 1, mode: 'strong', spent: 480, dmgDealt: 12034.5, kills: 61, creditsEarned: 610, vein: true, perk: 'sharp' },
    { spec: { id: 'mortar' }, cell: 88, stage: 0, branch: -1, branchStage: 0, mode: 'first', spent: 120, dmgDealt: 340, kills: 4, creditsEarned: 40, vein: false, perk: null },
  ],
};
const daily = { dateStr: '2026-07-08', levelId: 8, modifiers: ['ion-storms'], mutatorBonus: 0.25, difficulty: 3 };

const raw = serializeResume(fakeGame as any, daily);
check(raw !== null, 'serialize should succeed');
const snap = deserializeResume(raw!);
check(snap !== null, 'deserialize should succeed');
check(snap!.v === RESUME_VERSION, 'version stamped');
check(snap!.levelId === 8, 'levelId round-trips');
check(snap!.waveIdx === 4, 'waveIdx round-trips');
check(snap!.credits === 733, 'credits round-trips');
check(snap!.lives === 17, 'lives round-trips');
check(snap!.novaCharge === 42, 'novaCharge round-trips');
check(snap!.cdOrbital === 3.2, 'cdOrbital round-trips');
check(JSON.stringify([...fakeGame.mods].sort()) === JSON.stringify([...snap!.mods].sort()), 'mods round-trip');
check(snap!.towers.length === 2, 'both towers round-trip');
check(snap!.towers[0].specId === 'pulse' && snap!.towers[0].branch === 1 && snap!.towers[0].vein === true, 'tower[0] fields round-trip');
check(snap!.towers[1].specId === 'mortar' && snap!.towers[1].kills === 4, 'tower[1] fields round-trip');
check(snap!.towers[0].perk === 'sharp', 'veteran perk round-trips (Phase 4.6)');
check(snap!.towers[1].perk === null, 'null perk round-trips as null, not dropped');
check(snap!.daily !== null && snap!.daily.dateStr === '2026-07-08', 'daily context round-trips');

// --- graceful discard on version mismatch ---
const oldFormat = JSON.stringify({ v: 999, levelId: 3, towers: [] });
check(deserializeResume(oldFormat) === null, 'wrong version -> null (graceful discard)');

// --- graceful discard on malformed data ---
check(deserializeResume('not json at all {{{') === null, 'malformed JSON -> null');
check(deserializeResume(undefined) === null, 'undefined -> null');
check(deserializeResume('{}') === null, 'empty object -> null');
check(deserializeResume(JSON.stringify({ v: RESUME_VERSION, levelId: 'not-a-number', towers: [] })) === null, 'wrong-typed levelId -> null');
check(deserializeResume(JSON.stringify({ v: RESUME_VERSION, levelId: 3, towers: 'not-an-array' })) === null, 'wrong-typed towers -> null');

// --- idempotency: serializing twice from the "same" state gives structurally identical results (minus savedAt timestamp) ---
const raw2 = serializeResume(fakeGame as any, daily);
const snapA = JSON.parse(raw!); delete snapA.savedAt;
const snapB = JSON.parse(raw2!); delete snapB.savedAt;
check(JSON.stringify(snapA) === JSON.stringify(snapB), 'repeated serialization is structurally stable');

console.log(fails ? `${fails} FAILURES` : 'All resume round-trip tests PASSED');
process.exit(fails ? 1 : 0);
