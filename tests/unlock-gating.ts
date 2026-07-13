// Unlock gating — fresh save vs veteran save, against the REAL UNLOCKS table and isUnlocked().
// Run: node --experimental-strip-types tests/unlock-gating.ts
import { UNLOCKS, setUnlockedLevel, isUnlocked } from '../src/data.ts';
import { SEEN_UNLOCK_LEVELS } from '../src/save.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

// A fresh save (unlocked=1): nothing beyond L1 should be available.
setUnlockedLevel(1);
for (const [id, lvl] of Object.entries(UNLOCKS)) {
  check(isUnlocked(id) === (lvl <= 1), `fresh save (unlocked=1): '${id}' (gate ${lvl}) should be ${lvl <= 1}`);
}

// A save that just beat L4 (unlocked=5): everything gated at <=5 is on, nothing above is.
setUnlockedLevel(5);
for (const [id, lvl] of Object.entries(UNLOCKS)) {
  check(isUnlocked(id) === (lvl <= 5), `mid save (unlocked=5): '${id}' (gate ${lvl}) should be ${lvl <= 5}`);
}
check(isUnlocked('drops') === true, 'drops (gate 4) unlocked by unlocked=5');
check(isUnlocked('elites') === true, 'elites (gate 5) unlocked by unlocked=5');
check(isUnlocked('mutators') === false, 'mutators (gate 6) NOT yet unlocked by unlocked=5');
check(isUnlocked('nova') === false, 'nova (gate 7) NOT yet unlocked by unlocked=5');

// A veteran save (beaten everything, unlocked=16): every gated system is available, including
// campaign-replay of L1 — this is the core "veterans get the full sandbox everywhere" guarantee.
setUnlockedLevel(16);
for (const [id, lvl] of Object.entries(UNLOCKS)) {
  check(isUnlocked(id) === true, `veteran save (unlocked=16): '${id}' should always be unlocked`);
}

// An id with no entry in UNLOCKS is treated as always-unlocked (core systems, ungated by design)
setUnlockedLevel(1);
check(isUnlocked('some_totally_unregistered_system') === true, 'ids absent from UNLOCKS default to unlocked (core/ungated systems)');

// UNLOCKS <-> SEEN_UNLOCK_LEVELS must stay in sync (except the two documented no-toast exceptions)
const NO_TOAST = new Set(['mutators_hard', 'mod_combo']);
for (const [id, lvl] of Object.entries(UNLOCKS)) {
  if (NO_TOAST.has(id)) {
    check(!(id in SEEN_UNLOCK_LEVELS), `'${id}' is a no-toast gate and correctly absent from SEEN_UNLOCK_LEVELS`);
    continue;
  }
  check(id in SEEN_UNLOCK_LEVELS, `'${id}' has a matching toast-seen entry`);
  check(SEEN_UNLOCK_LEVELS[id] === lvl, `'${id}' toast level (${SEEN_UNLOCK_LEVELS[id]}) matches its unlock gate (${lvl})`);
}
// and the reverse: nothing in SEEN_UNLOCK_LEVELS should reference a gate that doesn't exist
// (the guide_*/zone_* keys are exceptions — they're not feature gates, just tutorial markers)
const NON_GATE_KEYS = new Set(['guide_build', 'guide_confirm', 'guide_launch', 'zone_1', 'zone_2', 'zone_3']);
for (const key of Object.keys(SEEN_UNLOCK_LEVELS)) {
  if (NON_GATE_KEYS.has(key)) continue;
  check(key in UNLOCKS, `SEEN_UNLOCK_LEVELS key '${key}' corresponds to a real UNLOCKS gate`);
}

console.log(fails ? `${fails} FAILURES` : 'unlock-gating: all checks passed');
process.exit(fails ? 1 : 0);
