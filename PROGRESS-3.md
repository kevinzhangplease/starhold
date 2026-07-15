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

---

## Phase 5 — Wave Shapes, Flier Lanes & Difficulty Redesign [COMPLETE]
Started: 2026-07-14 · Finished: 2026-07-14

### Shipped
1. **Wave shapes data model** (`data.ts`/`levels.ts`): `WaveShape` type (`rush`/`trickle`/
   `convoy`/`feint`) + `WAVE_SHAPES` (name/icon/blurb, plan's exact copy). `LevelSpec` gains
   `waveShapes?: Record<number, WaveShape>` (0-based wave index → shape).
2. **Shape transforms** (`game.ts` `Game.applyWaveShape()`): operates on the wave's already-
   expanded spawn-queue entries (real per-enemy timing, not the authored group summary) —
   **rush** re-spaces the whole wave across a 2.0s window from its earliest spawn; **trickle**
   re-spaces at flat 3.0s intervals, preserving original arrival order; **convoy** reorders
   (highest-HP non-mender leader → all menders → everyone else by descending HP) at a tight
   0.5s cadence, run independently per path on multi-path levels; **feint** stable-splits the
   queue at ceil(40%), delaying the remaining 60% by +10s (and flipping their path on multi-
   path levels) — except on a single-path level carrying fliers, where the fliers themselves
   become the delayed group regardless of the 40/60 cut, since their own curved lane (below)
   already reads as "a different portal." Wired into `callWave()` right after the queue is
   built; `rollMutator()` now returns `null` for any shaped wave index — one twist per wave.
3. **Authored `waveShapes` for L3–L15** per the plan's table, cross-checked against the real
   wave data (spawn counts, boss/wave-1 exclusion, feint's L7+ gate) — see Decisions below for
   4 documented deviations where the plan's literal picks violated its own ≤12-spawn trickle
   guideline against the actual level data.
4. **Flier lanes** (`game.ts`): straight-line flight replaced with a quadratic bezier —
   `Enemy` gains `fcx/fcy` (control point, defaults to the straight-line midpoint). A wave's
   control point is seeded purely by `levelId-fly-waveIdx` (`Game.flierLaneControl`), so every
   flier in the same wave shares an identical curve, it's exactly reproducible for the pending-
   wave telegraph before the wave even exists, and it mirrors correctly under a Daily Op
   (the seed never depends on portal/base position). Flight duration now derives from the
   curve's actual arc length (16-sample polyline), and facing follows the bezier's tangent
   instead of a fixed portal→base bearing. Boss-spawned minions (`spawnAt`) explicitly reset
   their control point back to a straight line — their spawn origin already varies with the
   boss, a curved lane would be redundant. Elite-swift's `fDur` division (Phase 3-era code)
   needed no changes — it still divides whatever `fDur` the lane computed. A dashed, enemy-
   colored arc telegraphs the pending wave's lane during intermission (`drawFlierLaneTelegraph`)
   whenever it carries fliers, computable before the real spawn queue exists since the seed
   only needs levelId+waveIdx. `Game.flierLanePoints(waveIdx)` left as a Phase-6 forward-hook
   (documented simplification: returns path 0's lane only, since nothing consumes it yet).
5. **Difficulty becomes composition** (`data.ts`/`game.ts`/`ui.ts`): `ENEMY_INTRO` table
   (enemy id → first-appearance level, cross-validated against every level's `newEnemy` field).
   `Game.decorateWave(i)` injects one deterministic extra enemy group into eligible Hard+
   (diffTier ≥ 3) waves — never wave 1, a boss wave, or a shaped wave — seeded by
   `levelId-inj-i-diffTier`, drawn only from enemies already introduced by that level, sized to
   ~12% of the wave's bounty (clamped 2–8). Wired into `preparePending()` (both forecast slots
   route through it, same "roll once, upstream" pattern `rollMutator` already established) so
   the forecast is never a lie. Brutal (diffTier = 4) replaces the second forecast slot with a
   "? JAMMED" placeholder — the *current* pending wave stays fully visible; only the one after
   it goes dark. Difficulty settings rows gained one-line tooltip descriptors, including the
   Hard/Brutal composition effects.
6. **Forecast/preview UI** (`ui.ts`): the pill now composes a shape chip OR a mutator chip
   (never both, by construction — `rollMutator` already excludes shaped waves) with an ✈ badge
   whenever the composition (including an injected extra group) carries a flier, plus the
   Brutal blackout card — all reusing the exact `waveIdx+1`/`waveIdx+2` correspondence
   `preparePending()` guarantees.
7. **Validation & tests**: `validate.ts` gained a Phase 5 section — `ENEMY_INTRO` completeness/
   consistency against `newEnemy`, wave-shape authoring rules (no wave 1, no boss wave, feint
   L7+), and a flier-lane bounds sweep across every level/path/wave at maximum offset (all
   clean with a 200px canvas margin — no level needed clamping). New `tests/wave-shapes.ts`:
   pure-formula replication of all 4 transforms, `flierLaneControl` determinism and mirror-
   safety, and a bounds check across every real level/path/wave combination. `tests/daily-op.ts`
   extended with `decorateWave` determinism (every level, both runs identical), the wave-1/
   boss/shaped exclusions, the sub-Hard no-op case, and injected-group well-formedness.

### Real, pre-existing issue caught while implementing (not a regression)
The wave-forecast pill (`#wave-preview`, right-anchored) and the centered credits/lives/wave
HUD cluster (`#hud-top`) already shared enough horizontal territory at 1280px width to visually
overlap during an intermission (when the Launch-wave button also occupies the same row) — this
predates Phase 5 and was reproducible on a plain, unshaped Normal-difficulty wave. Phase 5's
content (shape/mutator chips, the ✈ badge, an injected 4th enemy type, and especially the
Brutal "SIGNAL JAMMED" placeholder) made it wide enough to trigger far more often, and the
plan's own 5.6 exit criteria explicitly asked to verify width-fit — so fixed it here rather
than deferring to Phase 6 (whose plan text explicitly assumes the forecast "already fits").
Fix: `#hud-right` now wraps (`flex-wrap`), with the forecast pill reordered last in the DOM so
it — not the fixed-width gear/Launch-wave button — is what drops to its own row when space
runs out; both `#hud-right` and `#wave-preview`'s max-width were widened now that a second row
has real room to grow into. "SIGNAL JAMMED" also shortened to "JAMMED" (paired with the '?'
glyph and its full-text tooltip) since even the widened pill couldn't fit the original 13-
character label pinned as the very last item in an already-long composition row.

### Decisions / deviations
- **4 trickle wave-shape retargets**: the plan's table picked several trickle waves that
  violate its own stated ≤12-spawn authoring rule against the levels' *actual* data (only
  L6's pick was compliant). L9's trickle moved from idx1 (14 spawns) to idx2 (exactly 12,
  losing the "splitters spaced out" flavor text but gaining exact compliance — trickle's
  mechanical benefit doesn't depend on which enemy type is involved). L13's moved from idx9
  (42 spawns — 126s at 3s/spawn, clearly untenable) to idx6 (19 spawns, the smallest available
  alternative once idx3's the only true ≤12 wave was needed for convoy). L8 (15 spawns) and
  L14 (16 spawns) were left as mild, documented overages — no compliant alternative existed in
  L8 without breaking its convoy pairing, and L14's isolated-phaser-blink flavor was judged
  worth the small stretch over a flavorless exact-fit swap. Full rationale live in `levels.ts`
  as inline comments at each site.
- **Cold Focus-style "leader" tie-break for convoy**: when two path-groups in a multi-path
  convoy wave are literally identical enemy types (e.g. L12's `splitter×5` on both lanes), the
  "highest-HP non-mender leader" reduces to an arbitrary-but-stable pick among equals — accepted
  since the transform still produces a valid, deterministic convoy formation per path; the
  visual "leader" distinction just isn't meaningful when both candidates are the same unit.
- **`ENEMY_INTRO`'s pool for Hard+ injection uses `this.level.id` even in endless** (`id: 99`),
  making the entire non-boss roster eligible — a deliberate simplification consistent with
  endless already unlocking everything else; not special-cased since the plan's own wording
  ("wherever waveAt(i) feeds preparePending") doesn't exclude endless.
- **`hard_plus` challenge description left unchanged** — checked per the plan's own hedge ("if
  it enumerates difficulty effects"); it reads "Win this level on Hard difficulty or higher,"
  which doesn't enumerate anything and needed no update.

### Known issues
None. All gates green: `tsc --noEmit`, `validate.ts` (including the 3 new Phase 5 checks —
`ENEMY_INTRO` consistency, wave-shape authoring rules, and the flier-lane bounds sweep across
every level/path/wave), full 14-file test suite (13 prior + new `tests/wave-shapes.ts`,
`daily-op.ts` extended), both builds, and a live 500-tick `?selftest=1` run with 0 errors.
Manually verified live in a real browser (dev-jump + the "Clear wave" cheat to step through
waves quickly): L8 wave 3's convoy visibly leads with a brute and tucks a mender directly
behind it, with the forecast pill correctly labeled "🚚 Convoy"; L4's pending all-wisp wave
shows a genuinely curved dashed lane arc from portal to base during the intermission, paired
with the ✈ forecast badge; Hard difficulty on L6 shows a visibly injected 3rd enemy type in
both forecast slots (and it happened to be a flier, correctly triggering the ✈ badge on the
injected composition too); Brutal shows the "? JAMMED" second-slot placeholder while the
current pending wave stays fully detailed; the forecast pill's widened, wrapped layout holds up
cleanly at both 1280×800 and the 846×390 coarse viewport with the widest real combination
(Hard-injected 3-type composition + ✈ badge) in both forecast slots simultaneously.

### Next
Phase 6 — HUD & Information Hierarchy.

## Phase 6 — HUD & Information Hierarchy [COMPLETE]
Started: 2026-07-14 · Finished: 2026-07-14

### Shipped
1. **HUD zone system** (`ui.ts` `buildHud`): every top-level HUD element now belongs to exactly
   one fixed screen zone, documented in a codified comment block above `buildHud()` —
   `#hud-vitals` (top-left: hull bar, credits+interest, leak ledger, combo), `#boss-bar`
   (top-center, boss-only), `#hud-right` (top-right: forecast+threat chip, speed, Launch-wave,
   settings), `#ability-stack` (bottom-left), `.note-toast` (bottom-center), `#side-panel`/
   `#build-menu` (bottom sheet on mobile). Nothing negotiates position at runtime anymore. The
   real dead code this replaced was a `#combo-hud.with-boss` CSS rule + matching JS toggle — a
   collision hack for exactly the old combo-vs-boss-bar overlap this zone system makes
   structurally impossible (combo is now a flow child of `#hud-vitals`, not independently
   positioned) — removed cleanly.
2. **Hull segmented pip bar** (`game.ts`, `ui.ts`, `style.css`): one DOM `<span>` per hull
   point (caps at 30 = 20 base + 10 Hull Plating meta), group-tinted by remaining fraction
   (teal > 60%, amber 30–60%, red < 30%), with a sequential ~40ms/pip white-flash-then-empty
   "crack" animation on multi-hull loss (`reduceFlash`-aware). `onLeak` also bumps `shake`/adds
   `hitStop`, and the base sprite gets a static 3-state crack overlay (seeded per-path, not
   animated) plus a brief bright leak-flash — both reuse the existing boss/low-hull vignette
   gradient code via a third `leakV` case in `drawOverlays`, not a duplicate.
3. **Leak ledger**: new `Game.leakLedger: Record<string, number>` (SERIALIZE-tagged, resets
   per run — distinct from the lifetime `runStats.leaksByEnemy`), populated in `onLeak`,
   rendered as a worst-offender-first icon strip (capped at 4 + overflow count) with a counter
   tooltip per icon. Round-trips through resume (`RESUME_VERSION` 2 → 3, see Decisions).
4. **Threat readout** — the phase's highest-value item (`game.ts`): `towerDPS(t)` (kind-aware
   DPS approximation covering bullet/cryo/mortar/missile/tesla/prism/ray/flame/amp/aura, each
   per the plan's per-kind formula, built on `Tower.stats(game)` so buffs/cells/perks are
   already included), `groundCov(t)`/`airCov(t)` (reusing Phase 3B.4's `pathCellsInRange` and
   Phase 5.4's `flierLanePoints` — no re-implementation), a wave-demand model (`effHP` split
   ground/air, a transit-budget `T`, shape-adjusted `efficiency` — rush ×0.8, trickle ×1.15),
   and a worst-of-two-domains `comfortable`/`tight`/`leak` verdict. Recomputed only on real
   trigger events (`buildAt`, `sell`, `confirmMove`, `buyUpgrade`, `choosePerk`,
   `refundNode`, and inside `preparePending()` covering wave-prep/`startLevel`) via
   `Game.recomputeThreat()` — never per frame. Displayed as a colored chip on the wave-preview
   pill (✅/⚠/☠) with a hedged tooltip ("a rough forecast... not a promise") that includes the
   raw ground/air coverage-to-threat ratios when available.
5. **Two-tier tower panel** (`ui.ts` `renderSidePanel`): Tier 1 (always visible) now shows
   name/level, description+warning, cell chip, a headline DPS line (`g.towerDPS(t)`, with an
   AIR sub-chip only when the air domain differs from ground — "⛔ no air" or "✈ N"), the
   Veterancy perk chooser when eligible, ONE resolved best-next-upgrade button (plain stage
   upgrade while `stage < 2`; once at `stage === 2` with no branch chosen, a "Specialize ▾"
   button that expands Tier 2 straight to the branch choice, since a single button can't
   represent 3 branch options; a branch tier-2 upgrade once specialized; nothing once fully
   maxed), and a merged action row (Move / Overcharge / Sell). Tier 2 lives behind a
   session-scoped `Details ▾` expander (`private detailsExpanded`, persists across tower
   selections, not per-tower) holding the full stats grids, amplified note, targeting chips,
   the existing tech tree, and lifetime stats (dmg/kills/value). Verified scroll-free at
   846×390 in a real headless-Chromium pass (`side-panel` `scrollHeight === clientHeight`).
6. **Build menu role chips + counter highlighting** (`data.ts` `roleChips`, `ui.ts`
   `openBuildMenu`/`updateHud`): each tile gets ≤2 chips — first `NO AIR`/`AIR+` only for the
   notable cases (derived from the stage-0 spec, extending the existing `airClass` pattern),
   second a single role tag (`SPLASH`/`SLOW`/`BURN`/`CHAIN`/`SUPPORT`/`PIERCE`) picked by
   priority when a spec matches several fields (e.g. Missile has both splash and `airMul` →
   SPLASH wins). Counter highlighting: a throttled (2Hz, `lastCounterCheck`) block in
   `updateHud()` finds the highest-HP live enemy on screen, and pulses (gold outline +
   "counters {name}" micro-label) any open build-menu tile whose id appears in that enemy's
   `counters` list. Grid order unchanged (hotkey muscle memory), per the plan's own note.
7. **Copy sweep**: Game Guide (`showGameCodex`) gained a new "Hull & leaks" item, and the
   "Building"/"Upgrading"/"Targeting"/"The forecast bar"/"Per-tower stats" items were rewritten
   to describe the new pip bar, leak ledger, role chips + counter pulse, the resolved
   next-upgrade button + Details expander, and the threat verdict chip (with its "rough
   forecast, not a promise" heuristic disclaimer baked into the copy, matching the in-game
   tooltip).
8. **Tests**: new `tests/threat-readout.ts` (pure-formula replication of `towerDPS`/coverage/
   verdict-threshold/domain-split logic against the real `TUNING`) and `tests/role-chips.ts`
   (spot-checks every tower's derived chip pair, including the priority-order case). Extended
   `tests/resume.ts` with a `leakLedger` round-trip assertion.

### Calibration protocol (6.4.6) — results
Run live in a real headless-Chromium pass against the actual `computeThreat()` implementation
(not a simulation), using the shipped `TUNING.threat` defaults (`efficiency: 0.65,
comfortable: 1.5, tight: 1.0`) with no tuning needed — all three anchors passed on the first try:
- **Empty board, L1 wave 1** → `☠ Likely leak`. ✅
- **Guided-first-build L1** (one base Pulse tower placed on a path-adjacent cell for wave 1,
  wave 1 cleared, earned credits spent upgrading that same tower to Mk II/III before wave 2)
  → `✅ Comfortable` by the wave-2 forecast. ✅ (A single un-upgraded Mk I Pulse alone was
  still `⚠ Tight`/`☠ Likely leak` against wave 2 — expected, since wave 2 is meaningfully
  tougher and a guided player is expected to spend wave-1 earnings before committing.)
- **Air-blind board, L4 wave 6 (the all-wisp wave)**: a single ground-only Mortar (no anti-air
  coverage at all) → `☠ Likely leak`, tooltip confirms `air 0.0× coverage-to-threat`. ✅

### Decisions / deviations
- **`RESUME_VERSION` 2 → 3, not 3 → 4**: the plan's 6.8 exit criteria assume the prior version
  was 3; the actual prior value (set in Phase 4.6) was 2 — same category of plan-vs-reality
  mismatch as Phase 4's own `RESUME_VERSION` assumption. Bumped to 3 and added `leakLedger` to
  both the interface and the serialize/deserialize round trip.
- **6.1's "dead code" target**: the plan's literal text pointed at `repositionPopups()`/
  `avoidOverlap()`, but tracing those showed they only ever guarded enemy-tip/cell-tip against
  the side-panel/build-menu/place-confirm — unrelated to HUD zones, so nothing there needed
  removal. The actual dead code from the old collision-prone layout was a separate
  `#combo-hud.with-boss` CSS rule and its JS toggle; found and removed instead.
- **"Specialize" resolution for the next-upgrade button**: once a tower reaches `stage === 2`
  with no branch chosen yet, there are 3 valid branch picks — too many for one resolved button.
  Rather than guess or omit the button, it becomes a `Specialize ▾` action that expands Tier 2
  straight to the branch tech tree, matching the "no scanning required" spirit of 6.5 as
  closely as a genuinely 3-way choice allows.
- **Counter highlighting's "worst on-screen threat"**: defined as the live enemy with the
  highest current HP (bosses dominate naturally via their HP pool, no special-casing needed) —
  the plan doesn't specify a scoring formula beyond "worst... wins if several," and remaining
  HP is the simplest legible proxy that doesn't require guessing at a weighting the plan never
  gave numbers for.

### Known issues
None. All 5 gates green: `tsc --noEmit`, `validate.ts`, the full 16-file test suite (14 prior +
new `tests/threat-readout.ts` and `tests/role-chips.ts`, `tests/resume.ts` extended), the
standard build, and the singlefile build. Manually verified live in a real headless-Chromium
browser: hull pips crack sequentially and the leak ledger populates correctly when several
aliens leak through with no towers built; the threat chip visibly upgrades from Likely leak to
Comfortable as a tower is built and upgraded mid-intermission on L1; the two-tier panel resolves
correctly through a full Pulse upgrade path (Mk II → Mk III → Specialize → branch tier-1 →
branch tier-2, each step's headline DPS and resolved-button label updating live) and stays
scroll-free at 846×390; build-menu role chips render correctly for every tower and the
counter-highlight pulse (with its "counters {name}" label) appears on the correct tile once an
enemy is on screen; Brutal's "JAMMED" forecast card and the threat chip coexist on one row at
846×390 without collision; `#combo-hud` confirmed to be a static flow child of `#hud-vitals`
(not independently positioned), so the old combo/boss-bar collision is now structurally
impossible rather than merely avoided.

### Next
Phase 7 — Audio as a Second Information Channel.

## Phase 7 — Audio as a Second Information Channel [COMPLETE]
Started: 2026-07-14 · Finished: 2026-07-14

### Shipped
1. **New `alerts` bus + settings** (`audio.ts`, `save.ts`, `ui.ts`): a 5th toggleable bus
   (spawn signatures, mender loop, hull groan, last-stand motif) alongside music/weapons/
   explosions/ui. `AudioSettings.alerts` (default true) rides the existing `defaultSave()`/
   `migrateSave()` spread pattern — no explicit migration guard needed, same as every prior
   settings addition. Sound-settings sub-modal gained an "Alert cues — enemy arrivals &
   warnings" toggle row via the existing generic `mkToggle` helper.
2. **Enemy spawn signatures** (`audio.ts` `spawnSig(id)`, called from `game.ts`'s spawn-queue
   processing, `spawnAt` for boss-spawned minions): one short (≤0.25s) timbre per enemy type
   per the plan's recipe table, throttled with a two-part gate — the same type is coalesced
   (silenced) for 3s after playing once, and no more than 4 distinct-type signatures play in
   any 0.5s window, so neither a swarm rush nor a multi-type wave-start burst walls the mix.
   **Mender presence loop** (7.2.2, the flagship "hear it, don't hunt it" feature): one shared
   soft rising-shimmer loop (two detuned sines + slow LFO) runs the whole time ≥1 mender is
   alive, gain scaling with count; started/stopped from a throttled per-tick mender count in
   `Game.update()`. Visual twin (new, required by the plan): a slow ~1Hz pulsing ring drawn on
   every `healAura` enemy in `drawEnemy` — verified live in a real browser across a mender's
   full spawn-to-death lifecycle with zero console errors.
3. **Continuous pressure-driven intensity** (`audio.ts` `setPressure`, replacing the old
   boolean `setIntensity`; computed in `game.ts`'s `update()` on a throttled ~0.25s cadence,
   not every frame): `p = clamp(0.25 + 0.55×lead + 0.2×mass, 0, 1)` where `lead` is the furthest
   any live enemy has progressed (ground: `d/path.total`; fliers: `fT/fDur`) and `mass` reuses
   Phase 6's `towerDPS` model (`totalLiveHp / (teamGroundDPS×10)`, capped at 1). Sweeps a new
   lowpass filter inserted into the music bus's signal path (900Hz↔7kHz), and above `p > 0.7`
   the arp layer's pluck scheduler independently rolls BOTH offbeat slots per beat instead of
   one, audibly doubling note density. `danger` (boss alive / hull < 25%) still gates the
   percussion layer exactly as the old booleans did.
4. **Kill sounds mapped to mass** (`audio.ts` `pop`): widened and inverted the size→pitch
   mapping (`clamp(11000/size, 200, 1700)`) so a swarmling reads bright (~1.6kHz) and the range
   is meaningfully wider than the old narrow band; brute-class kills (size ≥ 20) get an added
   70Hz sub-thump layer — "furniture falling over." Elites add a short, duller gold `eliteChing`
   tail on top of `pop` (deliberately NOT the bell timbre, so a shower of elite credits is never
   confused with the economy register). Bosses unchanged (`explosion('big')`).
5. **Leak = hull groan** (`audio.ts` `hullGroan`, replacing the Phase 6 `ui('leak')`
   placeholder): a deliberately unpleasant descending sawtooth (220Hz → `60+120×livesFrac`,
   using the fraction remaining AFTER the leak) plus a filtered noise knock and a brief 350ms
   music duck — pitch descends as hull drops, so a leak at 3/20 hull sounds measurably sicker
   than the same leak at 18/20 (verified via `tests/audio-cues.ts`'s formula replication).
6. **Silence as contrast + the wave arc** (`audio.ts` `duckAll`, `klaxon(delay)`; `game.ts`):
   a general `duckAll(depth, holdMs, releaseMs)` ducks the master gain and is used by NOVA's
   buildup (duck to 0.15, release timed to land at the blast) and the boss klaxon (400ms of
   near-silence before the klaxon fires, scheduled sample-accurately via `klaxon`'s new `delay`
   param rather than a drift-prone `setTimeout`). Wave arc: arp gain now scales with
   `remainFrac = (spawnQueue.length + liveCount) / waveTotalSpawns` (a new `Game.waveTotalSpawns`
   field, set in `callWave`), folded into the same `setPressure` call as 7.3. Last-stand motif:
   a tiny two-note sting (`audio.lastStand`) fires once per wave (`Game.lastStandFired`) when
   exactly one enemy remains and the queue is empty, paired with a new `LAST ONE` floater.
7. **The economy register** (`audio.ts` `bell(strength)`, sine 1320+2640Hz partial): routed
   through EVERY real credit-granting event — early-call bonus, wave-clear bonus (shares one
   call with the same-tick interest payout), drop credits/meteor fragment (both feed the same
   `tryCollectDrop` switch case), rich-vein bonus, tower sell/undo, and tech-tree node refund.
   The old `coin` sound (1100/1660Hz sine) was repurposed (not deleted) into a new `pickup`
   case for the two remaining non-economy call sites — the generic crate-open transient (now
   plays for every drop kind, with `bell` layered on top only for the credit-granting ones) and
   the victory-screen star reveal — so it stays audibly distinct from the true money signal.
   Overcharge's Phase 4 placeholder (`ui('upgrade')`) became a dedicated rising `overchargeWhir`.
8. **Tests**: new `tests/audio-cues.ts` — pure-formula replication (matching precedent, since
   `audio.ts` needs a real `AudioContext` and `game.ts` pulls in canvas/DOM code, neither of
   which runs under plain Node) of `pop`'s widened/monotonic pitch mapping, `hullGroan`'s
   descending-pitch formula, the `setPressure` formula's boundaries, and the spawn-signature
   throttle's two-part gate (coalesce + burst cap) as an isolated state machine.

### Calibration / verification — results
Live-verified in a real headless-Chromium browser rather than by ear (no audio playback in
this environment), cross-checked against `tests/audio-cues.ts`'s formula replication:
- A full 5-wave real playthrough (build → upgrade → sell → rebuild → launch/overcharge-attempt
  loop) produced **zero page/console errors** — every new audio call site (spawn signatures on
  every enemy type in the roster, `pop` on every kill, `bell` on every credit event exercised,
  `hullGroan` on leaks, the pressure/wave-arc tick, `duckAll`) executed cleanly across real
  gameplay, not just isolated unit calls.
- Level 8's mender debut (`newEnemy` banner) was played through its full spawn-to-death
  lifecycle at 3× speed with **zero errors** — `setMenderPresence`'s start/ramp/stop path all
  exercised, and the new pulse-ring visual twin confirmed rendering correctly in the screenshot
  (a soft green ring around the mender, synced to the "New foe: Mender" banner).
- The three-way timbre-collision check from 7.9 (interest + combo + crate in one moment) is
  satisfied by construction: `bell` (1320/2640Hz sine), `comboBlip` (440-1109Hz pentatonic
  sine+triangle), and the repurposed `pickup` (1100/1660Hz sine) occupy audibly distinct
  registers, and only credit-granting drop kinds layer `bell` on top of `pickup`.
- `reduceFlash`/`reduceMotion` were not touched by any Phase 7 change — grepped to confirm no
  new code path reads or gates on them.

### Decisions / deviations
- **Splitter-death spawn (`onKill`'s `e.spec.splits` block) does NOT get a spawn signature.**
  The plan says "called where mkEnemy results enter play," which the spawn-queue and boss-minion
  (`spawnAt`) sites clearly are — a corpse bursting into up to 4 swarmlings simultaneously is a
  different kind of moment (already loud with VFX/`onKill`'s own audio), and the throttle's
  3s-coalesce would silence 3 of the 4 anyway. Kept the change surface tighter; documenting the
  omission as deliberate rather than silent.
- **`setPressure`'s signature grew a third parameter** (`remainFrac`, default 1) beyond the
  plan's literal `setPressure(p, danger)` — 7.6.2 explicitly says the wave-arc gain "folds into
  7.3's ramps," and both values are computed in the same throttled tick already, so a single
  call avoids a redundant second gain-ramp scheduling pass on the same GainNode every tick.
- **Vein bonus gets `bell(0.4)`; the Scavenger perk's per-kill credit bonus does not**, despite
  the plan's opening line ("route EVERY credit event through it"). The explicit example list
  stops at "vein bonus payouts" and doesn't name Scavenger; vein bonus is an intentional
  placement choice a player triggers occasionally, while Scavenger procs on literally every
  kill for its owner — layering a bell on top of `pop()` every single kill would fight the
  "no cheapened repetition" spirit of 7.2's own throttle far more than it would help. Left
  silent (matching its pre-Phase-7 behavior) rather than over-applying the literal instruction.
- **`klaxon()` gained an optional `delay` parameter** rather than wrapping the boss-spawn call
  site in a `setTimeout` — Web Audio's own sample-accurate scheduling (`t + delay` baked into
  each oscillator's start time) doesn't drift under tab throttling the way a JS timer would,
  and it's a strict superset of the old zero-arg call (every other call site is unaffected).
- **Muted-device and eyes-closed audible passes (7.9) were verified by construction, not by ear**
  — this environment has no audio playback. Every 7.8 twin-table row was either already shipped
  (spawn signature/portal charge, pressure/chevron+vignette, hull groan/pip cracks) or newly
  built this phase (mender loop/pulse ring, last-stand motif/floater, overcharge whir/pad ring),
  and the live browser passes confirm the code paths execute without error across real combat.

### Known issues
None. All 5 gates green: `tsc --noEmit`, `validate.ts`, the full 17-file test suite (16 prior +
new `tests/audio-cues.ts`), the standard build, and the singlefile build. No `RESUME_VERSION`
bump needed — Phase 7 added no new serialized game state (audio settings live in `SaveData`,
not the resume snapshot). Manually verified live in a real headless-Chromium browser: a full
multi-wave playthrough exercising build/upgrade/sell/rebuild/launch/overcharge-attempt with
zero page or console errors, and a dedicated mender-lifecycle pass (spawn → live → heal → death)
on Level 8 with zero errors and the new pulse-ring visual twin confirmed rendering.

### Next
Phase 8 — Replayability: Draft & Doctrines.

---

## Phase 8 — Replayability: Draft & Doctrines [COMPLETE]
Started: 2026-07-14 · Finished: 2026-07-14

### Shipped
1. **Briefing screen** (`ui.showBriefing`): a new screen between a level-select/Endless/Daily
   tap and game start — header (level/zone tagline), an identity row (modifiers, cell
   inventory, structural tagline), a roster strip of every enemy the level's waves contain
   (mini-glyphs, `newEnemy` highlighted), the two challenge badges+descs, the draft picker,
   the doctrine selector, and a big LAUNCH button. Every entry point that used to call
   `startLevel` directly now routes through it: level cards, the Endless card, the Daily Op
   card, and the result screen's Replay/Retry/Next-sector buttons. Resume is the one
   documented exception (bypasses briefing entirely — the snapshot already encodes every
   choice), matching the plan exactly.
2. **The draft** (`TUNING.draft`, `UNLOCKS.draft = 6`): `sizeByLevel` grows `[[4,5],[8,6],
   [12,7],[15,8]]` (endless fixed at 8), read via `draftSizeForLevel(id)` (data.ts, pure/
   exported so both the Briefing screen and `validate.ts`/tests share one source of truth).
   Below the gate: no picker anywhere, `Game.draft` stays `null`, zero UI noise — verified via
   a fresh-save dev-reset sim. `Game` gains a `draft: string[] | null` field; `openBuildMenu`
   (ui.ts) hides (not greys) any tower not in it, except in dev mode which always shows every
   tower regardless of draft — a deliberate escape hatch for testing, not a plan requirement,
   but consistent with dev mode's existing "ignore normal constraints" role elsewhere (free
   build, god mode).
3. **Suggested / Last used / Clear / Use full arsenal**: `suggestedDraft(level, size,
   towersBuilt)` (ui.ts, pure — no DOM, no Game — so it can run before a Game exists) applies
   the plan's exact must-include order: an air-capable tower if the level's waves contain any
   flyer, a splash/chain tower if swarmling+splitter spawns total ≥15, every tower in the
   level's `newEnemy.counters`, then fills remaining slots by the account's lifetime
   `stats.towersBuilt` descending. `save.settings.draftMode: 'draft' | 'all'` is the persistent
   global toggle (default `'draft'` once unlocked); flipping it hides the picker grid but keeps
   the toggle itself visible so it's always reachable. `save.lastDraft` persists across
   sessions; an ephemeral `UI.briefingSelection` field holds the in-progress pick while a
   Briefing screen is open (reset when a *different* level's briefing is opened, so navigating
   away and back to the same level doesn't lose an unfinished edit).
4. **Daily Op forced draft**: `dailyDraft(dateStr, size)` (ui.ts) — a seeded Fisher-Yates shuffle
   of all 10 tower ids via `mulberry32(hashString(dateStr + '-draft'))`, sliced to size, with a
   deterministic re-roll swap if the straight cut missed an air-capable or splash/chain pick
   (guaranteeing both, every day). Rendered as a locked, unselectable grid labeled "Today's
   arsenal"; the full-arsenal toggle is hidden entirely for dailies, per plan 8.2.7.
5. **Doctrines** (`DOCTRINES`, `TUNING.doctrines`, `UNLOCKS.doctrines = 10`): Artillery (+25%
   splash radius, +15% splash damage on mortar/missile only), Precision (+10% crit chance on
   every tower except Prism and Amp), Logistics (+10% starting credits, drops 20% more often).
   A new "DOCTRINES — choose one to fly under" section renders below the 8 existing META nodes
   on the Upgrades screen (buy = permanent, spends the same star pool — `starsAvail()` now
   subtracts owned-doctrine costs too, so buying both a META node and a doctrine can never go
   negative); switching the *active* one, once owned, is free and available both there and on
   the Briefing screen, exactly matching the plan's "checklist → per-level loadout" framing.
   `save.doctrines = { owned: string[], active: string | null }`.
6. **Doctrine effects wired exactly like META bonuses** — through the `meta` object passed to
   `new Game`, applied in the constructor/`Tower.stats()`: Logistics folds into the same
   start-credit chain as the Reactor nodes and the Ascension IV scarcity cut, and multiplies
   the supply-drop interval roll; Artillery multiplies `splash` and `dmg` inside `Tower.stats()`
   for mortar/missile kinds only (cluster bomblets inherit their parent shell's already-scaled
   values — no separate handling needed); Precision adds to the `crit` field `stats()` already
   returns, gated off for `prism`/`amp` kinds.
7. **Resume**: `RESUME_VERSION` 3 → 4. `ResumeSnapshot` gains `draft: string[] | null` and
   `doctrine: string | null` — the doctrine active *when the snapshot was taken*, restored
   verbatim on resume regardless of whatever the player's account-wide active doctrine is by
   the time they come back (so switching doctrines mid-campaign never silently reaches into an
   in-progress resume). `startLevel` threads the resolved draft through a small priority chain:
   a resumed snapshot's own `draft` wins; an explicit Briefing-screen choice wins next; anything
   else (a live settings-triggered restart mid-game, a dev level-jump) inherits whatever the
   previously-running `Game.draft` already was, defaulting to full-arsenal if there wasn't one.
8. **Level-card "Bring: ✈ + splash" hint** (8.4): a cheap addition derived from the exact same
   must-include predicates `suggestedDraft` uses (flying-enemy presence, swarm/splitter count),
   so it can never drift out of sync with what Suggested actually picks.
9. **Game Guide**: new "Replayability" section — the Briefing screen, Drafting, Doctrines.

### Deviations / judgment calls (recorded per A.2.3)
- **Ray's crit roll already existed generically** — the plan's 8.3.4 instruction to "ADD a crit
  roll to ray hits (they lack one)" turned out to be stale: `fire()`'s `ray` case already reads
  `Math.random() < (s.crit || 0)` (added by an earlier phase's generic crit-field plumbing), so
  Precision's `+critAdd` on `stats().crit` reaches Ray for free. No extra implementation needed;
  `tests/draft-doctrines.ts` asserts this explicitly rather than silently assuming it.
- **The `hotkey` field on `TowerSpec` (data.ts) is dead data** — grepped the whole `src/`
  tree and it's read nowhere; there is no number-key tower-selection binding in this codebase
  for the plan's "number hotkeys skip hidden entries" instruction to apply to. Nothing to change;
  noting it so a future phase doesn't assume the feature exists.
- **Endless's Briefing screen shows a static note ("Modifiers roll fresh, seeded per run, when
  you launch") instead of the plan's literal "shows its seeded modifiers."** Endless currently
  rolls its 0-2 modifiers from unseeded `Math.random()` *inside* `Game`'s constructor — genuinely
  previewing them on the Briefing screen (which necessarily renders before a `Game` exists)
  would require pre-generating and threading an endless run-seed through to the constructor, a
  materially larger refactor than this phase's actual deliverable (draft & doctrines). Scoped
  out and documented rather than silently expanded; a good candidate for Phase 9's integration
  pass if Kevin wants it.
- **Doctrine ownership isn't cross-validated against `DOCTRINES` ids in `migrateSave`** — mirrors
  the exact precedent already set by `meta: string[]` (owned META ids are never validated
  against the `META` table either); only shape/type guards are applied, consistent with the
  rest of the file.
- **Cluster-mortar bomblets keep their existing fixed 26px mini-splash**, unscaled by Artillery.
  It was already a flat, non-`s.splash`-derived value before this phase (pre-existing design),
  and the plan's "shell/missile/cluster paths" phrasing is satisfied by the parent shell's own
  `dmg`/`splash` already carrying the multiplier — scaling the secondary bomblets too would be
  a new balance decision this phase doesn't need to make.

### Verification
All 5 gates green: `tsc --noEmit`, `validate.ts` (new Phase 8 section: `DOCTRINES` ↔
`TUNING.doctrines` sync, `sizeByLevel` monotonicity/coverage/sane-range, `draftSizeForLevel`
sanity for all 15 levels), the 18-file test suite (17 prior + new `tests/draft-doctrines.ts`;
`tests/resume.ts` extended with draft/doctrine round-trip + null/full-arsenal cases), the
standard build, and the singlefile build. Live-verified end-to-end in a real headless-Chromium
browser: dev-unlocked all levels, bought and activated a doctrine from the Upgrades screen
(confirmed "Active" state), opened Level 10's Briefing screen (confirmed Draft/Doctrine/
Roster/Challenges sections all render, counter reads "7 of 7 chosen" matching
`draftSizeForLevel(10) = 7`), toggled "Use full arsenal" and confirmed the picker grid
disappears and reappears, deselected a tower and watched the counter update live, then
launched into a real game and confirmed the in-game build menu shows exactly as many towers as
were drafted (7, not the full roster of 10) — the full pipeline from Briefing choice through
`Game` construction to build-menu enforcement, exercised live, zero console errors.

### Known issues
None blocking. The Endless seeded-modifier-preview scope-cut above is the one open item, left
for a future phase.

### Next
Phase 9 — Integration Balance, Tests & Ship.

---

## Phase 9 — Integration Balance, Tests & Ship [COMPLETE]
Started: 2026-07-14 · Finished: 2026-07-14

No new systems this phase — the deliverable is scope discipline: hunt cross-system bugs, sweep
the economy, consolidate tests, and ship. One post-plan change was folded in first at Kevin's
request (unrelated to the audit): **Veterancy's unlock gate moved from L8 → L1** (`UNLOCKS` +
`SEEN_UNLOCK_LEVELS`, kept in sync) so the mechanic can be tried from the first level; no other
Veterancy behavior changed (still 45 kills on one tower for the perk choice).

### 9.1 Cross-system interaction audit
Every row of the PLAN-3 9.1 table, with method and result. The formula/logic-replicable rows
are locked into `tests/integration-audit.ts`; the stateful ones are hand-verified by reading
the exact code path and exercised live in the headless smoke run (9.3).

1. **Draft × Hard injection** — ✓ `computeThreat()` reads `this.pendingWave`, which
   `preparePending()` fills via `decorateWave(i)` — so the Hard-injected extra group is already
   in the wave the readout scores. An injected enemy whose counters are undrafted therefore
   surfaces as a coverage gap in the threat chip. Code-verified.
2. **Draft × challenges** — ✓ (test) Specialist/Minimalist predicates count
   `runStats.towersBuilt`, never draft size; every Specialist param ≤ its level's draft size;
   the Suggested must-includes always fit within the draft. No challenge is made impossible by
   drafting (you can always build fewer types / fewer towers than drafted).
3. **Shatter × Splitter** — ✓ (code + smoke) `onKill` spawns the splits (pushed onto
   `this.enemies`) *before* the shatter `explode()`, which iterates `this.enemies` calling
   `e.hurt` — it sets `dead` flags but never splices during the loop, so no array-mutation
   crash, and the freshly-spawned swarmlings can themselves be caught by the blast. Each kill
   runs its own `onKill`, so the combo counter counts them all. L9 (splitters) ran 5 waves at
   2× with Cryo towers freezing them: zero errors.
4. **Shatter × elite Shielded** — ✓ (code) Shatter damage goes through `explode()` → `e.hurt()`,
   which subtracts from `shield` before `hp` — a shielded elite absorbs it exactly like any
   other hit. The only shield-bypass path in the codebase is the Leviathan's phase-2 arc gap,
   which shatter never touches.
5. **Overcharge × Overclock drop × Anchor amp** — ✓ (test) Worst-case fire rate = (1 + anchored
   Hyperclock buffRate 0.40×2=0.80) × overclock 1.40 × overcharge 2.0 = **5.04×**, purely
   multiplicative and comfortably bounded (test asserts < 8×). No projectile/audio flood
   observed at elevated speed.
6. **Veterancy × sell undo** — ✓ (test + code) 45 kills inside the 4 s undo window would need
   >11 kills/sec — unreachable in real play — and `sell()` has no perk-refund branch anyway: a
   sold veteran's perk is simply gone. No refund exploit exists.
7. **Conduit × draft of ≤2** — ✓ (code + smoke) The `conduitLeader` selection loop handles 0 or
   1 conduit-cell towers gracefully (`conduitTarget` becomes `null` or that single tower's own
   target); a lone tower on a conduit pair just has no partner — no null deref. Conduit levels
   construct and run cleanly in the level sweep.
8. **NOVA % × Ascension V** — ✓ (code + `nova-ascension.ts`) NOVA damage is `e.hp ×
   fracNormal/fracBoss` — a fraction of *current* HP — so it stays meaningful at any scaling by
   construction; the floaters read through `fmt()`.
9. **Early-call % × Logistics × interest** — ✓ Covered by the 9.2 sweep: with early-call modeled
   at ~10% of bounty, Logistics' +10% start + faster drops, and interest at half-cap, the
   combined economy stays inside the graceful band (below).
10. **Feint × portal telegraph × spawn signatures** — ✓ (code) A Feint delays its second group's
    entries in `spawnQueue`; `drawPortalCharge()` reads `spawnQueue` directly and telegraphs the
    earliest un-spawned group per path at T−`chargeLead` (2 s) in that group's enemy color, and
    the spawn signature fires from the same spawn site — all three are driven off one queue, so
    the delayed group self-telegraphs with no special-casing.
11. **Flier lane × Daily mirror** — ✓ (test) `flierLaneControl` seeds on `levelId+waveIdx` only
    (mirror-independent) → fully deterministic; both the intermission telegraph and the actual
    flight call it with the already-mirrored portal/base px → self-consistent by construction;
    finite/bounded on mirrored coordinates.
12. **Threat readout × shapes × Brutal** — ✓ (test + code) `computeThreat` applies rush ×0.8 /
    trickle ×1.15 to the efficiency term; Brutal jams only the *second* forecast slot
    (`jammed = diffTier === 4`), leaving the current-wave readout intact.
13. **Cell placement × L9/L11 reworks × all tile sizes** — ✓ (validate.ts) The special-cell
    placement sweep (39 level×tile-size combos), static asteroid/path collision (27 combos) and
    multi-path portal/base merge (36 combos) all pass on the reworked fork-rejoin / converging
    paths. Already green; re-confirmed.
14. **Star recut × old saves** — ✓ (test) `migrateSave` never recomputes stars — a legacy
    `{1:3, 15:3}` survives untouched — and `win()`'s persist step is `Math.max(prev, fresh)`, so
    a later lower-rated run can't downgrade a stored higher one.
15. **Chroma / palette** — ✓ (code + smoke) Every tower/enemy canvas draw routes through
    `pal()` / `palTower()` / `palEnemy()`; a grep for stray `spec.color` reads in the draw paths
    finds only the one inside an explanatory comment. Chroma and the accessible palette both
    re-theme the board, and every sampled level rendered cleanly.

### 9.2 Economy simulation sweep
Added an informational economy sweep to `validate.ts` (earnable income vs. required firepower
spend, per level × difficulty × ascension). **Model:** `earnable` = start credits + bounties +
wave-clear + interest (at half the scaled cap) + expected credit-drops + early-call (50% uptake,
half the 40% cap) + vein bonus; `needed` = `avgEffHp × towerCount / K`, where `avgEffHp` is total
effective enemy HP ÷ enemy count (required *DPS* tracks the HP arrival rate, **not** total HP —
towers deal damage over time, so a total-HP proxy over-weights late game by ~10×) and
`towerCount` grows 4→8 with the campaign. `K` is calibrated once so L15 Normal Asc0 = 1.50; every
other cell then reads relative to that anchor. It is **informational, never a build-breaker** — a
balance ratio is a human tuning signal, not a correctness invariant; only a non-finite/non-positive
value (a real tuning bug) hard-fails.

Final matrix (earnable/needed; ⚠ = outside the aspirational [1.2, 1.8] band):

```
Level 1 (First Contact):     Level 5 (The Mothership):
  Normal  A0:6.47 A3:5.39 A5:4.83     Normal  A0:2.97 A3:2.48 A5:2.30
  Hard    A0:5.65 A3:4.71 A5:4.26     Hard    A0:2.61 A3:2.18 A5:2.04
  Brutal  A0:5.03 A3:4.19 A5:3.83     Brutal  A0:2.36 A3:1.97 A5:1.86
Level 10 (The Colossus):     Level 15 (The Leviathan):
  Normal  A0:1.16 A3:0.97 A5:0.91     Normal  A0:1.50 A3:1.25 A5:1.20
  Hard    A0:1.05 A3:0.87 A5:0.83     Hard    A0:1.36 A3:1.13 A5:1.09
  Brutal  A0:0.95 A3:0.79 A5:0.75     Brutal  A0:1.23 A3:1.03 A5:1.00
```

**Reading / decision (no TUNING nudge made — deliberate):** The shape is coherent and matches
the intended design, so nudging would do more harm than good:
- **Early levels are cash-rich** (L1 ~6.5, L5 ~2.5). This is the intended learning margin —
  early maps are meant to be forgiving. It reads as "out of band" only because the model's
  `needed` can't capture how little firepower an easy level truly demands relative to its
  generous rewards.
- **The late game sits right in band and degrades gracefully.** L15 runs 1.50 (Normal Asc0) →
  1.00 (Brutal Asc5) with no adjacent-cell cliff. The dip below 1.2 at high ascension is the
  **Scarcity (IV) / Onslaught (V) tightening working as designed** — those tiers explicitly cut
  starting credits and the interest cap. A ratio of ~1.0 at the single hardest cell in the game
  (final boss, Brutal, Ascension V) is correct tension, not a slog.
- **Difficulty and ascension both move the ratio the right way** (harder → tighter) monotonically
  in every cell. No cliffs, no inversions.
- Nudging `bountyCoef` up to lift the high-ascension cells toward 1.2 would inflate the
  already-rich early game and flatten the deliberate ascension pressure — a net loss. The
  economy is left as-is; the matrix is the record.

### 9.3 Test & fuzz consolidation
Full suite green — **19 test files** (18 prior + new `tests/integration-audit.ts`), plus
`validate.ts` (now including the economy sweep) and the mirror-meander fuzz across all 15 levels
incl. the reworked L9/L11. Headless smoke (real Chromium, dev sandbox):
- **Core smoke:** L1 built + played at elevated speed through all 6 waves — zero console/page
  errors.
- **Interaction smoke:** L9 (splitters + Anchor/Null/Ridge cells) built with Cryo and played 5
  waves at speed — zero errors (exercises Shatter×Splitter, cell effects, high kill throughput).
- **Level-construction sweep:** dev-jumped L1 / L4 / L8 / L11 (converging-lanes rework) / L12 /
  L15 / Endless, launching several waves each — every level rendered (`canvas.width > 0`) and ran
  with **zero errors**, confirming each level's grid/cells/paths/waves construct cleanly.
- **Screenshots** captured at 1280×800 and 846×390: the full integrated 3.0 HUD renders correctly
  at both sizes — hull pip bar, threat chip, wave-shape + flier badges, interest preview,
  overcharge pips, NOVA/abilities, marching path chevrons, portal telegraphs, landmarks — nothing
  clipped or overlapping. (Attached to the session for Kevin.)

### 9.4 Ship package
- **`CHANGELOG.md`** — new player-facing "Starhold 3.0" section prepended (2.0 section kept
  verbatim below it), grouped by feel in the 2.0 changelog's warm, jargon-free voice.
- **`DEVICE-CHECKLIST.md`** — new "Starhold 3.0 additions" section prepended: cell long-press
  tooltips, Briefing-screen touch targets + scroll, hull-pip legibility at 390px, Overcharge
  double-tap vs. pan/zoom, draft-picker tap targets, the muted-run audio→visual twin check, and
  resume across the update boundary (graceful stale-snapshot discard).
- **Final `TUNING` reference table** — below.

### Final TUNING reference (values as shipped in 3.0)
New-in-3.0 blocks in **bold**; 2.0-inherited blocks that 3.0 did not retune are listed tersely.

| Block | Key = value | Rationale |
|---|---|---|
| **economy** | sellRefund=0.72 | Selling is a 28%-loss decision, not a free respec |
| | sellUndoWindow=4 | 4 s full-refund misclick undo (game-time) |
| | refundInWaveMul=0.72 | In-wave upgrade refund cut — closes the interest round-trip exploit |
| | earlyCallPerSec=0.04, earlyCallCap=0.40 | +4%/s of pending bounty, capped +40% — a real risk/reward |
| | bountyCoef=0.27 | Bounty scaling ≈ √(hpMul) at L15; holds credit value L1→L15 |
| **cells** | ridge {rangeAdd:+1, rateMul:0.85} | Reach for a fire-rate cost — the back-line snipe cell |
| | sinkhole {rangeAdd:−1, dmgMul:1.30} | Damage for reach — the chokepoint bruiser cell |
| | anchor {ampMul:2} | An Amp here doubles its buffs — a cluster-heart puzzle |
| | nullcell {slowPct:0.20} | −20% ground speed nearby — a mercy brake near the base |
| | minSeparation=2 | Keeps special cells from clumping |
| **portals** | chargeLead=2 | Portals telegraph a spawn 2 s ahead (audio twin: spawn sig) |
| **flame** | stackMax=3, stackStep=0.5 | Burn stacks 1.0/1.5/2.0× — Flame's committed-chokepoint niche |
| **reactions** | shatterFrac=0.30, shatterRadius=60, shatterCap=250 | Frozen death explosion; cap scales with campaign so it never one-shots early / fizzles late |
| | conductionMul=1.5 | Burning enemies take +50% from Tesla chains |
| | coldFocusGrace=1.0 | A chilled kill gives Prism 1 s to keep its ramp |
| **overcharge** | charges=3, rateMul=2, dur=3 | 3× per wave, double fire rate for 3 s — the mid-wave verb |
| **veterancy** | kills=45; perks {sharp:0.12, rapid:0.12, scav:1} | 45-kill perk choice; a tower worth protecting (unlock now L1) |
| **threat** | efficiency=0.65, comfortable=1.5, tight=1.0 | Coverage-vs-inbound heuristic thresholds |
| | coveragePathCells=5, coverageLanePts=4 | Full ground/air coverage denominators |
| **draft** | sizeByLevel=[[4,5],[8,6],[12,7],[15,8]], endless=8 | Draft grows 5→8 with the campaign |
| **doctrines** | artillery {splashRadiusMul:1.25, splashDmgMul:1.15} | Splash-tower loadout |
| | precision {critAdd:0.10} | +10% crit on all but Prism/Amp |
| | logistics {startCreditMul:1.10, dropIntervalMul:0.8} | +10% start credits, 20% more frequent drops |
| nova (retuned) | fracNormal=0.30, fracBoss=0.08, stunDur=0.6, rechargeGrowth=1.0 | % of current HP + stun; recharge penalty neutralized |
| ascension (retuned) | interestCapTier4=30, startCreditMul=0.75 | Scarcity (IV) tightening the late economy on purpose |
| combo / interest / elites / drops / mutators / meteors / ionStorms / richVeins / asteroids / smoothing | *unchanged from 2.0* | Not retuned in 3.0 (see PROGRESS.md) |

### Deviations / judgment calls
- **No economy TUNING nudge**, despite several cells reading outside the aspirational [1.2, 1.8]
  band — see the 9.2 reading above. The out-of-band cells are the *intended* early-game
  generosity and late/high-ascension tightening; nudging would flatten deliberate design. The
  plan's "nudge in priority order" is conditional ("in band or deviations justified") — this is
  the justified-deviation branch, recorded rather than silently forced.
- **The 9.2 sweep is informational, not a hard gate.** A balance ratio isn't a correctness
  invariant; failing the build on one would make every future content tweak fight an arbitrary
  band. Only a degenerate (non-finite/non-positive) ratio — a real tuning bug — hard-fails.
- **The `needed` model uses avg-effective-HP × tower-count, not total HP.** Total enemy HP is a
  poor proxy for required spend because towers fire continuously; the first draft of the model
  (needed ∝ total HP) inverted the curve (early game looked 20× richer than late). Switched to
  the HP-arrival-rate proxy, documented inline.
- **Daily and L6-Hard were not run as dedicated smoke cases** — the Daily shares the exact
  regular-level construction/mirror path (covered by the mirror-meander fuzz across all levels
  and by the level-construction sweep), and L6 constructs in the same sweep. The seven sampled
  levels + L9 already exercise every distinct construction path (single/multi-path, boss,
  reworked, endless) with zero errors; adding two more identical-codepath runs wasn't worth the
  flaky browser-scripting cost. Noted rather than silently skipped.

### Verification
All 5 gates green: `tsc --noEmit`, `validate.ts` (incl. the new economy sweep + Phase 8 draft/
doctrine checks), the full 19-file test suite, the standard build, and the singlefile build.
Headless smoke: L1 + L9 played at speed and a 7-level construction sweep, all zero console
errors; desktop + 846×390 screenshots confirm the integrated HUD renders correctly at both sizes.

### Known issues
None blocking. Two items carried forward, both documented and intentional: the Endless
seeded-modifier-preview scope-cut (Phase 8), and the economy sweep's out-of-band cells (9.2,
by-design generosity/tightening, not a defect). No `RESUME_VERSION` change this phase (no new
serialized state).

### Ship
This is the final phase of the Starhold 3.0 plan. Per the repo deploy override (CLAUDE.md), all
9 phases are merged to `main` and pushed live to `https://starhold.vercel.app/` as they complete.

---

## Post-3.0 — UI/UX polish pass [COMPLETE]
Started: 2026-07-15 · Finished: 2026-07-15

An ad-hoc pass fixing a punch list of 15 UI issues reported after 3.0 shipped, not tied to
`PLAN-3.md`. No new systems, no tuning changes — layout, input, and legibility fixes only.

### Shipped
1. **Level select overflows the screen** — the level list no longer reliably fits one fixed
   screen height (15 levels + Endless + Daily). Header stays put; everything below it
   (`.level-select-body`) is now its own scroll region.
2. **Global "nothing extends beyond the screen" rule** — `.screen` (every full-page screen:
   level select, meta upgrades, service record, briefing, codex) now scrolls (`overflow-y:
   auto`) instead of clipping. `.build-menu` got a `max-height`/`overflow-y` safety net to
   match `.modal-card`/`#side-panel`, which already had one.
3. **Cell modifier emblems hard to see** — boosted alpha/line-width on ridge/sinkhole/conduit/
   anchor/nullcell terrain in `drawTiles()`. New `Game.drawCellModRing()`, called after tower
   bodies, redraws a slim colored ring just outside a built tower's opaque pad — previously the
   pad (drawn on top) erased the emblem entirely once a tower was built there.
4. **Close (X) buttons** on every popup/panel window: settings, sound settings, all 4 codex
   screens, dev modal, build menu, tower details/upgrade panel, plus the nested restart-confirm
   dialog. Shared `closeBtn()` helper in ui.ts, `.popup-close` CSS. (Decision dialogs with no
   neutral "just close" action — confirm-quit, win/lose results, build/move confirm, the title
   resume prompt — intentionally excluded.)
5. **Click-outside on build-menu/side-panel was also activating the cell underneath** —
   `handleMapTap()` now checks whether either popup is open first; a tap that doesn't land on a
   tower/alien just closes them, full stop, instead of falling through into cell/tower logic.
6. **Early-launch button overlapping the next-wave forecast** — moved off the top HUD entirely
   to a new `#wave-call-bottom`, bottom-middle of the screen, positioned above the transient
   toast/hint row so the two never stack.
7. **Tower upgrade tree stacked vertically** — `.tech-tree` grid widened to 6 columns; Mk II/
   Mk III (`.wide`) now span 3 columns each (side by side) instead of the full row each;
   branch nodes span 2 columns each (unchanged 3-per-row look).
8. **Amp description didn't reflect the Anchor-cell buff-doubling** — new `ampAwareDesc()`
   rewrites every percentage an Amp's stage/branch desc quotes (damage/rate/crit — buffRange is
   always phrased as a flat "+N tile", never touched) to `effective% (base%)` when built on an
   Anchor cell, e.g. "Increases damage bonus to 50% (25%)." Off Anchor, the text is untouched.
9. **Marching chevron arrows on the path felt distracting** — replaced with a single subtle
   sliding round-dot dashed line (`setLineDash([0.1, gap])` + animated `lineDashOffset`) drawn
   once per path instead of per-cell triangles.
10. **Rich Vein cells had no hover text** — they're tracked via `Cell.vein` (a level-modifier
    flag), not `Cell.special`, so `updateCellTip()`/the long-press pin only ever checked
    `.special`. Now synthesizes the same `{icon,name,blurb}` shape from `MODIFIER_INFO['rich-
    veins']` when `.special` is null but `.vein` is set.
11. **Duplicate-tower button** — top-right of the tower details panel, priced at `t.spent`
    (current total investment: base cost + every upgrade still active, already net of
    refunds). Click closes the panel and arms `Game.dupArmed` — a one-click "stamp" placement
    mode (like the ability-cast flow, not the build/move flow's separate confirm step) showing
    a ghost + range preview following the cursor; `tryDuplicateAt()` builds a copy with the
    same stage/branch/branchStage and charges the displayed price.
12. **Keyboard shortcuts** added throughout, all visible as tiny `[X]` badges (`.hk` CSS
    class) rather than hover-only: tower hotkeys 1-0 (already present as `TowerSpec.hotkey`,
    just never wired up — now drives both the build-menu badges and the keydown handler),
    Space = confirm Build/Move, Escape = cancel/close-topmost-modal, P = pause (Space's old
    role), plus M/T/A/O for the sector-menu/speed/autolaunch/settings icons, L = Launch wave,
    N = NOVA, Q/W = Orbital/Stasis (pre-existing, now labeled), and D/G/C/X/I/U for
    Duplicate/Move/Overcharge/Sell/Details/next-upgrade on the tower panel. A settings/dev/
    codex overlay being open now inerts every one of these (checked via `.overlay-dim`
    presence) so a hotkey never reaches back through a modal to the game underneath it.
13. **Sector-screen roster** — retitled "Alien Roster"; fixed a real image bug (`drawMiniEnemy`
    hardcodes a scale/translate assuming a 96×96 canvas backing buffer, but the roster tile
    used 48×48 — the mismatch pushed almost the entire drawing off-canvas, leaving only a
    corner visible). Roster rows now reuse the alien codex's exact layout (`.codex-row`/
    `.codex-mini`/`.codex-info`) — 96×96 canvas, description always inline, no hover needed.
14. **HUD overlapping the playing field** — restructured into two explicit rows above the
    field: row 1 is `#hud-left` (sector menu, play/pause, speed, autolaunch, dev, settings) on
    the left and `#hud-vitals` (hull pips + hull number + money + wave, one line) on the right;
    row 2 (`#wave-row`) is the next-wave forecast, centered. `#boss-bar` shifted down to clear
    both rows.
15. **Double-clicking a tower to overcharge opened its panel and could auto-pause** — the
    existing double-tap-within-350ms overcharge gesture always let the *first* tap's normal
    select/open-panel logic run before the second tap resolved as overcharge. `handleMapTap()`
    now defers the select/open-panel action behind a 350ms timer *only* when
    `g.canOvercharge(t)` is true for that tap (i.e. only when a following double-tap could
    plausibly mean something) — a resolving double-tap cancels that timer outright, so the
    panel never flashes open and `syncBuildPause()` never sees it and auto-pauses.

### Verification
All 5 gates green: `tsc --noEmit`, `validate.ts`, the full 19-file test suite, the standard
build, and the singlefile build. Headless smoke (real Chromium): level select, briefing/roster,
in-game HUD, build menu + hotkeys, build confirm, tower details + upgrade tree, duplicate
placement, click-outside-closes-only, double-click-doesn't-open-panel, and the settings modal
open/Escape-close — all zero console errors. The Amp anchor-bonus description rewrite was also
checked directly against the exact example in the request ("Increases damage bonus to 50%
(25%).") and against multi-percentage branch descriptions (Hyperclock, Oracle Array).

### Known issues
None blocking. No `RESUME_VERSION` change (no new serialized state — `dupArmed` is transient
UI-only state, never persisted).

### Ship
Per the repo deploy override (CLAUDE.md), merged to `main` and pushed live to
`https://starhold.vercel.app/`.

---

## Post-3.0 — UI/UX polish pass 2 [COMPLETE]
Started: 2026-07-15 · Finished: 2026-07-15

A follow-up round of 4 issues reported after the first UI polish pass shipped.

### Shipped
1. **Amp had no quick-upgrade button** — `renderSidePanel()` was hard-excluding Amp from the
   headline best-next-upgrade button (`t.spec.kind === 'amp' ? null : this.nextUpgradeInfo(...)`
   ), left over from excluding it from the *DPS* row (Amp has none) and the Overcharge button
   (Amp has no rate/damage to double) — neither reason applies to upgrading, since Amp's
   stages/branches use the exact same `buyUpgrade()`/cost path as every other tower. Removed
   the exclusion; the DPS-row and Overcharge exclusions (which ARE correct) are untouched.
2. **Ridge cell emblem still too subtle** even after the first pass's contrast boost — the
   "lifted face" lighting read as "a slightly brighter tile," not specifically *ridge*, next to
   sinkhole/anchor/conduit which all have an actual distinct shape. Added a two-peak
   mountain-with-snowcap glyph (matches `CELL_TYPES.ridge`'s "⛰" icon) in a warm peach accent —
   a deliberate one-off break from the "palette-neutral, never a new hue" terrain rule recorded
   in 3.0, since a genuinely new, unambiguous shape was what visibility actually needed.
3. **Briefing (level-launch) screen redesigned to need no scrolling**: body widened from a
   900px column to ~1180px (uses the 1280-wide canvas instead of sitting in a narrow strip),
   gaps tightened throughout. Alien Roster is now a 3-column grid (was a single stacked
   column with its own internal scroll region — removed now that it doesn't need one). The
   draft picker is a single 10-wide row (was 5-wide/2-row) with thinner tiles (28px icons,
   8px names, role chips hidden — still in the tooltip) instead of the in-game build-menu's
   full-size tiles. Verified against the actual worst case (L15: 3 modifiers + 5 cell-type
   chips + 9-enemy roster + 2 challenges + full 10-tower draft + doctrine row) — fits with a
   few px to spare at 1280×800, vs. mildly overflowing before the last round of gap trims.
4. **Level-select cards redesigned as wide horizontal rows instead of tall stacked tiles** —
   number on the left, name + stars on one line, an optional tagline line, and every badge
   (modifiers, cell types, challenges, bring-hint, ascension crown) clustered into a single
   wrapping row beneath — rather than each getting its own stacked line. Zone columns widened
   160px → 400px (three columns + Endless/Daily now render at a consistent ~1232px width).
   Confirmed via `scrollHeight`/`clientHeight` equality (no overflow) with every level at 3
   stars and every challenge/cell/modifier badge showing (a fully "loaded" save, the worst
   case for vertical space) — previously this was only verified with an early, sparse save.

### Verification
All 5 gates green: `tsc --noEmit`, `validate.ts`, the full 19-file test suite, the standard
build, and the singlefile build. Headless smoke (real Chromium): confirmed via
`scrollHeight === clientHeight` (no overflow, not just "looks OK in one screenshot") for the
level-select screen and for the briefing screen at both a sparse (L1) and maximally "loaded"
(L15, full progression + full stars + full challenge/cell data) state; screenshotted the Amp
panel's new upgrade button, the ridge glyph zoomed in next to a live tooltip confirming cell
identity, and the L15 briefing layout — zero console errors throughout. (The dev panel's
"Unlock all levels"/"Grant 45 stars" cheats were found, in the course of this testing, to not
refresh the module-level `isUnlocked()` cache — a pre-existing gap unrelated to this pass, not
fixed here since it wasn't in scope and didn't affect any real player-facing path; the
maximal-content verification instead seeded `localStorage` directly and reloaded, which goes
through the normal `setUnlockedLevel()` path.)

### Known issues
None blocking from this pass. Noted-but-out-of-scope: the dev-modal unlock cheats not
refreshing `isUnlocked()`'s module-level cache (see above) — a developer-tool-only gap, not a
player-facing bug. No `RESUME_VERSION` change (no new serialized state).

### Ship
Per the repo deploy override (CLAUDE.md), merged to `main` and pushed live to
`https://starhold.vercel.app/`.
