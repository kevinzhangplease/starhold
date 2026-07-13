// ================= UI layer =================
import { TOWERS, META, ABILITIES, ZONES, ENEMIES, TowerSpec, EnemySpec, airClass, setUnlockedLevel, fmt, isUnlocked, MUTATORS, MODIFIER_INFO, CHALLENGE_POOL, TUNING } from './data';
import { LEVELS, ENDLESS_LEVEL, LevelSpec } from './levels';
import { Game, Tower, Enemy, W, H } from './game';
import { audio } from './audio';
import { SaveData, loadSave, writeSave, starsEarned, starsSpent } from './save';
import { computeDailyOp, todayStr, daysBetween, DailyOp } from './daily';
import { serializeResume, deserializeResume, ResumeSnapshot } from './resume';

const el = (tag: string, cls = '', html = ''): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

// ================= Notification choreographer =================
// Single funnel for ALL transient on-screen text so popups never fight each other.
// Tiers: critical (boss/meteor warnings) interrupt and preempt; medium (wave/mutator/zone
// banners) queue one-at-a-time; low (tutorial/milestone toasts) show one bottom-center
// card, held back entirely while a boss is alive or a critical is on screen.
class Notifier {
  private root: HTMLElement;
  private medQueue: { text: string; color: string; sub?: string }[] = [];
  private medBusy = false;
  private lowQueue: { text: string }[] = [];
  private lowEl: HTMLElement | null = null;
  private critEl: HTMLElement | null = null;
  bossAlive = false; // maintained by UI.updateHud each frame

  constructor(root: HTMLElement) { this.root = root; }

  clearAll() {
    this.medQueue = []; this.lowQueue = [];
    this.critEl?.remove(); this.critEl = null;
    this.lowEl?.remove(); this.lowEl = null;
    this.root.querySelectorAll('.banner').forEach(b => b.remove());
    this.medBusy = false;
  }

  critical(text: string, color = '#ff8fa3') {
    // preempt: clear any showing medium banner immediately
    this.root.querySelectorAll('.banner:not(.crit)').forEach(b => b.remove());
    this.critEl?.remove();
    const b = el('div', 'banner crit', text);
    b.style.color = color;
    this.root.append(b);
    this.critEl = b;
    setTimeout(() => { b.remove(); if (this.critEl === b) { this.critEl = null; this.pumpLow(); } }, 2200);
  }

  medium(text: string, color = '#eef0ff', sub?: string) {
    this.medQueue.push({ text, color, sub });
    this.pumpMedium();
  }

  private pumpMedium() {
    if (this.medBusy) return;
    const n = this.medQueue.shift();
    if (!n) return;
    this.medBusy = true;
    const show = () => {
      // if a critical is on screen, wait for it
      if (this.critEl) { setTimeout(show, 250); return; }
      const b = el('div', 'banner', n.text);
      b.style.color = n.color;
      b.style.pointerEvents = 'auto'; // overrides .banner's default none — needed for tap-to-dismiss
      b.style.cursor = 'pointer';
      this.root.append(b);
      let subEl: HTMLElement | null = null;
      if (n.sub) {
        subEl = el('div', 'banner banner-sub', n.sub);
        this.root.append(subEl);
      }
      // Duration scales with content length — a short banner keeps the existing comfortable
      // floor, a long multi-item one (challenge briefings, 3-modifier lists) gets real
      // reading time instead of a flat 2100ms regardless of how much text it's carrying.
      // The CSS entrance/hold/exit animation is keyframed by PERCENTAGE, not fixed time, so
      // its own animation-duration must be set to match `dur` too — otherwise it plays out
      // its default 1.6s and the banner sits invisible (opacity:0, already faded) for
      // whatever's left of the extended JS timer, defeating the entire point of this fix.
      const totalLen = n.text.length + (n.sub?.length || 0);
      const dur = Math.max(2100, totalLen * 45);
      b.style.animationDuration = `${dur}ms`;
      if (subEl) subEl.style.animationDuration = `${dur}ms`;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        b.remove(); subEl?.remove();
        this.medBusy = false;
        this.pumpMedium();
      };
      b.onclick = finish; // tap/click to dismiss early — same pattern as the low-tier toast and victory-screen skip
      setTimeout(finish, dur);
    };
    show();
  }

  low(text: string) {
    this.lowQueue.push({ text });
    this.pumpLow();
  }

  pumpLow() {
    if (this.lowEl || this.bossAlive || this.critEl) return;
    const n = this.lowQueue.shift();
    if (!n) return;
    const card = el('div', 'note-toast', n.text);
    card.onclick = () => { card.remove(); if (this.lowEl === card) { this.lowEl = null; this.pumpLow(); } };
    this.root.append(card);
    this.lowEl = card;
    setTimeout(() => {
      if (this.lowEl === card) { card.remove(); this.lowEl = null; this.pumpLow(); }
    }, 8000);
  }
}

export class UI {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  save: SaveData;
  game: Game | null = null;
  current: LevelSpec | null = null;
  isEndless = false;
  isDaily = false;
  currentDaily: DailyOp | null = null;
  devMode = false;
  selfTestMode = false; // when true, persist() no-ops — set by ?selftest=1 so automated test play never contaminates a real save
  scale = 1;

  notify!: Notifier;
  private hudRefs: Record<string, HTMLElement> = {};
  private lastHud = { credits: -1, lives: -1, wave: -1 };
  private abilityBtns: Record<string, HTMLElement> = {};

  // touch/pointer state
  isCoarse = matchMedia('(pointer: coarse)').matches;
  effectivePerfMode(): boolean {
    const p = this.save.settings.perfMode;
    return p === 'on' ? true : p === 'off' ? false : this.isCoarse;
  }
  private downPos: { x: number; y: number } | null = null;
  private downPointerType = 'mouse';
  private longPressTimer: number | null = null;
  private longPressFired = false;
  private pinnedEnemyTip: Enemy | null = null;   // long-press-shown tooltip target, persists till lift

  constructor() {
    this.root = document.getElementById('ui-root')!;
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.selfTestMode = new URLSearchParams(location.search).get('selftest') === '1';
    this.save = loadSave();
    this.notify = new Notifier(this.root);
    setUnlockedLevel(this.save.unlocked);
    this.save.stats.sessions++;
    this.persist();
    this.devMode = new URLSearchParams(location.search).get('dev') === '1';
    audio.apply(this.save.settings);
    document.body.classList.toggle('chroma-theme', !!this.save.chromaOn);
    document.body.classList.toggle('perf-mode', this.effectivePerfMode());

    window.addEventListener('resize', () => this.fit());
    this.fit();
    this.setupOrientationGuard();
    this.setupVisibilityGuard();

    this.canvas.addEventListener('pointermove', ev => {
      if (!this.game) return;
      const p = this.toGame(ev);
      this.game.pointer(p.x, p.y);
      if (this.downPos && this.downPointerType !== 'mouse') {
        if (Math.hypot(p.x - this.downPos.x, p.y - this.downPos.y) > 12) this.clearLongPressTimer();
      }
    });
    this.canvas.addEventListener('pointerdown', ev => {
      audio.ensure();
      if (!this.game || this.game.state !== 'playing') return;
      const p = this.toGame(ev);
      if (ev.button === 2) { this.cancelAll(); return; }
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      this.downPos = { x: p.x, y: p.y };
      this.downPointerType = ev.pointerType;
      this.longPressFired = false;
      if (ev.pointerType === 'mouse') { this.handleMapTap(p); return; }
      // touch/pen: hold to decide between tap, long-press, and drag/scroll
      this.clearLongPressTimer();
      this.longPressTimer = window.setTimeout(() => { this.longPressFired = true; this.handleLongPress(p); }, 450);
    });
    this.canvas.addEventListener('pointerup', ev => {
      if (!this.game) return;
      const p = this.toGame(ev);
      this.clearLongPressTimer();
      this.clearTouchPeeks();
      if (this.downPointerType !== 'mouse' && !this.longPressFired && this.downPos) {
        if (Math.hypot(p.x - this.downPos.x, p.y - this.downPos.y) <= 12) this.handleMapTap(p);
      }
      this.downPos = null;
    });
    this.canvas.addEventListener('pointercancel', () => {
      this.clearLongPressTimer();
      this.clearTouchPeeks();
      this.downPos = null;
    });
    this.canvas.addEventListener('contextmenu', ev => ev.preventDefault());

    window.addEventListener('keydown', ev => {
      if (ev.ctrlKey && ev.shiftKey && ev.code === 'KeyD') {
        this.showDevModal();
        return;
      }
      if (!this.game || this.game.state !== 'playing') return;
      if (ev.code === 'Escape') this.cancelAll();
      if (ev.code === 'Space') { ev.preventDefault(); this.togglePause(); }
      if (ev.code === 'KeyQ') this.armAbility('orbital');
      if (ev.code === 'KeyW') this.armAbility('stasis');
    });

    document.addEventListener('pointerdown', () => audio.ensure(), { once: true });
    this.showTitle();
  }

  physicalScale = 1; // logical-to-physical canvas scale (CSS scale-to-fit x devicePixelRatio)
  fit() {
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    this.scale = s;
    this.canvas.style.width = `${W * s}px`;
    this.canvas.style.height = `${H * s}px`;
    // Backing-store resolution for sharpness: the canvas's actual pixel buffer is sized to
    // its true on-screen CSS size times the device pixel ratio (capped at 2x — diminishing
    // returns beyond that, and it keeps the fill-rate cost sane on phones), rather than
    // being stretched up from a fixed 1280x720 buffer. The context is then scaled by the
    // same factor so all existing drawing code keeps working in logical 1280x720 coordinates.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.physicalScale = s * dpr;
    const backingW = Math.round(W * this.physicalScale);
    const backingH = Math.round(H * this.physicalScale);
    if (this.canvas.width !== backingW || this.canvas.height !== backingH) {
      this.canvas.width = backingW;
      this.canvas.height = backingH;
    }
    if (this.game) this.game.dpr = this.physicalScale;
    const r = this.root;
    r.style.position = 'fixed';
    r.style.left = `${(window.innerWidth - W * s) / 2}px`;
    r.style.top = `${(window.innerHeight - H * s) / 2}px`;
    r.style.transformOrigin = '0 0';
    r.style.transform = `scale(${s})`;
    r.style.width = `${W}px`;
    r.style.height = `${H}px`;
  }
  // The single tap/click action for the map — mouse invokes this immediately on pointerdown
  // (unchanged desktop feel); touch/pen invoke it on pointerup once a genuine tap is confirmed
  // (not a long-press, not a drag past the movement threshold).
  private handleMapTap(p: { x: number; y: number }) {
    const g = this.game;
    if (!g) return;
    // a build or move confirmation is already showing — ignore further map taps
    if (g.pendingBuild || g.pendingMove) return;
    if (g.armed) { g.castAt(p.x, p.y); this.refreshAbilities(); return; }

    // supply crates are transient — tapping one always wins
    if (g.tryCollectDrop(p.x, p.y)) return;

    // moving a tower: this tap chooses the destination cell
    if (g.moveArmed) {
      const idx = g.cellAt(p.x, p.y);
      if (g.tryMoveTo(idx)) this.showMoveConfirm();
      else audio.ui('deny');
      return;
    }

    this.closeBuildMenu();
    const t = g.towerAt(p.x, p.y);
    if (t) {
      g.selected = t;
      audio.ui('click');
      this.renderSidePanel();
      return;
    }
    const e = g.enemyAt(p.x, p.y);
    if (e) {
      g.setFocus(e);
      return;
    }
    g.selected = null;
    this.closeSidePanel();
    const idx = g.cellAt(p.x, p.y);
    if (g.cellFree(idx)) {
      this.openBuildMenu(idx);
    } else {
      g.setFocus(null);
    }
  }

  // Touch/pen only: held ~450ms without moving. Shows a persistent (until finger-lift)
  // enemy tooltip or tower range-peek — the touch equivalent of desktop hover — without
  // performing the normal tap action (building, selecting, focusing).
  private handleLongPress(p: { x: number; y: number }) {
    const g = this.game;
    if (!g || g.state !== 'playing') return;
    const t = g.towerAt(p.x, p.y);
    if (t) { g.peekTower = t; g.buzz([12]); return; }
    const e = g.enemyAt(p.x, p.y);
    if (e) { this.pinnedEnemyTip = e; g.buzz([12]); return; }
  }

  private clearLongPressTimer() {
    if (this.longPressTimer !== null) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
  }
  private clearTouchPeeks() {
    this.pinnedEnemyTip = null;
    if (this.game) this.game.peekTower = null;
  }

  private orientationPausedGame = false;
  private orientationMq = matchMedia('(orientation: portrait) and (pointer: coarse)');
  private setupOrientationGuard() {
    this.orientationMq.addEventListener('change', () => this.checkOrientationPause());
    this.checkOrientationPause();
  }
  // Re-checked on every setupOrientationGuard 'change' event AND right after a fresh game
  // starts (in case the device was already in portrait when the level began).
  checkOrientationPause() {
    if (!this.game) return;
    if (this.orientationMq.matches) {
      if (!this.game.paused) { this.game.paused = true; this.orientationPausedGame = true; }
    } else if (this.orientationPausedGame) {
      this.game.paused = false;
      this.orientationPausedGame = false;
    }
  }

  private wasPausedByVisibility = false;
  private setupVisibilityGuard() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        audio.suspend();
        if (this.game && !this.game.paused) { this.game.paused = true; this.wasPausedByVisibility = true; }
      } else if (this.wasPausedByVisibility && this.game) {
        this.game.paused = false;
        this.wasPausedByVisibility = false;
      }
    });
  }

  toGame(ev: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (ev.clientX - rect.left) / this.scale, y: (ev.clientY - rect.top) / this.scale };
  }

  clearUI() { this.root.innerHTML = ''; this.hudRefs = {}; this.abilityBtns = {}; this.notify.clearAll(); }
  persist() { if (!this.selfTestMode) writeSave(this.save); }
  starsAvail() { return starsEarned(this.save) - starsSpent(this.save, Object.fromEntries(META.map(m => [m.id, m.cost]))); }

  cancelAll() {
    if (!this.game) return;
    this.game.cancel();
    this.closeBuildMenu();
    this.closeSidePanel();
    document.getElementById('place-confirm')?.remove();
    this.refreshAbilities();
  }

  // =========================================================
  // TITLE
  // =========================================================
  showTitle() {
    this.killGame();
    this.clearUI();
    audio.stopMusic();
    const sc = el('div', 'screen');
    const logo = el('div', 'title-logo', `<h1>STARHOLD</h1><div class="tag">Hold the line at the edge of a pastel galaxy.</div>${this.save.seen['warmaster'] ? '<div class="warmaster-tag">👑 WARMASTER — every sector held at Ascension V</div>' : ''}`);
    const play = el('button', 'btn primary', 'Play') as HTMLButtonElement;
    play.style.fontSize = '22px'; play.style.padding = '14px 52px';
    play.onclick = () => { audio.ensure(); audio.ui('click'); this.showLevelSelect(); };
    const note = el('div', 'tiny-note', 'Ctrl+Shift+D — developer mode');
    sc.append(logo, play, note);
    this.root.append(sc);

    const snap = deserializeResume(this.save.resume);
    if (snap) {
      const lv = snap.endless ? ENDLESS_LEVEL : LEVELS.find(l => l.id === snap.levelId);
      if (!lv) {
        this.save.resume = undefined; this.persist(); // stale/corrupted — discard gracefully
      } else {
        const dim = el('div', 'overlay-dim');
        const card = el('div', 'panel modal-card');
        card.append(el('h2', '', 'Resume?'));
        const label = snap.daily ? `Daily Op — ${lv.name} (mirrored)` : lv.name;
        card.append(el('div', 'tiny-note', `${label} — Wave ${snap.waveIdx + 1}, ${snap.towers.length} tower${snap.towers.length === 1 ? '' : 's'} standing.`));
        const row = el('div', 'result-row');
        const abandon = el('button', 'btn', 'Abandon');
        abandon.onclick = () => { audio.ui('click'); this.save.resume = undefined; this.persist(); dim.remove(); };
        const resumeBtn = el('button', 'btn primary', 'Resume');
        resumeBtn.onclick = () => {
          audio.ensure(); audio.ui('click'); dim.remove();
          this.startLevel(lv, snap.endless, snap.daily, snap);
        };
        row.append(abandon, resumeBtn);
        card.append(row);
        dim.append(card);
        this.root.append(dim);
      }
    }
    this.drawTitleBackdrop();
  }

  private backdropStarted = false;
  drawTitleBackdrop() {
    if (this.backdropStarted) return;
    this.backdropStarted = true;
    const g = this.canvas.getContext('2d')!;
    const stars = Array.from({ length: 140 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 2 + 0.5, p: Math.random() * 7 }));
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.game) return;
      g.setTransform(this.physicalScale, 0, 0, this.physicalScale, 0, 0);
      g.fillStyle = '#14152a';
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 5; i++) {
        const grad = g.createRadialGradient(200 + i * 240, 300 + Math.sin(i * 2) * 160, 0, 200 + i * 240, 300 + Math.sin(i * 2) * 160, 260);
        grad.addColorStop(0, ['#2b2f5e', '#3d2b58', '#1c3a41'][i % 3] + '55');
        grad.addColorStop(1, '#00000000');
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
      }
      const t = performance.now();
      for (const s of stars) {
        g.globalAlpha = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t / 800 + s.p * 5));
        g.fillStyle = '#dfe4ff';
        g.fillRect(s.x, s.y, s.s, s.s);
      }
      g.globalAlpha = 1;
    };
    loop();
  }

  // =========================================================
  // LEVEL SELECT
  // =========================================================
  showLevelSelect() {
    this.killGame();
    this.clearUI();
    const sc = el('div', 'screen');
    const head = el('div', 'screen-head');
    const back = el('button', 'btn subtle', '← Title');
    back.onclick = () => { audio.ui('click'); this.showTitle(); };
    const h = el('h2', '', 'Select sector');
    const bank = el('div', 'star-bank', `★ ${this.starsAvail()} available`);
    const metaBtn = el('button', 'btn pink subtle', 'Upgrades');
    metaBtn.onclick = () => { audio.ui('click'); this.showMeta(); };
    const setBtn = el('button', 'btn subtle', 'Settings');
    setBtn.onclick = () => { audio.ui('click'); this.showSettings(); };
    const devB = el('button', 'btn subtle', '⚑ Dev');
    devB.onclick = () => { audio.ui('click'); this.showDevModal(); };
    const recB = el('button', 'btn subtle', '📋 Record');
    recB.onclick = () => { audio.ui('click'); this.showServiceRecord(); };
    const guideB = el('button', 'btn pink subtle', '📖 Guide');
    guideB.onclick = () => { audio.ui('click'); this.showGameCodex(); };
    head.append(back, h, bank, metaBtn, guideB, setBtn, recB, devB);
    sc.append(head);

    if (this.save.ascension.unlocked > 0) {
      const ascRow = el('div', 'asc-row');
      const names = ['Off', 'I', 'II', 'III', 'IV', 'V'];
      ascRow.append(el('span', 'asc-label', 'Ascension:'));
      for (let t = 0; t <= this.save.ascension.unlocked; t++) {
        const b = el('button', `seg-chip${this.save.ascension.current === t ? ' on' : ''}`, names[t]);
        b.title = t === 0 ? 'Standard campaign difficulty.'
          : t === 1 ? 'Hardened: +20% alien HP.'
          : t === 2 ? 'Hardened + Aggressive: mutators more frequent, can appear from wave 2.'
          : t === 3 ? 'Hardened + Aggressive + Decorated: elites twice as common, can roll two affixes.'
          : t === 4 ? 'Hardened + Aggressive + Decorated + Scarcity: -25% starting credits, interest cap halved.'
          : 'Hardened + Aggressive + Decorated + Scarcity + Onslaught: shorter intermissions, meteors everywhere.';
        b.onclick = () => {
          audio.ui('click');
          this.save.ascension.current = t;
          this.persist();
          this.showLevelSelect();
        };
        ascRow.append(b);
      }
      sc.append(ascRow);
    }

    const row = el('div', 'zone-row');
    for (let z = 0; z < 3; z++) {
      const col = el('div', 'zone-col');
      col.append(el('div', 'zone-name', ZONES[z].name));
      for (const lv of LEVELS.filter(l => l.zone === z)) {
        const locked = lv.id > this.save.unlocked && !this.devMode;
        const stars = this.save.stars[lv.id] || 0;
        const card = el('div', `level-card${locked ? ' locked' : ''}`);
        const modIcons = (lv.modifiers || [])
          .map(m => MODIFIER_INFO[m])
          .filter(Boolean)
          .map(info => `<span class="lv-mod" title="${info.name} — ${info.blurb}">${info.icon}</span>`)
          .join('');
        const chDone = this.save.challenges[lv.id] || [];
        const chBadges = isUnlocked('challenges') ? (lv.challenges || []).map((c, i) => {
          const def = CHALLENGE_POOL[c.id];
          const earned = !!chDone[i];
          return `<span class="lv-ch${earned ? ' earned' : ''}" title="${def.name}${earned ? ' — complete!' : ' — not yet earned'}">${def.icon}</span>`;
        }).join('') : '';
        const bothEarned = chDone.length && chDone.every(Boolean);
        card.append(
          el('div', 'lv-num', `${lv.id}`),
          el('div', 'lv-name', `${lv.name}${modIcons ? ` <span class="lv-mods">${modIcons}</span>` : ''}`),
          el('div', 'lv-stars', [1, 2, 3].map(i => `<span class="${i <= stars ? 'star-on' : 'star-off'}">★</span>`).join('')),
        );
        if (chBadges) card.append(el('div', 'lv-challenges', chBadges));
        if (bothEarned) card.classList.add('all-challenges');
        const bestAsc = this.save.ascension.bestPerLevel[lv.id] || 0;
        if (bestAsc > 0) {
          const crown = el('div', 'lv-crown', `👑${['', 'I', 'II', 'III', 'IV', 'V'][bestAsc]}`);
          crown.title = `Best beaten at Ascension ${['', 'I', 'II', 'III', 'IV', 'V'][bestAsc]}`;
          card.append(crown);
        }
        (card.querySelector('.lv-num') as HTMLElement).style.color = ZONES[z].accent;
        if (!locked) card.onclick = () => { audio.ui('click'); this.startLevel(lv, false); };
        col.append(card);
      }
      row.append(col);
    }

    const endlessOpen = this.save.unlocked > 5 || this.devMode;
    const eCard = el('div', `level-card${endlessOpen ? '' : ' locked'}`);
    eCard.style.width = '540px';
    eCard.append(
      el('div', 'lv-num', '∞'),
      el('div', 'lv-name', endlessOpen ? `Endless Drift — survive as long as you can. Best: wave ${this.save.endlessBest[this.save.settings.difficulty ?? 2] || 0}` : 'Endless Drift — clear level 5 to unlock'),
    );
    (eCard.querySelector('.lv-num') as HTMLElement).style.color = '#c5b3f6';
    if (endlessOpen) eCard.onclick = () => { audio.ui('click'); this.startLevel(ENDLESS_LEVEL, true); };

    const beatenIds = Object.keys(this.save.stars).map(Number).filter(id => (this.save.stars[id] || 0) > 0);
    const today = todayStr();
    const op = beatenIds.length ? computeDailyOp(today, beatenIds) : null;
    const dCard = el('div', `level-card${op ? '' : ' locked'}`);
    dCard.style.width = '540px';
    if (op) {
      const lv = LEVELS.find(l => l.id === op.levelId)!;
      const modNames = op.modifiers.map(m => MODIFIER_INFO[m]?.icon).filter(Boolean).join(' ');
      const gap = this.save.daily.lastDate ? daysBetween(this.save.daily.lastDate, today) : null;
      const streak = gap === 0 || gap === 1 ? this.save.daily.streak : 0;
      const wonToday = this.save.daily.lastDate === today && this.save.daily.lastWon;
      dCard.append(
        el('div', 'lv-num', '☀'),
        el('div', 'lv-name', `Daily Op — ${lv.name} (mirrored)  ${modNames}  ·  Hard difficulty${wonToday ? '  ✓ solved' : ''}`),
        el('div', 'lv-stars', `🔥 Streak: ${streak}${this.save.daily.bestStreak > streak ? ` (best ${this.save.daily.bestStreak})` : ''}`),
      );
      (dCard.querySelector('.lv-num') as HTMLElement).style.color = '#ffd97a';
      dCard.onclick = () => { audio.ui('click'); this.startDailyOp(op); };
    } else {
      dCard.append(el('div', 'lv-num', '☀'), el('div', 'lv-name', 'Daily Op — beat any level to unlock'));
    }

    sc.append(row, eCard, dCard);
    this.root.append(sc);
    this.renderDevPanel();
  }

  // =========================================================
  // META TREE
  // =========================================================
  showMeta() {
    this.clearUI();
    const sc = el('div', 'screen');
    const head = el('div', 'screen-head');
    const back = el('button', 'btn subtle', '← Sectors');
    back.onclick = () => { audio.ui('click'); this.showLevelSelect(); };
    head.append(back, el('h2', '', 'Station upgrades'), el('div', 'star-bank', `★ ${this.starsAvail()} available`));
    const grid = el('div', 'meta-grid');
    for (const m of META) {
      const owned = this.save.meta.includes(m.id);
      const reqOk = !m.requires || this.save.meta.includes(m.requires);
      const afford = this.starsAvail() >= m.cost;
      const cant = !owned && (!reqOk || !afford);
      const node = el('div', `meta-node${owned ? ' owned' : cant ? ' cant' : ''}`);
      node.append(
        el('div', 'm-name', m.name),
        el('div', 'm-desc', m.desc),
        el('div', 'm-cost', owned ? '✓ Installed' : !reqOk ? `Requires ${META.find(x => x.id === m.requires)?.name}` : `★ ${m.cost}`),
      );
      if (!owned && !cant) node.onclick = () => {
        this.save.meta.push(m.id);
        this.persist();
        audio.ui('branch');
        this.showMeta();
      };
      grid.append(node);
    }
    sc.append(head, grid, el('div', 'top-note', 'Earn stars by finishing levels with your hull intact.'));
    this.root.append(sc);
  }

  // =========================================================
  // SETTINGS + ALIEN CODEX
  // =========================================================
  private wasPaused = false;
  private buildAutoPaused = false;
  showSettings(inGame = false) {
    const dim = el('div', 'overlay-dim');
    const card = el('div', 'panel modal-card');
    card.append(el('h2', '', 'Settings'));
    const s = this.save.settings;

    // Applies a setting that requires the level to regenerate. If a mission is
    // active, confirms with the player first (current progress would be lost).
    const confirmRestart = (apply: () => void) => {
      if (!inGame || !this.game || !this.current) { apply(); return; }
      const g = this.game;
      const wasPaused = g.paused;
      g.paused = true;
      const cdim = el('div', 'overlay-dim');
      const ccard = el('div', 'panel modal-card');
      ccard.append(el('h2', '', 'Restart this level?'));
      ccard.append(el('div', 'tiny-note', 'This setting needs to regenerate the level. Progress in this level will be lost.'));
      const row = el('div', 'result-row');
      const cancel = el('button', 'btn', 'Cancel');
      cancel.onclick = () => { audio.ui('click'); g.paused = wasPaused; cdim.remove(); };
      const confirm = el('button', 'btn pink', 'Restart level');
      confirm.onclick = () => { audio.ui('click'); cdim.remove(); apply(); };
      row.append(cancel, confirm);
      ccard.append(row);
      cdim.append(ccard);
      this.root.append(cdim);
    };

    // A labelled segmented control that stacks its label above the chips so the
    // chips can wrap onto a second line instead of forcing horizontal scroll.
    const mkSegRow = (label: string, options: string[], get: () => number, set: (i: number) => void, restarts: boolean) => {
      const block = el('div', 'set-block');
      block.append(el('div', 'set-label', label));
      const seg = el('div', 'seg-row');
      options.forEach((opt, i) => {
        const b = el('button', `seg-chip${get() === i ? ' on' : ''}`, opt);
        b.onclick = () => {
          if (get() === i) return;
          const apply = () => {
            set(i);
            this.persist();
            audio.ui('click');
            seg.querySelectorAll('.seg-chip').forEach(x => x.classList.remove('on'));
            b.classList.add('on');
            if (restarts && inGame && this.game && this.current) { dim.remove(); this.startLevel(this.current, this.isEndless, this.currentDaily); }
          };
          if (restarts) confirmRestart(apply); else apply();
        };
        seg.append(b);
      });
      block.append(seg);
      card.append(block);
    };

    // ---- Gameplay ----
    card.append(el('div', 'set-section', 'Gameplay'));
    const mkToggle = (label: string, key: keyof typeof s, onChange?: () => void) => {
      const row = el('div', 'set-row', `<span>${label}</span>`);
      const tg = el('button', `toggle${(s as any)[key] ? ' on' : ''}`);
      tg.onclick = () => {
        (s as any)[key] = !(s as any)[key];
        tg.classList.toggle('on');
        this.persist();
        audio.ui('click');
        onChange?.();
      };
      row.append(tg);
      card.append(row);
    };
    mkToggle('Pause when building', 'pauseOnBuild', () => {
      if (!s.pauseOnBuild) this.syncBuildPause();
    });
    mkToggle('Screen shake', 'shake', () => {
      if (this.game) this.game.shakeOn = s.shake;
    });
    mkToggle('Vibration (mobile)', 'haptics', () => {
      if (this.game) this.game.hapticsOn = s.haptics;
    });
    mkToggle('Damage numbers', 'damageNumbers', () => {
      if (this.game) this.game.damageNumbersOn = s.damageNumbers;
    });
    mkToggle('Reduce flashing', 'reduceFlash', () => {
      if (this.game) this.game.reduceFlash = s.reduceFlash;
    });
    mkToggle('Reduce motion', 'reduceMotion', () => {
      if (this.game) this.game.reduceMotion = s.reduceMotion;
    });
    if (this.save.chromaUnlocked) {
      const chromaRow = el('div', 'set-row', `<span>✦ Chroma palette</span>`);
      const chromaTg = el('button', `toggle${this.save.chromaOn ? ' on' : ''}`);
      chromaTg.onclick = () => {
        this.save.chromaOn = !this.save.chromaOn;
        chromaTg.classList.toggle('on');
        document.body.classList.toggle('chroma-theme', this.save.chromaOn);
        this.persist();
        audio.ui('click');
      };
      chromaRow.append(chromaTg);
      card.append(chromaRow);
    }

    // performance mode: auto (on for touch devices) / always on / always off
    mkSegRow('Performance mode', ['Auto', 'On', 'Off'],
      () => ({ auto: 0, on: 1, off: 2 }[s.perfMode] ?? 0),
      i => {
        s.perfMode = (['auto', 'on', 'off'] as const)[i];
        if (this.game) this.game.perfMode = this.effectivePerfMode();
        document.body.classList.toggle('perf-mode', this.effectivePerfMode());
      }, false);

    // default targeting mode for newly built towers
    const tgtBlock = el('div', 'set-block');
    tgtBlock.append(el('div', 'set-label', 'New towers target'));
    const tgtSeg = el('div', 'seg-row');
    const modes = ['first', 'last', 'strong', 'weak', 'close'];
    for (const m of modes) {
      const b = el('button', `seg-chip${this.save.defaultTargeting === m ? ' on' : ''}`, m[0].toUpperCase() + m.slice(1));
      b.onclick = () => {
        this.save.defaultTargeting = m;
        this.persist();
        audio.ui('click');
        if (this.game) this.game.defaultMode = m as any;
        tgtSeg.querySelectorAll('.seg-chip').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
      };
      tgtSeg.append(b);
    }
    tgtBlock.append(tgtSeg);
    card.append(tgtBlock);

    // ---- Mission settings (each regenerates the current level) ----
    card.append(el('div', 'set-section', 'Mission'));
    mkSegRow('Tile size', ['Small', 'Standard', 'Large'],
      () => [40, 48, 58].indexOf(s.tileSize), i => { s.tileSize = [40, 48, 58][i]; }, true);
    mkSegRow('Meander', ['Low', 'Medium', 'High'],
      () => s.meander ?? 0, i => { s.meander = i; }, true);
    mkSegRow('Difficulty', ['Relaxed', 'Easy', 'Normal', 'Hard', 'Brutal'],
      () => s.difficulty ?? 2, i => { s.difficulty = i; }, true);
    mkSegRow('Game length', ['Short', 'Quick', 'Standard', 'Long', 'Marathon'],
      () => s.length ?? 2, i => { s.length = i; }, true);
    card.append(el('div', 'tiny-note', 'Tile size, meander, difficulty, and game length restart the current level.'));

    // ---- Sound (secondary popup) ----
    const soundRow = el('div', 'result-row');
    const soundBtn = el('button', 'btn subtle', '🔊 Sound settings');
    soundBtn.onclick = () => { audio.ui('click'); this.showSoundSettings(dim); };
    soundRow.append(soundBtn);
    card.append(soundRow);

    const codexRow = el('div', 'result-row');
    const codexBtn = el('button', 'btn pink subtle', 'Alien codex');
    codexBtn.onclick = () => { audio.ui('click'); this.showCodex(dim); };
    const towerCodexBtn = el('button', 'btn subtle', 'Tower codex');
    towerCodexBtn.onclick = () => { audio.ui('click'); this.showTowerCodex(dim); };
    codexRow.append(codexBtn, towerCodexBtn);
    card.append(codexRow);

    const guideRow = el('div', 'result-row');
    const mapCodexBtn = el('button', 'btn subtle', '🗺 Map guide');
    mapCodexBtn.onclick = () => { audio.ui('click'); this.showMapCodex(dim); };
    const gameCodexBtn = el('button', 'btn pink subtle', '📖 How to play');
    gameCodexBtn.onclick = () => { audio.ui('click'); this.showGameCodex(dim); };
    guideRow.append(gameCodexBtn, mapCodexBtn);
    card.append(guideRow);

    const close = el('button', 'btn primary', 'Done');
    close.onclick = () => { audio.ui('click'); dim.remove(); if (inGame && this.game) { this.game.paused = this.wasPaused; this.syncBuildPause(); } };
    card.append(close);
    dim.append(card);
    this.root.append(dim);
    if (inGame && this.game) { this.wasPaused = this.game.paused; this.game.paused = true; }
  }

  showSoundSettings(parentDim: HTMLElement) {
    const dim = el('div', 'overlay-dim');
    const card = el('div', 'panel modal-card');
    card.append(el('h2', '', 'Sound settings'));
    const s = this.save.settings;

    const vol = el('div', 'set-row', `<span>Master volume</span>`);
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = `${Math.round(s.master * 100)}`;
    slider.oninput = () => { s.master = +slider.value / 100; audio.apply(s); };
    slider.onchange = () => { this.persist(); audio.ui('click'); };
    vol.append(slider);
    card.append(vol);

    const mkToggle = (label: string, key: keyof typeof s) => {
      const row = el('div', 'set-row', `<span>${label}</span>`);
      const tg = el('button', `toggle${(s as any)[key] ? ' on' : ''}`);
      tg.onclick = () => {
        (s as any)[key] = !(s as any)[key];
        tg.classList.toggle('on');
        audio.apply(s);
        if (key === 'music') { s.music ? audio.startMusic() : audio.stopMusic(); audio.apply(s); }
        this.persist();
        audio.ui('click');
      };
      row.append(tg);
      card.append(row);
    };
    mkToggle('Music', 'music');
    mkToggle('Weapon sounds', 'weapons');
    mkToggle('Explosion sounds', 'explosions');
    mkToggle('Interface sounds', 'ui');

    const close = el('button', 'btn primary', 'Back');
    close.onclick = () => { audio.ui('click'); dim.remove(); };
    card.append(close);
    dim.append(card);
    parentDim.append(dim);
  }

  showCodex(parentDim: HTMLElement) {
    const dim = el('div', 'overlay-dim');
    const card = el('div', 'panel modal-card codex-card');
    card.append(el('h2', '', 'Alien codex'));
    const list = el('div', 'codex-list');
    for (const spec of Object.values(ENEMIES)) {
      const row = el('div', 'codex-row');
      const mini = document.createElement('canvas');
      mini.width = 96; mini.height = 96;
      mini.className = 'codex-mini';
      this.drawMiniEnemy(mini, spec);
      const info = el('div', 'codex-info');
      const traits: string[] = [];
      if (spec.flying) traits.push('Flying');
      if (spec.shield) traits.push('Shielded');
      if (spec.healAura) traits.push('Healer');
      if (spec.splits) traits.push('Splits');
      if (spec.phase) traits.push('Phases');
      if (spec.boss) traits.push('BOSS');
      const weakTo = (spec.counters || []).map(cid => {
        const t = TOWERS.find(tw => tw.id === cid);
        return t ? `<span style="color:${t.color}">${t.name}</span>` : '';
      }).filter(Boolean).join(' · ');
      info.append(
        el('div', 'codex-name', `${spec.name}${traits.length ? ` <span class="codex-traits">${traits.join(' · ')}</span>` : ''}`),
        el('div', 'codex-desc', spec.desc),
        el('div', 'codex-stats', `HP ${spec.hp} · Speed ${spec.speed} · Bounty ◆${spec.reward} · Hull dmg −${spec.leak}`),
        el('div', 'codex-stats', weakTo ? `Weak to: ${weakTo}` : ''),
      );
      row.append(mini, info);
      list.append(row);
    }
    card.append(list);
    const close = el('button', 'btn primary', 'Back');
    close.onclick = () => { audio.ui('click'); dim.remove(); };
    card.append(close);
    dim.append(card);
    parentDim.append(dim);
  }

  showTowerCodex(parentDim: HTMLElement) {
    const dim = el('div', 'overlay-dim');
    const card = el('div', 'panel modal-card codex-card');
    card.append(el('h2', '', 'Tower codex'));
    const list = el('div', 'codex-list');
    for (const spec of TOWERS) {
      const row = el('div', 'codex-row');
      const mini = document.createElement('canvas');
      mini.width = 96; mini.height = 96;
      mini.className = 'codex-mini';
      this.drawMiniTower(mini, spec, 2.8);
      const info = el('div', 'codex-info');
      const s0 = spec.stages[0];
      const air = airClass(spec);
      const airChip = air === 'no-air' ? '<span class="chip chip-noair">✕ AIR</span>'
        : air === 'air-bonus' ? '<span class="chip chip-airplus">AIR ×2</span>'
        : air === 'support' ? '<span class="chip chip-support">SUPPORT</span>'
        : '<span class="chip chip-air">✓ AIR</span>';
      const statBits: string[] = [];
      if (s0.dmg) statBits.push(`Dmg ${s0.dmg}`);
      if (s0.rate) statBits.push(`${s0.rate}/s`);
      statBits.push(`Range ${s0.range} tiles`);
      statBits.push(`◆ ${s0.cost}`);
      info.append(
        el('div', 'codex-name', `<span style="color:${spec.color}">●</span> ${spec.name} ${airChip}`),
        el('div', 'codex-desc', spec.blurb),
        el('div', 'codex-stats', statBits.join(' · ')),
        el('div', 'codex-stats', `Specializations: ${spec.branches.map(b => b[0].name).join(' / ')}`),
      );
      row.append(mini, info);
      list.append(row);
    }
    card.append(list);
    const close = el('button', 'btn primary', 'Back');
    close.onclick = () => { audio.ui('click'); dim.remove(); };
    card.append(close);
    dim.append(card);
    parentDim.append(dim);
  }

  // Explains every tile type and on-map overlay — accepts an optional parent dim so it can
  // open nested (from Settings) or standalone (from the level-select Guide button).
  showMapCodex(parentDim?: HTMLElement) {
    const dim = el('div', 'overlay-dim');
    const card = el('div', 'panel modal-card codex-card');
    card.append(el('h2', '', 'Map guide'));
    card.append(el('div', 'guide-lead', "What every cell and overlay on the battlefield means."));
    const list = el('div', 'codex-list');
    const entries: { swatch: string; name: string; desc: string }[] = [
      { swatch: 'gm-swatch-empty', name: 'Open cell', desc: 'Empty ground. Tap or click it to build a tower there. A small pulsing outline and corner dot mark every buildable cell — it brightens further when your cursor or finger is right over it.' },
      { swatch: 'gm-swatch-path', name: 'Alien path', desc: 'The road aliens walk from portal to base. You can never build here — it\'s always excluded automatically, however winding the level\'s path is.' },
      { swatch: 'gm-swatch-rock', name: 'Rocky debris', desc: 'Blocked terrain from the "Asteroid Field" level modifier. Can\'t build here, but it doesn\'t block the alien path itself — it just forces you to route your defenses around it. Only appears on levels showing the 🪨 icon on their level card.' },
      { swatch: 'gm-swatch-vein', name: 'Rich Vein ✨', desc: 'Those twinkling cyan diamonds! From the "Rich Veins" level modifier. Build a tower directly on one and it earns +2 bonus credits every time it lands a killing blow, on top of the normal bounty — a real reason to consider a less "optimal" spot. Only on levels showing the 💎 icon.' },
      { swatch: 'gm-swatch-meteor', name: 'Meteor warning', desc: 'A pulsing red ring with a crosshair means a meteor is about to strike that exact cell in a few seconds. Any tower standing there gets knocked offline for 6 seconds when it lands. From the "Meteor Shower" modifier (☄️ on the level card) — you get just enough warning to react.' },
      { swatch: 'gm-swatch-storm', name: 'Ion storm band', desc: 'A glowing horizontal band that sweeps across a few rows, amber while it\'s still incoming and blue-static once it\'s active. Towers caught inside fire 30% slower until it passes. From the "Ion Storms" modifier (🌩 on the level card).' },
      { swatch: 'gm-swatch-portal', name: 'Portal', desc: 'The swirling ring where aliens enter the map. Purely visual — you can\'t interact with it.' },
      { swatch: 'gm-swatch-base', name: 'Your base', desc: 'The glowing orb aliens are trying to reach. Every alien that gets there costs you hull integrity (lives) — run out and the level ends.' },
      { swatch: 'gm-swatch-range', name: 'Range preview', desc: 'Whenever you select, are about to build, or are moving a tower, its range is drawn as a ring of highlighted tiles — that\'s the exact set of cells it can hit, not just an approximate circle.' },
      { swatch: 'gm-swatch-crate', name: 'Supply crate', desc: 'A parachuting crate that drifts across the map during a wave. Tap it before it despawns (it blinks in its last few seconds) for a random bonus — see "Supply Drops" in the game guide.' },
    ];
    for (const e of entries) {
      const row = el('div', 'codex-row');
      const swatch = el('div', `gm-swatch ${e.swatch}`);
      const info = el('div', 'codex-info');
      info.append(el('div', 'codex-name', e.name), el('div', 'codex-desc', e.desc));
      row.append(swatch, info);
      list.append(row);
    }
    card.append(list);
    const close = el('button', 'btn primary', 'Back');
    close.onclick = () => { audio.ui('click'); dim.remove(); };
    card.append(close);
    dim.append(card);
    (parentDim || this.root).append(dim);
  }

  // A full plain-language walkthrough of every system in the game, grouped roughly in the
  // order a new player meets them. Accepts an optional parent dim (see showMapCodex).
  showGameCodex(parentDim?: HTMLElement) {
    const dim = el('div', 'overlay-dim');
    const card = el('div', 'panel modal-card codex-card guide-card');
    card.append(el('h2', '', 'How to play'));
    card.append(el('div', 'guide-lead', "Everything in Starhold, explained — from your first tower to what's waiting after you beat the campaign."));
    const mapLinkRow = el('div', 'result-row');
    const mapLinkBtn = el('button', 'btn subtle', '🗺 Open the map guide');
    mapLinkBtn.onclick = () => { audio.ui('click'); this.showMapCodex(dim); };
    mapLinkRow.append(mapLinkBtn);
    card.append(mapLinkRow);
    const list = el('div', 'codex-list guide-list');

    const section = (title: string) => { list.append(el('div', 'guide-section-h', title)); };
    const item = (name: string, desc: string) => {
      const row = el('div', 'guide-item');
      row.append(el('div', 'guide-item-name', name), el('div', 'guide-item-desc', desc));
      list.append(row);
    };

    section('The basics');
    item('Goal', "Aliens march along a fixed path toward your base. Build towers to kill them before they arrive. Every alien that gets through costs hull integrity (your lives) — run out and the level ends.");
    item('Building', "Tap an open cell, pick a tower, then confirm — you'll see a ghost preview and its range before you commit. Each tower costs credits, which you earn by killing aliens and clearing waves.");
    item('Upgrading', "Select a built tower to see its tech tree: two general upgrades (Mk II, Mk III), then a choice of 3 specialization branches, 2 tiers each. Any upgrade can be refunded in full at any time — experiment freely.");
    item('Moving & selling', "A selected tower's panel has Move (relocate it for free) and Sell (full refund) buttons.");
    item('Targeting', "Each tower has a targeting mode — First (furthest along the path), Last, Strong(est), Weak(est), or Close(st) — changeable anytime from its panel. Set a default in Settings for all new towers.");
    item('Launching waves', "Click Launch to send the next wave — calling it early (before the countdown finishes) pays a bonus based on how much time was left. Toggle Auto-launch to skip the wait entirely.");
    item('The forecast bar', "Top-right shows what's coming: the next wave's alien composition and any twist it carries, plus a dimmed preview of the wave after that — always visible before you commit to a layout.");

    section('Making it interesting');
    item('Kill combos', "Kill aliens within 1.6 seconds of each other to build a combo counter. Milestones (×5, ×10, ×20, ×35, ×50) pay escalating bonus credits with a rising chime. Any alien that leaks through breaks your chain — leaks cost you momentum, not just hull.");
    item('Interest', "Credits you don't spend earn 6% interest at every wave clear (capped per payout). A faint ▲N next to your credit count shows the pending amount while a wave is active — a real save-vs-spend decision, every wave.");
    item('Elite aliens', "Occasionally a normal alien spawns as an Elite: gold crown, much tougher, 3x the bounty, and one random trait — Shielded, Swift, or Vampiric (heals nearby aliens) — named in its tooltip if you press and hold it.");
    item('Supply drops', "Crates parachute onto the map mid-wave. Tap one before it despawns (it blinks in its last few seconds) for a random bonus: credits, a full ability recharge, a temporary fire-rate boost for every tower, or hull repair.");
    item('Wave mutators', "From a few waves into most levels, a wave can arrive \"mutated\" — Frenzied (faster), Armored (shielded), Bounty (bigger rewards — the friendly one), Horde (more, weaker enemies), and later Regenerating or Phasing. Always shown in the forecast before you launch, and banners when it starts.");
    item('Level modifiers', "Some levels carry a standing hazard or feature for their whole duration, shown as icons on the level card: Asteroid Field, Rich Veins, Meteor Shower, Ion Storms — see the Map Guide for exactly what each looks like on the battlefield.");
    item('Weak-to hints', "Every alien's tooltip (and the Alien Codex) shows which towers counter it best — there's always a clear answer to \"what do I use for this?\"");

    section('Abilities & big moments');
    item('Orbital Strike & Stasis Field', "Two active abilities, unlocked permanently via the Upgrades screen (spend stars). Click the ability button, then click a spot on the map to cast — a heavy-damage strike or a slowing field, each on its own cooldown.");
    item('NOVA', "A free ultimate that charges as you rack up kills (elite and boss kills charge it much faster). When full, its button glows — fire it for a screen-wide shockwave. Gets harder to recharge each time you use it within a level. Most effective against groups of regular enemies — bosses take reduced, meaningful-but-not-decisive damage from it, so think of it as crowd control rather than a boss-damage cooldown.");
    item('Boss fights', "Every 5th level ends in a boss, announced with a klaxon and a screen-wide warning. It gets a persistent health bar, and most bosses change tactics once they drop to 50% HP — read the banner when it happens.");

    section('Stars & rewards');
    item('Level challenges', "Most levels carry two optional bonus objectives (shown before you start, and as badges on the level card) — things like winning without losing hull, or without selling a tower. Each earns a bonus star.");
    item('Stars', "Your star total (level completion + challenges + endless milestones) is shown at the top of Sectors and spent in Upgrades.");
    item('Meta upgrades', "Permanent, account-wide upgrades bought with stars: more starting credits, more hull, cheaper towers, stronger towers, and unlocking Orbital Strike / Stasis Field. These apply to every level you play from then on.");
    item('Victory & defeat screens', "Winning punches in your stars, challenge badges, and any new records one at a time — tap to skip. Losing tells you which wave broke you and which alien type did most of the damage, with a counter-tower hint.");
    item('Per-tower stats', "Any tower that's done something shows its lifetime damage, kills, and a value rating (credits earned back vs. what you spent) right in its panel — useful for judging what's actually pulling its weight.");

    section('After you beat the campaign');
    item('Ascension', "A 5-tier New Game+, unlocked one tier at a time by beating Level 15 at the current one. Each tier stacks on the last: more HP, more frequent mutators, more (and nastier) elites, a tighter economy, and eventually less breathing room between waves. Pick your tier from Sectors.");
    item('Daily Op', "One seeded, mirrored remix of a level you've already beaten — the same challenge for everyone on a given day, always at Hard difficulty. Win to build a streak; miss a day and it resets (but your best streak is kept).");
    item('Endless mode', "Unlocked after Level 5 — survive as long as you can against ever-scaling waves. Tracks a best-wave record per difficulty and awards milestone stars at waves 10/20/30.");
    item('Chroma palette', "An alternate color scheme for the whole interface, unlocked by earning all 28 challenge stars across the campaign. Toggle it in Settings once unlocked.");
    item('Service Record', "A lifetime stats screen — total kills, waves cleared, favorite tower, best combo, daily streak, and more — reachable from Sectors.");
    item('Resume', "The game saves your exact progress at every wave clear. Close the tab or lose your connection mid-level, and you'll be offered a Resume prompt next time you open the game.");

    section('Settings worth knowing about');
    item('Difficulty & game length', "Both restart the current level if changed mid-play (you'll be asked to confirm) — they scale enemy toughness/rewards and how many waves a level has.");
    item('Meander', "Controls how winding the alien path is — Low is closer to a straight line, High adds more turns and switchbacks, guaranteed to never cross itself.");
    item('Pause when building', "Auto-pauses the moment you open a build or upgrade panel, and resumes when you close it — handy if you want to plan without the clock running.");
    item('Reduce flashing / Reduce motion', "Accessibility toggles that soften NOVA's flash and meteor strikes, and disable slow-motion, hit-stop, and screen shake respectively.");
    item('Performance mode', "Trims particle effects and background detail for smoother play on phones — Auto (on by default for touch devices), always On, or always Off. Can also switch itself on mid-session if it notices the game running slow.");

    card.append(list);
    const close = el('button', 'btn primary', 'Back');
    close.onclick = () => { audio.ui('click'); dim.remove(); };
    card.append(close);
    dim.append(card);
    (parentDim || this.root).append(dim);
  }

  drawMiniEnemy(cv: HTMLCanvasElement, spec: EnemySpec) {
    const g = cv.getContext('2d')!;
    g.scale(2, 2);
    g.translate(24, 24);
    const r = Math.min(spec.size, 15);
    const shape = spec.shape || 'circle';
    g.fillStyle = 'rgba(4,5,14,0.4)';
    g.beginPath(); g.arc(3, 5, r + 2, 0, 7); g.fill();
    // wings
    if (spec.flying) {
      g.fillStyle = spec.color2;
      for (const side of [-1, 1]) {
        g.beginPath();
        if (shape === 'slim') {
          g.moveTo(r * 0.3, side * r * 0.3);
          g.lineTo(-r * 1.1, side * r * 1.5);
          g.lineTo(-r * 0.6, side * r * 0.4);
          g.closePath();
        } else {
          g.ellipse(-r * 0.2, side * r * 1.05, r * 0.85, r * 0.5, side * 0.5, 0, 7);
        }
        g.fill();
      }
    }
    const path = (rx: number, ry: number) => {
      g.beginPath();
      switch (shape) {
        case 'slim':
          g.moveTo(rx * 1.35, 0);
          g.quadraticCurveTo(rx * 0.3, -ry * 0.85, -rx * 0.85, -ry * 0.55);
          g.quadraticCurveTo(-rx * 1.05, 0, -rx * 0.85, ry * 0.55);
          g.quadraticCurveTo(rx * 0.3, ry * 0.85, rx * 1.35, 0);
          break;
        case 'square':
          (g as any).roundRect(-rx * 0.95, -ry * 0.95, rx * 1.9, ry * 1.9, rx * 0.28);
          break;
        case 'hex':
          for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            i ? g.lineTo(Math.cos(a) * rx * 1.05, Math.sin(a) * ry * 1.05)
              : g.moveTo(Math.cos(a) * rx * 1.05, Math.sin(a) * ry * 1.05);
          }
          g.closePath();
          break;
        case 'diamond':
          g.moveTo(rx * 1.2, 0); g.lineTo(0, -ry); g.lineTo(-rx * 1.2, 0); g.lineTo(0, ry);
          g.closePath();
          break;
        default:
          g.arc(0, 0, rx, 0, 7);
      }
    };
    if (shape === 'lumpy') {
      const lobes = [[0, 0, 1], [-0.55, 0.4, 0.62], [0.5, 0.45, 0.55], [-0.1, -0.55, 0.58]];
      for (const pass of [0, 1]) {
        g.fillStyle = pass ? spec.color : spec.color2;
        for (const [ox, oy, s] of lobes) {
          g.beginPath(); g.arc(ox * r, oy * r, r * s + (pass ? 0 : 2), 0, 7); g.fill();
        }
      }
    } else {
      g.fillStyle = spec.color2; path(r + 2, r + 2); g.fill();
      g.fillStyle = spec.color; path(r, r); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.beginPath(); g.arc(-r * 0.3, -r * 0.3, r * 0.3, 0, 7); g.fill();
    if (spec.healAura) {
      g.fillStyle = '#2f6b3f';
      const cw = r * 0.62, ct = r * 0.24;
      (g as any).beginPath(); (g as any).roundRect(-cw / 2, -ct / 2, cw, ct, ct * 0.4); g.fill();
      (g as any).beginPath(); (g as any).roundRect(-ct / 2, -cw / 2, ct, cw, ct * 0.4); g.fill();
    }
    if (spec.shield) {
      g.strokeStyle = '#bfe3ff'; g.lineWidth = 1.6; g.globalAlpha = 0.7;
      g.beginPath(); g.arc(0, 0, r + 5, 0, 7); g.stroke();
      g.globalAlpha = 1;
    }
    const n = spec.eyes || 1;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * r * 0.5;
      const er = Math.max(2.4, r * 0.26);
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(r * 0.3, off, er, 0, 7); g.fill();
      g.fillStyle = '#20223c';
      g.beginPath(); g.arc(r * 0.3 + 1.6, off, er * 0.5, 0, 7); g.fill();
    }
  }

  // =========================================================
  // GAME
  // =========================================================
  startLevel(level: LevelSpec, endless: boolean, daily: DailyOp | null = null, resumeSnap: ResumeSnapshot | null = null) {
    this.killGame();
    this.clearUI();
    this.current = level;
    this.isEndless = endless;
    this.isDaily = !!daily;
    this.currentDaily = daily;
    this.lastHud = { credits: -1, lives: -1, wave: -1 };
    // once we act on a snapshot (resuming OR starting anything else), it's consumed
    if (this.save.resume) { this.save.resume = undefined; this.persist(); }
    const owned = (id: string) => this.save.meta.includes(id) || this.devMode;
    const meta = {
      credits: owned('reactor2') ? 120 : owned('reactor1') ? 60 : 0,
      hp: owned('hull2') ? 10 : owned('hull1') ? 5 : 0,
      costMul: owned('fab') ? 0.9 : 1,
      dmgMul: owned('munitions') ? 1.1 : 1,
      orbital: owned('orbital'),
      stasis: owned('stasis'),
    };
    const st = this.save.settings;
    const DIFF_HP = [0.7, 0.85, 1, 1.25, 1.55];
    const DIFF_REWARD = [0.85, 0.95, 1, 1.15, 1.3];
    const LEN_FACTOR = [0.6, 0.8, 1, 1.3, 1.6];
    // Resuming MUST reuse the exact tileSize/meander the snapshot was built with — anything
    // else regenerates a different grid and every saved tower cell index becomes meaningless.
    const tileSize = resumeSnap ? resumeSnap.tileSize : (st.tileSize || 48);
    const meander = resumeSnap ? resumeSnap.meander : (st.meander ?? 0);
    const diffTier = resumeSnap ? resumeSnap.diffTier : daily ? daily.difficulty : (st.difficulty ?? 2);
    const ascTier = resumeSnap ? resumeSnap.ascTier : (endless || daily) ? 0 : this.save.ascension.current;
    const game = new Game(this.canvas, level, endless, meta, tileSize, {
      hpMul: DIFF_HP[diffTier],
      rewardMul: DIFF_REWARD[diffTier],
      waveFactor: LEN_FACTOR[st.length ?? 2],
      meander,
      diffTier,
      ascTier,
      mirror: !!daily,
      forceMods: daily?.modifiers,
      mutatorBonus: daily?.mutatorBonus,
      perfMode: this.effectivePerfMode(),
    });
    this.game = game;
    this.orientationPausedGame = false;
    game.dpr = this.physicalScale;
    game.dev = this.devMode;
    game.shakeOn = this.save.settings.shake;
    game.speed = ([1, 2, 3].includes(this.save.lastSpeed) ? this.save.lastSpeed : 1) as 1 | 2 | 3;
    game.defaultMode = this.save.defaultTargeting as any;
    game.hapticsOn = this.save.settings.haptics !== false;
    game.damageNumbersOn = this.save.settings.damageNumbers !== false;
    game.reduceFlash = !!this.save.settings.reduceFlash;
    game.reduceMotion = !!this.save.settings.reduceMotion;
    game.onToast = (key, text) => this.toastOnce(key, text);
    game.onWaveClear = () => this.saveResumeSnapshot();
    game.onPerfDrop = () => {
      document.body.classList.add('perf-mode');
      this.notify.low('Switched to performance mode to keep things smooth.');
    };
    if (!resumeSnap) {
      // scripted first encounters for players meeting these systems for the first time
      if (!endless && level.id === 4 && !this.save.seen['drops']) game.scriptDrop = true;
      if (!endless && level.id === 5 && !this.save.seen['elites']) game.scriptElite = true;
      game.firstMutator = isUnlocked('mutators') && !this.save.seen['mutators'];
      // level-identity modifiers: banner listing + first-encounter toasts for the passive ones
      if (game.mods.size) {
        const parts: string[] = [];
        for (const m of game.mods) {
          const info = MODIFIER_INFO[m];
          parts.push(`${info.icon} ${info.name}`);
          if (m === 'asteroids' || m === 'rich-veins') this.toastOnce(info.gate, info.blurb);
        }
        this.banner(parts.join('  ·  '), '#c5b3f6', 'medium');
      }
      // pre-level challenge briefing (not endless, not daily, not L1 — challenges gate at L2)
      if (!endless && !daily && isUnlocked('challenges') && level.challenges?.length) {
        const names = level.challenges.map(c => `${CHALLENGE_POOL[c.id].icon} ${CHALLENGE_POOL[c.id].name}`).join('  ·  ');
        this.banner(`Challenges: ${names}`, '#fff3b0', 'medium');
      }
      if (daily) {
        this.banner('☀ DAILY OP — mirrored layout, Hard difficulty', '#ffd97a', 'medium');
      }
    } else {
      this.banner('Resumed', '#a8e6cf', 'medium');
    }
    // zone flavor: one line, shown once on first-ever entry to each zone
    if (!endless && !daily && !resumeSnap) this.toastOnce(`zone_${level.zone + 1}`, ZONES[level.zone].tagline);
    this.buildHud();
    this.checkOrientationPause();
    if (!resumeSnap) this.maybeStartGuide(level, endless);

    if (resumeSnap) {
      // Restore full mid-level state. Grid/path/mods are already correct (constructed with
      // the snapshot's own tileSize/meander/diffTier/ascTier/forceMods above) — this just
      // repopulates the mutable run state on top of that freshly-built, matching grid.
      game.mods = new Set(resumeSnap.mods);
      game.credits = resumeSnap.credits;
      game.lives = Math.min(game.maxLives, resumeSnap.lives);
      game.waveIdx = resumeSnap.waveIdx;
      game.novaCharge = resumeSnap.novaCharge;
      game.novaNeed = resumeSnap.novaNeed;
      game.cds.orbital = resumeSnap.cdOrbital;
      game.cds.stasis = resumeSnap.cdStasis;
      for (const rt of resumeSnap.towers) {
        const spec = TOWERS.find(t => t.id === rt.specId);
        const cellInfo = game.cells[rt.cell];
        if (!spec || !cellInfo) continue; // corrupted/stale snapshot entry — skip gracefully
        const t = new Tower(spec, cellInfo.x, cellInfo.y);
        t.cell = rt.cell; t.col = cellInfo.col; t.row = cellInfo.row;
        t.stage = rt.stage; t.branch = rt.branch; t.branchStage = rt.branchStage;
        t.mode = rt.mode as any; t.spent = rt.spent;
        t.dmgDealt = rt.dmgDealt; t.kills = rt.kills; t.creditsEarned = rt.creditsEarned; t.vein = rt.vein;
        game.towers.push(t);
        game.occupied[rt.cell] = t;
      }
      game.interMax = (game.endless ? 14 : 13) * (game.ascTier >= 5 ? TUNING.ascension.intermissionMul : 1);
      game.interT = game.interMax;
      game.preparePending();
      game.onHud();
    }
    game.onHud = () => this.updateHud();
    game.onBanner = (text, color, tier, sub) => this.banner(text, color, tier, sub);
    game.onSelect = () => this.renderSidePanel();
    game.onEnd = (won, stars) => this.showResult(won, stars);
    if (this.save.settings.music) audio.startMusic();
    this.renderDevPanel();
    this.banner(endless ? 'Endless Drift' : `${level.id}. ${level.name}`, ZONES[level.zone].accent);
  }

  // Called by Game.onWaveClear — snapshots exactly enough to drop the player back into
  // the intermission before the next wave. Never fires on the final wave (win() returns
  // before onWaveClear would be reached), so there's nothing to accidentally save-over-a-win.
  saveResumeSnapshot() {
    const g = this.game;
    if (!g || this.isEndless) return; // endless has no "next wave" identity worth resuming into
    const raw = serializeResume(g as any, this.currentDaily);
    if (raw) { this.save.resume = raw; this.persist(); }
  }

  startDailyOp(op: DailyOp) {
    const lv = LEVELS.find(l => l.id === op.levelId);
    if (!lv) return;
    this.startLevel(lv, false, op);
  }

  // Fold the finished run's stat deltas into the save, then zero them so any
  // second call (quit -> new level etc.) can't double-count.
  mergeRunStats() {
    const g = this.game;
    if (!g) return;
    const r = g.runStats, s = this.save.stats;
    s.kills += r.kills;
    s.wavesCleared += r.wavesCleared;
    s.elitesSlain += r.elitesSlain;
    s.bestCombo = Math.max(s.bestCombo, r.bestCombo);
    s.novasFired += r.novasFired;
    for (const [id, n] of Object.entries(r.towersBuilt)) s.towersBuilt[id] = (s.towersBuilt[id] || 0) + n;
    for (const [id, n] of Object.entries(r.leaksByEnemy)) s.leaksByEnemy[id] = (s.leaksByEnemy[id] || 0) + n;
    g.runStats = { kills: 0, wavesCleared: 0, towersBuilt: {}, elitesSlain: 0, bestCombo: 0, novasFired: 0, leaksByEnemy: {} };
    this.persist();
  }

  killGame() {
    this.mergeRunStats();
    if (this.game) { this.game.destroy(); this.game = null; }
  }

  buildHud() {
    const g = this.game!;
    const top = el('div', 'panel');
    top.id = 'hud-top';
    const credits = el('div', 'hud-stat credits', `<span class="ico">◆</span><span class="v"></span><span class="interest-preview"></span>`);
    const lives = el('div', 'hud-stat lives', `<span class="ico">♥</span><span class="v"></span>`);
    const wave = el('div', 'hud-stat wave', `<span class="ico">≋</span><span class="v"></span>`);
    top.append(credits, lives, wave);
    this.hudRefs.credits = credits.querySelector('.v') as HTMLElement;
    this.hudRefs.interestPreview = credits.querySelector('.interest-preview') as HTMLElement;
    this.hudRefs.lives = lives.querySelector('.v') as HTMLElement;
    this.hudRefs.wave = wave.querySelector('.v') as HTMLElement;
    this.hudRefs.creditsWrap = credits; this.hudRefs.livesWrap = lives;
    const combo = el('div', '');
    combo.id = 'combo-hud';
    this.root.append(combo);
    this.hudRefs.combo = combo;

    const left = el('div', '');
    left.id = 'hud-left';
    const menu = el('button', 'icon-btn', '☰');
    menu.title = 'Back to sector select';
    menu.onclick = () => { audio.ui('click'); this.confirmQuit(); };
    const pause = el('button', 'icon-btn', '⏸');
    pause.title = 'Pause (Space) — you can still build while paused';
    pause.onclick = () => this.togglePause();
    this.hudRefs.pause = pause;
    const speed = el('button', 'icon-btn', `${g.speed}×`);
    speed.title = 'Game speed';
    speed.classList.toggle('active', g.speed > 1);
    speed.onclick = () => {
      audio.ui('click');
      g.speed = g.speed === 1 ? 2 : g.speed === 2 ? 3 : 1;
      speed.textContent = `${g.speed}×`;
      speed.classList.toggle('active', g.speed > 1);
      this.save.lastSpeed = g.speed;
      this.persist();
    };
    const auto = el('button', 'icon-btn', '⏩');
    auto.title = 'Auto-launch the next wave immediately (collects the maximum early bonus)';
    auto.onclick = () => {
      audio.ui('click');
      g.autoWave = !g.autoWave;
      auto.classList.toggle('active', g.autoWave);
      if (g.autoWave && !g.waveActive) g.callWave(true);
    };
    const devBtn = el('button', 'icon-btn', '⚑');
    devBtn.title = 'Developer Mode';
    devBtn.onclick = () => { audio.ui('click'); this.showDevModal(); };
    left.append(menu, pause, speed, auto, devBtn);

    const right = el('div', '');
    right.id = 'hud-right';
    const preview = el('div', 'wave-preview');
    preview.id = 'wave-preview';
    const call = el('div', '');
    call.id = 'wave-call';
    const bonus = el('div', 'bonus', '');
    const btn = el('button', 'btn primary', 'Launch wave');
    btn.onclick = () => { audio.ui('click'); g.callWave(true); this.updateHud(); };
    call.append(bonus, btn);
    this.hudRefs.callWrap = call;
    this.hudRefs.callBonus = bonus;
    this.hudRefs.callBtn = btn;
    this.hudRefs.wavePreview = preview;
    this.lastPreviewKey = '';
    const set = el('button', 'icon-btn', '⚙');
    set.onclick = () => { audio.ui('click'); this.showSettings(true); };
    right.append(preview, call, set);

    // boss health bar — top-center, hidden until a boss is alive
    const bossBar = el('div', '');
    bossBar.id = 'boss-bar';
    bossBar.innerHTML = `<div class="bb-name"></div><div class="bb-track"><div class="bb-shield"></div><div class="bb-fill"></div><div class="bb-tick"></div></div>`;
    this.root.append(bossBar);
    this.hudRefs.bossBar = bossBar;
    this.hudRefs.bossName = bossBar.querySelector('.bb-name') as HTMLElement;
    this.hudRefs.bossFill = bossBar.querySelector('.bb-fill') as HTMLElement;
    this.hudRefs.bossShield = bossBar.querySelector('.bb-shield') as HTMLElement;

    // NOVA ultimate — sits above the ability stack
    if (isUnlocked('nova')) {
      const nova = el('button', 'nova-btn');
      nova.id = 'nova-btn';
      nova.innerHTML = `<div class="nova-fill"></div><span class="nova-label">☀ NOVA</span>`;
      nova.title = 'NOVA — charged by kills. Fires a station-wide shockwave.';
      nova.onclick = () => {
        if (g.startNova()) { audio.ui('click'); this.notify.low('NOVA CHARGING — brace!'); }
        else audio.ui('deny');
      };
      this.root.append(nova);
      this.hudRefs.nova = nova;
      this.hudRefs.novaFill = nova.querySelector('.nova-fill') as HTMLElement;
      this.toastOnce('nova', 'NOVA unlocked! Kills charge the meter — fire it for a station-wide shockwave when things get desperate.');
    }

    // abilities — bottom-left stack
    const abil = el('div', '');
    abil.id = 'ability-stack';
    for (const key of ['orbital', 'stasis'] as const) {
      const ab = ABILITIES[key];
      const has = key === 'orbital' ? g.hasOrbital : g.hasStasis;
      if (!has && !this.devMode) continue;
      const btn = el('button', 'ability-btn');
      btn.innerHTML = `<span class="a-ico">${ab.ico}</span><span class="a-name">${ab.name}</span><div class="cd-mask" style="height:0"></div><div class="cd-num"></div>`;
      btn.title = `${ab.name} (${key === 'orbital' ? 'Q' : 'W'}) — click, then click the map`;
      btn.onclick = () => this.armAbility(key);
      abil.append(btn);
      this.abilityBtns[key] = btn;
    }

    const hint = el('div', 'build-hint', 'Click any open cell to build · click an alien to focus fire · select a tower to upgrade, sell, or move it');
    hint.id = 'build-hint';
    setTimeout(() => hint.remove(), 9000);

    this.root.append(top, left, right, abil, hint);
    this.repositionPopups();
  }

  // ---------- guided first build (fresh saves, Level 1 only) ----------
  private guideHighlightEl: HTMLElement | null = null;
  private clearGuideHighlight() { this.guideHighlightEl?.remove(); this.guideHighlightEl = null; }

  maybeStartGuide(level: LevelSpec, endless: boolean) {
    if (endless || level.id !== 1 || this.save.unlocked > 1 || this.save.seen['guide_build']) return;
    const g = this.game;
    if (!g || !g.paths[0]) return;
    // a good first cell: near a third of the way along the path, where its earliest bend usually is
    const target = g.paths[0].at(g.paths[0].total * 0.32);
    let best: typeof g.cells[number] | null = null, bd = Infinity;
    for (const c of g.cells) {
      if (!c.valid) continue;
      const d = (c.x - target.x) ** 2 + (c.y - target.y) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return;
    this.clearGuideHighlight();
    const ring = el('div', 'guide-ring');
    ring.style.left = `${best.x}px`;
    ring.style.top = `${best.y}px`;
    this.root.append(ring);
    this.guideHighlightEl = ring;
    this.notify.low('Tap a glowing empty cell to build your first tower.');
  }

  guideLaunchHint() {
    if (this.save.seen['guide_launch']) return;
    this.save.seen['guide_launch'] = true;
    this.persist();
    const btn = this.hudRefs.callBtn as HTMLElement | undefined;
    if (!btn) return;
    btn.classList.add('guide-pulse');
    this.notify.low('When you\'re ready, tap Launch wave to send in the first attack.');
    const clear = () => btn.classList.remove('guide-pulse');
    btn.addEventListener('click', clear, { once: true });
    setTimeout(clear, 9000);
  }

  // ---------- pause-when-building ----------
  syncBuildPause() {
    const g = this.game;
    if (!g) return;
    const setPaused = (p: boolean) => {
      g.paused = p;
      const btn = this.hudRefs.pause as HTMLElement | undefined;
      if (btn) { btn.textContent = p ? '▶' : '⏸'; btn.classList.toggle('active', p); }
    };
    if (!this.save.settings.pauseOnBuild) {
      if (this.buildAutoPaused) { setPaused(false); this.buildAutoPaused = false; }
      return;
    }
    const open = !!document.getElementById('build-menu') || !!document.getElementById('side-panel') || !!document.getElementById('place-confirm');
    if (open && !g.paused) { setPaused(true); this.buildAutoPaused = true; }
    else if (!open && this.buildAutoPaused) { setPaused(false); this.buildAutoPaused = false; }
  }

  // ---------- build menu ----------
  closeBuildMenu() {
    document.getElementById('build-menu')?.remove();
    if (this.game) { this.game.menuCell = -1; this.game.menuHover = null; }
    this.syncBuildPause();
  }

  openBuildMenu(cellIdx: number) {
    this.closeBuildMenu();
    const g = this.game!;
    g.menuCell = cellIdx;
    const c = g.cells[cellIdx];
    audio.ui('click');
    if (!this.save.seen['guide_build']) { this.save.seen['guide_build'] = true; this.persist(); this.clearGuideHighlight(); }

    const menu = el('div', 'panel build-menu');
    menu.id = 'build-menu';
    menu.append(el('div', 'bm-title', 'Build'));
    const grid = el('div', 'bm-grid');
    for (const spec of TOWERS) {
      const cost = g.costOf(spec);
      const poor = g.credits < cost;
      const item = el('button', `bm-item${poor ? ' poor' : ''}`) as HTMLButtonElement;
      const mini = document.createElement('canvas');
      mini.width = 68; mini.height = 68;
      this.drawMiniTower(mini, spec);
      item.append(mini, el('span', 'bm-name', spec.name), el('span', 'bm-cost', `◆ ${cost}`));
      item.title = spec.blurb;
      item.disabled = poor;
      item.onmouseenter = () => { g.menuHover = spec; };
      item.onmouseleave = () => { if (g.menuHover === spec) g.menuHover = null; };
      item.addEventListener('touchstart', () => { g.menuHover = spec; }, { passive: true });
      item.addEventListener('touchend', () => { if (g.menuHover === spec) g.menuHover = null; });
      item.addEventListener('touchcancel', () => { if (g.menuHover === spec) g.menuHover = null; });
      item.onclick = () => {
        this.closeBuildMenu();
        this.showBuildConfirm(cellIdx, spec);
      };
      grid.append(item);
    }
    menu.append(grid);

    // position adjacent to the cell, clamped to the playfield
    this.root.append(menu);
    if (this.isCoarse) {
      menu.classList.add('sheet');
    } else {
      const cs = g.cell;
      const mw = 336, mh = 232;
      let x = c.x + cs * 0.7;
      let y = c.y - mh / 2;
      if (x + mw > W - 10) x = c.x - cs * 0.7 - mw;
      y = Math.max(64, Math.min(H - mh - 12, y));
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
    }
    this.syncBuildPause();
    this.repositionPopups();
  }

  // ---------- 2-step placement: build ----------
  showBuildConfirm(cellIdx: number, spec: TowerSpec) {
    document.getElementById('place-confirm')?.remove();
    const g = this.game!;
    if (!g.tryBuildAt(cellIdx, spec)) { audio.ui('deny'); this.syncBuildPause(); return; }
    const c = g.cells[cellIdx];
    const cost = g.costOf(spec);
    const box = el('div', 'panel place-confirm');
    box.id = 'place-confirm';
    box.append(el('div', 'pc-title', `Build ${spec.name}?`));
    box.append(el('div', 'pc-cost', `◆ ${cost}`));
    const row = el('div', 'result-row');
    const cancel = el('button', 'btn', 'Cancel');
    cancel.onclick = () => {
      audio.ui('click');
      g.cancelBuild();
      box.remove();
      this.syncBuildPause();
    };
    const isFirstBuild = !this.save.seen['guide_confirm'];
    const confirm = el('button', 'btn primary', 'Build');
    confirm.onclick = () => {
      audio.ui('click');
      g.confirmBuild();
      box.remove();
      this.syncBuildPause();
      if (isFirstBuild) this.guideLaunchHint();
    };
    row.append(confirm, cancel);
    box.append(row);
    this.root.append(box);
    this.positionNearCell(box, c, 190, 108);
    this.syncBuildPause();
    this.repositionPopups();
    if (isFirstBuild) {
      this.save.seen['guide_confirm'] = true;
      this.persist();
      confirm.classList.add('guide-pulse');
    }
  }

  // ---------- 2-step placement: move ----------
  showMoveConfirm() {
    document.getElementById('place-confirm')?.remove();
    const g = this.game!;
    const pm = g.pendingMove;
    if (!pm) return;
    const c = g.cells[pm.cellIdx];
    const box = el('div', 'panel place-confirm');
    box.id = 'place-confirm';
    box.append(el('div', 'pc-title', `Move ${pm.tower.displayName}?`));
    const row = el('div', 'result-row');
    const cancel = el('button', 'btn', 'Cancel');
    cancel.onclick = () => {
      audio.ui('click');
      const t = pm.tower;
      g.cancelMove();
      g.selected = t;
      box.remove();
      this.renderSidePanel();
    };
    const confirm = el('button', 'btn primary', 'Move');
    confirm.onclick = () => {
      audio.ui('click');
      g.confirmMove();
      box.remove();
      this.renderSidePanel();
    };
    row.append(confirm, cancel);
    box.append(row);
    this.root.append(box);
    this.positionNearCell(box, c, 190, 90);
    this.syncBuildPause();
    this.repositionPopups();
  }

  positionNearCell(box: HTMLElement, c: { x: number; y: number }, bw: number, bh: number) {
    let x = c.x + 26, y = c.y - bh / 2;
    if (x + bw > W - 10) x = c.x - 26 - bw;
    y = Math.max(64, Math.min(H - bh - 12, y));
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
  }

  drawMiniTower(cv: HTMLCanvasElement, spec: TowerSpec, scale = 2) {
    const g = cv.getContext('2d')!;
    g.scale(scale, scale);
    g.translate(cv.width / scale / 2, cv.height / scale / 2);
    g.fillStyle = 'rgba(4,5,14,0.4)';
    g.beginPath(); g.arc(2, 3, 13, 0, 7); g.fill();
    g.fillStyle = '#2b2e52';
    g.beginPath(); g.arc(0, 0, 13, 0, 7); g.fill();
    const c = spec.color, c2 = spec.color2;
    switch (spec.kind) {
      case 'bullet': {
        const long = spec.id === 'sentinel';
        g.strokeStyle = c2; g.lineWidth = long ? 3 : 4; g.lineCap = 'round';
        g.beginPath(); g.moveTo(2, -2); g.lineTo(long ? 13 : 10, long ? -9 : -7); g.stroke();
        g.fillStyle = c; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill();
        g.fillStyle = '#ffffff66'; g.beginPath(); g.arc(-2, -2, 2.2, 0, 7); g.fill();
        break;
      }
      case 'mortar':
        g.fillStyle = c; g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill();
        g.fillStyle = c2; g.beginPath(); g.arc(1.4, 1.4, 5.4, 0, 7); g.fill();
        g.fillStyle = '#20223c'; g.beginPath(); g.arc(1.4, 1.4, 3.2, 0, 7); g.fill();
        break;
      case 'cryo':
        g.strokeStyle = c; g.lineWidth = 2.6; g.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI / 3;
          g.beginPath(); g.moveTo(Math.cos(a) * -9, Math.sin(a) * -9); g.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); g.stroke();
        }
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, 2.6, 0, 7); g.fill();
        break;
      case 'missile':
        g.save(); g.rotate(-0.5);
        g.fillStyle = c; (g as any).beginPath(); (g as any).roundRect(-8, -8, 16, 16, 4); g.fill();
        g.fillStyle = c2;
        for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(-3.5 + (i % 2) * 7, -3.5 + Math.floor(i / 2) * 7, 2, 0, 7); g.fill(); }
        g.restore();
        break;
      case 'tesla':
        g.fillStyle = c2;
        for (let i = 0; i < 3; i++) { const a = i * 2.1; g.beginPath(); g.arc(Math.cos(a) * 9, Math.sin(a) * 9, 2.2, 0, 7); g.fill(); }
        g.fillStyle = c; g.beginPath(); g.arc(0, 0, 6, 0, 7); g.fill();
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(-1.6, -1.6, 2, 0, 7); g.fill();
        break;
      case 'amp':
        g.save(); g.rotate(Math.PI / 4);
        g.fillStyle = c; (g as any).beginPath(); (g as any).roundRect(-7, -7, 14, 14, 3); g.fill();
        g.restore();
        g.strokeStyle = c2; g.lineWidth = 1.8; g.setLineDash([4, 4]);
        g.beginPath(); g.arc(0, 0, 11, 0, 7); g.stroke();
        g.setLineDash([]);
        break;
      case 'prism':
        g.fillStyle = c;
        g.beginPath(); g.moveTo(0, -10); g.lineTo(8, 0); g.lineTo(0, 10); g.lineTo(-8, 0); g.closePath(); g.fill();
        g.fillStyle = '#ffffff88';
        g.beginPath(); g.moveTo(0, -5); g.lineTo(3.4, 0); g.lineTo(0, 5); g.lineTo(-3.4, 0); g.closePath(); g.fill();
        break;
      case 'ray':
        g.save(); g.rotate(-0.5);
        g.fillStyle = c2; (g as any).beginPath(); (g as any).roundRect(-4, -4, 15, 8, 3); g.fill();
        g.fillStyle = c; (g as any).beginPath(); (g as any).roundRect(-3, -2.8, 12.6, 5.6, 2.4); g.fill();
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(10, 0, 2, 0, 7); g.fill();
        g.restore();
        g.fillStyle = c; g.beginPath(); g.arc(-3, 2, 4.6, 0, 7); g.fill();
        break;
      case 'flame':
        g.fillStyle = c; g.beginPath(); g.arc(-2, 0, 7, 0, 7); g.fill();
        g.fillStyle = c2;
        g.beginPath(); g.moveTo(3, -4); g.lineTo(11, -6); g.lineTo(11, 6); g.lineTo(3, 4); g.closePath(); g.fill();
        g.fillStyle = '#ffd9a0'; g.beginPath(); g.arc(-2, 0, 2.4, 0, 7); g.fill();
        break;
    }
  }

  refreshAbilities() {
    const g = this.game;
    if (!g) return;
    for (const key of Object.keys(this.abilityBtns)) {
      this.abilityBtns[key].classList.toggle('selected', g.armed === key);
    }
  }
  armAbility(key: 'orbital' | 'stasis') {
    const g = this.game!;
    if (!this.abilityBtns[key]) return;
    if (g.cds[key] > 0) { audio.ui('deny'); return; }
    audio.ui('click');
    this.closeBuildMenu();
    g.armed = g.armed === key ? null : key;
    this.refreshAbilities();
  }

  togglePause() {
    const g = this.game!;
    g.paused = !g.paused;
    audio.ui('click');
    (this.hudRefs.pause as HTMLElement).textContent = g.paused ? '▶' : '⏸';
    (this.hudRefs.pause as HTMLElement).classList.toggle('active', g.paused);
  }

  updateHud() {
    const g = this.game;
    if (!g || !this.hudRefs.credits) return;
    const L = this.lastHud;
    // pending-interest preview: visible while a wave is active and interest is unlocked
    {
      const pend = g.waveActive && isUnlocked('interest')
        ? Math.min(Math.floor(g.credits * 0.06), g.interestCap) : 0;
      const txt = pend > 0 ? `▲${pend}` : '';
      const ip = this.hudRefs.interestPreview as HTMLElement;
      if (ip && ip.textContent !== txt) ip.textContent = txt;
    }
    // combo counter: appears at ×3, pulses on increment
    {
      const c = this.hudRefs.combo as HTMLElement;
      if (c) {
        const show = g.comboCount >= 3;
        const txt = show ? `×${g.comboCount}` : '';
        if (c.textContent !== txt) {
          c.textContent = txt;
          c.classList.toggle('on', show);
          if (show) { c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse'); }
        }
      }
    }
    if (g.credits !== L.credits) {
      this.hudRefs.credits.textContent = `${g.credits}`;
      if (L.credits >= 0) { this.hudRefs.creditsWrap.classList.remove('bump'); void (this.hudRefs.creditsWrap as HTMLElement).offsetWidth; this.hudRefs.creditsWrap.classList.add('bump'); }
      this.refreshTreeAffordability();
      L.credits = g.credits;
      // refresh build-menu affordability live
      const menu = document.getElementById('build-menu');
      if (menu) {
        const items = menu.querySelectorAll('.bm-item');
        TOWERS.forEach((spec, i) => {
          const poor = g.credits < g.costOf(spec);
          (items[i] as HTMLButtonElement).disabled = poor;
          items[i].classList.toggle('poor', poor);
        });
      }
    }
    if (g.lives !== L.lives) {
      this.hudRefs.lives.textContent = `${g.lives}`;
      if (L.lives >= 0) { this.hudRefs.livesWrap.classList.remove('bump'); void (this.hudRefs.livesWrap as HTMLElement).offsetWidth; this.hudRefs.livesWrap.classList.add('bump'); }
      L.lives = g.lives;
    }
    const wv = Math.max(0, g.waveIdx + 1);
    if (wv !== L.wave) {
      this.hudRefs.wave.textContent = this.isEndless ? `Wave ${wv}` : `${wv} / ${g.totalWaves}`;
      L.wave = wv;
    }
    const canCall = g.state === 'playing' && !g.waveActive && (this.isEndless || g.waveIdx + 1 < g.totalWaves);
    (this.hudRefs.callWrap as HTMLElement).style.display = canCall ? 'flex' : 'none';
    if (canCall) {
      const secs = Math.ceil(g.interT);
      const bonus = Math.round(g.interT * 3);
      this.hudRefs.callBonus.textContent = bonus > 1 ? `+${bonus} ◆ if launched now` : '';
      this.hudRefs.callBtn.textContent = `Launch wave (${secs}s)`;
    }
    this.updateWavePreview();
    for (const key of Object.keys(this.abilityBtns)) {
      const btn = this.abilityBtns[key];
      const cd = g.cds[key];
      const max = (ABILITIES as any)[key].cd;
      (btn.querySelector('.cd-mask') as HTMLElement).style.height = `${(cd / max) * 100}%`;
      (btn.querySelector('.cd-num') as HTMLElement).textContent = cd > 0 ? `${Math.ceil(cd)}` : '';
    }
    this.updateEnemyTip();
    const boss = g.enemies.find(e => e.spec.boss && !e.dead) || null;
    this.notify.bossAlive = !!boss;
    if (!boss) this.notify.pumpLow();
    // boss health bar
    {
      const bar = this.hudRefs.bossBar as HTMLElement | undefined;
      if (bar) {
        bar.classList.toggle('on', !!boss);
        (this.hudRefs.combo as HTMLElement)?.classList.toggle('with-boss', !!boss);
        if (boss) {
          const name = this.hudRefs.bossName as HTMLElement;
          const label = `${boss.spec.name}${boss.bossPhase === 2 ? ' — PHASE 2' : ''}`;
          if (name.textContent !== label) { name.textContent = label; name.style.color = boss.spec.color; }
          (this.hudRefs.bossFill as HTMLElement).style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
          (this.hudRefs.bossShield as HTMLElement).style.width = boss.maxShield > 0 ? `${(boss.shield / boss.maxShield) * 100}%` : '0%';
        }
      }
    }
    // NOVA meter
    {
      const nova = this.hudRefs.nova as HTMLElement | undefined;
      if (nova) {
        const frac = Math.min(1, g.novaCharge / g.novaNeed);
        (this.hudRefs.novaFill as HTMLElement).style.height = `${frac * 100}%`;
        nova.classList.toggle('ready', frac >= 1 && g.novaFireAt === 0);
        nova.classList.toggle('firing', g.novaFireAt > 0);
      }
    }
    // adaptive music intensity
    audio.setIntensity(g.waveActive && g.state === 'playing', (!!boss || (g.state === 'playing' && g.lives / g.maxLives < 0.25)) );
  }

  private lastPreviewKey = '';
  updateWavePreview() {
    const g = this.game;
    const wrap = this.hudRefs.wavePreview as HTMLElement | undefined;
    if (!g || !wrap) return;
    const wave = g.state === 'playing' ? g.pendingWave : null;
    if (!wave || !wave.length) { if (this.lastPreviewKey !== '') { wrap.innerHTML = ''; this.lastPreviewKey = ''; } return; }
    const agg = (w: { e: string; n: number }[]) => {
      const counts = new Map<string, number>();
      for (const grp of w) counts.set(grp.e, (counts.get(grp.e) || 0) + grp.n);
      return counts;
    };
    const counts = agg(wave);
    const counts2 = g.pending2Wave ? agg(g.pending2Wave) : null;
    const key = [...counts.entries()].map(([k, v]) => `${k}:${v}`).join(',')
      + `|${g.pendingMutator || ''}|${counts2 ? [...counts2.keys()].join(',') : ''}|${g.pending2Mutator || ''}`;
    if (key === this.lastPreviewKey) return;
    this.lastPreviewKey = key;
    wrap.innerHTML = '';
    const mkChip = (mid: string | null, parent: HTMLElement) => {
      if (!mid) return;
      const m = MUTATORS[mid];
      const chip = el('span', 'wp-mut', `${m.icon} ${m.name}`);
      chip.style.color = m.color;
      chip.title = m.blurb;
      parent.append(chip);
    };
    wrap.append(el('span', 'wp-label', 'Next:'));
    mkChip(g.pendingMutator, wrap);
    for (const [id, n] of counts) {
      const spec = ENEMIES[id];
      const item = el('div', `wp-item${spec.boss ? ' boss' : ''}`);
      const mini = document.createElement('canvas');
      mini.width = 96; mini.height = 96;
      this.drawMiniEnemy(mini, spec);
      item.append(mini, el('span', 'wp-count', spec.boss ? spec.name : `×${n}`));
      item.title = `${spec.name} — ${spec.desc}${spec.counters ? `\nWeak to: ${spec.counters.map(c2 => TOWERS.find(t => t.id === c2)?.name).filter(Boolean).join(', ')}` : ''}`;
      wrap.append(item);
    }
    // dimmed second-wave forecast
    if (counts2) {
      const then = el('div', 'wp-then');
      then.append(el('span', 'wp-label', 'Then:'));
      mkChip(g.pending2Mutator, then);
      let shown = 0;
      for (const [id, n] of counts2) {
        if (shown++ >= 3) { then.append(el('span', 'wp-count', '…')); break; }
        const spec = ENEMIES[id];
        const item = el('div', `wp-item${spec.boss ? ' boss' : ''}`);
        const mini = document.createElement('canvas');
        mini.width = 96; mini.height = 96;
        this.drawMiniEnemy(mini, spec);
        item.append(mini, el('span', 'wp-count', spec.boss ? spec.name : `×${n}`));
        then.append(item);
      }
      wrap.append(then);
    }
  }

  updateEnemyTip() {
    const g = this.game;
    let tip = document.getElementById('enemy-tip');
    if (this.pinnedEnemyTip?.dead) this.pinnedEnemyTip = null;
    const e = this.pinnedEnemyTip
      || (g && g.state === 'playing' && !g.moveArmed && !g.pendingMove && !g.pendingBuild ? g.enemyAt(g.mx, g.my) : null);
    if (!e) { tip?.remove(); return; }
    if (!tip) {
      tip = el('div', 'panel');
      tip.id = 'enemy-tip';
      this.root.append(tip);
    }
    const rows: string[] = [];
    rows.push(`<div class="et-name" style="color:${e.spec.color}">${e.spec.name}</div>`);
    if (e.isElite) {
      const names: Record<string, string> = { shielded: 'Shielded (30% shield)', swift: 'Swift (+30% speed)', vampiric: 'Vampiric (heals nearby)' };
      const affixText = e.eliteAffixes.map(a => names[a]).join(' + ');
      rows.push(`<div class="et-row"><span style="color:#ffd97a">♛ ELITE</span><b style="color:#ffd97a">${affixText}</b></div>`);
    }
    rows.push(`<div class="et-row"><span>HP</span><b>${fmt(Math.ceil(e.hp))} / ${fmt(e.maxHp)}</b></div>`);
    if (e.maxShield > 0) rows.push(`<div class="et-row"><span>Shield</span><b>${fmt(Math.ceil(e.shield))} / ${fmt(e.maxShield)}</b></div>`);
    const eff = e.effSpeed(g!.now);
    rows.push(`<div class="et-row"><span>Speed</span><b>${Math.round(eff)}${eff < e.spec.speed - 0.5 ? ` <i>(${e.spec.speed})</i>` : ''}</b></div>`);
    if (g!.now < e.burnUntil && e.burnDps > 0) rows.push(`<div class="et-row"><span>Burning</span><b>${Math.round(e.burnDps)}/s</b></div>`);
    if (g!.now < e.frozenUntil) rows.push(`<div class="et-row"><span>Status</span><b>Frozen</b></div>`);
    else if (g!.now < e.slowUntil) rows.push(`<div class="et-row"><span>Slowed</span><b>${Math.round(e.slowPct * 100)}%</b></div>`);
    if (e.phased) rows.push(`<div class="et-row"><span>Status</span><b>Phased</b></div>`);
    if (e.spec.counters) {
      const names = e.spec.counters.map(cid => {
        const t = TOWERS.find(tw => tw.id === cid);
        return t ? `<span style="color:${t.color}">${t.name}</span>` : '';
      }).filter(Boolean).join(' · ');
      rows.push(`<div class="et-row"><span>Weak to</span><b>${names}</b></div>`);
    }
    rows.push(`<div class="et-row"><span>Bounty</span><b>◆ ${(e as any).reward}</b></div>`);
    rows.push(`<div class="et-row"><span>Hull dmg</span><b>−${e.spec.leak}</b></div>`);
    tip.innerHTML = rows.join('');
    let x = e.x + e.spec.size + 16, y = e.y - 40;
    if (x > W - 170) x = e.x - e.spec.size - 16 - 156;
    y = Math.max(64, Math.min(H - 170, y));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    this.repositionPopups();
  }

  // ---------- popup overlap avoidance ----------
  // Converts a screen-space DOMRect into the game's own coordinate space
  // (the whole #ui-root is scaled via CSS transform to fit the window).
  private toLocalRect(r: DOMRect) {
    const root = this.root.getBoundingClientRect();
    return {
      left: (r.left - root.left) / this.scale,
      right: (r.right - root.left) / this.scale,
      top: (r.top - root.top) / this.scale,
      bottom: (r.bottom - root.top) / this.scale,
    };
  }
  private rectsOverlap(a: { left: number; right: number; top: number; bottom: number }, b: typeof a) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }
  // Nudges `movable` (a floating, transient popup like the enemy tooltip) away from
  // any currently-visible `anchors` (persistent popups) it happens to overlap.
  private avoidOverlap(movable: HTMLElement, anchorIds: string[]) {
    const pad = 10;
    for (const id of anchorIds) {
      const anchor = document.getElementById(id);
      if (!anchor || anchor === movable) continue;
      const mv = this.toLocalRect(movable.getBoundingClientRect());
      const an = this.toLocalRect(anchor.getBoundingClientRect());
      if (!this.rectsOverlap(mv, an)) continue;
      const w = mv.right - mv.left, h = mv.bottom - mv.top;
      // prefer sliding below the anchor, then above, then to whichever side has room
      let newTop = an.bottom + pad;
      if (newTop + h > H - 10) newTop = an.top - pad - h;
      if (newTop >= 54 && newTop + h <= H - 10) {
        movable.style.top = `${newTop}px`;
      } else {
        let newLeft = an.right + pad;
        if (newLeft + w > W - 10) newLeft = an.left - pad - w;
        movable.style.left = `${Math.max(10, Math.min(W - w - 10, newLeft))}px`;
      }
    }
  }
  // Called whenever a floating popup is (re)positioned, to keep popup text from overlapping.
  repositionPopups() {
    const tip = document.getElementById('enemy-tip');
    if (tip) this.avoidOverlap(tip, ['side-panel', 'build-menu', 'place-confirm']);
  }

  banner(text: string, color = '#eef0ff', tier: 'critical' | 'medium' | 'low' = 'medium', sub?: string) {
    if (tier === 'critical') this.notify.critical(text, color);
    else if (tier === 'low') this.notify.low(text);
    else this.notify.medium(text, color, sub);
  }

  // One-time tutorial toast: fires only on first encounter, then never again.
  toastOnce(key: string, text: string) {
    if (this.save.seen[key]) return;
    this.save.seen[key] = true;
    this.persist();
    this.notify.low(text);
  }

  // ---------- side panel (adjacent to tower) ----------
  closeSidePanel() { document.getElementById('side-panel')?.remove(); this.syncBuildPause(); }

  renderSidePanel() {
    this.closeSidePanel();
    const g = this.game;
    if (!g) return;
    const t = g.selected;
    if (!t) { this.syncBuildPause(); return; }

    const panel = el('div', 'panel');
    panel.id = 'side-panel';
    const s = t.stats(g);
    const base = t.baseStats(g);
    panel.append(el('h3', '', `<span style="color:${t.spec.color}">●</span> ${t.displayName}`));
    panel.append(el('div', 'sp-desc', s.desc));
    if (t.kills > 0 || t.dmgDealt > 0) {
      const eff = t.spent > 0 ? t.creditsEarned / t.spent : 0;
      panel.append(el('div', 'sp-perf', `${fmt(Math.round(t.dmgDealt))} dmg · ${t.kills} kill${t.kills === 1 ? '' : 's'} · ${eff.toFixed(1)}× value`));
    }

    // primary stats — Damage/Rate/Range/Splash/Targets, packed two-per-row to save vertical space
    const primary = el('div', 'sp-stats2');
    const items: string[] = [];
    const pitem = (label: string, baseV: string, ampV: string | null) => {
      items.push(`<div class="ss-item"><span>${label}</span><b>${ampV !== null
        ? `<span class="stat-amped">${ampV}</span> <span class="stat-base">(${baseV})</span>`
        : baseV}</b></div>`);
    };
    if (s.dmg || t.spec.kind === 'prism') pitem('Damage', `${Math.round(base.dmg)}`, t.bDmg > 0 ? `${Math.round(s.dmg)}` : null);
    if (s.rate) pitem('Rate', `${base.rate.toFixed(1)}/s`, t.bRate > 0 ? `${s.rate.toFixed(1)}/s` : null);
    pitem('Range', `${Math.round(base.range)} tiles`, t.bRange > 0 ? `${Math.round(s.range)} tiles` : null);
    if (s.splash) pitem('Splash', `${Math.round(s.splash)}`, null);
    if (t.spec.kind !== 'amp') pitem('Targets', s.groundOnly ? '⛔ Ground only' : (s.airMul || 1) > 1 ? '✈ Air ×2' : '✈ Air + Ground', null);
    for (let i = 0; i < items.length; i += 2) {
      primary.innerHTML += `<div class="ss-row">${items[i]}${items[i + 1] || ''}</div>`;
    }
    panel.append(primary);

    // remaining, less-common stats — one per row, unchanged layout
    const grid = el('div', 'sp-stats');
    const stat = (label: string, baseV: string, ampV: string | null) => {
      grid.innerHTML += `<span>${label}</span><b>${ampV !== null
        ? `<span class="stat-amped">${ampV}</span> <span class="stat-base">(${baseV})</span>`
        : baseV}</b>`;
    };
    if (s.slow) stat('Slow', `${Math.round(s.slow * 100)}%`, null);
    if (s.chains) stat('Chains', `${s.chains}`, null);
    if (s.burnDps) stat('Burn', `${Math.round(base.burnDps || 0)}/s`, t.bDmg > 0 ? `${Math.round(s.burnDps)}/s` : null);
    if (s.rayWidth) stat('Beam', 'line', null);
    if ((base.crit || 0) > 0 || t.bCrit > 0) stat('Crit', `${Math.round((base.crit || 0) * 100)}%`, t.bCrit > 0 ? `${Math.round(s.crit * 100)}%` : null);
    panel.append(grid);
    if (t.buffed) {
      const bits: string[] = [];
      if (t.bDmg > 0) bits.push(`+${Math.round(t.bDmg * 100)}% dmg`);
      if (t.bRate > 0) bits.push(`+${Math.round(t.bRate * 100)}% rate`);
      const tileGain = Math.round(s.range) - Math.round(base.range);
      if (tileGain > 0) bits.push(`+${tileGain} range`);
      if (t.bCrit > 0) bits.push(`+${Math.round(t.bCrit * 100)}% crit`);
      panel.append(el('div', 'amped-note', `⟡ Amplified: ${bits.join(' · ')}`));
    }

    if (t.spec.kind !== 'amp' && !t.raw.aura) {
      const tips: Record<string, string> = {
        first: 'Target the alien furthest along the path (default)',
        last: 'Target the alien closest to the spawn portal',
        strong: 'Target the alien with the most health + shield',
        weak: 'Target the alien with the least health — good for finishing kills',
        close: 'Target the alien nearest to this tower',
      };
      const row = el('div', 'target-row');
      for (const m of ['first', 'last', 'strong', 'weak', 'close'] as const) {
        const chip = el('button', `target-chip${t.mode === m ? ' on' : ''}`, m[0].toUpperCase() + m.slice(1));
        chip.title = tips[m];
        chip.onclick = () => { t.mode = m; t.target = null; audio.ui('click'); this.renderSidePanel(); };
        row.append(chip);
      }
      panel.append(row);
    }

    panel.append(this.buildTechTree(g, t));

    const actionRow = el('div', 'panel-actions');
    const move = el('button', 'move-btn', 'Move');
    move.onclick = () => {
      audio.ui('click');
      g.armMove(t);
      this.closeSidePanel();
    };
    const sell = el('button', 'sell-btn', `Sell — full refund ◆ ${t.spent}`);
    sell.onclick = () => { g.sell(t); this.closeSidePanel(); };
    actionRow.append(move, sell);
    panel.append(actionRow);

    // position adjacent to the tower, clamped
    this.root.append(panel);
    if (this.isCoarse) {
      panel.classList.add('sheet');
      const handle = document.createElement('div');
      handle.className = 'sheet-handle';
      panel.prepend(handle);
    } else {
      const pw = 400;
      const ph = Math.min(620, panel.offsetHeight || 500);
      let x = t.x + t.spec.size + 26;
      let y = t.y - ph / 2;
      if (x + pw > W - 10) x = t.x - t.spec.size - 26 - pw;
      y = Math.max(64, Math.min(H - ph - 12, y));
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
    }
    this.syncBuildPause();
    this.repositionPopups();
  }

  // Full upgrade tech tree: Mk II / Mk III span all columns, branch stages one column each.
  // Bought nodes can be clicked again to refund them (and everything that depends on them).
  private treeRefs: { node: HTMLButtonElement; cost: number; avail: boolean }[] = [];
  buildTechTree(g: Game, t: Tower) {
    const tree = el('div', 'tech-tree');
    this.treeRefs = [];
    type NodeDef = { st: any; wide: boolean; state: 'bought' | 'avail' | 'locked'; buy?: () => void; refund?: () => void };
    const nodes: NodeDef[] = [];
    const stageState = (i: number): NodeDef['state'] =>
      (t.branch >= 0 || t.stage >= i) ? 'bought' : t.stage === i - 1 ? 'avail' : 'locked';
    nodes.push({ st: t.spec.stages[1], wide: true, state: stageState(1), buy: () => g.buyUpgrade(t), refund: () => g.refundNode(t, 'stage', 1) });
    nodes.push({ st: t.spec.stages[2], wide: true, state: stageState(2), buy: () => g.buyUpgrade(t), refund: () => g.refundNode(t, 'stage', 2) });
    for (const row of [0, 1]) {
      for (let b = 0; b < t.spec.branches.length; b++) {
        const st = t.spec.branches[b][row];
        let state: NodeDef['state'] = 'locked';
        let buy: (() => void) | undefined;
        let refund: (() => void) | undefined;
        if (row === 0) {
          if (t.branch === b) { state = 'bought'; refund = () => g.refundNode(t, 'branch', 0); }
          else if (t.branch < 0 && t.stage === 2) { state = 'avail'; buy = () => g.buyUpgrade(t, b); }
        } else {
          if (t.branch === b && t.branchStage >= 1) { state = 'bought'; refund = () => g.refundNode(t, 'branch', 1); }
          else if (t.branch === b && t.branchStage === 0) { state = 'avail'; buy = () => g.buyUpgrade(t); }
        }
        nodes.push({ st, wide: false, state, buy, refund });
      }
    }
    for (const nd of nodes) {
      const cost = g.upgradeCost(nd.st);
      const afford = g.credits >= cost;
      const unavailable = nd.state === 'locked' || (nd.state === 'avail' && !afford);
      const cls = `tree-node ${nd.state}${nd.state === 'avail' && !afford ? ' poor' : ''}${nd.wide ? ' wide' : ''}`;
      const node = el('button', cls) as HTMLButtonElement;
      node.dataset.name = nd.st.name;
      const statBits: string[] = [];
      if (nd.st.dmg) statBits.push(`⚔ ${nd.st.dmg}`);
      if (nd.st.rate) statBits.push(`${nd.st.rate}/s`);
      statBits.push(`◎ ${nd.st.range}`);
      if (nd.st.splash) statBits.push(`✺ ${nd.st.splash}`);
      if (nd.st.slow) statBits.push(`❄ ${Math.round(nd.st.slow * 100)}%`);
      if (nd.st.freeze) statBits.push(`freeze ${Math.round(nd.st.freeze * 100)}%`);
      if (nd.st.chains) statBits.push(`⌁ ×${nd.st.chains}`);
      if (nd.st.stun) statBits.push(`stun ${Math.round(nd.st.stun * 100)}%`);
      if (nd.st.burnDps) statBits.push(`🔥 ${nd.st.burnDps}/s`);
      if (nd.st.pierce) statBits.push(`pierce ${nd.st.pierce}`);
      if (nd.st.shots) statBits.push(`×${nd.st.shots}`);
      if (nd.st.beams) statBits.push(`beams ${nd.st.beams}`);
      if (nd.st.rampMax) statBits.push(`ramp ${nd.st.rampMax}×`);
      if (nd.st.airMul && nd.st.airMul > 1) statBits.push(`✈ ×${nd.st.airMul}`);
      if (nd.st.crit) statBits.push(`crit ${Math.round(nd.st.crit * 100)}%`);
      if (nd.st.buffDmg) statBits.push(`+${Math.round(nd.st.buffDmg * 100)}% dmg`);
      if (nd.st.buffRate) statBits.push(`+${Math.round(nd.st.buffRate * 100)}% rate`);
      node.innerHTML = `
        <span class="tn-head"><span class="tn-name">${unavailable ? '<span class="tn-x">✕</span> ' : ''}${nd.st.name}</span>
        <span class="tn-cost">${nd.state === 'bought' ? '★' : `◆ ${cost}`}</span></span>
        <span class="tn-desc">${nd.st.desc}</span>
        <span class="tn-stats">${statBits.join(' · ')}</span>`;
      if (nd.state === 'bought' && nd.refund) {
        node.title = 'Click to refund this upgrade (removes later upgrades too).';
        node.classList.add('refundable');
        node.onclick = () => { nd.refund!(); this.renderSidePanel(); };
      } else if (nd.state === 'avail' && nd.buy) {
        node.disabled = !afford;
        node.title = afford ? '' : 'Not enough credits yet.';
        node.onclick = () => { nd.buy!(); this.renderSidePanel(); };
        this.treeRefs.push({ node, cost, avail: true });
      } else {
        node.disabled = true;
        node.title = 'Not yet reachable in the tech tree.';
      }
      tree.append(node);
    }
    return tree;
  }

  // Called on credit changes: updates greyed-out state without rebuilding the panel (prevents flicker).
  refreshTreeAffordability() {
    const g = this.game;
    if (!g || !this.treeRefs.length || !document.getElementById('side-panel')) return;
    for (const ref of this.treeRefs) {
      const afford = g.credits >= ref.cost;
      ref.node.classList.toggle('poor', !afford);
      ref.node.disabled = !afford;
      ref.node.title = afford ? '' : 'Not enough credits yet.';
      const nameEl = ref.node.querySelector('.tn-name');
      const name = ref.node.dataset.name || '';
      if (nameEl) nameEl.innerHTML = (afford ? '' : '<span class="tn-x">✕</span> ') + name;
    }
  }


  // ---------- pause / quit ----------
  confirmQuit() {
    const g = this.game!;
    this.wasPaused = g.paused;
    g.paused = true;
    const dim = el('div', 'overlay-dim');
    const card = el('div', 'panel modal-card');
    card.append(el('h2', '', 'Leave this sector?'));
    card.append(el('div', 'tiny-note', 'Progress in this level will be lost.'));
    const row = el('div', 'result-row');
    const stay = el('button', 'btn', 'Keep fighting');
    stay.onclick = () => { audio.ui('click'); g.paused = this.wasPaused; dim.remove(); };
    const leave = el('button', 'btn pink', 'Leave');
    leave.onclick = () => { audio.ui('click'); this.showLevelSelect(); };
    row.append(stay, leave);
    card.append(row);
    dim.append(card);
    this.root.append(dim);
  }

  // ---------- results ----------
  showResult(won: boolean, stars: number) {
    const g = this.game!;
    this.closeBuildMenu();
    this.closeSidePanel();
    if (this.save.resume) { this.save.resume = undefined; this.persist(); }
    const prevBestCombo = this.save.stats.bestCombo;
    const prevEndlessBest = this.save.endlessBest[this.save.settings.difficulty ?? 2] || 0;

    // --- challenge evaluation (win only, not endless, not daily, only if this level has any) ---
    let chResults: boolean[] = [];
    let chNewlyEarned: boolean[] = [];
    let chromaJustUnlocked = false;
    if (won && !this.isEndless && !this.isDaily && this.current?.challenges?.length) {
      chResults = g.evaluateChallenges();
      const prev = this.save.challenges[this.current.id] || chResults.map(() => false);
      chNewlyEarned = chResults.map((got, i) => got && !prev[i]);
      this.save.challenges[this.current.id] = chResults.map((got, i) => got || !!prev[i]);
      // Chroma unlock: all 28 challenge stars, across every level
      const totalChallengeStars = Object.values(this.save.challenges).reduce((a, arr) => a + arr.filter(Boolean).length, 0);
      if (totalChallengeStars >= 28 && !this.save.chromaUnlocked) {
        this.save.chromaUnlocked = true;
        chromaJustUnlocked = true;
      }
    }

    let ascLeveledUp = false;
    let warmasterEarned = false;
    if (won && !this.isEndless && !this.isDaily && this.current) {
      const prev = this.save.stars[this.current.id] || 0;
      this.save.stars[this.current.id] = Math.max(prev, stars);
      this.save.unlocked = Math.max(this.save.unlocked, this.current.id + 1);
      setUnlockedLevel(this.save.unlocked);
      // Ascension: record the highest tier this level has been beaten at (crown badges),
      // and unlock the next tier when L15 falls at the currently-selected one.
      const tier = g.ascTier;
      const prevBest = this.save.ascension.bestPerLevel[this.current.id] || 0;
      if (tier > prevBest) this.save.ascension.bestPerLevel[this.current.id] = tier;
      if (this.current.id === 15 && tier === this.save.ascension.unlocked && tier < 5) {
        this.save.ascension.unlocked = tier + 1;
        this.save.ascension.current = tier + 1; // auto-select the newly earned tier
        ascLeveledUp = true;
      }
      if (this.current.id === 15 && tier === 5) {
        const allAtFive = LEVELS.every(l => (this.save.ascension.bestPerLevel[l.id] || 0) >= 5);
        if (allAtFive && !this.save.seen['warmaster']) { warmasterEarned = true; this.save.seen['warmaster'] = true; }
      }
    }
    let endlessMilestonesEarned: number[] = [];
    if (this.isEndless) {
      const tier = this.save.settings.difficulty ?? 2;
      this.save.endlessBest[tier] = Math.max(this.save.endlessBest[tier] || 0, g.waveIdx + 1);
      const reached = g.waveIdx + 1;
      const already = this.save.endlessMilestones[tier] || [];
      const newly = [10, 20, 30].filter(m => reached >= m && !already.includes(m));
      if (newly.length) {
        this.save.endlessMilestones[tier] = [...already, ...newly].sort((a, b) => a - b);
        endlessMilestonesEarned = newly;
      }
    }
    let dailyStreakBumped = false;
    let dailyNewStreak = 0;
    if (this.isDaily && won) {
      // Use the date this Daily Op actually represents (captured at run start), not
      // whatever the real-world date happens to be right now — a run started at 11:58pm
      // and finished after midnight should still credit the day it was actually playing,
      // the same way the run's own seed/composition never changes mid-play.
      const today = this.currentDaily?.dateStr ?? todayStr();
      if (this.save.daily.lastDate !== today) {
        const gap = this.save.daily.lastDate ? daysBetween(this.save.daily.lastDate, today) : null;
        this.save.daily.streak = gap === 1 ? this.save.daily.streak + 1 : 1;
        this.save.daily.lastDate = today;
        this.save.daily.lastWon = true;
        this.save.daily.bestStreak = Math.max(this.save.daily.bestStreak, this.save.daily.streak);
        dailyStreakBumped = true;
        dailyNewStreak = this.save.daily.streak;
      }
    }
    this.persist();

    const dim = el('div', 'overlay-dim');
    const card = el('div', 'panel result-card');

    // sequenced-reveal bookkeeping — tap anywhere to skip straight to the final state
    const pending: number[] = [];
    const after = (ms: number, fn: () => void) => { pending.push(window.setTimeout(fn, ms)); };
    let skipped = false;
    const skip = () => {
      if (skipped) return;
      skipped = true;
      for (const id of pending) clearTimeout(id);
      finalizeAll();
    };
    let finalizeAll: () => void = () => {};

    if (won) {
      card.append(el('h2', '', this.isDaily ? 'Daily Op cleared!' : this.isEndless ? `Wave ${g.waveIdx + 1} — new best!` : 'Sector held!'));
      const starsRow = el('div', 'r-stars');
      const starEls: HTMLElement[] = [];
      for (let i = 1; i <= 3; i++) {
        const s = el('span', 's star-off', '★');
        starEls.push(s);
        starsRow.append(s);
      }
      card.append(starsRow);
      card.append(el('div', 'r-sub', stars === 3 ? 'Flawless. Not a scratch on the hull.' : stars === 2 ? 'Held with minor damage.' : 'That was close. The station survived.'));

      // challenge badges — start face-down, flip to earned/failed during the sequence
      let chRow: HTMLElement | null = null;
      let chEls: HTMLElement[] = [];
      if (!this.isDaily && this.current?.challenges?.length) {
        chRow = el('div', 'r-challenges');
        chEls = this.current.challenges.map((c, i) => {
          const def = CHALLENGE_POOL[c.id];
          const b = el('div', 'r-ch facedown');
          b.innerHTML = `<span class="r-ch-icon">${def.icon}</span><span class="r-ch-name">${def.name}</span>`;
          chRow!.append(b);
          return b;
        });
        card.append(chRow);
      }

      const recordsEl = el('div', 'r-records');
      card.append(recordsEl);

      // build the reveal sequence: 3 stars, then challenge flips, then record callouts
      const steps: (() => void)[] = [];
      for (let i = 0; i < 3; i++) {
        steps.push(() => {
          if (i < stars) {
            starEls[i].classList.remove('star-off');
            starEls[i].classList.add('star-on', 'star-pop');
            audio.ui('coin');
            g.buzz([15]);
          }
        });
      }
      chEls.forEach((b, i) => {
        steps.push(() => {
          b.classList.remove('facedown');
          b.classList.add(chResults[i] ? 'earned' : 'failed', 'r-ch-flip');
          audio.ui(chResults[i] ? 'branch' : 'deny');
          if (chResults[i]) g.buzz([15]);
        });
      });
      steps.push(() => {
        const bits: string[] = [];
        if (g.runStats.bestCombo >= 5 && g.runStats.bestCombo > prevBestCombo) bits.push(`🔥 New best combo ×${g.runStats.bestCombo}!`);
        const earnedCount = chNewlyEarned.filter(Boolean).length;
        if (earnedCount > 0) bits.push(`★ ${earnedCount} new challenge star${earnedCount > 1 ? 's' : ''}!`);
        if (ascLeveledUp) bits.push(`⚔ Ascension ${['', 'I', 'II', 'III', 'IV', 'V'][this.save.ascension.current]} unlocked!`);
        if (warmasterEarned) bits.push(`👑 WARMASTER — every sector held at Ascension V!`);
        if (dailyStreakBumped) bits.push(`🔥 Daily streak: ${dailyNewStreak}${dailyNewStreak === this.save.daily.bestStreak && dailyNewStreak > 1 ? ' — new best!' : ''}`);
        if (chromaJustUnlocked) bits.push(`✦ CHROMA PALETTE UNLOCKED — try it in Settings!`);
        for (const b of bits) recordsEl.append(el('div', 'r-record', b));
      });

      let i = 0;
      const runNext = () => {
        if (i >= steps.length) return;
        steps[i](); i++;
        after(220, runNext);
      };
      finalizeAll = () => { while (i < steps.length) { steps[i](); i++; } };
      after(200, runNext);
      dim.addEventListener('click', ev => { if (!(ev.target as HTMLElement).closest('.result-row')) skip(); });
    } else {
      // --- defeat post-mortem ---
      card.append(el('h2', '', this.isEndless ? `Wave ${g.waveIdx + 1}` : 'Station lost'));
      card.append(el('div', 'r-sub', this.isEndless
        ? `You held the drift for ${g.waveIdx + 1} waves.${g.waveIdx + 1 >= prevEndlessBest ? ' New best!' : ''}`
        : `Broken on wave ${g.waveIdx + 1}. Rebuild and try a different layout.`));
      if (endlessMilestonesEarned.length) {
        const rec = el('div', 'r-records');
        for (const m of endlessMilestonesEarned) rec.append(el('div', 'r-record', `⭐ Endless milestone — wave ${m} reached!`));
        card.append(rec);
      }

      const leaks = Object.entries(g.runStats.leaksByEnemy).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (leaks.length) {
        const pm = el('div', 'post-mortem');
        const total = leaks.reduce((a, [, v]) => a + v, 0) || 1;
        for (const [id, dmg] of leaks) {
          const spec = ENEMIES[id];
          if (!spec) continue;
          const pct = Math.round((dmg / total) * 100);
          const counters = (spec.counters || []).map(cid => TOWERS.find(t => t.id === cid)?.name).filter(Boolean).join(', ');
          const row = el('div', 'pm-row');
          row.innerHTML = `<span class="pm-name" style="color:${spec.color}">${spec.name}</span>` +
            `<span class="pm-pct">${pct}% of hull loss</span>` +
            (counters ? `<span class="pm-counter">Counter with: ${counters}</span>` : '');
          pm.append(row);
        }
        card.append(pm);
      }
    }

    const row = el('div', 'result-row');
    const again = el('button', `btn${won ? '' : ' primary'}`, won ? 'Replay' : 'Retry');
    again.onclick = () => { audio.ui('click'); this.startLevel(this.current!, this.isEndless, this.currentDaily); };
    row.append(again);
    if (won && !this.isEndless && !this.isDaily && this.current && this.current.id < LEVELS.length) {
      const next = el('button', 'btn primary', 'Next sector →');
      next.onclick = () => { audio.ui('click'); this.startLevel(LEVELS[this.current!.id], false); };
      row.append(next);
    }
    const sel = el('button', 'btn subtle', won ? 'Sectors' : 'Change Loadout');
    sel.onclick = () => { audio.ui('click'); this.showLevelSelect(); };
    row.append(sel);
    card.append(row);
    dim.append(card);
    this.root.append(dim);
  }

  // ---------- dev panel ----------
  renderDevPanel() { /* legacy no-op — dev mode now lives in the popup window */ }

  showServiceRecord() {
    this.killGame();
    this.clearUI();
    const sc = el('div', 'screen');
    const head = el('div', 'screen-head');
    const back = el('button', 'btn subtle', '← Sectors');
    back.onclick = () => { audio.ui('click'); this.showLevelSelect(); };
    head.append(back, el('h2', '', 'Service Record'));
    sc.append(head);

    const s = this.save.stats;
    const favorite = Object.entries(s.towersBuilt).sort((a, b) => b[1] - a[1])[0];
    const favName = favorite ? TOWERS.find(t => t.id === favorite[0])?.name || favorite[0] : '—';
    const totalChallengeStars = Object.values(this.save.challenges).reduce((a, arr) => a + arr.filter(Boolean).length, 0);
    const totalLevelStars = Object.values(this.save.stars).reduce((a, b) => a + b, 0);
    const ascNames = ['Off', 'I', 'II', 'III', 'IV', 'V'];

    const stats: [string, string][] = [
      ['Total kills', fmt(s.kills)],
      ['Waves cleared', fmt(s.wavesCleared)],
      ['Elites slain', fmt(s.elitesSlain)],
      ['NOVAs fired', fmt(s.novasFired)],
      ['Best combo', `×${s.bestCombo}`],
      ['Favorite tower', favName],
      ['Level stars', `${totalLevelStars} / 45`],
      ['Challenge stars', `${totalChallengeStars} / 28`],
      ['Ascension unlocked', ascNames[this.save.ascension.unlocked]],
      ['Daily streak', `${this.save.daily.streak} (best ${this.save.daily.bestStreak})`],
      ['Play sessions', fmt(s.sessions)],
    ];
    const grid = el('div', 'record-grid');
    for (const [label, val] of stats) {
      const cell = el('div', 'record-cell');
      cell.innerHTML = `<div class="record-val">${val}</div><div class="record-label">${label}</div>`;
      grid.append(cell);
    }
    sc.append(grid);

    if (this.save.seen['warmaster']) {
      sc.append(el('div', 'warmaster-tag', '👑 WARMASTER — every sector held at Ascension V'));
    }
    this.root.append(sc);
  }

  showDevModal() {
    document.getElementById('dev-modal-dim')?.remove();
    const g = this.game;
    const wasPaused = g?.paused ?? false;
    if (g) g.paused = true;
    const dim = el('div', 'overlay-dim');
    dim.id = 'dev-modal-dim';
    const card = el('div', 'panel modal-card dev-modal');
    const active = this.devMode;
    card.append(el('h2', '', `⚑ Developer mode`));
    card.append(el('div', 'tiny-note', active ? 'Active — cheats enabled and all levels open.' : 'Inactive — activate below to enable the tools.'));

    const grid = el('div', 'dev-grid');
    const refresh = () => { dim.remove(); if (g) g.paused = wasPaused; this.showDevModal(); };
    const opt = (label: string, on: boolean | null, fn: () => void, toggle = false) => {
      const b = el('button', `dev-opt${toggle && on ? ' on' : ''}`, label) as HTMLButtonElement;
      b.disabled = !active;
      b.onclick = () => { audio.ui('click'); fn(); refresh(); };
      grid.append(b);
    };
    if (g) {
      opt(`God mode`, g.devGod, () => { g.devGod = !g.devGod; }, true);
      opt(`Free build`, g.devFree, () => { g.devFree = !g.devFree; }, true);
      opt('+1000 credits', null, () => { g.credits += 1000; });
      opt('Clear wave', null, () => {
        g.spawnQueue = [];
        for (const e of g.enemies) { e.hp = 0; e.dead = true; g.onKill(e); }
        g.enemies = [];
      });
      opt('Win level', null, () => { g.paused = false; g.win(); dim.remove(); });
      opt('Reset cooldowns', null, () => { g.cds.orbital = 0; g.cds.stasis = 0; });
    }
    opt('Unlock all levels', null, () => { this.save.unlocked = 16; this.persist(); });
    opt('Grant 45 stars', null, () => { for (const l of LEVELS) this.save.stars[l.id] = 3; this.persist(); });
    opt('Reset save', null, () => { localStorage.removeItem('starhold-save-v1'); this.save = loadSave(); });
    card.append(grid);

    const sel = document.createElement('select');
    sel.className = 'dev-select';
    sel.disabled = !active;
    sel.innerHTML = `<option value="">Jump to level…</option>` +
      LEVELS.map(l => `<option value="${l.id}">${l.id}. ${l.name}</option>`).join('') +
      `<option value="99">∞ Endless</option>`;
    sel.onchange = () => {
      const v = sel.value;
      if (!v) return;
      dim.remove();
      if (v === '99') this.startLevel(ENDLESS_LEVEL, true);
      else this.startLevel(LEVELS.find(l => l.id === +v)!, false);
    };
    card.append(sel);

    const master = el('button', `btn dev-master${active ? ' pink' : ' primary'}`,
      active ? 'Deactivate developer mode' : 'Activate developer mode');
    master.onclick = () => {
      audio.ui(active ? 'sell' : 'branch');
      this.devMode = !this.devMode;
      if (this.game) {
        this.game.dev = this.devMode;
        if (!this.devMode) { this.game.devGod = false; this.game.devFree = false; }
      }
      refresh();
    };
    card.append(master);

    const close = el('button', 'btn subtle', 'Close');
    close.onclick = () => { audio.ui('click'); dim.remove(); if (g) g.paused = wasPaused; };
    card.append(close);

    dim.append(card);
    this.root.append(dim);
  }
}
