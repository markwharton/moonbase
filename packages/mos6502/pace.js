// A machine run in a page against the clock, at its own frames a second whatever the display's rate: each animation
// frame runs the frames the clock has come to owe, two at most, so a short hitch (a slow frame, a stall) is caught up
// and the machine keeps to real time. A pause longer than a short hitch, ten frames, is dropped, not caught up: a tab
// in the background gets no animation frames at all, nor does a closed lid or a paused debugger, and a machine owed
// minutes of frames would otherwise run them two to an animation frame, at twice speed or more, until it had paid them
// back. So it comes back at speed from where it stopped, as a switched-on machine does.
//
//   pace(run, rate, { after, now, next })   run(frames) runs one frame of the machine (the frames run so far given);
//                                           rate, its frames a second (a Commodore 64's 50, an Apple II's 60);
//                                           after(frames), once each animation frame, the frames run so far;
//                                           now() and next(f), the clock and the animation frame, the page's unless
//                                           given (a test's)
export const HITCH = 10;   // frames: a pause longer than this is dropped

export function pace(run, rate, { after = () => {}, now = () => performance.now(), next = f => requestAnimationFrame(f) } = {}) {
  const period = 1000 / rate;
  let frames = 0, started = now();
  function tick() {
    let owed = Math.floor((now() - started) / period) - frames;
    if (owed > HITCH) { started += (owed - 2) * period; owed = 2; }
    for (let i = 0; i < Math.min(2, owed); i++) { frames++; run(frames); }
    after(frames);
    next(tick);
  }
  tick();
}
