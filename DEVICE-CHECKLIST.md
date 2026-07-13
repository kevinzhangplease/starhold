# STARHOLD 2.0 — Device Checklist (Samsung S23+)

Context: all of Phase 7's mobile/touch work was built and reasoned through carefully, but
**never actually seen rendered** — the dev sandbox couldn't run a headless browser (see
PROGRESS.md, Phase 7 and 8). Everything below is real verification, just not visual. This
checklist is where that gap gets closed. The first section is the stuff most likely to be
actually broken; the rest is normal pre-ship diligence.

**How to test:** open the deployed Vercel URL on the S23+ in Chrome, in landscape. For the
items involving Chrome's remote debugger, connect the phone to a computer via USB and open
`chrome://inspect` on the computer — you'll get the phone's console output live, which is the
easiest way to catch errors you can't otherwise see.

---

## Priority 1 — never visually verified, most likely to need a fix

- [ ] **General layout at S23+ landscape resolution.** Does the HUD fit without overlapping
  itself? Is anything cut off at the edges? Compare against how it looked on desktop.
- [ ] **Tower panel bottom sheet.** Tap a tower. Does the panel slide up from the bottom,
  full-width, with a visible drag handle at the top? Is it scrollable if the content is tall
  (a fully-upgraded tower with all 3 branches visible)?
- [ ] **Build menu sheet.** Tap an empty cell. Does the tower-choice menu appear centered,
  readable, with properly-sized icons (not squished into 5 tiny columns)?
- [ ] **Touch targets.** Try tapping the settings gear, the pause button, ability buttons, and
  the smallest tech-tree upgrade nodes. Do they register reliably on the first tap, or do you
  find yourself missing and hitting the wrong thing?
- [ ] **Long-press on an alien.** Hold your finger on a moving alien for about half a second.
  Does its tooltip appear and stay up while you hold? Does it disappear cleanly when you lift?
- [ ] **Long-press on a tower.** Same, but for a range preview — does the range ring show up
  without opening the full tower panel?
- [ ] **2-step build/move still feels right on touch.** Tap an empty cell, pick a tower, and
  confirm the ghost preview + confirm popup all work smoothly with taps (no accidental
  double-builds, no popups appearing in unreachable spots).
- [ ] **Portrait rotation.** Rotate the phone to portrait mid-game. Does the "rotate your
  device" prompt appear cleanly, covering the whole screen? Does the game visibly pause? Rotate
  back to landscape — does it resume exactly where you left off, un-paused?
- [ ] **No accidental browser gestures.** Try double-tapping rapidly on the game area (should
  NOT zoom), try a swipe-down from the top of the screen while playing (should NOT trigger
  pull-to-refresh), try holding your finger on a tower or alien for 2+ seconds (should NOT
  bring up a text-selection or "save image" style menu).

## Priority 2 — feel, not just function

- [ ] **Rendering sharpness.** Does text and tower/alien art look crisp, or soft/blurry? This
  was a specific fix (canvas backing-store resolution) — worth a close look.
- [ ] **Performance over a real session.** Play for a solid 10 minutes. Does the frame rate
  stay smooth, especially during a big wave with lots of particles (explosions, NOVA, a boss
  fight)? Does the phone get uncomfortably hot?
- [ ] **Auto performance mode.** If you notice any slowdown, check Settings — did "Performance
  mode" switch itself to on, with a small toast explaining why? (It's supposed to, after ~3
  seconds of sustained lag.)
- [ ] **Haptics.** Do you feel a buzz on: a combo milestone, an elite kill, a supply crate
  pickup, a hull hit (leak), a boss death, firing NOVA, and stars punching in on the victory
  screen? (Settings > Vibration must be on, which it is by default.)
- [ ] **NOVA with Reduce Flashing on vs off.** Fire NOVA once with the setting off (default) —
  should be a strong white flash. Turn on Settings > Reduce Flashing, fire it again — the flash
  should be noticeably softer. Same check for a meteor strike if you're on a level with that
  modifier.
- [ ] **Audio starts after your first tap**, not before (browsers block audio until a user
  interaction) — confirm you hear sound effects from your very first tap onward, with no need
  to tap twice or dig into settings.

## Priority 3 — PWA / installability

- [ ] **Install from the deployed Vercel URL.** In Chrome, look for the "Add to Home Screen" /
  install prompt (or use the browser menu). Install it.
- [ ] **Launch from the home screen icon.** Does it open full-screen (no browser address bar),
  landscape, with the correct icon and app name ("Starhold")?
- [ ] **Offline relaunch.** With the app installed and opened at least once, turn on Airplane
  Mode (or otherwise kill your connection) and relaunch the app from the home screen. Does it
  still load and play, or does it fail to open?
- [ ] **Update behavior.** If you install now and I ship another update later, reopening the
  app after a new deploy should eventually pick up the new version (may take one relaunch to
  take effect — that's expected service-worker behavior, not a bug).

## Priority 4 — resume & session resilience

- [ ] **Resume after killing the tab.** Play a level partway through (clear at least 2-3
  waves), then force-close the browser tab or app entirely (not just backgrounding it — really
  kill it). Reopen the app. You should see a "Resume Level N — Wave M?" prompt on the title
  screen. Tap Resume — do your towers, credits, and hull come back correctly?
- [ ] **Abandon works too.** Trigger the same resume prompt, but tap Abandon instead. Confirm
  it takes you to the title screen cleanly and doesn't reappear on next launch.
- [ ] **Backgrounding (not killing) the app.** Switch to another app mid-game for 30+ seconds,
  then switch back. Game should be paused, audio silent while away, and resume cleanly.

## Priority 5 — standalone file sanity (lower priority, less likely to be broken)

- [ ] **The single `starhold.html` file** (not the deployed site) still opens and plays
  correctly when opened directly — e.g. downloaded and double-tapped, or opened from a
  messaging app attachment. This one should NOT prompt for install and should NOT have any
  service-worker-related behavior (that's by design — see CHANGELOG.md).

---

## If something's broken

Note which checklist item failed, what you did right before it happened, and — if you have
Chrome's remote debugger connected — copy any red error text from the console. That's usually
enough for a fast, targeted fix rather than another full pass.
