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
