# STARHOLD 3.0 — Game Improvement Plan (v1)

**Owner:** Kevin. **Executor:** Claude Code sessions (typically Sonnet) connected to the GitHub repository. Read this whole file plus `PROGRESS-3.md` (create it in Phase 1 if absent) before touching code.
**Source of truth:** the GitHub repo `https://github.com/kevinzhangplease/starhold`. **Live deployment:** `https://starhold.vercel.app/` (Vercel builds from the repo — pushing `main` ships to the live site; pushing a branch produces a playable preview deployment if the project has previews enabled, which is Vercel's default).
**Relationship to existing docs:** `PLAN.md` (the 2.0 plan) is COMPLETE and historical — do not re-execute anything in it, but its Architecture Rules still apply and are restated below. `PROGRESS.md` is the 2.0 decision log; append nothing to it. This plan gets its own log: `PROGRESS-3.md`, committed to the repo alongside it. **Before Phase 1 begins, this file itself must live at the repo root** (so every Claude Code session can read it without Kevin re-attaching anything).

**Goal:** Starhold 2.0 is feature-complete and mobile-ready but has known depth problems: placement decisions are consequence-free (100% refunds), range is underpriced, most upgrades are stat bumps, maps differ only by path shape, abilities die as enemy HP scales, the HUD buries survival information, and audio is decoration rather than information. This plan fixes all of that across 9 phases.

**The single evaluation lens for every change (Kevin's directive — apply it whenever this plan leaves you a judgment call):**

> Does it change a *decision* the player makes differently across different maps/situations? Or does it just add a *task*? If it only adds a task, cut it or simplify it.

---

## PART A — EXECUTION PROTOCOL & CONVENTIONS

### A.1 Session bootstrap (start of EVERY phase)

Every phase begins:

1. Sync: `git checkout main && git pull` in the repo working copy. `npm install` if `node_modules` is missing or `package-lock.json` changed.
2. Create the working branch: `git checkout -b phase-<N>-<short-slug>` (e.g. `phase-2-cell-diversity`). All phase work happens on this branch.
3. Verify gates BEFORE any changes: `npx tsc --noEmit` clean AND `node --experimental-strip-types validate.ts` passes AND `node --experimental-strip-types tests/run-all.ts` green. If main is red before you start, STOP and tell Kevin — never build a phase on a broken base.
4. Read `Starhold Improvement Plan.md` (this file) fully, plus `PROGRESS-3.md`, plus the "Game context cheat-sheet" in old `PLAN.md` if you need architectural orientation.
5. Confirm which phase you are executing. **Execute exactly one phase per session unless Kevin explicitly says otherwise.**

### A.2 Session close (end of EVERY phase)

1. `npx tsc --noEmit` clean → `validate.ts` passes → full test suite green.
2. Both builds succeed as verification gates: `npm run build` AND `npx vite build --config vite.singlefile.config.ts` (the single-file bundle stays a supported artifact — verify it builds, but never commit `dist/`/`dist-single/`).
3. Write the phase entry in `PROGRESS-3.md`: what shipped, every deviation from this plan and why, every judgment call made, tuning values chosen, known issues. Commit it with the code.
4. Commit at logical checkpoints throughout the phase with descriptive messages prefixed `phase-N:`; finish with a clean working tree.
5. Push the branch. **Default flow: push the branch and give Kevin the branch name so he can play-test the Vercel preview deployment before merging.** Merge to `main` (which deploys to `https://starhold.vercel.app/`) only when Kevin says so, or if he has pre-authorized direct merges for that phase.
6. Report to Kevin: phase summary, preview/deploy URL, anything needing his eyes (screenshots, tuning calls, the fallbacks exercised).
7. **The game must be fully playable at the end of every phase. Never end a session mid-refactor or with a red branch.**

### A.3 Architecture rules (unchanged from 2.0 — binding)

- All new tunables live in the exported `TUNING` object in `src/data.ts`. No magic numbers in `game.ts`/`ui.ts`.
- All new player-facing systems check `isUnlocked(id)`. New unlock ids go in BOTH `UNLOCKS` (data.ts) and `SEEN_UNLOCK_LEVELS` (save.ts) — `validate.ts` asserts they stay in sync.
- Every new stateful field on `Game` that must survive a resume gets a `// SERIALIZE:` comment, and the resume snapshot (`src/resume.ts`) is extended in the same phase. Any phase that adds snapshot fields increments `RESUME_VERSION` by 1 (old snapshots are then gracefully discarded — that is existing, accepted behavior; note it in PROGRESS-3.md when it happens).
- All banners/toasts route through the notification choreographer in `ui.ts` (`notify.critical/medium/low`, `toastOnce`). Never create standalone popups.
- Deterministic randomness (anything the Daily Op or seeded placement touches) uses `rng.ts` `mulberry32`/`hashString` only — never `Math.random`.
- Save migration (`migrateSave` in save.ts) stays idempotent. New save fields get both a default in `defaultSave()` and a presence/type guard in `migrateSave`. **No player ever loses stars, meta purchases, challenge completions, or settings to this update.**
- Respect the accessibility settings everywhere: `reduceFlash`, `reduceMotion`, `damageNumbers`, `perfMode`. Every new flash/shake/slow-mo checks them.

### A.4 Code landmarks (verified against current source — cite these instead of searching blind)

| What | Where |
|---|---|
| Towers/enemies/META/ABILITIES/TUNING/UNLOCKS | `src/data.ts` |
| Level specs, waves, `WaveGroup {e,n,iv,d,p}` | `src/levels.ts` |
| `Game` class | `src/game.ts` ~line 480 |
| Sell (full refund today) | `game.ts` `sell(t)` ~2189 |
| Upgrade refunds (full today) | `game.ts` `refundNode()` ~891 |
| Early-call bonus (`interT * 3`) | `game.ts` `callWave(early)` ~964–975 |
| Wave-clear bonus + interest payout | `game.ts` ~1115–1131 |
| Bounty scaling (`rewardMul = 1 + (hpMul-1)*0.22`) | `game.ts` ~1071 |
| Elite promotion roll | `game.ts` ~1075–1090 |
| Star rating (`frac===0?3:frac<=0.25?2:1`) | `game.ts` `win()` ~1995 |
| Hull fields | `Game.lives`, `Game.maxLives`, `Game.livesLostTotal` |
| Difficulty tables `DIFF_HP=[0.7,0.85,1,1.25,1.55]`, `DIFF_REWARD=[0.85,0.95,1,1.15,1.3]` | `ui.ts` ~1117 |
| Meta bonuses enter `Game` via `meta.credits` / `meta.hp` (built in ui.ts near the DIFF tables) | `game.ts` ctor ~650 |
| Flier flight (straight-line lerp, `fx0/fy0→fx1/fy1`, `fDur`) | `Enemy` ctor ~204 + `Enemy.update` |
| Stun mechanic = `frozenUntil` (mortar quake path) | `game.ts` ~1498, ~1630 |
| Grid/cells `CellInfo {x,y,col,row,valid,path,rock,vein}` | `game.ts` ~475, built in `buildGrid()` ~746 |
| Asteroid/vein seeded placement (the pattern to copy for cell diversity) | `game.ts` ~819–845 |
| Background generation (unseeded `Math.random` today) | `game.ts` `buildBg()` ~2244 |
| Tile/path/portal rendering | `drawTiles()` ~2360, `drawPortalsAndBases()` ~2515 |
| Enemy body/death visuals | `drawEnemyBody()` ~2639, `deathFx()` ~1700 |
| Kill handling (bounty, combo, vein credit) | `onKill(e)` ~1892 |
| Leak handling | `onLeak(e)` ~1971, `Enemy.leak()` ~359 |
| Tower stats pipeline (buffs, overclock, storms) | `Tower.stats(game)` ~432, `rangeT()` ~431 |
| Targeting/fire | `updateTower()` ~1338, `canHit()` ~1405, `fire()` ~1419 |
| Notification choreographer | `ui.ts` top (`notify.critical/medium/low`), `banner()` ~1931 |
| HUD build (credits/lives/wave pills, wave preview) | `ui.ts` ~1267–1331 |
| Tower side panel (incl. `Sell — full refund` button) | `ui.ts` ~2034 and surrounding function |
| Build menu | `ui.ts` `openBuildMenu()` ~1446 |
| Audio engine (all synthesized) | `src/audio.ts` — `setIntensity`, `shoot`, `pop(size)`, `ui(kind)`, `comboBlip`, `klaxon`, `novaHum` |
| Resume snapshots (wave-clear only) | `src/resume.ts`, `RESUME_VERSION = 1` |
| Seeded RNG | `src/rng.ts` `mulberry32`, `hashString` |

### A.5 Decisions already made — do NOT re-litigate these

These were resolved with Kevin during planning. Treat them as fixed requirements:

1. **Tone: commit to the pastel/toy identity.** Menace comes from scale, silhouette, and audio contrast — never from darker art, grimdark palettes, or font changes. Keep Fredoka, keep hearts-adjacent warmth, keep "THE LEVIATHAN" as charming contrast.
2. **Enemy Adaptation (old ideas doc §9.3) is CUT.** Do not implement resistance-to-overused-towers in any form. It's an invisible punishing rule — fails the decision-vs-task test.
3. **No hard tower cap, no fixed pad system.** Open building stays. The spatial puzzle comes from cell diversity (Phase 2) plus the tower draft (Phase 8).
4. **Tower draft is a core system with a casual escape hatch:** draft size GROWS with level (not a flat 5), and a "use full arsenal" option is always available. Details in Phase 8.
5. **Doctrines are additive and migration-safe:** the existing 8 META nodes stay exactly as purchasable perks (with the Reactor % fix from Phase 1); doctrines are a NEW mutually-exclusive layer on top, and switching the active doctrine between levels is free once owned.
6. **Bounty scaling already exists** (`rewardMul`, see A.4). The old ideas doc's claim that "bounties never scale" was written against stale analysis. Phase 1 nudges the coefficient; do not build a second scaling system.
7. **There is no existing sell-undo window** — Phase 1 creates it. The old ideas doc's "keep the existing 4-second window" was a misstatement.
8. **Self-crossing loop maps are out of scope.** Structural map variety uses converging-lanes and fork-rejoin variants built from the engine's existing multi-path support (proven safe with meander by L7/L12). See Phase 3.
9. **Shaped waves never roll mutators** (one twist per wave, cognitively). See Phase 5.
10. **Existing saves migrate cleanly, always.** Earned stars are never recomputed downward by the new star curve; owned META nodes keep working.

### A.6 New unlock cadence (final — Phase 1 adds nothing; each phase adds its own row when instructed)

| Unlock id | Level | Introduced by | Note |
|---|---|---|---|
| `cells` | 3 | Phase 2 | Passive/read-only learning; pairs fine with `interest` (3) |
| `overcharge` | 4 | Phase 4 | L4 becomes the "things you TAP" level alongside `drops` — deliberate pairing |
| `draft` | 6 | Phase 8 | After the player has met most towers |
| `veterancy` | 8 | Phase 4 | L8 is otherwise sparse (`mod_meteors` only) |
| `doctrines` | 10 | Phase 8 | Star-gated anyway; level gate keeps the meta screen clean early |

Every row added must also be added to `SEEN_UNLOCK_LEVELS` in save.ts (validate.ts enforces sync). Veterans (`save.unlocked` ≥ the gate) get the feature immediately and the `seen` flag pre-marked by the existing migration logic — verify this happens for each new key.

### A.7 Phase map (what "execute phase N" means)

| Phase | Title | Headline systems |
|---|---|---|
| 1 | Economy, Abilities & Scaling Foundations | Sell undo + 72% refund, %-based early-call bonus, econScale audit, Orbital/NOVA/Reactor scaling, star recut |
| 2 | Cell Diversity — The Board Speaks | Ridge/Sinkhole/Conduit/Anchor/Null cells, placement algorithms, tooltips, level-card inventories |
| 3 | Map, Path & Portal Identity | Seeded backgrounds + landmarks, path channel + chevrons, portal charge telegraphs, L9/L11 structural reworks |
| 3B | Visual Identity & Readability | Palette token table + value/temperature split, scale hierarchy, idle/uncovered tower dimming, physical death feedback, chroma-on-board, accessible palette |
| 4 | Tower Depth | Range repricing, Flame stacking niche, 3 cross-tower reactions, tier-2 verb rewrites, Overcharge, Veterancy |
| 5 | Wave Shapes, Flier Lanes & Difficulty Redesign | Rush/Trickle/Convoy/Feint, curved per-wave flier lanes, Hard composition injection, Brutal forecast blackout |
| 6 | HUD & Information Hierarchy | Hull pip bar + leak impact + leak ledger, HUD zones, threat readout, two-tier tower panel, role chips |
| 7 | Audio as a Second Information Channel | Spawn signatures, pressure-driven mix, size-mapped kills, hull groan, silence contrast, wave arc, economy register |
| 8 | Replayability — Draft & Doctrines | Pre-level briefing screen, growing draft + full-arsenal toggle, seeded daily drafts, doctrine layer |
| 9 | Integration Balance, Tests & Ship | Cross-system interaction audit, economy simulation sweep, final TUNING table, changelog, device checklist |

Dependencies are strictly linear — execute in order (…3 → 3B → 4…). Phase 3B builds the coverage helper Phase 6 consumes and the palette tokens Phases 6–8 style against. Phase 6's threat readout consumes Phase 5's shape/lane data; Phase 7 attaches audio to hooks Phases 3–6 create; Phase 8's briefing screen consolidates info Phases 2–5 author. Do not reorder.

---
## PHASE 1 — ECONOMY, ABILITIES & SCALING FOUNDATIONS

**Intent.** Make placement a real decision (sell is no longer free), make the intermission a real risk/reward moment (early-call bonus worth taking), and make every flat number in the game hold its relative value from L1 to L15 Ascension V. This is a "numbers phase": almost everything lives in `data.ts` TUNING + small surgical edits in `game.ts`. UI changes are limited to copy and small label logic. Low visual risk, high design impact — that's why it goes first: every later phase's tuning assumes this economy.

**Do NOT in this phase:** touch rendering, restructure any panel, add unlock ids, or change wave content. No new enemy/tower content.

### 1.1 Create `TUNING.economy` and `TUNING.threat` scaffolding (data.ts)

Add to `TUNING`:

```ts
economy: {
  sellRefund: 0.72,          // fraction refunded outside the undo window
  sellUndoWindow: 4,         // seconds of game-time after placement with full refund
  refundInWaveMul: 0.72,     // upgrade-refund fraction while a wave is active (full between waves)
  earlyCallPerSec: 0.04,     // early-call bonus: +4% of pending wave bounty per second remaining
  earlyCallCap: 0.40,        // ...capped at +40% of the wave's bounty
  bountyCoef: 0.27,          // was 0.22 inline in game.ts ~1071 — move it here and raise it
},
```

Replace the inline `0.22` at game.ts ~1071 with `TUNING.economy.bountyCoef`. Rationale for 0.27: matches the intended √(hpMul) curve almost exactly at L15 (1 + 6.6×0.27 = 2.78 vs √7.6 = 2.76) while barely moving early levels.

### 1.2 The economy scale helper (game.ts)

Add two methods to `Game` (near `mkEnemy`):

```ts
// The reward multiplier every enemy bounty already uses — extracted so secondary
// credit sources (combo, drops, fragments, veins, wave-clear bonus, interest cap)
// can scale identically. Includes difficulty reward multiplier.
waveRewardMul(): number {
  return (1 + (this.level.hpMul - 1) * TUNING.economy.bountyCoef
    + (this.endless ? this.waveIdx * 0.05 : 0)) * this.diffReward;
}
// Convenience for scaling flat credit values. Always Math.round at the call site.
econScale(): number { return this.waveRewardMul(); }
```

Refactor the spawn site (~1071) to call `this.waveRewardMul()` so there is exactly one formula. **Important:** the spawn site multiplies by `this.diffReward` inside `mkEnemy` today (it's passed in and applied there) — read the current code carefully and make sure difficulty reward is applied exactly ONCE after the refactor, not twice. Write a test asserting a Drone's bounty at L1 Normal is unchanged (8) and at L15 Normal is round(8 × 2.78) = 22.

### 1.3 Apply econScale to every flat credit value (the §8.7 audit)

Multiply each of the following by `this.econScale()` and `Math.round` (leave the base numbers in TUNING untouched — scaling happens at the point of payment):

| Payment | Location | Base | Notes |
|---|---|---|---|
| Combo milestone credits | `onKill` combo logic, `TUNING.combo.bonuses` | [5,12,25,45,70] | Floater text uses the scaled value |
| Supply-drop credits | `tryCollectDrop` / drop spawn | 40–90 roll | Scale the rolled amount |
| Meteor fragment | fragment collect path | 20 | |
| Rich-vein per-kill | `onKill` vein credit | 2 | `Math.max(1, Math.round(2 × econScale))` |
| Wave-clear bonus | ~1115: `30 + waveIdx*4` | | Scale the whole sum |
| Interest cap | ~1120: `this.interestCap` | 60 (30 at Asc IV) | Cap becomes `Math.round(cap × econScale)`. Keep the Ascension IV halving applied AFTER scaling. |

Do NOT scale: hull patch (+2 of a non-scaling 20 hull — already proportionate), overclock duration/rate (percent/duration-based, ages fine), ability cooldowns, NOVA charge kill counts.

### 1.4 Sell undo window + 72% refund (game.ts + ui.ts)

1. Add `builtAt = -999;` field to `Tower`. Set `t.builtAt = this.now` in `buildAt()` (the actual placement commit, ~2095). Moving a tower does NOT reset it (Move is already free and should stay a pure reposition).
2. Rewrite `sell(t)`:

```ts
sell(t: Tower) {
  const undo = this.now - t.builtAt <= TUNING.economy.sellUndoWindow;
  const refund = undo ? t.spent : Math.round(t.spent * TUNING.economy.sellRefund);
  if (!undo) this.soldAny = true;   // undo is an "unplace", not a sale — Committed challenge unaffected
  this.credits += refund;
  // ...rest identical (free cell, remove, deselect, audio, smoke)
  this.floater(t.x, t.y - 20, undo ? `Undone +${refund}` : `+${refund}`, '#fff3b0');
}
```

3. The undo window uses **game time** (`this.now`) deliberately: it pauses with the game and shrinks in real terms at 3× speed. Both are acceptable; note in PROGRESS-3.md.
4. Resume interaction: `ResumeTower` doesn't carry `builtAt`; on restore, set `builtAt = -999` (any tower alive at a wave clear is past its window anyway). No RESUME_VERSION bump needed.
5. **UI copy** (ui.ts ~2034): the sell button label becomes a live two-state string computed wherever the panel refreshes:
   - Within window: `Undo — full refund ◆ N` (style it with the existing confirm-green accent).
   - After: `Sell (72%) ◆ N` where N is the post-cut amount.
   The label must update when the window lapses even if the panel stays open — recompute it in the existing per-frame/HUD update path that already refreshes panel numbers (interest preview uses one; piggyback on it). A countdown bar is optional polish; skip if it costs more than 15 minutes.
6. Update the Game Guide strings (ui.ts ~956–957): "Any upgrade can be refunded in full **between waves** — experiment freely. Selling a tower returns 72% of its cost, or 100% within 4 seconds of placing it."

### 1.5 Upgrade refunds: full between waves, 72% during (game.ts `refundNode`)

In `refundNode`, after computing `refund`, apply: `if (this.waveActive) refund = Math.round(refund * TUNING.economy.refundInWaveMul);` and keep `t.spent` reduced by the FULL node value regardless (spent tracks investment, not payout). Rationale (record in PROGRESS-3.md): full-refund experimentation between waves is a deliberate design value; the 72% in-wave cut closes the refund-everything-right-before-wave-clear interest exploit, because interest pays at the moment of the last kill (wave still active), making the round-trip strictly unprofitable. The old "accepted exploit" note in PROGRESS.md is now obsolete — say so in PROGRESS-3.md.

### 1.6 Early-call bonus as % of pending wave bounty (game.ts `callWave`)

1. Add helper:

```ts
pendingWaveBounty(): number {
  if (!this.pendingWave) return 0;
  const mul = this.waveRewardMul();
  return this.pendingWave.reduce((a, g) => a + ENEMIES[g.e].reward * g.n * mul, 0);
}
```

Ignore mutator adjustments (bounty/horde) in this estimate — document that as intentional simplification.
2. Change `callWave(early: boolean)` → `callWave(early: boolean, auto = false)`. The auto-wave call site (~1134, `if (this.autoWave) this.callWave(true)`) passes `auto = true`.
3. Replace the bonus block:

```ts
if (early && !auto && this.interT > 0.5) {
  const E = TUNING.economy;
  const frac = Math.min(E.earlyCallCap, this.interT * E.earlyCallPerSec);
  const bonus = Math.round(this.pendingWaveBounty() * frac);
  if (bonus > 0) {
    this.credits += bonus;
    this.floater(W / 2, 120, `Early call +${bonus} ◆ (+${Math.round(frac * 100)}%)`, '#fff3b0');
    audio.ui('coin');
  }
}
```

Auto-called waves get NO bonus — the bonus rewards a deliberate risk decision; if auto-call earned it, auto mode would be strictly optimal and the decision would vanish. The Speedrunner challenge predicate (`lateCallHappened`) is untouched and still works.
4. Show the live bonus on the call-wave button during intermissions: append ` +N◆` to its label, ticking down as `interT` falls (same refresh path as 1.4.5). This makes the tension legible before Phase 6's threat readout arrives.

### 1.7 Orbital Strike scales with the campaign (data.ts + game.ts)

1. Add `Game.currentHpScale()`:

```ts
currentHpScale(): number {
  const base = this.endless ? this.endlessHpMul(this.waveIdx) : this.level.hpMul;
  return base * (1 + this.waveIdx * 0.03) * this.diffHp;   // mirrors the enemy spawn formula
}
```

2. At the orbital damage application site, replace flat `ABILITIES.orbital.dmg` with `Math.round(ABILITIES.orbital.dmg * this.currentHpScale())`. Damage floaters use `fmt()`.
3. Update the META node desc for `orbital` to: "Unlock ability: aimed strike, heavy area damage that scales with the invasion. 30s cooldown."

### 1.8 NOVA: percentage damage + stun, recharge penalty removed (data.ts + game.ts)

1. `TUNING.nova` changes: remove `damage: 400` and `bossFrac: 0.5`; add `fracNormal: 0.30, fracBoss: 0.08, stunDur: 0.6`; set `rechargeGrowth: 1.4` → `1.0` (keep the field and the code path — a value of 1.0 neutralizes it — so no structural surgery is needed and it remains a tuning lever).
2. NOVA blast application: each enemy takes `Math.max(1, Math.round(e.hp * (e.spec.boss ? N.fracBoss : N.fracNormal)))` — **current** HP, per the design intent that it always feels like a meaningful bite. Non-boss enemies additionally get `e.frozenUntil = Math.max(e.frozenUntil, this.now + N.stunDur)` (reuses the mortar-quake stun pathway and its visuals — see A.4).
3. No use-count cap. The 90-kill charge requirement is already the limiter. If Phase 9's balance sweep finds NOVA spam, the fallback is a flat 2-uses-per-level cap — record that as the designated fallback, do not preemptively implement.
4. Update the NOVA unlock toast/codex text to describe percentages ("tears 30% of the health from everything on screen — 8% from bosses — and stuns the survivors").

### 1.9 Reactor meta nodes become percentages (data.ts + ui.ts + game.ts)

1. META descs: `reactor1` → "+20% starting credits every level." `reactor2` → "+35% starting credits (total)."
2. In ui.ts where the `meta` object passed to `new Game` is assembled (near the DIFF tables ~1110): replace the flat credits sum with `creditMul` (1.0 / 1.20 / 1.35 by ownership) and pass `meta.creditMul` instead of `meta.credits`.
3. game.ts ctor ~650: `this.credits = Math.round(level.startCredits * meta.creditMul * (ascTier>=4 ? TUNING.ascension.startCreditMul : 1))`.
4. Sanity anchors: L1 old +60 flat on 260 = +23%; new +20% = +52. L15: +35% of 620 = +217 (old flat +120). Both within intent.
5. `hull1/hull2` stay flat (+5/+10 on a non-scaling 20 base — already proportionate). `fab`/`munitions` are already percentages. No other META changes in this phase.

### 1.10 Star curve recut (game.ts `win()` ~1995)

Replace the frac-based cut with absolute hull damage:

```ts
const lost = this.livesLostTotal;
const stars = lost <= 2 ? 3 : lost <= 8 ? 2 : 1;
```

Absolute (not fraction) is deliberate: with Hull Plating meta, the challenge stays identical rather than getting easier. Verify the star-persist site takes `Math.max(existing, new)` — it must never downgrade a stored rating. Perfect Hull (zero loss) is now strictly harder than 3★ — the duplicate-reward problem is gone. Update the results-screen copy and the Game Guide line about stars: "3★ — win losing no more than 2 hull."

### 1.11 `pauseOnBuild` defaults on for new players (save.ts)

In `defaultSave()` only: `pauseOnBuild: true`. Do NOT touch `migrateSave` — existing players keep whatever they chose. Update the settings row description to mark it "(recommended)".

### 1.12 Validation & tests

- `validate.ts`: assert `TUNING.economy` exists with all six keys, `0 < sellRefund < 1`, `earlyCallCap ≤ 0.5`, `nova.fracNormal > nova.fracBoss`.
- New `tests/economy-v3.ts`: sell inside/outside undo window amounts; undo does not set `soldAny`, late sell does; refundNode full between waves / 72% during; early-call bonus math incl. cap and `auto=true` → 0; drone bounty anchors from 1.2; interest cap scaling at L1 vs L15; star cut mapping (0,2,3,8,9 hull lost → 3,3,2,2,1); NOVA damage vs normal/boss math; orbital scale at L1 vs L15.
- Update any existing tests that asserted the old constants (`tests/combo-interest.ts` will need the scaled cap).
- Add `tests/economy-v3.ts` to `tests/run-all.ts`.

### 1.13 Exit criteria

- All gates green (A.2). Fresh-save L1 plays identically except: sell label/behavior, early-call amounts, pauseOnBuild default.
- Dev-jump to L15 (`?dev=1`): kill a Drone → bounty ~22; collect a crate → credits visibly scaled; fire NOVA at the Leviathan → visible ~8% chunk + floaters in `fmt()`.
- PROGRESS-3.md phase entry written, including the obsoleted-exploit note (1.5) and any tuning deviations.

---
## PHASE 2 — CELL DIVERSITY: THE BOARD SPEAKS

**Intent.** Give every map a readable spatial identity by adding five special cell types whose modifiers change *which tower belongs where* — never "put your best tower here." Placement is algorithmic (the grid depends on tile-size and meander settings, so hand-placed coordinates are impossible) but every algorithm encodes a *reason* — Kevin's explicit requirement. This is the structural fix for map sameness; Phase 3 adds the cosmetic layer on top.

**Design discipline (binding):** each cell type must favor a different tower archetype and carry a real tradeoff or geometry constraint. If, while implementing, a cell type collapses into "always good" or "always ignored", flag it in PROGRESS-3.md rather than silently buffing it.

**Do NOT:** add more than these five types; use hue as the primary differentiator (elevation/shadow/value only — the palette is already saturated); make any cell type spawn on Ascension-modified logic (cells are level identity, not difficulty).

### 2.1 Data model (data.ts)

```ts
export interface CellTypeSpec {
  id: 'ridge' | 'sinkhole' | 'conduit' | 'anchor' | 'nullcell';
  name: string; icon: string; blurb: string; bestFor: string[];  // tower ids
}
export const CELL_TYPES: Record<string, CellTypeSpec> = {
  ridge:    { id: 'ridge',    name: 'Ridge',    icon: '⛰', blurb: '+1 range, −15% fire rate for the tower built here.', bestFor: ['sentinel', 'ray', 'missile'] },
  sinkhole: { id: 'sinkhole', name: 'Sinkhole', icon: '▽', blurb: '−1 range, +30% damage for the tower built here.', bestFor: ['flame', 'cryo', 'tesla'] },
  conduit:  { id: 'conduit',  name: 'Conduit',  icon: '↭', blurb: 'Linked cells: towers built on them focus the same target.', bestFor: ['pulse', 'prism', 'sentinel'] },
  anchor:   { id: 'anchor',   name: 'Anchor',   icon: '◎', blurb: 'An Amp built here projects double-strength buffs.', bestFor: ['amp'] },
  nullcell: { id: 'nullcell', name: 'Null Zone', icon: '∅', blurb: 'Unbuildable. Ground enemies passing beside it are slowed 20%.', bestFor: [] },
};
```

TUNING additions:

```ts
cells: {
  ridge: { rangeAdd: 1, rateMul: 0.85 },
  sinkhole: { rangeAdd: -1, dmgMul: 1.3 },
  anchor: { ampMul: 2 },
  nullcell: { slowPct: 0.2 },           // applies within Chebyshev 1 tile, ground only
  minSeparation: 2,                     // min Chebyshev distance between special cells
},
```

`LevelSpec` (levels.ts) gains `cellPlan?: { ridge?: number; sinkhole?: number; conduitPairs?: number; anchor?: number; nullcell?: number }`.

### 2.2 Per-level cell inventories (levels.ts — author exactly these)

Each inventory is chosen to interact with that level's existing identity (modifiers, path shape, roster). L1–L2 get none (clean teaching space).

| Level | cellPlan | Design reason (put a one-line comment in levels.ts) |
|---|---|---|
| 3 Long Meander | ridge 1, sinkhole 1 | First contact: one of each of the two simplest, opposite types |
| 4 High Wind | ridge 2, nullcell 1 | Wisps debut — ridges reward reaching anti-air; null eases the new pressure |
| 5 Mothership | sinkhole 1, anchor 1 | Boss level: reward a committed chokepoint + a buff hub |
| 6 Ember Gate | conduitPairs 1, sinkhole 1 | Conduit debuts where veins already teach "cells matter" |
| 7 Twin Lanes | ridge 2, anchor 1 | Ridges can cover both lanes from between them |
| 8 The Coil | sinkhole 2, conduitPairs 1 | Serpentine bends are sinkhole heaven; meteors threaten the conduit line |
| 9 Shatterfield | anchor 1, nullcell 1, ridge 1 | Splitter swarms — cluster play around the anchor |
| 10 Colossus | conduitPairs 1, sinkhole 1, ridge 1 | Full toolkit before Zone 3 |
| 11 Void Door | ridge 2, nullcell 1 | Phasers slip past — null slow near the base is the safety net you build around |
| 12 Crossfire | anchor 1, sinkhole 2 | Crossing lanes → the shared center is anchor country |
| 13 Long Night | conduitPairs 1, ridge 2, sinkhole 1 | Long straights → the conduit line level |
| 14 Gauntlet | sinkhole 2, conduitPairs 1 | One straight corridor: pure chokepoint identity |
| 15 Leviathan | ridge 1, sinkhole 1, conduitPairs 1, anchor 1 | Finale uses the whole language |
| Endless | seeded roll: 2–4 specials from a weighted pool (ridge 30, sinkhole 30, conduitPairs 15, anchor 15, nullcell 10) | Per-run variety, seeded at level build like veins |

Note for Phase 3 awareness: L9 and L11 paths get reworked in Phase 3 — these placement algorithms are path-relative, so inventories survive the rework untouched. Do not special-case them.

### 2.3 Placement algorithms (game.ts, inside `buildGrid()` after asteroid/vein seeding — copy that seeded-RNG pattern exactly)

Seed: `mulberry32(hashString(`${this.level.id}-cells`))` (endless XORs a per-run random like veins do). Compute for every valid cell: `pathAdj` = count of path cells within Chebyshev 1; `pathNear(k)` = any path cell within Chebyshev k. Then place in this fixed order (later types must respect `minSeparation` from all earlier ones, plus never on path/rock/vein/end cells; if a type can't be placed after 40 seeded attempts, relax `minSeparation` to 1, then skip with a console.warn — validate.ts will catch systematic failures):

- **Sinkhole — "the chokepoint hug":** candidates = valid cells with `pathAdj ≥ 2` (bend interiors and double-coverage pockets). Pick highest `pathAdj`, seeded tie-break. Reason: short-range towers get a home exactly where the path folds back on itself.
- **Ridge — "the back line":** candidates = valid cells with `pathAdj == 0` AND `pathNear(3)` true AND NOT `pathNear(1)` (one-to-two steps back from the road). Prefer candidates nearest a path corner (a path cell whose two path neighbors are non-collinear). Reason: the +1 range only matters if you're standing back; putting ridges at bends makes the reach-vs-rate tradeoff bite.
- **Conduit pair — "the firing line":** find the longest straight run of consecutive path cells; candidates = orthogonally adjacent valid-cell PAIRS on the same side of that run, both with `pathAdj ≥ 1`, centered nearest the run's midpoint. Mark both cells `special='conduit'` and store the partner index on each. Reason: rewards building a deliberate line along the longest sightline. Fallback if no such pair: any adjacent valid pair each with `pathAdj ≥ 1`.
- **Anchor — "the cluster heart":** candidate score = count of valid 8-neighborhood neighbor cells that each have `pathAdj ≥ 1`. Pick max. Reason: the anchor sits where a tower cluster naturally forms, making Amp placement a puzzle about the cluster, not the Amp.
- **Null Zone — "the last-ditch drag":** candidates = valid cells with `pathAdj ≥ 1` adjacent to the FINAL third of the path (by path-cell order). Pick seeded. Set `valid = false`, `special = 'nullcell'`. Reason: a mercy-brake near the base that the player routes their kill-zone around — terrain the player reads, not a rule they memorize.

Extend `CellInfo` with `special: string | null` and `conduitPartner?: number`. Store a `nullCells: number[]` list on Game for the slow lookup.

### 2.4 Effect wiring (game.ts)

1. `Tower` gains `cellType: string | null` — set in `buildAt()` and `confirmMove()` from `this.cells[cellIdx].special` (move ONTO a special cell picks up its modifier; moving off drops it — that's the point of Move mattering). On resume restore, recompute from the cell index (grid is deterministic given the snapshot's tileSize/meander — already enforced).
2. `Tower.stats(game)` and `rangeT()`: apply ridge/sinkhole. `rangeT()` currently takes no args — change signature to `rangeT(game?: Game)` OR (simpler, preferred) have the Tower cache the numeric modifiers on `cellType` assignment: `cellRangeAdd`, `cellRateMul`, `cellDmgMul` fields, defaulting 0/1/1. Then `rangeT()` becomes `Math.max(1, Math.round(raw.range * (1 + bRange)) + this.cellRangeAdd)` and `stats()` multiplies `dmg *= cellDmgMul`, `rate *= cellRateMul`. Range floor of 1 is load-bearing (sinkhole on a range-1 Flame stays 1 — pure win — intended: that IS the short-tower home).
3. **Anchor:** in the amp-buff application loop (~1275), when the buffing amp's `cellType === 'anchor'`, multiply its contributed `buffDmg/buffRate/buffRange/crit` by `TUNING.cells.anchor.ampMul`. The amp's own panel shows "Anchored ×2".
4. **Conduit:** once per `update()` before the tower loop: `this.conduitTarget = ` the current `target` of the conduit-cell tower with the highest `spent` that has a live, targetable target; in `updateTower`, a conduit tower whose acquisition would normally run picks `conduitTarget` instead IF `canHit(t, conduitTarget)` and it's in range — else falls through to normal targeting. Targeting-mode chips still apply when the shared target is out of reach. Draw a faint pulse along the partner link when both cells host towers.
5. **Null Zone:** in the ground-enemy movement step inside `Enemy.update` (game ref is available), apply `speedMul *= (1 - TUNING.cells.nullcell.slowPct)` when the enemy's position is within 1.5 tiles (px: `1.5 * game.cell`) of any null cell center. Precompute null-cell px centers once. Fliers exempt. Multiplicative with tower slows. Show the standard slow tint on affected enemies (reuse existing slow visual state).

### 2.5 Rendering (game.ts `drawTiles`)

All treatments are value/elevation-based, palette-neutral, and must stay readable at 390px-tall mobile:

- **Ridge:** cell face lifted — draw the cell fill 2px up-shifted with a lighter top edge (same hue +12% lightness) and a 3px darker drop shadow along its bottom edge.
- **Sinkhole:** inset — darker fill (−12% lightness), 2px inner shadow on the top edge, subtle downward-triangle glyph at low alpha.
- **Conduit:** both cells get a soft emissive border plus an animated dashed link line between their centers (pulse alpha 0.3–0.6, ~1.2s period; static at reduced opacity when `reduceMotion`).
- **Anchor:** two thin concentric rings inside the cell, slow rotation (static under `reduceMotion`).
- **Null Zone:** diagonal hatch pattern + a faint dashed radius ring hinting the slow field; render the ring only while an enemy is inside it (keeps the board quiet).
- Occupied special cells keep their treatment visible around the tower pad (draw special treatment before pads — verify z-order).
- `perfMode`: drop the animated elements (pulse/rotation), keep the static shapes.

### 2.6 Legibility: tooltips, build hints, panel chip, level cards (ui.ts)

1. **Cell tooltip** (Kevin's explicit requirement): hovering a special cell (desktop `mousemove` → `cellAt`) or long-pressing it (extend `handleLongPress`, which currently handles aliens/towers) shows a card: icon + name, blurb, and `Best for: Sentinel · Ray` built from `bestFor`. Reuse the alien-tooltip DOM component and its pinned-till-lift behavior. Long-press on an EMPTY special cell must not open the build menu (tooltip wins; tap still builds).
2. **Build menu hint:** when `openBuildMenu(cellIdx)` targets a special cell, show a header chip (icon + name) and add a `cell-favored` pulsing outline class to the tiles of `bestFor` towers.
3. **Tower panel chip:** a selected tower on a special cell shows `On Ridge ⛰ (+1 range, −15% rate)` under its name. (Phase 6 will fold this into the Tier-1 panel; put it anywhere sensible now.)
4. **Level-select cards:** a cell-inventory line from `cellPlan`, e.g. `⛰2 ▽1 ↭1` with a legend in the level-card tooltip/briefing text. Kevin's "think about the map on the bus" hook.
5. **Codex:** add a "Terrain" section listing the five types (reuse the modifier-codex pattern).

### 2.7 Gating & onboarding

- `UNLOCKS['cells'] = 3` and `SEEN_UNLOCK_LEVELS['cells'] = 3`. When locked (fresh save below L3), `buildGrid` skips `cellPlan` entirely — the board is visually identical to today.
- `toastOnce('cells', 'Special terrain! Long-press (or hover) a marked cell to see what it does — the right tower in the right place hits harder.')` on first entering a level with specials.
- Veterans: migration pre-marks `seen.cells` (verify via the existing `unlocked > 1` loop).

### 2.8 Validation & tests

- `validate.ts`: for every level × meander tier (0–2) × tile size option, run the placement routine headlessly: assert requested counts placed (warn-level allowed for ≤1 shortfall on the smallest grids — record which), no special on path/rock/vein/end, conduit partners adjacent, null cells in final path third. Assert `CELL_TYPES` ids match `TUNING.cells` keys.
- New `tests/cell-seeding.ts` (model on `tests/asteroid-vein-seeding.ts`): determinism (same seed → same cells twice); separation rule; a stats test: a mock tower on ridge/sinkhole reports modified range/rate/dmg; null-slow math.
- Resume round-trip test extension: tower on a special cell restores `cellType` correctly.

### 2.9 Exit criteria

- Gates green. Dev-jump L3 (fresh-save sim): exactly 1 ridge + 1 sinkhole visible, tooltips work by hover AND long-press; L2 shows none on a fresh save; veteran save shows specials on every authored level.
- Screenshot pass at 846×390: all five treatments distinguishable, tooltips reachable.
- Play check: place a Flame on a sinkhole beside a bend and a Sentinel on a back-line ridge — panel numbers reflect both; an Amp on L5's anchor shows doubled buffs on neighbors.

---
## PHASE 3 — MAP, PATH & PORTAL IDENTITY

**Intent.** Make each level *look like itself* every time (seeded backgrounds + hand-authored landmarks), make the road the most legible thing on the board (recessed channel + directional flow), telegraph spawns at the portal, and break the all-maps-are-one-wiggly-lane monotony by restructuring two levels using the engine's proven multi-path support. Pastel identity is binding (A.5.1): landmarks are soft, friendly silhouettes, not grimdark wreckage-noir.

**Do NOT:** implement a self-crossing loop path (A.5.8); change any wave *content* (Phase 5's job) beyond the path-index reassignments L9/L11 require; add audio (Phase 7 owns the portal/spawn sounds — this phase creates the visual hooks it will pair with).

### 3.1 Seeded, persistent backgrounds (game.ts `buildBg` + star field)

1. Replace every `Math.random()` in `buildBg()` with draws from `const rng = mulberry32(hashString(`bg-${this.level.id}`))` — nebula blob positions, radii, and color pick order. The same level now always generates the same sky.
2. Seed the star field (game.ts ~705) from the same rng (continue drawing from it after the blobs) so star placement is also stable per level.
3. Endless: seed from `hashString('bg-endless-' + runSeed)` where runSeed is one per-run random int — per-run identity, consistent within the run (and across a resume: store runSeed in the ResumeSnapshot — this is a snapshot field addition; per A.3 increment `RESUME_VERSION` to 2 in this phase and note it).

### 3.2 Hand-authored landmarks (data.ts table + game.ts draw)

1. Data: `export const LANDMARKS: Record<number, { kind: 'planet'|'moon'|'derelict'|'station'|'comet'; x: number; y: number; s: number }[]>` keyed by level id (99 = endless). Coordinates are in the 1280×720 logical space; `s` = scale 0.6–1.6.
2. Draw functions (in `buildBg`, painted onto the cached bg canvas after nebulas, before the grid): soft rounded silhouettes at ≤0.5 alpha in the zone's nebula tones with a thin rim highlight in the zone accent. Shape recipes:
   - `planet`: a large circle limb entering from an edge (draw the circle mostly off-canvas) + one thin ring arc.
   - `moon`: small full circle + 2–3 seeded craters (darker circles).
   - `derelict`: a rounded-rectangle hull silhouette with 2 fin trapezoids and 3 lit porthole dots (accent color, alpha 0.6) — friendly, toy-like, not menacing.
   - `station`: a ring + hub circle + 2 spokes.
   - `comet`: small bright head + long soft gradient tail (angled toward a corner).
3. Placement table (author exactly; edges/corners only — the mid-board must stay clean for gameplay):

| L | Landmarks |
|---|---|
| 1 | planet(1180, 90, 1.3) — a big friendly limb top-right; moon(120, 640, 0.7) |
| 2 | station(1150, 620, 0.9); moon(90, 100, 0.6) |
| 3 | comet(200, 80, 1.0); moon(1200, 660, 0.8) |
| 4 | planet(80, 620, 1.2); comet(1150, 100, 0.8) |
| 5 | derelict(1160, 120, 1.1) — the Mothership's escort wreck; moon(140, 620, 0.6) |
| 6 | planet(1190, 640, 1.4) — ember-lit limb; comet(150, 90, 0.7) |
| 7 | station(640, 60, 0.8) between the twin lanes' top edge; moon(80, 660, 0.7) |
| 8 | derelict(90, 90, 0.9); moon(1210, 650, 0.9) |
| 9 | comet(1180, 80, 1.1); derelict(110, 640, 0.8) |
| 10 | planet(70, 90, 1.5) — the Colossus looms from top-left; station(1190, 650, 0.7) |
| 11 | moon(1200, 90, 1.0); comet(100, 640, 0.9) |
| 12 | station(640, 680, 0.9) under the crossing; moon(90, 80, 0.6) |
| 13 | planet(1200, 640, 1.3); derelict(100, 100, 0.7) |
| 14 | derelict(640, 70, 1.0) hanging over the gauntlet corridor; comet(1180, 640, 0.8) |
| 15 | planet(640, -60, 1.6) — a vast limb across the whole top edge; station(120, 640, 0.8) |
| 99 | seeded pick of 2 from the full set (positions from a small preset list), using the runSeed rng |

4. `validate.ts`: every LANDMARKS coordinate within [−100, 1380]×[−100, 820]; every level 1–15 has 1–3 entries.

### 3.3 The road becomes a road (game.ts `drawTiles`)

1. **Recessed channel:** path cells render darker than terrain (−14% lightness of current path fill), with a 2px inner shadow along both long edges of the channel, replacing the current "just another tile" fill.
2. **Directional flow:** precompute, once per grid build, an ordered list of path-cell centers per path with a unit direction each (toward the base). Each frame draw small chevrons (`›` triangles, ~10px, alpha 0.35) on every second path cell, offset along the direction by `(now * 28) % spacing` so they visibly march toward the base. Under `reduceMotion`: static chevrons, no march. Under `perfMode`: every third cell.
3. **Hot portal:** the portal cell(s) get a persistent soft radial glow in the zone accent; the base cell(s) get a calmer teal glow. (The charge-up effect in 3.4 layers on top of this.)
4. Multi-path levels: chevrons per path; where paths share/cross cells (L12), draw both directions — it reads as an intersection, which it is.

### 3.4 Portal charge telegraph (game.ts)

1. At every frame while a wave is active or pending-launched, compute per path the earliest un-spawned `spawnQueue` time `t0`. If `now ≥ t0 − TUNING.portals.chargeLead` (add `portals: { chargeLead: 2 }` to TUNING), render the charge state on that portal: an expanding ring + brightening core in the **color of the enemy type of that pending group** (the group whose spawn is at `t0`), reaching peak exactly at spawn.
2. Because this reads from `spawnQueue`, a Feint wave's delayed second group (Phase 5) automatically telegraphs its portal 2s ahead — zero extra work later. State that in a code comment.
3. `reduceFlash`: cap the core brightness ramp. This visual is the designated "mute twin" of Phase 7's spawn-signature audio — leave a `// AUDIO-TWIN: spawn signature (Phase 7)` comment at the render site.

### 3.5 Structural rework: L9 becomes a fork-rejoin, L11 becomes converging lanes (levels.ts)

Engine facts making this safe: multiple `paths` per level are already supported (L7, L12), meander+mirror fuzz already covers multi-path levels, and paths sharing/crossing cells is proven by L12. To avoid any risk of meander treating shared waypoints inconsistently, the "fork" and "rejoin" are built from two paths whose endpoints are ADJACENT (one tile apart), never coincident — visually one mouth, structurally two clean polylines.

1. **L9 "Shatterfield" → fork-rejoin.** Replace `paths` with:

```ts
paths: [
  [[-40, 380], [200, 380], [200, 160], [640, 160], [640, 300], [1000, 300], [1000, 380], [1320, 380]],
  [[-40, 420], [200, 420], [200, 600], [640, 600], [640, 460], [1000, 460], [1000, 420], [1320, 420]],
],
```

Adjacent portals (y 380/420) fork immediately; adjacent bases (380/420) read as a rejoined mouth. Keep the existing 5 asteroid rocks only if they don't sit on either new path at any meander/tile setting — the existing seeded-asteroid rule already re-rolls collisions, but these are the STATIC `asteroids` array; check each against both polylines' cell footprints and nudge coordinates if needed (record nudges).
Rewrite the waves array with explicit path assignments — split each existing wave's groups across `p:0`/`p:1`, preserving composition and totals. Author it as: first group of each wave → p:0, second → p:1, third alternates, single-group waves split into two half-size groups (rounding up on p:0). Splitters remain the stars of the level. Write the final array out in full in levels.ts (no runtime splitting logic).

2. **L11 "Void Door" → converging lanes.** Replace `paths` with:

```ts
paths: [
  [[-40, 180], [420, 180], [420, 340], [860, 340], [860, 260], [1320, 260]],
  [[-40, 560], [300, 560], [300, 460], [700, 460], [700, 300], [1320, 300]],
],
```

Two separate portals (top-left, bottom-left) converging to adjacent base rows (260/300) on the right. Phasers arriving on two fronts is the level's new identity. Redistribute wave groups across paths as for L9. Bump the Minimalist challenge param 8 → 9 (two lanes with 8 towers was calibrated for one lane; note the recalibration).

3. Both levels: run `tests/mirror-meander-fuzz.ts` and the asteroid seeding test; play both at tile sizes 40/48/56 × meander 0–2 in dev mode and screenshot. If grid snapping merges the adjacent portal/base cells into one at any tile size, widen the y-separation to 60px and re-verify.
4. Update the two levels' level-card taglines to advertise the structure ("Two mouths, one door." / "They come from both flanks.").

### 3.6 Validation & tests

- Fuzz suite green across all 15 levels × meander × mirror (this is the phase most likely to break it — run it early and often).
- `validate.ts` additions from 3.2.4; assert every level's every path stays within x∈[−40,1320] y∈[100,680] after authoring.
- Visual QA checklist in PROGRESS-3.md: per-level screenshot at 1280×720 confirming landmark placement doesn't collide with HUD zones or the path.

### 3.7 Exit criteria

- Gates + fuzz green. Reload L6 three times — identical sky each time. L9/L11 playable start to finish on Normal with no pathing anomalies; flier behavior unchanged (they still fly portal→base — curved lanes are Phase 5).
- Portal charge visibly precedes every spawn group incl. mid-wave delayed groups. Chevrons march; `reduceMotion` freezes them; `perfMode` thins them.
- RESUME_VERSION = 2 shipped with runSeed; resume round-trip test updated and green.

---
## PHASE 3B — VISUAL IDENTITY & READABILITY (execute as its own session: "execute phase 3B")

**Intent.** Solve the "soup" problem — towers and enemies currently share mid-value pastels on navy and blur together at phone size — while honoring the pastel commitment (A.5.1): the split is by **value and temperature**, not by abandoning the palette. Simultaneously: move every tower/enemy color into a token table (so the Chroma prestige unlock finally re-themes the actual board, and a colorblind-accessible variant becomes a data entry, not a rewrite), exaggerate the size hierarchy so threat reads from silhouette, make bad placement visible on the board itself, and make damage feel physical instead of numeric.

**Do NOT:** darken the game's overall mood (enemies get *warmer and brighter*, not scarier); change any enemy `shape` values (they're the colorblind backbone); touch HUD chrome colors (already themed via CSS vars).

### 3B.1 Palette token table (data.ts + game.ts)

1. Create `export const PALETTE: Record<'default' | 'chroma' | 'accessible', { towers: Record<string, [string, string]>; enemies: Record<string, [string, string]>; rim: string; muzzle: string }>` and route EVERY canvas draw of tower/enemy color through `game.pal()` (a getter resolving the active variant from settings). Remove the `color/color2` reads from specs in draw code (keep the spec fields as the 'default' source of truth that PALETTE.default is generated from — one place to edit).
2. Active variant resolution: `accessible` setting (3B.6) wins, else `chromaOn`, else default. The Chroma unlock's scope-cut comment (canvas never re-themed) is now obsolete — delete it and note in PROGRESS-3.md that the prestige reward finally touches the board.

### 3B.2 The value/temperature split (exact hexes — PALETTE.default)

**Towers → cool, desaturated, slightly dark; their brightest element becomes the muzzle flash** (`muzzle: '#eaffff'` — boost flash/shot particle brightness accordingly). **Enemies → warm, saturated, with a warm rim-light** (`rim: '#fff4e0'`, drawn as a 1.5px arc on the upper-left of each body at 0.5 alpha in `drawEnemyBody`).

| Tower | color, color2 | | Enemy | color, color2 |
|---|---|---|---|---|
| pulse | #8fbfae, #5d8f7f | | drone | #ffb36e, #cc7f3f |
| mortar | #c4a894, #93755f | | dart | #ffd166, #c99b33 |
| cryo | #86b4cc, #5b84a1 | | brute | #ff8f6e, #c95c3d |
| missile | #c495a6, #92697c | | swarmling | #ffe066, #c9a933 |
| tesla | #cfc491, #9c9260 | | aegis | #ff9e9e, #c96a6a |
| amp | #a394cc, #77699c | | wisp | #ffb3d9, #c980a8 |
| prism | #c47a8d, #94566a | | raptor | #ff8fb8, #c95f88 |
| ray | #a8bf78, #79904c | | mender | #d4e86e, #a3b53f |
| flame | #c4906a, #925f3d | | splitter | #ffc09e, #c98f6e |
| sentinel | #b596cc, #85689c | | phase | #ffd9a8, #cca872 |
| | | | mothership | #ff9ecf, #c96f9e |
| | | | colossus | #ff7f5c, #c9502f |
| | | | leviathan | #ffb85c, #cc8a2e |

Two enemies rely on non-color identity carriers after the warm shift — mender keeps its "healer" read via the chartreuse family + heal pulses, phase via its shimmer effect; call this out in the codex if confusion appears. **Fallback (pre-authorized):** if side-by-side play screenshots show learned-identity confusion, keep enemy HUES as-shipped and apply only +20% saturation + the rim light, logging the deviation. Capture before/after screenshots at 1280×720 AND 846×390 for Kevin's review either way (headless puppeteer if available in the Claude Code environment; otherwise point Kevin at the branch's Vercel preview URL with instructions on what to compare).

Projectiles, beams, and burn/slow tints keep reading from their owner's palette entry — verify Tesla bolts and Prism beams stay visible against the new warm enemy bodies (they will — cool-on-warm).

### 3B.3 Scale hierarchy (data.ts sizes + verification)

| Enemy | size old → new | | Enemy | old → new |
|---|---|---|---|---|
| swarmling | 7.5 → 6.5 | | splitter | 16 → 17 |
| dart | 10 → 9.5 | | aegis | 15 → 16 |
| raptor | 11 → 10.5 | | mender | 15 → 16 |
| drone | 13 (keep) | | brute | 20 → 26 |
| wisp | 12 (keep) | | mothership | 34 → 40 |
| phase | 13 (keep) | | colossus | 38 → 46 |
| | | | leviathan | 42 → 52 |

`spec.size` participates in splash/ray/collision checks (`dist < splash + e.spec.size`, ~1633) — bigger brutes/bosses become marginally easier to splash-clip; accepted and noted. Verify after the change: elite brute (26×1.35≈35px) doesn't clip path walls visually at tile size 40; boss entrance shockwave/boss bar unaffected; leak visuals scale fine; fliers' straight approach still reads with the larger silhouettes (curved lanes arrive in Phase 5).

### 3B.4 Idle & uncovered tower feedback (game.ts)

1. Build the cached helper `pathCellsInRange(t): number` (enumerate cells within `rangeT()` Chebyshev of `t.col/row`, count `path` flags; recompute on build/move/upgrade/grid rebuild — store on the tower). **Phase 6's threat-readout coverage math reuses this exact helper — build it clean.**
2. **Uncovered** (hard warning): `pathCellsInRange === 0` AND the tower is groundOnly — it can never do anything: render at 45% brightness with a small `zᶻ` glyph, and its panel shows "Can't reach the road from here." Air-capable towers are exempt from the hard state (flier lanes vary per wave — Phase 5) but still get the soft state.
3. **Idle** (soft): has coverage but no target for >1.5s → 25% dim, glow/hum visuals off; instant restore on acquiring a target. Teaches placement quality by observation, no tooltip required.

### 3B.5 Physical hit & death feedback (game.ts `drawEnemyBody` / `hurt` / `deathFx`)

1. On hit: flash-to-white (existing `flashT` — verify wiring on every damage path incl. burns at reduced strength), squash impulse via the existing squash hook, and a 2px positional nudge along the hit direction (skip nudge under `reduceMotion`).
2. Bespoke deaths in `deathFx` by species (particles only — no new systems): **brute** cracks into 5 rotating 'shard' plates in its two palette tones; **swarmling** is a single quick pop ring (they die in dozens — keep it cheap); **aegis** whose shield broke this life shows hex-fragment shards a beat before the body burst (shield-break already has `shieldBreak` FX — chain them); **splitter**'s existing split burst stands. Bosses keep the Phase-4(2.0) death theater untouched. `perfMode` caps shard counts.
3. Floating damage numbers remain (respecting the existing toggle) but are now the *secondary* channel — do not enlarge them.

### 3B.6 Accessible palette (save.ts + ui.ts + data.ts)

`settings.accessiblePalette: boolean` (default false; migrate guard; settings row under the existing accessibility pair). `PALETTE.accessible`: derive from default but push VALUE separation — enemies warm-LIGHT, towers cool-DARK — and avoid red/green discrimination (shift mender toward yellow `#e8d96e`, ray toward blue-grey `#9fb4c4`). Enemy `shape` variety (circle/slim/square/hex/diamond/lumpy) is the second redundancy channel — add a `validate.ts` assertion that every non-boss enemy has a unique (shape, size-band) pair. `PALETTE.chroma`: port the existing chroma UI scheme's spirit onto the board tokens (cooler teals/magentas), same structure.

### 3B.7 Validation, tests, exit

- `validate.ts`: PALETTE has all three variants × every tower/enemy id; unique shape/size-band assertion; all hexes parse.
- Manual grep gate: no remaining hardcoded tower/enemy hex literals in `drawTower`/`drawEnemy*`/projectile draw paths (list any intentional stragglers in PROGRESS-3.md).
- Exit: before/after screenshot pairs (desktop + 846×390) attached for Kevin; toggling Chroma and Accessible visibly re-themes the BOARD, not just chrome; a groundOnly mortar placed in a far corner dims with `zᶻ` and explains itself; a brute death feels chunky at 3× speed in perfMode without frame drops (watchdog silent).

---
## PHASE 4 — TOWER DEPTH: PRICING, VERBS, REACTIONS, OVERCHARGE, VETERANCY

**Intent.** Attack "most upgrades are bigger numbers" from five angles at once: reprice range so reach costs what it's worth; give the short-range specialist (Flame) a genuine mechanical niche; add three cross-tower reactions (the genre's best discovery moments); rewrite the worst pure-stat tier-2 upgrades as verbs; and add two per-tower systems — Overcharge (an active mid-wave verb) and Veterancy (a reason to protect a specific tower instead of reflexively rebuilding). Together with Phase 2's cells, this is what makes two different maps produce two different builds.

**Do NOT:** rewrite all 30 tier-2 nodes (only the 5 specified — restraint IS the design; too many new mechanics turns discovery into homework); add a point-blank damage multiplier to Flame (explicitly cut: stacking burn + sinkhole cells already deliver the niche — three stacked buffs would over-shoot); implement reactions beyond the three specified.

### 4.1 Range repricing (data.ts — exact cost edits)

| Node | Old → New |
|---|---|
| Sentinel Mk I | 110 → 170 |
| Sentinel Mk II | 95 → 105 |
| Sentinel Mk III | 150 → 165 |
| Farsight / Star Sentinel | 260→280 / 360→380 |
| Rapid / Storm Sentinel | 250→265 / 340→360 |
| Warden / High Warden | 250→265 / 340→360 |
| Flame Mk I | 120 → 110 |

Everything else stays. Sentinel must end up the most expensive BASE tower (validate.ts asserts `TOWERS.find(sentinel).stages[0].cost === max over towers`). Update its blurb: "Covers half the map — reach is never cheap." Rationale comment in data.ts: range solves coverage AND uptime simultaneously (Defender's Quest lesson), so it carries the price tag.

### 4.2 Flame's niche: stacking burn (game.ts + data.ts)

1. `Enemy` gains `flameStacks = 0` and `flameStackUntil = 0`. New method:

```ts
igniteStack(dps: number, dur: number, now: number) {
  if (now > this.flameStackUntil) this.flameStacks = 0;
  this.flameStacks = Math.min(3, this.flameStacks + 1);
  const eff = dps * (1 + 0.5 * (this.flameStacks - 1));   // 1.0× / 1.5× / 2.0×
  this.burnDps = Math.max(this.burnDps, eff);
  this.burnUntil = Math.max(this.burnUntil, now + dur);
  this.flameStackUntil = this.burnUntil;
}
```

2. Flame-kind towers call `igniteStack` instead of `ignite`; Magma/Sunfire Mortar and everything else keep plain `ignite` (max-based). Add `TUNING.flame = { stackMax: 3, stackStep: 0.5 }` and read from it.
3. Visual: fire-particle emission rate in `Enemy.update`'s burn block scales with `flameStacks`; tooltip shows `Burning ×N`. Codex/blurb update: "Flame damage stacks up to three times on the same target — nothing melts a chokepoint like a committed Flame."
4. Test: three rapid igniteStack calls → burnDps = 2× base; expiry resets stacks; mortar burn unaffected.

### 4.3 Cross-tower reactions (game.ts + data.ts + codex)

Add `TUNING.reactions = { shatterFrac: 0.30, shatterRadius: 60, shatterCap: 250, conductionMul: 1.5, coldFocusGrace: 1.0 }`.

1. **Shatter** — *frozen enemies shatter on death.* In `onKill(e)`: if `e.frozenUntil > this.now` and `!e.spec.boss`, call `this.explode(e.x, e.y, R.shatterRadius, Math.min(e.maxHp * R.shatterFrac, R.shatterCap * this.currentHpScale()), '#a0d8ef', 1, false)` (hits air and ground; the cap scales with the campaign per Phase 1's helper so it neither one-shots early waves nor dies late). Ice-shard particles + existing `freezeCrack` audio. The kill source doesn't matter — the simple rule ("frozen things shatter") is the learnable one; the Cryo→Mortar pairing the ideas doc described emerges naturally because splash is what kills groups of frozen enemies. Splitter interaction: splits spawn first, then the shatter explosion may damage the spawned swarmlings — allowed, delightful, verify no iteration crash (spawn mid-onKill already happens today).
2. **Conduction** — *burning enemies take +50% from Tesla chains.* In the tesla damage application inside `fire()` (the chain loop): `if (en.burnUntil > this.now) dmg *= TUNING.reactions.conductionMul;` with a small gold spark on the proc.
3. **Cold Focus** — *a chilled kill doesn't break Prism's focus.* In `updateTower`'s prism handling, when the beam's target dies: if the dead target had `slowUntil > now`, retain `t.rampT` and set `t.coldFocusUntil = now + TUNING.reactions.coldFocusGrace`; if a new target is acquired before that expires, the ramp continues; otherwise it resets as today.
4. Each reaction gets: a `toastOnce('react_shatter'|'react_conduction'|'react_coldfocus', …)` on FIRST proc (write friendly one-liners, e.g. "SHATTER! Frozen enemies explode when killed — Cryo sets them up, splash knocks them down."), a line in a new Codex "Synergies" section, and a mention in the relevant tower codex entries. Discovery-first: no upfront tutorial beyond the toasts.
5. Tests (`tests/reactions.ts`): conduction multiplier math; shatter cap at L1 vs L15 scale; shatter never triggers on bosses; cold-focus ramp retention window.

### 4.4 Tier-2 verb rewrites (data.ts + game.ts — exactly these five)

New optional `StageStats` fields: `pierceRamp?: number; directStun?: number; farTiles?: number; farMul?: number; freshMul?: number; burnSpread?: number`.

| Node | New desc (player-facing) | Data | Implementation |
|---|---|---|---|
| Pulse › Star Lance | "Pierces 3. Each enemy the lance passes through takes 40% more than the last." | `pierceRamp: 0.4` (drop `crit`) | Bullet pierce handler: track hit index k per bullet; damage ×(1+pierceRamp)^k |
| Missile › Nova Torpedo | "A massive warhead. The enemy it strikes directly is stunned for half a second." | `directStun: 0.5` | Missile impact: primary target `frozenUntil = max(…, now + 0.5)` (splash victims unaffected) |
| Ray › Farlance | "Extreme range. Enemies 3+ tiles away take +50% — a true artillery beam." | `farTiles: 3, farMul: 1.5` | Ray hit loop: if Chebyshev tile distance tower→enemy ≥ farTiles, dmg ×farMul. Creates a REAL placement verb: build it far BACK (pairs with ridge cells) |
| Sentinel › Storm Sentinel | "Rapid fire that hits undamaged targets 50% harder — the perfect opener." | `freshMul: 1.5` | Bullet damage: if `e.hp >= e.maxHp` (and shield full if shielded), ×freshMul. Makes 'First' targeting mode a real choice on this tower |
| Flame › Hellmouth | "When a burning enemy dies, its fire leaps to the nearest enemy within 70px." | `burnSpread: 70` | Track `e.flameSpread=true` when ignited by a tower whose raw has `burnSpread`; in `onKill`, if set and burning, find nearest live non-boss enemy within 70px and `igniteStack` it with the killer's burn stats |

Every other tier-2 node keeps its current design — most already carry verbs (cluster, stun, freeze, auras, splits, ramp caps). Update the five descs verbatim; keep costs unchanged; codex regenerates from descs automatically. Tests: pierceRamp math on a 3-enemy line; freshMul only at full HP; burnSpread only from Hellmouth-sourced burns.

### 4.5 Overcharge — the mid-wave verb (game.ts + ui.ts + data.ts)

1. `TUNING.overcharge = { charges: 3, rateMul: 2, dur: 3 }`. `UNLOCKS['overcharge'] = 4` (+ SEEN sync). Deliberate pairing with `drops` at L4 — the "things you TAP" level; stagger the intros: the scripted first crate is L4 wave 2 (existing), so fire `toastOnce('overcharge', 'OVERCHARGE — tap a tower during a wave, then hit ⚡ to double its fire rate for 3 seconds. 3 charges per wave.')` at L4 wave 1 launch.
2. `Game` fields: `overchargeLeft = 0;` (reset to `TUNING.overcharge.charges` in `callWave` when unlocked) and per-tower `overchargedUntil = 0` on `Tower`. Neither needs serialization — resume snapshots are wave-clear only and charges replenish at wave launch; leave a comment saying exactly that.
3. Effect in `Tower.stats()`: firing towers (`rate > 0`): `rate ×= rateMul` while overcharged; rate-0 towers (prism/auras): `dmg ×= rateMul` instead. Amp: excluded (hide the button). Stacks multiplicatively with the supply-drop Overclock — rare, short, allowed; note it.
4. Activation: (a) the tower panel gains an `⚡ Overcharge (N left)` button, enabled only while `waveActive && overchargeLeft > 0 && now >= t.overchargedUntil`; (b) double-tap directly on a tower does the same (guard: only when not in build/move flows; reuse the tap-position plumbing in `handleMapTap`).
5. Feedback: crackle sparks + brightened muzzle + a depleting ring around the pad; small HUD pips (⚡⚡⚡) in the bottom-left action cluster showing charges (Phase 6 formalizes the zone; place beside abilities now). Haptic `buzz([18])`. `reduceFlash` caps the brightness pop. Audio: temporary reuse of `audio.ui('upgrade')`; Phase 7 replaces with a dedicated whir (leave `// AUDIO-TWIN` comment).
6. Tests: charge reset per wave; rate vs dmg pathway by tower kind; gating (locked before L4 fresh-save).

### 4.6 Veterancy (game.ts + ui.ts + resume.ts + data.ts)

1. `TUNING.veterancy = { kills: 45, perks: { sharp: 0.12, rapid: 0.12, scav: 1 } }`. `UNLOCKS['veterancy'] = 8` (+ SEEN). Perks: **Sharpshooter** +12% damage · **Rapid Cycler** +12% fire rate · **Scavenger** +`round(1 × econScale())`◆ per kill (computed at payout time so it scales).
2. `Tower` gains `perk: 'sharp' | 'rapid' | 'scav' | null = null`. Existing `t.kills` is the counter (crossing the threshold is checked in `onKill` where `t.kills` increments). On crossing: gold "VETERAN" floater over the tower, persistent gold chevron badge on the pad (render near the existing upgrade star pips, `starPip` area ~3255), `buzz([12,30,12])`, and if the tower's panel is open, show the chooser immediately.
3. Chooser UI: a compact 3-button row in the tower panel headed "Veteran — choose a perk" (one tap, irrevocable). Non-blocking: the game never pauses for it; an unchosen perk just waits (badge pulses until chosen). `toastOnce('veterancy', …)` on the first eligible tower.
4. Apply in `stats()`: sharp → `dmg ×1.12`; rapid → `rate ×1.12`; scav → handled in `onKill` credit payout (add to the vein-credit block). Panel shows the perk name+icon once chosen.
5. **Selling a veteran forfeits the perk — that's the point** (a tower worth protecting). Add a `title` warning on the sell button when `t.perk`. Move keeps everything.
6. Resume: `ResumeTower` gains `perk` (kills are already serialized). `RESUME_VERSION` 2 → 3. Round-trip test updated.
7. Tests: threshold trigger at exactly 45; perk math in stats; scav payout scaling; resume restores perk + badge state.

### 4.7 Exit criteria

- Gates green. Dev sandbox: freeze a Brute cluster with Absolute Zero, mortar them → shatter chain visibly procs with toast; burn a lane with Flame, add Tesla → conduction sparks; Star Lance visibly ramps down a conga line.
- Sentinel is the priciest base tower everywhere it's displayed; Flame stacks show ×2/×3 burn on a held target.
- Overcharge: 3 pips, double-tap works on S23+-sized viewport (dev tools emulation), pips vanish when locked (fresh-save sim below L4).
- A 45-kill tower offers exactly one perk choice; sell warning shows; resume preserves it.
- PROGRESS-3.md notes any tuning deviations (esp. shatterCap and freshMul if playtests demanded).

---
## PHASE 5 — WAVE SHAPES, FLIER LANES & DIFFICULTY REDESIGN

**Intent.** Waves stop being spawn tables and become *shapes* the player reads and answers; fliers stop being a solved formula and become a per-wave placement question; higher difficulties change what you *think about*, not how long you wait. All three systems must remain fully deterministic under the Daily Op (hash-seeded, never `Math.random` on anything a daily touches).

**Do NOT:** let shaped waves also roll mutators (A.5.9 — one twist per wave); apply shapes to boss waves or wave 1 of any level; change enemy stats or rosters.

### 5.1 Wave shapes — data model (data.ts + levels.ts)

```ts
export type WaveShape = 'rush' | 'trickle' | 'convoy' | 'feint';
export const WAVE_SHAPES: Record<WaveShape, { name: string; icon: string; blurb: string }> = {
  rush:    { name: 'Rush',    icon: '⏩', blurb: 'The whole wave arrives within seconds. Burst damage or bust.' },
  trickle: { name: 'Trickle', icon: '⋯', blurb: 'One at a time, endlessly spaced. Single-target damage matters.' },
  convoy:  { name: 'Convoy',  icon: '🚚', blurb: 'A tank leads; support hides behind it. Check your targeting priorities.' },
  feint:   { name: 'Feint',   icon: '◇', blurb: 'A small opener — then a second group, later, from somewhere else.' },
};
```

`LevelSpec` gains `waveShapes?: Record<number, WaveShape>` (0-based wave index → shape).

### 5.2 Shape transforms (game.ts `callWave`, applied to `spawnQueue` immediately after it's built)

Implement `applyWaveShape(shape, queueSlice)` operating on this wave's queued spawns (all share the same launch epoch):

- **rush:** sort by original `t`; re-space uniformly across a 2.0s window from the first spawn's time. Preserve `p` assignments.
- **trickle:** re-space uniformly at 3.0s intervals (authoring rule enforces ≤12 spawns — see 5.3).
- **convoy:** reorder: (1) the single highest-HP non-mender enemy first ("the leader"), (2) all menders immediately behind it, (3) everything else in descending HP. Re-space at a tight 0.5s. Multi-path levels: run the ordering per path.
- **feint:** stable-split the queue: first ceil(40%) keep their times; the remaining 60% shift +10s AND, on multi-path levels, flip `p` to the other path; on single-path levels, if the wave contains fliers, the fliers form the delayed group regardless of the 40/60 cut (their varied lane per 5.4 IS the "different portal"); otherwise the delayed group reuses the portal (a feint in time only — still valid). Phase 3's portal charge telegraph automatically announces the delayed group 2s ahead — verify, don't reimplement.

Mutator exclusion: in `rollMutator`, return null for any wave index present in `waveShapes` (and the endless generator never assigns both — 5.5).

### 5.3 Shape authoring (levels.ts — author exactly this table)

Rules encoded by the table: nothing on wave 1 or boss waves; ≤12 spawns for trickle; feint only L7+ ; first appearance of each shape gets its `toastOnce` (key `shape_rush` etc.) fired at wave launch; 2–3 shaped waves per level from L4 (L3 gets the gentle rush debut).

| Level | waveShapes (0-based index: shape) |
|---|---|
| 3 | {3: rush} — dart wave 4 compressed: the rush debut on a wave of fragiles |
| 4 | {5: rush} (the all-wisp wave) |
| 5 | {2: convoy} (brutes+swarmlings), {4: rush} |
| 6 | {1: trickle} (4 aegis — 1-at-a-time shield duels), {6: rush} |
| 7 | {3: convoy}, {7: feint} (darts split across the twin lanes) |
| 8 | {2: convoy} (brutes+menders — the convoy lesson proper), {5: trickle} |
| 9 | {1: trickle} (splitters spaced out), {7: feint} |
| 10 | {2: convoy}, {6: feint} |
| 11 | {4: convoy} (brutes+menders), {5: feint} (phasers/wisps across lanes) |
| 12 | {2: rush} (splitters both lanes), {7: feint} |
| 13 | {3: convoy}, {7: rush} (the raptor storm), {9: trickle} |
| 14 | {1: trickle} (phasers/aegis), {6: convoy}, {8: feint} |
| 15 | {3: convoy}, {7: rush} (raptors+wisps), {9: feint} |

Sanity-check each chosen wave's spawn count against its transform while implementing (esp. trickle ≤12 including Horde impossibility — shaped waves can't be Horde-mutated, so counts are static); if one violates, move the tag to the adjacent wave and note it.

### 5.4 Flier lanes — per-wave curved approach (game.ts)

1. Replace the straight-line flight with a quadratic Bézier: `P0` = portal, `P2` = base, `P1` = midpoint + perpendicular offset `o`. Per wave: `const r = mulberry32(hashString(`${levelId}-fly-${waveIdx}`)); o = (r() < 0.5 ? -1 : 1) * (120 + r() * 120)`. ALL fliers in the same wave share the lane — that's what makes it learnable/answerable. Enemy carries `flyCtrl {x,y}`; position = bezier(fT/fDur); `fDur` = approximated arc length (16-sample polyline) / speed. Elite-swift recompute (~243) divides `fDur` as today.
2. Boss-spawned minions (`spawnMinion` wisps) keep a STRAIGHT line from their spawn point — their origin already varies with the boss's position; a comment says so.
3. **Telegraph (the decision-maker):** during an intermission, if the pending wave contains fliers, draw the pending lane as a faint dashed arc (sampled bezier, alpha 0.3, enemy-colored) — computable because the seed depends only on levelId+waveIdx. The wave preview pill gains a small ✈ marker when fliers are inbound. This is what converts anti-air from a formula into a per-wave read.
4. Daily (mirrored): portal/base px are already mirrored, the hash seed is identical, so the lane mirrors consistently — deterministic. Endless: same hash scheme on waveIdx works unchanged.
5. Threat-readout forward-hook: leave a helper `flierLanePoints(waveIdx): {x,y}[]` (the 16 samples) exported on Game — Phase 6 consumes it for air-coverage math.
6. Tests: same seed → identical lane twice; arc stays within the 1280×720 bounds for every level's portal/base pairs at max offset (clamp `o` if any level violates — check L7/L12/L9/L11 multi-portal cases; fliers use `portalPx[p]`/`basePx[p]` — verify per-path and keep the per-path lane share).

### 5.5 Difficulty becomes composition (game.ts + ui.ts)

1. **Enemy intro table** (data.ts): `export const ENEMY_INTRO: Record<string, number> = { drone: 1, dart: 1, swarmling: 2, brute: 3, wisp: 4, aegis: 6, raptor: 7, mender: 8, splitter: 9, phase: 11 };` (validate.ts asserts every non-boss enemy present and consistent with each level's `newEnemy` fields).
2. **Hard+ injection (diffTier ≥ 3):** wrap wave retrieval — wherever `waveAt(i)` feeds `preparePending` — in `decorateWave(i)`: for non-boss, non-first, non-shaped waves, deterministically inject ONE extra group: rng = `mulberry32(hashString(`${levelId}-inj-${i}-${diffTier}`))`; pool = enemies with `ENEMY_INTRO ≤ level.id`, not already in the wave, non-boss; pick one; `n = clamp(ceil(waveBounty*0.12 / reward(e)), 2, 8)`, `iv 0.9`, `d = midpoint of the wave's spawn span`, `p = seeded pick of the wave's used paths`. **Critical:** injection must happen where BOTH the forecast preview and the spawn queue read the wave — inject once, upstream, so the preview always shows the truth (mutators already follow this pattern via `preparePending`; mirror it). Deterministic → Daily Op (always Hard) stays reproducible; extend `tests/daily-op.ts` to assert two runs produce identical decorated compositions.
3. **Brutal blackout (diffTier = 4):** the second-wave forecast card renders as a `?` card labeled "SIGNAL JAMMED" (keep the slot so the layout doesn't jump). The CURRENT pending wave stays fully visible — total blindness would just punish, not sharpen. Phase 6's threat readout also shows for the current wave only.
4. Settings copy: difficulty rows gain one-line descriptors — Hard: "…and every wave smuggles in an extra enemy type." Brutal: "…and the long-range forecast is jammed."
5. Update the challenge `hard_plus` desc if it enumerates difficulty effects (check).

### 5.6 Forecast/preview updates (ui.ts ~1786 wave-preview writer)

The pill(s) for a pending wave now compose, in order: shape icon+name (if shaped) OR mutator icon+name (if mutated) — never both by construction; composition mini-icons (already exists); ✈ lane marker (5.4.3); injected group included transparently (5.5.2). Second pill: same, or the Brutal `?` card. Verify 1280-width fit AND 846×390 coarse fit with the longest combination (convoy + 4 enemy types + ✈).

### 5.7 Exit criteria

- Gates green; daily determinism test extended and green; fuzz green.
- Dev-jump L8 wave 3 (convoy): brutes visibly lead, menders tucked behind, preview labeled; L13 wave 8 rush arrives inside 2s.
- L4+ intermission with pending wisps: dashed lane arc visible and the wave follows it exactly; lane differs between waves.
- Hard L6 run: every eligible wave shows exactly one injected type in the preview and delivers it; same daily seed twice → identical waves.
- Brutal: second forecast slot shows SIGNAL JAMMED; current wave intact.

---
## PHASE 6 — HUD & INFORMATION HIERARCHY

**Intent.** Fix the inverted hierarchy: the player's moment-to-moment questions are (1) am I about to die? (2) what's coming? (3) can I afford anything? (4) where's the pressure? — in that order. Hull becomes a segmented bar that degrades visibly; leaks become the loudest event in the game; a computed threat readout makes the early-call gamble and coverage gaps legible; the tower panel becomes a one-tap decision surface; and every UI element gets a permanent zone so categories never negotiate for space.

**Do NOT:** move the wave forecast off top-right (muscle memory + it already fits); make the threat readout claim certainty (it is a heuristic — label language below is deliberate); add sounds (Phase 7).

### 6.1 HUD zone system (ui.ts + style.css)

Codify (as CSS classes + a comment block at the HUD builder ~1267):

| Zone | Contents | Rule |
|---|---|---|
| Top-left — VITALS | Hull pip bar (6.2), credits pill (+interest preview), leak ledger (6.3), combo counter (moved here from top-center) | Player-state only |
| Top-center — THREAT | Boss bar, critical banners, meteor/ion warnings | Threat only; nothing else may render here |
| Top-right — FORECAST/CONTROL | Wave preview + threat readout (6.4), call button (+early bonus), speed, settings | Unchanged position |
| Bottom-left — ACTION | Abilities, NOVA, overcharge pips | Player verbs only |
| Bottom-center — GUIDANCE | Low-tier toasts (existing) | Unchanged |
| Right/bottom-sheet | Tower panel / build menu | Unchanged |

Moving the combo counter: relocate its element under the vitals cluster with the same pulse behavior; keep its `hudShowAt` logic. Verify the existing `repositionPopups`/`avoidOverlap` ad-hoc logic can now be DELETED for elements with fixed zones — remove what's dead, keep what still guards toasts.

### 6.2 Hull as a segmented bar + leak impact (ui.ts + game.ts)

1. Replace the `♥ N` pill with a pip bar: `maxLives` slots (20–30), each ~7×14px with 2px gaps, wrapping to two rows above 24. Filled pips tint by remaining fraction: >60% teal `#7ee3c3`, 30–60% amber `#ffd97a`, <30% red `#ff8fa3` (these join the pastel set — no grimdark). A small numeric label sits at the bar's end. Losing hull: each lost pip flashes white, "cracks" (2-frame split glyph), and settles to a dark empty slot — sequential at ~40ms/pip for multi-hull leaks (a boss leak of 15 should feel like a machine-gun of losses). `reduceFlash`: skip the white flash, keep the crack.
2. **Leak impact** in `onLeak` (~1971) + base rendering (`drawPortalsAndBases`): base flash + a persistent crack overlay on the base sprite with 3 damage states (lives fraction >60 / >30 / ≤30); `shake(6)` + `hitStop(0.03)` + a red edge pulse (`reduceFlash/Motion` respected — the existing low-hull vignette machinery is the pattern); a big `-N HULL` floater at the base. Leave `// AUDIO-TWIN: hull groan (Phase 7)` at the site.
3. Hull-pip bar is the designated visual twin of Phase 7's descending-pitch leak audio.

### 6.3 Leak ledger (game.ts + ui.ts + resume.ts)

1. `Game.leakLedger: Record<string, number> = {}` — enemy id → hull lost this RUN (`// SERIALIZE:`). Populate in `onLeak` alongside the existing lifetime `stats.leaksByEnemy`.
2. UI: a compact icon strip under the hull bar, appearing after the first leak: enemy mini-glyph ×count, worst offender first, max 4 entries + overflow "+n". Tap/hover a glyph → tooltip "Raptor — took 3 hull. Counters: Missile, Sentinel" (from `counters`). This is the in-run version of the defeat post-mortem, available while it's still actionable.
3. `ResumeSnapshot.leakLedger` — `RESUME_VERSION` 3 → 4. Round-trip test updated.

### 6.4 Threat readout (game.ts compute + ui.ts display) — the highest-value item in this phase

1. `TUNING.threat = { efficiency: 0.65, comfortable: 1.5, tight: 1.0, coveragePathCells: 5, coverageLanePts: 4 }`.
2. **DPS model** — `towerDPS(t): { ground: number; air: number }` on Game, kind-aware, deliberately simple:
   - bullet: `dmg×rate×(1+(crit||0)×1.5)`; pierce ×1.6; pierceRamp treat as pierce×1.8.
   - mortar/shell: `dmg×rate×1.4` (splash factor); cluster +`0.3×cluster`.
   - missile: `dmg×rate×(1+shots? shots−1 : 0)×1.2`.
   - tesla: `dmg×rate×(1+0.6×chains)`; conduction ignored (bonus headroom, not counted).
   - prism: `dmg×rampMax×0.6` (+beams× for splits ×0.8 each extra).
   - ray: `dmg×rate×1.8`.
   - aura: `dmg` (it's already per-second).
   - burn: `+ burnDps × min(1, burnDur×rate)`.
   - amp: 0 (its value flows through others' buffed stats — use `stats(game)` so buffs, cells, perks, overcharge=off are all included).
   - air = ground × (airMul||1); groundOnly → air 0.
3. **Coverage:** `groundCov(t) = min(1, pathCellsInRange / coveragePathCells)` where pathCellsInRange is the cached helper built in Phase 3B.4 — reuse it, do not re-implement. `airCov(t)` = if a pending flier lane exists (`flierLanePoints`), `min(1, lanePtsInRange / coverageLanePts)`; else fall back to base-proximity (within rangeT of any basePx → 1, else 0).
4. **Wave demand:** for the pending wave (post-decoration, post-shape): `effHP = Σ n × hp × currentHpScale() × (1+shieldFrac) × mutatorHpFactor`, split ground/air. Transit budget `T`: ground = pathLenPx / weightedAvgSpeed; air = laneLenPx / avgFlierSpeed; shaped waves adjust the EFFICIENCY term, not T (rush compresses arrival, not transit): rush → efficiency ×0.8 (simultaneity wastes DPS), trickle → ×1.15 (sequential targets waste nothing), convoy/feint → neutral. Deliverable = `Σ DPS_i × cov_i × T × efficiency(shape-adjusted)` per domain.
5. **Verdict:** worst of the two domains' ratios r = deliverable/effHP (skip a domain with zero demand): `r ≥ comfortable` → `✅ Comfortable`; `r ≥ tight` → `⚠ Tight`; else `☠ Likely leak`. Displayed as a colored chip on the wave-preview pill; tooltip: "A rough forecast from your coverage vs. what's inbound — not a promise." Recompute on: build/sell/move/upgrade/perk/wave-prep events only (never per frame). Brutal: current wave only (5.5.3).
6. **Calibration protocol (do this, record numbers):** empty board L1w1 must read Likely leak; the guided-first-build L1 layout must read Comfortable by w2; a deliberately air-blind board on L4's all-wisp wave must read Likely leak on the air domain. Tune `efficiency` first, thresholds second. If calibration can't satisfy all three anchors within an hour, ship with the tooltip language softened further ("very rough") and log it — the label's *relative* movement as you build is the real value.
7. Tests (`tests/threat-readout.ts`): DPS model spot values per kind; coverage counting on a synthetic grid; verdict thresholds; air/ground domain split (groundOnly tower contributes 0 air).

### 6.5 Two-tier tower panel (ui.ts — restructure the selection panel around ~2034)

**Tier 1 (always visible, zero scrolling, incl. mobile sheet):** name + level chip; **headline DPS** (`fmt(towerDPS)`, with `vs AIR ×2` sub-chip when airMul>1, `NO AIR` warning chip when groundOnly); cell chip (Phase 2) + perk badge (Phase 4); **the one most-likely next upgrade as a large buy button** — resolution order: `stage<2` → next Mk stage; `branch>=0 && branchStage<1` → the branch tier-2; `stage==2 && branch<0` → a "Specialize ▾" button that expands Tier 2 pre-scrolled to the tree; fully maxed → hidden; then the action row: Move · ⚡Overcharge · Sell/Undo.
**Tier 2 ("Details ▾" expander):** full tech tree, secondary stats grid (raw dmg/rate/range as before — DPS stays the headline), targeting-mode chips, per-tower lifetime stats. Remember the expanded/collapsed state per session (not per save).
Mobile budget: Tier 1 must fit the bottom sheet without internal scroll at 846×390 — verify with the longest tower name + all chips; if it doesn't fit, the stats sub-chips wrap before the buy button shrinks. Keyboard hotkeys and the existing 2-step confirms unchanged.

### 6.6 Build menu role chips + counter highlighting (ui.ts `openBuildMenu`)

1. Each tile gets ≤2 chips: first `NO AIR` (red-tinted) if groundOnly, else `AIR+` if airMul>1; second by role: `SPLASH` (splash/cluster) / `SLOW` (slow/aura) / `BURN` / `CHAIN` / `SUPPORT` (amp) / `PIERCE`. Derive from stage-0 spec (extend `airClass` into a `roleChips(spec)` helper in data.ts, unit-tested).
2. **Counter highlighting:** when any live enemy's `counters` includes a tower id, that tile gains a soft pulsing outline + a micro-label "counters Mender" (worst on-screen threat wins if several). Uses existing per-frame enemy list; throttle recompute to 2Hz.
3. Grid order stays hotkey order (muscle memory) — note as deliberate.

### 6.7 Copy sweep

Update Game Guide entries for: hull bar ("each pip is one hull"), leak ledger, threat readout (heuristic disclaimer), the panel restructure, role chips. Confirm the sell/undo copy from Phase 1 still reads correctly inside the new Tier-1 layout.

### 6.8 Exit criteria

- Gates green; RESUME_VERSION 4 round-trips with `leakLedger`.
- Lose 3 hull on purpose: pips crack sequentially, base shows damage state, ledger strip appears with the right glyph and counter tooltip.
- Threat readout passes the three calibration anchors (6.4.6) and visibly upgrades its verdict as you add coverage mid-intermission.
- Mobile screenshot set (846×390): vitals cluster legible, Tier-1 sheet fits scroll-free, chips readable, JAMMED card (Brutal) fits.
- Combo counter lives in vitals; nothing but threat ever renders top-center (verify with a boss + mutator + toast simultaneously — the old collision trio).

---
## PHASE 7 — AUDIO AS A SECOND INFORMATION CHANNEL

**Intent.** Convert audio from reaction-feedback + mood into something the player *reads with their ears* while their eyes are in the build menu: what just spawned, how close the pressure is, what a kill was worth, how bad a leak was. Everything remains synthesized (Web Audio, no assets). Two disciplines are binding: (1) **every audio-only cue has a visual twin** — a meaningful share of mobile play is muted (the twin table in 7.8 is the acceptance checklist); (2) **the economy register is exclusive** — one bell-like timbre for credits, used nowhere else, ever.

**Do NOT:** add volume beyond the existing compressor headroom (contrast comes from getting QUIETER first); attach any new sound to more than one event category; break the existing settings buses.

### 7.1 New bus + settings (audio.ts + save.ts + ui.ts)

Add a 5th bus/toggle `alerts` (spawn signatures, mender loop, hull groan, last-stand motif). `AudioSettings` gains `alerts: boolean` (default true; migrateSave guard). The sound-settings sub-modal gains the row "Alert cues — enemy arrivals & warnings". Music-side changes (7.3, 7.6) ride the existing `music` bus.

### 7.2 Enemy spawn signatures (audio.ts `spawnSig(id)` + game.ts spawn site)

One short, learnable timbre per enemy, called where `mkEnemy` results enter play. Recipes (all ≤0.25s, on `alerts`):

| Enemy | Recipe |
|---|---|
| drone | soft square blip 320Hz, 0.08s |
| dart | rising sine chirp 500→900Hz, 0.10s |
| swarmling | tiny tick 1200Hz, 0.03s |
| brute | low triangle thump 90Hz, 0.25s + click transient |
| aegis | two-tone metallic 260+390Hz struck together, 0.15s |
| wisp | airy sine glide 700→500Hz, 0.18s |
| raptor | fast dive chirp 1000→400Hz, 0.09s |
| mender | bright chime 660Hz, 0.12s — then the loop (7.2.2) |
| splitter | wobbly low blub 180Hz ±30Hz LFO, 0.2s |
| phase | detuned shimmer pair 880/886Hz, 0.2s |
| bosses | none here — the boss-theater klaxon path already owns it |

Throttle: max 4 signatures per 0.5s window, priority to enemy types not heard in the last 3s (a swarm rush must not machine-gun ticks — coalesce repeats). The visual twin is Phase 3's portal charge (already colored per incoming type) — verify the pairing holds for mid-wave feint groups.

2. **Mender presence loop:** while ≥1 mender is alive, run one shared soft rising-shimmer loop (two detuned sines + slow LFO, gain `min(1, 0.5×count)`), started/stopped from the game's enemy-count bookkeeping. Visual twin (build it now, in `drawEnemy`'s mender case): a slow pulsing ring on each mender synced ~1Hz. This is the flagship "hear it, don't hunt it" feature.

### 7.3 Continuous pressure-driven intensity (audio.ts + game.ts)

Replace `setIntensity(combat: boolean, danger: boolean)` with `setPressure(p: number, danger: boolean)` (keep a shim for old call sites during the edit, then remove). Game computes every ~0.25s while playing:

```ts
const lead = max over live ground enemies of (e.d / path.totalLen)  // 0..1, and fliers: fT/fDur
const mass = min(1, totalLiveEnemyHp / max(1, teamGroundDPS * 10))   // reuse Phase 6's DPS model sum
const p = waveActive ? clamp(0.25 + 0.55*lead + 0.2*mass, 0, 1) : 0.15;
```

In the engine: a lowpass filter on the music bus sweeps cutoff 900Hz→7kHz with p; the arp layer's pulse rate doubles above p 0.7; `danger` (boss alive / hull<25%) still gates the percussion layer as today. Result: an approaching leader audibly "opens up" the mix seconds before a leak — anticipatory, not reactive. Visual twin: the existing low-hull vignette + Phase 3's marching chevrons (no new work — cite them in the twin table).

### 7.4 Kill sounds mapped to mass (audio.ts `pop` + game.ts `onKill`)

`pop(size)` already takes size — verify the mapping is monotonic (bigger = lower/heavier) and widen it: swarmling (7.5) → bright 1.6kHz tick; drone ~ mid; brute (20+) → add a 70Hz sub-thump layer; elites add a small gold "ching" tail (they shower credits — but that ching must NOT be the economy bell — use a shorter, duller strike). Bosses keep `explosion('big')`. Clearing a swarm should rattle satisfyingly; a Brute kill should feel like furniture falling over.

### 7.5 Leak = hull groan (audio.ts `hullGroan(livesFrac)` + game.ts `onLeak`)

A deliberately unpleasant, non-musical cue: descending saw 220Hz → `60 + 120×livesFrac` Hz over 0.5s + a filtered noise "knock", volume slightly above the mix (on `alerts`), plus a 300ms music duck. **Pitch descends as hull drops** — a leak at 3 hull must sound sickening compared to a leak at 18. Visual twin: Phase 6's pip crack + base damage states (cite). Replace the placeholder wired in Phase 6.

### 7.6 Silence as contrast + the wave arc (audio.ts + game.ts)

1. `duckAll(depth, holdMs, releaseMs)` on the master gain. NOVA buildup: duck to 0.15 over 0.3s, hold through the 1.2s buildup, release INTO `novaBlast` — the blast lands in a dry room. Boss entrance: 400ms near-silence BEFORE the klaxon fires (delay the existing klaxon call; the red vignette already fills the gap visually). General principle in a comment: we can't get louder (compressor ceiling), so big moments get quieter first.
2. **Wave arc:** the arp layer's gain scales with wave fullness: `remainFrac = (spawnQueue.length + liveCount) / waveTotalSpawns` → arp gain `0.35 + 0.65×remainFrac` while combat (folds into 7.3's ramps). When exactly one enemy remains and the queue is empty: a tiny two-note "last stand" motif (once per wave, on `alerts`) + visual twin: a small `LAST ONE` floater over the enemy (add it in onKill/spawn bookkeeping). Wave clear keeps the existing jingle — now it resolves a thinning texture instead of interrupting a flat one.

### 7.7 The economy register (audio.ts)

Define `bell(strength)`: sine 1320Hz + 2640Hz partial, 0.12s, fast decay — bright, short, unmistakable. Route EVERY credit event through it and audit that nothing else uses that timbre: interest payout, early-call bonus, drop credits, meteor fragment, vein bonus payouts, sell/undo refund (`ui('sell')` keeps its own existing sound — a refund is a transaction, allowed to share the register: use `bell(0.6)` after the thunk), wave-clear bonus. The combo chain keeps `comboBlip` — it's a *performance* register the player has already learned; document that boundary. Grep all `ui('coin')` call sites and convert; then retire or repurpose the old coin sound so the register stays exclusive.

### 7.8 The twin table (acceptance checklist — every row must hold before exit)

| Audio cue | Visual twin | Twin built in |
|---|---|---|
| Spawn signature | Portal charge colored per enemy | Phase 3 |
| Mender loop | Mender pulse ring | Phase 7 (7.2.2) |
| Pressure mix opening | Chevron march + low-hull vignette | Phases 3/existing |
| Hull groan (+descending pitch) | Pip cracks + base damage states + `-N HULL` | Phase 6 |
| Last-stand motif | `LAST ONE` floater | Phase 7 (7.6.2) |
| Economy bell | Credit floaters (existing) | existing |
| Overcharge whir (new: replace the Phase 4 placeholder with a rising whir) | Pad ring + sparks | Phase 4 |

### 7.9 Exit criteria

- Gates green. Muted-device pass: play L8 muted — every event in 7.8 is still readable on screen.
- Audible pass: eyes-closed on L8, identify a mender arrival, a raptor arrival, and an impending leak before it lands, by ear alone.
- NOVA and boss entrances audibly "drop out" before impact; `reduceFlash/Motion` unaffected by audio changes.
- No timbre collisions: trigger interest + combo + crate in one moment — bell, blip, and bell are distinguishable and the bell only marks the credits.
- Settings: alerts toggle silences 7.2/7.5/7.6.2 only; migration guard tested.

---
## PHASE 8 — REPLAYABILITY: DRAFT & DOCTRINES

**Intent.** The two systems that multiply the existing content. The **draft** turns 15 levels into hundreds of distinct puzzles ("which 6 of my 10 towers answer THIS map?") — with Kevin's two refinements baked in: the draft *grows* as the campaign advances, and a full-arsenal option always exists for casual play. **Doctrines** turn the meta screen from a finished checklist into a per-level loadout identity. Both arrive through a new pre-level **Briefing screen** that finally gives all the per-level identity built in Phases 2–5 (cells, modifiers, shapes, roster) a place to be read before committing — Kevin's "think about the map on the bus" moment.

**Do NOT:** penalize or reward choosing full-arsenal vs. draft (no star/credit differences — it's a playstyle toggle, not a difficulty); make doctrines stack (exactly one active, always); touch the existing 8 META nodes beyond adding the section header.

### 8.1 Briefing screen (ui.ts — new `showBriefing(levelId, opts)` between level-select tap and game start)

Layout (single screen, no scroll on desktop; one scroll region allowed on mobile):

1. Header: level number/name, zone tagline, difficulty + ascension chips.
2. Identity row: modifier icons+one-liners (existing data), cell inventory (Phase 2.6.4 moves here, stays on the card too), structural note for L9/L11.
3. Roster strip: mini-glyphs of every enemy type appearing in the level (derive from waves incl. Hard injection pool note "+? on Hard"), with the level's `newEnemy` highlighted.
4. Challenges: the two badges + descs (replaces the pre-level challenge banner — remove that banner call).
5. **Draft picker** (8.2) and **Doctrine selector** (8.3).
6. Big LAUNCH button. Everything remembered from last time — a returning player's flow is two taps (level → Launch).

Endless and Daily route through the same screen (Daily shows its locked seeded draft; Endless shows its seeded modifiers). Resume flow bypasses briefing entirely (snapshot already encodes all choices).

### 8.2 The draft (data.ts + ui.ts + game.ts + resume.ts + save.ts)

1. `UNLOCKS['draft'] = 6` (+ SEEN). Below the gate (fresh saves L1–5): no picker, full arsenal, zero UI noise.
2. `TUNING.draft = { sizeByLevel: [[4,5],[8,6],[12,7],[15,8]], endless: 8 }` — interpret as "levels ≤4 → 5, ≤8 → 6, ≤12 → 7, ≤15 → 8". The GROWTH is Kevin's requirement: early maps are tight puzzles, late maps hand you a broader kit as wave complexity explodes. (Levels 1–5 only meet the draft when a veteran replays them.)
3. Picker UI: the 10 tower tiles (with Phase 6 role chips) in a select-N grid; counter "6 of 10 chosen"; buttons: **Suggested** · **Last used** · **Clear** · and the persistent toggle **"Use full arsenal"** (Kevin's casual escape hatch — `save.settings.draftMode: 'draft' | 'all'`, default `'draft'` once unlocked; flipping it hides the picker and is remembered globally).
4. **Suggested** algorithm (also the initial preselection the first time): must-includes first — ≥1 air-capable if the level's waves contain fliers; ≥1 splash/chain if swarmling+splitter spawn count ≥ 15; every tower listed in `counters` of the level's `newEnemy`; then fill remaining slots by the player's lifetime `stats.towersBuilt` descending (comfort picks). Deterministic, no rng.
5. `save.lastDraft: string[]` (global, not per-level — simpler, good enough; migrate guard). Persist on launch.
6. In-game enforcement: `Game` receives `draft: string[] | null`; `openBuildMenu` renders only drafted towers (hidden, not greyed); number hotkeys skip hidden entries; dev mode ignores the draft. `// SERIALIZE:` → `ResumeSnapshot.draft` (`RESUME_VERSION` 4 → 5).
7. **Daily Op:** the draft is seeded and FORCED: `mulberry32(hashString(dateStr + '-draft'))` picks sizeByLevel(level) towers, guaranteeing ≥1 air-capable and ≥1 splash via re-roll; the picker renders locked with "Today's arsenal". Extend the daily determinism test. (Full-arsenal toggle does not apply to dailies — part of the shared puzzle; say so in the UI.)
8. Challenge interactions: Specialist (≤N types) and Minimalist are unaffected by drafting (verify predicates count builds, not draft size). No draft-specific challenges this phase.
9. `toastOnce('draft', 'DRAFT — from here on you choose which towers to bring. Fewer tools, sharper plans. (Prefer everything? Flip on "Use full arsenal.")')` at the first briefing with the picker.

### 8.3 Doctrines (data.ts + ui.ts + game.ts + save.ts)

1. Data:

```ts
export interface DoctrineSpec { id: string; name: string; icon: string; cost: number; desc: string; }
export const DOCTRINES: DoctrineSpec[] = [
  { id: 'artillery', name: 'Artillery Doctrine', icon: '💥', cost: 3, desc: 'Splash radius +25%, splash damage +15%.' },
  { id: 'precision', name: 'Precision Doctrine', icon: '🎯', cost: 3, desc: 'All towers gain +10% critical chance (2.5× damage). Beams can crit.' },
  { id: 'logistics', name: 'Logistics Doctrine', icon: '📦', cost: 3, desc: 'Start with +10% credits; supply drops arrive 20% more often.' },
];
```

`TUNING.doctrines = { artillery: { splashRadiusMul: 1.25, splashDmgMul: 1.15 }, precision: { critAdd: 0.10 }, logistics: { startCreditMul: 1.10, dropIntervalMul: 0.8 } }`.
2. `UNLOCKS['doctrines'] = 10` (+ SEEN). Save: `save.doctrines = { owned: string[], active: string | null }` (defaults + migrate guard).
3. Meta screen: a visually distinct "DOCTRINES — choose one to fly under" section beneath the existing 8 nodes; each card shows cost in stars, Buy → Owned → radio-select Active. **Buying is permanent; switching the active doctrine is free and can also be done on the Briefing screen** — that's what converts it from checklist to per-level loadout (deliberate, per A.5.5). None active is allowed.
4. Effects (applied in the `Game` ctor from an `opts.doctrine` effects object, exactly like META bonuses):
   - artillery: multiply `splash` radii and splash-carrying damage in `stats()`/projectile creation for shell/missile/cluster paths.
   - precision: `+0.10` wherever crit is rolled (bullets ~1372); ADD a crit roll to ray hits (they lack one — implement `Math.random() < critTotal → ×2.5`, reusing the yellow crit damage-number styling). Prism/auras excluded (state it in the desc's codex expansion).
   - logistics: fold into start-credit computation (Phase 1.9's chain) and `TUNING.drops.intervalMin/Max × 0.8` at drop scheduling.
5. Tests (`tests/draft-doctrines.ts`): gating; sizeByLevel mapping; suggested-draft must-includes; daily draft determinism (two runs, same date → same set); doctrine exclusivity (activating B deactivates A); each doctrine's effect lands in stats/economy; resume with draft.

### 8.4 Guide & codex

Game Guide entries: "Drafting", "Doctrines", plus briefing-screen orientation. Level cards keep a one-line "Bring: ✈ + splash" style hint derived from the Suggested must-includes (cheap, high value for bus-thinking).

### 8.5 Exit criteria

- Gates green; RESUME_VERSION 5 round-trips draft.
- Fresh-save sim: no picker before L6; first L6 briefing shows toast + 6-slot picker preselected sensibly (missiles/sentinel present — L6 has wisps).
- Veteran flow: level → Launch in two taps with last draft remembered; full-arsenal toggle removes the picker everywhere except Daily.
- Daily: same date twice → identical forced draft; the locked picker communicates it.
- Doctrines: buy two, switch active on the briefing screen between runs, verify splash radius visibly changes (artillery) and ray crits appear (precision).
- Buying/refunding META still works; stars never went negative (starsAvail accounting includes doctrine costs).

---

## PHASE 9 — INTEGRATION BALANCE, TESTS & SHIP

**Intent.** Eight phases of new systems now coexist. This phase hunts interaction bugs, re-tunes the economy end-to-end, locks the final numbers into a reference table, and ships. Nothing new is designed here; scope discipline is the deliverable.

### 9.1 Cross-system interaction audit (test or hand-verify EVERY row; log each in PROGRESS-3.md)

| Interaction | What to verify |
|---|---|
| Draft × Hard injection | Injected enemy whose counters are undrafted → threat readout reflects the gap (it reads decorated waves — confirm) |
| Draft × challenges | Specialist/Minimalist predicates unaffected by draft size; no challenge is impossible under the minimum draft (walk all 28 vs. suggested-draft must-includes) |
| Shatter × Splitter | Frozen splitter death: splits spawn, then shatter damages them; no array-mutation crash; combo counts all kills |
| Shatter × elite Shielded | Shatter damage respects shields normally (no bypass) |
| Overcharge × Overclock drop × Anchor amp | Stacking is multiplicative and bounded — compute worst-case rate (~2×1.4×1.4) and confirm no audio/projectile flood at 3× speed in perfMode |
| Veterancy × sell undo | Un-doable window (4s) can't contain 45 kills — confirm no perk-refund path exists |
| Conduit × draft of 5 | Two towers minimum still fine; single tower on a conduit pair simply has no partner (no null crash) |
| NOVA % × Ascension V | 30%-of-current-HP remains meaningful at max scaling (by construction — spot-check the floaters) |
| Early-call % × Logistics × interest | See 9.2 economy sweep |
| Feint × portal telegraph × spawn sigs | Delayed group telegraphs at T−2s with correct color and signature |
| Flier lane × Daily mirror | Lane mirrors deterministically; anti-air telegraph accurate on mirrored layout |
| Threat readout × shapes × Brutal | Rush/trickle efficiency adjustments applied; readout absent for jammed wave 2 |
| Cell placement × L9/L11 reworks × all tile sizes | Re-run Phase 2 validation post-Phase-3 paths (should already be green — confirm) |
| Star recut × old saves | A save with legacy 3★ (earned at ≤25% loss) keeps them |
| Chroma/palette | Chroma toggle still themes correctly given any Phase 3/6 style additions |

### 9.2 Economy simulation sweep (extend validate.ts's headless model)

Model total earnable credits (bounties×rewardMul + wave-clear + interest at scaled cap + expected drops/veins + expected early-call at 50% uptake) vs. a "solid build cost" benchmark (sum of a representative 8-tower L15 build with tier-2s) for L1/L5/L10/L15 × Normal/Hard/Brutal × Ascension 0/III/V. Target band: earnable/needed ∈ [1.2, 1.8] everywhere (below 1.2 = slog returns; above 1.8 = trivialized). Nudge, in priority order: `bountyCoef` → wave-clear scaling → interest cap → early-call cap. Record the final matrix in PROGRESS-3.md.

### 9.3 Test & fuzz consolidation

Full suite green: all pre-existing tests + `economy-v3`, `cell-seeding`, `reactions`, `threat-readout`, `draft-doctrines`, extended `daily-op`, extended `resume`, mirror-meander fuzz (now incl. reworked L9/L11). Add any missing test flagged in Phases 1–8 PROGRESS notes. Headless smoke (puppeteer path from PLAN.md Phase 8, if chromium installs): 60s scripted L1 at 3×, zero console errors, desktop + 846×390 screenshots.

### 9.4 Ship package

1. Final `TUNING` reference table (every key, final value, one-line rationale) appended to PROGRESS-3.md.
2. `CHANGELOG.md`: new "Starhold 3.0" section, player-facing, grouped by feel (mirror the 2.0 changelog's voice — pastel-warm, no jargon).
3. `DEVICE-CHECKLIST.md` additions for Kevin's S23+: cell tooltips via long-press; briefing screen touch targets + scroll region; hull pips readable at 390px; overcharge double-tap vs. pan/zoom guards; draft picker tap targets; muted-run twin check (7.8 rows); resume across the update boundary (expect graceful snapshot discard exactly once — RESUME_VERSION churn).
4. Both builds green; branch pushed; after Kevin's sign-off, merge to `main` and confirm the Vercel production deployment at `https://starhold.vercel.app/` serves the 3.0 build (check the version/changelog string in the title screen or console).

### 9.5 Exit criteria

Every 9.1 row logged. 9.2 matrix in band or deviations justified. Suite + fuzz + smoke green. One clean full campaign playthrough spot-check (dev-jump sampling L1/L4/L8/L12/L15 on Normal, L6 on Hard, one Daily, one Endless-to-w12) with zero console errors. Deliverables presented with a short human-readable summary of what 3.0 changed.

---

## APPENDIX — QUICK REFERENCE

### New TUNING keys by phase
P1 `economy.*`, nova changes · P2 `cells.*` · P3 `portals.chargeLead` · P3B (PALETTE + size tables — data, no TUNING) · P4 `flame.*`, `reactions.*`, `overcharge.*`, `veterancy.*` · P5 (shapes are data, not tuning) · P6 `threat.*` · P8 `draft.*`, `doctrines.*`

### RESUME_VERSION ledger
1 (shipped) → 2 (P3: bg runSeed) → 3 (P4: tower perk) → 4 (P6: leakLedger) → 5 (P8: draft)

### New unlock ids
`cells:3` · `overcharge:4` · `draft:6` · `veterancy:8` · `doctrines:10` — each mirrored in SEEN_UNLOCK_LEVELS.

### New save fields
P1 none (default-only pauseOnBuild) · P3B `settings.accessiblePalette` · P7 `settings.alerts` · P8 `lastDraft`, `settings.draftMode`, `doctrines{owned,active}` — all with defaultSave defaults + migrateSave guards.

### The lens, one last time
Before writing any line of code in any phase, re-read the item's "Decision it creates" rationale. If an implementation compromise would reduce a decision to a task, stop and log the tension in PROGRESS-3.md instead of shipping the compromise silently.

*End of plan. Execute one phase per session, in order. — Compiled July 2026 from the Starhold design-ideas review with Kevin's rulings applied.*
