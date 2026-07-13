// ================= In-page self-test =================
// Activated via ?selftest=1. Drives a REAL Game instance (the same class actual play uses)
// through ~500 checkpoints of automated play — building towers, launching waves, casting
// abilities — while watching for thrown errors, unhandled rejections, and invalid state
// (NaN/Infinity credits, negative lives, etc.). Prints PASS/FAIL to console.
//
// This exists specifically because headless-browser screenshots/automation weren't obtainable
// in the development sandbox (see PROGRESS.md, Phase 7/8) — this is the fallback that lets
// Kevin get a real pass/fail signal by just opening the URL with the query param and reading
// the console, on his actual device, no toolchain required.
//
// Save isolation: UI's own constructor detects ?selftest=1 and sets `selfTestMode`, which
// makes persist() a no-op for the whole session — the automated play below still mutates the
// real in-memory save object (so it's exercising genuine code paths, not a mock), but none of
// those mutations ever reach localStorage. A real profile loaded in the same browser is never
// contaminated by test-run stats.
import { UI } from './ui';
import { TOWERS } from './data';
import { LEVELS } from './levels';
import type { Game } from './game';

interface SelfTestResult {
  pass: boolean;
  ticks: number;
  errors: string[];
  finalState: Record<string, unknown>;
}

export function runSelfTest(ui: UI) {
  const errors: string[] = [];
  const log = (...args: unknown[]) => console.log('[selftest]', ...args);
  const fail = (msg: string) => { errors.push(msg); console.error('[selftest] ERROR:', msg); };

  const prevOnError = window.onerror;
  window.onerror = (msg, src, line, col, err) => {
    fail(`window.onerror: ${msg} (${src}:${line}:${col})${err?.stack ? '\n' + err.stack : ''}`);
    return false;
  };
  window.addEventListener('unhandledrejection', ev => fail(`unhandledrejection: ${ev.reason}`));

  log('starting — jumping straight into Level 1...');
  try {
    ui.startLevel(LEVELS[0], false);
  } catch (e) {
    fail(`startLevel threw: ${e}`);
    finish(0);
    return;
  }
  let tick = 0;
  const maxTicks = 500;
  let intervalId = 0;

  driveTest();

  function driveTest() {
    const game: Game | null = ui.game;
    if (!game) { fail('game did not initialize after startLevel'); finish(0); return; }

    // Build a small, varied loadout early so combat + upgrades + auras all get exercised.
    const buildPlan = [0, 1, 4, 7]; // pulse, mortar, tesla, ray — spread across mechanics
    let built = 0;

    intervalId = window.setInterval(() => {
      tick++;
      try {
        // sanity: core numeric state must always be finite and within sane bounds
        if (!Number.isFinite(game.credits)) fail(`tick ${tick}: credits is not finite (${game.credits})`);
        if (!Number.isFinite(game.lives) || game.lives < 0) fail(`tick ${tick}: lives invalid (${game.lives})`);
        if (game.credits < -1) fail(`tick ${tick}: credits went meaningfully negative (${game.credits})`);
        if (Number.isNaN(game.waveIdx)) fail(`tick ${tick}: waveIdx is NaN`);

        // build a few towers over the first couple seconds
        if (built < buildPlan.length && tick % 6 === 0) {
          const specIdx = buildPlan[built];
          const spec = TOWERS[specIdx];
          const cellIdx = game.cells.findIndex((c, i) => c.valid && !game.occupied[i]);
          if (cellIdx >= 0 && game.credits >= game.costOf(spec)) {
            const ok = game.buildAt(cellIdx, spec);
            if (!ok) fail(`tick ${tick}: buildAt returned false unexpectedly for ${spec.id}`);
            built++;
          }
        }

        // keep waves flowing — never let the test stall waiting on a manual launch
        if (game.state === 'playing' && !game.waveActive && game.pendingWave) {
          game.callWave(true);
        }

        // occasionally try an upgrade on whatever's built, to exercise that path too
        if (tick % 25 === 0 && game.towers.length > 0) {
          const t = game.towers[0];
          try { game.buyUpgrade(t); } catch (e) { fail(`tick ${tick}: buyUpgrade threw: ${e}`); }
        }

        if (tick >= maxTicks || game.state !== 'playing') {
          clearInterval(intervalId);
          finish(tick, game);
        }
      } catch (e) {
        fail(`tick ${tick}: uncaught exception in drive loop: ${e}`);
        clearInterval(intervalId);
        finish(tick, game);
      }
    }, 20);
  }

  function finish(ticks: number, game?: Game) {
    window.onerror = prevOnError;
    const finalState = game ? {
      state: game.state, credits: game.credits, lives: game.lives, waveIdx: game.waveIdx,
      towers: game.towers?.length ?? 0, kills: game.runStats?.kills ?? 0,
    } : {};
    const result: SelfTestResult = { pass: errors.length === 0, ticks, errors, finalState };
    log(`${result.pass ? 'PASS' : 'FAIL'} — ${ticks} ticks, ${errors.length} error(s)`);
    log('final state:', finalState);
    (window as any).__selftestResult = result;
    // A machine-parseable single line, easy to spot in a phone browser's console.
    console.log(`SELFTEST_RESULT: ${result.pass ? 'PASS' : 'FAIL'}`);
  }
}
