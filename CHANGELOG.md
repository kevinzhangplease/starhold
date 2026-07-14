# STARHOLD 3.0 — Changelog

Starhold 2.0 was feature-complete but shallow in places: placement was consequence-free,
maps differed only in path shape, most upgrades were just bigger numbers, and the screen
buried the one thing you needed to know — am I about to lose? 3.0 fixes all of that. Grouped
by how it feels, not by build order. See `PROGRESS-3.md` for the technical/decision log and
`PLAN-3.md` for the spec. (The 2.0 changelog follows below, unchanged.)

---

## Every decision costs something now

- **Placement is a real choice.** Selling a tower now returns 72% of what you spent — except
  in the first 4 seconds after you place it, which is a full-refund undo window for a misclick.
  No more shuffling your whole board for free between waves.
- **Calling waves early pays a real bonus** — a percentage of the incoming wave's bounty, scaled
  by how much of the timer was left (up to +40%). The call button shows the live number ticking
  down. Auto-launch earns none of it: the bonus rewards a deliberate risk, so there's a genuine
  decision to make every intermission.
- **The whole economy holds its value.** Every credit reward — bounties, combos, crates, veins,
  wave-clear, interest — now scales with the campaign, so late levels feel as tight (or as
  generous) as early ones by design, not by accident.
- **Abilities that scale.** Orbital Strike's damage grows with the invasion instead of fading
  to a tickle by L15. NOVA now tears a *percentage* of health from everything on screen (30%
  from normal enemies, 8% from bosses) and stuns the survivors — crowd control that stays
  meaningful at any scale. Reactor meta upgrades are percentages now too.
- **Stars measure skill, not luck.** 3★ means losing no more than 2 hull, 2★ no more than 8 —
  absolute counts, so Hull Plating never makes the top rating easier to earn.

## The board itself speaks

- **Special terrain.** Five cell types now shape *where* things belong: Ridge (more range, less
  fire rate — for your snipers), Sinkhole (more damage, less range — for your short-range
  bruisers), Conduit (linked cells whose towers focus the same target), Anchor (an Amp here
  projects double-strength buffs), and Null Zone (unbuildable, but it drags passing ground
  enemies to a crawl). Long-press or hover any marked cell to see what it does and what belongs
  there. Every map has its own hand-picked mix.

## Every map looks — and plays — like itself

- **Persistent skies.** Each level now generates the same nebulae, stars, and hand-placed
  landmarks (planets, moons, derelicts, stations, comets) every single time — a sky you'll
  recognize on the bus.
- **The road reads as a road.** A recessed channel with little chevrons marching toward your
  base, and portals that visibly charge up — in the color of whatever's about to spawn — a
  couple seconds before it arrives.
- **Two levels rebuilt.** Shatterfield is now a fork-and-rejoin, and Void Door is two portals
  converging on your base from both flanks — real structural variety, not just a wigglier line.
- **A cleaner-looking battlefield.** Towers went cool and calm, enemies went warm and bright,
  so they stop blurring together at phone size; big enemies got genuinely bigger so threat
  reads from silhouette; and hits and deaths feel physical now — a squash, a nudge, bespoke
  debris when a Brute cracks apart. There's a colorblind-friendly palette in Settings, and the
  Chroma unlock finally re-themes the actual board, not just the menus.

## Towers you protect, not replace

- **Range costs what it's worth**, cross-tower **reactions** reward mixing (frozen enemies
  *Shatter* on death, burning enemies take extra from Tesla *Conduction*, a chilled kill won't
  break a Prism's *Cold Focus* ramp), and Flame now stacks its burn up to 3× on a held target.
- **Overcharge** — tap a tower mid-wave and hit ⚡ to double its fire rate for a few seconds,
  three charges a wave. The verb you reach for when a wave breaks through.
- **Veterancy** — a tower that lands 45 kills becomes a Veteran and earns a permanent perk you
  choose (more damage, more fire rate, or credits-per-kill). Selling it forfeits the perk — so
  now you have a reason to defend one proven tower instead of reflexively rebuilding.

## Waves you read, not memorize

- **Wave shapes.** A wave can arrive as a Rush (all at once), a Trickle (one at a time), a
  Convoy (a tank leading its support), or a Feint (a small opener, then a second group later
  from somewhere else). Shown in the forecast before you commit.
- **Flier lanes that change.** Fliers now curve along a per-wave path you can see previewed as
  a dashed arc during the intermission — anti-air became a real per-wave read instead of a
  solved formula.
- **Difficulty changes what you think about.** Hard smuggles an extra enemy type into every
  wave; Brutal jams your long-range forecast so you only see the wave in front of you.

## You can see — and hear — what's happening

- **A HUD that answers your real questions, in order.** A segmented hull bar that cracks pip by
  pip as you take hits; a leak ledger showing which enemy is actually costing you hull; and a
  **threat readout** that reads your coverage against the incoming wave and tells you
  Comfortable / Tight / Likely leak before you launch. The tower panel is now one tap to the
  decision that matters, with the full tech tree one tap further.
- **Audio you can read with your ears.** Each enemy type has its own spawn sound, a mender hums
  while it's alive so you can hear it without hunting, the music opens up as pressure builds,
  kills sound heavier the bigger the thing was, leaks groan lower the closer you are to losing,
  and one unmistakable bell marks every credit you earn. Everything audible has a visual twin,
  so muted play loses nothing.

## A hundred ways to replay

- **The Briefing screen.** Tap a level and you'll see its identity first — modifiers, terrain,
  the full enemy roster, its challenges — before you commit.
- **The draft.** From level 6 on, you choose which towers to bring (the draft grows as the
  campaign does). "Which 6 of my 10 answer *this* map?" — with a "use full arsenal" toggle any
  time you'd rather not. The Daily Op hands everyone the same locked draft.
- **Doctrines.** A new permanent-upgrade layer — Artillery, Precision, or Logistics — one active
  at a time, switchable for free before any level. Your overall approach for the run, chosen
  fresh each time.

---

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
