// The view of a card toolkit title (card.js): the screen as the remake's memory holds
// it, the hi-res page the soft switches show, or the text screen, painted dot for dot as the
// machine's page paints it (@moonbase-machines/apple2e/screen.js), 560 by 384. The toolkit's pictures are bitmaps,
// and this is them as they are; drawing them sharper is for later.
//
// `inset` (a title's, its title.js), when set on: the screen's band at the top, where it is (its rows above
// `top` all white), its dots `move` moved `by`, to make room for a mini view; `banded`, whether the band was there
// at the last painting.
import { paintHires, paintText } from '@moonbase-machines/apple2e/screen.js';

const NS = 'http://www.w3.org/2000/svg';

export class CardView {
  constructor(svg, { engine, inset = null }) {
    this.svg = svg; this.engine = engine; this.inset = inset; this.insetOn = false; this.banded = false;
    svg.setAttribute('viewBox', '0 0 560 384');
    this.canvas = document.createElement('canvas'); this.canvas.width = 560; this.canvas.height = 384;
    this.image = document.createElementNS(NS, 'image');
    for (const [k, v] of Object.entries({ x: 0, y: 0, width: 560, height: 384, preserveAspectRatio: 'none', style: 'image-rendering: pixelated' })) this.image.setAttribute(k, v);
    svg.append(this.image);
  }
  snapshot(e) { return e; }
  apply() {}
  // the screen, when a run has gone as far as it goes
  prompts() {
    const mem = this.engine.mem, s = this.engine.title.screen, ctx = this.canvas.getContext('2d');
    const pixels = ctx.createImageData(560, 384);
    if (s.text) paintText(pixels.data, mem, mem, false, [0, 24]);
    else {
      const page = s.page2 ? 0x4000 : 0x2000;
      paintHires(pixels.data, mem.subarray(page, page + 0x2000));
      if (s.mixed) paintText(pixels.data, mem, mem, false, [20, 24]);
    }
    this.banded = this.insetOn && !!this.inset && band(pixels.data, this.inset);
    if (this.banded) shift(pixels.data, this.inset);
    ctx.putImageData(pixels, 0, 0);
    this.image.setAttribute('href', this.canvas.toDataURL());
  }
}

// (whether the band is on the screen: its rows above `top` white, the whole width)
function band(px, { top }) {
  for (let y = 0; y < top; y++) for (let x = 0; x < 560; x++) { const i = (y * 560 + x) * 4; if (px[i] < 200 || px[i + 1] < 200 || px[i + 2] < 200) return false; }
  return true;
}
// (the band's rows `top` to `bottom`: the dots `move` moved `by`, white where they were)
function shift(px, { top, bottom, move: [from, to], by }) {
  for (let y = top; y <= bottom; y++) {
    const row = y * 560 * 4;
    px.copyWithin(row + (from + by) * 4, row + from * 4, row + to * 4);
    if (by < 0) px.fill(255, row + (to + by) * 4, row + to * 4); else px.fill(255, row + from * 4, row + (from + by) * 4);
  }
}
