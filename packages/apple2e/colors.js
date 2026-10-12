// The sixteen colors of the Apple IIe's double hi-res screen, as the vector engine numbers them.
// A color is 0 to 15, and its four bits, high bit first, are the pattern the engine writes for
// it along a row: its table at $5FAD in Animal Rescue's PART0, $54FE in Nature Park's, has
// 33 66 4C 19 for 12, which is 1100 repeated, and Apple's list of double hi-res colors calls
// that medium blue.
export const COLORS = [[0, 0, 0], [227, 30, 96], [96, 78, 0], [255, 106, 60], [0, 163, 96], [156, 156, 156], [20, 245, 60], [208, 221, 141],
  [96, 78, 224], [255, 68, 253], [156, 156, 156], [255, 160, 208], [20, 207, 253], [114, 168, 255], [114, 255, 208], [255, 255, 255]];
export const NAMES = ['black', 'magenta', 'brown', 'orange', 'dark green', 'gray', 'green', 'yellow', 'dark blue', 'purple', 'gray', 'pink', 'medium blue', 'light blue', 'aqua', 'white'];

export const rgb = c => 'rgb(' + COLORS[c & 15].join(',') + ')';
