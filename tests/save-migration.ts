// Save migration — idempotency and correctness across a range of synthetic old-format saves,
// against the REAL migrateSave/defaultSave functions.
// Run: node --experimental-strip-types tests/save-migration.ts
import { migrateSave, defaultSave } from '../src/save.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };
const stable = (o: any): string => JSON.stringify(o, (_k, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const roundTrip = (raw: any) => migrateSave(JSON.parse(JSON.stringify(migrateSave(raw))));

const fixtures: [string, any][] = [
  ['empty object', {}],
  ['undefined-ish (no fields at all)', { v: 1 }],
  ['default save re-migrated', defaultSave()],
  ['fresh player, L1 only', { unlocked: 1, stars: {} }],
  ['mid-campaign veteran', { unlocked: 8, stars: { 1: 3, 2: 2, 3: 3, 4: 1, 5: 3, 6: 2, 7: 3 }, meta: ['reactor1', 'hull1'] }],
  ['full campaign clear, v1 endlessBest', { unlocked: 16, endlessBest: 12, stars: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i + 1, 3])) }],
  ['ascension in progress (old shape, no `unlocked` field)', { unlocked: 16, ascension: { current: 2, bestPerLevel: { 15: 2 } } }],
  ['daily streak mid-flight', { unlocked: 10, daily: { lastDate: '2026-07-01', lastWon: true, streak: 5, bestStreak: 12 } }],
  ['challenges partially earned', { unlocked: 9, challenges: { 2: [true, false], 5: [true, true] } }],
  ['corrupted settings (wrong types)', { unlocked: 5, settings: { tileSize: 'not-a-number', difficulty: null } }],
  ['null fields throughout', { unlocked: null, stars: null, meta: null, settings: null }],
];

for (const [label, raw] of fixtures) {
  let migrated: any;
  try {
    migrated = migrateSave(raw);
  } catch (e) {
    fails++; console.error(`FAIL: migrateSave threw on "${label}":`, e);
    continue;
  }
  check(migrated.v === 2, `"${label}": migrated to schema v2`);
  check(typeof migrated.unlocked === 'number' && migrated.unlocked >= 1, `"${label}": unlocked is a valid number`);
  check(typeof migrated.stars === 'object', `"${label}": stars is an object`);
  check(Array.isArray(migrated.meta), `"${label}": meta is an array`);
  check(typeof migrated.settings === 'object' && migrated.settings !== null, `"${label}": settings is an object`);
  check(typeof migrated.endlessBest === 'object', `"${label}": endlessBest is an object (not a leftover v1 number)`);
  check(typeof migrated.ascension === 'object' && typeof migrated.ascension.unlocked === 'number', `"${label}": ascension.unlocked backfilled`);

  // idempotency: migrating an already-migrated save must be a no-op
  let twice: any;
  try {
    twice = roundTrip(raw);
  } catch (e) {
    fails++; console.error(`FAIL: second migration pass threw on "${label}":`, e);
    continue;
  }
  check(stable(migrated) === stable(migrateSave(JSON.parse(JSON.stringify(migrated)))), `"${label}": migration is idempotent`);
}

// v1 endlessBest (a bare number) relocates specifically to difficulty tier 2 (Normal)
{
  const m = migrateSave({ unlocked: 6, endlessBest: 14 });
  check(m.endlessBest[2] === 14, `v1 endlessBest:14 lands at tier 2, got ${JSON.stringify(m.endlessBest)}`);
  check(Object.keys(m.endlessBest).length === 1, 'v1 endlessBest migration creates exactly one tier entry');
}
{
  const m = migrateSave({ unlocked: 6, endlessBest: 0 });
  check(Object.keys(m.endlessBest).length === 0, 'v1 endlessBest:0 (never played) migrates to an empty map, not a spurious {2:0} entry');
}

// veteran seen-flag pre-marking: unlocked=10 should have every gate at or below 10 pre-marked
{
  const m = migrateSave({ unlocked: 10 });
  check(m.seen['drops'] === true, 'unlocked=10: drops (gate 4) pre-marked seen');
  check(m.seen['nova'] === true, 'unlocked=10: nova (gate 7) pre-marked seen');
  check(m.seen['mod_ionstorms'] === undefined || m.seen['mod_ionstorms'] === false, 'unlocked=10: mod_ionstorms (gate 12) NOT pre-marked');
}
{
  const m = migrateSave({ unlocked: 1 });
  check(Object.keys(m.seen).length === 0, 'unlocked=1 (brand new): zero pre-marked seen flags');
}

console.log(fails ? `${fails} FAILURES` : `save-migration: all checks passed (${fixtures.length} fixtures x idempotency)`);
process.exit(fails ? 1 : 0);
