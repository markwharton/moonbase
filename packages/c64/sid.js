// The SID, as far as a square-wave era of school software used it: three voices, each an
// oscillator at a 16-bit frequency with a triangle, sawtooth, pulse or noise wave, gated by an
// attack, decay, sustain and release envelope, mixed under the master volume. Ring modulation,
// sync and the filter are not here. The machine keeps each register write with its cycle, and
// `render` turns a frame's writes into samples at the sound card's rate.
const CLOCK = 985248;
const ATTACK = [2, 8, 16, 24, 38, 56, 68, 80, 100, 250, 500, 800, 1000, 3000, 5000, 8000];   // ms
const DECAY = [6, 24, 48, 72, 114, 168, 204, 240, 300, 750, 1500, 2400, 3000, 9000, 15000, 24000];

export class SID {
  constructor(rate) {
    this.rate = rate; this.r = new Uint8Array(0x20);
    this.v = [0, 1, 2].map(() => ({ phase: 0, env: 0, stage: 'off', noise: 0x7ffff8, noiseOut: 0 }));
  }
  write(reg, val) {
    const prev = this.r[reg]; this.r[reg] = val;
    if (reg % 7 === 4 && reg < 21) { const v = this.v[(reg / 7) | 0]; if ((val & 1) && !(prev & 1)) v.stage = 'attack'; else if (!(val & 1) && (prev & 1)) v.stage = 'release'; }
  }
  // `n` samples, with the writes in `events` as [sampleIndex, reg, val] applied in order
  render(n, events) {
    const out = new Float32Array(n);
    let e = 0;
    for (let i = 0; i < n; i++) {
      while (e < events.length && events[e][0] <= i) { this.write(events[e][1], events[e][2]); e++; }
      let mix = 0;
      for (let k = 0; k < 3; k++) {
        const b = k * 7, v = this.v[k], r = this.r;
        const freq = r[b] | r[b + 1] << 8, ctrl = r[b + 4];
        // the envelope, in levels of 0 to 1 per sample
        const a = ATTACK[r[b + 5] >> 4] / 1000 * this.rate, d = DECAY[r[b + 5] & 15] / 1000 * this.rate, sus = (r[b + 6] >> 4) / 15, rel = DECAY[r[b + 6] & 15] / 1000 * this.rate;
        if (v.stage === 'attack') { v.env += 1 / Math.max(1, a); if (v.env >= 1) { v.env = 1; v.stage = 'decay'; } }
        else if (v.stage === 'decay') { v.env -= (1 - sus) / Math.max(1, d) * 3; if (v.env <= sus) { v.env = sus; v.stage = 'sustain'; } }
        else if (v.stage === 'release') { v.env -= 1 / Math.max(1, rel) * 3; if (v.env <= 0) { v.env = 0; v.stage = 'off'; } }
        if (v.env <= 0 && v.stage !== 'attack') continue;
        // the oscillator: a 24-bit accumulator, as the chip's, stepped by the frequency
        const step = freq * CLOCK / 16777216 / this.rate;   // cycles of the wave per sample
        const before = v.phase; v.phase = (v.phase + step) % 1;
        let wave = 0;
        if (ctrl & 0x10) wave += v.phase < 0.5 ? v.phase * 4 - 1 : 3 - v.phase * 4;   // triangle
        if (ctrl & 0x20) wave += v.phase * 2 - 1;   // sawtooth
        if (ctrl & 0x40) { const pw = (r[b + 2] | (r[b + 3] & 15) << 8) / 4096; wave += v.phase < pw ? 1 : -1; }   // pulse
        if (ctrl & 0x80) { if (v.phase < before) { const bit = ((v.noise >> 22) ^ (v.noise >> 17)) & 1; v.noise = ((v.noise << 1) | bit) & 0x7fffff; v.noiseOut = (((v.noise >> 22) & 1) << 7 | ((v.noise >> 20) & 1) << 6 | ((v.noise >> 16) & 1) << 5 | ((v.noise >> 13) & 1) << 4 | ((v.noise >> 11) & 1) << 3 | ((v.noise >> 7) & 1) << 2 | ((v.noise >> 4) & 1) << 1 | ((v.noise >> 2) & 1)) / 128 - 1; } wave += v.noiseOut; }
        mix += wave * v.env;
      }
      out[i] = mix * (this.r[0x18] & 15) / 15 * 0.2;
    }
    return out;
  }
}
