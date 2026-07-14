// Phase 6.6 — build-menu role chips: roleChips(spec) derives a compact "what does this
// tower do" tag pair from the stage-0 spec. Run: node --experimental-strip-types tests/role-chips.ts
import { TOWERS, roleChips } from '../src/data.ts';

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.error('FAIL:', msg); } };

const byId = Object.fromEntries(TOWERS.map(t => [t.id, t]));

check(roleChips(byId.mortar).air === 'no-air', 'mortar is groundOnly at stage 0 -> NO AIR chip');
check(roleChips(byId.mortar).role === 'splash', 'mortar has splash at stage 0 -> SPLASH role');

check(roleChips(byId.missile).air === 'air-bonus', 'missile has airMul 2 at stage 0 -> AIR+ chip');
check(roleChips(byId.missile).role === 'splash', 'missile also has splash at stage 0 -> SPLASH wins (priority order)');

check(roleChips(byId.cryo).air === null, 'cryo hits air/ground evenly at stage 0 -> no air chip');
check(roleChips(byId.cryo).role === 'slow', 'cryo has slow at stage 0 -> SLOW role');

check(roleChips(byId.tesla).air === null, 'tesla hits air/ground evenly -> no air chip');
check(roleChips(byId.tesla).role === 'chain', 'tesla has chains at stage 0, no splash/slow/burn -> CHAIN role');

check(roleChips(byId.flame).role === 'burn', 'flame has burnDps at stage 0 -> BURN role');

check(roleChips(byId.amp).role === 'support', 'amp kind -> SUPPORT role regardless of stats');
check(roleChips(byId.amp).air === null, 'amp is not groundOnly and has no airMul -> no air chip');

check(roleChips(byId.pulse).air === null && roleChips(byId.pulse).role === null,
  'pulse has no splash/slow/burn/chains/pierce/groundOnly/airMul at stage 0 -> no chips at all');
check(roleChips(byId.sentinel).air === null && roleChips(byId.sentinel).role === null,
  'sentinel is plain long-range single-target at stage 0 -> no chips');

console.log(fails ? `${fails} FAILURES` : 'role-chips: all checks passed');
process.exit(fails ? 1 : 0);
