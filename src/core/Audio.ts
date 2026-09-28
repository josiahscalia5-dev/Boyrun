/**
 * Synthesized sound effects (Web Audio) - no audio files to ship.
 * The context is created lazily on the first user gesture, as mobile
 * browsers and WebViews require.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; noise: AudioBufferSourceNode } | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private coinStreak = 0;
  private lastCoinTime = 0;
  enabled = true;

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.7 : 0;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slideTo?: number): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, q = 1, when = 0, type: BiquadFilterType = 'bandpass', sweepTo?: number): void {
    const c = this.ctx;
    if (!c || !this.master || !this.noiseBuf) return;
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** Bright two-note chime; pitch climbs with a quick coin streak. */
  coin(): void {
    const c = this.ctx;
    if (!c) return;
    const now = c.currentTime;
    this.coinStreak = now - this.lastCoinTime < 0.45 ? Math.min(this.coinStreak + 1, 12) : 0;
    this.lastCoinTime = now;
    const base = 988 * Math.pow(2, (this.coinStreak % 13) / 24);
    this.tone(base, 0.09, 'square', 0.06);
    this.tone(base * 1.5, 0.22, 'sine', 0.12, 0.05);
  }

  whoosh(dir: number): void {
    this.noise(0.22, 0.22, dir < 0 ? 900 : 1100, 0.8, 0, 'bandpass', dir < 0 ? 2600 : 3200);
    this.tone(220, 0.12, 'sine', 0.05, 0, 330);
  }

  blocked(): void {
    this.tone(140, 0.1, 'triangle', 0.12, 0, 110);
  }

  boost(): void {
    this.noise(0.6, 0.25, 600, 0.7, 0, 'bandpass', 4000);
    this.tone(330, 0.35, 'sawtooth', 0.05, 0, 880);
    this.tone(660, 0.3, 'sine', 0.08, 0.08, 1320);
  }

  crash(): void {
    this.noise(0.7, 0.55, 500, 0.6, 0, 'lowpass', 120);
    this.tone(160, 0.5, 'sawtooth', 0.12, 0, 50);
    this.noise(0.25, 0.3, 3000, 2, 0.02, 'highpass');
  }

  countdown(final: boolean): void {
    this.tone(final ? 1046 : 523, final ? 0.45 : 0.18, 'square', 0.08);
    if (final) this.tone(1568, 0.5, 'sine', 0.08, 0.05);
  }

  click(): void {
    this.tone(700, 0.06, 'triangle', 0.1);
  }

  fanfare(): void {
    const notes = [523, 659, 784, 1046, 784, 1046, 1318];
    notes.forEach((n, i) => {
      this.tone(n, 0.28, 'square', 0.05, i * 0.1);
      this.tone(n, 0.4, 'sine', 0.08, i * 0.1);
    });
  }

  /** Continuous rail hum + wind whose pitch/volume follow speed. */
  ride(speed: number, active: boolean): void {
    const c = this.ctx;
    if (!c || !this.master || !this.noiseBuf) return;
    if (!this.hum) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      const gain = c.createGain();
      gain.gain.value = 0;
      const noise = c.createBufferSource();
      noise.buffer = this.noiseBuf;
      noise.loop = true;
      const nf = c.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 900;
      nf.Q.value = 0.5;
      const ng = c.createGain();
      ng.gain.value = 0.35;
      osc.connect(filter);
      noise.connect(nf).connect(ng).connect(filter);
      filter.connect(gain).connect(this.master);
      osc.start();
      noise.start();
      this.hum = { osc, filter, gain, noise };
    }
    const t = c.currentTime;
    const v = active ? Math.min(1, speed / 35) : 0;
    this.hum.osc.frequency.setTargetAtTime(55 + speed * 2.2, t, 0.1);
    this.hum.filter.frequency.setTargetAtTime(250 + speed * 45, t, 0.1);
    this.hum.gain.gain.setTargetAtTime(v * 0.08, t, 0.15);
  }
}
