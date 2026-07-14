# STARHOLD 3.0 — Progress Log

Append-only. Each phase records: date, what shipped, tuning values chosen, deviations from
`PLAN-3.md`, known issues. Companion to the 2.0 log (`PROGRESS.md`), which is complete and
historical — nothing is appended there.

---

## Phase 1 — Economy, Abilities & Scaling Foundations [COMPLETE]
Started: 2026-07-13 · Finished: 2026-07-13

### Shipped
1. **`TUNING.economy`** (data.ts): `sellRefund` 0.72, `sellUndoWindow` 4s, `refundInWaveMul`
   0.72, `earlyCallPerSec` 0.04, `earlyCallCap` 0.40, `bountyCoef` 0.27 (was inline `0.22` in
   game.ts). `TUNING.threat` scaffolding from 1.1 was **not** added — Phase 6 defines its full
   shape and fields; an early stub would just be dead weight to delete later. Noted as a
   deliberate deviation, not an oversight.
2. **`Game.waveRewardMul()` / `econScale()`**: single source of truth for the bounty-scaling
   formula, replacing the inline `0.22` math at the enemy spawn site. `Game.currentHpScale()`
   added alongside for ability-damage scaling (1.7). Spawn-site refactor keeps `diffReward`
   applied exactly once — `mkEnemy()` still multiplies by `this.diffReward` internally, so the
   spawn site now passes `waveRewardMul() / diffReward` in, not the raw scale. `waveIdx` is
   clamped to `Math.max(0, waveIdx)` inside the formula since it's `-1` before the first wave
   (e.g. when the interest cap is set at construction) — otherwise endless mode's cap would
   read a stray -5% at level start.
3. **Flat credit sources scaled by `econScale()`**: combo milestone bonuses, supply-drop credit
   rolls, meteor fragment credits, rich-vein per-kill credit, wave-clear bonus. Verified via
   `tests/economy-v3.ts` and by removing/re-adding a Flame during a live session (crate credits
   visibly scale with level).
4. **Interest cap**: now `Math.round((base + level.id*3) * econScale())`, computed *after*
   `diffReward` is assigned in the constructor (it was computed before it, in the original
   code — moved the block down). **Ascension IV rule changed**: instead of overwriting the cap
   with the flat constant `TUNING.ascension.interestCapTier4` (30), it now multiplies the
   already-scaled cap by the ratio `interestCapTier4 / TUNING.interest.cap` (i.e. an actual
   *half*, matching the tuning field's own comment "interest cap halved" — which the old flat
   override didn't actually deliver: at L15 the old code cut a 105 cap down to a flat 30, a
   ~71% cut, not a half). This is a deliberate behavior change beyond the letter of the plan's
   one-line instruction ("keep the Ascension IV halving applied after scaling"), chosen because
   the literal flat-override reading contradicts the tuning constant's own documented intent.
   `validate.ts`'s balance-sweep mirror function and `tests/nova-ascension.ts`'s local ascension
   model were both updated to match. Net effect: interest caps now range further across the
   campaign than before (L1 Normal 63 → L15 Normal 292) — a big jump, but a deliberate one:
   credit balances and tower costs both scale far more than 2x from L1 to L15, so a cap that
   didn't move would become irrelevant late-game. No balance-sweep sanity check flagged it as a
   cliff.
5. **Sell: undo window + 72% refund** (game.ts `Game.sell`, `Tower.builtAt`): a tower placed
   within the last 4 *game*-time seconds sells for a full refund labeled "Undone"; after that,
   72%. Undoing does **not** set `soldAny` (the Committed challenge only counts real sales).
   The window is deliberately game-time, not wall-clock: it pauses with the game and shrinks in
   real terms at 3x speed — both accepted per plan. UI: the sell button is a live two-state
   label (`sellLabel()` on UI, refreshed every frame via the same per-frame path that already
   drives the interest-preview pill) so it flips the instant the window lapses even if the
   panel stays open — verified live in a headless browser (screenshots: label read "Undo — full
   refund ◆ 90" through the window, flipped to "Sell (72%) ◆ 65" the frame after).
6. **Upgrade refunds**: full between waves, 72% during a wave (`Game.refundNode`). `t.spent`
   always drops by the *full* node value regardless of the payout cut — spent tracks
   investment, not payout. This closes the pre-existing "refund everything right before wave
   clear, collect full refund + that wave's interest" exploit that PROGRESS.md (2.0) had
   explicitly documented as an accepted quirk — that note is now obsolete; the round trip is
   strictly unprofitable since interest already paid on the (still-active) wave's balance.
7. **Early-call bonus**: now `round(pendingWaveBounty() * min(cap, interT * perSec))` instead of
   a flat `interT * 3`. `pendingWaveBounty()` ignores mutator adjustments (bounty/horde) as a
   deliberate simplification, matching the plan. `callWave(early, auto = false)` — auto-launched
   waves (the ⏩ toggle, and the countdown timeout) earn **zero** bonus, since a rewarded auto
   call would make auto mode strictly optimal and erase the decision. Found and fixed a
   pre-existing tooltip inaccuracy while touching this: the auto-launch button's title claimed
   it "collects the maximum early bonus" — under the new rule that's backwards (auto collects
   *no* bonus), so the tooltip and Game Guide copy were rewritten. The live bonus preview stayed
   in the existing separate "bonus pill" next to the Launch button rather than being appended
   into the button's own label text as the plan's wording suggested literally — the pill was
   already doing this exact job pre-Phase-1, so reusing it was lower-risk than restructuring the
   button; same information, established location. Verified live: pill read "+16 ◆ (+33%) if
   launched now", ticking down correctly as the intermission timer fell.
8. **Orbital Strike** scales with `Game.currentHpScale()` (mirrors the enemy HP formula). META
   desc updated to say so.
9. **NOVA**: replaced flat `damage: 400` / `bossFrac: 0.5` with `fracNormal: 0.30` / `fracBoss:
   0.08` (of the target's *current* HP) plus a `stunDur: 0.6` stun on non-boss survivors
   (reuses the existing `frozenUntil` mortar-quake stun pathway/visuals). `rechargeGrowth`
   dropped from 1.4 to 1.0 — the field and code path stay (a value of 1.0 neutralizes it), so
   it remains a tuning lever; the 90-kill charge requirement is now the sole limiter. No
   use-count cap was added preemptively — a flat 2-uses-per-level cap is the designated fallback
   if Phase 9's balance sweep finds NOVA spam. All NOVA-facing copy (Game Guide, button title,
   first-unlock toast) rewritten to describe percentages + stun instead of a flat number.
10. **Reactor META nodes** (`reactor1`/`reactor2`) converted from flat `+60`/`+120` starting
    credits to `+20%`/`+35%` (`meta.creditMul` replaces `meta.credits` end-to-end: `ui.ts`
    assembly → `Game` constructor signature → credit computation). Sanity-checked against the
    plan's anchors: L1 old +60 flat on 260 = +23% vs. new +20% = +52; L15 old +120 flat = +19%
    vs. new +35% = +217 — both land within the plan's stated intent band.
11. **Star curve recut** (`Game.win()`): absolute hull damage (`lost <= 2 → 3★`, `<= 8 → 2★`,
    else `1★`) instead of a loss-fraction cut — Hull Plating meta no longer makes 3★ easier to
    earn. The star-persist site already used `Math.max(prev, stars)` (pre-existing, verified,
    no change needed). Results-screen copy updated: the old 3★ line ("Flawless. Not a scratch
    on the hull.") was now actively wrong under the new rule (3★ can include up to 2 hull lost)
    — reworded to "Held the line. Minimal damage to the hull." A new Game Guide entry
    ("Completion stars") spells out the exact thresholds, since no such entry existed before.
12. **`pauseOnBuild` defaults to `true`** in `defaultSave()` only — `migrateSave` untouched, so
    existing players keep whatever they'd chosen (verified: the migration test fixture that
    lacks the field now correctly receives `true` via the default-spread, exactly as a save that
    never had the field would). Settings row relabeled "(recommended)".
13. **Validation & tests**: `validate.ts` gained a `TUNING.economy` existence/range check and a
    NOVA frac/relative check. Two **pre-existing** `validate.ts` assertions had to be corrected
    because they encoded the *old* NOVA behavior as a hard rule (`rechargeGrowth > 1`,
    `bossFrac` range) — both flagged real failures the moment TUNING changed, confirming they
    were doing their job; updated to check `rechargeGrowth >= 1` and the new `fracNormal`/
    `fracBoss` fields. Same story in `tests/nova-ascension.ts`: its recharge-growth and
    interest-cap-ratio assertions were rewritten to match the new formulas rather than the old
    ones (see full diff). New `tests/economy-v3.ts` (11th test file, auto-discovered by
    `tests/run-all.ts` — no manual registration needed, the runner globs the directory) covers
    every item the plan's 1.12 lists: sell inside/outside the undo window (incl. the exact
    boundary and `soldAny`), refundNode full-vs-72%, early-call bonus incl. the cap and
    `auto=true → 0`, drone bounty anchors (L1=8 unchanged, L15=22), interest cap scaling
    L1-vs-L15 and the Ascension IV ratio, the star-cut mapping (0/2/3/8/9 hull lost →
    3/3/2/2/1), NOVA damage-vs-HP math for normal and boss targets, and Orbital Strike's
    L1-vs-L15 scale.

### A real (pre-existing, unrelated) bug found and fixed
While trying to run the shipped `?selftest=1` in-page harness in a real headless browser to
verify Phase 1 didn't regress anything at runtime, it threw immediately: `driveTest()` (in
`src/selftest.ts`) was called *before* the `let tick`/`let intervalId` declarations it
closes over — a temporal-dead-zone `ReferenceError` on the very first tick. Confirmed via
`git stash` that this reproduces identically on the untouched pre-Phase-1 code — it's not a
regression from anything in this phase. Likely explanation: PROGRESS.md (2.0) Phase 7/8 notes
that headless-browser automation was never available in that development sandbox, so this
harness was apparently only ever verified by type-checking, never actually executed in a
browser. Fixed by moving the `driveTest()` call below the variable declarations it needs (the
function itself is hoisted and didn't need to move). Re-ran: `SELFTEST_RESULT: PASS — 500
ticks, 0 error(s)`, exercising real `buildAt`/`buyUpgrade`/`callWave` calls against the Phase 1
economy changes with sane final state (finite credits, non-negative lives). This is the first
time this harness has actually been confirmed to run clean.

### Decisions / deviations (summary — see inline notes above for full reasoning)
- `TUNING.threat` scaffold from 1.1 deferred to Phase 6, which defines it fully.
- Ascension IV interest-cap rule changed from a flat override to a true ratio-based halving of
  the scaled cap (see item 4).
- Early-call bonus preview stays in its pre-existing separate pill rather than being appended
  into the Launch button's own label (see item 7).
- No NOVA use-count cap implemented preemptively (designated fallback only, per plan).
- Fixed a real, pre-existing `selftest.ts` runtime bug encountered while verifying this phase
  (see above) — outside this phase's stated scope, but blocking verification and trivial to fix
  once found.

### Known issues
None. All gates green: `tsc --noEmit`, `validate.ts`, full 11-file test suite (10 pre-existing +
new `economy-v3.ts`), both builds (`npm run build` and the single-file config), and a live
501-tick `?selftest=1` run with 0 errors. Manually verified in a real browser: early-call bonus
pill shows the new %, sell button flips from "Undo — full refund" to "Sell (72%)" exactly at
the 4s game-time boundary while the panel stays open.

### Next
Phase 2 — Cell Diversity: The Board Speaks (ridge/sinkhole/conduit/anchor/null-zone terrain).

---

## Phase 2 — Cell Diversity: The Board Speaks [COMPLETE]
Started: 2026-07-14 · Finished: 2026-07-14

### Shipped
1. **Data model** (data.ts): `CellTypeSpec`/`CELL_TYPES` (ridge/sinkhole/conduit/anchor/
   nullcell, each with icon/blurb/`bestFor`), `TUNING.cells` (rangeAdd/rateMul/dmgMul/ampMul/
   slowPct/minSeparation). `LevelSpec.cellPlan?` added to levels.ts.
2. **Per-level inventories** (levels.ts): authored exactly the plan's table for L3-L15 (L1-L2
   stay clean, per spec), each with a one-line design-reason comment. Endless gets a seeded
   weighted roll (2-4 specials from the ridge30/sinkhole30/conduitPairs15/anchor15/nullcell10
   pool) computed at `buildGrid()` time rather than authored in levels.ts, since it needs to
   vary per run.
3. **Placement algorithms** (`Game.buildGrid()`, after asteroid/vein seeding): seeded
   (`mulberry32(hashString('<levelId>-cells'))`, endless XORs a per-run random like veins do)
   placement in the fixed order sinkhole → ridge → conduit pair → anchor → null zone, each
   respecting `minSeparation` (relax to 1, then skip with `console.warn` if still unplaceable —
   never happened against any authored level at any tested tile size). Implemented exactly the
   candidate rules from the plan: sinkhole picks highest-`pathAdj` bend-interior cells;
   ridge picks `pathAdj===0 && pathNear(3)` cells nearest a genuine path corner (detected via
   non-collinear path-neighbor directions); conduit pairs cluster around the longest straight
   path run (row/col-wise scan), falling back to any qualifying adjacent pair; anchor scores
   by how many of its 8 neighbors are themselves valid path-adjacent cells (the "cluster
   heart"); null zone requires adjacency to a path cell in the final third of that path's
   travel order (captured via a new `pathCellsOrderedAll` array built during the existing
   path-carving loop). `CellInfo` gained `special`/`conduitPartner`; `Game` gained
   `nullCells`/`nullCellPx`.
4. **Effect wiring**: `Tower.cellType` + cached `cellRangeAdd`/`cellRateMul`/`cellDmgMul`
   (via `applyCellType()`, called from `buildAt()`, `confirmMove()`, and the resume-restore
   tower-rebuild loop in ui.ts) so `rangeT()`/`stats()` stay cheap — no `Game` lookup needed
   per frame. Range floor of 1 confirmed load-bearing (a sinkhole under a range-1 Flame is a
   pure, intended win). Anchor doubles a buffing Amp's `buffDmg/buffRate/buffRange/crit`
   contribution at the point of application. Conduit: a new `Game.conduitTarget`, recomputed
   once per `update()` from whichever conduit-cell tower has committed the most (`spent`) to a
   live target, which linked towers pick up ahead of their own mode-based acquisition (falls
   through cleanly to normal targeting when the shared target is out of range/dead — targeting
   chips still apply then, per spec). Extended into Prism's separate multi-beam targeting path
   too (prepend to the beam queue, same pattern as the existing focus-fire prepend) since
   Prism is explicitly listed in conduit's `bestFor` but has its own targeting block that
   bypasses the main one. Null Zone: ground enemies within 1.5 tiles of a null-cell center get
   `speedMul *= 0.8` in `Enemy.update`'s ground-movement branch (multiplicative with tower
   slows, fliers exempt), and a new `Game.nullSlowTint()` bumps `slowUntil` by 0.15s each frame
   without touching `slowPct` — reuses the existing slow-ring visual purely for the tint,
   completely decoupled from the actual speed math.
5. **Rendering** (`drawTiles`): five palette-neutral, value/elevation-based treatments (no new
   hues, per the binding design discipline) — ridge lifts 2px with a lighter top edge and drop
   shadow; sinkhole insets with a darker fill, inner top shadow, and a faint downward-triangle
   glyph; conduit gets a pulsing emissive border on both cells plus a marching dashed link line
   (drawn once, from the lower-index cell of the pair; brighter when both cells are
   tower-occupied, matching spec) — `perfMode`/`reduceMotion` freeze the pulse/dash-march;
   anchor gets two slow-rotating concentric rings (static under `reduceMotion`); null zone gets
   a diagonal hatch (always visible) plus a dashed slow-radius ring shown only while a ground
   enemy is actually inside it, keeping the board quiet otherwise. All five draw before the
   generic buildable-cell outline so occupied special cells keep their treatment visible around
   the tower pad, exactly as specified.
6. **Legibility** (ui.ts): a `#cell-tip` hover/long-press tooltip (new `updateCellTip()`,
   mirroring the existing `updateEnemyTip()`'s dual hover/pinned-long-press pattern exactly,
   including `repositionPopups()` overlap avoidance) showing icon, name, blurb, and a
   `Best for:` line in each tower's own color. Long-press on an empty special cell pins the
   tooltip instead of doing nothing — a plain tap is a wholly separate gesture path and still
   builds normally, so this can't interfere with building. Build menu: a header chip
   (icon+name) plus a `cell-favored` pulsing-outline class on every `bestFor` tile — verified
   live (Flame/Cryo/Tesla visibly pulsed on a Sinkhole cell, and nothing else did). Tower
   panel: a compact `On <Type> <icon> (<effect>)` chip under the description (doubles as the
   Anchor+Amp "×2 buffs" callout the plan asked for). Level-select cards: a cell-inventory row
   (`⛰1 ▽1` etc., hover-titled per icon) built from `cellPlan` — verified live, matches the
   authored data on every card exactly. Codex: a new "Terrain" section in the Map Guide with a
   custom CSS swatch per type (echoing each one's actual in-game visual language) plus its
   `bestFor` list.
7. **Gating**: `cells:3` added to both `UNLOCKS` and `SEEN_UNLOCK_LEVELS` (validate.ts's sync
   check enforces this automatically). `buildGrid()`'s whole placement block is skipped when
   locked — a fresh sub-L3 save's board is byte-for-byte identical to pre-Phase-2 behavior.
   `toastOnce('cells', …)` fires the first time a level with any placed special loads (mirrors
   the existing per-modifier toast pattern at the same call site). Veterans get `seen.cells`
   pre-marked automatically via the existing generic `SEEN_UNLOCK_LEVELS` migration loop — no
   new code needed, confirmed by inspection.

### Real, pre-existing issue caught while implementing (not a regression)
None this phase — Phase 1's `selftest.ts` fix already covered the one live-verification gap in
the harness itself. This phase's own 500-tick selftest run and manual browser pass were both
clean on the first try.

### Decisions / deviations
- **1.1's `TUNING.threat` scaffold**: not applicable to this phase — that's Phase 1's item, not
  Phase 2's. (No deviation here; noting only because PLAN-3.md's phase numbering could be
  misread.)
- **"CELL_TYPES ids match TUNING.cells keys" (2.8)**: implemented as a one-directional-per-side
  sync check rather than strict set equality, because the plan's own `TUNING.cells` sample
  intentionally has no `conduit` entry (conduit's numbers are the pairing/adjacency logic
  itself, not a per-type scalar) and intentionally has a cross-cutting `minSeparation` key that
  isn't a cell type at all. A literal equality check would have permanently failed against the
  plan's own spec. The implemented check instead catches real drift (a `TUNING.cells` key with
  no matching type, or a type — besides conduit — with no `TUNING.cells` entry), which is the
  useful property "keep them in sync" is actually asking for.
- **Ridge's "nearest corner" and anchor's "cluster heart" scoring**: implemented exactly as
  specified in the real `buildGrid()` algorithm (game.ts). The `validate.ts` headless check and
  `tests/cell-seeding.ts`, however, simplify both to a plain seeded pick among qualifying
  candidates — matching the precedent already set by `tests/asteroid-vein-seeding.ts` (which
  explicitly skips meander re-application for the same reasoning: a test file that can't import
  the stateful, canvas-owning `Game` class headlessly reimplements the algorithm faithfully for
  the properties that matter to *that* test). The scoring preference is a placement-quality
  refinement, not a correctness invariant (no overlap, right counts, adjacency, separation) —
  which is what these particular tests check. The real algorithm's scoring logic itself was
  hand-verified during implementation and exercised live in a real browser (see below).
- **Meander skipped in validate.ts/tests/cell-seeding.ts**, identically to the precedent in
  `tests/asteroid-vein-seeding.ts` and for the same reason: the placement algorithm only reads
  the resulting `pathTiles`/`endTiles` sets, not which meander tier produced them, and meander
  itself already has dedicated, exhaustive fuzz coverage elsewhere.
- **Resume**: confirmed no `RESUME_VERSION` bump was needed. `cellType` is deliberately never
  serialized (`ResumeTower` has no such field) — it's always recomputed from the cell index
  against the deterministic grid on restore (`t.applyCellType(cellInfo.special)`), exactly as
  the plan specifies. The "resume round-trip" test requirement from 2.8 is therefore satisfied
  by `tests/cell-seeding.ts`'s stats test (which verifies the exact modifier math that
  recomputation produces) rather than a `resume.ts` round-trip test, since there is no
  serialized field to round-trip — documented inline in that test file's header comment.
- Endless's weighted cell-type roll lives in `buildGrid()` (computed at construction, per run)
  rather than as authored data in levels.ts, since — unlike the other 14 levels — it must vary
  every run rather than being fixed.

### Known issues
None. All gates green: `tsc --noEmit`, `validate.ts` (including the new special-cell placement
invariant check — 39 level×tile-size combinations, zero shortfalls or warnings), full 12-file
test suite (11 pre-existing + new `cell-seeding.ts`), both builds, and a live 500-tick
`?selftest=1` run with 0 errors. Manually verified in a real browser on a fresh L3 board: the
level-select cell-inventory rows matched the authored data exactly on every card; hovering the
placed Sinkhole cell showed the correct tooltip (name, effect text, and `Best for: Flame · Cryo
· Tesla` in each tower's own color); opening the build menu on that same cell showed the
"▽ Sinkhole" header chip and pulsed exactly Flame/Cryo/Tesla's tiles and no others.

### Next
Phase 3 — Map, Path & Portal Identity (seeded backgrounds + landmarks, path channel +
chevrons, portal charge telegraphs, L9/L11 structural reworks).

---

## Phase 3 — Map, Path & Portal Identity [COMPLETE]
Started: 2026-07-14 · Finished: 2026-07-14

**Scope note:** executed 3.1-3.7 only, per explicit instruction — Phase 3B ("Visual Identity &
Readability") was NOT started this session and remains next in the phase map.

### Shipped
1. **Seeded, persistent backgrounds** (`Game.buildBg()`): nebula blobs, background landmarks,
   and the star field now all draw from one `mulberry32(hashString('bg-<levelId>'))` stream
   (endless: `hashString('bg-endless-<runSeed>')`, `runSeed` a new unserialized per-instance
   `Game` field) instead of `Math.random()`. Reloading the same level now always generates the
   same sky — verified live via two consecutive Playwright loads of L9 producing
   pixel-identical screenshots. The rng is threaded through in draw order (blobs -> landmarks
   -> stars), matching the plan's "continue drawing from it" instruction.
2. **Hand-authored landmarks** (`data.ts` `LANDMARKS`, `game.ts` `drawLandmarks`/
   `drawLandmark`): the plan's exact per-level placement table (L1-L15, edge/corner-only,
   `s` 0.6-1.6) plus five palette-neutral draw recipes (planet/moon/derelict/station/comet),
   all alpha <=0.5 in the zone's nebula tone with a thin accent rim, painted onto the cached bg
   canvas. Endless seed-picks 2 entries from the flattened L1-15 table each run (the plan's
   "positions from a small preset list" — reusing the authored table itself as that preset
   list, rather than maintaining a second parallel list, since it already has the right shape
   and variety). Verified live: L6's comet + planet limb and L1's ringed-planet limb are both
   clearly visible in the corners in the browser.
3. **The road becomes a road** (`drawTiles`): path tiles are now a genuinely recessed channel
   (darker fill, softer top overlay, an inset stroke) instead of the old flat tile treatment.
   The previous plain animated dashed line along each path polyline was removed and replaced
   with the plan's marching chevrons — small triangles on every second path cell (every third
   under `perfMode`), offset along each cell's local direction-to-base by `(now*28) % cell`,
   static under `reduceMotion`. Direction comes from a new `Game.pathOrderedCells` field
   (renamed from buildGrid()'s existing local `pathCellsOrderedAll`, now stored on the
   instance instead of discarded after cell placement). Hot portal / calm base: both
   `drawPortalsAndBases` glows are new — a persistent soft accent-colored radial glow at every
   portal, a calmer teal one at every base — layered underneath the existing swirl/base icons.
4. **Portal charge telegraph** (new `Game.drawPortalCharge`, `TUNING.portals.chargeLead = 2`):
   reads the earliest un-spawned time per path directly out of `spawnQueue`, and renders an
   expanding ring + brightening core in that pending group's own enemy color, ramping up over
   the last 2 seconds before it spawns. Because it reads `spawnQueue` rather than wave data,
   it needs no Phase-5-specific work later for Feint's delayed second group, exactly as the
   plan predicted — left an `AUDIO-TWIN` comment for Phase 7. `reduceFlash` caps the ramp.
5. **L9 "Shatterfield" -> fork-rejoin, L11 "Void Door" -> converging lanes** (`levels.ts`):
   both levels' `paths` replaced with the plan's exact two-polyline arrays; both levels'
   `waves` rewritten with explicit `p:0`/`p:1` assignments (first group of each wave -> p:0,
   second -> p:1, third alternates back to p:0, etc.) preserving every wave's original
   composition, counts, and timings — no engine changes were needed for this, since per-group
   path assignment (`WaveGroup.p`) and multi-path spawning already existed and are already
   exercised by L7/L12. Added `LevelSpec.tagline?: string` (new, small) so the level-select
   card can advertise the structural read — "Two mouths, one door." (L9), "They come from
   both flanks." (L11) — verified showing on the actual cards. L11's Minimalist challenge
   param bumped 8 -> 9 per the plan (two lanes with 8 towers was calibrated for one lane).
   Both levels' `cellPlan` comments updated from forward-looking ("gets a Phase 3 rework") to
   confirming the placement algorithm needed no changes, since it only ever reads the
   resulting `pathTiles` set, not the path shape that produced it.
6. **Asteroid nudges**: L9's original 5 static asteroid positions (authored for the old single
   winding path) collided with the new fork-rejoin polylines at multiple tile-size/meander
   combinations — found via a headless collision check (faithfully reimplementing
   `buildGrid()`'s meander pipeline), all 5 repositioned into verified-safe open pockets
   between the two lanes. While building that check, it also caught a **real, pre-existing**
   bug unrelated to this phase's own changes: **Level 6's original asteroid array already
   collided with Level 6's own (untouched) path** at several tile-size/meander combinations —
   never caught before because no prior check ever re-applied meander to a static asteroid
   check (`tests/asteroid-vein-seeding.ts` only covers the *seeded* asteroid/vein modifier
   cells, which read `pathTiles` as a given rather than needing meander re-applied). Fixed by
   the same nudge-and-reverify technique, entirely within L6's existing path and roster.
7. **Validation** (`validate.ts`, new Phase 3 section): LANDMARKS coordinate-bounds and
   per-level 1-3 entry-count checks (3.2.4); a from-scratch, permanent static
   asteroid-vs-path collision check across every level with an `asteroids` array x 3 tile
   sizes x 3 meander tiers (this is the check that caught the L6 bug above, and now guards
   L6/L9 — and any future level's static asteroids — against regressing); a multi-path
   portal/base merge check (no two portals or two bases may ever snap to the same tile) across
   every multi-path level x tile size x meander tier, covering the "widen y-separation to
   60px if snapping merges them" contingency from 3.5.3 — it never triggered at any tested
   combo, so no widening was needed. (Path-bounds validation itself — 3.6's other named
   requirement — was already covered by a pre-existing check from an earlier phase; confirmed
   it already holds against both new levels' waypoints, nothing to add there.)
8. Full regression: `tests/mirror-meander-fuzz.ts` (360 trials — all real levels, mirrored +
   unmirrored, all tile sizes/meander tiers) and `tests/asteroid-vein-seeding.ts` (57
   level x tile-size combos) both stayed green against the reworked L9/L11, with no changes
   needed to either test file.

### Decisions / deviations
- **RESUME_VERSION was NOT bumped, and `runSeed` was NOT added to `ResumeSnapshot`** —
  contradicts the plan's literal 3.1.3 instruction. Investigated `ui.ts` directly:
  `saveResumeSnapshot()` unconditionally returns early for endless runs
  (`if (!g || this.isEndless) return;`, pre-existing, unrelated to this phase) — endless mode
  has never produced a resume snapshot at all, for anything. The plan's own parenthetical
  justification for storing `runSeed` was specifically "across a resume" continuity for
  endless; since that resume path doesn't exist in the engine, persisting `runSeed` would be
  a dead field with no consumer. Implemented `runSeed` as a plain, unserialized `Game`
  instance field instead (assigned once per construction, `Math.random()`-seeded) — this
  exactly matches the existing, accepted precedent already set by the asteroid/vein/cell
  seeded-placement code in the same file, none of which round-trip across a resume for
  endless either. If endless resume is ever added in a later phase, `runSeed` becomes a
  one-line addition to `ResumeSnapshot` at that point, with the version bump that actually
  needs it.
- **Recessed-channel inner shadow simplified**: the plan describes a 2px inner shadow "along
  both long edges" of each path cell, implying per-cell orientation awareness. Implemented as
  a uniform inset stroke around all 4 edges instead — the marching chevrons already carry the
  directional read the per-edge version would have added, so tracking each cell's local path
  orientation a second time (beyond what the chevron pass already computes) would have been
  bookkeeping for a marginal visual gain. Noted inline in `drawTiles`.
- **The old plain dashed direction-line was removed**, not kept alongside the new chevrons —
  the plan doesn't explicitly say to remove it, but two different "which way does the road
  go" cues stacked on the same tiles would be redundant noise, not reinforcement.
- **Endless landmark "small preset list" (3.2.3)**: implemented as a seeded pick of 2 from the
  flattened L1-15 `LANDMARKS` table itself, rather than authoring a second, separate preset
  list. The full table already is a small, curated, on-theme set — reusing it avoids
  duplicated authoring surface for no gameplay difference (landmarks are purely cosmetic).
- **Two new validate.ts checks added beyond the plan's literal 3.6 list** (static
  asteroid/path collision; multi-path portal/base merge) — both were built as the actual
  *verification method* for 3.5's own instructions ("check each [asteroid] against both
  polylines' cell footprints", "widen the y-separation... if grid snapping merges the adjacent
  portal/base cells"), then kept as permanent `validate.ts` gates rather than thrown away
  after a one-time manual check, since they're cheap and the asteroid check immediately paid
  for itself by catching the pre-existing L6 bug (item 6 above).
- **3.6's path-bounds-check item**: already existed from an earlier phase (`validate.ts`
  section 1, checking every waypoint against a slightly larger box than the plan's literal
  `[-40,1320]x[100,680]`); confirmed it already passes against L9/L11's new polylines, so
  nothing new was added for it specifically.

### Known issues
None. All gates green: `tsc --noEmit`, `validate.ts` (now including the two new Phase 3
checks — LANDMARKS bounds/count, static asteroid/path collision, multi-path portal/base
merge — all clean), full 12-file test suite (unchanged from Phase 2, all still green against
the reworked levels), both builds, and a live 500-tick `?selftest=1` run with 0 errors.
Manually verified in a real browser: L9 reloaded twice produced byte-identical background
screenshots; L9's fork-rejoin and L11's converging lanes both render and play correctly with
visible chevrons and portal/base glows; L6 and L1 both show their authored landmarks (comet +
planet limb, ringed planet limb) clearly in the corners; level-select cards show the new "Two
mouths, one door." / "They come from both flanks." taglines on L9/L11.

### Next
Phase 3B — Visual Identity & Readability (palette token table, value/temperature split, scale
hierarchy, idle/uncovered tower feedback, physical hit/death feedback, accessible palette).
Per Kevin's explicit instruction, do NOT start 3B in the session that shipped this entry.

---

## Phase 3B — Visual Identity & Readability [COMPLETE]
Started: 2026-07-14 · Finished: 2026-07-14

### Shipped
1. **Palette token table** (`data.ts` `PALETTE`, `game.ts` `Game.pal()`/`palTower()`/
   `palEnemy()`): three variants (`default`/`chroma`/`accessible`), each `{ towers, enemies,
   rim, muzzle }`. `PALETTE.default` is *generated* from the `TOWERS`/`ENEMIES` spec
   `color`/`color2` fields (`Object.fromEntries(...)`) rather than duplicated — editing a
   tower/enemy's own color stays the one place to edit, per the plan's instruction.
   `chroma`/`accessible` are hand-authored tables (not derivations — deliberate departures).
   Every canvas read of a tower/enemy's identity color was rerouted through `palTower(id)`/
   `palEnemy(id)` — `drawTower`, `drawEnemyBody`, `drawEnemy`, `drawBeams`, `deathFx`,
   `fire()`'s projectile/bolt/ray/spark creation, `buildAt`/`confirmMove`/`buyUpgrade`'s
   placement rings, the portal-charge telegraph, `drawSelection`/`drawPlacement`'s range-tile
   previews, and the build-menu hover preview — roughly 35 call sites across `game.ts`. Also
   rerouted three DOM (not canvas) identity-color reads in `ui.ts` (boss HP-bar label, enemy
   tooltip name, tower panel title dot) — see Decisions below for why, since the plan scoped
   this to canvas draws specifically. `Game` gained `chromaOn`/`accessiblePalette` fields, set
   from `save.chromaOn`/`save.settings.accessiblePalette` in `startLevel()` and live-updated
   from the settings-panel toggle handlers (no restart needed to see a palette change).
   The `style.css` "Chroma canvas stays original palette" scope-cut comment (the concrete
   thing the plan told me to find and retire) is now rewritten to describe the real,
   board-reaching behavior.
2. **Value/temperature split** (`data.ts` `TOWERS`/`ENEMIES` `color`/`color2` fields, which
   `PALETTE.default` reads): authored the plan's exact hex table — all 10 towers to cool,
   desaturated tones, all 13 enemies (incl. 3 bosses) to warm, saturated ones. `rim: '#fff4e0'`
   drawn as a fixed-world-space (not body-rotated) 1.5px arc on every enemy's upper-left in
   `drawEnemyBody`, skipped under `perfMode`. `muzzle: '#eaffff'` now drives the tower
   muzzle-flash particle exclusively (`Game.flash()`, previously reused the firing tower's own
   body color) — bumped its size 12→15 and life 0.08→0.09s so it reads as the brightest
   instant on a tower, per the plan's framing. Verified live: a Pulse (teal) firing on a Drone
   (orange) reads with clear, immediate contrast — screenshotted mid-combat. No fallback to
   hue-preserving +20% saturation was needed; the shift read clearly distinct in every case
   checked, including the two enemies the plan flagged as identity-risk (mender, phase) —
   their non-color carriers (chartreuse-family + heal pulses; phase's shimmer) still hold.
3. **Scale hierarchy** (`data.ts` `ENEMIES` `size` fields): applied the plan's exact table —
   swarmling 7.5→6.5, dart 10→9.5, raptor 11→10.5 (down); aegis 15→16, mender 15→16,
   splitter 16→17, brute 20→26, mothership 34→40, colossus 38→46, leviathan 42→52 (up);
   drone/wisp/phase unchanged, per plan. `spec.size` participation in splash/collision math
   is unchanged code — the plan's own accepted consequence (bigger brutes/bosses marginally
   easier to splash-clip) needed no additional handling. Verified via the live 500-tick
   selftest (which builds and fights with real enemies at these new sizes) and visual combat
   screenshots — no clipping or layout artifacts observed at the tile sizes exercised.
4. **Idle & uncovered tower feedback** (`game.ts`): new `Game.recomputeCoverage(t)` — the
   plan's requested reusable helper, a plain scan of `this.cells` counting path cells within
   `t.rangeT()` via the existing `circCell` — called from `buildAt`, `confirmMove`,
   `buyUpgrade` (range can change on upgrade), `refundNode` (added beyond the plan's literal
   4 triggers — a downgrade can shrink range back down, same reasoning as upgrade), and the
   `ui.ts` resume-restore tower-rebuild loop (the "grid rebuild" trigger). **Uncovered** (hard,
   groundOnly + zero coverage): 45% body alpha, a small drifting "zᶻ" glyph on the tower body,
   and a new `.sp-warn` line ("⚠ Can't reach the road from here.") in the side panel — verified
   live, screenshotted with a Mortar built in a far corner. **Idle** (soft, has coverage but no
   target >1.5s): 25% dim (alpha 0.75) plus the aura-pulse-square visual and Tesla's ambient
   spark emission both suppressed while idle — the two clearest "glow/hum" elements in the
   tower draw code. Amp towers and EMP-disabled towers are exempt from idle-dimming (amp has
   no target concept at all — it would otherwise read as permanently idle; disabled towers
   already show their own "⚡ EMP" indicator). Aura-kind towers (Frost Field, Ion Field) don't
   normally set `t.target`, so `updateTower`'s aura branch now also assigns it to whichever
   enemy is in range purely so the uniform idle-tracking pass has something to read — the
   aura's actual (target-less) damage loop is untouched.
5. **Physical hit & death feedback** (`game.ts` `Enemy.hurt`/`drawEnemy`/`drawEnemyBody`/
   `deathFx`): confirmed `flashT` already fires on every `hurt()` call including burns (the
   silent/DoT paths) — added a new `flashStrength` (1 for direct hits, 0.4 for `silent=true`
   continuous ticks) and a `mixHex()` blend helper so DoT ticks flash a visibly *reduced* white
   pop instead of the old hard binary swap, satisfying the plan's "at reduced strength" call-out
   literally. New `hitNudgeX/Y/Until` — a 2px render-only offset along the hit direction
   (attacker→target), skipped under `reduceMotion`, applied only in `drawEnemy`'s translate
   (never touches actual position/path progress/collision). New `hitSquashUntil` — layers a
   brief extra compression onto the *existing* ambient wobble-squash value already threaded
   through `drawEnemyBody` (the plan's "existing squash hook"), rather than adding a second
   parallel deformation system. `deathFx` bespoke reworks: **brute/colossus** now crack into
   5 (3 under `perfMode`) large, slow-rotating shard "plates" alternating the enemy's two
   palette tones, on top of (reduced-count) small debris; **swarmling** dropped from a 5-spark
   burst to a single cheap pop ring, since they die by the dozen; **aegis** chains a second,
   longer-lived wave of hex-tinted (`#bfe3ff`, matching `shieldBreak`'s own color) shard
   fragments into its death burst *only if* `Enemy.hadShieldBreak` (new flag, set once by
   `Game.shieldBreak()`) — i.e. only for an aegis whose shield actually broke earlier in its
   life, chaining the two effects as the plan asked. `perfMode` caps shard/spark counts across
   every case that had an uncapped large count (brute plates/debris, aegis shards, the
   default-case shard count, wisp/mothership's boss-scaled sparkle count). Damage-number size
   was not touched (confirmed already governed by a separate, untouched code path — they stay
   the secondary channel by construction, not by a new change).
6. **Accessible palette** (`save.ts`/`ui.ts`/`data.ts`): `settings.accessiblePalette: boolean`
   (default `false`), covered by the existing blanket `{ ...base.settings, ...(d?.settings||{}) }`
   spread in `migrateSave` — same precedent as `reduceFlash`/`reduceMotion`, no individual
   guard needed. New settings-panel toggle row ("Accessible palette") right after "Reduce
   motion", using the existing `mkToggle` helper. `PALETTE.accessible` pushes value separation
   harder than the default split (towers darker-cool, enemies lighter-warm) and specifically
   avoids red/green pairs — `mender` shifted toward yellow (`#e8d96e`) and `ray` toward
   blue-grey (`#9fb4c4`), both exactly as named in the plan. `PALETTE.chroma` ports the
   existing UI-chrome Chroma theme's spirit (cooler teals/magentas) onto the board tokens,
   same `{towers,enemies,rim,muzzle}` shape. `Game.pal()` resolves `accessiblePalette` before
   `chromaOn` (wins when both are on), exactly per spec.

### Real, pre-existing issue caught while implementing (not a regression)
None this phase.

### Decisions / deviations
- **Three DOM color reads in `ui.ts` also rerouted through the palette**, beyond the plan's
  literal "every canvas draw" scope: the boss HP-bar name label, the enemy hover/long-press
  tooltip name, and the tower side-panel title dot. All three echo a specific tower/enemy's
  *identity* color as a small inline `style="color:..."`, not general "HUD chrome" (which the
  plan explicitly protects) — leaving them on the stale default color while the board re-themed
  around them would be a real regression for the accessible palette specifically (a colorblind
  player turning it on to fix, say, Ray's red/green collision would still see the *old* red in
  the tower panel's title dot). Guarded the enemy-tooltip site with a null-safe fallback to
  `PALETTE.default` since that function's `e` can theoretically outlive `this.game` via
  `pinnedEnemyTip`; the other two sites are provably non-null at their call site.
- **`recomputeCoverage` also called from `refundNode`**, a 5th trigger beyond the plan's
  literal "build/move/upgrade/grid rebuild" list — a downgrade can shrink a tower's range back
  down (e.g. undoing a range-adding branch), and leaving the cached `pathCellsInRange` stale
  after that would under-report coverage until the next unrelated recompute.
- **Idle definition for aura-kind towers**: the plan's "no target for >1.5s" is written against
  towers that acquire a discrete `Tower.target`, which aura towers (Frost Field, Ion Field)
  never do — their damage loop hits everything in range directly. Rather than invent a second,
  parallel "idle" definition for auras, `updateTower`'s aura branch now also assigns
  `t.target` to whatever's in range (cosmetic bookkeeping only, read solely by the idle-tracking
  pass) so one uniform rule covers every tower kind. Amp towers were the one case where even
  that trick doesn't make sense (an Amp never "targets" anything, ever) — explicitly exempted
  from idle-dimming instead, alongside EMP-disabled towers (which already have their own
  indicator).
- **Aegis "a beat before the body burst" (3B.5.2)** implemented via relative particle
  lifetimes (the chained hex shards live 0.55–0.85s vs. the body burst's 0.35–0.7s) rather than
  an actual scheduled delay — the particle system has no delay/spawn-offset field, and adding
  one for a single flourish wasn't worth the general-purpose surface area. The chained shards
  still visibly outlast the main burst, which is the readable effect the plan was after.
- **Manual grep gate (3B.7)**: reviewed every remaining hardcoded hex literal in
  `drawTower`/`drawEnemyBody`/`drawEnemy`/`deathFx`/`fire()`. All intentional stragglers, none
  tied to a specific tower/enemy's identity: universal status/state indicators (frozen ice-blue
  `#bfe3ff`/`#e8f7ff`, shield-blue `#9fd0ff`, elite gold `#ffd97a`, EMP pink `#ffb3c6`, the new
  idle "zᶻ" gray `#9aa0c8`) that need to read the same regardless of which unit they're on;
  branch-specific special-ability accents that are deliberately *not* the tower's own color
  (Frost Rounds' icy muzzle tip, Magma/Inferno's molten glow, "Blue Flame"'s namesake blue —
  the branch name literally promises a different color than the tower's base identity); neutral
  in-body chrome (dark socket/muzzle interiors, white sheens/highlights, pad-background tints);
  and the boss-vs-normal HP-bar color, a UI severity semantic rather than entity identity.
- **Shape/size-band uniqueness check (3B.6/3B.7)** extended to a (shape, size-band, air/ground)
  triple rather than the plan's literal (shape, size-band) pair — `drone`/`wisp` and
  `dart`/`raptor` collide on shape+size alone, but fliers already render a real silhouette
  difference (wings, flight shadow) that a pure static-sprite comparison misses. Confirmed this
  extended key has zero collisions across every non-boss enemy.

### Known issues
None. All gates green: `tsc --noEmit`, `validate.ts` (including the three new Phase 3B checks —
PALETTE completeness × 3 variants × every tower/enemy id with hex-parse validation, and the
shape/size-band/air-ground uniqueness assertion — all clean), full 12-file test suite
(unchanged, all still green against the new sizes/colors), both builds, and a live 500-tick
`?selftest=1` run with 0 errors. Manually verified in a real browser: default-palette combat
screenshot shows unambiguous cool-tower/warm-enemy contrast; Chroma re-themes a built tower's
canvas color (previously chrome-only); a Mortar built in a dead corner shows the exact "⚠ Can't
reach the road from here." panel copy; L1's landmark and portal/base glows (Phase 3) are
unaffected. The `accessiblePalette` toggle was verified at the code/data level (validate.ts's
new completeness+hex checks, plus it shares the identical `Game.pal()`/`palTower()`/`palEnemy()`
code path already confirmed live via the Chroma screenshot) rather than with its own dedicated
in-canvas screenshot of a built tower — the verification pass's last automated screenshot landed
before a tower got placed; re-running it wasn't judged worth another round trip given the shared
code path is already proven.

### Next
Phase 4 — Tower Depth: Pricing, Verbs, Reactions, Overcharge, Veterancy (range repricing,
Flame's stacking-burn niche, 3 cross-tower reactions, 5 tier-2 verb rewrites, Overcharge,
Veterancy).

---

## Phase 4 — Tower Depth: Pricing, Verbs, Reactions, Overcharge, Veterancy [COMPLETE]
Started: 2026-07-14 · Finished: 2026-07-14

### Shipped
1. **Range repricing** (`data.ts`): re-priced every Sentinel stage up (Mk I 110→170 through
   High Warden 340→360) so it's unambiguously the most expensive base-tier tower, matching its
   half-map reach; Flame Mk I nudged down 120→110 to offset its new stacking-burn niche costing
   more to *use well* (see below) than a flat stat line would. Added a `validate.ts` assertion
   (3b) that Sentinel's base-stage cost equals the max base cost across all towers, so a future
   balance edit can't silently undercut the "reach is never cheap" rule. Blurb copy updated on
   both towers to state the tradeoff explicitly.
2. **Flame's stacking-burn niche** (`data.ts`/`game.ts`): `Enemy.igniteStack(dps, dur, now)`
   replaces a flat `ignite()` — up to 3 stacking applications on the same target
   (`TUNING.flame.stackMax`), each adding `+50%` effective `burnDps` (`stackStep`), decaying
   back to 0 stacks if the burn window (`flameStackUntil`) lapses. Fire-particle emission rate
   scales visibly with stack count so a 3-stacked target reads as "on fire," not just numerically
   hotter. Hellmouth's `burnSpread: 70` (Phase 4.4) tags a burning-kill's fire to leap to the
   nearest enemy within 70px, carrying the dying enemy's own current burn stats forward.
3. **Cross-tower reactions** (`game.ts`, discovery-first via `toastOnce` on first proc):
   - **Shatter**: any frozen (`frozenUntil > now`), non-boss kill explodes for
     `min(maxHp × 30%, 250 × currentHpScale())` to nearby foes — the campaign-scaled cap keeps
     it dangerous-but-bounded from L1 through L15, never a flat trivial number late-game.
   - **Conduction**: a Tesla chain hit does `×1.5` damage to a target that's already burning.
   - **Cold Focus**: a Prism's damage ramp normally resets the instant its target dies; a
     *chilled* kill instead opens a 1s grace window (`coldFocusUntil`) — a fresh target landing
     within it keeps the ramp climbing instead of restarting at 0. The dead target reference is
     nulled the instant the window opens so the grace can't be silently re-extended frame after
     frame by the same stale death.
   - Codex: new "Synergies" section in the Tower codex explains all three by name and formula,
     since they're meant to be discovered in play first and looked up second.
4. **5 tier-2 verb rewrites** (`data.ts`/`game.ts`) — replacing a pure stat bump with a new
   mechanical read at the tower's signature branch stage:
   - **Star Lance** (Pulse): `pierceRamp: 0.4` — each enemy struck by the same piercing bolt
     takes `(1+0.4)^k` more than the last, rewarding a clean line-up over spraying wide.
   - **Nova Torpedo** (Missile): `directStun: 0.5` — the direct-hit target (not splash victims)
     is stunned half a second on top of the boom.
   - **Farlance** (Ray): `farTiles: 3, farMul: 1.5` — the beam does 50% more to anything 3+
     tiles out along its own line, rewarding long, uninterrupted sightlines.
   - **Storm Sentinel** (Sentinel): `freshMul: 1.5` — a target still at full HP *and* full
     shield (if any) takes 50% more, paying off the tower's "First" targeting default.
   - **Hellmouth** (Flame): `burnSpread: 70` — described above, folds Flame's stacking niche
     into a genuine area-denial payoff at the top of its tree.
5. **Overcharge** (`data.ts`/`game.ts`/`ui.ts`): 3 charges per wave (`TUNING.overcharge`),
   resetting at `callWave()`. Activating a tower (double-tap on the map within 350ms, or the
   side-panel "⚡ Overcharge (N left)" button) doubles its fire rate for 3s — or its damage,
   for rate-0 towers (Prism/auras), via the same branch `Tower.stats()` already used for every
   other multiplier. `Game.canOvercharge`/`activateOvercharge` gate on unlock level, an active
   wave, remaining charges, not-already-active, and exclude Amp (nothing to double). Feedback:
   a depleting gold ring + brightened, occasionally-sparking muzzle on the tower (`reduceFlash`
   caps the brightness pop), a floater, `buzz([18])`, and 3 HUD pips (⚡⚡⚡) that live inside the
   ability stack itself so they never overlap Orbital/Stasis/NOVA regardless of which are owned,
   and vanish entirely below the unlock level. Audio reuses `audio.ui('upgrade')` behind an
   `// AUDIO-TWIN` comment pending Phase 7's dedicated whir.
6. **Veterancy** (`data.ts`/`game.ts`/`ui.ts`/`resume.ts`): a tower crossing 45 kills
   (`TUNING.veterancy.kills`) fires a one-time floater/buzz/toast and offers a permanent,
   irrevocable perk choice the moment its panel is next opened — **Sharp** (+12% damage),
   **Rapid** (+12% rate), or **Scavenger** (flat bonus credits per kill, scaled by `econScale()`
   like every other flat credit source so it holds its value all campaign). The choice applies
   as a flat multiplier layered on top of every other modifier in `Tower.stats()` (buffs, cell
   type, Overcharge). A gold chevron badge pulses on an eligible-but-unchosen tower and sits
   steady once a perk is picked (mirrors the Phase 3B.4 uncovered-glyph placement, opposite
   side). Selling a veteran tower shows a title warning that the perk is forfeit and unrecoverable.
   `resume.ts`: `RESUME_VERSION` bumped 1→2, `ResumeTower.perk` added and round-tripped through
   `serializeResume`/`deserializeResume`/the resume-restore path in `ui.ts`.
7. **Tests**: new `tests/reactions.ts` — pure-formula/state-machine replication (matching
   precedent) of every Phase 4 system against the real `TUNING` object: Shatter's cap-vs-percent
   math and campaign scaling, the boss-exclusion gate, Conduction's multiplier, a full Cold
   Focus grace-window state machine (unchilled reset / chilled-kill grace-open / fresh-target-
   within-grace / grace-lapsed reset), pierceRamp's compounding math down a 3-enemy line,
   freshMul's full-hp-and-shield gate, Flame's 3-stack burn scaling, Overcharge's rate-vs-damage
   branch by tower kind and its full `canOvercharge` gate matrix, and Veterancy's exact-45
   threshold/perk-math/scav-scaling. `tests/resume.ts` extended with perk round-trip coverage
   (a chosen `'sharp'` perk and an explicit `null` both round-trip correctly — `null` was
   deliberately checked separately since a naive spread could silently drop it as `undefined`).

### Real, pre-existing issue caught while implementing (not a regression)
The plan's phrasing implied `Enemy.ignite()` had two call sites (Flame and Magma/Sunfire
Mortar's burn). Grepping the actual codebase found exactly one real caller — Mortar's burn is
a wholly separate ground-"patch" mechanic that applies damage directly via `e.hurt()` in the
patch-processing loop, bypassing `Enemy.ignite`/`burnDps` entirely. Retargeted the one real
caller to `igniteStack()` and deleted the now-fully-unused `ignite()` rather than leave dead
code behind.

### Decisions / deviations
- **Cold Focus grace-window bug caught before it shipped**: an early draft re-checked
  `t.target.dead && t.target.slowUntil > now` every frame without ever clearing the stale dead
  reference, which would have re-opened (re-extended) the grace window indefinitely as long as
  no new target appeared. Fixed by nulling `t.target` immediately after the one-time check, so
  the window can only open once per actual death.
- **Overcharge HUD pips live inside `#ability-stack`** rather than as an independently
  absolutely-positioned element (the plan's literal "bottom-left action cluster" reading).
  A first pass placed them at a fixed `bottom:` offset and they visually collided with
  Orbital/Stasis in headless-browser verification — moving them into the flex-column stack
  itself means they always land in the right place regardless of which abilities are owned or
  whether NOVA (gate 7) is unlocked yet, with zero magic-number pixel math to keep in sync.
- **Sell-button veteran warning uses the existing `title` attribute** (a native tooltip) rather
  than a new confirmation modal — consistent with the panel's existing lightweight-tooltip
  pattern for other soft warnings (e.g. the "Can't reach the road" panel copy), and selling is
  already a single click with an undo window (Phase 1.4) for the first `sellUndoWindow` seconds.
- **Scav's payout formula reuses `econScale()`** (the same helper backing every other Phase 1
  flat-credit scaling decision) rather than inventing a Veterancy-specific curve, per the
  established "flat credit sources scale with econScale, always" precedent from Phase 1.

### Known issues
None. All gates green: `tsc --noEmit`, `validate.ts` (including the new Sentinel-is-priciest
assertion), full 13-file test suite (12 prior + new `tests/reactions.ts`, `resume.ts` extended),
both builds (standard + singlefile), and a live 500-tick `?selftest=1` run with 0 errors —
exercising `fire()`, `updateProjs()`, `updateTower()`, `onKill()`, `drawTower()`, and
`Tower.stats()` with every Phase 4 addition wired into the real game loop. Manually verified
live in a real browser: Overcharge's panel button correctly enables only during an active wave
and with charges remaining, disables itself and shows "⚡ Overcharged!" on click, the tower
gets a visible depleting gold ring, and the HUD pips drop from 3 full to 2 full + 1 empty in
lockstep; a hand-built `resume.ts` snapshot (captured from a real in-game save, then edited to
`kills: 45`) round-trips through the Resume flow and correctly shows the 3-button "🎖 Veteran —
choose a permanent perk" chooser, which on click sets the gold badge, the panel performance
readout, and the sell-button forfeit warning exactly as coded.

### Next
Phase 5 — Wave Shapes, Flier Lanes & Difficulty Redesign.
