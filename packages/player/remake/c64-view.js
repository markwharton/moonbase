// The view of a Commodore 64 title (Zoopak): the frame the VIC-II paints from the remake's
// memory and chips (@moonbase-machines/c64/paint.js), border and all, 384 by 272 in the machine's colours. The
// character ROM, which a text screen in the machine's own letters needs, is the one the emulator
// is given (the page's `roms`), when it is there.
import { paint } from '@moonbase-machines/c64/paint.js';
import { PALETTE, WIDTH, HEIGHT } from '@moonbase-machines/c64/vic.js';

const NS = 'http://www.w3.org/2000/svg';

export class C64View {
  constructor(svg, { engine, chargen }) {
    this.svg = svg; this.engine = engine; this.chargen = chargen;
    svg.setAttribute('viewBox', `0 0 ${WIDTH * 2} ${HEIGHT * 2}`);
    this.canvas = document.createElement('canvas'); this.canvas.width = WIDTH; this.canvas.height = HEIGHT;
    this.image = document.createElementNS(NS, 'image');
    for (const [k, v] of Object.entries({ x: 0, y: 0, width: WIDTH * 2, height: HEIGHT * 2, preserveAspectRatio: 'none', style: 'image-rendering: pixelated' })) this.image.setAttribute(k, v);
    svg.append(this.image);
  }
  snapshot(e) { return e; }
  apply() {}
  prompts() {
    const e = this.engine, frame = paint(e.mem, e.title.chip, this.chargen, this.vic, e.title.splits);
    const ctx = this.canvas.getContext('2d'), pixels = ctx.createImageData(WIDTH, HEIGHT);
    for (let i = 0; i < frame.length; i++) { const [r, g, b] = PALETTE[frame[i]]; pixels.data.set([r, g, b, 255], i * 4); }
    ctx.putImageData(pixels, 0, 0);
    // and the border's colour on either side, where the page is wider than the frame
    this.svg.style.background = `rgb(${PALETTE[frame[0]].join(',')})`;
    this.image.setAttribute('href', this.canvas.toDataURL());
  }
}
