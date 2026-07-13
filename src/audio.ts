// ================= Audio =================
// Everything is synthesized with the Web Audio API — no assets.
// Categories (independently toggleable): music, weapons, explosions, interface.

export interface AudioSettings {
  master: number;         // 0..1
  music: boolean;
  weapons: boolean;
  explosions: boolean;
  ui: boolean;
}

class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode;
  buses: Record<string, GainNode> = {};
  settings: AudioSettings = { master: 0.8, music: true, weapons: true, explosions: true, ui: true };
  private musicTimer: number | null = null;
  private nextBeat = 0;
  private beatIdx = 0;
  private started = false;

  // Suspends the audio context (called when the tab/app is backgrounded). ensure() already
  // resumes on the next user interaction, so this pairs cleanly with visibilitychange.
  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 5;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.settings.master;
    this.master.connect(comp);
    for (const b of ['music', 'weapons', 'explosions', 'ui']) {
      const gn = ctx.createGain();
      gn.gain.value = (this.settings as any)[b] ? 1 : 0;
      gn.connect(this.master);
      this.buses[b] = gn;
    }
    this.buses.music.gain.value = this.settings.music ? 0.5 : 0;
    // adaptive music layers: arp rides combat, percussion rides danger (boss / low hull)
    this.layerArp = ctx.createGain();
    this.layerArp.gain.value = 0.35;
    this.layerArp.connect(this.buses.music);
    this.layerPerc = ctx.createGain();
    this.layerPerc.gain.value = 0.0001;
    this.layerPerc.connect(this.buses.music);
  }

  private layerArp: GainNode | null = null;
  private layerPerc: GainNode | null = null;
  private intensity = { combat: false, danger: false };
  // Crossfade the adaptive layers (~1s). Called by the UI whenever game state changes.
  setIntensity(combat: boolean, danger: boolean) {
    if (this.intensity.combat === combat && this.intensity.danger === danger) return;
    this.intensity = { combat, danger };
    if (!this.ctx || !this.layerArp || !this.layerPerc) return;
    const t = this.ctx.currentTime;
    this.layerArp.gain.cancelScheduledValues(t);
    this.layerArp.gain.setValueAtTime(Math.max(0.0001, this.layerArp.gain.value), t);
    this.layerArp.gain.linearRampToValueAtTime(combat ? 1 : 0.35, t + 1);
    this.layerPerc.gain.cancelScheduledValues(t);
    this.layerPerc.gain.setValueAtTime(Math.max(0.0001, this.layerPerc.gain.value), t);
    this.layerPerc.gain.linearRampToValueAtTime(danger ? 0.9 : 0.0001, t + 1);
  }

  // Boss-approach klaxon: three descending two-tone blasts.
  klaxon() {
    if (!this.ctx || !this.settings.ui) return;
    const t = this.now();
    for (let i = 0; i < 3; i++) {
      this.osc('ui', 'square', 520, 520, t + i * 0.34, 0.14, 0.05);
      this.osc('ui', 'square', 370, 370, t + i * 0.34 + 0.15, 0.16, 0.05);
    }
  }

  // NOVA charge-up: a rising 1.2s swell.
  novaHum() {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = this.now();
    const o = c.createOscillator(); const o2 = c.createOscillator(); const gn = c.createGain();
    o.type = 'sawtooth'; o2.type = 'sine';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(340, t + 1.2);
    o2.frequency.setValueAtTime(140, t); o2.frequency.exponentialRampToValueAtTime(680, t + 1.2);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(0.16, t + 1.1);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);
    o.connect(gn); o2.connect(gn); gn.connect(this.buses.explosions);
    o.start(t); o2.start(t); o.stop(t + 1.4); o2.stop(t + 1.4);
  }

  novaBlast() {
    if (!this.ctx || !this.settings.explosions) return;
    const t = this.now();
    this.osc('explosions', 'sine', 220, 30, t, 0.9, 0.5);
    this.noise('explosions', t, 0.7, 0.4, 900, 1);
    this.noise('explosions', t + 0.05, 0.5, 0.3, 2600, 1);
  }

  apply(s: AudioSettings) {
    this.settings = s;
    if (!this.ctx) return;
    this.master.gain.value = s.master;
    this.buses.weapons.gain.value = s.weapons ? 1 : 0;
    this.buses.explosions.gain.value = s.explosions ? 1 : 0;
    this.buses.ui.gain.value = s.ui ? 1 : 0;
    this.buses.music.gain.value = s.music ? 0.5 : 0;
  }

  // ---------- primitives ----------
  private osc(bus: string, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol: number, curve = 2) {
    const c = this.ctx!; const o = c.createOscillator(); const gn = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    gn.gain.setValueAtTime(vol, t0);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(gn); gn.connect(this.buses[bus]);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  private noise(bus: string, t0: number, dur: number, vol: number, filterFreq = 2000, q = 0.7, sweepTo?: number) {
    const c = this.ctx!;
    const len = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(filterFreq, t0); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    const gn = c.createGain();
    gn.gain.setValueAtTime(vol, t0);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(gn); gn.connect(this.buses[bus]);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  private now() { return this.ctx ? this.ctx.currentTime : 0; }
  private ok(bus: string) { return !!this.ctx && (this.settings as any)[bus === 'ui' ? 'ui' : bus] !== false; }

  // ---------- weapon sounds ----------
  shoot(kind: string, level = 0) {
    if (!this.ctx || !this.settings.weapons) return;
    const t = this.now();
    const pitch = 1 + Math.random() * 0.12 - 0.06;
    switch (kind) {
      case 'pulse':
        this.osc('weapons', 'square', 920 * pitch, 240, t, 0.09, 0.11);
        this.osc('weapons', 'sine', 1400 * pitch, 500, t, 0.05, 0.05);
        break;
      case 'gatling':
        this.osc('weapons', 'square', 760 * pitch, 200, t, 0.06, 0.09);
        break;
      case 'lance':
        this.osc('weapons', 'sawtooth', 1800 * pitch, 120, t, 0.22, 0.16);
        this.noise('weapons', t, 0.14, 0.12, 5000, 1, 500);
        break;
      case 'mortar':
        this.noise('explosions', t, 0.16, 0.3, 500, 1, 90);
        this.osc('explosions', 'sine', 150, 45, t, 0.18, 0.32);
        break;
      case 'cryo':
        this.osc('weapons', 'triangle', 1300 * pitch, 2400, t, 0.12, 0.07);
        this.osc('weapons', 'sine', 2600 * pitch, 3600, t, 0.1, 0.035);
        break;
      case 'missile':
        this.noise('weapons', t, 0.3, 0.14, 900, 2, 3500);
        this.osc('weapons', 'sawtooth', 220 * pitch, 520, t, 0.24, 0.05);
        break;
      case 'tesla': {
        for (let i = 0; i < 3; i++) this.noise('weapons', t + i * 0.02, 0.05, 0.12, 6000, 3);
        this.osc('weapons', 'square', 180 * pitch, 90, t, 0.1, 0.1);
        break;
      }
      case 'prism':
        this.osc('weapons', 'sine', 640 * pitch, 660, t, 0.1, 0.028);
        break;
      case 'ray':
        this.osc('weapons', 'sawtooth', 1400 * pitch, 300, t, 0.16, 0.12);
        this.osc('weapons', 'sine', 2200 * pitch, 700, t, 0.1, 0.05);
        break;
      case 'flame':
        this.noise('weapons', t, 0.28, 0.13, 700, 1, 2200);
        this.osc('weapons', 'triangle', 90 * pitch, 60, t, 0.22, 0.06);
        break;
    }
  }

  explosion(size: 'small' | 'med' | 'big' = 'med') {
    if (!this.ctx || !this.settings.explosions) return;
    const t = this.now();
    if (size === 'small') {
      this.noise('explosions', t, 0.2, 0.22, 1800, 0.8, 200);
      this.osc('explosions', 'sine', 220, 60, t, 0.16, 0.2);
    } else if (size === 'med') {
      this.noise('explosions', t, 0.4, 0.34, 1200, 0.8, 100);
      this.osc('explosions', 'sine', 160, 40, t, 0.3, 0.34);
    } else {
      this.noise('explosions', t, 0.8, 0.44, 900, 0.8, 60);
      this.osc('explosions', 'sine', 110, 28, t, 0.6, 0.5);
      this.osc('explosions', 'triangle', 60, 24, t, 0.7, 0.3);
    }
  }

  pop(size: number) {
    // enemy death — pitch scales inversely with size, satisfying bubble-pop
    if (!this.ctx || !this.settings.explosions) return;
    const t = this.now();
    const f = Math.max(180, 900 - size * 22) * (0.92 + Math.random() * 0.26);
    this.osc('explosions', 'triangle', f, f * 2.4, t, 0.09, 0.16);
    this.noise('explosions', t, 0.07, 0.1, 3200, 1);
  }

  hit() {
    if (!this.ctx || !this.settings.weapons) return;
    if (Math.random() < 0.5) return; // thin out
    const t = this.now();
    this.osc('weapons', 'sine', 500 + Math.random() * 250, 180, t, 0.04, 0.035);
  }

  freezeCrack() {
    if (!this.ctx || !this.settings.weapons) return;
    const t = this.now();
    this.osc('weapons', 'triangle', 2100, 3400, t, 0.14, 0.08);
    this.noise('weapons', t, 0.1, 0.08, 7000, 2);
  }

  // ---------- ui & flow ----------
  // Combo milestone blip: rising notes on the A-major pentatonic so any sequence sounds musical.
  comboBlip(step: number) {
    if (!this.ctx || !this.settings.ui) return;
    const penta = [440, 494, 554, 659, 740, 880, 988, 1109]; // A4 B4 C#5 E5 F#5 A5 B5 C#6
    const f = penta[Math.min(step, penta.length - 1)];
    const t = this.now();
    this.osc('ui', 'sine', f, f * 1.02, t, 0.11, 0.14);
    this.osc('ui', 'triangle', f * 2, f * 2, t + 0.02, 0.07, 0.05);
  }

  ui(kind: string) {
    if (!this.ctx || !this.settings.ui) return;
    const t = this.now();
    switch (kind) {
      case 'click': this.osc('ui', 'sine', 640, 520, t, 0.05, 0.09); break;
      case 'place':
        this.osc('ui', 'sine', 200, 90, t, 0.12, 0.24);
        this.noise('ui', t, 0.07, 0.08, 1200, 1);
        break;
      case 'upgrade':
        this.osc('ui', 'sine', 420, 840, t, 0.1, 0.12);
        this.osc('ui', 'sine', 630, 1260, t + 0.07, 0.12, 0.1);
        break;
      case 'branch':
        for (let i = 0; i < 4; i++) this.osc('ui', 'sine', 440 * Math.pow(1.335, i), 440 * Math.pow(1.335, i), t + i * 0.06, 0.14, 0.09);
        break;
      case 'sell': this.osc('ui', 'sine', 700, 260, t, 0.16, 0.1); break;
      case 'deny':
        this.osc('ui', 'square', 180, 140, t, 0.09, 0.07);
        this.osc('ui', 'square', 150, 120, t + 0.09, 0.11, 0.07);
        break;
      case 'coin':
        this.osc('ui', 'sine', 1100, 1100, t, 0.06, 0.06);
        this.osc('ui', 'sine', 1660, 1660, t + 0.05, 0.09, 0.06);
        break;
      case 'wave':
        this.osc('ui', 'sawtooth', 190, 190, t, 0.24, 0.08);
        this.osc('ui', 'sawtooth', 254, 254, t + 0.02, 0.26, 0.06);
        this.osc('ui', 'sine', 95, 95, t, 0.3, 0.14);
        break;
      case 'leak':
        this.osc('ui', 'square', 320, 150, t, 0.16, 0.16);
        this.osc('ui', 'square', 320, 150, t + 0.16, 0.16, 0.13);
        break;
      case 'boss':
        this.osc('ui', 'sawtooth', 70, 45, t, 0.9, 0.22);
        this.osc('ui', 'sawtooth', 92, 60, t + 0.1, 0.9, 0.16);
        this.noise('ui', t, 0.8, 0.1, 400, 1);
        break;
      case 'ability':
        this.osc('ui', 'sine', 500, 1900, t, 0.3, 0.1);
        break;
    }
  }

  jingle(win: boolean) {
    if (!this.ctx || !this.settings.ui) return;
    const t = this.now();
    const notes = win ? [523, 659, 784, 1046, 784, 1046] : [392, 330, 262, 196];
    notes.forEach((f, i) => {
      this.osc('ui', 'triangle', f, f, t + i * 0.13, 0.3, 0.12);
      this.osc('ui', 'sine', f / 2, f / 2, t + i * 0.13, 0.34, 0.08);
    });
  }

  // ---------- music: soft pastel drift ----------
  startMusic() {
    this.ensure();
    if (!this.ctx || this.musicTimer !== null) return;
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.beatIdx = 0;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 120);
  }
  stopMusic() {
    if (this.musicTimer !== null) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }

  private scheduleMusic() {
    const c = this.ctx!;
    const beatLen = 60 / 68; // 68 bpm, one chord per 4 beats
    // chords: Am7 – Fmaj7 – Cmaj7 – G6 (pastel lo-fi)
    const prog = [
      [220, 261.6, 329.6, 392],
      [174.6, 220, 261.6, 329.6],
      [130.8, 164.8, 196, 246.9],
      [196, 246.9, 293.7, 329.6],
    ];
    const penta = [440, 523.2, 587.3, 659.2, 784, 880];
    while (this.nextBeat < c.currentTime + 0.6) {
      const bar = Math.floor(this.beatIdx / 4) % 4;
      const beat = this.beatIdx % 4;
      const t = this.nextBeat;
      if (beat === 0) {
        // pad chord
        for (const f of prog[bar]) {
          const o = c.createOscillator(); const o2 = c.createOscillator(); const gn = c.createGain();
          const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 900;
          o.type = 'sawtooth'; o2.type = 'sawtooth';
          o.frequency.value = f; o2.frequency.value = f * 1.004;
          const dur = beatLen * 4.2;
          gn.gain.setValueAtTime(0.0001, t);
          gn.gain.linearRampToValueAtTime(0.02, t + 1.2);
          gn.gain.linearRampToValueAtTime(0.0001, t + dur);
          o.connect(flt); o2.connect(flt); flt.connect(gn); gn.connect(this.buses.music);
          o.start(t); o2.start(t); o.stop(t + dur); o2.stop(t + dur);
        }
        // sub root
        const sub = c.createOscillator(); const sg = c.createGain();
        sub.type = 'sine'; sub.frequency.value = prog[bar][0] / 2;
        sg.gain.setValueAtTime(0.0001, t);
        sg.gain.linearRampToValueAtTime(0.045, t + 0.4);
        sg.gain.linearRampToValueAtTime(0.0001, t + beatLen * 3.8);
        sub.connect(sg); sg.connect(this.buses.music);
        sub.start(t); sub.stop(t + beatLen * 4);
      }
      // gentle pluck arpeggio on offbeats, sparse & random — rides the combat layer
      if (Math.random() < 0.65) {
        const f = penta[Math.floor(Math.random() * penta.length)];
        const o = c.createOscillator(); const gn = c.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        const tt = t + beatLen * (Math.random() < 0.5 ? 0.5 : 0);
        gn.gain.setValueAtTime(0.05, tt);
        gn.gain.exponentialRampToValueAtTime(0.0001, tt + 0.9);
        o.connect(gn); gn.connect(this.layerArp || this.buses.music);
        o.start(tt); o.stop(tt + 1);
      }
      // percussion layer: heartbeat kick on beats 0/2, soft hat offbeats — rides danger
      if (this.layerPerc) {
        if (beat === 0 || beat === 2) {
          const o = c.createOscillator(); const gn = c.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(140, t);
          o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
          gn.gain.setValueAtTime(0.35, t);
          gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
          o.connect(gn); gn.connect(this.layerPerc);
          o.start(t); o.stop(t + 0.25);
          // heartbeat double-thump on beat 0
          if (beat === 0) {
            const o2 = c.createOscillator(); const g2 = c.createGain();
            o2.type = 'sine';
            o2.frequency.setValueAtTime(120, t + 0.18);
            o2.frequency.exponentialRampToValueAtTime(44, t + 0.3);
            g2.gain.setValueAtTime(0.22, t + 0.18);
            g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
            o2.connect(g2); g2.connect(this.layerPerc);
            o2.start(t + 0.18); o2.stop(t + 0.4);
          }
        }
        const hlen = Math.ceil(c.sampleRate * 0.08);
        const hbuf = c.createBuffer(1, hlen, c.sampleRate);
        const hd = hbuf.getChannelData(0);
        for (let i2 = 0; i2 < hlen; i2++) hd[i2] = Math.random() * 2 - 1;
        const src2 = c.createBufferSource();
        src2.buffer = hbuf;
        const bp = c.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = 7000;
        const hg = c.createGain();
        const ht = t + beatLen * 0.5;
        hg.gain.setValueAtTime(0.05, ht);
        hg.gain.exponentialRampToValueAtTime(0.0001, ht + 0.06);
        src2.connect(bp); bp.connect(hg); hg.connect(this.layerPerc);
        src2.start(ht); src2.stop(ht + 0.08);
      }
      this.nextBeat += beatLen;
      this.beatIdx++;
    }
  }
}

export const audio = new AudioEngine();
