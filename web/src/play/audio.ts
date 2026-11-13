const KEY = 'ars.play.muted';

export function readMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export class Sound {
  muted = readMuted();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const length = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  unlock(): void {
    this.ensure();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(KEY, muted ? '1' : '0');
    } catch {
      return;
    } finally {
      if (this.master) this.master.gain.value = muted ? 0 : 0.5;
    }
  }

  private tone(frequency: number, duration: number, type: OscillatorType, volume: number, delay = 0, slide = 0): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const at = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency + slide), at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.05);
  }

  private burst(duration: number, frequency: number, volume: number, sweep = 0): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(frequency, ctx.currentTime);
    if (sweep)
      filter.frequency.exponentialRampToValueAtTime(Math.max(60, frequency + sweep), ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    source.stop(ctx.currentTime + duration + 0.05);
  }

  beep(final: boolean): void {
    this.tone(final ? 880 : 440, final ? 0.55 : 0.18, 'square', 0.16);
  }

  step(intensity: number): void {
    this.burst(0.07, 140 + intensity * 60, 0.1 + intensity * 0.12);
  }

  boost(): void {
    this.burst(0.6, 500, 0.3, 2400);
    this.tone(220, 0.35, 'sawtooth', 0.07, 0, 500);
  }

  pad(): void {
    this.tone(520, 0.12, 'triangle', 0.2);
    this.tone(780, 0.14, 'triangle', 0.2, 0.08);
    this.tone(1040, 0.2, 'triangle', 0.2, 0.16);
  }

  treat(): void {
    this.tone(880, 0.09, 'sine', 0.25);
    this.tone(1320, 0.16, 'sine', 0.25, 0.07);
  }

  bump(): void {
    this.burst(0.16, 180, 0.4, -100);
  }

  lap(): void {
    this.tone(660, 0.12, 'triangle', 0.2);
    this.tone(990, 0.25, 'triangle', 0.2, 0.12);
  }

  finish(win: boolean): void {
    const notes = win ? [523, 659, 784, 1047, 784, 1047] : [523, 659, 784];
    notes.forEach((note, index) => this.tone(note, 0.22, 'triangle', 0.22, index * 0.13));
  }

  setWind(speed: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    if (!this.wind) {
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.6;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master);
      source.start();
      this.wind = { gain, filter };
    }
    this.wind.gain.gain.setTargetAtTime(Math.min(0.22, speed * speed * 0.2), ctx.currentTime, 0.1);
    this.wind.filter.frequency.setTargetAtTime(300 + speed * 900, ctx.currentTime, 0.1);
  }

  dispose(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
    this.wind = null;
  }
}
