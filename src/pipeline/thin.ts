/**
 * Zhang-Suen thinning: reduces a binary image (1 = ink) to a one-pixel-wide,
 * 8-connected skeleton. Modifies a copy and returns it.
 */
export function thin(src: Uint8Array, w: number, h: number): Uint8Array {
  const img = src.slice();
  // Clear the border so neighbour lookups never leave the image.
  for (let x = 0; x < w; x++) {
    img[x] = 0;
    img[(h - 1) * w + x] = 0;
  }
  for (let y = 0; y < h; y++) {
    img[y * w] = 0;
    img[y * w + w - 1] = 0;
  }

  const toClear: number[] = [];
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      toClear.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!img[i]) continue;
          // Neighbours P2..P9 clockwise starting north.
          const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1];
          const p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const a =
            (+(!p2 && p3)) + (+(!p3 && p4)) + (+(!p4 && p5)) + (+(!p5 && p6)) +
            (+(!p6 && p7)) + (+(!p7 && p8)) + (+(!p8 && p9)) + (+(!p9 && p2));
          if (a !== 1) continue;
          if (pass === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          toClear.push(i);
        }
      }
      if (toClear.length) {
        changed = true;
        for (const i of toClear) img[i] = 0;
      }
    }
  }
  return img;
}
