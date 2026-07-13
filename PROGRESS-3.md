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
