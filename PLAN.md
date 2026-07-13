# STARHOLD 2.0 — Master Execution Plan (v3)

**Owner:** Kevin. **Executor:** Claude (any future session — read this whole file plus PROGRESS.md before touching code).
**Goal:** transform Starhold from a feature-complete TD into a genuinely fun, tense, replayable game, then make it fully mobile (Samsung S23+, landscape) with PWA support.

Kevin's diagnosis to fix: lack of challenge, sameness between levels, no tension in progression.
Design levers: forced adaptation (mutators/elites/boss phases), level identity (modifiers), telegraphed
threats + risk/reward loops (tension), one-new-concept-per-level onboarding, deep post-campaign replayability.

---

## SESSION BOOTSTRAP PROTOCOL (start of EVERY phase)

Sandbox resets between sessions. Every phase begins:
1. Restore source: unzip `starhold-source.zip` (Kevin re-uploads, or `/mnt/user-data/outputs/`) into `/home/claude/starhold`. `npm install`.
2. Verify gates BEFORE changes: `npx tsc --noEmit` clean AND `node --experimental-strip-types validate.ts` passes.
3. Read PLAN.md + PROGRESS.md fully.

END of EVERY phase: tsc clean → validate passes → `npm run build` + `npx vite build --config vite.singlefile.config.ts`
→ `cp dist-single/index.html /mnt/user-data/outputs/starhold.html` → re-zip source (INCLUDING PLAN.md/PROGRESS.md/tests)
to `/mnt/user-data/outputs/starhold-source.zip` (exclude node_modules, dist, dist-single) → present_files both → report.
**Game must be fully playable at end of every phase. Never end mid-refactor.**

## ARCHITECTURE RULES (all phases)
- All new tunables live in one exported `TUNING` object in `data.ts`.
- All new player-facing systems check `isUnlocked(id)` (built in Phase 1).
- Every new stateful field on `Game` gets a `// SERIALIZE:` comment (Phase 6 builds the resume system mechanically from these).
- All banners/toasts route through the notification choreographer (Phase 1). Never create standalone popups.
- Deterministic randomness (daily op, asteroid seeding) uses rng.ts mulberry32/hashString only.

---

## PHASE 1 — Foundations & Plumbing  [STATUS: see PROGRESS.md]
1. Write PLAN.md + PROGRESS.md (this).
2. Save schema v2 (save.ts): add `seen: Record<string,boolean>`, `challenges: Record<number,boolean[]>`,
   `ascension: {current:number; bestPerLevel:Record<number,number>}`, `endlessBest: Record<number,number>`,
   `endlessMilestones: Record<number,number[]>`, `daily: {lastDate:string; lastWon:boolean; streak:number; bestStreak:number}`,
   `stats: {kills, wavesCleared, towersBuilt:Record<string,number>, elitesSlain, novasFired, bestCombo, sessions, leaksByEnemy:Record<string,number>}`,
   `chromaUnlocked:boolean, chromaOn:boolean`, `lastSpeed:number`, `defaultTargeting:string`, `resume?:string`.
   `migrateSave(old)` idempotent; pre-marks ALL `seen` flags when `unlocked > 1` (veterans not toast-spammed).
3. Unlock gating: `UNLOCKS` table in data.ts: combo:2, challenges:2, interest:3, drops:4, mod_asteroids:4,
   elites:5, boss_theater:5, mutators:6, mod_veins:6, nova:7, mod_meteors:8, mutators_hard:9, boss_phase2:10,
   mod_combo:10, mod_ionstorms:12. `isUnlocked(id)` reads `save.unlocked` (highest level REACHED, not level being played
   — veterans replaying L1 get the full sandbox).
4. Notification choreographer (ui.ts): single queue, 3 tiers. Critical (boss entrance, meteor warning): interrupts,
   never queued behind anything. Medium (mutator banners, phase changes, zone text): one at a time, ~2.5s, queued.
   Low (tutorial/milestone toasts): bottom-center card, suppressed while boss alive or critical showing, 8s or tap
   to dismiss, max one visible. Route ALL existing onBanner calls through it.
5. `toastOnce(key, text)` — fires only if `!save.seen[key]`, then marks.
6. rng.ts: `mulberry32(seed)`, `hashString(s)`.
7. QoL: persist lastSpeed (restore at level start), defaultTargeting setting (new towers spawn with it),
   `fmt(n)` compact formatter (1.2k/3.4M) on HP bars/tooltips/floaters.
8. validate.ts scaffold: UNLOCKS ids sane; TUNING present; migration round-trips (idempotent).
Exit: gates green; game identical except QoL; migration validated.

## PHASE 2 — Core Engagement Loop
1. KILL COMBO (gate combo): kills within 1.6s chain. Milestones 5/10/20/35/50 → floater "COMBO ×N!",
   credits +5/+12/+25/+45/+70, rising pentatonic blip audio.comboBlip(step). HUD counter appears ≥3 (top-center
   under stats, pulse on increment). Breaks on 1.6s silence OR any leak. 50ms hit-stop on milestone.
   Track stats.bestCombo. toastOnce on first ×3.
2. INTEREST (gate interest): wave clear +6% of banked credits, cap +60 (TUNING). Floater "Interest +N ◆";
   credits pill shows faint "▲N" pending preview during waves. toastOnce first payout.
   KNOWN ACCEPTED EXPLOIT: sell-all-before-clear, bounded by cap. Do not fix; note in PROGRESS.md.
3. ELITES (gate elites): non-boss spawn roll 3% + levelIdx*0.4% + diffTier*2% (+0.3%/wave endless).
   Elite = ×1.35 size, ×4.5 HP, ×3 bounty, +1 leak dmg, gold pulsing outline + crown particles, one affix:
   Shielded(30% shield)/Swift(+30% speed)/Vampiric(heal nearby 8/s). Affix in hover tooltip. Death: burst +
   credit shower + hit-stop. FIRST elite scripted: L5 first play, wave 3 injects one elite drone alone + toast.
4. SUPPLY DROPS (gate drops): active waves, every 20–30s 35% roll → drifting crate (never over path tiles,
   ≥80px from edges; 10s life; blink last 3s). Tap collect: credits 40–90(45%) / ability recharge(20%) /
   Overclock all towers +40% rate 8s(20%) / hull +2(15%). First crate scripted L4 wave 2 + toast.
   Tap radius ≥44px effective (mobile-ready now).
5. Haptics stub: buzz(pattern) wraps navigator.vibrate, settings toggle (default on for coarse pointers);
   wire combo milestones + elite kills.
Exit: veteran save at L5+ shows all four; fresh-save sim shows none before their gates (interest at L3).

## PHASE 3 — Wave & Level Identity
1. MUTATORS (gate mutators): Frenzied ⚡ +40% speed · Armored 🛡 +30%-of-HP shield · Bounty 💰 +60% rewards ·
   Horde 🐝 +50% count −25% HP · Regenerating ✚ 2%/s heal (gate mutators_hard) · Phasing ◇ 20% gain blink
   (gate mutators_hard). Chance from wave 4: 12% + levelIdx*1.5% + diffTier*5%; endless ≥w10: 40%;
   no back-to-back before L10. FIRST mutator forced Bounty. Icon+name in wave-preview pill + medium banner at launch.
2. FORECAST: preview bar shows next TWO waves (current pill + smaller dimmed second), composition + mutator icons.
3. LEVEL MODIFIERS (LevelSpec.modifiers):
   - asteroids (mod_asteroids): 6–10 blocked rocky cells, seed hash(levelId+'ast'), NEVER on path (deterministic re-roll).
   - rich-veins (mod_veins): 3–4 glitter cells; tower on one earns +2 credits per kill it lands.
   - meteors (mod_meteors): every 25–35s target occupied-or-adjacent cell; critical warning ring 3s; strike
     disables tower 6s; 25% leaves 20-credit tappable fragment.
   - ion-storms (mod_ionstorms): every ~40s an 8s horizontal 2-row band, −30% fire rate inside; band highlighted
     4s ahead (critical).
   Assignment: L4 asteroids · L6 veins · L8 meteors · L10 asteroids+veins (mod_combo) · L12 ion ·
   L13 meteors+veins · L14 meteors+ion · L15 asteroids+meteors+ion · endless rotates seeded per-run.
   Icons + one-liners on level cards + start banner + toastOnce each first appearance.
4. LEGIBILITY: `counters: string[]` per enemy in data.ts; "Weak to: [icons]" in codex + hover tooltip.
   Audit every enemy has a clear best answer.
Exit: validate asserts modifier table valid; asteroid seeding never intersects path across 15 levels × 3 meander
tiers × 3 tile sizes; forecast fits 1280 width.

## PHASE 4 — Spectacle
1. BOSS THEATER (gate boss_theater): 3s entrance — klaxon, red edge vignette, letterboxed "⚠ NAME ⚠" (critical),
   landing shockwave. Top-center boss bar (name, shield segment, phase tick at 50%). Death: confetti + 1.5s slow-mo
   + zone-clear treatment L5/L10/L15.
2. PHASE 2 at 50% (gate boss_phase2 — Mothership L5 has NO phase 2, first boss stays simple):
   Mothership wisps ×2 + speed +30% · Colossus EMP radius ×2 + speed +20% after each EMP ·
   Leviathan directional rotating shield arc (uncovered arc takes damage; 30°/s; visible glowing arc).
   FALLBACK: if arc fights damage pipeline after ~45min effort → "shield fully regens once at 50%", log deviation.
3. NOVA (gate nova): meter per kill (elite ×4, boss ×20; full ≈90 kills). Button above abilities ignites when full.
   Fire: 1.2s buildup (darken, hum) → screen shockwave 400 dmg all (bosses half), 0.5s slow-mo, shake + haptic,
   credit floaters. Recharge requirement +40% per use per level. toastOnce on unlock.
4. JUICE: floating damage numbers (settings toggle, default on; crits yellow/larger; fmt()); wave-clear final-kill
   0.4s slow-mo + flash; hull<25% red vignette + heartbeat audio layer; pitch variance on kill pops.
5. ADAPTIVE MUSIC: layers — base pad (always) + arp (wave active) + percussion (boss alive or hull<25%); 1s crossfade.
6. ACCESSIBILITY: "Reduce flashing" (NOVA flash→fade; meteor flash softened) + "Reduce motion" (folds screen-shake
   toggle + disables slow-mo + hit-stop). Honored everywhere.
Exit: dev-jump L5/L10/L15 verifying entrance/bar/phase; NOVA with both toggles on/off.

## PHASE 5 — Player Journey
1. GUIDED FIRST BUILD (fresh saves, L1 only): pulse a good cell near first bend → highlight confirm → point at
   Launch once. Three steps, then silence forever (seen-keyed).
2. CHALLENGES (gate challenges): 2 per level L2–L15 (28 total). Pool: Perfect hull / Minimalist ≤6 towers /
   Specialist ≤2 types / No abilities / Speedrunner all-early / Never sell / Win on Hard+. Author in levels.ts,
   mindful of modifiers (no Minimalist on asteroid level). +1 star each once (save.challenges). Level-card badge
   slots + pre-level briefing line + results evaluation.
3. DEFEAT POST-MORTEM: which wave broke you; hull damage by enemy type + counter hint (Phase 3 counters data);
   big Retry (instant) + Change Loadout. Track stats.leaksByEnemy.
4. VICTORY CELEBRATION: stars punch in sequentially + sound + haptic; challenge badges flip; record callouts;
   skippable by tap.
5. PER-TOWER STATS: damage dealt, kills, credits earned (veins incl.), cost efficiency in detail panel header.
6. ZONE FLAVOR: one sentence per zone, medium banner on first entry (seen-gated) + title tagline. Write the 3 lines.
7. DIFFICULTY SMOOTHING: L1–L2 −10% pressure; feature-set compensation applies from L5 ramping full by L10
   (document exact hpMul numbers in PROGRESS.md).
Exit: fresh-save sim L1→L6 confirms one-new-concept cadence; defeat screen verified by losing on purpose.

## PHASE 6 — Replayability
1. ASCENSION I–V (beat L15 at tier N-1 to unlock N; selector on level select post-completion). Cumulative:
   I +20% HP · II mutation +15pts & from wave 2 · III elite ×2 & dual affixes · IV −25% start credits & interest
   cap 30 · V intermissions −40% & meteors on every level. Crown badges (best per level); all-15-at-V = title
   flourish + "Warmaster".
2. DAILY OP: seed hash(YYYY-MM-DD) → picks beaten level, 1–2 forced modifiers, mutator +25pts, Hard difficulty,
   MIRRORED path (x-flip waypoints BEFORE grid snap — upstream of meander; re-run meander fuzz on mirrored inputs).
   Card shows composition + streak (win stamps; missed day resets current, best kept).
3. ENDLESS: per-difficulty best-wave records on card; milestone stars w10/20/30 per difficulty (one-time);
   endless inherits full mutator/elite/modifier rotation from wave 1.
4. CHROMA: all 28 challenge stars → alternate palette (CSS var set) + settings toggle + title treatment.
5. SERVICE RECORD: stats screen off level select.
6. MID-LEVEL RESUME: serialize at each WAVE CLEAR (not per-frame): towers (spec id, cell, stage/branch/branchStage,
   mode, spent, stats), wave index, credits, hull, cooldowns, NOVA charge, combo, modifier runtime, RNG state →
   save.resume (version-stamped; mismatch = graceful discard). On open: "Resume Level N — Wave M?" Resume/Abandon.
   Enemies mid-wave NOT serialized (wave-clear snapshots only — accepted simplification).
7. BALANCE 2: spot-check Ascension III & V economies via validate model; nudge TUNING.
Exit: 30 sampled dates → identical daily ops across two runs; resume round-trip in dev mode; mirrored fuzz passes.

## PHASE 7 — Mobile & PWA (S23+, landscape)
1. Pointer Events unification; touch-action:none; kill double-tap zoom/selection/context menu/pull-to-refresh.
2. Touch: tap=click (2-step confirms already safe). Long-press 450ms alien = tooltip (till lift); long-press
   tower = range peek. Build-menu range preview on touch-rest. Audit ALL hover-only affordances.
3. Coarse UI (matchMedia pointer:coarse → isCoarse): icon buttons 40→56px; ≥44px targets everywhere;
   tower panel → bottom sheet (full-width, drag handle, internal scroll); build menu → centered sheet;
   dev modal/settings/codexes reachable.
4. Orientation/safe-area: portrait → "Rotate 🔄" overlay + pause; viewport-fit=cover + env(safe-area-inset-*).
5. Sharpness: backing store min(devicePixelRatio,2) × displayed size, context scaled.
6. PERFORMANCE MODE (auto on coarse, manual toggle): particle cap 250 oldest-culled; NO backdrop-filter
   (solid ~0.92 fallback); starfield −40%; simple shadows. visibilitychange → pause + audio suspend.
   Frame watchdog: >20ms avg 3s → drop one effect tier.
7. Haptics full wiring: NOVA, boss death, hull hit, victory stars (toggle respected).
8. PWA (deployed build only): manifest.webmanifest (fullscreen, landscape, theme #14152a), SVG icon →
   192/512/maskable PNGs via sharp at build, service worker precaching hashed assets (cache-first, versioned),
   registration guarded by https: so SINGLE-FILE starhold.html stays untouched; iOS meta fallbacks;
   audio unlock on first pointerdown.
Exit: 846×390 coarse screenshots (HUD, sheets, portrait overlay); PWA self-audit; single-file boots with SW inert.

## PHASE 8 — Tests, Final Balance, Ship
1. Node unit tests (/tests): combo timing/milestones; interest cap; mutator application; elite distribution
   (10k rolls); NOVA decay; challenge predicates; drop weighting; unlock gating fresh-vs-veteran; ascension
   stacking; migration idempotency; daily determinism; streak across dates; resume round-trip; mirrored+meander fuzz.
2. Headless smoke best-effort: apt-get chromium + puppeteer-core → 60s scripted L1 at 3×, zero console errors,
   desktop + 846×390 screenshots. If chromium won't install: SAY SO, ship ?selftest=1 in-page harness
   (500-tick sim, PASS/FAIL to console) runnable on the S23+.
3. Final balance sweep across difficulty × ascension grid; final TUNING table in PROGRESS.md.
4. Deliverables: bundles; source zip (PLAN/PROGRESS/tests/PWA assets); CHANGELOG.md; DEVICE-CHECKLIST.md for
   Kevin's S23+ (portrait overlay, smallest targets, long-press, sheet drag, audio-after-tap, PWA install from
   Vercel, offline relaunch, 10-min thermal, NOVA ± reduced-flashing, resume after tab kill).

---

## RISK REGISTER
(a) 28 handcrafted challenges — some mistuned. (b) Leviathan arc experimental — fallback in Phase 4.
(c) No physical device — DEVICE-CHECKLIST load-bearing; expect one tuning round from Kevin's real play.
(d) Ascension V simulated not felt. (e) Sell-then-interest exploit accepted (cap-bounded).
(f) Resume = wave-clear snapshots only, by design. (g) Interrupted phase: PROGRESS.md + // SERIALIZE: comments
+ this plan are the recovery path.

## GAME CONTEXT CHEAT-SHEET (for a cold-start session)
Vite + TypeScript, no framework. 1280×720 logical canvas, CSS-scaled. src/: game.ts (engine ~2600 lines),
ui.ts (~1500), data.ts (towers/enemies/meta/TUNING), levels.ts (15 levels + endless), audio.ts (procedural),
save.ts (localStorage 'starhold-save-v1'), style.css. validate.ts = headless data checks
(node --experimental-strip-types validate.ts). Grid: unified tiles incl. 1-wide path; ranges = circle-overlap
cells (jagged circle); meander system bends paths (fuzz-tested, never self-crosses). Build/move are 2-step
ghost+confirm. 10 towers × 3 branches × 2 tiers; full refunds; amp buffs dmg/rate/range/crit/burn. 13 enemies
incl. 3 bosses. Settings: tile size, meander, difficulty (5), game length (5), pause-on-build, sounds sub-modal.
Dev mode: ⚑ button / Ctrl+Shift+D / ?dev=1.
