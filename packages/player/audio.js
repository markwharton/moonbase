// The speaker. The Apple II makes sound by clicking the speaker, a toggle at $C030, and the
// machine keeps the cycle of each click. `Speaker` turns a run of cycles into a square wave
// at the sound card's rate and plays it through a worklet, which keeps a queue of what it has
// been given and holds the last level when the queue runs dry.
const CYCLES_PER_SECOND = 1020484;

const WORKLET = `
class SpeakerProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.queue = []; this.at = 0; this.level = 0; this.port.onmessage = e => this.queue.push(e.data); }
  process(inputs, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      while (this.queue.length && this.at >= this.queue[0].length) { this.queue.shift(); this.at = 0; }
      if (this.queue.length) this.level = this.queue[0][this.at++];
      out[i] = this.level;
    }
    return true;
  }
}
registerProcessor('speaker', SpeakerProcessor);
`;

export class Speaker {
  constructor() { this.context = null; this.node = null; this.level = 0; this.from = null; }

  // start on a gesture, as browsers require
  async start() {
    if (this.context) return;
    this.context = new AudioContext();
    await this.context.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    this.node = new AudioWorkletNode(this.context, 'speaker');
    this.node.connect(this.context.destination);
    this.rate = this.context.sampleRate;
    if (this.context.state !== 'running') await this.context.resume();
  }

  // the wave for the cycles from the last call up to `cycles`, given the clicks in between
  feed(clicks, cycles) {
    if (!this.node) return;
    if (this.from === null) this.from = cycles;   // from when the sound starts, not from the machine's first cycle
    const perSample = CYCLES_PER_SECOND / this.rate;
    const n = Math.floor((cycles - this.from) / perSample);
    if (n <= 0) return;
    const wave = new Float32Array(n);
    let ci = 0;
    for (let i = 0; i < n; i++) {
      const t = this.from + (i + 1) * perSample;
      while (ci < clicks.length && clicks[ci] <= t) { this.level = this.level ? 0 : 0.25; ci++; }
      wave[i] = this.level;
    }
    this.from += n * perSample;
    this.node.port.postMessage(wave, [wave.buffer]);
  }
}
