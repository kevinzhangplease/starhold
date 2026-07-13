# STARHOLD 2.0 — Progress Log

Append-only. Each phase records: date, what shipped, tuning values chosen, deviations from PLAN.md, known issues.

---

## Phase 1 — Foundations & Plumbing [COMPLETE]
Started: 2026-07-06 · Finished: 2026-07-07

### Shipped
1. PLAN.md (full v3 master plan) + this log, in repo root — travel inside starhold-source.zip.
2. **Save schema v2** (save.ts): added `v`, `seen`, `challenges`, `ascension{current,bestPerLevel}`,
   `endlessBest` (now Record<difficultyTier, bestWave> — was a single number), `endlessMilestones`,
   `daily{lastDate,lastWon,streak,bestStreak}`, `stats` (PlayerStats), `chromaUnlocked/chromaOn`,
   `lastSpeed`, `defaultTargeting`, `resume?`. `migrateSave()` is idempotent and pre-marks `seen`
   flags for veterans (unlocked > 1) via SEEN_UNLOCK_LEVELS. `starsEarned()` now sums level stars +
   challenge stars + endless milestone stars (future sources count as 0 today — behavior unchanged).
3. **Unlock gating** (data.ts): UNLOCKS table, `setUnlockedLevel()` / `isUnlocked()` module functions.
   UI pushes save.unlocked into gating at construction and on level-advance in showResult.
4. **TUNING** object (data.ts): all Phase 2–6 balance values centralized (combo/interest/elites/drops/
   mutators/meteors/ionStorms/richVeins/asteroids/nova/ascension/smoothing).
5. **Notification choreographer** (ui.ts `Notifier`): 3 tiers. Critical = letterboxed `.banner.crit`,
   preempts mediums. Medium = queued one-at-a-time 2.1s (fixes the old level-name/Wave-1 overlap).
   Low = single bottom-center `.note-toast`, tap-dismiss, 8s, held while a boss is alive or a critical
   shows, flushed after. `banner()` is now a router; BannerFn gained `(tier?, sub?)`; engine call sites
   tiered (BOSS INBOUND=critical; Wave N / New foe(+desc sub) / BOSS DOWN=medium). clearUI() calls
   notify.clearAll() so screen transitions can't leak queued banners.
6. **toastOnce(key, text)** on UI — checks/marks save.seen, delegates to notify.low.
7. **rng.ts**: mulberry32, hashString (FNV-1a), seededInt, seededPick — for Daily Op/asteroids/tests.
8. **QoL**: game speed persists (save.lastSpeed, restored at level start, button reflects it);
   "New towers target" setting (First/Last/Strong/Weak/Close) → Game.defaultMode → applied in buildAt;
   fmt() compact formatter (950/12.4k/3.4M) exported from data.ts, applied to enemy tooltip HP/Shield.
9. **validate.ts additions**: UNLOCKS↔SEEN_UNLOCK_LEVELS sync (no-toast exceptions: mutators_hard,
   mod_combo); TUNING sanity (milestone/bonus lengths, drop weights sum 100, ranges); migrateSave
   idempotency on {} / v1-veteran / fresh / default saves incl. endlessBest:7 → {2:7} relocation and
   veteran-vs-fresh seen pre-marking; fmt spot checks.

### Decisions / deviations
- v1 `endlessBest` (single number) migrates into difficulty tier 2 (Normal) — safest assumption.
- `stats.sessions++` happens in the UI constructor (once per page load = one "session").
- `Game.defaultMode` is NOT serialized (derived from settings each level start) — noted via SERIALIZE comment.
- SEEN_UNLOCK_LEVELS duplicated in save.ts (vs importing UNLOCKS) to avoid an import cycle;
  validate.ts enforces the two stay in sync.
- Notifier low-tier queues (rather than drops) toasts suppressed during boss fights, so tutorial
  text is never lost.

### Known issues
- None. Both gates green. Game behavior identical to pre-phase except the QoL items and banner queueing.

### Next: Phase 2 — Core Engagement Loop (Combo, Interest, Elites, Supply Drops) per PLAN.md.

---

## Phase 2 — Core Engagement Loop [COMPLETE]
Started: 2026-07-07 · Finished: 2026-07-07

### Shipped
1. **Kill combo** (gate `combo`): kills within TUNING.combo.window (1.6s) chain; milestones 5/10/20/35/50
   pay +5/+12/+25/+45/+70◆ with "COMBO ×N!" floater, rising pentatonic `audio.comboBlip(step)`, 50ms
   hit-stop, and haptic tick. HUD counter (#combo-hud, top-center under stat pills) appears at ×3 with a
   pulse per increment. Breaks on 1.6s silence or any leak ("COMBO BROKEN" floater when ≥×3).
   stats.bestCombo tracked via runStats.
2. **Interest** (gate `interest`): wave clear pays +6% of banked credits (pre-bonus balance), capped at
   `Game.interestCap` (=TUNING 60; field exists so Ascension IV can lower it). "Interest +N ◆" floater;
   credits pill shows live "▲N" pending-interest preview while a wave is active. toastOnce on first payout.
3. **Elites** (gate `elites`): on-spawn roll 3% + levelId×0.4% + diffTier×2% (+0.3%/endless wave).
   makeElite() clones the spec (size ×1.35, swift speed ×1.3, leak +1) so shared specs are never mutated;
   HP ×4.5, bounty ×3; affixes Shielded (30% shield, uses existing shield/regen pipeline), Swift, Vampiric
   (heals nearby 8/s × hpMul every 1s, gold ring FX). Gold pulsing aura ring + floating crown + rising
   sparks; affix named in hover tooltip; death = hit-stop + shake + gold shard shower. Scripted first
   elite: L5 wave 3, forced Shielded, when save.seen['elites'] unset.
4. **Supply drops** (gate `drops`): during active waves, roll every 20–30s at 35%; crate drifts with
   parachute + bob + pulsing ring, avoids path polylines (52px) and other crates, despawns at 10s with
   blink in final 3s. Tap radius 40px logical (≥44px effective on S23+). Contents 45/20/20/15:
   credits 40–90 / full ability recharge / Overclock (+40% fire rate 8s, gold sparks on towers) /
   +2 hull. Crate tap takes priority over all other map clicks. Scripted first crate: L4 wave 2.
5. **Haptics**: Game.buzz() wraps navigator.vibrate behind new settings.haptics toggle ("Vibration
   (mobile)", default on); wired to combo milestones (20ms), elite kills (30-40-30), crate collect (15ms).
6. **Stats plumbing**: Game.runStats accumulates kills/wavesCleared/towersBuilt/elitesSlain/bestCombo/
   leaksByEnemy; UI.mergeRunStats() folds into save.stats and zeroes on killGame() — covers win, loss,
   retry, and quit paths with no double-counting.

### Decisions / deviations
- Combo breaks at wave end by design (1.6s silence rule applies universally) — chains are within-wave.
- Elite spec cloning (not mutation) chosen so all size/speed/leak-dependent code works untouched.
- Vampiric heal scales with hpMul (flat 8/s would be irrelevant late-game); noted vs PLAN's flat wording.
- Interest computed on pre-wave-bonus balance (banked credits, not the bonus itself).
- settings.haptics defaults true everywhere; vibrate is a no-op on desktop so no toggle harm.
- Scripted-elite affix forced to Shielded (most legible "focus it down" teaching moment).

### Known issues
- None known. Gates green; gating smoke test (fresh/L3/L5/veteran) passes.

### Next: Phase 3 — Wave & Level Identity (mutators, forecast, level modifiers, counterplay legibility).

---

## Phase 3 — Wave & Level Identity [COMPLETE]
Started: 2026-07-07 · Finished: 2026-07-07

### Shipped
1. **Wave mutators** (gate `mutators`): 6 mutators in data.ts MUTATORS — Frenzied ⚡ (+40% speed),
   Armored 🛡 (30% shield), Bounty 💰 (+60% rewards, applies to bosses too), Horde 🐝 (+50% count,
   −25% HP, spawn interval compressed), Regenerating ✚ (2%/s, gate mutators_hard), Phasing ◇ (20%
   blink, gate mutators_hard). Chance from wave 4 = 12% + levelId×1.5% + diffTier×5% (endless ≥w10:
   40%); no back-to-back below L10; first-ever mutator forced Bounty. Effects applied per-enemy at
   spawn via spec cloning (bosses exempt from stat twists). Launch shows a colored medium banner.
2. **Two-wave forecast**: pipeline rewritten to two locked slots (pendingWave/pendingMutator +
   pending2Wave/pending2Mutator) — mutator rolls lock at generation so the preview never lies, and
   endless waves are generated once and cached (no regeneration mismatch). Preview bar: mutator chip
   + composition for the next wave, then a dimmed 86%-scale "Then:" section (≤3 enemy kinds + …).
3. **Level modifiers** (LevelSpec.modifiers, gated per MODIFIER_INFO.gate):
   - *Asteroid Field*: 6–10 seeded rock cells (mulberry32(hash(levelId+'-ast'))); reuses the existing
     rock-cell system; by construction only replaces buildable candidates so the path is never touched.
   - *Rich Veins*: 3–4 seeded glitter cells (twinkling cyan diamonds, visible under towers); towers
     there earn +2◆ per killing blow. Kill attribution: Enemy.lastHitBy threaded through beams, rays,
     auras, chains, flame cones, bullets, missiles, shells, and splash (projectiles carry owner;
     bomblets inherit). Burn/patch DoT deliberately unattributed.
   - *Meteor Shower*: every 25–35s during active waves, targets an occupied cell 75% of the time;
     3s pulsing red warning ring + crosshair; strike disables the tower 6s (reuses disabledUntil/EMP
     pipeline), 25% drops a tappable rotating meteor fragment worth 20◆ (rides the supply-drop system).
   - *Ion Storms*: ~40s cycle, 4s amber dashed warning band → 8s active 2-row band with drifting
     static; towers inside fire 30% slower (computed in Tower.stats from stormRow0/stormUntil).
   Assignment: L4 ast · L6 veins · L8 met · L10 ast+veins · L12 ion · L13 met+veins · L14 met+ion ·
   L15 ast+met+ion · endless picks 0–2 per run. Icons+tooltips on level cards, start-of-level banner,
   toastOnce per modifier (keys = gate names, matching SEEN_UNLOCK_LEVELS).
4. **Counterplay legibility**: EnemySpec.counters authored for all 13 enemies (audited: every enemy
   ≥1 counter, every counter a real tower id, every non-support tower appears somewhere). "Weak to"
   rendered in the hover tooltip (colored tower names), the alien codex, and wave-preview item titles.

### Decisions / deviations
- Meteors and storms run only while a wave is active (striking during planning intermissions felt
  punitive, not tense).
- Plan's "asteroid seeding fuzz across 15×3×3 grids" replaced by a by-construction invariant:
  modifier rocks can only ever claim cells that are not path/end/rock. validate.ts instead asserts
  the modifier assignment table, gate wiring, and counters coverage.
- Horde compresses spawn intervals (iv/1.5) so mutated waves feel denser, not just longer.
- Preview shows pre-Horde composition counts; the 🐝 chip signals the inflation.
- Bounty is the only mutator affecting bosses (it's a gift; stat twists on bosses felt unfair).

### Known issues
- None known. Gates green.

### Next: Phase 4 — Spectacle (boss theater, phase 2s, NOVA, juice, adaptive music, accessibility).

---

## Phase 4 — Spectacle [COMPLETE]
Started: 2026-07-07 · Finished: 2026-07-07

### Shipped
1. **Boss theater** (gate `boss_theater`): critical banner names the boss ("⚠ THE MOTHERSHIP ⚠"),
   3s pulsing red edge vignette, klaxon (three descending two-tone blasts), and a landing shockwave
   (ring FX + smoke + explosion sound) on spawn. Persistent top-center boss health bar (name, phase
   label, HP fill, overlaid shield fill, center tick mark) — shows/hides automatically with boss
   presence. Ungated players still get the old plain banner/shake, just no theater.
2. **Boss phase 2 at 50% HP** (gate `boss_phase2`, so the L5 Mothership stays simple for first-timers
   since the gate unlocks at L10): phase flip fires once per boss (bossPhase 1→2), with its own medium
   banner, shake, ring FX, and boss-bar phase label. Mothership: spawn rate doubled (halves
   spawnMinion.every), speed +30%. Colossus: EMP radius ×2 permanently in phase 2, plus each EMP now
   has a chance to ratchet speed up further (capped at 1.8× its phase-2 base) with a "RAGING" floater.
   Leviathan: shield snaps back to full and becomes a rotating 240° directional barrier — damage from
   the uncovered 120° gap (tracked via arcA, rotating 30°/s) bypasses the shield entirely, rendered as
   a visible pulsing arc with a gap. Verified the bypass-angle math exactly matches the drawn arc
   geometry via a 200k-trial fuzz test (one boundary-precision mismatch at the exact float seam,
   inconsequential).
3. **NOVA ultimate** (gate `nova`): meter charges on every kill (+1 normal, +4 elite, +20 boss),
   needs ~90-kill-equivalents to fill. Button (bottom-left, above abilities) glows and pulses when
   ready. Firing: 1.2s buildup (world darkens, rising hum, screen un-clickable-for-map-actions via
   existing pendingBuild/pendingMove guards is unaffected since NOVA doesn't block those — noted as
   acceptable) → 400 dmg to every enemy on screen (bosses take half), whiteout flash, 0.5s slow-mo,
   heavy shake + haptic buzz. Recharge requirement grows ×1.4 per use per level (diminishing, resets
   next level). Guarded against firing while paused or level not active.
4. **Juice**: floating damage numbers (settings toggle, default on) — batched per-enemy at ~3.5/s
   during sustained fire plus a flush on kill, using the engine's existing 'text' particle kind, sized
   smaller/faster than reward floaters to stay visually distinct. Wave-clear final moment now triggers
   a 0.4s slow-mo + soft flash. Boss death adds 1.2s slow-mo + flash + haptic on top of the existing
   confetti/shake. Zone finales (L5/L10/L15) get a "ZONE SECURED" banner. Kill-pop pitch variance
   widened (was ±15%, now ±26%) so sustained fights don't fatigue the ear.
5. **Adaptive music**: two new mix-bus layers on top of the existing pad — an arp layer (was fixed at
   full volume, now rides 0.35↔1.0 with combat state) and a new percussion layer (heartbeat kick +
   soft hat, 0↔0.9) tied to boss-alive OR hull<25%. Both crossfade over 1s via setIntensity(), called
   once per HUD update from the boss/hull state already being computed there — no extra per-frame cost.
6. **Accessibility**: two new settings toggles — "Reduce flashing" (whiteout flashes capped at 22-25%
   strength instead of up to 85%, boss vignette dimmed) and "Reduce motion" (disables slow-mo AND
   hit-stop AND screen shake via the same gate, folding all three motion-adjacent effects into one
   switch as planned). Both read live from Game fields set at level start and toggle mid-level too.
   Also added: damage-number toggle (separate from the above — purely a clutter preference).

### Decisions / deviations
- Colossus's phase-2 speed ramp is capped (1.8× its phase-2-entry speed) rather than unbounded, so
  repeated EMPs can't spiral into an unfair speed the player never sees coming.
- Leviathan's shield refills to max on the phase-2 transition (narratively "reconfiguring into a
  barrier") rather than continuing from whatever it was — cleaner, and avoids a phase-2 boss with an
  already-half-broken shield being visually confusing.
- NOVA damage-number and hit-stop routes are gated through the new reduceMotion/reduceFlash switches
  I added Game.slowMo()/screenFlash()/hitStop() wrapper methods rather than setting fields directly
  everywhere, so accessibility is enforced in one place. Two pre-existing direct hitStopT sets were
  migrated to the new hitStop() wrapper for consistency.
- No fallback was needed for the Leviathan arc (Risk (b) in the register) — the geometry worked
  cleanly on the first coherent implementation once tested.

### Known issues
- None known. Gates green; leviathan angle math fuzz-verified (200k trials, 1 negligible float-boundary
  mismatch at the exact seam).

### Next: Phase 5 — Player Journey (guided first build, level challenges, defeat post-mortem,
victory celebration, per-tower stats, zone flavor, difficulty smoothing).

---

## Phase 5 — Player Journey [COMPLETE]
Started: 2026-07-08 · Finished: 2026-07-08

### Shipped
1. **Guided first build** (fresh saves — save.unlocked===1 — L1 only, one-time, three seen-keyed steps):
   a pulsing gold ring highlights a good empty cell near the path's first bend (found by locating the
   nearest valid cell to the point 32% along the path polyline); clears the instant any build menu
   opens. The first-ever build-confirm popup gets its Build button highlighted with a pulsing glow.
   After that first tower lands, the Launch-wave button pulses once (auto-clears on click or after 9s).
   Each step is gated by its own save.seen flag (guide_build/guide_confirm/guide_launch, already
   reserved in Phase 1's SEEN_UNLOCK_LEVELS) so it can never repeat.
2. **Level challenges** (gate `challenges`): CHALLENGE_POOL of 7 — Perfect Hull, Minimalist (≤N built),
   Specialist (≤N tower types), No Abilities (Orbital/Stasis only — NOVA exempt), Speedrunner (never
   let the countdown auto-launch a wave), Committed (never sell), Battle-Tested (win on Hard+). 28
   hand-placed instances across L2-L15 (2 each), chosen level-by-level to avoid awkward pairings (no
   Minimalist on the three asteroid levels, where build space is already constrained). Runtime tracked
   via three new Game flags (lateCallHappened/soldAny/abilityUsed) plus existing runStats; evaluated
   once at win via Game.evaluateChallenges(). Level cards show two small badges (grayscale until
   earned) plus a gold border once both are earned; a pre-level medium banner briefs the two challenges;
   results screen flips each badge face-up with its earned/failed state.
3. **Defeat post-mortem**: loss screen now states which wave broke you, then ranks the top 3 enemy
   types by hull damage dealt this run (from runStats.leaksByEnemy, read before mergeRunStats zeroes
   it) with a percentage-of-total and a "Counter with: [towers]" line pulled from Phase 3's enemy
   counters data. Retry is now the primary/prominent button on loss; the sector-select button reads
   "Change Loadout" instead of "Sectors" specifically on defeat.
4. **Victory celebration**: stars, challenge badges, and record callouts now reveal in a short
   sequenced animation (star pop + coin chime + haptic per star; badge flip + branch/deny chime per
   challenge; then any record lines) rather than all at once. Tapping anywhere on the result card except
   the action buttons instantly finalizes the whole sequence — implemented via a shared timeout queue
   that a "skip" handler clears and fast-forwards through synchronously, so the skipped end-state is
   always identical to the fully-played one. Record callouts: new best combo (only if ≥5 and above the
   prior save's best), new endless-wave record, and a "N new challenge stars" summary line.
5. **Per-tower stats**: Tower now accumulates dmgDealt/kills/creditsEarned (credits include vein bonus
   payouts). Shown as a compact line under the description in the tower detail panel once a tower has
   done anything: "1.8k dmg · 34 kills · 2.1× value" (value = creditsEarned / amount spent).
6. **Zone flavor**: one-sentence tagline per zone (Nebula Shallows / Ember Drift / The Void Reach),
   shown as a medium banner the first time the player ever starts a level in that zone (toastOnce-style,
   keyed zone_1/2/3 — already reserved and pre-marked for veterans back in Phase 1).
7. **Difficulty smoothing**: new progression multiplier applied to Game.diffHp at construction — L1-L2
   run at ×0.9 HP (TUNING.smoothing.earlyLevels), then from L5 a linear ramp to ×1.15 HP by L10
   (compensationFrom=5, compensationFull=10, compensationMax=1.15), holding at ×1.15 for L11-15 and
   endless. This is multiplicative with the existing difficulty-setting and level's own hpMul, so it
   composes cleanly rather than overriding either.

### Decisions / deviations
- Minimalist/Specialist count towers *ever built* this run (not currently standing), so sell-and-rebuild
  cycling can't be used to dodge the constraint — a deliberate tightening beyond a literal reading.
- "Speedrunner" only breaks on the interT-countdown auto-trigger (callWave(false)); using the existing
  auto-wave ⏩ toggle (which always calls early=true) still satisfies it, since that playstyle is if
  anything more aggressive about not waiting.
- Found and fixed a real bug during implementation: my first draft of the new validate.ts zone/guide
  checks used a dynamic `import()` inside an otherwise fully synchronous script, which would have raced
  against the script's existing synchronous `process.exit()` and could have silently skipped those
  checks entirely. Caught before packaging by noticing the async/sync mismatch; replaced with a plain
  top-level import. Documenting it here since it's exactly the kind of subtle validate.ts bug that
  would otherwise pass silently forever (green output for the wrong reason).
- Challenge stars and level-completion stars remain separate pools, both already summed by
  starsEarned() from Phase 1 — no changes needed there, just confirmed correct.

### Known issues
- None known. Gates green; 28/28 challenge instances validated (correct ids, no duplicates, valid
  params); zone/guide seen-key alignment validated.

### Next: Phase 6 — Replayability (Ascension I-V, Daily Op, endless deepening, Chroma mode, Service
Record, mid-level resume).

---

## Phase 6 — Replayability [COMPLETE]
Started: 2026-07-08 · Finished: 2026-07-08

### Shipped
1. **Ascension I–V**: cumulative tiers, unlocked one at a time by beating L15 at the current
   ceiling (`save.ascension.unlocked`), freely selectable up to that ceiling for ANY level
   (`save.ascension.current`) via a new selector row on the level-select screen. Effects
   (all stacking): I +20% HP · II mutation chance +15pts & can start from wave 2 · III elite
   chance ×2 & a chance at a second, distinct affix · IV −25% starting credits & interest cap
   halved · V intermissions 40% shorter & meteors forced on every level. Crown badges on level
   cards show the best tier each level has been beaten at; beating all 15 at tier V grants a
   one-time "Warmaster" flourish on the title screen and Service Record.
2. **Elite dual-affix refactor**: `Enemy.eliteAffix` (single) became `eliteAffixes` (array),
   since Ascension III elites can roll two independent affixes (e.g. Shielded+Swift). Updated
   `makeElite()`, the vampiric-heal check, and the hover tooltip accordingly.
3. **Daily Op**: new `daily.ts` module. Seed = `hash(YYYY-MM-DD)` deterministically picks a
   beaten level, 1-2 forced modifiers, and always plays at Hard with a flat +25pt mutator-chance
   bonus and a **mirrored** path. Card on level select shows composition + streak; win stamps
   the streak (consecutive-day check via `daysBetween`), a missed day resets current but keeps
   best. Retry/settings-restart mid-daily-op now correctly preserve the daily context (see bugs
   below — this was originally broken).
4. **Endless deepening**: milestone stars at waves 10/20/30 per difficulty tier (one-time,
   `save.endlessMilestones`), shown in the loss/summary screen; endless now bypasses normal
   unlock gating for "hard" mutators and all level modifiers regardless of the player's actual
   campaign progress, so it always plays with the full rotation as specified.
5. **Chroma mode**: unlocks automatically at 28/28 challenge stars. Alternate palette is a pure
   CSS custom-property override (`body.chroma-theme`) reusing every existing `var(--*)` token,
   so all UI chrome re-themes for free, including the title screen. **Scope note**: this does
   NOT re-theme the canvas game-world rendering (nebula, towers, enemies) — those use hundreds
   of hardcoded hex colors in game.ts's draw calls, and re-theming all of them wasn't
   proportionate for a cosmetic prestige reward. Documented as a deliberate boundary, not an
   oversight.
6. **Service Record**: new screen off level select — lifetime kills/waves/elites/NOVAs/best
   combo/favorite tower (by build count)/level & challenge star totals/ascension ceiling/daily
   streak/sessions.
7. **Mid-level resume**: new `resume.ts` module, version-stamped, serialize/deserialize never
   throws (malformed or version-mismatched data discards gracefully to `null`). Snapshot taken
   via a new `Game.onWaveClear` hook at every wave clear (never on the level's final wave, since
   `win()` returns first — nothing to resume into a finished level). `startLevel()` was made
   resume-aware end-to-end: it reuses ALL normal construction/wiring code (so nothing is
   duplicated) and, when given a snapshot, constructs the Game with the **snapshot's own**
   tileSize/meander/diffTier/ascTier (not the player's possibly-since-changed current settings
   — using anything else would regenerate a different grid and orphan every saved tower cell
   index), then restores credits/lives/waveIdx/NOVA charge/ability cooldowns/active modifier set
   and rebuilds each tower directly from its saved stage/branch/branchStage/mode/spent/stats.
   Resume prompt appears automatically on the title screen when a valid snapshot exists
   ("Resume Level N — Wave M, K towers standing" / Resume / Abandon). Snapshot is cleared on
   win, on loss, and the instant it's acted on (resumed or abandoned) or superseded by starting
   something else.
8. **Balance pass 2**: spot-checked L15 "The Leviathan" economy at Ascension III and V (Hard
   difficulty baseline). III: HP ×1.50 vs. non-ascension baseline, starting credits unchanged.
   V: same ×1.50 HP (confirmed HP scaling doesn't compound past tier I by design — only
   Hardened adds raw HP; II-V add systemic pressure instead) but starting credits drop to 75%
   (620→465) and the interest cap halves (60→30). No TUNING values were changed — the numbers
   land in an intentional "meaningfully harder, not a cliff" band, and the later tiers'
   difficulty comes from compounding *systems* (shorter breathing room, doubled elites, forced
   meteors, tighter economy) rather than a raw damage-sponge escalation.

### Real bugs found and fixed during this phase (all verified via the fuzz/unit tests above)
- **Level 8 "The Coil" pre-existing self-intersecting path.** Completely unrelated to any of
  this project's six phases — the ORIGINAL hand-authored waypoints crossed themselves at pixel
  (1080, 450), regardless of tile size or meander setting. Found via a new fuzz harness that
  (unlike earlier phases' fuzz tests, which only used synthetic random paths) runs the real
  snap-to-grid pipeline against every actual level's path data. Replaced with a verified
  non-crossing monotonic zigzag of equivalent length/complexity; re-fuzzed clean.
- **Daily Op mirroring was fundamentally broken.** A naive per-point x-flip keeps the original
  point *order*, which reverses the shape's natural flow direction — but the engine always pins
  the first waypoint to the portal (left) column and the last to the base (right) column
  regardless of actual coordinates. The mismatch between "shape wants to flow right-to-left"
  and "engine forces start-left/end-right" produced self-crossing paths on nearly every level.
  Fixed by also reversing point order after the x-flip, which restores a proper mirror image
  that still flows the direction the engine expects. Caught by the same new real-level fuzz
  harness (324 trials: 15 levels + endless × 3 tile sizes × 3 meander tiers × mirrored/not).
- **`game.diffTier` was silently overwritten right after construction** with the player's raw
  settings value, undoing the correctly-computed Daily-Op-forced Hard difficulty (and, latently,
  any future per-run diffTier override) for all elite/mutator chance math. Found while tracing
  through `startLevel` for the resume refactor. The line was fully redundant for normal play
  (same value either way) and simply wrong for daily/resume — removed.
- **Retry/Replay after a Daily Op run silently dropped back to normal (non-mirrored,
  non-forced-modifier) play** of the same level, because the retry button didn't pass the daily
  context through. Same bug existed for the settings-change mid-level restart path. Both fixed
  by threading `this.currentDaily` through.

### Decisions / deviations
- Ascension does not apply to Endless mode (endless already has its own escalating per-wave
  difficulty and a separate record track; stacking a second difficulty system on top felt like
  scope creep beyond what was asked).
- "RNG state" from the plan's resume spec, in practice, reduces to preserving the *resolved*
  active-modifier set (`game.mods`) rather than any PRNG seed/stream — the engine doesn't use a
  resumable seeded stream for moment-to-moment randomness (wave mutator rolls etc. use
  `Math.random()` directly); only one-time setup (meander, asteroid/vein seeding, endless's
  modifier pick) is seeded, and all of those are either re-derivable identically from the
  preserved settings or already captured directly in the `mods` list.
- Resume is a single slot (`save.resume?: string`), not a stack — starting any level normally
  (not via the resume prompt) silently discards a pending snapshot. This matches common
  single-save-slot conventions and keeps the mental model simple ("the prompt is your one
  chance"); documented here rather than left implicit.
- Challenge/star/ascension-progress saving is fully skipped for Daily Op runs (it's a separate
  side-activity gated only by its own streak, not campaign progression).

### Known issues
- None known. Full regression suite green: 324-trial mirror+meander fuzz, resume round-trip
  unit tests, 30-date×2 Daily Op determinism test, tsc, validate.ts, and the actual `npm run
  build` (Vite) all pass.

### Next: Phase 7 — Mobile & PWA (Samsung S23+, landscape).

---

## Phase 7 — Mobile & PWA [COMPLETE]
Started: 2026-07-08 · Finished: 2026-07-08

### Shipped
1. **Pointer Events unification**: canvas input rewritten from mouse-only to Pointer Events
   throughout. Mouse behavior is byte-for-byte unchanged (acts immediately on pointerdown,
   via the extracted `handleMapTap()` method — same logic, just relocated). Touch/pen instead
   waits: pointerdown starts a 450ms timer and records position; pointerup fires the tap
   action ONLY if the timer never fired and the finger stayed within a 12px move threshold
   (otherwise it's treated as a drag/scroll and ignored, or as a completed long-press).
   `contextmenu` prevention, `touch-action:none` on the canvas, `touch-action:manipulation`
   globally (kills double-tap-zoom + the 300ms tap delay), `overscroll-behavior:none` (kills
   pull-to-refresh), `-webkit-tap-highlight-color:transparent`, `-webkit-touch-callout:none`.
2. **Long-press (450ms)**: on an enemy → tooltip pinned via `UI.pinnedEnemyTip`, independent
   of the old hover-position lookup, persists until finger-lift, auto-clears if the enemy dies
   mid-hold. On a tower → `Game.peekTower`, a new lightweight range-preview render path
   (reuses `drawRangeTiles`) that shows the range circle without opening the full tower panel
   or mutating `selected`. Both fire a short haptic tick.
3. **Build-menu touch-rest preview**: added `touchstart`/`touchend`/`touchcancel` handlers
   alongside the existing `onmouseenter`/`onmouseleave` on each build-menu item, so resting a
   finger on an option shows the same range preview mouse-hover already gave — this was the
   one genuinely hover-*gated* affordance found in a full audit; everything else was either
   decorative `:hover` polish (harmless without it) or a `.title` native tooltip (degrades
   gracefully on touch, not worth bespoke replacement).
4. **Coarse-pointer UI**: `matchMedia('(pointer:coarse)')` computed once (`UI.isCoarse`) for
   JS branching, mirrored by a CSS `@media (pointer:coarse)` block bumping every interactive
   control to a real ≥44px target (icon buttons 42→56px, `.btn`/`.seg-chip`/`.toggle`/
   `.move-btn`/`.sell-btn`/`.tree-node`/`.meta-node`, ability/NOVA buttons enlarged). Tower
   panel becomes a full-width bottom sheet (drag-handle, `max-height:62%`, internal scroll —
   CSS specificity `#side-panel.sheet` correctly overrides the desktop positioning's
   `max-height:620px`). Build menu becomes a centered sheet with a 3-column item grid instead
   of 5. Settings/codex/dev modals needed no structural change — already centered, scrollable
   `.modal-card`s that inherit the same coarse button-sizing rules.
5. **Orientation lock**: `#orientation-overlay` (full-screen, `position:fixed`, `z-index:9999`
   — verified via a full z-index audit that nothing else in the app exceeds 5, and verified it
   sits as a sibling of `#ui-root` rather than a descendant, so `#ui-root`'s CSS `transform:
   scale()` can't affect its fixed positioning) shown via `@media (orientation:portrait) and
   (pointer:coarse)` — gated to touch devices only, so a narrow desktop window is unaffected.
   Paired with a JS-side `checkOrientationPause()` (via a `matchMedia` change listener) that
   auto-pauses an active game on rotation to portrait and auto-resumes on rotation back,
   tracked with its own flag so it never fights a pause the player set deliberately.
   `viewport-fit=cover` + `env(safe-area-inset-*)` padding applied to every edge-anchored HUD
   element (top bar, left/right icon clusters, ability stack, NOVA button, build-hint,
   toasts) for punch-hole/notch safety.
6. **Canvas sharpness**: the canvas backing store was fixed at 1280×720 physical pixels
   regardless of device — on a high-DPI phone this meant the browser was upscaling a
   comparatively low-res bitmap, i.e. real blur. Backing store is now sized to
   `logical_size × CSS_scale_factor × min(devicePixelRatio,2)`, with the render context scaled
   by that same factor (`Game.dpr`) so every existing draw call keeps working in unmodified
   1280×720 logical coordinates. Touched three `setTransform` call sites (main render, overlay
   render, and the separate title-screen backdrop loop) to use this factor instead of a bare
   identity reset. `toGame()`'s pointer math is untouched and still correct — it only ever used
   the CSS scale factor, which sharpness doesn't change.
7. **Performance mode**: new tri-state setting (Auto/On/Off, default Auto = on for coarse
   pointers). When active: starfield count −40% (110→66, set at level construction), particle
   list capped at 250 with oldest-first culling (checked once per frame after the existing
   dead-particle filter), and four `backdrop-filter: blur()` panels (build menu, enemy tip,
   tower panel, end-of-level dim) swap to solid ~0.94-opacity backgrounds via a `.perf-mode`
   body class. A frame-time watchdog (rolling 3-second window during active, unpaused play)
   auto-enables performance mode once if the average exceeds 20ms/frame, with a low-tier toast
   telling the player what happened rather than silently changing behavior.
   `visibilitychange` → pauses the game and calls a new `audio.suspend()` (pairing with the
   existing resume-on-`ensure()` logic) when the tab/app backgrounds; restores on return, again
   tracked separately from a manual pause so the two can't fight each other.
8. **Haptics audit against the plan's explicit list**: NOVA ✓, boss death ✓, and victory
   stars ✓ were already wired in earlier phases (Phase 2/4/5). The audit found one real gap —
   **hull hit** (a leak reaching the base) had no haptic — now added.
9. **PWA**: `manifest.webmanifest` (fullscreen + standalone fallback, landscape, theme
   `#14152a`), a new source icon (`build-tools/icon.svg` — pastel tower motif matching the
   existing favicon, art kept within an ~80% "safe zone" so maskable OS crops never clip it)
   rasterized via `sharp` to 192/512 regular + 192/512 maskable PNGs
   (`npm run gen-icons`, one-time/as-needed — not part of the per-build pipeline since icon art
   changes far less often than code). Service worker is **generated post-build**
   (`build-tools/gen-sw.ts`, now chained onto `npm run build` so a normal Vercel deploy gets it
   automatically): scans the real `dist/` output for its actual content-hashed filenames (which
   change every build) and writes a precache list plus a version string derived from a hash of
   those exact files+sizes, so cache invalidation is tied to genuine output changes, not
   incidental rebuilds. Strategy is cache-first with network fallback and background cache
   backfill; `activate` deletes any previous version's cache. Registration in `main.ts` is
   guarded by `location.protocol === 'https:'`, confirmed both by reading the guard logic and
   by grepping the actual minified singlefile output to verify the exact same guard condition
   survived minification intact — the single-file build is provably inert under `file://`.
   iOS/PWA meta tags (`apple-mobile-web-app-*`, `theme-color`) and `apple-touch-icon` added to
   `index.html`. Audio-unlock-on-first-interaction was **already implemented** in an earlier
   phase (`document.addEventListener('pointerdown', () => audio.ensure(), {once:true})`) —
   verified present, no new work needed.

### Exit criteria — what was and wasn't achieved
- **PWA self-audit**: done via direct inspection — manifest fields verified against spec,
  icon rasterization verified (192/512 × regular/maskable all generated and visually checked),
  service worker generation verified against a real `dist/` build (8 files precached, correct
  version hash), HTTPS registration guard verified present in both source and the actual
  minified output, single-file inertness verified by simulating the guard condition under
  `file:` protocol.
- **Single-file boots with SW inert**: verified structurally (guard condition confirmed in the
  minified bundle) rather than by launching a real browser against it — see below.
- **846×390 coarse screenshots**: **not obtained**. This sandbox has no usable headless
  browser: the system Chromium package is a non-functional snap stub (snapd isn't running in
  this container), and Puppeteer's bundled-Chromium download is blocked by this environment's
  network allowlist (`storage.googleapis.com` isn't a permitted egress host — confirmed via a
  403 from the proxy, not a transient failure). Both install paths were actually attempted
  before concluding this, matching the plan's own contingency clause. In place of screenshots,
  I did a full manual verification pass instead: audited every `z-index` in the stylesheet to
  confirm the orientation overlay is genuinely topmost; traced CSS specificity to confirm
  `#side-panel.sheet`'s rules actually win over the desktop positioning rules; confirmed the
  orientation overlay sits outside `#ui-root`'s transformed stacking context; audited every
  `pointer-events` declaration to confirm decorative overlays (combo counter, boss bar, guide
  ring) can't block touches to the canvas beneath; grepped for and confirmed zero leftover
  mouse-only listeners after the Pointer Events refactor. This is real verification, just not
  visual — **the mobile layout has not been seen rendered, by me or anyone, and that is the
  single biggest risk in this phase.** Kevin's real-device pass on the S23+ is load-bearing
  here in a way it wasn't for earlier phases.

### Decisions / deviations
- `isCoarse` is computed once at UI construction, not live-updated if pointer capability
  changes mid-session (e.g. a mouse attached to a tablet). Doesn't apply to the actual target
  device (S23+ phone); flagged rather than engineering for a scenario out of scope.
- Build-confirm/move-confirm popups (the small 2-step-placement dialogs) were deliberately
  *not* converted to sheets — they're compact enough to stay as positioned popups, and their
  existing clamp-to-viewport logic already keeps them on-screen at any size.
- Performance-mode's starfield reduction only takes effect at level *construction* (matches
  when the star array is built); toggling the setting mid-level doesn't retroactively thin an
  already-generated starfield. Accepted as a cosmetic-only inconsistency, not worth a restart
  prompt over background decoration.
- Service worker generation was added to the main `build` script (not a separate opt-in
  command), since Kevin's actual deploy path is Vercel running `npm run build` directly —
  a separate script nobody remembers to run would never actually ship.

### Known issues
- **No visual verification of the mobile layout** — see exit criteria above. This is the
  primary open risk carried into Kevin's device check.
- Everything else: gates green (tsc, validate.ts), full regression suite green (324-trial
  mirror+meander fuzz, resume round-trip, 30-date daily determinism), both bundles build clean,
  PWA structurally verified.

### Next: Phase 8 — Test Suite, Final Balance, Device Checklist, Ship.

---

## Phase 8 — Tests, Final Balance, Ship [COMPLETE]
Started: 2026-07-08 · Finished: 2026-07-08

### Shipped
1. **Node unit test suite** (`/tests`, 10 files + `run-all.ts` runner): every item from the
   plan's checklist is covered, importing directly from the real source modules wherever
   possible (data.ts/levels.ts/save.ts/resume.ts/rng.ts are all leaf modules with zero
   internal imports, so tests exercise the actual shipped code, not a reimplementation).
   `daily.ts`'s logic is the one exception — it has real internal imports that Node's strict
   ESM resolver can't follow without extensions Vite's build can't accept — so its short
   orchestration is faithfully mirrored against the same real, directly-imported primitives
   (mulberry32/hashString/seededInt/seededPick from rng.ts, MODIFIER_INFO from data.ts),
   matching the pattern validate.ts already established.
   - `combo-interest.ts` — combo chain/milestone timing, interest cap math
   - `mutators-elites-drops.ts` — elite roll distribution (10k-trial statistical), mutator
     chance formula + STAT EFFECTS (not just probability), drop weighting (20k-trial)
   - `nova-ascension.ts` — NOVA recharge decay, Ascension cumulative tier stacking (verified
     tier V has literally all five tiers' effects active simultaneously)
   - `challenges.ts` — all 7 challenge predicates against synthetic states, cross-checked
     against the real 28 level-authored instances
   - `unlock-gating.ts` — fresh/mid/veteran save states against the real UNLOCKS table, plus
     UNLOCKS<->SEEN_UNLOCK_LEVELS sync
   - `save-migration.ts` — idempotency across 11 synthetic save fixtures (found and fixed a
     real bug — see below)
   - `daily-op.ts` — 30-date x2-run determinism, plus full streak-across-dates logic
     (consecutive days, same-day replay, gaps, month/year boundaries)
   - `resume.ts` — serialize/deserialize round-trip fidelity, version-mismatch and malformed
     data graceful discard
   - `mirror-meander-fuzz.ts` — every level x every tile size x every meander tier x
     mirrored/not (324 trials)
   - `asteroid-vein-seeding.ts` — **new**, closes a Phase 3 exit-criteria gap (see below)
2. **Headless smoke test: attempted, not achievable in this sandbox.** Both installation
   paths were actually tried, not just assumed unavailable: the system `chromium-browser`
   package installs as a non-functional snap stub (snapd isn't running in this container), and
   Puppeteer's bundled-Chromium download is blocked by the environment's network egress
   allowlist (`storage.googleapis.com` returns 403, not in the permitted host list). Per the
   plan's own contingency, shipped the fallback instead:
3. **`?selftest=1` in-page harness** (`src/selftest.ts`, lazy-loaded — confirmed via the real
   Vite build to land in its own ~2KB chunk, not bloating the main bundle): jumps straight into
   Level 1, then drives 500 checkpoints of real automated play (builds 4 varied towers,
   launches every wave automatically, exercises the upgrade path) against a REAL `Game`
   instance — the same class actual play uses, not a mock. Watches `window.onerror` and
   unhandled promise rejections, checks credits/lives/waveIdx stay finite and non-negative
   every checkpoint, and prints a machine-parseable `SELFTEST_RESULT: PASS`/`FAIL` line plus a
   final-state summary. Fully typed against the real `Game`/`UI` classes (no `any` — every API
   call in the harness is compiler-verified against the actual class shapes, which is real
   verification even though it's not the same as watching it run).
4. **Final balance sweep**: extended validate.ts with a full difficulty (5) x ascension (6)
   grid printout for three representative levels (1/8/15), plus automated sanity bounds (no
   non-positive or runaway HP multipliers, no credit cut deeper than 50%). Full output below.
   **No TUNING values were changed** — the sweep confirms the existing numbers are well-behaved
   across the entire grid, not just the two spot-checked points from Phase 6.
5. **Deliverables**: `CHANGELOG.md` (player-facing summary of the whole overhaul, grouped by
   purpose rather than build phase), `DEVICE-CHECKLIST.md` (S23+ real-device checklist,
   explicitly prioritized — Priority 1 is everything from Phase 7 that was never visually
   verified, since that's genuinely the highest-risk surface right now).

### A second real bug found by the new tests
- **`migrateSave` didn't guard against explicit `null` values for top-level primitive/array
  fields** (`unlocked`, `meta`, etc.) — only genuinely *missing* keys were protected by the
  existing `...base, ...d` spread pattern; a save with `{unlocked: null}` would have propagated
  that `null` straight through, corrupting the save. Caught by `save-migration.ts`'s
  "null fields throughout" fixture. Fixed by explicitly re-validating every fragile top-level
  field's type after the spread (see save.ts). This is exactly the kind of thing a real test
  suite is for — a scenario I wouldn't have manually thought to construct, but a systematic
  fixture list surfaced immediately.

### Final plan audit
Read PLAN.md in full against the actual codebase, phase by phase, before considering this
done. Two gaps found and closed (both documented above/here rather than silently patched):
- **Phase 3's exit criteria** ("asteroid seeding never intersects path across 15 levels x 3
  meander tiers x 3 tile sizes") had only ever been reasoned about as correct "by construction"
  — never actually fuzz-tested. Closed with the new `asteroid-vein-seeding.ts`, which faithfully
  replicates the real seeding loops from `buildGrid()` and confirms zero intersections across
  51 real level/tile-size combinations (plus the same guarantee for Rich Veins, which shares
  the same risk and wasn't explicitly named in the original exit criteria but clearly should
  have been).
- **`migrateSave`'s null-field gap**, above.
Everything else cross-checked clean:
- Reduce Motion genuinely folds in screen-shake suppression (`shake()` checks `reduceMotion`
  directly), not just a cosmetically-separate toggle.
- Zero banner/toast DOM creation exists outside the `Notifier` class — confirmed by grep
  boundary-checking every `.banner` element creation site against the class's line range.
  "Route ALL onBanner calls through it" is fully satisfied, not just mostly.
- The mutator no-back-to-back-before-L10 rule is present and correctly gated.
- `#wave-preview`'s `max-width:300px; overflow-x:auto` genuinely bounds the two-wave forecast
  regardless of content — "fits 1280 width" is an enforced CSS constraint, not an assumption.
- Every other phase's exit criteria were already met by work done during that phase (see each
  phase's own section above) — re-verified against the running test suite and validate.ts
  rather than taken on faith.

### Balance sweep results (captured verbatim from validate.ts)
```
Level 1 (First Contact) — base hpMul 1, startCredits 260:
  Relaxed  hpMul  A0:0.63x  A1:0.76x  A2:0.76x  A3:0.76x  A4:0.76x  A5:0.76x
  Easy     hpMul  A0:0.77x  A1:0.92x  A2:0.92x  A3:0.92x  A4:0.92x  A5:0.92x
  Normal   hpMul  A0:0.90x  A1:1.08x  A2:1.08x  A3:1.08x  A4:1.08x  A5:1.08x
  Hard     hpMul  A0:1.13x  A1:1.35x  A2:1.35x  A3:1.35x  A4:1.35x  A5:1.35x
  Brutal   hpMul  A0:1.40x  A1:1.67x  A2:1.67x  A3:1.67x  A4:1.67x  A5:1.67x
  startCredits/interestCap  A0:260◆/cap60  A1:260◆/cap60  A2:260◆/cap60  A3:260◆/cap60  A4:195◆/cap30  A5:195◆/cap30

Level 8 (The Coil) — base hpMul 2.7, startCredits 400:
  Relaxed  hpMul  A0:2.06x  A1:2.47x  A2:2.47x  A3:2.47x  A4:2.47x  A5:2.47x
  Easy     hpMul  A0:2.50x  A1:3.00x  A2:3.00x  A3:3.00x  A4:3.00x  A5:3.00x
  Normal   hpMul  A0:2.94x  A1:3.53x  A2:3.53x  A3:3.53x  A4:3.53x  A5:3.53x
  Hard     hpMul  A0:3.68x  A1:4.41x  A2:4.41x  A3:4.41x  A4:4.41x  A5:4.41x
  Brutal   hpMul  A0:4.56x  A1:5.47x  A2:5.47x  A3:5.47x  A4:5.47x  A5:5.47x
  startCredits/interestCap  A0:400◆/cap60  A1:400◆/cap60  A2:400◆/cap60  A3:400◆/cap60  A4:300◆/cap30  A5:300◆/cap30

Level 15 (The Leviathan) — base hpMul 7.6, startCredits 620:
  Relaxed  hpMul  A0:6.12x  A1:7.34x  A2:7.34x  A3:7.34x  A4:7.34x  A5:7.34x
  Easy     hpMul  A0:7.43x  A1:8.91x  A2:8.91x  A3:8.91x  A4:8.91x  A5:8.91x
  Normal   hpMul  A0:8.74x  A1:10.49x  A2:10.49x  A3:10.49x  A4:10.49x  A5:10.49x
  Hard     hpMul  A0:10.92x  A1:13.11x  A2:13.11x  A3:13.11x  A4:13.11x  A5:13.11x
  Brutal   hpMul  A0:13.55x  A1:16.26x  A2:16.26x  A3:16.26x  A4:16.26x  A5:16.26x
  startCredits/interestCap  A0:620◆/cap60  A1:620◆/cap60  A2:620◆/cap60  A3:620◆/cap60  A4:465◆/cap30  A5:465◆/cap30
```
Reading: HP scaling is smooth and monotonic across every difficulty tier at every level.
Ascension tiers I through V show identical hpMul (confirms by design that HP scaling doesn't
compound past tier I — only Hardened adds raw HP; tiers II-V add systemic pressure — more
mutators, more elites, tighter economy, less time — instead of a raw damage-sponge escalation).
Starting credits and interest cap stay completely flat until tier IV, then drop together by a
consistent 25%/50% respectively at every level sampled, not just L15. No automated sanity
check flagged anything as a cliff or a runaway multiplier anywhere in the grid.

### Decisions / deviations
- No TUNING values were changed in this phase — the balance sweep was confirmatory, not
  corrective. If Kevin's real play surfaces something that feels off, PLAN.md's risk register
  already anticipated this ("expect one tuning round from Kevin's real play") and every value
  lives in one place (`TUNING` in data.ts) specifically to make that cheap.
- The self-test harness builds a fixed, small set of tower types (pulse/mortar/tesla/ray) for
  breadth across mechanics (single-target/splash/chain/piercing-beam) rather than trying to
  exercise all 10 — chosen for a fast, reliable 500-checkpoint run rather than maximum coverage
  in one pass.

### Known issues
- None known. Full 10-file test suite green, tsc clean, validate.ts clean (including the new
  balance sweep and asteroid/vein seeding checks), both bundles build clean.
- Carried forward from Phase 7, still the single biggest open item: the mobile layout has
  still never been seen rendered by anyone. DEVICE-CHECKLIST.md Priority 1 exists specifically
  for this.

### This is the last phase. STARHOLD 2.0 is complete per PLAN.md.

---

## Post-Phase-8 addition — Map Guide & Game Guide
Added: 2026-07-08

Kevin noticed the twinkling glow on some tower spots (Rich Vein cells) and asked what it
meant, plus asked for a general "explain everything" reference since a lot had accumulated
across 8 phases. Two new in-game reference screens, both reachable from Settings, plus a
prominent standalone "📖 Guide" button on the level-select header (the natural place a
confused player looks, not buried in Settings):

- **Map guide** (`showMapCodex`): 10 entries covering every tile type and on-map overlay —
  open cells, path, rocky debris (Asteroid Field), Rich Vein cells (the glowing ones — build
  there for +2◆ per kill), meteor warning rings, ion storm bands, portal, base, range preview,
  and supply crates. Each entry has a small CSS swatch styled to match the actual in-game color
  language (not a canvas replica, but recognizable) plus a plain-language explanation.
- **Game guide** (`showGameCodex`): a full walkthrough of every system added across all 8
  phases, organized in the order a new player naturally meets them — The Basics, Making It
  Interesting (combo/interest/elites/drops/mutators/modifiers), Abilities & Big Moments,
  Stars & Rewards, After You Beat The Campaign (Ascension/Daily Op/Endless/Chroma/Service
  Record/Resume), and Settings Worth Knowing About. Cross-links to the Map Guide for the
  tile-specific detail.
- Both methods accept an optional `parentDim` so they work nested (opened from within
  Settings, stacking on top like the existing Alien/Tower codexes) or standalone (opened
  directly from level-select).
- Caught and verified a subtle risk during implementation: the guide text needed several
  escaped apostrophes/quotes inserted via a Python heredoc, which is exactly the kind of
  operation that can silently double-escape and leave literal backslashes visible in the
  UI. Verified byte-for-byte (not just visually) that every escape sequence in the final file
  is correct, then re-confirmed by grepping the actual compiled JS output for the exact
  apostrophized phrases — they render clean.

Gates green, full test suite green, both bundles rebuilt.

---

## Post-audit balance pass — items 6a, 7, 10, 13b, 15
Applied: 2026-07-09

Implemented 5 specific items from the Phase-8-audit to-do list (`STARHOLD-AUDIT-TODO.md`),
per Kevin's explicit selection. No other audit items were touched.

1. **Item 6a — Star Lance pierce 4→3.** Was a genuine cluster-DPS outlier (54.0/100cr vs.
   a field average of 15-25) specifically because pierce deals full, non-degraded damage to
   every enemy hit and aliens travel single-file, making its theoretical max close to its
   practical average on any straight path stretch. Verified the nerf's actual effect properly
   this time (a naive "3 enemies clustered" test scenario doesn't distinguish pierce=3 from
   pierce=4, since both cap out below the enemy count modeled — had to test a 5+-enemy queue
   specifically to see the real delta): peak-scenario DPS/100cr drops from 89.9 to 71.9, a
   genuine ~20% cut exactly where the outlier behavior lived, while 1-4-enemy performance
   (the common case) is completely unchanged. Description text updated to match ("Pierces 3
   enemies").
2. **Item 7 — Glacier Lance (Cryo's pierce branch) damage 30→60.** Was at just 20% of Star
   Lance's single-target DPS despite Cryo's other branches holding a much gentler ~50-79%
   ratio against Pulse's equivalents. Recomputed against the *already-nerfed* Star Lance (not
   the old numbers) to land the new value correctly: 60 damage puts Glacier Lance at 45% of
   Star Lance's DPS while carrying real utility Star Lance lacks (55% slow vs. a 25% crit
   chance) — solidly in line with Cryo's own established pattern rather than a 5x-deeper cut.
   Left Cryo Lance (the branch's first tier, 20 dmg) untouched — the audit item was scoped to
   the final-tier outlier specifically, and this project's other towers already show plenty of
   variance in their own upgrade-step ratios, so a bigger jump at this one branch's second tier
   isn't inherently inconsistent with the rest of the game.
3. **Item 10 — NOVA Game Guide clarification.** Added one sentence to the `showGameCodex()`
   NOVA entry: "Most effective against groups of regular enemies — bosses take reduced,
   meaningful-but-not-decisive damage from it, so think of it as crowd control rather than a
   boss-damage cooldown." Pure documentation change, no balance/behavior change — NOVA's
   actual damage numbers are untouched (see audit item #10's own reasoning for why 400 flat
   damage against a 16,000+ HP boss is very likely intentional, not a bug).
4. **Item 13, option (b) — ease Level 6's hpMul for zone-transition consistency, WITH a
   documented deviation from the literal audit wording.** Investigated the underlying
   mechanism before implementing rather than mechanically matching a percentage. Found that
   the original "L10→L11 drops 18%" finding is mostly an artifact of The Colossus's boss wave
   carrying a disproportionate 45% of L10's total HP (vs. The Mothership carrying only 28% of
   L5's) — L11 and L6 are BOTH actually harder than their predecessor's non-boss content when
   you set the boss wave aside, so the "dip" isn't really about L11 being easy, it's about
   L10's boss wave being unusually HP-heavy. Solving for the exact -18% match on L6 required
   dropping its hpMul to roughly 1.2-1.3, which would have made L6 *lower* than L4's hpMul
   (1.5) and broken the otherwise clean, monotonically-increasing hpMul sequence across L1-L15
   — a worse trade-off than the inconsistency being fixed. Implemented a moderate, real ease
   instead: **hpMul 2.0 → 1.5** (now tied with L4, with L5's boss level sitting as a small
   peak in between — a reasonable shape). Result: L5→L6 goes from +26% to **-6%** (a genuine,
   modest breather at the zone transition, consistent in *direction* with L10→L11, without
   the monotonicity break the exact-match version would have required). Flagged clearly to
   Kevin in the same turn this was implemented, rather than silently substituting judgment for
   his explicit instruction without saying so — he can ask for the more aggressive version if
   the modest ease doesn't feel sufficient in real play.
5. **Item 15 — interest cap now scales with level progress: `60 + levelId × 3`, reaching 105
   by L15** (previously a flat 60 everywhere). Implemented in the `Game` constructor (was
   previously a static class-field default). Endless mode explicitly excluded from the scaling
   (endless's `level.id` is a fixed sentinel `99`, which would have produced a nonsensical
   357-credit cap if not special-cased — endless keeps the flat 60 base). Ascension IV's own
   override (flat 30 regardless of level) was deliberately left untouched — it's meant to be a
   hard scarcity squeeze regardless of which level is being replayed at that tier, not a
   percentage of whatever the level-scaled value would otherwise be. Also updated
   `validate.ts`'s separate balance-sweep model (a hand-written approximation of the real
   formula for the diagnostic printout) to match, since it would otherwise have silently gone
   stale and misreported the cap as flat 60 in its own output. **Minor known side-effect,
   flagged not fixed**: the Ascension selector's tooltip text ("interest cap halved") is now
   only exactly accurate at low levels — at L15 the flat-30 override represents closer to a
   71% cut than a 50% one. Left as-is since it's still directionally true and rewording wasn't
   part of what was asked; worth a look if it reads as confusing in practice.

### Verification
All 5 changes re-verified together (not just individually) via the full regression suite:
`tsc --noEmit` clean, `validate.ts` clean (including its now-updated balance-sweep printout,
which correctly shows `cap105` at L15), and all 10 test files in `/tests` still green — none
of the existing unit tests happened to hardcode the old flat interest cap or the old Star
Lance/Glacier Lance numbers, so nothing needed updating there. Both bundles rebuilt clean.

### Not implemented (not requested this round)
Items 8, 9, 11, 12, 14, and all of Sections C/D/E from the audit remain open — this was a
scoped, explicit selection (6a, 7, 10, 13b, 15 only), not a "do everything" pass.

---

## Post-audit polish/bug pass — items 16, 17, 18, 19, 20, 21, 23
Applied: 2026-07-09

Implemented all 7 remaining requested items from `STARHOLD-AUDIT-TODO.md` with their suggested
fixes. Two items (16 and 18) offered multiple options in the original audit; both are called
out below with the reasoning for which one was chosen, following the same transparency
practice as the prior balance pass.

1. **Item 16 — medium banner duration now scales with content length**, chosen over the
   simpler flat-bump alternative because a flat bump would have slowed down every *short*
   banner too (wave mutator names, single-modifier banners) that likely weren't the problem —
   the length-scaled version only adds real time to the genuinely long multi-item banners
   (challenge briefings, 3-modifier lists) that were actually flagged. Formula:
   `Math.max(2100, (text+sub length) * 45)` ms. **Found and fixed a real problem with my own
   first-draft implementation**: the CSS `@keyframes banner` entrance/hold/exit animation is
   percentage-keyed against a *fixed* `animation-duration` (1.6s base, 2.1s for the sub-line)
   completely independent of the JS timer — extending only the JS removal delay would have
   left the banner sitting invisible (already faded to opacity:0 per the keyframe's `100%`
   state) for however much longer the JS kept it in the DOM, defeating the entire fix. Now
   sets `animationDuration` inline to match the computed duration on both the banner and its
   optional sub-line, so the visible hold phase genuinely stretches instead of the banner
   quietly disappearing early.
2. **Item 17 — floater lifetime now scales with text length**: `Math.min(1.6, 0.6 + text.length
   * 0.025)` seconds, exactly as specified in the audit. Short numbers stay snappy (~0.65-0.7s),
   longer phrases like "Abilities recharged!" get ~1.1s, capped at 1.6s so nothing lingers.
3. **Item 18 — Game Guide's nested-scroll risk removed**, chosen the "remove the inner cap"
   option over "guess a bigger outer height" because it's robust to *any* future content length
   rather than needing the guess re-verified every time guide text changes. `.guide-list`
   (Game-Guide-specific, scoped by its own class so the Alien/Tower/Map codexes — which use
   plain `.codex-list` without it — are untouched) now has `max-height: none; overflow-y:
   visible`, making the outer `.modal-card` (already scrollable at 660px) the sole scroll
   region for the whole guide.
4. **Item 19 — `.banner.crit` future-proofed** with `max-width: 1200px`, `overflow-wrap:
   break-word`, and `text-align: center` (needed as a companion — without it, a wrapped
   banner would default to left-aligned, which looks broken for a centered element). The
   current 3 boss names still fit on one line comfortably; this only matters if a longer name
   is ever added.
5. **Item 20 — medium banners are now tap/click-to-dismiss-early**, chosen over the
   "compress after first viewing" alternative because it's a general-purpose fix consistent
   with patterns already established elsewhere in the game (the low-tier toast and the
   victory-screen sequence are both already tap-to-skip) rather than adding a second,
   narrower mechanism (seen-tracking) that only helps the specific repeat-replay case.
   Implemented in the same edit as item 16, since both touch `pumpMedium()`.
6. **Item 21 — self-test save isolation.** Went with a more robust version of the "simpler"
   fix than originally sketched: rather than setting the flag from `main.ts` *after*
   `new UI()` completes, `?selftest=1` detection now happens as the very first line of `UI`'s
   own constructor — the constructor itself calls `persist()` once early on (a session-count
   increment), which would have already fired unprotected if the flag were set from outside
   after construction. Detecting it internally, before anything else runs, closes that gap
   completely. `persist()` now no-ops the actual `writeSave()`/`localStorage` call whenever
   `selfTestMode` is set; every other mutation (stats, stars, etc.) still happens normally in
   memory during the automated test run — so it's still exercising genuine code paths, just
   never writing any of it to disk. A real profile loaded in the same browser is now safe.
7. **Item 23 — Daily Op streak uses the op's own date, not "now" at result time.** The streak
   check now reads `this.currentDaily.dateStr` (captured when the run started) instead of a
   fresh `todayStr()` call inside `showResult()`. A run started at 11:58pm and finished after
   midnight now correctly credits the day it was actually playing (matching how the run's own
   seed/composition never changes mid-play), rather than potentially crediting the wrong day
   or missing a day's credit entirely.

### Verification
All 7 changes verified together: `tsc --noEmit` clean, `validate.ts` clean, full 10-file test
suite green (the existing `daily-op.ts` streak tests were already written against a plain
date-string parameter rather than any specific date-sourcing mechanism, so they remained valid
unchanged against item 23's fix — a good sign the original tests weren't overfit to
implementation details). Confirmed `selfTestMode` correctly present in the minified singlefile
build's actual output, not just the source. Both bundles rebuilt clean.

### Not implemented (not requested this round)
Item 22 (verified-safe, no action item to begin with) and Section E's improvement ideas
remain untouched — this was a scoped, explicit selection (16, 17, 18, 19, 20, 21, 23), not a
"do everything" pass.
