# STARHOLD 2.0 — Changelog

Everything below shipped in this overhaul, grouped by what it's for rather than by build
phase. See `PROGRESS.md` for the technical/decision log, and `PLAN.md` for the original spec.

---

## Bigger, tenser moments

- **Kill combos.** Chain kills within 1.6s of each other for escalating bonus credits and a
  rising musical chime. Any leak breaks the chain — leaks now cost you something beyond hull.
- **Elite enemies.** Occasional gold-crowned aliens with 4.5x HP, 3x bounty, and an affix
  (Shielded / Swift / Vampiric) named in their tooltip. Killing one is a small event —
  hit-stop, shake, a shower of credits.
- **Wave mutators.** From wave 4 on, a wave can arrive twisted: Frenzied, Armored, Bounty,
  Horde, and (later) Regenerating or Phasing. Announced in advance in the wave forecast and
  with a banner at launch, never a surprise.
- **Boss theater.** Bosses now get an entrance — klaxon, red vignette, a named warning banner,
  a landing shockwave — plus a persistent health bar and a genuine phase-2 twist at 50% HP.
  The Leviathan's shield became a rotating directional barrier you have to read and reposition
  around.
- **NOVA.** A kill-charged ultimate: a 1.2-second buildup (the world darkens, a hum rises)
  into a screen-wide shockwave. Recharges slower each time you use it in a level.
- **Juice pass.** Floating damage numbers, hit-stop on big kills, a slow-mo beat on wave clears
  and boss deaths, adaptive music that layers in percussion when a boss is alive or your hull
  is low, and an accessibility pair (Reduce Flashing / Reduce Motion) that actually turns all
  of the above off.

## A living economy

- **Interest.** Banked credits earn 6% at every wave clear (capped), shown live as you decide
  whether to spend or save.
- **Supply drops.** Crates drift across the map during waves — credits, an ability recharge,
  a temporary fire-rate boost, or hull repair.
- **Rich Veins & Asteroid Fields.** Some levels have glittering cells (towers there earn extra
  credits per kill) or blocked rocky cells that force you to route around them.
- **Meteor Showers & Ion Storms.** Some levels get periodic hazards — a warning ring before a
  tower gets knocked offline, or a sweeping band that slows fire rate — always telegraphed
  before they hit.

## Every level has a personality now

- Each level from 4 onward carries at least one of the above modifiers, plus two optional
  challenges (Perfect Hull, Minimalist, Specialist, No Abilities, Speedrunner, Committed,
  Battle-Tested) worth bonus stars.
- Every alien now tells you what beats it — "Weak to: [towers]" in its tooltip and the codex.
- New players meet all of this gradually: one new system roughly every level, with scripted
  first encounters and a guided first build on Level 1. Veterans replaying early levels get
  the full sandbox immediately.

## What happens when you win or lose actually means something

- **Victory** now punches in stars, challenge badges, and any new records one at a time, with
  sound and a haptic tick — tap to skip straight to the end.
- **Defeat** now tells you which wave broke you, which enemy type did most of the damage, and
  what counters it — not just "you lost."
- Every tower now tracks its own lifetime damage, kills, and value-for-money, visible right in
  its detail panel.

## After you've beaten everything

- **Ascension I–V**, a cumulative New Game+: harder enemies, more frequent mutators, more
  elites (sometimes with two affixes), a tighter economy, and eventually a genuinely brutal
  final tier — unlocked one at a time by beating the campaign at the previous one.
- **Daily Op**: one seeded, mirrored remix of a level you've beaten, the same for everyone on
  a given day. Builds a streak.
- **Endless mode** now has real milestone stars and per-difficulty best-wave records, and
  always plays with the full mutator/modifier rotation regardless of your campaign progress.
- **Chroma palette**: an alternate color scheme, unlocked by earning all 28 challenge stars.
- **Service Record**: a lifetime stats screen — kills, waves, favorite tower, best combo,
  streaks, and more.
- **Resume**: the game now saves your exact state at every wave clear, so closing the tab
  (or the browser killing it in the background) doesn't cost you a run in progress.

## On your phone

- Full touch support: tap to build/select, long-press an alien for its stats or a tower for a
  quick range peek, all without hover.
- Bigger touch targets throughout, the tower panel and build menu become sheets on touch
  devices, and a clean "rotate your device" prompt if you turn the phone to portrait.
- Sharper rendering (the canvas now matches your actual screen resolution instead of being
  stretched from a fixed size), a performance mode that kicks in automatically on phones (and
  can self-activate if the game senses it's running slow), and haptics on the big moments.
- **Installable as an app** — add it to your home screen from the deployed site for a
  full-screen, offline-capable experience. The standalone `starhold.html` file is completely
  unaffected by any of this and still works exactly as before.

## Under the hood (worth knowing about, not visible in play)

- A genuine pre-existing bug — Level 8's path crossed itself at one specific spot, unrelated
  to anything in this overhaul — was found via a new automated fuzz test and fixed.
- A real bug in the Daily Op path-mirroring logic (paths could self-cross when mirrored) was
  found the same way and fixed; the fix is now verified by 324 automated trials covering every
  level at every settings combination.
- 9 automated test files now guard the game's core math and logic (combo timing, interest,
  elite/drop probability distributions, ascension stacking, save migration, unlock gating,
  daily-op determinism, resume fidelity, path integrity) — see `tests/run-all.ts`.
